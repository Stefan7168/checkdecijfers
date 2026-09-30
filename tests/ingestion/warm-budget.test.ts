// The run's time budget is a real upper bound (open-questions #358 item 5): every CBS request the warm job and the
// conversion make is limited to the SMALLER of its own limit and the time left in --budget-seconds (the adapter's
// `stopAt`, on top of the existing per-attempt limit of src/sources/fetch-with-timeout.ts). A request cut by the
// budget is "not done": it counts as remaining, the next run repeats it, and nothing of it is stored — the table
// never answers from half a request. Hermetic: a fake CBS (fixture documents behind a fake fetch) whose data
// requests can hang forever; the real ODataV4Source, the real slice store, embedded Postgres.
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FixtureSource, loadFixtureDocs, type FixtureDocs } from '../../src/cbs-adapter/fixture-source.ts';
import { ODataV4Source } from '../../src/cbs-adapter/odata-v4.ts';
import type { CbsSource } from '../../src/cbs-adapter/types.ts';
import type { Db } from '../../src/db/types.ts';
import { runCli } from '../../src/ingestion/cli.ts';
import { convertTableToSlices } from '../../src/ingestion/convert.ts';
import { registerTables, syncTable } from '../../src/ingestion/pipeline.ts';
import { SEED_TABLES } from '../../src/ingestion/registry-seed.ts';
import { registerSchemaOnly } from '../../src/ingestion/slice-cache.ts';
import { warmTable } from '../../src/ingestion/warm-job.ts';
import { BUDGET_ENDED_PHRASE } from '../../src/sources/fetch-with-timeout.ts';
import { createTestDb } from '../helpers/pglite-db.ts';

const FIXTURES_DIR = fileURLToPath(new URL('../fixtures/cbs', import.meta.url));
const BASE = 'https://datasets.cbs.nl/odata/v1/CBS';
const POP = '03759ned';
/** How far past the budget a run may end (a slow test machine, the database work after the cut). */
const TOLERANCE_MS = 800;

let db: Db;
let closeDb: () => Promise<void>;

beforeAll(async () => {
  ({ db, close: closeDb } = await createTestDb());
});
afterAll(async () => {
  await closeDb();
});
beforeEach(async () => {
  await db.query('truncate table observations, dimension_labels, ingestion_batches, cbs_tables restart identity cascade');
});

const docs = (): FixtureDocs => loadFixtureDocs(`${FIXTURES_DIR}/${POP}`);

function json(body: unknown, status = 200) {
  return { ok: status === 200, status, statusText: status === 200 ? 'OK' : 'Not Found', json: async () => body, text: async () => JSON.stringify(body) };
}

/** CBS behind a fake fetch: the fixture's metadata, and Observations filtered by the request's $filter (only the
 * `<dimension> eq '<code>'` clauses the warm job sends). The first `answer` data requests are answered at once; every
 * later one HANGS FOREVER and ignores its abort signal — only the time limit can end it. */
function slowCbs(serve: FixtureDocs, answer: number) {
  const seen = { observations: 0, hung: 0 };
  const fetchFn = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    const path = url.pathname.replace(/^\/odata\/v1\/CBS\/[^/]+\//, '');
    if (path === 'Properties') return json(serve.properties);
    if (path === 'Dimensions') return json(serve.dimensions);
    if (path === 'MeasureCodes') return json(serve.measureCodes);
    if (path === 'MeasureGroups') return json({}, 404);
    if (path.endsWith('Codes')) return json(serve.codes[path.slice(0, -'Codes'.length)]);
    if (path === 'Observations') {
      seen.observations += 1;
      if (seen.observations > answer) {
        seen.hung += 1;
        return new Promise<never>(() => {});
      }
      const wanted = new Map<string, Set<string>>();
      for (const [, dim, code] of (url.searchParams.get('$filter') ?? '').matchAll(/(\w+) eq '([^']*)'/g)) {
        if (!wanted.has(dim!)) wanted.set(dim!, new Set());
        wanted.get(dim!)!.add(code!);
      }
      const rows = (serve.observationPages as { value: Record<string, unknown>[] }[])
        .flatMap((p) => p.value)
        .filter((r) => [...wanted].every(([dim, codes]) => codes.has(String(r[dim]))));
      return json({ value: rows });
    }
    throw new Error(`unexpected request ${url.href}`);
  }) as unknown as typeof fetch;
  return { fetchFn, seen };
}

async function registerPinned(source: CbsSource): Promise<void> {
  const t = SEED_TABLES.find((e) => e.id === POP)!;
  const r = await registerSchemaOnly(db, source, POP, undefined, {
    pinned: true,
    updateCadence: t.updateCadence,
    slice: t.slice ?? null,
    excludeMeasures: t.excludeMeasures,
  });
  if (!r.ok) throw new Error(r.summary);
}

async function cells(): Promise<string> {
  const { rows } = await db.query(
    `select measure, region_code, period_code, dims::text as dims, value::text as value, status
       from observations where table_id = $1 order by measure, region_code, period_code, dims::text`,
    [POP],
  );
  return JSON.stringify(rows);
}

async function sliceRows(): Promise<string> {
  const { rows } = await db.query(
    'select filter_key, cbs_modified, checked_at, row_count from slice_fetches where table_id = $1 order by filter_key',
    [POP],
  );
  return JSON.stringify(rows);
}

describe('the warm job under a time budget', () => {
  it('a hung data request is cut at the budget: the run ends on time, the cut request is remaining, nothing half-stored', async () => {
    const serve = docs();
    await registerPinned(new FixtureSource(serve));
    const { fetchFn, seen } = slowCbs(serve, 1);
    const budgetMs = 3_000;
    const startedAt = Date.now();
    const stopAt = startedAt + budgetMs;
    // The per-attempt limit alone (5 min) would hold the run for minutes; the budget must cut it.
    const source = new ODataV4Source({ fetchFn, stopAt, retryBackoffMs: 1, observationsTimeoutMs: 300_000 });

    const result = await warmTable(db, source, POP, { deadline: stopAt });
    const elapsed = Date.now() - startedAt;

    expect(elapsed).toBeLessThan(budgetMs + TOLERANCE_MS);
    expect(elapsed).toBeGreaterThanOrEqual(budgetMs - 50); // it really waited for the budget, not a shorter limit
    expect(seen.hung).toBe(1); // the cut request was not retried
    expect(result.planned).toBeGreaterThan(2);
    // Recorded as not done — neither a failure nor a confirmation; the first request stays stored.
    expect(result).toMatchObject({ outcome: 'partial', fetched: 1, confirmed: 0, remaining: result.planned - 1 });
    expect(result.failure).toBeUndefined();
    expect((await db.query('select last_sync_at from cbs_tables where id = $1', [POP])).rows[0]!.last_sync_at).toBeNull();
    const stored = (await db.query('select count(*)::int as n from slice_fetches where table_id = $1', [POP])).rows[0]!.n;
    expect(stored).toBe(1);

    // The next run (no hang) finishes exactly the remaining requests and ends with the same cells the whole-table path stores.
    const rest = slowCbs(serve, Infinity);
    const second = await warmTable(db, new ODataV4Source({ fetchFn: rest.fetchFn, retryBackoffMs: 1 }), POP, {
      deadline: Date.now() + 60_000,
    });
    expect(second).toMatchObject({ outcome: 'complete', confirmed: 1, fetched: result.planned - 1, remaining: 0 });
    const warmed = await cells();
    await db.query('truncate table observations, dimension_labels, ingestion_batches, cbs_tables restart identity cascade');
    const whole = new FixtureSource(serve);
    await registerTables(db, whole, [SEED_TABLES.find((e) => e.id === POP)!], { pinned: true });
    expect((await syncTable(db, whole, POP)).outcome).toBe('succeeded');
    expect(warmed).toBe(await cells());
  }, 30_000);

  it('a request cut on a table that was already warm leaves its stored cells and slice records untouched', async () => {
    const serve = docs();
    await registerPinned(new FixtureSource(serve));
    const first = await warmTable(db, new FixtureSource(serve), POP, { deadline: Date.now() + 60_000 });
    expect(first.outcome).toBe('complete');
    const cellsBefore = await cells();
    const slicesBefore = await sliceRows();

    // CBS now says the table was modified, so the warm run must re-fetch — and that data request hangs.
    const newer = structuredClone(serve);
    (newer.properties as Record<string, unknown>).Modified = '2026-09-29T00:00:00+02:00';
    const { fetchFn, seen } = slowCbs(newer, 0);
    const budgetMs = 2_000;
    const startedAt = Date.now();
    const stopAt = startedAt + budgetMs;
    const source = new ODataV4Source({ fetchFn, stopAt, retryBackoffMs: 1 });

    const result = await warmTable(db, source, POP, { deadline: stopAt });

    expect(Date.now() - startedAt).toBeLessThan(budgetMs + TOLERANCE_MS);
    expect(seen.hung).toBe(1);
    expect(result).toMatchObject({ outcome: 'partial', fetched: 0, confirmed: 0, remaining: first.planned });
    expect(await cells()).toBe(cellsBefore);
    expect(await sliceRows()).toBe(slicesBefore);
  }, 30_000);

  it('a budget that ends during the one schema read skips the table as "deadline" — not a failure, nothing written', async () => {
    const serve = docs();
    await registerPinned(new FixtureSource(serve));
    const hang = (async () => new Promise<never>(() => {})) as unknown as typeof fetch;
    const budgetMs = 700;
    const startedAt = Date.now();
    const stopAt = startedAt + budgetMs;
    const source = new ODataV4Source({ fetchFn: hang, stopAt, retryBackoffMs: 1 });

    const result = await warmTable(db, source, POP, { deadline: stopAt });

    expect(Date.now() - startedAt).toBeLessThan(budgetMs + TOLERANCE_MS);
    expect(result).toMatchObject({ outcome: 'skipped', skippedReason: 'deadline' });
    expect(await cells()).toBe('[]');
    expect(await sliceRows()).toBe('[]');
  }, 30_000);

  it('without a budget the behaviour is unchanged: a hung request is ended by the per-attempt limit and reported as a failure', async () => {
    const serve = docs();
    await registerPinned(new FixtureSource(serve));
    const { fetchFn } = slowCbs(serve, 0);
    const source = new ODataV4Source({ fetchFn, retryBackoffMs: 1, observationsTimeoutMs: 100 });

    const result = await warmTable(db, source, POP, { deadline: Date.now() + 60_000 });

    expect(result.outcome).toBe('failed');
    expect(result.failure?.summary).toMatch(/timed out/);
    expect(result.failure?.summary).not.toContain(BUDGET_ENDED_PHRASE);
  }, 30_000);
});

describe('the conversion under a time budget', () => {
  it('a hung comparison request is cut at the budget: refused, nothing written', async () => {
    const serve = docs();
    const whole = new FixtureSource(serve);
    await registerTables(db, whole, [SEED_TABLES.find((e) => e.id === POP)!], { pinned: true });
    expect((await syncTable(db, whole, POP)).outcome).toBe('succeeded');
    const cellsBefore = await cells();

    const { fetchFn, seen } = slowCbs(serve, 0);
    const budgetMs = 2_000;
    const startedAt = Date.now();
    const stopAt = startedAt + budgetMs;
    const source = new ODataV4Source({ fetchFn, stopAt, retryBackoffMs: 1 });

    const result = await convertTableToSlices(db, source, POP, { deadline: stopAt, apply: true });

    expect(Date.now() - startedAt).toBeLessThan(budgetMs + TOLERANCE_MS);
    expect(seen.hung).toBe(1);
    expect(result.outcome).toBe('refused');
    expect(result.reason).toContain(BUDGET_ENDED_PHRASE);
    expect((await db.query('select ingest_mode from cbs_tables where id = $1', [POP])).rows[0]!.ingest_mode).toBe('full');
    expect(await cells()).toBe(cellsBefore);
    expect(await sliceRows()).toBe('[]');
  }, 30_000);
});

describe('ingest warm / convert-to-slices (command line)', () => {
  it('hand the run a source built for the budget: stopAt is the run start plus --budget-seconds', async () => {
    const serve = docs();
    const fixture = new FixtureSource(serve);
    await registerPinned(fixture);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const stops: number[] = [];
    try {
      const before = Date.now();
      const code = await runCli(['warm', POP, '--budget-seconds', '120'], {
        db,
        source: fixture,
        sourceForBudget: (stopAt) => {
          stops.push(stopAt);
          return fixture;
        },
      });
      const after = Date.now();
      expect(code).toBe(0);
      expect(stops).toHaveLength(1);
      expect(stops[0]!).toBeGreaterThanOrEqual(before + 120_000);
      expect(stops[0]!).toBeLessThanOrEqual(after + 120_000);

      await runCli(['convert-to-slices', POP, '--budget-seconds', '30'], {
        db,
        source: fixture,
        sourceForBudget: (stopAt) => {
          stops.push(stopAt);
          return fixture;
        },
      });
      expect(stops).toHaveLength(2);
      expect(stops[1]! - Date.now()).toBeLessThanOrEqual(30_000);
    } finally {
      log.mockRestore();
    }
  }, 30_000);
});

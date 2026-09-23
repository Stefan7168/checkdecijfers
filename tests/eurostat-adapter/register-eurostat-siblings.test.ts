// E2a step 5 (docs/RUNBOOK.md "E2a step 5"; requirement 3 of the step-5
// brief): scripts/register-eurostat-siblings.ts's core logic
// (`registerEurostatSiblings`), exercised hermetically — a stubbed
// `StatisticsApiSource` (never the real network, mirroring
// tests/eurostat-adapter/register-sync.test.ts's own pattern) over a PGlite
// database. Never runs the CLI entry (which connects to a real DATABASE_URL
// and the real Eurostat API).
import { describe, expect, it, vi } from 'vitest';
import { createTestDb } from '../helpers/pglite-db.ts';
import { registerEurostatSiblings } from '../../scripts/register-eurostat-siblings.ts';
import { registerTables } from '../../src/ingestion/pipeline.ts';
import { StatisticsApiSource } from '../../src/eurostat-adapter/statistics-api.ts';
import { EUROSTAT_SIBLING_REGISTRATIONS } from '../../src/sources/eurostat-siblings.ts';

/** One minimal, valid JSON-stat dataset per reviewed table — small enough to
 * register + sync in one cell, shaped after each table's real dimensions
 * (research doc §1-3) so `registerTables`/`syncTable`'s five checks pass. */
const DATASETS: Readonly<Record<string, unknown>> = {
  une_rt_q: {
    version: '2.0',
    class: 'dataset',
    label: 'Unemployment by sex and age - quarterly data',
    id: ['s_adj', 'age', 'sex', 'unit', 'geo', 'time'],
    size: [1, 1, 1, 1, 1, 1],
    dimension: {
      s_adj: { category: { index: { SA: 0 }, label: { SA: 'Seasonally adjusted data' } } },
      age: { category: { index: { 'Y15-74': 0 }, label: { 'Y15-74': 'From 15 to 74 years' } } },
      sex: { category: { index: { T: 0 }, label: { T: 'Total' } } },
      unit: { category: { index: { PC_ACT: 0 }, label: { PC_ACT: 'Percentage of population in the labour force' } } },
      geo: { category: { index: { NL: 0 }, label: { NL: 'Netherlands' } } },
      time: { category: { index: { '2024-Q1': 0 }, label: { '2024-Q1': '2024-Q1' } } },
    },
    value: [3.5],
  },
  prc_hicp_manr: {
    version: '2.0',
    class: 'dataset',
    label: 'HICP - monthly data (annual rate of change)',
    id: ['unit', 'coicop', 'geo', 'time'],
    size: [1, 1, 1, 1],
    dimension: {
      unit: { category: { index: { RCH_A: 0 }, label: { RCH_A: 'Annual rate of change' } } },
      coicop: { category: { index: { CP00: 0 }, label: { CP00: 'All-items HICP' } } },
      geo: { category: { index: { NL: 0 }, label: { NL: 'Netherlands' } } },
      // The response's own time CATEGORY codes read 'YYYY-Mnn' (with 'M') —
      // distinct from the REQUEST's `sinceTimePeriod=YYYY-MM` (no 'M'), per
      // statistics-api.ts's `sinceTimePeriodFor` doc comment.
      time: { category: { index: { '2025-M03': 0 }, label: { '2025-M03': '2025-M03' } } },
    },
    value: [2.1],
  },
  namq_10_gdp: {
    version: '2.0',
    class: 'dataset',
    label: 'Gross domestic product (GDP) and main components - quarterly data',
    id: ['unit', 's_adj', 'na_item', 'geo', 'time'],
    size: [1, 1, 1, 1, 1],
    dimension: {
      unit: { category: { index: { CLV_PCH_SM: 0 }, label: { CLV_PCH_SM: 'Chain linked volumes, % change on same period' } } },
      s_adj: { category: { index: { SCA: 0 }, label: { SCA: 'Seasonally and calendar adjusted data' } } },
      na_item: { category: { index: { B1GQ: 0 }, label: { B1GQ: 'Gross domestic product at market prices' } } },
      geo: { category: { index: { NL: 0 }, label: { NL: 'Netherlands' } } },
      time: { category: { index: { '2024-Q1': 0 }, label: { '2024-Q1': '2024-Q1' } } },
    },
    value: [1.2],
  },
};

async function fakeDataciteFetch(): Promise<Response> {
  return new Response(JSON.stringify({ data: { attributes: { state: 'findable' } } }), {
    status: 200,
    headers: { 'content-type': 'application/vnd.api+json' },
  });
}

function stubSource() {
  const fetchFn = vi.fn(async (url: string) => {
    const nativeCode = Object.keys(DATASETS).find((code) => url.includes(`/data/${code}?`));
    if (!nativeCode) throw new Error(`stub fetch: no fixture for ${url}`);
    return new Response(JSON.stringify(DATASETS[nativeCode]), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  return { fetchFn, source: new StatisticsApiSource(fetchFn as unknown as typeof fetch) };
}

describe('registerEurostatSiblings — dry run (default)', () => {
  it('writes NOTHING and makes NO network call: an empty db reports all three as "to register", zero rows written', async () => {
    const { db, close } = await createTestDb();
    try {
      const { fetchFn, source } = stubSource();
      const lines: string[] = [];
      const result = await registerEurostatSiblings(db, source, { log: (l) => lines.push(l) });

      expect(result.applied).toBe(false);
      expect(result.alreadyRegistered).toEqual([]);
      expect(result.newlyRegistered).toEqual([]);
      expect(fetchFn).not.toHaveBeenCalled();

      const { rows } = await db.query('select count(*) c from cbs_tables');
      expect(Number(rows[0]!.c)).toBe(0);

      // Prints the request URL per table (buildRequestUrl — the SAME
      // function the real adapter uses, never a hand-built copy).
      for (const reg of EUROSTAT_SIBLING_REGISTRATIONS) {
        const line = lines.find((l) => l.includes(reg.tableId) && l.includes('would request'));
        expect(line, reg.tableId).toBeDefined();
        // The structural EU/EFTA geo sweep is always in the printed URL (the
        // adapter adds it whenever a slice is present) — proving the dry run
        // prints the REAL request URL, not a guess.
        expect(line).toContain('geo=NL');
        expect(line).toContain(`sinceTimePeriod=`);
      }
    } finally {
      await close();
    }
  });

  it('reports an already-registered table as skipped, not re-fetched, even in dry run', async () => {
    const { db, close } = await createTestDb();
    try {
      const { fetchFn, source } = stubSource();
      const uneRtQ = EUROSTAT_SIBLING_REGISTRATIONS.find((r) => r.tableId === 'eurostat:une_rt_q')!;
      // Register just une_rt_q for real first, out of band (never through
      // registerEurostatSiblings itself, which would register all three).
      await registerTables(
        db,
        source,
        [{ id: uneRtQ.tableId, updateCadence: uneRtQ.updateCadence, servesTasks: [], slice: uneRtQ.slice }],
        { fetchImpl: fakeDataciteFetch },
      );
      fetchFn.mockClear();

      const result = await registerEurostatSiblings(db, source);
      expect(result.alreadyRegistered).toEqual([uneRtQ.tableId]);
      expect(fetchFn).not.toHaveBeenCalled();
    } finally {
      await close();
    }
  });
});

describe('registerEurostatSiblings — --apply', () => {
  it('registers + syncs all three reviewed tables, pinned (eviction-exempt)', async () => {
    const { db, close } = await createTestDb();
    try {
      const { source } = stubSource();
      const result = await registerEurostatSiblings(db, source, { apply: true });

      expect(result.applied).toBe(true);
      expect(result.newlyRegistered.sort()).toEqual(EUROSTAT_SIBLING_REGISTRATIONS.map((r) => r.tableId).sort());
      expect(result.synced.every((s) => s.outcome === 'succeeded')).toBe(true);

      const { rows } = await db.query('select id, pinned, source from cbs_tables order by id');
      expect(rows).toHaveLength(3);
      for (const row of rows) {
        expect(row.pinned, row.id as string).toBe(true);
        expect(row.source).toBe('eurostat');
      }
    } finally {
      await close();
    }
  });

  it('is idempotent: a second --apply run registers nothing new, reports all three already registered', async () => {
    const { db, close } = await createTestDb();
    try {
      const { source } = stubSource();
      await registerEurostatSiblings(db, source, { apply: true });
      const second = await registerEurostatSiblings(db, source, { apply: true });

      expect(second.newlyRegistered).toEqual([]);
      expect(second.alreadyRegistered.sort()).toEqual(EUROSTAT_SIBLING_REGISTRATIONS.map((r) => r.tableId).sort());

      const { rows } = await db.query('select count(*) c from cbs_tables');
      expect(Number(rows[0]!.c)).toBe(3);
    } finally {
      await close();
    }
  });
});

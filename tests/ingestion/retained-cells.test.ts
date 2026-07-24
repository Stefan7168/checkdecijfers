// #154 (design: docs/session-briefs/2026-07-19-154-design.md): per-cell
// freshness truth for RETAINED cells — the s47 repro pinned end to end.
// Scenario A drives the full life cycle on one hermetic db: mark on absence
// (with the PRIOR-batch value, proven distinguishable from the cell's own
// batch_id by syncing clean twice first), the honest min attribution date,
// the retained-branch staleness wording, no date-creep on repeated absence,
// and the clear-on-reappearance reset. Scenario B pins the transition lower
// bound (pre-migration prior batches → the cell's OWN batch_id, never a
// later batch). The no-retained-cells regression belt is the entire existing
// suite: with zero marked rows every attribution date degrades to
// cbs_tables.last_sync_at byte-identically.
import { describe, expect, it } from 'vitest';
import { FixtureSource, loadFixtureDocs } from '../../src/cbs-adapter/fixture-source.ts';
import { registerTables, syncTable } from '../../src/ingestion/pipeline.ts';
import { SEED_TABLES } from '../../src/ingestion/registry-seed.ts';
import { applyRegistryDefaults } from '../../src/registry/apply.ts';
import { CANONICAL_MEASURES } from '../../src/registry/defaults.ts';
import { runQuery } from '../../src/query/index.ts';
import type { StructuredIntent } from '../../src/query/types.ts';
import { checkStaleness } from '../../src/answer/respond/staleness.ts';
import type { Db } from '../../src/db/types.ts';
import { createTestDb } from '../helpers/pglite-db.ts';
import { fileURLToPath } from 'node:url';

const FIXTURES_DIR = fileURLToPath(new URL('../fixtures/cbs', import.meta.url));
const TABLE_ID = '85224NED';

function seedTable(id: string) {
  const t = SEED_TABLES.find((entry) => entry.id === id);
  if (!t) throw new Error(`no seed entry for ${id}`);
  return t;
}

type RawDocs = Awaited<ReturnType<typeof loadFixtureDocs>>;

async function setup(): Promise<{ db: Db; close(): Promise<void>; docs: RawDocs }> {
  const { db, close } = await createTestDb();
  const docs = await loadFixtureDocs(`${FIXTURES_DIR}/${TABLE_ID}`);
  const source = new FixtureSource(docs);
  await registerTables(db, source, [seedTable(TABLE_ID)]);
  await applyRegistryDefaults(db); // other seed tables unregistered here — their rows simply skip
  return { db, close, docs };
}

// The seasonally-adjusted dimension is a materially-different-readings axis
// that is never defaulted silently — the explicit intent must carry the
// canonical entry's own dims (the same coordinates production resolves to).
const CANON = CANONICAL_MEASURES.find((m) => m.key === 'unemployment_rate_seasonally_adjusted')!;

const INTENT: StructuredIntent = {
  schemaVersion: 1,
  target: { kind: 'explicit', tableId: CANON.tableId, measure: CANON.measure, dims: CANON.dims },
  period: { kind: 'codes', codes: ['2025KW04'] },
  derivation: 'none',
} as StructuredIntent;

async function cleanSync(db: Db, docs: RawDocs): Promise<number> {
  const result = await syncTable(db, new FixtureSource(structuredClone(docs)), TABLE_ID);
  if (result.outcome !== 'succeeded') {
    throw new Error(`clean sync failed at ${result.failureStage}: ${result.failureSummary}`);
  }
  return result.batchId;
}

/** Second-sync docs with the target coordinate's wire row(s) removed —
 * within the ±20% row tolerance, so the sync succeeds with rows_missing. */
function withOmitted(
  docs: RawDocs,
  measure: string,
  periodCode: string,
  dims: Record<string, string>,
): { docs: RawDocs; dropped: number } {
  const mutated = structuredClone(docs);
  const pages = (mutated as { observationPages: { value: Record<string, unknown>[] }[] })
    .observationPages;
  let dropped = 0;
  for (const page of pages) {
    const before = page.value.length;
    page.value = page.value.filter(
      (row) =>
        !(
          row.Measure === measure &&
          row.Perioden === periodCode &&
          Object.entries(dims).every(([dim, code]) => row[dim] === code)
        ),
    );
    dropped += before - page.value.length;
  }
  if (dropped === 0) throw new Error('fixture mutation dropped nothing — wrong coordinate?');
  return { docs: mutated, dropped };
}

async function markerFor(
  db: Db,
  measure: string,
  periodCode: string,
  dims: Record<string, string>,
): Promise<number | null> {
  const { rows } = await db.query(
    `select last_seen_batch_id from observations
      where table_id = $1 and measure = $2 and period_code = $3 and dims = $4::jsonb`,
    [TABLE_ID, measure, periodCode, JSON.stringify(dims)],
  );
  if (rows.length !== 1) throw new Error(`expected 1 observation row, got ${rows.length}`);
  const id = rows[0]!.last_seen_batch_id;
  return id == null ? null : Number(id);
}

async function batchFinishedAtIso(db: Db, batchId: number): Promise<string> {
  const { rows } = await db.query('select finished_at from ingestion_batches where id = $1', [
    batchId,
  ]);
  return new Date(rows[0]!.finished_at as string | Date).toISOString();
}

async function tableLastSyncIso(db: Db): Promise<string> {
  const { rows } = await db.query('select last_sync_at from cbs_tables where id = $1', [TABLE_ID]);
  return new Date(rows[0]!.last_sync_at as string | Date).toISOString();
}

describe('#154 retained cells — scenario A: the full life cycle', () => {
  it('marks with the PRIOR batch, dates the result honestly, fires the retained staleness branch, never creeps, clears on reappearance', async () => {
    const { db, close, docs } = await setup();
    try {
      const batch1 = await cleanSync(db, docs);
      const batch2 = await cleanSync(db, docs);
      expect(batch2).toBeGreaterThan(batch1);

      // Baseline: the fresh result carries the table-level date (today's behavior).
      const baseline = await runQuery(db, INTENT);
      if (!baseline.ok) throw new Error(`baseline refused: ${JSON.stringify(baseline.refusal)}`);
      expect(baseline.attribution.syncedAt).toBe(await tableLastSyncIso(db));
      const cell = baseline.cells[0]!;

      // Sync 3 omits the cell → marked with batch2 (the PRIOR succeeded
      // batch), provably NOT the cell's own batch_id (which is batch1: the
      // unchanged-row guard left batch2 untouched on it).
      const omitted = withOmitted(docs, cell.measure, cell.periodCode, cell.dims);
      const sync3 = await syncTable(db, new FixtureSource(structuredClone(omitted.docs)), TABLE_ID);
      if (sync3.outcome !== 'succeeded') throw new Error(`sync3 failed: ${sync3.failureSummary}`);
      expect(sync3.rowsMissing).toBe(omitted.dropped);
      expect(await markerFor(db, cell.measure, cell.periodCode, cell.dims)).toBe(batch2);

      // The result containing the retained cell shows the OLDEST truth …
      const retained = await runQuery(db, INTENT);
      if (!retained.ok) throw new Error('retained-cell query refused');
      expect(retained.attribution.syncedAt).toBe(await batchFinishedAtIso(db, batch2));
      expect(retained.attribution.syncedAt < (await tableLastSyncIso(db))).toBe(true);

      // … and a result WITHOUT retained cells keeps the table date (belt).
      const otherPeriod = await db.query(
        `select period_code from observations
          where table_id = $1 and measure = $2 and dims = $3::jsonb and period_code <> $4
          order by period_code desc limit 1`,
        [TABLE_ID, cell.measure, JSON.stringify(cell.dims), cell.periodCode],
      );
      const controlIntent = {
        ...INTENT,
        period: { kind: 'codes', codes: [otherPeriod.rows[0]!.period_code as string] },
      } as StructuredIntent;
      const control = await runQuery(db, controlIntent);
      if (!control.ok) throw new Error('control query refused');
      expect(control.attribution.syncedAt).toBe(await tableLastSyncIso(db));

      // Staleness: backdate the marked batch → the net fires on EXACTLY the
      // retained class, with the honest "niet opnieuw bevestigd" clause; the
      // fresh control stays silent (85224NED is quarterly → maxAge 138d).
      await db.query(
        `update ingestion_batches set finished_at = '2020-01-01T00:00:00.000Z' where id = $1`,
        [batch2],
      );
      const backdated = await runQuery(db, INTENT);
      if (!backdated.ok) throw new Error('backdated query refused');
      expect(backdated.attribution.syncedAt).toBe('2020-01-01T00:00:00.000Z');
      const staleCheck = await checkStaleness(db, backdated, '2026-07-24');
      expect(staleCheck.stale).toBe(true);
      expect(staleCheck.warning).toContain('niet opnieuw bevestigd');
      expect(staleCheck.warning).toContain('2020-01-01');
      expect(staleCheck.warning).not.toContain('onze laatste synchronisatie');
      const controlCheck = await checkStaleness(db, control, '2026-07-24');
      expect(controlCheck.stale).toBe(false);

      // No date-creep: a second absent sync leaves the marker untouched.
      const sync4 = await syncTable(db, new FixtureSource(structuredClone(omitted.docs)), TABLE_ID);
      if (sync4.outcome !== 'succeeded') throw new Error(`sync4 failed: ${sync4.failureSummary}`);
      expect(await markerFor(db, cell.measure, cell.periodCode, cell.dims)).toBe(batch2);

      // Reappearance with an IDENTICAL value: the OR-term lets the reset
      // through the unchanged-row guard — marker cleared, date healed.
      const sync5 = await cleanSync(db, docs);
      expect(sync5).toBeGreaterThan(sync4.batchId);
      expect(await markerFor(db, cell.measure, cell.periodCode, cell.dims)).toBeNull();
      const healed = await runQuery(db, INTENT);
      if (!healed.ok) throw new Error('healed query refused');
      expect(healed.attribution.syncedAt).toBe(await tableLastSyncIso(db));
    } finally {
      await close();
    }
  }, 300_000);
});

describe('#154 retained cells — scenario B: transition lower bound', () => {
  it('with no provably-post-migration prior batch, marks with the cell OWN batch_id — a true lower bound, never a later batch', async () => {
    const { db, close, docs } = await setup();
    try {
      // Guard the version literal the pipeline queries (021 → 21).
      const migration = await db.query(
        'select applied_at from schema_migrations where version = 21',
      );
      expect(migration.rows.length).toBe(1);

      const batch1 = await cleanSync(db, docs);
      const batch2 = await cleanSync(db, docs);

      const baseline = await runQuery(db, INTENT);
      if (!baseline.ok) throw new Error('baseline refused');
      const cell = baseline.cells[0]!;

      // Simulate the transition window: pretend migration 021 was applied
      // AFTER both prior batches — the NULL-means-present invariant is then
      // unprovable for them, so the conservative fallback must be used.
      await db.query(
        `update schema_migrations set applied_at = now() + interval '1 day' where version = 21`,
      );
      const omitted = withOmitted(docs, cell.measure, cell.periodCode, cell.dims);
      const sync3 = await syncTable(db, new FixtureSource(omitted.docs), TABLE_ID);
      if (sync3.outcome !== 'succeeded') throw new Error(`sync3 failed: ${sync3.failureSummary}`);

      // The cell's own batch_id is batch1 (inserted then, unchanged since) —
      // NOT batch2, which without the invariant proves nothing.
      expect(await markerFor(db, cell.measure, cell.periodCode, cell.dims)).toBe(batch1);
      expect(batch2).toBeGreaterThan(batch1);
    } finally {
      await close();
    }
  }, 300_000);
});

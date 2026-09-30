// Supervised conversion of ONE pinned whole-table table to slice storage (ADR 065
// step 7; design docs/superpowers/specs/2026-09-30-one-route-warm-slices-design.md
// D7), and the way back (convert-to-full). Owner-run, one table at a time.
//
// The conversion changes how a table is stored, never what a reader sees, so it
// only proceeds for a table whose stored cells provably equal CBS right now:
//   1. preconditions (database only, nothing fetched);
//   2. the read-only parity proof (parity.ts) over the warm plan — complete, and
//      no difference but cells already marked retained;
//   3. CBS's schema and code lists, fetched BEFORE any write, must give a
//      slice registration equal to the stored one (layout, scope, cadence,
//      measures and units, fingerprint, every label) — otherwise the owner runs
//      the ordinary sync (or `sync --rebaseline`) first;
//   4. the switch — ONE transaction under the table's exclusive advisory lock:
//      snapshot the cells, delete them (and any slice records), rewrite the row
//      in place to the slice registration and replace its labels;
//   5. the warm job fills the declared scope again;
//   6. the after-check: the stored cells equal the snapshot cell for cell, the
//      registry curation and canonical measures equal theirs.
// Without `apply` (the CLI's --yes) it stops after step 3 plus a read-only look
// at the stored cells: a dry run that writes nothing.
import type { CbsCode, CbsSource, CbsTableSchema } from '../cbs-adapter/types.ts';
import type { Db } from '../db/types.ts';
import { CBS_SOURCE_KEY, sourceKeyForTableId } from '../sources/registry.ts';
import { compareTableWithSource, type ParityReport } from './parity.ts';
import { fetchAllCodeLists } from './pipeline.ts';
import { SEED_TABLES } from './registry-seed.ts';
import { planSchemaOnlyRegistration, writeSliceRegistration, type SliceRegistration } from './slice-cache.ts';
import { WARM_MAX_CELLS, warmTable, type WarmTableResult } from './warm-job.ts';
import { loadWarmScope, planWarmSlices, type WarmPlan } from './warm-plan.ts';

export interface ConvertOptions {
  /** Epoch ms (as `now` counts them): the proof and the warm run share this budget. */
  deadline: number;
  /** false = dry run: checks and proof only, nothing written (the CLI without --yes). */
  apply: boolean;
  now?: () => number;
}

export interface CellDifference {
  kind: 'changed' | 'extra' | 'missing';
  /** measure, region, period, dims */
  cell: string;
  before?: string;
  after?: string;
}

export interface ConvertResult {
  tableId: string;
  outcome: 'refused' | 'dry_run' | 'converted' | 'converted_incomplete' | 'after_check_failed';
  /** refused: why, in plain words. */
  reason?: string;
  parity?: ParityReport;
  /** Requests in the warm plan. */
  plannedRequests?: number;
  /** Stored present cells carried over (the snapshot). */
  storedCells?: number;
  /** Stored cells marked retained (CBS withdrew them) that CBS still withholds:
   * not carried over — questions about them refuse afterwards. (On an unfinished
   * warm run this also counts retained cells not reached yet.) */
  retainedCells?: number;
  /** Differences that do not block (today only CBS's table title). */
  notes: string[];
  warm?: WarmTableResult;
  /** converted_incomplete: planned requests the warm run did not do. */
  remaining?: number;
  afterCheck?: { cellDifferences: CellDifference[]; cellDifferenceCount: number; registryDifferences: string[] };
}

/** A 'running' batch younger than this means another sync may be writing this table. */
const RUNNING_BATCH_WINDOW = '1 day';
const MAX_REPORTED_DIFFERENCES = 10;
const PAGE_SIZE = 20_000;

/** Thrown inside the switch transaction to roll it back with a plain reason. */
class ConvertAbort extends Error {}

function parseJsonb<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  return (typeof value === 'string' ? JSON.parse(value) : value) as T;
}

/** JSON with sorted object keys: equal content, equal text, whatever the key order. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
}

function iso(value: unknown): string | null {
  return value == null ? null : new Date(value as string | Date).toISOString();
}

// ---------------------------------------------------------------------------
// Cells: streamed in pages (a pinned table can hold hundreds of thousands)
// ---------------------------------------------------------------------------

interface StoredCell {
  key: string;
  /** Every reader-relevant column besides the key; batch ids and dates left out. */
  value: string;
  measure: string;
  regionCode: string;
  periodCode: string;
  dims: Record<string, string>;
  retained: boolean;
}

async function streamCells(db: Db, tableId: string, visit: (cell: StoredCell) => void): Promise<void> {
  let lastId = '0';
  for (;;) {
    const { rows } = await db.query(
      `select id, measure, region_code, period_code, period_grain, period_year, period_index, dims::text as dims,
              value::text as value, unit, decimals, status, value_attribute, last_seen_batch_id
         from observations
        where table_id = $1 and id > $2::bigint
        order by id
        limit ${PAGE_SIZE}`,
      [tableId, lastId],
    );
    for (const r of rows) {
      const dimsText = String(r.dims);
      visit({
        key: JSON.stringify([r.measure, r.region_code, r.period_code, dimsText]),
        // Numbers compared as numbers (numeric text keeps an input's trailing zeros).
        value: JSON.stringify([
          r.period_grain,
          Number(r.period_year),
          r.period_index == null ? null : Number(r.period_index),
          r.value == null ? null : Number(r.value),
          r.unit,
          Number(r.decimals),
          r.status,
          r.value_attribute,
        ]),
        measure: String(r.measure),
        regionCode: String(r.region_code),
        periodCode: String(r.period_code),
        dims: JSON.parse(dimsText) as Record<string, string>,
        retained: r.last_seen_batch_id != null,
      });
    }
    if (rows.length < PAGE_SIZE) return;
    lastId = String(rows[rows.length - 1]!.id);
  }
}

/** The declared scope as a predicate: a cell is inside when every coordinate is
 * one the warm plan asks for (the plan chunks each axis, so the union of its
 * requests per axis is exactly the scope). */
function scopePredicate(plan: WarmPlan, geoDim: string | null): (cell: StoredCell) => boolean {
  const measures = new Set<string>();
  const periods = new Set<string>();
  const members = new Map<string, Set<string>>();
  for (const req of plan.requests) {
    for (const m of req.measures) measures.add(m);
    for (const p of req.periods) periods.add(p);
    for (const [dim, codes] of Object.entries(req.members)) {
      let set = members.get(dim);
      if (!set) members.set(dim, (set = new Set()));
      for (const c of codes) set.add(c);
    }
  }
  const otherDims = [...members.keys()].filter((d) => d !== geoDim);
  return (cell) => {
    if (!measures.has(cell.measure) || !periods.has(cell.periodCode)) return false;
    if (geoDim ? !members.get(geoDim)!.has(cell.regionCode) : cell.regionCode !== '') return false;
    if (Object.keys(cell.dims).length !== otherDims.length) return false;
    return otherDims.every((d) => members.get(d)!.has(cell.dims[d] ?? ''));
  };
}

interface CellSnapshot {
  /** Present cells: the warm run must store each one back, unchanged. */
  cells: Map<string, string>;
  /** Cells marked retained (CBS withdrew them earlier). A warm run does not
   * bring back one CBS still withholds (it is dropped: questions about it then
   * refuse); one CBS publishes again comes back present and must be unchanged. */
  retainedCells: Map<string, string>;
  outside: number;
  outsideExamples: string[];
}

async function snapshotCells(db: Db, tableId: string, inScope: (cell: StoredCell) => boolean): Promise<CellSnapshot> {
  const snap: CellSnapshot = { cells: new Map(), retainedCells: new Map(), outside: 0, outsideExamples: [] };
  await streamCells(db, tableId, (cell) => {
    if (!inScope(cell)) {
      snap.outside += 1;
      if (snap.outsideExamples.length < 3) snap.outsideExamples.push(cell.key);
    } else if (cell.retained) {
      snap.retainedCells.set(cell.key, cell.value);
    } else {
      snap.cells.set(cell.key, cell.value);
    }
  });
  return snap;
}

// ---------------------------------------------------------------------------
// Registry: what a reader depends on, before and after
// ---------------------------------------------------------------------------

/** The registry columns and canonical measures the conversion must leave as they were. */
async function registrySnapshot(db: Db, tableId: string): Promise<Record<string, string>> {
  const row = (
    await db.query(
      `select expected_dimensions, slice, units, update_cadence, pinned, source, schema_fingerprint,
              default_coordinates, period_semantics
         from cbs_tables where id = $1`,
      [tableId],
    )
  ).rows[0];
  const canonicalRows = (
    await db.query(
      `select key, measure, measure_title, dims, definition_label, everyday_terms, alternates, notes
         from canonical_measures where table_id = $1 order by key`,
      [tableId],
    )
  ).rows;
  const out: Record<string, string> = {};
  for (const col of ['expected_dimensions', 'slice', 'units', 'default_coordinates', 'period_semantics']) {
    out[col] = canonical(parseJsonb(row?.[col], null));
  }
  for (const col of ['update_cadence', 'pinned', 'source', 'schema_fingerprint']) out[col] = canonical(row?.[col] ?? null);
  out.canonical_measures = canonical(
    canonicalRows.map((r) => ({ ...r, dims: parseJsonb(r.dims, {}), alternates: parseJsonb(r.alternates, null) })),
  );
  return out;
}

/** How many measures' descriptive text (title, description) the conversion refreshes to CBS's
 * current text. Not a reason to refuse: unit and decimals are compared in registrationDifferences. */
function measureTextChanges(stored: Record<string, unknown>, reg: SliceRegistration): number {
  const units = parseJsonb<Record<string, { title?: unknown; description?: unknown }>>(stored.units, {});
  let changed = 0;
  for (const [code, now] of Object.entries(reg.units)) {
    const before = units[code];
    if (before === undefined) continue;
    if ((before.title ?? null) !== (now.title ?? null) || (before.description ?? null) !== (now.description ?? null)) {
      changed += 1;
    }
  }
  return changed;
}

/** Why the slice registration of this table would differ from what is stored — empty when it would not. */
async function registrationDifferences(
  db: Db,
  stored: Record<string, unknown>,
  reg: SliceRegistration,
): Promise<string[]> {
  const out: string[] = [];
  const compare = (column: string, before: unknown, after: unknown) => {
    if (canonical(before) !== canonical(after)) {
      out.push(`${column}: stored ${canonical(before)}, the slice registration would write ${canonical(after)}`);
    }
  };
  compare('expected_dimensions', parseJsonb(stored.expected_dimensions, []), reg.expectedDimensions);
  compare('slice', parseJsonb(stored.slice, null), reg.slice);
  compare('update_cadence', stored.update_cadence ?? null, reg.updateCadence);
  compare('source', stored.source, reg.source);
  if (stored.schema_fingerprint != null) compare('schema_fingerprint', stored.schema_fingerprint, reg.fingerprint);

  // Unit and decimals are what a number means; title and description are descriptive text that
  // the ingestion checks never compare (validate.ts RegistryUnits) — see measureTextChanges.
  const units = parseJsonb<Record<string, { unit?: unknown; decimals?: unknown }>>(stored.units, {});
  const codes = new Set([...Object.keys(units), ...Object.keys(reg.units)]);
  const meaning = (u: { unit?: unknown; decimals?: unknown } | undefined) =>
    u === undefined ? null : { unit: u.unit ?? null, decimals: u.decimals ?? null };
  for (const code of [...codes].sort()) {
    if (canonical(meaning(units[code])) !== canonical(meaning(reg.units[code]))) {
      out.push(`units of measure ${code}: stored ${canonical(units[code] ?? null)}, CBS now ${canonical(reg.units[code] ?? null)}`);
    }
  }

  // The code lists: which codes exist, a period's status (it decides its cells' status) and a
  // code's group (region classes are answered from it) must be equal. A label's wording and its
  // position are descriptive — see labelTextChanges.
  const labelDiffs: string[] = [];
  const storedLabels = await readStoredLabels(db, reg.tableId);
  const seen = new Set<string>();
  for (const l of reg.labelRows) {
    const key = labelKey(l.dimension, l.code);
    seen.add(key);
    const now = canonical([l.dimension_group ?? null, l.status ?? null]);
    const before = storedLabels.get(key);
    if (before === undefined) labelDiffs.push(`${key} is new at CBS`);
    else if (before.meaning !== now) labelDiffs.push(`${key} changed (stored ${before.meaning}, CBS now ${now})`);
  }
  for (const key of storedLabels.keys()) if (!seen.has(key)) labelDiffs.push(`${key} is no longer published by CBS`);
  if (labelDiffs.length > 0) {
    out.push(
      `${labelDiffs.length} dimension label(s) differ from CBS's current code lists, e.g. ` +
        labelDiffs.slice(0, 5).join('; '),
    );
  }
  return out;
}

const labelKey = (dimension: unknown, code: unknown) => `${String(dimension)} ${String(code)}`;

/** Per stored label: what it means (group, status) and how it reads (wording, position). */
async function readStoredLabels(db: Db, tableId: string): Promise<Map<string, { meaning: string; text: string }>> {
  const stored = new Map<string, { meaning: string; text: string }>();
  for (const l of (
    await db.query(
      'select dimension, code, label, dimension_group, status, sort_index from dimension_labels where table_id = $1',
      [tableId],
    )
  ).rows) {
    stored.set(labelKey(l.dimension, l.code), {
      meaning: canonical([l.dimension_group ?? null, l.status ?? null]),
      text: canonical([l.label, l.sort_index == null ? null : Number(l.sort_index)]),
    });
  }
  return stored;
}

/** How many labels' wording or position the conversion refreshes to CBS's current code lists
 * (CBS rewords labels routinely and the ordinary sync never refreshes them). Not a reason to refuse. */
async function labelTextChanges(db: Db, reg: SliceRegistration): Promise<number> {
  const storedLabels = await readStoredLabels(db, reg.tableId);
  let changed = 0;
  for (const l of reg.labelRows) {
    const before = storedLabels.get(labelKey(l.dimension, l.code));
    if (before !== undefined && before.text !== canonical([l.label, l.sort_index == null ? null : Number(l.sort_index)])) {
      changed += 1;
    }
  }
  return changed;
}

// ---------------------------------------------------------------------------
// convert-to-slices
// ---------------------------------------------------------------------------

export async function convertTableToSlices(
  db: Db,
  source: CbsSource,
  tableId: string,
  opts: ConvertOptions,
): Promise<ConvertResult> {
  const now = opts.now ?? Date.now;
  const notes: string[] = [];
  const refused = (reason: string, extra: Partial<ConvertResult> = {}): ConvertResult => ({
    tableId,
    outcome: 'refused',
    reason,
    notes,
    ...extra,
  });

  // --- 1. Preconditions: the database only -------------------------------------
  const row = (
    await db.query(
      `select ingest_mode, status, needs_review_reason, pinned, version, last_sync_at, title, expected_dimensions,
              slice, units, update_cadence, schema_fingerprint, source
         from cbs_tables where id = $1`,
      [tableId],
    )
  ).rows[0];
  if (!row) return refused(`Table "${tableId}" is not registered.`);
  if (row.ingest_mode !== 'full') return refused(`Table "${tableId}" is already in slice storage.`);
  if (row.status !== 'active') {
    return refused(
      `Table "${tableId}" is quarantined (needs_review): ${String(row.needs_review_reason ?? 'reason not recorded')}. ` +
        `Review it and re-baseline it with the ordinary sync (ingest sync ${tableId} --rebaseline) first.`,
    );
  }
  if (row.pinned !== true) {
    return refused(`Table "${tableId}" is not pinned; only the pinned (curated) tables are converted this way.`);
  }
  if (sourceKeyForTableId(tableId) !== CBS_SOURCE_KEY) return refused(`Table "${tableId}" is not a CBS table.`);
  const seed = SEED_TABLES.find((t) => t.id === tableId);
  if (!seed) {
    return refused(`Table "${tableId}" has no seed entry in registry-seed.ts; its curation cannot be carried over.`);
  }
  // A table whose period status comes from CBS's period notes (ADR 061, 70072ned)
  // converts like any other since #358 item 3: the parity proof below and the
  // warm run read its notes with the whole-table sync's own fail-closed reader,
  // so its statuses are proven equal before anything is written.
  let plan: WarmPlan;
  let geoDim: string | null;
  try {
    const scope = await loadWarmScope(db, tableId);
    plan = planWarmSlices(scope, { maxCells: WARM_MAX_CELLS });
    geoDim = scope.dimensions.find((d) => d.kind === 'GeoDimension')?.name ?? null;
  } catch (err) {
    return refused(`The declared scope cannot be planned: ${err instanceof Error ? err.message : String(err)}`);
  }
  const plannedRequests = plan.requests.length;

  // --- 2. Read-only proof -------------------------------------------------------
  const parity = await compareTableWithSource(db, source, tableId, {
    deadline: opts.deadline,
    maxCells: WARM_MAX_CELLS,
    now,
  });
  if (!parity.complete) {
    return refused(
      `The read-only comparison with CBS did not finish (${parity.error ?? 'no reason recorded'}); nothing was written. ` +
        `Run again with a larger --budget-seconds.`,
      { parity, plannedRequests },
    );
  }
  const unexplained = parity.diffCounts.missing_at_source - parity.retained;
  const blocking = [
    parity.diffCounts.value_differs > 0 ? `${parity.diffCounts.value_differs} value_differs` : null,
    parity.diffCounts.missing_in_store > 0 ? `${parity.diffCounts.missing_in_store} missing_in_store` : null,
    unexplained > 0 ? `${unexplained} missing_at_source (not retained)` : null,
  ].filter((s): s is string => s !== null);
  if (blocking.length > 0) {
    return refused(
      `The stored cells differ from what CBS returns now (${blocking.join(', ')}); converting would change ` +
        `what readers see. Nothing was written.`,
      { parity, plannedRequests },
    );
  }
  if (parity.diffCounts.status_differs > 0) {
    return refused(
      `${parity.diffCounts.status_differs} cell(s) have a different status at CBS now — CBS moved on. ` +
        `Run the ordinary sync first (ingest sync ${tableId}), then convert. Nothing was written.`,
      { parity, plannedRequests },
    );
  }

  // --- 3. The slice registration, from CBS's schema fetched BEFORE any write ------
  let schema: CbsTableSchema;
  let codeLists: Record<string, CbsCode[]>;
  try {
    schema = await source.fetchTableSchema(tableId);
    codeLists = await fetchAllCodeLists(source, tableId, schema.dimensions);
  } catch (err) {
    return refused(
      `Fetching the table's schema from CBS failed: ${err instanceof Error ? err.message : String(err)}. Nothing was written.`,
      { parity, plannedRequests },
    );
  }
  let registration: SliceRegistration;
  try {
    const planned = planSchemaOnlyRegistration(tableId, schema, codeLists, {
      pinned: true,
      updateCadence: seed.updateCadence,
      slice: seed.slice ?? null,
      excludeMeasures: seed.excludeMeasures,
    });
    if (!planned.ok) return refused(`${planned.reason}: ${planned.summary}`, { parity, plannedRequests });
    registration = planned.registration;
  } catch (err) {
    return refused(err instanceof Error ? err.message : String(err), { parity, plannedRequests });
  }
  const differences = await registrationDifferences(db, row, registration);
  if (differences.length > 0) {
    return refused(
      `The slice registration would not equal the stored registration: ${differences.join(' | ')}. ` +
        `Bring the stored registration up to date first (ingest sync ${tableId}, or ingest sync ${tableId} ` +
        `--rebaseline for a reviewed layout/unit/label change), then convert. Nothing was written.`,
      { parity, plannedRequests },
    );
  }
  const textChanges = measureTextChanges(row, registration);
  if (textChanges > 0) {
    notes.push(`The measure text (title or description) of ${textChanges} measure(s) becomes CBS's current text.`);
  }
  const labelChanges = await labelTextChanges(db, registration);
  if (labelChanges > 0) {
    notes.push(`The wording or position of ${labelChanges} label(s) becomes CBS's current code list.`);
  }
  if (row.title !== registration.title) {
    notes.push(`The table title becomes CBS's current title "${registration.title}" (stored: "${String(row.title)}").`);
  }

  const inScope = scopePredicate(plan, geoDim);
  if (!opts.apply) {
    const look = await snapshotCells(db, tableId, inScope);
    if (look.outside > 0) {
      return refused(outsideReason(tableId, look), { parity, plannedRequests });
    }
    return {
      tableId,
      outcome: 'dry_run',
      parity,
      plannedRequests,
      storedCells: look.cells.size,
      // The retained cells CBS still withholds (the proof counted them).
      retainedCells: parity.retained,
      notes,
    };
  }

  // --- 4. The switch: one transaction under the table's exclusive lock ---------
  const switched = await db
    .withTransaction(async (tx) => {
      // Same key and bound as fetchSlice/syncTable's rebaseline/eviction.
      await tx.query("set local lock_timeout = '180s'");
      await tx.query('select pg_advisory_xact_lock(hashtext($1))', [tableId]);

      // The proof above ran before this lock: the row must not have moved since.
      const fresh = (
        await tx.query('select ingest_mode, status, pinned, version, last_sync_at from cbs_tables where id = $1 for update', [
          tableId,
        ])
      ).rows[0];
      if (
        !fresh ||
        fresh.ingest_mode !== 'full' ||
        fresh.status !== 'active' ||
        fresh.pinned !== true ||
        Number(fresh.version) !== Number(row.version) ||
        iso(fresh.last_sync_at) !== iso(row.last_sync_at)
      ) {
        throw new ConvertAbort(
          `The registry row of "${tableId}" changed while the proof ran (a sync or another operator). Nothing was ` +
            `written; run the conversion again.`,
        );
      }
      // syncTable writes its batch row first and takes no lock on an ordinary
      // sync: a recent 'running' batch means one may still commit cells.
      const running = (
        await tx.query(
          `select id from ingestion_batches
            where table_id = $1 and outcome = 'running' and started_at > now() - interval '${RUNNING_BATCH_WINDOW}'`,
          [tableId],
        )
      ).rows;
      if (running.length > 0) {
        throw new ConvertAbort(
          `A sync of "${tableId}" is running (batch ${running.map((r) => String(r.id)).join(', ')}); nothing was ` +
            `written. Wait for it to finish (or mark a crashed one failed), then convert.`,
        );
      }

      const snapshot = await snapshotCells(tx, tableId, inScope);
      if (snapshot.outside > 0) throw new ConvertAbort(outsideReason(tableId, snapshot));
      const registryBefore = await registrySnapshot(tx, tableId);

      // observations -> its batch rows stay (history; nothing cascades from a
      // cell). slice_fetches: none expected on a whole-table table, cleared for
      // a clean slice registration. canonical_measures and ingestion_batches
      // reference the row and are kept; the row is rewritten in place.
      await tx.query('delete from observations where table_id = $1', [tableId]);
      await tx.query('delete from slice_fetches where table_id = $1', [tableId]);
      await writeSliceRegistration(tx, registration, 'replace');
      return { snapshot, registryBefore };
    })
    .catch((err: unknown) => {
      if (err instanceof ConvertAbort) return err;
      throw err;
    });
  if (switched instanceof ConvertAbort) return refused(switched.message, { parity, plannedRequests });
  const { snapshot, registryBefore } = switched;

  // --- 5. Warm -------------------------------------------------------------------
  const warm = await warmTable(db, source, tableId, { deadline: opts.deadline, now });
  const complete = warm.outcome === 'complete';

  // --- 6. After-check --------------------------------------------------------------
  const cellDifferences: CellDifference[] = [];
  let cellDifferenceCount = 0;
  const differ = (d: CellDifference) => {
    cellDifferenceCount += 1;
    if (cellDifferences.length < MAX_REPORTED_DIFFERENCES) cellDifferences.push(d);
  };
  const expected = snapshot.cells;
  const retained = snapshot.retainedCells;
  const storedCells = expected.size;
  await streamCells(db, tableId, (cell) => {
    // A retained cell CBS publishes again comes back present: same value, or it is a change.
    const before = expected.get(cell.key) ?? retained.get(cell.key);
    if (before === undefined) differ({ kind: 'extra', cell: cell.key, after: cell.value });
    else if (before !== cell.value) differ({ kind: 'changed', cell: cell.key, before, after: cell.value });
    expected.delete(cell.key);
    retained.delete(cell.key);
  });
  // A cell not stored yet is expected while the warm run is unfinished.
  if (complete) for (const [key, before] of expected) differ({ kind: 'missing', cell: key, before });
  // What is left of the retained cells is not stored (again): dropped.
  const carried = { parity, plannedRequests, storedCells, retainedCells: retained.size };

  const registryAfter = await registrySnapshot(db, tableId);
  const registryDifferences = Object.keys(registryBefore)
    .filter((col) => registryBefore[col] !== registryAfter[col])
    .map((col) => `${col}: before ${registryBefore[col]}, after ${registryAfter[col]}`);
  const modeRow = (await db.query('select ingest_mode, pinned from cbs_tables where id = $1', [tableId])).rows[0];
  if (modeRow?.ingest_mode !== 'slice_cache') registryDifferences.push(`ingest_mode is ${String(modeRow?.ingest_mode)}`);

  if (cellDifferenceCount > 0 || registryDifferences.length > 0) {
    return {
      tableId,
      outcome: 'after_check_failed',
      ...carried,
      notes,
      warm,
      afterCheck: { cellDifferences, cellDifferenceCount, registryDifferences },
    };
  }
  if (!complete) {
    const remaining = warm.outcome === 'skipped' ? plannedRequests : warm.remaining;
    return { tableId, outcome: 'converted_incomplete', ...carried, notes, warm, remaining };
  }
  return { tableId, outcome: 'converted', ...carried, notes, warm };
}

function outsideReason(tableId: string, snap: CellSnapshot): string {
  return (
    `${snap.outside} stored cell(s) lie outside the declared scope of "${tableId}" (e.g. ${snap.outsideExamples.join('; ')}); ` +
    `slice storage would not keep them, so readers would lose them. Nothing was written.`
  );
}

// ---------------------------------------------------------------------------
// Plain-language report for the command line
// ---------------------------------------------------------------------------

function parityLine(p: ParityReport | undefined): string | null {
  if (!p) return null;
  const c = p.diffCounts;
  return (
    `  Proof: ${p.requestsFetched} of ${p.requests} request(s) compared, ${p.identical} identical cell(s); ` +
    `value_differs ${c.value_differs}, status_differs ${c.status_differs}, missing_in_store ${c.missing_in_store}, ` +
    `missing_at_source ${c.missing_at_source} (${p.retained} retained).`
  );
}

export function describeConversion(r: ConvertResult): string {
  const id = r.tableId;
  const lines: string[] = [];
  const counts = () =>
    `  ${r.storedCells ?? 0} stored cell(s) carried over; ${r.retainedCells ?? 0} retained cell(s) (withdrawn by CBS) ` +
    `are not carried over — questions about them will refuse.`;
  switch (r.outcome) {
    case 'refused':
      lines.push(`[${id}] REFUSED — nothing was written.`, `  ${r.reason ?? ''}`);
      break;
    case 'dry_run':
      lines.push(
        `[${id}] DRY RUN — every check passed; nothing was written.`,
        `  With --yes: delete the table's stored cells, register it in slice storage with the same scope, ` +
          `fill ${r.plannedRequests} planned request(s) from CBS, and check the result cell for cell.`,
        counts(),
      );
      break;
    case 'converted':
      lines.push(`[${id}] converted to slice storage; every stored cell and the registry equal the snapshot.`, counts());
      break;
    case 'converted_incomplete': {
      const f = r.warm?.failure;
      lines.push(
        `[${id}] converted_incomplete — the table is in slice storage, but the warm run did not finish: ` +
          `${r.remaining} request(s) remain. It answers only for the cells already stored.`,
      );
      if (f) lines.push(`  Warm run failed (${f.stage}${f.quarantined ? ', table quarantined' : ''}): ${f.summary}`);
      lines.push(
        f?.quarantined
          ? `  Review the cause, then: ingest rebaseline-slices ${id} --yes`
          : `  Finish it with: ingest warm ${id}`,
        counts(),
      );
      break;
    }
    case 'after_check_failed': {
      const a = r.afterCheck!;
      lines.push(
        `[${id}] AFTER-CHECK FAILED — the table is in slice storage, but what it stores now differs from before ` +
          `the conversion (${a.cellDifferenceCount} cell difference(s), ${a.registryDifferences.length} registry difference(s)).`,
        `  Nothing was rolled back: the old cells are gone.`,
      );
      for (const d of a.cellDifferences) {
        lines.push(`  - ${d.kind} ${d.cell}${d.before ? ` before ${d.before}` : ''}${d.after ? ` after ${d.after}` : ''}`);
      }
      for (const d of a.registryDifferences) lines.push(`  - ${d}`);
      lines.push(
        `  To retry the fill: ingest warm ${id}, then compare with CBS: npm run ingest:parity -- ${id} --max-cells ${WARM_MAX_CELLS}`,
        `  To return to whole-table storage: ingest convert-to-full ${id} --yes, then ingest sync ${id}`,
      );
      break;
    }
  }
  const proof = parityLine(r.parity);
  if (proof) lines.push(proof);
  if (r.warm && r.outcome !== 'refused') {
    lines.push(
      `  Warm run: ${r.warm.outcome} — planned ${r.warm.planned}, fetched ${r.warm.fetched}, ` +
        `confirmed ${r.warm.confirmed}, remaining ${r.warm.remaining}.`,
    );
  }
  if (r.outcome === 'refused' && r.parity) {
    for (const d of r.parity.diffs.slice(0, MAX_REPORTED_DIFFERENCES)) {
      lines.push(
        `  - ${d.kind} ${d.measure} ${d.regionCode ?? ''} ${d.periodCode} ${JSON.stringify(d.dims)}` +
          `${d.stored ? ` stored ${JSON.stringify(d.stored)}` : ''}${d.fetched ? ` CBS ${JSON.stringify(d.fetched)}` : ''}`,
      );
    }
  }
  for (const n of r.notes) lines.push(`  Note: ${n}`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// convert-to-full: the way back
// ---------------------------------------------------------------------------

export interface ConvertToFullResult {
  tableId: string;
  outcome: 'refused' | 'dry_run' | 'converted_to_full';
  reason?: string;
  cells?: number;
  sliceRecords?: number;
}

/**
 * Returns a pinned slice-storage table to whole-table storage: in one locked
 * transaction its cells and slice records are deleted and the row is switched
 * back IN PLACE (canonical_measures and ingestion_batches reference it). Its
 * layout, units, fingerprint, scope, cadence and labels are kept: the slice
 * registration derives them exactly as registerTables + syncTable do (pinned
 * by tests/ingestion/slice-cache-pinned.test.ts), so the next ordinary sync
 * checks CBS against them as usual. `last_row_count` is cleared (no
 * whole-table sync has run yet), so that first sync sets the row-count
 * baseline. The owner then runs `ingest sync <tableId>`.
 */
export async function convertTableToFull(
  db: Db,
  tableId: string,
  opts: { apply: boolean },
): Promise<ConvertToFullResult> {
  const refused = (reason: string): ConvertToFullResult => ({ tableId, outcome: 'refused', reason });
  const row = (
    await db.query('select ingest_mode, status, needs_review_reason, pinned from cbs_tables where id = $1', [tableId])
  ).rows[0];
  if (!row) return refused(`Table "${tableId}" is not registered.`);
  if (row.ingest_mode !== 'slice_cache') return refused(`Table "${tableId}" is not in slice storage.`);
  if (row.pinned !== true) return refused(`Table "${tableId}" is not pinned; an on-demand slice table has no whole-table form.`);
  if (sourceKeyForTableId(tableId) !== CBS_SOURCE_KEY) return refused(`Table "${tableId}" is not a CBS table.`);
  if (!SEED_TABLES.some((t) => t.id === tableId)) return refused(`Table "${tableId}" has no seed entry in registry-seed.ts.`);
  if (row.status !== 'active') {
    return refused(
      `Table "${tableId}" is quarantined (needs_review): ${String(row.needs_review_reason ?? 'reason not recorded')}. ` +
        `Re-baseline it first (ingest rebaseline-slices ${tableId} --yes).`,
    );
  }

  const count = async (d: Db) =>
    (
      await d.query(
        `select (select count(*) from observations where table_id = $1)::int as cells,
                (select count(*) from slice_fetches where table_id = $1)::int as slices`,
        [tableId],
      )
    ).rows[0]!;
  if (!opts.apply) {
    const c = await count(db);
    return { tableId, outcome: 'dry_run', cells: Number(c.cells), sliceRecords: Number(c.slices) };
  }

  const result = await db
    .withTransaction(async (tx) => {
      await tx.query("set local lock_timeout = '180s'");
      await tx.query('select pg_advisory_xact_lock(hashtext($1))', [tableId]);
      const fresh = (
        await tx.query('select ingest_mode, status, pinned from cbs_tables where id = $1 for update', [tableId])
      ).rows[0];
      if (!fresh || fresh.ingest_mode !== 'slice_cache' || fresh.status !== 'active' || fresh.pinned !== true) {
        throw new ConvertAbort(`The registry row of "${tableId}" changed meanwhile; nothing was written.`);
      }
      const c = await count(tx);
      await tx.query('delete from observations where table_id = $1', [tableId]);
      await tx.query('delete from slice_fetches where table_id = $1', [tableId]);
      await tx.query(
        `update cbs_tables
            set ingest_mode = 'full', schema_cbs_modified = null, last_sync_at = null, last_row_count = null,
                version = version + 1, updated_at = now()
          where id = $1`,
        [tableId],
      );
      return c;
    })
    .catch((err: unknown) => {
      if (err instanceof ConvertAbort) return err;
      throw err;
    });
  if (result instanceof ConvertAbort) return refused(result.message);
  return { tableId, outcome: 'converted_to_full', cells: Number(result.cells), sliceRecords: Number(result.slices) };
}

export function describeConversionToFull(r: ConvertToFullResult): string {
  switch (r.outcome) {
    case 'refused':
      return `[${r.tableId}] REFUSED — nothing was written.\n  ${r.reason ?? ''}`;
    case 'dry_run':
      return (
        `[${r.tableId}] DRY RUN — nothing was written. With --yes: delete ${r.cells} stored cell(s) and ` +
        `${r.sliceRecords} slice record(s) and switch the table back to whole-table storage; then run ` +
        `ingest sync ${r.tableId}.`
      );
    case 'converted_to_full':
      return (
        `[${r.tableId}] back in whole-table storage (${r.cells} cell(s) and ${r.sliceRecords} slice record(s) ` +
        `deleted). It answers nothing until you run: ingest sync ${r.tableId}`
      );
  }
}

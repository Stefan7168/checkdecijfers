// Slice-cache registration (breadth step 2, spec
// 2026-09-28-breadth-any-cbs-table-design.md D4; migration 037,
// docs/decisions/061 for the period-note prose-reader boundary this module
// deliberately does NOT cross). registerSchemaOnly registers a CBS table's
// LAYOUT ONLY — metadata, code lists, numeric-measure units, schema
// fingerprint — with zero observation rows. fetchSlice (Task 4) then fetches
// exactly the cells one question needs on top of that layout, validates them
// with the existing ingestion checks and stores them.
//
// Every write here reuses registerTables'/syncTable's own helpers
// (src/ingestion/pipeline.ts, src/ingestion/validate.ts) — never a second
// copy of the fingerprint, dimension_labels batching, source-key derivation,
// validation checks, observation column derivation or upsert.
import type { CbsCode, CbsObservationRow, CbsSource, CbsTableSchema } from '../cbs-adapter/types.ts';
import type { Db } from '../db/types.ts';
import { computeFingerprint } from './fingerprint.ts';
import {
  buildStagedRows,
  diffCorrections,
  failBatch,
  fetchAllCodeLists,
  insertDimensionLabels,
  labelRowsFromCodeLists,
  markUnseenCellsRetained,
  stageRows,
  unitsFromMeasures,
  upsertStagedObservations,
} from './pipeline.ts';
import type { FailureStage } from './types.ts';
import {
  checkDimensionMapping,
  checkPeriodParsing,
  checkSchemaFingerprint,
  checkSliceRowPlausibility,
  checkUnitConsistency,
  type RegistryUnits,
  type StoredLabel,
} from './validate.ts';
import { sourceKeyForTableId } from '../sources/registry.ts';

export type SchemaOnlyResult =
  | { ok: true; tableId: string; numericMeasures: string[]; alreadyRegistered: boolean }
  | {
      ok: false;
      reason:
        | 'no_time_dimension'
        | 'no_periods'
        | 'no_machine_period_status'
        | 'no_numeric_measures'
        | 'no_cbs_modified'
        | 'registered_as_full';
      summary: string;
    };

/** jsonb round-trips as a string over the real pg driver and as an already-
 * parsed object over PGlite (same duality pipeline.ts's own parseRegistryRow
 * handles) — never assume one or the other. */
function parseJsonbUnits(value: unknown): Record<string, unknown> {
  if (value == null) return {};
  return (typeof value === 'string' ? JSON.parse(value) : value) as Record<string, unknown>;
}

/**
 * Registers a CBS table's schema (metadata, code lists, numeric-measure
 * units, fingerprint) with `ingest_mode = 'slice_cache'` and NO observation
 * rows — Task 4's `fetchSlice` fills cells on demand against this layout.
 *
 * Refuses loudly (principle c) rather than registering a table this reader
 * cannot safely serve:
 * - `no_time_dimension`: the schema has no `TimeDimension` — a slice cache
 *   is fetched and evicted per period, so there must be one to key on.
 * - `no_periods`: the time dimension's own code list came back empty — no
 *   period exists to key a slice on (distinct from the ALL-NULL case below,
 *   which has periods but no machine status on any of them).
 * - `no_machine_period_status`: the time dimension has periods, but every
 *   one carries `status: null`. ADR 061's period-note PROSE reader
 *   (src/ingestion/period-note-status.ts) is reviewed per table (a curated
 *   `Phase0Table.periodNoteStatus` config) — schema-only registration is
 *   generic and un-curated, so it never guesses a status from prose.
 * - `no_numeric_measures`: every measure's CBS `DataType` is `'String'` —
 *   text measures (`code`, `naam`, `omschrijving`-shaped) are never
 *   registered as servable (breadth step 2 constraints).
 * - `no_cbs_modified`: CBS's own 'Modified' date on the table (`schema.
 *   modified`) is null or empty. A slice cache's ONLY staleness signal is
 *   "did CBS's Modified move since we last fetched this slice" — a table
 *   whose source can never state that can never be told apart from stale,
 *   so it is refused at registration rather than silently served forever.
 *
 * Idempotent: already `slice_cache` -> `{ ok: true, alreadyRegistered: true
 * }`, no writes. Already `full` -> `registered_as_full` — the whole-table
 * path (`registerTables`/`syncTable`) owns that id; this function never
 * touches it.
 */
export async function registerSchemaOnly(
  db: Db,
  source: CbsSource,
  tableId: string,
): Promise<SchemaOnlyResult> {
  const existing = await db.query('select ingest_mode, units from cbs_tables where id = $1', [tableId]);
  if (existing.rows.length > 0) {
    const row = existing.rows[0]!;
    if (row.ingest_mode === 'full') {
      return {
        ok: false,
        reason: 'registered_as_full',
        summary:
          `Table "${tableId}" is already registered as a full-ingest table; the whole-table ` +
          `registration path (registerTables/syncTable) owns it, not the slice cache.`,
      };
    }
    const units = parseJsonbUnits(row.units);
    return { ok: true, tableId, numericMeasures: Object.keys(units).sort(), alreadyRegistered: true };
  }

  const schema = await source.fetchTableSchema(tableId);
  const codeLists = await fetchAllCodeLists(source, tableId, schema.dimensions);

  // Controller ruling, fix round 1: a slice-cache table's ONLY freshness
  // signal is CBS's own 'Modified' date — a source that cannot state one
  // cannot be schema-only registered at all, checked before anything else.
  if (schema.modified == null || schema.modified.trim().length === 0) {
    return {
      ok: false,
      reason: 'no_cbs_modified',
      summary:
        `Table "${tableId}" has no CBS 'Modified' date on its Properties document — without it ` +
        `we could never tell when the stored slices go stale, so this table cannot be ` +
        `schema-only registered.`,
    };
  }

  const periodDim = schema.dimensions.find((d) => d.kind === 'TimeDimension');
  if (!periodDim) {
    return {
      ok: false,
      reason: 'no_time_dimension',
      summary:
        `Table "${tableId}" has no TimeDimension in its schema. The slice cache fetches and ` +
        `evicts by period, so a table with no time dimension cannot be registered this way.`,
    };
  }

  const periodCodes: CbsCode[] = codeLists[periodDim.name] ?? [];
  if (periodCodes.length === 0) {
    return {
      ok: false,
      reason: 'no_periods',
      summary:
        `Table "${tableId}"'s "${periodDim.name}" code list came back empty — there is no ` +
        `period to key a slice cache on, so this table cannot be registered this way.`,
    };
  }
  if (periodCodes.every((c) => c.status === null)) {
    return {
      ok: false,
      reason: 'no_machine_period_status',
      summary:
        `Table "${tableId}"'s "${periodDim.name}" code list has no machine Status on any ` +
        `period (every code is null). ADR 061's period-note prose reader is curated per table, ` +
        `not a generic fallback — refusing rather than guessing a publication status from free text.`,
    };
  }

  const numericMeasures = schema.measures.filter((m) => m.dataType !== 'String');
  if (numericMeasures.length === 0) {
    return {
      ok: false,
      reason: 'no_numeric_measures',
      summary:
        `Table "${tableId}" publishes no numeric measures — every measure's CBS DataType is ` +
        `'String' (text measures like code/naam/omschrijving are never servable).`,
    };
  }

  const expectedDimensions = [...schema.dimensions]
    .map((d) => ({ name: d.name, kind: d.kind }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const units = unitsFromMeasures(numericMeasures);
  // Computed NOW, from the schema just fetched — unlike registerTables' full-
  // ingest path (which leaves schema_fingerprint null until the first
  // syncTable), a slice-cache table has no separate "first sync" moment: its
  // schema IS what's registered, so the fingerprint is set at registration.
  const fingerprint = computeFingerprint(schema.dimensions, numericMeasures.map((m) => m.code));
  const sourceKey = sourceKeyForTableId(tableId);

  await db.withTransaction(async (tx) => {
    await tx.query(
      `insert into cbs_tables
         (id, title, expected_dimensions, slice, units, schema_fingerprint, pinned, source,
          ingest_mode, schema_cbs_modified, last_row_count)
       values ($1, $2, $3, null, $4, $5, $6, $7, 'slice_cache', $8, null)`,
      [
        tableId,
        schema.title,
        JSON.stringify(expectedDimensions),
        JSON.stringify(units),
        fingerprint,
        false,
        sourceKey,
        // Guaranteed non-null/non-empty by the no_cbs_modified refusal above.
        schema.modified,
      ],
    );

    await insertDimensionLabels(tx, tableId, labelRowsFromCodeLists(schema.dimensions, codeLists), 'ignore');
  });

  return {
    ok: true,
    tableId,
    numericMeasures: numericMeasures.map((m) => m.code).sort(),
    alreadyRegistered: false,
  };
}

// ---------------------------------------------------------------------------
// fetchSlice (Task 4)
// ---------------------------------------------------------------------------

/** The most cells one slice request may ask for (measures × every dimension's
 * member count × periods). A per-question slice is small by design; anything
 * larger is a caller bug or a question that needs the whole-table path. */
export const SLICE_MAX_CELLS = 2000;

export interface SliceRequest {
  /** Numeric measure codes of this table, at least one. */
  measures: string[];
  /** Every NON-time dimension (regions included) → at least one code. */
  members: Record<string, string[]>;
  /** At least one period code. */
  periods: string[];
}

export type SliceFetchResult =
  | { ok: true; batchId: number; rowsStored: number; missingCells: number; filterKey: string }
  | { ok: false; stage: FailureStage | 'request'; summary: string };

/** Sorted, de-duplicated copy of a request — the one shape that is validated,
 * sent to CBS, keyed and stored, so two orderings of one request are one slice. */
function normalizeRequest(req: SliceRequest): SliceRequest {
  const sortUnique = (codes: string[]) => [...new Set(codes)].sort();
  const members: Record<string, string[]> = {};
  for (const dim of Object.keys(req.members).sort()) members[dim] = sortUnique(req.members[dim] ?? []);
  return { measures: sortUnique(req.measures), members, periods: sortUnique(req.periods) };
}

/** Canonical JSON of a slice request: sorted keys, sorted and de-duplicated
 * code lists — the `slice_fetches.filter_key` idempotency key. */
export function sliceFilterKey(req: SliceRequest): string {
  return JSON.stringify(normalizeRequest(req));
}

interface SliceRegistry {
  units: RegistryUnits;
  expectedDimensions: { name: string; kind: string }[];
  schemaFingerprint: string | null;
  schemaCbsModified: Date | null;
  version: number;
}

/** Thrown inside the write transaction when, under the per-table lock, the
 * registry row turns out to have moved since this fetch validated against it
 * (a concurrent schema refresh, quarantine or eviction). The transaction
 * rolls back; fetchSlice records the batch as failed. Never escapes. */
class SliceAbortError extends Error {
  readonly failureSummary: string;
  constructor(failureSummary: string) {
    super(failureSummary);
    this.name = 'SliceAbortError';
    this.failureSummary = failureSummary;
  }
}

function refuse(summary: string): SliceFetchResult {
  return { ok: false, stage: 'request', summary };
}

function toTime(value: unknown): number | null {
  if (value == null) return null;
  const time = new Date(value as string | Date).getTime();
  return Number.isNaN(time) ? null : time;
}

/**
 * Fetches exactly the CBS cells one question needs — `measures` × every
 * listed member of every non-time dimension × `periods` — validates them with
 * the existing ingestion checks and stores them in `observations`, for a table
 * registered by `registerSchemaOnly` (`ingest_mode = 'slice_cache'`).
 *
 * 1. Request validation, BEFORE any network call: the table must be a
 *    registered, active slice-cache table; every measure must be in its
 *    stored units; `members` must name exactly its non-time dimensions; every
 *    code and period must be in its stored dimension_labels (so only codes CBS
 *    itself published ever reach a CBS filter); at most SLICE_MAX_CELLS cells.
 *    Refusals are `stage: 'request'` and write nothing (no batch either).
 * 2. Freshness: the schema read carries CBS 'Modified'. Newer than
 *    `schema_cbs_modified` → the code lists are re-fetched too and, if the
 *    fingerprint over numeric measures still matches, this table's
 *    dimension_labels are replaced with CBS's current lists (new periods and
 *    members are a slice cache's normal lifecycle), and units, version and
 *    `schema_cbs_modified` updated — in the same transaction as the cells.
 * 3. Validation, first failure wins, nothing written to `observations`:
 *    schema_fingerprint (quarantines), row_plausibility's duplicate /
 *    reason-less-null / string-value pieces, period_parsing (R11: every cell's
 *    status comes from its period, never guessed), dimension_mapping against
 *    the stored labels without accepting new codes (quarantines),
 *    unit_consistency against the stored units (quarantines), and finally
 *    every row must lie inside the requested coordinates.
 * 4. Store, in ONE transaction under the per-table advisory lock syncTable,
 *    eviction and resolveIntent share: optional schema refresh, the
 *    observations upsert (syncTable's own staging + upsert helpers), the batch
 *    marked succeeded, and the `slice_fetches` row upserted. Cells inside the
 *    request that CBS no longer returns are marked retained (#154) against
 *    the previous fetch of this same slice — never the whole table's unseen
 *    cells — and `last_row_count` is never touched: a slice is not a full
 *    sync.
 *
 * `missingCells` = requested coordinates CBS returned no row for: a real CBS
 * "no cell", recorded on the batch as `rows_missing`, not an error.
 * Idempotent: the same request again upserts nothing new and keeps one
 * `slice_fetches` row (refreshed to the latest batch).
 */
export async function fetchSlice(
  db: Db,
  source: CbsSource,
  tableId: string,
  req: SliceRequest,
): Promise<SliceFetchResult> {
  // --- 1. Request validation (no network) -----------------------------------
  const registryResult = await db.query(
    `select ingest_mode, status, needs_review_reason, units, expected_dimensions,
            schema_fingerprint, schema_cbs_modified, version
       from cbs_tables where id = $1`,
    [tableId],
  );
  const row = registryResult.rows[0];
  if (!row) return refuse(`Table "${tableId}" is not registered; register it for the slice cache first.`);
  if (row.ingest_mode !== 'slice_cache') {
    return refuse(
      `Table "${tableId}" is a full-ingest table, not a slice-cache table; the whole-table sync owns its cells.`,
    );
  }
  if (row.status !== 'active') {
    return refuse(
      `Table "${tableId}" is quarantined (needs_review): ${String(row.needs_review_reason ?? 'reason not recorded')}. ` +
        `No slice is fetched until it has been reviewed.`,
    );
  }
  const registry: SliceRegistry = {
    units: parseJsonbUnits(row.units) as RegistryUnits,
    expectedDimensions: (typeof row.expected_dimensions === 'string'
      ? JSON.parse(row.expected_dimensions)
      : (row.expected_dimensions ?? [])) as { name: string; kind: string }[],
    schemaFingerprint: (row.schema_fingerprint as string | null) ?? null,
    schemaCbsModified: row.schema_cbs_modified == null ? null : new Date(row.schema_cbs_modified as string | Date),
    version: Number(row.version),
  };
  const timeDim = registry.expectedDimensions.find((d) => d.kind === 'TimeDimension');
  if (!timeDim) {
    return refuse(`Table "${tableId}" has no time dimension in its registered layout; it cannot be sliced.`);
  }

  const request = normalizeRequest(req);

  if (request.measures.length === 0) return refuse('A slice needs at least one measure.');
  // Own keys only: an inherited name (`constructor`) must never pass as a code.
  const unknownMeasures = request.measures.filter((m) => !Object.hasOwn(registry.units, m));
  if (unknownMeasures.length > 0) {
    return refuse(
      `Measure code(s) ${unknownMeasures.slice(0, 10).join(', ')} are not numeric measures of table "${tableId}".`,
    );
  }

  const labelsResult = await db.query('select dimension, code, status from dimension_labels where table_id = $1', [
    tableId,
  ]);
  const storedLabels: StoredLabel[] = [];
  const codesByDim = new Map<string, Set<string>>();
  const storedPeriodCodes: CbsCode[] = [];
  for (const label of labelsResult.rows) {
    const dimension = label.dimension as string;
    const code = label.code as string;
    storedLabels.push({ dimension, code });
    let set = codesByDim.get(dimension);
    if (!set) {
      set = new Set();
      codesByDim.set(dimension, set);
    }
    set.add(code);
    if (dimension === timeDim.name) {
      storedPeriodCodes.push({
        code,
        title: '',
        dimensionGroup: null,
        status: (label.status as string | null) ?? null,
        index: null,
      });
    }
  }

  const nonTimeDims = registry.expectedDimensions.filter((d) => d.name !== timeDim.name).map((d) => d.name);
  const missingDims = nonTimeDims.filter((d) => !Object.hasOwn(request.members, d));
  if (missingDims.length > 0) {
    return refuse(
      `The slice must name at least one code for every dimension of "${tableId}"; missing: ${missingDims.join(', ')}.`,
    );
  }
  const extraDims = Object.keys(request.members).filter((d) => !nonTimeDims.includes(d));
  if (extraDims.length > 0) {
    return refuse(
      `Dimension(s) ${extraDims.join(', ')} are not member dimensions of "${tableId}" ` +
        `(its time dimension "${timeDim.name}" goes in periods).`,
    );
  }
  for (const dim of nonTimeDims) {
    const codes = request.members[dim]!;
    if (codes.length === 0) return refuse(`Dimension ${dim} needs at least one code.`);
    const known = codesByDim.get(dim) ?? new Set<string>();
    const unknown = codes.filter((c) => !known.has(c));
    if (unknown.length > 0) {
      return refuse(`Code(s) ${unknown.slice(0, 10).join(', ')} are not published codes of ${dim} in "${tableId}".`);
    }
  }
  if (request.periods.length === 0) return refuse('A slice needs at least one period.');
  const knownPeriods = codesByDim.get(timeDim.name) ?? new Set<string>();
  const unknownPeriods = request.periods.filter((p) => !knownPeriods.has(p));
  if (unknownPeriods.length > 0) {
    return refuse(
      `Period(s) ${unknownPeriods.slice(0, 10).join(', ')} are not published periods of "${tableId}".`,
    );
  }

  let cellCount = request.measures.length * request.periods.length;
  for (const dim of nonTimeDims) cellCount *= request.members[dim]!.length;
  if (cellCount > SLICE_MAX_CELLS) {
    return refuse(
      `The slice asks for ${cellCount} cells; at most ${SLICE_MAX_CELLS} can be fetched per question.`,
    );
  }

  const filterKey = JSON.stringify(request);

  // --- 2. Fetch (recorded as a batch that survives a failure) ---------------
  const batchInsert = await db.query(
    `insert into ingestion_batches (table_id, outcome) values ($1, 'running') returning id`,
    [tableId],
  );
  const batchId = Number(batchInsert.rows[0]!.id);

  const fail = async (
    stage: FailureStage,
    summary: string,
    quarantine: boolean,
    rowCount: number | null,
    fingerprint: string | null,
  ): Promise<SliceFetchResult> => {
    await failBatch(db, batchId, tableId, stage, summary, rowCount, fingerprint, quarantine);
    return { ok: false, stage, summary };
  };
  const fetchFailure = (err: unknown) =>
    fail(
      'fetch',
      `Fetching a slice of table "${tableId}" from CBS failed: ${err instanceof Error ? err.message : String(err)}.`,
      false,
      null,
      null,
    );

  let schema: CbsTableSchema;
  try {
    schema = await source.fetchTableSchema(tableId);
  } catch (err) {
    return fetchFailure(err);
  }

  const fetchedModified = toTime(schema.modified);
  if (schema.modified == null || fetchedModified === null) {
    return fail(
      'fetch',
      `CBS returned no readable 'Modified' date for table "${tableId}" (got ${JSON.stringify(schema.modified)}); ` +
        `without it the stored slices can never be told apart from stale ones, so nothing is fetched.`,
      false,
      null,
      null,
    );
  }
  const storedModified = registry.schemaCbsModified?.getTime() ?? null;
  const refresh = storedModified === null || fetchedModified > storedModified;
  // CBS serving an OLDER 'Modified' than the one we already hold (a lagging
  // mirror, a rollback) never moves anything backwards: no refresh (above),
  // and the slice is recorded as current as of the later of the two dates.
  const sliceCbsModified =
    storedModified !== null && storedModified > fetchedModified
      ? registry.schemaCbsModified!.toISOString()
      : schema.modified;

  const numericMeasures = schema.measures.filter((m) => m.dataType !== 'String');
  const numericCodes = numericMeasures.map((m) => m.code);
  const fingerprint = computeFingerprint(schema.dimensions, numericCodes);

  // Stage 1 runs on every fetch (the schema is read anyway), not only on a
  // refresh: a redesign CBS did not announce via 'Modified' still fails loudly.
  const stage1 = checkSchemaFingerprint(
    schema.dimensions,
    numericCodes,
    registry.expectedDimensions,
    registry.schemaFingerprint,
  );
  if (!stage1.ok) return fail(stage1.stage, stage1.summary, true, null, fingerprint);

  let codeLists: Record<string, CbsCode[]> | null = null;
  const observationRows: CbsObservationRow[] = [];
  try {
    if (refresh) codeLists = await fetchAllCodeLists(source, tableId, schema.dimensions);
    for await (const page of source.fetchObservations(
      tableId,
      {
        measures: request.measures,
        dimensionIn: request.members,
        periodIn: { dimension: timeDim.name, codes: request.periods },
      },
      schema.dimensions.map((d) => d.name),
    )) {
      observationRows.push(...page);
    }
  } catch (err) {
    return fetchFailure(err);
  }

  // Under a refresh the fetched code lists ARE the (not yet persisted) new
  // label baseline, exactly like syncTable's rebaseline path.
  const labelsForMapping: StoredLabel[] = codeLists
    ? Object.entries(codeLists).flatMap(([dimension, codes]) => codes.map((c) => ({ dimension, code: c.code })))
    : storedLabels;
  const periodCodes: CbsCode[] = codeLists ? (codeLists[timeDim.name] ?? []) : storedPeriodCodes;

  // --- 3. Validation: the existing checks, first failure wins ---------------
  const rowCount = observationRows.length;

  const stage2 = checkSliceRowPlausibility(observationRows);
  if (!stage2.ok) return fail(stage2.stage, stage2.summary, false, rowCount, fingerprint);

  const stage3 = checkPeriodParsing(observationRows, timeDim.name, periodCodes);
  if (!stage3.ok) return fail(stage3.stage, stage3.summary, false, rowCount, fingerprint);

  // The fetched code lists are not compared to the labels here ({}): without a
  // refresh none were fetched, and with one they ARE the labels. Every fetched
  // row's coordinates still are, with no new code accepted.
  const stage4 = checkDimensionMapping(
    observationRows,
    schema.dimensions,
    registry.units,
    labelsForMapping,
    {},
    false,
  );
  if (!stage4.ok) return fail(stage4.stage, stage4.summary, true, rowCount, fingerprint);

  const stage5 = checkUnitConsistency(numericMeasures, registry.units);
  if (!stage5.ok) return fail(stage5.stage, stage5.summary, true, rowCount, fingerprint);

  // Slice-specific: CBS must return only what was asked for. A row outside
  // the requested coordinates means the server-side filter misbehaved; storing
  // it would record cells no slice_fetches row accounts for.
  const allowedMeasures = new Set(request.measures);
  const allowedPeriods = new Set(request.periods);
  const allowedByDim = nonTimeDims.map((dim) => [dim, new Set(request.members[dim])] as const);
  const outside = observationRows.filter(
    (r) =>
      !allowedMeasures.has(r.measure) ||
      !allowedPeriods.has(r.coordinates[timeDim.name] ?? '') ||
      allowedByDim.some(([dim, codes]) => !codes.has(r.coordinates[dim] ?? '')),
  );
  if (outside.length > 0) {
    const examples = outside
      .slice(0, 3)
      .map((r) => `measure ${r.measure} at ${JSON.stringify(r.coordinates)}`)
      .join('; ');
    return fail(
      'row_plausibility',
      `${outside.length} fetched row(s) fall outside the requested slice — the server-side filter did not ` +
        `hold, so nothing is stored. Examples: ${examples}.`,
      false,
      rowCount,
      fingerprint,
    );
  }

  // --- 4. Store: one transaction under the per-table lock -------------------
  const periodStatusByCode = new Map<string, string>();
  for (const code of periodCodes) {
    if (code.status != null) periodStatusByCode.set(code.code, code.status);
  }
  const staged = buildStagedRows(observationRows, schema.dimensions, registry.units, periodStatusByCode, tableId);
  const missingCells = cellCount - staged.length;

  const outcome = await db
    .withTransaction(async (tx) => {
      // Same key and bound as syncTable's rebaseline lock (pipeline.ts):
      // EXCLUSIVE against eviction and a rebaseline, and against
      // resolveIntent's SHARED read of this table.
      await tx.query("set local lock_timeout = '180s'");
      await tx.query('select pg_advisory_xact_lock(hashtext($1))', [tableId]);

      // Everything above validated against registry state read before this
      // lock existed. Re-read it under the lock; a moved row means a
      // concurrent refresh, quarantine or eviction won — abort, write nothing.
      const fresh = (
        await tx.query('select ingest_mode, status, version from cbs_tables where id = $1 for update', [tableId])
      ).rows[0];
      const moved =
        !fresh ||
        fresh.ingest_mode !== 'slice_cache' ||
        fresh.status !== 'active' ||
        Number(fresh.version) !== registry.version;
      if (moved) {
        const what = fresh
          ? `status ${String(fresh.status)}, version ${registry.version} -> ${String(fresh.version)}`
          : 'row removed';
        throw new SliceAbortError(
          `Slice fetch for "${tableId}" aborted: the table's registry row changed while this fetch was ` +
            `validating (${what}). Nothing was written; fetch the slice again.`,
        );
      }

      if (codeLists) {
        await tx.query(
          `update cbs_tables
             set units = $2, schema_cbs_modified = $3, version = version + 1, updated_at = now()
           where id = $1`,
          [tableId, JSON.stringify(unitsFromMeasures(numericMeasures)), schema.modified],
        );
        await tx.query('delete from dimension_labels where table_id = $1', [tableId]);
        await insertDimensionLabels(tx, tableId, labelRowsFromCodeLists(schema.dimensions, codeLists), 'none');
      }

      await stageRows(tx, staged);
      const corrections = await diffCorrections(tx, tableId);

      // #154, scoped to this request: a cell inside the requested
      // coordinates that CBS no longer returns is kept but marked retained,
      // dated by the previous fetch of this exact slice — the provable prior
      // that last confirmed it. No previous fetch of this filter_key → no
      // provable prior → nothing is marked (a cell stored by an overlapping
      // slice is not claimed by this one's history). A cell that reappears
      // is cleared by the upsert below.
      const prior = await tx.query('select batch_id from slice_fetches where table_id = $1 and filter_key = $2', [
        tableId,
        filterKey,
      ]);
      const priorBatchId = prior.rows[0]?.batch_id == null ? null : Number(prior.rows[0].batch_id);
      if (priorBatchId !== null) {
        const geoDim = schema.dimensions.find((d) => d.kind === 'GeoDimension');
        const dimsIn: Record<string, string[]> = {};
        for (const dim of nonTimeDims) if (dim !== geoDim?.name) dimsIn[dim] = request.members[dim]!;
        await markUnseenCellsRetained(tx, tableId, priorBatchId, {
          measures: request.measures,
          periods: request.periods,
          regionCodes: geoDim ? request.members[geoDim.name]! : null,
          dimsIn,
        });
      }
      const { rowsInserted, rowsUpdated } = await upsertStagedObservations(tx, tableId, batchId);
      const rowsUnchanged = staged.length - rowsInserted - rowsUpdated;

      // rows_missing on a slice batch = requested cells CBS returned no row for.
      await tx.query(
        `update ingestion_batches
           set outcome = 'succeeded', finished_at = now(),
               row_count = $2, rows_inserted = $3, rows_updated = $4, rows_unchanged = $5,
               rows_missing = $6, corrections = $7, fingerprint = $8, rebaselined = false
         where id = $1`,
        [
          batchId,
          staged.length,
          rowsInserted,
          rowsUpdated,
          rowsUnchanged,
          missingCells,
          JSON.stringify(corrections),
          fingerprint,
        ],
      );

      await tx.query(
        `insert into slice_fetches (table_id, filter_key, filter, cbs_modified, row_count, batch_id)
         values ($1, $2, $3, $4, $5, $6)
         on conflict (table_id, filter_key) do update set
           filter = excluded.filter,
           cbs_modified = excluded.cbs_modified,
           row_count = excluded.row_count,
           batch_id = excluded.batch_id,
           fetched_at = now()`,
        [tableId, filterKey, filterKey, sliceCbsModified, staged.length, batchId],
      );
      return null;
    })
    .catch((err: unknown) => {
      if (err instanceof SliceAbortError) return err;
      throw err;
    });

  if (outcome instanceof SliceAbortError) {
    return fail('rebaseline_conflict', outcome.failureSummary, false, rowCount, fingerprint);
  }

  return { ok: true, batchId, rowsStored: staged.length, missingCells, filterKey };
}

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
import type { CbsCode, CbsMeasure, CbsObservationRow, CbsSource, CbsTableSchema } from '../cbs-adapter/types.ts';
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
  /** Breadth step 5 (the table-lane job): the schema the caller JUST fetched
   * from this same `source` for this table, and its code lists — either
   * already fetched, or a loader this function calls only AFTER its
   * schema-only refusals (so `no_cbs_modified` / `no_time_dimension` still
   * refuse before any code-list fetch; the caller memoizes the loader and
   * reuses the lists). A first registration then fetches nothing twice.
   * Absent ⇒ fetched here, exactly as before. */
  prefetched?: {
    schema: CbsTableSchema;
    codeLists?: Record<string, CbsCode[]> | (() => Promise<Record<string, CbsCode[]>>);
  },
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

  if (prefetched !== undefined && prefetched.schema.tableId !== tableId) {
    throw new Error(`registerSchemaOnly: prefetched schema is for "${prefetched.schema.tableId}", not "${tableId}"`);
  }
  const schema = prefetched?.schema ?? (await source.fetchTableSchema(tableId));

  // Controller ruling, fix round 1: a slice-cache table's ONLY freshness
  // signal is CBS's own 'Modified' date — a source that cannot state one
  // cannot be schema-only registered at all, checked before anything else.
  // Final-review fix 5: this and the no_time_dimension refusal below need
  // only the schema, so they run BEFORE the (per-dimension) code-list fetch.
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

  const given = prefetched?.codeLists;
  const codeLists =
    given === undefined
      ? await fetchAllCodeLists(source, tableId, schema.dimensions)
      : typeof given === 'function'
        ? await given()
        : given;
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

export interface SliceRegistry {
  units: RegistryUnits;
  expectedDimensions: { name: string; kind: string }[];
  schemaFingerprint: string | null;
  schemaCbsModified: Date | null;
  version: number;
}

/** The `cbs_tables` registry row shape both `fetchSlice` and `ensureSlice`
 * (Task 5) validate a request against — extracted so the parse (jsonb
 * duality, the pg-vs-PGlite string/object round trip parseJsonbUnits also
 * handles) exists exactly once. */
function parseSliceRegistry(row: Record<string, unknown>): SliceRegistry {
  return {
    units: parseJsonbUnits(row.units) as RegistryUnits,
    expectedDimensions: (typeof row.expected_dimensions === 'string'
      ? JSON.parse(row.expected_dimensions)
      : (row.expected_dimensions ?? [])) as { name: string; kind: string }[],
    schemaFingerprint: (row.schema_fingerprint as string | null) ?? null,
    schemaCbsModified: row.schema_cbs_modified == null ? null : new Date(row.schema_cbs_modified as string | Date),
    version: Number(row.version),
  };
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

// ---------------------------------------------------------------------------
// Schema check + apply (Task 5: shared between fetchSlice's inline refresh
// and ensureSlice's standalone pre-check, never a second copy of either)
// ---------------------------------------------------------------------------

export type SchemaCheckResult =
  | {
      ok: true;
      schema: CbsTableSchema;
      numericMeasures: CbsMeasure[];
      fingerprint: string;
      /** true when CBS's current Modified is newer than the registry's
       * `schema_cbs_modified` — a refresh is needed/was fetched. */
      refresh: boolean;
      /** Non-null exactly when `refresh` is true — CBS's current code lists,
       * fetched so a caller can apply them (`applySchemaRefresh`). */
      codeLists: Record<string, CbsCode[]> | null;
    }
  | { ok: false; stage: FailureStage; summary: string; quarantine: boolean; fingerprint: string | null };

/** Fetches CBS's current schema for a slice-cache table (one properties
 * request — `knownSchema`, when given, skips even that: the caller already
 * has it) and decides, against the given registry snapshot, whether a
 * refresh is needed — running the SAME schema_fingerprint and
 * unit_consistency checks either way (a redesign or unit change CBS did not
 * announce via Modified must still fail loudly, and one it did announce must
 * never be applied), refusing a Modified OLDER than the registry's, and
 * fetching current code lists only when a refresh IS needed. Pure: no DB
 * writes, no batch bookkeeping — a caller on failure records its own batch
 * (fetchSlice already has one open; ensureSlice opens its own).
 *
 * This is fetchSlice's own step 2 (schema fetch, freshness check,
 * schema_fingerprint validation, conditional code-list fetch), extracted so
 * ensureSlice (Task 5) can run exactly the same decision standalone, BEFORE
 * validating a request against possibly-stale stored labels — never a copy
 * of this logic. */
export async function checkSliceSchema(
  source: CbsSource,
  tableId: string,
  registry: SliceRegistry,
  knownSchema?: CbsTableSchema,
): Promise<SchemaCheckResult> {
  const fetchFailureResult = (err: unknown): SchemaCheckResult => ({
    ok: false,
    stage: 'fetch',
    summary: `Fetching a slice of table "${tableId}" from CBS failed: ${err instanceof Error ? err.message : String(err)}.`,
    quarantine: false,
    fingerprint: null,
  });

  let schema: CbsTableSchema;
  if (knownSchema) {
    schema = knownSchema;
  } else {
    try {
      schema = await source.fetchTableSchema(tableId);
    } catch (err) {
      return fetchFailureResult(err);
    }
  }

  const fetchedModified = toTime(schema.modified);
  if (schema.modified == null || fetchedModified === null) {
    return {
      ok: false,
      stage: 'fetch',
      summary:
        `CBS returned no readable 'Modified' date for table "${tableId}" (got ${JSON.stringify(schema.modified)}); ` +
        `without it the stored slices can never be told apart from stale ones, so nothing is fetched.`,
      quarantine: false,
      fingerprint: null,
    };
  }
  const storedModified = registry.schemaCbsModified?.getTime() ?? null;
  // Final-review fix 4: CBS serving an OLDER 'Modified' than the one we
  // already hold (a lagging mirror, a rollback) is an unexpected CBS state —
  // refused loudly (principle c), never stored under either date: recording
  // the later date would claim these cells came from a CBS version this
  // response is not, and the earlier one would move the registry backwards.
  // A fetch failure, not suspect data: no quarantine, nothing written.
  if (storedModified !== null && fetchedModified < storedModified) {
    return {
      ok: false,
      stage: 'fetch',
      summary:
        `CBS reported table "${tableId}" as last modified ${schema.modified}, OLDER than the ` +
        `${registry.schemaCbsModified!.toISOString()} we already hold — a lagging or rolled-back CBS response. ` +
        `Nothing is fetched or stored until CBS reports a current date again.`,
      quarantine: false,
      fingerprint: null,
    };
  }
  const refresh = storedModified === null || fetchedModified > storedModified;

  const numericMeasures = schema.measures.filter((m) => m.dataType !== 'String');
  const numericCodes = numericMeasures.map((m) => m.code);
  const fingerprint = computeFingerprint(schema.dimensions, numericCodes);

  const stage1 = checkSchemaFingerprint(
    schema.dimensions,
    numericCodes,
    registry.expectedDimensions,
    registry.schemaFingerprint,
  );
  if (!stage1.ok) {
    return { ok: false, stage: stage1.stage, summary: stage1.summary, quarantine: true, fingerprint };
  }

  // Final-review fix 2: the unit/decimals check lives HERE, next to the
  // fingerprint check, so every path that may go on to apply a refresh
  // (fetchSlice inline, ensureSlice's standalone pre-check) runs it BEFORE
  // applySchemaRefresh rewrites the stored units — a refresh can never
  // launder a unit change into the registry the check compares against.
  const unitCheck = checkUnitConsistency(numericMeasures, registry.units);
  if (!unitCheck.ok) {
    return { ok: false, stage: unitCheck.stage, summary: unitCheck.summary, quarantine: true, fingerprint };
  }

  let codeLists: Record<string, CbsCode[]> | null = null;
  if (refresh) {
    try {
      codeLists = await fetchAllCodeLists(source, tableId, schema.dimensions);
    } catch (err) {
      return fetchFailureResult(err);
    }
  }

  return { ok: true, schema, numericMeasures, fingerprint, refresh, codeLists };
}

/** Applies an already-fetched, already-fingerprint-checked schema refresh
 * (`checkSliceSchema`'s `refresh: true` branch) to the registry: units,
 * `schema_cbs_modified`, a version bump, and a full `dimension_labels`
 * replace — the exact write fetchSlice's own store step has always made
 * inline, now shared with ensureSlice's standalone pre-check (Task 5).
 * Caller's responsibility: run this under the per-table EXCLUSIVE advisory
 * lock (`pg_advisory_xact_lock(hashtext(tableId))`), in the same transaction
 * as the registry's own concurrency check — this function only issues the
 * writes. */
export async function applySchemaRefresh(
  tx: Db,
  tableId: string,
  schema: CbsTableSchema,
  numericMeasures: CbsMeasure[],
  codeLists: Record<string, CbsCode[]>,
): Promise<void> {
  await tx.query(
    `update cbs_tables
       set units = $2, schema_cbs_modified = $3, version = version + 1, updated_at = now()
     where id = $1`,
    [tableId, JSON.stringify(unitsFromMeasures(numericMeasures)), schema.modified],
  );
  await tx.query('delete from dimension_labels where table_id = $1', [tableId]);
  await insertDimensionLabels(tx, tableId, labelRowsFromCodeLists(schema.dimensions, codeLists), 'none');
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
 *    the stored labels without accepting new codes (quarantines), and finally
 *    every row must lie inside the requested coordinates. (unit_consistency
 *    against the stored units — quarantines — and the refusal of a CBS
 *    Modified OLDER than the registry's run earlier, in checkSliceSchema.)
 * 4. Store, in ONE transaction under the per-table advisory lock syncTable,
 *    eviction and resolveIntent share: optional schema refresh, the
 *    observations upsert (syncTable's own staging + upsert helpers), the batch
 *    marked succeeded, and the `slice_fetches` row upserted (its `checked_at`
 *    set to now — the date the query layer shows for this slice's cells;
 *    `cbs_tables.last_sync_at` is never written). Cells inside the
 *    request that CBS no longer returns are marked retained (#154), each
 *    dated by its own last-writing batch — never the whole table's unseen
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
  /** Task 5 internal seam: ensureSlice, having already fetched CBS's current
   * schema (and, if newer, already applied that refresh to the registry
   * BEFORE calling in here), passes it through so this call skips its own
   * properties request — and, since the registry it reads below is already
   * current, checkSliceSchema naturally finds nothing left to refresh, so
   * this call never refreshes what ensureSlice already refreshed. No caller
   * outside ensureSlice needs this. */
  opts?: { schema?: CbsTableSchema },
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
  const registry: SliceRegistry = parseSliceRegistry(row);
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

  // Schema fetch + freshness/fingerprint check + conditional code-list
  // fetch — checkSliceSchema (extracted above, Task 5): identical work to
  // what this block always did inline, just also reusable by ensureSlice.
  // `opts?.schema` is set only when ensureSlice already fetched (and, if
  // needed, already applied) it — this call then does no network fetch of
  // its own here, and naturally detects nothing left to refresh.
  const check = await checkSliceSchema(source, tableId, registry, opts?.schema);
  if (!check.ok) return fail(check.stage, check.summary, check.quarantine, null, check.fingerprint);
  const { schema, numericMeasures, fingerprint, codeLists } = check;
  // check.ok guarantees CBS's Modified is readable and NOT older than the
  // registry's (an older one is refused by checkSliceSchema — final-review
  // fix 4), so the slice is recorded as of exactly the version it came from.
  const sliceCbsModified = schema.modified;

  const observationRows: CbsObservationRow[] = [];
  try {
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

  // unit_consistency already ran inside checkSliceSchema above (final-review
  // fix 2: shared with ensureSlice's pre-check, before any refresh).

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
        await applySchemaRefresh(tx, tableId, schema, numericMeasures, codeLists);
      }

      await stageRows(tx, staged);
      const corrections = await diffCorrections(tx, tableId);

      // #154, scoped to this request: a cell inside the requested
      // coordinates that CBS no longer returns is kept but marked retained —
      // ALWAYS, whether or not this exact filter_key was fetched before
      // (final-review fix 1). The query layer dates a present cell by the
      // latest checked_at of ANY covering slice, so an unmarked cell a NEW
      // overlapping slice just failed to get back would be served as
      // confirmed by this fetch (R4). Its last-seen batch is the cell's OWN
      // batch_id (null prior -> `o.batch_id`): the batch that really returned
      // its stored value — never later than CBS's last confirmation, so the
      // date can only err older. Only still-unmarked cells are touched (the
      // date never creeps forward); a cell that reappears is cleared by the
      // upsert below.
      const geoDim = schema.dimensions.find((d) => d.kind === 'GeoDimension');
      const dimsIn: Record<string, string[]> = {};
      for (const dim of nonTimeDims) if (dim !== geoDim?.name) dimsIn[dim] = request.members[dim]!;
      await markUnseenCellsRetained(tx, tableId, null, {
        measures: request.measures,
        periods: request.periods,
        regionCodes: geoDim ? request.members[geoDim.name]! : null,
        dimsIn,
      });
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
           fetched_at = now(),
           checked_at = now()`,
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

// ---------------------------------------------------------------------------
// ensureSlice (breadth step 2, Task 5)
// ---------------------------------------------------------------------------

/**
 * Skips fetching a slice already stored and fresh: returns
 * `{ ok: true, cached: true, … }` without any observation fetch when
 * `slice_fetches` already holds this exact request (`filter_key`) and CBS's
 * current `Modified` says nothing changed — one cheap properties request
 * either way, never a full observations fetch on a cache hit. A cache hit
 * moves that row's `checked_at` to the time of this CBS check (CBS just
 * confirmed the slice unchanged) — unless a refresh landed in between and
 * superseded it — so answers from it are dated by this confirmation. Otherwise
 * behaves exactly like `fetchSlice` (and, for a table that is not an active
 * slice-cache table, defers to it immediately with no extra network call, so
 * it gives the exact same refusal wording for "not registered" / "full
 * table" / "quarantined").
 *
 * The "newest period" problem (controller ruling, Task 5): `fetchSlice`
 * validates a request against STORED labels BEFORE any network call, so a
 * period CBS added after this table's last refresh is refused until some
 * OTHER fetch happens to trigger a refresh first. `ensureSlice` fixes that
 * by checking CBS's Modified FIRST and, if newer than
 * `cbs_tables.schema_cbs_modified`, applying the schema refresh (labels,
 * units, `schema_cbs_modified`) BEFORE validating/fetching the actual
 * request — via `checkSliceSchema`/`applySchemaRefresh`, the exact steps
 * `fetchSlice` itself uses, never a copy. The already-fetched schema is then
 * passed to `fetchSlice` (on a cache miss) so it does not fetch — or
 * refresh — it again.
 *
 * Staleness without a further network call (controller ruling): a stored
 * `slice_fetches` row whose `cbs_modified` is OLDER than the table's
 * (possibly just-refreshed) `schema_cbs_modified` is stale — a DIFFERENT
 * slice already saw a newer CBS version, this one hasn't yet — and is
 * refetched even though CBS's Modified has not moved again since this
 * function's own check. Otherwise the row is a cache hit exactly when CBS's
 * current Modified is not newer than the row's own `cbs_modified`.
 *
 * NEVER call this while holding resolveIntent's SHARED per-table advisory
 * lock (src/query/resolve.ts, `pg_advisory_xact_lock_shared`) — both the
 * refresh step here and `fetchSlice`'s own write step take the EXCLUSIVE
 * lock on the same key (`syncTable`'s own bound) and would self-deadlock
 * against a shared lock already held in the same transaction/session.
 * Nothing in the request path calls this yet (breadth step 2, Task 5) —
 * wiring it in is a later step.
 */
export async function ensureSlice(
  db: Db,
  source: CbsSource,
  tableId: string,
  req: SliceRequest,
): Promise<SliceFetchResult & { cached?: boolean }> {
  const filterKey = sliceFilterKey(req);

  const registryRow = (
    await db.query(
      `select ingest_mode, status, needs_review_reason, units, expected_dimensions,
              schema_fingerprint, schema_cbs_modified, version
         from cbs_tables where id = $1`,
      [tableId],
    )
  ).rows[0];
  // Not a registered, active slice-cache table: no schema check applies here
  // — fetchSlice's own request validation gives the right refusal, with no
  // wasted network call for a request that would refuse anyway.
  if (!registryRow || registryRow.ingest_mode !== 'slice_cache' || registryRow.status !== 'active') {
    return fetchSlice(db, source, tableId, req);
  }
  const registry = parseSliceRegistry(registryRow);

  // Fix round 1 of Task 5b: the moment CBS's Modified was asked for — what a
  // cache hit below confirms the slice AS OF (never the later now() of the
  // bump itself, which would over-claim by the length of this call).
  const checkTakenAt = new Date().toISOString();
  // ensureSlice's own failures (no fetchSlice batch exists yet) get their own
  // failed batch row, same bookkeeping as fetchSlice's.
  const failOwn = async (
    stage: FailureStage,
    summary: string,
    quarantine: boolean,
    fingerprint: string | null,
  ): Promise<SliceFetchResult> => {
    const batchInsert = await db.query(
      `insert into ingestion_batches (table_id, outcome) values ($1, 'running') returning id`,
      [tableId],
    );
    const batchId = Number(batchInsert.rows[0]!.id);
    await failBatch(db, batchId, tableId, stage, summary, null, fingerprint, quarantine);
    return { ok: false, stage, summary };
  };
  const check = await checkSliceSchema(source, tableId, registry);
  if (!check.ok) return failOwn(check.stage, check.summary, check.quarantine, check.fingerprint);

  const codeLists = check.codeLists;
  if (check.refresh && codeLists) {
    await db.withTransaction(async (tx) => {
      // Same key and bound as fetchSlice's own write lock (and syncTable's
      // rebaseline lock): EXCLUSIVE against a concurrent fetchSlice/eviction/
      // rebaseline, and against resolveIntent's SHARED read of this table.
      await tx.query("set local lock_timeout = '180s'");
      await tx.query('select pg_advisory_xact_lock(hashtext($1))', [tableId]);
      const fresh = (
        await tx.query('select ingest_mode, status, version from cbs_tables where id = $1 for update', [tableId])
      ).rows[0];
      const moved =
        !fresh ||
        fresh.ingest_mode !== 'slice_cache' ||
        fresh.status !== 'active' ||
        Number(fresh.version) !== registry.version;
      // A concurrent change (another refresh, a quarantine, an eviction) won
      // the race: skip applying here rather than fighting it. fetchSlice
      // below re-reads the registry itself and reacts to whatever is
      // actually there now — no data is lost or duplicated either way, this
      // call simply did not get to apply the refresh it found.
      if (moved) return;
      await applySchemaRefresh(tx, tableId, check.schema, check.numericMeasures, codeLists);
    });
  }

  const sliceRow = (
    await db.query(
      'select cbs_modified, batch_id, row_count from slice_fetches where table_id = $1 and filter_key = $2',
      [tableId, filterKey],
    )
  ).rows[0];

  if (sliceRow) {
    const currentSchemaModified = (
      await db.query('select schema_cbs_modified from cbs_tables where id = $1', [tableId])
    ).rows[0]?.schema_cbs_modified;
    const rowModifiedTime = toTime(sliceRow.cbs_modified);
    const schemaModifiedTime = toTime(currentSchemaModified);
    // Ruling #2: a row older than the table's CURRENT schema_cbs_modified is
    // stale even without CBS moving again (a DIFFERENT slice already saw the
    // newer version); otherwise a cache hit needs CBS's Modified, fetched
    // just above, to be no newer than what this row already recorded.
    const stale = rowModifiedTime !== null && schemaModifiedTime !== null && rowModifiedTime < schemaModifiedTime;
    const cbsModifiedTime = toTime(check.schema.modified);
    // Final-review fix 4, per slice: CBS's Modified OLDER than the version
    // this slice was already stored under (a lagging mirror) must never read
    // as "unchanged" and re-confirm it — refused like the registry-level case
    // checkSliceSchema already refuses: stage 'fetch', no quarantine, nothing
    // written beyond the failed batch.
    if (cbsModifiedTime !== null && rowModifiedTime !== null && cbsModifiedTime < rowModifiedTime) {
      return failOwn(
        'fetch',
        `CBS reported table "${tableId}" as last modified ${String(check.schema.modified)}, OLDER than the ` +
          `${new Date(rowModifiedTime).toISOString()} this slice was stored under — a lagging or rolled-back ` +
          `CBS response. Nothing is fetched, stored or re-confirmed until CBS reports a current date again.`,
        false,
        null,
      );
    }
    const cbsNewer = rowModifiedTime === null || cbsModifiedTime === null || cbsModifiedTime > rowModifiedTime;
    if (!stale && !cbsNewer) {
      // Task 5b: CBS's Modified, fetched just above, says nothing changed
      // since this slice was stored — its cells are re-confirmed as of the
      // check. Only checked_at moves (fetched_at stays: nothing was fetched);
      // the query layer dates this slice's cells by it. cbs_tables.last_sync_at
      // is never written here (one slice must not re-date another's cells).
      // Fix round 1 (minor 2): this runs outside the per-table lock, so it is
      // CONDITIONAL — a refresh committed since the staleness check above (a
      // newer schema_cbs_modified this row has not caught up with) means CBS
      // has superseded the slice, and it must not be confirmed. greatest()
      // keeps a concurrent refetch's later checked_at from moving backwards.
      await db.query(
        `update slice_fetches set checked_at = greatest(checked_at, $3::timestamptz)
          where table_id = $1 and filter_key = $2
            and cbs_modified >= (select schema_cbs_modified from cbs_tables where id = $1)`,
        [tableId, filterKey, checkTakenAt],
      );
      const batch = (
        await db.query('select rows_missing from ingestion_batches where id = $1', [sliceRow.batch_id])
      ).rows[0];
      return {
        ok: true,
        cached: true,
        batchId: Number(sliceRow.batch_id),
        rowsStored: Number(sliceRow.row_count),
        missingCells: batch?.rows_missing == null ? 0 : Number(batch.rows_missing),
        filterKey,
      };
    }
  }

  return fetchSlice(db, source, tableId, req, { schema: check.schema });
}

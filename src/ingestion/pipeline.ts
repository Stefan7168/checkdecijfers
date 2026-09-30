// registerTables + syncTable — the core ingestion pipeline (docs/05-data-rules.md,
// "Data access strategy" + "Validation pipeline"; docs/07-phase0-table-set.md,
// slices and catalog quirks).
import type { CbsCode, CbsDimension, CbsMeasure, CbsObservationRow, CbsSlice, CbsSource } from '../cbs-adapter/types.ts';
import type { Db } from '../db/types.ts';
import { eurostatDoiFor, verifyEurostatDoi } from '../eurostat-adapter/doi.ts';
import { computeFingerprint } from './fingerprint.ts';
import { allowListedMeasures, missingAllowListedCodes } from './measure-allow-list.ts';
import { parsePeriodNotes } from './period-note-status.ts';
import { parsePeriodCode } from './periods.ts';
import { SEED_TABLES, type Phase0Table } from './registry-seed.ts';
import { EUROSTAT_SOURCE_KEY, sourceKeyForTableId } from '../sources/registry.ts';
import type { Correction, RegisterTablesFn, SyncOptions, SyncResult, SyncTableFn } from './types.ts';
import {
  checkDimensionMapping,
  checkPeriodParsing,
  checkRowPlausibility,
  checkSchemaFingerprint,
  checkUnitConsistency,
  type RegistryUnits,
  type StoredLabel,
} from './validate.ts';

const CHUNK_SIZE = 5000;

function findDimension(dimensions: CbsDimension[], kind: CbsDimension['kind']): CbsDimension | undefined {
  return dimensions.find((d) => d.kind === kind);
}

/** Exported for src/ingestion/slice-cache.ts (breadth step 2, Task 3):
 * registerSchemaOnly needs the exact same all-dimensions code-list fetch
 * registerTables uses — reused, never copied. */
export async function fetchAllCodeLists(
  source: CbsSource,
  tableId: string,
  dimensions: CbsDimension[],
  // E2a step-5 fix (2026-09-23): threaded through to `fetchCodeList` so a
  // Eurostat table's registered slice narrows this fetch the SAME way it
  // narrows `fetchTableSchema`/`fetchObservations` — see CbsSource's own
  // doc comment (src/cbs-adapter/types.ts). `undefined` for CBS callers is
  // the pre-existing behaviour, unchanged.
  slice?: CbsSlice,
): Promise<Record<string, CbsCode[]>> {
  const result: Record<string, CbsCode[]> = {};
  for (const dim of dimensions) {
    result[dim.name] = await source.fetchCodeList(tableId, dim.name, slice);
  }
  return result;
}

async function fetchAllObservations(
  source: CbsSource,
  tableId: string,
  slice: Phase0Table['slice'],
  // #156 (session-47 ingestion hunt): the dimension names from the schema this
  // sync ALREADY fetched + validated, so the adapter parses observations against
  // that same set instead of re-fetching /Dimensions (redundant call + TOCTOU).
  dimensionNames: string[],
): Promise<CbsObservationRow[]> {
  const rows: CbsObservationRow[] = [];
  for await (const page of source.fetchObservations(tableId, slice, dimensionNames)) {
    rows.push(...page);
  }
  return rows;
}

/** Exported for the WP30b conformance harness (src/sources/conformance.ts),
 * which derives registration-time expectations exactly like registerTables
 * does — one derivation, no second copy to drift. */
export function unitsFromMeasures(measures: CbsMeasure[]): RegistryUnits {
  const units: RegistryUnits = {};
  for (const m of measures) {
    units[m.code] = { unit: m.unit, decimals: m.decimals, title: m.title, description: m.description };
  }
  return units;
}

/** The per-table curation a registration applies to CBS's measure list. */
export interface MeasureCuration {
  /** ADR 061: `slice.measures` is the allow-list of served codes. */
  slice?: CbsSlice | null;
  /** #167: curated phantom measures, treated as not published. */
  excludeMeasures?: string[];
}

/** The measures a table registers as served: CBS's list minus the curated
 * phantom exclusions, narrowed to the allow-list when there is one. A listed
 * code CBS does not carry is a curation error — refused before any write.
 * Shared by registerTables and registerSchemaOnly's pinned path so the two
 * storage modes derive one served set. */
export function servedMeasuresForRegistration(
  tableId: string,
  measures: CbsMeasure[],
  curation: MeasureCuration,
): CbsMeasure[] {
  const excluded = new Set(curation.excludeMeasures ?? []);
  const missingListed = missingAllowListedCodes(curation.slice, measures.map((m) => m.code));
  if (missingListed.length > 0) {
    throw new Error(
      `Cannot register ${tableId}: its measure allow-list names code(s) CBS does not list: ` +
        `${missingListed.join(', ')}.`,
    );
  }
  const allow = allowListedMeasures(curation.slice);
  return measures.filter((m) => !excluded.has(m.code) && (allow === null || allow.has(m.code)));
}

// ---------------------------------------------------------------------------
// registerTables
// ---------------------------------------------------------------------------

export const registerTables: RegisterTablesFn = async (db, source, tables, options = {}) => {
  // #110(c): seed registrations pin (eviction-exempt); on-demand onboarding
  // takes the default false — matching the column default, so the on-demand
  // path needed no change when the option landed.
  const pinned = options.pinned ?? false;
  const fetchImpl = options.fetchImpl;
  const existingRows = await db.query('select id from cbs_tables');
  const existingIds = new Set(existingRows.rows.map((r) => r.id as string));

  const newlyRegistered: string[] = [];

  for (const table of tables) {
    if (existingIds.has(table.id)) continue;

    // E2a step-5 fix (2026-09-23): `table.slice` — already stored verbatim
    // into `cbs_tables.slice` further down and already threaded into
    // `fetchObservations` at sync time — now ALSO reaches the schema/
    // code-list read here. Was the real registerTables gap: a Eurostat
    // dataset whose wanted slice is small but whose FULL dataset exceeds the
    // 500k-cell synchronous cap could never even register, because this
    // schema fetch requested the unfiltered dataset regardless of the slice
    // the table would otherwise be registered with (see ADR 048 D6's
    // as-built note). For CBS, `table.slice` is passed through identically,
    // but CBS's own adapters ignore the parameter — byte-identical.
    const schema = await source.fetchTableSchema(table.id, table.slice);
    const codeLists = await fetchAllCodeLists(source, table.id, schema.dimensions, table.slice);

    const expectedDimensions = [...schema.dimensions]
      .map((d) => ({ name: d.name, kind: d.kind }))
      .sort((a, b) => a.name.localeCompare(b.name));
    // #167 (phantom-measure exclusion) + ADR 061 (measure allow-list): the
    // registered units carry only the measures this table actually serves.
    const units = unitsFromMeasures(servedMeasuresForRegistration(table.id, schema.measures, table));

    const sourceKey = sourceKeyForTableId(table.id);

    // #264 (ADR 048 D7(a)): the DOI shown on the "Bewijs dit cijfer" proof
    // panel, scoped to Eurostat rows only — CBS has no DOI concept, so
    // migration 032's `doi` column stays NULL for every CBS row forever
    // (cheapest-mechanism-first: zero API calls for the source that has no
    // DOI at all). For Eurostat, construct the DOI deterministically
    // (`10.2908/<CODE>`, session 108 research) then verify it out-of-band —
    // never the request path — against the public DataCite API before ever
    // storing it as fact (principle c: never guess). `verifyEurostatDoi`
    // itself never throws (see that module); the try/catch below is an
    // extra belt so a genuinely unexpected failure here can NEVER fail or
    // block registration — DOI is presentation-only support, not a
    // validation-pipeline check.
    let doi: string | null = null;
    if (sourceKey === EUROSTAT_SOURCE_KEY) {
      try {
        const candidate = eurostatDoiFor(table.id);
        const findable = await verifyEurostatDoi(candidate, { fetchImpl });
        if (findable) {
          doi = candidate;
        } else {
          console.warn(
            `DOI candidate ${candidate} for ${table.id} was not confirmed findable by DataCite — ` +
              'left null (registration and the proof panel are unaffected).',
          );
        }
      } catch (error) {
        console.warn(
          `DOI verification errored for ${table.id} (registration unaffected):`,
          error instanceof Error ? error.message : String(error),
        );
      }
    }

    await db.withTransaction(async (tx) => {
      await tx.query(
        `insert into cbs_tables
           (id, title, expected_dimensions, slice, units, update_cadence, schema_fingerprint, pinned, source, doi)
         values ($1, $2, $3, $4, $5, $6, null, $7, $8, $9)`,
        [
          table.id,
          schema.title,
          JSON.stringify(expectedDimensions),
          table.slice ? JSON.stringify(table.slice) : null,
          JSON.stringify(units),
          table.updateCadence,
          pinned,
          // WP30c fix (session 107, found registering the first real
          // Eurostat table): this insert never wrote `source` at all,
          // silently defaulting to the migration-016 column default ('cbs')
          // for EVERY table, Eurostat included — a real bug, distinct from
          // (and not caught by) `ingestCatalog`'s own already-correct
          // source-scoped insert into `cbs_catalog`. Derived from the id's
          // own prefix (D4), the SAME derivation `src/catalog/recall.ts`'s
          // deny gate itself uses — so this write can never disagree with
          // the one thing that actually matters for keeping Eurostat off
          // live chat (that gate never reads this column, by design).
          sourceKey,
          doi,
        ],
      );

      // #34(b): batched, preserving this site's on-conflict-do-nothing.
      await insertDimensionLabels(
        tx,
        table.id,
        labelRowsFromCodeLists(schema.dimensions, codeLists),
        'ignore',
      );
    });

    newlyRegistered.push(table.id);
  }

  return newlyRegistered;
};

// ---------------------------------------------------------------------------
// syncTable
// ---------------------------------------------------------------------------

interface RegistryRow {
  id: string;
  expected_dimensions: { name: string; kind: string }[];
  units: RegistryUnits;
  slice: Phase0Table['slice'] | null;
  row_count_tolerance: number;
  schema_fingerprint: string | null;
  status: 'active' | 'needs_review';
  last_row_count: number | null;
  version: number;
}

function parseRegistryRow(row: Record<string, unknown>): RegistryRow {
  const parseJsonb = <T>(value: unknown, fallback: T): T => {
    if (value == null) return fallback;
    return (typeof value === 'string' ? JSON.parse(value) : value) as T;
  };
  return {
    id: row.id as string,
    expected_dimensions: parseJsonb(row.expected_dimensions, []),
    units: parseJsonb(row.units, {}),
    slice: parseJsonb(row.slice, null),
    row_count_tolerance: Number(row.row_count_tolerance),
    schema_fingerprint: (row.schema_fingerprint as string | null) ?? null,
    status: row.status as 'active' | 'needs_review',
    last_row_count: row.last_row_count == null ? null : Number(row.last_row_count),
    version: Number(row.version),
  };
}

export interface StagedRow {
  measure: string;
  region_code: string;
  period_code: string;
  period_grain: 'JJ' | 'KW' | 'MM';
  period_year: number;
  period_index: number | null;
  dims: Record<string, string>;
  value: number | null;
  unit: string;
  decimals: number;
  status: string;
  value_attribute: string;
}

function sortedDims(dims: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(dims).sort()) out[key] = dims[key]!;
  return out;
}

/** Exported for src/ingestion/slice-cache.ts (breadth step 2, Task 4) —
 * a failed slice fetch is recorded exactly like a failed sync. */
export async function failBatch(
  db: Db,
  batchId: number,
  tableId: string,
  stage: NonNullable<SyncResult['failureStage']>,
  summary: string,
  rowCount: number | null,
  fingerprint: string | null,
  quarantine: boolean,
): Promise<void> {
  await db.query(
    `update ingestion_batches
       set outcome = 'failed', finished_at = now(), failure_stage = $2,
           failure_summary = $3, row_count = $4, fingerprint = $5
     where id = $1`,
    [batchId, stage, summary, rowCount, fingerprint],
  );
  if (quarantine) {
    await db.query(
      `update cbs_tables
         set status = 'needs_review', needs_review_reason = $2, updated_at = now()
       where id = $1`,
      [tableId, summary],
    );
  }
}

/**
 * #34(c): thrown from inside the rebaseline write transaction when its
 * post-lock re-validation decides this sync must not commit. withTransaction's
 * contract rolls everything back on rejection; syncTable's outer scope catches
 * exactly this type, records the batch as failed via failBatch (the
 * ingestion_batches row must never be left stuck at 'running'), and returns
 * the same failed SyncResult shape the five ordered checks produce. It must
 * never escape syncTable.
 */
class RebaselineAbortError extends Error {
  readonly stage: NonNullable<SyncResult['failureStage']>;
  readonly failureSummary: string;
  /** Mirrors failBatch's quarantine flag: true also marks the table needs_review. */
  readonly quarantine: boolean;

  constructor(
    stage: NonNullable<SyncResult['failureStage']>,
    failureSummary: string,
    quarantine: boolean,
  ) {
    super(failureSummary);
    this.name = 'RebaselineAbortError';
    this.stage = stage;
    this.failureSummary = failureSummary;
    this.quarantine = quarantine;
  }
}

/** One dimension_labels row, in the exact column order the insert writes. */
interface LabelRow {
  dimension: string;
  code: string;
  label: string;
  dimension_group: string | null;
  status: string | null;
  sort_index: number | null;
}

/** Flattens fetched code lists into label rows, in the same dimension-then-code
 * order the old per-row insert loops used. Exported for src/ingestion/
 * slice-cache.ts (breadth step 2, Task 3) — reused, never copied. */
export function labelRowsFromCodeLists(
  dimensions: CbsDimension[],
  codeLists: Record<string, CbsCode[]>,
): LabelRow[] {
  const rows: LabelRow[] = [];
  for (const dim of dimensions) {
    for (const code of codeLists[dim.name] ?? []) {
      rows.push({
        dimension: dim.name,
        code: code.code,
        label: code.title,
        dimension_group: code.dimensionGroup,
        status: code.status,
        sort_index: code.index,
      });
    }
  }
  return rows;
}

/**
 * #34(b): dimension_labels writes go in CHUNK_SIZE batches through
 * jsonb_to_recordset — one round-trip per chunk instead of one per code, the
 * same batching the observations staging insert already uses (per-row label
 * writes dominated the 4-6 minute syncs of small tables). Row content is
 * identical to the old per-row inserts: same columns, same values, and
 * CbsCode's nullable fields are explicit nulls, which JSON round-trips
 * losslessly. `onConflict: 'ignore'` keeps the two sites that had
 * `on conflict ... do nothing`; 'none' keeps the rebaseline rewrite's exact
 * semantics — it follows a delete, so a conflict there can only be a genuine
 * anomaly (a duplicate code inside one fetched CBS code list) and must stay
 * a loud unique-violation failure, never a silent drop.
 *
 * Exported for src/ingestion/slice-cache.ts (breadth step 2, Task 3) —
 * registerSchemaOnly writes the same dimension_labels shape and reuses this
 * batched writer instead of a second copy.
 */
export async function insertDimensionLabels(
  tx: Db,
  tableId: string,
  rows: LabelRow[],
  onConflict: 'ignore' | 'none',
): Promise<void> {
  const conflictClause =
    onConflict === 'ignore' ? '\n       on conflict (table_id, dimension, code) do nothing' : '';
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE);
    await tx.query(
      `insert into dimension_labels
         (table_id, dimension, code, label, dimension_group, status, sort_index)
       select $1::text, x.dimension, x.code, x.label, x.dimension_group, x.status, x.sort_index
       from jsonb_to_recordset($2::jsonb) as x(
         dimension text, code text, label text, dimension_group text,
         status text, sort_index integer
       )${conflictClause}`,
      [tableId, JSON.stringify(chunk)],
    );
  }
}

/**
 * Derives the `observations` columns for every validated fetched row — the
 * single column derivation shared by syncTable (whole-table sync) and
 * fetchSlice (src/ingestion/slice-cache.ts, breadth step 2 Task 4): trimmed
 * measure, region from the GeoDimension, parsed period grain/year/index, the
 * remaining coordinates as sorted `dims`, unit/decimals from the registry,
 * and the status (per-cell override, else the period's). Extracted verbatim
 * from syncTable — same checks, same error texts. Runs only AFTER the
 * validation stages; its throws are defensive guards those stages cover.
 */
export function buildStagedRows(
  observationRows: CbsObservationRow[],
  dimensions: CbsDimension[],
  registryUnits: RegistryUnits,
  periodStatusByCode: Map<string, string>,
  tableId: string,
): StagedRow[] {
  const periodDim = findDimension(dimensions, 'TimeDimension');
  const geoDim = findDimension(dimensions, 'GeoDimension');

  const staged: StagedRow[] = [];
  for (const row of observationRows) {
    const measure = row.measure.trim();
    const regionCode = geoDim ? (row.coordinates[geoDim.name] ?? '').trim() : '';
    const periodCode = periodDim ? row.coordinates[periodDim.name]! : '';
    const parsedPeriod = parsePeriodCode(periodCode);
    if (!parsedPeriod) {
      // Guarded by the period_parsing stage (stage 3); defensive only.
      throw new Error(`internal error: unparseable period code "${periodCode}" survived period_parsing`);
    }

    const dims: Record<string, string> = {};
    for (const dim of dimensions) {
      if (dim === periodDim || dim === geoDim) continue;
      const code = row.coordinates[dim.name];
      if (code !== undefined) dims[dim.name] = code;
    }

    const unitMeta = registryUnits[measure];
    // Guarded by the dimension_mapping stage (stage 4); defensive only.
    if (!unitMeta) throw new Error(`internal error: unknown measure "${measure}" survived dimension_mapping`);

    // Status transitions (Voorlopig -> Definitief) are normal CBS lifecycle:
    // they update rows and are counted as rows_updated, not logged as
    // corrections (docs/05 corrections log covers *value* changes).
    // A period without a status fails at stage 3 — never defaulted here
    // (R11: status is required; principle (c): never guess).
    //
    // #251 (session 109): the OPTIONAL per-CELL override. CBS's own adapter
    // never sets `row.status` from a machine per-period status (its statuses
    // are per-PERIOD by construction), so for an ordinary CBS row `override`
    // is undefined and this falls through to the unchanged
    // `periodStatusByCode` lookup below — byte-identical, pinned by test. Two
    // things now DO set `row.status` before this point: a source whose
    // statuses really are per cell (Eurostat's JSON-stat flags, ADR 048 D6 +
    // its #251 addendum), and, since ADR 061 (Task 3a), the period-note reader
    // above for a table whose Perioden code list has no machine status at all
    // (`Phase0Table.periodNoteStatus`, e.g. 70072ned) — both supply it here
    // instead of leaving every row to fall through to the period lookup.
    const override = row.status;
    if (override !== undefined && override.trim().length === 0) {
      // Setting the field but leaving it blank is an adapter authoring bug,
      // and the one reading of it we must never take is "definitive"
      // (principle (c)). Omitting the field is the way to defer to the period.
      throw new Error(
        `adapter supplied an EMPTY per-cell status for period "${periodCode}" in table "${tableId}" — ` +
          `omit CbsObservationRow.status to fall back to the period status; never send a blank one.`,
      );
    }
    const status = override ?? periodStatusByCode.get(periodCode);
    if (status === undefined) {
      throw new Error(`internal error: period "${periodCode}" without status survived period_parsing`);
    }

    staged.push({
      measure,
      region_code: regionCode,
      period_code: periodCode,
      period_grain: parsedPeriod.grain,
      period_year: parsedPeriod.year,
      period_index: parsedPeriod.index,
      dims: sortedDims(dims),
      value: row.value,
      unit: unitMeta.unit,
      decimals: unitMeta.decimals,
      status,
      value_attribute: row.valueAttribute,
    });
  }
  return staged;
}

/**
 * Creates the transaction-scoped `sync_staging` temp table and loads the
 * staged rows into it in CHUNK_SIZE batches. Shared by syncTable and
 * fetchSlice (extracted verbatim from syncTable). Must run inside a
 * transaction (`on commit drop`).
 */
export async function stageRows(tx: Db, staged: StagedRow[]): Promise<void> {
  await tx.query(`
    create temp table sync_staging (
      measure text,
      region_code text,
      period_code text,
      period_grain text,
      period_year integer,
      period_index integer,
      dims jsonb,
      value numeric,
      unit text,
      decimals integer,
      status text,
      value_attribute text
    ) on commit drop
  `);

  for (let i = 0; i < staged.length; i += CHUNK_SIZE) {
    const chunk = staged.slice(i, i + CHUNK_SIZE);
    await tx.query(
      `insert into sync_staging
         (measure, region_code, period_code, period_grain, period_year, period_index,
          dims, value, unit, decimals, status, value_attribute)
       select measure, region_code, period_code, period_grain, period_year, period_index,
              dims, value, unit, decimals, status, value_attribute
       from jsonb_to_recordset($1::jsonb) as x(
         measure text, region_code text, period_code text, period_grain text,
         period_year integer, period_index integer, dims jsonb, value numeric,
         unit text, decimals integer, status text, value_attribute text
       )`,
      [JSON.stringify(chunk)],
    );
  }
}

/**
 * Natural-key diff of `sync_staging` against the stored observations: every
 * cell whose value changed, named exactly (docs/05 silent-retroactive-
 * corrections log). Shared by syncTable and fetchSlice (extracted verbatim).
 */
export async function diffCorrections(tx: Db, tableId: string): Promise<Correction[]> {
  const correctionRows = await tx.query(`
    select
      s.measure, s.region_code, s.period_code, s.dims,
      o.value as old_value, s.value as new_value,
      o.status as old_status, s.status as new_status
    from sync_staging s
    join observations o
      on o.table_id = $1
     and o.measure = s.measure
     and o.period_code = s.period_code
     and o.region_code = s.region_code
     and o.dims = s.dims
    where o.value is distinct from s.value
  `, [tableId]);

  return correctionRows.rows.map((r) => ({
    measure: r.measure as string,
    region_code: r.region_code as string,
    period_code: r.period_code as string,
    dims: (typeof r.dims === 'string' ? JSON.parse(r.dims) : r.dims) as Record<string, string>,
    old_value: r.old_value == null ? null : String(r.old_value),
    new_value: r.new_value == null ? null : String(r.new_value),
    old_status: r.old_status as string,
    new_status: r.new_status as string,
  }));
}

/** fetchSlice's scope for markUnseenCellsRetained: only cells whose
 * coordinates lie inside the requested slice are candidates. */
export interface RetainedMarkScope {
  measures: string[];
  periods: string[];
  /** Allowed region codes (the GeoDimension's members), or null when the
   * table has no GeoDimension (region_code is then '' on every cell). */
  regionCodes: string[] | null;
  /** Every other requested dimension → allowed codes, matched on dims->>dim. */
  dimsIn: Record<string, string[]>;
}

/**
 * #154: marks cells of this table that are absent from `sync_staging` as
 * retained — `last_seen_batch_id` = the provable prior batch that last
 * confirmed them, or (null prior, syncTable's transition fallback) the
 * cell's own `batch_id`. Only where still NULL, so repeated absence never
 * creeps the date forward; the observations upsert clears it again when the
 * cell reappears. Extracted verbatim from syncTable (no scope: every cell of
 * the table is a candidate); fetchSlice passes a `scope` so only cells inside
 * the re-fetched request are candidates. Must run inside the transaction that
 * staged the rows, before upsertStagedObservations.
 */
export async function markUnseenCellsRetained(
  tx: Db,
  tableId: string,
  provablePriorId: number | null,
  scope?: RetainedMarkScope,
): Promise<void> {
  const markValueSql = provablePriorId !== null ? '$2::bigint' : 'o.batch_id';
  const markParams: unknown[] = provablePriorId !== null ? [tableId, provablePriorId] : [tableId];
  let scopeSql = '';
  if (scope) {
    const p = (value: unknown) => {
      markParams.push(value);
      return `$${markParams.length}`;
    };
    scopeSql = `
      and o.measure = any(${p(scope.measures)}::text[])
      and o.period_code = any(${p(scope.periods)}::text[])
      and (${p(scope.regionCodes)}::text[] is null or o.region_code = any($${markParams.length}::text[]))
      and not exists (
        select 1 from jsonb_each(${p(JSON.stringify(scope.dimsIn))}::jsonb) f
        where not coalesce(jsonb_exists(f.value, o.dims ->> f.key), false)
      )`;
  }
  await tx.query(
    `update observations o
        set last_seen_batch_id = ${markValueSql}
      where o.table_id = $1
        and o.last_seen_batch_id is null
        and not exists (
          select 1 from sync_staging s
          where s.measure = o.measure
            and s.period_code = o.period_code
            and s.region_code = o.region_code
            and s.dims = o.dims
        )${scopeSql}`,
    markParams,
  );
}

/**
 * Upserts `sync_staging` into `observations` on the natural key (table_id,
 * measure, period_code, region_code, dims), skipping unchanged cells.
 * Shared by syncTable and fetchSlice (extracted verbatim from syncTable).
 */
export async function upsertStagedObservations(
  tx: Db,
  tableId: string,
  batchId: number,
): Promise<{ rowsInserted: number; rowsUpdated: number }> {
  const upsertResult = await tx.query(`
    insert into observations
      (table_id, measure, region_code, period_code, period_grain, period_year,
       period_index, dims, value, unit, decimals, status, value_attribute, batch_id)
    select $1::text, s.measure, s.region_code, s.period_code, s.period_grain, s.period_year,
           s.period_index, s.dims, s.value, s.unit, s.decimals, s.status, s.value_attribute, $2::bigint
    from sync_staging s
    on conflict (table_id, measure, period_code, region_code, dims)
    do update set
      value = excluded.value,
      status = excluded.status,
      value_attribute = excluded.value_attribute,
      unit = excluded.unit,
      decimals = excluded.decimals,
      batch_id = excluded.batch_id,
      -- #154: a re-published cell is confirmed again — clear the
      -- retained marker. The OR-term below lets an identical-value
      -- reappearance through the unchanged-row guard for exactly this
      -- reset (write cost stays proportional to anomalies, design §2).
      last_seen_batch_id = null
    where (observations.value, observations.status, observations.value_attribute)
      is distinct from (excluded.value, excluded.status, excluded.value_attribute)
       or observations.last_seen_batch_id is not null
    returning (xmax = 0) as inserted
  `, [tableId, batchId]);

  let rowsInserted = 0;
  let rowsUpdated = 0;
  for (const r of upsertResult.rows) {
    if (r.inserted) rowsInserted++;
    else rowsUpdated++;
  }
  return { rowsInserted, rowsUpdated };
}

export const syncTable: SyncTableFn = async (db, source, tableId, options = {}) => {
  const registryResult = await db.query('select * from cbs_tables where id = $1', [tableId]);
  if (registryResult.rows.length === 0) {
    throw new Error(`syncTable: table "${tableId}" is not registered. Call registerTables first.`);
  }
  const registry = parseRegistryRow(registryResult.rows[0]!);

  // Breadth step 2: a slice-cache table (migration 037's ingest_mode; the
  // column is simply absent on a database without 037, which means 'full')
  // is filled per question by fetchSlice, never by a whole-table sync. Refuse
  // before fetching anything (and before the quarantine check, so a
  // quarantined slice-cache table is never pointed at --rebaseline),
  // recorded on a batch, without quarantining.
  if (registryResult.rows[0]!.ingest_mode === 'slice_cache') {
    const summary =
      `Table "${tableId}" is a slice-cache table — use fetchSlice, never a whole-table sync. ` +
      `Nothing was fetched and the table is unchanged.`;
    const refused = await db.query(
      `insert into ingestion_batches (table_id, outcome, finished_at, failure_stage, failure_summary)
       values ($1, 'failed', now(), 'ingest_mode', $2) returning id`,
      [tableId, summary],
    );
    return {
      tableId,
      batchId: Number(refused.rows[0]!.id),
      outcome: 'failed',
      failureStage: 'ingest_mode',
      failureSummary: summary,
      rowCount: 0,
      rowsInserted: 0,
      rowsUpdated: 0,
      rowsUnchanged: 0,
      rowsMissing: 0,
      corrections: [],
      rebaselined: false,
    };
  }

  if (registry.status === 'needs_review' && !options.rebaseline) {
    throw new Error(
      `Table "${tableId}" is quarantined (needs_review): ${
        registryResult.rows[0]!.needs_review_reason ?? 'reason not recorded'
      }. Review the cause, then re-run with --rebaseline to re-baseline and sync.`,
    );
  }

  // Recorded outside any transaction so the batch survives a failed sync.
  const batchInsert = await db.query(
    `insert into ingestion_batches (table_id, outcome) values ($1, 'running') returning id`,
    [tableId],
  );
  const batchId = Number(batchInsert.rows[0]!.id);

  // Fetch/parse errors: transient infrastructure, data not suspect — the
  // table is NOT quarantined, but the batch is loudly recorded as failed.
  let schema: Awaited<ReturnType<CbsSource['fetchTableSchema']>>;
  let codeLists: Record<string, CbsCode[]>;
  let observationRows: CbsObservationRow[];
  try {
    // E2a step-5 fix (2026-09-23): the SAME `registry.slice` already used
    // for `fetchAllObservations` below now also reaches the schema/
    // code-list read — every ordinary sync (not just the one-time
    // registration above) re-fetches schema/code-lists, so leaving this
    // call unsliced would still hit the cap on every later sync of a
    // registered Eurostat table, even after registerTables itself was
    // fixed. CBS callers pass the exact same value they always registered
    // with; CBS's own adapters ignore it — byte-identical.
    const sliceForFetch = registry.slice ?? undefined;
    schema = await source.fetchTableSchema(tableId, sliceForFetch);
    codeLists = await fetchAllCodeLists(source, tableId, schema.dimensions, sliceForFetch);
    observationRows = await fetchAllObservations(
      source,
      tableId,
      sliceForFetch,
      schema.dimensions.map((d) => d.name),
    );
  } catch (err) {
    const summary = `Fetching table "${tableId}" from CBS failed: ${err instanceof Error ? err.message : String(err)}.`;
    await failBatch(db, batchId, tableId, 'fetch', summary, null, null, false);
    return {
      tableId,
      batchId,
      outcome: 'failed',
      failureStage: 'fetch',
      failureSummary: summary,
      rowCount: 0,
      rowsInserted: 0,
      rowsUpdated: 0,
      rowsUnchanged: 0,
      rowsMissing: 0,
      corrections: [],
      rebaselined: false,
    };
  }

  // #167: curated phantom-measure exclusion (session 50). CBS metadata can
  // list measures that carry ZERO observations table-wide (85880NED: 17 of
  // 210) — those entries would trip the per-measure plausibility check and
  // unit consistency on a fully healthy ingest. A seed's excludeMeasures
  // (measured + documented per code) is treated as not-published throughout
  // the sync: dropped from the served measure set, and any fetched row for
  // them discarded. The schema FINGERPRINT below deliberately stays
  // UNFILTERED, so a CBS change to the phantom set still fails the drift
  // check loudly and forces a re-measure.
  const excludedMeasures = new Set(SEED_TABLES.find((t) => t.id === tableId)?.excludeMeasures ?? []);
  // ADR 061: the measure allow-list (registry.slice.measures) scopes the
  // served set, the rows and — below — the schema fingerprint.
  const allowList = allowListedMeasures(registry.slice);
  const isServed = (code: string) => !excludedMeasures.has(code) && (allowList === null || allowList.has(code));
  const servedMeasures =
    excludedMeasures.size === 0 && allowList === null ? schema.measures : schema.measures.filter((m) => isServed(m.code));
  if (excludedMeasures.size > 0 || allowList !== null) {
    observationRows = observationRows.filter((row) => isServed(row.measure));
  }

  const periodDim = findDimension(schema.dimensions, 'TimeDimension');

  let rebaselined = false;
  let expectedDimensions = registry.expected_dimensions;
  let registryUnits = registry.units;
  let schemaFingerprintToCompare = registry.schema_fingerprint;
  let rowCountTolerance = registry.row_count_tolerance;

  if (options.rebaseline) {
    // Baselines-in-waiting only: the five checks below run against these, but
    // nothing is persisted until they all pass (inside the success
    // transaction). A rebaseline sync that fails a later check must leave the
    // registry baseline exactly as it was — otherwise the loud failure would
    // hide a silent registry swap.
    expectedDimensions = [...schema.dimensions]
      .map((d) => ({ name: d.name, kind: d.kind }))
      .sort((a, b) => a.name.localeCompare(b.name));
    registryUnits = unitsFromMeasures(servedMeasures);
    schemaFingerprintToCompare = null; // fresh baseline: nothing to compare yet
    rebaselined = true;
  }

  // The fingerprint covers every code CBS lists (so phantom-set drift still
  // fails loudly, #167) — EXCEPT on an allow-listed table, where it covers
  // exactly the listed codes: CBS revising one of the other codes of a wide
  // table is not a change to anything we serve.
  const fingerprintMeasureCodes = (
    allowList === null ? schema.measures : schema.measures.filter((m) => allowList.has(m.code))
  ).map((m) => m.code);
  const fingerprint = computeFingerprint(schema.dimensions, fingerprintMeasureCodes);

  const missingListed = missingAllowListedCodes(registry.slice, schema.measures.map((m) => m.code));
  if (missingListed.length > 0) {
    const summary =
      `CBS no longer lists measure code(s) ${missingListed.join(', ')}, which this table's allow-list serves. ` +
      `This is a schema change on a figure we publish; the table is quarantined until it is re-curated.`;
    await failBatch(db, batchId, tableId, 'schema_fingerprint', summary, observationRows.length, fingerprint, true);
    return {
      tableId,
      batchId,
      outcome: 'failed',
      failureStage: 'schema_fingerprint',
      failureSummary: summary,
      rowCount: observationRows.length,
      rowsInserted: 0,
      rowsUpdated: 0,
      rowsUnchanged: 0,
      rowsMissing: 0,
      corrections: [],
      rebaselined,
    };
  }

  // --- Run the five ordered checks. First failure -> loud, no writes. -----

  const stage1 = checkSchemaFingerprint(
    schema.dimensions,
    fingerprintMeasureCodes,
    expectedDimensions,
    schemaFingerprintToCompare,
  );
  if (!stage1.ok) {
    await failBatch(db, batchId, tableId, stage1.stage, stage1.summary, observationRows.length, fingerprint, true);
    return {
      tableId,
      batchId,
      outcome: 'failed',
      failureStage: stage1.stage,
      failureSummary: stage1.summary,
      rowCount: observationRows.length,
      rowsInserted: 0,
      rowsUpdated: 0,
      rowsUnchanged: 0,
      rowsMissing: 0,
      corrections: [],
      rebaselined,
    };
  }

  const stage2 = checkRowPlausibility(observationRows, registryUnits, registry.last_row_count, rowCountTolerance);
  if (!stage2.ok) {
    await failBatch(db, batchId, tableId, stage2.stage, stage2.summary, observationRows.length, fingerprint, true);
    return {
      tableId,
      batchId,
      outcome: 'failed',
      failureStage: stage2.stage,
      failureSummary: stage2.summary,
      rowCount: observationRows.length,
      rowsInserted: 0,
      rowsUpdated: 0,
      rowsUnchanged: 0,
      rowsMissing: 0,
      corrections: [],
      rebaselined,
    };
  }

  // Task 3a: a table whose Perioden statuses are stated in PROSE rather than
  // a machine `Status` field (70072ned is the first, Task 3) gets its
  // per-cell status derived here — BEFORE stage 3 (checkPeriodParsing) reads
  // it via the #251 hook (`CbsObservationRow.status`). Tables without this
  // config are untouched: byte-identical, no row gets `status`.
  const periodNoteConfig = SEED_TABLES.find((t) => t.id === tableId)?.periodNoteStatus;
  if (periodNoteConfig) {
    // Final-review fix (ADR 061): the periodNoteStatus map above was reviewed
    // against the SEED's OWN measure allow-list (Phase0Table.slice.measures) —
    // not against whatever slice this table happens to be registered with
    // right now. A re-registration with a wider or merely different slice
    // could silently store an unreviewed figure as Definitief. Refuse before
    // ANY row gets a status unless the registered slice serves EXACTLY the
    // seed's set (principle (c): never guess).
    const seedEntry = SEED_TABLES.find((t) => t.id === tableId);
    const seedMeasures = new Set(seedEntry?.slice?.measures ?? []);
    const registryMeasures = new Set(registry.slice?.measures ?? []);
    const slicesMatch =
      seedMeasures.size === registryMeasures.size && [...seedMeasures].every((m) => registryMeasures.has(m));
    if (!slicesMatch) {
      const missingFromRegistration = [...seedMeasures].filter((m) => !registryMeasures.has(m)).slice(0, 10);
      const extraInRegistration = [...registryMeasures].filter((m) => !seedMeasures.has(m)).slice(0, 10);
      const differences = [
        missingFromRegistration.length > 0
          ? `missing from the registered slice: ${missingFromRegistration.join(', ')}`
          : null,
        extraInRegistration.length > 0 ? `extra in the registered slice: ${extraInRegistration.join(', ')}` : null,
      ].filter((s): s is string => s !== null);
      const summary =
        `This table's period-note status map was reviewed for the seed's measure allow-list ` +
        `(${seedMeasures.size} codes), but the registered slice serves a different set ` +
        `(${differences.join('; ')}). Refusing, because an unreviewed figure could be stored as final. ` +
        `Re-register the table with the seed's slice.`;
      await failBatch(db, batchId, tableId, 'period_parsing', summary, observationRows.length, fingerprint, true);
      return {
        tableId,
        batchId,
        outcome: 'failed',
        failureStage: 'period_parsing',
        failureSummary: summary,
        rowCount: observationRows.length,
        rowsInserted: 0,
        rowsUpdated: 0,
        rowsUnchanged: 0,
        rowsMissing: 0,
        corrections: [],
        rebaselined,
      };
    }

    const periodDimName = periodDim?.name ?? 'Perioden';

    // CBS's own caveat, which this reader deliberately does NOT parse: a
    // TOPIC note (a served measure's own Description) can also mark a
    // measure provisional, separately from the PERIOD note above. Refusing
    // rather than risking a Definitief mislabel (principle (c)).
    const topicNoted = servedMeasures.find((m) => m.description.toLowerCase().includes('voorlopig'));
    if (topicNoted) {
      const summary =
        `Measure "${topicNoted.code}"'s CBS description mentions "voorlopig" — a TOPIC note can also mark a ` +
        `measure provisional, and this reader only reads PERIOD notes; refusing rather than mislabeling it Definitief.`;
      await failBatch(db, batchId, tableId, 'period_parsing', summary, observationRows.length, fingerprint, true);
      return {
        tableId,
        batchId,
        outcome: 'failed',
        failureStage: 'period_parsing',
        failureSummary: summary,
        rowCount: observationRows.length,
        rowsInserted: 0,
        rowsUpdated: 0,
        rowsUnchanged: 0,
        rowsMissing: 0,
        corrections: [],
        rebaselined,
      };
    }

    const notes = parsePeriodNotes(
      codeLists[periodDimName] ?? [],
      periodNoteConfig,
      servedMeasures.map((m) => m.code),
    );
    if (!notes.ok) {
      await failBatch(db, batchId, tableId, 'period_parsing', notes.summary, observationRows.length, fingerprint, true);
      return {
        tableId,
        batchId,
        outcome: 'failed',
        failureStage: 'period_parsing',
        failureSummary: notes.summary,
        rowCount: observationRows.length,
        rowsInserted: 0,
        rowsUpdated: 0,
        rowsUnchanged: 0,
        rowsMissing: 0,
        corrections: [],
        rebaselined,
      };
    }
    for (const obsRow of observationRows) {
      obsRow.status = notes.statusOf(obsRow.coordinates[periodDimName] ?? '', obsRow.measure);
    }
  }

  const stage3 = checkPeriodParsing(
    observationRows,
    periodDim?.name ?? 'Perioden',
    codeLists[periodDim?.name ?? 'Perioden'] ?? [],
  );
  if (!stage3.ok) {
    await failBatch(db, batchId, tableId, stage3.stage, stage3.summary, observationRows.length, fingerprint, true);
    return {
      tableId,
      batchId,
      outcome: 'failed',
      failureStage: stage3.stage,
      failureSummary: stage3.summary,
      rowCount: observationRows.length,
      rowsInserted: 0,
      rowsUpdated: 0,
      rowsUnchanged: 0,
      rowsMissing: 0,
      corrections: [],
      rebaselined,
    };
  }

  // Under rebaseline the fetched code lists ARE the (unpersisted) new
  // baseline, so mapping validates against those instead of the old labels.
  let storedLabels: StoredLabel[];
  if (rebaselined) {
    storedLabels = Object.entries(codeLists).flatMap(([dimension, codes]) =>
      codes.map((c) => ({ dimension, code: c.code })),
    );
  } else {
    const storedLabelsResult = await db.query(
      'select dimension, code from dimension_labels where table_id = $1',
      [tableId],
    );
    storedLabels = storedLabelsResult.rows.map((r) => ({
      dimension: r.dimension as string,
      code: r.code as string,
    }));
  }

  const stage4 = checkDimensionMapping(
    observationRows,
    schema.dimensions,
    registryUnits,
    storedLabels,
    codeLists,
    options.acceptNewCodes ?? false,
  );
  if (!stage4.ok) {
    await failBatch(db, batchId, tableId, stage4.stage, stage4.summary, observationRows.length, fingerprint, true);
    return {
      tableId,
      batchId,
      outcome: 'failed',
      failureStage: stage4.stage,
      failureSummary: stage4.summary,
      rowCount: observationRows.length,
      rowsInserted: 0,
      rowsUpdated: 0,
      rowsUnchanged: 0,
      rowsMissing: 0,
      corrections: [],
      rebaselined,
    };
  }

  const stage5 = checkUnitConsistency(servedMeasures, registryUnits);
  if (!stage5.ok) {
    await failBatch(db, batchId, tableId, stage5.stage, stage5.summary, observationRows.length, fingerprint, true);
    return {
      tableId,
      batchId,
      outcome: 'failed',
      failureStage: stage5.stage,
      failureSummary: stage5.summary,
      rowCount: observationRows.length,
      rowsInserted: 0,
      rowsUpdated: 0,
      rowsUnchanged: 0,
      rowsMissing: 0,
      corrections: [],
      rebaselined,
    };
  }

  // --- All checks passed: build staged rows and write inside a transaction. --

  const periodStatusByCode = new Map<string, string>();
  for (const code of codeLists[periodDim?.name ?? 'Perioden'] ?? []) {
    if (code.status != null) periodStatusByCode.set(code.code, code.status);
  }

  const staged = buildStagedRows(observationRows, schema.dimensions, registryUnits, periodStatusByCode, tableId);

  const newCodesAccepted = new Map<string, string[]>();
  if (options.acceptNewCodes) {
    const storedByDim = new Map<string, Set<string>>();
    for (const label of storedLabels) {
      let set = storedByDim.get(label.dimension);
      if (!set) {
        set = new Set();
        storedByDim.set(label.dimension, set);
      }
      set.add(label.code);
    }
    for (const dim of schema.dimensions) {
      const known = storedByDim.get(dim.name) ?? new Set<string>();
      const fetched = codeLists[dim.name] ?? [];
      const newOnes = fetched.filter((c) => !known.has(c.code));
      if (newOnes.length > 0) newCodesAccepted.set(dim.name, newOnes.map((c) => c.code));
    }
  }

  // #34(c): the rebaseline branch inside this transaction can abort via
  // RebaselineAbortError. withTransaction rolls the writes back on rejection,
  // and the instanceof branch below turns exactly that error into a loudly
  // recorded failed batch — never a batch left stuck at 'running', never a
  // silent overwrite. Any other rejection is a real infrastructure error and
  // propagates unchanged (SyncTableFn's documented contract).
  const syncWrites = await db
    .withTransaction(async (tx) => {
      if (rebaselined) {
        // #34(c): serializes concurrent REBASELINES of the same table — the
        // on-demand onboarding cron and a manual CLI resync now share this
        // entry point with no other protection, and this delete-then-
        // reinsert is the one write in this transaction with no
        // on-conflict guard (every other write here — the observations
        // upsert, acceptNewCodes' inserts — already has a real unique
        // constraint or ON CONFLICT behind it). Scoped to just this branch,
        // not the whole transaction: an ordinary (non-rebaseline) sync never
        // touches this unguarded write, so it never needs to wait on it.
        // Transaction-scoped (released automatically on commit/rollback) —
        // doesn't touch the ingestion_batches row inserted further up,
        // which is deliberately its own separate statement outside any
        // transaction (survives a failed sync).
        //
        // Bounded, not the query's default unbounded wait: this pool sets
        // no lock_timeout anywhere else (src/db/client.ts), and the
        // onboarding cron's Vercel function has a 300s ceiling — an
        // unbounded wait here could tie up a pooled connection past that
        // ceiling and turn a clean, catchable failure into a killed
        // function and a batch row stuck 'running'. 180s leaves headroom
        // under the 300s ceiling for the validation work that already ran
        // before this point. This 180s bound is about how long THIS
        // acquisition waits to succeed — it says nothing about how long a
        // DIFFERENT caller waiting on the SAME key, once this one succeeds,
        // then waits for this transaction to commit or roll back.
        //
        // #196 (session 76, PR #128 round 2): this key (hashtext(tableId))
        // is also taken EXCLUSIVE by evictStaleTables (src/ingestion/
        // eviction.ts) and SHARED by resolveIntent's read arc
        // (src/query/resolve.ts) — a live read for this exact table now
        // waits, unbounded, behind a `--rebaseline` in progress, same as it
        // already does behind an eviction in progress. Analyzed and accepted
        // there (src/query/resolve.ts's comment at its own lock
        // acquisition): both EXCLUSIVE acquirers of this key are manual,
        // operator-initiated, never cron-driven (confirmed: this branch only
        // runs when `--rebaseline` is passed, and only src/ingestion/cli.ts
        // ever passes it — the onboarding cron's own syncTable call,
        // src/ingestion/onboarding.ts:202, passes no options).
        await tx.query("set local lock_timeout = '180s'");
        await tx.query('select pg_advisory_xact_lock(hashtext($1))', [tableId]);

        // #34(c)(i)+(ii): everything above was validated against registry
        // state read BEFORE this lock existed (the plain db.query reads at
        // the top of syncTable) — a concurrent writer can have committed
        // between those reads and this point. Re-read the registry row
        // fresh, inside the transaction and under the lock. FOR UPDATE takes
        // the cbs_tables row lock now rather than at this branch's update
        // just below (same acquisition order as before, no new deadlock
        // shape), so the row also cannot move between this re-read and
        // commit.
        const freshRows = await tx.query(
          `select version, last_row_count, row_count_tolerance
             from cbs_tables where id = $1 for update`,
          [tableId],
        );
        const fresh = freshRows.rows[0];
        if (!fresh) {
          // The table was registered when this sync started; only a
          // concurrent hard delete could get here. Abort loudly.
          throw new RebaselineAbortError(
            'rebaseline_conflict',
            `Rebaseline of "${tableId}" aborted: the registry row disappeared while this sync was validating.`,
            false,
          );
        }

        // (c)(ii): the version bump below carries no optimistic-concurrency
        // guard, so without this check the second of two concurrent
        // rebaselines would silently commit its own (stale-validated)
        // baseline over the first's fresher one — both reporting
        // 'succeeded'. If the version moved since the pre-lock read, this
        // sync validated against a superseded baseline: abort and leave the
        // winner's baseline untouched. Deliberately NOT a quarantine — the
        // registry now holds the concurrent winner's freshly validated
        // baseline, not suspect data.
        const freshVersion = Number(fresh.version);
        if (freshVersion !== registry.version) {
          throw new RebaselineAbortError(
            'rebaseline_conflict',
            `Rebaseline of "${tableId}" aborted: the registry baseline was modified concurrently ` +
              `(version ${registry.version} -> ${freshVersion}) after this sync validated against it — ` +
              `most likely another rebaseline committed first. Nothing was overwritten; ` +
              `re-run the rebaseline if it is still needed.`,
            false,
          );
        }

        // (c)(i): of the five ordered checks, row plausibility (stage 2) is
        // the only one whose rebaseline-path inputs come from the registry
        // rather than from this sync's own fetched data (last_row_count +
        // row_count_tolerance; stages 1, 3, 4 and 5 validate the fetched
        // schema/codes/units against themselves when rebaselining). Re-run
        // it against the just-read values, so a row count committed by a
        // concurrent ordinary sync (which bumps no version) cannot be
        // bypassed on the strength of this sync's stale pre-lock read.
        // Failing here means exactly what a pre-transaction stage-2 failure
        // means, so it quarantines the same way.
        const freshLastRowCount = fresh.last_row_count == null ? null : Number(fresh.last_row_count);
        const freshTolerance = Number(fresh.row_count_tolerance);
        const recheck = checkRowPlausibility(
          observationRows,
          registryUnits,
          freshLastRowCount,
          freshTolerance,
        );
        if (!recheck.ok) {
          throw new RebaselineAbortError(
            recheck.stage,
            `${recheck.summary} (Caught by the post-lock re-validation: the registry row changed ` +
              `while this rebaseline was validating.)`,
            true,
          );
        }

        // Reviewed re-baseline persists only now, after all five checks
        // passed — atomically with the data it validated.
        await tx.query(
          `update cbs_tables
             set expected_dimensions = $2, units = $3, schema_fingerprint = $4,
                 version = version + 1, status = 'active', needs_review_reason = null,
                 updated_at = now()
           where id = $1`,
          [tableId, JSON.stringify(expectedDimensions), JSON.stringify(registryUnits), fingerprint],
        );
        await tx.query('delete from dimension_labels where table_id = $1', [tableId]);
        // #34(b): batched full-set rewrite. Deliberately no on-conflict
        // clause, exactly like the per-row loop it replaces — see
        // insertDimensionLabels.
        await insertDimensionLabels(
          tx,
          tableId,
          labelRowsFromCodeLists(schema.dimensions, codeLists),
          'none',
        );
      }

      await stageRows(tx, staged);

      // Natural-key diff against existing observations: value changes are
      // silent-retroactive-corrections, named exactly (docs/05).
      const corrections = await diffCorrections(tx, tableId);

      const missingRows = await tx.query(`
        select count(*)::int as count
        from observations o
        where o.table_id = $1
          and not exists (
            select 1 from sync_staging s
            where s.measure = o.measure
              and s.period_code = o.period_code
              and s.region_code = o.region_code
              and s.dims = o.dims
          )
      `, [tableId]);
      const rowsMissing = Number(missingRows.rows[0]!.count);

      // #154: mark newly-retained cells with the last batch that provably
      // confirmed them — only where still NULL (repeated absence must never
      // creep the date forward). The provable prior is the previous
      // SUCCEEDED batch for this table, but only if that batch ran after
      // migration 021 was applied (the NULL-means-present invariant holds
      // from then on); otherwise fall back to the cell's OWN batch_id (its
      // last change — a true lower bound: "gesynchroniseerd op" may
      // understate, never overstate). One transition-window approximation,
      // explicit and conservative (design §2).
      if (rowsMissing > 0) {
        const priorBatch = await tx.query(
          `select b.id
             from ingestion_batches b
            where b.table_id = $1
              and b.outcome = 'succeeded'
              and b.finished_at > (select applied_at from schema_migrations where version = 21)
            order by b.id desc
            limit 1`,
          [tableId],
        );
        const provablePriorId = priorBatch.rows.length > 0 ? (priorBatch.rows[0]!.id as number) : null;
        await markUnseenCellsRetained(tx, tableId, provablePriorId);
      }

      const { rowsInserted, rowsUpdated } = await upsertStagedObservations(tx, tableId, batchId);
      const rowsUnchanged = staged.length - rowsInserted - rowsUpdated;

      // Update Perioden label statuses to the fetched statuses.
      for (const [code, status] of periodStatusByCode) {
        await tx.query(
          `update dimension_labels set status = $4
           where table_id = $1 and dimension = $2 and code = $3`,
          [tableId, periodDim?.name ?? 'Perioden', code, status],
        );
      }

      // Reviewed acceptance of new codes: insert as labels.
      if (options.acceptNewCodes) {
        const acceptedRows: LabelRow[] = [];
        for (const [dim, codes] of newCodesAccepted) {
          const fetched = codeLists[dim] ?? [];
          const byCode = new Map(fetched.map((c) => [c.code, c]));
          for (const code of codes) {
            const c = byCode.get(code)!;
            acceptedRows.push({
              dimension: dim,
              code: c.code,
              label: c.title,
              dimension_group: c.dimensionGroup,
              status: c.status,
              sort_index: c.index,
            });
          }
        }
        // #34(b): batched, preserving this site's on-conflict-do-nothing.
        await insertDimensionLabels(tx, tableId, acceptedRows, 'ignore');
      }

      await tx.query(
        `update cbs_tables
           set last_sync_at = now(),
               last_row_count = $2,
               schema_fingerprint = coalesce(schema_fingerprint, $3),
               updated_at = now()
         where id = $1`,
        [tableId, staged.length, fingerprint],
      );

      return { corrections, rowsInserted, rowsUpdated, rowsUnchanged, rowsMissing };
    })
    .catch((err: unknown) => {
      if (err instanceof RebaselineAbortError) return err;
      throw err;
    });

  if (syncWrites instanceof RebaselineAbortError) {
    await failBatch(
      db,
      batchId,
      tableId,
      syncWrites.stage,
      syncWrites.failureSummary,
      observationRows.length,
      fingerprint,
      syncWrites.quarantine,
    );
    return {
      tableId,
      batchId,
      outcome: 'failed',
      failureStage: syncWrites.stage,
      failureSummary: syncWrites.failureSummary,
      rowCount: observationRows.length,
      rowsInserted: 0,
      rowsUpdated: 0,
      rowsUnchanged: 0,
      rowsMissing: 0,
      corrections: [],
      rebaselined,
    };
  }
  const { corrections, rowsInserted, rowsUpdated, rowsUnchanged, rowsMissing } = syncWrites;

  await db.query(
    `update ingestion_batches
       set outcome = 'succeeded', finished_at = now(),
           row_count = $2, rows_inserted = $3, rows_updated = $4, rows_unchanged = $5,
           rows_missing = $6, corrections = $7, fingerprint = $8, rebaselined = $9
     where id = $1`,
    [
      batchId,
      staged.length,
      rowsInserted,
      rowsUpdated,
      rowsUnchanged,
      rowsMissing,
      JSON.stringify(corrections),
      fingerprint,
      rebaselined,
    ],
  );

  return {
    tableId,
    batchId,
    outcome: 'succeeded',
    rowCount: staged.length,
    rowsInserted,
    rowsUpdated,
    rowsUnchanged,
    rowsMissing,
    corrections,
    rebaselined,
  };
};

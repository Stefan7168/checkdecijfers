// registerTables + syncTable — the core ingestion pipeline (docs/05-data-rules.md,
// "Data access strategy" + "Validation pipeline"; docs/07-phase0-table-set.md,
// slices and catalog quirks).
import type { CbsCode, CbsDimension, CbsMeasure, CbsObservationRow, CbsSource } from '../cbs-adapter/types.ts';
import type { Db } from '../db/types.ts';
import { computeFingerprint } from './fingerprint.ts';
import { parsePeriodCode } from './periods.ts';
import type { Phase0Table } from './registry-seed.ts';
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

async function fetchAllCodeLists(
  source: CbsSource,
  tableId: string,
  dimensions: CbsDimension[],
): Promise<Record<string, CbsCode[]>> {
  const result: Record<string, CbsCode[]> = {};
  for (const dim of dimensions) {
    result[dim.name] = await source.fetchCodeList(tableId, dim.name);
  }
  return result;
}

async function fetchAllObservations(
  source: CbsSource,
  tableId: string,
  slice: Phase0Table['slice'],
): Promise<CbsObservationRow[]> {
  const rows: CbsObservationRow[] = [];
  for await (const page of source.fetchObservations(tableId, slice)) {
    rows.push(...page);
  }
  return rows;
}

function unitsFromMeasures(measures: CbsMeasure[]): RegistryUnits {
  const units: RegistryUnits = {};
  for (const m of measures) {
    units[m.code] = { unit: m.unit, decimals: m.decimals, title: m.title };
  }
  return units;
}

// ---------------------------------------------------------------------------
// registerTables
// ---------------------------------------------------------------------------

export const registerTables: RegisterTablesFn = async (db, source, tables) => {
  const existingRows = await db.query('select id from cbs_tables');
  const existingIds = new Set(existingRows.rows.map((r) => r.id as string));

  const newlyRegistered: string[] = [];

  for (const table of tables) {
    if (existingIds.has(table.id)) continue;

    const schema = await source.fetchTableSchema(table.id);
    const codeLists = await fetchAllCodeLists(source, table.id, schema.dimensions);

    const expectedDimensions = [...schema.dimensions]
      .map((d) => ({ name: d.name, kind: d.kind }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const units = unitsFromMeasures(schema.measures);

    await db.withTransaction(async (tx) => {
      await tx.query(
        `insert into cbs_tables
           (id, title, expected_dimensions, slice, units, update_cadence, schema_fingerprint)
         values ($1, $2, $3, $4, $5, $6, null)`,
        [
          table.id,
          schema.title,
          JSON.stringify(expectedDimensions),
          table.slice ? JSON.stringify(table.slice) : null,
          JSON.stringify(units),
          table.updateCadence,
        ],
      );

      for (const dim of schema.dimensions) {
        const codes = codeLists[dim.name] ?? [];
        for (const code of codes) {
          await tx.query(
            `insert into dimension_labels
               (table_id, dimension, code, label, dimension_group, status, sort_index)
             values ($1, $2, $3, $4, $5, $6, $7)
             on conflict (table_id, dimension, code) do nothing`,
            [table.id, dim.name, code.code, code.title, code.dimensionGroup, code.status, code.index],
          );
        }
      }
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

interface StagedRow {
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

async function failBatch(
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

export const syncTable: SyncTableFn = async (db, source, tableId, options = {}) => {
  const registryResult = await db.query('select * from cbs_tables where id = $1', [tableId]);
  if (registryResult.rows.length === 0) {
    throw new Error(`syncTable: table "${tableId}" is not registered. Call registerTables first.`);
  }
  const registry = parseRegistryRow(registryResult.rows[0]!);

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
    schema = await source.fetchTableSchema(tableId);
    codeLists = await fetchAllCodeLists(source, tableId, schema.dimensions);
    observationRows = await fetchAllObservations(source, tableId, registry.slice ?? undefined);
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

  const periodDim = findDimension(schema.dimensions, 'TimeDimension');
  const geoDim = findDimension(schema.dimensions, 'GeoDimension');

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
    registryUnits = unitsFromMeasures(schema.measures);
    schemaFingerprintToCompare = null; // fresh baseline: nothing to compare yet
    rebaselined = true;
  }

  const fingerprint = computeFingerprint(schema.dimensions, schema.measures.map((m) => m.code));

  // --- Run the five ordered checks. First failure -> loud, no writes. -----

  const stage1 = checkSchemaFingerprint(
    schema.dimensions,
    schema.measures.map((m) => m.code),
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

  const stage5 = checkUnitConsistency(schema.measures, registryUnits);
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

  const staged: StagedRow[] = [];
  for (const row of observationRows) {
    const measure = row.measure.trim();
    const regionCode = geoDim ? (row.coordinates[geoDim.name] ?? '').trim() : '';
    const periodCode = periodDim ? row.coordinates[periodDim.name]! : '';
    const parsedPeriod = parsePeriodCode(periodCode);
    if (!parsedPeriod) {
      // Guarded by stage3 above; defensive only.
      throw new Error(`internal error: unparseable period code "${periodCode}" survived period_parsing`);
    }

    const dims: Record<string, string> = {};
    for (const dim of schema.dimensions) {
      if (dim === periodDim || dim === geoDim) continue;
      const code = row.coordinates[dim.name];
      if (code !== undefined) dims[dim.name] = code;
    }

    const unitMeta = registryUnits[measure];
    // Guarded by stage4 above; defensive only.
    if (!unitMeta) throw new Error(`internal error: unknown measure "${measure}" survived dimension_mapping`);

    // Status transitions (Voorlopig -> Definitief) are normal CBS lifecycle:
    // they update rows and are counted as rows_updated, not logged as
    // corrections (docs/05 corrections log covers *value* changes).
    // A period without a status fails at stage 3 — never defaulted here
    // (R11: status is required; principle (c): never guess).
    const status = periodStatusByCode.get(periodCode);
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

  const { corrections, rowsInserted, rowsUpdated, rowsUnchanged, rowsMissing } = await db.withTransaction(
    async (tx) => {
      if (rebaselined) {
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
        for (const dim of schema.dimensions) {
          for (const code of codeLists[dim.name] ?? []) {
            await tx.query(
              `insert into dimension_labels
                 (table_id, dimension, code, label, dimension_group, status, sort_index)
               values ($1, $2, $3, $4, $5, $6, $7)`,
              [tableId, dim.name, code.code, code.title, code.dimensionGroup, code.status, code.index],
            );
          }
        }
      }

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

      // Natural-key diff against existing observations: value changes are
      // silent-retroactive-corrections, named exactly (docs/05).
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

      const corrections: Correction[] = correctionRows.rows.map((r) => ({
        measure: r.measure as string,
        region_code: r.region_code as string,
        period_code: r.period_code as string,
        dims: (typeof r.dims === 'string' ? JSON.parse(r.dims) : r.dims) as Record<string, string>,
        old_value: r.old_value == null ? null : String(r.old_value),
        new_value: r.new_value == null ? null : String(r.new_value),
        old_status: r.old_status as string,
        new_status: r.new_status as string,
      }));

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
          batch_id = excluded.batch_id
        where (observations.value, observations.status, observations.value_attribute)
          is distinct from (excluded.value, excluded.status, excluded.value_attribute)
        returning (xmax = 0) as inserted
      `, [tableId, batchId]);

      let rowsInserted = 0;
      let rowsUpdated = 0;
      for (const r of upsertResult.rows) {
        if (r.inserted) rowsInserted++;
        else rowsUpdated++;
      }
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
        for (const [dim, codes] of newCodesAccepted) {
          const fetched = codeLists[dim] ?? [];
          const byCode = new Map(fetched.map((c) => [c.code, c]));
          for (const code of codes) {
            const c = byCode.get(code)!;
            await tx.query(
              `insert into dimension_labels
                 (table_id, dimension, code, label, dimension_group, status, sort_index)
               values ($1, $2, $3, $4, $5, $6, $7)
               on conflict (table_id, dimension, code) do nothing`,
              [tableId, dim, c.code, c.title, c.dimensionGroup, c.status, c.index],
            );
          }
        }
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
    },
  );

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

// Slice-cache registration (breadth step 2, spec
// 2026-09-28-breadth-any-cbs-table-design.md D4; migration 037,
// docs/decisions/061 for the period-note prose-reader boundary this module
// deliberately does NOT cross). registerSchemaOnly registers a CBS table's
// LAYOUT ONLY — metadata, code lists, numeric-measure units, schema
// fingerprint — with zero observation rows. Task 4 (fetchSlice, same file)
// adds the on-demand cell fetch on top of a schema-only registration; this
// task is schema only.
//
// Every write here reuses registerTables'/syncTable's own helpers
// (src/ingestion/pipeline.ts) — never a second copy of the fingerprint,
// dimension_labels batching, or source-key derivation.
import type { CbsCode, CbsSource } from '../cbs-adapter/types.ts';
import type { Db } from '../db/types.ts';
import { computeFingerprint } from './fingerprint.ts';
import {
  fetchAllCodeLists,
  insertDimensionLabels,
  labelRowsFromCodeLists,
  unitsFromMeasures,
} from './pipeline.ts';
import { sourceKeyForTableId } from '../sources/registry.ts';

export type SchemaOnlyResult =
  | { ok: true; tableId: string; numericMeasures: string[]; alreadyRegistered: boolean }
  | {
      ok: false;
      reason: 'no_time_dimension' | 'no_machine_period_status' | 'no_numeric_measures' | 'registered_as_full';
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
 * - `no_machine_period_status`: every fetched Perioden code has `status:
 *   null`. ADR 061's period-note PROSE reader (src/ingestion/
 *   period-note-status.ts) is reviewed per table (a curated
 *   `Phase0Table.periodNoteStatus` config) — schema-only registration is
 *   generic and un-curated, so it never guesses a status from prose.
 * - `no_numeric_measures`: every measure's CBS `DataType` is `'String'` —
 *   text measures (`code`, `naam`, `omschrijving`-shaped) are never
 *   registered as servable (breadth step 2 constraints).
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
    return { ok: true, tableId, numericMeasures: Object.keys(units), alreadyRegistered: true };
  }

  const schema = await source.fetchTableSchema(tableId);
  const codeLists = await fetchAllCodeLists(source, tableId, schema.dimensions);

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
  if (periodCodes.length > 0 && periodCodes.every((c) => c.status === null)) {
    return {
      ok: false,
      reason: 'no_machine_period_status',
      summary:
        `Table "${tableId}"'s Perioden code list has no machine Status on any period (every ` +
        `code is null). ADR 061's period-note prose reader is curated per table, not a generic ` +
        `fallback — refusing rather than guessing a publication status from free text.`,
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
        schema.modified ?? null,
      ],
    );

    await insertDimensionLabels(tx, tableId, labelRowsFromCodeLists(schema.dimensions, codeLists), 'ignore');
  });

  return {
    ok: true,
    tableId,
    numericMeasures: numericMeasures.map((m) => m.code),
    alreadyRegistered: false,
  };
}

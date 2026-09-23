// Registry work package: idempotently writes src/registry/defaults.ts into
// cbs_tables.default_coordinates/.period_semantics and canonical_measures
// (migration 002). Safe to re-run — every write is a plain UPSERT/UPDATE keyed
// on a stable id, matching the ingestion pipeline's idempotency stance
// (docs/05-data-rules.md). Requires the referenced cbs_tables rows to already
// exist (run `ingest register --all` first).
import type { Db } from '../db/types.ts';
import { CANONICAL_MEASURES, TABLE_REGISTRY_DEFAULTS } from './defaults.ts';
import { EUROSTAT_SIBLING_MEASURES_REVIEWED } from '../sources/eurostat-siblings.ts';

export interface ApplyResult {
  tablesUpdated: string[];
  tablesMissing: string[];
  canonicalMeasuresUpserted: string[];
  /** E2a step 5 (docs/RUNBOOK.md "E2a step 5"): a reviewed Eurostat sibling
   * measure (`EUROSTAT_SIBLING_MEASURES_REVIEWED`) whose Eurostat table isn't
   * registered yet — `scripts/register-eurostat-siblings.ts --apply` hasn't
   * been run for it. SKIPPED, never a reason to abort the CBS apply: the
   * owner's regular `registry:apply` must keep writing the CBS defaults
   * exactly as before regardless of sibling-table registration state. Empty
   * once all three reviewed sibling tables are registered. */
  siblingMeasuresSkipped: string[];
}

export async function applyRegistryDefaults(db: Db): Promise<ApplyResult> {
  // Check every referenced table exists *before* writing anything: Db.query
  // only ever returns `{ rows }` (no rowCount — see src/db/types.ts), so an
  // UPDATE's "did it match" can't be read off the result, and canonical_measures
  // has a foreign key to cbs_tables — a mid-loop insert against a missing table
  // would throw and abort with some rows already written. Check first, apply
  // only if everything referenced exists, so this is all-or-nothing —
  // CBS-only, unchanged (E2a step 5): a missing Eurostat sibling table is
  // deliberately NOT part of this list (handled separately below), so it can
  // never abort the CBS write the owner's unrelated `registry:apply` depends
  // on.
  const referencedTableIds = [
    ...new Set([
      ...TABLE_REGISTRY_DEFAULTS.map((t) => t.tableId),
      ...CANONICAL_MEASURES.map((c) => c.tableId),
    ]),
  ];
  // The lookup query also checks the sibling tables' existence (one query,
  // both purposes) — but `tablesMissing` below is filtered to the CBS-only
  // list above, so a missing sibling table never surfaces there.
  const lookupIds = [
    ...new Set([...referencedTableIds, ...EUROSTAT_SIBLING_MEASURES_REVIEWED.map((c) => c.tableId)]),
  ];
  const existing = await db.query('select id from cbs_tables where id = any($1)', [lookupIds]);
  const existingIds = new Set(existing.rows.map((r) => r.id as string));
  const tablesMissing = referencedTableIds.filter((id) => !existingIds.has(id));
  if (tablesMissing.length > 0) {
    // Fix round 2 (minor): the CBS write is aborted here, but `existingIds`
    // already carries every sibling table's real registration state (the
    // lookup query above checks it in the same statement) — so the result
    // can and should still report which sibling measures are NOT yet
    // applicable, instead of a hardcoded `[]` that would misleadingly read
    // as "everything's fine on the sibling side" while the CBS side fails.
    const siblingMeasuresSkipped = EUROSTAT_SIBLING_MEASURES_REVIEWED.filter(
      (cm) => !existingIds.has(cm.tableId),
    ).map((cm) => cm.key);
    return { tablesUpdated: [], tablesMissing, canonicalMeasuresUpserted: [], siblingMeasuresSkipped };
  }

  const tablesUpdated: string[] = [];
  for (const entry of TABLE_REGISTRY_DEFAULTS) {
    await db.query(
      `update cbs_tables
         set default_coordinates = $2::jsonb, period_semantics = $3::jsonb, updated_at = now()
       where id = $1`,
      [entry.tableId, JSON.stringify(entry.defaultCoordinates), JSON.stringify(entry.periodSemantics)],
    );
    tablesUpdated.push(entry.tableId);
  }

  // E2a step 5: a reviewed sibling measure is upserted only once its table is
  // registered — skipped (reported, not aborted) otherwise, so `registry:apply`
  // is mechanical: run it any time after step 5's registration script, in
  // any order relative to which of the three tables are registered yet.
  const siblingMeasuresSkipped: string[] = [];
  const siblingMeasuresToApply = EUROSTAT_SIBLING_MEASURES_REVIEWED.filter((cm) => {
    if (existingIds.has(cm.tableId)) return true;
    siblingMeasuresSkipped.push(cm.key);
    return false;
  });
  const measuresToApply = [...CANONICAL_MEASURES, ...siblingMeasuresToApply];

  const canonicalMeasuresUpserted: string[] = [];
  for (const cm of measuresToApply) {
    await db.query(
      `insert into canonical_measures
         (key, table_id, measure, measure_title, dims, definition_label, everyday_terms, alternates, notes, updated_at)
       values ($1, $2, $3, $4, $5::jsonb, $6, $7, $8::jsonb, $9, now())
       on conflict (key) do update set
         table_id = excluded.table_id,
         measure = excluded.measure,
         measure_title = excluded.measure_title,
         dims = excluded.dims,
         definition_label = excluded.definition_label,
         everyday_terms = excluded.everyday_terms,
         alternates = excluded.alternates,
         notes = excluded.notes,
         updated_at = now()`,
      [
        cm.key,
        cm.tableId,
        cm.measure,
        cm.measureTitle,
        JSON.stringify(cm.dims),
        cm.definitionLabel,
        cm.everydayTerms,
        cm.alternates ? JSON.stringify(cm.alternates) : null,
        cm.notes ?? null,
      ],
    );
    canonicalMeasuresUpserted.push(cm.key);
  }

  return { tablesUpdated, tablesMissing, canonicalMeasuresUpserted, siblingMeasuresSkipped };
}

// CLI entry: node --env-file=.env src/registry/apply.ts
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const { connectFromEnv } = await import('../db/client.ts');
  const { applyMigrations } = await import('../db/migrate.ts');
  const { db, pool } = connectFromEnv();
  try {
    await applyMigrations(db);
    const result = await applyRegistryDefaults(db);
    if (result.tablesMissing.length > 0) {
      console.error(
        `FAILED: ${result.tablesMissing.length} table(s) not yet registered (run "npm run ingest -- register --all" first): ${result.tablesMissing.join(', ')}`,
      );
      process.exit(1);
    }
    console.log(`Updated defaults for ${result.tablesUpdated.length} table(s): ${result.tablesUpdated.join(', ')}.`);
    console.log(`Upserted ${result.canonicalMeasuresUpserted.length} canonical measure(s): ${result.canonicalMeasuresUpserted.join(', ')}.`);
    if (result.siblingMeasuresSkipped.length > 0) {
      console.log(
        `Skipped ${result.siblingMeasuresSkipped.length} Eurostat sibling measure(s) (table not yet registered — run "npm run eurostat:siblings -- --apply" first): ${result.siblingMeasuresSkipped.join(', ')}.`,
      );
    }
  } finally {
    await pool.end();
  }
}

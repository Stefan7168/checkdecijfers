// Registry work package: idempotently writes src/registry/defaults.ts into
// cbs_tables.default_coordinates/.period_semantics and canonical_measures
// (migration 002). Safe to re-run — every write is a plain UPSERT/UPDATE keyed
// on a stable id, matching the ingestion pipeline's idempotency stance
// (docs/05-data-rules.md). Requires the referenced cbs_tables rows to already
// exist (run `ingest register --all` first).
import type { Db } from '../db/types.ts';
import { CANONICAL_MEASURES, TABLE_REGISTRY_DEFAULTS } from './defaults.ts';

export interface ApplyResult {
  tablesUpdated: string[];
  tablesMissing: string[];
  canonicalMeasuresUpserted: string[];
}

export async function applyRegistryDefaults(db: Db): Promise<ApplyResult> {
  // Check every referenced table exists *before* writing anything: Db.query
  // only ever returns `{ rows }` (no rowCount — see src/db/types.ts), so an
  // UPDATE's "did it match" can't be read off the result, and canonical_measures
  // has a foreign key to cbs_tables — a mid-loop insert against a missing table
  // would throw and abort with some rows already written. Check first, apply
  // only if everything referenced exists, so this is all-or-nothing.
  const referencedTableIds = [
    ...new Set([
      ...TABLE_REGISTRY_DEFAULTS.map((t) => t.tableId),
      ...CANONICAL_MEASURES.map((c) => c.tableId),
    ]),
  ];
  const existing = await db.query('select id from cbs_tables where id = any($1)', [referencedTableIds]);
  const existingIds = new Set(existing.rows.map((r) => r.id as string));
  const tablesMissing = referencedTableIds.filter((id) => !existingIds.has(id));
  if (tablesMissing.length > 0) {
    return { tablesUpdated: [], tablesMissing, canonicalMeasuresUpserted: [] };
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

  const canonicalMeasuresUpserted: string[] = [];
  for (const cm of CANONICAL_MEASURES) {
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

  return { tablesUpdated, tablesMissing, canonicalMeasuresUpserted };
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
  } finally {
    await pool.end();
  }
}

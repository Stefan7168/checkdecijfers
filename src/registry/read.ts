// Small registry read helper (WP9 seam): the staleness check needs the
// expected update cadence for a table, without pulling in the whole apply.ts
// write path. Read-only, no LLM, no computation beyond the SQL projection.
import type { Db } from '../db/types.ts';

/** cbs_tables.update_cadence for one table, or null when the table is
 * unregistered or the column was never set (docs/05 staleness row: an
 * unknown cadence means "never stale" — see respond/staleness.ts). */
export async function readUpdateCadence(db: Db, tableId: string): Promise<string | null> {
  const result = await db.query('select update_cadence from cbs_tables where id = $1', [tableId]);
  const row = result.rows[0];
  if (!row) return null;
  return (row.update_cadence as string | null) ?? null;
}

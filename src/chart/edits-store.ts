// Chart co-pilot edit-log store (session 112 phase 1 / session 113 phase 2,
// migrations 034 + 035, ADR 056 decision 4, docs/open-questions.md #274).
// Mirrors src/chart/headline-store.ts exactly: FILE-ONLY until the
// owner-supervised apply — every function here degrades gracefully (checked
// via to_regclass / a defensive catch, never a try/catch masking real
// errors) when the table or column doesn't exist yet.
//
// A row is keyed by EITHER an audit answer (a CBS chart, phase 1) OR a
// dataset turn (a reader's own-data chart, phase 2) — never both (migration
// 035's `chart_edits_one_key` check). `ChartEditsKey` is reproduced here
// rather than imported from web/lib/chart-edits-key.ts: src/threads/
// replay.ts's own header comment states the mandatory layering rule —
// "web/backend -> ../src means src code cannot import web/lib/*" — so this
// type is duplicated, structurally identical, on both sides of that
// boundary (src/chart/embed-live.ts's own precedent for the same rule).
//
// The write's ownership + kind + chart + source guard lives IN the SQL
// itself (same pattern as upsertChartHeadline / upsertAnswerFeedback): a row
// can only come into existence from a select over the caller's OWN,
// USER-tagged, chart-bearing answer/turn row. Zero rows returned = the guard
// did not match — reported as a soft `false`, never an error.
//
// `log` is the reader's serialised command history for the chart (form,
// zoom, hidden/highlighted series, style, template, notes, title, caption
// commands). A command never carries a data value — only keys, codes, enum
// values and text the reader typed — so the answer's numbers are untouched
// (R1/R6). CHART_EDITS_MAX_JSON caps the serialised size so a runaway log
// can't grow the row unboundedly.
import type { Db } from '../db/types.ts';

export const CHART_EDITS_MAX_JSON = 65_536;

/** Reproduced from web/lib/chart-edits-key.ts — see the module header. */
export type ChartEditsKey = { kind: 'answer'; id: number } | { kind: 'turn'; id: number };

/** Postgres's SQLSTATE for "undefined_column" — the deploy-order-safe
 * fallback for the turn leg, which reads/writes a column (`dataset_turn_id`)
 * that doesn't exist until migration 035 is applied. Mirrors
 * src/chart/user-styles.ts's UNDEFINED_TABLE (42P01) precedent for the same
 * deploy-window problem, one SQLSTATE over. */
const UNDEFINED_COLUMN = '42703';

function isUndefinedColumnError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === UNDEFINED_COLUMN
  );
}

async function tableExists(db: Db): Promise<boolean> {
  const { rows } = await db.query(`select to_regclass('public.chart_edits') as t`);
  return rows[0]?.t != null;
}

/** Fix round 1 (code review, session 113): whether migration 035 has been
 * applied — checked via `information_schema.columns` rather than
 * `to_regclass` (that only answers "does the table/index exist", not "does
 * this column"). 035 is one atomic transaction (`applyMigrations` in
 * src/db/migrate.ts wraps every migration file in `db.withTransaction`), so
 * `dataset_turn_id` existing is a reliable proxy for "the two partial
 * unique indexes exist too, and the old plain PK is gone" — the deploy
 * window is strictly before-035 or after-035, never half-applied. Used by
 * `upsertAnswerEdits` to pick its `ON CONFLICT` target: Postgres's conflict-
 * target inference with an explicit `WHERE` predicate matches ONLY an
 * existing partial unique index with that exact predicate — it does NOT
 * fall back to a full (predicate-less) unique index/PK. Before 035, the
 * live table still has the old `(audit_answer_id, user_id)` primary key, so
 * a `where audit_answer_id is not null` conflict target would raise 42P10
 * ("no unique or exclusion constraint matching") on every save of the
 * already-live phase-1 feature — exactly the deploy-window breakage this
 * function exists to avoid. */
async function turnColumnExists(db: Db): Promise<boolean> {
  const { rows } = await db.query(
    `select 1 from information_schema.columns where table_name = 'chart_edits' and column_name = 'dataset_turn_id'`,
  );
  return rows.length > 0;
}

export interface UpsertChartEditsInput {
  key: ChartEditsKey;
  userId: string;
  log: unknown[];
}

async function upsertAnswerEdits(
  db: Db,
  key: { id: number },
  userId: string,
  json: string,
  post035: boolean,
): Promise<boolean> {
  // Pre-035: the live table still has the old, predicate-less PK
  // `(audit_answer_id, user_id)` — the conflict target must match it
  // exactly (no `where`). Post-035: the PK is gone, replaced by the
  // partial unique index this predicate matches. See turnColumnExists's
  // comment for why a 42P10 error is the alternative if this picks wrong.
  const conflictTarget = post035
    ? '(audit_answer_id, user_id) where audit_answer_id is not null'
    : '(audit_answer_id, user_id)';
  const { rows } = await db.query(
    `insert into chart_edits (audit_answer_id, user_id, log)
     select a.id, $3::text, $2::jsonb
       from audit_answers a
      where a.id = $1 and a.user_id = $3 and a.kind = 'answer' and a.source_tag = 'user' and a.chart_emitted
     on conflict ${conflictTarget} do update
       set log = excluded.log, updated_at = now()
     returning audit_answer_id`,
    [key.id, json, userId],
  );
  return rows.length > 0;
}

/** The `$2::text` cast in the select list (added to the brief's literal SQL)
 * is load-bearing: `$2` is also compared as `t.user_id = $2::uuid` below in
 * the same statement, and Postgres refuses to deduce two different types
 * for one parameter ("inconsistent types deduced for parameter $2")
 * without an explicit cast on at least one side. */
async function upsertTurnEdits(db: Db, key: { id: number }, userId: string, json: string): Promise<boolean> {
  try {
    const { rows } = await db.query(
      `insert into chart_edits (dataset_turn_id, user_id, log)
       select t.id, $2::text, $3::jsonb
         from dataset_turns t
        where t.id = $1 and t.user_id = $2::uuid and t.kind = 'chart' and t.chart_emitted
       on conflict (dataset_turn_id, user_id) where dataset_turn_id is not null do update
         set log = excluded.log, updated_at = now()
       returning dataset_turn_id`,
      [key.id, userId, json],
    );
    return rows.length > 0;
  } catch (err) {
    if (isUndefinedColumnError(err)) return false;
    throw err;
  }
}

export async function upsertChartEdits(db: Db, input: UpsertChartEditsInput): Promise<boolean> {
  const json = JSON.stringify(input.log);
  if (json.length > CHART_EDITS_MAX_JSON) return false;
  if (!(await tableExists(db))) return false;
  if (input.key.kind === 'turn') return upsertTurnEdits(db, input.key, input.userId, json);
  const post035 = await turnColumnExists(db);
  return upsertAnswerEdits(db, input.key, input.userId, json, post035);
}

function toLog(raw: unknown): unknown[] | null {
  return Array.isArray(raw) ? raw : null;
}

async function getAnswerEdits(db: Db, id: number, userId: string): Promise<unknown[] | null> {
  const { rows } = await db.query(`select log from chart_edits where audit_answer_id = $1 and user_id = $2`, [
    id,
    userId,
  ]);
  if (rows.length === 0) return null;
  return toLog(rows[0]!.log);
}

async function getTurnEdits(db: Db, id: number, userId: string): Promise<unknown[] | null> {
  try {
    const { rows } = await db.query(`select log from chart_edits where dataset_turn_id = $1 and user_id = $2`, [
      id,
      userId,
    ]);
    if (rows.length === 0) return null;
    return toLog(rows[0]!.log);
  } catch (err) {
    if (isUndefinedColumnError(err)) return null;
    throw err;
  }
}

export async function getOwnChartEdits(db: Db, key: ChartEditsKey, userId: string): Promise<unknown[] | null> {
  if (!(await tableExists(db))) return null;
  return key.kind === 'answer' ? getAnswerEdits(db, key.id, userId) : getTurnEdits(db, key.id, userId);
}

/** Retention leg (src/attachments/retention.ts's redactTurnsForDatasets):
 * hard-deletes every chart_edits row keyed by one of the given dataset-turn
 * ids. Unlike the answer leg (audit_answers rows are redacted, never
 * deleted), a redacted dataset_turns row carries no chart data to replay
 * against any more, so its edit log is dead weight rather than something to
 * redact in place — a hard delete, called from the SAME transaction as the
 * turn redaction. Returns 0 (never throws) on an empty list or when the
 * column is absent — the pre-035 deploy window has nothing to delete yet.
 *
 * Final review (session 113): the column-absent case is PROBED, not caught.
 * This is the one leg that runs inside the caller's transaction, and a
 * failed statement puts Postgres into "current transaction is aborted" —
 * catching 42703 here would still leave the retention transaction dead, so
 * the following `update dataset_turns …` (and with it deleteOneDataset /
 * deleteUserDatasets / the GDPR purge) would throw. `turnColumnExists` is a
 * plain select against information_schema and never aborts anything. */
export async function deleteChartEditsForTurns(db: Db, turnIds: number[]): Promise<number> {
  if (turnIds.length === 0) return 0;
  if (!(await tableExists(db))) return 0;
  if (!(await turnColumnExists(db))) return 0;
  const { rows } = await db.query(
    `delete from chart_edits where dataset_turn_id = any($1::bigint[]) returning dataset_turn_id`,
    [turnIds],
  );
  return rows.length;
}

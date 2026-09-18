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

export interface UpsertChartEditsInput {
  key: ChartEditsKey;
  userId: string;
  log: unknown[];
}

async function upsertAnswerEdits(db: Db, key: { id: number }, userId: string, json: string): Promise<boolean> {
  const { rows } = await db.query(
    `insert into chart_edits (audit_answer_id, user_id, log)
     select a.id, $3::text, $2::jsonb
       from audit_answers a
      where a.id = $1 and a.user_id = $3 and a.kind = 'answer' and a.source_tag = 'user' and a.chart_emitted
     on conflict (audit_answer_id, user_id) where audit_answer_id is not null do update
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
  return input.key.kind === 'answer'
    ? upsertAnswerEdits(db, input.key, input.userId, json)
    : upsertTurnEdits(db, input.key, input.userId, json);
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
 * column is absent — the pre-035 deploy window has nothing to delete yet. */
export async function deleteChartEditsForTurns(db: Db, turnIds: number[]): Promise<number> {
  if (turnIds.length === 0) return 0;
  if (!(await tableExists(db))) return 0;
  try {
    const { rows } = await db.query(`delete from chart_edits where dataset_turn_id = any($1::bigint[]) returning dataset_turn_id`, [
      turnIds,
    ]);
    return rows.length;
  } catch (err) {
    if (isUndefinedColumnError(err)) return 0;
    throw err;
  }
}

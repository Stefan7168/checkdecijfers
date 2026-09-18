// Chart co-pilot edit-log store (session 112, chart co-pilot phase 1,
// migration 034, ADR 056 decision 4, docs/open-questions.md #274). Mirrors
// src/chart/headline-store.ts exactly: FILE-ONLY until the owner-supervised
// apply — every function here degrades gracefully (checked via to_regclass,
// never a try/catch masking real errors) when the table doesn't exist yet.
//
// The write's ownership + kind + chart + source guard lives IN the SQL
// itself (same pattern as upsertChartHeadline / upsertAnswerFeedback): a row
// can only come into existence from a select over the caller's OWN,
// USER-tagged, chart-bearing ANSWER row. Zero rows returned = the guard did
// not match — reported as a soft `false`, never an error.
//
// `log` is the reader's serialised command history for the chart (form,
// zoom, hidden/highlighted series, style, template, notes, title, caption
// commands). A command never carries a data value — only keys, codes, enum
// values and text the reader typed — so the answer's numbers are untouched
// (R1/R6). CHART_EDITS_MAX_JSON caps the serialised size so a runaway log
// can't grow the row unboundedly.
import type { Db } from '../db/types.ts';

export const CHART_EDITS_MAX_JSON = 65_536;

async function tableExists(db: Db): Promise<boolean> {
  const { rows } = await db.query(`select to_regclass('public.chart_edits') as t`);
  return rows[0]?.t != null;
}

export interface UpsertChartEditsInput {
  auditAnswerId: number;
  userId: string;
  log: unknown[];
}

export async function upsertChartEdits(db: Db, input: UpsertChartEditsInput): Promise<boolean> {
  const json = JSON.stringify(input.log);
  if (json.length > CHART_EDITS_MAX_JSON) return false;
  if (!(await tableExists(db))) return false;
  const { rows } = await db.query(
    `insert into chart_edits (audit_answer_id, user_id, log)
     select a.id, $3::text, $2::jsonb
       from audit_answers a
      where a.id = $1 and a.user_id = $3 and a.kind = 'answer' and a.source_tag = 'user' and a.chart_emitted
     on conflict (audit_answer_id, user_id) do update
       set log = excluded.log, updated_at = now()
     returning audit_answer_id`,
    [input.auditAnswerId, json, input.userId],
  );
  return rows.length > 0;
}

export async function getOwnChartEdits(db: Db, auditAnswerId: number, userId: string): Promise<unknown[] | null> {
  if (!(await tableExists(db))) return null;
  const { rows } = await db.query(`select log from chart_edits where audit_answer_id = $1 and user_id = $2`, [
    auditAnswerId,
    userId,
  ]);
  if (rows.length === 0) return null;
  const log = rows[0]!.log;
  return Array.isArray(log) ? log : null;
}

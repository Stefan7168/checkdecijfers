// Journalist chart-headline store (session 105,
// docs/superpowers/specs/2026-09-16-chart-journalist-headline-design.md).
// FILE-ONLY until the owner-supervised apply of migration 031 — every
// function here degrades gracefully (checked via to_regclass, never a
// try/catch masking real errors) when the table doesn't exist yet, mirroring
// src/chart/user-styles.ts's stated contract.
//
// The write's ownership + kind + chart-presence guard lives IN the SQL
// itself (mirrors src/answer/audit/feedback.ts's upsertAnswerFeedback): a
// row can only come into existence from a select over the caller's OWN,
// USER-tagged, chart-bearing ANSWER row. Zero rows returned = the guard did
// not match — reported as a soft `false`, never an error.
import type { Db } from '../db/types.ts';

export const CHART_HEADLINE_MAX_LENGTH = 140;

export function normalizeHeadlineText(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, CHART_HEADLINE_MAX_LENGTH);
}

async function tableExists(db: Db): Promise<boolean> {
  const { rows } = await db.query(`select to_regclass('public.chart_headlines') as t`);
  return rows[0]?.t != null;
}

export interface UpsertChartHeadlineInput {
  auditAnswerId: number;
  userId: string;
  headline: string;
}

export async function upsertChartHeadline(db: Db, input: UpsertChartHeadlineInput): Promise<boolean> {
  if (!(await tableExists(db))) return false;
  const { rows } = await db.query(
    `insert into chart_headlines (audit_answer_id, headline)
     select a.id, $2::text
       from audit_answers a
      where a.id = $1
        and a.user_id = $3
        and a.kind = 'answer'
        and a.chart_emitted
     on conflict (audit_answer_id) do update
       set headline = excluded.headline, updated_at = now()
     returning audit_answer_id`,
    [input.auditAnswerId, input.headline, input.userId],
  );
  return rows.length > 0;
}

export async function getOwnChartHeadline(db: Db, auditAnswerId: number, userId: string): Promise<string | null> {
  if (!(await tableExists(db))) return null;
  const { rows } = await db.query(
    `select h.headline
       from chart_headlines h
       join audit_answers a on a.id = h.audit_answer_id
      where h.audit_answer_id = $1
        and a.user_id = $2`,
    [auditAnswerId, userId],
  );
  return rows.length > 0 ? (rows[0]!.headline as string) : null;
}

/** No ownership check — used only from the public /embed/[token] route,
 * whose signed token (verifyEmbedToken) has already proven the caller may
 * see this specific audit row's chart. */
export async function getChartHeadlinePublic(db: Db, auditAnswerId: number): Promise<string | null> {
  if (!(await tableExists(db))) return null;
  const { rows } = await db.query(`select headline from chart_headlines where audit_answer_id = $1`, [auditAnswerId]);
  return rows.length > 0 ? (rows[0]!.headline as string) : null;
}

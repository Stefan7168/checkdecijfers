// ADR 041 revisit trigger "The Pro-owner-email lookup" / open-questions #224.
// Design note: docs/session-briefs/2026-09-12-live-embed-creator-lookup-design.md
// (option 3, recommended over a Supabase admin/service-role client or a
// mirrored+trigger-synced email column: no new secret, no schema change, no
// second copy of personal data — CLAUDE.md's "cheapest viable mechanism
// first" rule).
//
// The app's only Postgres connection (src/db/client.ts's pooled `pg.Pool`
// over DATABASE_URL) already points at the same Supabase Postgres project
// that runs GoTrue auth — `auth.users` is an ordinary table in that same
// database, not a separate service. This is the ONE place in the codebase
// that reads it.
//
// Fails closed to `null` on ANY error: the `auth` schema absent, the pooler
// role lacking SELECT privilege on it (this session could not verify
// against the live project — see the design note's residual risks and
// docs/RUNBOOK.md), a malformed id, or a genuinely unknown user. The caller
// (the embed route's Live gate) already treats `null` email as "not Pro" —
// so an unverified or denied read degrades to exactly today's behaviour
// (Live stays frozen), never a thrown error and never a guess.
//
// NEVER logs the looked-up email — only ever returned to the immediate
// caller, which itself only ever feeds it straight into `hasProPlan` and
// discards it.
import type { Db } from '../db/types.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolves a Supabase auth user id to that user's email, or `null` if the
 * id is malformed, unknown, or the read fails for any reason (missing
 * `auth` schema, denied privilege, unreachable database). Never throws.
 */
export async function lookupUserEmail(db: Db, userId: string): Promise<string | null> {
  if (!UUID_RE.test(userId)) return null;

  try {
    const result = await db.query('select email from auth.users where id = $1', [userId]);
    const row = result.rows[0] as { email?: unknown } | undefined;
    if (row === undefined || typeof row.email !== 'string') return null;
    const trimmed = row.email.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

// Durable error logging (#65 / WP25, migration 024) — the write and retention
// primitives for the `error_log` table.
//
// Lives in src/db/ (the shared layer beneath the ADR-001 modules, next to the
// migration runner) because the write sites span module boundaries: the chat
// Server Actions (answer/billing path), the Stripe webhook (billing), the auth
// callback and the #114 health route. It is operational infrastructure, not
// product logic — no module's domain owns it.
//
// THE FAIL-OPEN RULE (WP25 brief, the reverse of R8's fail-closed audit
// store, deliberately): a broken logger must never break the product path,
// and a failed write here must never mask or replace the ORIGINAL error being
// recorded. `logError` therefore never throws and never rejects — its own
// failure is console-logged and swallowed. Callers just `await logError(...)`
// and then do whatever they already did (rethrow / return an error response).
//
// NO PERSONAL DATA, structurally (the invariant the migration header states):
// `context` must never carry raw question or answer text — this table has no
// GDPR redaction machinery, so it must never need it. Reference what was being
// processed by request id / audit id, never by content. Message and stack are
// error internals (allowed); bounds below keep rows small either way.
import type { Db } from './types.ts';

/** Retention window (days): adopted 2026-08-27 (session 66) from the WP25
 * brief's suggested default. Enforced by the shared retention job
 * (src/answer/audit/retention-job.ts) — expired rows are DELETED, not
 * redacted (nothing references them; the trial_questions precedent). */
export const ERROR_LOG_RETENTION_DAYS = 90;

/** Bounds. An error log exists to be small and always writable — an oversized
 * message/stack/context is truncated or dropped, never allowed to fail the
 * insert or bloat the table. */
const MAX_MESSAGE_LENGTH = 2000;
const MAX_STACK_LENGTH = 8000;
const MAX_SOURCE_LENGTH = 100;
/** Serialized-context ceiling; over it the context is REPLACED by a marker
 * (truncating JSON mid-string would store garbage). */
const MAX_CONTEXT_JSON_LENGTH = 8192;

/** Postgres-compatible uuid check. request_id/user_id are uuid COLUMNS
 * (joinability with credit_transactions/audit_answers, migrations 005/010),
 * but the values arrive from client-controlled strings (guardRequestId bounds
 * length, not shape) — a non-uuid must go to `context`, never fail the
 * insert on a cast error (fail-open would swallow it and the trace would be
 * lost exactly when a crafted request is worth tracing). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ErrorLogInput {
  /** The catch site: 'askQuestion' | 'replyToClarification' | 'stripe-webhook'
   * | 'auth-callback' | 'health' today. Free text by design (migration 024) —
   * a new catch site must not need a migration. */
  source: string;
  /** The caught value, as caught — message/stack extraction happens here so
   * every catch site records errors identically (incl. non-Error throws). */
  error: unknown;
  requestId?: string | null;
  userId?: string | null;
  /** Bounded structured extras. NEVER raw question/answer text (see header). */
  context?: Record<string, unknown> | null;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…[truncated]` : text;
}

/** message/stack from an unknown caught value, without trusting it to be an
 * Error. A non-Error throw (a string, an object) stringifies; a broken
 * toString cannot escape (JSON fallback, then a fixed marker). */
function describeError(error: unknown): { message: string; stack: string | null } {
  if (error instanceof Error) {
    return {
      message: truncate(error.message === '' ? error.name : error.message, MAX_MESSAGE_LENGTH),
      stack: typeof error.stack === 'string' ? truncate(error.stack, MAX_STACK_LENGTH) : null,
    };
  }
  let message: string;
  try {
    message = typeof error === 'string' ? error : JSON.stringify(error) ?? String(error);
  } catch {
    message = '[unserializable thrown value]';
  }
  return { message: truncate(message, MAX_MESSAGE_LENGTH), stack: null };
}

/** context → a jsonb-bindable string within the bound, or null. Over-bound or
 * unserializable context is REPLACED by a marker object — the row still
 * writes, and says why the detail is missing. */
function boundContext(context: Record<string, unknown> | null): string | null {
  if (context === null || Object.keys(context).length === 0) return null;
  let json: string;
  try {
    json = JSON.stringify(context);
  } catch {
    return JSON.stringify({ note: 'context dropped: not serializable' });
  }
  if (json.length > MAX_CONTEXT_JSON_LENGTH) {
    return JSON.stringify({ note: `context dropped: exceeded ${MAX_CONTEXT_JSON_LENGTH}-char bound` });
  }
  return json;
}

/**
 * Best-effort durable write of one caught error. NEVER throws, NEVER rejects
 * (the fail-open rule above) — on its own failure it console-logs and returns,
 * so the caller's original error handling is untouched. Until migration 024's
 * supervised live apply the insert fails on the missing relation and lands
 * here too: deploy-order-safe without a flag.
 */
export async function logError(db: Db, input: ErrorLogInput): Promise<void> {
  try {
    const { message, stack } = describeError(input.error);
    const requestIdOk = typeof input.requestId === 'string' && UUID_RE.test(input.requestId);
    const userIdOk = typeof input.userId === 'string' && UUID_RE.test(input.userId);
    // A non-uuid request id is exactly the kind of crafted input worth keeping:
    // preserve it (bounded) in context instead of failing the uuid column.
    const context: Record<string, unknown> = { ...(input.context ?? {}) };
    if (typeof input.requestId === 'string' && !requestIdOk) {
      context.rawRequestId = truncate(input.requestId, MAX_SOURCE_LENGTH);
    }
    await db.query(
      `insert into error_log (source, request_id, user_id, message, stack, context)
       values ($1, $2, $3, $4, $5, $6::jsonb)`,
      [
        truncate(input.source, MAX_SOURCE_LENGTH),
        requestIdOk ? input.requestId : null,
        userIdOk ? input.userId : null,
        message,
        stack,
        boundContext(context),
      ],
    );
  } catch (logFailure) {
    // Fail-open: the ORIGINAL error was already console-logged by the catch
    // site; this line records only that its durable copy did not land.
    console.error('error_log write failed (original error unaffected):', logFailure);
  }
}

/** The 90-day cutoff, derived from an injected clock (the retention job's
 * one-clock rule: every window in a run is cut from the same instant). */
export function errorLogRetentionCutoff(now: Date): Date {
  const cutoff = new Date(now);
  cutoff.setUTCDate(cutoff.getUTCDate() - ERROR_LOG_RETENTION_DAYS);
  return cutoff;
}

/** Dry-run count for the retention job — same WHERE as the purge below (the
 * ⟨F2⟩ discipline: preview and apply may never disagree). */
export async function countPurgeableErrorLog(db: Db, cutoff: Date): Promise<number> {
  const { rows } = await db.query(
    'select count(*)::int as n from error_log where occurred_at < $1',
    [cutoff.toISOString()],
  );
  return Number(rows[0]?.n ?? 0);
}

/** DELETEs expired rows; returns how many went. Deletion, not redaction:
 * nothing references error_log rows and they carry no user-facing record
 * (the trial_questions 90-day precedent, ADR 036 D4). */
export async function purgeExpiredErrorLog(db: Db, cutoff: Date): Promise<number> {
  const { rows } = await db.query(
    'delete from error_log where occurred_at < $1 returning id',
    [cutoff.toISOString()],
  );
  return rows.length;
}

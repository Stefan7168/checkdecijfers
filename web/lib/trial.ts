// Server-side helpers for the #53 anonymous trial (ADR 036). Pure
// server-module (node:crypto, next/headers) — never imported by client code.
//
// Dormancy contract (D3): the trial EXISTS only when TRIAL_ENABLED='1' AND
// the separate trial API key AND the ip-hash secret are set. Anything less →
// 'dormant', and the landing renders byte-identically to a build without
// this feature (the WP129/WP135 pattern). Enabled but not servable → the
// visible degrade to "log in om verder te gaan" the owner decided, never a
// broken page — and since 2026-07-25 that degrade is TWO states, because they
// are two different truths: 'closed' when the pot was read and is at 0 (the
// copy may say so), 'unavailable' when the pot table is missing or the read
// threw (the copy must not name a cause we do not have).
import { createHmac } from 'node:crypto';
import { cookies, headers } from 'next/headers';
import { getTrialPotStatus, TRIAL_QUESTIONS_PER_VISITOR } from '../backend/billing/index.ts';
import { getDb } from './db.ts';

/** The D1 visitor cookie: HttpOnly, functional-only, set on FIRST use. */
export const TRIAL_COOKIE = 'cdc_trial';
export const TRIAL_COOKIE_MAX_AGE_S = 180 * 24 * 60 * 60;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True for a canonically-shaped UUID. Exported because the trial's
 * `requestId` needs the SAME shape check as the visitor cookie and for a
 * sharper reason: `trial_questions.request_id` is `text` (migration 020) while
 * `audit_answers.request_id` is `uuid` (migration 010), so a non-UUID id is
 * accepted by the pot take and only rejected by the R8 insert — AFTER both LLM
 * calls have been paid for. See the guard in trial-actions.ts. */
export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

export function trialConfigured(): boolean {
  return (
    process.env.TRIAL_ENABLED === '1' &&
    typeof process.env.ANTHROPIC_TRIAL_API_KEY === 'string' &&
    process.env.ANTHROPIC_TRIAL_API_KEY.length > 0 &&
    typeof process.env.TRIAL_IP_HASH_SECRET === 'string' &&
    process.env.TRIAL_IP_HASH_SECRET.length > 0
  );
}

/** The visitor's cookie id, ONLY if it parses as a UUID — a forged/garbage
 * cookie value counts as no cookie (never reaches SQL as-is). */
export async function readTrialVisitorId(): Promise<string | null> {
  const jar = await cookies();
  const value = jar.get(TRIAL_COOKIE)?.value;
  return value !== undefined && UUID_PATTERN.test(value) ? value.toLowerCase() : null;
}

/** HMAC-hashed request IP (ADR 036 D2): raw IPs never persist. Vercel
 * terminates the connection, so x-forwarded-for's FIRST entry is the
 * platform-set client address (spoofable only by proxies the visitor owns —
 * acceptable for a backstop limit; the pot is the real ceiling).
 *
 * `||`, not `??`, on the fall-through (2026-07-25): a header that is PRESENT
 * but EMPTY splits to `''`, which is not nullish — so `??` short-circuited on
 * it and never consulted `x-real-ip`, hashing a third shared bucket distinct
 * from both a real address and `'unknown'`. Not reachable on Vercel, which
 * overwrites `x-forwarded-for` itself; it would become reachable the moment
 * this sits behind any other proxy, which the launch plan contemplates.
 *
 * The secret is ASSERTED, not defaulted. It used to fall back to `''`, and an
 * unkeyed SHA-256 of an IPv4 address is reversible by brute force over the
 * whole 2^32 space — i.e. the silent failure of `??` here would have been the
 * precise defeat of the "raw IPs never persist" guarantee D2 makes, plus a
 * silent second budget for every visitor (keyed and unkeyed hashes differ).
 * Today `trialConfigured()` guarantees it is set on every path that reaches
 * here; this makes that guarantee loud instead of load-bearing-but-unstated. */
export async function hashedRequestIp(): Promise<string> {
  const secret = process.env.TRIAL_IP_HASH_SECRET;
  if (secret === undefined || secret.length === 0) {
    throw new Error('TRIAL_IP_HASH_SECRET is unset — refusing to persist an unkeyed IP hash');
  }
  const h = await headers();
  const forwarded = h.get('x-forwarded-for');
  // Trim BEFORE the fallback, not after: a present-but-whitespace header is
  // truthy, so trimming last would let ' ' win the `||` and hash to '' — the
  // same shared-bucket bug as the empty header, one character away.
  const ip =
    forwarded?.split(',')[0]?.trim() || h.get('x-real-ip')?.trim() || 'unknown';
  return createHmac('sha256', secret).update(ip).digest('hex');
}

export type TrialGateState =
  | { kind: 'dormant' }
  /** The pot was READ and is empty. Only this state may say so to the visitor. */
  | { kind: 'closed' }
  /** We could not determine the pot state (table absent, DB unreachable, pooler
   * full). Degrades identically to 'closed' — but the copy must NOT name a
   * cause, because we do not know one. Split out from 'closed' on 2026-07-25:
   * the single state made the landing tell every visitor "het gratis proefpotje
   * is op dit moment leeg" during a #173 pooler exhaustion, when the pot may
   * well have been full. No number is wrong, so no invariant is breached — but
   * asserting an unverified cause to the public is the exact habit this product
   * exists to not have (principle (c)). */
  | { kind: 'unavailable' }
  /** THIS visitor's own budget is spent (the pot may still be open). */
  | { kind: 'used_up' }
  | { kind: 'open'; questionsLeft: number };

/** The landing's per-request gate read (server component): computed fresh on
 * every request so a pot refill re-opens the trial WITHOUT a deploy (owner
 * decision: auto re-enable). Fail-safe unchanged: anything short of a verified
 * open pot degrades to the login nudge, never to a broken page — only the
 * REASON we show is now distinguished from the reason we merely assumed. */
export async function getTrialGateState(): Promise<TrialGateState> {
  if (!trialConfigured()) return { kind: 'dormant' };
  try {
    const db = getDb();
    const pot = await getTrialPotStatus(db);
    // getTrialPotStatus returns null for BOTH "table absent" and "read threw"
    // — neither is evidence the pot is empty.
    if (pot === null) return { kind: 'unavailable' };
    if (pot.remaining <= 0) return { kind: 'closed' };
    const visitorId = await readTrialVisitorId();
    if (visitorId === null) return { kind: 'open', questionsLeft: TRIAL_QUESTIONS_PER_VISITOR };
    const { rows } = await db.query(
      'select count(*)::int as n from trial_questions where visitor_id = $1 and not refunded',
      [visitorId],
    );
    const left = TRIAL_QUESTIONS_PER_VISITOR - Number(rows[0]!.n);
    return left > 0 ? { kind: 'open', questionsLeft: left } : { kind: 'used_up' };
  } catch (err) {
    console.warn('[trial] gate read failed, rendering unavailable:', err);
    return { kind: 'unavailable' };
  }
}

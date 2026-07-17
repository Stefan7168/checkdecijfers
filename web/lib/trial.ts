// Server-side helpers for the #53 anonymous trial (ADR 036). Pure
// server-module (node:crypto, next/headers) — never imported by client code.
//
// Dormancy contract (D3): the trial EXISTS only when TRIAL_ENABLED='1' AND
// the separate trial API key AND the ip-hash secret are set. Anything less →
// 'dormant', and the landing renders byte-identically to a build without
// this feature (the WP129/WP135 pattern). Enabled-but-empty (pot at 0, pot
// table missing, any read error) → 'closed': the visible degrade to "log in
// om verder te gaan" the owner decided — never a broken page.
import { createHmac } from 'node:crypto';
import { cookies, headers } from 'next/headers';
import { getTrialPotStatus, TRIAL_QUESTIONS_PER_VISITOR } from '../backend/billing/index.ts';
import { getDb } from './db.ts';

/** The D1 visitor cookie: HttpOnly, functional-only, set on FIRST use. */
export const TRIAL_COOKIE = 'cdc_trial';
export const TRIAL_COOKIE_MAX_AGE_S = 180 * 24 * 60 * 60;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
 * acceptable for a backstop limit; the pot is the real ceiling). */
export async function hashedRequestIp(): Promise<string> {
  const h = await headers();
  const forwarded = h.get('x-forwarded-for');
  const ip = (forwarded?.split(',')[0] ?? h.get('x-real-ip') ?? 'unknown').trim();
  return createHmac('sha256', process.env.TRIAL_IP_HASH_SECRET ?? '').update(ip).digest('hex');
}

export type TrialGateState =
  | { kind: 'dormant' }
  /** Pot empty/unreadable: the honest "log in om verder te gaan" degrade. */
  | { kind: 'closed' }
  /** THIS visitor's own budget is spent (the pot may still be open). */
  | { kind: 'used_up' }
  | { kind: 'open'; questionsLeft: number };

/** The landing's per-request gate read (server component): computed fresh on
 * every request so a pot refill re-opens the trial WITHOUT a deploy (owner
 * decision: auto re-enable). Fail-safe: any error reads as 'closed'. */
export async function getTrialGateState(): Promise<TrialGateState> {
  if (!trialConfigured()) return { kind: 'dormant' };
  try {
    const db = getDb();
    const pot = await getTrialPotStatus(db);
    if (pot === null || pot.remaining <= 0) return { kind: 'closed' };
    const visitorId = await readTrialVisitorId();
    if (visitorId === null) return { kind: 'open', questionsLeft: TRIAL_QUESTIONS_PER_VISITOR };
    const { rows } = await db.query(
      'select count(*)::int as n from trial_questions where visitor_id = $1 and not refunded',
      [visitorId],
    );
    const left = TRIAL_QUESTIONS_PER_VISITOR - Number(rows[0]!.n);
    return left > 0 ? { kind: 'open', questionsLeft: left } : { kind: 'used_up' };
  } catch (err) {
    console.warn('[trial] gate read failed, rendering closed:', err);
    return { kind: 'closed' };
  }
}

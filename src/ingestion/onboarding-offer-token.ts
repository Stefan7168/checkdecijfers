// WP16 sub-part 2 addendum (ADR 026, session 101, 2026-09-13): a signed,
// stateless "confirm this fetch?" offer — the confirm-first gate #109 said
// only the owner could authorize, now authorized. Modeled directly on
// src/chart/embed-token.ts (ADR 041): `{payload}.{signature}`, HMAC-SHA256,
// timingSafeEqual, fails closed (returns null) on anything malformed rather
// than throwing. The one difference from that token: the payload here is
// structured JSON, not a bare integer, because nothing is persisted
// server-side until the user actually confirms — the token IS the only place
// `tableId`/`confidence`/`candidateIds`/`questionText` live between the
// acknowledgment turn and the confirm click. See ADR 026's addendum for why
// this replaces a persisted "awaiting confirmation" row (no migration, no
// owner-supervised DDL step) and why the WP26 clickOptions client-trust
// pattern (validate-pending.ts) is NOT reused here (that pattern's safety
// argument — "the worst a forged option can do is become a normally-billed
// query over other real data" — does not hold for a token that authorizes an
// ingestion job and a 100-credit debit, not a query).
import { createHmac, timingSafeEqual } from 'node:crypto';

/** 30 minutes: long enough to notice and click a chat message, short enough
 * that a stale/abandoned tab can't fire a fetch against a topic the user has
 * long since stopped caring about, or against pricing/finder behavior that
 * may have changed since. Matches the acknowledgment copy's own "meestal een
 * kwestie van minuten" framing — this is the confirmation window, not the
 * fetch's own runtime. */
const OFFER_TTL_MS = 30 * 60 * 1000;

export interface OnboardingOfferPayload {
  userId: string;
  /** The ORIGINAL chat turn's requestId — reused verbatim by the confirm
   * action so triggerOnboarding's existing (user, request_id) uniqueness
   * index dedupes a double-click or a retried Server Action exactly the way
   * it already dedupes a retried askQuestion call. Never a freshly-minted id. */
  requestId: string;
  tableId: string;
  topicTerm: string;
  confidence: number;
  candidateIds: string[];
  questionText: string;
  /** The offer turn's own audit_answers row id — carried through so the
   * eventual pending_table_requests row (created on confirm, inside
   * triggerOnboarding) still links back to the turn that introduced it, the
   * same dashboard-join role ackAuditAnswerId always played. Null when the
   * offer's own audit write failed (respond-audited's existing fail-closed
   * policy — the offer still shows; the trigger just can't back-reference it,
   * unchanged from before this addendum). */
  ackAuditAnswerId: number | null;
}

interface SignedPayload extends OnboardingOfferPayload {
  expiresAt: number;
}

function encodePayload(payload: SignedPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function signatureFor(encoded: string, secret: string): string {
  return createHmac('sha256', secret).update(encoded).digest().toString('base64url');
}

export function signOnboardingOffer(payload: OnboardingOfferPayload, secret: string): string {
  const encoded = encodePayload({ ...payload, expiresAt: Date.now() + OFFER_TTL_MS });
  return `${encoded}.${signatureFor(encoded, secret)}`;
}

/** Verifies the signature and expiry, and returns the payload — WITHOUT
 * checking `userId` against the caller's real session. That check belongs to
 * the caller (confirmOnboardingFetch), which has the actual authenticated
 * session; this function only proves the token was minted by this server and
 * has not expired, exactly the fail-closed scope verifyEmbedToken has. Never
 * throws — every malformed shape, bad signature, or expired token returns
 * null, same convention as every other refusal path in this codebase. */
export function verifyOnboardingOffer(token: string, secret: string): OnboardingOfferPayload | null {
  const dot = token.indexOf('.');
  if (dot < 1) return null;

  const encoded = token.slice(0, dot);
  const sigPart = token.slice(dot + 1);
  if (encoded.length === 0 || sigPart.length === 0) return null;

  const expected = Buffer.from(signatureFor(encoded, secret));
  const actual = Buffer.from(sigPart);
  if (expected.length !== actual.length) return null;
  if (!timingSafeEqual(expected, actual)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!isSignedPayload(parsed)) return null;
  if (Date.now() > parsed.expiresAt) return null;

  const { expiresAt: _expiresAt, ...payload } = parsed;
  return payload;
}

function isSignedPayload(value: unknown): value is SignedPayload {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.userId === 'string' &&
    typeof v.requestId === 'string' &&
    typeof v.tableId === 'string' &&
    typeof v.topicTerm === 'string' &&
    typeof v.confidence === 'number' &&
    Array.isArray(v.candidateIds) &&
    v.candidateIds.every((id) => typeof id === 'string') &&
    typeof v.questionText === 'string' &&
    (v.ackAuditAnswerId === null || typeof v.ackAuditAnswerId === 'number') &&
    typeof v.expiresAt === 'number'
  );
}

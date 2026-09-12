// ADR 041 / spec Part B2: a signed, stateless chart-embed token. No database
// row per embed — the token IS the authorization. `{auditId}.{signature}`,
// HMAC-SHA256 over the decimal audit id, signature truncated to 16 bytes and
// base64url-encoded (22 chars, no padding). Verification is constant-time
// (`timingSafeEqual`) and never throws on malformed input — every failure
// mode returns `null`, matching the fail-closed convention `hasProPlan` and
// every other refusal path in this codebase use.
import { createHmac, timingSafeEqual } from 'node:crypto';

const SIGNATURE_BYTES = 16;

function signatureFor(auditId: number, secret: string): string {
  return createHmac('sha256', secret)
    .update(String(auditId))
    .digest()
    .subarray(0, SIGNATURE_BYTES)
    .toString('base64url');
}

export function signEmbedToken(auditId: number, secret: string): string {
  return `${auditId}.${signatureFor(auditId, secret)}`;
}

export function verifyEmbedToken(token: string, secret: string): number | null {
  const dot = token.indexOf('.');
  if (dot < 1) return null;

  const idPart = token.slice(0, dot);
  const sigPart = token.slice(dot + 1);
  if (!/^\d+$/.test(idPart) || sigPart.length === 0) return null;

  const auditId = Number(idPart);
  if (!Number.isSafeInteger(auditId) || auditId < 1) return null;

  const expected = Buffer.from(signatureFor(auditId, secret));
  const actual = Buffer.from(sigPart);
  if (expected.length !== actual.length) return null;
  if (!timingSafeEqual(expected, actual)) return null;

  return auditId;
}

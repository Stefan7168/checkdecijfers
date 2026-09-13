// The signed-in "mint an embed code" Server Action (spec Part B2). Kept to
// its own tiny file, same rationale as chart-style-actions.ts's own header
// comment: chart.tsx (a client component) must never drag this module's
// audit/db graph toward the client bundle by importing chart-style-actions.ts
// and this file from the same barrel.
'use server';

import { loadAuditRecord } from '../backend/answer/audit/index.ts';
import { signEmbedToken } from '../backend/chart/embed-token.ts';
import { hasProPlan } from '../backend/billing/pro.ts';
import { currentUserEmail, currentUserId } from '../lib/current-user.ts';
import { getDb } from '../lib/db.ts';
import { reportError } from '../lib/error-report.ts';

/** The retention redaction sentinel (`src/answer/audit/retention.ts`'s
 * `redactedResponse()`) lives INSIDE the stored response envelope, not as a
 * column on `AuditRecord` — mirrors `scripts/verify-audit-rows.ts`'s own
 * `isRedacted` helper exactly, so a redacted row can never be embedded. */
function isRedacted(response: unknown): boolean {
  return typeof response === 'object' && response !== null && (response as { redacted?: unknown }).redacted === true;
}

export type CreateEmbedCodeResult =
  | { ok: true; token: string; pro: boolean }
  | { ok: false; reason: 'unauthenticated' | 'not_found' | 'forbidden' | 'unavailable' | 'error' };

export async function createEmbedCode(auditId: number): Promise<CreateEmbedCodeResult> {
  const userId = await currentUserId();
  if (userId === null) return { ok: false, reason: 'unauthenticated' };

  const secret = process.env.EMBED_TOKEN_SECRET;
  if (!secret) return { ok: false, reason: 'unavailable' };

  try {
    const record = await loadAuditRecord(getDb(), auditId);
    if (record === null) return { ok: false, reason: 'not_found' };

    if (
      record.userId !== userId ||
      record.response.kind !== 'answer' ||
      record.response.chart === null ||
      isRedacted(record.response)
    ) {
      return { ok: false, reason: 'forbidden' };
    }

    const email = await currentUserEmail();
    const pro = hasProPlan({ id: userId, email });
    return { ok: true, token: signEmbedToken(auditId, secret), pro };
  } catch (e) {
    await reportError('createEmbedCode', e, { userId, extra: { auditId } });
    return { ok: false, reason: 'error' };
  }
}

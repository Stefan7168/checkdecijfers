// Journalist chart-headline server actions (session 105,
// docs/superpowers/specs/2026-09-16-chart-journalist-headline-design.md).
// Own tiny file, mirroring chart-insights-actions.ts / chart-style-actions.ts:
// chart.tsx imports only this, never web/app/actions.ts's much larger graph.
'use server';

import { AnthropicLlmClient } from '../backend/answer/llm/client.ts';
import { chartSpecSchema } from '../backend/chart/schema.ts';
import { draftHeadline } from '../backend/chart/headline-phrase.ts';
import {
  CHART_HEADLINE_MAX_LENGTH,
  getOwnChartHeadline,
  normalizeHeadlineText,
  upsertChartHeadline,
} from '../backend/chart/headline-store.ts';
import { currentUserId } from '../lib/current-user.ts';
import { getDb } from '../lib/db.ts';
import { reportError } from '../lib/error-report.ts';

export type DraftChartHeadlineResponse =
  | { ok: true; headline: string }
  | { ok: false; reason: 'unauthenticated' | 'invalid_spec' | 'no_findings' | 'error' };

export async function draftChartHeadline(rawSpec: unknown): Promise<DraftChartHeadlineResponse> {
  let userId: string | null = null;
  try {
    userId = await currentUserId();
    if (userId === null) return { ok: false, reason: 'unauthenticated' };

    const parsed = chartSpecSchema.safeParse(rawSpec);
    if (!parsed.success) return { ok: false, reason: 'invalid_spec' };

    const result = await draftHeadline(parsed.data, { client: new AnthropicLlmClient() });
    if (!result.ok) {
      // draftHeadline's own reason type ('no_findings' | 'phrasing_failed',
      // Task 3) is wider than this action's public contract, which has no
      // 'phrasing_failed' case (see DraftChartHeadlineResponse above) — an
      // AI phrasing failure folds into the generic 'error' reason; only
      // 'no_findings' (a real, distinct, chart-has-nothing-notable state) is
      // surfaced as its own reason.
      return { ok: false, reason: result.reason === 'no_findings' ? 'no_findings' : 'error' };
    }
    return { ok: true, headline: result.headline };
  } catch (e) {
    await reportError('draftChartHeadline', e, { userId });
    return { ok: false, reason: 'error' };
  }
}

export interface SaveChartHeadlineResponse {
  ok: boolean;
}

export async function saveChartHeadline(rawAuditId: unknown, rawHeadline: unknown): Promise<SaveChartHeadlineResponse> {
  try {
    const userId = await currentUserId();
    if (userId === null) return { ok: false };
    if (typeof rawAuditId !== 'number' || !Number.isSafeInteger(rawAuditId) || rawAuditId <= 0) {
      return { ok: false };
    }
    if (typeof rawHeadline !== 'string' || rawHeadline.length > CHART_HEADLINE_MAX_LENGTH * 2) {
      // Generous pre-normalize bound so a pasted-with-whitespace string
      // isn't rejected before normalizeHeadlineText gets to trim/cap it;
      // the real cap is enforced below via the normalized value.
      return { ok: false };
    }
    const headline = normalizeHeadlineText(rawHeadline);
    if (headline === null) return { ok: false };

    const ok = await upsertChartHeadline(getDb(), { auditAnswerId: rawAuditId, userId, headline });
    return { ok };
  } catch (e) {
    await reportError('saveChartHeadline', e, {});
    return { ok: false };
  }
}

export type FetchChartHeadlineResponse = { ok: true; headline: string | null } | { ok: false };

export async function fetchChartHeadline(rawAuditId: unknown): Promise<FetchChartHeadlineResponse> {
  try {
    const userId = await currentUserId();
    if (userId === null) return { ok: false };
    if (typeof rawAuditId !== 'number' || !Number.isSafeInteger(rawAuditId) || rawAuditId <= 0) {
      return { ok: false };
    }
    const headline = await getOwnChartHeadline(getDb(), rawAuditId, userId);
    return { ok: true, headline };
  } catch (e) {
    await reportError('fetchChartHeadline', e, {});
    return { ok: false };
  }
}

// Insights AI phrasing (session 94 owner ask) — the server action chart.tsx
// calls once a Story/Insights panel opens. Deliberately its own tiny file,
// the same chart-style-actions.ts precedent: chart.tsx (a client component)
// only ever imports this, never app/actions.ts's much larger graph.
//
// Trust boundary: the spec comes straight from the client that already has
// it rendered on screen (not re-fetched from an audit row) — it is NOT
// secret, and findings are re-derived HERE from the spec rather than trusted
// from any client-sent finding list, closing the one real risk (prompt-
// injection via a crafted finding string reaching the LLM prompt — the same
// concern answer/compose/prompt.ts's R2 discipline names). A tampered spec's
// worst case is AI-phrased nonsense shown back to that same user's own
// screen — never persisted, never another user's concern, unlike the core
// answer pipeline's stored, cited answers.
//
// No server-side rate limit yet (unlike lookupBrand's daily/monthly caps
// below) — deliberate v1 scope call, marked as an assumption: this path is
// authenticated-only, click-triggered (never automatic), and runs on the
// cheap PHRASING_MODEL tier with a short response. Revisit with a counter
// (mirroring chart_style_usage) if usage ever shows it's needed —
// docs/open-questions.md tracks this.
'use server';

import { AnthropicLlmClient } from '../backend/answer/llm/client.ts';
import { chartSpecSchema } from '../backend/chart/schema.ts';
import { scoreFindings } from '../backend/chart/insights.ts';
import { composeInsights } from '../backend/chart/insights-phrase.ts';
import { currentUserId } from '../lib/current-user.ts';
import { reportError } from '../lib/error-report.ts';

export type GenerateInsightsResponse =
  | { ok: true; phrased: Record<string, string> }
  | { ok: false; reason: 'unauthenticated' | 'invalid_spec' | 'error' };

/**
 * AI-phrases the top findings for a chart spec the caller already has
 * rendered. Never throws: any failure — auth, a malformed spec, a provider
 * outage, a validation reject — resolves to a typed outcome. An empty
 * `phrased` map (spec parses fine but has 0 findings, or every finding
 * failed phrasing) is `{ ok: true, phrased: {} }`, not an error — the
 * caller's own deterministic captions (chart-insights.ts) are the floor
 * either way, so there is nothing exceptional about "no AI text yet".
 */
export async function generateInsights(rawSpec: unknown): Promise<GenerateInsightsResponse> {
  let userId: string | null = null;
  try {
    userId = await currentUserId();
    if (userId === null) return { ok: false, reason: 'unauthenticated' };

    const parsed = chartSpecSchema.safeParse(rawSpec);
    if (!parsed.success) return { ok: false, reason: 'invalid_spec' };

    const findings = scoreFindings(parsed.data);
    const result = await composeInsights(findings, { client: new AnthropicLlmClient() });
    return { ok: true, phrased: Object.fromEntries(result.phrased) };
  } catch (e) {
    await reportError('generateInsights', e, { userId });
    return { ok: false, reason: 'error' };
  }
}

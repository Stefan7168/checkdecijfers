// Journalist chart-headline drafting (session 105,
// docs/superpowers/specs/2026-09-16-chart-journalist-headline-design.md).
// Deliberately NOT a new LLM mechanism: this is a thin wrapper around the
// SAME digit-free slot-filling mechanism ADR 041 already proved for Insights
// (src/chart/insights-phrase.ts's composeInsights) — a fabricated number
// stays structurally unrepresentable here for exactly the same reason it
// does there. Only the chart's single top-ranked finding (scoreFindings's
// own ranking, unchanged) is phrased, since a headline is one sentence
// about the chart's most notable point, not a per-finding list.
import { scoreFindings } from './insights.ts';
import { composeInsights, type ComposeInsightsOptions } from './insights-phrase.ts';
import type { ChartSpec } from './types.ts';

export type DraftHeadlineResult =
  | { ok: true; headline: string }
  | { ok: false; reason: 'no_findings' | 'phrasing_failed' };

export async function draftHeadline(spec: ChartSpec, options: ComposeInsightsOptions): Promise<DraftHeadlineResult> {
  const findings = scoreFindings(spec);
  if (findings.length === 0) return { ok: false, reason: 'no_findings' };

  const top = findings[0]!;
  const result = await composeInsights([top], options);
  const phrase = result.phrased.get(top.id);
  if (phrase === undefined) return { ok: false, reason: 'phrasing_failed' };
  return { ok: true, headline: phrase };
}

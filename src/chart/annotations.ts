// #170(4) — curated event annotations for the "Ontdek Nederland in
// grafieken" homepage charts (open-questions #170 item 4; design note:
// docs/session-briefs/2026-07-18-parked-ideas-architecture-sketches.md §4).
//
// A small, hand-curated set of real, uncontroversial historical/economic
// reference points — DETERMINISTIC and CURATED ONLY, never LLM-generated,
// never auto-derived from news (project-wide rule: only deterministic code
// and human-curated data may produce user-facing factual claims). Mirrors
// how src/chart/curated.ts's own ONTDEK_CHARTS array is curated: a plain,
// committed TypeScript const, not a database table — there are only a
// handful of hand-picked dates here, which is code review's job to keep
// honest, not a runtime CRUD surface.
//
// Neutrality guardrail (from the design note): labels NAME events, they do
// not INTERPRET them ("crisis door beleid X") — every label below is a bare,
// dated, widely-documented fact. This is Dutch product copy and — like any
// other curated Dutch string in this codebase — should get an owner read
// before it ships live.
//
// Each entry names a calendar date plus the canonical measure keys it is
// judged relevant to (design note: "which canonical keys it applies to") —
// broad macro-economic shocks are relevant to every curated measure today,
// but the field lets a future, narrower annotation (e.g. a change relevant
// to one measure only) target just that measure. A curated date is converted
// to a CBS-style period code PER GRAIN by hand (never at runtime by date
// arithmetic) for the two grains ONTDEK_CHARTS actually uses today (MM, KW);
// a chart at a grain an entry has no code for simply never shows it — a safe
// no-op, not an error.
import type { PeriodGrain } from '../query/index.ts';
import type { ChartAnnotation } from './types.ts';

export interface ChartAnnotationDefinition {
  /** Stable id for tests/debugging — never shown to a user. */
  slug: string;
  /** Ready-to-display Dutch label, curated verbatim (renderers never format
   * or derive this text — R6's "no computation" discipline applied to
   * metadata). Carries its own human-readable date mention so no renderer
   * needs date-formatting logic to show it meaningfully. */
  label: string;
  /** canonical_measures keys (ADR 010) this annotation is considered
   * relevant to. */
  canonicalKeys: string[];
  /** Hand-authored CBS-style period code per grain this event may be shown
   * at. A grain absent here is simply never annotated by this entry. */
  periodCodes: Partial<Record<PeriodGrain, string>>;
}

/** The initial curated set (session 66, 2026-08-27): three real,
 * uncontroversial macro-economic reference points, deliberately small — this
 * proves the mechanism, not an exhaustive historical timeline (more can be
 * added later, with no schema change). All five ONTDEK_CHARTS measures
 * (consumer confidence, GDP growth, inflation, house prices, unemployment)
 * are broad macro series any of these three genuinely affected, hence the
 * shared canonicalKeys list below.
 *
 * **Known limitation, not a bug:** ONTDEK_CHARTS windows are ROLLING (2
 * years of months / 3 years of quarters ending at the freshest ingested
 * period — ADR 035 D1), so with TODAY's window lengths none of these three
 * (2008/2020/2022) currently falls inside any live chart's plotted range —
 * confirmed against the committed fixtures (freshest ~2026MM06 / ~2026KW01).
 * The mechanism is proven directly in tests/chart/annotations.test.ts and
 * tests/chart/render-svg.test.ts against a constructed in-range spec rather
 * than relying on today's live window; a future nearer-term event, or a
 * deliberate window-length change (a separate product decision, not made
 * here), will make an entry like this visible on the live homepage without
 * any further schema or mechanism change. */
export const CHART_ANNOTATIONS: ChartAnnotationDefinition[] = [
  {
    slug: 'financiele-crisis-2008',
    label: 'Financiële crisis: val Lehman Brothers (september 2008)',
    canonicalKeys: [
      'consumer_confidence_seasonally_adjusted',
      'gdp_growth_yoy_volume',
      'cpi_yearly_inflation',
      'average_existing_home_sale_price',
      'unemployment_rate_seasonally_adjusted',
    ],
    periodCodes: { MM: '2008MM09', KW: '2008KW03' },
  },
  {
    slug: 'coronacrisis-start',
    label: 'Coronacrisis: eerste lockdown (maart 2020)',
    canonicalKeys: [
      'consumer_confidence_seasonally_adjusted',
      'gdp_growth_yoy_volume',
      'cpi_yearly_inflation',
      'average_existing_home_sale_price',
      'unemployment_rate_seasonally_adjusted',
    ],
    periodCodes: { MM: '2020MM03', KW: '2020KW01' },
  },
  {
    slug: 'oekraine-oorlog-start',
    label: 'Start Oekraïne-oorlog (februari 2022)',
    canonicalKeys: [
      'consumer_confidence_seasonally_adjusted',
      'gdp_growth_yoy_volume',
      'cpi_yearly_inflation',
      'average_existing_home_sale_price',
      'unemployment_rate_seasonally_adjusted',
    ],
    periodCodes: { MM: '2022MM02', KW: '2022KW01' },
  },
];

/** Pure selection: which curated annotations apply to THIS chart, at exactly
 * the period codes it actually plots. `periodCodesInView` must be the
 * chart's own already-validated series period codes (never a computed
 * range) — an annotation whose period code is not literally one of them is
 * dropped rather than placed at an approximate or interpolated position (R6's
 * "verbatim projection" discipline extended to metadata). Order follows
 * CHART_ANNOTATIONS (chronological by construction, curated by hand). */
export function selectAnnotations(
  canonicalKey: string,
  grain: PeriodGrain,
  periodCodesInView: readonly string[],
): ChartAnnotation[] {
  const inView = new Set(periodCodesInView);
  const result: ChartAnnotation[] = [];
  for (const def of CHART_ANNOTATIONS) {
    if (!def.canonicalKeys.includes(canonicalKey)) continue;
    const periodCode = def.periodCodes[grain];
    if (periodCode === undefined) continue;
    if (!inView.has(periodCode)) continue;
    result.push({ periodCode, label: def.label });
  }
  return result;
}

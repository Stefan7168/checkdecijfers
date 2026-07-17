// Curated discovery charts — the "Ontdek Nederland in grafieken" homepage
// section (owner decision session 51, open-questions #53(c); ADR 035). A
// fixed, hand-curated set of chart intents over canonical registry keys,
// built through the SAME deterministic pipeline chat answers use:
//
//   freshestForCanonical → hand-authored StructuredIntent (range ending at
//   the freshest ingested period) → runQuery → buildChartSpec
//
// No LLM anywhere (the intent is authored here, in code), no money path, no
// audit rows (these are not answers to a user question — ADR 035 D4; R1
// traceability still holds structurally: every point carries its resultId in
// the spec). Every spec carries its own R4 attribution and R11 provisional
// marking exactly like a chat chart — no separate rendering rules exist for
// the public page.
//
// Failure posture (principle c + the #53 empty-pot fail-safe philosophy): a
// series that cannot be served honestly — missing table, quarantined table,
// unexpected grain, any typed refusal, a spec-builder refusal — is SKIPPED
// with a recorded reason, never guessed at and never allowed to break the
// section for the healthy series. The hermetic gate test pins that all
// curated series DO build against the committed fixtures, so a skip in
// production is a data regression, not an accepted steady state.
import type { Db } from '../db/types.ts';
import { encodePeriodCode, parsePeriodCode, type ParsedPeriod } from '../ingestion/periods.ts';
import type { PeriodGrain, StructuredIntent } from '../query/index.ts';
import { freshestForCanonical, runQuery } from '../query/index.ts';
import { buildChartSpec } from './build.ts';
import type { ChartSpec } from './types.ts';

export interface CuratedChartDefinition {
  /** Stable identifier for logs, skip reports and React keys. */
  slug: string;
  /** canonical_measures key (ADR 010) — the same vocabulary the intent
   * parser emits, so the landing can never name a coordinate the registry
   * does not pin. */
  canonicalKey: string;
  /** The grain this chart is designed for. The freshest-period anchor is
   * grain-agnostic; if the freshest ingested period is ever of a different
   * grain, the chart is skipped rather than silently switching cadence. */
  grain: PeriodGrain;
  /** Number of periods plotted, ending at the freshest ingested period. */
  windowLength: number;
}

/** The owner-approved discovery set (session 51): the four series named in
 * the session-52 kickoff, all live in the registry. Windows are sized to
 * read as a story at a glance: two years of months, three years of
 * quarters. */
export const ONTDEK_CHARTS: CuratedChartDefinition[] = [
  {
    slug: 'consumentenvertrouwen',
    canonicalKey: 'consumer_confidence_seasonally_adjusted',
    grain: 'MM',
    windowLength: 24,
  },
  {
    slug: 'economische-groei',
    canonicalKey: 'gdp_growth_yoy_volume',
    grain: 'KW',
    windowLength: 12,
  },
  {
    slug: 'inflatie',
    canonicalKey: 'cpi_yearly_inflation',
    grain: 'MM',
    windowLength: 24,
  },
  {
    slug: 'huizenprijzen',
    canonicalKey: 'average_existing_home_sale_price',
    grain: 'MM',
    windowLength: 24,
  },
];

export interface CuratedChart {
  slug: string;
  spec: ChartSpec;
}

export interface CuratedChartsOutcome {
  charts: CuratedChart[];
  /** Series that could not be served honestly, with the reason — for server
   * logs and the gate test, never for silent disappearance. */
  skipped: { slug: string; reason: string }[];
}

/** The period `steps` positions before `p` at the same grain (calendar
 * arithmetic, so windows cross year boundaries correctly). The index is
 * derived from the floored year — never from JS's `%`, whose negative
 * remainder would emit an out-of-range index once `total` goes negative
 * (adversarial-review finding, session 52). */
export function periodStepsBack(p: ParsedPeriod, steps: number): ParsedPeriod {
  if (p.grain === 'JJ') return { grain: 'JJ', year: p.year - steps, index: null };
  const perYear = p.grain === 'KW' ? 4 : 12;
  const total = p.year * perYear + (p.index ?? 1) - 1 - steps;
  const year = Math.floor(total / perYear);
  return { grain: p.grain, year, index: total - year * perYear + 1 };
}

async function buildOne(
  db: Db,
  def: CuratedChartDefinition,
): Promise<{ slug: string; spec: ChartSpec } | { slug: string; reason: string }> {
  const { slug } = def;
  // DB-call throws (connection reset, timeout) deliberately PROPAGATE out of
  // this function: an I/O throw is transient-shaped, and folding it into a
  // 'skip' would let one blip get cached as a smaller chart set for a full
  // TTL while bypassing the web layer's stale-over-nothing fallback
  // (adversarial-review finding, session 52). Only DETERMINISTIC cannot-serve
  // outcomes below become skips — those reproduce identically on every
  // rebuild, so caching them is honest.
  const freshest = await freshestForCanonical(db, def.canonicalKey);
  if (freshest === null) {
    return { slug, reason: `no freshest period for '${def.canonicalKey}' (table absent or quarantined)` };
  }
  const anchor = parsePeriodCode(freshest.periodCode);
  if (anchor === null || anchor.grain !== def.grain) {
    return {
      slug,
      reason: `freshest period ${freshest.periodCode} is not at the designed grain ${def.grain}`,
    };
  }
  const intent: StructuredIntent = {
    schemaVersion: 1,
    target: { kind: 'canonical', key: def.canonicalKey },
    period: {
      kind: 'range',
      from: encodePeriodCode(periodStepsBack(anchor, def.windowLength - 1)),
      to: freshest.periodCode,
    },
    derivation: 'series',
  };
  const outcome = await runQuery(db, intent);
  if (!outcome.ok) {
    return { slug, reason: `query refused (${outcome.refusal.kind}): ${outcome.refusal.message}` };
  }
  try {
    const spec = buildChartSpec(outcome);
    if (spec === null) {
      return { slug, reason: `result shape '${outcome.shape}' yields no chart` };
    }
    return { slug, spec };
  } catch (err) {
    // buildChartSpec is PURE — a throw here is deterministic upstream data
    // corruption (mixed units etc.), never a transient. Quarantine THIS
    // chart with the loud reason in the skip report; the other series keep
    // serving (mirrors the per-table quarantine posture).
    return { slug, reason: `chart build failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

export async function buildCuratedCharts(db: Db): Promise<CuratedChartsOutcome> {
  const results = await Promise.all(ONTDEK_CHARTS.map((def) => buildOne(db, def)));
  const outcome: CuratedChartsOutcome = { charts: [], skipped: [] };
  for (const result of results) {
    if ('spec' in result) outcome.charts.push(result);
    else outcome.skipped.push(result);
  }
  return outcome;
}

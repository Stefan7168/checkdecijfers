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
//
// #170(4), session 66: two additive extensions to that same pipeline, both
// OPTIONAL per chart definition so the original four charts are byte-for-
// byte unchanged. (1) Curated event annotations (src/chart/annotations.ts)
// are merged into the built spec's `annotations` field — metadata, never a
// data value, added AFTER buildChartSpec runs, never inside it. (2) A narrow
// definition toggle (CuratedChartDefinition.alternateReading): when a
// definition names one, a SECOND spec is built over the identical period
// window via an explicit (table + measure + alternate dims) target — the
// SAME runQuery → buildChartSpec path, so it is exactly as validated as the
// primary. Building the alternate can degrade (toggleSkipped) without
// touching the primary chart; it never blocks or weakens it.
import type { Db } from '../db/types.ts';
import { encodePeriodCode, parsePeriodCode, type ParsedPeriod } from '../ingestion/periods.ts';
import type { PeriodGrain, StructuredIntent, ValidatedResult } from '../query/index.ts';
import { freshestForCanonical, runQuery } from '../query/index.ts';
import { selectAnnotations } from './annotations.ts';
import { buildChartSpec } from './build.ts';
import type { ChartSpec } from './types.ts';

/** #170(4), narrow-scope definition toggle: an alternate reading of the SAME
 * table + measure a curated chart already uses, differing only by semantic
 * dims — a REAL registry alternate (`CANONICAL_MEASURES[canonicalKey]
 * .alternates` in `src/registry/defaults.ts`), copied here by hand, never a
 * fabricated coordinate. This is deliberately the NARROW form: one hardcoded
 * alternate per chart definition, not a general definition-switching
 * mechanism (open-questions #46, Phase-2-tied, stays unbuilt — see the
 * design note in docs/session-briefs/2026-07-18-parked-ideas-architecture-
 * sketches.md §4). */
export interface CuratedChartAlternateReading {
  /** Button label for the alternate reading — copied verbatim from the
   * registry alternate's own `label`, never invented copy. */
  label: string;
  /** The alternate's semantic dims coordinate(s). Same table + measure as
   * the primary canonical reading (resolved at build time from the
   * primary's own ValidatedResult), differing only by these. */
  dims: Record<string, string>;
}

/** Both specs are independently built server-side through the SAME
 * `runQuery` → `buildChartSpec` path (R6) over the identical period window —
 * the client toggle only ever swaps which already-validated spec is shown,
 * never computes or blends one. */
export interface CuratedChartToggle {
  /** Button label for the PRIMARY (canonical) reading. */
  primaryLabel: string;
  alternateLabel: string;
  alternateSpec: ChartSpec;
}

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
  /** #170(4): when present, a second spec is built for the same window
   * using this alternate reading, and the client offers a two-state
   * switcher (CuratedChart.toggle). A definition without this field behaves
   * exactly as before this feature existed. */
  alternateReading?: CuratedChartAlternateReading;
  /** Button label for the PRIMARY reading's toggle button. Only meaningful
   * together with alternateReading. */
  primaryReadingLabel?: string;
}

/** The owner-approved discovery set (session 51): the four series named in
 * the session-52 kickoff, all live in the registry, plus one added session
 * 66 (#170(4) — see its own comment below for why). Windows are sized to
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
  // #170(4), session 66: added specifically to carry the definition toggle
  // proof-of-mechanism — the only CANONICAL_MEASURES entry in
  // src/registry/defaults.ts whose `alternates` names a genuine same-table,
  // same-measure seizoengecorrigeerd/ongecorrigeerd pair (dims-only, no
  // measure-code change); none of the four charts above have one (checked:
  // their own `alternates`, where present, differ by MEASURE code or table,
  // not by this dims-based seasonal-adjustment reading). Three years of
  // quarters, matching economische-groei's own cadence.
  {
    slug: 'werkloosheid',
    canonicalKey: 'unemployment_rate_seasonally_adjusted',
    grain: 'KW',
    windowLength: 12,
    primaryReadingLabel: 'seizoengecorrigeerd',
    alternateReading: {
      // Copied verbatim from CANONICAL_MEASURES['unemployment_rate_seasonally_adjusted']
      // .alternates[0] (src/registry/defaults.ts) — keep in sync if that
      // registry entry ever changes.
      label: 'oorspronkelijke, ongecorrigeerde cijfers',
      dims: { SeizoenEnWerkdagcorrectie: 'A042501' },
    },
  },
];

export interface CuratedChart {
  slug: string;
  spec: ChartSpec;
  /** #170(4): present only when the definition carried an alternateReading
   * AND it built successfully. A failed or refused alternate build degrades
   * to no toggle (the primary chart still serves, unchanged) rather than
   * failing the whole chart — see CuratedChartsOutcome.toggleSkipped. */
  toggle?: CuratedChartToggle;
}

export interface CuratedChartsOutcome {
  charts: CuratedChart[];
  /** Series that could not be served honestly, with the reason — for server
   * logs and the gate test, never for silent disappearance. */
  skipped: { slug: string; reason: string }[];
  /** #170(4): a chart that DID build (present in `charts`) but whose
   * configured toggle could not — logged the same way `skipped` is, never a
   * silent omission. */
  toggleSkipped: { slug: string; reason: string }[];
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

/** #170(4): build the alternate reading over the IDENTICAL period window the
 * primary reading resolved, targeting the same table + measure the primary
 * outcome actually used (never re-derived from the registry independently —
 * this guarantees "same measure, different dims" rather than risking a
 * second, possibly-inconsistent lookup) with the alternate's dims swapped
 * in. A DB throw here is transient-shaped and PROPAGATES, mirroring
 * buildOne's own policy (see its header comment) — only a deterministic
 * cannot-serve outcome (refusal, no-chart shape, or a buildChartSpec
 * corruption throw) degrades to "no toggle", never the transient case. */
async function buildAlternateSpec(
  db: Db,
  primary: ValidatedResult,
  primaryIntent: StructuredIntent,
  alt: CuratedChartAlternateReading,
): Promise<{ spec: ChartSpec } | { reason: string }> {
  const altIntent: StructuredIntent = {
    schemaVersion: 1,
    target: {
      kind: 'explicit',
      tableId: primary.attribution.tableId,
      measure: primary.cells[0]!.measure,
      dims: alt.dims,
    },
    period: primaryIntent.period,
    derivation: 'series',
  };
  const altOutcome = await runQuery(db, altIntent);
  if (!altOutcome.ok) {
    return { reason: `alternate reading refused (${altOutcome.refusal.kind}): ${altOutcome.refusal.message}` };
  }
  try {
    const spec = buildChartSpec(altOutcome);
    if (spec === null) return { reason: `alternate reading shape '${altOutcome.shape}' yields no chart` };
    return { spec };
  } catch (err) {
    return { reason: `alternate reading chart build failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

interface BuildOneSuccess {
  slug: string;
  spec: ChartSpec;
  toggle?: CuratedChartToggle;
  /** Present only when alternateReading was configured but could not build —
   * distinct from a whole-chart skip: the chart itself still serves. */
  toggleSkipReason?: string;
}

async function buildOne(
  db: Db,
  def: CuratedChartDefinition,
): Promise<BuildOneSuccess | { slug: string; reason: string }> {
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
  let rawSpec: ChartSpec | null;
  try {
    rawSpec = buildChartSpec(outcome);
  } catch (err) {
    // buildChartSpec is PURE — a throw here is deterministic upstream data
    // corruption (mixed units etc.), never a transient. Quarantine THIS
    // chart with the loud reason in the skip report; the other series keep
    // serving (mirrors the per-table quarantine posture).
    return { slug, reason: `chart build failed: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (rawSpec === null) {
    return { slug, reason: `result shape '${outcome.shape}' yields no chart` };
  }
  // #170(4) annotations: curated metadata merged in AFTER the deterministic
  // spec builder, never inside it (buildChartSpec stays the one shared,
  // unmodified producer chat answers use too — R6). Selection is restricted
  // to period codes THIS spec actually plots, so a marker is never placed
  // outside the real, validated window.
  const spec: ChartSpec = {
    ...rawSpec,
    annotations: selectAnnotations(
      def.canonicalKey,
      def.grain,
      rawSpec.series[0]!.points.map((p) => p.periodCode),
    ),
  };
  if (def.alternateReading === undefined) {
    return { slug, spec };
  }
  const altResult = await buildAlternateSpec(db, outcome, intent, def.alternateReading);
  if ('reason' in altResult) {
    return { slug, spec, toggleSkipReason: altResult.reason };
  }
  return {
    slug,
    spec,
    toggle: {
      primaryLabel: def.primaryReadingLabel ?? spec.title,
      alternateLabel: def.alternateReading.label,
      alternateSpec: altResult.spec,
    },
  };
}

export async function buildCuratedCharts(db: Db): Promise<CuratedChartsOutcome> {
  const results = await Promise.all(ONTDEK_CHARTS.map((def) => buildOne(db, def)));
  const outcome: CuratedChartsOutcome = { charts: [], skipped: [], toggleSkipped: [] };
  for (const result of results) {
    if ('spec' in result) {
      outcome.charts.push({ slug: result.slug, spec: result.spec, toggle: result.toggle });
      if (result.toggleSkipReason !== undefined) {
        outcome.toggleSkipped.push({ slug: result.slug, reason: result.toggleSkipReason });
      }
    } else {
      outcome.skipped.push(result);
    }
  }
  return outcome;
}

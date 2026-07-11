// WP29 (#73, ADR 029): follow-up suggestion chips under an answer.
//
// Four DETERMINISTIC generators over the answered intent + the registry —
// no LLM anywhere (principle a): chip copy is a templated QUESTION over
// registry labels, never a number, never a claim. Every candidate is
// servability-gated through the #56 echoServability dry-run before it may
// surface (ADR 029 D2 / the R7-options rule: an offered option must resolve
// in loaded data — an ungated chip invites the paid dead-end that deferred
// #73). Unservable candidates are silently dropped; zero survivors → no
// chips at all.
//
// Confinement mirrors dry-run.ts: EchoServability carries no cells and no
// values by construction, so this module can never see a data value — the
// same structural no-numbers guarantee the refusal templates have (ADR 015).
// The chip TEXT is built from labels and period codes only.
//
// v1 click behavior lives in web/components/chat.tsx: FILL the input, never
// send (the proven #75 convention — no new charged entry point). Because the
// filled text goes through a fresh LLM parse, every generated question is
// FULLY explicit (measure label, region names, period words) — the shape
// that parses confidently (ADR 029 D3). Inclusive ranges say "tot en met",
// matching the #75 example chip and policy.ts's own range options (the
// brief's "van X tot Y" sketch left the inclusivity wording to the repo
// convention).
import { INTENT_SCHEMA_VERSION } from '../../query/index.ts';
import type { StructuredIntent, ValidatedResult } from '../../query/index.ts';
import type { ServabilityCheck } from '../intent/policy.ts';
import { baseLabel, stepPeriodCode } from '../intent/resolve.ts';
import { CANONICAL_MEASURES } from '../../registry/defaults.ts';
import type { CanonicalMeasure } from '../../registry/types.ts';
import { periodCodeToNl } from './period-nl.ts';

/** ADR 029 D1: at most 3 chips shown, fixed generator priority. */
export const MAX_SUGGESTIONS = 3;

/** CBS's standard RegioS code for the whole country — fixture-confirmed on
 * every geo table we ingest (the codes-RegioS.json fixtures). Only used to
 * BUILD a candidate intent; the dry-run gates it, so a table using a
 * different national code simply drops the chip (never a wrong offer). */
const NATIONAL_REGION_CODE = 'NL01';

/** The G4 comparison set (ADR 029 D1 generator 3, national-answer branch).
 * Copy says "Den Haag" (what users say); the parser's own alias map resolves
 * it to CBS's 's-Gravenhage label (resolve.ts REGION_NAME_ALIASES). Codes are
 * CBS's stable gemeente codes; the dry-run gates them like every candidate. */
const G4 = [
  { code: 'GM0363', name: 'Amsterdam' },
  { code: 'GM0599', name: 'Rotterdam' },
  { code: 'GM0518', name: 'Den Haag' },
  { code: 'GM0344', name: 'Utrecht' },
];

/** Dutch listing: "A", "A en B", "A, B en C". */
function joinNl(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} en ${items[items.length - 1]}`;
}

interface SuggestionContext {
  intent: StructuredIntent;
  result: ValidatedResult;
  check: ServabilityCheck;
  registry: readonly CanonicalMeasure[];
  /** The answered subject for chip copy — attribution.definitionLabel (the
   * same field template.ts's subject() reads). Null for explicit targets:
   * those generators drop rather than guess a label (the brief's rule). */
  label: string | null;
  /** Earliest/latest answered period codes (cells are ordered by period
   * ascending — ValidatedResult contract). */
  firstPeriod: string;
  lastPeriod: string;
  /** The answered regions, verbatim intent codes (empty = national-only
   * measure: resolveRegions emits no codes for those). */
  regions: string[];
  /** Display names for the answered regions, in cell order, parentheticals
   * stripped ("Utrecht (gemeente)" → "Utrecht") — built from the cells' own
   * CBS labels, never re-derived from codes. */
  regionNames: string[];
  /** ` in Amsterdam` / ` in Amsterdam en Rotterdam` / '' — the copy fragment
   * naming the answered regions, so a filled chip re-parses onto the same
   * region (ADR 029 D3: fully-explicit question text). */
  regionPhrase: string;
}

async function servable(ctx: SuggestionContext, intent: StructuredIntent): Promise<boolean> {
  return (await ctx.check(intent)).servable;
}

/** Candidate intent sharing the answered target/regions, with a new period
 * selection and derivation — the shape every generator varies. */
function variant(
  ctx: SuggestionContext,
  period: StructuredIntent['period'],
  derivation: StructuredIntent['derivation'],
  regions: string[] = ctx.regions,
): StructuredIntent {
  return {
    schemaVersion: INTENT_SCHEMA_VERSION,
    target: ctx.intent.target,
    ...(regions.length > 0 ? { regions } : {}),
    period,
    derivation,
  };
}

/** Generator 1 — adjacent period: the answered period shifted to the nearest
 * loaded neighbor. "Next" is preferred; when the answer already sits at the
 * latest loaded period (the dry-run says next is not servable), fall back to
 * the period before the answered window. The dry-run IS the loadedness
 * check — no db access here. */
async function adjacentPeriod(ctx: SuggestionContext): Promise<string | null> {
  if (ctx.label === null) return null;
  const neighbors = [stepPeriodCode(ctx.lastPeriod, 1), stepPeriodCode(ctx.firstPeriod, -1)];
  for (const code of neighbors) {
    if (code === null) continue;
    if (await servable(ctx, variant(ctx, { kind: 'codes', codes: [code] }, 'none'))) {
      return `Wat was ${ctx.label}${ctx.regionPhrase} in ${periodCodeToNl(code)}?`;
    }
  }
  return null;
}

/** Generator 2 — trend: a series over a window ending at the answered
 * period, at the answered grain. Tries a five-period window first, then the
 * three-period minimum (the brief's "≥3 periods loaded" floor); the dry-run
 * proves the whole window serves gap-free (runQuery's completeness pass), so
 * a named range is never a range we cannot deliver. Skipped when the answer
 * already IS a series — the chip would re-ask the question just answered. */
async function trend(ctx: SuggestionContext): Promise<string | null> {
  if (ctx.label === null) return null;
  if (ctx.result.shape === 'series' || ctx.intent.derivation === 'series') return null;
  // A multi-region series is a shape the query layer refuses (several regions
  // AND several periods) — don't burn dry-runs on it.
  if (ctx.regions.length > 1) return null;
  for (const span of [5, 3]) {
    const from = stepPeriodCode(ctx.lastPeriod, -(span - 1));
    if (from === null) continue;
    const candidate = variant(ctx, { kind: 'range', from, to: ctx.lastPeriod }, 'series');
    if (await servable(ctx, candidate)) {
      return (
        `Hoe ontwikkelde ${ctx.label}${ctx.regionPhrase} zich van ` +
        `${periodCodeToNl(from)} tot en met ${periodCodeToNl(ctx.lastPeriod)}?`
      );
    }
  }
  return null;
}

/** Generator 3 — region variant, only when the measure is regional (the
 * answered intent carries region codes; national-only measures never do —
 * resolveRegions contract). A sub-national answer offers the national
 * figure; a national answer offers the G4 comparison. One region chip max. */
async function regionVariant(ctx: SuggestionContext): Promise<string | null> {
  if (ctx.label === null) return null;
  if (ctx.regions.length === 0) return null;
  const answeredNational = ctx.regions.every((code) => code.startsWith('NL'));
  const period: StructuredIntent['period'] = { kind: 'codes', codes: [ctx.lastPeriod] };
  if (answeredNational) {
    const candidate = variant(ctx, period, 'none', G4.map((g) => g.code));
    if (await servable(ctx, candidate)) {
      return (
        `Wat was ${ctx.label} in de gemeentes ${joinNl(G4.map((g) => g.name))} ` +
        `in ${periodCodeToNl(ctx.lastPeriod)}?`
      );
    }
    return null;
  }
  const candidate = variant(ctx, period, 'none', [NATIONAL_REGION_CODE]);
  if (await servable(ctx, candidate)) {
    return `Wat was ${ctx.label} in Nederland in ${periodCodeToNl(ctx.lastPeriod)}?`;
  }
  return null;
}

/** Generator 4 — same topic: another canonical measure on the SAME table
 * (first by key order, skipping the answered one), asked with ITS everyday
 * term. The candidate intent carries the sibling's canonical key and the
 * answered period/regions — complete, so the dry-run is meaningful and the
 * filled text re-parses onto the sibling's own definition. */
async function sameTopic(ctx: SuggestionContext): Promise<string | null> {
  if (ctx.intent.target.kind !== 'canonical') return null;
  const answeredKey = ctx.intent.target.key;
  const sibling = ctx.registry
    .filter((m) => m.tableId === ctx.result.attribution.tableId && m.key !== answeredKey)
    .sort((a, b) => a.key.localeCompare(b.key))[0];
  const term = sibling?.everydayTerms[0];
  if (!sibling || !term) return null;
  const candidate: StructuredIntent = {
    schemaVersion: INTENT_SCHEMA_VERSION,
    target: { kind: 'canonical', key: sibling.key },
    ...(ctx.regions.length > 0 ? { regions: ctx.regions } : {}),
    period: { kind: 'codes', codes: [ctx.lastPeriod] },
    derivation: 'none',
  };
  if (await servable(ctx, candidate)) {
    return `Hoeveel ${term} waren er${ctx.regionPhrase} in ${periodCodeToNl(ctx.lastPeriod)}?`;
  }
  return null;
}

/** Builds the servability-gated follow-up chips for an answered question
 * (ADR 029): candidates in fixed priority (adjacent period → trend → region
 * variant → same topic), each dry-run through `check`, first MAX_SUGGESTIONS
 * survivors kept. Pure apart from the injected dry-run; FAIL-OPEN — any
 * throw anywhere (including a throwing check) returns [] so a suggestions
 * hiccup can never cost the user the paid answer (the same rule
 * web/app/actions.ts applies to outcomeContext). `registry` is injectable
 * for tests only; production call sites take the default. */
export async function buildSuggestions(
  intent: StructuredIntent,
  result: ValidatedResult,
  check: ServabilityCheck,
  registry: readonly CanonicalMeasure[] = CANONICAL_MEASURES,
): Promise<string[]> {
  try {
    const cells = result.cells;
    const firstPeriod = cells[0]?.periodCode;
    const lastPeriod = cells[cells.length - 1]?.periodCode;
    if (firstPeriod === undefined || lastPeriod === undefined) return [];

    // Region display names from the cells' own labels, unique, in cell order.
    const regionNames: string[] = [];
    for (const cell of cells) {
      if (cell.regionLabel === null) continue;
      const name = baseLabel(cell.regionLabel.replace(/\s+/g, ' ').trim());
      if (!regionNames.includes(name)) regionNames.push(name);
    }
    const regions = intent.regions ?? [];
    // Drop-never-guess: an intent with regions whose cells carry no labels
    // (or vice versa) has no honest region wording — generate nothing that
    // names a region. Empty-region generators still run.
    const regionPhrase =
      regions.length > 0 && regionNames.length === regions.length
        ? ` in ${joinNl(regionNames)}`
        : '';
    const ctx: SuggestionContext = {
      intent,
      result,
      check,
      registry,
      label: result.attribution.definitionLabel,
      firstPeriod,
      lastPeriod,
      regions: regions.length > 0 && regionNames.length === regions.length ? regions : [],
      regionNames,
      regionPhrase,
    };

    const out: string[] = [];
    for (const generator of [adjacentPeriod, trend, regionVariant, sameTopic]) {
      if (out.length >= MAX_SUGGESTIONS) break;
      const text = await generator(ctx);
      if (text !== null) out.push(text);
    }
    return out;
  } catch {
    // Fail-open (ADR 029): chips are decoration on a paid answer — never let
    // their failure surface as an error or block the response.
    return [];
  }
}

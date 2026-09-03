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
//
// #197 step 3 (session 70, 2026-09-02): two COMPARISON generators join the
// four — "Vergelijk met Nederland" / "Vergelijk met <de G4>" (the answered
// regions plus the national row, or the country plus the G4, at the answered
// period) and "Vergelijk met <a year earlier>" (the answered period against
// the same period one year back, as the registered `difference` derivation).
// They differ from the four question-shaped generators in ONE way: their
// candidate is not re-parsed by the LLM on click. Each surviving comparison
// rides the label list AND a `ClickOption` (WP26 mechanism A, ADR 024) — the
// fully resolved intent the dry-run just proved — so respond.ts can offer it
// on a chip-carrier pending and the reply turn takes it deterministically
// through the `templateOnly` take-path: a real query, a real audit row, zero
// LLM, and a NEW validated result (R6: never a client-side merge of two
// answers). They exist only while `CLARIFY_CLICK_ENABLED` is on — offered as a
// plain label without that take-path, a click would send "Vergelijk met
// Nederland" through a fresh parse it was never written for. Principle (c) is
// the same dry-run gate as every other chip: a table with no national row
// simply never offers the national comparison.
import { INTENT_SCHEMA_VERSION, NATIONAL_REGION_CODE } from '../../query/index.ts';
import type { QueryRefusal, StructuredIntent, ValidatedResult } from '../../query/index.ts';
import type { ServabilityCheck } from '../intent/policy.ts';
import type { ClarifyAxis, ClickOption, RegionTerm } from '../intent/types.ts';
import { baseLabel, stepPeriodCode } from '../intent/resolve.ts';
import { CANONICAL_MEASURES } from '../../registry/defaults.ts';
import type { CanonicalMeasure } from '../../registry/types.ts';
import { periodCodeToNl } from './period-nl.ts';
import { isClickTakeableIntent } from './validate-pending.ts';

/** ADR 029 D1: at most 3 chips shown, fixed generator priority. */
export const MAX_SUGGESTIONS = 3;

// NATIONAL_REGION_CODE is IMPORTED from the query module above, not re-declared
// here. It used to be a local copy of the same literal, which meant this layer
// predicted the query layer's default rather than reading it — the shape the
// 2026-07-25 architecture review named (one constant, three declarations).
// Here it is only used to BUILD a candidate intent; the dry-run gates it, so a
// table using a different national code simply drops the chip, never offers a
// wrong one.

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

/** Registry definitionLabel by canonical key — the label a refusal chip names
 * (a refusal has no ValidatedResult, so it cannot use the answer path's
 * cell-derived attribution.definitionLabel; this is the same label refusals.ts
 * uses in the prose it complements). */
const definitionLabelByKey = new Map(CANONICAL_MEASURES.map((m) => [m.key, m.definitionLabel]));

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
  /** #197 step 3: set once a region comparison chip has been offered, so the
   * region-variant generator (a lone national figure) does not ALSO surface —
   * the side-by-side comparison already contains it. */
  comparedRegions: boolean;
}

/** #197 step 3: a comparison candidate — the chip label AND the fully resolved
 * intent a click takes without a parse (respond.ts wraps it in a ClickOption).
 * `axis` names what the comparison varies, for the carrier pending's `axes`. */
interface ComparisonCandidate {
  label: string;
  intent: StructuredIntent;
  axis: ClarifyAxis;
}

const isNationalCode = (code: string): boolean => code.startsWith('NL');

/** A comparison candidate is dry-run ONLY if the click-time validator would
 * accept it back verbatim — the producer-side twin of validate-pending.ts's
 * schema. The case that made this necessary: live chat answers on-demand-
 * onboarded topics (`onboarded:…` canonical keys) with the flag on, and those
 * keys are deliberately outside CANONICAL_KEYS, so a chip minted for them
 * would be stripped at click time and the label would fall into the paid LLM
 * merge. Not takeable ⇒ not offered, and no dry-run spent. */
async function servableAndTakeable(ctx: SuggestionContext, intent: StructuredIntent): Promise<boolean> {
  if (!isClickTakeableIntent(intent)) return false;
  return servable(ctx, intent);
}

/** The regions a comparison starts from: the RESOLVED intent's — the one the
 * query actually ran (`result.intent`, carried for R8) — not the parsed one.
 * They differ in exactly one case: WP26 mechanism B-region defaulted the
 * national row onto a question that named no place. A comparison built on
 * the parsed (region-less) intent would then offer nothing on precisely the
 * answers where "how does this compare" is most natural; built on the
 * resolved one it offers the country + the G4 with every region EXPLICIT, so
 * the click never depends on the B default still being on (the RUNBOOK's
 * rollback-order hazard does not apply to these chips). (Reviewer finding,
 * the parallel session 70, 2026-09-02.) */
const answeredRegions = (ctx: SuggestionContext): string[] => ctx.result.intent.regions ?? [];

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
  // #197 step 3: a side-by-side comparison chip already carries the national
  // (or G4) figure — a second chip asking for it alone would be redundant.
  if (ctx.comparedRegions) return null;
  const answeredNational = ctx.regions.every(isNationalCode);
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

/** #197 step 3, generator 5a — region comparison. A sub-national answer
 * (one period, any number of regions without the national row) offers the
 * SAME regions plus the national row, side by side; a national answer offers
 * the country plus the G4. The candidate is a plain multi-region intent at the
 * answered period — the query layer's `comparison` shape, which charts as bars
 * and lays out as one table row per region. Uses the intent's own verbatim
 * region codes (never the display names): the label names no answered region,
 * so the drop-never-guess wording rule that empties `ctx.regions` on a label
 * mismatch does not apply here, and the codes ARE what the query ran.
 *
 * Structural skips, before any dry-run is spent: an explicit target (the
 * validator refuses those at click time), a national-only measure (nothing to
 * compare against), a multi-period answer (one varying axis per question —
 * resolve.ts refuses several regions AND several periods), an answer that
 * already contains the national row. The click-time schema (canonical key,
 * regions ≤ 8, well-formed codes) is applied by `servableAndTakeable` before
 * the dry-run — one source of truth for those bounds. Principle (c): a table
 * with no national row fails the dry-run and offers nothing — the same gate
 * as every chip. */
async function compareRegion(ctx: SuggestionContext): Promise<ComparisonCandidate | null> {
  if (ctx.intent.target.kind !== 'canonical') return null;
  const answered = answeredRegions(ctx);
  if (answered.length === 0) return null;
  if (ctx.firstPeriod !== ctx.lastPeriod) return null;
  const period: StructuredIntent['period'] = { kind: 'codes', codes: [ctx.lastPeriod] };
  if (answered.every(isNationalCode)) {
    if (answered.length !== 1) return null;
    const regions = [...answered, ...G4.map((g) => g.code)];
    const candidate = variant(ctx, period, 'none', regions);
    if (await servableAndTakeable(ctx, candidate)) {
      return { label: `Vergelijk met ${joinNl(G4.map((g) => g.name))}`, intent: candidate, axis: 'region' };
    }
    return null;
  }
  if (answered.some(isNationalCode)) return null;
  // No hand-copied region cap here: `servableAndTakeable` runs the click-time
  // schema (regions ≤ 8) on this exact candidate before any dry-run is spent —
  // one source of truth for the bound (reviewer finding, PR #118).
  const candidate = variant(ctx, period, 'none', [...answered, NATIONAL_REGION_CODE]);
  if (await servableAndTakeable(ctx, candidate)) {
    return { label: 'Vergelijk met Nederland', intent: candidate, axis: 'region' };
  }
  return null;
}

/** #197 step 3, generator 5b — period comparison: the answered period against
 * the same period ONE YEAR earlier (the previous year, quarter-a-year-ago,
 * month-a-year-ago), as the registered `difference` derivation (R5) — the
 * take then reads "van X in <earlier> naar Y in <answered>" with the
 * procentpunt rule (R10) applied by the template. Single-period answers at
 * ONE place only: `difference` compares periods at one place by definition
 * (resolve.ts arity rule). The label names the earlier period explicitly —
 * period words only, never a value. */
async function comparePeriod(ctx: SuggestionContext): Promise<ComparisonCandidate | null> {
  if (ctx.intent.target.kind !== 'canonical') return null;
  const answered = answeredRegions(ctx);
  if (answered.length > 1) return null;
  if (ctx.firstPeriod !== ctx.lastPeriod) return null;
  const grain = ctx.lastPeriod.slice(4, 6);
  const perYear = grain === 'JJ' ? 1 : grain === 'KW' ? 4 : grain === 'MM' ? 12 : null;
  if (perYear === null) return null;
  const earlier = stepPeriodCode(ctx.lastPeriod, -perYear);
  if (earlier === null) return null;
  const candidate = variant(
    ctx,
    { kind: 'codes', codes: [earlier, ctx.lastPeriod] },
    'difference',
    answered,
  );
  if (await servableAndTakeable(ctx, candidate)) {
    return { label: `Vergelijk met ${periodCodeToNl(earlier)}`, intent: candidate, axis: 'period' };
  }
  return null;
}

/** What respondToIntent assembles under an answer: the chip labels in display
 * order (at most MAX_SUGGESTIONS) and, for the comparison chips among them,
 * the ClickOptions a click takes deterministically plus the axes they vary
 * (the carrier pending's `axes`). `clickOptions` is [] and `axes` is [] unless
 * the caller enabled comparisons — the flag-off shape is byte-identical to the
 * pre-#197 `buildSuggestions`. */
export interface AnswerChips {
  suggestions: string[];
  clickOptions: ClickOption[];
  axes: ClarifyAxis[];
}

type Generator = (ctx: SuggestionContext) => Promise<string | ComparisonCandidate | null>;

/** Builds the servability-gated chips for an answered question (ADR 029):
 * candidates in fixed priority — adjacent period → trend → [#197: region
 * comparison → period comparison →] region variant → same topic — each
 * dry-run through `check`, first MAX_SUGGESTIONS survivors kept. The two
 * comparison generators run ONLY with `opts.clickOptions` (the
 * CLARIFY_CLICK_ENABLED wire): their chips need the deterministic take-path,
 * so without it they are not generated at all and the output is the pre-#197
 * list, byte for byte. They sit ahead of the region variant because a
 * side-by-side comparison subsumes the lone national figure; with the cap at 3
 * that is also the only position where they can surface at all on a regional
 * answer. Pure apart from the injected dry-run; FAIL-OPEN — any throw
 * anywhere (including a throwing check) returns the empty shape so a chips
 * hiccup can never cost the user the paid answer (the same rule
 * web/app/actions.ts applies to outcomeContext). `registry` is injectable for
 * tests only; production call sites take the default. */
export async function buildAnswerChips(
  intent: StructuredIntent,
  result: ValidatedResult,
  check: ServabilityCheck,
  opts: { clickOptions: boolean },
  registry: readonly CanonicalMeasure[] = CANONICAL_MEASURES,
): Promise<AnswerChips> {
  const empty: AnswerChips = { suggestions: [], clickOptions: [], axes: [] };
  try {
    const cells = result.cells;
    const firstPeriod = cells[0]?.periodCode;
    const lastPeriod = cells[cells.length - 1]?.periodCode;
    if (firstPeriod === undefined || lastPeriod === undefined) return empty;

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
      comparedRegions: false,
    };

    const generators: Generator[] = opts.clickOptions
      ? [adjacentPeriod, trend, compareRegion, comparePeriod, regionVariant, sameTopic]
      : [adjacentPeriod, trend, regionVariant, sameTopic];
    const suggestions: string[] = [];
    const clickOptions: ClickOption[] = [];
    const axes: ClarifyAxis[] = [];
    for (const generator of generators) {
      if (suggestions.length >= MAX_SUGGESTIONS) break;
      const produced = await generator(ctx);
      if (produced === null) continue;
      if (typeof produced === 'string') {
        suggestions.push(produced);
        continue;
      }
      suggestions.push(produced.label);
      clickOptions.push({
        id: `cmp-${clickOptions.length + 1}`,
        label: produced.label,
        intent: produced.intent,
        // A comparison names the explicit, already-answered period(s) — it
        // makes no "what is it now" claim, so the staleness rule must not
        // treat a click as one (the same reasoning as the rescue chip).
        impliedRecency: false,
      });
      if (!axes.includes(produced.axis)) axes.push(produced.axis);
      if (produced.axis === 'region') ctx.comparedRegions = true;
    }
    return { suggestions, clickOptions, axes };
  } catch {
    // Fail-open (ADR 029): chips are decoration on a paid answer — never let
    // their failure surface as an error or block the response.
    return empty;
  }
}

/** The pre-#197 entry point: the question-shaped chips only (no comparisons,
 * no click options) — what every flag-off turn still produces. Kept as the
 * named seam the WP29 tests and the module index pin. */
export async function buildSuggestions(
  intent: StructuredIntent,
  result: ValidatedResult,
  check: ServabilityCheck,
  registry: readonly CanonicalMeasure[] = CANONICAL_MEASURES,
): Promise<string[]> {
  return (await buildAnswerChips(intent, result, check, { clickOptions: false }, registry)).suggestions;
}

/** #134(a) (ADR 029, refusal-side variant): ONE servability-gated retry chip on
 * a period-coverage refusal — the query-refusal kinds that compute a concrete
 * boundary period we CAN serve: `freshness` (offer the freshest available
 * period), `outside_loaded_slice` on the PERIOD axis (offer the loaded-slice
 * floor), and `not_published` on the PERIOD axis (#134(b), below). The chip
 * re-asks the SAME canonical measure at that boundary, so a click
 * (fill-don't-send, #75) lands the user on a working period instead of guessing
 * one — turning the refusal's prose into a one-click retry.
 *
 * #137: for an `outside_loaded_slice` refusal whose ASK was a RANGE partly below
 * the floor, the chip prefers the WORKING sub-range [floor, originalTo] as a
 * trend question (the "probeer 2010–2024" shape), falling back to the single
 * floor period when that window isn't fully servable.
 *
 * #134(b): a `not_published` refusal is handled identically to the period
 * outside_loaded_slice — but ONLY the too-OLD sub-case, which run.ts marks by
 * setting `nearestAlternative` to our earliest served period (the owner's
 * "inflatie 2001" case: offer our earliest year, or the clamped working
 * sub-range for a range ask). A MID-GAP not_published carries no boundary and
 * gets no chip — it stays prose-only (owner decision 2026-07-13). Range-aware
 * like #137, since the owner's canonical example was a range.
 *
 * #138 (the #134 v2 regional case): a region-carrying intent now gets the same
 * chip WITH the registry-labelled region — `labelRegions` is the injected
 * honest code→label source (wired to context/build.ts regionTermsFor at the
 * respond.ts call site: canonical key → table → GeoDimension →
 * dimension_labels, a pure metadata mirror structurally incapable of touching
 * a cell value; this module keeps its never-sees-db confinement). It fails
 * closed exactly like the context builder: ANY unlabelable code → null → no
 * chip at all, byte-identical to the region-less-v1 bailout (drop-never-
 * guess). The regional candidate carries the intent's own region codes, so
 * the dry-run proves the REGIONAL cells are loaded, not just the national
 * ones. The dry-run IS the loadedness proof
 * (EchoServability carries no cell values by construction — the same no-numbers
 * guarantee the answer-path generators have); an unservable boundary drops the
 * chip. FAIL-OPEN: any throw returns [] so a chip hiccup never costs the user
 * the (refunded) refusal turn. Returns 0 or 1 chip. */
export type RegionLabeler = (
  canonicalKey: string,
  codes: string[],
) => Promise<RegionTerm[] | null>;

export async function buildRefusalSuggestions(
  refusal: QueryRefusal,
  check: ServabilityCheck,
  labelRegions: RegionLabeler,
): Promise<string[]> {
  try {
    const r = refusal.refusal;
    // Only the period-coverage kinds that know a concrete boundary, and only on
    // the PERIOD axis — the dimension outside_loaded_slice carries a dimension
    // COORDINATE in nearestAlternative (resolve.ts, axis 'measure'), never a
    // period, so it must not become a period chip. not_published (#134(b)):
    // ONLY the too-old sub-case reaches here with a boundary — run.ts sets
    // nearestAlternative solely when the ask is before our earliest served
    // period; a mid-gap not_published carries none → drops below (prose-only).
    if (r.kind !== 'freshness' && r.kind !== 'outside_loaded_slice' && r.kind !== 'not_published') {
      return [];
    }
    if (r.axis !== 'period') return [];
    // Canonical target only — a registry definitionLabel to name in the chip
    // (mirrors the answer path's label===null skip; drop-never-guess).
    const intent = refusal.intent;
    if (intent.target.kind !== 'canonical') return [];
    const label = definitionLabelByKey.get(intent.target.key);
    if (label === undefined) return [];
    // #138: regions are labelled from the registry (dimension_labels via the
    // injected closure) — the honest source a cell-less refusal DOES have.
    // Fail-closed: null (any unlabelable code / no geo dimension) or a count
    // mismatch → no chip at all, byte-identical to the region-less-v1 bailout.
    const regions = intent.regions ?? [];
    let regionPhrase = '';
    if (regions.length > 0) {
      const terms = await labelRegions(intent.target.key, regions);
      if (terms === null || terms.length !== regions.length) return [];
      regionPhrase = ` in ${joinNl(terms.map((t) => t.name))}`;
    }
    // The boundary the refusal already computed: freshest-available for
    // freshness, the loaded-slice floor (nearestAlternative) for the period
    // outside_loaded_slice.
    const boundary =
      r.kind === 'freshness'
        ? (r.freshness?.freshestAvailable?.periodCode ?? r.nearestAlternative ?? null)
        : (r.nearestAlternative ?? null);
    if (boundary === null) return [];

    // #137 (range-ask retry): when an `outside_loaded_slice` refusal came from a
    // RANGE ask partly below our slice floor, offer the WORKING sub-range
    // [floor, originalTo] as a trend chip (the owner's "probeer 2010–2024"
    // shape) rather than a single floor year. Only for outside_loaded_slice — a
    // range retry is meaningless for a "too recent" freshness refusal. The
    // dry-run is the SOLE validity gate (the module's design philosophy): a
    // backwards / mixed-grain / above-the-ceiling / gappy window resolves to NOT
    // servable (runQuery REFUSES it in resolve.ts — it never throws), so we
    // cleanly fall through to the single-period floor chip below. Skip the
    // degenerate floor===to case (its copy would read "van X tot en met X").
    // Wrapped in its own try so even an unexpected throw keeps the single-period
    // fallback rather than the outer catch swallowing the whole turn's chip.
    if (
      (r.kind === 'outside_loaded_slice' || r.kind === 'not_published') &&
      intent.period.kind === 'range' &&
      intent.period.to !== boundary
    ) {
      try {
        const rangeCandidate: StructuredIntent = {
          schemaVersion: INTENT_SCHEMA_VERSION,
          target: intent.target,
          // #138: the regional candidate carries the ask's own region codes —
          // the dry-run must prove the REGIONAL window serves, not the national.
          ...(regions.length > 0 ? { regions } : {}),
          period: { kind: 'range', from: boundary, to: intent.period.to },
          derivation: 'series',
        };
        if ((await check(rangeCandidate)).servable) {
          return [
            `Hoe ontwikkelde ${label}${regionPhrase} zich van ${periodCodeToNl(boundary)} ` +
              `tot en met ${periodCodeToNl(intent.period.to)}?`,
          ];
        }
      } catch {
        // fall through to the single-period chip
      }
    }

    const candidate: StructuredIntent = {
      schemaVersion: INTENT_SCHEMA_VERSION,
      target: intent.target,
      ...(regions.length > 0 ? { regions } : {}),
      period: { kind: 'codes', codes: [boundary] },
      derivation: 'none',
    };
    // The dry-run proves the boundary period resolves in loaded data (R7 /
    // docs/05 "actually available" rule) — a refusal must never offer a retry
    // it cannot then serve. With regions on the candidate that proof covers
    // the regional cells themselves (#138).
    if (!(await check(candidate)).servable) return [];
    return [`Wat was ${label}${regionPhrase} in ${periodCodeToNl(boundary)}?`];
  } catch {
    return [];
  }
}

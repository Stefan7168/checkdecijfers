// The R7 decision layer: ranked candidates + calibrated thresholds decide
// answer vs. clarify — never a best guess (docs/05-data-rules.md R7,
// calibration procedure + measured values in ADR 012 / open-questions #19).
//
// Rules, in order:
//   1. identical resolved intents merge (two readings that agree are one);
//   2. the TOP-ranked reading failing resolution exits to clarification —
//      never a silent fall-through to a lower-confidence reading;
//   3. top confidence below answerThreshold → clarify (confirm the reading);
//   4. a materially different second reading at/above runnerUpThreshold →
//      clarify with both readings as options;
//   5. otherwise: emit the intent, ranked list attached for the audit record.
import { CANONICAL_MEASURES } from '../../registry/defaults.ts';
import type { EchoServability, StructuredIntent } from '../../query/index.ts';
// Leaf module (zero imports of its own), so this intent→respond edge cannot
// cycle; it renders period codes for clarification prose, which is exactly
// what the echo fallback below builds (WP15/#56).
import { periodCodeToNl } from '../respond/period-nl.ts';
// The click trust boundary's own predicate (validate-pending.ts imports only
// zod, the intent schema/types, the query types and the sources leaf modules
// — nothing that imports this file back), so the offer side can refuse to
// mint a chip the take side would strip.
import { isClickTakeableIntent, type ClickValidationOptions } from '../respond/validate-pending.ts';
// ADR 058 phase 2 (#332), Task 3: the English parameter helpers built in
// Task 1 (leaf module, DB-free) — every English clarification question below
// is assembled from THESE, at the same site as its Dutch counterpart, never
// a machine translation of the Dutch string itself. Importing a respond/
// leaf module from intent/ is the same precedent as periodCodeToNl above.
import {
  englishMeasureLabel,
  FIXED_OPTION_EN,
  joinOfEn,
  periodCodeToEn,
  regionLabelEn,
} from '../respond/english.ts';
import { stableStringify } from './client.ts';
import { isResolutionFailure, type CandidateResolution } from './resolve.ts';
import type {
  ClarifyAxis,
  ClickOption,
  LlmUsage,
  ParseOutcome,
  ParserConfig,
  RankedCandidate,
  RawParse,
  ResolutionFailure,
} from './types.ts';
import { MAX_CLICK_OPTIONS } from './types.ts';

export interface OutcomeContext {
  question: string;
  raw: RawParse;
  model: string;
  usage: LlmUsage;
}

const definitionLabelByKey = new Map(CANONICAL_MEASURES.map((m) => [m.key, m.definitionLabel]));

function joinOf(options: string[]): string {
  return options.join(' of ');
}

/** One compact Dutch question per failure shape (B15/B16 scoring: at most one
 * question, options that resolve in the loaded data, no numbers). WP9 owns
 * the full failure-behavior table; these templates are its seam. */
function failureQuestion(failure: ResolutionFailure): string {
  switch (failure.reason) {
    case 'region_ambiguous':
      return `Bedoel je ${joinOf(failure.options)}?`;
    case 'region_unknown':
      return 'Welke gemeente of provincie bedoel je precies, of wil je het cijfer voor heel Nederland?';
    case 'region_on_national_measure':
      return 'Die cijfers heb ik alleen voor heel Nederland, niet per gemeente of buurt — wil je het landelijke cijfer?';
    // WP22 (#97a): the max/"meeste" gaps name their REAL cause. Both texts
    // deliberately carry no digits (the no-numbers belt) and exactly one
    // question mark (the one-compact-question pin).
    case 'max_needs_regions':
      return 'Welke gemeentes of provincies wil je met elkaar vergelijken? Noem er minstens twee in je vraag.';
    case 'max_on_national_measure': {
      // With a checked range option (the gap-free loaded window, computed by
      // the resolver — adversarial-review fix: never name a grain the
      // measure may not have), invite exactly that servable reply; without
      // one, stay generic.
      const lead =
        'Deze cijfers zijn er alleen voor heel Nederland, dus regio’s vergelijken kan hier niet — ' +
        'en de periode met de hoogste of laagste waarde opzoeken kan ik nog niet. ';
      return failure.options.length > 0
        ? `${lead}Wil je in plaats daarvan het verloop zien, bijvoorbeeld van ${joinOf(failure.options)}?`
        : `${lead}Wil je in plaats daarvan het verloop over een periode zien?`;
    }
    case 'grain_unavailable':
      return failure.options.length > 0
        ? `Die cijfers zijn er alleen ${failure.options.join(' en ')} — voor welke periode wil je ze?`
        : 'Voor welke periode wil je dit weten?';
    case 'period_missing':
      // With options (the degenerate open-range shape: "sinds 2015" resolving
      // to a single year), name the loaded-data range suggestion; without,
      // the question named no period at all.
      return failure.options.length > 0
        ? `Voor welke periode wil je dit weten — bijvoorbeeld ${joinOf(failure.options)}?`
        : 'Voor welke periode wil je dit weten (bijvoorbeeld een jaartal of kwartaal)?';
    case 'period_invalid':
      return 'Welke periode bedoel je precies?';
    case 'unknown_canonical_key':
      return 'Welk onderwerp uit de officiële CBS-cijfers bedoel je precies?';
    // Eurostat E2a (§4.4, owner-approved copy, session 125): names the
    // SOURCE the answer will use — never framed as "CBS heeft geen cijfer"
    // (the product draws on several sources, not just CBS asked-and-refused)
    // — and keeps the one caveat that matters: the definitions can differ.
    case 'other_source_available':
      return (
        `Voor dit antwoord gebruiken we Eurostat: ${failure.siblingDefinitionLabel ?? ''}. ` +
        'Eurostat hanteert één definitie voor alle landen; die kan afwijken van de CBS-definitie.'
      );
  }
}

// ---------------------------------------------------------------------------
// English siblings (ADR 058 phase 2, #332, Task 3) — assembled at the SAME
// site as failureQuestion above, from the SAME ResolutionFailure, never a
// post-hoc translation of the Dutch string. Threaded onto the ParseOutcome as
// question_en/options_en/untranslated_en, present-only and stripped again
// before the outcome is stored (respond/refusals.ts's withoutEnglish) — the
// Dutch path stays byte-identical.
// ---------------------------------------------------------------------------

/** 'Bedoel je X?' -> 'Did you mean: X?' — the one Dutch confirm template
 * reused verbatim across region_ambiguous (here) and every rule 3/4 confirm
 * in decide() below; kept as one function so the phrasing can never drift
 * between the sites that share the Dutch template. */
function didYouMeanEn(text: string): string {
  return `Did you mean: ${text}?`;
}

/** '2015 tot en met 2024' -> '2015 to 2024' — the one option shape
 * openEndedRangeOptions (resolve.ts) assembles from year PARTS, never
 * through periodCodeToNl, for the period_missing / max_on_national_measure
 * failures. Built from the same parts here (a regex over the exact shape
 * that builder ever emits), not a translation of the Dutch string; anything
 * else passes through unchanged (defensive — this shape is the only one
 * either failure reason ever offers). */
function yearRangeOptionToEn(option: string): string {
  const match = /^(\d{4}) tot en met (\d{4})$/.exec(option);
  return match ? `${match[1]!} to ${match[2]!}` : option;
}

/** English options for a ResolutionFailure, index-aligned with
 * `failure.options` (same length, always — pinned by
 * tests/answer/english-clarifications.test.ts). Region labels through
 * regionLabelEn; the one "X tot en met Y" shape through yearRangeOptionToEn;
 * every other fixed Dutch literal through FIXED_OPTION_EN (english.ts) — the
 * `?? o` fallback is defensive only, never reached while that map stays in
 * sync with every fixed option string this module (and resolve.ts) emits. */
function failureOptionsEn(failure: ResolutionFailure): string[] {
  if (failure.reason === 'region_ambiguous') return failure.options.map(regionLabelEn);
  if (failure.reason === 'max_on_national_measure' || failure.reason === 'period_missing') {
    return failure.options.map(yearRangeOptionToEn);
  }
  return failure.options.map((o) => FIXED_OPTION_EN[o] ?? o);
}

/** The one non-template ingredient (design doc): siblingDefinitionLabel is
 * Dutch registry text with no English sibling reachable from a
 * ResolutionFailure alone (the Eurostat sibling canonical key never lives in
 * CANONICAL_MEASURES — src/sources/eurostat-siblings.ts's own ruling — so
 * englishMeasureLabel has nothing to look up), so it rides verbatim and is
 * listed here rather than silently left untranslated in the sentence. */
function failureUntranslatedEn(failure: ResolutionFailure): string[] {
  if (failure.reason === 'other_source_available' && failure.siblingDefinitionLabel) {
    return [failure.siblingDefinitionLabel];
  }
  return [];
}

/** English sibling of failureQuestion — same switch, same cases, English
 * options via failureOptionsEn above. One question mark wherever the Dutch
 * has exactly one (including other_source_available, which — like the
 * Dutch — has ZERO: it is a statement naming the source switch, not phrased
 * as a question). */
function failureQuestionEn(failure: ResolutionFailure): string {
  const optionsEn = failureOptionsEn(failure);
  switch (failure.reason) {
    case 'region_ambiguous':
      return didYouMeanEn(joinOfEn(optionsEn));
    case 'region_unknown':
      return 'Which municipality or province do you mean exactly, or do you want the figure for the Netherlands as a whole?';
    case 'region_on_national_measure':
      return "I only have those figures for the Netherlands as a whole, not per municipality or neighbourhood — do you want the national figure?";
    case 'max_needs_regions':
      return 'Which municipalities or provinces do you want to compare? Name at least two in your question.';
    case 'max_on_national_measure': {
      const leadEn =
        "These figures exist only for the Netherlands as a whole, so comparing regions isn't possible here — " +
        "and looking up the period with the highest or lowest value isn't something I can do yet. ";
      return optionsEn.length > 0
        ? `${leadEn}Would you like to see the trend instead, for example ${joinOfEn(optionsEn)}?`
        : `${leadEn}Would you like to see the trend over a period instead?`;
    }
    case 'grain_unavailable':
      return optionsEn.length > 0
        ? `Those figures are only available ${optionsEn.join(' and ')} — which period do you want them for?`
        : 'Which period do you want this for?';
    case 'period_missing':
      return optionsEn.length > 0
        ? `Which period do you want this for — for example ${joinOfEn(optionsEn)}?`
        : 'Which period do you want this for (for example a year or quarter)?';
    case 'period_invalid':
      return 'Which exact period do you mean?';
    case 'unknown_canonical_key':
      return 'Which topic from the official CBS figures do you mean exactly?';
    case 'other_source_available':
      return (
        `For this answer we use Eurostat: ${failure.siblingDefinitionLabel ?? ''}. ` +
        'Eurostat applies one single definition for every country; that may differ from the CBS definition.'
      );
  }
}

/** WP26 mechanism A (ADR 024, execute-brief §3): turn candidate (label,intent)
 * pairs into offered ClickOptions — but only after PROVING each one answers,
 * through the same real-query dry-run the #56 echo uses. An option that would
 * refuse is dropped silently: it stays a plain-text option, exactly as today.
 * That is the whole dead-end guarantee — a chip exists only if it worked at
 * offer time, and the take-path re-runs the real query anyway (data can move
 * between offer and click; the normal gate then refuses and refunds).
 *
 * `id` is derived from the option's index in the ORIGINAL list so it stays
 * aligned with `options[]` even when middle entries drop out. */
async function buildClickOptions(
  servability: ServabilityCheck,
  entries: { label: string; intent: StructuredIntent | null; impliedRecency: boolean }[],
  clickValidation: ClickValidationOptions,
): Promise<ClickOption[]> {
  const offered: ClickOption[] = [];
  for (const [index, entry] of entries.slice(0, MAX_CLICK_OPTIONS).entries()) {
    if (entry.intent === null) continue;
    // E2a final-review fix wave (C1, defence in depth — the #197 rule
    // suggestions.ts already follows): a chip whose intent the click trust
    // boundary (validate-pending.ts, applied in web/app/actions.ts before the
    // take) would DROP is worse than no chip — its click would fall into the
    // paid LLM merge instead of the take-path. Checked BEFORE the dry-run, so
    // an untakeable option costs no query either.
    if (!isClickTakeableIntent(entry.intent, clickValidation)) continue;
    const verdict = await servability(entry.intent);
    if (!verdict.servable) continue;
    offered.push({
      id: `opt-${index + 1}`,
      label: entry.label,
      intent: entry.intent,
      impliedRecency: entry.impliedRecency,
    });
  }
  return offered;
}

/** Only materialize the key when something is actually offered — an empty
 * `clickOptions: []` would change the serialized clarification envelope (and
 * the stored pending) for every flag-off turn, breaking the byte-neutrality
 * the rollout depends on (#144 pattern). */
function withClickOptions(
  outcome: Extract<ParseOutcome, { kind: 'clarification' }>,
  clickOptions: ClickOption[],
): ParseOutcome {
  return clickOptions.length > 0 ? { ...outcome, clickOptions } : outcome;
}

async function clarificationFromFailure(
  context: OutcomeContext,
  failure: ResolutionFailure,
  servability: ServabilityCheck,
  clickOptionsEnabled: boolean,
  clickValidation: ClickValidationOptions,
): Promise<ParseOutcome> {
  const outcome = {
    kind: 'clarification',
    ...context,
    axes: [failure.axis],
    question_nl: failureQuestion(failure),
    question_en: failureQuestionEn(failure),
    options: failure.options,
    options_en: failureOptionsEn(failure),
    untranslated_en: failureUntranslatedEn(failure),
    reason: failure.message,
  } as const satisfies Extract<ParseOutcome, { kind: 'clarification' }>;
  // The resolver attaches per-option intents only where the options ARE the
  // competing readings (region_ambiguous: "Utrecht (gemeente)" vs the
  // province). Everywhere else there is nothing takeable to offer.
  const clickOptions =
    !clickOptionsEnabled || failure.optionIntents === undefined
      ? []
      : await buildClickOptions(
          servability,
          failure.options.map((label, i) => ({
            label,
            intent: failure.optionIntents?.[i] ?? null,
            impliedRecency: failure.optionImpliedRecency ?? false,
          })),
          clickValidation,
        );
  // E2a final-review fix wave (I6): the Eurostat switch is ONLY takeable by
  // its chip — its question promises an answer ("Voor dit antwoord gebruiken
  // we Eurostat: …") that a typed reply cannot reach (the reply merge
  // re-resolves to the CBS key and ends in a still-ambiguous refusal: the
  // paid dead end ADR 024 exists to remove). So when no chip survives — click
  // options off (the documented rollback state), the offer-time dry-run
  // refusing, or the trust-boundary gate above — the reader gets EXACTLY the
  // CBS clarification they would have had without a sibling pair: the
  // original region_unknown / region_on_national_measure failure the resolver
  // kept on `fallback`. Recursing re-applies every rule to that failure (it
  // carries no option intents, so it renders as plain text, as before E2a).
  if (failure.reason === 'other_source_available' && clickOptions.length === 0 && failure.fallback !== undefined) {
    return clarificationFromFailure(context, failure.fallback, servability, clickOptionsEnabled, clickValidation);
  }
  return withClickOptions(outcome, clickOptions);
}

/** WP16 sub-part 2 (ADR 026): the injected table-finder seam. A callback (NOT
 * a db import, mirroring ServabilityCheck above) so this leaf module stays
 * free of database and catalog access — the closure that implements it
 * (constructed in web/app/actions.ts) owns the findTable call, the confidence
 * routing, AND the per-user already-pending check (it has db + userId there).
 * OPTIONAL by design: absent → today's B15 clarification, byte-identical (the
 * load-bearing pin, §0.1). Returns null when the finder did NOT confidently
 * pick a table (recall empty, low confidence, rerank error, or a throw the
 * closure swallowed) — the caller then falls back to buildUnmatchedClarification. */
export interface OnboardingRouting {
  tableId: string;
  topicTerm: string;
  confidence: number;
  /** true → an active job already exists for this (user, table). */
  alreadyPending: boolean;
  /** WP27 stage B (ADR 027 D2a): the finder's candidate chain — the confident
   * pick first, then its allowlist-sanitized alternativeIds, cap 3. CONSTRUCTED
   * in src/ingestion/onboarding-finder.ts (the one building link — PR-#17
   * review); every carrier from here to pending_table_requests.candidate_ids
   * only passes it along, so stage C's fit gate can try candidate 2 when
   * candidate 1 misfits. Always non-empty on a real routing (pick is first). */
  candidateIds: string[];
}
/** WP27 stage A (ADR 027 D3a): the finder receives the FULL question alongside
 * the unmatched term — the question's shape (stock vs flow) is signal the term
 * alone discards. The closure threads it into the Stage-2 rerank prompt. */
export type TableFinder = (term: string, question: string) => Promise<OnboardingRouting | null>;

/** The unmatched-measure exit, finder-aware (WP16 sub-part 2). With no finder
 * (or a finder that doesn't confidently route) it returns EXACTLY
 * buildUnmatchedClarification's output — the B15 pin holds by construction.
 * With a confident routing it emits the 'onboarding' ParseOutcome the respond
 * layer turns into the acknowledgment. The finder is consulted only when the
 * raw parse actually carries an unmatched term (the real B15 shape); a null
 * unmatchedMeasureTerm never triggers a fetch (nothing to search for). */
export async function resolveUnmatched(
  context: OutcomeContext,
  finder: TableFinder | undefined,
): Promise<ParseOutcome> {
  const term = context.raw.unmatchedMeasureTerm;
  if (finder && term !== null) {
    const routing = await finder(term, context.question);
    if (routing) {
      return {
        kind: 'onboarding',
        ...context,
        tableId: routing.tableId,
        topicTerm: routing.topicTerm,
        confidence: routing.confidence,
        alreadyPending: routing.alreadyPending,
        // WP27 stage B: carried verbatim — this outcome is the second link of
        // the candidate chain (finder → HERE → envelope → trigger → store).
        candidateIds: routing.candidateIds,
      };
    }
  }
  return buildUnmatchedClarification(context);
}

/** B15 shape: the topic term matched nothing loaded. Measure is unresolved,
 * and without a measure neither region nor period can resolve — the one
 * clarification round names all axes at once (docs/05 failure table). */
export function buildUnmatchedClarification(context: OutcomeContext): ParseOutcome {
  const rawTerm = context.raw.unmatchedMeasureTerm;
  const term = rawTerm ?? 'dit onderwerp';
  // ADR 058 phase 2 (#332), Task 3: the user's own unmatched term stays
  // VERBATIM Dutch inside the English sentence (design doc's one
  // non-template ingredient) — but the 'dit onderwerp'/'this topic' FILLER
  // (no term at all) is our own template text, not user input, so it gets a
  // real English word instead of riding along untranslated.
  const termEn = rawTerm ?? 'this topic';
  const nearestKeys = context.raw.nearestCanonicalKeys.filter((key) => definitionLabelByKey.has(key));
  const nearest = nearestKeys.map((key) => definitionLabelByKey.get(key)!);
  const nearestEn = nearestKeys.map((key) => englishMeasureLabel(key));
  const options = nearest.length > 0 ? nearest : [...definitionLabelByKey.values()].slice(0, 3);
  const optionsEn =
    nearestEn.length > 0
      ? nearestEn
      : [...definitionLabelByKey.keys()].slice(0, 3).map((key) => englishMeasureLabel(key));
  const lead = `Ik heb geen CBS-cijfers over "${term}" geladen`;
  const leadEn = `I don't have any CBS figures about "${termEn}" loaded`;
  const question =
    nearest.length > 0
      ? `${lead} — bedoel je misschien ${joinOf(nearest)}, en zo ja voor welke regio en periode?`
      : `${lead} — welk onderwerp uit mijn bronnen bedoel je (bijvoorbeeld ${options.join(', ')}), en voor welke regio en periode?`;
  const questionEn =
    nearestEn.length > 0
      ? `${leadEn} — do you perhaps mean ${joinOfEn(nearestEn)}, and if so for which region and period?`
      : `${leadEn} — which topic from my sources do you mean (for example ${optionsEn.join(', ')}), and for which region and period?`;
  return {
    kind: 'clarification',
    ...context,
    axes: ['measure', 'region', 'period'],
    question_nl: question,
    question_en: questionEn,
    options,
    options_en: optionsEn,
    untranslated_en: rawTerm ? [rawTerm] : [],
    reason: `measure term "${term}" matches no canonical measure`,
  };
}

/** The whole REGION axis of an intent — named regions AND the #267 region
 * class — so two readings that differ only in class ("elke provincie" vs.
 * heel Nederland) are a region difference, never an agreement. */
function regionAxisOf(intent: StructuredIntent): string {
  return stableStringify({ regions: intent.regions ?? [], regionSet: intent.regionSet ?? null });
}

/** Axes on which two resolved readings differ — the user-facing shape of the
 * ambiguity, named in the clarification. */
export function differingAxes(a: RankedCandidate, b: RankedCandidate): ClarifyAxis[] {
  const axes: ClarifyAxis[] = [];
  if (stableStringify(a.intent.target) !== stableStringify(b.intent.target)) axes.push('measure');
  if (regionAxisOf(a.intent) !== regionAxisOf(b.intent)) axes.push('region');
  if (stableStringify(a.intent.period) !== stableStringify(b.intent.period)) axes.push('period');
  if (a.intent.derivation !== b.intent.derivation) axes.push('derivation');
  return axes.length > 0 ? axes : ['measure'];
}

/** Merge candidates that resolved to the SAME intent (agreement, not
 * ambiguity), keeping the highest confidence and its reading. Pure: the
 * input objects are never mutated (review finding, 2026-07-03 — mutation
 * made the merge untestable through decide()). */
export function mergeResolutions(resolutions: CandidateResolution[]): CandidateResolution[] {
  const merged: CandidateResolution[] = [];
  const byIntent = new Map<string, RankedCandidate>();
  for (const resolution of resolutions) {
    if (isResolutionFailure(resolution)) {
      merged.push(resolution);
      continue;
    }
    const key = stableStringify(resolution.intent);
    const existing = byIntent.get(key);
    if (!existing) {
      const copy = { ...resolution };
      byIntent.set(key, copy);
      merged.push(copy);
    } else if (resolution.confidence > existing.confidence) {
      existing.confidence = resolution.confidence;
      existing.reading = resolution.reading;
      existing.impliedRecency = resolution.impliedRecency;
    }
  }
  return merged;
}

/** The #56 dry-run seam (WP15, ADR 021 decision 4): "would confirming this
 * echo suggestion actually produce an answer?" — answered by the query
 * layer's echoServability. A callback (not a db import) so this module stays
 * free of database access; REQUIRED, not optional, so no call site can
 * silently skip the check (tests pass stubs explicitly). */
export type ServabilityCheck = (intent: StructuredIntent) => Promise<EchoServability>;

/** Deterministic Dutch fallback when the echo suggestion is NOT servable
 * (docs/05: options must be concrete and actually available — V22/V23
 * measured the echo naming unloaded data). Names what IS loaded instead;
 * carries period codes/years only, never a value (principle c). */
function echoUnservableClarification(
  context: OutcomeContext,
  top: RankedCandidate,
  verdict: Extract<EchoServability, { servable: false }>,
): ParseOutcome {
  const key = top.intent.target.kind === 'canonical' ? top.intent.target.key : null;
  const label = key === null ? null : (definitionLabelByKey.get(key) ?? null);
  const subject = label ?? 'deze cijfers';
  const subjectEn = key === null ? 'these figures' : englishMeasureLabel(key);

  // The suggestion is fine but incomplete (e.g. no region on a geo table):
  // confirm it AND ask the missing axes in the same, single round (docs/05:
  // all axes at once). Without this, confirming the echo would burn the one
  // clarification round and dead-end in a still-ambiguous refusal.
  if (verdict.kind === 'needs_clarification') {
    const axes = verdict.axes ?? [];
    const askRegion = axes.includes('region');
    const question = askRegion
      ? `Bedoel je ${top.reading}? Geef dan ook aan voor welke regio: heel Nederland, of een specifieke gemeente of provincie.`
      : `Bedoel je ${top.reading}? Kun je de vraag dan iets preciezer stellen?`;
    // ADR 058 phase 2 (#332), Task 3: top.reading is the model's own
    // free-text reading — kept VERBATIM Dutch inside the English sentence
    // (design doc's one non-template ingredient), listed in untranslated_en.
    const questionEn = askRegion
      ? `${didYouMeanEn(top.reading)} Then also specify the region: the Netherlands as a whole, or a specific municipality or province.`
      : `${didYouMeanEn(top.reading)} Could you phrase the question a bit more precisely?`;
    const options = askRegion
      ? ['heel Nederland (landelijk cijfer)', 'een specifieke gemeente of provincie — noem de naam']
      : [top.reading];
    return {
      kind: 'clarification',
      ...context,
      axes: ['measure', ...axes],
      question_nl: question,
      question_en: questionEn,
      options,
      // Translated through FIXED_OPTION_EN (english.ts) — the SAME lookup
      // failureOptionsEn uses, rather than a second hand-copied literal pair
      // that could drift from it. top.reading (the non-region branch) is not
      // a fixed literal, so it falls through the `?? o` unchanged.
      options_en: options.map((o) => FIXED_OPTION_EN[o] ?? o),
      untranslated_en: [top.reading],
      reason: `echo suggestion resolves but is not yet servable (${verdict.kind}: ${axes.join(', ') || 'unspecified axes'})`,
    };
  }

  // Period-shaped unservability (outside the slice, not yet published, never
  // published, a gap): name the window we CAN serve. yearRange is gap-free by
  // construction (dry-run applies the WP14 interior-gap discipline).
  const range = verdict.availability.yearRange;
  const freshest = verdict.availability.freshest;
  if (range !== null) {
    return {
      kind: 'clarification',
      ...context,
      axes: ['period'],
      question_nl: `Die precieze periode kan ik niet leveren — van ${subject} heb ik jaarcijfers van ${range.fromYear} tot en met ${range.toYear}. Welke periode bedoel je?`,
      question_en: `I can't give you that exact period — for ${subjectEn} I have yearly figures from ${range.fromYear} to ${range.toYear}. Which period do you mean?`,
      options: [`${range.fromYear} tot en met ${range.toYear}`],
      options_en: [`${range.fromYear} to ${range.toYear}`],
      untranslated_en: [],
      reason: `echo suggestion is not servable (${verdict.kind}); offering the loaded year window instead`,
    };
  }
  if (freshest !== null) {
    return {
      kind: 'clarification',
      ...context,
      axes: ['period'],
      question_nl: `Die precieze periode kan ik niet leveren — het meest recente cijfer van ${subject} gaat over ${periodCodeToNl(freshest.periodCode)}. Welke periode bedoel je?`,
      question_en: `I can't give you that exact period — the most recent figure for ${subjectEn} covers ${periodCodeToEn(freshest.periodCode)}. Which period do you mean?`,
      options: [periodCodeToNl(freshest.periodCode)],
      options_en: [periodCodeToEn(freshest.periodCode)],
      untranslated_en: [],
      reason: `echo suggestion is not servable (${verdict.kind}); offering the freshest loaded period instead`,
    };
  }
  return {
    kind: 'clarification',
    ...context,
    axes: ['measure'],
    question_nl: `Zo kan ik dit niet leveren uit de geladen CBS-cijfers. Kun je aangeven wat je precies wilt weten over ${subject}?`,
    question_en: `I can't give you this from the loaded CBS figures. Could you specify exactly what you want to know about ${subjectEn}?`,
    options: [],
    options_en: [],
    untranslated_en: [],
    reason: `echo suggestion is not servable (${verdict.kind}) and no honest availability window exists`,
  };
}

/** #64 (owner decision 2026-07-04, built session 22): a question that
 * EXPLICITLY names several absolute periods ("in Rotterdam in 2020 en in
 * 2022") is an enumeration, not an ambiguity — R7's rule 4 exists for
 * competing INTERPRETATIONS, and the owner decision reads enumerations out
 * of it. When every plausible reading agrees on everything except a
 * single-code yearly period, each period is absolute and pairwise distinct,
 * and every named year literally appears in the question text, the readings
 * merge into ONE multi-code intent — which the query contract already
 * serves as an ordinary series (verified empirically against the fixture
 * DB before this was built). Deliberately narrow v1, each condition closing
 * a wrong-merge class:
 *  - JJ single-code periods only (the live-observed shape; KW/MM
 *    enumerations keep clarifying until measured need);
 *  - derivation 'none' on every reading (difference/max enumerations have
 *    their own semantics);
 *  - identical target AND regions (Utrecht gemeente-vs-provincie differs on
 *    the REGION axis and therefore never merges — that IS interpretation
 *    ambiguity);
 *  - every year's digits present in the question (the honest test of "the
 *    user themselves named it"; a model-invented year cannot merge).
 * The merged reading then faces rules 3/5 like any other candidate — at the
 * WEAKEST source confidence, so a shaky enumeration still confirms first. */
export function mergeExplicitPeriodEnumeration(
  question: string,
  candidates: RankedCandidate[],
): RankedCandidate | null {
  if (candidates.length < 2) return null;
  const first = candidates[0]!;
  const years: number[] = [];
  for (const candidate of candidates) {
    if (candidate.intent.derivation !== 'none') return null;
    if (stableStringify(candidate.intent.target) !== stableStringify(first.intent.target)) return null;
    if (regionAxisOf(candidate.intent) !== regionAxisOf(first.intent)) return null;
    const period = candidate.intent.period;
    if (period.kind !== 'codes' || period.codes.length !== 1) return null;
    const match = /^(\d{4})JJ00$/.exec(period.codes[0]!);
    if (!match) return null;
    const year = Number(match[1]);
    if (!question.includes(String(year))) return null;
    years.push(year);
  }
  if (new Set(years).size !== years.length) return null;
  const sorted = [...years].sort((a, b) => a - b);
  return {
    intent: { ...first.intent, period: { kind: 'codes', codes: sorted.map((y) => `${y}JJ00`) } },
    confidence: Math.min(...candidates.map((c) => c.confidence)),
    reading: `expliciet genoemde jaren: ${
      sorted.length === 2
        ? sorted.join(' en ')
        : `${sorted.slice(0, -1).join(', ')} en ${sorted[sorted.length - 1]}`
    }`,
    impliedRecency: false,
  };
}

export async function decide(
  context: OutcomeContext,
  resolutions: CandidateResolution[],
  config: ParserConfig,
  servability: ServabilityCheck,
  /** WP16 sub-part 2 (ADR 026): OPTIONAL — when present and the outcome is the
   * unmatched-measure exit, the finder can route to the onboarding trigger.
   * Absent → the plain B15 clarification, byte-identical (the load-bearing
   * pin). Only the resolutions-empty branch consults it; every other decision
   * path is a normal clarification/intent that has nothing to onboard. */
  finder?: TableFinder,
  /** WP26 mechanism A (ADR 024): the `CLARIFY_CLICK_ENABLED` rollout flag,
   * threaded from web/app/actions.ts. Absent/false (benchmark, tests, CLI, and
   * production until the owner flips it) → not one dry-run runs here and every
   * clarification is byte-identical to the pre-WP26 one. */
  clickOptionsEnabled = false,
  /** Eurostat E2a (final-review fix wave C1): the test seam of the click
   * trust boundary's sibling allowlist, same shape as `resolveCandidate`'s
   * `eurostatSiblings` option — a test that injects a sibling pair at
   * resolution injects the same map here, so the offer-side gate agrees with
   * the resolver. Absent (every production caller) ⇒ the production map. */
  clickValidation: ClickValidationOptions = {},
): Promise<ParseOutcome> {
  if (resolutions.length === 0) return resolveUnmatched(context, finder);

  const ranked = [...mergeResolutions(resolutions)].sort((a, b) => b.confidence - a.confidence);
  const top = ranked[0]!;

  // Rule 2: never fall through past a failed top reading.
  if (isResolutionFailure(top)) {
    return clarificationFromFailure(context, top, servability, clickOptionsEnabled, clickValidation);
  }

  // Rule 2.5 (#64): an explicit enumeration of named absolute periods merges
  // into one multi-code intent instead of firing rule 4 — then re-enters the
  // rules as a single candidate (one-level recursion: a lone candidate can
  // never merge again), so rule 3's confirm-when-doubting still applies at
  // the weakest source confidence.
  const plausible = ranked.filter((candidate) => candidate.confidence >= config.runnerUpThreshold);
  if (
    plausible.length >= 2 &&
    plausible.every((candidate): candidate is RankedCandidate => !isResolutionFailure(candidate))
  ) {
    const enumerated = mergeExplicitPeriodEnumeration(context.question, plausible);
    // The enumerated recursion is a resolved single candidate, never the
    // unmatched exit — the finder is irrelevant there, so it is not threaded.
    // The click flag IS threaded: the recursion can still exit via rule 3.
    if (enumerated) {
      return decide(context, [enumerated], config, servability, undefined, clickOptionsEnabled, clickValidation);
    }
  }

  // Rule 3: a lone reading the model itself doubts → confirm, don't guess —
  // but only offer a suggestion that would actually answer when confirmed
  // (#56, ADR 021 decision 4): an unservable one names what IS loaded instead.
  //
  // #267: EXCEPT when the dry-run ends in an honest structural SCOPE refusal
  // (the query refusal's subReason — e.g. "werkloosheid per provincie" on a
  // national-only measure). Confirming the reading cannot change that outcome,
  // and the echo fallback below would misreport it as a period problem ("Die
  // precieze periode kan ik niet leveren"), so the reading passes on and the
  // query layer's own refusal wording says what is really missing. That
  // wording names the measure it understood, so a misread stays visible, and
  // it carries no number (principle c).
  const topVerdict = top.confidence < config.answerThreshold ? await servability(top.intent) : null;
  const scopeRefusal = topVerdict !== null && !topVerdict.servable && topVerdict.subReason !== undefined;
  if (topVerdict !== null && !scopeRefusal) {
    const verdict = topVerdict;
    if (!verdict.servable) return echoUnservableClarification(context, top, verdict);
    const confirm = {
      kind: 'clarification',
      ...context,
      axes: ['measure'],
      question_nl: `Bedoel je ${top.reading}?`,
      question_en: didYouMeanEn(top.reading),
      options: [top.reading],
      options_en: [top.reading],
      untranslated_en: [top.reading],
      reason: `top reading confidence ${top.confidence} is below the answer threshold ${config.answerThreshold}`,
    } as const satisfies Extract<ParseOutcome, { kind: 'clarification' }>;
    // WP26 mechanism A: this exact intent was JUST proven servable one line
    // above, so the confirm-option needs no second dry-run — offering it means
    // "yes, that one" resolves without a paid re-parse.
    return clickOptionsEnabled
      ? withClickOptions(confirm, [
          {
            id: 'opt-1',
            label: top.reading,
            intent: top.intent,
            impliedRecency: top.impliedRecency,
          },
        ])
      : confirm;
  }

  // Rule 4: a materially different plausible second reading → user-facing
  // ambiguity. A failed runner-up counts: it would itself have clarified.
  const runnerUp = ranked
    .slice(1)
    .find((candidate) => candidate.confidence >= config.runnerUpThreshold);
  if (runnerUp) {
    const failed = isResolutionFailure(runnerUp);
    // #63: the SAME unconditional servability dry-run rule 3 already runs for
    // its own lone reading, now run for BOTH rule-4 readings — regardless of
    // clickOptionsEnabled. Before this, only the click-options branch below
    // ever checked servability here, so the PLAIN-TEXT options (what
    // production actually shows today, flag off) could confirm a dead end —
    // exactly the class WP15's #56 fix exists to prevent for rule 3. A failed
    // runner-up has no intent to check (pre-existing) and is never servable.
    // Narrowed once here (matching the pre-existing technique below of
    // ternary-ing on the `failed` const alias) so every later use of the
    // runner-up's intent/impliedRecency stays type-safe without re-deriving
    // narrowing from a compound boolean TS can't trace back to `runnerUp`.
    const runnerUpIntent = failed ? null : runnerUp.intent;
    const runnerUpImpliedRecency = failed ? false : runnerUp.impliedRecency;
    const topVerdict = await servability(top.intent);
    const runnerUpVerdict = runnerUpIntent === null ? null : await servability(runnerUpIntent);
    const topServable = topVerdict.servable;
    const runnerUpServable = runnerUpVerdict !== null && runnerUpVerdict.servable;

    // Neither reading would answer: the same fallback rule 3 uses for its own
    // unservable top reading — name what IS loaded rather than offer a pair
    // that both dead-end.
    if (!topServable && !runnerUpServable) {
      return echoUnservableClarification(
        context,
        top,
        topVerdict as Extract<EchoServability, { servable: false }>,
      );
    }
    // Exactly one reading survives: this is no longer a two-way ambiguity —
    // the same single-reading confirm shape rule 3 uses, reusing the verdict
    // already computed above instead of a second dry-run.
    if (topServable !== runnerUpServable) {
      const solo = topServable
        ? { reading: top.reading, intent: top.intent, impliedRecency: top.impliedRecency }
        : { reading: runnerUp.reading, intent: runnerUpIntent!, impliedRecency: runnerUpImpliedRecency };
      const confirm = {
        kind: 'clarification',
        ...context,
        axes: ['measure'],
        question_nl: `Bedoel je ${solo.reading}?`,
        question_en: didYouMeanEn(solo.reading),
        options: [solo.reading],
        options_en: [solo.reading],
        untranslated_en: [solo.reading],
        reason: `only one of two plausible readings is servable (rule 4 → rule-3-shaped confirm): the other would dead-end`,
      } as const satisfies Extract<ParseOutcome, { kind: 'clarification' }>;
      return clickOptionsEnabled
        ? withClickOptions(confirm, [
            {
              id: 'opt-1',
              label: solo.reading,
              intent: solo.intent,
              impliedRecency: solo.impliedRecency,
            },
          ])
        : confirm;
    }

    // Both servable: the outcome shape is unchanged from before #63.
    const outcome = {
      kind: 'clarification',
      ...context,
      axes: failed ? [runnerUp.axis] : differingAxes(top, runnerUp),
      question_nl: `Bedoel je ${joinOf([top.reading, runnerUp.reading])}?`,
      question_en: didYouMeanEn(joinOfEn([top.reading, runnerUp.reading])),
      options: [top.reading, runnerUp.reading],
      options_en: [top.reading, runnerUp.reading],
      untranslated_en: [top.reading, runnerUp.reading],
      reason: failed
        ? `plausible alternative reading did not resolve: ${runnerUp.message}`
        : `two plausible readings above the runner-up threshold ${config.runnerUpThreshold}`,
    } as const satisfies Extract<ParseOutcome, { kind: 'clarification' }>;
    if (!clickOptionsEnabled) return outcome;
    // WP26 mechanism A: the one shape the measured corpus dead-ends on most —
    // two competing readings, the user retypes one of them. Both verdicts are
    // already known from the dry-run above — reused here, not re-run. (Both
    // reaching here implies !failed, since a failed runner-up is never
    // servable — runnerUpIntent is therefore never null in this branch.)
    const clickOptions: ClickOption[] = [
      { id: 'opt-1', label: top.reading, intent: top.intent, impliedRecency: top.impliedRecency },
      {
        id: 'opt-2',
        label: runnerUp.reading,
        intent: runnerUpIntent!,
        impliedRecency: runnerUpImpliedRecency,
      },
    ];
    return withClickOptions(outcome, clickOptions);
  }

  const successes = ranked.filter(
    (candidate): candidate is RankedCandidate => !isResolutionFailure(candidate),
  );
  return {
    kind: 'intent',
    ...context,
    intent: top.intent,
    confidence: top.confidence,
    impliedRecency: top.impliedRecency,
    // WP26 mechanism B-period: present-only, so a turn that defaulted nothing
    // serializes the pre-WP26 outcome shape.
    ...(top.periodDefaulted === true ? { periodDefaulted: true } : {}),
    ranked: successes,
  };
}

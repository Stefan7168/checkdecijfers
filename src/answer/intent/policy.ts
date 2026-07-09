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
import { stableStringify } from './client.ts';
import { isResolutionFailure, type CandidateResolution } from './resolve.ts';
import type {
  ClarifyAxis,
  LlmUsage,
  ParseOutcome,
  ParserConfig,
  RankedCandidate,
  RawParse,
  ResolutionFailure,
} from './types.ts';

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
  }
}

function clarificationFromFailure(
  context: OutcomeContext,
  failure: ResolutionFailure,
): ParseOutcome {
  return {
    kind: 'clarification',
    ...context,
    axes: [failure.axis],
    question_nl: failureQuestion(failure),
    options: failure.options,
    reason: failure.message,
  };
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
  const term = context.raw.unmatchedMeasureTerm ?? 'dit onderwerp';
  const nearest = context.raw.nearestCanonicalKeys
    .map((key) => definitionLabelByKey.get(key))
    .filter((label): label is string => label !== undefined);
  const options = nearest.length > 0 ? nearest : [...definitionLabelByKey.values()].slice(0, 3);
  const lead = `Ik heb geen CBS-cijfers over "${term}" geladen`;
  const question =
    nearest.length > 0
      ? `${lead} — bedoel je misschien ${joinOf(nearest)}, en zo ja voor welke regio en periode?`
      : `${lead} — welk onderwerp uit mijn bronnen bedoel je (bijvoorbeeld ${options.join(', ')}), en voor welke regio en periode?`;
  return {
    kind: 'clarification',
    ...context,
    axes: ['measure', 'region', 'period'],
    question_nl: question,
    options,
    reason: `measure term "${term}" matches no canonical measure`,
  };
}

/** Axes on which two resolved readings differ — the user-facing shape of the
 * ambiguity, named in the clarification. */
export function differingAxes(a: RankedCandidate, b: RankedCandidate): ClarifyAxis[] {
  const axes: ClarifyAxis[] = [];
  if (stableStringify(a.intent.target) !== stableStringify(b.intent.target)) axes.push('measure');
  if (stableStringify(a.intent.regions ?? []) !== stableStringify(b.intent.regions ?? [])) {
    axes.push('region');
  }
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
    return {
      kind: 'clarification',
      ...context,
      axes: ['measure', ...axes],
      question_nl: question,
      options: askRegion
        ? ['heel Nederland (landelijk cijfer)', 'een specifieke gemeente of provincie — noem de naam']
        : [top.reading],
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
      options: [`${range.fromYear} tot en met ${range.toYear}`],
      reason: `echo suggestion is not servable (${verdict.kind}); offering the loaded year window instead`,
    };
  }
  if (freshest !== null) {
    return {
      kind: 'clarification',
      ...context,
      axes: ['period'],
      question_nl: `Die precieze periode kan ik niet leveren — het meest recente cijfer van ${subject} gaat over ${periodCodeToNl(freshest.periodCode)}. Welke periode bedoel je?`,
      options: [periodCodeToNl(freshest.periodCode)],
      reason: `echo suggestion is not servable (${verdict.kind}); offering the freshest loaded period instead`,
    };
  }
  return {
    kind: 'clarification',
    ...context,
    axes: ['measure'],
    question_nl: `Zo kan ik dit niet leveren uit de geladen CBS-cijfers. Kun je aangeven wat je precies wilt weten over ${subject}?`,
    options: [],
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
    if (stableStringify(candidate.intent.regions ?? []) !== stableStringify(first.intent.regions ?? [])) {
      return null;
    }
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
): Promise<ParseOutcome> {
  if (resolutions.length === 0) return resolveUnmatched(context, finder);

  const ranked = [...mergeResolutions(resolutions)].sort((a, b) => b.confidence - a.confidence);
  const top = ranked[0]!;

  // Rule 2: never fall through past a failed top reading.
  if (isResolutionFailure(top)) return clarificationFromFailure(context, top);

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
    if (enumerated) return decide(context, [enumerated], config, servability);
  }

  // Rule 3: a lone reading the model itself doubts → confirm, don't guess —
  // but only offer a suggestion that would actually answer when confirmed
  // (#56, ADR 021 decision 4): an unservable one names what IS loaded instead.
  if (top.confidence < config.answerThreshold) {
    const verdict = await servability(top.intent);
    if (!verdict.servable) return echoUnservableClarification(context, top, verdict);
    return {
      kind: 'clarification',
      ...context,
      axes: ['measure'],
      question_nl: `Bedoel je ${top.reading}?`,
      options: [top.reading],
      reason: `top reading confidence ${top.confidence} is below the answer threshold ${config.answerThreshold}`,
    };
  }

  // Rule 4: a materially different plausible second reading → user-facing
  // ambiguity. A failed runner-up counts: it would itself have clarified.
  const runnerUp = ranked
    .slice(1)
    .find((candidate) => candidate.confidence >= config.runnerUpThreshold);
  if (runnerUp) {
    if (isResolutionFailure(runnerUp)) {
      return {
        kind: 'clarification',
        ...context,
        axes: [runnerUp.axis],
        question_nl: `Bedoel je ${joinOf([top.reading, runnerUp.reading])}?`,
        options: [top.reading, runnerUp.reading],
        reason: `plausible alternative reading did not resolve: ${runnerUp.message}`,
      };
    }
    return {
      kind: 'clarification',
      ...context,
      axes: differingAxes(top, runnerUp),
      question_nl: `Bedoel je ${joinOf([top.reading, runnerUp.reading])}?`,
      options: [top.reading, runnerUp.reading],
      reason: `two plausible readings above the runner-up threshold ${config.runnerUpThreshold}`,
    };
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
    ranked: successes,
  };
}

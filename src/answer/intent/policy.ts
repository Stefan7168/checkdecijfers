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

export function decide(
  context: OutcomeContext,
  resolutions: CandidateResolution[],
  config: ParserConfig,
): ParseOutcome {
  if (resolutions.length === 0) return buildUnmatchedClarification(context);

  const ranked = [...mergeResolutions(resolutions)].sort((a, b) => b.confidence - a.confidence);
  const top = ranked[0]!;

  // Rule 2: never fall through past a failed top reading.
  if (isResolutionFailure(top)) return clarificationFromFailure(context, top);

  // Rule 3: a lone reading the model itself doubts → confirm, don't guess.
  if (top.confidence < config.answerThreshold) {
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

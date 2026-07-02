// Labelled-case expectations for the intent parser — shared between the
// hermetic replay tests (tests/answer/) and the live eval/calibration script
// (scripts/intent-eval.ts), so "pass" means the same thing on CI and against
// the live model.
import { readFileSync } from 'node:fs';
import { stableStringify } from '../../src/answer/intent/index.ts';
import type { ClarifyAxis, ParseOutcome } from '../../src/answer/intent/index.ts';
import type { StructuredIntent } from '../../src/query/index.ts';
import {
  ANSWERABLE_TASKS,
  REFUSAL_TASK_QUESTIONS,
  UNDISAMBIGUATED_VARIANTS,
} from './benchmark-intents.ts';

export interface IntentChecks {
  canonicalKey?: string;
  grain?: 'JJ' | 'KW' | 'MM';
  regions?: string[];
  derivation?: string;
  impliedRecency?: boolean;
}

export interface Expectation {
  outcome: 'intent' | 'clarification' | 'refusal';
  intent?: StructuredIntent;
  checks?: IntentChecks;
  axesInclude?: ClarifyAxis[];
  refusalKind?: string;
}

export interface LabelledCase {
  id: string;
  category: string;
  question: string;
  expect: Expectation;
}

export interface LabelledSet {
  version: number;
  referenceDate: string;
  note: string;
  cases: LabelledCase[];
}

export function loadLabelledSet(): LabelledSet {
  return JSON.parse(
    readFileSync(new URL('../../benchmark/intent-labelled-set.json', import.meta.url), 'utf8'),
  ) as LabelledSet;
}

/** CBS month code of the month before the reference date — what "vorige
 * maand" must resolve to (B20). */
export function previousMonthCode(referenceDateIso: string): string {
  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(referenceDateIso);
  if (!match) throw new Error(`referenceDate must be YYYY-MM-DD, got "${referenceDateIso}"`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  return month === 1 ? `${year - 1}MM12` : `${year}MM${String(month - 1).padStart(2, '0')}`;
}

/** The benchmark tasks as labelled cases — B1–B14 expect their hand-authored
 * intent verbatim; B15/B16 must clarify; B17–B19 must classify; B20 must emit
 * the previous-month CPI intent (whose freshness refusal the query layer
 * then produces — asserted separately in the tests). */
export function benchmarkCases(referenceDate: string): LabelledCase[] {
  const cases: LabelledCase[] = [];
  for (const [taskId, task] of Object.entries(ANSWERABLE_TASKS)) {
    cases.push({
      id: taskId,
      category: 'benchmark_answerable',
      question: task.question,
      expect: { outcome: 'intent', intent: task.intent },
    });
  }
  for (const [taskId, task] of Object.entries(UNDISAMBIGUATED_VARIANTS)) {
    cases.push({
      id: taskId,
      category: 'variant',
      question: task.question,
      expect: { outcome: 'intent', intent: task.intent },
    });
  }
  cases.push(
    {
      id: 'B15',
      category: 'benchmark_clarify',
      question: REFUSAL_TASK_QUESTIONS.B15!,
      expect: { outcome: 'clarification', axesInclude: ['measure'] },
    },
    {
      id: 'B16',
      category: 'benchmark_clarify',
      question: REFUSAL_TASK_QUESTIONS.B16!,
      expect: { outcome: 'clarification', axesInclude: ['region'] },
    },
    {
      id: 'B17',
      category: 'benchmark_refusal',
      question: REFUSAL_TASK_QUESTIONS.B17!,
      expect: { outcome: 'refusal', refusalKind: 'out_of_scope' },
    },
    {
      id: 'B18',
      category: 'benchmark_refusal',
      question: REFUSAL_TASK_QUESTIONS.B18!,
      expect: { outcome: 'refusal', refusalKind: 'forecast' },
    },
    {
      id: 'B19',
      category: 'benchmark_refusal',
      question: REFUSAL_TASK_QUESTIONS.B19!,
      expect: { outcome: 'refusal', refusalKind: 'causal' },
    },
    {
      id: 'B20',
      category: 'benchmark_freshness',
      question: REFUSAL_TASK_QUESTIONS.B20!,
      expect: {
        outcome: 'intent',
        intent: {
          schemaVersion: 1,
          target: { kind: 'canonical', key: 'cpi_yearly_inflation' },
          period: { kind: 'codes', codes: [previousMonthCode(referenceDate)] },
          derivation: 'none',
        },
        checks: { impliedRecency: true },
      },
    },
  );
  return cases;
}

export function allCases(set: LabelledSet): LabelledCase[] {
  return [...benchmarkCases(set.referenceDate), ...set.cases];
}

function grainOf(intent: StructuredIntent): string {
  const code = intent.period.kind === 'codes' ? intent.period.codes[0]! : intent.period.from;
  return /(JJ|KW|MM)/.exec(code)?.[1] ?? '??';
}

/** Returns a list of problems — empty means the outcome matches the label. */
export function checkExpectation(outcome: ParseOutcome, expect: Expectation): string[] {
  const problems: string[] = [];
  if (outcome.kind !== expect.outcome) {
    const detail =
      outcome.kind === 'clarification'
        ? ` (asked: "${outcome.question_nl}")`
        : outcome.kind === 'refusal'
          ? ` (${outcome.refusalKind})`
          : '';
    return [`expected outcome "${expect.outcome}", got "${outcome.kind}"${detail}`];
  }
  if (outcome.kind === 'intent') {
    if (expect.intent && stableStringify(outcome.intent) !== stableStringify(expect.intent)) {
      problems.push(
        `intent mismatch:\n  expected ${stableStringify(expect.intent)}\n  got      ${stableStringify(outcome.intent)}`,
      );
    }
    const checks = expect.checks;
    if (checks) {
      if (
        checks.canonicalKey !== undefined &&
        (outcome.intent.target.kind !== 'canonical' ||
          outcome.intent.target.key !== checks.canonicalKey)
      ) {
        problems.push(`expected canonical key ${checks.canonicalKey}, got ${stableStringify(outcome.intent.target)}`);
      }
      if (checks.grain !== undefined && grainOf(outcome.intent) !== checks.grain) {
        problems.push(`expected grain ${checks.grain}, got ${grainOf(outcome.intent)}`);
      }
      if (
        checks.regions !== undefined &&
        stableStringify(outcome.intent.regions ?? []) !== stableStringify(checks.regions)
      ) {
        problems.push(`expected regions ${checks.regions.join(',')}, got ${(outcome.intent.regions ?? []).join(',')}`);
      }
      if (checks.derivation !== undefined && outcome.intent.derivation !== checks.derivation) {
        problems.push(`expected derivation ${checks.derivation}, got ${outcome.intent.derivation}`);
      }
      if (checks.impliedRecency !== undefined && outcome.impliedRecency !== checks.impliedRecency) {
        problems.push(`expected impliedRecency=${checks.impliedRecency}, got ${outcome.impliedRecency}`);
      }
    }
  }
  if (outcome.kind === 'clarification') {
    for (const axis of expect.axesInclude ?? []) {
      if (!outcome.axes.includes(axis)) {
        problems.push(`expected clarification axes to include "${axis}", got [${outcome.axes.join(', ')}]`);
      }
    }
    const questionMarks = (outcome.question_nl.match(/\?/g) ?? []).length;
    if (questionMarks !== 1) {
      problems.push(`clarification must ask exactly one compact question, found ${questionMarks} question marks in "${outcome.question_nl}"`);
    }
  }
  if (outcome.kind === 'refusal' && expect.refusalKind && outcome.refusalKind !== expect.refusalKind) {
    problems.push(`expected refusal kind "${expect.refusalKind}", got "${outcome.refusalKind}"`);
  }
  return problems;
}

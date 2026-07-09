// WP16 sub-part 2 (ADR 026, design §2): the trigger flow at the answer-pipeline
// seam. Two things are pinned here:
//  1. THE LOAD-BEARING PIN — with NO finder injected, the unmatched exit is
//     byte-identical to buildUnmatchedClarification's B15 output (design §0.1).
//  2. With a finder stub, confident/disclose/none/throw route correctly, both
//     verbatim Dutch copies are exact, and the already-pending path is distinct.
// All synthetic — no LLM, no database, no catalog. The finder is the injected
// TableFinder callback (its production impl is tested separately).
import { describe, expect, it } from 'vitest';
import {
  buildUnmatchedClarification,
  resolveUnmatched,
  type OnboardingRouting,
  type OutcomeContext,
  type RawParse,
  type TableFinder,
} from '../../src/answer/intent/index.ts';
import {
  ONBOARDING_ALREADY_PENDING_TEXT,
  ONBOARDING_PENDING_TEXT,
  buildOnboardingRefusal,
  toRefusalResponse,
} from '../../src/answer/respond/refusals.ts';

function context(raw?: Partial<RawParse>, question = 'synthetische vraag'): OutcomeContext {
  return {
    question,
    raw: {
      version: 3,
      kind: 'data_query',
      candidates: [],
      unmatchedMeasureTerm: null,
      nearestCanonicalKeys: [],
      note: null,
      ...raw,
    },
    model: 'test-model',
    usage: { inputTokens: 0, outputTokens: 0 },
  };
}

const B15_CONTEXT = context({
  unmatchedMeasureTerm: 'zonnestroom',
  nearestCanonicalKeys: ['unemployment_rate_seasonally_adjusted'],
});

const confidentFinder: TableFinder = async (term) => ({
  tableId: '82610NED',
  topicTerm: term,
  confidence: 0.91,
  alreadyPending: false,
});

describe('resolveUnmatched — the finder-aware unmatched exit (WP16 sub-part 2)', () => {
  it('THE LOAD-BEARING PIN: no finder → byte-identical to buildUnmatchedClarification (B15)', async () => {
    const withoutFinder = await resolveUnmatched(B15_CONTEXT, undefined);
    const b15 = buildUnmatchedClarification(B15_CONTEXT);
    // Deep-equal is the real byte pin: same kind, axes, question_nl, options,
    // reason — every field the B15 clarification carries, unchanged.
    expect(withoutFinder).toStrictEqual(b15);
    expect(withoutFinder.kind).toBe('clarification');
  });

  it('confident finder pick → an onboarding ParseOutcome carrying the pick', async () => {
    const outcome = await resolveUnmatched(B15_CONTEXT, confidentFinder);
    expect(outcome.kind).toBe('onboarding');
    if (outcome.kind !== 'onboarding') throw new Error('unreachable');
    expect(outcome.tableId).toBe('82610NED');
    expect(outcome.topicTerm).toBe('zonnestroom');
    expect(outcome.confidence).toBe(0.91);
    expect(outcome.alreadyPending).toBe(false);
    // The OutcomeBase fields still ride along for the audit record.
    expect(outcome.question).toBe(B15_CONTEXT.question);
    expect(outcome.raw).toBe(B15_CONTEXT.raw);
  });

  it('already-pending routing → alreadyPending true (no new fetch will be triggered)', async () => {
    const finder: TableFinder = async (term) => ({
      tableId: '82610NED',
      topicTerm: term,
      confidence: 0.9,
      alreadyPending: true,
    });
    const outcome = await resolveUnmatched(B15_CONTEXT, finder);
    expect(outcome.kind).toBe('onboarding');
    if (outcome.kind !== 'onboarding') throw new Error('unreachable');
    expect(outcome.alreadyPending).toBe(true);
  });

  it('finder returns null (disclose/none/low-confidence) → falls back to B15, byte-identical', async () => {
    const nullFinder: TableFinder = async () => null;
    const outcome = await resolveUnmatched(B15_CONTEXT, nullFinder);
    expect(outcome).toStrictEqual(buildUnmatchedClarification(B15_CONTEXT));
  });

  it('a null unmatchedMeasureTerm never consults the finder (nothing to search for)', async () => {
    let called = false;
    const spyFinder: TableFinder = async (term) => {
      called = true;
      return { tableId: 'X', topicTerm: term, confidence: 1, alreadyPending: false };
    };
    // context() defaults unmatchedMeasureTerm to null.
    const outcome = await resolveUnmatched(context(), spyFinder);
    expect(called).toBe(false);
    expect(outcome.kind).toBe('clarification');
  });

  it('passes the FULL question to the finder alongside the term (WP27 stage A, ADR 027 D3a)', async () => {
    let seenTerm: string | null = null;
    let seenQuestion: string | null = null;
    const spyFinder: TableFinder = async (term, question) => {
      seenTerm = term;
      seenQuestion = question;
      return null;
    };
    await resolveUnmatched(B15_CONTEXT, spyFinder);
    expect(seenTerm).toBe('zonnestroom');
    expect(seenQuestion).toBe(B15_CONTEXT.question);
  });
});

describe('onboarding acknowledgment copy — VERBATIM, owner-approved (design §2)', () => {
  it('onboarding_pending text is byte-exact and carries the envelope', () => {
    const built = buildOnboardingRefusal(
      { tableId: '82610NED', topicTerm: 'zonnestroom', confidence: 0.91 },
      false,
    );
    expect(built.reason).toBe('onboarding_pending');
    expect(built.text).toBe(
      'Dat onderwerp staat nog niet in onze database. We vragen de cijfers nu automatisch op bij het CBS en controleren ze — meestal een kwestie van minuten. Je krijgt een e-mail zodra je vraag beantwoord kan worden. Heb je ondertussen nog een andere vraag?',
    );
    expect(built.text).toBe(ONBOARDING_PENDING_TEXT);
    expect(built.onboarding).toEqual({ tableId: '82610NED', topicTerm: 'zonnestroom', confidence: 0.91 });
    // No unbacked numbers: the copy carries NO digit at all.
    expect(/[0-9]/.test(built.text)).toBe(false);
  });

  it('onboarding_already_pending text is byte-exact and carries NO envelope', () => {
    const built = buildOnboardingRefusal(
      { tableId: '82610NED', topicTerm: 'zonnestroom', confidence: 0.91 },
      true,
    );
    expect(built.reason).toBe('onboarding_already_pending');
    expect(built.text).toBe(
      'Deze cijfers worden al voor je opgehaald bij het CBS. Je krijgt een e-mail zodra je vraag beantwoord kan worden.',
    );
    expect(built.text).toBe(ONBOARDING_ALREADY_PENDING_TEXT);
    expect(built.onboarding).toBeNull();
    expect(/[0-9]/.test(built.text)).toBe(false);
  });

  it('toRefusalResponse propagates the onboarding envelope onto the response', () => {
    const built = buildOnboardingRefusal(
      { tableId: '82610NED', topicTerm: 'zonnestroom', confidence: 0.91 },
      false,
    );
    const response = toRefusalResponse({ question: 'q', built, parse: null, queryRefusal: null });
    expect(response.kind).toBe('refusal');
    expect(response.reason).toBe('onboarding_pending');
    expect(response.onboarding).toEqual({ tableId: '82610NED', topicTerm: 'zonnestroom', confidence: 0.91 });
    // The acknowledgment deliberately opens no clarification round.
    expect(response.text).toBe(ONBOARDING_PENDING_TEXT);
  });

  it('the already-pending response carries a null onboarding field', () => {
    const built = buildOnboardingRefusal(
      { tableId: '82610NED', topicTerm: 'zonnestroom', confidence: 0.91 },
      true,
    );
    const response = toRefusalResponse({ question: 'q', built, parse: null, queryRefusal: null });
    expect(response.onboarding).toBeNull();
  });

  // Guards the deliberate deviation: the onboarding_pending copy ENDS IN '?'
  // and must NOT be rejected by the refusal never-a-question guard. If a future
  // refactor routes it through assertNotAQuestion this test fails loudly.
  it('onboarding_pending copy intentionally ends in a question mark (an invited follow-up)', () => {
    const routing: OnboardingRouting = {
      tableId: 'X',
      topicTerm: 't',
      confidence: 0.9,
      alreadyPending: false,
    };
    expect(routing.alreadyPending).toBe(false);
    expect(ONBOARDING_PENDING_TEXT.trimEnd().endsWith('?')).toBe(true);
  });
});

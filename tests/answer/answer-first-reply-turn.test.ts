// #191 — the clarification REPLY turn must run under the SAME WP26 rollout
// flag as the first turn (ADR 024, R7 third branch).
//
// The bug these pins close was not "the reply turn is pre-WP26". It was that
// the reply turn ran HALF of mechanism B, a state nobody chose:
//
//   * B-REGION lives in the QUERY layer (src/query/resolve.ts) and already
//     reached reply turns through the `{ ...options }` spread into
//     respondToIntent, so it fired on replies even before this fix.
//   * B-PERIOD lives in the INTENT layer (src/answer/intent/resolve.ts:731)
//     and is fed by the ClarifyReplyOptions bag, which respond.ts built
//     without `answerFirstEnabled`.
//
// So with ANSWER_FIRST_ENABLED=1 a reply turn silently defaulted the region
// the user never mentioned and then REFUSED over the period it was allowed to
// default — after charging the clarification. R7's third branch draws no
// first-turn/reply-turn distinction, so that asymmetry was a conformance gap.
//
// The load-bearing pin here is AGREEMENT (the third describe block): the same
// intent must get the same servability verdict on both turns under the same
// flag. A pin that only asserted "the reply now answers" would still pass if a
// later change made the FIRST turn refuse too.
//
// Hermetic: fixture-ingested PGlite + canned parse. No LLM, no network.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../../src/db/types.ts';
import { createIngestedDb } from '../helpers/ingested-db.ts';
import { respondToClarificationReply, respondToQuestion } from '../../src/answer/respond/index.ts';
import type { PendingClarification } from '../../src/answer/respond/index.ts';
import type { LlmClient, LlmResponse } from '../../src/answer/llm/client.ts';
import type { RawParse } from '../../src/answer/intent/types.ts';

let db: Db;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createIngestedDb());
}, 300_000);

afterAll(async () => {
  await close();
});

const REFERENCE_DATE = '2026-08-15';

/** One canned RawParse for every request — the merge the LLM would have
 * produced, minus the LLM. */
class CannedClient implements LlmClient {
  // Explicit field, not a constructor parameter property: this repo compiles
  // with `erasableSyntaxOnly`, which forbids the shorthand.
  private readonly raw: RawParse;
  constructor(raw: RawParse) {
    this.raw = raw;
  }
  async complete(): Promise<LlmResponse> {
    return {
      outputText: JSON.stringify(this.raw),
      model: 'stub',
      stopReason: 'end_turn',
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  }
}

class ThrowingClient implements LlmClient {
  async complete(): Promise<LlmResponse> {
    throw new Error('boom: the answer client must not be reached');
  }
}

/** The shape #191 is about: the user disambiguated the REGION we asked for,
 * and the merged intent still carries no period signal at all. */
function periodlessMerge(): RawParse {
  return {
    version: 3,
    kind: 'data_query',
    candidates: [
      {
        canonicalKey: 'population_on_1_january',
        // RegionTerm objects, not bare strings — a string here fails the
        // raw-parse schema and lands in an 'internal' refusal, which would
        // make this test pass for entirely the wrong reason.
        regions: [{ name: 'Utrecht', kind: 'gemeente' }],
        period: { kind: 'none' },
        derivation: 'none',
        confidence: 0.95,
        reading: 'inwoners, regio verduidelijkt, geen periode genoemd',
      } as never,
    ],
    unmatchedMeasureTerm: null,
    nearestCanonicalKeys: [],
    note: null,
  };
}

/** A pending whose asked-about axis is the REGION — so the reply supplies the
 * region, and the period is the axis nobody ever asked about. */
const PENDING: PendingClarification = {
  version: 1,
  question: 'Hoeveel inwoners telde Utrecht?',
  referenceDate: REFERENCE_DATE,
  axes: ['region'],
  questionNl: 'Bedoel je de gemeente Utrecht of de provincie Utrecht?',
  options: ['Utrecht (gemeente)', 'Utrecht (PV)'],
};

function replyOptions(raw: RawParse, answerFirstEnabled: boolean) {
  return {
    intentClient: new CannedClient(raw),
    answerClient: new ThrowingClient(),
    referenceDate: REFERENCE_DATE,
    answerFirstEnabled,
  };
}

describe('#191 flag OFF: the reply turn is byte-identically pre-WP26', () => {
  it('still refuses a period-less reply, exactly as before', async () => {
    const response = await respondToClarificationReply(
      db,
      PENDING,
      'de gemeente',
      replyOptions(periodlessMerge(), false) as never,
    );

    expect(response.kind).toBe('refusal');
    if (response.kind !== 'refusal') return;
    // R7: a reply never asks again — a still-missing axis is the terminal
    // still-ambiguous refusal, not a second clarification.
    expect(response.reason).toBe('still_ambiguous');
  });
});

describe('#191 flag ON: the reply turn defaults the period like the first turn', () => {
  it('answers instead of dead-ending, once the flag actually reaches it', async () => {
    const response = await respondToClarificationReply(
      db,
      PENDING,
      'de gemeente',
      replyOptions(periodlessMerge(), true) as never,
    );

    // The regression this file exists to prevent: before the fix this was a
    // 'refusal' with reason 'still_ambiguous' — the user answered the exact
    // question we asked and was refused on an axis nobody asked about.
    expect(response.kind).not.toBe('refusal');
  });
});

describe('#191 the property that must hold: first turn and reply turn AGREE', () => {
  // This is the pin that survives future changes. It does not assert WHICH
  // verdict is right — it asserts the two halves of one conversation cannot
  // disagree about whether the same intent is servable.
  for (const answerFirstEnabled of [false, true]) {
    it(`reaches the same servability verdict on both turns (flag=${answerFirstEnabled})`, async () => {
      const raw = periodlessMerge();

      const firstTurn = await respondToQuestion(db, 'Hoeveel inwoners telde de gemeente Utrecht?', {
        intentClient: new CannedClient(raw),
        answerClient: new ThrowingClient(),
        referenceDate: REFERENCE_DATE,
        answerFirstEnabled,
      } as never);

      const replyTurn = await respondToClarificationReply(
        db,
        PENDING,
        'de gemeente',
        replyOptions(raw, answerFirstEnabled) as never,
      );

      const servable = (kind: string) => kind !== 'refusal' && kind !== 'clarification';
      expect(servable(replyTurn.kind)).toBe(servable(firstTurn.kind));
    });
  }
});

// #134(c) (ADR 029) — the forecast/causal refusal's own honest "I can look up
// X for period Y" offer, turned into ONE takeable chip via the existing
// #134/#73-v2 mechanism: the same nearestCanonicalKeys[0] + freshest-period
// candidate the prose already names, the same servability dry-run gate, and
// the same chip-carrier pending as every other #134 chip and the WP26c
// rescue chip beside it.
//
// What is pinned here:
//  1. The refusal TEXT and classification are UNCHANGED by the chip mechanism
//     (on or off) — the chip is an escape hatch beside an honest refusal, a
//     concrete alternative already stated in prose, never a correction of it.
//  2. A chip is offered ONLY when the dry-run proves the candidate loaded and
//     servable — no strong single match, or a failed dry-run, ⇒ no chip and a
//     byte-identical envelope.
//  3. Taking the chip resolves deterministically (zero LLM calls) to the
//     freshest period, through the ordinary reply path.
//  4. Causal never fires without a definitionLabel match.
//  5. Flag off ⇒ no chip, no pending key at all.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../../src/db/types.ts';
import { createIngestedDb } from '../helpers/ingested-db.ts';
import { respondToClarificationReply, respondToQuestion } from '../../src/answer/respond/index.ts';
import { freshestForCanonical } from '../../src/query/index.ts';
import { periodCodeToNl } from '../../src/answer/respond/period-nl.ts';
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

class CannedClient implements LlmClient {
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
    throw new Error('LLM call attempted on a path that must be deterministic');
  }
}

function misfire(kind: RawParse['kind'], nearest: string[]): RawParse {
  return {
    version: 3,
    kind,
    candidates: [],
    unmatchedMeasureTerm: null,
    nearestCanonicalKeys: nearest,
    note: null,
  };
}

function options(clickOptionsEnabled?: boolean) {
  return {
    intentClient: new ThrowingClient(),
    answerClient: new ThrowingClient(),
    referenceDate: REFERENCE_DATE,
    ...(clickOptionsEnabled === undefined ? {} : { clickOptionsEnabled }),
  };
}

async function ask(question: string, raw: RawParse, clickOptionsEnabled?: boolean) {
  return respondToQuestion(db, question, { ...options(clickOptionsEnabled), intentClient: new CannedClient(raw) });
}

describe('the forecast refusal offer chip (#134(c))', () => {
  it('carries exactly one takeable chip resolving to the freshest period, for a servable nearest measure', async () => {
    const freshest = await freshestForCanonical(db, 'cpi_yearly_inflation');
    if (!freshest) throw new Error('fixture db must load cpi_yearly_inflation for this test');

    const response = await ask(
      'Wat wordt de inflatie volgend jaar?',
      misfire('forecast_request', ['cpi_yearly_inflation']),
      true,
    );
    expect(response.kind).toBe('refusal');
    if (response.kind !== 'refusal') throw new Error('unreachable');
    // The classification and the honest text are UNTOUCHED.
    expect(response.reason).toBe('forecast');
    expect(response.text).toContain('CBS publiceert gerealiseerde cijfers');

    expect(response.suggestions).toHaveLength(1);
    expect(response.suggestions[0]).toBe(`Wat was de inflatie in ${periodCodeToNl(freshest.periodCode)}?`);

    const clickOptions = response.pending?.clickOptions ?? [];
    expect(clickOptions).toHaveLength(1);
    expect(clickOptions[0]!.label).toBe(response.suggestions[0]);
    expect(clickOptions[0]!.intent.target).toEqual({ kind: 'canonical', key: 'cpi_yearly_inflation' });
    expect(clickOptions[0]!.intent.period).toEqual({ kind: 'codes', codes: [freshest.periodCode] });
    expect(clickOptions[0]!.intent.regions).toBeUndefined();
    expect(clickOptions[0]!.impliedRecency).toBe(false);
    expect(response.pending?.rescueOnly).toBe(true);
  });

  it('taking the chip answers WITHOUT an LLM call, attributed to the freshest period', async () => {
    const freshest = await freshestForCanonical(db, 'cpi_yearly_inflation');
    if (!freshest) throw new Error('fixture db must load cpi_yearly_inflation for this test');

    const refusal = await ask(
      'Wat wordt de inflatie volgend jaar?',
      misfire('forecast_request', ['cpi_yearly_inflation']),
      true,
    );
    if (refusal.kind !== 'refusal' || !refusal.pending) throw new Error('expected an offer-chip pending');

    // Both clients throw: reaching any model on this path fails the test.
    const taken = await respondToClarificationReply(db, refusal.pending, refusal.suggestions[0]!, {
      ...options(true),
    });
    expect(taken.kind).toBe('answer');
    if (taken.kind !== 'answer') throw new Error('unreachable');
    expect(taken.result.cells).toHaveLength(1);
    expect(taken.result.cells[0]!.periodCode).toBe(freshest.periodCode);
    expect(taken.answer.source).toBe('template');
  });

  it('offers no chip (byte-identical envelope) when the candidate is not servable — a regional measure with no place named and mechanism B off', async () => {
    // population_on_1_january is regional; with no region on the candidate
    // intent and answerFirstEnabled off, the dry-run refuses needs_clarification
    // — the exact "computed a candidate, but it does not resolve" case.
    const response = await ask(
      'Wat wordt het aantal inwoners volgend jaar?',
      misfire('forecast_request', ['population_on_1_january']),
      true,
    );
    if (response.kind !== 'refusal') throw new Error('unreachable');
    expect(response.suggestions).toEqual([]);
    expect(response.pending).toBeUndefined();
  });

  it('offers no chip when nearestCanonicalKeys is empty (no candidate at all)', async () => {
    const response = await ask('Wat wordt de rentestand volgend jaar?', misfire('forecast_request', []), true);
    if (response.kind !== 'refusal') throw new Error('unreachable');
    expect(response.suggestions).toEqual([]);
    expect(response.pending).toBeUndefined();
  });

  it('flag off: no chip, and no pending key at all', async () => {
    const response = await ask(
      'Wat wordt de inflatie volgend jaar?',
      misfire('forecast_request', ['cpi_yearly_inflation']),
    );
    if (response.kind !== 'refusal') throw new Error('unreachable');
    expect(response.suggestions).toEqual([]);
    expect(Object.hasOwn(response, 'pending')).toBe(false);
  });

  it('the refusal text and offer prose are byte-identical whether or not the chip mechanism is on', async () => {
    const flagOff = await ask(
      'Wat wordt de inflatie volgend jaar?',
      misfire('forecast_request', ['cpi_yearly_inflation']),
      false,
    );
    const flagOn = await ask(
      'Wat wordt de inflatie volgend jaar?',
      misfire('forecast_request', ['cpi_yearly_inflation']),
      true,
    );
    if (flagOff.kind !== 'refusal' || flagOn.kind !== 'refusal') throw new Error('unreachable');
    expect(flagOn.text).toBe(flagOff.text);
    expect(flagOn.reason).toBe(flagOff.reason);
    expect(flagOn.offer).toBe(flagOff.offer);
  });
});

describe('the causal refusal offer chip (#134(c))', () => {
  it('carries exactly one takeable chip when nearestCanonicalKeys resolves to a definitionLabel', async () => {
    const freshest = await freshestForCanonical(db, 'bankruptcies_businesses');
    if (!freshest) throw new Error('fixture db must load bankruptcies_businesses for this test');

    const response = await ask(
      'Komt dat door de rente?',
      misfire('causal_question', ['bankruptcies_businesses']),
      true,
    );
    expect(response.kind).toBe('refusal');
    if (response.kind !== 'refusal') throw new Error('unreachable');
    expect(response.reason).toBe('causal');
    expect(response.text).toMatch(/oorzakelijk/i);

    expect(response.suggestions).toHaveLength(1);
    const clickOptions = response.pending?.clickOptions ?? [];
    expect(clickOptions).toHaveLength(1);
    expect(clickOptions[0]!.intent.target).toEqual({ kind: 'canonical', key: 'bankruptcies_businesses' });
    expect(clickOptions[0]!.intent.period).toEqual({ kind: 'codes', codes: [freshest.periodCode] });
    expect(clickOptions[0]!.impliedRecency).toBe(false);
  });

  it('offers no chip when nearestCanonicalKeys is empty (no definitionLabel to name)', async () => {
    const response = await ask('Komt dat door het weer?', misfire('causal_question', []), true);
    if (response.kind !== 'refusal') throw new Error('unreachable');
    expect(response.suggestions).toEqual([]);
    expect(response.pending).toBeUndefined();
  });

  it('taking the causal offer chip answers deterministically, attributed to the freshest period', async () => {
    const freshest = await freshestForCanonical(db, 'bankruptcies_businesses');
    if (!freshest) throw new Error('fixture db must load bankruptcies_businesses for this test');

    const refusal = await ask(
      'Komt dat door de rente?',
      misfire('causal_question', ['bankruptcies_businesses']),
      true,
    );
    if (refusal.kind !== 'refusal' || !refusal.pending) throw new Error('expected an offer-chip pending');

    const taken = await respondToClarificationReply(db, refusal.pending, refusal.suggestions[0]!, {
      ...options(true),
    });
    expect(taken.kind).toBe('answer');
    if (taken.kind !== 'answer') throw new Error('unreachable');
    expect(taken.result.cells).toHaveLength(1);
    expect(taken.result.cells[0]!.periodCode).toBe(freshest.periodCode);
    expect(taken.answer.source).toBe('template');
  });
});

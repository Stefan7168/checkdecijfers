// ADR 058 (English answers, Task 6): translateAnswer + attachEnglish —
// the orchestrator that wires masking (Task 1), the glossary (Task 2), the
// deterministic checks (Task 4) and the English structural lines (Task 5)
// into one fail-closed-to-Dutch step. Hermetic: a stub LlmClient, no
// network, no DB — composeAnswer runs the `templateOnly` rung (same pattern
// as tests/answer/eurostat-answer-wording.test.ts) so the fixture's Dutch
// answer is real, deterministic output, never a real model call.
import { describe, expect, it } from 'vitest';
import { composeAnswer } from '../../../src/answer/compose/index.ts';
import type { LlmClient, LlmRequest } from '../../../src/answer/llm/client.ts';
import type { AnswerResponse, ComposedResponse } from '../../../src/answer/respond/types.ts';
import { makeCell, makeResult } from '../../helpers/synthetic-results.ts';
import { SOURCES } from '../../../src/sources/registry.ts';
import {
  attachEnglish,
  CAVEAT_TRANSLATIONS,
  prepareTranslation,
  translateAnswer,
} from '../../../src/answer/translate/translate.ts';
import type { TranslationItems } from '../../../src/answer/translate/check.ts';

/** templateOnly makes composeAnswer's LLM rung unreachable (ADR 024) — a real
 * reach for this client would be a bug, not a fallback (same pattern as
 * tests/answer/eurostat-answer-wording.test.ts's NeverCallAnswerClient). */
class NeverCallAnswerClient implements LlmClient {
  complete(): Promise<never> {
    throw new Error('translate.test.ts: composeAnswer reached an LLM client (templateOnly should have made this unreachable)');
  }
}

/** A single-cell, no-region, no-derivation unemployment-rate result (mirrors
 * synthetic-results.ts's `unemploymentSingle`, kept local so the fixture's
 * exact shape — no day-of-month digit inside the definition label, unlike
 * `populationSingle`'s "1 januari" — is visible in this file). Both the
 * measure title ('Werkloosheidspercentage') and the region a cell would
 * carry are seeded in src/registry/english-names.data.ts, so the glossary
 * check (C5) exercises a REAL translated name, not a stand-in. */
const UNEMPLOYMENT_RESULT = makeResult({
  shape: 'single',
  definitionLabel: 'werkloosheidspercentage, seizoengecorrigeerd',
  cells: [
    makeCell({
      table: '85224NED',
      measure: 'M001906',
      measureTitle: 'Werkloosheidspercentage',
      region: null,
      periodCode: '2025KW04',
      periodLabel: '2025 4e kwartaal',
      value: 4.0,
      unit: '%',
      decimals: 1,
    }),
  ],
});

async function makeAnswerResponse(
  overrides: { suggestions?: string[]; stalenessWarning?: string | null } = {},
): Promise<AnswerResponse> {
  const answer = await composeAnswer(UNEMPLOYMENT_RESULT, { client: new NeverCallAnswerClient(), templateOnly: true });
  return {
    schemaVersion: 1,
    kind: 'answer',
    question: 'Hoe hoog is de werkloosheid?',
    text: answer.text,
    answer,
    chart: null,
    chartAlternates: [],
    stalenessWarning: overrides.stalenessWarning ?? null,
    parse: {},
    result: UNEMPLOYMENT_RESULT,
    suggestions: overrides.suggestions ?? ['Hoe was dit een jaar eerder?'],
  } as unknown as AnswerResponse;
}

/** The brief's sketch stub: replays `outputs` in order, recording every
 * request it was called with. */
function stub(outputs: string[]): LlmClient & { requests: LlmRequest[] } {
  const requests: LlmRequest[] = [];
  return {
    requests,
    async complete(req: LlmRequest) {
      requests.push(req);
      const outputText = outputs.shift() ?? '{}';
      return { outputText, model: req.model, stopReason: 'end_turn', usage: { inputTokens: 1, outputTokens: 1 } };
    },
  };
}

/** A faithful English translation of the masked fixture body, built from a
 * dry run's `maskedDutch` (per the task brief: never hand-count placeholder
 * ids). Kept as a function of the ACTUAL maskedDutch so a change to the
 * fixture, the masker or the glossary can never silently desync this from
 * what prepareTranslation really produces. */
function faithfulEnglish(masked: TranslationItems): TranslationItems {
  return {
    body: masked.body.replace(
      /Werkloosheidspercentage, seizoengecorrigeerd was in (⟦P[a-z]+⟧) (⟦N[a-z]+⟧)%\./,
      'The seasonally adjusted unemployment rate was $2% in $1.',
    ),
    chips: masked.chips.map((chip) => chip.replace('Hoe was dit een jaar eerder?', 'What was this a year earlier?')),
    definition:
      masked.definition === null
        ? null
        : masked.definition.replace('werkloosheidspercentage, seizoengecorrigeerd', 'seasonally adjusted unemployment rate'),
    alternates: masked.alternates,
  };
}

describe('translateAnswer', () => {
  it('1. a faithful translation is verified: English-notation numbers, no Dutch digits, chips carry the Dutch submit text', async () => {
    const response = await makeAnswerResponse();
    const { maskedDutch } = prepareTranslation(response);
    const english = faithfulEnglish(maskedDutch);
    // Sanity: the fixture actually masked the '4,0' value and the quarter
    // label — if this ever stops matching, faithfulEnglish's regex silently
    // no-ops and the rest of the assertions below would be checking nothing.
    expect(english.body).not.toBe(maskedDutch.body);
    expect(english.body).toMatch(/⟦N[a-z]+⟧/);

    const client = stub([JSON.stringify(english)]);
    const rendering = await translateAnswer(response, client);

    expect(rendering.status).toBe('verified');
    expect(rendering.text).not.toBeNull();
    // The Dutch value '4,0' (decimal comma) must come back as English
    // notation '4.0' (decimal point) — mask.ts's toEnglishNumberToken.
    expect(rendering.text).toContain('4.0');
    expect(rendering.text).not.toMatch(/\d,\d/); // no surviving Dutch decimal-comma notation
    expect(rendering.chips).toHaveLength(1);
    expect(rendering.chips[0]!.submit).toBe(response.suggestions[0]);
    expect(rendering.chips[0]!.label).toBe('What was this a year earlier?');
    expect(rendering.body).toContain('unemployment rate');
    expect(rendering.attempts).toEqual([{ ok: true, problems: [], error: null }]);
  });

  it('2. no request the model sees ever carries a digit (items or system, beyond the rule numbers)', async () => {
    const response = await makeAnswerResponse();
    const { maskedDutch } = prepareTranslation(response);
    const english = faithfulEnglish(maskedDutch);
    const client = stub([JSON.stringify(english)]);
    await translateAnswer(response, client);

    expect(client.requests.length).toBeGreaterThan(0);
    for (const req of client.requests) {
      const { items } = JSON.parse(req.question) as { items: unknown };
      expect(JSON.stringify(items)).not.toMatch(/\p{Nd}/u);
      // The system prompt names its rules '1.' through '7.' — those digits
      // are allowed; nothing else may appear.
      const withoutRuleNumbers = req.system.replace(/^[1-7]\./gm, '');
      expect(withoutRuleNumbers).not.toMatch(/\p{Nd}/u);
    }
  });

  it('3. a first attempt with a spurious direction claim (C3) fails, a corrected retry passes; the retry names the problem', async () => {
    const response = await makeAnswerResponse();
    const { maskedDutch } = prepareTranslation(response);
    const faithful = faithfulEnglish(maskedDutch);
    const withSpuriousRise = { ...faithful, body: faithful.body.replace('was', 'rose to') };
    const client = stub([JSON.stringify(withSpuriousRise), JSON.stringify(faithful)]);

    const rendering = await translateAnswer(response, client);

    expect(rendering.status).toBe('verified');
    expect(rendering.attempts).toHaveLength(2);
    expect(rendering.attempts[0]!.ok).toBe(false);
    expect(rendering.attempts[0]!.problems.join()).toMatch(/C3/);
    expect(rendering.attempts[1]!.ok).toBe(true);
    expect(client.requests).toHaveLength(2);
    expect(client.requests[1]!.system).toMatch(/C3/);
  });

  it('4. both attempts fail their checks ⇒ fallback, no English text', async () => {
    const response = await makeAnswerResponse();
    const { maskedDutch } = prepareTranslation(response);
    const faithful = faithfulEnglish(maskedDutch);
    const broken = { ...faithful, body: faithful.body.replace('was', 'rose to') };
    const client = stub([JSON.stringify(broken), JSON.stringify(broken)]);

    const rendering = await translateAnswer(response, client);

    expect(rendering.status).toBe('fallback');
    expect(rendering.text).toBeNull();
    expect(rendering.body).toBeNull();
    expect(rendering.lines).toBeNull();
    expect(rendering.chips).toEqual([]);
    expect(rendering.attempts).toHaveLength(2);
    expect(rendering.attempts.every((a) => !a.ok)).toBe(true);
  });

  it('5. the client throwing ⇒ fallback with the error recorded on the first attempt', async () => {
    const response = await makeAnswerResponse();
    const client: LlmClient = {
      complete: async () => {
        throw new Error('boom: simulated provider outage');
      },
    };

    const rendering = await translateAnswer(response, client);

    expect(rendering.status).toBe('fallback');
    expect(rendering.text).toBeNull();
    expect(rendering.attempts[0]!.error).toContain('boom');
  });

  it('7. every registered source\'s provisionalDisplay value has a caveat-translation entry', () => {
    for (const source of Object.values(SOURCES)) {
      for (const dutch of Object.values(source.provisionalDisplay)) {
        expect(CAVEAT_TRANSLATIONS[dutch], `missing caveat translation for '${dutch}' (source '${source.key}')`).toBeDefined();
      }
    }
    // The generic fallback marker (template.ts's provisionalSuffix default
    // for a status absent from a source's own map) must always be covered
    // too, independent of what's actually listed in the registry today.
    expect(CAVEAT_TRANSLATIONS[' (voorlopig cijfer)']).toBe(' (provisional figure)');
  });
});

describe('attachEnglish', () => {
  it("6. returns the SAME object for lang 'nl', for no client, and for a refusal response", async () => {
    const response = await makeAnswerResponse();
    const client = stub(['{}']);

    const stillDutch = await attachEnglish(response, { lang: 'nl', client });
    expect(stillDutch).toBe(response);

    const noClient = await attachEnglish(response, { lang: 'en' });
    expect(noClient).toBe(response);

    const refusal = {
      schemaVersion: 1,
      kind: 'refusal',
      question: 'wat dan ook',
      text: 'Dat kan ik niet beantwoorden.',
      reason: 'scope',
      offer: null,
      guidance: null,
      freshness: null,
      parse: null,
      queryRefusal: null,
      internalNote: null,
      onboarding: null,
      suggestions: [],
    } as unknown as ComposedResponse;
    const refusalResult = await attachEnglish(refusal, { lang: 'en', client });
    expect(refusalResult).toBe(refusal);
  });

  it('attaches a verified rendering onto the response when lang is en and a client is supplied', async () => {
    const response = await makeAnswerResponse();
    const { maskedDutch } = prepareTranslation(response);
    const english = faithfulEnglish(maskedDutch);
    const client = stub([JSON.stringify(english)]);

    const result = await attachEnglish(response, { lang: 'en', client });

    expect(result).not.toBe(response);
    expect((result as AnswerResponse).english?.status).toBe('verified');
    // The Dutch envelope fields are untouched.
    expect((result as AnswerResponse).text).toBe(response.text);
    expect((result as AnswerResponse).answer).toBe(response.answer);
  });
});

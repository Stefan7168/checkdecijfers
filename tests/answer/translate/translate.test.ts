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
import { makeCell, makeResult, populationSingle } from '../../helpers/synthetic-results.ts';
import { SOURCES } from '../../../src/sources/registry.ts';
import { hasDigitOutsidePlaceholders } from '../../../src/answer/translate/mask.ts';
import { buildTranslateRequest, TRANSLATE_SYSTEM_PROMPT } from '../../../src/answer/translate/prompt.ts';
import {
  attachEnglish,
  CAVEAT_TRANSLATIONS,
  prepareTranslation,
  translateAnswer,
} from '../../../src/answer/translate/translate.ts';
import { TRANSLATE_TIMEOUT_MS } from '../../../src/answer/translate/types.ts';
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
      // Final-review fix wave (ruling 17a): the '%' is masked together with
      // its number (one placeholder, filled as '4.0%'), so it no longer
      // appears as text after the placeholder.
      /Werkloosheidspercentage, seizoengecorrigeerd was in (⟦P[a-z]+⟧) (⟦N[a-z]+⟧)\./,
      'The seasonally adjusted unemployment rate was $2 in $1.',
    ),
    chips: masked.chips.map((chip) => chip.replace('Hoe was dit een jaar eerder?', 'What was this a year earlier?')),
    definition:
      masked.definition === null
        ? null
        : masked.definition.replace('werkloosheidspercentage, seizoengecorrigeerd', 'seasonally adjusted unemployment rate'),
    alternates: masked.alternates,
  };
}

/** Ruling 9 (Task 6 fix round 1, Critical): `populationSingle` is the
 * FLAGSHIP digit-bearing-name case — its measure title 'Bevolking op 1
 * januari' → 'Population on 1 January' carries a digit in BOTH languages,
 * so before the fix it deadlocked C5 ("use the glossary name exactly",
 * which is 'Population on 1 January') against C2 ("never write a digit").
 * A dedicated helper (rather than reusing `makeAnswerResponse`) keeps that
 * fixture's exact shape visible in this file. */
async function makePopulationAnswerResponse(
  overrides: { suggestions?: string[]; stalenessWarning?: string | null } = {},
): Promise<AnswerResponse> {
  const answer = await composeAnswer(populationSingle, { client: new NeverCallAnswerClient(), templateOnly: true });
  return {
    schemaVersion: 1,
    kind: 'answer',
    question: 'Hoeveel inwoners heeft Nederland?',
    text: answer.text,
    answer,
    chart: null,
    chartAlternates: [],
    stalenessWarning: overrides.stalenessWarning ?? null,
    parse: {},
    result: populationSingle,
    suggestions: overrides.suggestions ?? ['Hoe was dit een jaar eerder?'],
  } as unknown as AnswerResponse;
}

const POPULATION_BODY_RE = /^(⟦G[a-z]+⟧) in Nederland was in (⟦P[a-z]+⟧) (⟦N[a-z]+⟧)\.$/;
const POPULATION_DEFINITION_RE = /^bevolking op (⟦N[a-z]+⟧) januari$/;

/** A faithful English translation of the masked `populationSingle` body,
 * derived from the ACTUAL maskedDutch (never hand-counted placeholder ids —
 * same discipline as `faithfulEnglish` above). The name-masking fix (ruling
 * 9) means 'Bevolking op 1 januari' is now ONE 'name' placeholder (⟦G..⟧) in
 * the body; the definition text uses the lowercase, differently-cased
 * 'bevolking op 1 januari', which name-masking's exact-case match
 * deliberately does NOT catch (mask.test.ts pins this), so its '1' is
 * masked as an ordinary number placeholder instead. */
function faithfulPopulationEnglish(masked: TranslationItems): TranslationItems {
  const bodyMatch = POPULATION_BODY_RE.exec(masked.body);
  if (!bodyMatch) throw new Error(`unexpected masked population body shape: ${JSON.stringify(masked.body)}`);
  const [, name, period, number] = bodyMatch;
  const definitionMatch = masked.definition === null ? null : POPULATION_DEFINITION_RE.exec(masked.definition);
  if (masked.definition !== null && !definitionMatch) {
    throw new Error(`unexpected masked population definition shape: ${JSON.stringify(masked.definition)}`);
  }
  return {
    body: `${name} in the Netherlands was ${number} in ${period}.`,
    chips: masked.chips.map((chip) => chip.replace('Hoe was dit een jaar eerder?', 'What was this a year earlier?')),
    definition: definitionMatch ? `population on ${definitionMatch[1]} January` : masked.definition,
    alternates: masked.alternates,
  };
}

/** Every digit in `text` outside a placeholder, checking BOTH the whole
 * `question` and only what a retry APPENDS to the fixed system prompt
 * (ruling 9c/10) — the rule numbers '1.'–'7.' live in the fixed base prompt
 * and are audited there once, never re-allowed here. */
function assertRequestCarriesNoDigit(req: LlmRequest): void {
  expect(hasDigitOutsidePlaceholders(req.question)).toBe(false);
  const appendix = req.system.startsWith(TRANSLATE_SYSTEM_PROMPT) ? req.system.slice(TRANSLATE_SYSTEM_PROMPT.length) : req.system;
  expect(hasDigitOutsidePlaceholders(appendix)).toBe(false);
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

  it('2. no request the model sees ever carries a digit — using the digit-bearing population fixture, across a retry (rulings 9c/9d/10)', async () => {
    // populationSingle's glossary carries a digit in BOTH languages
    // ('Bevolking op 1 januari' → 'Population on 1 January'): the fixture
    // most likely to leak a digit through the glossary if ruling 9's fix
    // regressed. A spurious direction claim forces a real retry, so the
    // SECOND request (with its appended retry suffix) is checked too —
    // ruling 10's fixed, digit-free problem sentences must hold there.
    const response = await makePopulationAnswerResponse();
    const { maskedDutch } = prepareTranslation(response);
    const faithful = faithfulPopulationEnglish(maskedDutch);
    const withSpuriousRise = { ...faithful, body: faithful.body.replace('was', 'rose to') };
    const client = stub([JSON.stringify(withSpuriousRise), JSON.stringify(faithful)]);

    const rendering = await translateAnswer(response, client);

    // Sanity: the retry actually happened and the deadlock is really gone.
    expect(rendering.status).toBe('verified');
    expect(client.requests).toHaveLength(2);
    for (const req of client.requests) assertRequestCarriesNoDigit(req);
    // The retry's appended text must never quote the raw problem string
    // (which could itself carry a digit via a glossary name) — only the
    // fixed, digit-free sentence for its check kind (ruling 10).
    expect(client.requests[1]!.system).toContain('A direction word was changed.');
  });

  it("the population fixture (digit-bearing glossary name) verifies with a single faithful stub — no C5/C2 deadlock", async () => {
    const response = await makePopulationAnswerResponse();
    const { maskedDutch } = prepareTranslation(response);
    const faithful = faithfulPopulationEnglish(maskedDutch);
    const client = stub([JSON.stringify(faithful)]);

    const rendering = await translateAnswer(response, client);

    expect(rendering.status).toBe('verified');
    expect(rendering.attempts).toEqual([{ ok: true, problems: [], error: null }]);
    expect(rendering.text).toContain('Population on 1 January');
    expect(rendering.text).toContain('18,044,027');
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
    // The raw 'C3: ...' problem is audit-only (attempts[].problems); the
    // retry sent to the MODEL uses ruling 10's fixed, digit-free sentence.
    expect(rendering.attempts[0]!.problems.join()).toMatch(/C3/);
    expect(rendering.attempts[1]!.ok).toBe(true);
    expect(client.requests).toHaveLength(2);
    expect(client.requests[1]!.system).not.toMatch(/C3/);
    expect(client.requests[1]!.system).toContain('A direction word was changed.');
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

  it('5. the client throwing on every attempt ⇒ fallback, the error recorded on each attempt (ruling 11: an error retries, same as a failed check)', async () => {
    const response = await makeAnswerResponse();
    const client: LlmClient = {
      complete: async () => {
        throw new Error('boom: simulated provider outage');
      },
    };

    const rendering = await translateAnswer(response, client);

    expect(rendering.status).toBe('fallback');
    expect(rendering.text).toBeNull();
    expect(rendering.attempts).toHaveLength(2);
    expect(rendering.attempts[0]!.error).toContain('boom');
    expect(rendering.attempts[1]!.error).toContain('boom');
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

describe('translateAnswer — fallback paths (ruling 11, Task 6 fix round 1)', () => {
  it('an unknown registry caveat marker is caught before any model spend', async () => {
    const response = await makeAnswerResponse();
    // CAVEAT_TRANSLATIONS is typed Readonly but is a plain object at
    // runtime; temporarily removing an entry exercises caveatsForResult's
    // defensive throw without needing a second, fabricated source registry.
    // Restored in `finally` so no other test in this file (or any other,
    // hermetic per-file module registry) ever sees the mutation.
    const table = CAVEAT_TRANSLATIONS as Record<string, string>;
    const original = table[' (voorlopig cijfer)']!;
    delete table[' (voorlopig cijfer)'];
    try {
      const client = stub(['{}']);
      const rendering = await translateAnswer(response, client);
      expect(rendering.status).toBe('fallback');
      expect(rendering.attempts).toEqual([{ ok: false, problems: ['unknown caveat marker'], error: null }]);
      expect(client.requests).toHaveLength(0);
    } finally {
      table[' (voorlopig cijfer)'] = original;
    }
  });

  it('a digit that survives masking (a non-ASCII digit the masker cannot recognize as numeric) blocks the model call entirely', async () => {
    // findNumericTokens (mask.ts) matches ASCII digits only (`\d`). A
    // FULLWIDTH digit is normalized to ASCII by normalizeForScan's NFKC pass
    // before scanning (so it IS masked — not a useful test case here); a
    // DEVANAGARI digit is a genuine Unicode Nd character that NFKC does NOT
    // decompose to ASCII, so it survives normalizeForScan untouched and is
    // invisible to findNumericTokens, yet IS caught by
    // hasDigitOutsidePlaceholders (unicode \p{Nd}) — exactly the gap the
    // pre-call gate exists to catch, independent of the ruling-9 fix.
    const response = await makeAnswerResponse({ suggestions: ['Hoe was dit in jaar १२३?'] });
    const client = stub(['{}']);

    const rendering = await translateAnswer(response, client);

    expect(rendering.status).toBe('fallback');
    expect(rendering.attempts).toEqual([{ ok: false, problems: ['C2: digit survived masking'], error: null }]);
    expect(client.requests).toHaveLength(0);
  });

  it('an unrecognized staleness-warning shape blocks the model call entirely (no spend)', async () => {
    const response = await makeAnswerResponse({ stalenessWarning: 'Let op: iets ongebruikelijks staat hier.' });
    const client = stub(['{}']);

    const rendering = await translateAnswer(response, client);

    expect(rendering.status).toBe('fallback');
    expect(rendering.attempts).toEqual([{ ok: false, problems: ['staleness warning shape unknown'], error: null }]);
    expect(client.requests).toHaveLength(0);
  });

  it('unparseable output, then a faithful retry ⇒ verified', async () => {
    const response = await makeAnswerResponse();
    const { maskedDutch } = prepareTranslation(response);
    const faithful = faithfulEnglish(maskedDutch);
    const client = stub(['not valid json{', JSON.stringify(faithful)]);

    const rendering = await translateAnswer(response, client);

    expect(rendering.status).toBe('verified');
    expect(rendering.attempts).toHaveLength(2);
    expect(rendering.attempts[0]!).toEqual({ ok: false, problems: ['unparseable output'], error: null });
    expect(rendering.attempts[1]!.ok).toBe(true);
    expect(client.requests[1]!.system).toContain('The output was not valid JSON of the required shape.');
  });

  it('malformed (but validly-parsed) output twice ⇒ fallback, rawTranslation stays null (controller ruling 14)', async () => {
    const response = await makeAnswerResponse();
    const client = stub(['{}', '{}']);

    const rendering = await translateAnswer(response, client);

    expect(rendering.status).toBe('fallback');
    expect(rendering.attempts).toHaveLength(2);
    expect(rendering.attempts.every((a) => a.problems.join() === 'malformed output')).toBe(true);
    // Ruling 14: a malformed (shape-invalid) parse is never assigned to
    // rawTranslation — its type stays TranslationItems | null, so any
    // non-null value is guaranteed shape-valid.
    expect(rendering.rawTranslation).toBeNull();
  });

  it('a client error, then a faithful retry ⇒ verified (ruling 11: an error retries, same as a failed check)', async () => {
    const response = await makeAnswerResponse();
    const { maskedDutch } = prepareTranslation(response);
    const faithful = faithfulEnglish(maskedDutch);
    const requests: LlmRequest[] = [];
    let calls = 0;
    const client: LlmClient = {
      async complete(req) {
        requests.push(req);
        calls += 1;
        if (calls === 1) throw new Error('transient outage');
        return { outputText: JSON.stringify(faithful), model: req.model, stopReason: 'end_turn', usage: { inputTokens: 1, outputTokens: 1 } };
      },
    };

    const rendering = await translateAnswer(response, client);

    expect(rendering.status).toBe('verified');
    expect(rendering.attempts).toHaveLength(2);
    expect(rendering.attempts[0]!.error).toContain('transient outage');
    expect(rendering.attempts[1]!.ok).toBe(true);
    expect(requests).toHaveLength(2);
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

describe('prepareTranslation — units (final-review fix wave, ruling 17a)', () => {
  it("a registered unit with an English name is masked WITH its number and filled in English ('euro' → 'euros')", async () => {
    const result = makeResult({
      shape: 'single',
      definitionLabel: 'gemiddelde verkoopprijs',
      cells: [
        makeCell({
          table: '85773NED',
          measure: 'M000001',
          measureTitle: 'Gemiddelde verkoopprijs',
          region: null,
          periodCode: '2024JJ00',
          periodLabel: '2024',
          value: 450985,
          unit: 'euro',
          decimals: 0,
        }),
      ],
    });
    const answer = await composeAnswer(result, { client: new NeverCallAnswerClient(), templateOnly: true });
    const response = {
      schemaVersion: 1,
      kind: 'answer',
      question: 'Wat was de gemiddelde verkoopprijs?',
      text: answer.text,
      answer,
      chart: null,
      chartAlternates: [],
      stalenessWarning: null,
      parse: {},
      result,
      suggestions: [],
    } as unknown as AnswerResponse;
    const prep = prepareTranslation(response);
    const numbers = prep.maskTable.filter((e) => e.kind === 'number');
    expect(answer.body).toContain('450.985 euro');
    expect(numbers.find((e) => e.dutch === '450.985 euro')?.english).toBe('450,985 euros');
    expect(prep.maskedDutch.body).not.toMatch(/euro/);
  });
});

describe('retry sentences for the final-review checks (ruling 10 discipline: fixed, digit-free)', () => {
  it('C9 and C10 map to their own fixed sentences, never the raw problem text', () => {
    const req = buildTranslateRequest({ body: 'x', chips: [], definition: null, alternates: [] }, [], {
      retryProblems: ["C9: body says 'ten' but the Dutch has no counterpart for it", 'C10: negation of a direction claim differs (Dutch [not down], English [down])'],
    });
    expect(req.system).toContain('A number word, fraction, multiple, scale word or unit was written that the Dutch does not contain.');
    expect(req.system).toContain('A negation was added or dropped.');
    expect(req.system).not.toContain('C9:');
    expect(req.system).not.toContain("'ten'");
  });
});

describe('the translate step deadline (final-review fix wave, ruling 19)', () => {
  it('the default cap is 20 000 ms', () => {
    expect(TRANSLATE_TIMEOUT_MS).toBe(20_000);
  });

  it("a client that never resolves ⇒ fallback with error 'timeout', within the cap", async () => {
    const response = await makeAnswerResponse();
    let calls = 0;
    const client: LlmClient = {
      complete: () => {
        calls += 1;
        return new Promise<never>(() => {});
      },
    };
    const started = Date.now();
    const rendering = await translateAnswer(response, client, { timeoutMs: 30 });
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(rendering.status).toBe('fallback');
    expect(rendering.text).toBeNull();
    expect(rendering.attempts.at(-1)).toEqual({ ok: false, problems: [], error: 'timeout' });
    expect(rendering.maskedDutch).toEqual(prepareTranslation(response).maskedDutch);
    expect(calls).toBe(1);
  });

  it('a LATE faithful response mutates nothing and triggers no further call', async () => {
    const response = await makeAnswerResponse();
    const faithful = faithfulEnglish(prepareTranslation(response).maskedDutch);
    let calls = 0;
    const client: LlmClient = {
      complete: (req) => {
        calls += 1;
        return new Promise((resolve) =>
          setTimeout(
            () => resolve({ outputText: JSON.stringify(faithful), model: req.model, stopReason: 'end_turn', usage: { inputTokens: 1, outputTokens: 1 } }),
            60,
          ),
        );
      },
    };
    const rendering = await translateAnswer(response, client, { timeoutMs: 10 });
    const snapshot = JSON.stringify(rendering);
    await new Promise((r) => setTimeout(r, 150));
    expect(JSON.stringify(rendering)).toBe(snapshot);
    expect(rendering.status).toBe('fallback');
    expect(rendering.attempts).toEqual([{ ok: false, problems: [], error: 'timeout' }]);
    expect(calls).toBe(1);
  });

  it('a slow first attempt that fails its checks does not start a second call after the deadline', async () => {
    const response = await makeAnswerResponse();
    let calls = 0;
    const client: LlmClient = {
      complete: (req) => {
        calls += 1;
        return new Promise((resolve) =>
          setTimeout(() => resolve({ outputText: '{}', model: req.model, stopReason: 'end_turn', usage: { inputTokens: 1, outputTokens: 1 } }), 40),
        );
      },
    };
    const rendering = await translateAnswer(response, client, { timeoutMs: 10 });
    await new Promise((r) => setTimeout(r, 150));
    expect(rendering.status).toBe('fallback');
    expect(calls).toBe(1);
  });

  it('a fast faithful response still verifies under the cap', async () => {
    const response = await makeAnswerResponse();
    const client = stub([JSON.stringify(faithfulEnglish(prepareTranslation(response).maskedDutch))]);
    const rendering = await translateAnswer(response, client, { timeoutMs: 1_000 });
    expect(rendering.status).toBe('verified');
  });
});

// WP9 done-criterion, hermetic (ADR 012 harness, extended to the full
// respond layer): B15–B20, the one-round clarification-reply merge, compound
// + smalltalk, and clock-injected staleness — all driven end-to-end through
// respondToQuestion / respondToClarificationReply, replayed from committed
// LLM fixtures (intent, answer, clarify). No API key, no network: exactly
// what CI runs.
//
// This suite is the WP9 counterpart to compose-pipeline.test.ts (WP7) and
// intent-parse.test.ts (WP6): it proves the ENVELOPE (ComposedResponse), not
// just the parser or the composer in isolation — a chat UI only ever sees
// what this suite exercises.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ReplayLlmClient } from '../../src/answer/llm/client.ts';
import type { LlmClient } from '../../src/answer/llm/client.ts';
import {
  respondToClarificationReply,
  respondToQuestion,
} from '../../src/answer/respond/index.ts';
import type { ComposedResponse, PendingClarification } from '../../src/answer/respond/index.ts';
import {
  findNumericTokens,
  normalizeForScan,
  numbersInText,
  periodCodeNumbers,
} from '../../src/answer/compose/format.ts';
import { CANONICAL_MEASURES } from '../../src/registry/defaults.ts';
import { freshestForCanonical, runQuery } from '../../src/query/index.ts';
import type { Db } from '../../src/db/types.ts';
import { createIngestedDb } from '../helpers/ingested-db.ts';
import { REFUSAL_TASK_QUESTIONS } from '../helpers/benchmark-intents.ts';
import { checkComposedAnswer, loadAnswerKey } from '../helpers/answer-expectations.ts';
import { loadLabelledSet } from '../helpers/intent-expectations.ts';

const INTENT_FIXTURES = fileURLToPath(new URL('../fixtures/llm/intent', import.meta.url));
const ANSWER_FIXTURES = fileURLToPath(new URL('../fixtures/llm/answer', import.meta.url));
// The clarify-mode request (CLARIFY_MODE_SECTION appended to the base
// prompt) hashes differently from a plain intent request, so its replay
// fixtures live in their own directory (scripts/clarify-eval.ts uses the
// same split: ReplayIntentClient for the original question, a separate
// client over tests/fixtures/llm/clarify for the reply).
const CLARIFY_FIXTURES = fileURLToPath(new URL('../fixtures/llm/clarify', import.meta.url));

const labelledSet = loadLabelledSet();
const REFERENCE_DATE = labelledSet.referenceDate;
const answerKey = loadAnswerKey();

let db: Db;
let close: () => Promise<void>;

function respondOptions(referenceDate: string = REFERENCE_DATE) {
  return {
    intentClient: new ReplayLlmClient(INTENT_FIXTURES),
    answerClient: new ReplayLlmClient(ANSWER_FIXTURES),
    referenceDate,
  };
}

/** respondToClarificationReply's intentClient must replay the CLARIFY-MODE
 * request (a different prompt/hash than a fresh question) — the fixed
 * RespondOptions contract has one `intentClient` field per call site, so the
 * two entry points are exercised with different options objects, exactly
 * like scripts/clarify-eval.ts's two separate clients. */
function clarifyReplyOptions(referenceDate: string = REFERENCE_DATE) {
  return {
    intentClient: new ReplayLlmClient(CLARIFY_FIXTURES),
    answerClient: new ReplayLlmClient(ANSWER_FIXTURES),
    referenceDate,
  };
}

beforeAll(async () => {
  ({ db, close } = await createIngestedDb());
}, 300_000);

afterAll(async () => {
  await close();
});

// ---------------------------------------------------------------------------
// Whitelist builder (principle c belt-check) — numbers ONLY from structured
// fields, never the rendered text. Reused across every no-numbers sweep in
// this file.
// ---------------------------------------------------------------------------

function fullLabelWhitelist(): Set<number> {
  const numbers = new Set<number>();
  for (const m of CANONICAL_MEASURES) {
    for (const n of numbersInText(m.definitionLabel)) numbers.add(n);
    for (const term of m.everydayTerms) {
      for (const n of numbersInText(term)) numbers.add(n);
    }
  }
  return numbers;
}

function addPeriodCodes(whitelist: Set<number>, codes: (string | null | undefined)[]): void {
  for (const code of codes) {
    if (!code) continue;
    for (const n of periodCodeNumbers(code)) whitelist.add(n);
  }
}

/** Structured-fields-only whitelist for a single ComposedResponse (non-answer
 * envelopes only — answers are checked via checkComposedAnswer instead, which
 * has its own frozen-key expectation). Pulls numbers from: pending option
 * strings, pending axes (no numbers there), freshness period codes, every
 * canonical measure's freshest-available period (the structured source the
 * forecast/causal offers and the still-ambiguous example cite), and registry
 * labels — never from `text` itself. */
async function whitelistForResponse(response: ComposedResponse): Promise<Set<number>> {
  const whitelist = fullLabelWhitelist();
  if (response.kind === 'clarification') {
    for (const opt of response.options) {
      for (const n of numbersInText(opt)) whitelist.add(n);
    }
  }
  if (response.kind === 'refusal') {
    if (response.freshness) {
      addPeriodCodes(whitelist, [
        response.freshness.freshestAvailable?.periodCode,
        response.freshness.freshestDefinitief?.periodCode,
      ]);
    }
    // The forecast/causal offers and the still-ambiguous/out-of-scope example
    // question cite a canonical measure's freshest-available period —
    // freshestForCanonical is their structured source, so whitelist every
    // measure's freshest period from that same source rather than re-deriving
    // refusals.ts's exact pick.
    for (const m of CANONICAL_MEASURES) {
      const freshest = await freshestForCanonical(db, m.key);
      if (freshest) addPeriodCodes(whitelist, [freshest.periodCode]);
    }
  }
  return whitelist;
}

function assertNoUnbackedNumbers(response: ComposedResponse, whitelist: Set<number>): void {
  const normalized = normalizeForScan(response.text);
  for (const token of findNumericTokens(normalized)) {
    expect(
      whitelist.has(token.value),
      `${response.kind}/${'reason' in response ? response.reason : ''}: unbacked number ` +
        `'${token.token}' (${token.value}) in text: ${JSON.stringify(response.text)}`,
    ).toBe(true);
  }
}

describe('B15-B20 end-to-end (respondToQuestion, replayed fixtures)', () => {
  const responses = new Map<string, ComposedResponse>();

  beforeAll(async () => {
    for (const taskId of ['B15', 'B16', 'B17', 'B18', 'B19', 'B20']) {
      const question = REFUSAL_TASK_QUESTIONS[taskId]!;
      responses.set(taskId, await respondToQuestion(db, question, respondOptions()));
    }
  }, 300_000);

  it('B15: clarification, exactly one "?", pending matches the envelope, options non-empty, no multi-digit token', () => {
    const response = responses.get('B15')!;
    expect(response.kind).toBe('clarification');
    if (response.kind !== 'clarification') throw new Error('unreachable');
    const questionMarks = (response.text.match(/\?/g) ?? []).length;
    expect(questionMarks).toBe(1);
    expect(response.pending.questionNl).toBe(response.text);
    expect(response.pending.axes).toEqual(response.axes);
    expect(response.pending.options).toEqual(response.options);
    expect(response.options.length).toBeGreaterThan(0);
    // Belt-check reused from intent-parse.test.ts: no multi-digit token in
    // the clarifying question itself (a single digit is fine — definition
    // labels like "bevolking op 1 januari" legitimately contain one).
    expect(response.text).not.toMatch(/\d\d/);
  });

  it('B16: clarification, exactly one "?", pending matches the envelope, options non-empty, no multi-digit token', () => {
    const response = responses.get('B16')!;
    expect(response.kind).toBe('clarification');
    if (response.kind !== 'clarification') throw new Error('unreachable');
    const questionMarks = (response.text.match(/\?/g) ?? []).length;
    expect(questionMarks).toBe(1);
    expect(response.pending.questionNl).toBe(response.text);
    expect(response.pending.axes).toEqual(response.axes);
    expect(response.pending.options).toEqual(response.options);
    expect(response.options.length).toBeGreaterThan(0);
    expect(response.text).not.toMatch(/\d\d/);
  });

  it('B17: refusal reason "scope", names at least one loaded topic, offer or guidance non-null', () => {
    const response = responses.get('B17')!;
    expect(response.kind).toBe('refusal');
    if (response.kind !== 'refusal') throw new Error('unreachable');
    expect(response.reason).toBe('scope');
    const namesATopic = CANONICAL_MEASURES.some((m) => response.text.includes(m.everydayTerms[0]!));
    expect(namesATopic).toBe(true);
    expect(response.offer !== null || response.guidance !== null).toBe(true);
  });

  it('B18: refusal reason "forecast", refuses prediction, offers realized inflation, no table value in text', async () => {
    const response = responses.get('B18')!;
    expect(response.kind).toBe('refusal');
    if (response.kind !== 'refusal') throw new Error('unreachable');
    expect(response.reason).toBe('forecast');
    expect(response.text).toContain('CBS publiceert gerealiseerde cijfers');
    const cpiLabel = CANONICAL_MEASURES.find((m) => m.key === 'cpi_yearly_inflation')!.definitionLabel;
    expect(response.text).toContain(cpiLabel);
    // No number in the text may come from any cell value in ANY loaded
    // table — the sharpest test is that every numeric token is whitelisted
    // by structured registry/period sources alone.
    assertNoUnbackedNumbers(response, await whitelistForResponse(response));
  });

  it('B19: refusal reason "causal"', () => {
    const response = responses.get('B19')!;
    expect(response.kind).toBe('refusal');
    if (response.kind !== 'refusal') throw new Error('unreachable');
    expect(response.reason).toBe('causal');
  });

  it('B20: refusal reason "freshness", freshness payload equals the answer-key entry, Dutch period + voorlopig marking, no key value anywhere in the envelope', () => {
    const response = responses.get('B20')!;
    expect(response.kind).toBe('refusal');
    if (response.kind !== 'refusal') throw new Error('unreachable');
    expect(response.reason).toBe('freshness');

    const key = answerKey.tasks.B20 as unknown as {
      freshestAvailable: { period: string; status: string; value: number };
      freshestDefinitief: { period: string; value: number };
    };
    expect(response.freshness).toEqual({
      freshestAvailable: { periodCode: key.freshestAvailable.period, status: key.freshestAvailable.status },
      freshestDefinitief: { periodCode: key.freshestDefinitief.period },
    });
    // R11 + Dutch period rendering: 2026MM06 -> "juni 2026", Voorlopig ->
    // "voorlopig cijfer" marking.
    expect(response.text).toContain('juni 2026');
    expect(response.text).toMatch(/voorlopig/i);
    // Principle c belt-check, mirroring intent-parse.test.ts's B20 test: the
    // full envelope (not just the refusal text) must never carry the key's
    // values.
    expect(JSON.stringify(response)).not.toContain(String(key.freshestAvailable.value));
    expect(JSON.stringify(response)).not.toContain(String(key.freshestDefinitief.value));
  });
});

// ---------------------------------------------------------------------------
// The clarification round (benchmark/clarification-cases.json)
// ---------------------------------------------------------------------------

interface ClarifyCaseFile {
  version: number;
  referenceDate: string;
  note: string;
  cases: {
    id: string;
    originalQuestion: string;
    reply: string;
    expect: { outcome: 'intent' | 'clarification' | 'refusal'; intent?: unknown; refusalKind?: string; axesInclude?: string[] };
  }[];
}

function loadClarificationCases(): ClarifyCaseFile {
  return JSON.parse(
    readFileSync(new URL('../../benchmark/clarification-cases.json', import.meta.url), 'utf8'),
  ) as ClarifyCaseFile;
}

// Benchmark intents these merged clarify-reply cases are expected to land on
// (per the case file's note: c-b15-full -> B5, c-b16-national -> B7,
// c-utrecht-gemeente -> B2), so the frozen-key value must appear verbatim.
const BENCHMARK_TASK_BY_CASE_ID: Record<string, string> = {
  'c-b15-full': 'B5',
  'c-b16-national': 'B7',
  'c-utrecht-gemeente': 'B2',
};

describe('the clarification round: respondToQuestion -> respondToClarificationReply', () => {
  const clarifySet = loadClarificationCases();
  // The clarify case file's own reference date (its "note" documents this is
  // the SAME clock the intent fixtures for these original questions were
  // recorded against). The FIRST turn replays from the intent fixtures; the
  // SECOND (the reply) replays from the clarify fixtures — different prompt,
  // different hash, different directory (see clarifyReplyOptions above).

  const results = new Map<string, { pending: PendingClarification; reply: ComposedResponse }>();

  beforeAll(async () => {
    for (const c of clarifySet.cases) {
      const first = await respondToQuestion(db, c.originalQuestion, respondOptions(clarifySet.referenceDate));
      if (first.kind !== 'clarification') {
        throw new Error(
          `case ${c.id}: original question "${c.originalQuestion}" did not produce a clarification ` +
            `(got "${first.kind}") — cannot exercise the reply round.`,
        );
      }
      const reply = await respondToClarificationReply(
        db,
        first.pending,
        c.reply,
        clarifyReplyOptions(clarifySet.referenceDate),
      );
      results.set(c.id, { pending: first.pending, reply });
    }
  }, 300_000);

  for (const c of clarifySet.cases) {
    it(`${c.id}: reply "${c.reply}" -> expected outcome "${c.expect.outcome}"`, () => {
      const { reply } = results.get(c.id)!;

      if (c.expect.outcome === 'intent') {
        expect(reply.kind).toBe('answer');
        if (reply.kind !== 'answer') throw new Error('unreachable');
        const benchmarkTaskId = BENCHMARK_TASK_BY_CASE_ID[c.id];
        if (benchmarkTaskId) {
          const key = answerKey.tasks[benchmarkTaskId];
          if (!key) throw new Error(`STOP: no answer-key entry for ${benchmarkTaskId} (case ${c.id})`);
          const problems = checkComposedAnswer(benchmarkTaskId, key, reply.answer);
          expect(problems, `${reply.answer.text}\n\n${problems.join('\n')}`).toEqual([]);
        }
      } else if (c.expect.outcome === 'clarification') {
        // The one-round rule: a reply may NEVER produce a second
        // clarification envelope.
        expect(reply.kind).toBe('refusal');
        if (reply.kind !== 'refusal') throw new Error('unreachable');
        expect(reply.reason).toBe('still_ambiguous');
        expect(reply.guidance).not.toBeNull();
        expect((reply as unknown as { pending?: unknown }).pending).toBeUndefined();
      } else {
        expect(reply.kind).toBe('refusal');
        if (reply.kind !== 'refusal') throw new Error('unreachable');
        if (c.expect.refusalKind) {
          const expectedReason = c.expect.refusalKind === 'smalltalk' ? 'smalltalk' : c.expect.refusalKind;
          expect(reply.reason).toBe(expectedReason);
        }
      }
    });
  }

  it('across ALL cases: no reply ever produces a second clarification envelope', () => {
    for (const c of clarifySet.cases) {
      const { reply } = results.get(c.id)!;
      if (c.expect.outcome === 'clarification') {
        expect(reply.kind, `case ${c.id}`).not.toBe('clarification');
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Compound + smalltalk (from the intent labelled set)
// ---------------------------------------------------------------------------

describe('compound + smalltalk questions (labelled set)', () => {
  const compoundCase = labelledSet.cases.find((c) => c.id === 'r-compound');
  const smalltalkCase = labelledSet.cases.find((c) => c.id === 's-hallo');
  if (!compoundCase) throw new Error('STOP: no r-compound case in benchmark/intent-labelled-set.json');
  if (!smalltalkCase) throw new Error('STOP: no s-hallo case in benchmark/intent-labelled-set.json');

  let compoundResponse: ComposedResponse;
  let smalltalkResponse: ComposedResponse;

  beforeAll(async () => {
    compoundResponse = await respondToQuestion(db, compoundCase.question, respondOptions());
    smalltalkResponse = await respondToQuestion(db, smalltalkCase.question, respondOptions());
  }, 300_000);

  it('r-compound: refusal reason "compound", not a clarification, no numbers', async () => {
    expect(compoundResponse.kind).toBe('refusal');
    if (compoundResponse.kind !== 'refusal') throw new Error('unreachable');
    expect(compoundResponse.reason).toBe('compound');
    expect((compoundResponse as unknown as { pending?: unknown }).pending).toBeUndefined();
    assertNoUnbackedNumbers(compoundResponse, await whitelistForResponse(compoundResponse));
  });

  it('s-hallo: refusal reason "smalltalk"', () => {
    expect(smalltalkResponse.kind).toBe('refusal');
    if (smalltalkResponse.kind !== 'refusal') throw new Error('unreachable');
    expect(smalltalkResponse.reason).toBe('smalltalk');
  });
});

// ---------------------------------------------------------------------------
// Staleness, clock-injected at the pipeline level
// ---------------------------------------------------------------------------

describe('staleness, clock-injected at the pipeline level', () => {
  const B3_QUESTION = 'Wat was de inflatie (CPI, jaargemiddelde) in 2024?';
  // v-werkloosheid-nu: the recency-implying labelled case (impliedRecency:
  // true via "nu"), whose canonical measure (unemployment, table 85224NED)
  // is quarterly-cadenced.
  const RECENCY_CASE_ID = 'v-werkloosheid-nu';

  it("B3 at the normal reference date carries NO staleness warning (fixtures ingested 'today')", async () => {
    const response = await respondToQuestion(db, B3_QUESTION, respondOptions(REFERENCE_DATE));
    expect(response.kind).toBe('answer');
    if (response.kind !== 'answer') throw new Error('unreachable');
    expect(response.stalenessWarning).toBeNull();
  });

  it('B3 with a far-future reference date answers WITH a stalenessWarning naming the sync date; frozen-key check still passes (attribution intact, warning appended)', async () => {
    const farFuture = '2027-06-01';
    const response = await respondToQuestion(db, B3_QUESTION, respondOptions(farFuture));
    expect(response.kind).toBe('answer');
    if (response.kind !== 'answer') throw new Error('unreachable');
    expect(response.stalenessWarning).not.toBeNull();
    // Names the sync date (YYYY-MM-DD form).
    expect(response.stalenessWarning).toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(response.text).toContain(response.stalenessWarning!);
    // The warning is appended AFTER the full composed answer, never spliced
    // into it (R4 attribution intact).
    expect(response.text.startsWith(response.answer.text)).toBe(true);

    const key = answerKey.tasks.B3!;
    const problems = checkComposedAnswer('B3', key, response.answer);
    expect(problems, `${response.answer.text}\n\n${problems.join('\n')}`).toEqual([]);
  });

  it(`${RECENCY_CASE_ID}: at a far-future reference date this recency-implying question produces a "staleness" refusal`, async () => {
    const recencyCase = labelledSet.cases.find((c) => c.id === RECENCY_CASE_ID);
    if (!recencyCase) throw new Error(`STOP: no ${RECENCY_CASE_ID} case in benchmark/intent-labelled-set.json`);

    const farFuture = '2027-06-01';
    const response = await respondToQuestion(db, recencyCase.question, respondOptions(farFuture));
    expect(response.kind).toBe('refusal');
    if (response.kind !== 'refusal') throw new Error('unreachable');
    expect(response.reason).toBe('staleness');

    // Belt-check THIS refusal too (adversarial-review finding, 2026-07-03:
    // it was the one non-answer text never scanned): its digits come from
    // the sync date and the freshest cell's period label — both structured
    // sources, recovered here via the query layer, never from the text.
    if (response.parse?.kind !== 'intent') throw new Error('unreachable: staleness refusal keeps its intent parse');
    const q = await runQuery(db, response.parse.intent);
    if (!q.ok) throw new Error('unreachable: the staleness refusal came from a successful query');
    const whitelist = await whitelistForResponse(response);
    for (const n of numbersInText(q.attribution.syncedAt.slice(0, 10))) whitelist.add(n);
    for (const cell of q.cells) {
      addPeriodCodes(whitelist, [cell.periodCode]);
      for (const n of numbersInText(cell.periodLabel)) whitelist.add(n);
    }
    assertNoUnbackedNumbers(response, whitelist);

    // R11 on the offered period: when the freshest cell is not definitive the
    // offer must carry the status marker (the deterministic always-provisional
    // pin lives in respond-staleness.test.ts; this guards the live-data path).
    const lastCell = q.cells[q.cells.length - 1]!;
    if (lastCell.provisional) {
      expect(response.text).toMatch(/voorlopig cijfer/);
    }
  });
});

// ---------------------------------------------------------------------------
// The degenerate open-range shape (validation pass 2026-07-04, V01/V28): live,
// pre-v4 parsers emitted year_range fromYear == toYear for "sinds {jaar}" —
// the v1 raw schema could not express an open end. Since WP14 the live model
// says {kind:'since'} and V01 ANSWERS (tests/answer/intent-resolve.test.ts);
// this test pins the FALLBACK: should a degenerate shape still arrive (the
// stub replays the v1-era parse observed live in audit row 36, version field
// updated), the envelope must be an honest CLARIFICATION, never the catch-all
// internal refusal it produced before the 2026-07-05 resolver guard. With the
// WP14 coordinate-aware grain gate the degenerate yearly shape on
// unemployment now exits even earlier — naming the real constraint (the
// canonical seasonally-adjusted series has no yearly grain) instead of
// offering a range that could not be served (ADR 019 §4).
// ---------------------------------------------------------------------------

describe('open-range questions ("sinds 2015") clarify at the envelope level', () => {
  function stubIntentClient(rawParse: unknown): LlmClient {
    return {
      complete: async () => ({
        outputText: JSON.stringify(rawParse),
        model: 'stub-model',
        stopReason: 'end_turn',
        usage: { inputTokens: 0, outputTokens: 0 },
      }),
    };
  }

  it("V01's exact live parse becomes a period clarification, not an internal refusal", async () => {
    const observedLiveParse = {
      version: 2,
      kind: 'data_query',
      candidates: [
        {
          canonicalKey: 'unemployment_rate_seasonally_adjusted',
          regions: [{ name: 'Nederland', kind: 'land' }],
          period: { kind: 'year_range', fromYear: 2015, toYear: 2015 },
          derivation: 'series',
          confidence: 0.92,
          reading: 'ontwikkeling van werkloosheidspercentage in Nederland over de periode vanaf 2015',
        },
      ],
      unmatchedMeasureTerm: null,
      nearestCanonicalKeys: [],
      note: null,
    };
    const response = await respondToQuestion(
      db,
      'Hoe ontwikkelt de werkloosheid zich in Nederland sinds 2015?',
      {
        intentClient: stubIntentClient(observedLiveParse),
        answerClient: new ReplayLlmClient(ANSWER_FIXTURES),
        referenceDate: REFERENCE_DATE,
      },
    );
    expect(response.kind).toBe('clarification');
    if (response.kind !== 'clarification') throw new Error('unreachable');
    expect(response.axes).toEqual(['period']);
    expect(response.text).toContain('Die cijfers zijn er alleen per kwartaal');
    expect(response.options).toEqual(['per kwartaal']);
    // Belt: the clarification text carries no unbacked numbers.
    assertNoUnbackedNumbers(response, await whitelistForResponse(response));
  });
});

// ---------------------------------------------------------------------------
// A no-numbers sweep over every non-answer envelope this suite produced
// ---------------------------------------------------------------------------

describe('no-numbers sweep: every non-answer envelope in this suite', () => {
  it('every refusal/clarification text produced above has only whitelisted numbers', async () => {
    const envelopes: ComposedResponse[] = [];

    for (const taskId of ['B15', 'B16', 'B17', 'B18', 'B19', 'B20']) {
      envelopes.push(await respondToQuestion(db, REFUSAL_TASK_QUESTIONS[taskId]!, respondOptions()));
    }
    const compoundCase = labelledSet.cases.find((c) => c.id === 'r-compound')!;
    const smalltalkCase = labelledSet.cases.find((c) => c.id === 's-hallo')!;
    envelopes.push(await respondToQuestion(db, compoundCase.question, respondOptions()));
    envelopes.push(await respondToQuestion(db, smalltalkCase.question, respondOptions()));

    const clarifySet = loadClarificationCases();
    for (const c of clarifySet.cases) {
      const first = await respondToQuestion(db, c.originalQuestion, respondOptions(clarifySet.referenceDate));
      if (first.kind !== 'clarification') continue;
      envelopes.push(first);
      const reply = await respondToClarificationReply(
        db,
        first.pending,
        c.reply,
        clarifyReplyOptions(clarifySet.referenceDate),
      );
      if (reply.kind !== 'answer') envelopes.push(reply);
    }

    for (const envelope of envelopes) {
      if (envelope.kind === 'answer') continue; // answers are checked via checkComposedAnswer elsewhere
      const whitelist = await whitelistForResponse(envelope);
      // Staleness refusals are belt-checked in their own test above (with the
      // sync-date/period-label whitelist recovered via the query layer); this
      // sweep covers every other non-answer envelope, where no sync-date
      // numbers can legitimately occur.
      assertNoUnbackedNumbers(envelope, whitelist);
    }
  }, 300_000);
});

// #144 (ADR 034): the semantic second pass — deterministic gate (suspect
// detection over the validator's soft flags), output-contract validation,
// runner policy (reject-only, fail_open vs fail_closed), and the compose
// ladder integration. All hermetic: the LLM is a stub — these tests prove the
// deterministic 90% (gating, plumbing, policy), exactly the ADR 012 split;
// the checker's live judgment quality is the eval script's job
// (semantic-check:eval, owner-supervised recording).
import { describe, expect, it } from 'vitest';
import type { LlmClient, LlmRequest } from '../../src/answer/llm/client.ts';
import { composeAnswer } from '../../src/answer/compose/compose.ts';
import {
  buildSemanticCheckPayload,
  buildSemanticCheckRequest,
  findSuspectTokens,
  runSemanticCheck,
  validateSemanticCheckOutput,
  SEMANTIC_CHECK_MODEL,
} from '../../src/answer/compose/semantic-check.ts';
import { scanBody } from '../../src/answer/compose/validate.ts';
import { makeCell, makeResult } from '../helpers/synthetic-results.ts';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Single 2024 year cell, unit 'aantal' (no unit-adjacency demands). */
function yearResult() {
  return makeResult({
    shape: 'single',
    cells: [makeCell({ periodCode: '2024JJ00', periodLabel: '2024', value: 100, unit: 'aantal' })],
  });
}

/** A result whose metadata carries a bracket coordinate. The label is
 * word-prefixed ('personen van …') — a label STARTING at the numeral leaves
 * that numeral without an anchor word, so its echo fails the deterministic
 * validator outright and never reaches the checker. */
function bracketResult() {
  const cell = makeCell({ periodCode: '2024JJ00', periodLabel: '2024', value: 3618, unit: 'aantal' });
  cell.dimLabels = { leeftijd: 'personen van 45 tot 65 jaar' };
  return makeResult({ shape: 'single', cells: [cell] });
}

/** Bodies that pass the full deterministic validator against yearResult(). */
const CLEAN_BODY = 'In 2024 telde Nederland 100 inwoners.'; // 'telde' = corpus-safe continuation
const SUSPECT_BODY = 'In 2024 telde Nederland 100 inwoners. Het beeld veranderde na 2024 volgens het bureau.'; // 'volgens' = un-screened

const CLEAR_VERDICT = '{"version":1,"verdicts":[{"id":0,"fabricated":false,"reason":"jaartal"}]}';
const FABRICATED_VERDICT = '{"version":1,"verdicts":[{"id":0,"fabricated":true,"reason":"duur"}]}';

function stubClient(outputs: Array<string | Error>): { client: LlmClient; requests: LlmRequest[] } {
  const requests: LlmRequest[] = [];
  let i = 0;
  return {
    requests,
    client: {
      async complete(request: LlmRequest) {
        requests.push(request);
        const out = outputs[Math.min(i, outputs.length - 1)]!;
        i += 1;
        if (out instanceof Error) throw out;
        return {
          outputText: out,
          model: 'stub-checker',
          stopReason: 'end_turn',
          usage: { inputTokens: 11, outputTokens: 7 },
        };
      },
    },
  };
}

// ---------------------------------------------------------------------------
// The deterministic gate: which exemptions are residual-prone (soft)
// ---------------------------------------------------------------------------

describe('findSuspectTokens: only the two proven residual shapes are suspects', () => {
  it('#141 residual — temporal marker + un-screened continuation word is a suspect', () => {
    const suspects = findSuspectTokens('Het beeld veranderde na 2024 volgens het bureau. In 2024 telde Nederland 100 inwoners.', yearResult());
    expect(suspects.map((s) => `${s.token}:${s.kind}`)).toEqual(['2024:period']);
    expect(suspects[0]!.sentence).toBe('Het beeld veranderde na 2024 volgens het bureau.');
  });

  it('#140 residual — bracket-coordinate echoes beside their own words are suspects', () => {
    const suspects = findSuspectTokens('In 2024 telde de groep personen van 45 tot 65 jaar 3.618 personen.', bracketResult());
    expect(suspects.map((s) => `${s.token}:${s.kind}`)).toEqual(['45:metadata', '65:metadata']);
    // The fabricated reuse beside the same word is textually indistinguishable
    // — also a suspect; the CHECKER separates them, not the validator.
    const fabricated = findSuspectTokens('De regeling bestaat al 65 jaar.', bracketResult());
    expect(fabricated.map((s) => `${s.token}:${s.kind}`)).toEqual(['65:metadata']);
  });

  it('the date-form metadata echo ("op 1 januari 2024", "per 1 januari.") is HARD — no quantity reading exists', () => {
    const result = makeResult({
      shape: 'single',
      cells: [
        makeCell({
          periodCode: '2024JJ00',
          periodLabel: '2024',
          value: 3618,
          unit: 'aantal',
          measureTitle: 'Bevolking op 1 januari',
        }),
      ],
    });
    const body = 'Op 1 januari 2024 telde Nederland 3.618 inwoners.';
    expect(scanBody(body, result).find((t) => t.value === 1)?.kind).toBe('metadata');
    expect(findSuspectTokens(body, result)).toEqual([]);
    // Month followed by sentence end / punctuation is also a date.
    expect(findSuspectTokens('Nederland telde in 2024 3.618 inwoners, gemeten per 1 januari.', result)).toEqual([]);
  });

  it('REVIEW-CONFIRMED BYPASS (closed): a month-name COMPOUND after the echo is NOT a date — it stays suspect', () => {
    // The v1 rule looked only at the single word touching the number, so a
    // fabricated COUNT riding a month-name compound noun ("31
    // januari-meldingen", "1 januari overzicht") was hard-classified and the
    // checker never fired. Now: date-form requires a year or punctuation
    // after the month.
    const population = makeResult({
      shape: 'single',
      cells: [
        makeCell({
          periodCode: '2025JJ00',
          periodLabel: '2025',
          value: 18044027,
          unit: 'aantal',
          measureTitle: 'Bevolking op 1 januari',
        }),
      ],
    });
    const spaced = findSuspectTokens(
      'Nederland telde op 1 januari 2025 18.044.027 inwoners. Het CBS bracht daarnaast 1 januari overzicht extra uit.',
      population,
    );
    expect(spaced.map((s) => `${s.token}:${s.kind}`)).toEqual(['1:metadata']);
    const dienst = makeResult({
      shape: 'single',
      cells: [
        makeCell({
          periodCode: '2024JJ00',
          periodLabel: '2024',
          value: 5000,
          unit: 'aantal',
          measureTitle: 'Aantal op 31 januari',
        }),
      ],
    });
    const hyphenated = findSuspectTokens(
      "Er waren op 31 januari 2024 5.000 auto's. Daarnaast registreerde de dienst nog 31 januari-meldingen extra.",
      dienst,
    );
    expect(hyphenated.map((s) => `${s.token}:${s.kind}`)).toEqual(['31:metadata']);
  });

  it('a year with NO letter continuation ("in 2024 3,3%"-shape) is HARD', () => {
    const result = makeResult({
      shape: 'single',
      cells: [makeCell({ periodCode: '2024JJ00', periodLabel: '2024', value: 3.3, unit: '%', decimals: 1 })],
    });
    expect(findSuspectTokens('De inflatie bedroeg in 2024 3,3%.', result)).toEqual([]);
  });

  it('corpus-safe continuations, verbatim label echoes, span-after and list-label forms are HARD', () => {
    expect(findSuspectTokens(CLEAN_BODY, yearResult())).toEqual([]); // 'telde'
    const monthly = makeResult({
      shape: 'single',
      cells: [makeCell({ periodCode: '2026MM05', periodLabel: '2026 mei', value: 326, unit: 'aantal' })],
    });
    expect(findSuspectTokens('In 2026 mei waren het er 326.', monthly)).toEqual([]); // label echo
    const twoYears = makeResult({
      shape: 'series',
      cells: [
        makeCell({ periodCode: '2024JJ00', periodLabel: '2024', value: 100, unit: 'aantal' }),
        makeCell({ periodCode: '2025JJ00', periodLabel: '2025', value: 100, unit: 'aantal' }),
      ],
    });
    // '2024' grounds via the span-after leg (hard); '2025' is followed by
    // 'bleef' — an UN-screened continuation, so it stays suspect by design
    // (over-triggering costs one cheap call, never a wrong verdict; the safe
    // list grows only from measured eval misses).
    expect(
      findSuspectTokens('Tussen 2024 en 2025 bleef het aantal 100 in beide jaren gelijk aan 100.', twoYears).map(
        (s) => `${s.token}:${s.kind}`,
      ),
    ).toEqual(['2025:period']);
    // The same span with nothing after the second year has no suspect at all.
    expect(findSuspectTokens('Het aantal bedroeg 100 tussen 2024 en 2025.', twoYears)).toEqual([]);
  });

  it('cell values, derivations, counts and unbacked tokens are never suspects', () => {
    const tokens = scanBody('In 2024 telde Nederland 100 inwoners en 55 schepen.', yearResult());
    expect(tokens.find((t) => t.value === 100)?.soft).toBe(false); // cell
    expect(tokens.find((t) => t.value === 55)?.kind).toBe('unbacked'); // rejected outright — the validator's job, not the checker's
    expect(tokens.find((t) => t.value === 55)?.soft).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The labelled calibration set is structurally sound (hermetic half — the
// judgments themselves are the eval script's live/replay half, ADR 012 split)
// ---------------------------------------------------------------------------

describe('semantic-check labelled set (tests/helpers/semantic-check-cases.ts)', () => {
  it('every case passes the deterministic validator AND carries >=1 suspect', async () => {
    const { SEMANTIC_CHECK_CASES } = await import('../helpers/semantic-check-cases.ts');
    const { validateAnswerBody } = await import('../../src/answer/compose/validate.ts');
    expect(SEMANTIC_CHECK_CASES.length).toBeGreaterThanOrEqual(6);
    for (const c of SEMANTIC_CHECK_CASES) {
      const result = c.result();
      const validation = validateAnswerBody(c.body, result);
      expect(validation.problems, `${c.id} must pass the deterministic validator`).toEqual([]);
      expect(findSuspectTokens(c.body, result).length, `${c.id} must carry a suspect`).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Payload (R2 discipline) + output contract
// ---------------------------------------------------------------------------

describe('semantic-check payload and output contract', () => {
  it('the payload carries ONLY the whitelisted fields — no user question, no raw cells', () => {
    const suspects = findSuspectTokens(SUSPECT_BODY, yearResult());
    const payload = buildSemanticCheckPayload(SUSPECT_BODY, yearResult(), suspects);
    expect(Object.keys(payload).sort()).toEqual(['body', 'descriptors', 'periods', 'suspects', 'validatedValues']);
    expect(payload.suspects.map((s) => Object.keys(s).sort())).toEqual([['id', 'sentence', 'token']]);
    expect(payload.suspects[0]).toEqual({ id: 0, token: '2024', sentence: 'Het beeld veranderde na 2024 volgens het bureau.' });
    expect(payload.validatedValues).toEqual(['100 (aantal)']);
    expect(payload.periods).toEqual(['2024']);
    // The request is built from the payload + the fixed system prompt alone.
    const request = buildSemanticCheckRequest(payload);
    expect(request.model).toBe(SEMANTIC_CHECK_MODEL);
    expect(request.temperature).toBe(0);
    expect(request.question).toContain('"suspects"');
    expect(request.jsonSchema).toBeDefined();
  });

  it('output validation: exactly one verdict per suspect, or a loud error', () => {
    expect(validateSemanticCheckOutput(CLEAR_VERDICT, 1)).toEqual([{ id: 0, fabricated: false, reason: 'jaartal' }]);
    expect(() => validateSemanticCheckOutput('not json', 1)).toThrow(/not valid JSON/);
    expect(() => validateSemanticCheckOutput('{"version":2,"verdicts":[]}', 0)).toThrow(/schema/);
    expect(() => validateSemanticCheckOutput('{"version":1,"verdicts":[]}', 1)).toThrow(/exactly once/);
    expect(() =>
      validateSemanticCheckOutput('{"version":1,"verdicts":[{"id":0,"fabricated":false,"reason":"a"},{"id":0,"fabricated":false,"reason":"b"}]}', 2),
    ).toThrow(/exactly once/);
    expect(() =>
      validateSemanticCheckOutput('{"version":1,"verdicts":[{"id":1,"fabricated":false,"reason":"a"}]}', 1),
    ).toThrow(/exactly once/);
  });
});

// ---------------------------------------------------------------------------
// Runner policy: reject-only, fail_open vs fail_closed
// ---------------------------------------------------------------------------

describe('runSemanticCheck policy', () => {
  it('no suspects → no LLM call, skipped_no_suspects record', async () => {
    const stub = stubClient([new Error('must not be called')]);
    const outcome = await runSemanticCheck(CLEAN_BODY, yearResult(), { client: stub.client, mode: 'fail_open' });
    expect(stub.requests).toHaveLength(0);
    expect(outcome.reject).toBe(false);
    expect(outcome.record.status).toBe('skipped_no_suspects');
    expect(outcome.record.suspects).toEqual([]);
    expect(outcome.record.verdicts).toBeNull();
    expect(outcome.record.model).toBeNull();
  });

  it('suspects cleared → served with the verdicts recorded verbatim', async () => {
    const stub = stubClient([CLEAR_VERDICT]);
    const outcome = await runSemanticCheck(SUSPECT_BODY, yearResult(), { client: stub.client, mode: 'fail_open' });
    expect(stub.requests).toHaveLength(1);
    expect(outcome.reject).toBe(false);
    expect(outcome.record.status).toBe('ok');
    expect(outcome.record.model).toBe('stub-checker');
    expect(outcome.record.verdicts).toEqual([{ id: 0, fabricated: false, reason: 'jaartal' }]);
    expect(outcome.usage).toEqual({ inputTokens: 11, outputTokens: 7 });
  });

  it('a fabricated verdict rejects, naming the token and its sentence', async () => {
    const stub = stubClient([FABRICATED_VERDICT]);
    const outcome = await runSemanticCheck(SUSPECT_BODY, yearResult(), { client: stub.client, mode: 'fail_open' });
    expect(outcome.reject).toBe(true);
    expect(outcome.problems).toHaveLength(1);
    expect(outcome.problems[0]).toContain("SEM: getal '2024'");
    expect(outcome.problems[0]).toContain('veranderde na 2024 volgens');
  });

  it('checker error: fail_open serves (status error recorded), fail_closed rejects', async () => {
    const open = await runSemanticCheck(SUSPECT_BODY, yearResult(), {
      client: stubClient([new Error('boom')]).client,
      mode: 'fail_open',
    });
    expect(open.reject).toBe(false);
    expect(open.record.status).toBe('error');
    expect(open.record.mode).toBe('fail_open');
    expect(open.record.error).toContain('boom');
    expect(open.problems).toEqual([]);

    const closed = await runSemanticCheck(SUSPECT_BODY, yearResult(), {
      client: stubClient([new Error('boom')]).client,
      mode: 'fail_closed',
    });
    expect(closed.reject).toBe(true);
    expect(closed.problems[0]).toContain('fail_closed');
  });

  it('malformed checker output is an ERROR (per mode), never a clearance', async () => {
    const outcome = await runSemanticCheck(SUSPECT_BODY, yearResult(), {
      client: stubClient(['{"version":1,"verdicts":[]}']).client, // ids do not cover the suspect
      mode: 'fail_closed',
    });
    expect(outcome.reject).toBe(true);
    expect(outcome.record.status).toBe('error');
    expect(outcome.record.error).toContain('exactly once');
  });
});

// ---------------------------------------------------------------------------
// Compose ladder integration
// ---------------------------------------------------------------------------

describe('composeAnswer ladder integration (#144)', () => {
  it('feature OFF: no checker construction, no semanticCheck key in the envelope', async () => {
    const phrasing = stubClient([CLEAN_BODY]);
    const answer = await composeAnswer(yearResult(), { client: phrasing.client });
    expect(answer.source).toBe('llm');
    expect('semanticCheck' in answer).toBe(false);
    expect(JSON.stringify(answer)).not.toContain('semanticCheck');
  });

  it('feature ON, no suspects: served with skipped_no_suspects, zero checker calls', async () => {
    const phrasing = stubClient([CLEAN_BODY]);
    const checker = stubClient([new Error('must not be called')]);
    const answer = await composeAnswer(yearResult(), {
      client: phrasing.client,
      semanticCheck: { client: checker.client, mode: 'fail_open' },
    });
    expect(answer.source).toBe('llm');
    expect(checker.requests).toHaveLength(0);
    expect(answer.semanticCheck?.status).toBe('skipped_no_suspects');
  });

  it('feature ON, suspect cleared: served with the ok verdict + checker usage in the sum', async () => {
    const phrasing = stubClient([SUSPECT_BODY]);
    const checker = stubClient([CLEAR_VERDICT]);
    const answer = await composeAnswer(yearResult(), {
      client: phrasing.client,
      semanticCheck: { client: checker.client, mode: 'fail_open' },
    });
    expect(answer.source).toBe('llm');
    expect(answer.semanticCheck?.status).toBe('ok');
    expect(answer.semanticCheck?.verdicts).toEqual([{ id: 0, fabricated: false, reason: 'jaartal' }]);
    // 11/7 (phrasing stub) + 11/7 (checker stub).
    expect(answer.usage).toEqual({ inputTokens: 22, outputTokens: 14 });
    expect(answer.attempts).toEqual([{ kind: 'llm', ok: true, problems: [], error: null }]);
  });

  it('rejection drops down the SAME ladder: retry serves when its body is clean', async () => {
    const phrasing = stubClient([SUSPECT_BODY, CLEAN_BODY]);
    const checker = stubClient([FABRICATED_VERDICT]);
    const answer = await composeAnswer(yearResult(), {
      client: phrasing.client,
      semanticCheck: { client: checker.client, mode: 'fail_open' },
    });
    expect(answer.source).toBe('llm_retry');
    expect(answer.attempts).toHaveLength(2);
    expect(answer.attempts[0]!.ok).toBe(false);
    expect(answer.attempts[0]!.problems[0]).toContain('SEM:');
    expect(answer.attempts[1]!.ok).toBe(true);
    // The retry body has no suspects — the checker gate re-ran deterministically.
    expect(answer.semanticCheck?.status).toBe('skipped_no_suspects');
    expect(checker.requests).toHaveLength(1);
  });

  it('rejection on both attempts falls closed to the template — no semanticCheck key rides a template body', async () => {
    const phrasing = stubClient([SUSPECT_BODY, SUSPECT_BODY]);
    const checker = stubClient([FABRICATED_VERDICT, FABRICATED_VERDICT]);
    const answer = await composeAnswer(yearResult(), {
      client: phrasing.client,
      semanticCheck: { client: checker.client, mode: 'fail_open' },
    });
    expect(answer.source).toBe('template');
    expect('semanticCheck' in answer).toBe(false);
    expect(answer.attempts.map((a) => a.ok)).toEqual([false, false]);
    expect(answer.validation.ok).toBe(true); // the template always validates
  });

  it('checker error under fail_open serves the deterministically-validated body', async () => {
    const phrasing = stubClient([SUSPECT_BODY]);
    const checker = stubClient([new Error('api down')]);
    const answer = await composeAnswer(yearResult(), {
      client: phrasing.client,
      semanticCheck: { client: checker.client, mode: 'fail_open' },
    });
    expect(answer.source).toBe('llm');
    expect(answer.semanticCheck?.status).toBe('error');
    expect(answer.semanticCheck?.mode).toBe('fail_open');
    expect(answer.semanticCheck?.error).toContain('api down');
  });

  it('checker error under fail_closed walks the whole ladder to the template', async () => {
    const phrasing = stubClient([SUSPECT_BODY, SUSPECT_BODY]);
    const checker = stubClient([new Error('api down')]);
    const answer = await composeAnswer(yearResult(), {
      client: phrasing.client,
      semanticCheck: { client: checker.client, mode: 'fail_closed' },
    });
    expect(answer.source).toBe('template');
    expect('semanticCheck' in answer).toBe(false);
    expect(checker.requests).toHaveLength(2); // once per LLM attempt
    expect(answer.attempts.every((a) => !a.ok)).toBe(true);
  });
});

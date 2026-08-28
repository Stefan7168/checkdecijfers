// #162 (ADR-DRAFT slot-filling, hermetic half) — the deterministic 90%:
// slot-context/payload construction (R2, stronger: no values at all), the
// template-formatter fills (R10/R11 structural), the §1 pre-fill validation
// rules, the ladder wiring (new first rung, unchanged template floor), and —
// the load-bearing one — FLAG-OFF NEUTRALITY: without the option the request
// bytes and the envelope are byte-identical to the legacy pipeline. All
// hermetic: the LLM is a stub (the ADR 012 split); the slot pipeline's live
// phrasing quality is the §6 A/B's job (owner-supervised, NOT run yet).
import { describe, expect, it } from 'vitest';
import type { LlmClient, LlmRequest, LlmResponse } from '../../src/answer/llm/client.ts';
import { stableStringify } from '../../src/answer/llm/client.ts';
import { composeAnswer } from '../../src/answer/compose/compose.ts';
import { buildPhrasingRequest, COMPOSE_PROMPT_VERSION } from '../../src/answer/compose/prompt.ts';
import {
  buildSlotContext,
  buildSlotPhrasingPayload,
  buildSlotPhrasingRequest,
  fillSlots,
  SLOT_COMPOSE_PROMPT_VERSION,
  validateSlotBody,
} from '../../src/answer/compose/slots.ts';
import { renderTemplateBody } from '../../src/answer/compose/template.ts';
import { DERIVED_DATA_MARKING } from '../../src/query/index.ts';
import { makeCell, makeResult } from '../helpers/synthetic-results.ts';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Single 2024 count cell, no region — menu: waarde1, periode1. */
function singleResult() {
  return makeResult({
    shape: 'single',
    cells: [makeCell({ periodCode: '2024JJ00', periodLabel: '2024', value: 18044027, unit: 'aantal' })],
  });
}

/** Two %-cells + an explicit (negative) difference — menu: waarde1, waarde2,
 * periode1, periode2, verschil1. The R10 procentpunt case. */
function inflationResult() {
  const c2023 = makeCell({ periodCode: '2023JJ00', periodLabel: '2023', value: 4.4, unit: '%', decimals: 1 });
  const c2024 = makeCell({ periodCode: '2024JJ00', periodLabel: '2024', value: 3.3, unit: '%', decimals: 1 });
  return makeResult({
    shape: 'derived',
    cells: [c2023, c2024],
    derivations: [
      {
        kind: 'difference',
        explicit: true,
        value: -1.1,
        minuendResultId: c2024.resultId,
        subtrahendResultId: c2023.resultId,
        sourceResultIds: [c2023.resultId, c2024.resultId],
        unit: '%',
        marking: DERIVED_DATA_MARKING,
      },
    ],
  });
}

/** Two regions, one period, max derivation — the winner points at waarde1. */
function comparisonResult() {
  const ams = makeCell({
    region: { code: 'GM0363', label: 'Amsterdam' },
    periodCode: '2024JJ00',
    periodLabel: '2024',
    value: 12438,
    unit: 'aantal',
  });
  const rot = makeCell({
    region: { code: 'GM0599', label: 'Rotterdam' },
    periodCode: '2024JJ00',
    periodLabel: '2024',
    value: 8500,
    unit: 'aantal',
  });
  return makeResult({
    shape: 'comparison',
    cells: [ams, rot],
    derivations: [
      {
        kind: 'max',
        explicit: true,
        value: 12438,
        winnerResultId: ams.resultId,
        rankingResultIds: [ams.resultId, rot.resultId],
        sourceResultIds: [ams.resultId, rot.resultId],
        unit: 'aantal',
        marking: DERIVED_DATA_MARKING,
      },
    ],
  });
}

const GOOD_SINGLE_BODY = 'Nederland telde in {periode1} {waarde1} inwoners.';
const GOOD_INFLATION_BODY =
  'De inflatie daalde van {waarde1} in {periode1} naar {waarde2} in {periode2}, een daling van {verschil1}.';

function stubClient(outputs: Array<string | Error>): { client: LlmClient; requests: LlmRequest[] } {
  const requests: LlmRequest[] = [];
  let i = 0;
  return {
    requests,
    client: {
      async complete(request: LlmRequest): Promise<LlmResponse> {
        requests.push(request);
        const out = outputs[Math.min(i, outputs.length - 1)]!;
        i += 1;
        if (out instanceof Error) throw out;
        return {
          outputText: out,
          model: 'stub-model',
          stopReason: 'end_turn',
          usage: { inputTokens: 11, outputTokens: 7 },
        };
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Flag-off neutrality — the hermetic half's load-bearing proof
// ---------------------------------------------------------------------------

describe('flag OFF: byte-identical to the legacy pipeline', () => {
  it('the model sees the exact legacy request and the envelope serializes no #162 key', async () => {
    const { client, requests } = stubClient(['Nederland telde in 2024 18.044.027 inwoners.']);
    const answer = await composeAnswer(singleResult(), { client });
    // Request bytes: exactly what the legacy builder produces — so every
    // committed legacy fixture keeps its hash (the replay suite re-proves
    // this against the real fixtures).
    expect(stableStringify(requests[0])).toBe(stableStringify(buildPhrasingRequest(singleResult())));
    // Envelope: zero new keys serialized (present-only discipline, docs/13).
    expect(answer.source).toBe('llm');
    expect('slotPhrasing' in answer).toBe(false);
    expect(JSON.stringify(answer)).not.toContain('slotPhrasing');
    expect(answer.promptVersion).toBe(COMPOSE_PROMPT_VERSION);
  });
});

// ---------------------------------------------------------------------------
// The slot context and payload (R2: no values at all)
// ---------------------------------------------------------------------------

describe('slot context and payload', () => {
  it('builds the closed menu in deterministic order with exact bindings', () => {
    const result = inflationResult();
    const context = buildSlotContext(result);
    expect(context.menu).toEqual(['waarde1', 'waarde2', 'periode1', 'periode2', 'verschil1']);
    expect(context.bindings).toEqual([
      { slot: 'waarde1', kind: 'value', resultId: result.cells[0]!.resultId, derivationIndex: null },
      { slot: 'waarde2', kind: 'value', resultId: result.cells[1]!.resultId, derivationIndex: null },
      { slot: 'periode1', kind: 'period', resultId: result.cells[0]!.resultId, derivationIndex: null },
      { slot: 'periode2', kind: 'period', resultId: result.cells[1]!.resultId, derivationIndex: null },
      { slot: 'verschil1', kind: 'derivation', resultId: null, derivationIndex: 0 },
    ]);
  });

  it('shares one period slot across cells of the same period (comparison)', () => {
    const context = buildSlotContext(comparisonResult());
    expect(context.menu).toEqual(['waarde1', 'waarde2', 'periode1']);
  });

  it('the payload carries no value, no period label, no digits outside slot ids (R2, stronger)', () => {
    const result = inflationResult();
    const serialized = JSON.stringify(buildSlotPhrasingPayload(result, buildSlotContext(result)));
    for (const leaked of ['4,4', '3,3', '1,1', '2023', '2024', result.cells[0]!.resultId]) {
      expect(serialized, `'${leaked}' leaked into the slot payload`).not.toContain(leaked);
    }
    // After stripping the slot ids themselves, the whole payload is digit-free
    // (definitionLabel/periodSemantics are null here; when set they are the
    // only fields allowed to carry a digit, and the zero-digit OUTPUT rule
    // keeps such digits out of the body regardless).
    expect(serialized.replace(/(?:waarde|periode|verschil)\d+/g, '')).not.toMatch(/\d/);
  });

  it('serializes only whitelisted fields (the R2 walk, slot variant)', () => {
    const allowed = new Set([
      'shape', 'definitionLabel', 'periodSemantics', 'cells', 'derivations', 'slots',
      'slot', 'periodSlot', 'periodKind', 'regionLabel', 'unitKind', 'plural', 'provisional',
      'kind', 'explicit', 'direction', 'trendWord', 'monotonic', 'periodSlots',
      'winnerRegion', 'firstPeriodSlot', 'lastPeriodSlot',
    ]);
    const collect = (value: unknown, into: Set<string>): void => {
      if (Array.isArray(value)) { for (const v of value) collect(v, into); return; }
      if (value !== null && typeof value === 'object') {
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) { into.add(k); collect(v, into); }
      }
    };
    for (const result of [singleResult(), inflationResult(), comparisonResult()]) {
      const seen = new Set<string>();
      collect(buildSlotPhrasingPayload(result, buildSlotContext(result)), seen);
      for (const key of seen) expect(allowed.has(key), `field '${key}' leaked into the slot payload`).toBe(true);
    }
  });

  it('difference metadata: procentpunt unitKind, legacy trend word, both period slots', () => {
    const result = inflationResult();
    const payload = buildSlotPhrasingPayload(result, buildSlotContext(result));
    expect(payload.derivations).toEqual([
      {
        kind: 'difference',
        explicit: true,
        slot: 'verschil1',
        unitKind: 'procentpunt',
        direction: 'down',
        trendWord: 'daling',
        periodSlots: ['periode1', 'periode2'],
      },
    ]);
  });

  it('max points at the winner cell existing slot and names the winner region', () => {
    const result = comparisonResult();
    const payload = buildSlotPhrasingPayload(result, buildSlotContext(result));
    expect(payload.derivations).toEqual([
      { kind: 'max', explicit: true, slot: 'waarde1', winnerRegion: 'Amsterdam' },
    ]);
  });

  it('the strict retry request differs only by the stricter prompt', () => {
    const result = singleResult();
    const base = buildSlotPhrasingRequest(result);
    const strict = buildSlotPhrasingRequest(result, { strict: true });
    expect(base.system).not.toContain('STRENGER');
    expect(strict.system).toContain('STRENGER');
    expect(strict.question).toBe(base.question);
  });
});

// ---------------------------------------------------------------------------
// The filler — template-rung formatters, byte for byte (R10/R11 structural)
// ---------------------------------------------------------------------------

describe('fillSlots renders through the proven template formatters', () => {
  it('percent, procentpunt and period labels', () => {
    const context = buildSlotContext(inflationResult());
    expect(context.fills.get('waarde1')).toBe('4,4%');
    expect(context.fills.get('waarde2')).toBe('3,3%');
    expect(context.fills.get('periode1')).toBe('2023');
    expect(context.fills.get('periode2')).toBe('2024');
    expect(context.fills.get('verschil1')).toBe('1,1 procentpunt');
    expect(fillSlots(GOOD_INFLATION_BODY, context)).toBe(
      'De inflatie daalde van 4,4% in 2023 naar 3,3% in 2024, een daling van 1,1 procentpunt.',
    );
  });

  it('Dutch grouping and bare counts', () => {
    const context = buildSlotContext(singleResult());
    expect(context.fills.get('waarde1')).toBe('18.044.027');
  });

  it('factor units keep their verbatim factor string (the ×1.000 guard, R10)', () => {
    const result = makeResult({
      shape: 'single',
      cells: [makeCell({ periodCode: '2024JJ00', periodLabel: '2024', value: 8204, unit: 'x 1 000' })],
    });
    expect(buildSlotContext(result).fills.get('waarde1')).toBe('8.204 (x 1 000)');
  });

  it('provisional values carry the marking in the fill itself (R11 filler-owned)', () => {
    const result = makeResult({
      shape: 'single',
      cells: [makeCell({ periodCode: '2025KW01', periodLabel: '2025 1e kwartaal', value: 4.0, unit: '%', decimals: 1, status: 'Voorlopig' })],
    });
    expect(buildSlotContext(result).fills.get('waarde1')).toBe('4,0% (voorlopig cijfer)');
  });

  it('a difference over a provisional source carries the marking too (R11)', () => {
    const c2023 = makeCell({ periodCode: '2023JJ00', periodLabel: '2023', value: 4.4, unit: '%', decimals: 1 });
    const c2024 = makeCell({ periodCode: '2024JJ00', periodLabel: '2024', value: 3.3, unit: '%', decimals: 1, status: 'Voorlopig' });
    const result = makeResult({
      shape: 'derived',
      cells: [c2023, c2024],
      derivations: [
        {
          kind: 'difference',
          explicit: true,
          value: -1.1,
          minuendResultId: c2024.resultId,
          subtrahendResultId: c2023.resultId,
          sourceResultIds: [c2023.resultId, c2024.resultId],
          unit: '%',
          marking: DERIVED_DATA_MARKING,
        },
      ],
    });
    expect(buildSlotContext(result).fills.get('verschil1')).toBe('1,1 procentpunt (voorlopig cijfer)');
  });

  it('negative cell values keep their sign', () => {
    const result = makeResult({
      shape: 'single',
      cells: [makeCell({ periodCode: '2025MM06', periodLabel: '2025 juni', value: -24, unit: 'aantal' })],
    });
    expect(buildSlotContext(result).fills.get('waarde1')).toBe('-24');
  });
});

// ---------------------------------------------------------------------------
// Pre-fill validation — the §1 rules
// ---------------------------------------------------------------------------

describe('validateSlotBody (the §1 pre-fill rules)', () => {
  it('accepts a clean placeholder body', () => {
    expect(validateSlotBody(GOOD_INFLATION_BODY, buildSlotContext(inflationResult()))).toEqual({ ok: true, problems: [] });
  });

  it('rule i: any digit outside a valid placeholder rejects — ASCII and fullwidth alike', () => {
    const context = buildSlotContext(singleResult());
    const ascii = validateSlotBody('Nederland telde in {periode1} {waarde1} inwoners, zo’n 18 miljoen.', context);
    expect(ascii.ok).toBe(false);
    expect(ascii.problems.some((p) => p.includes("cijfer '18'"))).toBe(true);
    const fullwidth = validateSlotBody('Nederland telde in {periode1} {waarde1} inwoners (１８ miljoen).', context);
    expect(fullwidth.ok).toBe(false);
    expect(fullwidth.problems.some((p) => p.includes('cijfer'))).toBe(true);
  });

  it('rule ii: unknown or malformed placeholders reject', () => {
    const context = buildSlotContext(singleResult());
    const unknown = validateSlotBody('In {periode1} was het {waarde9}.', context);
    expect(unknown.ok).toBe(false);
    expect(unknown.problems.some((p) => p.includes("onbekende placeholder '{waarde9}'"))).toBe(true);
    const malformed = validateSlotBody('In {periode1} was het {waarde1 hoog.', context);
    expect(malformed.ok).toBe(false);
    expect(malformed.problems.some((p) => p.includes('accolade'))).toBe(true);
  });

  it('rule iii: a body without any value placeholder rejects (the no-value-shown guard)', () => {
    const report = validateSlotBody('Het cijfer voor {periode1} staat hieronder.', buildSlotContext(singleResult()));
    expect(report.ok).toBe(false);
    expect(report.problems.some((p) => p.includes('geen enkele waarde-placeholder'))).toBe(true);
  });

  it('rule iv: Dutch number/scale word-forms still reject (slots stop digits, not woorden)', () => {
    const context = buildSlotContext(singleResult());
    const report = validateSlotBody('Nederland telde in {periode1} {waarde1} inwoners — zeventien miljoen mensen.', context);
    expect(report.ok).toBe(false);
    expect(report.problems.some((p) => p.startsWith('R3:'))).toBe(true);
  });

  it('rule v: a value slot must share its sentence with its period slot (>1 periods)', () => {
    const report = validateSlotBody(
      'De inflatie was {waarde1} in {periode1}. Daarna kwam {waarde2}.',
      buildSlotContext(inflationResult()),
    );
    expect(report.ok).toBe(false);
    expect(report.problems.some((p) => p.includes('{waarde2}') && p.includes('periode-placeholder'))).toBe(true);
  });

  it('rule v: a verschil slot needs one source period in-sentence and BOTH in the body', () => {
    const report = validateSlotBody(
      'Het verschil bedroeg {verschil1} in {periode2}.',
      buildSlotContext(inflationResult()),
    );
    expect(report.ok).toBe(false);
    expect(report.problems.some((p) => p.includes('{periode1}') && p.includes('ontbreekt'))).toBe(true);
  });

  it('rule v: with >1 regions each value slot sentence must name its region', () => {
    const report = validateSlotBody(
      'Amsterdam telde in {periode1} {waarde1} inwoners. De andere stad telde {waarde2} inwoners.',
      buildSlotContext(comparisonResult()),
    );
    expect(report.ok).toBe(false);
    expect(report.problems.some((p) => p.includes('{waarde2}') && p.includes('Rotterdam'))).toBe(true);
  });

  it('rule v: single-axis results must still name the period slot and region somewhere', () => {
    const context = buildSlotContext(singleResult());
    const report = validateSlotBody('Het inwonertal was {waarde1}.', context);
    expect(report.ok).toBe(false);
    expect(report.problems.some((p) => p.includes('{periode1}') && p.includes('nergens'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Ladder integration — the new first rung, unchanged floor
// ---------------------------------------------------------------------------

describe('composeAnswer ladder integration (#162)', () => {
  it('flag ON, clean placeholder body: served filled, with the slot record and prompt version', async () => {
    const result = inflationResult();
    const { client, requests } = stubClient([GOOD_INFLATION_BODY]);
    const answer = await composeAnswer(result, { client, slotPhrasing: true });
    expect(answer.source).toBe('llm');
    expect(answer.body).toBe('De inflatie daalde van 4,4% in 2023 naar 3,3% in 2024, een daling van 1,1 procentpunt.');
    expect(answer.validation.ok).toBe(true);
    expect(answer.promptVersion).toBe(SLOT_COMPOSE_PROMPT_VERSION);
    expect(answer.slotPhrasing).toEqual({
      schemaVersion: 1,
      rawBody: GOOD_INFLATION_BODY,
      slots: buildSlotContext(result).bindings,
    });
    // The model saw the slot request, not the legacy one.
    expect(requests[0]!.system).toContain('placeholder');
    expect(requests[0]!.question).not.toContain('4,4');
  });

  it('digit leak → strict retry → served; the retry prompt is the stricter one', async () => {
    const result = singleResult();
    const { client, requests } = stubClient([
      'Nederland telde in {periode1} zo’n 18 miljoen — {waarde1} inwoners.',
      GOOD_SINGLE_BODY,
    ]);
    const answer = await composeAnswer(result, { client, slotPhrasing: true });
    expect(answer.source).toBe('llm_retry');
    expect(answer.body).toBe('Nederland telde in 2024 18.044.027 inwoners.');
    expect(answer.attempts).toHaveLength(2);
    expect(answer.attempts[0]!.ok).toBe(false);
    expect(answer.attempts[0]!.problems.some((p) => p.startsWith('SLOT:'))).toBe(true);
    expect(requests[1]!.system).toContain('STRENGER');
  });

  it('both attempts rejected → the UNCHANGED template floor, no slot record', async () => {
    const result = inflationResult();
    const { client } = stubClient(['Ongeveer {waarde9}.', 'Nog steeds {waarde9}.']);
    const answer = await composeAnswer(result, { client, slotPhrasing: true });
    expect(answer.source).toBe('template');
    expect(answer.body).toBe(renderTemplateBody(result));
    expect(answer.validation.ok).toBe(true);
    expect('slotPhrasing' in answer).toBe(false);
    expect(answer.promptVersion).toBe(SLOT_COMPOSE_PROMPT_VERSION);
    expect(answer.attempts.map((a) => a.ok)).toEqual([false, false]);
  });

  it('a fabricating client cannot land a digit: structurally rejected, template serves the cell values', async () => {
    const result = singleResult();
    const { client } = stubClient(['Het antwoord is ongeveer 12.345.678, oftewel twaalf miljoen.']);
    const answer = await composeAnswer(result, { client, slotPhrasing: true });
    expect(answer.source).toBe('template');
    expect(answer.text).not.toContain('12.345.678');
    expect(answer.body).toContain('18.044.027');
  });

  it('the §2 belt: a filled body with a wrong trend word fails the legacy validator', async () => {
    const result = inflationResult();
    const wrongTrend =
      'De inflatie steeg van {waarde1} in {periode1} naar {waarde2} in {periode2}, een stijging van {verschil1}.';
    const { client } = stubClient([wrongTrend, GOOD_INFLATION_BODY]);
    const answer = await composeAnswer(result, { client, slotPhrasing: true });
    expect(answer.source).toBe('llm_retry');
    expect(answer.attempts[0]!.ok).toBe(false);
    expect(answer.attempts[0]!.problems.some((p) => p.startsWith('R9:'))).toBe(true);
  });

  it('the #144 checker is never called on the slot path (ADR-draft §2)', async () => {
    const result = singleResult();
    // The filled body ends in a residual-prone shape ('na 2024 volgens…') —
    // exactly what would trigger the checker on the legacy path.
    const { client } = stubClient([
      'Nederland telde in {periode1} {waarde1} inwoners. Het beeld veranderde na {periode1} volgens het bureau.',
    ]);
    const checker = stubClient([new Error('must not be called')]);
    const answer = await composeAnswer(result, {
      client,
      slotPhrasing: true,
      semanticCheck: { client: checker.client, mode: 'fail_closed' },
    });
    expect(answer.source).toBe('llm');
    expect(checker.requests).toHaveLength(0);
    expect('semanticCheck' in answer).toBe(false);
  });

  it('null-cell results keep skipping the LLM entirely (flag on, zero calls)', async () => {
    const result = makeResult({
      shape: 'single',
      cells: [makeCell({ periodCode: '2024JJ00', periodLabel: '2024', value: null, unit: 'aantal', valueAttribute: 'Onbekend' })],
    });
    const { client, requests } = stubClient(['must not be called']);
    const answer = await composeAnswer(result, { client, slotPhrasing: true });
    expect(answer.source).toBe('template');
    expect(requests).toHaveLength(0);
  });

  it('templateOnly wins over the flag (ADR 024: no LLM call at all)', async () => {
    const { client, requests } = stubClient(['must not be called']);
    const answer = await composeAnswer(singleResult(), { client, slotPhrasing: true, templateOnly: true });
    expect(answer.source).toBe('template');
    expect(requests).toHaveLength(0);
    expect(answer.promptVersion).toBe(COMPOSE_PROMPT_VERSION);
  });

  it('rawBody is stored scan-normalized: fullwidth-free, zero-width-free', async () => {
    const result = singleResult();
    // A zero-width space smuggled into the model output must not survive into
    // the stored rawBody (the R8 re-fill would otherwise depend on invisible
    // bytes). Built via an escape so the invisible byte is visible in review.
    const smuggled = 'Nederland telde in {periode1} {waarde\u200B1} inwoners.';
    const { client } = stubClient([smuggled]);
    const answer = await composeAnswer(result, { client, slotPhrasing: true });
    expect(answer.source).toBe('llm');
    expect(answer.slotPhrasing?.rawBody).toBe(GOOD_SINGLE_BODY);
  });
});

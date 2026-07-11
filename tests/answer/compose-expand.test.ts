// #125a (ADR 031 D4/D5): the display splice — "uitgerekend erbij". Both
// insertion shapes, the fail-open belts, occurrence claiming, validator
// backing of the expanded token, and the compose.ts wiring (LLM path and
// template path get the identical mechanism).
import { describe, expect, it } from 'vitest';
import {
  applyUnitExpansions,
  composeAnswer,
  renderTemplateBody,
  validateAnswerBody,
} from '../../src/answer/compose/index.ts';
import type { LlmClient, LlmRequest, LlmResponse } from '../../src/answer/llm/client.ts';
import { deriveUnitExpansion } from '../../src/query/derivations.ts';
import type { DerivationRecord, ResultCell, ValidatedResult } from '../../src/query/index.ts';
import { makeCell, makeResult } from '../helpers/synthetic-results.ts';

/** The registered expansion for a cell — via the real derivation function so
 * these tests can never drift from what runQuery actually registers. */
function expansionFor(cell: ResultCell): DerivationRecord {
  const derived = deriveUnitExpansion(cell);
  if (!derived.ok) throw new Error(`test setup: ${derived.reason}`);
  return derived.record;
}

/** B6-shaped: 8.204 (x 1 000) with its registered expansion. */
function housingExpanded(): ValidatedResult {
  const cell = makeCell({
    table: '82235NED', measure: 'D002936', measureTitle: 'Beginstand voorraad',
    region: null, periodCode: '2024JJ00', periodLabel: '2024', value: 8204, unit: 'x 1 000',
  });
  return makeResult({
    shape: 'single',
    definitionLabel: 'woningvoorraad per 1 januari',
    cells: [cell],
    derivations: [expansionFor(cell)],
  });
}

/** The live #111 answer's shape: 390,2 with CBS's spaceless 'x 1000'. */
function bijstandExpanded(): ValidatedResult {
  const cell = makeCell({
    table: '37789ksz', measure: 'D000203_2', measureTitle: 'Totaal bijstandsuitkeringen',
    region: null, periodCode: '2023JJ00', periodLabel: '2023', value: 390.2, unit: 'x 1000', decimals: 1,
  });
  return makeResult({
    shape: 'single',
    definitionLabel: 'totaal bijstandsuitkeringen',
    cells: [cell],
    derivations: [expansionFor(cell)],
  });
}

describe('applyUnitExpansions — insertion shapes (D4)', () => {
  it('bare prose appends the owner-illustrated form: 390,2 x 1000 (= 390.200)', () => {
    const body = 'Het totaal aantal bijstandsuitkeringen kwam in 2023 uit op 390,2 x 1000.';
    expect(applyUnitExpansions(body, bijstandExpanded())).toBe(
      'Het totaal aantal bijstandsuitkeringen kwam in 2023 uit op 390,2 x 1000 (= 390.200).',
    );
  });

  it('a parenthesized unit takes the expansion inside the parens', () => {
    const body = 'De woningvoorraad per 1 januari was in 2024 8.204 (x 1 000).';
    expect(applyUnitExpansions(body, housingExpanded())).toBe(
      'De woningvoorraad per 1 januari was in 2024 8.204 (x 1 000 = 8.204.000).',
    );
  });

  it('matches every unit spelling the validator itself accepts (×, dots)', () => {
    const body = 'De woningvoorraad per 1 januari was in 2024 8.204 × 1.000.';
    expect(applyUnitExpansions(body, housingExpanded())).toBe(
      'De woningvoorraad per 1 januari was in 2024 8.204 × 1.000 (= 8.204.000).',
    );
  });

  it('spliced bodies still pass the full validator', () => {
    const spliced = applyUnitExpansions(
      'De woningvoorraad per 1 januari was in 2024 8.204 (x 1 000).',
      housingExpanded(),
    );
    expect(validateAnswerBody(spliced, housingExpanded()).ok).toBe(true);
  });
});

describe('applyUnitExpansions — fail-open belts (D4)', () => {
  it('no expansion record → byte-untouched', () => {
    const result = makeResult({
      shape: 'single',
      cells: [makeCell({ periodCode: '2024JJ00', periodLabel: '2024', value: 8204, unit: 'x 1 000' })],
    });
    const body = 'De testmaat was in 2024 8.204 (x 1 000).';
    expect(applyUnitExpansions(body, result)).toBe(body);
  });

  it('a body that is not its own scan-normal form → byte-untouched (index safety)', () => {
    const body = 'De woningvoorraad was in 2024 8​.204 (x 1 000).'; // zero-width space
    expect(applyUnitExpansions(body, housingExpanded())).toBe(body);
  });

  it('no factor phrase inside the R10 window → byte-untouched', () => {
    const body = 'De woningvoorraad per 1 januari was in 2024 8.204.';
    expect(applyUnitExpansions(body, housingExpanded())).toBe(body);
  });

  it('a splice the validator rejects is discarded whole (the last belt)', () => {
    // Two factor-unit cells; only the 2023 cell carries a record, and its
    // expanded figure (390.200) equals the 2024 cell's RAW value — so the
    // inserted token classifies as that cell and fails R10 (no factor string
    // adjacent to the insertion). The belt must throw the splice away.
    const a = makeCell({
      periodCode: '2023JJ00', periodLabel: '2023', value: 390.2, unit: 'x 1000', decimals: 1,
    });
    const b = makeCell({
      measure: 'M2', periodCode: '2024JJ00', periodLabel: '2024', value: 390200, unit: 'x 1000',
    });
    const result = makeResult({ shape: 'series', cells: [a, b], derivations: [expansionFor(a)] });
    const body = 'In 2023 was het 390,2 x 1000 en in 2024 390.200 x 1000.';
    expect(applyUnitExpansions(body, result)).toBe(body);
  });

  it('a phrase occurrence shared by two values is claimed by the nearest token only', () => {
    const a = makeCell({
      periodCode: '2023JJ00', periodLabel: '2023', value: 390.2, unit: 'x 1000', decimals: 1,
    });
    const b = makeCell({
      periodCode: '2024JJ00', periodLabel: '2024', value: 400.5, unit: 'x 1000', decimals: 1,
    });
    const result = makeResult({
      shape: 'series',
      cells: [a, b],
      derivations: [expansionFor(a), expansionFor(b)],
    });
    // One 'x 1000' within BOTH tokens' windows: only the nearest (400,5)
    // expands; 390,2 finds its only occurrence claimed and stays bare.
    const body = 'In 2023 390,2 en in 2024 400,5 x 1000.';
    expect(applyUnitExpansions(body, result)).toBe('In 2023 390,2 en in 2024 400,5 x 1000 (= 400.500).');
  });

  it('misattribution belt: a phrase with another number in between is never claimed', () => {
    // Only the 2023 cell carries a record; the lone 'x 1000' sits next to the
    // RECORDLESS 2024 value. Without the belt the 2023 anchor would claim it
    // and the answer would read "400,5 x 1000 (= 390.200)" — a misleading
    // display that survives re-validation (the token IS record-backed).
    const a = makeCell({
      periodCode: '2023JJ00', periodLabel: '2023', value: 390.2, unit: 'x 1000', decimals: 1,
    });
    const b = makeCell({
      periodCode: '2024JJ00', periodLabel: '2024', value: 400.5, unit: 'x 1000', decimals: 1,
    });
    const result = makeResult({ shape: 'series', cells: [a, b], derivations: [expansionFor(a)] });
    const body = 'In 2023 390,2 en in 2024 400,5 x 1000.';
    expect(applyUnitExpansions(body, result)).toBe(body);
  });

  it('double-render belt: a body that already shows the expanded figure stays untouched', () => {
    // A model that computed the expansion itself writes a token the record
    // backs — the validator rightly accepts it, and the splice must not add
    // the same figure a second time.
    const body = 'Het totaal aantal bijstandsuitkeringen kwam in 2023 uit op 390,2 x 1000 (= 390.200).';
    expect(applyUnitExpansions(body, bijstandExpanded())).toBe(body);
  });

  it('two values each with their own phrase both expand', () => {
    const a = makeCell({
      periodCode: '2023JJ00', periodLabel: '2023', value: 390.2, unit: 'x 1000', decimals: 1,
    });
    const b = makeCell({
      periodCode: '2024JJ00', periodLabel: '2024', value: 400.5, unit: 'x 1000', decimals: 1,
    });
    const result = makeResult({
      shape: 'series',
      cells: [a, b],
      derivations: [expansionFor(a), expansionFor(b)],
    });
    const body = 'In 2023 390,2 x 1000 en in 2024 400,5 x 1000.';
    expect(applyUnitExpansions(body, result)).toBe(
      'In 2023 390,2 x 1000 (= 390.200) en in 2024 400,5 x 1000 (= 400.500).',
    );
  });
});

describe('validator backing of the expanded token (D5)', () => {
  it('the correct expanded figure classifies as derivation and passes', () => {
    const report = validateAnswerBody(
      'Het totaal aantal bijstandsuitkeringen kwam in 2023 uit op 390,2 x 1000 (= 390.200).',
      bijstandExpanded(),
    );
    expect(report.problems).toEqual([]);
  });

  it('a WRONG expanded figure matches no record and fails R3', () => {
    const report = validateAnswerBody(
      'Het totaal aantal bijstandsuitkeringen kwam in 2023 uit op 390,2 x 1000 (= 390.201).',
      bijstandExpanded(),
    );
    expect(report.ok).toBe(false);
    expect(report.problems.some((p) => p.includes('390.201'))).toBe(true);
  });

  it('without the record, the expanded figure is unbacked (R1/R5)', () => {
    const bare = makeResult({
      shape: 'single',
      cells: [makeCell({ periodCode: '2023JJ00', periodLabel: '2023', value: 390.2, unit: 'x 1000', decimals: 1 })],
    });
    const report = validateAnswerBody(
      'De testmaat kwam in 2023 uit op 390,2 x 1000 (= 390.200).',
      bare,
    );
    expect(report.ok).toBe(false);
  });
});

class StubClient implements LlmClient {
  private readonly text: string;
  constructor(text: string) {
    this.text = text;
  }
  async complete(_request: LlmRequest): Promise<LlmResponse> {
    return { outputText: this.text, model: 'stub', stopReason: 'end_turn', usage: { inputTokens: 1, outputTokens: 1 } };
  }
}

class ThrowingClient implements LlmClient {
  async complete(): Promise<LlmResponse> {
    throw new Error('api unreachable');
  }
}

describe('compose.ts wiring — one mechanism for both paths (D4)', () => {
  it('LLM path: the stored body is the SPLICED body and text re-assembles from it', async () => {
    const answer = await composeAnswer(bijstandExpanded(), {
      client: new StubClient('Het totaal aantal bijstandsuitkeringen kwam in 2023 uit op 390,2 x 1000.'),
    });
    expect(answer.source).toBe('llm');
    expect(answer.body).toBe(
      'Het totaal aantal bijstandsuitkeringen kwam in 2023 uit op 390,2 x 1000 (= 390.200).',
    );
    expect(answer.validation.ok).toBe(true);
    expect(answer.text.startsWith(answer.body)).toBe(true);
    // D6: the expansion IS a bewerking — the CC BY marking line renders.
    expect(answer.markingLine).not.toBeNull();
  });

  it('template path: the fallback body splices identically', async () => {
    const answer = await composeAnswer(housingExpanded(), { client: new ThrowingClient() });
    expect(answer.source).toBe('template');
    expect(answer.body).toContain('8.204 (x 1 000 = 8.204.000)');
    expect(answer.validation.ok).toBe(true);
  });

  it('the template body itself stays splice-free (the splice is compose-level, R8 single site)', () => {
    // renderTemplateBody must NOT contain the expansion — assemble() is the
    // one splice site, so reconstruct.ts needs no new logic (the body is a
    // stored part).
    const body = renderTemplateBody(housingExpanded());
    expect(body).toContain('8.204 (x 1 000)');
    expect(body).not.toContain('8.204.000');
  });
});

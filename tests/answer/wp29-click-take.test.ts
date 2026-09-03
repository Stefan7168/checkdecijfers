// #73 v2 (ADR 029 as-built 2026-09-03, over ADR 024 mechanism A) — every
// follow-up chip is a zero-LLM click take: the four WP29 generators (adjacent
// period, trend, region variant, same topic) now ride the WP26 chip carrier
// exactly like the #197 comparison chips.
//
// What these prove, in the order the brief asks for:
//  (a) THE CARRIER HOLDS EVERY TAKEABLE SURVIVOR. With the flag on, each
//      survivor's label is in `pending.clickOptions` byte-equal and in display
//      order — and ONLY the takeable ones (the click-time schema is the gate).
//  (b) EACH GENERATOR'S TAKE COMPOSES on the `templateOnly` rung with BOTH LLM
//      clients throwing: adjacent → one cell, trend → a series with a line
//      chart, region variant → the national cell / the G4 comparison with a
//      bar chart. A NEW validated result every time (R6), the click model on
//      the parse, zero tokens.
//  (c) THE AUDITED TAKE ROW RECONSTRUCTS CLEAN (R8) and records the label as
//      reply_text.
//  (d) A SERVABLE-BUT-NOT-TAKEABLE survivor is offered as a plain label — in
//      `suggestions`, not in `clickOptions` (today's fill-the-input contract).
//  (e) FLAG OFF ⇒ no `pending` key and the pre-v2 list, byte-identical.
//  (f) THE FORGERY PINS still reject on the widened carrier.
//  Plus: a B-region-defaulted answer mints intents that name NL01 explicitly,
//  so a take never leans on the default still being on.
//
//  (g) SAME TOPIC — the only take that switches `target.key` — against REAL
//      data: five seed tables carry several canonical measures (83693NED ×3,
//      85880NED ×2, 85770NED ×3, 85828NED ×2, 85429NED ×4 — CANONICAL_MEASURES;
//      the rest carry one). Under cap 3 the topic chip surfaces when an earlier
//      generator yields nothing, e.g. on a SERIES answer (no trend chip, no
//      single-period comparison). (d) pins the other half: a sibling outside
//      CANONICAL_KEYS stays a label.
//  (h) ZERO TAKEABLE SURVIVORS on the real path: `suggestions` may still carry
//      label-only chips while the envelope has NO `pending` key at all.
//
// Hermetic: fixture-ingested PGlite + canned/throwing clients. No API key, no
// network — exactly what CI runs.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../../src/db/types.ts';
import { createIngestedDb } from '../helpers/ingested-db.ts';
import {
  CLICK_TAKE_MODEL,
  MAX_SUGGESTIONS,
  buildAnswerChips,
  buildSuggestions,
  respondToClarificationReply,
  respondToQuestion,
  validateClickOptions,
  withValidatedClickOptions,
} from '../../src/answer/respond/index.ts';
import type { AnswerChips, AnswerResponse, PendingClarification } from '../../src/answer/respond/index.ts';
import { respondToIntent } from '../../src/answer/respond/index.ts';
import { CHIP_CARRIER_QUESTION_NL, isRescuePending, isStrippedCarrier } from '../../src/answer/respond/respond.ts';
import type { ServabilityCheck } from '../../src/answer/intent/policy.ts';
import type { LlmClient, LlmResponse } from '../../src/answer/llm/client.ts';
import type { ParseOutcome, RawParse } from '../../src/answer/intent/types.ts';
import { MAX_CLICK_OPTIONS } from '../../src/answer/intent/types.ts';
import { CANONICAL_MEASURES } from '../../src/registry/defaults.ts';
import type { CanonicalMeasure } from '../../src/registry/types.ts';
import { echoServability, runQuery, INTENT_SCHEMA_VERSION } from '../../src/query/index.ts';
import type { StructuredIntent, ValidatedResult } from '../../src/query/index.ts';
import {
  answerClarificationReplyAudited,
  loadAuditRecord,
  reconstructionReport,
} from '../../src/answer/audit/index.ts';

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

/** Any call to this is a test failure by construction. */
class ThrowingClient implements LlmClient {
  async complete(): Promise<LlmResponse> {
    throw new Error('LLM call attempted on a path that must be deterministic');
  }
}

function rawDataQuery(...candidates: Record<string, unknown>[]): RawParse {
  return {
    version: 3,
    kind: 'data_query',
    candidates: candidates as never,
    unmatchedMeasureTerm: null,
    nearestCanonicalKeys: [],
    note: null,
  };
}

const AMSTERDAM_2024 = rawDataQuery({
  canonicalKey: 'population_on_1_january',
  regions: [{ name: 'Amsterdam', kind: 'gemeente' }],
  period: { kind: 'year', year: 2024 },
  derivation: 'none',
  confidence: 0.95,
  reading: 'bevolking van Amsterdam in 2024',
});

const ROTTERDAM_2024 = rawDataQuery({
  canonicalKey: 'population_on_1_january',
  regions: [{ name: 'Rotterdam', kind: 'gemeente' }],
  period: { kind: 'year', year: 2024 },
  derivation: 'none',
  confidence: 0.95,
  reading: 'bevolking van Rotterdam in 2024',
});

/** A question that names NO place — the WP26 mechanism B-region shape. */
const REGIONLESS_2024 = rawDataQuery({
  canonicalKey: 'population_on_1_january',
  regions: null,
  period: { kind: 'year', year: 2024 },
  derivation: 'none',
  confidence: 0.95,
  reading: 'bevolking in 2024',
});

const ADJACENT = 'Wat was bevolking op 1 januari in Amsterdam in 2025?';
const TREND = 'Hoe ontwikkelde bevolking op 1 januari in Amsterdam zich van 2020 tot en met 2024?';
const COMPARE_NL = 'Vergelijk met Nederland';

function intentOf(
  key: string,
  period: StructuredIntent['period'],
  regions?: string[],
  derivation: StructuredIntent['derivation'] = 'none',
): StructuredIntent {
  return {
    schemaVersion: INTENT_SCHEMA_VERSION,
    target: { kind: 'canonical', key },
    ...(regions && regions.length > 0 ? { regions } : {}),
    period,
    derivation,
  };
}

async function answered(intent: StructuredIntent): Promise<ValidatedResult> {
  const outcome = await runQuery(db, intent);
  if (!outcome.ok) throw new Error(`test fixture intent is not servable: ${JSON.stringify(intent)}`);
  return outcome;
}

const realCheck: ServabilityCheck = (intent) => echoServability(db, intent);
const ON = { clickOptions: true };

const SERVABLE = { servable: true } as const;
const NOT_SERVABLE = {
  servable: false,
  kind: 'no_data',
  axes: null,
  availability: { yearRange: null, freshest: null },
} as const;

function throwingOptions(clickOptionsEnabled = true, answerFirstEnabled?: boolean) {
  return {
    intentClient: new ThrowingClient(),
    answerClient: new ThrowingClient(),
    referenceDate: REFERENCE_DATE,
    clickOptionsEnabled,
    ...(answerFirstEnabled === undefined ? {} : { answerFirstEnabled }),
  };
}

async function answerAmsterdam(clickOptionsEnabled?: boolean): Promise<AnswerResponse> {
  const response = await respondToQuestion(db, 'Hoeveel inwoners had Amsterdam in 2024?', {
    intentClient: new CannedClient(AMSTERDAM_2024),
    answerClient: new ThrowingClient(),
    referenceDate: REFERENCE_DATE,
    ...(clickOptionsEnabled === undefined ? {} : { clickOptionsEnabled }),
  });
  if (response.kind !== 'answer') throw new Error(`expected an answer, got ${response.kind}: ${response.text}`);
  return response;
}

async function carrier(): Promise<PendingClarification> {
  const pending = (await answerAmsterdam(true)).pending;
  if (!pending) throw new Error('expected a carrier pending');
  return pending;
}

/** The carrier respondToIntent mints, built by hand from a buildAnswerChips
 * result — for the generators a stub check has to steer into a slot. */
function carrierFor(question: string, chips: AnswerChips): PendingClarification {
  return {
    version: 1,
    question,
    referenceDate: REFERENCE_DATE,
    axes: chips.axes,
    questionNl: CHIP_CARRIER_QUESTION_NL,
    options: chips.clickOptions.map((option) => option.label),
    clickOptions: chips.clickOptions,
    rescueOnly: true,
  };
}

async function take(pending: PendingClarification, label: string, answerFirstEnabled?: boolean) {
  const taken = await respondToClarificationReply(db, pending, label, throwingOptions(true, answerFirstEnabled));
  if (taken.kind !== 'answer') throw new Error(`expected the take to answer, got ${taken.kind}: ${taken.text}`);
  // ADR 024: template rung, click model, zero tokens — on every take.
  expect(taken.answer.source).toBe('template');
  expect(taken.answer.model).toBeNull();
  expect(taken.answer.validation.ok).toBe(true);
  expect(taken.parse.model).toBe(CLICK_TAKE_MODEL);
  expect(taken.parse.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
  // R1: every cell traceable.
  expect(taken.result.cells.every((c) => c.resultId.length > 0)).toBe(true);
  return taken;
}

describe('(a) the carrier holds every takeable survivor, byte-equal and in display order', () => {
  it('Amsterdam 2024, flag on: adjacent, trend AND the comparison are all click options; the question-shaped ones carry questionShaped', async () => {
    const response = await answerAmsterdam(true);
    expect(response.suggestions).toEqual([ADJACENT, TREND, COMPARE_NL]);
    const pending = response.pending;
    expect(pending).toBeDefined();
    if (!pending) throw new Error('unreachable');
    expect(pending.rescueOnly).toBe(true);
    expect(pending.questionNl).toBe(CHIP_CARRIER_QUESTION_NL);
    expect(pending.question).toBe('Hoeveel inwoners had Amsterdam in 2024?');
    expect(pending.referenceDate).toBe(REFERENCE_DATE);
    // Every survivor, in display order, label-bound index for index.
    expect(pending.options).toEqual(response.suggestions);
    expect(pending.clickOptions?.map((o) => o.label)).toEqual(response.suggestions);
    expect(pending.clickOptions?.map((o) => o.id)).toEqual(['adjacent-1', 'trend-1', 'cmp-1']);
    expect(pending.clickOptions?.map((o) => o.questionShaped)).toEqual([true, true, undefined]);
    expect(pending.clickOptions?.every((o) => o.impliedRecency === false)).toBe(true);
    // The union of the survivors' axes, in order of appearance.
    expect(pending.axes).toEqual(['period', 'region']);
    // The stored intents are exactly the ones the generators dry-ran.
    expect(pending.clickOptions?.[0]!.intent).toEqual(
      intentOf('population_on_1_january', { kind: 'codes', codes: ['2025JJ00'] }, ['GM0363']),
    );
    expect(pending.clickOptions?.[1]!.intent).toEqual(
      intentOf('population_on_1_january', { kind: 'range', from: '2020JJ00', to: '2024JJ00' }, ['GM0363'], 'series'),
    );
    expect(pending.clickOptions?.[2]!.intent).toEqual(
      intentOf('population_on_1_january', { kind: 'codes', codes: ['2024JJ00'] }, ['GM0363', 'NL01']),
    );
    // Carrier-shaped, and still carrier-shaped after the trust boundary.
    expect(isRescuePending(pending)).toBe(true);
    const validated = withValidatedClickOptions(pending);
    expect(validated).toEqual(pending);
    expect(isRescuePending(validated)).toBe(true);
    expect(validateClickOptions(pending.clickOptions)).toEqual(pending.clickOptions);
    // The audited text is byte-untouched by any of this.
    for (const label of response.suggestions) expect(response.text).not.toContain(label);
  });

  it('the bound: MAX_SUGGESTIONS chips always fit the carrier shape (1..MAX_CLICK_OPTIONS)', () => {
    expect(MAX_SUGGESTIONS).toBeLessThanOrEqual(MAX_CLICK_OPTIONS);
    expect(MAX_SUGGESTIONS).toBeGreaterThanOrEqual(1);
  });

  it('a national answer (Nederland 2026): adjacent falls back to 2025, trend 2022–2026, the G4 comparison — all three takeable, every intent naming its regions', async () => {
    const intent = intentOf('population_on_1_january', { kind: 'codes', codes: ['2026JJ00'] }, ['NL01']);
    const chips = await buildAnswerChips(intent, await answered(intent), realCheck, ON);
    expect(chips.suggestions).toEqual([
      'Wat was bevolking op 1 januari in Nederland in 2025?',
      'Hoe ontwikkelde bevolking op 1 januari in Nederland zich van 2022 tot en met 2026?',
      'Vergelijk met Amsterdam, Rotterdam, Den Haag en Utrecht',
    ]);
    expect(chips.clickOptions.map((o) => o.label)).toEqual(chips.suggestions);
    expect(chips.clickOptions.map((o) => o.id)).toEqual(['adjacent-1', 'trend-1', 'cmp-1']);
    for (const option of chips.clickOptions) expect(option.intent.regions?.[0]).toBe('NL01');
    expect(validateClickOptions(chips.clickOptions)).toEqual(chips.clickOptions);
  });
});

describe('(b) the take — each generator composes on the templateOnly rung, both clients throwing', () => {
  it('adjacent period: one cell for 2025 in Amsterdam, no chart, a NEW validated result — and the taken answer chains its own carrier', async () => {
    const taken = await take(await carrier(), ADJACENT);
    expect(taken.result.shape).toBe('single');
    expect(taken.result.intent).toEqual(
      intentOf('population_on_1_january', { kind: 'codes', codes: ['2025JJ00'] }, ['GM0363']),
    );
    expect(taken.result.cells.map((c) => [c.regionCode, c.periodCode])).toEqual([['GM0363', '2025JJ00']]);
    expect(taken.chart).toBeNull();
    expect(taken.text).toContain('2025');
    // The reply-turn convention: the ORIGINAL question is the row's question.
    expect(taken.question).toBe('Hoeveel inwoners had Amsterdam in 2024?');
    // The 2025 answer offers its own chips on its own carrier (2026 next).
    expect(taken.suggestions[0]).toBe('Wat was bevolking op 1 januari in Amsterdam in 2026?');
    expect(taken.pending?.options).toEqual(taken.pending?.clickOptions?.map((o) => o.label));
  });

  it('trend: a five-period series 2020..2024 for Amsterdam with the builder\'s LINE chart', async () => {
    const taken = await take(await carrier(), TREND);
    expect(taken.result.shape).toBe('series');
    expect(taken.result.cells.map((c) => c.periodCode)).toEqual([
      '2020JJ00',
      '2021JJ00',
      '2022JJ00',
      '2023JJ00',
      '2024JJ00',
    ]);
    expect(taken.result.cells.every((c) => c.regionCode === 'GM0363')).toBe(true);
    expect(taken.chart?.kind).toBe('line');
    expect(taken.chart?.series).toHaveLength(1);
    expect(taken.chart?.series[0]!.points).toHaveLength(5);
    // A series answer offers no trend chip of its own (it would re-ask).
    expect(taken.suggestions.join(' ')).not.toContain('Hoe ontwikkelde');
  });

  it('trend on a NATIONAL answer (Nederland 2026): the 2022..2026 window, five NL01 cells, a line chart', async () => {
    const question = 'Hoeveel inwoners had Nederland in 2026?';
    const intent = intentOf('population_on_1_january', { kind: 'codes', codes: ['2026JJ00'] }, ['NL01']);
    const chips = await buildAnswerChips(intent, await answered(intent), realCheck, ON);
    const label = 'Hoe ontwikkelde bevolking op 1 januari in Nederland zich van 2022 tot en met 2026?';
    expect(chips.clickOptions[1]!.id).toBe('trend-1');
    expect(chips.clickOptions[1]!.label).toBe(label);
    const taken = await take(carrierFor(question, chips), label);
    expect(taken.result.shape).toBe('series');
    expect(taken.result.cells.map((c) => c.periodCode)).toEqual([
      '2022JJ00',
      '2023JJ00',
      '2024JJ00',
      '2025JJ00',
      '2026JJ00',
    ]);
    expect(taken.result.cells.every((c) => c.regionCode === 'NL01')).toBe(true);
    expect(taken.chart?.kind).toBe('line');
    expect(taken.chart?.series).toHaveLength(1);
    expect(taken.chart?.series[0]!.points).toHaveLength(5);
  });

  /** Steers the region VARIANT into a slot: refuse the two comparison shapes
   * — the national row beside other regions (`[GM…, NL01]` / `[NL01, G4…]`)
   * and the difference derivation — and pass everything else to the REAL
   * dry-run, so the variant's own candidate (`[NL01]` alone, or the G4) is
   * still proven against loaded data. */
  const noComparisons: ServabilityCheck = async (intent) => {
    const regions = intent.regions ?? [];
    return (regions.includes('NL01') && regions.length > 1) || intent.derivation === 'difference'
      ? NOT_SERVABLE
      : echoServability(db, intent);
  };

  it('region variant, sub-national → the national figure: one NL01 cell at the answered period', async () => {
    const question = 'Hoeveel inwoners had Amsterdam in 2024?';
    const intent = intentOf('population_on_1_january', { kind: 'codes', codes: ['2024JJ00'] }, ['GM0363']);
    const chips = await buildAnswerChips(intent, await answered(intent), noComparisons, ON);
    const label = 'Wat was bevolking op 1 januari in Nederland in 2024?';
    expect(chips.suggestions).toEqual([ADJACENT, TREND, label]);
    expect(chips.clickOptions.map((o) => o.id)).toEqual(['adjacent-1', 'trend-1', 'region-1']);
    expect(chips.clickOptions[2]!.questionShaped).toBe(true);
    expect(chips.axes).toEqual(['period', 'region']);
    const taken = await take(carrierFor(question, chips), label);
    expect(taken.result.shape).toBe('single');
    expect(taken.result.cells.map((c) => [c.regionCode, c.periodCode])).toEqual([['NL01', '2024JJ00']]);
    expect(taken.chart).toBeNull();
    expect(taken.text).toContain('Nederland');
  });

  it('region variant, national → the G4: a four-region comparison with the builder\'s BAR chart', async () => {
    const question = 'Hoeveel inwoners had Nederland in 2026?';
    const intent = intentOf('population_on_1_january', { kind: 'codes', codes: ['2026JJ00'] }, ['NL01']);
    const chips = await buildAnswerChips(intent, await answered(intent), noComparisons, ON);
    const label = 'Wat was bevolking op 1 januari in de gemeentes Amsterdam, Rotterdam, Den Haag en Utrecht in 2026?';
    expect(chips.suggestions[2]).toBe(label);
    expect(chips.clickOptions[2]!.id).toBe('region-1');
    const taken = await take(carrierFor(question, chips), label);
    expect(taken.result.shape).toBe('comparison');
    expect(taken.result.cells.map((c) => c.regionCode)).toEqual(['GM0363', 'GM0599', 'GM0518', 'GM0344']);
    expect(taken.result.cells.every((c) => c.periodCode === '2026JJ00')).toBe(true);
    expect(taken.chart?.kind).toBe('bar');
    expect(taken.chart?.series).toHaveLength(4);
  });

  it('a click after a rollback (flag off) sends the question-shaped label through a fresh parse — it IS a question, so that path is the v1 contract, not a dead end', async () => {
    const pending = await carrier();
    const next = await respondToClarificationReply(db, pending, ADJACENT, {
      intentClient: new CannedClient(ROTTERDAM_2024),
      answerClient: new ThrowingClient(),
      referenceDate: REFERENCE_DATE,
      clickOptionsEnabled: false,
    });
    expect(next.kind).toBe('answer');
    if (next.kind !== 'answer') throw new Error('unreachable');
    expect(next.question).toBe(ADJACENT);
    expect(next.parse.model).not.toBe(CLICK_TAKE_MODEL);
  });
});

describe('(c) the AUDITED take writes a real row that reconstructs clean (R8)', () => {
  async function audited(label: string) {
    const pending = await carrier();
    const outcome = await answerClarificationReplyAudited(db, pending, label, {
      ...throwingOptions(true),
      sourceTag: 'validation',
    });
    expect(outcome.response.kind).toBe('answer');
    expect(outcome.auditId).not.toBeNull();
    const record = await loadAuditRecord(db, outcome.auditId!);
    if (record === null) throw new Error('audit row missing');
    expect(record.kind).toBe('answer');
    expect(record.replyText).toBe(label);
    expect(record.pendingClarification).toEqual(pending);
    expect(record.question).toBe('Hoeveel inwoners had Amsterdam in 2024?');
    expect(record.llmCalls).toEqual([]);
    expect(record.answerSource).toBe('template');
    expect(reconstructionReport(record).problems).toEqual([]);
    return record;
  }

  it('adjacent period: one result id, the label as reply_text, zero LLM calls', async () => {
    const record = await audited(ADJACENT);
    expect(record.resultIds).toHaveLength(1);
  });

  it('trend: five result ids and the stored line chart re-derive', async () => {
    const record = await audited(TREND);
    expect(record.resultIds).toHaveLength(5);
  });
});

describe('(d) a servable-but-not-takeable survivor is offered as a plain label, never as an option', () => {
  const sibling: CanonicalMeasure = {
    key: 'population_average_test_only',
    tableId: '03759ned',
    measure: 'M000365',
    measureTitle: 'Gemiddelde bevolking',
    dims: {},
    definitionLabel: 'gemiddelde bevolking',
    everydayTerms: ['gemiddelde inwoners'],
  };
  const registry = [...CANONICAL_MEASURES, sibling];

  it('an injected same-table sibling outside CANONICAL_KEYS: in suggestions, NOT in clickOptions, no axis', async () => {
    const intent = intentOf('population_on_1_january', { kind: 'codes', codes: ['2024JJ00'] }, ['GM0363']);
    const result = await answered(intent);
    // Only the sibling survives its dry-run.
    const check: ServabilityCheck = async (candidate) =>
      candidate.target.kind === 'canonical' && candidate.target.key === sibling.key ? SERVABLE : NOT_SERVABLE;
    const chips = await buildAnswerChips(intent, result, check, ON, registry);
    expect(chips.suggestions).toEqual(['Hoeveel gemiddelde inwoners waren er in Amsterdam in 2024?']);
    expect(chips.clickOptions).toEqual([]);
    expect(chips.axes).toEqual([]);
    // And the flag-off list is the same one label (offered either way).
    expect(chips.suggestions).toEqual(await buildSuggestions(intent, result, check, registry));
  });

  it('mixed: takeable chips get options and the label-only sibling sits beside them — options stay a label-bound subset in display order', async () => {
    const intent = intentOf('population_on_1_january', { kind: 'codes', codes: ['2024JJ00'] }, ['GM0363']);
    const result = await answered(intent);
    // Refuse the trend and both comparisons; accept the adjacent code, the
    // national variant and the sibling.
    const check: ServabilityCheck = async (candidate) =>
      candidate.derivation !== 'none' || (candidate.regions ?? []).length > 1 ? NOT_SERVABLE : SERVABLE;
    const chips = await buildAnswerChips(intent, result, check, ON, registry);
    expect(chips.suggestions).toEqual([
      ADJACENT,
      'Wat was bevolking op 1 januari in Nederland in 2024?',
      'Hoeveel gemiddelde inwoners waren er in Amsterdam in 2024?',
    ]);
    expect(chips.clickOptions.map((o) => o.label)).toEqual([
      ADJACENT,
      'Wat was bevolking op 1 januari in Nederland in 2024?',
    ]);
    expect(chips.clickOptions.map((o) => o.id)).toEqual(['adjacent-1', 'region-1']);
    expect(chips.axes).toEqual(['period', 'region']);
    // Such a carrier is still carrier-shaped: options are the takeable labels.
    expect(isRescuePending(carrierFor('q', chips))).toBe(true);
  });

  it('drop-never-guess, extended to the take: when a named place has no honest cell label the candidates name no region — offered as labels only, never as an intent that would lean on the B-region default', async () => {
    // Two codes whose base labels collapse to ONE name ("Utrecht (gemeente)"
    // and "Utrecht (PV)" both → "Utrecht") is the realistic shape; here the
    // stub result simply carries fewer labels than the intent has codes.
    const amsterdam = intentOf('population_on_1_january', { kind: 'codes', codes: ['2024JJ00'] }, ['GM0363']);
    const result = await answered(amsterdam);
    const twoRegions = intentOf('population_on_1_january', { kind: 'codes', codes: ['2024JJ00'] }, ['GM0363', 'GM0599']);
    const chips = await buildAnswerChips(twoRegions, { ...result, intent: twoRegions }, async () => SERVABLE, ON);
    expect(chips.suggestions).toEqual([
      'Wat was bevolking op 1 januari in 2025?',
      'Hoe ontwikkelde bevolking op 1 januari zich van 2020 tot en met 2024?',
      'Vergelijk met Nederland',
    ]);
    // The rule discriminates per candidate: the two region-less question chips
    // stay labels, while the comparison — which names its regions explicitly
    // (the resolved codes + NL01) — is still a take.
    expect(chips.clickOptions.map((o) => o.id)).toEqual(['cmp-1']);
    expect(chips.clickOptions[0]!.intent.regions).toEqual(['GM0363', 'GM0599', 'NL01']);
    expect(chips.axes).toEqual(['region']);
  });
});

describe('(e) flag OFF: no pending key, the pre-v2 list byte for byte', () => {
  it('respondToQuestion without the flag carries the WP29 list and no `pending`', async () => {
    for (const flag of [undefined, false] as const) {
      const response = await answerAmsterdam(flag);
      expect(Object.hasOwn(response, 'pending')).toBe(false);
      expect(response.suggestions).toEqual([
        ADJACENT,
        TREND,
        'Wat was bevolking op 1 januari in Nederland in 2024?',
      ]);
      expect(response.suggestions).toEqual(await buildSuggestions(response.result.intent, response.result, realCheck));
    }
  });

  it('buildAnswerChips flag off: the empty option shape, whatever the survivors', async () => {
    const intent = intentOf('population_on_1_january', { kind: 'codes', codes: ['2024JJ00'] }, ['GM0363']);
    const result = await answered(intent);
    const chips = await buildAnswerChips(intent, result, realCheck, { clickOptions: false });
    expect(chips).toEqual({ suggestions: await buildSuggestions(intent, result, realCheck), clickOptions: [], axes: [] });
  });
});

describe('(f) the forgery pins hold on the widened carrier', () => {
  it('swapped labels, a length mismatch, a missing axis or a bare flag never read as a carrier', async () => {
    const pending = await carrier();
    if (!pending.clickOptions || pending.clickOptions.length !== 3) throw new Error('expected three chips');
    expect(isRescuePending(pending)).toBe(true);
    // (a) options[i] must equal clickOptions[i].label — any reorder ⇒ not a carrier.
    expect(isRescuePending({ ...pending, options: [pending.options[1]!, pending.options[0]!, pending.options[2]!] })).toBe(false);
    // (b) a length mismatch either way ⇒ not a carrier.
    expect(isRescuePending({ ...pending, options: pending.options.slice(0, 2) })).toBe(false);
    expect(isRescuePending({ ...pending, clickOptions: pending.clickOptions.slice(0, 2) })).toBe(false);
    // (c) the bare flag, no chips at all ⇒ not a carrier (the session-57 pin).
    expect(isRescuePending({ ...pending, clickOptions: undefined, rescueOnly: true })).toBe(false);
    expect(isRescuePending({ ...pending, axes: [] })).toBe(false);
    // (d) a label swapped INTO an option is caught by the reply match, not only the shape:
    // the take matches the reply against options[] AND the option's own label.
    const forged: PendingClarification = {
      ...pending,
      clickOptions: [{ ...pending.clickOptions[2]!, label: ADJACENT }, pending.clickOptions[1]!, pending.clickOptions[0]!],
    };
    expect(isRescuePending(forged)).toBe(false);
  });

  it('#122 review: ONE tampered option is dropped WITHOUT breaking the carrier — options re-align to the survivors, the surviving chip still takes, the dropped label and unrelated text are FRESH questions (never the paid merge), with the flag on and off', async () => {
    const pending = await carrier();
    const [adjacent, trend, compare] = pending.clickOptions!;
    // Tamper the TREND option (impliedRecency is not a boolean) — dropped.
    const tampered: PendingClarification = {
      ...pending,
      clickOptions: [adjacent!, { ...trend!, impliedRecency: 'no' as unknown as boolean }, compare!],
    };
    const safe = withValidatedClickOptions(tampered);
    expect(safe.clickOptions?.map((o) => o.id)).toEqual(['adjacent-1', 'cmp-1']);
    // BEFORE the fix `options` stayed three long, the carrier stopped being
    // carrier-shaped, and every non-matching reply fell into the LLM merge.
    expect(safe.options).toEqual([ADJACENT, COMPARE_NL]);
    expect(isRescuePending(safe)).toBe(true);
    // The surviving chip still takes — both clients throwing.
    const taken = await take(safe, ADJACENT);
    expect(taken.result.cells.map((c) => c.periodCode)).toEqual(['2025JJ00']);
    const fresh = (clickOptionsEnabled: boolean) => ({
      intentClient: new CannedClient(ROTTERDAM_2024),
      answerClient: new ThrowingClient(),
      referenceDate: REFERENCE_DATE,
      clickOptionsEnabled,
    });
    // The DROPPED chip's label is a fresh question (the canned parse stands in
    // for the ordinary parse) — the answer belongs to the typed text, never to
    // the answered question (a merge would answer under pending.question).
    const dropped = await respondToClarificationReply(db, safe, TREND, fresh(true));
    expect(dropped.kind).toBe('answer');
    if (dropped.kind !== 'answer') throw new Error('unreachable');
    expect(dropped.question).toBe(TREND);
    expect(dropped.parse.model).not.toBe(CLICK_TAKE_MODEL);
    // An UNRELATED question likewise.
    const unrelated = await respondToClarificationReply(db, safe, 'Hoeveel inwoners had Rotterdam in 2024?', fresh(true));
    expect(unrelated.kind).toBe('answer');
    if (unrelated.kind !== 'answer') throw new Error('unreachable');
    expect(unrelated.question).toBe('Hoeveel inwoners had Rotterdam in 2024?');
    expect(unrelated.result.intent.regions).toEqual(['GM0599']);
    expect(unrelated.parse.model).not.toBe(CLICK_TAKE_MODEL);
    // And after a rollback (flag off) the re-aligned carrier still routes
    // fresh instead of merging — the documented post-rollback behaviour.
    const rolledBack = await respondToClarificationReply(db, safe, ADJACENT, fresh(false));
    expect(rolledBack.kind).toBe('answer');
    if (rolledBack.kind !== 'answer') throw new Error('unreachable');
    expect(rolledBack.question).toBe(ADJACENT);
    expect(rolledBack.parse.model).not.toBe(CLICK_TAKE_MODEL);
  });

  it('#122 review: a carrier whose EVERY option is dropped is a STRIPPED carrier (rescueOnly, empty options, no chips) — every reply is a fresh question, never the merge', async () => {
    const pending = await carrier();
    const allTampered: PendingClarification = {
      ...pending,
      clickOptions: pending.clickOptions!.map((o) => ({ ...o, id: '' })),
    };
    const safe = withValidatedClickOptions(allTampered);
    expect(safe).toEqual({
      version: pending.version,
      question: pending.question,
      referenceDate: pending.referenceDate,
      axes: pending.axes,
      questionNl: pending.questionNl,
      options: [],
      rescueOnly: true,
    });
    expect(isRescuePending(safe)).toBe(false);
    expect(isStrippedCarrier(safe)).toBe(true);
    const fresh = {
      intentClient: new CannedClient(ROTTERDAM_2024),
      answerClient: new ThrowingClient(),
      referenceDate: REFERENCE_DATE,
      clickOptionsEnabled: true,
    };
    const unrelated = await respondToClarificationReply(db, safe, 'Hoeveel inwoners had Rotterdam in 2024?', fresh);
    expect(unrelated.kind).toBe('answer');
    if (unrelated.kind !== 'answer') throw new Error('unreachable');
    expect(unrelated.question).toBe('Hoeveel inwoners had Rotterdam in 2024?');
    expect(unrelated.result.intent.regions).toEqual(['GM0599']);
    // A clicked chip whose option was dropped goes the same way — its label is
    // a complete question, so the ordinary parse handles it (v1 behaviour).
    const label = await respondToClarificationReply(db, safe, ADJACENT, fresh);
    expect(label.kind).toBe('answer');
    if (label.kind !== 'answer') throw new Error('unreachable');
    expect(label.question).toBe(ADJACENT);
    expect(label.parse.model).not.toBe(CLICK_TAKE_MODEL);
  });

  it('a client-supplied questionShaped that is not literally true drops the option at the trust boundary (fail-closed)', async () => {
    const pending = await carrier();
    const tampered = pending.clickOptions!.map((option, index) =>
      index === 0 ? { ...option, questionShaped: 'yes' as unknown as true } : option,
    );
    expect(validateClickOptions(tampered).map((o) => o.id)).toEqual(['trend-1', 'cmp-1']);
  });
});

describe('(g) same topic — the only take that switches target.key, on real data (83693NED carries three canonical measures)', () => {
  const question = 'Hoe ontwikkelde het consumentenvertrouwen zich van april tot en met juni 2026?';
  const series = intentOf(
    'consumer_confidence_seasonally_adjusted',
    { kind: 'range', from: '2026MM04', to: '2026MM06' },
    undefined,
    'series',
  );
  const topicLabel = 'Hoeveel economisch klimaat waren er in juni 2026?';

  it('a consumer-confidence SERIES answer offers the economic-climate sibling as topic-1 (questionShaped): a series gets no trend chip and no single-period comparison, so the roster has room', async () => {
    const chips = await buildAnswerChips(series, await answered(series), realCheck, ON);
    expect(chips.suggestions).toEqual([
      'Wat was consumentenvertrouwen, seizoengecorrigeerd in maart 2026?',
      topicLabel,
    ]);
    expect(chips.clickOptions.map((o) => o.id)).toEqual(['adjacent-1', 'topic-1']);
    expect(chips.clickOptions[1]).toEqual({
      id: 'topic-1',
      label: topicLabel,
      intent: intentOf('economic_climate_seasonally_adjusted', { kind: 'codes', codes: ['2026MM06'] }),
      impliedRecency: false,
      questionShaped: true,
    });
    expect(chips.axes).toEqual(['period', 'measure']);
    expect(validateClickOptions(chips.clickOptions)).toEqual(chips.clickOptions);
  });

  it('the take: one cell of the SIBLING measure under its own attribution and definition label, template, zero tokens — and the audited row reconstructs clean (R8)', async () => {
    const chips = await buildAnswerChips(series, await answered(series), realCheck, ON);
    const pending = carrierFor(question, chips);
    const taken = await take(pending, topicLabel);
    expect(taken.result.intent.target).toEqual({ kind: 'canonical', key: 'economic_climate_seasonally_adjusted' });
    expect(taken.result.shape).toBe('single');
    expect(taken.result.cells.map((c) => c.periodCode)).toEqual(['2026MM06']);
    expect(taken.result.attribution.tableId).toBe('83693NED');
    expect(taken.result.attribution.definitionLabel).toBe(
      'oordeel economisch klimaat (deelindicator consumentenvertrouwen), seizoengecorrigeerd',
    );
    expect(taken.chart).toBeNull();
    const audited = await answerClarificationReplyAudited(db, pending, topicLabel, {
      ...throwingOptions(true),
      sourceTag: 'validation',
    });
    expect(audited.response.kind).toBe('answer');
    expect(audited.auditId).not.toBeNull();
    const record = await loadAuditRecord(db, audited.auditId!);
    if (record === null) throw new Error('audit row missing');
    expect(record.replyText).toBe(topicLabel);
    expect(record.llmCalls).toEqual([]);
    expect(record.answerSource).toBe('template');
    expect(record.resultIds).toHaveLength(1);
    expect(reconstructionReport(record).problems).toEqual([]);
  });
});

describe('(h) zero takeable survivors on the real path: label-only suggestions, and NO pending key at all', () => {
  // A question naming Utrecht (gemeente), Utrecht (provincie) AND the country.
  // The two Utrecht labels collapse to one base name ("Utrecht"), so the
  // drop-never-guess rule words no region and every question-shaped candidate
  // names no place → label-only (the take rule); the answer already holds the
  // national row (no region comparison) and has three places (no period
  // comparison). Two fill-the-input chips survive; nothing is takeable.
  const three = intentOf('population_on_1_january', { kind: 'codes', codes: ['2024JJ00'] }, ['GM0344', 'PV26', 'NL01']);
  const labels = [
    'Wat was bevolking op 1 januari in 2025?',
    'Hoe ontwikkelde bevolking op 1 januari zich van 2020 tot en met 2024?',
  ];

  function intentParse(intent: StructuredIntent): Extract<ParseOutcome, { kind: 'intent' }> {
    return {
      kind: 'intent',
      question: 'stub',
      raw: { version: 3, kind: 'data_query', candidates: [], unmatchedMeasureTerm: null, nearestCanonicalKeys: [], note: null },
      model: 'stub',
      usage: { inputTokens: 0, outputTokens: 0 },
      intent,
      confidence: 0.97,
      impliedRecency: false,
      ranked: [],
    };
  }

  it('respondToIntent — the downstream half both entry points share, where the `pending` key is gated: two labels, no pending', async () => {
    const response = await respondToIntent(db, 'Hoeveel inwoners hadden Utrecht, de provincie Utrecht en Nederland in 2024?', intentParse(three), {
      answerClient: new ThrowingClient(),
      referenceDate: REFERENCE_DATE,
      clickOptionsEnabled: true,
      answerFirstEnabled: true,
    });
    if (response.kind !== 'answer') throw new Error(`expected an answer, got ${response.kind}: ${response.text}`);
    expect(response.result.cells.map((c) => c.regionCode)).toEqual(['GM0344', 'PV26', 'NL01']);
    expect(response.suggestions).toEqual(labels);
    expect(Object.hasOwn(response, 'pending')).toBe(false);
  });

  it('respondToQuestion — the real entry point with a canned parse naming all three places: same', async () => {
    const response = await respondToQuestion(db, 'Hoeveel inwoners hadden Utrecht, de provincie Utrecht en Nederland in 2024?', {
      intentClient: new CannedClient(
        rawDataQuery({
          canonicalKey: 'population_on_1_january',
          regions: [
            { name: 'Utrecht', kind: 'gemeente' },
            { name: 'Utrecht', kind: 'provincie' },
            { name: 'Nederland', kind: 'land' },
          ],
          period: { kind: 'year', year: 2024 },
          derivation: 'none',
          confidence: 0.95,
          reading: 'bevolking van Utrecht (gemeente en provincie) en Nederland in 2024',
        }),
      ),
      answerClient: new ThrowingClient(),
      referenceDate: REFERENCE_DATE,
      clickOptionsEnabled: true,
      answerFirstEnabled: true,
    });
    if (response.kind !== 'answer') throw new Error(`expected an answer, got ${response.kind}: ${response.text}`);
    expect(response.result.cells.map((c) => c.regionCode)).toEqual(['GM0344', 'PV26', 'NL01']);
    expect(response.suggestions).toEqual(labels);
    expect(Object.hasOwn(response, 'pending')).toBe(false);
  });
});

describe('a B-region-defaulted answer mints intents that never lean on the default', () => {
  it('the question named no place: the chips name the country the take carries, every stored intent names NL01 — and the take serves with ANSWER_FIRST off', async () => {
    const response = await respondToQuestion(db, 'Hoeveel inwoners waren er in 2024?', {
      intentClient: new CannedClient(REGIONLESS_2024),
      answerClient: new ThrowingClient(),
      referenceDate: REFERENCE_DATE,
      clickOptionsEnabled: true,
      answerFirstEnabled: true,
    });
    if (response.kind !== 'answer') throw new Error(`expected the national default to answer, got ${response.kind}: ${response.text}`);
    expect(response.result.regionDefaulted).toBe(true);
    // Review round 2: the copy names the place the take carries. The default
    // was disclosed on THIS answer (its assumptionLine); the chip is an
    // explicit national question, worded as when the question named the
    // country — never a place-less label over a place-bound intent.
    expect(response.suggestions[0]).toBe('Wat was bevolking op 1 januari in Nederland in 2025?');
    const pending = response.pending;
    if (!pending?.clickOptions) throw new Error('expected a carrier');
    expect(pending.clickOptions.map((o) => o.id)).toEqual(['adjacent-1', 'trend-1', 'cmp-1']);
    for (const option of pending.clickOptions) expect(option.intent.regions?.[0]).toBe('NL01');
    // The take with the B default rolled back still serves — explicitly national.
    const taken = await take(pending, 'Wat was bevolking op 1 januari in Nederland in 2025?', false);
    expect(taken.result.regionDefaulted ?? false).toBe(false);
    expect(taken.result.cells.map((c) => [c.regionCode, c.periodCode])).toEqual([['NL01', '2025JJ00']]);
  });
});

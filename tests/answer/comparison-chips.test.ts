// #197 step 3 (ADR 029 as-built over ADR 024 mechanism A) — the comparison
// chips: "Vergelijk met Nederland" / "Vergelijk met <de G4>" / "Vergelijk met
// <a year earlier>" under an answer, taken deterministically.
//
// What these prove, in the order the build-plan section asks for:
//  1. GENERATION IS GATED. Every comparison candidate is dry-run through the
//     REAL query layer; principle (c): a table with no national row offers no
//     national comparison (the stub check that refuses NL01 proves the gate is
//     what decides, not a table lookup).
//  2. THE TAKE IS LLM-FREE AND YIELDS A NEW VALIDATED RESULT (R6). Clicking a
//     chip runs the real query with BOTH clients throwing: a comparison shape,
//     one cell per region, a bar chart, template composition, the click model
//     on the parse — never a client-side merge of two answers.
//  3. THE CARRIER IS NOT AN OPEN ROUND. Anything typed that is not a chip is a
//     fresh question, exactly like the WP26c rescue pending; the client-held
//     payload survives the validate-pending trust boundary unchanged.
//  4. FLAG-OFF BYTE-NEUTRALITY. Without CLARIFY_CLICK_ENABLED the answer
//     carries the pre-#197 chip list and NO `pending` key at all.
//  5. THE AUDIT ROW IS REAL. The audited reply path records the label as the
//     reply, zero LLM calls, template source, and reconstructs cleanly (R8).
//
// Hermetic: fixture-ingested PGlite + canned/throwing clients. No API key, no
// network — exactly what CI runs.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../../src/db/types.ts';
import { createIngestedDb } from '../helpers/ingested-db.ts';
import {
  CLICK_TAKE_MODEL,
  buildAnswerChips,
  buildSuggestions,
  respondToClarificationReply,
  respondToQuestion,
  validateClickOptions,
  withValidatedClickOptions,
} from '../../src/answer/respond/index.ts';
import type { PendingClarification } from '../../src/answer/respond/index.ts';
import { isRescuePending } from '../../src/answer/respond/respond.ts';
import type { ServabilityCheck } from '../../src/answer/intent/policy.ts';
import type { LlmClient, LlmResponse } from '../../src/answer/llm/client.ts';
import type { RawParse } from '../../src/answer/intent/types.ts';
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

/** Every numeric token in a chip must be a 4-digit year or the "1 januari"
 * digit — never a cell value (the principle a/c belt the WP29 tests apply). */
function expectNoValueDigits(chips: string[]): void {
  for (const chip of chips) {
    const tokens = chip.match(/\d+(?:[.,]\d+)?/g) ?? [];
    for (const token of tokens) {
      expect(token === '1' || /^\d{4}$/.test(token), `token '${token}' in chip '${chip}'`).toBe(true);
    }
  }
}

describe('buildAnswerChips — the comparison generators against the real fixture db + real dry-run', () => {
  it('sub-national single answer (Amsterdam 2024): the region comparison REPLACES the lone national chip and carries a resolved two-region intent', async () => {
    const intent = intentOf('population_on_1_january', { kind: 'codes', codes: ['2024JJ00'] }, ['GM0363']);
    const chips = await buildAnswerChips(intent, await answered(intent), realCheck, ON);
    expect(chips.suggestions).toEqual([
      'Wat was bevolking op 1 januari in Amsterdam in 2025?',
      'Hoe ontwikkelde bevolking op 1 januari in Amsterdam zich van 2020 tot en met 2024?',
      'Vergelijk met Nederland',
    ]);
    expect(chips.clickOptions).toEqual([
      {
        id: 'cmp-1',
        label: 'Vergelijk met Nederland',
        intent: intentOf('population_on_1_january', { kind: 'codes', codes: ['2024JJ00'] }, ['GM0363', 'NL01']),
        impliedRecency: false,
      },
    ]);
    expect(chips.axes).toEqual(['region']);
    expectNoValueDigits(chips.suggestions);
  });

  it('national answer (Nederland 2026): the comparison is the country plus the G4, one bar each', async () => {
    const intent = intentOf('population_on_1_january', { kind: 'codes', codes: ['2026JJ00'] }, ['NL01']);
    const chips = await buildAnswerChips(intent, await answered(intent), realCheck, ON);
    expect(chips.suggestions[2]).toBe('Vergelijk met Amsterdam, Rotterdam, Den Haag en Utrecht');
    expect(chips.clickOptions).toHaveLength(1);
    expect(chips.clickOptions[0]!.intent.regions).toEqual(['NL01', 'GM0363', 'GM0599', 'GM0518', 'GM0344']);
    expect(chips.clickOptions[0]!.intent.period).toEqual({ kind: 'codes', codes: ['2026JJ00'] });
    expect(chips.clickOptions[0]!.intent.derivation).toBe('none');
    // The lone-G4 question of the region variant is subsumed, not duplicated.
    expect(chips.suggestions.join(' ')).not.toContain('in de gemeentes');
  });

  it('national-only measure (CPI 2024): no region comparison, but the year-earlier comparison as the registered difference derivation', async () => {
    const intent = intentOf('cpi_yearly_inflation', { kind: 'codes', codes: ['2024JJ00'] });
    const chips = await buildAnswerChips(intent, await answered(intent), realCheck, ON);
    expect(chips.suggestions).toEqual([
      'Wat was inflatie (jaarmutatie CPI, alle bestedingen) in 2025?',
      'Hoe ontwikkelde inflatie (jaarmutatie CPI, alle bestedingen) zich van 2020 tot en met 2024?',
      'Vergelijk met 2023',
    ]);
    expect(chips.clickOptions).toEqual([
      {
        id: 'cmp-1',
        label: 'Vergelijk met 2023',
        intent: intentOf('cpi_yearly_inflation', { kind: 'codes', codes: ['2023JJ00', '2024JJ00'] }, undefined, 'difference'),
        impliedRecency: false,
      },
    ]);
    expect(chips.axes).toEqual(['period']);
    expectNoValueDigits(chips.suggestions);
  });

  it('a series answer gets no comparison chip (one varying axis per question — several regions AND several periods is refused)', async () => {
    const intent = intentOf('cpi_yearly_inflation', { kind: 'range', from: '2020JJ00', to: '2024JJ00' }, undefined, 'series');
    const chips = await buildAnswerChips(intent, await answered(intent), realCheck, ON);
    expect(chips.clickOptions).toEqual([]);
    expect(chips.axes).toEqual([]);
    expect(chips.suggestions).toEqual(await buildSuggestions(intent, await answered(intent), realCheck));
  });

  it('flag off: byte-identical to the pre-#197 buildSuggestions list, no click options, no axes', async () => {
    const intent = intentOf('population_on_1_january', { kind: 'codes', codes: ['2024JJ00'] }, ['GM0363']);
    const result = await answered(intent);
    const chips = await buildAnswerChips(intent, result, realCheck, { clickOptions: false });
    expect(chips).toEqual({
      suggestions: await buildSuggestions(intent, result, realCheck),
      clickOptions: [],
      axes: [],
    });
    expect(chips.suggestions).toContain('Wat was bevolking op 1 januari in Nederland in 2024?');
    expect(chips.suggestions.join(' ')).not.toContain('Vergelijk');
  });

  it('every offered option survives the reply-turn trust boundary unchanged (a chip the validator would drop must never be offered)', async () => {
    for (const intent of [
      intentOf('population_on_1_january', { kind: 'codes', codes: ['2024JJ00'] }, ['GM0363']),
      intentOf('population_on_1_january', { kind: 'codes', codes: ['2026JJ00'] }, ['NL01']),
      intentOf('cpi_yearly_inflation', { kind: 'codes', codes: ['2024JJ00'] }),
    ]) {
      const chips = await buildAnswerChips(intent, await answered(intent), realCheck, ON);
      expect(chips.clickOptions.length).toBeGreaterThan(0);
      expect(validateClickOptions(chips.clickOptions)).toEqual(chips.clickOptions);
    }
  });
});

describe('buildAnswerChips — the gates (stub checks)', () => {
  let amsterdamIntent: StructuredIntent;
  let amsterdamResult: ValidatedResult;

  beforeAll(async () => {
    amsterdamIntent = intentOf('population_on_1_january', { kind: 'codes', codes: ['2024JJ00'] }, ['GM0363']);
    amsterdamResult = await answered(amsterdamIntent);
  });

  it('principle (c): when the national row is not servable, NO national comparison is offered — and no lone national chip either; the period comparison still can', async () => {
    const check: ServabilityCheck = async (intent) =>
      (intent.regions ?? []).includes('NL01') ? NOT_SERVABLE : SERVABLE;
    const chips = await buildAnswerChips(amsterdamIntent, amsterdamResult, check, ON);
    expect(chips.suggestions).toEqual([
      'Wat was bevolking op 1 januari in Amsterdam in 2025?',
      'Hoe ontwikkelde bevolking op 1 januari in Amsterdam zich van 2020 tot en met 2024?',
      'Vergelijk met 2023',
    ]);
    expect(chips.clickOptions.map((o) => o.label)).toEqual(['Vergelijk met 2023']);
    expect(chips.axes).toEqual(['period']);
  });

  it('priority: the region comparison sits ahead of the region variant, and the variant is skipped once a comparison surfaced (even with room left)', async () => {
    // Adjacent and trend refused ⇒ room for three more; the lone national
    // question must still not appear beside its side-by-side superset.
    const check: ServabilityCheck = async (intent) =>
      intent.derivation === 'series' || (intent.period.kind === 'codes' && intent.period.codes[0] !== '2024JJ00' && intent.derivation === 'none')
        ? NOT_SERVABLE
        : SERVABLE;
    const chips = await buildAnswerChips(amsterdamIntent, amsterdamResult, check, ON);
    expect(chips.suggestions).toEqual(['Vergelijk met Nederland', 'Vergelijk met 2023']);
    expect(chips.clickOptions.map((o) => o.id)).toEqual(['cmp-1', 'cmp-2']);
    expect(chips.axes).toEqual(['region', 'period']);
  });

  it('an answer that already includes the national row offers no region comparison', async () => {
    const intent = intentOf('population_on_1_january', { kind: 'codes', codes: ['2024JJ00'] }, ['GM0363', 'NL01']);
    const check: ServabilityCheck = async () => SERVABLE;
    // The comparisons start from the RESOLVED intent (result.intent), so the
    // stub result carries the regions under test.
    const chips = await buildAnswerChips(intent, { ...amsterdamResult, intent }, check, ON);
    expect(chips.suggestions.join(' ')).not.toContain('Vergelijk met Nederland');
    // Two regions ⇒ the difference derivation cannot apply either.
    expect(chips.clickOptions).toEqual([]);
  });

  it('a region set that would exceed the validator bound is never offered — the click-time schema gate (isClickTakeableIntent, regions ≤ 8) refuses nine, so no chip and no dry-run', async () => {
    // Since the follow-up on PR #118 there is no hand-copied cap in the
    // generator: this pins the SCHEMA gate itself (an option the validator would
    // drop at click time would silently downgrade the click to the LLM merge).
    const eight = ['GM0363', 'GM0599', 'GM0518', 'GM0344', 'GM0772', 'GM0014', 'GM0268', 'GM0153'];
    const intent = intentOf('population_on_1_january', { kind: 'codes', codes: ['2024JJ00'] }, eight);
    const check: ServabilityCheck = async () => SERVABLE;
    const chips = await buildAnswerChips(intent, { ...amsterdamResult, intent }, check, ON);
    expect(chips.suggestions.join(' ')).not.toContain('Vergelijk met Nederland');
    expect(chips.clickOptions).toEqual([]);
  });

  it('an on-demand-ONBOARDED key offers no comparison chip: the click-time validator would strip it and the label would fall into the paid LLM merge', async () => {
    // Live chat answers onboarded topics with the flag on (extraCanonicalMeasures
    // + clickOptionsEnabled both wired in actions.ts); `onboarded:…` keys are
    // deliberately outside CANONICAL_KEYS (validate-pending.ts's own NOTE).
    const intent = intentOf('onboarded:some_table_measure', { kind: 'codes', codes: ['2024JJ00'] }, ['GM0363']);
    let dryRuns = 0;
    const check: ServabilityCheck = async () => {
      dryRuns += 1;
      return SERVABLE;
    };
    const chips = await buildAnswerChips(intent, { ...amsterdamResult, intent }, check, ON);
    expect(chips.clickOptions).toEqual([]);
    expect(chips.suggestions.join(' ')).not.toContain('Vergelijk');
    expect(Object.hasOwn(chips, 'axes') && chips.axes).toEqual([]);
    // And no dry-run was spent on a candidate that could never be offered.
    const questionOnly = await buildAnswerChips(intent, { ...amsterdamResult, intent }, async () => SERVABLE, { clickOptions: false });
    expect(chips.suggestions).toEqual(questionOnly.suggestions);
    expect(dryRuns).toBe(questionOnly.suggestions.length);
  });

  it('an explicit (non-canonical) target offers no comparison (the trust boundary refuses explicit targets)', async () => {
    const intent: StructuredIntent = {
      schemaVersion: INTENT_SCHEMA_VERSION,
      target: { kind: 'explicit', tableId: '03759ned', measure: 'BevolkingOp1Januari_1', dims: {} } as never,
      regions: ['GM0363'],
      period: { kind: 'codes', codes: ['2024JJ00'] },
      derivation: 'none',
    };
    const check: ServabilityCheck = async () => SERVABLE;
    const chips = await buildAnswerChips(intent, amsterdamResult, check, ON);
    expect(chips.clickOptions).toEqual([]);
  });

  it('WP26 B-region: a region-less question answered NATIONALLY by the default still gets the G4 comparison, built on the RESOLVED intent with every region explicit', async () => {
    const regionless = intentOf('population_on_1_january', { kind: 'codes', codes: ['2024JJ00'] });
    const outcome = await runQuery(db, regionless, { answerFirstEnabled: true });
    if (!outcome.ok) throw new Error('expected the B-region default to serve the national row');
    expect(outcome.regionDefaulted).toBe(true);
    expect(outcome.intent.regions).toEqual(['NL01']);
    const check: ServabilityCheck = (intent) => echoServability(db, intent, { answerFirstEnabled: true });
    const chips = await buildAnswerChips(regionless, outcome, check, ON);
    const labels = chips.clickOptions.map((o) => o.label);
    expect(labels).toContain('Vergelijk met Amsterdam, Rotterdam, Den Haag en Utrecht');
    for (const option of chips.clickOptions) {
      // Explicit regions on EVERY carried intent: a click must not depend on
      // the default still being on at click time.
      expect(option.intent.regions?.length ?? 0).toBeGreaterThan(0);
      expect(option.intent.regions?.[0]).toBe('NL01');
    }
  });

  it('fail-open: a throwing check yields the empty shape — never an exception, never a partial carrier', async () => {
    const check: ServabilityCheck = async () => {
      throw new Error('dry-run exploded');
    };
    const chips = await buildAnswerChips(amsterdamIntent, amsterdamResult, check, ON);
    expect(chips).toEqual({ suggestions: [], clickOptions: [], axes: [] });
  });
});

function askOptions(intentClient: LlmClient, clickOptionsEnabled?: boolean) {
  return {
    intentClient,
    answerClient: new ThrowingClient(),
    referenceDate: REFERENCE_DATE,
    ...(clickOptionsEnabled === undefined ? {} : { clickOptionsEnabled }),
  };
}

async function answerAmsterdam(clickOptionsEnabled?: boolean) {
  const response = await respondToQuestion(
    db,
    'Hoeveel inwoners had Amsterdam in 2024?',
    askOptions(new CannedClient(AMSTERDAM_2024), clickOptionsEnabled),
  );
  if (response.kind !== 'answer') throw new Error(`expected an answer, got ${response.kind}: ${response.text}`);
  return response;
}

describe('the envelope: an answer carries its comparison chips on a chip-carrier pending', () => {
  it('flag on: the pending is rescueOnly, its options are exactly the comparison labels, and it is carrier-shaped', async () => {
    const response = await answerAmsterdam(true);
    expect(response.suggestions).toContain('Vergelijk met Nederland');
    const pending = response.pending;
    expect(pending).toBeDefined();
    if (!pending) throw new Error('unreachable');
    expect(pending.rescueOnly).toBe(true);
    expect(pending.options).toEqual(['Vergelijk met Nederland']);
    expect(pending.axes).toEqual(['region']);
    expect(pending.question).toBe('Hoeveel inwoners had Amsterdam in 2024?');
    expect(pending.referenceDate).toBe(REFERENCE_DATE);
    expect(pending.clickOptions?.map((o) => o.label)).toEqual(pending.options);
    expect(isRescuePending(pending)).toBe(true);
    // The client-held copy comes back through validate-pending.ts unchanged
    // and is STILL carrier-shaped afterwards.
    const validated = withValidatedClickOptions(pending);
    expect(validated).toEqual(pending);
    expect(isRescuePending(validated)).toBe(true);
    // The audited text is byte-untouched by any of this.
    expect(response.text).not.toContain('Vergelijk');
  });

  it('the widened carrier shape still closes forgery: swapped labels, a length mismatch, or a bare flag never read as a carrier', async () => {
    const response = await answerAmsterdam(true);
    const pending = response.pending;
    if (!pending || !pending.clickOptions) throw new Error('expected a carrier pending');
    const second: typeof pending.clickOptions[number] = {
      ...pending.clickOptions[0]!,
      id: 'cmp-2',
      label: 'Vergelijk met 2023',
    };
    const twoChips: PendingClarification = {
      ...pending,
      options: ['Vergelijk met Nederland', 'Vergelijk met 2023'],
      clickOptions: [pending.clickOptions[0]!, second],
    };
    expect(isRescuePending(twoChips)).toBe(true);
    // (a) options[i] must equal clickOptions[i].label — order swapped ⇒ not a carrier.
    expect(isRescuePending({ ...twoChips, options: ['Vergelijk met 2023', 'Vergelijk met Nederland'] })).toBe(false);
    // (b) a length mismatch either way ⇒ not a carrier.
    expect(isRescuePending({ ...twoChips, options: ['Vergelijk met Nederland'] })).toBe(false);
    expect(isRescuePending({ ...pending, options: ['Vergelijk met Nederland', 'Vergelijk met 2023'] })).toBe(false);
    // (c) the bare flag, no chips at all ⇒ not a carrier (the session-57 pin, still holding).
    expect(isRescuePending({ ...pending, clickOptions: undefined, rescueOnly: true })).toBe(false);
    expect(isRescuePending({ ...pending, axes: [] })).toBe(false);
  });

  it('flag off: the pre-#197 chips, and NO pending key at all (byte-neutral envelope)', async () => {
    for (const flag of [undefined, false] as const) {
      const response = await answerAmsterdam(flag);
      expect(Object.hasOwn(response, 'pending')).toBe(false);
      expect(response.suggestions.join(' ')).not.toContain('Vergelijk');
      expect(response.suggestions).toContain('Wat was bevolking op 1 januari in Nederland in 2024?');
    }
  });
});

describe('the take: a clicked comparison is a NEW validated result, without any LLM call (R6)', () => {
  async function carrier(): Promise<PendingClarification> {
    const pending = (await answerAmsterdam(true)).pending;
    if (!pending) throw new Error('expected a carrier pending');
    return pending;
  }

  it('"Vergelijk met Nederland" answers as a two-region comparison from the stored intent — both clients throw', async () => {
    const pending = await carrier();
    const taken = await respondToClarificationReply(db, pending, 'Vergelijk met Nederland', {
      intentClient: new ThrowingClient(),
      answerClient: new ThrowingClient(),
      referenceDate: REFERENCE_DATE,
      clickOptionsEnabled: true,
    });
    expect(taken.kind).toBe('answer');
    if (taken.kind !== 'answer') throw new Error('unreachable');
    // R6: one query, one result, one cell per region — not two answers glued.
    expect(taken.result.shape).toBe('comparison');
    expect(taken.result.intent.regions).toEqual(['GM0363', 'NL01']);
    expect(taken.result.cells.map((c) => c.regionCode)).toEqual(['GM0363', 'NL01']);
    expect(taken.result.cells.every((c) => c.periodCode === '2024JJ00')).toBe(true);
    // R1: every cell traceable; the chart is the builder's bar comparison.
    expect(taken.result.cells.every((c) => c.resultId.length > 0)).toBe(true);
    expect(taken.chart?.kind).toBe('bar');
    expect(taken.chart?.series).toHaveLength(2);
    // ADR 024: template rung, click model, zero tokens.
    expect(taken.answer.source).toBe('template');
    expect(taken.answer.model).toBeNull();
    expect(taken.answer.validation.ok).toBe(true);
    expect(taken.parse.model).toBe(CLICK_TAKE_MODEL);
    expect(taken.parse.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
    // The original question is what the row records (reply-turn convention —
    // the label travels as reply_text; ADR 024 addendum states the rule).
    expect(taken.question).toBe('Hoeveel inwoners had Amsterdam in 2024?');
    expectNoValueDigits(taken.suggestions);
    // Chaining is deliberately closed: a two-region answer already holds the
    // national row (no region comparison) and has two places (no difference)
    // — so the taken answer carries NO new carrier.
    expect(Object.hasOwn(taken, 'pending')).toBe(false);
    expect(taken.suggestions.join(' ')).not.toContain('Vergelijk');
  });

  it('"Vergelijk met 2023" on a national-only measure takes as the difference derivation', async () => {
    const response = await respondToQuestion(
      db,
      'Wat was de inflatie in 2024?',
      askOptions(
        new CannedClient(
          rawDataQuery({
            canonicalKey: 'cpi_yearly_inflation',
            regions: [],
            period: { kind: 'year', year: 2024 },
            derivation: 'none',
            confidence: 0.95,
            reading: 'inflatie in 2024',
          }),
        ),
        true,
      ),
    );
    if (response.kind !== 'answer' || !response.pending) throw new Error('expected an answer with a carrier');
    expect(response.pending.options).toEqual(['Vergelijk met 2023']);
    const taken = await respondToClarificationReply(db, response.pending, 'Vergelijk met 2023', {
      intentClient: new ThrowingClient(),
      answerClient: new ThrowingClient(),
      referenceDate: REFERENCE_DATE,
      clickOptionsEnabled: true,
    });
    expect(taken.kind).toBe('answer');
    if (taken.kind !== 'answer') throw new Error('unreachable');
    expect(taken.result.shape).toBe('derived');
    expect(taken.result.derivations.some((d) => d.kind === 'difference' && d.explicit)).toBe(true);
    expect(taken.result.cells.map((c) => c.periodCode)).toEqual(['2023JJ00', '2024JJ00']);
    // A derived result draws no chart (chart/build.ts charts series and
    // comparisons only) — the answer text carries the difference.
    expect(taken.chart).toBeNull();
    expect(taken.parse.model).toBe(CLICK_TAKE_MODEL);
    expect(taken.answer.source).toBe('template');
    // No chaining from a two-period answer either (one varying axis).
    expect(Object.hasOwn(taken, 'pending')).toBe(false);
  });

  it('anything typed that is not a chip is answered as a FRESH question, never merged with the answered one', async () => {
    const pending = await carrier();
    const next = await respondToClarificationReply(db, pending, 'Hoeveel inwoners had Rotterdam in 2024?', {
      intentClient: new CannedClient(ROTTERDAM_2024),
      answerClient: new ThrowingClient(),
      referenceDate: REFERENCE_DATE,
      clickOptionsEnabled: true,
    });
    expect(next.kind).toBe('answer');
    if (next.kind !== 'answer') throw new Error('unreachable');
    expect(next.result.intent.regions).toEqual(['GM0599']);
    expect(next.question).toBe('Hoeveel inwoners had Rotterdam in 2024?');
  });

  it('after a rollback (flag off) a carrier minted earlier still routes: the chip label becomes a fresh question, not a merge', async () => {
    const pending = await carrier();
    // With the deterministic rung off, the label reaches the parse as a NEW
    // question (here the canned client answers it) — the RUNBOOK's documented
    // post-rollback behaviour for a rescue chip, now shared by comparisons.
    const next = await respondToClarificationReply(db, pending, 'Vergelijk met Nederland', {
      intentClient: new CannedClient(ROTTERDAM_2024),
      answerClient: new ThrowingClient(),
      referenceDate: REFERENCE_DATE,
      clickOptionsEnabled: false,
    });
    expect(next.kind).toBe('answer');
    if (next.kind !== 'answer') throw new Error('unreachable');
    expect(next.question).toBe('Vergelijk met Nederland');
    expect(next.parse.model).not.toBe(CLICK_TAKE_MODEL);
  });

  it('the AUDITED take writes a real row: the label as reply_text, zero LLM calls, template source, clean reconstruction (R8)', async () => {
    const pending = await carrier();
    const audited = await answerClarificationReplyAudited(db, pending, 'Vergelijk met Nederland', {
      intentClient: new ThrowingClient(),
      answerClient: new ThrowingClient(),
      referenceDate: REFERENCE_DATE,
      clickOptionsEnabled: true,
      sourceTag: 'validation',
    });
    expect(audited.response.kind).toBe('answer');
    expect(audited.auditId).not.toBeNull();
    const record = await loadAuditRecord(db, audited.auditId!);
    if (record === null) throw new Error('audit row missing');
    expect(record.kind).toBe('answer');
    expect(record.replyText).toBe('Vergelijk met Nederland');
    expect(record.pendingClarification).toEqual(pending);
    expect(record.question).toBe('Hoeveel inwoners had Amsterdam in 2024?');
    expect(record.llmCalls).toEqual([]);
    expect(record.answerSource).toBe('template');
    expect(record.resultIds).toHaveLength(2);
    expect(reconstructionReport(record).problems).toEqual([]);
  });
});

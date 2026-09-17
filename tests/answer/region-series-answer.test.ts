// ADR 055 Task 4 — the ANSWER side of a multi-region series: one clause per
// region, the structural coverage disclosure, and MS1 as a testable rule.
//
// Everything here runs against REAL results from the hermetic ingest (ADR 009)
// rather than hand-built ones — the per-region coverage record and the
// per-region derivations are exactly the kind of state a synthetic fixture
// gets subtly wrong.
//
// What is proven:
//
//  1. **MS1 in the rendered text.** A region with its OWN direction record
//     gets a clause carrying its own two endpoint values and its own direction
//     word; a region without one (a gap at any requested period) gets NO
//     clause, NO trend word and NO values in the body at all. The rule is
//     never a string filter — the template simply has no record to phrase
//     from (src/query/run.ts), and R9 fails any such claim closed from the
//     other side (the hand-written-body pins at the bottom).
//  2. **No cross-region claim, ever.** No registered derivation ranks change
//     across regions, so this shape carries zero `max` records: a superlative
//     or a "grew faster than" comparison has nothing to bind to and is
//     rejected.
//  3. The coverage sentence lands in `ComposedAnswer.regionSeriesLine` and NOT
//     in `body` — its digits count REQUESTED PERIODS and MISSING CELLS, not
//     CBS cell values, so R1 (whose exemptions are structural, never
//     pattern-based) would rightly reject them inside the scanned body. The
//     tamper pin proves the distinction is real.
//  4. Zero LLM calls for this shape, by SHAPE and not by caller — handing a
//     phrasing model several regions' numbers at once is precisely the
//     cross-attribution surface MS1 forbids.
//
// Test ORDER is load-bearing from "a PARTIAL region" onwards: those blocks
// surgically mutate this suite's own private PGlite (every createIngestedDb
// caller gets its own — tests/helpers/fixture-snapshot.ts), each on
// coordinates the later blocks do not depend on.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runQuery } from '../../src/query/index.ts';
import type { DerivationRecord, StructuredIntent, ValidatedResult } from '../../src/query/index.ts';
import { deriveDirection, deriveFirstLast } from '../../src/query/derivations.ts';
import type { Db } from '../../src/db/types.ts';
import { createIngestedDb } from '../helpers/ingested-db.ts';
import { composeAnswer, renderTemplateBody, validateAnswerBody } from '../../src/answer/compose/index.ts';
import { buildRegionSeriesLine } from '../../src/answer/compose/format.ts';
import { formatValueNl } from '../../src/answer/compose/format.ts';
import { baseRegionLabel } from '../../src/answer/compose/validate.ts';
import type { LlmClient, LlmResponse } from '../../src/answer/llm/client.ts';

let db: Db;
let close: () => Promise<void>;

const POPULATION_MEASURE = 'M000352';
const AMSTERDAM = 'GM0363';
const ROTTERDAM = 'GM0599';
const DEN_HAAG = 'GM0518';
const UTRECHT = 'GM0344';

/** A client that FAILS the test if it is ever called — the proof that this
 * shape costs no phrasing call at all, not merely that it usually falls back. */
class NeverCalledClient implements LlmClient {
  calls = 0;
  async complete(): Promise<LlmResponse> {
    this.calls += 1;
    throw new Error('composeAnswer called the LLM for a region_series result');
  }
}

/** Every ranking/superlative word validate.ts recognises (SUPERLATIVE_WORDS)
 * plus the comparatives a multi-region body must equally avoid — MS1 forbids
 * a cross-region claim of ANY kind, not only the superlative form. */
const CROSS_REGION_WORDS = /\b(meeste|hoogste|grootste|laagste|minste|hoger|lager|meer dan|minder dan|sneller)\b/i;

function population(extra: Partial<StructuredIntent>): StructuredIntent {
  return {
    schemaVersion: 1,
    target: { kind: 'canonical', key: 'population_on_1_january' },
    period: { kind: 'range', from: '2020JJ00', to: '2024JJ00' },
    derivation: 'none',
    ...extra,
  };
}

async function answer(intent: StructuredIntent): Promise<ValidatedResult> {
  const outcome = await runQuery(db, intent);
  if (!outcome.ok) throw new Error(`expected a result, got ${outcome.refusal.kind}: ${outcome.refusal.message}`);
  return outcome;
}

function directionsOf(result: ValidatedResult): Extract<DerivationRecord, { kind: 'direction' }>[] {
  return result.derivations.filter((d): d is Extract<DerivationRecord, { kind: 'direction' }> => d.kind === 'direction');
}

function cellsOf(result: ValidatedResult, regionCode: string) {
  return result.cells.filter((c) => c.regionCode === regionCode);
}

/** Every value of a region, exactly as the template would format it. */
function formattedValues(result: ValidatedResult, regionCode: string): string[] {
  return cellsOf(result, regionCode)
    .filter((c) => c.value !== null)
    .map((c) => formatValueNl(c.value!, c.decimals));
}

beforeAll(async () => {
  ({ db, close } = await createIngestedDb());
}, 300_000);

afterAll(async () => {
  await close();
});

describe('region_series — a COMPLETE series: one clause per region, each bound to its own record', () => {
  it('renders one clause per region, carrying that region\'s own endpoints and its own direction word', async () => {
    const result = await answer(population({ regions: [AMSTERDAM, ROTTERDAM] }));
    expect(result.shape).toBe('region_series');
    expect(result.regionSeries!.complete).toBe(true);
    const directions = directionsOf(result);
    expect(directions).toHaveLength(2);

    const body = renderTemplateBody(result);
    const byId = new Map(result.cells.map((c) => [c.resultId, c]));
    for (const record of directions) {
      const first = byId.get(record.firstResultId)!;
      const last = byId.get(record.lastResultId)!;
      const name = baseRegionLabel(first.regionLabel!);
      const word = { up: 'gestegen', down: 'gedaald', flat: 'gelijk gebleven' }[record.direction];
      // The clause: this region's name, its own two endpoint values with
      // their own period labels, and the direction word its OWN record backs.
      expect(body).toContain(
        `${name} ging van ${formatValueNl(first.value!, first.decimals)} in ${first.periodLabel} ` +
          `naar ${formatValueNl(last.value!, last.decimals)} in ${last.periodLabel} (${word})`,
      );
    }
    // One sentence, two clauses — the clause boundary is what lets the
    // validator bind each direction word to one region alone.
    expect(body.split(';')).toHaveLength(2);
    expect(validateAnswerBody(body, result).problems).toEqual([]);
  });

  it('makes NO cross-region claim of any kind — there is no ranking record to bind one to', async () => {
    const result = await answer(population({ regions: [AMSTERDAM, ROTTERDAM, DEN_HAAG] }));
    expect(result.derivations.some((d) => d.kind === 'max')).toBe(false);
    const body = renderTemplateBody(result);
    expect(body).not.toMatch(CROSS_REGION_WORDS);
    expect(validateAnswerBody(body, result).problems).toEqual([]);
  });

  it('composeAnswer makes ZERO LLM calls for this shape, even when the caller passes no templateOnly', async () => {
    const result = await answer(population({ regions: [AMSTERDAM, ROTTERDAM] }));
    const client = new NeverCalledClient();
    const composed = await composeAnswer(result, { client });
    expect(client.calls).toBe(0);
    expect(composed.source).toBe('template');
    expect(composed.body).toBe(renderTemplateBody(result));
    expect(composed.validation.ok).toBe(true);
  });

  it('a COMPLETE series has nothing to disclose: no line, and no key at all (present-only, docs/13)', async () => {
    const result = await answer(population({ regions: [AMSTERDAM, ROTTERDAM] }));
    expect(buildRegionSeriesLine(result)).toBeNull();
    const composed = await composeAnswer(result, { client: new NeverCalledClient() });
    expect('regionSeriesLine' in composed).toBe(false);
  });

  it('no other shape ever carries the key', async () => {
    const series = await answer(population({ regions: [AMSTERDAM], derivation: 'series' }));
    expect(series.shape).toBe('series');
    expect(buildRegionSeriesLine(series)).toBeNull();
    const composed = await composeAnswer(series, { client: new NeverCalledClient(), templateOnly: true });
    expect('regionSeriesLine' in composed).toBe(false);
  });
});

describe('region_series — a PARTIAL region gets no clause, no trend word, and a structural disclosure', () => {
  it('the partial region is absent from the BODY entirely, while its cells stay in the result (R11)', async () => {
    // No loaded table produces a withheld cell naturally, so seed one:
    // Rotterdam's 2022 population becomes Confidential — a value that EXISTS
    // but is not disclosed, so no honest trend spans that window.
    await db.query(
      `update observations set value = null, value_attribute = 'Confidential'
        where table_id = '03759ned' and measure = $1 and region_code = $2 and period_code = '2022JJ00'`,
      [POPULATION_MEASURE, ROTTERDAM],
    );

    const result = await answer(population({ regions: [AMSTERDAM, ROTTERDAM] }));
    expect(result.regionSeries!.partial).toEqual([ROTTERDAM]);
    expect(directionsOf(result)).toHaveLength(1);

    const body = renderTemplateBody(result);
    // The complete region is phrased in full...
    expect(body).toContain(baseRegionLabel(cellsOf(result, AMSTERDAM)[0]!.regionLabel!));
    // ...the partial one is named nowhere, and NONE of its values appear —
    // not even the endpoints it does have. No clause means no trend word can
    // be attached to it by accident.
    expect(body).not.toContain(baseRegionLabel(cellsOf(result, ROTTERDAM)[0]!.regionLabel!));
    for (const value of formattedValues(result, ROTTERDAM)) {
      expect(body).not.toContain(value);
    }
    // R11: the withheld cells are still in the result (they draw as gaps and
    // name their own CBS reason in the chart) — suppressed CLAIM, not
    // suppressed data.
    expect(cellsOf(result, ROTTERDAM)).toHaveLength(5);
    expect(validateAnswerBody(body, result).problems).toEqual([]);
  });

  it('names the partial region in the coverage line, by its verbatim CBS label, OUTSIDE the scanned body', async () => {
    const result = await answer(population({ regions: [AMSTERDAM, ROTTERDAM] }));
    const line = buildRegionSeriesLine(result)!;
    expect(line).not.toBeNull();
    expect(line).toContain(baseRegionLabel(cellsOf(result, ROTTERDAM)[0]!.regionLabel!));
    expect(line).toMatch(/geen ontwikkeling/i);
    // Its digits are the coverage record's own facts (1 missing of 5 asked).
    expect(line).toMatch(/1 van de 5 gevraagde jaren/);

    const client = new NeverCalledClient();
    const composed = await composeAnswer(result, { client });
    expect(client.calls).toBe(0);
    expect(composed.regionSeriesLine).toBe(line);
    // R1's structural exemption: NOT in the scanned body...
    expect(composed.body).not.toContain(line);
    expect(validateAnswerBody(composed.body, result).problems).toEqual([]);
    // ...but it IS what the user reads, above the attribution line.
    expect(composed.text).toContain(line);
    expect(composed.text.indexOf(line)).toBeLessThan(composed.text.indexOf(composed.attributionLine));
    // The proof that the exemption is structural and not a loophole: paste the
    // SAME disclosure into the body and R1 rejects it.
    expect(validateAnswerBody(`${composed.body} ${line}`, result).ok).toBe(false);
  });
});

describe('region_series — an EXCLUDED region contributes nothing, and is named by its bare CBS code', () => {
  it('is absent from the body and from the cells, and the coverage line says so', async () => {
    await db.query(
      `delete from observations
        where table_id = '03759ned' and measure = $1 and region_code = $2 and period_code = '2023JJ00'`,
      [POPULATION_MEASURE, UTRECHT],
    );

    const result = await answer(population({ regions: [AMSTERDAM, DEN_HAAG, UTRECHT] }));
    expect(result.regionSeries!.excluded).toEqual([UTRECHT]);
    expect(cellsOf(result, UTRECHT)).toHaveLength(0);

    const body = renderTemplateBody(result);
    expect(body).not.toContain(UTRECHT);
    expect(validateAnswerBody(body, result).problems).toEqual([]);

    // An excluded region has no cell, so it carries no verbatim CBS label —
    // it is named by its bare, checkable CBS code (the ADR 054 D6 /
    // open-questions #266 Assumption, extended to this second surface).
    const line = buildRegionSeriesLine(result)!;
    expect(line).toContain(UTRECHT);
    expect(line).toMatch(/onze database/i);
  });
});

describe('region_series — MS1: the claims no body may make, judged by the validator', () => {
  it('a trend word about a PARTIAL region is rejected — it has no record, and may not borrow another region\'s', async () => {
    const result = await answer(population({ regions: [AMSTERDAM, ROTTERDAM] }));
    expect(result.regionSeries!.partial).toEqual([ROTTERDAM]);
    const rotterdam = cellsOf(result, ROTTERDAM);
    const first = rotterdam[0]!;
    const last = rotterdam[rotterdam.length - 1]!;
    const name = baseRegionLabel(first.regionLabel!);
    // Every NUMBER below is a real cell of this very result, so R1 is happy —
    // what must fail is the CLAIM: Rotterdam was deliberately given no
    // direction record, and Amsterdam's may not back a sentence about
    // Rotterdam.
    const tampered =
      `${renderTemplateBody(result)} ${name} ging van ${formatValueNl(first.value!, first.decimals)} in ` +
      `${first.periodLabel} naar ${formatValueNl(last.value!, last.decimals)} in ${last.periodLabel} (gestegen).`;
    const report = validateAnswerBody(tampered, result);
    expect(report.ok).toBe(false);
    expect(report.problems.some((p) => p.startsWith('R9:'))).toBe(true);
  });

  it('a SUPERLATIVE anywhere in the body is rejected — this shape carries no ranking record', async () => {
    const result = await answer(population({ regions: [AMSTERDAM, DEN_HAAG] }));
    const winner = baseRegionLabel(cellsOf(result, AMSTERDAM)[0]!.regionLabel!);
    const tampered = `${renderTemplateBody(result)} ${winner} had de hoogste waarde.`;
    const report = validateAnswerBody(tampered, result);
    expect(report.ok).toBe(false);
    expect(report.problems.some((p) => /overtreffende trap/i.test(p))).toBe(true);
  });

  it('a COMPARATIVE across two region names is rejected — no derivation ranks change across regions', async () => {
    const result = await answer(population({ regions: [AMSTERDAM, DEN_HAAG] }));
    const a = baseRegionLabel(cellsOf(result, AMSTERDAM)[0]!.regionLabel!);
    const b = baseRegionLabel(cellsOf(result, DEN_HAAG)[0]!.regionLabel!);
    const report = validateAnswerBody(`${renderTemplateBody(result)} ${a} groeide meer dan ${b}.`, result);
    expect(report.ok).toBe(false);
    expect(report.problems.some((p) => /R9:/.test(p))).toBe(true);
  });

  it('deriveDirection and deriveFirstLast still REFUSE a multi-region cells array — the guard this design leans on', async () => {
    const result = await answer(population({ regions: [AMSTERDAM, DEN_HAAG] }));
    // The whole cells array spans two regions: exactly the input
    // checkSingleRegion exists to reject, and exactly why run.ts slices.
    const direction = deriveDirection(result.cells);
    const firstLast = deriveFirstLast(result.cells);
    expect(direction.ok).toBe(false);
    expect(firstLast.ok).toBe(false);
    if (direction.ok || firstLast.ok) throw new Error('unreachable');
    expect(direction.reason).toMatch(/different regions/i);
    expect(firstLast.reason).toMatch(/different regions/i);
    // ...and the per-region slice, which run.ts does pass, is accepted.
    expect(deriveDirection(cellsOf(result, AMSTERDAM)).ok).toBe(true);
  });
});

describe('region_series — with NO complete region the body falls back to the claim-free listing', () => {
  it('states the cells and nothing else, passes the validator, and discloses both regions', async () => {
    // Den Haag joins Rotterdam in the partial bucket: now neither region of
    // this pair has a direction record at all.
    await db.query(
      `update observations set value = null, value_attribute = 'Confidential'
        where table_id = '03759ned' and measure = $1 and region_code = $2 and period_code = '2021JJ00'`,
      [POPULATION_MEASURE, DEN_HAAG],
    );

    const result = await answer(population({ regions: [ROTTERDAM, DEN_HAAG] }));
    expect(result.regionSeries!.partial).toEqual([ROTTERDAM, DEN_HAAG]);
    expect(directionsOf(result)).toHaveLength(0);

    const body = renderTemplateBody(result);
    // The fail-closed floor: per-cell lines, each naming its region, period
    // and value — and each withheld cell its own CBS reason (R11).
    expect(body).not.toMatch(/\b(gestegen|gedaald|gelijk gebleven)\b/);
    expect(body).not.toMatch(CROSS_REGION_WORDS);
    expect(body).toContain('geen waarde');
    expect(validateAnswerBody(body, result).problems).toEqual([]);

    const line = buildRegionSeriesLine(result)!;
    for (const code of [ROTTERDAM, DEN_HAAG]) {
      expect(line).toContain(baseRegionLabel(cellsOf(result, code)[0]!.regionLabel!));
    }
  });
});

// #253 Task 6 — the ANSWER side of a region-class question: a deterministic
// body, the structural coverage disclosure, and the dedicated refusal for a
// class ask on a national-only measure.
//
// Four things are proven here, all against REAL results from the hermetic
// ingest (ADR 009) rather than hand-built ones — the coverage record is
// exactly the kind of state a synthetic fixture gets subtly wrong:
//
//  1. RS1 in the rendered text: a COMPLETE class renders a superlative (it has
//     a ranking derivation to bind to) and an INCOMPLETE one renders none —
//     and both pass validateAnswerBody. The rule is never a string filter; the
//     template simply has no record to phrase from (src/query/derivations.ts).
//  2. The coverage sentence lands in ComposedAnswer.regionSetLine and NOT in
//     `body` — so its unavoidable digits (roster counts) are STRUCTURAL under
//     R1, exactly like assumptionLine's disclosure. The tamper pin proves the
//     distinction is real: the same count pasted INTO the body fails.
//  3. Zero LLM calls for this shape. Handing a phrasing model up to 500
//     numbers is both the most expensive and the highest-fabrication-surface
//     option in the design, for a sentence the ranking derivation already
//     determines (spec §Billing).
//  4. A class ask on a national-only measure gets its OWN refusal wording —
//     never max_needs_regions' "name some regions" (which is precisely what a
//     class ask avoids) and never the 'internal' bucket (which pages the
//     owner, src/answer/audit/alerts.ts, for what is an honest scope limit).
//
// Test ORDER is load-bearing from "an incomplete class" onwards: that block
// mutates this suite's own private PGlite (tests/helpers/fixture-snapshot.ts
// gives every createIngestedDb caller its own).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runQuery } from '../../src/query/index.ts';
import type { StructuredIntent, ValidatedResult } from '../../src/query/index.ts';
import type { Db } from '../../src/db/types.ts';
import { createIngestedDb } from '../helpers/ingested-db.ts';
import { composeAnswer, renderTemplateBody, validateAnswerBody } from '../../src/answer/compose/index.ts';
import { buildRegionSetLine } from '../../src/answer/compose/format.ts';
import { baseRegionLabel } from '../../src/answer/compose/validate.ts';
import { buildQueryRefusal } from '../../src/answer/respond/refusals.ts';
import type { LlmClient, LlmResponse } from '../../src/answer/llm/client.ts';

let db: Db;
let close: () => Promise<void>;

const POPULATION_MEASURE = 'M000352';

/** A client that FAILS the test if it is ever called — the proof that this
 * shape costs no phrasing call at all, not merely that it usually falls back. */
class NeverCalledClient implements LlmClient {
  calls = 0;
  async complete(): Promise<LlmResponse> {
    this.calls += 1;
    throw new Error('composeAnswer called the LLM for a region_set result');
  }
}

/** Every ranking/superlative word validate.ts recognises (SUPERLATIVE_WORDS)
 * plus the comparatives an incomplete set must equally avoid. */
const RANKING_WORDS = /\b(meeste|hoogste|grootste|laagste|minste|hoger|lager|meer dan|minder dan)\b/i;

function population(extra: Partial<StructuredIntent>): StructuredIntent {
  return {
    schemaVersion: 1,
    target: { kind: 'canonical', key: 'population_on_1_january' },
    period: { kind: 'codes', codes: ['2025JJ00'] },
    derivation: 'none',
    ...extra,
  };
}

async function answer(intent: StructuredIntent): Promise<ValidatedResult> {
  const outcome = await runQuery(db, intent);
  if (!outcome.ok) throw new Error(`expected a result, got ${outcome.refusal.kind}: ${outcome.refusal.message}`);
  return outcome;
}

beforeAll(async () => {
  ({ db, close } = await createIngestedDb());
}, 300_000);

afterAll(async () => {
  await close();
});

describe('region_set — a complete class: the ranking IS claimed, deterministically', () => {
  it('names the top and bottom region with their own values, and passes the validator', async () => {
    const result = await answer(population({ regionSet: { kind: 'all_provincies' } }));
    expect(result.regionSet!.complete).toBe(true);
    const ranking = result.derivations.find((d) => d.kind === 'max');
    expect(ranking, 'a complete class must carry a ranking derivation (RS1)').toBeDefined();
    if (ranking?.kind !== 'max') throw new Error('unreachable');

    const byId = new Map(result.cells.map((c) => [c.resultId, c]));
    const winner = byId.get(ranking.winnerResultId)!;
    const lowest = byId.get(ranking.rankingResultIds[ranking.rankingResultIds.length - 1]!)!;

    const body = renderTemplateBody(result);
    expect(body).toContain('de hoogste');
    expect(body).toContain('de laagste');
    expect(body).toContain(baseRegionLabel(winner.regionLabel!));
    expect(body).toContain(baseRegionLabel(lowest.regionLabel!));
    // The structural region count, not the roster size — the roster size is
    // not an allowed number in a scanned body (that is what regionSetLine is
    // for), so a body that used it would fail R1.
    expect(body).toContain(`Van de ${result.cells.length} provincies`);
    expect(validateAnswerBody(body, result).problems).toEqual([]);
  });

  it('does not spell out every member: a class answer is a summary, not a 500-line list', async () => {
    const result = await answer(population({ regionSet: { kind: 'all_provincies' } }));
    const body = renderTemplateBody(result);
    const named = result.cells.filter((c) => body.includes(baseRegionLabel(c.regionLabel!)));
    expect(named.length).toBeLessThanOrEqual(3);
  });

  it('CBS-Impossible members do not break completeness, and the body counts the members it SERVED', async () => {
    const result = await answer({
      schemaVersion: 1,
      target: { kind: 'canonical', key: 'average_home_sale_price_by_gemeente' },
      period: { kind: 'codes', codes: ['2024JJ00'] },
      derivation: 'none',
      regionSet: { kind: 'gemeenten_in_provincie', parent: 'PV26' },
    });
    expect(result.regionSet!.complete).toBe(true);
    expect(result.regionSet!.rosterSize).toBe(42);
    const body = renderTemplateBody(result);
    expect(body).toContain(`Van de ${result.cells.length} gemeenten`);
    expect(validateAnswerBody(body, result).problems).toEqual([]);
  });
});

describe('region_set — the coverage disclosure is structural, never part of the scanned body', () => {
  it('composeAnswer assembles regionSetLine beside assumptionLine, outside the body, above the source line', async () => {
    const result = await answer({
      schemaVersion: 1,
      target: { kind: 'canonical', key: 'average_home_sale_price_by_gemeente' },
      period: { kind: 'codes', codes: ['2024JJ00'] },
      derivation: 'none',
      regionSet: { kind: 'gemeenten_in_provincie', parent: 'PV26' },
    });
    const client = new NeverCalledClient();
    const composed = await composeAnswer(result, { client });

    expect(client.calls).toBe(0);
    expect(composed.source).toBe('template');
    expect(composed.regionSetLine).toBe(buildRegionSetLine(result));
    expect(composed.regionSetLine).not.toBeNull();
    // R1's structural exemption: NOT in the scanned body...
    expect(composed.body).not.toContain(composed.regionSetLine!);
    expect(validateAnswerBody(composed.body, result).problems).toEqual([]);
    // ...but it IS what the user reads, above the attribution line.
    expect(composed.text).toContain(composed.regionSetLine!);
    expect(composed.text.indexOf(composed.regionSetLine!)).toBeLessThan(
      composed.text.indexOf(composed.attributionLine),
    );
  });

  it('discloses the roster size and the excluded members — digits a scanned body could never carry', async () => {
    const result = await answer({
      schemaVersion: 1,
      target: { kind: 'canonical', key: 'average_home_sale_price_by_gemeente' },
      period: { kind: 'codes', codes: ['2024JJ00'] },
      derivation: 'none',
      regionSet: { kind: 'gemeenten_in_provincie', parent: 'PV26' },
    });
    const line = buildRegionSetLine(result)!;
    expect(line).toContain('42');
    expect(line).toContain('16');
    // The proof that the exemption is structural and not a loophole: paste the
    // SAME disclosure into the body and R1 rejects it.
    const tampered = `${renderTemplateBody(result)} ${line}`;
    expect(validateAnswerBody(tampered, result).ok).toBe(false);
  });

  it('a result that is not a region set carries no key at all (present-only, docs/13)', async () => {
    const result = await answer(population({ regions: ['GM0363'] }));
    expect(buildRegionSetLine(result)).toBeNull();
    const composed = await composeAnswer(result, { client: new NeverCalledClient(), templateOnly: true });
    expect('regionSetLine' in composed).toBe(false);
  });
});

describe('region_set — an incomplete class is answered WITHOUT any ranking claim (RS1)', () => {
  it('a withheld member removes the ranking derivation, the superlative, and says so', async () => {
    // No loaded table produces a withheld cell naturally: seed one. A
    // Confidential value EXISTS but is not disclosed — it could have been the
    // maximum, which is exactly why no ranking may be claimed.
    await db.query(
      `update observations set value = null, value_attribute = 'Confidential'
        where table_id = '03759ned' and measure = $1 and region_code = 'PV20' and period_code = '2025JJ00'`,
      [POPULATION_MEASURE],
    );

    const result = await answer(population({ regionSet: { kind: 'all_provincies' } }));
    expect(result.regionSet!.complete).toBe(false);
    expect(result.derivations.some((d) => d.kind === 'max')).toBe(false);

    const body = renderTemplateBody(result);
    expect(body).not.toMatch(RANKING_WORDS);
    // R11: the withheld cell keeps its CBS reason in the answer, never a gap.
    expect(body).toContain('geen waarde');
    expect(validateAnswerBody(body, result).problems).toEqual([]);

    const line = buildRegionSetLine(result)!;
    expect(line).toContain('Groningen');
    expect(line).toMatch(/geen rangorde/i);
    // The disclosure itself never uses the words it is suppressing.
    expect(line).not.toMatch(/\b(hoogste|laagste|meeste|minste)\b/i);

    const composed = await composeAnswer(result, { client: new NeverCalledClient() });
    expect(composed.regionSetLine).toBe(line);
    expect(composed.body).not.toMatch(RANKING_WORDS);
  });

  it('a member with no row at all is disclosed as missing, and still no ranking', async () => {
    await db.query(
      `delete from observations
        where table_id = '03759ned' and measure = $1 and region_code = 'PV21' and period_code = '2025JJ00'`,
      [POPULATION_MEASURE],
    );

    const result = await answer(population({ regionSet: { kind: 'all_provincies' } }));
    expect(result.regionSet!.missing).toEqual(['PV21']);
    expect(result.derivations.some((d) => d.kind === 'max')).toBe(false);
    const body = renderTemplateBody(result);
    expect(body).not.toMatch(RANKING_WORDS);
    expect(validateAnswerBody(body, result).problems).toEqual([]);
    expect(buildRegionSetLine(result)).toMatch(/PV21/);
  });
});

describe('region_set — a class ask on a national-only measure', () => {
  it('refuses with its own wording: published nationally only, never "name some regions"', async () => {
    const outcome = await runQuery(db, {
      schemaVersion: 1,
      target: { kind: 'canonical', key: 'unemployment_rate_seasonally_adjusted' },
      period: { kind: 'codes', codes: ['2024KW04'] },
      derivation: 'none',
      regionSet: { kind: 'all_provincies' },
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('unreachable');
    expect(outcome.refusal.kind).toBe('invalid_intent');
    expect(outcome.refusal.subReason).toBe('region_scope_on_national_measure');

    const built = buildQueryRefusal(outcome);
    expect(built.kind).toBe('refusal');
    if (built.kind !== 'refusal') throw new Error('unreachable');
    expect(built.refusal.reason).toBe('region_scope_on_national_measure');
    // NOT the internal bucket: this is an honest scope limit, and an
    // 'internal' refusal pages the owner (src/answer/audit/alerts.ts).
    expect(built.refusal.reason).not.toBe('internal');
    expect(built.refusal.internalNote).toBeNull();
    // NOT max_needs_regions' template, which asks the user to name regions.
    expect(built.refusal.text).not.toMatch(/noem .{0,30}(gemeente|provincie)/i);
    expect(built.refusal.text).not.toMatch(/welke gemeente/i);
    expect(built.refusal.text).toMatch(/landelijk/i);
    // A refusal carries no data value (open-questions #37 policy).
    expect(built.refusal.text).not.toMatch(/\d/);
    expect(built.refusal.text.trim().endsWith('?')).toBe(false);
  });

  it('an over-the-cap region set keeps the generic internal wording — the sub-reason is not a catch-all', async () => {
    await db.query(
      `update observations set value_attribute = 'Confidential'
        where id in (
          select id from observations
           where table_id = '03759ned' and measure = $1 and period_code = '2025JJ00'
             and value is null and value_attribute = 'Impossible' and region_code like 'GM%'
           order by id limit 300)`,
      [POPULATION_MEASURE],
    );
    const outcome = await runQuery(db, population({ regionSet: { kind: 'all_gemeenten' } }));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('unreachable');
    expect(outcome.refusal.kind).toBe('invalid_intent');
    expect(outcome.refusal.subReason).toBeUndefined();
    const built = buildQueryRefusal(outcome);
    if (built.kind !== 'refusal') throw new Error('unreachable');
    expect(built.refusal.reason).toBe('internal');
  });
});

describe('row 13 (session 110, ADR 054 addendum + ADR 055) — several regions AND several periods', () => {
  // ADR 055 re-point: two NAMED regions over a range is no longer a refusal —
  // it is the `region_series` answer (tests/answer/region-series-answer.test.ts
  // owns that side). What still refuses, with the unchanged sub-reason, is
  // everything outside that shape: more named regions than the cap allows
  // (here), and a region CLASS over a range (below). The assertions are the
  // same ones, on the case that still reaches the refusal.
  const OVER_CAP_REGIONS = ['PV20', 'PV21', 'PV22', 'PV23', 'PV24', 'PV25', 'PV26'];

  it('refuses with its own wording, never the internal bucket that pages the owner', async () => {
    const outcome = await runQuery(
      db,
      population({
        regions: OVER_CAP_REGIONS,
        period: { kind: 'range', from: '2020JJ00', to: '2024JJ00' },
      }),
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('unreachable');
    expect(outcome.refusal.kind).toBe('invalid_intent');
    expect(outcome.refusal.subReason).toBe('multi_region_multi_period');

    const built = buildQueryRefusal(outcome);
    expect(built.kind).toBe('refusal');
    if (built.kind !== 'refusal') throw new Error('unreachable');
    expect(built.refusal.reason).toBe('multi_region_multi_period');
    expect(built.refusal.reason).not.toBe('internal');
    expect(built.refusal.internalNote).toBeNull();
    // ADR 055: the wording names what is still out of scope — a whole GROUP of
    // regions, or more regions than one answer can carry...
    expect(built.refusal.text).toMatch(/hele groep regio's/i);
    expect(built.refusal.text).toMatch(/meer regio's dan in één antwoord passen/i);
    // ...and it must NOT go on claiming the shape itself is unsupported, which
    // is what the pre-ADR-055 wording said and is now simply false.
    expect(built.refusal.text).not.toMatch(/nog niet/i);
    expect(built.refusal.text).toMatch(/kan ik voor een paar met name genoemde regio's samen laten zien/i);
    // A refusal carries no data value (open-questions #37 policy).
    expect(built.refusal.text).not.toMatch(/\d/);
    expect(built.refusal.text.trim().endsWith('?')).toBe(false);
  });

  it('a region CLASS ask over several periods hits the SAME sub-reason (regionSet counts as "several regions" too)', async () => {
    const outcome = await runQuery(
      db,
      population({
        regionSet: { kind: 'all_provincies' },
        period: { kind: 'range', from: '2020JJ00', to: '2024JJ00' },
      }),
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('unreachable');
    expect(outcome.refusal.subReason).toBe('multi_region_multi_period');
  });
});

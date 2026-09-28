// Regional statistics part 2 (ADR 061 part 2), Task 2 — verification-first:
// each of the 12 new 70072ned canonical measures (registered by Task 1,
// commit ddc3fd8d) must render deterministically through the SAME code path
// every other measure uses: the ADR 054 region-set shape (Step 1, "welke
// provincie heeft de hoogste …") and the plain single-region template shape
// (Step 2, "wat is X in Amsterdam"). Nothing here is measure-specific code —
// this test exists to PROVE the existing formatter/unit/R11 machinery
// already handles these 12 figures correctly, and to catch it where it
// doesn't (see the `displayValueUnit` fix in
// src/answer/compose/template.ts this task added, and its own comment for
// the gap it closes).
//
// Hermetic: the shared fixture DB (`createIngestedDb()`) already contains
// 70072ned 2024+ ingested by Task 1's registry-seed slice; every intent here
// is the exact ADR 054 shape (`regionSet: { kind: 'all_provincies' }`) other
// region-set tests already use (tests/answer/region-set-answer.test.ts).
//
// Zero LLM calls: both steps use the template path exclusively
// (`templateOnly: true` — the class disclosure and coverage line have no LLM
// phrasing in front of them at all, region-set-answer.test.ts's own
// NeverCalledClient proves that structurally; the single-region path is
// forced onto the template rung the same way clarification click-throughs
// are, ADR 024).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runQuery } from '../../src/query/index.ts';
import type { StructuredIntent, ValidatedResult } from '../../src/query/index.ts';
import type { Db } from '../../src/db/types.ts';
import { createIngestedDb } from '../helpers/ingested-db.ts';
import { composeAnswer, renderTemplateBody, validateAnswerBody } from '../../src/answer/compose/index.ts';
import { displayValueUnit, provisionalSuffix } from '../../src/answer/compose/template.ts';
import { baseRegionLabel } from '../../src/answer/compose/validate.ts';
import { CANONICAL_MEASURES } from '../../src/registry/defaults.ts';
import type { LlmClient, LlmResponse } from '../../src/answer/llm/client.ts';

let db: Db;
let close: () => Promise<void>;

/** Proves the template path never calls the LLM (region_set has no phrasing
 * rung at all; a single-region case is forced onto the template rung with
 * `templateOnly: true`) — an accidental call fails loudly instead of
 * silently passing on a mocked response. */
class ThrowingClient implements LlmClient {
  async complete(): Promise<LlmResponse> {
    throw new Error('composeAnswer called the LLM in a deterministic-only test');
  }
}

/** The Task-1-registered CANONICAL_MEASURES entry for a key, or a loud
 * failure — every key below must exist (this IS the coverage the brief
 * asks for), so a missing one is a real regression, not a skip. */
function measureFor(key: string) {
  const m = CANONICAL_MEASURES.find((c) => c.key === key);
  if (!m) throw new Error(`canonical measure "${key}" not found — Task 1 registration regressed`);
  return m;
}

async function answer(intent: StructuredIntent): Promise<ValidatedResult> {
  const outcome = await runQuery(db, intent);
  if (!outcome.ok) throw new Error(`expected a result for ${JSON.stringify(intent)}, got refusal: ${outcome.refusal.kind} — ${outcome.refusal.message}`);
  return outcome;
}

beforeAll(async () => {
  ({ db, close } = await createIngestedDb());
}, 300_000);

afterAll(async () => {
  await close();
});

/** The 12 keys (ADR 061 part 2 constraints table), each with:
 *  - `regionSetPeriod`: the 2024JJ00 all-provincies case is COMPLETE (12/12
 *    served, no withheld/missing member) for every one of the 12 — measured
 *    directly against the fixture DB while writing this test, so
 *    `business_establishments` needs no 2026JJ00 fallback (2024 is present).
 *  - `single`: one GM0363 (Amsterdam) case, at 2025JJ00 where that period has
 *    a value, else 2024JJ00 — `owner_occupied_homes_share`,
 *    `highly_educated_share` and `population_growth_per_1000` have no
 *    GM0363 2025 figure (matches the brief's "2025 exists for all except
 *    1014800, 2018790, M000101_3").
 *  - `expectedRendered`: the EXACT `displayValueUnit`-formatted value+unit
 *    string this cell must produce — measured against the real fixture cell,
 *    not hand-computed, so a formatter regression fails this test rather
 *    than silently reformatting.
 *  - `provisional`: whether that single-region cell's own CBS status is
 *    provisional (R11) — asserted against the composed text.
 */
const CASES: Array<{
  key: string;
  singlePeriod: string;
  expectedValue: number;
  expectedDecimals: number;
  expectedUnit: string;
  expectedRendered: string;
  provisional: boolean;
}> = [
  {
    key: 'population_density',
    singlePeriod: '2025JJ00',
    expectedValue: 4968,
    expectedDecimals: 0,
    expectedUnit: 'aantal inwoners per km²',
    expectedRendered: '4.968 (aantal inwoners per km²)',
    provisional: false,
  },
  {
    key: 'average_woz_value',
    singlePeriod: '2025JJ00',
    expectedValue: 518,
    expectedDecimals: 0,
    expectedUnit: '1 000 euro',
    expectedRendered: '518 (× 1 000 euro)',
    provisional: true,
  },
  {
    key: 'owner_occupied_homes_share',
    singlePeriod: '2024JJ00',
    expectedValue: 29.9,
    expectedDecimals: 1,
    expectedUnit: '%',
    expectedRendered: '29,9%',
    provisional: true,
  },
  {
    key: 'highly_educated_share',
    singlePeriod: '2024JJ00',
    expectedValue: 49.7,
    expectedDecimals: 1,
    expectedUnit: '%',
    expectedRendered: '49,7%',
    provisional: false,
  },
  {
    key: 'passenger_cars_per_1000_residents',
    singlePeriod: '2025JJ00',
    expectedValue: 287,
    expectedDecimals: 0,
    expectedUnit: 'per 1 000 inwoners',
    expectedRendered: '287 (per 1 000 inwoners)',
    provisional: false,
  },
  {
    key: 'distance_to_train_station',
    singlePeriod: '2025JJ00',
    expectedValue: 2.8,
    expectedDecimals: 1,
    expectedUnit: 'km',
    expectedRendered: '2,8 km',
    provisional: true,
  },
  {
    key: 'population_growth_per_1000',
    singlePeriod: '2024JJ00',
    expectedValue: 3.5,
    expectedDecimals: 1,
    expectedUnit: 'per 1 000 inwoners',
    expectedRendered: '3,5 (per 1 000 inwoners)',
    provisional: false,
  },
  {
    key: 'average_household_size',
    singlePeriod: '2025JJ00',
    expectedValue: 1.78,
    expectedDecimals: 2,
    expectedUnit: 'personen per 1 huishouden',
    expectedRendered: '1,78 (personen per 1 huishouden)',
    provisional: false,
  },
  {
    key: 'single_person_households_share',
    singlePeriod: '2025JJ00',
    expectedValue: 55,
    expectedDecimals: 1,
    expectedUnit: '%',
    expectedRendered: '55,0%',
    provisional: false,
  },
  {
    key: 'business_establishments',
    singlePeriod: '2025JJ00',
    expectedValue: 209480,
    expectedDecimals: 0,
    expectedUnit: 'aantal',
    expectedRendered: '209.480',
    provisional: true,
  },
  {
    key: 'benefit_recipients_total',
    singlePeriod: '2025JJ00',
    expectedValue: 198190,
    expectedDecimals: 0,
    expectedUnit: 'aantal',
    expectedRendered: '198.190',
    provisional: true,
  },
  {
    key: 'distance_to_large_supermarket',
    singlePeriod: '2025JJ00',
    expectedValue: 0.6,
    expectedDecimals: 1,
    expectedUnit: 'km',
    expectedRendered: '0,6 km',
    provisional: true,
  },
];

function regionSetIntent(key: string): StructuredIntent {
  return {
    schemaVersion: 1,
    target: { kind: 'canonical', key },
    regionSet: { kind: 'all_provincies' },
    period: { kind: 'codes', codes: ['2024JJ00'] },
    derivation: 'none',
  };
}

function singleIntent(key: string, periodCode: string): StructuredIntent {
  return {
    schemaVersion: 1,
    target: { kind: 'canonical', key },
    regions: ['GM0363'],
    period: { kind: 'codes', codes: [periodCode] },
    derivation: 'none',
  };
}

describe('Step 1 — all 12 figures render the ADR 054 region-set shape deterministically', () => {
  for (const c of CASES) {
    describe(c.key, () => {
      it('answers with all 12 provinces, the definition line, and passes the validator', async () => {
        const result = await answer(regionSetIntent(c.key));
        expect(result.shape).toBe('region_set');
        expect(result.regionSet?.complete).toBe(true);
        expect(result.regionSet?.rosterSize).toBe(12);
        expect(result.cells).toHaveLength(12);
        expect(new Set(result.cells.map((cell) => cell.regionCode)).size).toBe(12);

        const body = renderTemplateBody(result);
        expect(validateAnswerBody(body, result).problems).toEqual([]);

        const composed = await composeAnswer(result, { client: new ThrowingClient(), templateOnly: true });
        const measure = measureFor(c.key);
        expect(composed.definitionLine).not.toBeNull();
        expect(composed.definitionLine).toContain(measure.definitionLabel);
      });

      it('a complete class either claims the ranking (RS1) or, on a tie, falls back honestly — never a fabricated superlative', async () => {
        const result = await answer(regionSetIntent(c.key));
        const body = renderTemplateBody(result);
        const ranking = result.derivations.find((d) => d.kind === 'max');
        const byId = new Map(result.cells.map((cell) => [cell.resultId, cell]));

        if (ranking?.kind === 'max') {
          const winner = byId.get(ranking.winnerResultId)!;
          const lowest = byId.get(ranking.rankingResultIds[ranking.rankingResultIds.length - 1]!)!;
          expect(body).toContain(baseRegionLabel(winner.regionLabel!));
          expect(body).toContain(baseRegionLabel(lowest.regionLabel!));
          // R11 (fix round 1, strengthened): the value+unit AND its own
          // provisional suffix are checked as ONE contiguous rendering, for
          // winner and lowest SEPARATELY — not just "voorlopig appears
          // somewhere in the body" (which a coincidental match elsewhere
          // could satisfy without actually marking the right cell). Brief's
          // own pinned examples: average_woz_value 2024 is NaderVoorlopig for
          // every province (winner AND lowest both provisional, so this
          // reaches both branches below); population_density 2024 is
          // Definitief for every province (neither provisional).
          const winnerRendered = `${displayValueUnit(winner.value!, winner.decimals, winner.unit)}${provisionalSuffix(winner)}`;
          const lowestRendered = `${displayValueUnit(lowest.value!, lowest.decimals, lowest.unit)}${provisionalSuffix(lowest)}`;
          expect(body).toContain(winnerRendered);
          expect(body).toContain(lowestRendered);
          if (winner.provisional) expect(winnerRendered).toMatch(/voorlopig/i);
          if (lowest.provisional) expect(lowestRendered).toMatch(/voorlopig/i);
          if (winner.provisional || lowest.provisional) {
            expect(body).toMatch(/voorlopig/i);
          } else {
            // Neither cell is provisional: R11 marking must be ABSENT, not
            // merely "not required" — a stray 'voorlopig' here would be a
            // fabricated marking on a Definitief cell.
            expect(body).not.toMatch(/voorlopig/i);
          }
        } else {
          // distance_to_large_supermarket 2024: PV21/PV22 tie at the top
          // (1,4 km both) — deriveMax correctly refuses a shared maximum
          // (src/query/derivations.ts), so RS1 forbids any superlative and
          // the template falls back to the claim-free per-region listing
          // (renderRegionSet's floor: EVERY cell gets its own `cellLine`,
          // not just the first). Checked for ALL 12 listed cells, not only
          // cells[0] (fix round 1: a bug in cell #2..12's rendering would
          // have gone unnoticed otherwise).
          expect(body).not.toMatch(/\b(hoogste|laagste|meeste|minste)\b/i);
          for (const cell of result.cells) {
            const rendered = `${displayValueUnit(cell.value!, cell.decimals, cell.unit)}${provisionalSuffix(cell)}`;
            expect(body).toContain(rendered);
            if (cell.provisional) expect(rendered).toMatch(/voorlopig/i);
          }
          const anyProvisional = result.cells.some((cell) => cell.provisional);
          if (!anyProvisional) expect(body).not.toMatch(/voorlopig/i);
        }
      });
    });
  }

  // Fix round 1: the brief's own two pinned examples, checked directly
  // against every province's own CBS status — not just "some provisional
  // cell somewhere", but the SPECIFIC status the brief names for the WHOLE
  // 2024 class.
  it("pins the brief's examples: average_woz_value 2024 is NaderVoorlopig everywhere (marked); population_density 2024 is Definitief everywhere (not marked)", async () => {
    const woz = await answer(regionSetIntent('average_woz_value'));
    expect(woz.cells).toHaveLength(12);
    for (const cell of woz.cells) {
      expect(cell.status).toBe('NaderVoorlopig');
      expect(cell.provisional).toBe(true);
    }
    const wozBody = renderTemplateBody(woz);
    expect(wozBody).toMatch(/voorlopig/i);

    const density = await answer(regionSetIntent('population_density'));
    expect(density.cells).toHaveLength(12);
    for (const cell of density.cells) {
      expect(cell.status).toBe('Definitief');
      expect(cell.provisional).toBe(false);
    }
    const densityBody = renderTemplateBody(density);
    expect(densityBody).not.toMatch(/voorlopig/i);
  });
});

describe('Step 2 — one Amsterdam (GM0363) case per figure through the template compose path', () => {
  for (const c of CASES) {
    it(`${c.key}: value + unit render exactly, and R11 marks a provisional cell`, async () => {
      const result = await answer(singleIntent(c.key, c.singlePeriod));
      expect(result.cells).toHaveLength(1);
      const cell = result.cells[0]!;
      // Pins the fixture data itself, not just the formatter: a fixture
      // change here should fail this test loudly rather than the assertion
      // below silently comparing two things that both moved.
      expect(cell.value).toBe(c.expectedValue);
      expect(cell.decimals).toBe(c.expectedDecimals);
      expect(cell.unit).toBe(c.expectedUnit);
      expect(cell.provisional).toBe(c.provisional);

      // The exact rendered value+unit string (R3/R10: verbatim CBS unit,
      // deterministic Dutch number formatting).
      expect(displayValueUnit(cell.value!, cell.decimals, cell.unit)).toBe(c.expectedRendered);

      const composed = await composeAnswer(result, { client: new ThrowingClient(), templateOnly: true });
      expect(composed.body).toContain(c.expectedRendered);
      expect(validateAnswerBody(composed.body, result).problems).toEqual([]);
      if (c.provisional) {
        expect(composed.body).toMatch(/voorlopig/i);
      } else {
        expect(composed.body).not.toMatch(/voorlopig/i);
      }

      const measure = measureFor(c.key);
      expect(composed.definitionLine).not.toBeNull();
      expect(composed.definitionLine).toContain(measure.definitionLabel);
    });
  }
});

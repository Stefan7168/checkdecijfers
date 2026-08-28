// WP26 mechanism B, BOTH defaults at once — a geo-table question that names
// neither a place nor a period. This is the branch the flag flip activates and
// the one no test covered (architecture review 2026-07-25, Q1): the region
// default lives in the QUERY layer (src/query/resolve.ts) and the period
// default in the INTENT layer (src/answer/intent/resolve.ts), so the only
// thing making them agree is that the intent layer PREDICTS what the query
// layer will do — it walks the trend window over NATIONAL_REGION_CODE because
// that is the row B-region is about to default to.
//
// A prediction with no test is a coincidence waiting to break. The pins:
//
//  1. FLAG OFF ⇒ unchanged clarification, and — pinned deliberately — the
//     PERIOD axis is the one that speaks, because intent-layer period
//     resolution fails before the query layer ever gets to enumerate axes.
//  2. FLAG ON ⇒ both defaults fire, and the window the intent layer computed
//     actually SERVES at the region the query layer chose. This is the
//     cross-layer agreement pin.
//  3. The two layers agree on WHICH region: every served cell is the national
//     row, and the recorded intent says so (R8).
//  4. The prediction is load-bearing, proven by perturbation: a hole in the
//     NATIONAL series shortens the defaulted window, and a hole in a
//     GEMEENTE's series does not touch it. If the intent layer walked "any
//     region" this test fails.
//  5. One disclosure carries BOTH assumptions, in region-then-period order,
//     still with no number in it.
//  6. R8: the combined line re-derives byte-identically from the stored result.
//
// Hermetic: fixture-ingested PGlite, canned parse, template composition, no LLM.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../../src/db/types.ts';
import { createIngestedDb } from '../helpers/ingested-db.ts';
import { isResolutionFailure, resolveCandidate } from '../../src/answer/intent/resolve.ts';
import type { RawCandidate } from '../../src/answer/intent/types.ts';
import { NATIONAL_REGION_CODE, runQuery } from '../../src/query/index.ts';
import { composeAnswer } from '../../src/answer/compose/index.ts';
import { buildAssumptionLine } from '../../src/answer/compose/format.ts';
import { validateAnswerBody } from '../../src/answer/compose/validate.ts';
import type { LlmClient, LlmResponse } from '../../src/answer/llm/client.ts';

let db: Db;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createIngestedDb());
}, 300_000);

afterAll(async () => {
  await close();
});

const REFERENCE_DATE = '2026-08-15';

/** A geo measure with neither a place nor a period — the double-default shape. */
function bareCandidate(canonicalKey: string): RawCandidate {
  return {
    canonicalKey,
    regions: null,
    period: { kind: 'none' },
    derivation: 'none',
    confidence: 0.95,
    reading: `${canonicalKey}, geen plaats en geen periode genoemd`,
  };
}

class ThrowingClient implements LlmClient {
  async complete(): Promise<LlmResponse> {
    throw new Error('LLM call attempted in a deterministic test');
  }
}

/** Resolve + run + JOIN, with both WP26 switches set the same way.
 *
 * The join is the point. The two flags are set in different layers and neither
 * layer sees the other's: `runQuery` returns `regionDefaulted` (query layer),
 * while `periodDefaulted` is known only to the intent layer and is stitched
 * onto the result by respond.ts:
 *
 *     parse.periodDefaulted === true ? { ...outcome, periodDefaulted: true } : outcome
 *
 * `served` below reproduces that line exactly, because it is the ONLY place the
 * two halves ever meet — and therefore the only place a combined disclosure can
 * be built. A test that read `outcome.periodDefaulted` straight off runQuery
 * would silently see `undefined` and quietly assert half the feature. */
async function resolveAndRun(canonicalKey: string, answerFirstEnabled: boolean) {
  const resolution = await resolveCandidate(db, bareCandidate(canonicalKey), REFERENCE_DATE, {
    answerFirstEnabled,
  });
  if (isResolutionFailure(resolution)) return { resolution, outcome: null, served: null } as const;
  const outcome = await runQuery(db, resolution.intent, { answerFirstEnabled });
  const served =
    outcome.ok && resolution.periodDefaulted === true
      ? { ...outcome, periodDefaulted: true as const }
      : outcome;
  return { resolution, outcome, served } as const;
}

/** The canonical measure's storage coordinates, for the perturbation pins. */
async function coordinatesOf(canonicalKey: string): Promise<{ table_id: string; measure: string }> {
  const probe = await db.query('select table_id, measure from canonical_measures where key = $1', [
    canonicalKey,
  ]);
  const row = probe.rows[0] as { table_id: string; measure: string } | undefined;
  if (row === undefined) throw new Error(`fixture is missing canonical measure ${canonicalKey}`);
  return row;
}

/** Delete the given cells, run `body`, and put them back whatever happens —
 * the isolation contract createIngestedDb() gives every suite means this only
 * ever affects this file's private database, but a leaked deletion would still
 * confuse the rest of it. */
async function withoutRows(
  where: string,
  params: unknown[],
  body: () => Promise<void>,
): Promise<void> {
  const saved = await db.query(`select * from observations where ${where}`, params);
  expect(saved.rows.length).toBeGreaterThan(0);
  await db.query(`delete from observations where ${where}`, params);
  try {
    await body();
  } finally {
    for (const cell of saved.rows as Record<string, unknown>[]) {
      const columns = Object.keys(cell).filter((c) => c !== 'id');
      await db.query(
        `insert into observations (${columns.join(', ')}) values (${columns
          .map((_, i) => `$${i + 1}`)
          .join(', ')})`,
        columns.map((c) => cell[c]),
      );
    }
  }
}

describe('flag off: a question missing BOTH axes still clarifies', () => {
  it('fails at the period axis, and defaults nothing', async () => {
    const { resolution, outcome } = await resolveAndRun('population_on_1_january', false);
    expect(isResolutionFailure(resolution)).toBe(true);
    if (!isResolutionFailure(resolution)) throw new Error('unreachable');
    expect(outcome).toBeNull();
    // Pinned as OBSERVED behaviour, not as a wish: the intent layer resolves the
    // period before the query layer ever enumerates its axes, so a question
    // missing both axes exits on 'period' alone. The query layer's "every
    // unresolved axis in ONE refusal" rule is a guarantee WITHIN that layer, not
    // across the two. Fail-closed either way — the user is asked something
    // answerable — but if this ever becomes a combined region+period ask, this
    // expectation is the thing that should be updated deliberately.
    expect(resolution.reason).toBe('period_missing');
    expect(resolution.axis).toBe('period');
  });
});

describe('flag on: both defaults fire, and the two layers agree', () => {
  it('the intent layer defaults the period and the query layer defaults the region', async () => {
    const { resolution, outcome, served } = await resolveAndRun('population_on_1_january', true);
    if (isResolutionFailure(resolution)) throw new Error('the double default did not resolve');
    expect(resolution.periodDefaulted).toBe(true);
    // The intent leaves the region axis OPEN — the query layer owns that default.
    expect(resolution.intent.regions).toBeUndefined();
    if (outcome === null) throw new Error('unreachable');
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error('the defaulted window did not serve');
    // Each layer sets ONLY its own flag...
    expect(outcome.regionDefaulted).toBe(true);
    expect(Object.hasOwn(outcome, 'periodDefaulted')).toBe(false);
    // ...and only the joined result carries both. If this ever changes — if
    // runQuery starts setting periodDefaulted itself — the disclosure would be
    // built twice from two sources, which is exactly the drift R8 forbids.
    if (served === null || !served.ok) throw new Error('unreachable');
    expect(served.regionDefaulted).toBe(true);
    expect(served.periodDefaulted).toBe(true);
  });

  it('the window the intent layer computed actually SERVES — the cross-layer pin', async () => {
    // The failure this catches: the intent layer walking a window over one set
    // of regions while the query layer serves another. Every period in the
    // window would then have to exist for BOTH, and the completeness check
    // would refuse — a dead end manufactured entirely by two defaults the user
    // never asked for.
    const { resolution, outcome } = await resolveAndRun('population_on_1_january', true);
    if (isResolutionFailure(resolution)) throw new Error('unreachable');
    if (outcome === null || !outcome.ok) throw new Error('the double default refused');
    expect(outcome.shape).toBe('series');
    expect(outcome.cells.length).toBeGreaterThan(1);
    expect(outcome.cells.every((c) => c.value !== null)).toBe(true);
    // R8: the recorded intent shows the query that RAN, on both axes.
    expect(outcome.intent.regions).toEqual([NATIONAL_REGION_CODE]);
    expect(outcome.intent.period.kind).toBe('range');
    expect(outcome.cells.every((c) => c.regionCode === NATIONAL_REGION_CODE)).toBe(true);
    // Every period the intent layer put in the window came back as a cell.
    if (resolution.intent.period.kind !== 'range') throw new Error('unreachable');
    expect(outcome.cells[0]!.periodCode).toBe(resolution.intent.period.from);
    expect(outcome.cells[outcome.cells.length - 1]!.periodCode).toBe(resolution.intent.period.to);
  });

  it('a hole in the NATIONAL series shortens the window — the prediction is load-bearing', async () => {
    const { resolution: before } = await resolveAndRun('population_on_1_january', true);
    if (isResolutionFailure(before)) throw new Error('unreachable');
    if (before.intent.period.kind !== 'range') throw new Error('expected a multi-period window');
    const row = await coordinatesOf('population_on_1_january');
    // Captured OUT of the union before the closure: TypeScript's narrowing of
    // `before.intent.period` does not survive into the callback below.
    const beforeTo = before.intent.period.to;
    const holeYear = Number(beforeTo.slice(0, 4)) - 2;
    await withoutRows(
      'table_id = $1 and measure = $2 and period_code = $3 and region_code = $4',
      [row.table_id, row.measure, `${holeYear}JJ00`, NATIONAL_REGION_CODE],
      async () => {
        const { resolution: after, outcome } = await resolveAndRun('population_on_1_january', true);
        if (isResolutionFailure(after)) throw new Error('the hole caused a refusal, not a shorter window');
        if (after.intent.period.kind !== 'range') throw new Error('unreachable');
        expect(Number(after.intent.period.from.slice(0, 4))).toBe(holeYear + 1);
        expect(after.intent.period.to).toBe(beforeTo);
        // And the shortened window still serves at the defaulted region.
        if (outcome === null) throw new Error('unreachable');
        expect(outcome.ok).toBe(true);
      },
    );
  });

  it('a hole in a GEMEENTE series does NOT touch the defaulted window', async () => {
    // The other half of the same pin. If the intent layer walked the periods
    // available for "any region", deleting Amsterdam's row would shorten a
    // window that is about to be served nationally — a default degraded by data
    // that has nothing to do with it.
    const { resolution: before } = await resolveAndRun('population_on_1_january', true);
    if (isResolutionFailure(before)) throw new Error('unreachable');
    if (before.intent.period.kind !== 'range') throw new Error('unreachable');
    const row = await coordinatesOf('population_on_1_january');
    const { from: beforeFrom, to: beforeTo } = before.intent.period;
    const holeYear = Number(beforeTo.slice(0, 4)) - 2;
    await withoutRows(
      'table_id = $1 and measure = $2 and period_code = $3 and region_code = $4',
      [row.table_id, row.measure, `${holeYear}JJ00`, 'GM0363'],
      async () => {
        const { resolution: after } = await resolveAndRun('population_on_1_january', true);
        if (isResolutionFailure(after)) throw new Error('unreachable');
        if (after.intent.period.kind !== 'range') throw new Error('unreachable');
        expect(after.intent.period.from).toBe(beforeFrom);
        expect(after.intent.period.to).toBe(beforeTo);
      },
    );
  });
});

describe('the combined disclosure', () => {
  it('carries BOTH assumptions, region first, with no number in it', async () => {
    const { served: outcome } = await resolveAndRun('population_on_1_january', true);
    if (outcome === null || !outcome.ok) throw new Error('unreachable');
    const line = buildAssumptionLine(outcome);
    if (line === null) throw new Error('a double-defaulted answer disclosed nothing');
    const regionPart = 'Dit is het landelijke cijfer voor heel Nederland.';
    const periodPart = 'Dit is het verloop over de afgelopen jaren, t/m ';
    expect(line).toContain(regionPart);
    expect(line).toContain(periodPart);
    expect(line.indexOf(regionPart)).toBeLessThan(line.indexOf(periodPart));
    expect(line).toContain('Vraag gerust naar alleen het laatste cijfer of naar een andere periode.');
    // The window's end is named from the CELLS, so the sentence can only ever
    // describe data that is really in the answer.
    expect(line).toContain(`t/m ${outcome.cells[outcome.cells.length - 1]!.periodLabel}`);
    // A disclosure names assumptions, never values. Assert on the PRODUCED
    // line, not on the literal above — checking the constant would be a
    // tautology that passes whatever the builder does (caught reviewing this
    // file). The period half legitimately contains a year in its label, so the
    // pin is the region half: everything up to where the period sentence
    // starts, which includes the "Noem een gemeente of provincie…" tail that
    // buildAssumptionLine also emits and that nothing else here inspects.
    expect(line.slice(0, line.indexOf(periodPart))).not.toMatch(/\d/);
  });

  it('rides outside the validated body and re-derives byte-identically (R8)', async () => {
    const { served: outcome } = await resolveAndRun('population_on_1_january', true);
    if (outcome === null || !outcome.ok) throw new Error('unreachable');
    const answer = await composeAnswer(outcome, {
      client: new ThrowingClient(),
      templateOnly: true,
    });
    expect(answer.assumptionLine).toBe(buildAssumptionLine(outcome));
    expect(answer.body).not.toContain('landelijke cijfer voor heel Nederland');
    expect(validateAnswerBody(answer.body, outcome).ok).toBe(true);
    // Exactly what audit/reconstruct.ts recomputes from the row alone.
    const rederived = [
      answer.body,
      '',
      ...(answer.assumptionLine ? [answer.assumptionLine] : []),
      ...(answer.definitionLine ? [answer.definitionLine] : []),
      // #39: the alternate-reading disclosure sits between definition and
      // marking — same order as compose.ts/reconstruct.ts.
      ...(answer.alternatesLine ? [answer.alternatesLine] : []),
      ...(answer.markingLine ? [answer.markingLine] : []),
      answer.attributionLine,
    ].join('\n');
    expect(answer.text).toBe(rederived);
  });
});

describe('the no-default pins still hold when BOTH axes are open', () => {
  it('a geo measure without a national row clarifies instead of inventing one', async () => {
    // The region default is gated on the NL row EXISTING. With the period axis
    // also open, the intent layer walks its window over that same (absent) row
    // first — so this must still end in a clarification, never in a national
    // figure assembled out of some other region's cells.
    const row = await coordinatesOf('average_home_sale_price_by_gemeente');
    await withoutRows(
      'table_id = $1 and measure = $2 and region_code = $3',
      [row.table_id, row.measure, NATIONAL_REGION_CODE],
      async () => {
        const { resolution, outcome } = await resolveAndRun(
          'average_home_sale_price_by_gemeente',
          true,
        );
        if (isResolutionFailure(resolution)) {
          // The intent layer got there first: no national window to walk.
          expect(resolution.axis).toBe('period');
          return;
        }
        if (outcome === null) throw new Error('unreachable');
        expect(outcome.ok).toBe(false);
        if (outcome.ok) throw new Error('a national figure was served without a national row');
        expect(outcome.refusal.kind).toBe('needs_clarification');
        expect(outcome.refusal.axes).toContain('region');
      },
    );
  });

  it('a national-only measure defaults the period only', async () => {
    const { resolution, served } = await resolveAndRun('cpi_yearly_inflation', true);
    if (isResolutionFailure(resolution)) throw new Error('unreachable');
    if (served === null || !served.ok) throw new Error('unreachable');
    expect(served.periodDefaulted).toBe(true);
    // No geo dimension ⇒ nothing to default ⇒ no key at all (byte-neutrality).
    expect(Object.hasOwn(served, 'regionDefaulted')).toBe(false);
    const line = buildAssumptionLine(served);
    expect(line).not.toContain('landelijke cijfer voor heel Nederland');
  });
});

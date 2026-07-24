// WP26 mechanism B-period (ADR 024, safelist entry 2) — a question with NO
// period signal gets the recent TREND (the owner's session-23 upgrade over
// "freshest single value"), disclosed and correctable, instead of a
// clarification round the user pays for.
//
// The riskiest of the three defaults, so the pins are about what it must NOT
// do as much as what it does:
//
//  1. FLAG OFF ⇒ today's period_missing clarification, unchanged.
//  2. FLAG ON ⇒ a bounded window ending at the freshest published period, at
//     the COARSEST published grain, resolved to a real range.
//  3. GAP-FREE BY CONSTRUCTION. The window is built by walking backwards while
//     each step is actually present — never by computing a span and hoping the
//     completeness check agrees. A hole in our data must SHORTEN the window,
//     never turn an answerable question into a refusal the user never asked
//     for. This is the pin that separates this design from the naive one.
//  4. DEGRADES to a single value when only one period is loaded.
//  5. Present tense ('latest') is untouched — it is the majority path.
//  6. The disclosure names the window's real end (from the served cells), and
//     carries no claim beyond it.
//
// Hermetic: fixture-ingested PGlite, canned parse, no LLM.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../../src/db/types.ts';
import { createIngestedDb } from '../helpers/ingested-db.ts';
import { resolveCandidate, isResolutionFailure } from '../../src/answer/intent/resolve.ts';
import type { RawCandidate } from '../../src/answer/intent/types.ts';
import { runQuery } from '../../src/query/index.ts';
import { buildAssumptionLine } from '../../src/answer/compose/format.ts';

let db: Db;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createIngestedDb());
}, 300_000);

afterAll(async () => {
  await close();
});

const REFERENCE_DATE = '2026-08-15';

function periodlessCandidate(canonicalKey: string, regions: RawCandidate['regions'] = null): RawCandidate {
  return {
    canonicalKey,
    regions,
    period: { kind: 'none' },
    derivation: 'none',
    confidence: 0.95,
    reading: `${canonicalKey}, geen periode genoemd`,
  };
}

async function resolve(candidate: RawCandidate, answerFirstEnabled: boolean) {
  return resolveCandidate(db, candidate, REFERENCE_DATE, { answerFirstEnabled });
}

describe('flag off: a period-less question still clarifies', () => {
  it('fails with period_missing, exactly as before WP26', async () => {
    const resolution = await resolve(periodlessCandidate('cpi_yearly_inflation'), false);
    expect(isResolutionFailure(resolution)).toBe(true);
    if (!isResolutionFailure(resolution)) throw new Error('unreachable');
    expect(resolution.reason).toBe('period_missing');
    expect(resolution.axis).toBe('period');
  });
});

describe('flag on: the recent trend answers', () => {
  it('resolves to a bounded range ending at the freshest published period', async () => {
    const resolution = await resolve(periodlessCandidate('cpi_yearly_inflation'), true);
    expect(isResolutionFailure(resolution)).toBe(false);
    if (isResolutionFailure(resolution)) throw new Error('unreachable');
    expect(resolution.periodDefaulted).toBe(true);
    expect(resolution.intent.period.kind).toBe('range');
    if (resolution.intent.period.kind !== 'range') throw new Error('unreachable');
    // Coarsest published grain (yearly here), and a bounded window.
    expect(resolution.intent.period.from).toMatch(/^\d{4}JJ00$/);
    expect(resolution.intent.period.to).toMatch(/^\d{4}JJ00$/);
    const span =
      Number(resolution.intent.period.to.slice(0, 4)) -
      Number(resolution.intent.period.from.slice(0, 4));
    expect(span).toBeGreaterThan(0);
    expect(span).toBeLessThanOrEqual(9); // ~10 years INCLUSIVE of both ends
    // A defaulted window IS a series: without this the multi-period selection
    // would keep the model's 'none' hint and lose the direction derivation
    // that honest trend prose binds to (R9).
    expect(resolution.intent.derivation).toBe('series');
    // A window ending at the freshest period implies currency, so a stale
    // table must refuse rather than warn-and-serve.
    expect(resolution.impliedRecency).toBe(true);
  });

  it('the whole window actually SERVES — every period in it is a real cell', async () => {
    const resolution = await resolve(periodlessCandidate('cpi_yearly_inflation'), true);
    if (isResolutionFailure(resolution)) throw new Error('unreachable');
    const outcome = await runQuery(db, resolution.intent, { answerFirstEnabled: true });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error('the defaulted window did not serve');
    expect(outcome.shape).toBe('series');
    expect(outcome.cells.length).toBeGreaterThan(1);
    expect(outcome.cells.every((c) => c.value !== null)).toBe(true);
  });

  it('discloses the window with its REAL end, taken from the served cells', async () => {
    const resolution = await resolve(periodlessCandidate('cpi_yearly_inflation'), true);
    if (isResolutionFailure(resolution)) throw new Error('unreachable');
    const outcome = await runQuery(db, resolution.intent, { answerFirstEnabled: true });
    if (!outcome.ok) throw new Error('unreachable');
    const line = buildAssumptionLine({ ...outcome, periodDefaulted: true });
    const lastLabel = outcome.cells[outcome.cells.length - 1]!.periodLabel;
    expect(line).toContain(`t/m ${lastLabel}`);
    expect(line).toContain('Vraag gerust naar alleen het laatste cijfer of naar een andere periode.');
  });
});

describe('the honesty pins', () => {
  it('a HOLE in the data shortens the window instead of causing a refusal', async () => {
    // The pin that separates this from the naive design. A computed 10-year
    // span across an interior gap would be refused by the completeness check —
    // turning a question the user COULD have had answered into a dead end,
    // through a default they never asked for. The walk must stop at the hole.
    const before = await resolve(periodlessCandidate('cpi_yearly_inflation'), true);
    if (isResolutionFailure(before)) throw new Error('unreachable');
    if (before.intent.period.kind !== 'range') throw new Error('unreachable');
    const latestYear = Number(before.intent.period.to.slice(0, 4));
    // Punch a hole two years below the newest period.
    const holeYear = latestYear - 2;
    const probe = await db.query(
      `select table_id, measure, dims from canonical_measures where key = $1`,
      ['cpi_yearly_inflation'],
    );
    const row = probe.rows[0] as { table_id: string; measure: string };
    const saved = await db.query(
      `select * from observations where table_id = $1 and measure = $2 and period_code = $3`,
      [row.table_id, row.measure, `${holeYear}JJ00`],
    );
    expect(saved.rows.length).toBeGreaterThan(0);
    await db.query(
      `delete from observations where table_id = $1 and measure = $2 and period_code = $3`,
      [row.table_id, row.measure, `${holeYear}JJ00`],
    );
    try {
      const after = await resolve(periodlessCandidate('cpi_yearly_inflation'), true);
      if (isResolutionFailure(after)) throw new Error('the hole caused a refusal instead of a shorter window');
      if (after.intent.period.kind !== 'range') throw new Error('unreachable');
      // The window now starts AFTER the hole, and still ends at the newest.
      expect(Number(after.intent.period.from.slice(0, 4))).toBe(holeYear + 1);
      expect(after.intent.period.to).toBe(before.intent.period.to);
      // And it genuinely serves.
      const outcome = await runQuery(db, after.intent, { answerFirstEnabled: true });
      expect(outcome.ok).toBe(true);
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
  });

  it('degrades to a single value when only one period survives the walk', async () => {
    // Same mechanism, hole placed directly under the newest period: the walk
    // yields one period, which must become a single-code intent (not a
    // degenerate range) — the safelist's own degradation rule.
    const before = await resolve(periodlessCandidate('cpi_yearly_inflation'), true);
    if (isResolutionFailure(before)) throw new Error('unreachable');
    if (before.intent.period.kind !== 'range') throw new Error('unreachable');
    const latestYear = Number(before.intent.period.to.slice(0, 4));
    const probe = await db.query(
      `select table_id, measure from canonical_measures where key = $1`,
      ['cpi_yearly_inflation'],
    );
    const row = probe.rows[0] as { table_id: string; measure: string };
    const saved = await db.query(
      `select * from observations where table_id = $1 and measure = $2 and period_code = $3`,
      [row.table_id, row.measure, `${latestYear - 1}JJ00`],
    );
    await db.query(
      `delete from observations where table_id = $1 and measure = $2 and period_code = $3`,
      [row.table_id, row.measure, `${latestYear - 1}JJ00`],
    );
    try {
      const after = await resolve(periodlessCandidate('cpi_yearly_inflation'), true);
      if (isResolutionFailure(after)) throw new Error('unreachable');
      expect(after.intent.period).toEqual({ kind: 'codes', codes: [`${latestYear}JJ00`] });
      // A single period is not a series — the derivation forcing must not fire.
      expect(after.intent.derivation).toBe('none');
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
  });

  it('the window is computed for the region it will be SERVED for', async () => {
    // Review finding (session 56): computing the run across all regions and
    // serving it for one would include a period the served region lacks, and
    // the completeness check would refuse — a dead end manufactured by a
    // default nobody asked for. Deleting a period for ONE gemeente must shorten
    // that gemeente's window, and leave another gemeente's untouched.
    const probe = await db.query(
      `select table_id, measure from canonical_measures where key = $1`,
      ['population_on_1_january'],
    );
    const row = probe.rows[0] as { table_id: string; measure: string };
    const amsterdam = periodlessCandidate('population_on_1_january', [
      { name: 'Amsterdam', kind: 'gemeente' },
    ]);
    const utrecht = periodlessCandidate('population_on_1_january', [
      { name: 'Utrecht', kind: 'gemeente' },
    ]);
    const before = await resolve(amsterdam, true);
    if (isResolutionFailure(before)) throw new Error('unreachable');
    if (before.intent.period.kind !== 'range') throw new Error('expected a multi-period window');
    const holeYear = Number(before.intent.period.to.slice(0, 4)) - 2;
    const saved = await db.query(
      `select * from observations where table_id = $1 and measure = $2 and period_code = $3 and region_code = $4`,
      [row.table_id, row.measure, `${holeYear}JJ00`, 'GM0363'],
    );
    expect(saved.rows.length).toBeGreaterThan(0);
    await db.query(
      `delete from observations where table_id = $1 and measure = $2 and period_code = $3 and region_code = $4`,
      [row.table_id, row.measure, `${holeYear}JJ00`, 'GM0363'],
    );
    try {
      const afterAmsterdam = await resolve(amsterdam, true);
      if (isResolutionFailure(afterAmsterdam)) throw new Error('unreachable');
      if (afterAmsterdam.intent.period.kind !== 'range') throw new Error('unreachable');
      expect(Number(afterAmsterdam.intent.period.from.slice(0, 4))).toBe(holeYear + 1);
      // And it serves — the whole point.
      const served = await runQuery(db, afterAmsterdam.intent, { answerFirstEnabled: true });
      expect(served.ok).toBe(true);
      // Another gemeente still has the full window: the hole was region-local.
      const afterUtrecht = await resolve(utrecht, true);
      if (isResolutionFailure(afterUtrecht)) throw new Error('unreachable');
      if (afterUtrecht.intent.period.kind !== 'range') throw new Error('unreachable');
      expect(Number(afterUtrecht.intent.period.from.slice(0, 4))).toBeLessThan(holeYear);
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
  });

  it('present tense is untouched — "latest" still serves the single freshest value', async () => {
    const latest: RawCandidate = { ...periodlessCandidate('cpi_yearly_inflation'), period: { kind: 'latest' } };
    for (const answerFirstEnabled of [false, true]) {
      const resolution = await resolve(latest, answerFirstEnabled);
      if (isResolutionFailure(resolution)) throw new Error('unreachable');
      expect(resolution.intent.period.kind).toBe('codes');
      expect(resolution.periodDefaulted).toBeUndefined();
    }
  });

  it('no disclosure is built when nothing was defaulted', async () => {
    const resolution = await resolve(
      { ...periodlessCandidate('cpi_yearly_inflation'), period: { kind: 'year', year: 2024 } },
      true,
    );
    if (isResolutionFailure(resolution)) throw new Error('unreachable');
    const outcome = await runQuery(db, resolution.intent, { answerFirstEnabled: true });
    if (!outcome.ok) throw new Error('unreachable');
    expect(buildAssumptionLine(outcome)).toBeNull();
  });
});

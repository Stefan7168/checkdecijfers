// WP5 done-criterion (docs/08-build-plan.md): benchmark tasks B1-B14 scored
// against the frozen answer key using HAND-AUTHORED structured intents — the
// exact objects the WP6 intent parser will have to produce — over the
// deterministic query layer, hermetically (PGlite + committed fixtures,
// ADR 009; never against Supabase). B20's freshness reference is exercised as
// a typed freshness refusal.
//
// Honesty rule: every expected value in this file is READ FROM
// benchmark/answer-key.json. Nothing numeric is hardcoded here — the key is
// the single ground truth (docs/02-user-scenarios.md, Scoring), and keys are
// never edited to green.
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runQuery } from '../../src/query/index.ts';
import type { QueryOutcome, StructuredIntent, ValidatedResult } from '../../src/query/index.ts';
import { DERIVED_DATA_MARKING } from '../../src/query/index.ts';
import { CANONICAL_MEASURES } from '../../src/registry/defaults.ts';
import type { Db } from '../../src/db/types.ts';
import { createIngestedDb } from '../helpers/ingested-db.ts';
import { ANSWERABLE_TASKS } from '../helpers/benchmark-intents.ts';

const answerKey = JSON.parse(
  readFileSync(new URL('../../benchmark/answer-key.json', import.meta.url), 'utf8'),
) as {
  pinnedTo: { tables: Record<string, { title: string }> };
  tasks: Record<string, any>;
};

// The hand-authored intents — one per answerable benchmark task, written from
// the docs/02 task phrasings. Since WP6 they live in the shared helper
// (tests/helpers/benchmark-intents.ts) so the parser tests target literally
// the same objects this suite proves against the frozen answer key.
const INTENTS: Record<string, StructuredIntent> = Object.fromEntries(
  Object.entries(ANSWERABLE_TASKS).map(([taskId, task]) => [taskId, task.intent]),
);

let db: Db;
let close: () => Promise<void>;
const outcomes: Record<string, QueryOutcome> = {};

beforeAll(async () => {
  ({ db, close } = await createIngestedDb());
  for (const [taskId, intent] of Object.entries(INTENTS)) {
    outcomes[taskId] = await runQuery(db, intent);
  }
}, 300_000);

afterAll(async () => {
  await close();
});

function asResult(taskId: string): ValidatedResult {
  const outcome = outcomes[taskId]!;
  if (!outcome.ok) {
    throw new Error(`${taskId} refused (${outcome.refusal.kind}): ${outcome.refusal.message}`);
  }
  return outcome;
}

/** Shared per-task checks mirroring the docs/02 scoring criteria that live at
 * the query layer: attribution (R4), traceability (R1), unit metadata (R10). */
function checkBaseline(taskId: string, result: ValidatedResult): void {
  const key = answerKey.tasks[taskId]!;
  expect(result.attribution.tableId).toBe(key.table);
  expect(result.attribution.tableTitle).toBe(answerKey.pinnedTo.tables[key.table]!.title);
  expect(result.attribution.tableVersion).toBeGreaterThanOrEqual(1);
  expect(result.attribution.syncedAt).toBeTruthy();
  expect(result.attribution.license).toBe('CC BY 4.0');
  // R1: unique, non-empty result ids; every derivation source is a real cell.
  const ids = result.cells.map((c) => c.resultId);
  expect(new Set(ids).size).toBe(ids.length);
  for (const d of result.derivations) {
    for (const src of d.sourceResultIds) expect(ids).toContain(src);
  }
  // R10: one unit across the result, from the key.
  const expectedUnit = key.unit ?? key.cells?.[0]?.unit;
  for (const cell of result.cells) expect(cell.unit).toBe(expectedUnit);
}

describe('benchmark B1-B14 against the frozen answer key (hand-authored intents)', () => {
  const singleTasks = ['B1', 'B2', 'B3', 'B5', 'B6', 'B7', 'B9', 'B11', 'B12'] as const;
  for (const taskId of singleTasks) {
    it(`${taskId}: single value matches the key exactly`, () => {
      const key = answerKey.tasks[taskId]!;
      const result = asResult(taskId);
      checkBaseline(taskId, result);
      expect(result.shape).toBe('single');
      expect(result.cells).toHaveLength(1);
      const cell = result.cells[0]!;
      expect(cell.value).toBe(key.value);
      expect(cell.unit).toBe(key.unit);
      expect(cell.decimals).toBe(key.decimals);
      expect(cell.status).toBe(key.status);
      expect(cell.valueAttribute).toBe(key.valueAttribute);
      expect(cell.periodCode).toBe(key.period);
      expect(cell.regionCode).toBe(key.region?.code ?? null);
      expect(cell.regionLabel).toBe(key.region?.label ?? null);
      expect(cell.dims).toEqual(key.dims);
      expect(cell.measure).toBe(key.measure);
      expect(cell.measureTitle).toBe(key.measureTitle);
      // R11: provisional marking driven by the key's recorded status.
      expect(cell.provisional).toBe(key.status !== 'Definitief');
      expect(result.attribution.coveredPeriods).toEqual({ from: key.period, to: key.period });
    });
  }

  it('B5: the canonical default is chosen AND stated transparently (R7 policy)', () => {
    const key = answerKey.tasks.B5!;
    const result = asResult('B5');
    const cell = result.cells[0]!;
    expect(cell.dims['SeizoenEnWerkdagcorrectie']).toBe(key.canonicalDefault.chosen.code);
    expect(cell.dimLabels['SeizoenEnWerkdagcorrectie']).toBe(key.canonicalDefault.chosen.label);
    const cm = CANONICAL_MEASURES.find((c) => c.key === 'unemployment_rate_seasonally_adjusted')!;
    expect(result.attribution.definitionLabel).toBe(cm.definitionLabel);
  });

  it('B11: NaderVoorlopig cell carries the R11 provisional marking', () => {
    const result = asResult('B11');
    expect(result.cells[0]!.status).toBe(answerKey.tasks.B11!.status);
    expect(result.cells[0]!.provisional).toBe(true);
  });

  it('B1: period semantics state the 1-januari stand convention (registry, R9 context)', () => {
    const result = asResult('B1');
    expect(result.attribution.periodSemantics).toMatch(/1 januari/);
  });

  for (const taskId of ['B4', 'B8'] as const) {
    it(`${taskId}: series matches every key point and pre-registers direction + first/last (R9)`, () => {
      const key = answerKey.tasks[taskId]!;
      const result = asResult(taskId);
      checkBaseline(taskId, result);
      expect(result.shape).toBe('series');
      expect(result.cells).toHaveLength(key.points.length);
      key.points.forEach((point: any, i: number) => {
        const cell = result.cells[i]!;
        expect(cell.periodCode).toBe(point.period);
        expect(cell.value).toBe(point.value);
        expect(cell.status).toBe(point.status);
        expect(cell.valueAttribute).toBe(point.valueAttribute);
        expect(cell.unit).toBe(key.unit);
        expect(cell.decimals).toBe(key.decimals);
      });
      expect(result.attribution.coveredPeriods).toEqual({
        from: key.points[0].period,
        to: key.points[key.points.length - 1].period,
      });

      const direction = result.derivations.find((d) => d.kind === 'direction');
      const firstLast = result.derivations.find((d) => d.kind === 'first_last');
      expect(direction).toBeDefined();
      expect(firstLast).toBeDefined();
      if (direction?.kind !== 'direction' || firstLast?.kind !== 'first_last') throw new Error('unreachable');
      const first = key.points[0].value;
      const last = key.points[key.points.length - 1].value;
      expect(direction.netChange).toBeCloseTo(last - first, 10);
      expect(direction.direction).toBe(last > first ? 'up' : last < first ? 'down' : 'flat');
      // Both benchmark series rose AND fell — a straight-trend claim would be
      // dishonest, and the derivation must say so.
      const values = key.points.map((p: any) => p.value);
      const rises = values.some((v: number, i: number) => i > 0 && v > values[i - 1]);
      const falls = values.some((v: number, i: number) => i > 0 && v < values[i - 1]);
      expect(direction.monotonic).toBe(!(rises && falls));
      expect(direction.explicit).toBe(false);
      expect(firstLast.firstResultId).toBe(result.cells[0]!.resultId);
      expect(firstLast.lastResultId).toBe(result.cells[result.cells.length - 1]!.resultId);
    });
  }

  it('B10: comparison returns both key cells and a ranking that backs the direction (R9)', () => {
    const key = answerKey.tasks.B10!;
    const result = asResult('B10');
    checkBaseline('B10', result);
    expect(result.shape).toBe('comparison');
    expect(result.cells).toHaveLength(key.cells.length);
    key.cells.forEach((keyCell: any, i: number) => {
      const cell = result.cells[i]!;
      expect(cell.regionCode).toBe(keyCell.region.code);
      expect(cell.regionLabel).toBe(keyCell.region.label);
      expect(cell.value).toBe(keyCell.value);
      expect(cell.unit).toBe(keyCell.unit);
      expect(cell.status).toBe(keyCell.status);
      expect(cell.periodCode).toBe(key.period);
      expect(cell.dims).toEqual(key.dims);
    });
    // Pre-registered (non-explicit) max backs "meer dan" — winner per the key.
    const max = result.derivations.find((d) => d.kind === 'max');
    expect(max).toBeDefined();
    if (max?.kind !== 'max') throw new Error('unreachable');
    expect(max.explicit).toBe(false);
    const keyWinner = key.cells.reduce((a: any, b: any) => (a.value > b.value ? a : b));
    const winnerCell = result.cells.find((c) => c.resultId === max.winnerResultId)!;
    expect(winnerCell.regionCode).toBe(keyWinner.region.code);
  });

  it('B13: derived difference matches the key formula, is marked, and lists its sources (R5)', () => {
    const key = answerKey.tasks.B13!;
    const result = asResult('B13');
    checkBaseline('B13', result);
    expect(result.shape).toBe('derived');
    expect(result.cells).toHaveLength(key.sources.length);
    key.sources.forEach((source: any, i: number) => {
      const cell = result.cells[i]!;
      expect(cell.periodCode).toBe(source.period);
      expect(cell.value).toBe(source.value);
      expect(cell.status).toBe(source.status);
      expect(cell.regionCode).toBe(key.region.code);
      expect(cell.regionLabel).toBe(key.region.label);
    });
    const diff = result.derivations.find((d) => d.kind === 'difference');
    expect(diff).toBeDefined();
    if (diff?.kind !== 'difference') throw new Error('unreachable');
    expect(diff.explicit).toBe(true);
    // key.formula: "sources[1].value - sources[0].value"
    expect(diff.value).toBe(key.sources[1].value - key.sources[0].value);
    expect(diff.value).toBe(key.computedValue);
    expect(diff.minuendResultId).toBe(result.cells[1]!.resultId);
    expect(diff.subtrahendResultId).toBe(result.cells[0]!.resultId);
    expect(diff.sourceResultIds).toEqual(result.cells.map((c) => c.resultId));
    expect(diff.marking).toBe(DERIVED_DATA_MARKING);
    expect(diff.unit).toBe(key.unit);
  });

  it('B14: derived max names the key winner, is marked, and ranks all four sources (R5)', () => {
    const key = answerKey.tasks.B14!;
    const result = asResult('B14');
    checkBaseline('B14', result);
    expect(result.shape).toBe('derived');
    expect(result.cells).toHaveLength(key.sources.length);
    key.sources.forEach((source: any, i: number) => {
      const cell = result.cells[i]!;
      expect(cell.regionCode).toBe(source.region.code);
      expect(cell.regionLabel).toBe(source.region.label);
      expect(cell.value).toBe(source.value);
      expect(cell.status).toBe(source.status);
      expect(cell.periodCode).toBe(key.period);
    });
    const max = result.derivations.find((d) => d.kind === 'max');
    expect(max).toBeDefined();
    if (max?.kind !== 'max') throw new Error('unreachable');
    expect(max.explicit).toBe(true);
    expect(max.value).toBe(key.computedValue);
    const winnerCell = result.cells.find((c) => c.resultId === max.winnerResultId)!;
    expect(winnerCell.regionCode).toBe(key.winner.code);
    expect(winnerCell.regionLabel).toBe(key.winner.label);
    expect(max.marking).toBe(DERIVED_DATA_MARKING);
    expect(max.sourceResultIds).toEqual(result.cells.map((c) => c.resultId));
    // Ranking descending by value, per the key's source values.
    const expectedOrder = [...key.sources]
      .sort((a: any, b: any) => b.value - a.value)
      .map((s: any) => s.region.code);
    const rankedRegions = max.rankingResultIds.map(
      (id) => result.cells.find((c) => c.resultId === id)!.regionCode,
    );
    expect(rankedRegions).toEqual(expectedOrder);
  });
});

describe('B20 freshness reference (typed refusal, no numbers)', () => {
  function nextPeriodAfter(code: string): string {
    const match = /^(\d{4})MM(\d{2})$/.exec(code);
    if (!match) throw new Error(`B20 reference period is not monthly: ${code}`);
    const year = Number(match[1]);
    const month = Number(match[2]);
    return month === 12 ? `${year + 1}MM01` : `${year}MM${String(month + 1).padStart(2, '0')}`;
  }

  it('asking one month beyond the freshest CPI month refuses with the key reference offered', async () => {
    const key = answerKey.tasks.B20!;
    const asked = nextPeriodAfter(key.freshestAvailable.period);
    const outcome = await runQuery(db, {
      schemaVersion: 1,
      target: { kind: 'canonical', key: 'cpi_yearly_inflation' },
      period: { kind: 'codes', codes: [asked] },
      derivation: 'none',
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('unreachable');
    expect(outcome.refusal.kind).toBe('freshness');
    expect(outcome.refusal.freshness?.freshestAvailable).toEqual({
      periodCode: key.freshestAvailable.period,
      status: key.freshestAvailable.status,
    });
    expect(outcome.refusal.freshness?.freshestDefinitief).toEqual({
      periodCode: key.freshestDefinitief.period,
    });
    expect(outcome.refusal.nearestAlternative).toBe(key.freshestAvailable.period);
    // A refusal carries no data values (principle c): the freshest period's
    // VALUE must not appear anywhere in the refusal payload.
    expect(JSON.stringify(outcome)).not.toContain(String(key.freshestAvailable.value));
  });
});

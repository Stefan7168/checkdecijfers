// WP8 done-criterion (docs/08-build-plan.md): B4 and B8 render a correct
// line chart whose points equal their cells — proven against the frozen
// answer key through the real pipeline path (hand-authored intents → query →
// spec → SVG), hermetically (PGlite + committed fixtures, ADR 009).
//
// Honesty rule (docs/02, Scoring): every expected value here is READ FROM
// benchmark/answer-key.json. Nothing numeric is hardcoded; keys are never
// edited to green.
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runQuery } from '../../src/query/index.ts';
import type { ValidatedResult } from '../../src/query/index.ts';
import type { Db } from '../../src/db/types.ts';
import { buildChartSpec, renderChartSvg } from '../../src/chart/index.ts';
import type { ChartSpec } from '../../src/chart/index.ts';
import { findNumericTokens, formatValueNl, normalizeForScan } from '../../src/answer/compose/format.ts';
import { createIngestedDb } from '../helpers/ingested-db.ts';
import { ANSWERABLE_TASKS } from '../helpers/benchmark-intents.ts';

interface KeyPoint {
  period: string;
  value: number;
  status: string;
  valueAttribute: string;
}
interface KeyTask {
  shape: string;
  table: string;
  measureTitle: string;
  unit: string;
  decimals: number;
  points: KeyPoint[];
}

const answerKey = JSON.parse(
  readFileSync(new URL('../../benchmark/answer-key.json', import.meta.url), 'utf8'),
) as { tasks: Record<string, KeyTask> };

let db: Db;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createIngestedDb());
});

afterAll(async () => {
  await close();
});

async function chartFor(taskId: 'B4' | 'B8'): Promise<{ result: ValidatedResult; spec: ChartSpec }> {
  const outcome = await runQuery(db, ANSWERABLE_TASKS[taskId].intent);
  if (!outcome.ok) throw new Error(`${taskId} refused: ${outcome.refusal.message}`);
  const spec = buildChartSpec(outcome);
  if (spec === null) throw new Error(`${taskId} produced no chart spec`);
  return { result: outcome, spec };
}

describe.each(['B4', 'B8'] as const)('%s line chart against the frozen key', (taskId) => {
  it('spec points equal the key cells: period, value, status, unit — verbatim', async () => {
    const key = answerKey.tasks[taskId]!;
    const { spec } = await chartFor(taskId);

    expect(spec.kind).toBe('line');
    expect(spec.unit).toBe(key.unit);
    expect(spec.title).toBe(key.measureTitle);
    expect(spec.attribution.tableId).toBe(key.table);
    expect(spec.series).toHaveLength(1);

    const points = spec.series[0]!.points;
    expect(points.map((p) => p.periodCode)).toEqual(key.points.map((k) => k.period));
    expect(points.map((p) => p.value)).toEqual(key.points.map((k) => k.value));
    expect(points.map((p) => p.status)).toEqual(key.points.map((k) => k.status));
    for (const point of points) {
      expect(point.formattedValue).toBe(formatValueNl(point.value!, key.decimals));
    }
  });

  it('the rendered SVG shows every key value and period, adds no numbers, drops no point', async () => {
    const key = answerKey.tasks[taskId]!;
    const { spec } = await chartFor(taskId);
    const svg = renderChartSvg(spec);
    const text = [...svg.matchAll(/>([^<]+)</g)].map((m) => m[1]!).join(' ');

    for (const keyPoint of key.points) {
      expect(text).toContain(formatValueNl(keyPoint.value, key.decimals));
    }
    expect(svg.match(/data-point="value"/g)).toHaveLength(key.points.length);
    expect(text).toContain(`tabel ${key.table}`);

    // No invented numbers: every numeric token shown occurs in a spec string.
    const specStrings = [
      spec.title,
      spec.unit,
      spec.attributionLine,
      ...Object.values(spec.dimLabels),
      ...(spec.provisionalNote === null ? [] : [spec.provisionalNote]),
      ...spec.nullNotes,
      ...(spec.definitionLine === null ? [] : [spec.definitionLine]),
      ...spec.series.flatMap((s) => [
        s.label,
        ...s.points.flatMap((p) => [p.periodLabel, ...(p.formattedValue === null ? [] : [p.formattedValue])]),
      ]),
    ];
    const allowed = new Set(
      specStrings.flatMap((s) => findNumericTokens(normalizeForScan(s)).map((t) => t.token)),
    );
    for (const token of findNumericTokens(normalizeForScan(text))) {
      expect(allowed, `invented numeric token "${token.token}"`).toContain(token.token);
    }
  });

  it('spec building is deterministic across runs', async () => {
    const first = await chartFor(taskId);
    const second = await chartFor(taskId);
    expect(second.spec).toEqual(first.spec);
    expect(renderChartSvg(second.spec)).toBe(renderChartSvg(first.spec));
  });
});

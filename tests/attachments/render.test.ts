// renderInstructionForDataset (src/attachments/render.ts) — the pure part of
// the zero-LLM render action (co-pilot phase 2, session 113). Validate →
// build, with every reachable failure returned as an outcome instead of
// thrown: a panel/canvas edit costs no credit and must never surface a
// stack trace. No LLM anywhere in this file.
import { describe, expect, it } from 'vitest';
import { renderInstructionForDataset } from '../../src/attachments/render.ts';
import { buildDatasetProfile } from '../../src/attachments/ingest/profile.ts';
import { MAX_CHART_POINTS } from '../../src/attachments/limits.ts';
import type { UserDataset } from '../../src/attachments/types.ts';

const CELLS = [
  ['Jaar', 'Gemeente', 'Omzet'],
  ['2020', 'Amsterdam', '120,5'],
  ['2020', 'Rotterdam', '80,0'],
  ['2021', 'Amsterdam', '150,0'],
  ['2021', 'Rotterdam', '90,0'],
];

function dataset(cells: string[][] = CELLS): UserDataset {
  return {
    id: 42,
    userId: 'u1',
    sourceKind: 'file_csv',
    displayName: 'verkoop-2024.csv',
    sourceUrl: null,
    cells,
    profile: buildDatasetProfile(cells),
    status: 'ready',
    contentSha256: 'deadbeef',
    createdAt: '2026-09-06T00:00:00Z',
  };
}

/** The client-side shape a doorway actually sends: no `reading`/`confidence`
 * (ClientChartInstruction cuts them — types.ts), so this also pins that the
 * server-only placeholders are filled here rather than demanded of the
 * browser. */
function clientInstruction(fields: Record<string, unknown> = {}): unknown {
  return {
    version: 2,
    kind: 'line',
    x: 'c0',
    y: ['c2'],
    seriesBy: null,
    filters: [],
    sort: null,
    limit: null,
    aggregate: null,
    derived: null,
    unsupported: null,
    ...fields,
  };
}

describe('renderInstructionForDataset', () => {
  it('returns ok with a built chart for a valid v2 instruction', () => {
    const outcome = renderInstructionForDataset(dataset(), clientInstruction({ seriesBy: 'c1' }));
    expect(outcome.kind).toBe('ok');
    if (outcome.kind !== 'ok') return;
    expect(outcome.chart.origin).toBe('user_dataset');
    expect(outcome.chart.series.map((s) => s.label)).toEqual(['Amsterdam', 'Rotterdam']);
  });

  it('upgrades a stored v1 instruction rather than refusing it', () => {
    const v1 = { version: 1, kind: 'line', x: 'c0', y: ['c2'], seriesBy: null, filters: [], sort: null, limit: null, unsupported: null };
    expect(renderInstructionForDataset(dataset(), v1).kind).toBe('ok');
  });

  it('refuses a column id that is not in the profile (validation)', () => {
    expect(renderInstructionForDataset(dataset(), clientInstruction({ x: 'c99' }))).toEqual({ kind: 'invalid', reason: 'validation' });
  });

  it('refuses a non-object instruction (validation), never throws', () => {
    expect(renderInstructionForDataset(dataset(), null)).toEqual({ kind: 'invalid', reason: 'validation' });
    expect(renderInstructionForDataset(dataset(), 'line chart please')).toEqual({ kind: 'invalid', reason: 'validation' });
  });

  // A gap INSIDE the column's real range: allowed by the validator (it only
  // refuses a range outside [min, max]) and matched by no row — the one way a
  // legal filter can still select nothing.
  it('reports zero_rows when a legal filter matches nothing', () => {
    const outcome = renderInstructionForDataset(
      dataset(),
      clientInstruction({ filters: [{ column: 'c2', op: 'between', from: 100, to: 110 }] }),
    );
    expect(outcome).toEqual({ kind: 'invalid', reason: 'zero_rows' });
  });

  it('refuses a filter value outside the column\'s own vocabulary (validation)', () => {
    const outcome = renderInstructionForDataset(
      dataset(),
      clientInstruction({ filters: [{ column: 'c1', op: 'in', values: ['Nergens'] }] }),
    );
    expect(outcome).toEqual({ kind: 'invalid', reason: 'validation' });
  });

  it('reports too_many_points over the cap', () => {
    const cells: string[][] = [['Jaar', 'Gemeente', 'Omzet']];
    for (let i = 0; i < MAX_CHART_POINTS + 1; i++) cells.push([`${2000 + i}`, 'Amsterdam', '1,0']);
    expect(renderInstructionForDataset(dataset(cells), clientInstruction())).toEqual({ kind: 'invalid', reason: 'too_many_points' });
  });
});

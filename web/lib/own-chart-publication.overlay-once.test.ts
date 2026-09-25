// Session 128 security-review fix wave (#322 I-4b): pruneForPublic resolves
// the chart's points ONCE per request and answers every kept overlay from
// that one map — it used to run a full executeInstruction over every row of
// the file once PER overlay. Its own file because it needs a module mock of
// derive-overlay.ts (the real functions, wrapped to count calls), which the
// main publication test file must not have.
import { describe, expect, it, vi } from 'vitest';

const { allResolvedPointsCalls } = vi.hoisted(() => ({ allResolvedPointsCalls: { count: 0 } }));
vi.mock('../backend/attachments/derive-overlay.ts', async () => {
  const actual = await vi.importActual<typeof import('../backend/attachments/derive-overlay.ts')>('../backend/attachments/derive-overlay.ts');
  return {
    ...actual,
    allResolvedPoints: (...args: Parameters<typeof actual.allResolvedPoints>) => {
      allResolvedPointsCalls.count++;
      return actual.allResolvedPoints(...args);
    },
  };
});

import { buildDatasetProfile } from '../backend/attachments/ingest/profile.ts';
import { deriveChartOverlay } from '../backend/attachments/derive-overlay.ts';
import { validateInstructionObject } from '../backend/attachments/instruct/schema.ts';
import type { DatasetTurnRecord, UserDataset } from '../backend/attachments/types.ts';
import { makeCommand } from './chart-commands.ts';
import { buildPublishedChart, pruneForPublic } from './own-chart-publication.ts';

const CELLS = [
  ['Jaar', 'Klant', 'Omzet'],
  ['2020', 'Geheim BV', '120,5'],
  ['2020', 'Open NV', '80,0'],
  ['2021', 'Geheim BV', '150,0'],
  ['2021', 'Open NV', '90,0'],
  ['2022', 'Open NV', '95,5'],
];
const dataset: UserDataset = {
  id: 42,
  userId: 'u1',
  sourceKind: 'file_csv',
  displayName: 'x.csv',
  sourceUrl: null,
  cells: CELLS,
  profile: buildDatasetProfile(CELLS),
  status: 'ready',
  contentSha256: 'ab',
  createdAt: '2026-09-06T00:00:00Z',
};
const instruction = {
  version: 2,
  kind: 'line',
  x: 'c0',
  y: ['c2'],
  seriesBy: 'c1',
  filters: [],
  sort: null,
  limit: null,
  aggregate: null,
  derived: null,
  unsupported: null,
  reading: '',
  confidence: 1,
};
const turn = { id: 7, userId: 'u1', datasetId: 42, kind: 'chart', chartEmitted: true, instruction } as unknown as DatasetTurnRecord;

describe('pruneForPublic — overlays resolved from ONE point map per request', () => {
  it('five overlays cost one allResolvedPoints call, and each value equals deriveChartOverlay on its own', () => {
    const requests = [
      { id: 'a', calcKind: 'difference' as const, resultIds: ['r2:c2', 'r4:c2'] },
      { id: 'b', calcKind: 'difference' as const, resultIds: ['r4:c2', 'r5:c2'] },
      { id: 'c', calcKind: 'mean' as const, resultIds: ['r2:c2', 'r4:c2', 'r5:c2'] },
      { id: 'd', calcKind: 'difference' as const, resultIds: ['r2:c2', 'r5:c2'] },
      { id: 'e', calcKind: 'mean' as const, resultIds: ['r2:c2', 'r4:c2'] },
    ];
    const built = buildPublishedChart(dataset, turn, requests.map((overlay) => makeCommand({ kind: 'addDerivedOverlay', overlay }, 'panel')));
    if (!built.ok) throw new Error('expected ok');
    expect(built.dropped).toBe(0);

    allResolvedPointsCalls.count = 0;
    const pub = pruneForPublic(built, null);
    expect(allResolvedPointsCalls.count).toBe(1);

    const validated = validateInstructionObject(instruction, dataset.profile);
    for (const r of requests) {
      const expected = deriveChartOverlay(dataset, validated, { calcKind: r.calcKind, resultIds: r.resultIds });
      expect(pub.overlays[r.id]!.value).toBe(expected.value);
      expect(pub.overlays[r.id]!.decimals).toBe(expected.decimals);
    }
  });

  it('no overlays: no point map is built at all', () => {
    const built = buildPublishedChart(dataset, turn, []);
    if (!built.ok) throw new Error('expected ok');
    allResolvedPointsCalls.count = 0;
    pruneForPublic(built, null);
    expect(allResolvedPointsCalls.count).toBe(0);
  });
});

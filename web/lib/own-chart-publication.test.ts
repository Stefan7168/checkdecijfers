// Own-data publish (ADR 057, session 127, Task 2) — TDD RED for
// buildPublishedChart/pruneForPublic. See the spec §3.4/§3.5 and
// docs/05-data-rules.md invariant P1: an anonymous visitor to a published
// own-data chart must never receive a hidden series' label/value/source
// text, the dataset's file name/source url/content hash, its raw cells or
// profile, or the reader's own command log.
import { describe, expect, it } from 'vitest';
import { buildDatasetProfile } from '../backend/attachments/ingest/profile.ts';
import type { DatasetTurnRecord, UserDataset } from '../backend/attachments/types.ts';
import { buildPublishedChart, pruneForPublic } from './own-chart-publication.ts';

const CELLS = [
  ['Jaar', 'Klant', 'Omzet'],
  ['2020', 'Geheim BV', '120,5'],
  ['2020', 'Open NV', '80,0'],
  ['2021', 'Geheim BV', '150,0'],
  ['2021', 'Open NV', '90,0'],
];
const dataset: UserDataset = {
  id: 42,
  userId: 'u1',
  sourceKind: 'file_csv',
  displayName: 'klanten_vertrouwelijk.csv',
  sourceUrl: 'https://intranet.example.com/x.csv',
  cells: CELLS,
  profile: buildDatasetProfile(CELLS),
  status: 'ready',
  contentSha256: 'deadbeefcafe',
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

describe('buildPublishedChart', () => {
  it('an empty log rebuilds the chart as first made', () => {
    const r = buildPublishedChart(dataset, turn, []);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.dropped).toBe(0);
    expect(r.spec.series.map((s) => s.label)).toEqual(['Geheim BV', 'Open NV']);
  });
  it('replays view commands (title, hide a series)', () => {
    const r = buildPublishedChart(dataset, turn, [{ kind: 'setTitle', title: 'Omzet' }, { kind: 'toggleSeries', key: 's0' }]);
    if (!r.ok) throw new Error('expected ok');
    expect(r.state.title).toBe('Omzet');
    expect([...r.state.hiddenKeys]).toEqual(['s0']);
  });
  it('counts a command that does not validate as dropped (never silently different)', () => {
    const r = buildPublishedChart(dataset, turn, [{ kind: 'toggleSeries', key: 's9' }]);
    if (!r.ok) throw new Error('expected ok');
    expect(r.dropped).toBe(1);
  });
  it('counts garbage entries as dropped', () => {
    const r = buildPublishedChart(dataset, turn, [null, 42, 'x', { nokind: true }]);
    if (!r.ok) throw new Error('expected ok');
    expect(r.dropped).toBe(4);
  });
  it('a non-array log is invalid_log', () => {
    expect(buildPublishedChart(dataset, turn, { kind: 'setTitle' })).toEqual({ ok: false, reason: 'invalid_log' });
  });
  it('a turn without an instruction is not_chart', () => {
    expect(buildPublishedChart(dataset, { ...turn, instruction: null }, [])).toEqual({ ok: false, reason: 'not_chart' });
  });
  it('follows a setInstruction data command to the new spec', () => {
    const next = { ...instruction, seriesBy: null } as Record<string, unknown>;
    delete next.reading;
    delete next.confidence;
    const r = buildPublishedChart(dataset, turn, [{ kind: 'setInstruction', instruction: next, summary: 'één lijn' }]);
    if (!r.ok) throw new Error('expected ok');
    expect(r.dropped).toBe(0);
    expect(r.spec.series).toHaveLength(1);
  });
});

describe('pruneForPublic — invariant P1', () => {
  // rowRef format is r{row}:c{col} (execute.ts), row 0 = header, so with
  // this CELLS layout: Geheim BV = r1:c2 (2020, 120,5) / r3:c2 (2021,
  // 150,0); Open NV = r2:c2 (2020, 80,0) / r4:c2 (2021, 90,0). s0 = the
  // first series built (Geheim BV, first appearance order — chart.ts's own
  // grouping), s1 = Open NV.
  const built = buildPublishedChart(dataset, turn, [
    { kind: 'toggleSeries', key: 's0' },
    { kind: 'addNote', note: { id: 'n1', resultId: 'r1:c2', periodLabel: '2020', seriesLabel: 'Geheim BV', text: 'piek' } },
    { kind: 'setTitle', title: 'Omzet per klant' },
    // A difference spanning a hidden point (Geheim BV, r1:c2) and a visible
    // one (Open NV, r2:c2) must never reach the public page.
    { kind: 'addDerivedOverlay', overlay: { id: 'o-hidden', calcKind: 'difference', resultIds: ['r1:c2', 'r2:c2'] } },
    // A difference between two visible points (both Open NV) must survive
    // pruning, resolved to a real number.
    { kind: 'addDerivedOverlay', overlay: { id: 'o-visible', calcKind: 'difference', resultIds: ['r2:c2', 'r4:c2'] } },
  ]);
  if (!built.ok) throw new Error('expected ok');
  const pub = pruneForPublic(built, 'Bron: eigen administratie');
  const json = JSON.stringify(pub);

  it('never contains a hidden series label, value or source text', () => {
    expect(json).not.toContain('Geheim BV');
    expect(json).not.toContain('120,5');
    expect(json).not.toContain('150,0');
    expect(json).not.toContain('120.5');
  });
  it('keeps the hidden series slot so keys and colours do not shift', () => {
    expect(pub.spec.series).toHaveLength(2);
    expect(pub.spec.series[0]!.label).toBe('');
    expect(pub.spec.series[0]!.points.every((p) => p.value === null && p.formattedValue === null && p.sourceText === '')).toBe(true);
    expect(pub.spec.series[1]!.label).toBe('Open NV');
    expect(pub.state.hiddenKeys).toEqual(['s0']);
  });
  it('drops a note anchored to a hidden point', () => {
    expect(pub.state.notes).toEqual([]);
  });
  it('drops a derived overlay that touches a hidden point, keeps one over visible points only', () => {
    expect(pub.state.derivedOverlayRequests.map((r) => r.id)).toEqual(['o-visible']);
    expect(pub.overlays['o-hidden']).toBeUndefined();
    expect(pub.overlays['o-visible']).toBeDefined();
    expect(typeof pub.overlays['o-visible']!.value).toBe('number');
    expect(pub.overlays['o-visible']!.value).toBe(10);
  });
  it('never contains the file name, source url, content hash, cells, profile or the command log', () => {
    for (const secret of ['klanten_vertrouwelijk', 'intranet.example.com', 'deadbeefcafe', '"cells"', '"profile"', 'toggleSeries', 'addNote']) {
      expect(json).not.toContain(secret);
    }
  });
  it('keeps the author text and the source line', () => {
    expect(pub.state.title).toBe('Omzet per klant');
    expect(pub.sourceLine).toBe('Bron: eigen administratie');
  });
  it('clears the verified-whole designation and period range (v1)', () => {
    expect(JSON.stringify(pub.state)).not.toContain('wholeReferenceRowRef');
    expect(JSON.stringify(pub.state)).not.toContain('periodRange');
  });
});

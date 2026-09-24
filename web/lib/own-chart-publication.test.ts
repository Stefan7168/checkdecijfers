// Own-data publish (ADR 057, session 127, Task 2 + fix round 1) — TDD for
// buildPublishedChart/pruneForPublic. See the spec §3.4/§3.5 and
// docs/05-data-rules.md invariant P1: an anonymous visitor to a published
// own-data chart must never receive a hidden series' label/value/source
// text, the dataset's file name/source url/content hash, its raw cells or
// profile, or the reader's own command log.
import { describe, expect, it } from 'vitest';
import { buildDatasetProfile } from '../backend/attachments/ingest/profile.ts';
import type { ClientChartInstruction, DatasetTurnRecord, UserDataset } from '../backend/attachments/types.ts';
import { makeCommand } from './chart-commands.ts';
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
    const r = buildPublishedChart(dataset, turn, [
      makeCommand({ kind: 'setTitle', title: 'Omzet' }, 'panel'),
      makeCommand({ kind: 'toggleSeries', key: 's0' }, 'panel'),
    ]);
    if (!r.ok) throw new Error('expected ok');
    expect(r.state.title).toBe('Omzet');
    expect([...r.state.hiddenKeys]).toEqual(['s0']);
  });
  it('counts a command that does not validate as dropped (never silently different)', () => {
    // Well-formed (passes the chart-commands.ts schema) but semantically
    // invalid: 's9' names no series on this chart, so validateCommand
    // refuses it — a DIFFERENT drop path from the garbage/malformed tests
    // below (those never even reach validateCommand).
    const r = buildPublishedChart(dataset, turn, [makeCommand({ kind: 'toggleSeries', key: 's9' }, 'panel')]);
    if (!r.ok) throw new Error('expected ok');
    expect(r.dropped).toBe(1);
  });
  it('counts garbage entries as dropped', () => {
    const r = buildPublishedChart(dataset, turn, [null, 42, 'x', { nokind: true }]);
    if (!r.ok) throw new Error('expected ok');
    expect(r.dropped).toBe(4);
  });
  it('counts a well-shaped-but-incomplete command as dropped, never throws (I3)', () => {
    // Each of these has a real `kind` string chart-commands.ts recognises,
    // but is missing the fields that kind's own schema (and, before this
    // fix, validateCommand/applyCommand reading them unconditionally) —
    // so a loose `typeof kind === 'string'` shape check would let them
    // through to a crash instead of a reachable "dropped" outcome.
    const r = buildPublishedChart(dataset, turn, [{ kind: 'setSeriesView' }, { kind: 'addNote' }, { kind: 'setInstruction' }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.dropped).toBe(3);
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
    const r = buildPublishedChart(dataset, turn, [
      makeCommand({ kind: 'setInstruction', instruction: next as unknown as ClientChartInstruction, summary: 'één lijn' }, 'panel'),
    ]);
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
    makeCommand({ kind: 'toggleSeries', key: 's0' }, 'panel'),
    makeCommand({ kind: 'addNote', note: { id: 'n1', resultId: 'r1:c2', periodLabel: '2020', seriesLabel: 'Geheim BV', text: 'piek' } }, 'panel'),
    makeCommand({ kind: 'setTitle', title: 'Omzet per klant' }, 'panel'),
    // A difference spanning a hidden point (Geheim BV, r1:c2) and a visible
    // one (Open NV, r2:c2) must never reach the public page.
    makeCommand({ kind: 'addDerivedOverlay', overlay: { id: 'o-hidden', calcKind: 'difference', resultIds: ['r1:c2', 'r2:c2'] } }, 'panel'),
    // A difference between two visible points (both Open NV) must survive
    // pruning, resolved to a real number.
    makeCommand({ kind: 'addDerivedOverlay', overlay: { id: 'o-visible', calcKind: 'difference', resultIds: ['r2:c2', 'r4:c2'] } }, 'panel'),
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

describe('pruneForPublic — C1: a hidden series own column header must not leak via yHeaders', () => {
  // No seriesBy: two y columns each become their own series, in
  // instruction.y order (chart.ts's buildUserChartSpec — bySeries insertion
  // order follows executeInstruction's own yIds.flatMap order). So s0 =
  // 'Omzet' (c1), s1 = 'GeheimeKolom' (c2) — and, per chart.ts, `yHeaders`
  // lists those same two columns' headers in the SAME order.
  const CELLS_MULTI_Y = [
    ['Jaar', 'Omzet', 'GeheimeKolom'],
    ['2020', '100,0', '5,0'],
    ['2021', '110,0', '6,0'],
  ];
  const datasetMultiY: UserDataset = {
    id: 43,
    userId: 'u1',
    sourceKind: 'file_csv',
    displayName: 'multi.csv',
    sourceUrl: null,
    cells: CELLS_MULTI_Y,
    profile: buildDatasetProfile(CELLS_MULTI_Y),
    status: 'ready',
    contentSha256: 'cafebabe',
    createdAt: '2026-09-06T00:00:00Z',
  };
  const instructionMultiY = {
    version: 2,
    kind: 'line',
    x: 'c0',
    y: ['c1', 'c2'],
    seriesBy: null,
    filters: [],
    sort: null,
    limit: null,
    aggregate: null,
    derived: null,
    unsupported: null,
    reading: '',
    confidence: 1,
  };
  const turnMultiY = {
    id: 8,
    userId: 'u1',
    datasetId: 43,
    kind: 'chart',
    chartEmitted: true,
    instruction: instructionMultiY,
  } as unknown as DatasetTurnRecord;

  it('blanks the hidden series own header out of yHeaders, but leaves the other header alone', () => {
    const built = buildPublishedChart(datasetMultiY, turnMultiY, [makeCommand({ kind: 'toggleSeries', key: 's1' }, 'panel')]);
    if (!built.ok) throw new Error('expected ok');
    // Sanity: the FULL (unpruned) spec still has both headers.
    expect(built.spec.yHeaders).toEqual(['Omzet', 'GeheimeKolom']);

    const pub = pruneForPublic(built, null);
    expect(pub.spec.yHeaders).toEqual(['Omzet', '']);
    expect(pub.spec.series[1]!.label).toBe('');
    expect(JSON.stringify(pub)).not.toContain('GeheimeKolom');
  });
});

describe('pruneForPublic — C2: a note stays anchored to a rowRef the FINAL spec no longer plots', () => {
  it('drops a note whose rowRef the current chart no longer plots at all (not merely hidden)', () => {
    // addNote is validated against the chart as it stood when the command
    // was issued (Geheim BV still plotted, r1:c2 a real point). The
    // FOLLOWING setInstruction then filters the data down to Open NV only
    // — Geheim BV, and r1:c2 with it, no longer exists on the final chart
    // at all (not merely hidden by toggleSeries) — so the note must be
    // dropped, not merely kept-because-not-blanked.
    const filtered = { ...instruction, filters: [{ column: 'c1', op: 'in', values: ['Open NV'] }] } as Record<string, unknown>;
    delete filtered.reading;
    delete filtered.confidence;
    const built = buildPublishedChart(dataset, turn, [
      makeCommand(
        { kind: 'addNote', note: { id: 'n2', resultId: 'r1:c2', periodLabel: '2020', seriesLabel: 'Geheim BV', text: 'was hier' } },
        'panel',
      ),
      makeCommand({ kind: 'setInstruction', instruction: filtered as unknown as ClientChartInstruction, summary: 'alleen Open NV' }, 'panel'),
    ]);
    if (!built.ok) throw new Error('expected ok');
    expect(built.dropped).toBe(0);
    // Sanity: the note is really still in the raw (unpruned) state — this
    // proves the drop happens in pruneForPublic, not earlier by accident.
    expect(built.state.notes).toHaveLength(1);

    const pub = pruneForPublic(built, null);
    expect(pub.state.notes).toEqual([]);
    expect(JSON.stringify(pub)).not.toContain('Geheim BV');
  });
});

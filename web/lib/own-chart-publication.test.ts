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
import { buildPublishedChart, firstRenderMatchesEnvelope, PUBLIC_OVERLAY_MAX, pruneForPublic } from './own-chart-publication.ts';

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
  // Session 128 fix wave (#322 I-4a): the log is now parsed WHOLE through
  // the capped schema (the card's own stored-log hydration does the same,
  // use-chart-edits.ts), so a garbage entry refuses the log as invalid_log
  // rather than being counted as one dropped entry. Both outcomes fail
  // closed (publish refuses, the public page shows "not available"); a
  // garbage entry never comes from a real card, so 'invalid' is the more
  // accurate refusal than 'changed'.
  it('refuses a log with garbage entries as invalid_log', () => {
    expect(buildPublishedChart(dataset, turn, [null, 42, 'x', { nokind: true }])).toEqual({ ok: false, reason: 'invalid_log' });
  });
  it('refuses a well-shaped-but-incomplete command as invalid_log, never throws (I3)', () => {
    // Each of these has a real `kind` string chart-commands.ts recognises,
    // but is missing the fields that kind's own schema (and, before fix
    // round 1, validateCommand/applyCommand reading them unconditionally) —
    // so a loose `typeof kind === 'string'` shape check would let them
    // through to a crash instead of a reachable refusal.
    const r = buildPublishedChart(dataset, turn, [{ kind: 'setSeriesView' }, { kind: 'addNote' }, { kind: 'setInstruction' }]);
    expect(r).toEqual({ ok: false, reason: 'invalid_log' });
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

  // Fix round 2: `yHeaders[i]` and `series[i]` are NOT guaranteed to name the
  // same column BY POSITION — `yHeaders` always lists `instruction.y` in
  // its own fixed order, while `series` is grouped by first-appearance
  // order over execute.ts's OWN returned points, which a `sort`/`limit` can
  // reorder or shrink independently of `instruction.y`'s order. A dataset
  // where GeheimeKolom's values dwarf Omzet's, plotted with
  // `sort: { by: 'value', direction: 'desc' }` over both y columns
  // together, puts GeheimeKolom's points first, so `series[0]` is
  // GeheimeKolom and `series[1]` is Omzet — the OPPOSITE of
  // `instruction.y`'s own `['c1' Omzet, 'c2' GeheimeKolom]` order. Hiding
  // `s0` (GeheimeKolom) must blank `yHeaders`' GeheimeKolom entry (position
  // 1, not 0) and leave Omzet's (position 0) alone — the exact case a
  // position-based blank gets backwards. A SEPARATE dataset from
  // `datasetMultiY` above (whose own values happen to sort the OTHER way)
  // so this repro is unambiguous.
  const CELLS_SORT_DESC = [
    ['Jaar', 'Omzet', 'GeheimeKolom'],
    ['2020', '10', '777'],
    ['2021', '20', '888'],
  ];
  const datasetSortDesc: UserDataset = {
    id: 44,
    userId: 'u1',
    sourceKind: 'file_csv',
    displayName: 'sort.csv',
    sourceUrl: null,
    cells: CELLS_SORT_DESC,
    profile: buildDatasetProfile(CELLS_SORT_DESC),
    status: 'ready',
    contentSha256: 'baadf00d',
    createdAt: '2026-09-06T00:00:00Z',
  };
  const instructionSortDesc = {
    version: 2,
    kind: 'bar',
    x: 'c0',
    y: ['c1', 'c2'],
    seriesBy: null,
    filters: [],
    sort: { by: 'value', direction: 'desc' },
    limit: null,
    aggregate: null,
    derived: null,
    unsupported: null,
    reading: '',
    confidence: 1,
  };
  const turnSortDesc = {
    id: 9,
    userId: 'u1',
    datasetId: 44,
    kind: 'chart',
    chartEmitted: true,
    instruction: instructionSortDesc,
  } as unknown as DatasetTurnRecord;

  it('blanks by LABEL, not by position, when sort reorders series ahead of instruction.y', () => {
    const built = buildPublishedChart(datasetSortDesc, turnSortDesc, [makeCommand({ kind: 'toggleSeries', key: 's0' }, 'panel')]);
    if (!built.ok) throw new Error('expected ok');
    // Sanity: confirms the premise — series order is REVERSED from
    // instruction.y's own column order, and s0 is really GeheimeKolom.
    expect(built.spec.series.map((s) => s.label)).toEqual(['GeheimeKolom', 'Omzet']);
    expect(built.spec.yHeaders).toEqual(['Omzet', 'GeheimeKolom']);

    const pub = pruneForPublic(built, null);
    expect(JSON.stringify(pub)).not.toContain('GeheimeKolom');
    expect(pub.spec.yHeaders).toContain('Omzet');
    expect(pub.spec.yHeaders).toEqual(['Omzet', '']);
  });

  it('also blanks a header whose entire series was dropped by limit, even the one that stays hidden', () => {
    // limit: 2 keeps only the two highest-value points overall — both are
    // GeheimeKolom's (777, 888) — so Omzet's series disappears ENTIRELY
    // (zero points survive the slice), not merely "hidden": there is no
    // `series[i]` for it at all any more, only a `yHeaders` entry naming a
    // column nothing currently draws.
    const turnSortDescLimited = {
      ...turnSortDesc,
      instruction: { ...instructionSortDesc, limit: 2 },
    } as unknown as DatasetTurnRecord;
    const built = buildPublishedChart(datasetSortDesc, turnSortDescLimited, [
      makeCommand({ kind: 'toggleSeries', key: 's0' }, 'panel'),
    ]);
    if (!built.ok) throw new Error('expected ok');
    // Sanity: only ONE series remains (GeheimeKolom), against TWO yHeaders.
    expect(built.spec.series).toHaveLength(1);
    expect(built.spec.series[0]!.label).toBe('GeheimeKolom');
    expect(built.spec.yHeaders).toEqual(['Omzet', 'GeheimeKolom']);

    const pub = pruneForPublic(built, null);
    expect(JSON.stringify(pub)).not.toContain('GeheimeKolom');
    // Omzet's own header is blanked too — its column is not plotted at all,
    // visible or otherwise, so the public heading must not name it either.
    expect(pub.spec.yHeaders).toEqual(['', '']);
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

  it('also drops an overlay request and a headline override pointing at a rowRef the final spec no longer plots', () => {
    const filtered = { ...instruction, filters: [{ column: 'c1', op: 'in', values: ['Open NV'] }] } as Record<string, unknown>;
    delete filtered.reading;
    delete filtered.confidence;
    const built = buildPublishedChart(dataset, turn, [
      // Both valid against the chart as it stood at this point (Geheim
      // BV's own two points, still real rowRefs on the original chart).
      makeCommand({ kind: 'addDerivedOverlay', overlay: { id: 'o-stale', calcKind: 'difference', resultIds: ['r1:c2', 'r3:c2'] } }, 'panel'),
      makeCommand({ kind: 'setHeadlineOverride', resultId: 'r1:c2' }, 'panel'),
      // Filters the chart down to Open NV only — Geheim BV, and both
      // rowRefs above with it, no longer exist on the final chart at all.
      makeCommand({ kind: 'setInstruction', instruction: filtered as unknown as ClientChartInstruction, summary: 'alleen Open NV' }, 'panel'),
    ]);
    if (!built.ok) throw new Error('expected ok');
    expect(built.dropped).toBe(0);
    // Sanity: both are really still in the raw (unpruned) state.
    expect(built.state.derivedOverlayRequests.map((r) => r.id)).toEqual(['o-stale']);
    expect(built.state.headlineOverrideResultId).toBe('r1:c2');

    const pub = pruneForPublic(built, null);
    expect(pub.state.derivedOverlayRequests).toEqual([]);
    expect(pub.overlays['o-stale']).toBeUndefined();
    expect(pub.state.headlineOverrideResultId).toBeNull();
  });
});

// Final-review fix A1 (ruling R11): buildRows unions every series' x keys, so
// a blanked slot that kept all its points would put a category that exists
// ONLY in the hidden series on the public axis/table/heatmap. x = customer
// name, series = segment: 'Minister X' is a VIP-only customer.
describe('pruneForPublic — A1: a category only the hidden series plots never reaches the payload', () => {
  const CELLS_SEGMENT = [
    ['Segment', 'Klant', 'Omzet'],
    ['VIP', 'Minister X', '500'],
    ['VIP', 'Bakker', '100'],
    ['Normaal', 'Bakker', '50'],
    ['Normaal', 'Jansen', '60'],
  ];
  const datasetSegment: UserDataset = {
    id: 45,
    userId: 'u1',
    sourceKind: 'file_csv',
    displayName: 'segmenten.csv',
    sourceUrl: null,
    cells: CELLS_SEGMENT,
    profile: buildDatasetProfile(CELLS_SEGMENT),
    status: 'ready',
    contentSha256: 'feedface',
    createdAt: '2026-09-06T00:00:00Z',
  };
  const instructionSegment = {
    version: 2,
    kind: 'bar',
    x: 'c1',
    y: ['c2'],
    seriesBy: 'c0',
    filters: [],
    sort: null,
    limit: null,
    aggregate: null,
    derived: null,
    unsupported: null,
    reading: '',
    confidence: 1,
  };
  const turnSegment = {
    id: 10,
    userId: 'u1',
    datasetId: 45,
    kind: 'chart',
    chartEmitted: true,
    instruction: instructionSegment,
  } as unknown as DatasetTurnRecord;

  it('drops the hidden-only category from the blanked slot, keeps the shared one, keeps the slot', () => {
    const built = buildPublishedChart(datasetSegment, turnSegment, [makeCommand({ kind: 'toggleSeries', key: 's0' }, 'panel')]);
    if (!built.ok) throw new Error('expected ok');
    // Sanity: s0 = VIP (first appearance), really plotting Minister X.
    expect(built.spec.series.map((s) => s.label)).toEqual(['VIP', 'Normaal']);
    expect(built.spec.series[0]!.points.map((p) => p.xKey)).toContain('Minister X');

    const pub = pruneForPublic(built, null);
    expect(JSON.stringify(pub)).not.toContain('Minister X');
    expect(JSON.stringify(pub)).not.toContain('VIP');
    expect(JSON.stringify(pub)).not.toContain('500');
    expect(pub.spec.series).toHaveLength(2);
    expect(pub.spec.series[0]!.label).toBe('');
    // Session 128 fix wave (#322 I-2): the blanked slot is now exactly one
    // blank point per VISIBLE category, in visible order — it no longer
    // mirrors which of those categories the hidden series itself has (VIP
    // has no Jansen row; the slot must not say so).
    expect(pub.spec.series[0]!.points.map((p) => p.xKey)).toEqual(['Bakker', 'Jansen']);
    expect(pub.spec.series[1]!.label).toBe('Normaal');
  });

  it('drops an era shading anchored to a hidden-only category, keeps one between visible categories', () => {
    const built = buildPublishedChart(datasetSegment, turnSegment, [
      makeCommand({ kind: 'addEraShading', era: { id: 'e-hidden', fromPeriodCode: 'Minister X', toPeriodCode: 'Bakker', label: 'geheim tijdperk' } }, 'panel'),
      makeCommand({ kind: 'addEraShading', era: { id: 'e-visible', fromPeriodCode: 'Bakker', toPeriodCode: 'Jansen', label: 'open tijdperk' } }, 'panel'),
      makeCommand({ kind: 'toggleSeries', key: 's0' }, 'panel'),
    ]);
    if (!built.ok) throw new Error('expected ok');
    expect(built.dropped).toBe(0);
    expect(built.state.eraShadings.map((e) => e.id)).toEqual(['e-hidden', 'e-visible']);

    const pub = pruneForPublic(built, null);
    expect(pub.state.eraShadings.map((e) => e.id)).toEqual(['e-visible']);
    expect(JSON.stringify(pub)).not.toContain('Minister X');
  });
});

// Final-review fix A3 (ruling R16): series keys are positional (s0, s1, ...),
// so a stored log only means what the author meant if the FIRST render of the
// turn's instruction still produces the same series, in the same order, as
// the chart the turn stored when it was made.
describe('firstRenderMatchesEnvelope — A3 code-drift guard', () => {
  function withEnvelope(chart: unknown): DatasetTurnRecord {
    return { ...turn, envelope: { schemaVersion: 1, kind: 'chart', question: 'q', text: 't', instruction, ...(chart === undefined ? {} : { chart }) } } as unknown as DatasetTurnRecord;
  }
  it('true when the stored chart names the same series in the same order', () => {
    expect(firstRenderMatchesEnvelope(dataset, withEnvelope({ series: [{ label: 'Geheim BV' }, { label: 'Open NV' }] }))).toBe(true);
  });
  it('false when the order differs (s0 would now mean a different series)', () => {
    expect(firstRenderMatchesEnvelope(dataset, withEnvelope({ series: [{ label: 'Open NV' }, { label: 'Geheim BV' }] }))).toBe(false);
  });
  it('false when a label differs or the count differs', () => {
    expect(firstRenderMatchesEnvelope(dataset, withEnvelope({ series: [{ label: 'Geheim BV' }, { label: 'Ander NV' }] }))).toBe(false);
    expect(firstRenderMatchesEnvelope(dataset, withEnvelope({ series: [{ label: 'Geheim BV' }] }))).toBe(false);
  });
  it('false (fail closed) when the stored chart is present but malformed', () => {
    expect(firstRenderMatchesEnvelope(dataset, withEnvelope({ series: 'nope' }))).toBe(false);
    expect(firstRenderMatchesEnvelope(dataset, withEnvelope('nope'))).toBe(false);
  });
  it('true (check skipped) only when the envelope carries no chart at all', () => {
    expect(firstRenderMatchesEnvelope(dataset, withEnvelope(undefined))).toBe(true);
  });
  it('false for a turn with no instruction', () => {
    expect(firstRenderMatchesEnvelope(dataset, { ...withEnvelope(undefined), instruction: null })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Session 128 security-review fix wave (docs/superpowers/specs/
// 2026-09-25-own-data-publish-security-review.md, open-questions #322).
// ---------------------------------------------------------------------------

/** Any internal row reference: an aggregate (`agg:fn:r1:c2+r3:c2`, which
 * lists the group's member rows — and so its size n, which for `count` IS
 * the value), a derived one (`der:share_of_total:r1:c2|total:3`), or a bare
 * cell reference (`r1:c2`). None may reach the public payload (I-1). */
function expectNoInternalRefs(json: string): void {
  expect(json).not.toMatch(/agg:/);
  expect(json).not.toMatch(/der:/);
  expect(json).not.toMatch(/r\d+:c\d+/);
  expect(json).not.toMatch(/\|total:/);
}

function datasetFrom(id: number, cells: string[][]): UserDataset {
  return {
    id,
    userId: 'u1',
    sourceKind: 'file_csv',
    displayName: 'afdelingen.csv',
    sourceUrl: null,
    cells,
    profile: buildDatasetProfile(cells),
    status: 'ready',
    contentSha256: 'c0ffee',
    createdAt: '2026-09-06T00:00:00Z',
  };
}
function turnFor(datasetId: number, instr: Record<string, unknown>): DatasetTurnRecord {
  return { id: 70, userId: 'u1', datasetId, kind: 'chart', chartEmitted: true, instruction: instr } as unknown as DatasetTurnRecord;
}
function instructionWith(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    version: 2,
    kind: 'bar',
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
    ...overrides,
  };
}

// Complaints per year by department; the secret department is hidden. Its
// amounts are distinctive (7771..7775) so a leaked value is unmistakable.
const DEPT_CELLS = [
  ['Jaar', 'Afdeling', 'Bedrag'],
  ['2020', 'Geheime afdeling', '7771'],
  ['2020', 'Geheime afdeling', '7772'],
  ['2020', 'Geheime afdeling', '7773'],
  ['2020', 'Open afdeling', '11'],
  ['2021', 'Geheime afdeling', '7774'],
  ['2021', 'Geheime afdeling', '7775'],
  ['2021', 'Open afdeling', '12'],
  ['2021', 'Open afdeling', '13'],
];
const HIDDEN_DEPT_VALUES = ['7771', '7772', '7773', '7774', '7775', '23316', '23.316', '15549', '15.549', '7.772', '7.774,5', '7774,5'];

describe('pruneForPublic — I-1: no internal row reference ever reaches the payload', () => {
  const cases: [string, Record<string, unknown>][] = [
    ['count', { aggregate: { fn: 'count' } }],
    ['sum', { aggregate: { fn: 'sum' } }],
    ['mean', { aggregate: { fn: 'mean' } }],
    ['share_of_total', { derived: { op: 'share_of_total', b: null } }],
    ['sort by value (raw)', { sort: { by: 'value', direction: 'desc' } }],
    ['sort by value (sum)', { aggregate: { fn: 'sum' }, sort: { by: 'value', direction: 'desc' } }],
  ];
  for (const [name, overrides] of cases) {
    it(`${name}: a hidden series leaves no internal ref, label or value — and neither does a visible point`, () => {
      const ds = datasetFrom(60, DEPT_CELLS);
      const built = buildPublishedChart(ds, turnFor(60, instructionWith(overrides)), [makeCommand({ kind: 'toggleSeries', key: 's0' }, 'panel')]);
      if (!built.ok) throw new Error(`expected ok, got ${built.reason}`);
      expect(built.dropped).toBe(0);
      // Sanity: the unpruned spec really carries the internal refs the
      // public one must not (proves the fixture has something to leak).
      expect(JSON.stringify(built.spec)).toMatch(/agg:|der:|r\d+:c\d+/);

      const json = JSON.stringify(pruneForPublic(built, null));
      expectNoInternalRefs(json);
      expect(json).not.toContain('Geheime afdeling');
      for (const v of HIDDEN_DEPT_VALUES) expect(json).not.toContain(v);
    });
  }

  it('re-keys every point to opaque public ids and remaps notes, overlays and the headline through the same map', () => {
    const ds = datasetFrom(61, DEPT_CELLS);
    const built = buildPublishedChart(ds, turnFor(61, instructionWith({ aggregate: { fn: 'sum' } })), []);
    if (!built.ok) throw new Error('expected ok');
    // Visible = s1 (Open afdeling): its two aggregate points' internal refs.
    const [refA, refB] = built.spec.series[1]!.points.map((p) => p.rowRef) as [string, string];
    const rebuilt = buildPublishedChart(ds, turnFor(61, instructionWith({ aggregate: { fn: 'sum' } })), [
      makeCommand({ kind: 'toggleSeries', key: 's0' }, 'panel'),
      makeCommand({ kind: 'addNote', note: { id: `${refA}-x1`, resultId: refA, periodLabel: '2020', seriesLabel: 'Sum of Bedrag', text: 'begin' } }, 'panel'),
      makeCommand({ kind: 'addDerivedOverlay', overlay: { id: 'o-diff', calcKind: 'difference', resultIds: [refA, refB] } }, 'panel'),
      makeCommand({ kind: 'setHeadlineOverride', resultId: refB }, 'panel'),
    ]);
    if (!rebuilt.ok) throw new Error('expected ok');
    expect(rebuilt.dropped).toBe(0);

    const pub = pruneForPublic(rebuilt, null);
    expectNoInternalRefs(JSON.stringify(pub));
    const ids = pub.spec.series.flatMap((s) => s.points.map((p) => p.rowRef));
    for (const id of ids) expect(id).toMatch(/^p\d+$/);
    expect(new Set(ids).size).toBe(ids.length);

    const [pubA, pubB] = pub.spec.series[1]!.points.map((p) => p.rowRef);
    expect(pub.state.notes).toHaveLength(1);
    expect(pub.state.notes[0]!.resultId).toBe(pubA);
    expect(pub.state.notes[0]!.id).toMatch(/^n\d+$/);
    expect(pub.state.derivedOverlayRequests).toEqual([{ id: 'o-diff', calcKind: 'difference', resultIds: [pubA, pubB] }]);
    // Same value the author's card is served (11 → 25), from the same
    // derivation function; its own handle is opaque too.
    expect(pub.overlays['o-diff']!.value).toBe(14);
    expect(pub.state.headlineOverrideResultId).toBe(pubB);
  });
});

// I-2: sort by value orders every series' points by value — so a hidden
// slot that kept its own points in their own order would publish the hidden
// series' RANKING, and which categories it has at all (for `count`, a
// missing category IS a value: zero).
describe('pruneForPublic — I-2: a blanked slot carries no information about the hidden series', () => {
  function rankCells(vip: [string, string][]): string[][] {
    return [
      ['Jaar', 'Segment', 'Omzet'],
      ...vip.map(([year, v]) => [year, 'VIP', v]),
      ['2019', 'Normaal', '50'],
      ['2020', 'Normaal', '40'],
      ['2021', 'Normaal', '60'],
    ];
  }
  const sorted = instructionWith({ sort: { by: 'value', direction: 'desc' } });
  function publish(cells: string[][]) {
    const built = buildPublishedChart(datasetFrom(62, cells), turnFor(62, sorted), [makeCommand({ kind: 'toggleSeries', key: 's0' }, 'panel')]);
    if (!built.ok) throw new Error('expected ok');
    return { built, pub: pruneForPublic(built, null) };
  }

  it('orders the blanked slot by the VISIBLE x order, never the hidden ranking', () => {
    const { built, pub } = publish(rankCells([['2019', '10'], ['2020', '900'], ['2021', '300']]));
    // Premise: the unpruned hidden series is in its own value order.
    expect(built.spec.series[0]!.label).toBe('VIP');
    expect(built.spec.series[0]!.points.map((p) => p.xKey)).toEqual(['2020', '2021', '2019']);
    const visibleOrder = pub.spec.series[1]!.points.map((p) => p.xKey);
    expect(visibleOrder).toEqual(['2021', '2019', '2020']);
    expect(pub.spec.series[0]!.points.map((p) => p.xKey)).toEqual(visibleOrder);
  });

  it('any consumer taking the union of x keys in series order (hidden slot first) gets the visible order', () => {
    const { pub } = publish(rankCells([['2019', '10'], ['2020', '900'], ['2021', '300']]));
    const union: string[] = [];
    for (const s of pub.spec.series) for (const p of s.points) if (!union.includes(p.xKey)) union.push(p.xKey);
    expect(union).toEqual(pub.spec.series[1]!.points.map((p) => p.xKey));
  });

  it('two hidden series with different values, ranking and coverage produce the IDENTICAL blanked slot', () => {
    const a = publish(rankCells([['2019', '10'], ['2020', '900'], ['2021', '300']])).pub;
    const b = publish(rankCells([['2019', '999'], ['2020', '1']])).pub; // no 2021 row at all
    expect(a.spec.series[0]).toEqual(b.spec.series[0]);
    expect(a.spec.series[0]!.points).toHaveLength(3);
  });
});

// M-1: a note stores the series/period label the chart had WHEN it was
// added; a later setInstruction keeps the note (by design) while the series
// can now mean something else entirely.
describe('pruneForPublic — M-1: note labels are rebuilt from the final public spec', () => {
  const NOTE_CELLS = [
    ['Jaar', 'Klant', 'Regio', 'Omzet'],
    ['2020', 'Minister X', 'Noord', '100'],
    ['2020', 'Bakker', 'Zuid', '200'],
    ['2021', 'Minister X', 'Noord', '110'],
    ['2021', 'Bakker', 'Zuid', '210'],
  ];
  it('a note made under "series by Klant" shows the Regio series label after a switch, never the old customer name', () => {
    const byKlant = instructionWith({ kind: 'line', y: ['c3'], seriesBy: 'c1' });
    const byRegio = { ...instructionWith({ kind: 'line', y: ['c3'], seriesBy: 'c2' }) };
    delete byRegio.reading;
    delete byRegio.confidence;
    const built = buildPublishedChart(datasetFrom(63, NOTE_CELLS), turnFor(63, byKlant), [
      makeCommand({ kind: 'addNote', note: { id: 'n-old', resultId: 'r1:c3', periodLabel: '2020', seriesLabel: 'Minister X', text: 'let op' } }, 'panel'),
      makeCommand({ kind: 'setInstruction', instruction: byRegio as unknown as ClientChartInstruction, summary: 'per regio' }, 'panel'),
    ]);
    if (!built.ok) throw new Error('expected ok');
    expect(built.dropped).toBe(0);
    expect(built.spec.series.map((s) => s.label)).toEqual(['Noord', 'Zuid']);
    // Premise: the raw state still carries the stale label.
    expect(built.state.notes[0]!.seriesLabel).toBe('Minister X');

    const pub = pruneForPublic(built, null);
    expect(JSON.stringify(pub)).not.toContain('Minister X');
    expect(pub.state.notes).toHaveLength(1);
    expect(pub.state.notes[0]).toMatchObject({ seriesLabel: 'Noord', periodLabel: '2020', text: 'let op' });
  });
});

// I-4 (a): the whole log goes through the capped schema — at publish AND at
// read time — and the number of overlays a public view resolves is capped.
describe('buildPublishedChart — I-4: the log and the overlay count are capped', () => {
  it('a log of 200 commands replays; 201 is invalid_log (the capped schema, not entry by entry)', () => {
    const titles = (n: number) => Array.from({ length: n }, (_, i) => makeCommand({ kind: 'setTitle', title: `t${i}` }, 'panel'));
    expect(buildPublishedChart(dataset, turn, titles(200)).ok).toBe(true);
    expect(buildPublishedChart(dataset, turn, titles(201))).toEqual({ ok: false, reason: 'invalid_log' });
  });
  it(`${PUBLIC_OVERLAY_MAX} overlays are fine; one more refuses the whole chart`, () => {
    const overlays = (n: number) =>
      Array.from({ length: n }, (_, i) =>
        makeCommand({ kind: 'addDerivedOverlay', overlay: { id: `o${i}`, calcKind: 'difference', resultIds: ['r2:c2', 'r4:c2'] } }, 'panel'),
      );
    const ok = buildPublishedChart(dataset, turn, overlays(PUBLIC_OVERLAY_MAX));
    if (!ok.ok) throw new Error('expected ok');
    expect(Object.keys(pruneForPublic(ok, null).overlays)).toHaveLength(PUBLIC_OVERLAY_MAX);
    expect(buildPublishedChart(dataset, turn, overlays(PUBLIC_OVERLAY_MAX + 1))).toEqual({ ok: false, reason: 'too_many_overlays' });
  });
});

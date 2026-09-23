// Co-pilot phase 4 (session 115, #274): the server action that re-runs a
// registered derivation (difference/mean) over an ALREADY-AUDITED chart's own
// cells, on demand. No CBS fetch, no new audit_answers row — the source cells
// were already fetched and verified once, when this chart's answer was first
// built; this only re-applies deterministic math to them (R5). Mirrors the
// mocking pattern from dataset-copilot-actions.test.ts and
// chart-headline-actions.test.ts.
import { describe, expect, it, vi } from 'vitest';

const { currentUserId, getDb } = vi.hoisted(() => ({
  currentUserId: vi.fn().mockResolvedValue('u1'),
  getDb: vi.fn(),
}));
vi.mock('../lib/current-user.ts', () => ({ currentUserId }));
vi.mock('../lib/db.ts', () => ({ getDb }));

const { loadAuditRecord, isRedacted } = vi.hoisted(() => ({
  loadAuditRecord: vi.fn(),
  isRedacted: vi.fn().mockReturnValue(false),
}));
vi.mock('../../src/answer/audit/index.ts', () => ({ loadAuditRecord, isRedacted }));

vi.mock('../lib/error-report.ts', () => ({ reportError: vi.fn().mockResolvedValue(undefined) }));

import { requestChartDerivation } from './chart-derivation-actions.ts';

const spec = { unit: 'aantal', series: [{ label: 'x', regionCode: 'GM0599', points: [
  { resultId: 'r1', periodCode: '2019', periodLabel: '2019', value: 10, formattedValue: '10', decimals: 0, status: 'Definitief', provisional: false, valueAttribute: 'None' },
  { resultId: 'r2', periodCode: '2020', periodLabel: '2020', value: 20, formattedValue: '20', decimals: 0, status: 'Definitief', provisional: false, valueAttribute: 'None' },
] }] };

describe('requestChartDerivation', () => {
  it('refuses a non-answer key (own-data charts have no audit row to re-read)', async () => {
    const result = await requestChartDerivation({ kind: 'turn', id: 1 }, 'difference', ['r1', 'r2']);
    expect(result.ok).toBe(false);
  });

  it('re-derives a difference over the audited chart\'s own cells, no new CBS fetch, no new audit row', async () => {
    loadAuditRecord.mockResolvedValue({ id: 5, userId: 'u1', response: { kind: 'answer', chart: spec, cells: [], derivations: [] } });
    const result = await requestChartDerivation({ kind: 'answer', id: 5 }, 'difference', ['r1', 'r2']);
    expect(result).toEqual({ ok: true, record: expect.objectContaining({ kind: 'difference', value: 10 }) });
  });

  it('code-review fix round 3: sorts cells by periodCode before deriving, so clicking the LATER point first never flips the sign', async () => {
    loadAuditRecord.mockResolvedValue({ id: 5, userId: 'u1', response: { kind: 'answer', chart: spec, cells: [], derivations: [] } });
    // r2 (2020) clicked first, r1 (2019) clicked second — the reverse of the
    // chronological order. Before this fix, `requestChartDerivation` passed
    // resultIds straight through to `deriveDifference`, which treats
    // cells[0] as "earlier" unconditionally — this would have returned -10.
    const result = await requestChartDerivation({ kind: 'answer', id: 5 }, 'difference', ['r2', 'r1']);
    expect(result).toEqual({ ok: true, record: expect.objectContaining({ kind: 'difference', value: 10 }) });
  });

  it('#292(b): refuses the same point named twice, rather than computing an automatic zero', async () => {
    loadAuditRecord.mockResolvedValue({ id: 5, userId: 'u1', response: { kind: 'answer', chart: spec, cells: [], derivations: [] } });
    expect((await requestChartDerivation({ kind: 'answer', id: 5 }, 'difference', ['r1', 'r1'])).ok).toBe(false);
    expect((await requestChartDerivation({ kind: 'answer', id: 5 }, 'mean', ['r1', 'r2', 'r1'])).ok).toBe(false);
  });

  it('refuses a resultId not present on that chart, rather than guessing', async () => {
    loadAuditRecord.mockResolvedValue({ id: 5, userId: 'u1', response: { kind: 'answer', chart: spec, cells: [], derivations: [] } });
    const result = await requestChartDerivation({ kind: 'answer', id: 5 }, 'difference', ['r1', 'not-real']);
    expect(result.ok).toBe(false);
  });

  it('refuses an answer belonging to a different user, rather than leaking its data (security fix, final review)', async () => {
    loadAuditRecord.mockResolvedValue({ id: 5, userId: 'someone-else', response: { kind: 'answer', chart: spec, cells: [], derivations: [] } });
    const result = await requestChartDerivation({ kind: 'answer', id: 5 }, 'difference', ['r1', 'r2']);
    expect(result.ok).toBe(false);
  });

  it('refuses a redacted answer', async () => {
    isRedacted.mockReturnValueOnce(true);
    loadAuditRecord.mockResolvedValue({ id: 5, userId: 'u1', response: { kind: 'answer', chart: spec, cells: [], derivations: [] } });
    const result = await requestChartDerivation({ kind: 'answer', id: 5 }, 'difference', ['r1', 'r2']);
    expect(result.ok).toBe(false);
  });

  it('refuses when the audit row has no chart at all', async () => {
    loadAuditRecord.mockResolvedValue({ id: 5, userId: 'u1', response: { kind: 'answer', chart: null, cells: [], derivations: [] } });
    const result = await requestChartDerivation({ kind: 'answer', id: 5 }, 'difference', ['r1', 'r2']);
    expect(result.ok).toBe(false);
  });

  // Minor fix (final review): a stored row can have `chart: undefined`
  // (never written, rather than explicitly written as null) — the old
  // `spec === null` check missed this case and fell through to the generic
  // catch/reportError path instead of this specific, honest refusal.
  it('refuses when the audit row\'s chart is undefined (not explicitly null), with the same honest reason as a null chart', async () => {
    loadAuditRecord.mockResolvedValue({ id: 5, userId: 'u1', response: { kind: 'answer', chart: undefined, cells: [], derivations: [] } });
    const result = await requestChartDerivation({ kind: 'answer', id: 5 }, 'difference', ['r1', 'r2']);
    expect(result).toEqual({ ok: false, reason: 'this answer has no chart to derive from' });
  });

  it('refuses derivation on null-valued cells with an accurate CBS reason message', async () => {
    const specWithNull = { unit: 'aantal', series: [{ label: 'x', regionCode: 'GM0599', points: [
      { resultId: 'r1', periodCode: '2019', periodLabel: '2019', value: 10, formattedValue: '10', decimals: 0, status: 'Definitief', provisional: false, valueAttribute: 'None' },
      { resultId: 'r2', periodCode: '2020', periodLabel: '2020', value: null, formattedValue: null, decimals: 0, status: 'Definitief', provisional: false, valueAttribute: 'DataNotAvailable' },
    ] }] };
    loadAuditRecord.mockResolvedValue({ id: 5, userId: 'u1', response: { kind: 'answer', chart: specWithNull, cells: [], derivations: [] } });
    const result = await requestChartDerivation({ kind: 'answer', id: 5 }, 'mean', ['r1', 'r2']);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('DataNotAvailable');
    }
  });
});

// #316 — the break-in-series guard for a Eurostat chart's on-demand
// difference. Not reader-reachable today (no Eurostat answer can be charted
// until E2a step 6), but must be closed before that flip. Mirrors
// chart-whole-verification-actions.test.ts's fake-db-keyed-on-SQL-text
// pattern: the fake only answers the one `from observations` window query
// findEurostatWindowBreaks issues, and asserts the exact table/measure/dims
// it was called with.
describe('requestChartDerivation — Eurostat break-in-series guard (#316)', () => {
  const EUROSTAT_TABLE = 'eurostat:ei_bsin_q_r2';
  const MEASURE = 'obsValue';
  const DIMS = {};

  function eurostatPoint(resultId: string, periodCode: string, value: number, status = 'Published') {
    return { resultId, periodCode, periodLabel: periodCode, value, formattedValue: String(value), decimals: 0, status, provisional: status !== 'Published', valueAttribute: 'None' };
  }

  function resultCell(resultId: string, regionCode: string, periodCode: string, measure: string | undefined = MEASURE) {
    return { resultId, tableId: EUROSTAT_TABLE, measure, measureTitle: 'A measure', regionCode, regionLabel: regionCode, periodCode, periodLabel: periodCode, grain: 'year', dims: DIMS, dimLabels: {}, value: 1, unit: 'aantal', decimals: 0, status: 'Published', provisional: false, valueAttribute: 'None', batchId: 1 };
  }

  function eurostatSpec(points: ReturnType<typeof eurostatPoint>[], regionCode: string | null = 'DE') {
    return { unit: 'aantal', dims: DIMS, series: [{ label: regionCode ?? 'NL', regionCode, points }], attribution: { tableId: EUROSTAT_TABLE } };
  }

  /** A fake db that answers only the window-break SQL, returning `windowRows`
   * verbatim and asserting the coordinate it was queried with — including
   * the region codes, so a fix-round regression (passing the wrong sentinel
   * for a geo-less table) fails loudly rather than silently. */
  function fakeWindowDb(windowRows: { region_code: string; period_code: string; status: string }[], expectedRegionCodes = ['DE']) {
    const query = vi.fn(async (sql: string, params: unknown[]) => {
      if (sql.includes('from observations')) {
        const [tableId, measure, dims, regionCodes] = params as [string, string, string, string[]];
        expect(tableId).toBe(EUROSTAT_TABLE);
        expect(measure).toBe(MEASURE);
        expect(dims).toBe(JSON.stringify(DIMS));
        expect(regionCodes).toEqual(expectedRegionCodes);
        return { rows: windowRows };
      }
      throw new Error(`unexpected SQL in test: ${sql}`);
    });
    return { query };
  }

  function stubRecord(points: ReturnType<typeof eurostatPoint>[], cells: ReturnType<typeof resultCell>[], regionCode: string | null = 'DE') {
    loadAuditRecord.mockResolvedValue({
      id: 5,
      userId: 'u1',
      response: { kind: 'answer', chart: eurostatSpec(points, regionCode), result: { cells }, cells: [], derivations: [] },
    });
  }

  it('(a) a break flagged on the LATER compared period refuses with the stable, translatable reason', async () => {
    const points = [eurostatPoint('r1', '2020JJ00', 10), eurostatPoint('r2', '2021JJ00', 20, 'b')];
    const cells = [resultCell('r1', 'DE', '2020JJ00'), resultCell('r2', 'DE', '2021JJ00')];
    stubRecord(points, cells);
    // The later period's own observation row carries the break flag — found
    // by the window query same as it would in the real database (the query
    // window is period > first, <= last, so it covers the last endpoint too).
    getDb.mockReturnValue(fakeWindowDb([{ region_code: 'DE', period_code: '2021JJ00', status: 'b' }]));
    const result = await requestChartDerivation({ kind: 'answer', id: 5 }, 'difference', ['r1', 'r2']);
    expect(result).toEqual({ ok: false, reason: 'a Eurostat break in series lies between these points' });
  });

  it('(b) a combined "bp" flag on a period BETWEEN the two chosen chart points (not itself on the chart) refuses', async () => {
    // Only 2020 and 2022 are plotted; 2021 is not a chart point at all — the
    // break can only be found by querying the whole window from `observations`.
    const points = [eurostatPoint('r1', '2020JJ00', 10), eurostatPoint('r2', '2022JJ00', 30)];
    const cells = [resultCell('r1', 'DE', '2020JJ00'), resultCell('r2', 'DE', '2022JJ00')];
    stubRecord(points, cells);
    getDb.mockReturnValue(fakeWindowDb([{ region_code: 'DE', period_code: '2021JJ00', status: 'bp' }]));
    const result = await requestChartDerivation({ kind: 'answer', id: 5 }, 'difference', ['r1', 'r2']);
    expect(result).toEqual({ ok: false, reason: 'a Eurostat break in series lies between these points' });
  });

  it('(c) no break anywhere in the window: the difference computes normally', async () => {
    const points = [eurostatPoint('r1', '2020JJ00', 10), eurostatPoint('r2', '2022JJ00', 30)];
    const cells = [resultCell('r1', 'DE', '2020JJ00'), resultCell('r2', 'DE', '2022JJ00')];
    stubRecord(points, cells);
    getDb.mockReturnValue(fakeWindowDb([]));
    const result = await requestChartDerivation({ kind: 'answer', id: 5 }, 'difference', ['r1', 'r2']);
    expect(result).toEqual({ ok: true, record: expect.objectContaining({ kind: 'difference', value: 20 }) });
  });

  it('(d) a CBS spec whose status string happens to be "b" is unaffected — no window query, byte-identical result', async () => {
    const spec = { unit: 'aantal', series: [{ label: 'x', regionCode: 'GM0599', points: [
      { resultId: 'r1', periodCode: '2019', periodLabel: '2019', value: 10, formattedValue: '10', decimals: 0, status: 'Definitief', provisional: false, valueAttribute: 'None' },
      { resultId: 'r2', periodCode: '2020', periodLabel: '2020', value: 20, formattedValue: '20', decimals: 0, status: 'b', provisional: false, valueAttribute: 'None' },
    ] }], attribution: { tableId: '85984NED' } };
    const query = vi.fn(async () => { throw new Error('CBS derivation must never query the database'); });
    getDb.mockReturnValue({ query });
    loadAuditRecord.mockResolvedValue({ id: 5, userId: 'u1', response: { kind: 'answer', chart: spec, result: { cells: [] }, cells: [], derivations: [] } });
    const result = await requestChartDerivation({ kind: 'answer', id: 5 }, 'difference', ['r1', 'r2']);
    expect(result).toEqual({ ok: true, record: expect.objectContaining({ kind: 'difference', value: 10 }) });
    expect(query).not.toHaveBeenCalled();
  });

  it('(e) a Eurostat spec whose measure cannot be determined from the stored result refuses, fail closed', async () => {
    const points = [eurostatPoint('r1', '2020JJ00', 10), eurostatPoint('r2', '2022JJ00', 30)];
    // No matching cells at all in the stored result — the audited row cannot
    // say what measure this comparison is over.
    stubRecord(points, []);
    const query = vi.fn(async () => { throw new Error('must refuse before ever querying the window'); });
    getDb.mockReturnValue({ query });
    const result = await requestChartDerivation({ kind: 'answer', id: 5 }, 'difference', ['r1', 'r2']);
    expect(result).toEqual({ ok: false, reason: 'cannot determine the Eurostat measure for this pair of points — refusing rather than skip the break check' });
    expect(query).not.toHaveBeenCalled();
  });

  // Fix round 1 (#316): a table with no geo dimension displays `regionCode:
  // null` on its ResultCells/ChartSeries (src/query/run.ts), but
  // resolve.ts's own `regionCodes` default/sentinel for such a table is `['']`
  // — the value actually stored as `observations.region_code`. The action
  // must query with that sentinel, not refuse just because the display value
  // is null.
  it('(f) a geo-less Eurostat spec (regionCode null) with no break in the window computes normally, querying the "" sentinel region', async () => {
    const points = [eurostatPoint('r1', '2020JJ00', 10), eurostatPoint('r2', '2022JJ00', 30)];
    const cells = [resultCell('r1', 'NL', '2020JJ00'), resultCell('r2', 'NL', '2022JJ00')];
    stubRecord(points, cells, null);
    getDb.mockReturnValue(fakeWindowDb([], ['']));
    const result = await requestChartDerivation({ kind: 'answer', id: 5 }, 'difference', ['r1', 'r2']);
    expect(result).toEqual({ ok: true, record: expect.objectContaining({ kind: 'difference', value: 20 }) });
  });

  it('(g) a geo-less Eurostat spec with a "b" in the window (region "") still refuses with the stable break reason', async () => {
    const points = [eurostatPoint('r1', '2020JJ00', 10), eurostatPoint('r2', '2022JJ00', 30)];
    const cells = [resultCell('r1', 'NL', '2020JJ00'), resultCell('r2', 'NL', '2022JJ00')];
    stubRecord(points, cells, null);
    getDb.mockReturnValue(fakeWindowDb([{ region_code: '', period_code: '2021JJ00', status: 'b' }], ['']));
    const result = await requestChartDerivation({ kind: 'answer', id: 5 }, 'difference', ['r1', 'r2']);
    expect(result).toEqual({ ok: false, reason: 'a Eurostat break in series lies between these points' });
  });

  it('mean stays unguarded (ruling R6: a mean is not a cross-period comparison) — no window query even across a break', async () => {
    const points = [eurostatPoint('r1', '2020JJ00', 10), eurostatPoint('r2', '2021JJ00', 20, 'b'), eurostatPoint('r3', '2022JJ00', 30)];
    const cells = [resultCell('r1', 'DE', '2020JJ00'), resultCell('r2', 'DE', '2021JJ00'), resultCell('r3', 'DE', '2022JJ00')];
    stubRecord(points, cells);
    const query = vi.fn(async () => { throw new Error('mean must never query the window'); });
    getDb.mockReturnValue({ query });
    const result = await requestChartDerivation({ kind: 'answer', id: 5 }, 'mean', ['r1', 'r2', 'r3']);
    expect(result).toEqual({ ok: true, record: expect.objectContaining({ kind: 'mean', value: 20 }) });
    expect(query).not.toHaveBeenCalled();
  });
});

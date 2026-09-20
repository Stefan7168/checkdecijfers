// Chart co-pilot phase 5b (session 117, spec §11): the on-demand verified-
// whole server action — re-reads an ALREADY-AUDITED region-set chart's own
// cells (the parts), fetches the roster's CBS-published parent total (the
// whole) from OUR database, and reports per period whether the parts add up.
// No CBS fetch, no new audit row. Mirrors chart-derivation-actions.test.ts's
// mocking pattern; the database is a small fake that answers the three
// statements the action (and region-set.ts's `codesInGroups`) issue, keyed
// on the SQL text, so the exact coordinates each statement selects on are
// asserted, never assumed.
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

const { reportError } = vi.hoisted(() => ({ reportError: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../lib/error-report.ts', () => ({ reportError }));

import { verifyPartsSumToWhole, wholeSumTolerance } from '../../src/query/whole-verification.ts';
import { requestWholeVerification } from './chart-whole-verification-actions.ts';

const TABLE = '03759ned';
const MEASURE = 'Bevolking_1';
const DIMS = { Geslacht: 'T001038' };

function cell(regionCode: string, periodCode: string, value: number | null, valueAttribute = 'None') {
  return {
    resultId: `${TABLE}:${MEASURE}:${regionCode}:${periodCode}:Geslacht=T001038`,
    tableId: TABLE,
    measure: MEASURE,
    measureTitle: 'Bevolking',
    regionCode,
    regionLabel: regionCode,
    periodCode,
    periodLabel: periodCode,
    grain: 'year',
    dims: DIMS,
    dimLabels: { Geslacht: 'Totaal' },
    value,
    unit: 'aantal',
    decimals: 0,
    status: 'Definitief',
    provisional: false,
    valueAttribute,
    batchId: 1,
  };
}

/** A three-province roster over two years, the way buildChartSpec lays a
 * region-set answer out: one series per region, one point per period. */
function fixture(opts: { scope?: unknown; withheld?: boolean } = {}) {
  const cells = [
    cell('PV20', '2020', 100),
    cell('PV21', '2020', 200),
    cell('PV22', '2020', opts.withheld ? null : 300, opts.withheld ? 'DataNotAvailable' : 'None'),
    cell('PV20', '2021', 110),
    cell('PV21', '2021', 210),
    cell('PV22', '2021', 310),
  ];
  const byRegion = new Map<string, typeof cells>();
  for (const c of cells) byRegion.set(c.regionCode, [...(byRegion.get(c.regionCode) ?? []), c]);
  const spec = {
    schemaVersion: 1,
    kind: 'bar',
    unit: 'aantal',
    regionScope: 'scope' in opts ? opts.scope : { kind: 'all_provincies' },
    series: [...byRegion.entries()].map(([regionCode, cs]) => ({
      label: regionCode,
      regionCode,
      points: cs.map((c) => ({
        resultId: c.resultId,
        periodCode: c.periodCode,
        periodLabel: c.periodLabel,
        value: c.value,
        formattedValue: c.value === null ? null : String(c.value),
        decimals: 0,
        status: 'Definitief',
        provisional: false,
        valueAttribute: c.valueAttribute,
      })),
    })),
  };
  return { spec, cells };
}

interface FakeDbOptions {
  /** The 'NL' group's codes on the table's geo dimension (default: one code). */
  nationalCodes?: string[];
  /** The stored whole per period; a period absent here has no row at all. */
  wholes?: Record<string, { value: number | null; decimals?: number; valueAttribute?: string }>;
  geoDimension?: string | null;
}

function fakeDb(opts: FakeDbOptions = {}) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    if (sql.includes('from cbs_tables')) {
      const geo = opts.geoDimension === undefined ? 'RegioS' : opts.geoDimension;
      const dims = [{ name: 'Perioden', kind: 'TimeDimension' }, ...(geo === null ? [] : [{ name: geo, kind: 'GeoDimension' }])];
      return { rows: [{ expected_dimensions: dims }] };
    }
    if (sql.includes('from dimension_labels')) {
      const [, dimension, groups] = params as [string, string, string[]];
      if (dimension !== 'RegioS' || !groups.includes('NL')) return { rows: [] };
      return { rows: (opts.nationalCodes ?? ['NL01']).map((code) => ({ code })) };
    }
    if (sql.includes('from observations')) {
      const [tableId, measure, dims, regionCode, periodCodes] = params as [string, string, string, string, string[]];
      expect(tableId).toBe(TABLE);
      expect(measure).toBe(MEASURE);
      expect(dims).toBe(JSON.stringify(DIMS));
      const rows = periodCodes.flatMap((p) => {
        const w = opts.wholes?.[p];
        if (!w) return [];
        return [{ period_code: p, value: w.value, decimals: w.decimals ?? 0, value_attribute: w.valueAttribute ?? 'None', region_code: regionCode }];
      });
      return { rows };
    }
    throw new Error(`unexpected SQL in test: ${sql}`);
  });
  return { db: { query }, calls };
}

/** The audit row's stored roster coverage (#253, `ValidatedResult.regionSet`)
 * — complete by default, the way run.ts records a roster every member of
 * which has a row. The final-review fix (I1) refuses BEFORE any arithmetic
 * unless this says complete, so every verifying test below carries it. */
function coverage(over: Partial<{ scope: unknown; rosterSize: number; withheld: string[]; missing: string[]; complete: boolean }> = {}) {
  return { scope: { kind: 'all_provincies' }, rosterSize: 3, notApplicable: [], withheld: [], missing: [], complete: true, ...over };
}

/** `regionSet` is present-only (docs/13): this sentinel means the key is
 * absent altogether, as on a pre-#253 row (an explicit `undefined` argument
 * would only fall through to the parameter default). */
const NO_REGION_SET = Symbol('no regionSet key');

function stubRecord(fx: ReturnType<typeof fixture>, userId = 'u1', regionSet: unknown = coverage()) {
  loadAuditRecord.mockResolvedValue({
    id: 5,
    userId,
    response: {
      kind: 'answer',
      chart: fx.spec,
      result: { cells: fx.cells, ...(regionSet === NO_REGION_SET ? {} : { regionSet }) },
      cells: fx.cells,
      derivations: [],
    },
  });
}

describe('requestWholeVerification', () => {
  it('refuses a non-answer key (own-data charts have no audit row to re-read)', async () => {
    const result = await requestWholeVerification({ kind: 'turn', id: 1 }, ['2020']);
    expect(result.ok).toBe(false);
  });

  it('refuses a signed-out caller and never touches the database', async () => {
    currentUserId.mockResolvedValueOnce(null);
    const { db } = fakeDb();
    getDb.mockReturnValue(db);
    const result = await requestWholeVerification({ kind: 'answer', id: 5 }, ['2020']);
    expect(result).toEqual({ ok: false });
    expect(db.query).not.toHaveBeenCalled();
  });

  it('verifies each requested period independently: parts that sum to the stored national total pass', async () => {
    const fx = fixture();
    stubRecord(fx);
    const { db, calls } = fakeDb({ wholes: { '2020': { value: 600 }, '2021': { value: 630 } } });
    getDb.mockReturnValue(db);
    const result = await requestWholeVerification({ kind: 'answer', id: 5 }, ['2020', '2021']);
    expect(result).toEqual({ ok: true, periods: { '2020': { verified: true }, '2021': { verified: true } } });
    // The whole was fetched at the parts' OWN coordinates, at the ONE code
    // the 'NL' group resolved to, for both periods in one statement.
    const wholeFetch = calls.find((c) => c.sql.includes('from observations'))!;
    expect(wholeFetch.params).toEqual([TABLE, MEASURE, JSON.stringify(DIMS), 'NL01', ['2020', '2021']]);
    // Exactly the three statements: the geo dimension, the group's codes, the wholes.
    expect(calls.map((c) => /from (\w+)/.exec(c.sql)![1])).toEqual(['cbs_tables', 'dimension_labels', 'observations']);
  });

  it('a genuine mismatch in ONE period refuses only that period (sum_mismatch), the other still verifies', async () => {
    const fx = fixture();
    stubRecord(fx);
    // 2021's parts sum to 630; a stored total of 700 is far outside the
    // 0.5% tolerance. 2020 still matches its own total.
    const { db } = fakeDb({ wholes: { '2020': { value: 600 }, '2021': { value: 700 } } });
    getDb.mockReturnValue(db);
    const result = await requestWholeVerification({ kind: 'answer', id: 5 }, ['2020', '2021']);
    expect(result).toEqual({
      ok: true,
      periods: { '2020': { verified: true }, '2021': { verified: false, reason: 'sum_mismatch' } },
    });
  });

  it('a period whose total CBS has not published (no row) refuses with missing_whole, never treated as a match', async () => {
    const fx = fixture();
    stubRecord(fx);
    const { db } = fakeDb({ wholes: { '2020': { value: 600 } } });
    getDb.mockReturnValue(db);
    const result = await requestWholeVerification({ kind: 'answer', id: 5 }, ['2020', '2021']);
    expect(result).toEqual({
      ok: true,
      periods: { '2020': { verified: true }, '2021': { verified: false, reason: 'missing_whole' } },
    });
  });

  it('a stored total that is itself withheld (null value with a CBS reason) refuses with missing_whole', async () => {
    const fx = fixture();
    stubRecord(fx);
    const { db } = fakeDb({ wholes: { '2020': { value: null, valueAttribute: 'DataNotAvailable' } } });
    getDb.mockReturnValue(db);
    const result = await requestWholeVerification({ kind: 'answer', id: 5 }, ['2020']);
    expect(result).toEqual({ ok: true, periods: { '2020': { verified: false, reason: 'missing_whole' } } });
  });

  it('a withheld PART refuses that period with withheld_member — unknown is never zero', async () => {
    const fx = fixture({ withheld: true });
    // A real audit row with a withheld member records `complete: false` and
    // is refused earlier as incomplete_roster (the test below); stubbing it
    // complete here exercises the pure check's OWN null guard as a second,
    // independent line of defence.
    stubRecord(fx);
    // 2020's two known parts sum to 300; a total of 300 would "match" if
    // the withheld member were silently treated as zero.
    const { db } = fakeDb({ wholes: { '2020': { value: 300 }, '2021': { value: 630 } } });
    getDb.mockReturnValue(db);
    const result = await requestWholeVerification({ kind: 'answer', id: 5 }, ['2020', '2021']);
    expect(result).toEqual({
      ok: true,
      periods: { '2020': { verified: false, reason: 'withheld_member' }, '2021': { verified: true } },
    });
  });

  it('a gemeenten-in-provincie roster checks against the named province\'s OWN cell, with no group lookup', async () => {
    const fx = fixture({ scope: { kind: 'gemeenten_in_provincie', parent: 'PV26' } });
    stubRecord(fx);
    const { db, calls } = fakeDb({ wholes: { '2020': { value: 600 } } });
    getDb.mockReturnValue(db);
    const result = await requestWholeVerification({ kind: 'answer', id: 5 }, ['2020']);
    expect(result).toEqual({ ok: true, periods: { '2020': { verified: true } } });
    const wholeFetch = calls.find((c) => c.sql.includes('from observations'))!;
    expect(wholeFetch.params[3]).toBe('PV26');
    expect(calls.some((c) => c.sql.includes('from dimension_labels'))).toBe(false);
    expect(calls.some((c) => c.sql.includes('from cbs_tables'))).toBe(false);
  });

  // Final-review fix (I1): the incomplete-roster gap. A member with NO
  // observation row is not a null-valued part — it is no part at all, so
  // the sum check cannot see it. The only thing between an incomplete
  // roster and a false "verified" is then the rounding tolerance, which a
  // small gemeente sits inside. These tests pin the case the review found
  // nobody had tested: the missing member's true value is INSIDE tolerance.
  describe('incomplete roster (I1)', () => {
    /** A three-gemeente roster of PV26 where the smallest gemeente (GM0088,
     * 400 of a 100 000 province total — 0.4%, inside the 0.5% tolerance)
     * has no row at all: only two members reach the chart. */
    function incompleteGemeentenFixture() {
      const cells = [cell('GM0080', '2020', 60_000), cell('GM0085', '2020', 39_600)];
      const spec = {
        schemaVersion: 1,
        kind: 'bar',
        unit: 'aantal',
        regionScope: { kind: 'gemeenten_in_provincie', parent: 'PV26' },
        series: cells.map((c) => ({
          label: c.regionCode,
          regionCode: c.regionCode,
          points: [
            {
              resultId: c.resultId,
              periodCode: c.periodCode,
              periodLabel: c.periodLabel,
              value: c.value,
              formattedValue: String(c.value),
              decimals: 0,
              status: 'Definitief',
              provisional: false,
              valueAttribute: c.valueAttribute,
            },
          ],
        })),
      };
      return { spec, cells };
    }
    const PROVINCE_TOTAL = 100_000;

    it('the naive sum check alone WOULD pass this roster — the gap is real', () => {
      const fx = incompleteGemeentenFixture();
      const presentSum = fx.cells.reduce((t, c) => t + (c.value as number), 0);
      expect(PROVINCE_TOTAL - presentSum).toBe(400);
      expect(400).toBeLessThanOrEqual(wholeSumTolerance(PROVINCE_TOTAL, 0));
      expect(verifyPartsSumToWhole(fx.cells, { value: PROVINCE_TOTAL, decimals: 0, valueAttribute: 'None' })).toEqual({ verified: true });
    });

    it('a roster whose stored coverage says a member is missing is refused as incomplete_roster, never verified, and no whole is fetched', async () => {
      const fx = incompleteGemeentenFixture();
      stubRecord(
        fx,
        'u1',
        coverage({ scope: { kind: 'gemeenten_in_provincie', parent: 'PV26' }, rosterSize: 3, missing: ['GM0088'], complete: false }),
      );
      const { db } = fakeDb({ wholes: { '2020': { value: PROVINCE_TOTAL } } });
      getDb.mockReturnValue(db);
      const result = await requestWholeVerification({ kind: 'answer', id: 5 }, ['2020']);
      expect(result).toEqual({ ok: true, periods: { '2020': { verified: false, reason: 'incomplete_roster' } } });
      expect(db.query).not.toHaveBeenCalled();
    });

    it('a withheld member also makes the stored coverage incomplete: refused before any arithmetic, for EVERY requested period', async () => {
      const fx = fixture({ withheld: true });
      stubRecord(fx, 'u1', coverage({ withheld: ['PV22'], complete: false }));
      const { db } = fakeDb({ wholes: { '2020': { value: 300 }, '2021': { value: 630 } } });
      getDb.mockReturnValue(db);
      const result = await requestWholeVerification({ kind: 'answer', id: 5 }, ['2020', '2021']);
      expect(result).toEqual({
        ok: true,
        periods: { '2020': { verified: false, reason: 'incomplete_roster' }, '2021': { verified: false, reason: 'incomplete_roster' } },
      });
      expect(db.query).not.toHaveBeenCalled();
    });

    it('a row with no regionSet key at all is never assumed complete: incomplete_roster, no database touched', async () => {
      const fx = fixture();
      stubRecord(fx, 'u1', NO_REGION_SET);
      const { db } = fakeDb({ wholes: { '2020': { value: 600 } } });
      getDb.mockReturnValue(db);
      const result = await requestWholeVerification({ kind: 'answer', id: 5 }, ['2020']);
      expect(result).toEqual({ ok: true, periods: { '2020': { verified: false, reason: 'incomplete_roster' } } });
      expect(db.query).not.toHaveBeenCalled();
    });
  });

  it('refuses the whole request when the stored spec carries no region scope (a hand-picked list is never a whole)', async () => {
    const fx = fixture({ scope: null });
    stubRecord(fx);
    const { db } = fakeDb({ wholes: { '2020': { value: 600 } } });
    getDb.mockReturnValue(db);
    const result = await requestWholeVerification({ kind: 'answer', id: 5 }, ['2020']);
    expect(result).toEqual({ ok: false, reason: 'this chart was not built from a complete set of regions' });
    expect(db.query).not.toHaveBeenCalled();
  });

  it('refuses the whole request for a pre-5b stored spec with no regionScope key at all', async () => {
    const fx = fixture();
    delete (fx.spec as { regionScope?: unknown }).regionScope;
    stubRecord(fx);
    getDb.mockReturnValue(fakeDb().db);
    const result = await requestWholeVerification({ kind: 'answer', id: 5 }, ['2020']);
    expect(result.ok).toBe(false);
  });

  it('refuses a scope this phase defines no whole for (all_gemeenten) rather than guessing the national total', async () => {
    const fx = fixture({ scope: { kind: 'all_gemeenten' } });
    stubRecord(fx);
    const { db } = fakeDb({ wholes: { '2020': { value: 600 } } });
    getDb.mockReturnValue(db);
    const result = await requestWholeVerification({ kind: 'answer', id: 5 }, ['2020']);
    expect(result).toEqual({ ok: false, reason: 'this set of regions has no published total to check against' });
    expect(db.query).not.toHaveBeenCalled();
  });

  it('every requested period is missing_whole when the national group resolves to no single code on this table', async () => {
    const fx = fixture();
    stubRecord(fx);
    const { db, calls } = fakeDb({ nationalCodes: [], wholes: { '2020': { value: 600 } } });
    getDb.mockReturnValue(db);
    const result = await requestWholeVerification({ kind: 'answer', id: 5 }, ['2020', '2021']);
    expect(result).toEqual({
      ok: true,
      periods: { '2020': { verified: false, reason: 'missing_whole' }, '2021': { verified: false, reason: 'missing_whole' } },
    });
    expect(calls.some((c) => c.sql.includes('from observations'))).toBe(false);
  });

  it('two codes in the national group is not a single-cell total either: missing_whole, no observation fetch', async () => {
    const fx = fixture();
    stubRecord(fx);
    const { db, calls } = fakeDb({ nationalCodes: ['NL01', 'NL02'], wholes: { '2020': { value: 600 } } });
    getDb.mockReturnValue(db);
    const result = await requestWholeVerification({ kind: 'answer', id: 5 }, ['2020']);
    expect(result).toEqual({ ok: true, periods: { '2020': { verified: false, reason: 'missing_whole' } } });
    expect(calls.some((c) => c.sql.includes('from observations'))).toBe(false);
  });

  it('a table with no geo dimension has no whole: missing_whole for every period', async () => {
    const fx = fixture();
    stubRecord(fx);
    const { db } = fakeDb({ geoDimension: null, wholes: { '2020': { value: 600 } } });
    getDb.mockReturnValue(db);
    const result = await requestWholeVerification({ kind: 'answer', id: 5 }, ['2020']);
    expect(result).toEqual({ ok: true, periods: { '2020': { verified: false, reason: 'missing_whole' } } });
  });

  it('refuses a period not on this chart, rather than verifying nothing against something', async () => {
    const fx = fixture();
    stubRecord(fx);
    const { db } = fakeDb({ wholes: { '2020': { value: 600 } } });
    getDb.mockReturnValue(db);
    const result = await requestWholeVerification({ kind: 'answer', id: 5 }, ['2020', '2019']);
    expect(result).toEqual({ ok: false, reason: 'one of those periods is not on this chart' });
  });

  it('refuses when a spec point has no matching audited cell (the parts must be the row\'s own cells, R1)', async () => {
    const fx = fixture();
    fx.cells.splice(0, 1);
    stubRecord(fx);
    const { db } = fakeDb({ wholes: { '2020': { value: 600 } } });
    getDb.mockReturnValue(db);
    const result = await requestWholeVerification({ kind: 'answer', id: 5 }, ['2020']);
    expect(result).toEqual({ ok: false, reason: 'one of those points is not on this chart' });
  });

  it('refuses an empty or oversized period list', async () => {
    const fx = fixture();
    stubRecord(fx);
    getDb.mockReturnValue(fakeDb().db);
    expect((await requestWholeVerification({ kind: 'answer', id: 5 }, [])).ok).toBe(false);
    expect((await requestWholeVerification({ kind: 'answer', id: 5 }, 'x')).ok).toBe(false);
  });

  it('refuses an answer belonging to a different user, with the same opaque reason as a missing row (no probing)', async () => {
    const fx = fixture();
    stubRecord(fx, 'someone-else');
    const { db } = fakeDb({ wholes: { '2020': { value: 600 } } });
    getDb.mockReturnValue(db);
    const result = await requestWholeVerification({ kind: 'answer', id: 5 }, ['2020']);
    expect(result).toEqual({ ok: false, reason: 'this answer is not available' });
    expect(db.query).not.toHaveBeenCalled();
    loadAuditRecord.mockResolvedValueOnce(null);
    expect(await requestWholeVerification({ kind: 'answer', id: 5 }, ['2020'])).toEqual({ ok: false, reason: 'this answer is not available' });
  });

  it('refuses a redacted answer', async () => {
    const fx = fixture();
    stubRecord(fx);
    isRedacted.mockReturnValueOnce(true);
    const { db } = fakeDb({ wholes: { '2020': { value: 600 } } });
    getDb.mockReturnValue(db);
    const result = await requestWholeVerification({ kind: 'answer', id: 5 }, ['2020']);
    expect(result).toEqual({ ok: false, reason: 'this answer is not available' });
    expect(db.query).not.toHaveBeenCalled();
  });

  it('refuses when the audit row has no chart (null or undefined)', async () => {
    for (const chart of [null, undefined]) {
      loadAuditRecord.mockResolvedValue({ id: 5, userId: 'u1', response: { kind: 'answer', chart, result: { cells: [] } } });
      getDb.mockReturnValue(fakeDb().db);
      expect(await requestWholeVerification({ kind: 'answer', id: 5 }, ['2020'])).toEqual({ ok: false, reason: 'this answer has no chart to verify' });
    }
  });

  it('refuses a non-answer audit row (a clarification has no chart)', async () => {
    loadAuditRecord.mockResolvedValue({ id: 5, userId: 'u1', response: { kind: 'clarification' } });
    getDb.mockReturnValue(fakeDb().db);
    expect(await requestWholeVerification({ kind: 'answer', id: 5 }, ['2020'])).toEqual({ ok: false, reason: 'this answer has no chart to verify' });
  });

  it('a thrown database error is reported and answered with a bare refusal, never a verdict', async () => {
    const fx = fixture();
    stubRecord(fx);
    getDb.mockReturnValue({ query: vi.fn().mockRejectedValue(new Error('connection lost')) });
    const result = await requestWholeVerification({ kind: 'answer', id: 5 }, ['2020']);
    expect(result).toEqual({ ok: false });
    expect(reportError).toHaveBeenCalledWith('requestWholeVerification', expect.any(Error), {});
  });
});

// splitSliceRequest (#358 (11)): the table lane's reader slice, split so no CBS
// $filter names more than DEFAULT_MAX_FILTER_TERMS (150) codes — CBS refuses about
// 170 (node limit 1,000). It is the warm planner's own splitter (one `splitAxes`),
// so these tests also pin that the planner and the lane share one cap.
// Pure and hermetic: committed CBS fixtures through FixtureSource, no DB, no network.
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FixtureSource, loadFixtureDocs } from '../../src/cbs-adapter/fixture-source.ts';
import { sliceToFilter } from '../../src/cbs-adapter/odata-v4.ts';
import type { CbsObservationRow } from '../../src/cbs-adapter/types.ts';
import { SLICE_MAX_CELLS, type SliceRequest } from '../../src/ingestion/slice-cache.ts';
import { DEFAULT_MAX_FILTER_TERMS, splitSliceRequest } from '../../src/ingestion/warm-plan.ts';

const FIXTURES_DIR = fileURLToPath(new URL('../fixtures/cbs', import.meta.url));
const TABLE = '83625NED';
const MEASURE = 'M001534';

/** The `x eq 'code'` terms of the $filter CBS would receive for a request. */
function filterTerms(req: SliceRequest, timeDim: string): number {
  const filter = sliceToFilter({
    measures: req.measures,
    dimensionIn: req.members,
    periodIn: { dimension: timeDim, codes: req.periods },
  })!;
  return (filter.match(/ eq '/g) ?? []).length;
}

function totalCodes(req: SliceRequest): number {
  return req.measures.length + req.periods.length + Object.values(req.members).reduce((n, c) => n + c.length, 0);
}

const regionCodes = (n: number): string[] => Array.from({ length: n }, (_, i) => `GM${String(i + 1).padStart(4, '0')}`);

const cellKey = (r: CbsObservationRow): string => `${r.measure}|${r.coordinates['RegioS']}|${r.coordinates['Perioden']}`;

describe('splitSliceRequest — the 150-code cap', () => {
  it('the cap is the warm planner\'s exported constant, 150', () => {
    expect(DEFAULT_MAX_FILTER_TERMS).toBe(150);
  });

  it('a 745-code region request becomes at least 5 requests, none over 150 codes, together exactly the original', () => {
    const regions = regionCodes(745);
    const req: SliceRequest = { measures: [MEASURE], members: { RegioS: regions }, periods: ['2024JJ00'] };
    const pieces = splitSliceRequest(req, 'Perioden');
    expect(pieces.length).toBeGreaterThanOrEqual(5);
    for (const piece of pieces) {
      expect(totalCodes(piece)).toBeLessThanOrEqual(DEFAULT_MAX_FILTER_TERMS);
      expect(filterTerms(piece, 'Perioden')).toBeLessThanOrEqual(DEFAULT_MAX_FILTER_TERMS);
      expect(piece.measures).toEqual([MEASURE]);
      expect(piece.periods).toEqual(['2024JJ00']);
    }
    // every region exactly once: no gap, no overlap
    const seen = pieces.flatMap((p) => p.members['RegioS']!);
    expect(seen).toHaveLength(745);
    expect(new Set(seen)).toEqual(new Set(regions));
  });

  it('several long axes: the total across all axes still stays under the cap', () => {
    const req: SliceRequest = {
      measures: ['M1', 'M2', 'M3'],
      members: { RegioS: regionCodes(300), Geslacht: ['T', 'M', 'V'] },
      periods: Array.from({ length: 5 }, (_, i) => `${2020 + i}JJ00`),
    };
    const pieces = splitSliceRequest(req, 'Perioden');
    expect(pieces.length).toBeGreaterThan(1);
    for (const piece of pieces) expect(totalCodes(piece)).toBeLessThanOrEqual(DEFAULT_MAX_FILTER_TERMS);
    // the pieces' cells are exactly the original's cells, each once
    const cells = new Set<string>();
    let n = 0;
    for (const p of pieces) {
      for (const m of p.measures) for (const g of p.members['Geslacht']!) for (const r of p.members['RegioS']!) {
        for (const per of p.periods) {
          cells.add([m, g, r, per].join('|'));
          n += 1;
        }
      }
    }
    expect(n).toBe(3 * 3 * 300 * 5);
    expect(cells.size).toBe(n);
  });

  it('nothing at or below the cap changes: one request, the same code lists', () => {
    // 148 regions + 1 period + 1 measure = exactly 150 terms
    const at: SliceRequest = { measures: [MEASURE], members: { RegioS: regionCodes(148) }, periods: ['2024JJ00'] };
    const atPieces = splitSliceRequest(at, 'Perioden');
    expect(atPieces).toHaveLength(1);
    expect(atPieces[0]).toEqual({ measures: [MEASURE], members: { RegioS: regionCodes(148) }, periods: ['2024JJ00'] });
    // a typical small question
    const small: SliceRequest = { measures: [MEASURE], members: { RegioS: ['GM0363'] }, periods: ['2023JJ00', '2024JJ00'] };
    const smallPieces = splitSliceRequest(small, 'Perioden');
    expect(smallPieces).toHaveLength(1);
    expect(smallPieces[0]!.members).toEqual({ RegioS: ['GM0363'] });
    expect([...smallPieces[0]!.periods].sort()).toEqual(['2023JJ00', '2024JJ00']);
    // one code over splits
    const over: SliceRequest = { measures: [MEASURE], members: { RegioS: regionCodes(149) }, periods: ['2024JJ00'] };
    expect(splitSliceRequest(over, 'Perioden').length).toBeGreaterThan(1);
  });

  it('respects a smaller custom cell cap the way the warm planner does', () => {
    const req: SliceRequest = { measures: [MEASURE], members: { RegioS: regionCodes(100) }, periods: ['2023JJ00', '2024JJ00'] };
    const pieces = splitSliceRequest(req, 'Perioden', { maxCells: 60 });
    for (const p of pieces) expect(p.measures.length * p.periods.length * p.members['RegioS']!.length).toBeLessThanOrEqual(60);
    expect(SLICE_MAX_CELLS).toBeGreaterThan(60); // the default is the store's own cap
  });

  it('refuses an empty axis instead of inventing a request', () => {
    expect(() => splitSliceRequest({ measures: [MEASURE], members: { RegioS: [] }, periods: ['2024JJ00'] }, 'Perioden')).toThrow(
      /at least one code/,
    );
  });
});

describe('splitSliceRequest — the combined cells equal the single-request cells (fixture)', () => {
  it('all 745 regions of 83625NED, split, return exactly the cells of one unsplit request', async () => {
    const source = new FixtureSource(await loadFixtureDocs(`${FIXTURES_DIR}/${TABLE}`));
    const schema = await source.fetchTableSchema(TABLE);
    const dimNames = schema.dimensions.map((d) => d.name);
    const regions = (await source.fetchCodeList(TABLE, 'RegioS')).map((c) => c.code);
    expect(regions).toHaveLength(745);
    const req: SliceRequest = { measures: [MEASURE], members: { RegioS: regions }, periods: ['2020JJ00'] };

    const collect = async (r: SliceRequest): Promise<CbsObservationRow[]> => {
      const rows: CbsObservationRow[] = [];
      for await (const page of source.fetchObservations(
        TABLE,
        { measures: r.measures, dimensionIn: r.members, periodIn: { dimension: 'Perioden', codes: r.periods } },
        dimNames,
      )) {
        rows.push(...page);
      }
      return rows;
    };

    const whole = await collect(req);
    expect(whole.length).toBeGreaterThan(100); // a real, non-trivial slice

    const pieces = splitSliceRequest(req, 'Perioden');
    expect(pieces.length).toBeGreaterThanOrEqual(5);
    const combined: CbsObservationRow[] = [];
    for (const piece of pieces) combined.push(...(await collect(piece)));

    expect(combined).toHaveLength(whole.length);
    expect(new Set(combined.map(cellKey))).toEqual(new Set(whole.map(cellKey)));
    // and the values are the same cells' values, not just the same coordinates
    const valueOf = (rows: CbsObservationRow[]) => new Map(rows.map((r) => [cellKey(r), r.value]));
    expect(valueOf(combined)).toEqual(valueOf(whole));
  });
});

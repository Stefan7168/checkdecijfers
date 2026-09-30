// planWarmSlices / loadWarmScope (ADR 065 step 2): a table's declared scope
// (cbs_tables.slice) turned into bounded slice requests. The planner is pure;
// the semantics it must equal are matchesSlice (fixture-source.ts) and
// sliceToFilter (odata-v4.ts). loadWarmScope is tested against PGlite like
// tests/ingestion/slice-cache.test.ts does.
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FixtureSource, loadFixtureDocs } from '../../src/cbs-adapter/fixture-source.ts';
import { sliceToFilter } from '../../src/cbs-adapter/odata-v4.ts';
import type { CbsSlice } from '../../src/cbs-adapter/types.ts';
import type { Db } from '../../src/db/types.ts';
import { registerTables } from '../../src/ingestion/pipeline.ts';
import { SEED_TABLES } from '../../src/ingestion/registry-seed.ts';
import { fetchSlice, registerSchemaOnly, SLICE_MAX_CELLS, type SliceRequest } from '../../src/ingestion/slice-cache.ts';
import { loadWarmScope, planWarmSlices, type WarmPlan, type WarmScopeInput } from '../../src/ingestion/warm-plan.ts';
import { createTestDb } from '../helpers/pglite-db.ts';

// --- helpers -------------------------------------------------------------

/** A small synthetic table: Geslacht (3) x Regio (5) x Perioden (6), 2 measures. */
function baseInput(overrides: Partial<WarmScopeInput> = {}): WarmScopeInput {
  return {
    tableId: 'TESTNED',
    slice: null,
    measures: ['M2', 'M1'],
    dimensions: [
      { name: 'Perioden', kind: 'TimeDimension' },
      { name: 'Regio', kind: 'GeoDimension' },
      { name: 'Geslacht', kind: 'Dimension' },
    ],
    codes: {
      Geslacht: ['T', 'M', 'V'],
      Regio: ['GM0001', 'GM0002', 'GM0003', 'PV20', 'NL01'],
      Perioden: ['2020JJ00', '2021JJ00', '2022JJ00', '2023JJ00', '2024JJ00', '2025JJ00'],
    },
    ...overrides,
  };
}

/** Every cell of a plan as a `measure|dim=code|...|period` string, one entry per
 * (request, cell) — duplicates are kept so overlap is visible. */
function cellsOf(input: WarmScopeInput, plan: WarmPlan): string[] {
  const timeDim = input.dimensions.find((d) => d.kind === 'TimeDimension')!.name;
  const dims = input.dimensions.filter((d) => d.name !== timeDim).map((d) => d.name).sort();
  const out: string[] = [];
  for (const req of plan.requests) {
    let combos: string[][] = [[]];
    for (const dim of dims) {
      combos = combos.flatMap((prefix) => req.members[dim]!.map((c) => [...prefix, `${dim}=${c}`]));
    }
    for (const m of req.measures) {
      for (const combo of combos) {
        for (const p of req.periods) out.push([m, ...combo, p].join('|'));
      }
    }
  }
  return out;
}

function requestCells(req: SliceRequest): number {
  return (
    req.measures.length * req.periods.length * Object.values(req.members).reduce((n, codes) => n * codes.length, 1)
  );
}

/** The exact $filter string CBS would receive for a request. */
function filterOf(input: WarmScopeInput, req: SliceRequest): string {
  const timeDim = input.dimensions.find((d) => d.kind === 'TimeDimension')!.name;
  const slice: CbsSlice = {
    measures: req.measures,
    dimensionIn: req.members,
    periodIn: { dimension: timeDim, codes: req.periods },
  };
  return sliceToFilter(slice)!;
}

function shuffled<T>(items: T[]): T[] {
  // Deterministic "shuffle": reverse then rotate — enough to differ from any sorted order.
  const reversed = [...items].reverse();
  return [...reversed.slice(1), ...reversed.slice(0, 1)];
}

// --- 1. scope semantics ---------------------------------------------------

describe('planWarmSlices: scope semantics (equal to matchesSlice / sliceToFilter)', () => {
  it('no slice = every measure x every member x every period, as ONE request when it fits', () => {
    const input = baseInput();
    const plan = planWarmSlices(input);
    expect(plan.totalCells).toBe(2 * 3 * 5 * 6);
    expect(plan.requests).toHaveLength(1);
    const req = plan.requests[0]!;
    expect(req.measures).toEqual(['M1', 'M2']);
    expect(req.members).toEqual({
      Geslacht: ['M', 'T', 'V'],
      Regio: ['GM0001', 'GM0002', 'GM0003', 'NL01', 'PV20'],
    });
    expect([...req.periods].sort()).toEqual(input.codes.Perioden!.slice().sort());
  });

  it('dimensionEquals pins one code', () => {
    const plan = planWarmSlices(baseInput({ slice: { dimensionEquals: { Geslacht: 'T' } } }));
    expect(plan.requests[0]!.members.Geslacht).toEqual(['T']);
    expect(plan.totalCells).toBe(2 * 1 * 5 * 6);
  });

  it('dimensionPrefixes keeps the stored codes starting with any prefix', () => {
    const plan = planWarmSlices(baseInput({ slice: { dimensionPrefixes: { Regio: ['NL', 'PV'] } } }));
    expect(plan.requests[0]!.members.Regio).toEqual(['NL01', 'PV20']);
  });

  it('dimensionIn keeps exactly the listed codes', () => {
    const plan = planWarmSlices(baseInput({ slice: { dimensionIn: { Regio: ['GM0003', 'GM0001'] } } }));
    expect(plan.requests[0]!.members.Regio).toEqual(['GM0001', 'GM0003']);
  });

  it('several clauses on one dimension are ANDed, like matchesSlice', () => {
    const plan = planWarmSlices(
      baseInput({ slice: { dimensionPrefixes: { Regio: ['GM'] }, dimensionIn: { Regio: ['GM0002', 'PV20'] } } }),
    );
    // PV20 is listed but does not start with GM; GM0001/GM0003 start with GM but are not listed.
    expect(plan.requests[0]!.members.Regio).toEqual(['GM0002']);
  });

  it('slice.measures narrows the curated measure list', () => {
    const plan = planWarmSlices(baseInput({ slice: { measures: ['M2'] } }));
    expect(plan.requests[0]!.measures).toEqual(['M2']);
    expect(plan.totalCells).toBe(1 * 3 * 5 * 6);
  });

  it('an empty slice.measures means every measure (sliceToFilter adds no clause)', () => {
    const plan = planWarmSlices(baseInput({ slice: { measures: [] } }));
    expect(plan.requests[0]!.measures).toEqual(['M1', 'M2']);
  });

  it('periodFloor keeps codes >= the floor by plain string comparison', () => {
    const plan = planWarmSlices(baseInput({ slice: { periodFloor: '2023JJ00' } }));
    expect([...plan.requests[0]!.periods].sort()).toEqual(['2023JJ00', '2024JJ00', '2025JJ00']);
  });

  it('periodFloor compares as strings: a floor between two grains uses lexicographic order', () => {
    const input = baseInput({
      codes: {
        Geslacht: ['T'],
        Regio: ['NL01'],
        Perioden: ['2022JJ00', '2022KW01', '2022MM01', '2023JJ00'],
      },
      slice: { periodFloor: '2022KW01' },
    });
    const plan = planWarmSlices(input);
    // 'JJ' < 'KW' < 'MM': the 2022JJ00 code is excluded, exactly as `Perioden ge '2022KW01'` would.
    expect([...plan.requests[0]!.periods].sort()).toEqual(['2022KW01', '2022MM01', '2023JJ00']);
  });

  it('periodIn keeps the listed periods', () => {
    const plan = planWarmSlices(baseInput({ slice: { periodIn: { dimension: 'Perioden', codes: ['2021JJ00', '2025JJ00'] } } }));
    expect([...plan.requests[0]!.periods].sort()).toEqual(['2021JJ00', '2025JJ00']);
  });

  it('periodFloor and periodIn together are ANDed', () => {
    const plan = planWarmSlices(
      baseInput({ slice: { periodFloor: '2022JJ00', periodIn: { dimension: 'Perioden', codes: ['2021JJ00', '2024JJ00'] } } }),
    );
    expect(plan.requests[0]!.periods).toEqual(['2024JJ00']);
  });

  it('a dimensionEquals on the time dimension keeps that one period', () => {
    const plan = planWarmSlices(baseInput({ slice: { dimensionEquals: { Perioden: '2022JJ00' } } }));
    expect(plan.requests[0]!.periods).toEqual(['2022JJ00']);
  });

  it('a non-Perioden time dimension with a periodFloor is refused (sliceToFilter and matchesSlice both hard-code "Perioden")', () => {
    const input = baseInput({
      dimensions: [
        { name: 'Tijd', kind: 'TimeDimension' },
        { name: 'Regio', kind: 'GeoDimension' },
        { name: 'Geslacht', kind: 'Dimension' },
      ],
      codes: { Geslacht: ['T'], Regio: ['NL01'], Tijd: ['2020JJ00', '2021JJ00'] },
      slice: { periodFloor: '2021JJ00' },
    });
    expect(() => planWarmSlices(input)).toThrow(/TESTNED.*periodFloor/);
  });

  it('emits only stored codes, never trims or invents', () => {
    const input = baseInput({ slice: { dimensionPrefixes: { Regio: ['GM'] }, periodFloor: '2022JJ00' } });
    const plan = planWarmSlices(input);
    for (const req of plan.requests) {
      for (const c of req.members.Regio!) expect(input.codes.Regio).toContain(c);
      for (const p of req.periods) expect(input.codes.Perioden).toContain(p);
      for (const m of req.measures) expect(input.measures).toContain(m);
    }
  });

  it('a stored code list with duplicates is de-duplicated', () => {
    const input = baseInput();
    input.codes.Geslacht = ['T', 'T', 'M', 'V', 'M'];
    const plan = planWarmSlices(input);
    expect(plan.requests[0]!.members.Geslacht).toEqual(['M', 'T', 'V']);
    expect(plan.totalCells).toBe(2 * 3 * 5 * 6);
  });
});

// --- 2. refusals ------------------------------------------------------------

describe('planWarmSlices: refuses loudly, never plans a partial scope', () => {
  it('no TimeDimension', () => {
    const input = baseInput({
      dimensions: [
        { name: 'Regio', kind: 'GeoDimension' },
        { name: 'Geslacht', kind: 'Dimension' },
      ],
    });
    expect(() => planWarmSlices(input)).toThrow(/TESTNED.*time dimension/i);
  });

  it('more than one TimeDimension', () => {
    const input = baseInput();
    input.dimensions.push({ name: 'Jaren', kind: 'TimeDimension' });
    input.codes.Jaren = ['2020'];
    expect(() => planWarmSlices(input)).toThrow(/TESTNED.*time dimension/i);
  });

  it('a dimensionEquals code that is not stored', () => {
    expect(() => planWarmSlices(baseInput({ slice: { dimensionEquals: { Geslacht: 'X' } } }))).toThrow(
      /TESTNED.*Geslacht.*X/,
    );
  });

  it('a prefix that matches no stored code (even when another prefix does)', () => {
    expect(() => planWarmSlices(baseInput({ slice: { dimensionPrefixes: { Regio: ['GM', 'ZZ'] } } }))).toThrow(
      /TESTNED.*Regio.*ZZ/,
    );
  });

  it('a dimensionIn code that is not stored', () => {
    expect(() => planWarmSlices(baseInput({ slice: { dimensionIn: { Regio: ['GM0001', 'GM9999'] } } }))).toThrow(
      /TESTNED.*Regio.*GM9999/,
    );
  });

  it('a periodIn code that is not stored', () => {
    expect(() =>
      planWarmSlices(baseInput({ slice: { periodIn: { dimension: 'Perioden', codes: ['1999JJ00'] } } })),
    ).toThrow(/TESTNED.*1999JJ00/);
  });

  it('a slice.measures code that is not one of the curated measures', () => {
    expect(() => planWarmSlices(baseInput({ slice: { measures: ['M1', 'NOPE'] } }))).toThrow(/TESTNED.*NOPE/);
  });

  it('scope clauses on one dimension that leave nothing', () => {
    expect(() =>
      planWarmSlices(baseInput({ slice: { dimensionEquals: { Regio: 'NL01' }, dimensionPrefixes: { Regio: ['GM'] } } })),
    ).toThrow(/TESTNED.*Regio/);
  });

  it('a scope key naming a dimension the table does not have', () => {
    expect(() => planWarmSlices(baseInput({ slice: { dimensionEquals: { Leeftijd: '10000' } } }))).toThrow(
      /TESTNED.*Leeftijd/,
    );
    expect(() => planWarmSlices(baseInput({ slice: { dimensionPrefixes: { Leeftijd: ['1'] } } }))).toThrow(
      /TESTNED.*Leeftijd/,
    );
    expect(() => planWarmSlices(baseInput({ slice: { dimensionIn: { Leeftijd: ['1'] } } }))).toThrow(
      /TESTNED.*Leeftijd/,
    );
    expect(() =>
      planWarmSlices(baseInput({ slice: { periodIn: { dimension: 'Tijd', codes: ['2020JJ00'] } } })),
    ).toThrow(/TESTNED.*Tijd/);
  });

  it('an empty measure list', () => {
    expect(() => planWarmSlices(baseInput({ measures: [] }))).toThrow(/TESTNED.*measure/i);
  });

  it('an empty period list (a floor above every stored period)', () => {
    expect(() => planWarmSlices(baseInput({ slice: { periodFloor: '2099JJ00' } }))).toThrow(/TESTNED.*period/i);
  });

  it('a dimension with no stored codes', () => {
    const input = baseInput();
    input.codes.Geslacht = [];
    expect(() => planWarmSlices(input)).toThrow(/TESTNED.*Geslacht/);
    const missing = baseInput();
    delete missing.codes.Regio;
    expect(() => planWarmSlices(missing)).toThrow(/TESTNED.*Regio/);
  });

  it('the time dimension with no stored codes', () => {
    const input = baseInput();
    input.codes.Perioden = [];
    expect(() => planWarmSlices(input)).toThrow(/TESTNED.*Perioden/);
  });
});

// --- 3. caps ---------------------------------------------------------------

describe('planWarmSlices: every request obeys both caps', () => {
  it('the default cell cap is SLICE_MAX_CELLS', () => {
    const codes = Array.from({ length: 60 }, (_, i) => `R${String(i).padStart(3, '0')}`);
    const periods = Array.from({ length: 100 }, (_, i) => `${1900 + i}JJ00`);
    const input = baseInput({ measures: ['M1'], codes: { Geslacht: ['T'], Regio: codes, Perioden: periods } });
    const plan = planWarmSlices(input);
    expect(plan.totalCells).toBe(6000);
    expect(plan.requests.length).toBeGreaterThan(1);
    for (const req of plan.requests) expect(requestCells(req)).toBeLessThanOrEqual(SLICE_MAX_CELLS);
  });

  it('respects a custom maxCells', () => {
    const input = baseInput();
    const plan = planWarmSlices(input, { maxCells: 20 });
    for (const req of plan.requests) expect(requestCells(req)).toBeLessThanOrEqual(20);
    expect(plan.requests.length).toBeGreaterThan(1);
  });

  it('respects a custom maxFilterChars, measured on the real sliceToFilter string', () => {
    const input = baseInput();
    const whole = planWarmSlices(input);
    const wholeLen = filterOf(input, whole.requests[0]!).length;
    const capped = planWarmSlices(input, { maxFilterChars: Math.floor(wholeLen / 2) });
    expect(capped.requests.length).toBeGreaterThan(1);
    for (const req of capped.requests) {
      expect(filterOf(input, req).length).toBeLessThanOrEqual(Math.floor(wholeLen / 2));
    }
    expect(capped.longestFilterChars).toBe(Math.max(...capped.requests.map((r) => filterOf(input, r).length)));
    expect(whole.longestFilterChars).toBe(wholeLen);
  });

  it('a cap that is exactly the whole scope keeps one request; one below splits it', () => {
    const input = baseInput();
    const total = input.measures.length * 3 * 5 * 6;
    expect(planWarmSlices(input, { maxCells: total }).requests).toHaveLength(1);
    expect(planWarmSlices(input, { maxCells: total - 1 }).requests.length).toBeGreaterThan(1);
    const len = planWarmSlices(input).longestFilterChars;
    expect(planWarmSlices(input, { maxFilterChars: len }).requests).toHaveLength(1);
    expect(planWarmSlices(input, { maxFilterChars: len - 1 }).requests.length).toBeGreaterThan(1);
  });

  it('the default filter cap is 6000 characters', () => {
    // 300 long region codes: the Regio clause alone is far above 6000 characters.
    const regions = Array.from({ length: 300 }, (_, i) => `GM${String(i).padStart(4, '0')}`);
    const input = baseInput({
      measures: ['M1'],
      codes: { Geslacht: ['T'], Regio: regions, Perioden: ['2024JJ00'] },
    });
    const plan = planWarmSlices(input);
    expect(plan.requests.length).toBeGreaterThan(1);
    expect(plan.longestFilterChars).toBeLessThanOrEqual(6000);
    for (const req of plan.requests) expect(filterOf(input, req).length).toBeLessThanOrEqual(6000);
  });

  it('no request names more than 150 codes in total (CBS refuses a filter of about 170 terms or more)', () => {
    // Measured 2026-09-30: CBS answers 400 "The node count limit of '1000' has been exceeded" at
    // 180 ORed terms and accepts 165. Short codes keep the character cap out of the way here.
    const periods = Array.from({ length: 400 }, (_, i) => `${1600 + i}JJ00`);
    const input = baseInput({ measures: ['M1'], codes: { Geslacht: ['T'], Regio: ['NL01'], Perioden: periods } });
    const plan = planWarmSlices(input, { maxCells: 1_000_000 });
    expect(plan.requests.length).toBeGreaterThan(1);
    for (const req of plan.requests) {
      const terms = req.measures.length + req.periods.length + Object.values(req.members).reduce((n, c) => n + c.length, 0);
      expect(terms).toBeLessThanOrEqual(150);
    }
    const capped = planWarmSlices(input, { maxCells: 1_000_000, maxFilterTerms: 40 });
    for (const req of capped.requests) {
      const terms = req.measures.length + req.periods.length + Object.values(req.members).reduce((n, c) => n + c.length, 0);
      expect(terms).toBeLessThanOrEqual(40);
    }
  });

  it('throws when even a single-cell request exceeds the filter cap', () => {
    expect(() => planWarmSlices(baseInput(), { maxFilterChars: 10 })).toThrow(/TESTNED.*single-cell/);
  });

  it('throws when the cell cap is below one', () => {
    expect(() => planWarmSlices(baseInput(), { maxCells: 0 })).toThrow(/TESTNED/);
  });
});

// --- 4. complete and non-overlapping ----------------------------------------

describe('planWarmSlices: complete and non-overlapping', () => {
  it.each([
    ['whole table, tight cell cap', { maxCells: 7 }, null],
    ['whole table, cap of one cell', { maxCells: 1 }, null],
    ['prefix scope, cap 10', { maxCells: 10 }, { dimensionPrefixes: { Regio: ['GM'] }, dimensionEquals: { Geslacht: 'T' } }],
    ['floor scope, cap 13', { maxCells: 13 }, { periodFloor: '2022JJ00', measures: ['M1'] }],
    ['filter-cap driven', { maxFilterChars: 120 }, null],
  ] as [string, { maxCells?: number; maxFilterChars?: number }, CbsSlice | null][])(
    '%s: the union of all requests is exactly the scope',
    (_name, options, slice) => {
      const input = baseInput({ slice });
      const plan = planWarmSlices(input, options);
      const cells = cellsOf(input, plan);
      // Reference: brute-force the scope from the stored lists.
      const wholePlan = planWarmSlices(input); // one request when uncapped
      expect(wholePlan.requests).toHaveLength(1);
      const expected = cellsOf(input, wholePlan);
      expect(new Set(cells).size).toBe(cells.length); // no cell in two requests
      expect([...cells].sort()).toEqual([...expected].sort());
      expect(cells.length).toBe(plan.totalCells);
    },
  );
});

// --- 5. deterministic -------------------------------------------------------

describe('planWarmSlices: deterministic', () => {
  it('the same input gives an identical plan, whatever the order of its arrays and object keys', () => {
    const a = baseInput({
      slice: { dimensionPrefixes: { Regio: ['PV', 'GM', 'NL'] }, periodFloor: '2021JJ00' },
    });
    const b: WarmScopeInput = {
      tableId: a.tableId,
      slice: { periodFloor: '2021JJ00', dimensionPrefixes: { Regio: ['NL', 'GM', 'PV'] } },
      measures: shuffled(a.measures),
      dimensions: shuffled(a.dimensions),
      codes: {
        Perioden: shuffled(a.codes.Perioden!),
        Geslacht: shuffled(a.codes.Geslacht!),
        Regio: shuffled(a.codes.Regio!),
      },
    };
    const options = { maxCells: 12 };
    expect(planWarmSlices(b, options)).toEqual(planWarmSlices(a, options));
    expect(JSON.stringify(planWarmSlices(b, options))).toBe(JSON.stringify(planWarmSlices(a, options)));
  });

  it('does not mutate its input', () => {
    const input = baseInput();
    const before = JSON.stringify(input);
    planWarmSlices(input, { maxCells: 9 });
    expect(JSON.stringify(input)).toBe(before);
  });
});

// --- 6. few requests, period chunks outermost and newest first --------------

describe('planWarmSlices: few requests, newest periods first', () => {
  it('halves the largest axis until the cap holds (10 members x 10 periods, cap 25 -> 2 x 2 requests)', () => {
    const input = baseInput({
      measures: ['M1'],
      codes: {
        Geslacht: ['T'],
        Regio: Array.from({ length: 10 }, (_, i) => `R${i}`),
        Perioden: Array.from({ length: 10 }, (_, i) => `${2010 + i}JJ00`),
      },
    });
    const plan = planWarmSlices(input, { maxCells: 25 });
    expect(plan.requests).toHaveLength(4);
    for (const req of plan.requests) expect(requestCells(req)).toBe(25);
    // Period chunks outermost, newest first: the first two requests share the newest five years.
    const newest = ['2015JJ00', '2016JJ00', '2017JJ00', '2018JJ00', '2019JJ00'];
    expect([...plan.requests[0]!.periods].sort()).toEqual(newest);
    expect([...plan.requests[1]!.periods].sort()).toEqual(newest);
    expect(plan.requests[0]!.members.Regio).toEqual(['R0', 'R1', 'R2', 'R3', 'R4']);
    expect(plan.requests[1]!.members.Regio).toEqual(['R5', 'R6', 'R7', 'R8', 'R9']);
    expect([...plan.requests[2]!.periods].sort()).toEqual(['2010JJ00', '2011JJ00', '2012JJ00', '2013JJ00', '2014JJ00']);
  });

  it('requests come newest period chunk first even when the input lists periods oldest first', () => {
    const input = baseInput({ measures: ['M1'] });
    const plan = planWarmSlices(input, { maxCells: 15 });
    const maxPeriods = plan.requests.map((r) => [...r.periods].sort().at(-1)!);
    expect(maxPeriods).toEqual([...maxPeriods].sort().reverse());
  });

  it('a cap of one cell needs one request per cell; a bigger cap stays within twice the theoretical minimum', () => {
    const input = baseInput();
    const cells = 2 * 3 * 5 * 6;
    expect(planWarmSlices(input, { maxCells: 1 }).requests).toHaveLength(cells);
    // 180 cells at cap 30: at least 6 requests; halving axes gives 12 here.
    expect(planWarmSlices(input, { maxCells: 30 }).requests.length).toBeLessThanOrEqual(2 * Math.ceil(cells / 30));
  });
});

// --- fixture-backed pinned scopes and loadWarmScope --------------------------

const FIXTURES_DIR = fileURLToPath(new URL('../fixtures/cbs', import.meta.url));

function seedTable(id: string) {
  const t = SEED_TABLES.find((entry) => entry.id === id);
  if (!t) throw new Error(`no Phase0Table registry entry for ${id}`);
  return t;
}

let db: Db;
let closeDb: () => Promise<void>;

beforeAll(async () => {
  ({ db, close: closeDb } = await createTestDb());
});

afterAll(async () => {
  await closeDb();
});

beforeEach(async () => {
  await db.query(
    'truncate table observations, dimension_labels, ingestion_batches, cbs_tables restart identity cascade',
  );
});

describe('loadWarmScope (reads the registry row + stored codes)', () => {
  it('reads slice, measures, dimensions and every stored code of a pinned table registered with a slice', async () => {
    const docs = loadFixtureDocs(`${FIXTURES_DIR}/03759ned`);
    const source = new FixtureSource(docs);
    const seed = seedTable('03759ned');
    await registerTables(db, source, [seed]);

    const scope = await loadWarmScope(db, '03759ned');
    expect(scope.tableId).toBe('03759ned');
    expect(scope.slice).toEqual(seed.slice);
    expect(scope.measures.length).toBeGreaterThan(0);
    expect(scope.dimensions.filter((d) => d.kind === 'TimeDimension')).toHaveLength(1);
    const labelRows = await db.query('select count(*)::int as n from dimension_labels where table_id = $1', ['03759ned']);
    const storedCodes = Object.values(scope.codes).reduce((n, codes) => n + codes.length, 0);
    expect(storedCodes).toBe(Number(labelRows.rows[0]!.n));
    expect(scope.codes.Perioden!.length).toBeGreaterThan(0);
  });

  it('a table registered without a slice has slice null', async () => {
    const source = new FixtureSource(loadFixtureDocs(`${FIXTURES_DIR}/83625NED`));
    await registerTables(db, source, [seedTable('83625NED')]);
    const scope = await loadWarmScope(db, '83625NED');
    expect(scope.slice).toBeNull();
  });

  it('throws for a table that is not registered', async () => {
    await expect(loadWarmScope(db, 'NOPE')).rejects.toThrow(/NOPE/);
  });

  it('copes with jsonb arriving as a string (real pg driver) and as an object (PGlite)', async () => {
    const source = new FixtureSource(loadFixtureDocs(`${FIXTURES_DIR}/83625NED`));
    await registerTables(db, source, [seedTable('83625NED')]);
    const asObject = await loadWarmScope(db, '83625NED');
    const asString: Db = {
      ...db,
      query: async (text: string, params?: unknown[]) => {
        const result = await db.query(text, params);
        if (!/from cbs_tables/.test(text)) return result;
        return {
          ...result,
          rows: result.rows.map((row) => ({
            ...row,
            slice: row.slice == null ? null : JSON.stringify(row.slice),
            units: JSON.stringify(row.units),
            expected_dimensions: JSON.stringify(row.expected_dimensions),
          })),
        };
      },
    };
    expect(await loadWarmScope(asString, '83625NED')).toEqual(asObject);
  });
});

describe('planWarmSlices on real fixture-backed scopes', () => {
  it('03759ned with its seed slice: every request is accepted by fetchSlice, and the plan covers every fixture cell of the scope', async () => {
    const docs = loadFixtureDocs(`${FIXTURES_DIR}/03759ned`);
    const source = new FixtureSource(docs);
    const seed = seedTable('03759ned');
    // Slice-cache registration keeps every code CBS publishes for the table; the
    // scope then comes from the seed's declared slice.
    expect((await registerSchemaOnly(db, source, '03759ned')).ok).toBe(true);
    const scope = { ...(await loadWarmScope(db, '03759ned')), slice: seed.slice! };

    const plan = planWarmSlices(scope);
    console.log(
      `03759ned: ${plan.requests.length} request(s), ${plan.totalCells} cells, ` +
        `largest ${Math.max(...plan.requests.map(requestCells))} cells, longest filter ${plan.longestFilterChars}`,
    );
    expect(plan.requests.length).toBeGreaterThan(0);
    for (const req of plan.requests) {
      expect(requestCells(req)).toBeLessThanOrEqual(SLICE_MAX_CELLS);
      expect(filterOf(scope, req).length).toBeLessThanOrEqual(6000);
    }
    const result = await fetchSlice(db, source, '03759ned', plan.requests[0]!);
    expect(result).toMatchObject({ ok: true });

    // Every observation the fixture holds inside the declared scope is a cell of the plan.
    const planned = new Set(cellsOf(scope, plan));
    const timeDim = scope.dimensions.find((d) => d.kind === 'TimeDimension')!.name;
    const dims = scope.dimensions.filter((d) => d.name !== timeDim).map((d) => d.name).sort();
    let inScope = 0;
    for await (const page of source.fetchObservations('03759ned', seed.slice!)) {
      for (const row of page) {
        inScope += 1;
        const key = [row.measure, ...dims.map((d) => `${d}=${row.coordinates[d]}`), row.coordinates[timeDim]].join('|');
        expect(planned.has(key)).toBe(true);
      }
    }
    expect(inScope).toBeGreaterThan(0);
  });

  it('83625NED with no slice: one whole-table plan whose first request passes fetchSlice', async () => {
    const docs = loadFixtureDocs(`${FIXTURES_DIR}/83625NED`);
    const source = new FixtureSource(docs);
    expect((await registerSchemaOnly(db, source, '83625NED')).ok).toBe(true);
    const scope = await loadWarmScope(db, '83625NED');
    expect(scope.slice).toBeNull();

    const plan = planWarmSlices(scope);
    console.log(
      `83625NED: ${plan.requests.length} request(s), ${plan.totalCells} cells, ` +
        `largest ${Math.max(...plan.requests.map(requestCells))} cells, longest filter ${plan.longestFilterChars}`,
    );
    for (const req of plan.requests) expect(requestCells(req)).toBeLessThanOrEqual(SLICE_MAX_CELLS);
    const result = await fetchSlice(db, source, '83625NED', plan.requests[0]!);
    expect(result).toMatchObject({ ok: true });
    // The union of the plan is the whole Cartesian product of the stored codes.
    const cells = cellsOf(scope, plan);
    expect(new Set(cells).size).toBe(cells.length);
    expect(cells.length).toBe(plan.totalCells);
  });
});

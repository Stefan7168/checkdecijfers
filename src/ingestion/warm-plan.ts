// Warm-scope planner (ADR 065, step 2): turns a pinned table's declared scope
// (cbs_tables.slice) into bounded slice requests that together fill exactly
// that scope. Pure — the only I/O is loadWarmScope's SELECTs.
//
// The scope semantics are matchesSlice's (src/cbs-adapter/fixture-source.ts) and
// sliceToFilter's (src/cbs-adapter/odata-v4.ts): clauses on one dimension are
// ANDed, `measures` / `dimensionIn` / `periodIn` with nothing listed restrict
// nothing, and `periodFloor` is a plain string comparison. The planner never
// trims and never invents: every emitted code is a stored code, and anything it
// cannot plan completely it refuses (principle c) rather than plan a part.
import type { CbsSlice } from '../cbs-adapter/types.ts';
import { sliceToFilter } from '../cbs-adapter/odata-v4.ts';
import type { Db } from '../db/types.ts';
import { SLICE_MAX_CELLS, type SliceRequest } from './slice-cache.ts';

export interface WarmScopeInput {
  tableId: string;
  /** cbs_tables.slice — the declared scope; null = the whole table. */
  slice: CbsSlice | null;
  /** The table's curated numeric measure codes (the keys of cbs_tables.units). */
  measures: string[];
  /** cbs_tables.expected_dimensions. Exactly one must be the TimeDimension. */
  dimensions: { name: string; kind: string }[];
  /** Every stored code per dimension name (dimension_labels), time dimension included. */
  codes: Record<string, string[]>;
}

export interface WarmPlanOptions {
  /** Most cells per request; default SLICE_MAX_CELLS (what fetchSlice accepts). */
  maxCells?: number;
  /** Most characters in the $filter string CBS receives; default 6000. */
  maxFilterChars?: number;
}

export interface WarmPlan {
  /** Newest periods first. */
  requests: SliceRequest[];
  /** The Cartesian size of the whole scope. */
  totalCells: number;
  /** Length of the longest $filter string among the requests. */
  longestFilterChars: number;
}

export const DEFAULT_MAX_FILTER_CHARS = 6000;
/** sliceToFilter joins the clauses of a filter with ' and '. */
const CLAUSE_JOIN_CHARS = ' and '.length;

const sortUnique = (codes: string[]): string[] => [...new Set(codes)].sort();

/** The stored codes of one dimension that the declared scope keeps. */
function scopedCodes(tableId: string, dim: string, stored: string[], slice: CbsSlice | null): string[] {
  let kept = stored;
  const equals = slice?.dimensionEquals;
  if (equals && Object.hasOwn(equals, dim)) {
    const code = equals[dim]!;
    if (!stored.includes(code)) {
      throw new Error(`Warm plan for "${tableId}": the scope pins ${dim} to "${code}", which is not a stored code of ${dim}.`);
    }
    kept = kept.filter((c) => c === code);
  }
  const prefixes = slice?.dimensionPrefixes?.[dim];
  if (prefixes) {
    if (prefixes.length === 0) {
      throw new Error(`Warm plan for "${tableId}": the scope lists no prefix for ${dim} (it would match nothing).`);
    }
    for (const prefix of prefixes) {
      if (!stored.some((c) => c.startsWith(prefix))) {
        throw new Error(`Warm plan for "${tableId}": the scope's ${dim} prefix "${prefix}" matches no stored code.`);
      }
    }
    kept = kept.filter((c) => prefixes.some((p) => c.startsWith(p)));
  }
  const listed = slice?.dimensionIn?.[dim];
  // An empty list adds no clause in sliceToFilter and none in matchesSlice.
  if (listed && listed.length > 0) {
    const unknown = listed.filter((c) => !stored.includes(c));
    if (unknown.length > 0) {
      throw new Error(
        `Warm plan for "${tableId}": the scope lists ${dim} code(s) ${unknown.slice(0, 5).join(', ')} that are not stored codes.`,
      );
    }
    kept = kept.filter((c) => listed.includes(c));
  }
  return kept;
}

interface Axis {
  kind: 'periods' | 'members' | 'measures';
  /** The dimension name for members, the time dimension for periods. */
  name: string;
  codes: string[];
}

function chunk(codes: string[], size: number): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < codes.length; i += size) out.push(codes.slice(i, i + size));
  return out;
}

/** The exact clause sliceToFilter writes for one chunk of one axis — the real
 * function, so the planner's length bound cannot drift from what CBS receives. */
function clauseOf(axis: Axis, codes: string[]): string {
  const slice: CbsSlice =
    axis.kind === 'measures'
      ? { measures: codes }
      : axis.kind === 'periods'
        ? { periodIn: { dimension: axis.name, codes } }
        : { dimensionIn: { [axis.name]: codes } };
  return sliceToFilter(slice) ?? '';
}

/** Longest clause any chunk of this axis produces at this chunk size. */
function longestClause(axis: Axis, size: number): number {
  return Math.max(...chunk(axis.codes, size).map((c) => clauseOf(axis, c).length));
}

export function planWarmSlices(input: WarmScopeInput, options: WarmPlanOptions = {}): WarmPlan {
  const { tableId, slice } = input;
  const maxCells = options.maxCells ?? SLICE_MAX_CELLS;
  const maxFilterChars = options.maxFilterChars ?? DEFAULT_MAX_FILTER_CHARS;
  const fail = (why: string): never => {
    throw new Error(`Warm plan for "${tableId}": ${why}`);
  };

  const timeDims = input.dimensions.filter((d) => d.kind === 'TimeDimension');
  if (timeDims.length !== 1) {
    fail(`needs exactly one time dimension, the layout has ${timeDims.length}.`);
  }
  const timeDim = timeDims[0]!.name;
  const dimNames = input.dimensions.map((d) => d.name);
  if (new Set(dimNames).size !== dimNames.length) fail('the layout lists a dimension name twice.');
  const memberDims = dimNames.filter((n) => n !== timeDim).sort();

  // A scope naming a dimension the table does not have is a stale or wrong scope.
  for (const [clause, dims] of [
    ['dimensionEquals', Object.keys(slice?.dimensionEquals ?? {})],
    ['dimensionPrefixes', Object.keys(slice?.dimensionPrefixes ?? {})],
    ['dimensionIn', Object.keys(slice?.dimensionIn ?? {})],
  ] as const) {
    for (const dim of dims) {
      if (!dimNames.includes(dim)) fail(`the scope's ${clause} names dimension "${dim}", which the table does not have.`);
    }
  }
  if (slice?.periodIn && slice.periodIn.dimension !== timeDim) {
    fail(`the scope's periodIn names "${slice.periodIn.dimension}", but the time dimension is "${timeDim}".`);
  }
  // Both sliceToFilter and matchesSlice hard-code the name 'Perioden' for the floor.
  if (slice?.periodFloor && timeDim !== 'Perioden') {
    fail(`the scope has a periodFloor, but the time dimension is "${timeDim}", not "Perioden" — the floor would not apply.`);
  }

  const storedOf = (dim: string): string[] => {
    const stored = sortUnique(input.codes[dim] ?? []);
    if (stored.length === 0) fail(`dimension ${dim} has no stored codes.`);
    return stored;
  };

  // Measures.
  const curated = sortUnique(input.measures);
  if (curated.length === 0) fail('the table has no measures.');
  let measures = curated;
  if (slice?.measures && slice.measures.length > 0) {
    const unknown = slice.measures.filter((m) => !curated.includes(m));
    if (unknown.length > 0) {
      fail(`the scope lists measure(s) ${unknown.slice(0, 5).join(', ')} that are not among the table's measures.`);
    }
    measures = curated.filter((m) => slice.measures!.includes(m));
  }

  // Members of every non-time dimension.
  const members: Record<string, string[]> = {};
  for (const dim of memberDims) {
    members[dim] = scopedCodes(tableId, dim, storedOf(dim), slice);
    if (members[dim]!.length === 0) fail(`the scope leaves no ${dim} code.`);
  }

  // Periods.
  let periods = scopedCodes(tableId, timeDim, storedOf(timeDim), slice);
  if (slice?.periodFloor) periods = periods.filter((p) => p >= slice.periodFloor!);
  if (slice?.periodIn && slice.periodIn.codes.length > 0) {
    const unknown = slice.periodIn.codes.filter((c) => !input.codes[timeDim]!.includes(c));
    if (unknown.length > 0) {
      fail(`the scope lists period(s) ${unknown.slice(0, 5).join(', ')} that are not stored periods.`);
    }
    periods = periods.filter((p) => slice.periodIn!.codes.includes(p));
  }
  if (periods.length === 0) fail('the scope leaves no period.');
  periods.reverse(); // newest first (descending string order)

  const totalCells = measures.length * periods.length * memberDims.reduce((n, d) => n * members[d]!.length, 1);

  // Axes in emission order: periods outermost, then dimensions by name, measures innermost.
  const axes: Axis[] = [
    { kind: 'periods', name: timeDim, codes: periods },
    ...memberDims.map((dim): Axis => ({ kind: 'members', name: dim, codes: members[dim]! })),
    { kind: 'measures', name: 'Measure', codes: measures },
  ];

  // Start from whole lists and halve the largest axis until both caps hold.
  const sizes = axes.map((a) => a.codes.length);
  const filterBound = (): number =>
    axes.reduce((sum, axis, i) => sum + longestClause(axis, sizes[i]!), 0) + CLAUSE_JOIN_CHARS * (axes.length - 1);
  for (;;) {
    const cells = sizes.reduce((n, s) => n * s, 1);
    const filterChars = filterBound();
    if (cells <= maxCells && filterChars <= maxFilterChars) break;
    const splittable = axes.map((_, i) => i).filter((i) => sizes[i]! > 1);
    if (splittable.length === 0) {
      fail(
        `even a single-cell request is too big (${cells} cell(s) against a cap of ${maxCells}, ` +
          `a ${filterChars}-character filter against a cap of ${maxFilterChars}).`,
      );
    }
    // Cells too many: split the axis with the most codes per chunk. Only the
    // filter too long: split the axis whose longest clause is the longest.
    const weight = (i: number): number => (cells > maxCells ? sizes[i]! : longestClause(axes[i]!, sizes[i]!));
    let pick = splittable[0]!;
    for (const i of splittable) if (weight(i) > weight(pick)) pick = i;
    sizes[pick] = Math.ceil(sizes[pick]! / 2);
  }

  // Cartesian product of the chunks, first axis outermost. Inside a request the
  // code lists are ascending, the canonical form fetchSlice keys a request by.
  const chunked = axes.map((axis, i) => chunk(axis.codes, sizes[i]!).map((c) => [...c].sort()));
  const requests: SliceRequest[] = [];
  const pickIdx = new Array<number>(axes.length).fill(0);
  for (;;) {
    const req: SliceRequest = { measures: [], members: {}, periods: [] };
    axes.forEach((axis, i) => {
      const codes = chunked[i]![pickIdx[i]!]!;
      if (axis.kind === 'periods') req.periods = codes;
      else if (axis.kind === 'measures') req.measures = codes;
      else req.members[axis.name] = codes;
    });
    requests.push(req);
    let level = axes.length - 1;
    while (level >= 0 && pickIdx[level]! + 1 >= chunked[level]!.length) {
      pickIdx[level] = 0;
      level -= 1;
    }
    if (level < 0) break;
    pickIdx[level]! += 1;
  }

  const longestFilterChars = Math.max(
    ...requests.map((req) =>
      sliceToFilter({
        measures: req.measures,
        dimensionIn: req.members,
        periodIn: { dimension: timeDim, codes: req.periods },
      })!.length,
    ),
  );
  return { requests, totalCells, longestFilterChars };
}

/** jsonb round-trips as a string over the real pg driver and as an already-
 * parsed object over PGlite — never assume one or the other. */
function parseJsonb<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  return (typeof value === 'string' ? JSON.parse(value) : value) as T;
}

/** Reads one table's registry row and stored code lists into the planner's
 * input. SELECTs only. */
export async function loadWarmScope(db: Db, tableId: string): Promise<WarmScopeInput> {
  const registry = await db.query('select slice, units, expected_dimensions from cbs_tables where id = $1', [tableId]);
  const row = registry.rows[0];
  if (!row) throw new Error(`Warm plan for "${tableId}": the table is not registered.`);
  const labels = await db.query(
    'select dimension, code from dimension_labels where table_id = $1 order by dimension, code',
    [tableId],
  );
  const codes: Record<string, string[]> = {};
  for (const label of labels.rows) (codes[label.dimension as string] ??= []).push(label.code as string);
  return {
    tableId,
    slice: parseJsonb<CbsSlice | null>(row.slice, null),
    measures: Object.keys(parseJsonb<Record<string, unknown>>(row.units, {})),
    dimensions: parseJsonb<{ name: string; kind: string }[]>(row.expected_dimensions, []),
    codes,
  };
}

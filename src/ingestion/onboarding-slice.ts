// Slice estimation for the on-demand onboarding job (WP16 sub-part 2, ADR 026,
// design §4). BEFORE ingesting a discovered table, the job estimates its cell
// count and, if it would exceed the size cap (ADR 026's 300s-function budget),
// builds a registered slice that keeps the table small enough to ingest inside
// one cron invocation. A slice here NEVER fabricates a number: it only bounds
// which cells are loaded (national region + recent years); every cell that IS
// loaded still flows through the full ingestion validators and, at delivery,
// the full answer pipeline. A too-tight slice can only ever yield a refund
// (delivery can't answer), never a wrong figure.
import type { CbsCode, CbsSlice, CbsSource, CbsTableSchema } from '../cbs-adapter/types.ts';
import { parsePeriodCode } from './periods.ts';

/** Size cap (ADR 026): a table estimated over this is sliced down before
 * ingest so one invocation stays within the ~300s Fluid Compute budget. One
 * table's ingestion at this size is comparable to today's manual `ingest sync`
 * runs (ADR 026 decision 1). Config constant, not inlined in logic. */
export const ONBOARDING_MAX_CELLS = 150_000;

/** How many trailing years a sliced onboard keeps (design §4: "the last 10
 * years"). The floor is computed from the newest year actually present in the
 * period code list, never the wall clock — a stale table still yields a
 * well-formed, servable floor. */
export const ONBOARDING_SLICE_YEARS = 10;

/** The CBS national total region code. CBS uses 'NL' (and 'NL01' for the
 * country in some tables); a prefix pin on 'NL' covers both, and drops the
 * province/municipality rows that blow up a geo table's size. */
const NATIONAL_REGION_PREFIX = 'NL';

export interface SliceEstimate {
  /** The estimated total cell count (from $count when available, else the
   * dimension-cardinality product). null only when neither could be computed
   * — the job then ingests the full table and lets the ingestion validators'
   * own plausibility bounds be the backstop. */
  estimatedCells: number | null;
  /** How the estimate was derived — for the plain-language slice_note. */
  source: 'count_endpoint' | 'cardinality_product' | 'unknown';
  /** The slice to register, or null to ingest the full table. */
  slice: CbsSlice | null;
  /** Owner-readable note (design §4): what was sliced and why, or that the
   * full table was loaded. Stored on the pending row (recordSliceNote). */
  note: string;
}

/** Product of every dimension's code-list cardinality — the upper-bound cell
 * count when the live $count is unavailable. Returns null if any dimension has
 * no codes (we can't bound it honestly → don't pretend to). */
export function cardinalityProduct(
  schema: CbsTableSchema,
  codeLists: Record<string, CbsCode[]>,
): number | null {
  if (schema.dimensions.length === 0) return null;
  let product = schema.measures.length > 0 ? schema.measures.length : 1;
  for (const dim of schema.dimensions) {
    const codes = codeLists[dim.name];
    if (!codes || codes.length === 0) return null;
    product *= codes.length;
  }
  return product;
}

/** The newest year present in the Perioden code list, or null when the list is
 * empty/unparseable. Used to anchor the trailing-years floor at real data,
 * never a guessed "today". */
function newestPeriodYear(periodCodes: CbsCode[]): number | null {
  let newest: number | null = null;
  for (const c of periodCodes) {
    const parsed = parsePeriodCode(c.code);
    if (parsed && (newest === null || parsed.year > newest)) newest = parsed.year;
  }
  return newest;
}

/**
 * Estimates a discovered table's size and, when it exceeds ONBOARDING_MAX_CELLS,
 * returns a bounding slice (national region prefix + last-N-years period floor).
 * Pure given its inputs; the caller fetches schema + code lists (already done
 * for registration) and passes them in. `count` is the $count result (or null).
 */
export function estimateSlice(
  schema: CbsTableSchema,
  codeLists: Record<string, CbsCode[]>,
  count: number | null,
): SliceEstimate {
  const product = cardinalityProduct(schema, codeLists);
  const estimatedCells = count ?? product;
  const source: SliceEstimate['source'] =
    count !== null ? 'count_endpoint' : product !== null ? 'cardinality_product' : 'unknown';

  if (estimatedCells === null || estimatedCells <= ONBOARDING_MAX_CELLS) {
    return {
      estimatedCells,
      source,
      slice: null,
      note:
        estimatedCells === null
          ? 'Volledige tabel geladen (grootte kon niet worden geschat).'
          : `Volledige tabel geladen (geschat ${estimatedCells.toLocaleString('nl-NL')} cellen, onder de limiet van ${ONBOARDING_MAX_CELLS.toLocaleString('nl-NL')}).`,
    };
  }

  // Over the cap: build a bounding slice. Pin the national region (drops the
  // province/municipality explosion) when the table has a geo dimension, and
  // floor the period to the last N years anchored at the newest published year.
  const geoDim = schema.dimensions.find((d) => d.kind === 'GeoDimension');
  const periodDim = schema.dimensions.find((d) => d.kind === 'TimeDimension');

  const slice: CbsSlice = {};
  const notes: string[] = [];

  if (geoDim) {
    slice.dimensionPrefixes = { [geoDim.name]: [NATIONAL_REGION_PREFIX] };
    notes.push(`alleen landelijk (${geoDim.name} = ${NATIONAL_REGION_PREFIX}*)`);
  }

  if (periodDim) {
    const newest = newestPeriodYear(codeLists[periodDim.name] ?? []);
    if (newest !== null) {
      const floorYear = newest - (ONBOARDING_SLICE_YEARS - 1);
      // Lexicographic floor on CBS period codes (YYYY + grain + index) — a
      // 'YYYYJJ00' floor with `Perioden ge` keeps every grain from that year
      // on (sliceToFilter / matchesPeriodFloor share this exact semantics).
      slice.periodFloor = `${floorYear}JJ00`;
      notes.push(`vanaf ${floorYear} (laatste ${ONBOARDING_SLICE_YEARS} jaar t/m ${newest})`);
    }
  }

  // If neither a geo nor a period dimension exists we cannot slice safely —
  // ingest the full table and rely on the ingestion validators (a genuinely
  // huge measure-only table is not a Phase-0-shaped table anyway).
  if (Object.keys(slice).length === 0) {
    return {
      estimatedCells,
      source,
      slice: null,
      note: `Volledige tabel geladen (geschat ${estimatedCells.toLocaleString('nl-NL')} cellen; kon niet worden versmald — geen regio- of periodedimensie).`,
    };
  }

  return {
    estimatedCells,
    source,
    slice,
    note: `Tabel versmald tot ${notes.join(' en ')} (geschat ${estimatedCells.toLocaleString('nl-NL')} cellen, boven de limiet van ${ONBOARDING_MAX_CELLS.toLocaleString('nl-NL')}).`,
  };
}

/** Reads $count from the source, translating a thrown network error into a
 * null estimate rather than blowing up the size step (the job wraps the whole
 * attempt, but size estimation should degrade gracefully to the cardinality
 * product on a flaky $count). */
export async function fetchCount(source: CbsSource, tableId: string): Promise<number | null> {
  try {
    return await source.fetchObservationCount(tableId);
  } catch {
    return null;
  }
}

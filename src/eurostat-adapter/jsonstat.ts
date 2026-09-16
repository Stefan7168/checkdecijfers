// Eurostat JSON-stat 2.0 parser (ADR 048 D6) — the ONE place this adapter
// maps Eurostat's native wire shape into the canonical waist types
// (src/cbs-adapter/types.ts, re-exported by ./types.ts). Shared by the live
// adapter (statistics-api.ts) and the fixture replay (fixture-source.ts), the
// same ADR-003-seam discipline CBS's parse-v4.ts already follows: both paths
// must exercise this exact code.
//
// D1 ("no new provider abstraction") + the how-to-add-a-source guide's Step 2
// ("no imports from cbs-adapter into your adapter beyond the shared types")
// mean the small client-side slice-matching helpers below are a deliberate,
// small DUPLICATE of the equivalent private logic in
// src/cbs-adapter/fixture-source.ts, not a shared import — each adapter owns
// its own copy of a ~15-line pure function, the same way each adapter will
// own its own id-prefix stripping (D4: "never the caller's job").
import { baseLabel } from '../answer/intent/resolve.ts';
import type {
  CbsCatalogEntry,
  CbsCode,
  CbsDimension,
  CbsMeasure,
  CbsObservationRow,
  CbsSlice,
  CbsTableSchema,
} from '../cbs-adapter/types.ts';
import { encodePeriodCode } from '../ingestion/periods.ts';
import { parseFactorUnit } from '../query/derivations.ts';
import { AsyncApiRequiredError, UnsupportedGrainError, type JsonStatCategory, type JsonStatDataset } from './types.ts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** D6: "synchronous only... refuse server-side any dataset whose declared
 * cell count would need the async API — a typed refusal, not a hang." The
 * ADR's own measured figure for the sync/async boundary. */
export const SYNC_CELL_THRESHOLD = 500_000;

/** D6: "Eurostat has no per-period publication status; the adapter reports
 * every observed period as published, which the ingestion validator's
 * step-3 status requirement accepts as honest." A fixed, non-null constant
 * (never null — src/ingestion/validate.ts's checkPeriodParsing refuses any
 * period with a null status) — its VALUE is inert for provisional display
 * (Amendment B1: the registry's `definitiveStatuses: []` makes every
 * Eurostat cell provisional regardless of this string), but it must exist. */
export const EUROSTAT_PERIOD_STATUS = 'Published';

/**
 * D6 licence exceptions ("licence exceptions enforced structurally at slice
 * time... pending the legal check in Assumption 2"): a STAND-IN EU/EFTA geo
 * allow-list, NOT the owner-signed authoritative list Assumption 2 still
 * needs. Deliberately a plain Set of ISO-3166-alpha-2-style Eurostat `geo`
 * codes (the 27 EU members + the 4 EFTA states) plus the handful of
 * aggregate codes Eurostat itself publishes alongside them — good enough to
 * PROVE the exclusion mechanism exists and is exercised (this file's own
 * unit tests), not to certify which real geographies are licence-exempt.
 * Never widen this without checking Assumption 2 first; narrowing it is
 * always safe (principle c — under-inclusive means "excluded", never wrong).
 */
export const EU_EFTA_STAND_IN_GEO_CODES: ReadonlySet<string> = new Set([
  // EU-27
  'BE', 'BG', 'CZ', 'DK', 'DE', 'EE', 'IE', 'EL', 'ES', 'FR', 'HR', 'IT', 'CY',
  'LV', 'LT', 'LU', 'HU', 'MT', 'NL', 'AT', 'PL', 'PT', 'RO', 'SI', 'SK', 'FI', 'SE',
  // EFTA
  'IS', 'LI', 'NO', 'CH',
  // Common Eurostat aggregates over the above (never a single country)
  'EU27_2020', 'EA', 'EA19', 'EA20', 'EFTA',
]);

// ---------------------------------------------------------------------------
// Period grammar (D6)
// ---------------------------------------------------------------------------

const ANNUAL_RE = /^(\d{4})$/;
const QUARTER_RE = /^(\d{4})-Q([1-4])$/;
const MONTH_RE = /^(\d{4})-M(0[1-9]|1[0-2])$/;
const SEMESTER_RE = /^\d{4}-S[12]$/;
const WEEKLY_RE = /^\d{4}-W\d{2}$/;
const DAILY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Maps a Eurostat native `time` category code into the internal
 * `YYYY(JJ|KW|MM)NN` grammar (D6). Annual/quarterly/monthly map losslessly
 * (always routed through `encodePeriodCode`, so the F2 round-trip holds by
 * construction); semester/weekly/daily are REFUSED — thrown, never silently
 * mapped (Amendment B4: proved by a standalone unit test on this function,
 * never via the conformance harness, which has no "expected to throw"
 * mechanism).
 */
export function mapEurostatPeriod(nativeCode: string): string {
  let m = ANNUAL_RE.exec(nativeCode);
  if (m) return encodePeriodCode({ grain: 'JJ', year: Number(m[1]), index: null });
  m = QUARTER_RE.exec(nativeCode);
  if (m) return encodePeriodCode({ grain: 'KW', year: Number(m[1]), index: Number(m[2]) });
  m = MONTH_RE.exec(nativeCode);
  if (m) return encodePeriodCode({ grain: 'MM', year: Number(m[1]), index: Number(m[2]) });
  if (SEMESTER_RE.test(nativeCode)) throw new UnsupportedGrainError('semester', nativeCode);
  if (WEEKLY_RE.test(nativeCode)) throw new UnsupportedGrainError('weekly', nativeCode);
  if (DAILY_RE.test(nativeCode)) throw new UnsupportedGrainError('daily', nativeCode);
  throw new UnsupportedGrainError('unrecognized', nativeCode);
}

// ---------------------------------------------------------------------------
// JSON-stat 2.0 mechanics (https://json-stat.org/format/)
// ---------------------------------------------------------------------------

/** D4: "spoken NATIVELY by the adapter... strips its own prefix internally,
 * never the caller's job." Split on the FIRST ':' — matches
 * src/sources/registry.ts's own rule exactly, kept as an independent local
 * copy per the how-to-add-a-source guide's Step 2 (no cross-adapter/registry
 * imports beyond the shared wire types). */
function nativeIdFrom(tableId: string): string {
  const colon = tableId.indexOf(':');
  return colon >= 0 ? tableId.slice(colon + 1) : tableId;
}

function requireDataset(raw: unknown): JsonStatDataset {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Eurostat JSON-stat response is not an object');
  }
  const ds = raw as Record<string, unknown>;
  if (!Array.isArray(ds.id) || ds.id.some((x) => typeof x !== 'string') || ds.id.length === 0) {
    throw new Error("Eurostat JSON-stat response 'id' must be a non-empty array of dimension names");
  }
  if (!Array.isArray(ds.size) || ds.size.some((x) => typeof x !== 'number') || ds.size.length !== ds.id.length) {
    throw new Error("Eurostat JSON-stat response 'size' must be a number array parallel to 'id'");
  }
  if (typeof ds.dimension !== 'object' || ds.dimension === null) {
    throw new Error("Eurostat JSON-stat response is missing 'dimension'");
  }
  if (!Array.isArray(ds.value) && (typeof ds.value !== 'object' || ds.value === null)) {
    throw new Error("Eurostat JSON-stat response 'value' must be an array (dense) or an object (sparse)");
  }
  return ds as unknown as JsonStatDataset;
}

/** Reads one cell — `value` is dense-array-or-sparse-object (see
 * JsonStatDataset's own doc comment); a sparse object's missing key means
 * null, exactly like a dense array's explicit `null` at that position. */
function valueAt(value: JsonStatDataset['value'], offset: number): number | null {
  const raw = Array.isArray(value) ? value[offset] : value[String(offset)];
  return typeof raw === 'number' ? raw : null;
}

/** The array form must declare exactly `total` entries (dense, `null`
 * explicit); the sparse object form only ever lists non-null cells, so its
 * key COUNT is not comparable to `total` — instead every key must be a
 * valid, in-range offset (mirrors normalizeStatus's own key validation). */
function validateValueShape(value: JsonStatDataset['value'], total: number, tableId: string): void {
  if (Array.isArray(value)) {
    if (value.length !== total) {
      throw new Error(
        `Eurostat dataset '${tableId}' declares ${total} cells (product of 'size') but 'value' has ` +
          `${value.length} entries.`,
      );
    }
    return;
  }
  for (const key of Object.keys(value)) {
    const offset = Number(key);
    if (!Number.isInteger(offset) || offset < 0 || offset >= total) {
      throw new Error(`Eurostat dataset '${tableId}' has an out-of-range 'value' cell index '${key}' (total cells: ${total})`);
    }
  }
}

/** Normalizes a dimension's `category.index` (an object OR an array, both
 * spec-valid — see ./types.ts's JsonStatCategory doc) into an array where
 * position == category index, i.e. `codesByIndex[i]` is the code at index i. */
function codesByIndex(category: JsonStatCategory, dimensionName: string): string[] {
  const idx = category.index;
  if (Array.isArray(idx)) return idx;
  if (typeof idx !== 'object' || idx === null) {
    throw new Error(`Eurostat dimension '${dimensionName}' has no usable category.index`);
  }
  const entries = Object.entries(idx);
  const codes = new Array<string>(entries.length);
  for (const [code, pos] of entries) {
    if (!Number.isInteger(pos) || pos < 0 || pos >= codes.length) {
      throw new Error(
        `Eurostat dimension '${dimensionName}' category.index has an out-of-range position for code '${code}': ${pos}`,
      );
    }
    codes[pos] = code;
  }
  for (let i = 0; i < codes.length; i++) {
    if (codes[i] === undefined) {
      throw new Error(`Eurostat dimension '${dimensionName}' category.index is missing position ${i}`);
    }
  }
  return codes;
}

/** Inverse of the JSON-stat spec's flat-index rule ("the last dimension
 * varies fastest"): given a flat offset into `value`/`status`, recovers the
 * per-dimension category index for every dimension in `sizes`' order. */
function unravelOffset(offset: number, sizes: number[]): number[] {
  const idx = new Array<number>(sizes.length);
  let remaining = offset;
  for (let i = sizes.length - 1; i >= 0; i--) {
    const size = sizes[i]!;
    idx[i] = remaining % size;
    remaining = Math.floor(remaining / size);
  }
  return idx;
}

type JsonStatStatus = JsonStatDataset['status'];

/** Normalizes the dataset's `status` field (absent / a single uniform
 * string / the common sparse offset->flag map) into one lookup. Verbatim
 * strings only — never interpreted here (principle a; interpretation is the
 * registry's job, R11). */
function normalizeStatus(status: JsonStatStatus, total: number): Map<number, string> {
  const map = new Map<number, string>();
  if (status === undefined) return map;
  if (typeof status === 'string') {
    for (let i = 0; i < total; i++) map.set(i, status);
    return map;
  }
  if (typeof status === 'object' && status !== null) {
    for (const [key, flag] of Object.entries(status)) {
      const offset = Number(key);
      if (!Number.isInteger(offset) || offset < 0 || offset >= total) {
        throw new Error(`Eurostat dataset 'status' has an out-of-range cell index '${key}' (total cells: ${total})`);
      }
      if (typeof flag !== 'string' || flag.length === 0) {
        throw new Error(`Eurostat dataset 'status' entry '${key}' is not a non-empty flag string`);
      }
      map.set(offset, flag);
    }
    return map;
  }
  throw new Error(`Eurostat dataset 'status' has an unrecognized shape: ${JSON.stringify(status)}`);
}

function matchesGeoRestriction(geoCode: string): boolean {
  return EU_EFTA_STAND_IN_GEO_CODES.has(geoCode);
}

/** Local, deliberately-duplicated equivalent of cbs-adapter/fixture-source's
 * private matchesSlice — same CbsSlice semantics (dimensionEquals AND'd,
 * dimensionPrefixes OR'd-per-dimension-then-AND'd, periodFloor lexicographic
 * on the MAPPED 'time' coordinate). `sliceCoordinates` includes 'unit' (the
 * caller may pin `dimensionEquals: { unit: 'GWH' }` per D6's "unit pinned in
 * the slice" onboarding practice) even though 'unit' never appears on the
 * stored CbsObservationRow.coordinates (it is absorbed into `measure`). */
function matchesSlice(sliceCoordinates: Record<string, string>, slice: CbsSlice | undefined): boolean {
  if (!slice) return true;
  if (slice.dimensionEquals) {
    for (const [dim, code] of Object.entries(slice.dimensionEquals)) {
      if (sliceCoordinates[dim] !== code) return false;
    }
  }
  if (slice.dimensionPrefixes) {
    for (const [dim, prefixes] of Object.entries(slice.dimensionPrefixes)) {
      const value = sliceCoordinates[dim];
      if (value === undefined || !prefixes.some((p) => value.startsWith(p))) return false;
    }
  }
  if (slice.periodFloor) {
    const period = sliceCoordinates['time'];
    if (period === undefined || period < slice.periodFloor) return false;
  }
  return true;
}

/** LOW-effort code-review finding, fixed: `v.toString()` can render a small
 * magnitude in exponential notation (e.g. 1e-7), which has no '.' in the
 * position a plain-decimal count expects — `decimalsOf` expands that case
 * explicitly instead of assuming `toString()` never switches notation. */
function decimalsOf(v: number): number {
  if (!Number.isFinite(v) || Number.isInteger(v)) return 0;
  const s = v.toString();
  const eIndex = s.search(/[eE]/);
  if (eIndex === -1) {
    const dot = s.indexOf('.');
    return dot === -1 ? 0 : s.length - dot - 1;
  }
  const mantissa = s.slice(0, eIndex);
  const exponent = Number(s.slice(eIndex + 1));
  const dot = mantissa.indexOf('.');
  const mantissaDecimals = dot === -1 ? 0 : mantissa.length - dot - 1;
  return Math.max(0, mantissaDecimals - exponent);
}

function maxDecimals(values: number[]): number {
  let max = 0;
  for (const v of values) max = Math.max(max, decimalsOf(v));
  return max;
}

// ---------------------------------------------------------------------------
// Amendment 7 — fail-open AND logged unit-label parsing
// ---------------------------------------------------------------------------

/** Never throws (this module's own fail-open contract, matching
 * src/db/error-log.ts's logError — but this is a pure, synchronous module
 * with no Db, so console.error is the primitive here, not the durable
 * error_log table). Structured so a real log search can find every Eurostat
 * parse-mismatch line by its `[eurostat-adapter]` tag. */
function logEurostatParseMismatch(kind: string, context: string, detail: Record<string, unknown>): void {
  console.error(`[eurostat-adapter] parse mismatch (${kind}) at ${context}:`, detail);
}

/**
 * Amendment 7 (WP30c/E1 brief): `parseFactorUnit` (src/query/derivations.ts)
 * and `baseLabel` (src/answer/intent/resolve.ts) are two of ADR 030's own
 * documented "known fail-open niceties" (docs/how-to-add-a-source.md, Step
 * 2) — tuned on CBS's own factor/label spellings, and already safe for a
 * brand-new source because BOTH fail open by design (a non-match returns
 * null / leaves the label untouched, never throws): a missed nicety on
 * Eurostat data is nothing worse than a display nicety not firing. What
 * neither function does is say so. For Eurostat specifically — a source this
 * session cannot verify against real data (Constraint 0) — that silence is
 * a problem: the FIRST real capture needs a log trail to check these
 * assumptions against, not a black box. These two wrappers add exactly that
 * visibility without changing either shared function or its CBS behaviour.
 *
 * `eurostatFactorUnit` only logs when the label ACTUALLY CONTAINS A DIGIT
 * and still failed to parse as a pure factor — most Eurostat unit labels are
 * purely textual ('Number', 'Percentage of GDP') and correctly never match
 * `parseFactorUnit`'s CBS-tuned grammar; that is the ordinary case, not a
 * mismatch worth logging.
 */
export function eurostatFactorUnit(unitLabel: string, context: string): number | null {
  const factor = parseFactorUnit(unitLabel);
  if (factor === null && /\d/.test(unitLabel)) {
    logEurostatParseMismatch('factor-unit', context, { unitLabel });
  }
  return factor;
}

/**
 * See `eurostatFactorUnit`'s doc comment above for the shared rationale.
 * D6 requires the measure's `unit` field to carry the Eurostat unit label
 * VERBATIM — so unlike CBS's own chip-label call sites, this wrapper never
 * actually strips anything; it only uses `baseLabel`'s CBS-style trailing-
 * parenthetical-qualifier detection as a PROBE: if a Eurostat unit label
 * would have been changed by that CBS convention, that is worth a human
 * checking once real data exists (is it a genuine qualifier, or coincidence
 * from a wholly different source?) — logged, then the untouched raw label
 * is still returned, always.
 */
export function eurostatBaseLabel(rawLabel: string, context: string): string {
  if (rawLabel.trim().length === 0) {
    logEurostatParseMismatch('base-label-empty', context, { rawLabel });
    return rawLabel;
  }
  const stripped = baseLabel(rawLabel);
  if (stripped !== rawLabel) {
    logEurostatParseMismatch('base-label-parenthetical', context, { rawLabel, stripped });
  }
  return rawLabel;
}

// ---------------------------------------------------------------------------
// The parser
// ---------------------------------------------------------------------------

export interface ParsedEurostatDataset {
  schema: CbsTableSchema;
  /** Per (non-unit) coordinate dimension — same contract as CbsSource's
   * fetchCodeList, pre-computed for every dimension in `schema.dimensions`. */
  codeLists: Record<string, CbsCode[]>;
  rows: CbsObservationRow[];
}

/**
 * Parses one Eurostat JSON-stat 2.0 dataset response into the canonical
 * waist shapes (D6). `tableId` is the PREFIXED id ('eurostat:<code>'); this
 * function strips its own prefix internally (D4) to build measure codes and
 * error messages against the bare native code.
 *
 * D6 obligations implemented here:
 * - one CbsMeasure per distinct `unit` category actually present in the
 *   (geo-restricted, sliced) result set (`<native-code>|<unit-code>`, title
 *   = dataset title + unit label, unit = the label VERBATIM, decimals = the
 *   observed maximum precision for that unit);
 * - `time` mapped through `mapEurostatPeriod` (throws `UnsupportedGrainError`
 *   for semester/weekly/daily, per Amendment B4 — never caught here);
 * - every observation's flag rides verbatim into `valueAttribute` (Amendment
 *   B1 — this is NOT a per-cell provisional-status mechanism; see the
 *   registry's own `definitiveStatuses: []` comment for why that is safe);
 * - the D6 licence-exception geographies are excluded STRUCTURALLY (never
 *   even reach `rows`/`codeLists`), via the stand-in `EU_EFTA_STAND_IN_GEO_CODES`
 *   list (Assumption 2 — pending the real legal-reviewed list);
 * - `slice` (optional) applies the SAME CbsSlice semantics every other
 *   adapter uses, additionally to (never instead of) the geo restriction.
 */
export function parseJsonStatDataset(
  raw: unknown,
  tableId: string,
  slice?: CbsSlice,
): ParsedEurostatDataset {
  const ds = requireDataset(raw);
  const nativeCode = nativeIdFrom(tableId);

  const total = ds.size.reduce((a, b) => a * b, 1);
  if (total > SYNC_CELL_THRESHOLD) throw new AsyncApiRequiredError(total, SYNC_CELL_THRESHOLD);
  validateValueShape(ds.value, total, tableId);

  if (!ds.id.includes('unit')) {
    throw new Error(`Eurostat dataset '${tableId}' has no 'unit' dimension — D6's per-unit measure synthesis needs one.`);
  }
  if (!ds.id.includes('time')) {
    throw new Error(`Eurostat dataset '${tableId}' has no 'time' dimension.`);
  }

  const dimCodes: Record<string, string[]> = {};
  const dimLabels: Record<string, Record<string, string>> = {};
  for (const dimName of ds.id) {
    const dim = ds.dimension[dimName];
    if (!dim) throw new Error(`Eurostat dataset '${tableId}' is missing dimension.'${dimName}' metadata.`);
    dimCodes[dimName] = codesByIndex(dim.category, dimName);
    dimLabels[dimName] = dim.category.label ?? {};
  }

  const statusByOffset = normalizeStatus(ds.status, total);
  const coordinateDimNames = ds.id.filter((name) => name !== 'unit');

  const rows: CbsObservationRow[] = [];
  const observedByUnit = new Map<string, number[]>();

  for (let offset = 0; offset < total; offset++) {
    const idx = unravelOffset(offset, ds.size);
    const coordinates: Record<string, string> = {};
    const sliceCoordinates: Record<string, string> = {};
    let unitCode = '';

    for (let d = 0; d < ds.id.length; d++) {
      const dimName = ds.id[d]!;
      const rawCode = dimCodes[dimName]![idx[d]!];
      if (rawCode === undefined) {
        throw new Error(`internal: unresolved category for dimension '${dimName}' at index ${idx[d]}`);
      }
      if (dimName === 'unit') {
        unitCode = rawCode;
        sliceCoordinates[dimName] = rawCode;
        continue;
      }
      const mapped = dimName === 'time' ? mapEurostatPeriod(rawCode) : rawCode;
      coordinates[dimName] = mapped;
      sliceCoordinates[dimName] = mapped;
    }

    const geoCode = coordinates['geo'];
    if (geoCode !== undefined && !matchesGeoRestriction(geoCode)) continue;
    if (!matchesSlice(sliceCoordinates, slice)) continue;

    const value = valueAt(ds.value, offset);
    const flag = statusByOffset.get(offset) ?? null;
    // A real live-data finding (session 107): Eurostat's sparse `value`
    // representation routinely omits a cell from BOTH `value` and `status`
    // (no observation reported at all for that coordinate combination — a
    // normal, expected shape for real EU data, unlike CBS's dense grid).
    // 'None' means "a real, present value with nothing special to flag"
    // (see CbsObservationRow's own doc comment) — defaulting an ABSENT value
    // to 'None' would claim the opposite of what happened. Eurostat's own
    // ':' (not-available) flag, already registered in registry.ts's
    // nullReasonLabels, is the honest default for a null cell with no
    // explicit flag; 'None' stays the default only when a value IS present.
    const valueAttribute = flag ?? (value === null ? ':' : 'None');

    if (value !== null) {
      const bucket = observedByUnit.get(unitCode) ?? [];
      bucket.push(value);
      observedByUnit.set(unitCode, bucket);
    }

    rows.push({
      measure: `${nativeCode}|${unitCode}`,
      coordinates,
      value,
      valueAttribute,
      stringValue: null,
    });
  }

  const presentMeasures = new Set(rows.map((r) => r.measure));
  const datasetTitle = typeof ds.label === 'string' && ds.label.trim().length > 0 ? ds.label : nativeCode;

  const measures: CbsMeasure[] = [];
  for (const unitCode of dimCodes['unit']!) {
    const measureCode = `${nativeCode}|${unitCode}`;
    if (!presentMeasures.has(measureCode)) continue; // filtered entirely out by geo/slice — no phantom measure
    const rawLabel = dimLabels['unit']?.[unitCode] ?? unitCode;
    const ctx = `table '${tableId}' unit '${unitCode}'`;
    eurostatFactorUnit(rawLabel, ctx); // Amendment 7 observability probe; see the function's own doc comment
    const unitLabel = eurostatBaseLabel(rawLabel, ctx); // verbatim per D6; see the function's own doc comment
    measures.push({
      code: measureCode,
      title: `${datasetTitle} — ${unitLabel}`,
      unit: unitLabel,
      decimals: maxDecimals(observedByUnit.get(unitCode) ?? []),
      description: '',
    });
  }

  const dimensions: CbsDimension[] = coordinateDimNames.map((name) => ({
    name,
    kind: name === 'time' ? 'TimeDimension' : name === 'geo' ? 'GeoDimension' : 'Dimension',
  }));

  const schema: CbsTableSchema = { tableId, title: datasetTitle, dimensions, measures };

  const codeLists: Record<string, CbsCode[]> = {};
  for (const dimName of coordinateDimNames) {
    if (dimName === 'geo') {
      codeLists[dimName] = dimCodes[dimName]!
        .filter((code) => matchesGeoRestriction(code))
        .map((code, i) => ({
          code,
          title: dimLabels[dimName]?.[code] ?? code,
          dimensionGroup: null,
          status: null,
          index: i,
        }));
    } else if (dimName === 'time') {
      codeLists[dimName] = dimCodes[dimName]!.map((nativeTimeCode, i) => ({
        code: mapEurostatPeriod(nativeTimeCode),
        title: dimLabels[dimName]?.[nativeTimeCode] ?? nativeTimeCode,
        dimensionGroup: null,
        status: EUROSTAT_PERIOD_STATUS,
        index: i,
      }));
    } else {
      codeLists[dimName] = dimCodes[dimName]!.map((code, i) => ({
        code,
        title: dimLabels[dimName]?.[code] ?? code,
        dimensionGroup: null,
        status: null,
        index: i,
      }));
    }
  }

  return { schema, codeLists, rows };
}

// ---------------------------------------------------------------------------
// Catalogue API — the real "table of contents" TSV shape (Constraint 0
// resolved, session 107, 2026-09-16, via a live capture)
// ---------------------------------------------------------------------------

/** dd.mm.yyyy (the real endpoint's own date format, e.g. "14.08.2026") — to
 * ISO 'yyyy-mm-dd' so `modified` matches CBS's own ISO convention. */
function parseEurostatTocDate(raw: string): string | null {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(raw.trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

/** Splits ONE tab-separated, double-quoted line into its raw cell strings
 * (quotes stripped, tabs are the only separator — no embedded-quote escaping
 * in the real file, verified against a live capture). */
function splitTocLine(line: string): string[] {
  return line.split('\t').map((cell) => cell.replace(/^"|"$/g, ''));
}

/**
 * Eurostat's REAL Catalogue "table of contents" endpoint
 * (`.../catalogue/toc/txt?lang=EN`) is not JSON at all — it is a
 * tab-separated, double-quoted TEXT file, one row per catalog node, verified
 * against a live capture (session 107, 2026-09-16; the original
 * `link.item[]` JSON shape this function used to expect was Constraint 0's
 * own disclosed, UNVERIFIED best-effort guess and was wrong). Columns:
 * `title \t code \t type \t last update of data \t last table structure
 * change \t data start \t data end \t values`. `title`'s leading spaces
 * encode the node's depth in the theme hierarchy (folders nest datasets/
 * tables); trimmed away here since `CbsCatalogEntry` is a flat list, exactly
 * like CBS's own catalog.
 *
 * Only `type === 'dataset' | 'table'` rows are real, independently queryable
 * leaf nodes (both verified live against the Statistics API endpoint) —
 * `'folder'` rows are pure navigation with no data behind them and are
 * dropped. Eurostat's toc file carries no per-entry lifecycle/status field
 * at all (unlike CBS's 'Regulier'/'Gediscontinueerd'/'Vervallen') — `status`
 * stays `null` for every entry, not "unknown pending a capture" (that
 * capture has now happened; the field genuinely does not exist here). See
 * open-questions #250 for what this means for `currentCatalogStatuses`.
 */
export function parseJsonStatCatalog(raw: string): CbsCatalogEntry[] {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new Error('Eurostat catalogue response is empty or not a string');
  }
  const lines = raw.split('\n').filter((line) => line.trim().length > 0);
  const [header, ...rows] = lines;
  if (header === undefined || !header.includes('"code"')) {
    throw new Error(`Eurostat catalogue response is missing the expected header row: ${JSON.stringify(header)}`);
  }
  const entries: CbsCatalogEntry[] = [];
  for (const line of rows) {
    const cells = splitTocLine(line);
    const [rawTitle, code, type, lastUpdate] = cells;
    if (type !== 'dataset' && type !== 'table') continue;
    if (typeof code !== 'string' || code.length === 0) {
      throw new Error(`Eurostat catalogue row is missing a code: ${JSON.stringify(line)}`);
    }
    const title = (rawTitle ?? '').trim();
    if (title.length === 0) {
      throw new Error(`Eurostat catalogue item '${code}' is missing a title`);
    }
    entries.push({
      tableId: `eurostat:${code}`,
      title,
      summary: '',
      status: null,
      datasetType: type,
      language: 'en',
      modified: typeof lastUpdate === 'string' ? parseEurostatTocDate(lastUpdate) : null,
    });
  }
  return entries;
}

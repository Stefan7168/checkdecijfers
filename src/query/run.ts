// Query execution: ResolvedQuery -> ValidatedResult | QueryRefusal.
// Deterministic SQL over `observations`, completeness-checked against the
// intent (every requested coordinate must produce a cell, or the whole query
// refuses with a diagnosis — never a silently partial answer), derivations
// applied only through the registered functions (R5), attribution attached so
// no rendering path can drop it (R4). No LLM anywhere (WP5).
import type { Db } from '../db/types.ts';
import { parsePeriodCode } from '../ingestion/periods.ts';
import { CBS_SOURCE_KEY, isProvisionalStatus, resolveSourceForTable } from '../sources/registry.ts';
import { deriveDifference, deriveDirection, deriveFirstLast, deriveMax, deriveUnitExpansion } from './derivations.ts';
import {
  NATIONAL_REGION_CODE,
  normalizeLabel,
  periodKey,
  resolveIntent,
  type QueryOptions,
  type ResolvedQuery,
} from './resolve.ts';
import type {
  Attribution,
  DerivationRecord,
  FreshnessInfo,
  QueryOutcome,
  QueryRefusal,
  ResultCell,
  ResultShape,
  StructuredIntent,
} from './types.ts';
import { RESULT_SCHEMA_VERSION } from './types.ts';

function refuse(
  intent: StructuredIntent,
  kind: QueryRefusal['refusal']['kind'],
  message: string,
  extra?: Partial<QueryRefusal['refusal']>,
): QueryRefusal {
  return { ok: false, refusal: { kind, message, ...extra }, intent };
}

/** Deterministic coordinate id — the R1 traceability handle. Stable across
 * re-ingests (unlike a row id) and self-describing; version pinning lives in
 * cell.batchId + attribution.tableVersion. */
export function buildResultId(
  tableId: string,
  measure: string,
  regionCode: string,
  periodCode: string,
  dims: Record<string, string>,
): string {
  const dimsPart =
    Object.keys(dims)
      .sort()
      .map((k) => `${k}=${dims[k]}`)
      .join(';') || '-';
  return `${tableId}:${measure}:${regionCode || '-'}:${periodCode}:${dimsPart}`;
}

interface ObservationRow {
  region_code: string;
  period_code: string;
  value: unknown;
  unit: string;
  decimals: unknown;
  status: string;
  value_attribute: string;
  batch_id: unknown;
  /** #154: non-null marks a RETAINED cell (CBS stopped returning it); the
   * value is the last batch that provably confirmed it. Kept OFF ResultCell
   * (a rare internal freshness fact, not answer-surface data) — run() reads
   * it sideband to compute the honest attribution.syncedAt. */
  last_seen_batch_id: unknown;
  /** #196 (session 73): the period's label, LEFT-JOINed from dimension_labels
   * into the fetch itself so labels come from the same snapshot as the cells
   * (null only for a period the table's time dimension does not list). */
  period_label: string | null;
  /** #196 (session 73): for a RETAINED cell, finished_at of the batch that
   * last confirmed it (ingestion_batches, LEFT-JOINed — same snapshot); null
   * for a cell present in the latest sync. */
  retained_finished_at: unknown;
}

/** Freshest period we hold for these exact coordinates (open-questions #37:
 * freshest available regardless of status, plus freshest Definitief as the
 * secondary reference). Offered as period + status only — never a value. */
async function fetchFreshness(
  db: Db,
  q: ResolvedQuery,
  regionCode: string,
): Promise<FreshnessInfo> {
  const base = `
    select period_code, status from observations
    where table_id = $1 and measure = $2 and dims = $3::jsonb
      and region_code = $4 and period_grain = $5`;
  const params = [q.tableId, q.measure, JSON.stringify(q.dims), regionCode, q.grain];
  const order = ' order by period_year desc, coalesce(period_index, 0) desc limit 1';
  const available = await db.query(base + order, params);
  // WP30b: "definitive" per the table's source registry entry (for CBS
  // exactly ['Definitief'] — byte-identical result). Own params array so the
  // sibling query above never sees the extra parameter.
  const definitief = await db.query(base + ` and status = any($6::text[])` + order, [
    ...params,
    resolveSourceForTable(q.tableId).definitiveStatuses,
  ]);
  return {
    freshestAvailable: available.rows[0]
      ? { periodCode: available.rows[0].period_code as string, status: available.rows[0].status as string }
      : null,
    freshestDefinitief: definitief.rows[0]
      ? { periodCode: definitief.rows[0].period_code as string }
      : null,
  };
}

/** #134(b): the EARLIEST period we hold for these exact coordinates AT THE
 * REQUESTED GRAIN — the mirror of fetchFreshness's freshestAvailable. Used to
 * classify a too-OLD not_published ask (before our earliest served period,
 * e.g. "inflatie 2001" when our CPI slice starts 2010) so the refusal can offer
 * that floor as a retry boundary (suggestions.ts). Same-grain deliberately: a
 * yearly ask gets a yearly floor, a quarterly ask a quarterly one — a
 * grain-mismatch not_published (asking a quarter of a yearly-only table) finds
 * nothing at that grain → null → no boundary → stays prose (the safe default;
 * cross-grain retry offers are a deferred v2). Null when we hold nothing here. */
async function earliestAvailablePeriod(
  db: Db,
  q: ResolvedQuery,
  regionCode: string,
): Promise<string | null> {
  const res = await db.query(
    `select period_code from observations
     where table_id = $1 and measure = $2 and dims = $3::jsonb
       and region_code = $4 and period_grain = $5
     order by period_year asc, coalesce(period_index, 0) asc limit 1`,
    [q.tableId, q.measure, JSON.stringify(q.dims), regionCode, q.grain],
  );
  return res.rows[0] ? (res.rows[0].period_code as string) : null;
}

/** Why is a requested cell missing? Ordered diagnosis producing the refusal
 * kind docs/05's failure table requires: freshness (beyond what we can serve,
 * with the freshest period offered) / not_published (CBS never published it) /
 * no_data (a loud gap we will not paper over). Slice refusals were already
 * handled in resolve. */
async function diagnoseMissing(
  db: Db,
  q: ResolvedQuery,
  regionCode: string,
  missingPeriod: string,
): Promise<QueryRefusal> {
  const where = regionCode ? ` for region ${regionCode}` : '';
  const freshness = await fetchFreshness(db, q, regionCode);
  const requestedKey = periodKey(parsePeriodCode(missingPeriod)!);

  if (freshness.freshestAvailable) {
    const freshestKey = periodKey(parsePeriodCode(freshness.freshestAvailable.periodCode)!);
    if (requestedKey > freshestKey) {
      return refuse(
        q.intent,
        'freshness',
        `period ${missingPeriod} is not available yet${where} — the freshest we can serve is ${freshness.freshestAvailable.periodCode} (status: ${freshness.freshestAvailable.status})`,
        { axis: 'period', freshness, nearestAlternative: freshness.freshestAvailable.periodCode },
      );
    }
  }

  const published = await db.query(
    'select 1 from dimension_labels where table_id = $1 and dimension = $2 and code = $3',
    [q.tableId, q.timeDimension, missingPeriod],
  );
  if (published.rows.length === 0) {
    const grains = await db.query(
      'select distinct period_grain from observations where table_id = $1 order by period_grain',
      [q.tableId],
    );
    const grainList = grains.rows.map((r) => r.period_grain as string).join(', ') || 'none ingested';
    // #134(b): a too-OLD not_published ask (the requested period is before our
    // earliest served period at this grain — the owner's "inflatie 2001" case)
    // can honestly offer that earliest period as a retry boundary, exactly like
    // the outside_loaded_slice floor. A MID-GAP not_published (a hole between
    // served periods) gets NO boundary: there is no single honest "try this"
    // target, so the refusal stays prose-only (owner decision 2026-07-13). The
    // chip builder (suggestions.ts) dry-run-gates this boundary like any other.
    // The too-old vs mid-gap split is pinned end to end (against a seeded
    // interior gap) by tests/query/not-published-midgap.test.ts — do NOT weaken
    // the `requestedKey < earliest` comparison to just `earliest !== null`.
    const earliest = await earliestAvailablePeriod(db, q, regionCode);
    const tooOld =
      earliest !== null && requestedKey < periodKey(parsePeriodCode(earliest)!);
    // #196 (session 73): the ONE branch a fully evicted table can reach — no
    // available period (the freshness branch needs one), no dimension_labels
    // row (the no_data branch needs one) — so this is where "evicted
    // mid-flight" must be told apart from "CBS never published it". Checked
    // LAST, after every read above: any eviction that could have emptied one
    // of those reads committed before this statement runs, so the honest
    // refusal always wins; and a registration that still holds here means
    // every read above saw a live table. One statement, only on this branch
    // (#173) — the freshness and no_data outcomes pay nothing.
    const stillRegistered = await db.query('select 1 from cbs_tables where id = $1', [q.tableId]);
    if (stillRegistered.rows.length === 0) {
      return refuse(
        q.intent,
        'table_evicted',
        `table "${q.tableId}" was evicted while this query was in flight — it is no longer registered; the next question about it goes through the on-demand fetch again`,
        { axis: 'period' },
      );
    }
    return refuse(
      q.intent,
      'not_published',
      `CBS has not published period ${missingPeriod} for table "${q.tableId}" (grains with data: ${grainList})`,
      { axis: 'period', freshness, ...(tooOld ? { nearestAlternative: earliest } : {}) },
    );
  }

  return refuse(
    q.intent,
    'no_data',
    `period ${missingPeriod} is published for table "${q.tableId}" and inside the loaded slice, but no observation exists${where} at ${JSON.stringify(q.dims)} — a data gap that needs review, not an answer`,
    { axis: 'period', freshness },
  );
}

function toNumber(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`non-numeric value from the database: ${String(value)}`);
  return n;
}

/** Freshest period (any grain, any status) we hold for a canonical measure's
 * pinned coordinates — the WP9 seam for refusal offers (forecast/causal
 * offers, the still-ambiguous example) that need "the freshest we can serve"
 * without a full StructuredIntent/period to resolve against. Reuses the same
 * canonical-measure lookup resolve.ts's target-resolution branch performs,
 * rather than duplicating it with a different shape.
 *
 * Region handling: canonical measures on a regional table (population) are
 * asked about nationally unless the user names a place — NATIONAL_REGION_CODE
 * is the national aggregate code, imported from resolve.ts rather than spelled
 * out here (it was a third hardcoded 'NL01' until 2026-07-25; a layer that
 * re-declares another layer's constant is a layer that can drift from it).
 * Regionless tables use the '' convention resolve.ts/observations use
 * throughout. Grain-agnostic (freshest across every ingested grain): callers
 * only need "the freshest we can serve", not a specific grain's cadence. */
export async function freshestForCanonical(
  db: Db,
  canonicalKey: string,
  /** Both optional, both additive: omitted ⇒ byte-identical to every existing
   * caller (national/regionless region, every grain pooled together — this
   * function's own doc above). `regionCode` lets a caller ask "freshest for
   * THIS region" instead of the national default; `grain` restricts the
   * comparison to one grain, needed by any caller comparing against an
   * already-resolved period code (mixing grains in one `order by
   * period_year, period_index` is not a valid freshness ordering — KW04 and
   * MM12 of the same year are not comparable by `period_index` alone). */
  overrides?: { regionCode?: string; grain?: 'JJ' | 'KW' | 'MM' },
): Promise<{ periodCode: string; status: string } | null> {
  const cm = await db.query(
    'select table_id, measure, dims from canonical_measures where key = $1',
    [canonicalKey],
  );
  const row = cm.rows[0];
  if (!row) return null;
  const tableId = row.table_id as string;
  const measure = row.measure as string;
  const dims = (typeof row.dims === 'string' ? JSON.parse(row.dims) : row.dims) as Record<string, string>;

  const table = await db.query(
    'select expected_dimensions, default_coordinates, status from cbs_tables where id = $1',
    [tableId],
  );
  const tableRow = table.rows[0];
  if (!tableRow) return null;
  // #155 (session-47 ingestion hunt): the value path refuses a quarantined
  // table (resolve.ts, 'table_quarantined') before serving any number, but this
  // freshness-METADATA helper is called OUTSIDE that gate (refusals.ts forecast/
  // causal offers, dry-run.ts echoServability). Without this check a
  // needs_review table's freshest-period label could surface in a refusal/offer
  // — never a value, but still referencing a table we flagged as broken. Treat a
  // quarantined table as "no freshness to offer", mirroring the value-path gate.
  if (tableRow.status !== 'active') return null;
  const expectedDimensions = (
    typeof tableRow.expected_dimensions === 'string'
      ? JSON.parse(tableRow.expected_dimensions)
      : tableRow.expected_dimensions
  ) as { name: string; kind: string }[];
  const defaultCoordinates = (
    typeof tableRow.default_coordinates === 'string'
      ? JSON.parse(tableRow.default_coordinates)
      : (tableRow.default_coordinates ?? {})
  ) as Record<string, string>;
  const geoDimension = expectedDimensions.find((d) => d.kind === 'GeoDimension')?.name ?? null;
  const regionCode = geoDimension ? (overrides?.regionCode ?? NATIONAL_REGION_CODE) : '';

  // Observations store the FULL merged coordinate set: the table's pinned
  // default ("totaal") coordinates overlaid with the canonical measure's
  // semantic dims — the same precedence resolveIntent applies (resolve.ts,
  // "default (totaal) coordinates < canonical semantic dims"). Querying with
  // the canonical dims alone silently matches nothing (session review,
  // 2026-07-03: the forecast/causal offers then lose their period).
  const mergedDims = { ...defaultCoordinates, ...dims };

  const grainFilter = overrides?.grain ? 'and period_grain = $5' : '';
  const params = overrides?.grain
    ? [tableId, measure, JSON.stringify(mergedDims), regionCode, overrides.grain]
    : [tableId, measure, JSON.stringify(mergedDims), regionCode];
  const result = await db.query(
    `select period_code, status from observations
     where table_id = $1 and measure = $2 and dims = $3::jsonb and region_code = $4 ${grainFilter}
     order by period_year desc, coalesce(period_index, 0) desc limit 1`,
    params,
  );
  const freshest = result.rows[0];
  if (!freshest) return null;
  return { periodCode: freshest.period_code as string, status: freshest.status as string };
}

/** #110(b): usage bookkeeping for the on-demand table lifecycle — records that
 * an answer/follow-up/chart read used this table (`cbs_tables.last_queried_at`,
 * migration 025), which is the eviction GC's staleness anchor
 * (src/ingestion/eviction.ts). DEBOUNCED in the WHERE clause itself: the
 * UPDATE writes only when the stored value is > 1 day stale (or null), so a
 * popular table costs at most ~one row write per day — every other read runs a
 * zero-row UPDATE (no write, no row lock). SQL `now()` rather than an injected
 * clock, deliberately: the debounce needs no test-pinned instant (tests assert
 * bump/no-bump by manipulating the stored value), and threading a clock through
 * runQuery for bookkeeping would touch every caller.
 *
 * NEVER fails the read path: a bookkeeping write must not take down an answer
 * (the worst a missed bump can cost is a table evicted up to a day early, and
 * eviction is recoverable by re-onboarding — an answer failure is not). This
 * isolation also makes the migration-025 deploy window safe: code that reaches
 * production before the column exists warns instead of erroring.
 *
 * #196 (session 73): the row is taken with `for no key update skip locked` in
 * a subquery, so a bump that meets an in-flight eviction's `select … for
 * update` (src/ingestion/eviction.ts) SKIPS instead of queueing behind that
 * transaction — a served answer's latency and its pooled connection (#173)
 * are never coupled to an eviction's commit, and a table mid-eviction needs no
 * bump anyway. NO KEY UPDATE rather than UPDATE so a concurrent ingestion
 * insert's FK check (a KEY SHARE lock on this row) never causes a spurious
 * skip; eviction's FOR UPDATE still does. Same shape as onboarding-store's
 * claimOnePending; like there, the contention path is untestable under
 * single-connection PGlite and is source-pinned (tests/query/last-queried). */
export async function touchLastQueriedAt(db: Db, tableId: string): Promise<void> {
  try {
    await db.query(
      `update cbs_tables
          set last_queried_at = now()
        where id = (select id from cbs_tables where id = $1 for no key update skip locked)
          and (last_queried_at is null or last_queried_at < now() - interval '1 day')`,
      [tableId],
    );
  } catch (error) {
    console.warn(
      `last_queried_at bump failed for table ${tableId} (answer unaffected):`,
      error instanceof Error ? error.message : String(error),
    );
  }
}

export async function runQuery(
  db: Db,
  intent: StructuredIntent,
  /** WP26 (ADR 024): the answer-first switches. Absent ⇒ pre-WP26 behavior. */
  options: QueryOptions = {},
): Promise<QueryOutcome> {
  const outcome = await resolveIntent(db, intent, options);
  if (!outcome.ok) return outcome;
  const q = outcome.resolved;

  // --- Fetch all requested cells in one deterministic query ------------------
  // #196 (session 73): ONE statement, ONE snapshot. The period labels and the
  // retained cells' batch dates used to be two later statements
  // (dimension_labels, ingestion_batches), each its own autocommit snapshot —
  // an eviction committing between the fetch and either of them left a served
  // answer with raw period codes in its sentence and a too-new "gesynchroniseerd
  // op" date for a retained cell. LEFT-JOINed here they are read together with
  // the cells they describe, and a served turn pays two statements fewer (#173).
  const result = await db.query(
    `select o.region_code, o.period_code, o.value, o.unit, o.decimals, o.status, o.value_attribute,
            o.batch_id, o.last_seen_batch_id,
            dl.label as period_label,
            ib.finished_at as retained_finished_at
     from observations o
     left join dimension_labels dl
       on dl.table_id = o.table_id and dl.dimension = $6 and dl.code = o.period_code
     left join ingestion_batches ib
       on ib.id = o.last_seen_batch_id
     where o.table_id = $1 and o.measure = $2 and o.dims = $3::jsonb
       and o.region_code = any($4::text[]) and o.period_code = any($5::text[])`,
    [q.tableId, q.measure, JSON.stringify(q.dims), q.regionCodes, q.periodCodes, q.timeDimension],
  );
  const byCoordinate = new Map<string, ObservationRow>();
  const periodLabelByCode = new Map<string, string>();
  for (const row of result.rows) {
    const obs = row as unknown as ObservationRow;
    byCoordinate.set(`${obs.region_code}|${obs.period_code}`, obs);
    if (obs.period_label != null) periodLabelByCode.set(obs.period_code, normalizeLabel(obs.period_label));
  }

  // #110(b) usage bookkeeping — AFTER the fetch since #195/#196 (session 72,
  // adversarial review of PR #111), skip-locked since session 73:
  //  (a) #196 — a read never waits behind an eviction. The fetch above holds
  //      no lock and reads its own MVCC snapshot, so a query that arrives while
  //      evictStaleTables is mid-transaction simply sees the pre-eviction data
  //      (never a manufactured miss); and touchLastQueriedAt's UPDATE takes the
  //      row with `for no key update skip locked` (see its header), so it
  //      SKIPS an eviction's `select … for update` instead of queueing behind
  //      it — the served turn's latency and its pooled connection (#173) are
  //      never coupled to an eviction's commit.
  //  (b) #195 — only a DELIVERABLE read counts as demand. `options.probe`
  //      (dry-run.ts's echoServability, the servability-probe primitive every
  //      follow-up chip / comparison chip / alternate-reading check funnels
  //      through) skips the bump entirely: a probe never shows the caller a
  //      value, so it must not keep a table artificially "warm" for the
  //      eviction GC — the eviction anchor reads as "last SERVED/DELIVERED
  //      read", not "last touched by any internal machinery". Still runs on
  //      the missing-cell diagnosis path below (the original #110(b) design):
  //      a refusal for one missing period on an otherwise-present, still-
  //      registered table is still live demand for the table as a whole.
  // Debounced in touchLastQueriedAt's own WHERE clause and never fails the
  // read path (see that function's header) either way.
  if (options.probe !== true) {
    await touchLastQueriedAt(db, q.tableId);
  }

  // --- Completeness: every requested coordinate, or a diagnosed refusal ------
  // Diagnose the earliest missing period (then the intent's region order) so a
  // trailing not-yet-published year reads as freshness, an interior hole as a
  // gap.
  for (const periodCode of q.periodCodes) {
    for (const regionCode of q.regionCodes) {
      if (!byCoordinate.has(`${regionCode}|${periodCode}`)) {
        return diagnoseMissing(db, q, regionCode, periodCode);
      }
    }
  }

  // --- Build ordered, labeled cells ------------------------------------------
  // (the period labels came with the fetch above — one snapshot, #196)

  const cells: ResultCell[] = [];
  for (const periodCode of q.periodCodes) {
    for (const regionCode of q.regionCodes) {
      const row = byCoordinate.get(`${regionCode}|${periodCode}`)!;
      const parsed = parsePeriodCode(periodCode)!;
      const status = row.status;
      cells.push({
        resultId: buildResultId(q.tableId, q.measure, regionCode, periodCode, q.dims),
        tableId: q.tableId,
        measure: q.measure,
        measureTitle: q.measureTitle,
        regionCode: q.geoDimension ? regionCode : null,
        regionLabel: q.geoDimension ? (q.regionLabels[regionCode] ?? null) : null,
        periodCode,
        periodLabel: periodLabelByCode.get(periodCode) ?? periodCode,
        grain: parsed.grain,
        dims: q.dims,
        dimLabels: q.dimLabels,
        value: row.value == null ? null : toNumber(row.value),
        unit: row.unit,
        decimals: toNumber(row.decimals),
        status,
        // WP30b: the table's source declares which verbatim statuses count as
        // definitive; anything else is marked (fail-safe, principle c).
        // Byte-identical to the old `status !== 'Definitief'` for CBS cells.
        provisional: isProvisionalStatus(resolveSourceForTable(q.tableId), status),
        valueAttribute: row.value_attribute,
        batchId: toNumber(row.batch_id),
      });
    }
  }

  // --- Consistency guards (R10 groundwork): one unit across one measure ------
  const units = new Set(cells.map((c) => c.unit));
  if (units.size > 1) {
    return refuse(intent, 'internal_inconsistency', `cells of measure "${q.measure}" carry mixed units (${[...units].join(', ')}) — suspected ingestion corruption, refusing to serve`);
  }
  if (q.table.lastSyncAt === null) {
    return refuse(intent, 'internal_inconsistency', `table "${q.tableId}" has observations but no recorded sync time — registry inconsistency, refusing to serve`);
  }

  // --- Derivations: registered functions only (R5) ----------------------------
  const derivations: DerivationRecord[] = [];
  if (q.derivation === 'difference') {
    const derived = deriveDifference(cells);
    if (!derived.ok) return refuse(intent, 'derivation_failed', derived.reason, { axis: 'derivation' });
    derivations.push(derived.record);
  } else if (q.derivation === 'max') {
    const derived = deriveMax(cells, true);
    if (!derived.ok) return refuse(intent, 'derivation_failed', derived.reason, { axis: 'derivation' });
    derivations.push(derived.record);
  }

  // Pre-registered derivations (R9): every multi-period result carries
  // direction + first/last, every multi-region comparison a non-explicit max —
  // computed here, deterministically, so trend/ranking prose has something to
  // bind to. A pre-registration that refuses (null cells, tied max) is simply
  // omitted: prose then has nothing to bind direction words to and the
  // phrasing layer must fail closed (R9), which is the honest outcome.
  const allValuesPresent = cells.every((c) => c.value !== null);
  // Pre-registration stays UNCONDITIONAL for multi-period results — the #64
  // review weighed gating it for non-contiguous 'none' selections and
  // reverted: now_vs_ago (WP14/V02) produces the same disjoint shape for a
  // question that literally asks the comparison, and endpoint direction
  // prose ("gestegen van A naar B") is true, derivation-bound and the
  // B13/V02 house convention. The genuinely new dishonesty channel — a
  // LINE implying the unsampled hole — is closed in chart/build.ts instead;
  // the residual monotonic-describes-the-sample seam (pre-existing since
  // WP14) is recorded at open-questions #100 for the next prompt-touching WP.
  if (q.periodCodes.length > 1 && allValuesPresent) {
    const direction = deriveDirection(cells);
    if (direction.ok) derivations.push(direction.record);
    const firstLast = deriveFirstLast(cells);
    if (firstLast.ok) derivations.push(firstLast.record);
  }
  if (q.regionCodes.length > 1 && q.derivation !== 'max' && allValuesPresent) {
    const comparison = deriveMax(cells, false);
    if (comparison.ok) derivations.push(comparison.record);
  }
  // #125a (ADR 031): every non-null cell with a PURE numeric factor unit
  // ('x 1 000') pre-registers its exact expanded figure, so the display layer
  // can state "= 390.200" alongside the verbatim notation and R1/R3 have a
  // record to back that token. A refusal (non-factor unit, inexact) is simply
  // omitted — the answer then renders as before (fail-open display nicety).
  for (const cell of cells) {
    const expansion = deriveUnitExpansion(cell);
    if (expansion.ok) derivations.push(expansion.record);
  }

  // --- Attribution (R4), carried in the result itself --------------------------
  // #154: the displayed syncedAt is the MINIMUM (oldest) of the cells'
  // effective dates. A cell present in the latest sync is dated by
  // cbs_tables.last_sync_at (byte-identical to the old behavior — the 99%
  // case pays no extra query); a RETAINED cell (last_seen_batch_id set) is
  // dated by the finished_at of the batch that last confirmed it, so the
  // shown date honestly reflects the weakest link and checkStaleness —
  // which reads this same field — starts firing on exactly the class that
  // used to slip the net (design §3).
  // #196 (session 73): the retained batches' finished_at rode along with the
  // fetch (LEFT JOIN ingestion_batches on last_seen_batch_id) — no second
  // statement, no second snapshot, so an eviction landing after the fetch can
  // no longer hide the older date behind a "batch row gone" null.
  let effectiveSyncedAt = q.table.lastSyncAt;
  for (const row of byCoordinate.values()) {
    if (row.last_seen_batch_id == null || row.retained_finished_at == null) continue;
    const iso = new Date(row.retained_finished_at as string | Date).toISOString();
    if (iso < effectiveSyncedAt) effectiveSyncedAt = iso;
  }

  const attribution: Attribution = {
    tableId: q.tableId,
    tableTitle: q.table.title,
    tableVersion: q.table.version,
    // WP30a: everything registered today IS CBS; adapters for source #2
    // will carry their key through registration (ADR 030 D4/D5, WP30c).
    source: CBS_SOURCE_KEY,
    syncedAt: effectiveSyncedAt,
    coveredPeriods: { from: q.periodCodes[0]!, to: q.periodCodes[q.periodCodes.length - 1]! },
    license: 'CC BY 4.0',
    definitionLabel: q.definitionLabel,
    definitionText: q.definitionText,
    periodSemantics: q.table.periodSemantics?.[q.grain] ?? null,
    // #39: present-only (docs/13) — an answer whose canonical default has no
    // recorded alternates, and every explicit-target answer, serializes no key
    // at all, so all previously stored envelopes stay byte-identical.
    ...(q.alternates.length > 0 ? { alternates: q.alternates } : {}),
  };

  const shape: ResultShape =
    q.derivation === 'difference' || q.derivation === 'max'
      ? 'derived'
      : q.periodCodes.length > 1
        ? 'series'
        : q.regionCodes.length > 1
          ? 'comparison'
          : 'single';

  return {
    ok: true,
    schemaVersion: RESULT_SCHEMA_VERSION,
    shape,
    cells,
    derivations,
    attribution,
    // #196 (session 73): the registry facts the staleness check needs, from the
    // row this query resolved against — read once, never re-read after the fetch.
    registry: { updateCadence: q.table.updateCadence, lastSyncAt: q.table.lastSyncAt },
    // WP26 mechanism B: the intent we ACTUALLY ran — identical to the caller's
    // object unless a safelisted axis was defaulted, in which case R8 must show
    // the resolved coordinate, not the under-specified ask.
    intent: q.intent,
    // Present-only (A1 discipline): a non-defaulted answer serializes no key,
    // so every pre-WP26 and flag-off envelope stays byte-identical.
    ...(q.regionDefaulted ? { regionDefaulted: true as const } : {}),
  };
}

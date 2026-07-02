// Query execution: ResolvedQuery -> ValidatedResult | QueryRefusal.
// Deterministic SQL over `observations`, completeness-checked against the
// intent (every requested coordinate must produce a cell, or the whole query
// refuses with a diagnosis — never a silently partial answer), derivations
// applied only through the registered functions (R5), attribution attached so
// no rendering path can drop it (R4). No LLM anywhere (WP5).
import type { Db } from '../db/types.ts';
import { parsePeriodCode } from '../ingestion/periods.ts';
import { deriveDifference, deriveDirection, deriveFirstLast, deriveMax } from './derivations.ts';
import { normalizeLabel, periodKey, resolveIntent, type ResolvedQuery } from './resolve.ts';
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
  const definitief = await db.query(base + ` and status = 'Definitief'` + order, params);
  return {
    freshestAvailable: available.rows[0]
      ? { periodCode: available.rows[0].period_code as string, status: available.rows[0].status as string }
      : null,
    freshestDefinitief: definitief.rows[0]
      ? { periodCode: definitief.rows[0].period_code as string }
      : null,
  };
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
    return refuse(
      q.intent,
      'not_published',
      `CBS has not published period ${missingPeriod} for table "${q.tableId}" (grains with data: ${grainList})`,
      { axis: 'period', freshness },
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

export async function runQuery(db: Db, intent: StructuredIntent): Promise<QueryOutcome> {
  const outcome = await resolveIntent(db, intent);
  if (!outcome.ok) return outcome;
  const q = outcome.resolved;

  // --- Fetch all requested cells in one deterministic query ------------------
  const result = await db.query(
    `select region_code, period_code, value, unit, decimals, status, value_attribute, batch_id
     from observations
     where table_id = $1 and measure = $2 and dims = $3::jsonb
       and region_code = any($4::text[]) and period_code = any($5::text[])`,
    [q.tableId, q.measure, JSON.stringify(q.dims), q.regionCodes, q.periodCodes],
  );
  const byCoordinate = new Map<string, ObservationRow>();
  for (const row of result.rows) {
    byCoordinate.set(`${row.region_code}|${row.period_code}`, row as unknown as ObservationRow);
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
  const periodLabels = await db.query(
    'select code, label from dimension_labels where table_id = $1 and dimension = $2 and code = any($3::text[])',
    [q.tableId, q.timeDimension, q.periodCodes],
  );
  const periodLabelByCode = new Map(
    periodLabels.rows.map((r) => [r.code as string, normalizeLabel(r.label as string)]),
  );

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
        provisional: status !== 'Definitief',
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

  // --- Attribution (R4), carried in the result itself --------------------------
  const attribution: Attribution = {
    tableId: q.tableId,
    tableTitle: q.table.title,
    tableVersion: q.table.version,
    syncedAt: q.table.lastSyncAt,
    coveredPeriods: { from: q.periodCodes[0]!, to: q.periodCodes[q.periodCodes.length - 1]! },
    license: 'CC BY 4.0',
    definitionLabel: q.definitionLabel,
    periodSemantics: q.table.periodSemantics?.[q.grain] ?? null,
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
    intent,
  };
}

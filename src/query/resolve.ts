// Intent resolution: StructuredIntent -> ResolvedQuery (validated CBS
// coordinates) or a typed refusal. Everything here is deterministic reads of
// the registry (cbs_tables, canonical_measures, dimension_labels) — no
// observation data yet, no LLM anywhere (WP5, docs/08-build-plan.md).
//
// Ordering: structural validity first (an intent that can never be valid),
// then registry resolution (table, measure, dims, regions), then slice
// compatibility. Period *availability* is a data question, not an intent
// question — a well-formed request for an unpublished period resolves fine
// here and refuses with the right kind (freshness / not_published) in run.ts.
import type { CbsSlice } from '../cbs-adapter/types.ts';
import type { Db } from '../db/types.ts';
import { parsePeriodCode, type ParsedPeriod } from '../ingestion/periods.ts';
import type {
  IntentDerivation,
  PeriodGrain,
  QueryRefusal,
  StructuredIntent,
} from './types.ts';
import { INTENT_SCHEMA_VERSION } from './types.ts';

export interface ResolvedQuery {
  intent: StructuredIntent;
  tableId: string;
  measure: string;
  measureTitle: string;
  /** Merged, validated non-geo/non-period coordinates. */
  dims: Record<string, string>;
  /** Labels for the merged dims — R9 binding data, fetched once here. */
  dimLabels: Record<string, string>;
  /** Validated region codes in intent order; [''] for tables without a geo
   * dimension (matching observations.region_code's '' convention). */
  regionCodes: string[];
  regionLabels: Record<string, string>;
  geoDimension: string | null;
  timeDimension: string;
  /** Fully enumerated period codes, ascending. */
  periodCodes: string[];
  grain: PeriodGrain;
  derivation: IntentDerivation;
  definitionLabel: string | null;
  table: {
    title: string;
    version: number;
    lastSyncAt: string | null;
    slice: CbsSlice | null;
    periodSemantics: Record<string, string> | null;
  };
}

export type ResolveOutcome = { ok: true; resolved: ResolvedQuery } | QueryRefusal;

function refuse(
  intent: StructuredIntent,
  kind: QueryRefusal['refusal']['kind'],
  message: string,
  extra?: Partial<QueryRefusal['refusal']>,
): QueryRefusal {
  return { ok: false, refusal: { kind, message, ...extra }, intent };
}

function parseJsonb<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  return (typeof value === 'string' ? JSON.parse(value) : value) as T;
}

/** CBS metadata carries stray whitespace (double spaces inside measure
 * titles, trailing spaces on table titles — wire quirks like docs/07's code
 * padding). Codes are trimmed at parse time; human-readable titles/labels are
 * normalized here, at the presentation seam, so attribution matches how the
 * frozen answer key and docs record them. Whitespace-only — never touches
 * content. */
export function normalizeLabel(label: string): string {
  return label.replace(/\s+/g, ' ').trim();
}

/** Sortable key for parsed periods of one grain. */
export function periodKey(p: ParsedPeriod): number {
  return p.year * 100 + (p.index ?? 0);
}

/** Enumerates the inclusive range from..to at one grain, ascending. */
export function enumeratePeriods(from: ParsedPeriod, to: ParsedPeriod): string[] {
  const codes: string[] = [];
  if (from.grain === 'JJ') {
    for (let y = from.year; y <= to.year; y++) codes.push(`${y}JJ00`);
    return codes;
  }
  const maxIndex = from.grain === 'KW' ? 4 : 12;
  let year = from.year;
  let index = from.index ?? 1;
  const endKey = periodKey(to);
  while (year * 100 + index <= endKey) {
    codes.push(`${year}${from.grain}${String(index).padStart(2, '0')}`);
    index++;
    if (index > maxIndex) {
      index = 1;
      year++;
    }
  }
  return codes;
}

async function fetchLabels(
  db: Db,
  tableId: string,
  dimension: string,
  codes: string[],
): Promise<Map<string, string>> {
  if (codes.length === 0) return new Map();
  const result = await db.query(
    'select code, label from dimension_labels where table_id = $1 and dimension = $2 and code = any($3::text[])',
    [tableId, dimension, codes],
  );
  return new Map(result.rows.map((r) => [r.code as string, normalizeLabel(r.label as string)]));
}

interface TableRow {
  title: string;
  version: number;
  status: 'active' | 'needs_review';
  needsReviewReason: string | null;
  lastSyncAt: string | null;
  expectedDimensions: { name: string; kind: string }[];
  defaultCoordinates: Record<string, string>;
  periodSemantics: Record<string, string> | null;
  slice: CbsSlice | null;
  units: Record<string, { unit: string; decimals: number; title: string }>;
}

async function fetchTable(db: Db, tableId: string): Promise<TableRow | null> {
  const result = await db.query('select * from cbs_tables where id = $1', [tableId]);
  const row = result.rows[0];
  if (!row) return null;
  return {
    title: normalizeLabel(row.title as string),
    version: Number(row.version),
    status: row.status as TableRow['status'],
    needsReviewReason: (row.needs_review_reason as string | null) ?? null,
    lastSyncAt: row.last_sync_at == null ? null : new Date(row.last_sync_at as string | Date).toISOString(),
    expectedDimensions: parseJsonb(row.expected_dimensions, []),
    defaultCoordinates: parseJsonb(row.default_coordinates, {}),
    periodSemantics: parseJsonb(row.period_semantics, null),
    slice: parseJsonb(row.slice, null),
    units: parseJsonb(row.units, {}),
  };
}

/** Lexicographic compare, matching sliceToFilter's `Perioden ge 'code'`
 * semantics (CBS period codes sort correctly as strings). */
function belowPeriodFloor(periodCode: string, floor: string | undefined): boolean {
  return floor !== undefined && periodCode < floor;
}

export async function resolveIntent(db: Db, intent: StructuredIntent): Promise<ResolveOutcome> {
  // --- Structural validity -------------------------------------------------
  if (intent.schemaVersion !== INTENT_SCHEMA_VERSION) {
    return refuse(intent, 'invalid_intent', `unsupported intent schemaVersion ${intent.schemaVersion}; this query layer speaks version ${INTENT_SCHEMA_VERSION}`);
  }

  let parsedPeriods: { code: string; parsed: ParsedPeriod }[];
  if (intent.period.kind === 'codes') {
    if (intent.period.codes.length === 0) {
      return refuse(intent, 'invalid_intent', 'period.codes is empty', { axis: 'period' });
    }
    const parsed: { code: string; parsed: ParsedPeriod }[] = [];
    for (const code of intent.period.codes) {
      const p = parsePeriodCode(code);
      if (!p) return refuse(intent, 'invalid_intent', `"${code}" is not a CBS period code`, { axis: 'period' });
      parsed.push({ code, parsed: p });
    }
    const grains = new Set(parsed.map((p) => p.parsed.grain));
    if (grains.size > 1) {
      return refuse(intent, 'invalid_intent', `period codes mix grains (${[...grains].join(', ')}) — one grain per question`, { axis: 'period' });
    }
    if (new Set(parsed.map((p) => p.code)).size !== parsed.length) {
      return refuse(intent, 'invalid_intent', 'period.codes contains duplicates', { axis: 'period' });
    }
    parsedPeriods = [...parsed].sort((a, b) => periodKey(a.parsed) - periodKey(b.parsed));
  } else {
    const from = parsePeriodCode(intent.period.from);
    const to = parsePeriodCode(intent.period.to);
    if (!from || !to) {
      return refuse(intent, 'invalid_intent', `period range endpoint is not a CBS period code (from="${intent.period.from}", to="${intent.period.to}")`, { axis: 'period' });
    }
    if (from.grain !== to.grain) {
      return refuse(intent, 'invalid_intent', `period range mixes grains (${from.grain}..${to.grain})`, { axis: 'period' });
    }
    if (periodKey(from) > periodKey(to)) {
      return refuse(intent, 'invalid_intent', `period range runs backwards (${intent.period.from} > ${intent.period.to})`, { axis: 'period' });
    }
    parsedPeriods = enumeratePeriods(from, to).map((code) => ({
      code,
      parsed: parsePeriodCode(code)!,
    }));
  }
  const grain = parsedPeriods[0]!.parsed.grain;
  const periodCodes = parsedPeriods.map((p) => p.code);

  const regions = intent.regions ?? [];
  if (new Set(regions).size !== regions.length) {
    return refuse(intent, 'invalid_intent', 'regions contains duplicates', { axis: 'region' });
  }

  // --- Derivation arity (structural: can never be satisfied) ---------------
  // Phase 0 supports one varying axis per question: several periods at one
  // place, or several regions at one period — never both (**Assumption**,
  // mirrored in docs/open-questions.md; revisit with WP6 if a benchmark-shaped
  // question needs it).
  if (periodCodes.length > 1 && regions.length > 1) {
    return refuse(intent, 'invalid_intent', 'several regions AND several periods in one question is not supported (one varying axis per question)');
  }
  switch (intent.derivation) {
    case 'difference':
      if (periodCodes.length !== 2) {
        return refuse(intent, 'invalid_intent', `derivation "difference" needs exactly 2 periods, got ${periodCodes.length}`, { axis: 'derivation' });
      }
      if (regions.length > 1) {
        return refuse(intent, 'invalid_intent', 'derivation "difference" compares periods at one place — several regions given', { axis: 'derivation' });
      }
      break;
    case 'max':
      if (periodCodes.length !== 1 || regions.length < 2) {
        return refuse(intent, 'invalid_intent', `derivation "max" needs exactly 1 period and at least 2 regions, got ${periodCodes.length} period(s) and ${regions.length} region(s)`, { axis: 'derivation' });
      }
      break;
    case 'series':
      if (periodCodes.length < 2) {
        return refuse(intent, 'invalid_intent', `derivation "series" needs a multi-period selection, got ${periodCodes.length} period(s)`, { axis: 'derivation' });
      }
      break;
    case 'none':
      break;
    default:
      return refuse(intent, 'invalid_intent', `unknown derivation kind "${(intent as { derivation: string }).derivation}"`, { axis: 'derivation' });
  }

  // --- Target resolution ----------------------------------------------------
  let tableId: string;
  let measure: string;
  let semanticDims: Record<string, string>;
  let explicitDims: Record<string, string>;
  let definitionLabel: string | null;
  if (intent.target.kind === 'canonical') {
    const result = await db.query(
      'select table_id, measure, measure_title, dims, definition_label from canonical_measures where key = $1',
      [intent.target.key],
    );
    const row = result.rows[0];
    if (!row) {
      return refuse(intent, 'invalid_intent', `unknown canonical measure key "${intent.target.key}" — not in the registry's alias list`, { axis: 'measure' });
    }
    tableId = row.table_id as string;
    measure = row.measure as string;
    semanticDims = parseJsonb(row.dims, {});
    explicitDims = {};
    definitionLabel = row.definition_label as string;
  } else {
    tableId = intent.target.tableId;
    measure = intent.target.measure;
    semanticDims = {};
    explicitDims = intent.target.dims ?? {};
    definitionLabel = null;
  }

  const table = await fetchTable(db, tableId);
  if (!table) {
    return refuse(intent, 'table_not_registered', `table "${tableId}" is not registered — out of the loaded Phase 0 scope`, { axis: 'measure' });
  }
  if (table.status === 'needs_review') {
    return refuse(intent, 'table_quarantined', `table "${tableId}" is quarantined pending review (${table.needsReviewReason ?? 'reason not recorded'}) — not served until it passes validation again`);
  }

  const measureMeta = table.units[measure];
  if (!measureMeta) {
    return refuse(intent, 'invalid_intent', `measure "${measure}" does not exist on table "${tableId}"`, { axis: 'measure' });
  }

  // --- Dimensions ------------------------------------------------------------
  const geoDimension = table.expectedDimensions.find((d) => d.kind === 'GeoDimension')?.name ?? null;
  const timeDimension = table.expectedDimensions.find((d) => d.kind === 'TimeDimension')?.name ?? 'Perioden';
  const plainDimensions = table.expectedDimensions.filter((d) => d.kind === 'Dimension').map((d) => d.name);

  // default (totaal) coordinates < canonical semantic dims < explicit dims
  const dims: Record<string, string> = { ...table.defaultCoordinates, ...semanticDims, ...explicitDims };
  for (const dim of Object.keys(dims)) {
    if (!plainDimensions.includes(dim)) {
      return refuse(intent, 'invalid_intent', `"${dim}" is not a dimension of table "${tableId}" (has: ${plainDimensions.join(', ') || 'none'})`, { axis: 'measure' });
    }
  }
  const unpinned = plainDimensions.filter((d) => dims[d] === undefined);
  const dimLabels: Record<string, string> = {};
  for (const [dim, code] of Object.entries(dims)) {
    const labels = await fetchLabels(db, tableId, dim, [code]);
    const label = labels.get(code);
    if (label === undefined) {
      return refuse(intent, 'invalid_intent', `code "${code}" does not exist in dimension "${dim}" of table "${tableId}"`, { axis: 'measure' });
    }
    dimLabels[dim] = label;
  }

  // --- Regions ----------------------------------------------------------------
  let regionCodes: string[] = [''];
  let regionLabels: Record<string, string> = {};
  let regionMissing = false;
  if (geoDimension) {
    if (regions.length === 0) {
      regionMissing = true;
    } else {
      const labels = await fetchLabels(db, tableId, geoDimension, regions);
      const unknown = regions.filter((r) => !labels.has(r));
      if (unknown.length > 0) {
        return refuse(intent, 'invalid_intent', `region code(s) ${unknown.join(', ')} do not exist in dimension "${geoDimension}" of table "${tableId}"`, { axis: 'region' });
      }
      regionCodes = [...regions];
      regionLabels = Object.fromEntries(regions.map((r) => [r, labels.get(r)!]));
    }
  } else if (regions.length > 0) {
    return refuse(intent, 'invalid_intent', `table "${tableId}" has no regional dimension, but the intent names region(s) ${regions.join(', ')}`, { axis: 'region' });
  }

  // --- Clarification: ALL unresolved user-facing axes in ONE refusal ----------
  // docs/05's failure table requires the single clarification round to cover
  // every unresolved axis at once (combined presets) — so this refusal must
  // name them all, never just the first one hit (principle c: no axis is ever
  // defaulted silently).
  if (unpinned.length > 0 || regionMissing) {
    const axes: ('measure' | 'region')[] = [];
    const parts: string[] = [];
    if (unpinned.length > 0) {
      axes.push('measure');
      parts.push(`dimension(s) ${unpinned.join(', ')} carry no coordinate (materially different readings exist)`);
    }
    if (regionMissing) {
      axes.push('region');
      parts.push(`no region is named (table is regional: ${geoDimension})`);
    }
    return refuse(intent, 'needs_clarification', `table "${tableId}": ${parts.join('; and ')} — these must be chosen, never defaulted silently`, { axis: axes[0], axes });
  }

  // --- Slice compatibility (docs/05: "outside the loaded slice" is its own
  // refusal, distinct from "not published by CBS") -----------------------------
  const slice = table.slice;
  if (slice) {
    for (const [dim, pinned] of Object.entries(slice.dimensionEquals ?? {})) {
      if (dims[dim] !== undefined && dims[dim] !== pinned) {
        return refuse(intent, 'outside_loaded_slice', `dimension "${dim}" is only loaded at coordinate "${pinned}" (asked: "${dims[dim]}") — CBS publishes more, but it is outside our ingested slice`, { axis: 'measure', nearestAlternative: pinned });
      }
    }
    for (const [dim, prefixes] of Object.entries(slice.dimensionPrefixes ?? {})) {
      if (dim === geoDimension) {
        for (const region of regionCodes) {
          if (!prefixes.some((p) => region.startsWith(p))) {
            return refuse(intent, 'outside_loaded_slice', `region "${region}" is outside the loaded slice of table "${tableId}" (loaded: ${prefixes.map((p) => `${p}…`).join(', ')})`, { axis: 'region' });
          }
        }
      } else if (dims[dim] !== undefined && !prefixes.some((p) => dims[dim]!.startsWith(p))) {
        return refuse(intent, 'outside_loaded_slice', `dimension "${dim}" coordinate "${dims[dim]}" is outside the loaded slice of table "${tableId}" (loaded: ${prefixes.map((p) => `${p}…`).join(', ')})`, { axis: 'measure' });
      }
    }
    for (const { code } of parsedPeriods) {
      if (belowPeriodFloor(code, slice.periodFloor)) {
        return refuse(intent, 'outside_loaded_slice', `period ${code} is before the loaded slice of table "${tableId}" (loaded from ${slice.periodFloor}) — CBS publishes earlier periods, but they are outside our ingested slice`, { axis: 'period', nearestAlternative: slice.periodFloor });
      }
    }
  }

  return {
    ok: true,
    resolved: {
      intent,
      tableId,
      measure,
      measureTitle: normalizeLabel(measureMeta.title),
      dims,
      dimLabels,
      regionCodes,
      regionLabels,
      geoDimension,
      timeDimension,
      periodCodes,
      grain,
      derivation: intent.derivation,
      definitionLabel,
      table: {
        title: table.title,
        version: table.version,
        lastSyncAt: table.lastSyncAt,
        slice,
        periodSemantics: table.periodSemantics,
      },
    },
  };
}

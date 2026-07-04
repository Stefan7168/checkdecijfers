// Deterministic resolution: one raw LLM candidate → a frozen-contract
// StructuredIntent, or a typed ResolutionFailure that exits to clarification.
// Everything here is registry/database reads and arithmetic — the LLM's
// region NAMES and period DESCRIPTIONS become CBS codes only in this file,
// so a hallucinated code can never reach the query layer (principle a).
//
// Pass-through policy: failures the query layer already refuses honestly
// (missing region on a geo table, several regions AND several periods, a
// unique region outside the loaded slice) are NOT duplicated here — the
// intent is emitted and WP5's typed refusal is the single source of that
// behavior. This file only catches what the query layer cannot see: name
// ambiguity, unknown names, missing/unresolvable periods.
import type { Db } from '../../db/types.ts';
import { INTENT_SCHEMA_VERSION } from '../../query/index.ts';
import type { IntentPeriod, StructuredIntent } from '../../query/index.ts';
import type {
  PeriodSpec,
  RankedCandidate,
  RawCandidate,
  RegionKind,
  ResolutionFailure,
} from './types.ts';

/** Canonical keys whose yearly period code is a stand per 1 januari — for
 * these, "groei in jaar X" = cell(X+1) − cell(X); for flow/average measures
 * it is cell(X) − cell(X−1). Curated from the registry's period_semantics
 * prose (src/registry/defaults.ts); the hermetic test suite cross-checks each
 * listed key's JJ semantics text against the database. */
export const STAND_START_OF_YEAR_KEYS = new Set([
  'population_on_1_january',
  'housing_stock_start_of_year',
]);

/** Everyday-name → official CBS base name. CBS labels Den Haag as
 * 's-Gravenhage (docs/07 quirk); users overwhelmingly say Den Haag. */
const REGION_NAME_ALIASES: Record<string, string> = {
  'den haag': "'s-gravenhage",
};

const KIND_CODE_PREFIX: Record<Exclude<RegionKind, 'onbekend'>, string> = {
  land: 'NL',
  landsdeel: 'LD',
  provincie: 'PV',
  gemeente: 'GM',
};

/** Matching normalization: lowercase, straight apostrophes, no diacritics,
 * collapsed whitespace. Display strings always use the original CBS label. */
export function normalizeRegionName(name: string): string {
  const flattened = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[‘’ʼ]/g, "'")
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  return REGION_NAME_ALIASES[flattened] ?? flattened;
}

/** CBS disambiguates colliding names with a trailing parenthetical:
 * "Utrecht (gemeente)", "Utrecht (PV)". The base name is what users say.
 * Exported for the WP15 context builder (code→name round-trip, ADR 021). */
export function baseLabel(label: string): string {
  return label.replace(/\s*\([^)]*\)\s*$/, '');
}

interface CanonicalRow {
  key: string;
  tableId: string;
  measure: string;
  definitionLabel: string;
  /** The FULL coordinate set the canonical measure's cells sit at: the
   * table's pinned default ("totaal") coordinates overlaid with the
   * measure's semantic dims — the same precedence the query layer and
   * freshestForCanonical apply. Every period/grain lookup in this file must
   * filter on it: a grain that exists only at a DIFFERENT coordinate (CBS
   * publishes no seasonally-adjusted YEARLY unemployment — the yearly cells
   * are un-corrected) is not servable under the canonical definition, and
   * promising it here would dead-end in a no_data refusal downstream
   * (WP14 finding, 2026-07-04). */
  mergedDims: Record<string, string>;
}

interface TableGeo {
  geoDimension: string | null;
  geoSlicePrefixes: string[] | null;
}

async function fetchCanonical(db: Db, key: string): Promise<CanonicalRow | null> {
  const result = await db.query(
    `select c.key, c.table_id, c.measure, c.definition_label, c.dims, t.default_coordinates
     from canonical_measures c join cbs_tables t on t.id = c.table_id
     where c.key = $1`,
    [key],
  );
  const row = result.rows[0];
  if (!row) return null;
  const parseJson = (v: unknown): Record<string, string> =>
    v == null ? {} : ((typeof v === 'string' ? JSON.parse(v) : v) as Record<string, string>);
  return {
    key: row.key as string,
    tableId: row.table_id as string,
    measure: row.measure as string,
    definitionLabel: row.definition_label as string,
    mergedDims: { ...parseJson(row.default_coordinates), ...parseJson(row.dims) },
  };
}

async function fetchTableGeo(db: Db, tableId: string): Promise<TableGeo> {
  const result = await db.query(
    'select expected_dimensions, slice from cbs_tables where id = $1',
    [tableId],
  );
  const row = result.rows[0];
  if (!row) return { geoDimension: null, geoSlicePrefixes: null };
  const parse = <T>(v: unknown, fallback: T): T =>
    v == null ? fallback : ((typeof v === 'string' ? JSON.parse(v) : v) as T);
  const dimensions = parse<{ name: string; kind: string }[]>(row.expected_dimensions, []);
  const geoDimension = dimensions.find((d) => d.kind === 'GeoDimension')?.name ?? null;
  const slice = parse<{ dimensionPrefixes?: Record<string, string[]> } | null>(row.slice, null);
  const geoSlicePrefixes =
    geoDimension && slice?.dimensionPrefixes?.[geoDimension]
      ? slice.dimensionPrefixes[geoDimension]!
      : null;
  return { geoDimension, geoSlicePrefixes };
}

interface RegionMatch {
  code: string;
  label: string;
}

type RegionResolution =
  | { ok: true; codes: string[] }
  | { ok: false; failure: Pick<ResolutionFailure, 'axis' | 'reason' | 'message' | 'options'> };

async function resolveRegions(
  db: Db,
  candidate: RawCandidate,
  canonical: CanonicalRow,
  geo: TableGeo,
): Promise<RegionResolution> {
  const terms = candidate.regions ?? [];
  if (terms.length === 0) return { ok: true, codes: [] };

  if (!geo.geoDimension) {
    // "Nederland" on a national-only measure IS the national figure — only a
    // sub-national place is a real mismatch (B16), never the country itself
    // ("Hoeveel woningen telde Nederland?" = B6, a plain national lookup).
    const subNational = terms.filter(
      (t) => t.kind !== 'land' && !/^(heel )?nederland$/.test(normalizeRegionName(t.name)),
    );
    if (subNational.length === 0) return { ok: true, codes: [] };
    return {
      ok: false,
      failure: {
        axis: 'region',
        reason: 'region_on_national_measure',
        message: `"${canonical.definitionLabel}" is only available nationally; the question names ${subNational.map((t) => `"${t.name}"`).join(', ')}`,
        options: ['heel Nederland'],
      },
    };
  }

  const labelRows = await db.query(
    'select code, label from dimension_labels where table_id = $1 and dimension = $2',
    [canonical.tableId, geo.geoDimension],
  );
  const all: RegionMatch[] = labelRows.rows.map((r) => ({
    code: (r.code as string).trim(),
    label: (r.label as string).replace(/\s+/g, ' ').trim(),
  }));

  const codes: string[] = [];
  for (const term of terms) {
    const wanted = normalizeRegionName(term.name);
    let matches = all.filter((m) => normalizeRegionName(baseLabel(m.label)) === wanted);
    if (term.kind !== 'onbekend') {
      const prefix = KIND_CODE_PREFIX[term.kind];
      matches = matches.filter((m) => m.code.startsWith(prefix));
    }
    if (matches.length === 0) {
      return {
        ok: false,
        failure: {
          axis: 'region',
          reason: 'region_unknown',
          message: `"${term.name}" matches no region of table ${canonical.tableId}`,
          options: [],
        },
      };
    }
    if (matches.length > 1) {
      // Ambiguity is judged (and options are offered) within the loaded
      // slice only — an option must resolve in the loaded data (docs/05).
      const inSlice = geo.geoSlicePrefixes
        ? matches.filter((m) => geo.geoSlicePrefixes!.some((p) => m.code.startsWith(p)))
        : matches;
      const effective = inSlice.length > 0 ? inSlice : matches;
      if (effective.length > 1) {
        return {
          ok: false,
          failure: {
            axis: 'region',
            reason: 'region_ambiguous',
            message: `"${term.name}" matches several regions: ${effective.map((m) => m.label).join(', ')}`,
            options: effective.map((m) => m.label),
          },
        };
      }
      matches = effective;
    }
    codes.push(matches[0]!.code);
  }
  return { ok: true, codes };
}

// ---------------------------------------------------------------------------
// Periods
// ---------------------------------------------------------------------------

const pad2 = (n: number): string => String(n).padStart(2, '0');

function isSaneYear(year: number): boolean {
  return Number.isInteger(year) && year >= 1900 && year <= 2100;
}

/** Steps a CBS period code by `steps` positions at its own grain (negative =
 * back): 2026KW01 −20 → 2021KW01, 2026MM06 −60 → 2021MM06. Null when the code
 * does not parse — callers fail loudly, never step a code they can't read. */
export function stepPeriodCode(code: string, steps: number): string | null {
  // Fail-loud covers BOTH arguments: a fractional/NaN step would otherwise
  // produce a plausible-looking garbage code ('2026KW2.5') — exactly the kind
  // of silently-wrong value principle (c) exists to prevent (review finding,
  // 2026-07-04; unreachable from current call sites, but this is exported).
  if (!Number.isInteger(steps)) return null;
  const match = /^(\d{4})(JJ|KW|MM)(\d{2})$/.exec(code);
  if (!match) return null;
  const year = Number(match[1]);
  const grain = match[2] as 'JJ' | 'KW' | 'MM';
  if (grain === 'JJ') return `${year + steps}JJ00`;
  const perYear = grain === 'KW' ? 4 : 12;
  const index = Number(match[3]);
  if (index < 1 || index > perYear) return null;
  const absolute = year * perYear + (index - 1) + steps;
  const steppedYear = Math.floor(absolute / perYear);
  const steppedIndex = ((absolute % perYear) + perYear) % perYear + 1;
  return `${steppedYear}${grain}${pad2(steppedIndex)}`;
}

/** Grains published AT THE CANONICAL COORDINATE (mergedDims) — never the bare
 * measure: unemployment's yearly cells exist only un-corrected, so JJ is not
 * a grain the seasonally-adjusted canonical reading can serve (WP14). */
async function availableGrains(db: Db, canonical: CanonicalRow): Promise<Set<string>> {
  const result = await db.query(
    'select distinct period_grain from observations where table_id = $1 and measure = $2 and dims = $3::jsonb',
    [canonical.tableId, canonical.measure, JSON.stringify(canonical.mergedDims)],
  );
  return new Set(result.rows.map((r) => r.period_grain as string));
}

/** Freshest published period at one grain, at the canonical coordinate — a
 * period CODE lookup only, no values (a refusal or clarification never
 * carries data, principle c). */
async function latestPeriod(db: Db, canonical: CanonicalRow, grain: string): Promise<string | null> {
  const result = await db.query(
    'select max(period_code) as latest from observations where table_id = $1 and measure = $2 and period_grain = $3 and dims = $4::jsonb',
    [canonical.tableId, canonical.measure, grain, JSON.stringify(canonical.mergedDims)],
  );
  return (result.rows[0]?.latest as string | null) ?? null;
}

interface ReferenceDate {
  year: number;
  month: number;
}

export function parseReferenceDate(iso: string): ReferenceDate {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) throw new Error(`referenceDate must be YYYY-MM-DD, got "${iso}"`);
  return { year: Number(match[1]), month: Number(match[2]) };
}

type PeriodResolution =
  | { ok: true; period: IntentPeriod; impliedRecency: boolean }
  | { ok: false; failure: Pick<ResolutionFailure, 'axis' | 'reason' | 'message' | 'options'> };

function periodFailure(
  reason: 'period_invalid' | 'period_missing' | 'grain_unavailable',
  message: string,
  options: string[] = [],
): PeriodResolution {
  return { ok: false, failure: { axis: 'period', reason, message, options } };
}

const GRAIN_LABEL: Record<string, string> = { JJ: 'per jaar', KW: 'per kwartaal', MM: 'per maand' };

async function resolvePeriod(
  db: Db,
  spec: PeriodSpec,
  canonical: CanonicalRow,
  reference: ReferenceDate,
): Promise<PeriodResolution> {
  const grains = await availableGrains(db, canonical);
  const requireGrain = (grain: 'JJ' | 'KW' | 'MM'): PeriodResolution | null => {
    if (grains.has(grain)) return null;
    return periodFailure(
      'grain_unavailable',
      `"${canonical.definitionLabel}" is not published ${GRAIN_LABEL[grain]}`,
      [...grains].sort().map((g) => GRAIN_LABEL[g] ?? g),
    );
  };

  switch (spec.kind) {
    case 'year': {
      if (!isSaneYear(spec.year)) return periodFailure('period_invalid', `year ${spec.year} is not a plausible year`);
      return requireGrain('JJ') ?? { ok: true, period: { kind: 'codes', codes: [`${spec.year}JJ00`] }, impliedRecency: false };
    }
    case 'quarter': {
      if (!isSaneYear(spec.year) || !Number.isInteger(spec.quarter) || spec.quarter < 1 || spec.quarter > 4) {
        return periodFailure('period_invalid', `quarter ${spec.quarter}/${spec.year} is not a valid quarter`);
      }
      return requireGrain('KW') ?? { ok: true, period: { kind: 'codes', codes: [`${spec.year}KW${pad2(spec.quarter)}`] }, impliedRecency: false };
    }
    case 'month': {
      if (!isSaneYear(spec.year) || !Number.isInteger(spec.month) || spec.month < 1 || spec.month > 12) {
        return periodFailure('period_invalid', `month ${spec.month}/${spec.year} is not a valid month`);
      }
      return requireGrain('MM') ?? { ok: true, period: { kind: 'codes', codes: [`${spec.year}MM${pad2(spec.month)}`] }, impliedRecency: false };
    }
    case 'year_range': {
      if (!isSaneYear(spec.fromYear) || !isSaneYear(spec.toYear) || spec.fromYear > spec.toYear) {
        return periodFailure('period_invalid', `year range ${spec.fromYear}..${spec.toYear} is not valid`);
      }
      return requireGrain('JJ') ?? {
        ok: true,
        period: { kind: 'range', from: `${spec.fromYear}JJ00`, to: `${spec.toYear}JJ00` },
        impliedRecency: false,
      };
    }
    case 'since': {
      // Open-ended range (WP14, open-questions #55): the model states the
      // START; the END is always the freshest published period at the start's
      // grain — never a year the (deliberately date-free) model guessed. A
      // start before the loaded slice is NOT clamped here: the intent passes
      // through and the query layer's outside_loaded_slice / not_published
      // refusals stay the single honest source of that behavior (docs/05
      // failure table; same pass-through policy as regions).
      if (!isSaneYear(spec.year)) return periodFailure('period_invalid', `year ${spec.year} is not a plausible year`);
      if (spec.month !== null && spec.quarter !== null) {
        return periodFailure('period_invalid', 'a "since" period carries both a month and a quarter — at most one may refine the start year');
      }
      let grain: 'JJ' | 'KW' | 'MM';
      let from: string;
      if (spec.month !== null) {
        if (!Number.isInteger(spec.month) || spec.month < 1 || spec.month > 12) {
          return periodFailure('period_invalid', `month ${spec.month}/${spec.year} is not a valid month`);
        }
        grain = 'MM';
        from = `${spec.year}MM${pad2(spec.month)}`;
        const gate = requireGrain(grain);
        if (gate) return gate;
      } else if (spec.quarter !== null) {
        if (!Number.isInteger(spec.quarter) || spec.quarter < 1 || spec.quarter > 4) {
          return periodFailure('period_invalid', `quarter ${spec.quarter}/${spec.year} is not a valid quarter`);
        }
        grain = 'KW';
        from = `${spec.year}KW${pad2(spec.quarter)}`;
        const gate = requireGrain(grain);
        if (gate) return gate;
      } else {
        // Year-only start: the COARSEST published grain — an annual series is
        // the natural reading of "sinds 2015". Measures without a yearly
        // series at the canonical coordinate (unemployment: CBS publishes no
        // seasonally-adjusted year figures) fall back to a finer grain,
        // starting at that year's first period; the answer states its periods
        // explicitly (R4), so the granularity is transparent, never a guess.
        const preferred = (['JJ', 'KW', 'MM'] as const).find((g) => grains.has(g));
        if (!preferred) return periodFailure('period_invalid', `no published periods found for "${canonical.definitionLabel}"`);
        grain = preferred;
        from = grain === 'JJ' ? `${spec.year}JJ00` : grain === 'KW' ? `${spec.year}KW01` : `${spec.year}MM01`;
      }
      const latest = await latestPeriod(db, canonical, grain);
      if (!latest) return periodFailure('period_invalid', `no published periods found for "${canonical.definitionLabel}"`);
      if (from > latest) {
        return periodFailure('period_invalid', `the requested start ${from} lies beyond the freshest published period (${latest})`);
      }
      return { ok: true, period: { kind: 'range', from, to: latest }, impliedRecency: true };
    }
    case 'last_n': {
      // "de afgelopen N jaar/kwartalen/maanden": the N freshest PUBLISHED
      // periods at the unit's grain, end-anchored — a range whose end no
      // model chose. n ≥ 2: the singular "afgelopen jaar" is a relative
      // offset, and n = 1 would be a degenerate range.
      if (!Number.isInteger(spec.n) || spec.n < 1 || spec.n > 120) {
        return periodFailure('period_invalid', `a window of ${spec.n} ${spec.unit}s is not supported (1..120)`);
      }
      // The COARSEST grain that can express the unit exactly, falling back to
      // finer grains when the natural one is not published at the canonical
      // coordinate ("afgelopen vijf jaar" of unemployment = the last 20
      // quarters of the seasonally-adjusted series — CBS has no yearly one).
      const preference: Record<typeof spec.unit, ('JJ' | 'KW' | 'MM')[]> = {
        year: ['JJ', 'KW', 'MM'],
        quarter: ['KW', 'MM'],
        month: ['MM'],
      };
      const grain = preference[spec.unit].find((g) => grains.has(g));
      if (!grain) {
        return periodFailure(
          'grain_unavailable',
          `"${canonical.definitionLabel}" is not published at a grain that can express a window of ${spec.unit}s`,
          [...grains].sort().map((g) => GRAIN_LABEL[g] ?? g),
        );
      }
      const unitSteps: Record<'JJ' | 'KW' | 'MM', Partial<Record<typeof spec.unit, number>>> = {
        JJ: { year: 1 },
        KW: { year: 4, quarter: 1 },
        MM: { year: 12, quarter: 3, month: 1 },
      };
      const stepsPerUnit = unitSteps[grain][spec.unit];
      if (!stepsPerUnit) return periodFailure('period_invalid', `grain ${grain} cannot express unit "${spec.unit}"`);
      const latest = await latestPeriod(db, canonical, grain);
      if (!latest) return periodFailure('period_invalid', `no published periods found for "${canonical.definitionLabel}"`);
      // n = 1 ("het afgelopen jaar"): not a window but the single freshest
      // published period at the unit's grain — the same transparent-default
      // pattern as 'latest', period stated in the answer. The prompt asks for
      // a relative offset on singular phrasings, but the model legitimately
      // encodes it this way too (observed live, 2026-07-04, confidence 0.92);
      // both encodings must converge on the same honest intent — prompt rules
      // are the primary control, the deterministic resolver the hard floor
      // (ADR 012).
      if (spec.n === 1) {
        return { ok: true, period: { kind: 'codes', codes: [latest] }, impliedRecency: true };
      }
      const from = stepPeriodCode(latest, -(spec.n * stepsPerUnit - 1));
      if (!from) return periodFailure('period_invalid', `freshest period code "${latest}" cannot be stepped — data needs review`);
      return { ok: true, period: { kind: 'range', from, to: latest }, impliedRecency: true };
    }
    case 'now_vs_ago': {
      // "nu vergeleken met N jaar geleden" (V02): TWO disjoint periods — the
      // freshest published period and the one exactly `amount` units earlier,
      // both at the finest published grain that can express the unit exactly
      // (a year is 12 months / 4 quarters / 1 year; a month only ever a
      // month). Emitted as two codes, ascending — the existing difference /
      // series machinery does the rest (StructuredIntent unchanged).
      if (!Number.isInteger(spec.amount) || spec.amount < 1 || spec.amount > 120) {
        return periodFailure('period_invalid', `a comparison ${spec.amount} ${spec.unit}s back is not supported (1..120)`);
      }
      const expressible: Record<typeof spec.unit, ('JJ' | 'KW' | 'MM')[]> = {
        month: ['MM'],
        quarter: ['MM', 'KW'],
        year: ['MM', 'KW', 'JJ'],
      };
      const grain = (['MM', 'KW', 'JJ'] as const).find(
        (g) => expressible[spec.unit].includes(g) && grains.has(g),
      );
      if (!grain) {
        return periodFailure(
          'grain_unavailable',
          `"${canonical.definitionLabel}" is not published at a grain that can express "${spec.amount} ${spec.unit}(s) ago"`,
          [...grains].sort().map((g) => GRAIN_LABEL[g] ?? g),
        );
      }
      const latest = await latestPeriod(db, canonical, grain);
      if (!latest) return periodFailure('period_invalid', `no published periods found for "${canonical.definitionLabel}"`);
      const steps: Record<'JJ' | 'KW' | 'MM', Partial<Record<typeof spec.unit, number>>> = {
        MM: { month: 1, quarter: 3, year: 12 },
        KW: { quarter: 1, year: 4 },
        JJ: { year: 1 },
      };
      const stepsPerUnit = steps[grain][spec.unit];
      if (!stepsPerUnit) {
        // Unreachable by construction (grain ∈ expressible[unit]) — fail
        // loudly rather than step by NaN if the two tables ever drift.
        return periodFailure('period_invalid', `grain ${grain} cannot express unit "${spec.unit}"`);
      }
      const past = stepPeriodCode(latest, -(spec.amount * stepsPerUnit));
      if (!past) return periodFailure('period_invalid', `freshest period code "${latest}" cannot be stepped — data needs review`);
      return { ok: true, period: { kind: 'codes', codes: [past, latest] }, impliedRecency: true };
    }
    case 'change_over_year': {
      if (!isSaneYear(spec.year)) return periodFailure('period_invalid', `year ${spec.year} is not a plausible year`);
      const grainGate = requireGrain('JJ');
      if (grainGate) return grainGate;
      const codes = STAND_START_OF_YEAR_KEYS.has(canonical.key)
        ? [`${spec.year}JJ00`, `${spec.year + 1}JJ00`]
        : [`${spec.year - 1}JJ00`, `${spec.year}JJ00`];
      return { ok: true, period: { kind: 'codes', codes }, impliedRecency: false };
    }
    case 'relative': {
      if (!Number.isInteger(spec.offset) || spec.offset > 0 || spec.offset < -120) {
        return periodFailure('period_invalid', `relative offset ${spec.offset} is not supported (0..-120)`);
      }
      if (spec.unit === 'month') {
        const gate = requireGrain('MM');
        if (gate) return gate;
        const index = reference.year * 12 + (reference.month - 1) + spec.offset;
        const year = Math.floor(index / 12);
        const month = (index % 12) + 1;
        return { ok: true, period: { kind: 'codes', codes: [`${year}MM${pad2(month)}`] }, impliedRecency: true };
      }
      if (spec.unit === 'quarter') {
        const gate = requireGrain('KW');
        if (gate) return gate;
        const currentQuarter = Math.floor((reference.month - 1) / 3);
        const index = reference.year * 4 + currentQuarter + spec.offset;
        const year = Math.floor(index / 4);
        const quarter = (index % 4) + 1;
        return { ok: true, period: { kind: 'codes', codes: [`${year}KW${pad2(quarter)}`] }, impliedRecency: true };
      }
      const gate = requireGrain('JJ');
      if (gate) return gate;
      return { ok: true, period: { kind: 'codes', codes: [`${reference.year + spec.offset}JJ00`] }, impliedRecency: true };
    }
    case 'latest': {
      // Present tense resolves to the freshest PUBLISHED period at the finest
      // grain — a deterministic choice the answer states explicitly (R4
      // covered-period + freshness line), not a hidden guess. ADR 012.
      const finest = (['MM', 'KW', 'JJ'] as const).find((g) => grains.has(g));
      if (!finest) return periodFailure('period_invalid', `no published periods found for "${canonical.definitionLabel}"`);
      const latest = await latestPeriod(db, canonical, finest);
      if (!latest) return periodFailure('period_invalid', `no published periods found for "${canonical.definitionLabel}"`);
      return { ok: true, period: { kind: 'codes', codes: [latest] }, impliedRecency: true };
    }
    case 'none':
      return periodFailure('period_missing', 'the question names no period', []);
  }
}

// ---------------------------------------------------------------------------
// Candidate assembly
// ---------------------------------------------------------------------------

function normalizeDerivation(candidate: RawCandidate): RawCandidate['derivation'] {
  // The period spec is the stronger signal than the LLM's derivation hint.
  if (candidate.period.kind === 'change_over_year') return 'difference';
  // Open-ended and last-n windows are series by construction, same as an
  // explicit year range — even under a 'difference' hint ("met hoeveel
  // gestegen sinds 2015"): the pre-registered direction derivation carries
  // the honest net change, while a difference over >2 cells could never
  // execute. Exceptions: last_n with n = 1 is a single period, not a window
  // (its hint stands); now_vs_ago keeps its hint too — none and difference
  // are both meaningful over exactly two periods.
  if (
    candidate.period.kind === 'year_range' ||
    candidate.period.kind === 'since' ||
    (candidate.period.kind === 'last_n' && candidate.period.n !== 1)
  ) {
    return 'series';
  }
  return candidate.derivation;
}

/** Structurally single-period selections: one explicit code, or a range whose
 * ends coincide. A from<to range can still turn out sparse — completeness
 * stays the query layer's job; this only names shapes that can NEVER be
 * multi-period. */
function isSinglePeriodSelection(period: IntentPeriod): boolean {
  return period.kind === 'codes' ? period.codes.length < 2 : period.from === period.to;
}

/** Clarification option for the degenerate open-range shape: "{jaar} tot en
 * met {laatste gepubliceerde jaar}" — offered only when the selection is a
 * yearly period and a later published year actually exists. The start year is
 * clamped to the earliest LOADED year, so the offered range fully resolves in
 * the loaded data (docs/05 — "sinds 1990" on a slice that starts 2019 must
 * offer "2019 tot en met …", never a range we cannot serve). Period CODES
 * only, never a value (principle c). */
async function openEndedRangeOptions(
  db: Db,
  canonical: CanonicalRow,
  period: IntentPeriod,
): Promise<string[]> {
  const code = period.kind === 'codes' ? period.codes[0] : period.from;
  if (!code || !/^\d{4}JJ00$/.test(code)) return [];
  const fromYear = Number(code.slice(0, 4));
  // Bounds at the canonical COORDINATE, like every other period lookup here:
  // pre-WP14 these queries ran unfiltered, so for unemployment (whose yearly
  // cells exist only un-corrected) the guard offered "2013 tot en met 2025" —
  // a range that dead-ended in a no_data refusal if the user confirmed it
  // (WP14 finding, 2026-07-04).
  const bounds = await db.query(
    "select min(period_code) as earliest, max(period_code) as latest from observations where table_id = $1 and measure = $2 and period_grain = 'JJ' and dims = $3::jsonb",
    [canonical.tableId, canonical.measure, JSON.stringify(canonical.mergedDims)],
  );
  const parseYear = (value: unknown): number | null =>
    typeof value === 'string' && /^\d{4}JJ00$/.test(value) ? Number(value.slice(0, 4)) : null;
  const earliestYear = parseYear(bounds.rows[0]?.earliest);
  const latestYear = parseYear(bounds.rows[0]?.latest);
  if (earliestYear === null || latestYear === null) return [];
  const effectiveFrom = Math.max(fromYear, earliestYear);
  if (latestYear <= effectiveFrom) return [];
  // min/max alone cannot see interior gaps (review finding, 2026-07-05): a
  // missing year inside the window would make the offered range unservable —
  // the query layer's completeness check would refuse it after the user
  // confirmed. Offer nothing rather than a range we cannot serve.
  const window = await db.query(
    "select count(distinct period_code) as n from observations where table_id = $1 and measure = $2 and period_grain = 'JJ' and dims = $5::jsonb and period_code between $3 and $4",
    [canonical.tableId, canonical.measure, `${effectiveFrom}JJ00`, `${latestYear}JJ00`, JSON.stringify(canonical.mergedDims)],
  );
  if (Number(window.rows[0]?.n) !== latestYear - effectiveFrom + 1) return [];
  return [`${effectiveFrom} tot en met ${latestYear}`];
}

const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

export type CandidateResolution = RankedCandidate | ResolutionFailure;

export function isResolutionFailure(value: CandidateResolution): value is ResolutionFailure {
  return !('intent' in value);
}

export async function resolveCandidate(
  db: Db,
  candidate: RawCandidate,
  referenceDateIso: string,
): Promise<CandidateResolution> {
  const confidence = clamp01(candidate.confidence);
  const fail = (
    partial: Pick<ResolutionFailure, 'axis' | 'reason' | 'message' | 'options'>,
  ): ResolutionFailure => ({ ...partial, confidence, reading: candidate.reading });

  const canonical = await fetchCanonical(db, candidate.canonicalKey);
  if (!canonical) {
    return fail({
      axis: 'measure',
      reason: 'unknown_canonical_key',
      message: `canonical key "${candidate.canonicalKey}" is not in the registry`,
      options: [],
    });
  }

  const geo = await fetchTableGeo(db, canonical.tableId);
  const regionResolution = await resolveRegions(db, candidate, canonical, geo);
  if (!regionResolution.ok) return fail(regionResolution.failure);

  const derivation = normalizeDerivation(candidate);
  if (derivation === 'max' && regionResolution.codes.length < 2) {
    return fail({
      axis: 'region',
      reason: 'region_unknown',
      message: 'a "meeste/hoogste" comparison needs the regions to compare named in the question',
      options: [],
    });
  }

  const reference = parseReferenceDate(referenceDateIso);
  const periodResolution = await resolvePeriod(db, candidate.period, canonical, reference);
  if (!periodResolution.ok) return fail(periodResolution.failure);

  // A multi-period derivation over a structurally single-period selection can
  // never execute — the query layer rejects it as invalid_intent, which
  // surfaces as the catch-all internal refusal (validation pass 2026-07-04,
  // V01/V28 "sinds 2015/2010"). The shape is reachable because the raw schema
  // cannot express an open-ended range and the prompt is deliberately
  // date-free, so the model emits fromYear == toYear. Which end year the user
  // means is genuinely unresolved: exit to a period clarification with an
  // option that resolves in the loaded data — ask, never guess (R7,
  // principle c).
  if ((derivation === 'series' || derivation === 'difference') && isSinglePeriodSelection(periodResolution.period)) {
    return fail({
      axis: 'period',
      reason: 'period_missing',
      message: `derivation "${derivation}" needs more than one period, but the question resolves to a single one`,
      options: await openEndedRangeOptions(db, canonical, periodResolution.period),
    });
  }

  const intent: StructuredIntent = {
    schemaVersion: INTENT_SCHEMA_VERSION,
    target: { kind: 'canonical', key: canonical.key },
    ...(regionResolution.codes.length > 0 ? { regions: regionResolution.codes } : {}),
    period: periodResolution.period,
    derivation,
  };
  return {
    intent,
    confidence,
    reading: candidate.reading,
    impliedRecency: periodResolution.impliedRecency,
  };
}

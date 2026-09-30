// Pure period arithmetic and derivation rules, shared by the curated resolver
// (./resolve.ts) and the table lane (../table-lane/periods.ts, plan.ts).
//
// Extracted (2026-10-01, table-lane period shapes, ADR 062 as-built "step 5
// follow-up") from resolve.ts so the table lane answers now-versus-then,
// explicit date ranges and relative periods with EXACTLY the curated lane's
// rules — never a second copy that could drift. Everything here is pure: no
// db, no LLM, no clock (a reference date is always passed in). The callers
// own the data facts (which grains are published, which period is the
// freshest) and their own failure wording; this module owns only the
// arithmetic and the grain-preference tables.
//
// Principle (a): the model states the period in words (a PeriodSpec); every
// CBS period code is computed HERE, deterministically. Principle (c): every
// function reports "cannot" as null / a typed result — never a guessed code.
import type { IntentPeriod } from '../../query/types.ts';
import type { DerivationHint, PeriodSpec } from './types.ts';

/** CBS period grains, as the codes spell them. */
export type PeriodGrainCode = 'JJ' | 'KW' | 'MM';

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** The curated resolver's plausibility window for a stated year. */
export function isSaneYear(year: number): boolean {
  return Number.isInteger(year) && year >= 1900 && year <= 2100;
}

// ---------------------------------------------------------------------------
// Explicit date ranges (#77, ADR 023)
// ---------------------------------------------------------------------------

const isLeapYear = (year: number): boolean =>
  (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

/** Days in a calendar month (proleptic Gregorian) — the only calendar
 * knowledge the pipeline needs, and it lives HERE, not in the LLM: the model
 * copies dates verbatim, code judges them (ADR 023). */
export function daysInMonth(year: number, month: number): number {
  const lengths = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return lengths[month - 1]!;
}

type DateRangeSpec = Extract<PeriodSpec, { kind: 'date_range' }>;

export type DateRangeMonths =
  /** Whole-month boundaries: inclusive month indexes (year*12 + month-1). */
  | { kind: 'months'; fromIdx: number; toIdx: number }
  /** Real dates, but a boundary cuts a month — CBS data is monthly at
   * finest, so this exits to an honest period clarification, never a
   * silently widened window. */
  | { kind: 'misaligned' }
  | { kind: 'invalid'; message: string };

/** Normalizes a raw date_range to whole months, deterministically:
 * validates the calendar fields (leap years included), applies the
 * exclusive-end rule for bare "tot" (minus one day; a month-only exclusive
 * end drops the named month), and checks that both boundaries land exactly
 * on month edges. Pure arithmetic — shared by derivation normalization and
 * period resolution so the two can never disagree. */
export function dateRangeToMonths(spec: DateRangeSpec): DateRangeMonths {
  for (const [label, b] of [['from', spec.from], ['to', spec.to]] as const) {
    if (!isSaneYear(b.year)) return { kind: 'invalid', message: `${label} year ${b.year} is not a plausible year` };
    if (!Number.isInteger(b.month) || b.month < 1 || b.month > 12) {
      return { kind: 'invalid', message: `${label} month ${b.month} is not a valid month` };
    }
    if (b.day !== null && (!Number.isInteger(b.day) || b.day < 1 || b.day > daysInMonth(b.year, b.month))) {
      return { kind: 'invalid', message: `${label} day ${b.day} does not exist in ${b.month}/${b.year}` };
    }
  }

  const fromAligned = spec.from.day === null || spec.from.day === 1;

  // Inclusive end month index + whether the end lands on a month edge.
  let toIdx: number;
  let toAligned: boolean;
  if (spec.toInclusive) {
    toIdx = spec.to.year * 12 + (spec.to.month - 1);
    toAligned = spec.to.day === null || spec.to.day === daysInMonth(spec.to.year, spec.to.month);
  } else if (spec.to.day === null) {
    // "van maart tot juni 2021": the strict reading — juni itself excluded.
    // The answer states its covered periods (R4), so the reading is visible,
    // never a hidden guess.
    toIdx = spec.to.year * 12 + (spec.to.month - 1) - 1;
    toAligned = true;
  } else if (spec.to.day === 1) {
    // "tot 1 januari 2023" = through december 2022.
    toIdx = spec.to.year * 12 + (spec.to.month - 1) - 1;
    toAligned = true;
  } else {
    // "tot 20 maart" = through 19 maart. An exclusive day end can only land
    // on a month edge via day 1 (handled above): day ≤ daysInMonth, so
    // day − 1 always falls strictly inside the month.
    toIdx = spec.to.year * 12 + (spec.to.month - 1);
    toAligned = false;
  }

  if (!fromAligned || !toAligned) return { kind: 'misaligned' };

  const fromIdx = spec.from.year * 12 + (spec.from.month - 1);
  if (fromIdx > toIdx) {
    return { kind: 'invalid', message: 'the date range is empty or runs backwards' };
  }
  return { kind: 'months', fromIdx, toIdx };
}

export const monthIdxYear = (idx: number): number => Math.floor(idx / 12);
export const monthIdxMonth = (idx: number): number => (idx % 12) + 1;

/** The grain a whole-month date range resolves at: a single month only ever
 * at MM; a longer span at the FINEST published grain that expresses both
 * boundaries exactly — spelling out "1 januari … 31 december" signals
 * intra-year interest, so a monthly series gets its monthly cells, while a
 * yearly-only measure still serves whole calendar years honestly. Null when
 * no published grain expresses the boundaries (the caller refuses on its
 * grain axis — never a silently widened window). */
export function dateRangeGrain(
  months: { fromIdx: number; toIdx: number },
  isPublished: (grain: PeriodGrainCode) => boolean,
): PeriodGrainCode | null {
  if (months.fromIdx === months.toIdx) return isPublished('MM') ? 'MM' : null;
  const fromMonth = monthIdxMonth(months.fromIdx);
  const toMonth = monthIdxMonth(months.toIdx);
  const expressesExactly: Record<PeriodGrainCode, boolean> = {
    MM: true,
    KW: [1, 4, 7, 10].includes(fromMonth) && [3, 6, 9, 12].includes(toMonth),
    JJ: fromMonth === 1 && toMonth === 12,
  };
  return (['MM', 'KW', 'JJ'] as const).find((g) => isPublished(g) && expressesExactly[g]) ?? null;
}

/** The CBS period code containing month index `idx` at `grain`. Exact at the
 * range's own boundaries whenever `grain` came from dateRangeGrain. */
export function dateRangeCode(idx: number, grain: PeriodGrainCode): string {
  const year = monthIdxYear(idx);
  const month = monthIdxMonth(idx);
  if (grain === 'JJ') return `${year}JJ00`;
  if (grain === 'KW') return `${year}KW${pad2(Math.ceil(month / 3))}`;
  return `${year}MM${pad2(month)}`;
}

// ---------------------------------------------------------------------------
// Stepping, now-versus-then, relative periods
// ---------------------------------------------------------------------------

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
  const grain = match[2] as PeriodGrainCode;
  if (grain === 'JJ') return `${year + steps}JJ00`;
  const perYear = grain === 'KW' ? 4 : 12;
  const index = Number(match[3]);
  if (index < 1 || index > perYear) return null;
  const absolute = year * perYear + (index - 1) + steps;
  const steppedYear = Math.floor(absolute / perYear);
  const steppedIndex = ((absolute % perYear) + perYear) % perYear + 1;
  return `${steppedYear}${grain}${pad2(steppedIndex)}`;
}

type NowVsAgoSpec = Extract<PeriodSpec, { kind: 'now_vs_ago' }>;

/** "nu vergeleken met N {eenheid} geleden" (V02): the FINEST published grain
 * that can express the unit exactly (a year is 12 months / 4 quarters / 1
 * year; a month only ever a month). Null when none is published. */
export function nowVsAgoGrain(
  unit: NowVsAgoSpec['unit'],
  isPublished: (grain: PeriodGrainCode) => boolean,
): PeriodGrainCode | null {
  const expressible: Record<NowVsAgoSpec['unit'], PeriodGrainCode[]> = {
    month: ['MM'],
    quarter: ['MM', 'KW'],
    year: ['MM', 'KW', 'JJ'],
  };
  return (['MM', 'KW', 'JJ'] as const).find((g) => expressible[unit].includes(g) && isPublished(g)) ?? null;
}

/** The earlier of now_vs_ago's two periods: `amount` units before `latest`
 * (the freshest published period at `grain`). `unit` when the grain cannot
 * express the unit (unreachable when `grain` came from nowVsAgoGrain — fail
 * loudly rather than step by NaN if the two tables ever drift); `step` when
 * `latest` cannot be stepped. */
export function nowVsAgoPastCode(
  latest: string,
  grain: PeriodGrainCode,
  spec: Pick<NowVsAgoSpec, 'unit' | 'amount'>,
): { ok: true; code: string } | { ok: false; failure: 'unit' | 'step' } {
  const steps: Record<PeriodGrainCode, Partial<Record<NowVsAgoSpec['unit'], number>>> = {
    MM: { month: 1, quarter: 3, year: 12 },
    KW: { quarter: 1, year: 4 },
    JJ: { year: 1 },
  };
  const stepsPerUnit = steps[grain][spec.unit];
  if (!stepsPerUnit) return { ok: false, failure: 'unit' };
  const past = stepPeriodCode(latest, -(spec.amount * stepsPerUnit));
  if (!past) return { ok: false, failure: 'step' };
  return { ok: true, code: past };
}

type RelativeSpec = Extract<PeriodSpec, { kind: 'relative' }>;

/** "vorige maand" / "vorig kwartaal" / "vorig jaar": the calendar period
 * `offset` units from the reference date (offset −1 = the previous one). The
 * ONE place relative words become a period code — the prompt is date-free,
 * the reference date is the caller's. Whether that period is published is
 * the caller's data fact. */
export function relativePeriodCode(
  spec: Pick<RelativeSpec, 'unit' | 'offset'>,
  reference: { year: number; month: number },
): { grain: PeriodGrainCode; code: string } {
  if (spec.unit === 'month') {
    const index = reference.year * 12 + (reference.month - 1) + spec.offset;
    return { grain: 'MM', code: `${Math.floor(index / 12)}MM${pad2((index % 12) + 1)}` };
  }
  if (spec.unit === 'quarter') {
    const currentQuarter = Math.floor((reference.month - 1) / 3);
    const index = reference.year * 4 + currentQuarter + spec.offset;
    return { grain: 'KW', code: `${Math.floor(index / 4)}KW${pad2((index % 4) + 1)}` };
  }
  return { grain: 'JJ', code: `${reference.year + spec.offset}JJ00` };
}

// ---------------------------------------------------------------------------
// Derivation rules
// ---------------------------------------------------------------------------

/** The derivation a period spec implies — the period spec is the stronger
 * signal than the LLM's derivation hint. */
export function normalizeDerivation(period: PeriodSpec, derivation: DerivationHint): DerivationHint {
  if (period.kind === 'change_over_year') return 'difference';
  // Open-ended and last-n windows are series by construction, same as an
  // explicit year range — even under a 'difference' hint ("met hoeveel
  // gestegen sinds 2015"): the pre-registered direction derivation carries
  // the honest net change, while a difference over >2 cells could never
  // execute. Exceptions: last_n with n = 1 is a single period, not a window
  // (its hint stands); now_vs_ago keeps its hint too — none and difference
  // are both meaningful over exactly two periods.
  if (period.kind === 'year_range' || period.kind === 'since' || (period.kind === 'last_n' && period.n !== 1)) {
    return 'series';
  }
  // An explicit date range spanning several whole months is a series by the
  // same reasoning; a single-month or not-yet-normalizable one keeps its hint
  // (resolution handles the invalid/misaligned exits). Shares the resolver's
  // own normalization so the two can never disagree (ADR 023).
  if (period.kind === 'date_range') {
    const months = dateRangeToMonths(period);
    if (months.kind === 'months' && months.fromIdx < months.toIdx) return 'series';
  }
  return derivation;
}

/** Structurally single-period selections: one explicit code, or a range whose
 * ends coincide. A from<to range can still turn out sparse — completeness
 * stays the query layer's job; this only names shapes that can NEVER be
 * multi-period. */
export function isSinglePeriodSelection(period: IntentPeriod): boolean {
  return period.kind === 'codes' ? period.codes.length < 2 : period.from === period.to;
}

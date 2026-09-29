// Breadth step 5, Task 2 — the table lane's period resolver (plan
// docs/superpowers/plans/2026-09-29-breadth-step-5-table-lane-wiring.md,
// "Settled design choices" 8; open-questions #339 (9)).
//
// Resolves the table parser's PeriodSpec against ONE table's own stored
// period codes (the time dimension's code list) — never against a calendar.
// Pure and synchronous: no db, no LLM call (principle a). Every non-happy
// branch is a typed refusal (principle c):
//   - a grain the table does not publish → `table_lane_period_grain` (strict;
//     no fallback to another grain),
//   - a period this table does not list → `table_lane_period_missing`, naming
//     the latest available CODE at that grain (a code, never a value),
//   - a spec kind this lane does not resolve (change_over_year, now_vs_ago,
//     date_range, relative) or an insane year/index →
//     `table_lane_period_unsupported`.
// The only default is `none` (no period in the question at all): the latest
// period at the coarsest grain the table has, returned as `defaulted` so the
// answer states it ("Uitgangspunt: Perioden: <label>").
import type { CbsCode } from '../../cbs-adapter/types.ts';
import { parsePeriodCode, type ParsedPeriod } from '../../ingestion/periods.ts';
import type { PeriodGrain } from '../../query/types.ts';
import type { PeriodSpec } from '../intent/types.ts';

export type TablePeriodResolution =
  | { ok: true; codes: string[]; defaulted: { code: string; label: string } | null }
  | {
      ok: false;
      reason: 'table_lane_period_unsupported' | 'table_lane_period_grain' | 'table_lane_period_missing';
      detail: string;
      latestPeriodCode?: string;
    };

/** Coarsest first. */
const GRAIN_ORDER: PeriodGrain[] = ['JJ', 'KW', 'MM'];

const MIN_YEAR = 1800;
const MAX_YEAR = 2100;

interface ReadablePeriod {
  code: string;
  title: string;
  parsed: ParsedPeriod;
}

function sortKey(p: ParsedPeriod): number {
  return p.year * 100 + (p.index ?? 0);
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function unsupported(detail: string): TablePeriodResolution {
  return { ok: false, reason: 'table_lane_period_unsupported', detail };
}

function saneYear(year: number): boolean {
  return Number.isInteger(year) && year >= MIN_YEAR && year <= MAX_YEAR;
}

function unitGrain(unit: 'month' | 'quarter' | 'year'): PeriodGrain {
  return unit === 'year' ? 'JJ' : unit === 'quarter' ? 'KW' : 'MM';
}

/**
 * Resolves `spec` against the time dimension's stored codes. Unreadable codes
 * (parsePeriodCode → null) are ignored. "Latest" is the maximum by (year,
 * sub-period) at one grain. `referenceDate` (YYYY-MM-DD) is accepted for the
 * caller's contract but not consulted: the table's own published codes decide
 * what "latest" is, never the calendar.
 */
export function resolveTablePeriod(
  spec: PeriodSpec,
  timeCodes: CbsCode[],
  referenceDate: string,
): TablePeriodResolution {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(referenceDate)) {
    throw new Error(`resolveTablePeriod: referenceDate '${referenceDate}' is not YYYY-MM-DD`);
  }

  const byGrain = new Map<PeriodGrain, ReadablePeriod[]>();
  for (const c of timeCodes) {
    const parsed = parsePeriodCode(c.code);
    if (!parsed) continue;
    let list = byGrain.get(parsed.grain);
    if (!list) {
      list = [];
      byGrain.set(parsed.grain, list);
    }
    list.push({ code: c.code, title: c.title, parsed });
  }
  for (const list of byGrain.values()) list.sort((a, b) => sortKey(a.parsed) - sortKey(b.parsed));

  const at = (grain: PeriodGrain): ReadablePeriod[] => byGrain.get(grain) ?? [];
  const latestCode = (grain: PeriodGrain): string => at(grain)[at(grain).length - 1]!.code;
  const grainAbsent = (grain: PeriodGrain): TablePeriodResolution => ({
    ok: false,
    reason: 'table_lane_period_grain',
    detail: `the table publishes no ${grain} periods`,
  });
  const missing = (grain: PeriodGrain, what: string): TablePeriodResolution => ({
    ok: false,
    reason: 'table_lane_period_missing',
    detail: `${what} is not published in this table (latest ${grain} period: ${latestCode(grain)})`,
    latestPeriodCode: latestCode(grain),
  });
  const single = (grain: PeriodGrain, code: string): TablePeriodResolution => {
    if (at(grain).length === 0) return grainAbsent(grain);
    if (!at(grain).some((p) => p.code === code)) return missing(grain, `period ${code}`);
    return { ok: true, codes: [code], defaulted: null };
  };
  const coarsest = (): ReadablePeriod | null => {
    for (const grain of GRAIN_ORDER) {
      const list = at(grain);
      if (list.length > 0) return list[list.length - 1]!;
    }
    return null;
  };

  switch (spec.kind) {
    case 'year':
      if (!saneYear(spec.year)) return unsupported(`year ${spec.year} is outside ${MIN_YEAR}..${MAX_YEAR}`);
      return single('JJ', `${spec.year}JJ00`);

    case 'quarter':
      if (!saneYear(spec.year)) return unsupported(`year ${spec.year} is outside ${MIN_YEAR}..${MAX_YEAR}`);
      if (!Number.isInteger(spec.quarter) || spec.quarter < 1 || spec.quarter > 4) {
        return unsupported(`quarter ${spec.quarter} is not 1..4`);
      }
      return single('KW', `${spec.year}KW${pad2(spec.quarter)}`);

    case 'month':
      if (!saneYear(spec.year)) return unsupported(`year ${spec.year} is outside ${MIN_YEAR}..${MAX_YEAR}`);
      if (!Number.isInteger(spec.month) || spec.month < 1 || spec.month > 12) {
        return unsupported(`month ${spec.month} is not 1..12`);
      }
      return single('MM', `${spec.year}MM${pad2(spec.month)}`);

    case 'year_range': {
      if (!saneYear(spec.fromYear) || !saneYear(spec.toYear)) {
        return unsupported(`year range ${spec.fromYear}..${spec.toYear} is outside ${MIN_YEAR}..${MAX_YEAR}`);
      }
      if (spec.fromYear > spec.toYear) return unsupported(`year range ${spec.fromYear}..${spec.toYear} is reversed`);
      if (at('JJ').length === 0) return grainAbsent('JJ');
      const codes = at('JJ')
        .filter((p) => p.parsed.year >= spec.fromYear && p.parsed.year <= spec.toYear)
        .map((p) => p.code);
      if (codes.length === 0) return missing('JJ', `no year in ${spec.fromYear}..${spec.toYear}`);
      return { ok: true, codes, defaulted: null };
    }

    case 'since': {
      if (!saneYear(spec.year)) return unsupported(`year ${spec.year} is outside ${MIN_YEAR}..${MAX_YEAR}`);
      if (spec.month !== null && spec.quarter !== null) {
        return unsupported('a start with both a month and a quarter');
      }
      let grain: PeriodGrain;
      let start: string;
      if (spec.month !== null) {
        if (!Number.isInteger(spec.month) || spec.month < 1 || spec.month > 12) {
          return unsupported(`month ${spec.month} is not 1..12`);
        }
        grain = 'MM';
        start = `${spec.year}MM${pad2(spec.month)}`;
      } else if (spec.quarter !== null) {
        if (!Number.isInteger(spec.quarter) || spec.quarter < 1 || spec.quarter > 4) {
          return unsupported(`quarter ${spec.quarter} is not 1..4`);
        }
        grain = 'KW';
        start = `${spec.year}KW${pad2(spec.quarter)}`;
      } else {
        grain = 'JJ';
        start = `${spec.year}JJ00`;
      }
      const list = at(grain);
      if (list.length === 0) return grainAbsent(grain);
      const startIndex = list.findIndex((p) => p.code === start);
      // Strict: a start the table does not list is refused, never silently
      // narrowed to the table's first period (the reader asked "since X").
      if (startIndex === -1) return missing(grain, `start period ${start}`);
      return { ok: true, codes: list.slice(startIndex).map((p) => p.code), defaulted: null };
    }

    case 'last_n': {
      if (!Number.isInteger(spec.n) || spec.n < 1) return unsupported(`last_n count ${spec.n} is not a positive integer`);
      const grain = unitGrain(spec.unit);
      const list = at(grain);
      if (list.length === 0) return grainAbsent(grain);
      if (list.length < spec.n) return missing(grain, `the last ${spec.n} ${grain} periods`);
      return { ok: true, codes: list.slice(list.length - spec.n).map((p) => p.code), defaulted: null };
    }

    case 'latest':
    case 'none': {
      const latest = coarsest();
      if (!latest) {
        return { ok: false, reason: 'table_lane_period_missing', detail: 'the table lists no readable period code' };
      }
      const label = latest.title.trim().length > 0 ? latest.title.trim() : latest.code;
      return {
        ok: true,
        codes: [latest.code],
        defaulted: spec.kind === 'none' ? { code: latest.code, label } : null,
      };
    }

    default:
      return unsupported(`period kind '${spec.kind}' is not supported by the table lane`);
  }
}

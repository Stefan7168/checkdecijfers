// How late may a Eurostat dataset's newest period be before we call it frozen? (ADR 048's 2026-09-30
// addendum: Eurostat retires datasets without notice — prc_hicp_manr stayed at 2025-12 while the live
// series moved to prc_hicp_minr.) A frozen dataset never looks "changed", so a refresh job would keep
// re-confirming it as current; lateness of the data itself is the only signal. Shared by the freshness
// report (src/ingestion/freshness.ts, catalogue 'data end') and the warm job (src/ingestion/warm-job.ts,
// the newest stored period), so the two can never judge by different limits. Pure.
import { parsePeriodCode } from './periods.ts';

/** Monthly data is published about 1-2 months after the period; 4 leaves room for a late release. */
export const EUROSTAT_MONTHLY_MAX_LAG_MONTHS = 4;
/** Quarterly national-accounts data lags 1-2 quarters; 3 leaves room for a late release. */
export const EUROSTAT_QUARTERLY_MAX_LAG_QUARTERS = 3;
/** Annual data can lag 12-18 months after the year ends; 30 leaves room for slow indicators. */
export const EUROSTAT_ANNUAL_MAX_LAG_MONTHS = 30;

export interface DataEndLag {
  unit: 'month' | 'quarter' | 'year';
  /** Whole months (quarters for 'quarter') from the last month the period covers to `now`. */
  lag: number;
  /** True when the lag is over the limit for its grain. */
  frozen: boolean;
}

function judge(unit: DataEndLag['unit'], lag: number): DataEndLag {
  const limit = { month: EUROSTAT_MONTHLY_MAX_LAG_MONTHS, quarter: EUROSTAT_QUARTERLY_MAX_LAG_QUARTERS, year: EUROSTAT_ANNUAL_MAX_LAG_MONTHS }[unit];
  return { unit, lag, frozen: lag > limit };
}

/** Eurostat's own spelling ('2025', '2025-12', '2025-Q4'); null for one we do not recognise. */
export function lagOfDataEnd(dataEnd: string, now: Date): DataEndLag | null {
  const nowMonths = now.getUTCFullYear() * 12 + now.getUTCMonth();
  let m = /^(\d{4})$/.exec(dataEnd);
  if (m) return judge('year', nowMonths - (Number(m[1]) * 12 + 11));
  m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(dataEnd);
  if (m) return judge('month', nowMonths - (Number(m[1]) * 12 + Number(m[2]) - 1));
  m = /^(\d{4})-Q([1-4])$/.exec(dataEnd);
  if (m) return judge('quarter', Math.floor(nowMonths / 3) - (Number(m[1]) * 4 + Number(m[2]) - 1));
  return null;
}

/** The same judgement for a stored period code ('2025MM12', '2025KW04', '2025JJ00'); null when the
 * code is not one of those three grains. */
export function lagOfPeriodCode(periodCode: string, now: Date): DataEndLag | null {
  const p = parsePeriodCode(periodCode);
  if (!p) return null;
  if (p.grain === 'JJ') return lagOfDataEnd(String(p.year), now);
  if (p.grain === 'KW') return lagOfDataEnd(`${p.year}-Q${p.index}`, now);
  return lagOfDataEnd(`${p.year}-${String(p.index).padStart(2, '0')}`, now);
}

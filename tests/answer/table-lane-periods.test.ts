// Breadth step 5, Task 2 — the table lane's period resolver
// (src/answer/table-lane/periods.ts): a reader's PeriodSpec resolved against
// ONE table's own stored period codes, never a calendar guess (principle c;
// plan "Settled design choices" 8). Pure; no db, no LLM.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { CbsCode, CbsTableSchema } from '../../src/cbs-adapter/types.ts';
import { trailingPeriods, TREND_CONTEXT_PERIODS, resolveTablePeriod } from '../../src/answer/table-lane/periods.ts';

function loadFixture(tableId: string): { schema: CbsTableSchema; codeLists: Record<string, CbsCode[]> } {
  const path = fileURLToPath(new URL(`../fixtures/tableparse/schemas/${tableId}.json`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8')) as { schema: CbsTableSchema; codeLists: Record<string, CbsCode[]> };
}

const REF = '2026-09-29';

function code(c: string, title = c): CbsCode {
  return { code: c, title, dimensionGroup: null, status: 'Definitief', index: null };
}

// 85669NED: yearly only, 1990JJ00..2025JJ00 (36 codes).
const yearly = loadFixture('85669NED').codeLists.Perioden!;
// 80590ned: JJ + KW + MM, 2003..2026MM08.
const mixed = loadFixture('80590ned').codeLists.Perioden!;
// 82291NED: JJ only, NON-contiguous (2013, 2017 "2017/2018", 2021).
const gappy = loadFixture('82291NED').codeLists.Perioden!;

describe('resolveTablePeriod — single periods', () => {
  it('year present → that code', () => {
    expect(resolveTablePeriod({ kind: 'year', year: 2020 }, yearly, REF)).toEqual({
      ok: true,
      codes: ['2020JJ00'],
      defaulted: null,
    });
  });

  it('year absent at a present grain → period_missing naming the latest code at that grain', () => {
    const r = resolveTablePeriod({ kind: 'year', year: 1980 }, yearly, REF);
    expect(r).toMatchObject({ ok: false, reason: 'table_lane_period_missing', latestPeriodCode: '2025JJ00' });
  });

  it('quarter on a yearly-only table → period_grain (grain absent, no fallback)', () => {
    const r = resolveTablePeriod({ kind: 'quarter', year: 2020, quarter: 2 }, yearly, REF);
    expect(r).toMatchObject({ ok: false, reason: 'table_lane_period_grain' });
  });

  it('quarter and month present → their codes', () => {
    expect(resolveTablePeriod({ kind: 'quarter', year: 2020, quarter: 2 }, mixed, REF)).toEqual({
      ok: true,
      codes: ['2020KW02'],
      defaulted: null,
    });
    expect(resolveTablePeriod({ kind: 'month', year: 2024, month: 3 }, mixed, REF)).toEqual({
      ok: true,
      codes: ['2024MM03'],
      defaulted: null,
    });
  });

  it('a month after the latest published month → missing, naming the latest month code', () => {
    const r = resolveTablePeriod({ kind: 'month', year: 2026, month: 12 }, mixed, REF);
    expect(r).toMatchObject({ ok: false, reason: 'table_lane_period_missing', latestPeriodCode: '2026MM08' });
  });

  it('an out-of-range quarter/month index is unsupported, never clamped', () => {
    expect(resolveTablePeriod({ kind: 'quarter', year: 2020, quarter: 5 }, mixed, REF)).toMatchObject({
      ok: false,
      reason: 'table_lane_period_unsupported',
    });
    expect(resolveTablePeriod({ kind: 'month', year: 2020, month: 13 }, mixed, REF)).toMatchObject({
      ok: false,
      reason: 'table_lane_period_unsupported',
    });
  });

  it('a year outside 1800..2100 is unsupported (sanity)', () => {
    expect(resolveTablePeriod({ kind: 'year', year: 1799 }, yearly, REF)).toMatchObject({
      ok: false,
      reason: 'table_lane_period_unsupported',
    });
    expect(resolveTablePeriod({ kind: 'year', year: 2101 }, yearly, REF)).toMatchObject({
      ok: false,
      reason: 'table_lane_period_unsupported',
    });
  });
});

describe('resolveTablePeriod — ranges', () => {
  it('year_range → every JJ code in range, ascending', () => {
    expect(resolveTablePeriod({ kind: 'year_range', fromYear: 2018, toYear: 2021 }, yearly, REF)).toEqual({
      ok: true,
      codes: ['2018JJ00', '2019JJ00', '2020JJ00', '2021JJ00'],
      defaulted: null,
    });
  });

  it('year_range on a gappy table → only the published codes', () => {
    expect(resolveTablePeriod({ kind: 'year_range', fromYear: 2012, toYear: 2022 }, gappy, REF)).toEqual({
      ok: true,
      codes: ['2013JJ00', '2017JJ00', '2021JJ00'],
      defaulted: null,
    });
  });

  it('year_range with nothing published in it → missing', () => {
    expect(resolveTablePeriod({ kind: 'year_range', fromYear: 1970, toYear: 1980 }, yearly, REF)).toMatchObject({
      ok: false,
      reason: 'table_lane_period_missing',
      latestPeriodCode: '2025JJ00',
    });
  });

  it('year_range with from > to is unsupported', () => {
    expect(resolveTablePeriod({ kind: 'year_range', fromYear: 2021, toYear: 2018 }, yearly, REF)).toMatchObject({
      ok: false,
      reason: 'table_lane_period_unsupported',
    });
  });

  it('since a year → from that code to the latest JJ', () => {
    expect(resolveTablePeriod({ kind: 'since', year: 2022, quarter: null, month: null }, yearly, REF)).toEqual({
      ok: true,
      codes: ['2022JJ00', '2023JJ00', '2024JJ00', '2025JJ00'],
      defaulted: null,
    });
  });

  it('since a month → from that month to the latest month (MM grain only)', () => {
    expect(resolveTablePeriod({ kind: 'since', year: 2026, quarter: null, month: 5 }, mixed, REF)).toEqual({
      ok: true,
      codes: ['2026MM05', '2026MM06', '2026MM07', '2026MM08'],
      defaulted: null,
    });
  });

  it('since a start the table does not publish → missing (never silently narrowed)', () => {
    expect(resolveTablePeriod({ kind: 'since', year: 1980, quarter: null, month: null }, yearly, REF)).toMatchObject({
      ok: false,
      reason: 'table_lane_period_missing',
      latestPeriodCode: '2025JJ00',
    });
  });

  it('since a quarter on a yearly-only table → period_grain', () => {
    expect(resolveTablePeriod({ kind: 'since', year: 2020, quarter: 1, month: null }, yearly, REF)).toMatchObject({
      ok: false,
      reason: 'table_lane_period_grain',
    });
  });

  it('last_n → the n latest codes at the unit grain', () => {
    expect(resolveTablePeriod({ kind: 'last_n', unit: 'quarter', n: 3 }, mixed, REF)).toEqual({
      ok: true,
      codes: ['2025KW04', '2026KW01', '2026KW02'],
      defaulted: null,
    });
    expect(resolveTablePeriod({ kind: 'last_n', unit: 'year', n: 2 }, yearly, REF)).toEqual({
      ok: true,
      codes: ['2024JJ00', '2025JJ00'],
      defaulted: null,
    });
  });

  it('last_n asking for more periods than published → missing', () => {
    expect(resolveTablePeriod({ kind: 'last_n', unit: 'year', n: 5 }, gappy, REF)).toMatchObject({
      ok: false,
      reason: 'table_lane_period_missing',
      latestPeriodCode: '2021JJ00',
    });
  });

  it('last_n with a grain the table lacks → period_grain', () => {
    expect(resolveTablePeriod({ kind: 'last_n', unit: 'month', n: 3 }, yearly, REF)).toMatchObject({
      ok: false,
      reason: 'table_lane_period_grain',
    });
  });
});

describe('resolveTablePeriod — latest / none / unsupported', () => {
  it('latest → the latest code at the coarsest grain (no grain implied), not defaulted', () => {
    expect(resolveTablePeriod({ kind: 'latest' }, mixed, REF)).toEqual({
      ok: true,
      codes: ['2025JJ00'],
      defaulted: null,
    });
  });

  it('none → latest at the coarsest grain, stated as a default with the CBS title', () => {
    expect(resolveTablePeriod({ kind: 'none' }, gappy, REF)).toEqual({
      ok: true,
      codes: ['2021JJ00'],
      defaulted: { code: '2021JJ00', label: '2021' },
    });
  });

  it('none on a table without yearly codes → latest at the coarsest grain it has', () => {
    const codes = [code('2024KW04', '2024 4e kwartaal'), code('2025MM01', '2025 januari'), code('2025KW01', '2025 1e kwartaal')];
    expect(resolveTablePeriod({ kind: 'none' }, codes, REF)).toEqual({
      ok: true,
      codes: ['2025KW01'],
      defaulted: { code: '2025KW01', label: '2025 1e kwartaal' },
    });
  });

  it('unreadable codes are ignored', () => {
    const codes = [code('2020JJ00'), code('2021X'), code('garbage'), code('2021JJ00')];
    expect(resolveTablePeriod({ kind: 'latest' }, codes, REF)).toEqual({ ok: true, codes: ['2021JJ00'], defaulted: null });
  });

  it('latest/none on a table with no readable period code → missing', () => {
    expect(resolveTablePeriod({ kind: 'none' }, [code('garbage')], REF)).toMatchObject({
      ok: false,
      reason: 'table_lane_period_missing',
    });
  });

  it('change_over_year stays refused: the stand-vs-flow reading is not stated by an un-curated table', () => {
    expect(resolveTablePeriod({ kind: 'change_over_year', year: 2020 }, yearly, REF)).toMatchObject({
      ok: false,
      reason: 'table_lane_period_unsupported',
    });
  });
});

// 2026-10-01 (#342 (b)): the curated resolver's own rules
// (src/answer/intent/period-rules.ts) over the table's published codes.
describe('resolveTablePeriod — now_vs_ago (curated rule: finest published grain that expresses the unit)', () => {
  it('yearly-only table: the latest year and the year N before it', () => {
    expect(resolveTablePeriod({ kind: 'now_vs_ago', unit: 'year', amount: 5 }, yearly, REF)).toEqual({
      ok: true,
      codes: ['2020JJ00', '2025JJ00'],
      defaulted: null,
    });
  });

  it('JJ + KW + MM table: "5 jaar geleden" compares the latest MONTH with the same month 5 years back (curated: finest grain)', () => {
    expect(resolveTablePeriod({ kind: 'now_vs_ago', unit: 'year', amount: 5 }, mixed, REF)).toEqual({
      ok: true,
      codes: ['2021MM08', '2026MM08'],
      defaulted: null,
    });
    expect(resolveTablePeriod({ kind: 'now_vs_ago', unit: 'quarter', amount: 2 }, mixed, REF)).toEqual({
      ok: true,
      codes: ['2026MM02', '2026MM08'],
      defaulted: null,
    });
  });

  it('a month comparison on a yearly-only table → period_grain (no month to compare)', () => {
    expect(resolveTablePeriod({ kind: 'now_vs_ago', unit: 'month', amount: 3 }, yearly, REF)).toMatchObject({
      ok: false,
      reason: 'table_lane_period_grain',
    });
  });

  it('the earlier period is not in the table → period_missing, never a nearest period', () => {
    const r = resolveTablePeriod({ kind: 'now_vs_ago', unit: 'year', amount: 60 }, yearly, REF);
    expect(r).toMatchObject({ ok: false, reason: 'table_lane_period_missing' });
    expect(r).not.toHaveProperty('latestPeriodCode');
  });

  it('gappy table: the step lands on an unpublished year → period_missing', () => {
    // 82291NED lists 2013, 2017, 2021 — "4 jaar geleden" from 2021 is 2017 (listed), 3 years is 2018 (not).
    expect(resolveTablePeriod({ kind: 'now_vs_ago', unit: 'year', amount: 4 }, gappy, REF)).toMatchObject({
      ok: true,
      codes: ['2017JJ00', '2021JJ00'],
    });
    expect(resolveTablePeriod({ kind: 'now_vs_ago', unit: 'year', amount: 3 }, gappy, REF)).toMatchObject({
      ok: false,
      reason: 'table_lane_period_missing',
    });
  });

  it.each([0, -1, 1.5, 121])('amount %s → period_unsupported', (amount) => {
    expect(resolveTablePeriod({ kind: 'now_vs_ago', unit: 'year', amount }, yearly, REF)).toMatchObject({
      ok: false,
      reason: 'table_lane_period_unsupported',
    });
  });
});

describe('resolveTablePeriod — date_range (curated rule, ADR 023)', () => {
  const range = (
    from: [number, number, number | null],
    to: [number, number, number | null],
    toInclusive = true,
  ) =>
    ({
      kind: 'date_range',
      from: { year: from[0], month: from[1], day: from[2] },
      to: { year: to[0], month: to[1], day: to[2] },
      toInclusive,
    }) as const;

  it('whole calendar years on a yearly-only table → those years (exact, no adaptation)', () => {
    expect(resolveTablePeriod(range([2020, 1, 1], [2022, 12, 31]), yearly, REF)).toEqual({
      ok: true,
      codes: ['2020JJ00', '2021JJ00', '2022JJ00'],
      defaulted: null,
    });
  });

  it('the same boundaries on a monthly table → the monthly cells (finest exact grain)', () => {
    const r = resolveTablePeriod(range([2022, 1, 1], [2022, 12, 31]), mixed, REF);
    expect(r).toMatchObject({ ok: true });
    if (r.ok) {
      expect(r.codes).toHaveLength(12);
      expect(r.codes[0]).toBe('2022MM01');
      expect(r.codes[11]).toBe('2022MM12');
    }
  });

  it('boundaries a yearly table cannot express (March..August) → period_grain', () => {
    expect(resolveTablePeriod(range([2022, 3, null], [2022, 8, null]), yearly, REF)).toMatchObject({
      ok: false,
      reason: 'table_lane_period_grain',
    });
  });

  it('a single whole month → one MM code', () => {
    expect(resolveTablePeriod(range([2024, 3, 1], [2024, 3, 31]), mixed, REF)).toEqual({
      ok: true,
      codes: ['2024MM03'],
      defaulted: null,
    });
  });

  it('bare "tot" with a month end excludes that month (the curated strict reading)', () => {
    const r = resolveTablePeriod(range([2024, 1, null], [2024, 4, null], false), mixed, REF);
    expect(r).toMatchObject({ ok: true, codes: ['2024MM01', '2024MM02', '2024MM03'] });
  });

  it('a boundary that cuts into a month → period_unsupported (never a widened window)', () => {
    expect(resolveTablePeriod(range([2022, 1, 15], [2022, 12, 31]), mixed, REF)).toMatchObject({
      ok: false,
      reason: 'table_lane_period_unsupported',
    });
  });

  it('an impossible date → period_unsupported', () => {
    expect(resolveTablePeriod(range([2022, 2, 30], [2022, 12, 31]), mixed, REF)).toMatchObject({
      ok: false,
      reason: 'table_lane_period_unsupported',
    });
  });

  it('a range entirely outside the table → period_missing', () => {
    expect(resolveTablePeriod(range([1950, 1, null], [1960, 12, null]), yearly, REF)).toMatchObject({
      ok: false,
      reason: 'table_lane_period_missing',
      latestPeriodCode: '2025JJ00',
    });
  });
});

describe('resolveTablePeriod — relative (curated rule: calendar step from the reference date)', () => {
  it('"vorig jaar" on 2026-09-29 → 2025 when the table lists it', () => {
    expect(resolveTablePeriod({ kind: 'relative', unit: 'year', offset: -1 }, yearly, REF)).toEqual({
      ok: true,
      codes: ['2025JJ00'],
      defaulted: null,
    });
  });

  it('"vorige maand" on 2026-09-29 → 2026MM08; "vorig kwartaal" → 2026KW02', () => {
    expect(resolveTablePeriod({ kind: 'relative', unit: 'month', offset: -1 }, mixed, REF)).toEqual({
      ok: true,
      codes: ['2026MM08'],
      defaulted: null,
    });
    expect(resolveTablePeriod({ kind: 'relative', unit: 'quarter', offset: -1 }, mixed, REF)).toEqual({
      ok: true,
      codes: ['2026KW02'],
      defaulted: null,
    });
  });

  it('the calendar period is not published yet → period_missing naming the latest (never the latest silently)', () => {
    expect(resolveTablePeriod({ kind: 'relative', unit: 'year', offset: -1 }, yearly, '2027-02-01')).toMatchObject({
      ok: false,
      reason: 'table_lane_period_missing',
      latestPeriodCode: '2025JJ00',
    });
  });

  it('a relative month on a yearly-only table → period_grain', () => {
    expect(resolveTablePeriod({ kind: 'relative', unit: 'month', offset: -1 }, yearly, REF)).toMatchObject({
      ok: false,
      reason: 'table_lane_period_grain',
    });
  });

  it.each([1, -121, -0.5])('offset %s → period_unsupported', (offset) => {
    expect(resolveTablePeriod({ kind: 'relative', unit: 'year', offset }, yearly, REF)).toMatchObject({
      ok: false,
      reason: 'table_lane_period_unsupported',
    });
  });
});

describe('trailingPeriods (session 153, trend by default)', () => {
  const c = (code: string) => ({ code, title: code, dimensionGroup: null, status: 'Definitief', index: null });
  const yearly = ['2015JJ00', '2016JJ00', '2017JJ00', '2018JJ00', '2019JJ00', '2020JJ00', '2021JJ00', '2022JJ00'].map(c);

  it('ends at the given code, same grain only, at most the grain\'s context length', () => {
    const mixed = [...yearly, c('2022KW01'), c('2022KW02')];
    expect(trailingPeriods(mixed, '2022JJ00')).toEqual(['2017JJ00', '2018JJ00', '2019JJ00', '2020JJ00', '2021JJ00', '2022JJ00']);
    expect(trailingPeriods(mixed, '2022JJ00')).toHaveLength(TREND_CONTEXT_PERIODS.JJ);
    expect(trailingPeriods(mixed, '2022KW02')).toEqual(['2022KW01', '2022KW02']);
  });

  it('a short table gives what it has; an unknown code gives []', () => {
    expect(trailingPeriods(yearly.slice(0, 2), '2016JJ00')).toEqual(['2015JJ00', '2016JJ00']);
    expect(trailingPeriods(yearly, '2030JJ00')).toEqual([]);
  });

  it('irregular months (CBS publishes only April and December) keep CBS\'s own gaps', () => {
    const codes = ['2024MM04', '2024MM12', '2025MM04', '2025MM12', '2026MM04'].map(c);
    expect(trailingPeriods(codes, '2026MM04')).toEqual(['2024MM04', '2024MM12', '2025MM04', '2025MM12', '2026MM04']);
  });
});


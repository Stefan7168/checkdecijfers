// Breadth step 5, Task 2 — the table lane's period resolver
// (src/answer/table-lane/periods.ts): a reader's PeriodSpec resolved against
// ONE table's own stored period codes, never a calendar guess (principle c;
// plan "Settled design choices" 8). Pure; no db, no LLM.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { CbsCode, CbsTableSchema } from '../../src/cbs-adapter/types.ts';
import { resolveTablePeriod } from '../../src/answer/table-lane/periods.ts';

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

  it.each([
    [{ kind: 'change_over_year', year: 2020 }],
    [{ kind: 'now_vs_ago', unit: 'year', amount: 5 }],
    [{ kind: 'relative', unit: 'year', offset: -1 }],
    [
      {
        kind: 'date_range',
        from: { year: 2020, month: 1, day: 1 },
        to: { year: 2020, month: 12, day: 31 },
        toInclusive: true,
      },
    ],
  ] as const)('%o → table_lane_period_unsupported', (spec) => {
    expect(resolveTablePeriod(spec, yearly, REF)).toMatchObject({ ok: false, reason: 'table_lane_period_unsupported' });
  });
});

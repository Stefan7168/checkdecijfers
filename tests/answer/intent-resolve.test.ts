// Deterministic-resolution tests: raw candidates (as the LLM would emit them)
// → StructuredIntent or typed failure, against the hermetic fixture database
// (ADR 009). No LLM anywhere in this file — this is the half of WP6 that must
// hold regardless of what any model does.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  isResolutionFailure,
  normalizeRegionName,
  resolveCandidate,
  STAND_START_OF_YEAR_KEYS,
  stepPeriodCode,
} from '../../src/answer/intent/index.ts';
import type { PeriodSpec, RawCandidate, RegionTerm } from '../../src/answer/intent/index.ts';
import { runQuery } from '../../src/query/index.ts';
import type { Db } from '../../src/db/types.ts';
import { createIngestedDb } from '../helpers/ingested-db.ts';

const REFERENCE_DATE = '2026-08-15';

let db: Db;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createIngestedDb());
}, 300_000);

afterAll(async () => {
  await close();
});

function raw(
  canonicalKey: string,
  period: PeriodSpec,
  regions: RegionTerm[] | null = null,
  derivation: RawCandidate['derivation'] = 'none',
): RawCandidate {
  return { canonicalKey, regions, period, derivation, confidence: 0.9, reading: 'test' };
}

async function resolved(candidate: RawCandidate) {
  const result = await resolveCandidate(db, candidate, REFERENCE_DATE);
  if (isResolutionFailure(result)) {
    throw new Error(`expected resolution, got failure: ${result.reason} (${result.message})`);
  }
  return result;
}

async function failed(candidate: RawCandidate) {
  const result = await resolveCandidate(db, candidate, REFERENCE_DATE);
  if (!isResolutionFailure(result)) {
    throw new Error(`expected failure, got intent ${JSON.stringify(result.intent)}`);
  }
  return result;
}

describe('region resolution (names → CBS codes, never by the LLM)', () => {
  it('Nederland resolves to NL01', async () => {
    const result = await resolved(raw('population_on_1_january', { kind: 'year', year: 2025 }, [{ name: 'Nederland', kind: 'land' }]));
    expect(result.intent.regions).toEqual(['NL01']);
  });

  it('an explicit gemeente qualifier disambiguates Utrecht (B2)', async () => {
    const result = await resolved(raw('population_on_1_january', { kind: 'year', year: 2024 }, [{ name: 'Utrecht', kind: 'gemeente' }]));
    expect(result.intent.regions).toEqual(['GM0344']);
  });

  it('an explicit provincie qualifier resolves to the PV code', async () => {
    const result = await resolved(raw('population_on_1_january', { kind: 'year', year: 2024 }, [{ name: 'Utrecht', kind: 'provincie' }]));
    expect(result.intent.regions).toEqual(['PV26']);
  });

  it('bare "Utrecht" is user-facing ambiguity with in-slice options (R7)', async () => {
    const failure = await failed(raw('population_on_1_january', { kind: 'year', year: 2024 }, [{ name: 'Utrecht', kind: 'onbekend' }]));
    expect(failure.reason).toBe('region_ambiguous');
    expect(failure.axis).toBe('region');
    expect(failure.options).toContain('Utrecht (gemeente)');
    expect(failure.options).toContain('Utrecht (PV)');
    // The COROP region "Utrecht (CR)" exists in the labels but is outside the
    // loaded slice (NL/PV/GM) — it may not be offered as an option (docs/05).
    expect(failure.options).not.toContain('Utrecht (CR)');
  });

  it('"Den Haag" resolves via the alias to \'s-Gravenhage (GM0518)', async () => {
    const result = await resolved(raw('population_on_1_january', { kind: 'year', year: 2025 }, [{ name: 'Den Haag', kind: 'onbekend' }]));
    expect(result.intent.regions).toEqual(['GM0518']);
  });

  it('matching is case- and diacritic-insensitive', async () => {
    const result = await resolved(raw('population_on_1_january', { kind: 'year', year: 2024 }, [{ name: 'amsterdam', kind: 'onbekend' }]));
    expect(result.intent.regions).toEqual(['GM0363']);
    expect(normalizeRegionName("’s-Gravenhage")).toBe("'s-gravenhage");
  });

  it('an unknown place fails as region_unknown', async () => {
    const failure = await failed(raw('population_on_1_january', { kind: 'year', year: 2024 }, [{ name: 'Atlantis', kind: 'onbekend' }]));
    expect(failure.reason).toBe('region_unknown');
  });

  it('a region on a national-only measure fails honestly (B16 shape)', async () => {
    const failure = await failed(raw('housing_stock_start_of_year', { kind: 'year', year: 2024 }, [{ name: 'Amsterdam', kind: 'gemeente' }]));
    expect(failure.reason).toBe('region_on_national_measure');
    expect(failure.options).toEqual(['heel Nederland']);
  });

  it('order of named regions is preserved (B14 G4 order)', async () => {
    const g4: RegionTerm[] = [
      { name: 'Amsterdam', kind: 'gemeente' },
      { name: 'Rotterdam', kind: 'gemeente' },
      { name: 'Den Haag', kind: 'gemeente' },
      { name: 'Utrecht', kind: 'gemeente' },
    ];
    const result = await resolved(raw('population_on_1_january', { kind: 'year', year: 2025 }, g4, 'max'));
    expect(result.intent.regions).toEqual(['GM0363', 'GM0599', 'GM0518', 'GM0344']);
    expect(result.intent.derivation).toBe('max');
  });

  it('"meeste" without named regions cannot resolve (no silent max-over-everything)', async () => {
    const failure = await failed(raw('population_on_1_january', { kind: 'year', year: 2025 }, null, 'max'));
    expect(failure.axis).toBe('region');
  });
});

describe('period resolution (specs → CBS codes, clock injected)', () => {
  it('year, quarter and month specs produce single codes', async () => {
    expect((await resolved(raw('cpi_yearly_inflation', { kind: 'year', year: 2024 }))).intent.period).toEqual({ kind: 'codes', codes: ['2024JJ00'] });
    expect((await resolved(raw('unemployment_rate_seasonally_adjusted', { kind: 'quarter', year: 2025, quarter: 4 }))).intent.period).toEqual({ kind: 'codes', codes: ['2025KW04'] });
    expect((await resolved(raw('cpi_yearly_inflation', { kind: 'month', year: 2025, month: 3 }))).intent.period).toEqual({ kind: 'codes', codes: ['2025MM03'] });
  });

  it('a year range becomes a range intent with derivation series', async () => {
    const result = await resolved(raw('cpi_yearly_inflation', { kind: 'year_range', fromYear: 2020, toYear: 2024 }));
    expect(result.intent.period).toEqual({ kind: 'range', from: '2020JJ00', to: '2024JJ00' });
    expect(result.intent.derivation).toBe('series');
  });

  it('change_over_year maps per period semantics: stand per 1 januari vs flow (B13)', async () => {
    const stand = await resolved(raw('population_on_1_january', { kind: 'change_over_year', year: 2024 }, [{ name: 'Nederland', kind: 'land' }]));
    expect(stand.intent.period).toEqual({ kind: 'codes', codes: ['2024JJ00', '2025JJ00'] });
    expect(stand.intent.derivation).toBe('difference');
    const flow = await resolved(raw('cpi_yearly_inflation', { kind: 'change_over_year', year: 2024 }));
    expect(flow.intent.period).toEqual({ kind: 'codes', codes: ['2023JJ00', '2024JJ00'] });
  });

  it('relative periods resolve against the injected reference date and imply recency', async () => {
    const month = await resolved(raw('cpi_yearly_inflation', { kind: 'relative', unit: 'month', offset: -1 }));
    expect(month.intent.period).toEqual({ kind: 'codes', codes: ['2026MM07'] });
    expect(month.impliedRecency).toBe(true);
    const quarter = await resolved(raw('unemployment_rate_seasonally_adjusted', { kind: 'relative', unit: 'quarter', offset: -1 }));
    expect(quarter.intent.period).toEqual({ kind: 'codes', codes: ['2026KW02'] });
    const year = await resolved(raw('cpi_yearly_inflation', { kind: 'relative', unit: 'year', offset: -1 }));
    expect(year.intent.period).toEqual({ kind: 'codes', codes: ['2025JJ00'] });
  });

  it('latest resolves to the freshest published period at the finest grain — code only, no value', async () => {
    const result = await resolved(raw('cpi_yearly_inflation', { kind: 'latest' }));
    const expected = await db.query(
      "select max(period_code) as latest from observations where table_id = '86141NED' and measure = 'M000238' and period_grain = 'MM'",
    );
    expect(result.intent.period).toEqual({ kind: 'codes', codes: [expected.rows[0]!.latest as string] });
    expect(result.impliedRecency).toBe(true);
  });

  it('a grain the measure is not published at fails with the available grains as options', async () => {
    const failure = await failed(raw('population_on_1_january', { kind: 'month', year: 2025, month: 3 }, [{ name: 'Nederland', kind: 'land' }]));
    expect(failure.reason).toBe('grain_unavailable');
    expect(failure.options).toEqual(['per jaar']);
  });

  it('no period signal fails as period_missing — never a guessed year', async () => {
    const failure = await failed(raw('cpi_yearly_inflation', { kind: 'none' }));
    expect(failure.reason).toBe('period_missing');
    expect(failure.axis).toBe('period');
  });

  it('nonsense periods fail as period_invalid', async () => {
    expect((await failed(raw('cpi_yearly_inflation', { kind: 'year', year: 12 }))).reason).toBe('period_invalid');
    expect((await failed(raw('cpi_yearly_inflation', { kind: 'quarter', year: 2024, quarter: 5 }))).reason).toBe('period_invalid');
    expect((await failed(raw('cpi_yearly_inflation', { kind: 'year_range', fromYear: 2024, toYear: 2020 }))).reason).toBe('period_invalid');
  });
});

describe('multi-period derivations over a single-period selection clarify, never reach the query layer (validation pass 2026-07-04, V01/V28)', () => {
  // The raw schema cannot express an open-ended range ("sinds 2015") and the
  // prompt is deliberately date-free, so the model emits fromYear == toYear.
  // Before this guard the shape travelled to the query layer, whose
  // invalid_intent refusal surfaces as the catch-all internal text — an
  // error, not a designed outcome.
  async function loadedYearBounds(key: string): Promise<{ earliest: number; latest: number }> {
    const canonical = await db.query('select table_id, measure from canonical_measures where key = $1', [key]);
    const bounds = await db.query(
      "select min(period_code) as earliest, max(period_code) as latest from observations where table_id = $1 and measure = $2 and period_grain = 'JJ'",
      [canonical.rows[0]!.table_id, canonical.rows[0]!.measure],
    );
    return {
      earliest: Number((bounds.rows[0]!.earliest as string).slice(0, 4)),
      latest: Number((bounds.rows[0]!.latest as string).slice(0, 4)),
    };
  }

  it('a degenerate year_range (from == to) exits to a period clarification with a loaded-data range option', async () => {
    const failure = await failed(
      raw('cpi_yearly_inflation', { kind: 'year_range', fromYear: 2015, toYear: 2015 }, null, 'series'),
    );
    expect(failure.axis).toBe('period');
    expect(failure.reason).toBe('period_missing');
    // The option must resolve in the loaded data (docs/05): both ends come
    // from the published JJ periods in the same database.
    const { earliest, latest } = await loadedYearBounds('cpi_yearly_inflation');
    expect(latest).toBeGreaterThan(2015);
    expect(failure.options).toEqual([`${Math.max(2015, earliest)} tot en met ${latest}`]);
  });

  it('never offers a yearly range when the yearly cells sit at a different coordinate than the canonical reading', async () => {
    // Unemployment's yearly cells are exclusively UN-corrected; the canonical
    // seasonally-adjusted coordinate has no yearly series. Pre-WP14 the grain
    // check and the range offer both ran WITHOUT the coordinate filter: the
    // guard offered "2013 tot en met 2025" — a range that dead-ended in a
    // no_data refusal if the user confirmed it (WP14 finding, 2026-07-04).
    // Coordinate-aware, the yearly shape now exits at the grain gate with the
    // honest alternative.
    const failure = await failed(
      raw('unemployment_rate_seasonally_adjusted', { kind: 'year_range', fromYear: 2015, toYear: 2015 }, [{ name: 'Nederland', kind: 'land' }]),
    );
    expect(failure.axis).toBe('period');
    expect(failure.reason).toBe('grain_unavailable');
    expect(failure.options).toEqual(['per kwartaal']);
  });

  it('a start year BEFORE the loaded slice is clamped — the offered range must fully resolve (docs/05)', async () => {
    const failure = await failed(
      raw('population_on_1_january', { kind: 'year_range', fromYear: 1970, toYear: 1970 }, [{ name: 'Nederland', kind: 'land' }]),
    );
    expect(failure.axis).toBe('period');
    const { earliest, latest } = await loadedYearBounds('population_on_1_january');
    expect(earliest).toBeGreaterThan(1970);
    expect(failure.options).toEqual([`${earliest} tot en met ${latest}`]);
  });

  it('an explicit series hint on a single year clarifies instead of erroring', async () => {
    const failure = await failed(raw('cpi_yearly_inflation', { kind: 'year', year: 2023 }, null, 'series'));
    expect(failure.axis).toBe('period');
    expect(failure.reason).toBe('period_missing');
    // A yearly single period still yields a resolvable range suggestion.
    expect(failure.options).toHaveLength(1);
    expect(failure.options[0]).toMatch(/^2023 tot en met \d{4}$/);
  });

  it('an explicit difference hint on a single year clarifies instead of erroring', async () => {
    const failure = await failed(raw('cpi_yearly_inflation', { kind: 'year', year: 2023 }, null, 'difference'));
    expect(failure.axis).toBe('period');
    expect(failure.reason).toBe('period_missing');
  });

  it('series over the latest (single, monthly) period clarifies without inventing a yearly range option', async () => {
    const failure = await failed(raw('cpi_yearly_inflation', { kind: 'latest' }, null, 'series'));
    expect(failure.axis).toBe('period');
    expect(failure.reason).toBe('period_missing');
    // CPI's finest grain is monthly — no yearly range suggestion exists for a
    // monthly code, and no other option may be invented.
    expect(failure.options).toEqual([]);
  });

  it('a from == to range starting at the freshest published year offers no impossible range option', async () => {
    const canonical = await db.query(
      "select table_id, measure from canonical_measures where key = 'population_on_1_january'",
    );
    const latest = await db.query(
      "select max(period_code) as latest from observations where table_id = $1 and measure = $2 and period_grain = 'JJ'",
      [canonical.rows[0]!.table_id, canonical.rows[0]!.measure],
    );
    const year = Number((latest.rows[0]!.latest as string).slice(0, 4));
    const failure = await failed(
      raw('population_on_1_january', { kind: 'year_range', fromYear: year, toYear: year }, [{ name: 'Nederland', kind: 'land' }]),
    );
    expect(failure.axis).toBe('period');
    expect(failure.options).toEqual([]);
  });

  it('a genuine multi-year range with an explicit series hint still resolves (the guard does not over-trigger)', async () => {
    const result = await resolved(raw('cpi_yearly_inflation', { kind: 'year_range', fromYear: 2020, toYear: 2024 }, null, 'series'));
    expect(result.intent.period).toEqual({ kind: 'range', from: '2020JJ00', to: '2024JJ00' });
    expect(result.intent.derivation).toBe('series');
  });

  it('an interior gap in the loaded years suppresses the range option — never offer a range we cannot serve', async () => {
    // Punch a one-year hole inside the loaded window, inside a transaction
    // that is rolled back (the shared test database must come out untouched —
    // WP10 lesson: probes never leave residue).
    const canonical = await db.query(
      "select table_id, measure from canonical_measures where key = 'cpi_yearly_inflation'",
    );
    const { table_id, measure } = canonical.rows[0]! as { table_id: string; measure: string };
    const { earliest, latest } = await loadedYearBounds('cpi_yearly_inflation');
    const gapYear = earliest + 1;
    expect(gapYear).toBeLessThan(latest);
    await db.query('begin');
    try {
      await db.query(
        'delete from observations where table_id = $1 and measure = $2 and period_code = $3',
        [table_id, measure, `${gapYear}JJ00`],
      );
      const failure = await failed(
        raw('cpi_yearly_inflation', { kind: 'year_range', fromYear: earliest, toYear: earliest }, null, 'series'),
      );
      expect(failure.axis).toBe('period');
      expect(failure.options).toEqual([]);
    } finally {
      await db.query('rollback');
    }
    // The hole is gone: the option is offered again.
    const restored = await failed(
      raw('cpi_yearly_inflation', { kind: 'year_range', fromYear: earliest, toYear: earliest }, null, 'series'),
    );
    expect(restored.options).toEqual([`${earliest} tot en met ${latest}`]);
  });
});

describe('open-ended period ranges (WP14, open-questions #55): since / last_n / now_vs_ago', () => {
  // Fixture-DB anchors (committed, deterministic): CPI JJ 2010–2025 and MM
  // through 2026MM06; unemployment JJ 2013–2025 and KW through 2026KW01;
  // population JJ through 2026JJ00 with slice floor 2019JJ00.

  describe('since — the model states the start, code resolves the open end', () => {
    it('"sinds 2015" resolves to a range ending at the freshest published year and implies recency', async () => {
      const result = await resolved(raw('cpi_yearly_inflation', { kind: 'since', year: 2015, quarter: null, month: null }, null, 'series'));
      expect(result.intent.period).toEqual({ kind: 'range', from: '2015JJ00', to: '2025JJ00' });
      expect(result.intent.derivation).toBe('series');
      expect(result.impliedRecency).toBe(true);
    });

    it('a year-only since falls back to the finest published grain when the canonical coordinate has no yearly series (V01)', async () => {
      // CBS publishes NO seasonally-adjusted yearly unemployment — the
      // table's yearly cells are un-corrected, a different coordinate. The
      // honest yearly-shaped answer is the quarterly headline series from
      // that year's first quarter.
      const result = await resolved(
        raw('unemployment_rate_seasonally_adjusted', { kind: 'since', year: 2015, quarter: null, month: null }, [{ name: 'Nederland', kind: 'land' }], 'series'),
      );
      expect(result.intent.period).toEqual({ kind: 'range', from: '2015KW01', to: '2026KW01' });
      expect(result.intent.derivation).toBe('series');
      expect(result.impliedRecency).toBe(true);
    });

    it('a start month refines the grain: "sinds maart 2020" runs monthly to the freshest month', async () => {
      const result = await resolved(raw('cpi_yearly_inflation', { kind: 'since', year: 2020, quarter: null, month: 3 }));
      expect(result.intent.period).toEqual({ kind: 'range', from: '2020MM03', to: '2026MM06' });
    });

    it('a start quarter refines the grain likewise', async () => {
      const result = await resolved(raw('unemployment_rate_seasonally_adjusted', { kind: 'since', year: 2023, quarter: 2, month: null }));
      expect(result.intent.period).toEqual({ kind: 'range', from: '2023KW02', to: '2026KW01' });
    });

    it('a "since" derivation hint is normalized to series even under a difference hint ("met hoeveel gestegen sinds 2015")', async () => {
      const result = await resolved(raw('cpi_yearly_inflation', { kind: 'since', year: 2015, quarter: null, month: null }, null, 'difference'));
      // A difference over >2 cells could never execute; the pre-registered
      // direction derivation carries the honest net change instead.
      expect(result.intent.derivation).toBe('series');
    });

    it('a start beyond the freshest published period fails as period_invalid, never an empty range', async () => {
      const failure = await failed(raw('cpi_yearly_inflation', { kind: 'since', year: 2030, quarter: null, month: null }));
      expect(failure.reason).toBe('period_invalid');
      expect(failure.axis).toBe('period');
    });

    it('both a month and a quarter on one since is a contract violation → period_invalid', async () => {
      const failure = await failed(raw('cpi_yearly_inflation', { kind: 'since', year: 2020, quarter: 2, month: 3 }));
      expect(failure.reason).toBe('period_invalid');
    });

    it('a sub-year since on a yearly-only measure exits as grain_unavailable with honest options', async () => {
      const failure = await failed(raw('population_on_1_january', { kind: 'since', year: 2020, quarter: null, month: 6 }, [{ name: 'Nederland', kind: 'land' }]));
      expect(failure.reason).toBe('grain_unavailable');
      expect(failure.options).toEqual(['per jaar']);
    });

    it('a since starting at the freshest published year degenerates and the existing guard clarifies', async () => {
      // "sinds 2025" when 2025 is the freshest CPI year: range 2025..2025 is
      // structurally single-period; the WP13-interim degenerate guard stays
      // the fallback (docs/08 WP14 brief).
      const failure = await failed(raw('cpi_yearly_inflation', { kind: 'since', year: 2025, quarter: null, month: null }, null, 'series'));
      expect(failure.axis).toBe('period');
      expect(failure.reason).toBe('period_missing');
    });
  });

  describe('since passes out-of-slice starts THROUGH — the query layer stays the single honest source (no clamping)', () => {
    it('"inwoners sinds 2015" resolves to 2015 despite the 2019 slice floor, and the query layer refuses outside_loaded_slice', async () => {
      const result = await resolved(
        raw('population_on_1_january', { kind: 'since', year: 2015, quarter: null, month: null }, [{ name: 'Nederland', kind: 'land' }], 'series'),
      );
      expect(result.intent.period).toEqual({ kind: 'range', from: '2015JJ00', to: '2026JJ00' });
      const outcome = await runQuery(db, result.intent);
      expect(outcome.ok).toBe(false);
      if (outcome.ok) throw new Error('unreachable');
      expect(outcome.refusal.kind).toBe('outside_loaded_slice');
      expect(outcome.refusal.nearestAlternative).toBe('2019JJ00');
    });

    it('"werkloosheid sinds 2010" (V28) resolves honestly and the query layer refuses not_published — CBS starts this series in 2013', async () => {
      const result = await resolved(
        raw('unemployment_rate_seasonally_adjusted', { kind: 'since', year: 2010, quarter: null, month: null }, [{ name: 'Nederland', kind: 'land' }], 'series'),
      );
      expect(result.intent.period).toEqual({ kind: 'range', from: '2010KW01', to: '2026KW01' });
      const outcome = await runQuery(db, result.intent);
      expect(outcome.ok).toBe(false);
      if (outcome.ok) throw new Error('unreachable');
      expect(outcome.refusal.kind).toBe('not_published');
    });

    it('"werkloosheid sinds 2015" (V01) answers end-to-end: a full validated series with direction pre-registered', async () => {
      const result = await resolved(
        raw('unemployment_rate_seasonally_adjusted', { kind: 'since', year: 2015, quarter: null, month: null }, [{ name: 'Nederland', kind: 'land' }], 'series'),
      );
      const outcome = await runQuery(db, result.intent);
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) throw new Error('unreachable');
      expect(outcome.shape).toBe('series');
      expect(outcome.cells).toHaveLength(45); // 2015KW01..2026KW01 inclusive
      expect(outcome.cells[0]!.periodCode).toBe('2015KW01');
      expect(outcome.cells[44]!.periodCode).toBe('2026KW01');
      expect(outcome.derivations.some((d) => d.kind === 'direction')).toBe(true);
    });
  });

  describe('last_n — the n freshest published periods, end-anchored', () => {
    it('"de afgelopen vijf jaar" is the 5 freshest published years', async () => {
      const result = await resolved(raw('cpi_yearly_inflation', { kind: 'last_n', unit: 'year', n: 5 }));
      expect(result.intent.period).toEqual({ kind: 'range', from: '2021JJ00', to: '2025JJ00' });
      expect(result.intent.derivation).toBe('series');
      expect(result.impliedRecency).toBe(true);
    });

    it('quarters wrap year boundaries correctly', async () => {
      const result = await resolved(raw('unemployment_rate_seasonally_adjusted', { kind: 'last_n', unit: 'quarter', n: 4 }));
      expect(result.intent.period).toEqual({ kind: 'range', from: '2025KW02', to: '2026KW01' });
    });

    it('months wrap year boundaries correctly', async () => {
      const result = await resolved(raw('cpi_yearly_inflation', { kind: 'last_n', unit: 'month', n: 8 }));
      expect(result.intent.period).toEqual({ kind: 'range', from: '2025MM11', to: '2026MM06' });
    });

    it('n = 1 ("het afgelopen jaar") is the single freshest published period, not a window — the hint stands, no series normalization', async () => {
      // The prompt asks for a relative offset on singular phrasings, but the
      // model legitimately encodes last_n(1) too (observed live, 2026-07-04);
      // both encodings converge on the same honest intent.
      const result = await resolved(raw('bankruptcies_businesses', { kind: 'last_n', unit: 'year', n: 1 }));
      expect(result.intent.period).toEqual({ kind: 'codes', codes: ['2025JJ00'] });
      expect(result.intent.derivation).toBe('none');
      expect(result.impliedRecency).toBe(true);
    });

    it('n of 0 or absurd is period_invalid', async () => {
      expect((await failed(raw('cpi_yearly_inflation', { kind: 'last_n', unit: 'year', n: 0 }))).reason).toBe('period_invalid');
      expect((await failed(raw('cpi_yearly_inflation', { kind: 'last_n', unit: 'year', n: -3 }))).reason).toBe('period_invalid');
      expect((await failed(raw('cpi_yearly_inflation', { kind: 'last_n', unit: 'year', n: 2.5 }))).reason).toBe('period_invalid');
      expect((await failed(raw('cpi_yearly_inflation', { kind: 'last_n', unit: 'year', n: 121 }))).reason).toBe('period_invalid');
    });

    it('a unit the measure is not published at exits as grain_unavailable', async () => {
      const failure = await failed(raw('population_on_1_january', { kind: 'last_n', unit: 'quarter', n: 4 }, [{ name: 'Nederland', kind: 'land' }]));
      expect(failure.reason).toBe('grain_unavailable');
      expect(failure.options).toEqual(['per jaar']);
    });

    it('a year window falls back to the finest published grain when the coordinate has no yearly series', async () => {
      // "de afgelopen vijf jaar" of unemployment = the last 20 quarters of
      // the seasonally-adjusted series (no yearly one exists at CBS).
      const result = await resolved(raw('unemployment_rate_seasonally_adjusted', { kind: 'last_n', unit: 'year', n: 5 }));
      expect(result.intent.period).toEqual({ kind: 'range', from: '2021KW02', to: '2026KW01' });
    });
  });

  describe('now_vs_ago — two disjoint periods at the finest grain that can express the unit (V02)', () => {
    it('"inflatie nu vs 5 jaar geleden" compares the freshest month with the month 60 back', async () => {
      const result = await resolved(raw('cpi_yearly_inflation', { kind: 'now_vs_ago', unit: 'year', amount: 5 }));
      expect(result.intent.period).toEqual({ kind: 'codes', codes: ['2021MM06', '2026MM06'] });
      expect(result.intent.derivation).toBe('none');
      expect(result.impliedRecency).toBe(true);
    });

    it('keeps an explicit difference hint — "met hoeveel gestegen t.o.v. 5 jaar geleden"', async () => {
      const result = await resolved(
        raw('unemployment_rate_seasonally_adjusted', { kind: 'now_vs_ago', unit: 'year', amount: 5 }, null, 'difference'),
      );
      expect(result.intent.period).toEqual({ kind: 'codes', codes: ['2021KW01', '2026KW01'] });
      expect(result.intent.derivation).toBe('difference');
    });

    it('a yearly-only measure compares at the year grain', async () => {
      const result = await resolved(raw('population_on_1_january', { kind: 'now_vs_ago', unit: 'year', amount: 5 }, [{ name: 'Nederland', kind: 'land' }]));
      expect(result.intent.period).toEqual({ kind: 'codes', codes: ['2021JJ00', '2026JJ00'] });
    });

    it('a unit finer than any published grain exits as grain_unavailable', async () => {
      const failure = await failed(raw('population_on_1_january', { kind: 'now_vs_ago', unit: 'month', amount: 6 }, [{ name: 'Nederland', kind: 'land' }]));
      expect(failure.reason).toBe('grain_unavailable');
      expect(failure.options).toEqual(['per jaar']);
    });

    it('quarter units pick the finest grain that expresses quarters exactly', async () => {
      const result = await resolved(raw('unemployment_rate_seasonally_adjusted', { kind: 'now_vs_ago', unit: 'quarter', amount: 2 }));
      expect(result.intent.period).toEqual({ kind: 'codes', codes: ['2025KW03', '2026KW01'] });
    });

    it('non-positive or absurd amounts are period_invalid', async () => {
      expect((await failed(raw('cpi_yearly_inflation', { kind: 'now_vs_ago', unit: 'year', amount: 0 }))).reason).toBe('period_invalid');
      expect((await failed(raw('cpi_yearly_inflation', { kind: 'now_vs_ago', unit: 'year', amount: -5 }))).reason).toBe('period_invalid');
      expect((await failed(raw('cpi_yearly_inflation', { kind: 'now_vs_ago', unit: 'year', amount: 121 }))).reason).toBe('period_invalid');
    });

    it('"nu vs 5 jaar geleden" answers end-to-end with both cells and an honest two-period result (V02)', async () => {
      const result = await resolved(raw('cpi_yearly_inflation', { kind: 'now_vs_ago', unit: 'year', amount: 5 }));
      const outcome = await runQuery(db, result.intent);
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) throw new Error('unreachable');
      expect(outcome.cells.map((c) => c.periodCode)).toEqual(['2021MM06', '2026MM06']);
      expect(outcome.derivations.some((d) => d.kind === 'direction')).toBe(true);
    });
  });

  describe('coordinate-aware grain lookups hold for EVERY canonical measure', () => {
    it("each canonical key resolves 'latest' — the merged-dims filter matches real observations everywhere", async () => {
      // Guards the WP14 coordinate filter against registry drift: if any
      // measure's defaults ⊕ dims stopped matching its stored observation
      // coordinates, its grains would silently come back empty here.
      const keys = await db.query('select key from canonical_measures order by key');
      expect(keys.rows.length).toBeGreaterThan(0);
      for (const row of keys.rows) {
        const result = await resolveCandidate(
          db,
          raw(row.key as string, { kind: 'latest' }),
          REFERENCE_DATE,
        );
        expect(isResolutionFailure(result), `latest failed for ${row.key as string}`).toBe(false);
      }
    });
  });

  describe('stepPeriodCode — pure period arithmetic', () => {
    it('steps within and across year boundaries at each grain', () => {
      expect(stepPeriodCode('2026KW01', -1)).toBe('2025KW04');
      expect(stepPeriodCode('2026MM01', -1)).toBe('2025MM12');
      expect(stepPeriodCode('2026MM06', -60)).toBe('2021MM06');
      expect(stepPeriodCode('2025JJ00', -10)).toBe('2015JJ00');
      expect(stepPeriodCode('2025KW02', 3)).toBe('2026KW01');
    });

    it('returns null for codes it cannot read — callers must fail loudly, never step garbage', () => {
      expect(stepPeriodCode('2025XX01', -1)).toBeNull();
      expect(stepPeriodCode('geen code', -1)).toBeNull();
      expect(stepPeriodCode('2025MM13', -1)).toBeNull();
    });

    it('returns null for steps it cannot apply — a fractional or NaN step must never yield a plausible-looking code', () => {
      // Review finding 2026-07-04: without this, stepPeriodCode('2026KW01',
      // 1.5) returned '2026KW2.5' — unreachable from current call sites
      // (integer-guarded), but the function is exported and fail-loud is its
      // stated contract.
      expect(stepPeriodCode('2026KW01', 1.5)).toBeNull();
      expect(stepPeriodCode('2026KW01', Number.NaN)).toBeNull();
      expect(stepPeriodCode('2026KW01', Number.POSITIVE_INFINITY)).toBeNull();
    });
  });
});

describe('curated stand-per-1-januari set cross-checks the registry prose', () => {
  it('every key in STAND_START_OF_YEAR_KEYS has JJ period semantics mentioning 1 januari', async () => {
    for (const key of STAND_START_OF_YEAR_KEYS) {
      const row = await db.query(
        `select t.period_semantics from cbs_tables t
         join canonical_measures c on c.table_id = t.id where c.key = $1`,
        [key],
      );
      const semantics = row.rows[0]?.period_semantics;
      const parsed = (typeof semantics === 'string' ? JSON.parse(semantics) : semantics) as Record<string, string>;
      expect(parsed.JJ, `period semantics for ${key}`).toMatch(/1 januari/);
    }
  });
});

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
} from '../../src/answer/intent/index.ts';
import type { PeriodSpec, RawCandidate, RegionTerm } from '../../src/answer/intent/index.ts';
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

  it('"sinds 2015" (degenerate year_range, from == to) exits to a period clarification with a loaded-data range option', async () => {
    const failure = await failed(
      raw('unemployment_rate_seasonally_adjusted', { kind: 'year_range', fromYear: 2015, toYear: 2015 }, [{ name: 'Nederland', kind: 'land' }]),
    );
    expect(failure.axis).toBe('period');
    expect(failure.reason).toBe('period_missing');
    // The option must resolve in the loaded data (docs/05): both ends come
    // from the published JJ periods in the same database.
    const { earliest, latest } = await loadedYearBounds('unemployment_rate_seasonally_adjusted');
    expect(latest).toBeGreaterThan(2015);
    expect(failure.options).toEqual([`${Math.max(2015, earliest)} tot en met ${latest}`]);
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

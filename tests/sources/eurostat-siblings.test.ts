// E2a step 5 (docs/superpowers/specs/2026-09-23-eurostat-e2a-country-answers-
// design.md §6 step 5; docs/superpowers/specs/2026-09-23-eurostat-e2a-step5-
// sibling-datasets.md §4): the ONE gate function
// (`activeEurostatSiblings()`) resolveCandidate's default, the offer-side
// gate and the click trust boundary all fall back to — proving here, once,
// that it agrees with itself under both flag states is what makes it safe
// for those three call sites to never diverge (requirement: "Resolver,
// offer-side gate and click trust boundary must always agree on the map").
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  EUROSTAT_SIBLINGS_REVIEWED,
  EUROSTAT_SIBLING_MEASURES_REVIEWED,
  EUROSTAT_SIBLING_REGISTRATIONS,
  activeEurostatSiblings,
  eurostatSiblingTargetKeys,
  eurostatSiblingsEnabled,
} from '../../src/sources/eurostat-siblings.ts';
import { CANONICAL_MEASURES } from '../../src/registry/defaults.ts';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('eurostatSiblingsEnabled / activeEurostatSiblings (E2a step 5/6 gate)', () => {
  it('unset env: disabled, active map is empty', () => {
    vi.stubEnv('EUROSTAT_SIBLINGS_ENABLED', '');
    expect(eurostatSiblingsEnabled()).toBe(false);
    expect(activeEurostatSiblings()).toEqual({});
  });

  it('env set to anything other than the exact string "1": still disabled (dark)', () => {
    for (const value of ['0', 'true', 'TRUE', '1 ', ' 1', 'yes']) {
      vi.stubEnv('EUROSTAT_SIBLINGS_ENABLED', value);
      expect(eurostatSiblingsEnabled(), value).toBe(false);
      expect(activeEurostatSiblings(), value).toEqual({});
    }
  });

  it('env exactly "1": enabled, active map is the three reviewed pairs', () => {
    vi.stubEnv('EUROSTAT_SIBLINGS_ENABLED', '1');
    expect(eurostatSiblingsEnabled()).toBe(true);
    expect(activeEurostatSiblings()).toEqual(EUROSTAT_SIBLINGS_REVIEWED);
    expect(Object.keys(activeEurostatSiblings())).toEqual([
      'unemployment_rate_seasonally_adjusted',
      'cpi_yearly_inflation',
      'gdp_growth_yoy_volume',
    ]);
  });

  it('read at CALL TIME, not module-load time: flipping the env var between two calls in the same test changes the result', () => {
    vi.stubEnv('EUROSTAT_SIBLINGS_ENABLED', '');
    expect(activeEurostatSiblings()).toEqual({});
    vi.stubEnv('EUROSTAT_SIBLINGS_ENABLED', '1');
    expect(activeEurostatSiblings()).toEqual(EUROSTAT_SIBLINGS_REVIEWED);
    vi.stubEnv('EUROSTAT_SIBLINGS_ENABLED', '');
    expect(activeEurostatSiblings()).toEqual({});
  });
});

describe('eurostatSiblingTargetKeys (offer-side gate + click trust boundary default)', () => {
  it('flag off: no argument -> empty set (same gate as the resolver default)', () => {
    vi.stubEnv('EUROSTAT_SIBLINGS_ENABLED', '');
    expect(eurostatSiblingTargetKeys()).toEqual(new Set());
  });

  it('flag on: no argument -> the three reviewed sibling keys', () => {
    vi.stubEnv('EUROSTAT_SIBLINGS_ENABLED', '1');
    expect(eurostatSiblingTargetKeys()).toEqual(
      new Set(['eu_unemployment_rate_harmonised', 'eu_hicp_annual_rate', 'eu_gdp_growth_yoy_volume']),
    );
  });

  it('an explicit override still wins over the flag (test seam unaffected)', () => {
    vi.stubEnv('EUROSTAT_SIBLINGS_ENABLED', '1');
    expect(eurostatSiblingTargetKeys({ foo: 'bar_key' })).toEqual(new Set(['bar_key']));
    vi.stubEnv('EUROSTAT_SIBLINGS_ENABLED', '');
    expect(eurostatSiblingTargetKeys({ foo: 'bar_key' })).toEqual(new Set(['bar_key']));
  });
});

describe('the reviewed constants (requirement 1: pairs + measures)', () => {
  it('EUROSTAT_SIBLINGS_REVIEWED has exactly the three owner-approved-topic pairs (§7 D4)', () => {
    expect(EUROSTAT_SIBLINGS_REVIEWED).toEqual({
      unemployment_rate_seasonally_adjusted: 'eu_unemployment_rate_harmonised',
      cpi_yearly_inflation: 'eu_hicp_annual_rate',
      gdp_growth_yoy_volume: 'eu_gdp_growth_yoy_volume',
    });
  });

  it('every CBS key in the reviewed pair map exists in src/registry/defaults.ts (CANONICAL_MEASURES)', () => {
    const cbsKeys = new Set(CANONICAL_MEASURES.map((c) => c.key));
    for (const cbsKey of Object.keys(EUROSTAT_SIBLINGS_REVIEWED)) {
      expect(cbsKeys.has(cbsKey), cbsKey).toBe(true);
    }
  });

  it('EUROSTAT_SIBLING_MEASURES_REVIEWED has exactly the three reviewed measures, everydayTerms always empty (sibling-only, never parser vocabulary)', () => {
    expect(EUROSTAT_SIBLING_MEASURES_REVIEWED.map((m) => m.key).sort()).toEqual(
      ['eu_gdp_growth_yoy_volume', 'eu_hicp_annual_rate', 'eu_unemployment_rate_harmonised'].sort(),
    );
    for (const m of EUROSTAT_SIBLING_MEASURES_REVIEWED) {
      expect(m.everydayTerms, m.key).toEqual([]);
      expect(m.tableId.startsWith('eurostat:'), m.key).toBe(true);
    }
  });

  it('every reviewed measure key is the target of exactly one reviewed pair, and vice versa', () => {
    const measureKeys = new Set(EUROSTAT_SIBLING_MEASURES_REVIEWED.map((m) => m.key));
    const pairTargets = new Set(Object.values(EUROSTAT_SIBLINGS_REVIEWED));
    expect(measureKeys).toEqual(pairTargets);
  });

  it('none of the three reviewed measures leak into CANONICAL_MEASURES (R7: never the parser vocabulary)', () => {
    const cbsKeys = new Set(CANONICAL_MEASURES.map((c) => c.key));
    for (const m of EUROSTAT_SIBLING_MEASURES_REVIEWED) {
      expect(cbsKeys.has(m.key), m.key).toBe(false);
    }
  });
});

describe('EUROSTAT_SIBLING_REGISTRATIONS (requirement 3: the one place the script and its test read)', () => {
  it('has exactly one registration per reviewed measure, matching tableIds', () => {
    const registrationIds = EUROSTAT_SIBLING_REGISTRATIONS.map((r) => r.tableId).sort();
    const measureTableIds = EUROSTAT_SIBLING_MEASURES_REVIEWED.map((m) => m.tableId).sort();
    expect(registrationIds).toEqual(measureTableIds);
  });

  it('no registration ever pins `geo` in dimensionEquals — the adapter refuses that (structural EU/EFTA sweep only)', () => {
    for (const reg of EUROSTAT_SIBLING_REGISTRATIONS) {
      expect(reg.slice.dimensionEquals, reg.tableId).not.toHaveProperty('geo');
    }
  });

  it('every periodFloor is a valid CBS-format period code', () => {
    for (const reg of EUROSTAT_SIBLING_REGISTRATIONS) {
      expect(reg.slice.periodFloor, reg.tableId).toMatch(/^\d{4}(JJ00|KW0[1-4]|MM(0[1-9]|1[0-2]))$/);
    }
  });
});

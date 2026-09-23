// Eurostat E2a Task 1, Step 1: the Dutch geo-name list is complete (every
// code the adapter can emit, and nothing else) and its lookups behave —
// pure code, no database. See src/sources/eurostat-geo-names.ts's own header
// for the "why" of this list's shape.
import { describe, expect, it } from 'vitest';
import { EU_EFTA_STAND_IN_GEO_CODES } from '../../src/eurostat-adapter/jsonstat.ts';
import {
  EUROSTAT_GEO_NAMES_NL,
  eurostatGeoCodeForDutchName,
  dutchDisplayNameForGeo,
} from '../../src/sources/eurostat-geo-names.ts';
import { normalizeRegionName } from '../../src/answer/intent/resolve.ts';

describe('Dutch Eurostat geo names', () => {
  it('names every code the adapter can emit, and nothing else', () => {
    expect(new Set(Object.keys(EUROSTAT_GEO_NAMES_NL))).toEqual(new Set(EU_EFTA_STAND_IN_GEO_CODES));
  });
  it.each([
    ['Duitsland', 'DE'], ['belgie', 'BE'], ['België', 'BE'], ['Griekenland', 'EL'],
    ['de EU', 'EU27_2020'], ['Europese Unie', 'EU27_2020'], ['de eurozone', 'EA20'], ['Nederland', 'NL'],
  ])('%s -> %s', (name, code) => expect(eurostatGeoCodeForDutchName(name)).toBe(code));
  it('refuses a country outside the list', () => {
    expect(eurostatGeoCodeForDutchName('Japan')).toBeNull();
    expect(eurostatGeoCodeForDutchName('de VS')).toBeNull();
  });
  it('display name is Dutch', () => expect(dutchDisplayNameForGeo('DE')).toBe('Duitsland'));
  it('no alias maps to two codes', () => {
    const seen = new Map<string, string>();
    for (const [code, e] of Object.entries(EUROSTAT_GEO_NAMES_NL))
      for (const a of [e.display, ...e.aliases]) {
        const k = a.toLowerCase();
        expect(seen.get(k) ?? code, `alias ${a}`).toBe(code);
        seen.set(k, code);
      }
  });
  // R2 (controller ruling): the raw-toLowerCase check above only guards the
  // literal strings in this file. The ACTUAL resolver matches through
  // normalizeRegionName (diacritics stripped, whitespace collapsed), so
  // uniqueness must ALSO hold after that normalization — otherwise two
  // differently-accented aliases for two DIFFERENT codes could still
  // collide even though the raw check above passed.
  it('no alias maps to two codes after normalizeRegionName (the resolver\'s own normalization)', () => {
    const seen = new Map<string, string>();
    for (const [code, e] of Object.entries(EUROSTAT_GEO_NAMES_NL))
      for (const a of [e.display, ...e.aliases]) {
        const k = normalizeRegionName(a);
        expect(seen.get(k) ?? code, `normalized alias "${k}" (from "${a}")`).toBe(code);
        seen.set(k, code);
      }
  });
  it('EA / EA19 / EA20 stay distinct after normalization (the "(n landen)" collision risk R2 warns about)', () => {
    expect(normalizeRegionName(EUROSTAT_GEO_NAMES_NL.EA!.display)).not.toBe(
      normalizeRegionName(EUROSTAT_GEO_NAMES_NL.EA19!.display),
    );
    expect(normalizeRegionName(EUROSTAT_GEO_NAMES_NL.EA19!.display)).not.toBe(
      normalizeRegionName(EUROSTAT_GEO_NAMES_NL.EA20!.display),
    );
    // EA/EA19 must carry NO bare "eurozone" alias (only EA20 may), or the
    // line above would be defeated by the alias list instead of the display.
    for (const code of ['EA', 'EA19'] as const) {
      for (const alias of EUROSTAT_GEO_NAMES_NL[code]!.aliases) {
        expect(normalizeRegionName(alias)).not.toBe('eurozone');
        expect(normalizeRegionName(alias)).not.toBe('de eurozone');
      }
    }
  });
});

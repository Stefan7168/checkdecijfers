import { describe, expect, it } from 'vitest';
import { adapterFor } from '../../src/sources/adapters.ts';
import { ODataV4Source } from '../../src/cbs-adapter/odata-v4.ts';
import { StatisticsApiSource } from '../../src/eurostat-adapter/statistics-api.ts';

// WP30c/E1 (ADR 048 D1, Done-definition item 2): the `adapterFor` line the
// how-to-add-a-source guide's Step 5 requires. Constraint 0 means nothing in
// E1 actually calls this factory with a real question — this test only
// proves the routing exists and throws loud on typos, per ADR 030 D5's
// fail-direction (FETCH seams throw, never silently fall back to CBS).
describe('adapterFor — eurostat routing (WP30c/E1)', () => {
  it('routes "eurostat" to a real StatisticsApiSource instance', () => {
    expect(adapterFor('eurostat')).toBeInstanceOf(StatisticsApiSource);
  });

  it('still routes "cbs" to ODataV4Source (unchanged)', () => {
    expect(adapterFor('cbs')).toBeInstanceOf(ODataV4Source);
  });

  it('throws loud on an unregistered key, never silently falling back to cbs', () => {
    expect(() => adapterFor('bogus')).toThrow(/No adapter is registered for source 'bogus'/);
  });
});

// ADR 058 (English answers, Task 3): the literal tables in english-names.data.ts
// are filled from CBS's own English (ENG) sibling tables where one exists
// (scripts/english-names-fetch.ts), and by hand — reading the Dutch table's
// own definition text — where CBS publishes no English sibling. This test is
// the bar Task 3 was built against: every registered CBS canonical measure
// has an English title, no entry ever fabricates or changes a digit, and
// CURATED tracks only hand-written entries that really exist in the maps it
// covers (measure/table titles — the only two categories this test, and the
// consumers that read CURATED, look at).
//
// Restricted to CBS tables only (sourceKeyForTableId/resolveSourceForTable,
// src/sources/registry.ts): a future Eurostat canonical measure's
// `measureTitle` is Eurostat's own English label already (ADR 048), not a
// Dutch string this list translates, so it is out of scope for this table —
// same reasoning as this task's binding context from Task 2.
import { describe, expect, it } from 'vitest';
import { CANONICAL_MEASURES } from '../../src/registry/defaults.ts';
import { sourceKeyForTableId, CBS_SOURCE_KEY } from '../../src/sources/registry.ts';
import { CURATED, MEASURE_TITLES, TABLE_TITLES } from '../../src/registry/english-names.data.ts';

const cbsMeasures = CANONICAL_MEASURES.filter((m) => sourceKeyForTableId(m.tableId) === CBS_SOURCE_KEY);

describe('english-names data', () => {
  it('has an English title for every registered CBS canonical measure', () => {
    const missing = cbsMeasures.map((m) => m.measureTitle).filter((t) => t && !(t in MEASURE_TITLES));
    expect(missing).toEqual([]);
  });

  it('never maps to an empty string or a digit-changed string', () => {
    for (const [nl, en] of Object.entries({ ...MEASURE_TITLES, ...TABLE_TITLES })) {
      expect(en.trim().length).toBeGreaterThan(0);
      expect((en.match(/\d+/g) ?? []).join()).toBe((nl.match(/\d+/g) ?? []).join());
    }
  });

  it('marks curated entries only for labels that exist in the maps', () => {
    for (const nl of CURATED) expect(nl in MEASURE_TITLES || nl in TABLE_TITLES).toBe(true);
  });
});

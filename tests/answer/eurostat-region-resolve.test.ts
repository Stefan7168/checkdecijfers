// Eurostat E2a Task 1, Steps 5-9: source-aware region resolution on a
// `eurostat:` table. Hermetic (createTestDb + insertEurostatTestTable, NOT
// the full CBS ingest fixture intent-resolve.test.ts uses) because this
// exercises only the resolver's new source-aware branch, not the CBS
// fixture data. See docs/superpowers/specs/2026-09-23-eurostat-e2a-
// country-answers-design.md §4.3 for the design this pins.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb } from '../helpers/pglite-db.ts';
import {
  EUROSTAT_TEST_CANONICAL_KEY,
  EUROSTAT_TEST_TABLE_ID,
  insertEurostatTestTable,
} from '../helpers/eurostat-test-table.ts';
import {
  isResolutionFailure,
  resolveCandidate,
} from '../../src/answer/intent/index.ts';
import type { PeriodSpec, RawCandidate, RegionTerm } from '../../src/answer/intent/index.ts';
import { runQuery } from '../../src/query/index.ts';
import type { Db } from '../../src/db/types.ts';

const REFERENCE_DATE = '2021-06-15';
const YEAR: PeriodSpec = { kind: 'year', year: 2021 };

function raw(regions: RegionTerm[] | null): RawCandidate {
  return {
    canonicalKey: EUROSTAT_TEST_CANONICAL_KEY,
    regions,
    period: YEAR,
    derivation: 'none',
    confidence: 0.9,
    reading: 'test',
  };
}

describe('source-aware region resolution on a Eurostat table', () => {
  let db: Db;
  let close: () => Promise<void>;

  beforeEach(async () => {
    ({ db, close } = await createTestDb());
    await insertEurostatTestTable(db);
  });
  afterEach(async () => {
    await close();
  });

  it('a Dutch country name with kind "land" resolves — the CBS "NL" prefix filter no longer applies', async () => {
    const result = await resolveCandidate(db, raw([{ name: 'Duitsland', kind: 'land' }]), REFERENCE_DATE);
    expect(isResolutionFailure(result)).toBe(false);
    if (isResolutionFailure(result)) throw new Error('unreachable');
    expect(result.intent.regions).toEqual(['DE']);
  });

  it('several Dutch names, mixed kind, resolve in order', async () => {
    const result = await resolveCandidate(
      db,
      raw([
        { name: 'Duitsland', kind: 'onbekend' },
        { name: 'Nederland', kind: 'land' },
      ]),
      REFERENCE_DATE,
    );
    expect(isResolutionFailure(result)).toBe(false);
    if (isResolutionFailure(result)) throw new Error('unreachable');
    expect(result.intent.regions).toEqual(['DE', 'NL']);
  });

  it('the table\'s own English label still resolves (the Dutch list is additive, not a replacement)', async () => {
    const result = await resolveCandidate(db, raw([{ name: 'Germany', kind: 'onbekend' }]), REFERENCE_DATE);
    expect(isResolutionFailure(result)).toBe(false);
    if (isResolutionFailure(result)) throw new Error('unreachable');
    expect(result.intent.regions).toEqual(['DE']);
  });

  it('a country outside the licence-exception list fails honestly as region_unknown', async () => {
    const result = await resolveCandidate(db, raw([{ name: 'Japan', kind: 'land' }]), REFERENCE_DATE);
    expect(isResolutionFailure(result)).toBe(true);
    if (!isResolutionFailure(result)) throw new Error('unreachable');
    expect(result.reason).toBe('region_unknown');
  });

  // Step 8: display uses the Dutch name, never the table's own English label.
  it('a Eurostat result cell for DE carries the Dutch display name "Duitsland", not "Germany"', async () => {
    const result = await resolveCandidate(db, raw([{ name: 'Duitsland', kind: 'land' }]), REFERENCE_DATE);
    expect(isResolutionFailure(result)).toBe(false);
    if (isResolutionFailure(result)) throw new Error('unreachable');
    const outcome = await runQuery(db, result.intent);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error('unreachable');
    expect(outcome.cells).toHaveLength(1);
    expect(outcome.cells[0]!.regionCode).toBe('DE');
    expect(outcome.cells[0]!.regionLabel).toBe('Duitsland');
  });

  it('the Eurostat table id is sanity-checked (guards against a future rename of the shared helper)', () => {
    expect(EUROSTAT_TEST_TABLE_ID).toBe('eurostat:e2a_test_unemp');
  });
});

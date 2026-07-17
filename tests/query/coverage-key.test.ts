// Coverage-sprint verification tasks (docs/05-data-rules.md table-onboarding
// rule): a curated table added outside the frozen Phase-0 benchmark ships with
// 2-3 frozen-key benchmark-style tasks. These are those tasks for 83693NED
// (coverage table #1, docs/11-coverage-table-set.md) — hand-authored intents
// over the deterministic query layer, hermetic (PGlite + committed fixtures,
// ADR 009), mirroring tests/query/benchmark-intents.test.ts.
//
// Honesty rule (inherited from that suite verbatim): every expected value here
// is READ FROM benchmark/coverage-key.json — whose values were independently
// re-queried from BOTH live CBS platforms (v3 + v4) on the freeze date.
// Nothing numeric is hardcoded here, and keys are never edited to green.
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runQuery } from '../../src/query/index.ts';
import type { QueryOutcome, StructuredIntent, ValidatedResult } from '../../src/query/index.ts';
import type { Db } from '../../src/db/types.ts';
import { createIngestedDb } from '../helpers/ingested-db.ts';

const coverageKey = JSON.parse(
  readFileSync(new URL('../../benchmark/coverage-key.json', import.meta.url), 'utf8'),
) as {
  pinnedTo: { tables: Record<string, { title: string }> };
  tasks: Record<string, any>;
};

// Hand-authored structured intents, one per coverage verification task —
// written from the coverage-key question phrasings, the same discipline as
// tests/helpers/benchmark-intents.ts.
const INTENTS: Record<string, StructuredIntent> = {
  CC1: {
    schemaVersion: 1,
    target: { kind: 'canonical', key: 'consumer_confidence_seasonally_adjusted' },
    period: { kind: 'codes', codes: ['2026MM06'] },
    derivation: 'none',
  },
  CC2: {
    schemaVersion: 1,
    target: { kind: 'canonical', key: 'consumer_confidence_seasonally_adjusted' },
    period: { kind: 'codes', codes: ['2013MM02'] },
    derivation: 'none',
  },
  CC3: {
    schemaVersion: 1,
    target: { kind: 'canonical', key: 'willingness_to_buy_seasonally_adjusted' },
    period: { kind: 'codes', codes: ['2026MM06'] },
    derivation: 'none',
  },
  CC4: {
    schemaVersion: 1,
    target: { kind: 'canonical', key: 'consumer_confidence_seasonally_adjusted' },
    period: { kind: 'codes', codes: ['2025JJ00'] },
    derivation: 'none',
  },
  // Table #2 (85880NED, session 50 — full ingest per the owner decision).
  CC5: {
    schemaVersion: 1,
    target: { kind: 'canonical', key: 'gdp_growth_yoy_volume' },
    period: { kind: 'codes', codes: ['2026KW01'] },
    derivation: 'none',
  },
  CC6: {
    schemaVersion: 1,
    target: { kind: 'canonical', key: 'gdp_growth_yoy_volume' },
    period: { kind: 'codes', codes: ['2023KW04'] },
    derivation: 'none',
  },
  CC7: {
    schemaVersion: 1,
    target: { kind: 'canonical', key: 'gdp_growth_qoq_volume' },
    period: { kind: 'codes', codes: ['2026KW01'] },
    derivation: 'none',
  },
  // Table #3 (85770NED): frozen in the session-49 overnight prep with EXPLICIT
  // targets; re-pointed at the canonical keys in the session-50 vocab batch
  // (#164 — one vocab change + one fixture re-record). Frozen values unchanged.
  CC8: {
    schemaVersion: 1,
    target: { kind: 'canonical', key: 'producer_prices_yoy' },
    period: { kind: 'codes', codes: ['2026MM05'] },
    derivation: 'none',
  },
  CC9: {
    schemaVersion: 1,
    target: { kind: 'canonical', key: 'producer_prices_yoy' },
    period: { kind: 'codes', codes: ['2023MM06'] },
    derivation: 'none',
  },
  CC10: {
    schemaVersion: 1,
    target: { kind: 'canonical', key: 'import_prices_yoy' },
    period: { kind: 'codes', codes: ['2026MM05'] },
    derivation: 'none',
  },
  // Tables #4-#9 (session-53 prep, 2026-07-17): EXPLICIT targets, the same
  // #164 batch discipline as the session-49 overnight prep for table #3 —
  // canonical vocabulary for all six tables lands in ONE staged vocab batch
  // (owner-present re-record; see the staged-vocab session brief). Re-point at
  // canonical keys when that batch lands; the frozen values stay the same.
  // Table #4 (85828NED omzet detailhandel).
  CC11: {
    schemaVersion: 1,
    target: {
      kind: 'explicit',
      tableId: '85828NED',
      measure: 'A042501_2',
      dims: { BedrijfstakkenBranchesSBI2008: '371600' },
    },
    period: { kind: 'codes', codes: ['2026MM05'] },
    derivation: 'none',
  },
  CC12: {
    schemaVersion: 1,
    target: {
      kind: 'explicit',
      tableId: '85828NED',
      measure: 'A042501_2',
      dims: { BedrijfstakkenBranchesSBI2008: '371700' },
    },
    period: { kind: 'codes', codes: ['2026MM05'] },
    derivation: 'none',
  },
  CC13: {
    schemaVersion: 1,
    target: {
      kind: 'explicit',
      tableId: '85828NED',
      measure: 'A042501_1',
      dims: { BedrijfstakkenBranchesSBI2008: '371600' },
    },
    period: { kind: 'codes', codes: ['2025JJ00'] },
    derivation: 'none',
  },
  // Table #5 (85937NED consumptie huishoudens).
  CC14: {
    schemaVersion: 1,
    target: {
      kind: 'explicit',
      tableId: '85937NED',
      measure: 'M005269',
      dims: { ConsumptieveBestedingen: 'A047812' },
    },
    period: { kind: 'codes', codes: ['2025MM12'] },
    derivation: 'none',
  },
  CC15: {
    schemaVersion: 1,
    target: {
      kind: 'explicit',
      tableId: '85937NED',
      measure: 'M005269',
      dims: { ConsumptieveBestedingen: 'A047825' },
    },
    period: { kind: 'codes', codes: ['2025KW04'] },
    derivation: 'none',
  },
  CC16: {
    schemaVersion: 1,
    target: {
      kind: 'explicit',
      tableId: '85937NED',
      measure: 'M005269',
      dims: { ConsumptieveBestedingen: 'A047812' },
    },
    period: { kind: 'codes', codes: ['2026MM05'] },
    derivation: 'none',
  },
  CC17: {
    schemaVersion: 1,
    target: {
      kind: 'explicit',
      tableId: '85937NED',
      measure: 'M005269',
      dims: { ConsumptieveBestedingen: 'A047812' },
    },
    period: { kind: 'codes', codes: ['2020MM04'] },
    derivation: 'none',
  },
  // Table #6 (85429NED internationale goederenhandel, totals slice).
  CC18: {
    schemaVersion: 1,
    target: {
      kind: 'explicit',
      tableId: '85429NED',
      measure: 'D001607',
      dims: { Landen: 'T001047', SITC: 'T001082' },
    },
    period: { kind: 'codes', codes: ['2026MM04'] },
    derivation: 'none',
  },
  CC19: {
    schemaVersion: 1,
    target: {
      kind: 'explicit',
      tableId: '85429NED',
      measure: 'M001608',
      dims: { Landen: 'T001047', SITC: 'T001082' },
    },
    period: { kind: 'codes', codes: ['2026MM04'] },
    derivation: 'none',
  },
  CC20: {
    schemaVersion: 1,
    target: {
      kind: 'explicit',
      tableId: '85429NED',
      measure: 'D001607',
      dims: { Landen: 'T001047', SITC: 'T001082' },
    },
    period: { kind: 'codes', codes: ['2015MM01'] },
    derivation: 'none',
  },
  CC21: {
    schemaVersion: 1,
    target: {
      kind: 'explicit',
      tableId: '85429NED',
      measure: 'M001609',
      dims: { Landen: 'T001047', SITC: 'T001082' },
    },
    period: { kind: 'codes', codes: ['2021JJ00'] },
    derivation: 'none',
  },
  // Table #7 (85792NED huizenprijzen regio — RegioS is a PLAIN dimension, not
  // GeoDimension; regions go through dims, never the regions field).
  CC22: {
    schemaVersion: 1,
    target: {
      kind: 'explicit',
      tableId: '85792NED',
      measure: 'M001505_2',
      dims: { RegioS: 'NL01' },
    },
    period: { kind: 'codes', codes: ['2026KW01'] },
    derivation: 'none',
  },
  CC23: {
    schemaVersion: 1,
    target: {
      kind: 'explicit',
      tableId: '85792NED',
      measure: 'M001534',
      dims: { RegioS: 'GM0363' },
    },
    period: { kind: 'codes', codes: ['2025KW04'] },
    derivation: 'none',
  },
  CC24: {
    schemaVersion: 1,
    target: {
      kind: 'explicit',
      tableId: '85792NED',
      measure: 'M001532_2',
      dims: { RegioS: 'PV28' },
    },
    period: { kind: 'codes', codes: ['2020JJ00'] },
    derivation: 'none',
  },
  // Table #8 (80590ned werkloosheid per maand — lowercase id, totals slice).
  CC25: {
    schemaVersion: 1,
    target: {
      kind: 'explicit',
      tableId: '80590ned',
      measure: 'M004210',
      dims: { Geslacht: 'T001038', Leeftijd: '52052' },
    },
    period: { kind: 'codes', codes: ['2026MM06'] },
    derivation: 'none',
  },
  CC26: {
    schemaVersion: 1,
    target: {
      kind: 'explicit',
      tableId: '80590ned',
      measure: 'M001906_2',
      dims: { Geslacht: 'T001038', Leeftijd: '52052' },
    },
    period: { kind: 'codes', codes: ['2025JJ00'] },
    derivation: 'none',
  },
  CC27: {
    schemaVersion: 1,
    target: {
      kind: 'explicit',
      tableId: '80590ned',
      measure: 'M004210',
      dims: { Geslacht: 'T001038', Leeftijd: '52052' },
    },
    period: { kind: 'codes', codes: ['2014MM02'] },
    derivation: 'none',
  },
  CC28: {
    schemaVersion: 1,
    target: {
      kind: 'explicit',
      tableId: '80590ned',
      measure: 'M004210',
      dims: { Geslacht: 'T001038', Leeftijd: '52052' },
    },
    period: { kind: 'codes', codes: ['2025JJ00'] },
    derivation: 'none',
  },
  // Table #9 (83625NED verkoopprijzen per gemeente — RegioS IS a GeoDimension
  // here: regions travel through the intent's regions field, the 03759ned way).
  CC29: {
    schemaVersion: 1,
    target: { kind: 'explicit', tableId: '83625NED', measure: 'M001534' },
    regions: ['NL01'],
    period: { kind: 'codes', codes: ['2025JJ00'] },
    derivation: 'none',
  },
  CC30: {
    schemaVersion: 1,
    target: { kind: 'explicit', tableId: '83625NED', measure: 'M001534' },
    regions: ['GM0363'],
    period: { kind: 'codes', codes: ['2025JJ00'] },
    derivation: 'none',
  },
  CC31: {
    schemaVersion: 1,
    target: { kind: 'explicit', tableId: '83625NED', measure: 'M001534' },
    regions: ['GM0363'],
    period: { kind: 'codes', codes: ['2015JJ00'] },
    derivation: 'none',
  },
};

let db: Db;
let close: () => Promise<void>;
const outcomes: Record<string, QueryOutcome> = {};

beforeAll(async () => {
  ({ db, close } = await createIngestedDb());
  for (const [taskId, intent] of Object.entries(INTENTS)) {
    outcomes[taskId] = await runQuery(db, intent);
  }
}, 300_000);

afterAll(async () => {
  await close();
});

function asResult(taskId: string): ValidatedResult {
  const outcome = outcomes[taskId]!;
  if (!outcome.ok) {
    throw new Error(`${taskId} refused (${outcome.refusal.kind}): ${outcome.refusal.message}`);
  }
  return outcome;
}

/** Baseline checks mirroring benchmark-intents.test.ts checkBaseline:
 * attribution (R4), traceability (R1), unit metadata (R10). */
function checkBaseline(taskId: string, result: ValidatedResult): void {
  const key = coverageKey.tasks[taskId]!;
  expect(result.attribution.tableId).toBe(key.table);
  expect(result.attribution.tableTitle).toBe(coverageKey.pinnedTo.tables[key.table]!.title);
  expect(result.attribution.tableVersion).toBeGreaterThanOrEqual(1);
  expect(result.attribution.syncedAt).toBeTruthy();
  expect(result.attribution.license).toBe('CC BY 4.0');
  const ids = result.cells.map((c) => c.resultId);
  expect(new Set(ids).size).toBe(ids.length);
  for (const cell of result.cells) expect(cell.unit).toBe(key.unit);
}

describe('coverage verification tasks against the frozen coverage key (tables #1-#9: 83693NED, 85880NED, 85770NED, 85828NED, 85937NED, 85429NED, 85792NED, 80590ned, 83625NED)', () => {
  for (const taskId of [
    'CC1', 'CC2', 'CC3', 'CC5', 'CC6', 'CC7', 'CC8', 'CC9', 'CC10',
    'CC11', 'CC12', 'CC13', 'CC14', 'CC15', 'CC16', 'CC17', 'CC18', 'CC19', 'CC20',
    'CC22', 'CC23', 'CC24', 'CC25', 'CC26', 'CC27', 'CC29', 'CC30', 'CC31',
  ] as const) {
    it(`${taskId}: single frozen-key cell reproduces exactly`, () => {
      const key = coverageKey.tasks[taskId]!;
      const result = asResult(taskId);
      checkBaseline(taskId, result);
      expect(result.cells).toHaveLength(1);
      const cell = result.cells[0]!;
      expect(cell.value).toBe(key.value);
      expect(cell.measure).toBe(key.measure);
      expect(cell.periodCode).toBe(key.period);
      expect(cell.status).toBe(key.status);
      expect(cell.decimals).toBe(key.decimals);
      expect(cell.valueAttribute).toBe(key.valueAttribute);
      // Geo-dimension tasks (table #9) pin the region binding too.
      if (key.region) expect(cell.regionCode).toBe(key.region);
    });
  }

  for (const taskId of ['CC4', 'CC21'] as const) {
    it(`${taskId}: an unpublished/absent-cell ask refuses value-free (never an averaged/interpolated number)`, () => {
      const key = coverageKey.tasks[taskId]!;
      const outcome = outcomes[taskId]!;
      expect(outcome.ok).toBe(false);
      if (outcome.ok) return;
      expect(outcome.refusal.kind).toBe(key.refusalKind);
      // Value-free refusal: the message must not smuggle in any cell value.
      expect(outcome.refusal.message).not.toMatch(/-?\d+ ?(gemiddelde )?saldo/);
      expect(outcome.refusal.message).not.toMatch(/-?\d+[.,]\d+ ?%/);
      expect(outcome.refusal.message).not.toMatch(/-?\d+ ?mln/);
    });
  }

  for (const taskId of ['CC28'] as const) {
    it(`${taskId}: a CBS-impossible cell serves an honest null with its reason, never a substituted number (R11)`, () => {
      // 80590ned: seasonally-adjusted measures exist on JJ periods as rows
      // whose value is null with ValueAttribute 'Impossible' (no seasonal
      // adjustment exists on year basis — measured 2026-07-17). The honest
      // behavior is serving the null WITH its CBS reason; fabricating or
      // averaging a year figure would be the worst possible bug (principle c).
      const key = coverageKey.tasks[taskId]!;
      const result = asResult(taskId);
      checkBaseline(taskId, result);
      expect(result.cells).toHaveLength(1);
      const cell = result.cells[0]!;
      expect(cell.value).toBeNull();
      expect(cell.valueAttribute).toBe(key.valueAttribute);
      expect(cell.measure).toBe(key.measure);
      expect(cell.periodCode).toBe(key.period);
      expect(cell.status).toBe(key.status);
    });
  }

  it('the three canonical keys resolve to the seasonally adjusted table, never the uncorrected sibling 83694NED', () => {
    for (const taskId of ['CC1', 'CC2', 'CC3'] as const) {
      expect(asResult(taskId).attribution.tableId).toBe('83693NED');
    }
  });
});

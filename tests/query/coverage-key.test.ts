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
  // Table #3 (session-49 overnight prep; CC5-CC7 are RESERVED for the
  // descoped 85880NED — see coverage-key.json pinnedTo note): EXPLICIT
  // targets, because the
  // canonical vocabulary for these tables lands with the session-50 batch
  // (#164 — one vocab change + one fixture re-record per session). Re-point
  // at canonical keys when that batch lands; the frozen values stay the same.
  CC8: {
    schemaVersion: 1,
    target: {
      kind: 'explicit',
      tableId: '85770NED',
      measure: 'M003288',
      dims: { Afzetgebieden: 'A044074', AlleProdComCoderingen: 'A052584' },
    },
    period: { kind: 'codes', codes: ['2026MM05'] },
    derivation: 'none',
  },
  CC9: {
    schemaVersion: 1,
    target: {
      kind: 'explicit',
      tableId: '85770NED',
      measure: 'M003288',
      dims: { Afzetgebieden: 'A044074', AlleProdComCoderingen: 'A052584' },
    },
    period: { kind: 'codes', codes: ['2023MM06'] },
    derivation: 'none',
  },
  CC10: {
    schemaVersion: 1,
    target: {
      kind: 'explicit',
      tableId: '85770NED',
      measure: 'M003288',
      dims: { Afzetgebieden: 'A044077', AlleProdComCoderingen: 'A052584' },
    },
    period: { kind: 'codes', codes: ['2026MM05'] },
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

describe('coverage verification tasks against the frozen coverage key (83693NED + 85770NED)', () => {
  for (const taskId of ['CC1', 'CC2', 'CC3', 'CC8', 'CC9', 'CC10'] as const) {
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
    });
  }

  for (const taskId of ['CC4'] as const) {
    it(`${taskId}: an unpublished-grain ask refuses value-free (never an averaged/interpolated number)`, () => {
      const key = coverageKey.tasks[taskId]!;
      const outcome = outcomes[taskId]!;
      expect(outcome.ok).toBe(false);
      if (outcome.ok) return;
      expect(outcome.refusal.kind).toBe(key.refusalKind);
      // Value-free refusal: the message must not smuggle in any cell value.
      expect(outcome.refusal.message).not.toMatch(/-?\d+ ?(gemiddelde )?saldo/);
      expect(outcome.refusal.message).not.toMatch(/-?\d+[.,]\d+ ?%/);
    });
  }

  it('the three canonical keys resolve to the seasonally adjusted table, never the uncorrected sibling 83694NED', () => {
    for (const taskId of ['CC1', 'CC2', 'CC3'] as const) {
      expect(asResult(taskId).attribution.tableId).toBe('83693NED');
    }
  });
});

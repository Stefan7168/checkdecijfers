// Eurostat E2a Task 3 (spec §4.5, wiring point 3): the answer path must
// thread the result's REAL source through nullReasonText/statusSuffixNl
// instead of always assuming CBS, and the CBS-shaped constants reachable
// from the answer path (NATIONAL_REGION_CODE, isNationalCode) must never
// leak onto a non-CBS table. Hermetic (PGlite), zero LLM spend: every
// end-to-end case below runs `templateOnly` through a throwing stub client
// (same pattern as tests/answer/eurostat-explorer-wiring.test.ts and
// web/lib/eurostat-explorer.ts's own NeverCallAnswerClient) — a real reach
// for the LLM client would be a bug this test wants to fail loudly on, not
// silently spend real money.
import { describe, expect, it } from 'vitest';
import type { Db } from '../../src/db/types.ts';
import { createTestDb } from '../helpers/pglite-db.ts';
import {
  EUROSTAT_TEST_CANONICAL_KEY,
  EUROSTAT_TEST_MEASURE,
  EUROSTAT_TEST_TABLE_ID,
  insertEurostatTestTable,
} from '../helpers/eurostat-test-table.ts';
import { nullReasonText } from '../../src/answer/compose/template.ts';
import { statusSuffixNl } from '../../src/answer/respond/refusals.ts';
import { respondToIntent } from '../../src/answer/respond/respond.ts';
import { buildSuggestions } from '../../src/answer/respond/suggestions.ts';
import type { LlmClient, LlmResponse } from '../../src/answer/llm/client.ts';
import { RAW_PARSE_VERSION } from '../../src/answer/intent/types.ts';
import type { ParseOutcome } from '../../src/answer/intent/types.ts';
import { echoServability, runQuery, INTENT_SCHEMA_VERSION } from '../../src/query/index.ts';
import type { StructuredIntent, ValidatedResult } from '../../src/query/index.ts';
import { SOURCES } from '../../src/sources/registry.ts';

/** D5c pattern: never actually invoked — templateOnly makes composeAnswer's
 * LLM rung unreachable, so a real call here is a bug, not a fallback. */
class NeverCallAnswerClient implements LlmClient {
  complete(): Promise<LlmResponse> {
    throw new Error('eurostat-answer-wording: composeAnswer tried to call an LLM client (templateOnly should have made this unreachable)');
  }
}

/** Adversarial fixture shared by the two CBS-only-constant tests below:
 * hand-inserts an 'NL01' row + its label directly onto the (already
 * hand-inserted) Eurostat test table — a coincidental collision with CBS's
 * national code, which real Eurostat data would never actually produce
 * (Eurostat's own Dutch country code is bare 'NL'). Without each guard this
 * task adds, the CBS-shaped machinery would find this row perfectly
 * servable and use it; the guard must reject it on the table's SOURCE alone,
 * never on whether 'NL01' happens to resolve. */
async function insertNl01Collision(db: Db): Promise<void> {
  await db.query(`insert into dimension_labels (table_id, dimension, code, label) values ($1, 'geo', 'NL01', $2)`, [
    EUROSTAT_TEST_TABLE_ID,
    'Collision test region',
  ]);
  const {
    rows: [batch],
  } = await db.query(
    `insert into ingestion_batches (table_id, finished_at, outcome, row_count)
     values ($1, now(), 'succeeded', 1) returning id`,
    [EUROSTAT_TEST_TABLE_ID],
  );
  const batchId = (batch as { id: number }).id;
  await db.query(
    `insert into observations
       (table_id, measure, region_code, period_code, period_grain, period_year, dims, value, unit, decimals, status, value_attribute, batch_id)
     values ($1, $2, 'NL01', '2020JJ00', 'JJ', 2020, '{}'::jsonb, 999, 'Percentage', 1, 'Published', 'None', $3)`,
    [EUROSTAT_TEST_TABLE_ID, EUROSTAT_TEST_MEASURE, batchId],
  );
}

/** A minimal 'intent' ParseOutcome — respondToIntent only reads
 * .intent/.impliedRecency/.question off it (the same minimal-stub contract
 * tests/answer/respond-staleness.test.ts's stubIntentOutcome documents). */
function buildParseOutcome(question: string, intent: StructuredIntent): Extract<ParseOutcome, { kind: 'intent' }> {
  return {
    kind: 'intent',
    question,
    raw: {
      version: RAW_PARSE_VERSION,
      kind: 'data_query',
      candidates: [],
      unmatchedMeasureTerm: null,
      nearestCanonicalKeys: [],
      note: null,
    },
    model: 'none (test stub)',
    usage: { inputTokens: 0, outputTokens: 0 },
    intent,
    confidence: 1,
    impliedRecency: false,
    ranked: [],
  };
}

describe('statusSuffixNl — source-aware (E2a wiring point 3)', () => {
  it('resolves the EUROSTAT wording for a Eurostat-only status flag, from SOURCES.eurostat.provisionalDisplay', () => {
    expect(statusSuffixNl('p', 'eurostat')).toBe(SOURCES.eurostat!.provisionalDisplay.p);
    expect(SOURCES.eurostat!.provisionalDisplay.p).toBe(' (voorlopig cijfer)');
  });

  it('keeps resolving CBS wording when no sourceKey is passed (existing callers unchanged)', () => {
    expect(statusSuffixNl('Voorlopig')).toBe(SOURCES.cbs!.provisionalDisplay.Voorlopig);
    expect(statusSuffixNl('Voorlopig')).toBe(' (voorlopig cijfer)');
  });

  it("a status unknown to the given source resolves empty, never the other source's wording", () => {
    // 'Voorlopig' is a CBS status; it is not a key in Eurostat's map.
    expect(statusSuffixNl('Voorlopig', 'eurostat')).toBe('');
  });
});

describe('nullReasonText — source-aware (E2a wiring point 3)', () => {
  it("resolves Eurostat's own null-reason label for its ':' (not available) flag", () => {
    expect(nullReasonText(':', 'eurostat')).toBe(SOURCES.eurostat!.nullReasonLabels[':']);
    expect(nullReasonText(':', 'eurostat')).toBe('door Eurostat (nog) niet beschikbaar gesteld');
  });

  it('keeps resolving CBS wording when no sourceKey is passed', () => {
    expect(nullReasonText('Confidential')).toBe(SOURCES.cbs!.nullReasonLabels.Confidential);
  });

  it('an attribute unknown to a source names the source, never guesses a shared meaning', () => {
    // ':' means something specific to Eurostat but is not a CBS-registered attribute.
    expect(nullReasonText(':')).toBe("door CBS gemarkeerd als ':'");
  });
});

describe('end-to-end answer over a hand-inserted Eurostat table (real source, real wording)', () => {
  let db: Db;
  let close: () => Promise<void>;

  async function setUp(): Promise<{ db: Db; close: () => Promise<void> }> {
    const handle = await createTestDb();
    // 'e' (schatting) is deliberately NOT the flag used elsewhere in this
    // slice's fixtures: Eurostat's wording for 'p' (' (voorlopig cijfer)')
    // is byte-identical to CBS's pre-WP30a GENERIC fallback, so a 'p' cell
    // would render correctly even with the bug this task fixes (Wiring
    // point 3's old `resolveSource(undefined)`) — a false negative. 'e'
    // maps to Eurostat's OWN, distinctive ' (schatting)' wording, which the
    // CBS-default bug would never produce.
    await insertEurostatTestTable(handle.db, { statusOverrides: { 'DE|2020': 'e' } });
    return handle;
  }

  it("renders Eurostat's own provisional wording for a flagged cell — not CBS's generic fallback, not none", async () => {
    ({ db, close } = await setUp());
    try {
      const intent: StructuredIntent = {
        schemaVersion: INTENT_SCHEMA_VERSION,
        target: { kind: 'canonical', key: EUROSTAT_TEST_CANONICAL_KEY },
        regions: ['DE'],
        period: { kind: 'codes', codes: ['2020JJ00'] },
        derivation: 'none',
      };
      const question = '[test] eurostat provisional wording';
      const parse = buildParseOutcome(question, intent);
      const response = await respondToIntent(db, question, parse, {
        answerClient: new NeverCallAnswerClient(),
        referenceDate: '2026-09-23',
        templateOnly: true,
      });

      expect(response.kind).toBe('answer');
      if (response.kind !== 'answer') return;
      expect(response.answer.body).toContain(SOURCES.eurostat!.provisionalDisplay.e);
      expect(response.answer.body).toContain(' (schatting)');
      // The pre-fix bug: template.ts's provisionalSuffix always resolved
      // CBS, whose provisionalDisplay has no 'e' key, so it fell back to
      // the generic ' (voorlopig cijfer)' — the wrong wording this proves
      // is gone.
      expect(response.answer.body).not.toContain(' (voorlopig cijfer)');
      expect(response.answer.model).toBeNull(); // real templateOnly floor, zero LLM spend
    } finally {
      await close();
    }
  });
});

describe('NATIONAL_REGION_CODE default is CBS-only (E2a spec §4.5)', () => {
  let db: Db;
  let close: () => Promise<void>;

  it('a Eurostat intent with no region refuses/clarifies — NL01 is never queried, even when an NL01 row exists on that table', async () => {
    ({ db, close } = await createTestDb());
    try {
      await insertEurostatTestTable(db);
      // Without the source guard, resolve.ts's WP26 mechanism B-region
      // default would find this row, label it, and silently serve it as
      // "the national figure" for a source that has no such concept — the
      // exact fabrication principle (c) forbids. With the guard, the
      // national-default block is never even attempted for a non-CBS table,
      // regardless of what happens to live at 'NL01'.
      await insertNl01Collision(db);

      const intent: StructuredIntent = {
        schemaVersion: INTENT_SCHEMA_VERSION,
        target: { kind: 'explicit', tableId: EUROSTAT_TEST_TABLE_ID, measure: EUROSTAT_TEST_MEASURE },
        period: { kind: 'codes', codes: ['2020JJ00'] },
        derivation: 'none',
      };
      const outcome = await runQuery(db, intent, { answerFirstEnabled: true });

      expect(outcome.ok).toBe(false);
      if (outcome.ok) return;
      expect(outcome.refusal.kind).toBe('needs_clarification');
      expect(outcome.refusal.axis).toBe('region');
    } finally {
      await close();
    }
  });
});

describe('national-comparison suggestion chips are CBS-only (E2a spec §4.5)', () => {
  let db: Db;
  let close: () => Promise<void>;

  it('a Eurostat answer for DE offers no "Vergelijk met Nederland" / national-figure chip built against NL01', async () => {
    ({ db, close } = await createTestDb());
    try {
      await insertEurostatTestTable(db);
      // Same adversarial NL01 collision as the region-default test above: a
      // servable 'NL01' row on this Eurostat table would otherwise make
      // compareRegion's dry-run genuinely succeed (a false negative for this
      // test without it) — the guard must reject the candidate on the
      // table's source, not rely on the dry-run happening to fail.
      await insertNl01Collision(db);
      const intent: StructuredIntent = {
        schemaVersion: INTENT_SCHEMA_VERSION,
        target: { kind: 'canonical', key: EUROSTAT_TEST_CANONICAL_KEY },
        regions: ['DE'],
        period: { kind: 'codes', codes: ['2020JJ00'] },
        derivation: 'none',
      };
      const outcome = await runQuery(db, intent);
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      const result: ValidatedResult = outcome;

      const chips = await buildSuggestions(intent, result, (candidate) => echoServability(db, candidate));

      expect(chips.some((c) => c.includes('Nederland'))).toBe(false);
      expect(chips.some((c) => c.toLowerCase().includes('vergelijk'))).toBe(false);
    } finally {
      await close();
    }
  });
});

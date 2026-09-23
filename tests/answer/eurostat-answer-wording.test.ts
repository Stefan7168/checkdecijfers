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
import { baseRegionLabel, validateAnswerBody } from '../../src/answer/compose/validate.ts';
import { dutchDisplayNameForGeo } from '../../src/sources/eurostat-geo-names.ts';

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
      // Fix wave I2: the right wording must also pass R11 (it used to fail it).
      expect(response.answer.validation.ok).toBe(true);
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

// E2a final-review fix wave (I2): R11's provisional-marking check is
// source-aware. Before the fix it demanded the word 'voorlopig' for every
// flagged cell, while the template (Task 3) correctly renders Eurostat's own
// marking — so every templated Eurostat answer with an 'e'/'b'/… cell failed
// its own validator (served under #121 serve+alert, audit:verify red).
describe('R11 validator accepts each source its own marking (fix wave I2)', () => {
  // One flag per region, one table: p (voorlopig), e (schatting), b
  // (methodebreuk), and a COMBINED 'bp' — no registered marking, so the
  // template renders the generic ' (voorlopig cijfer)' and R11 wants
  // 'voorlopig', matching it.
  const FLAGS: Record<string, string> = { DE: 'p', BE: 'e', NL: 'b', EU27_2020: 'bp' };
  const EXPECTED_MARKING: Record<string, string> = {
    DE: ' (voorlopig cijfer)',
    BE: ' (schatting)',
    NL: ' (methodebreuk)',
    EU27_2020: ' (voorlopig cijfer)',
  };

  async function answerFor(db: Db, region: string) {
    const intent: StructuredIntent = {
      schemaVersion: INTENT_SCHEMA_VERSION,
      target: { kind: 'canonical', key: EUROSTAT_TEST_CANONICAL_KEY },
      regions: [region],
      period: { kind: 'codes', codes: ['2020JJ00'] },
      derivation: 'none',
    };
    const question = `[test] R11 marking for ${region}`;
    const response = await respondToIntent(db, question, buildParseOutcome(question, intent), {
      answerClient: new NeverCallAnswerClient(),
      referenceDate: '2026-09-23',
      templateOnly: true,
    });
    if (response.kind !== 'answer') throw new Error(`expected an answer for ${region}, got ${response.kind}`);
    return response;
  }

  it('a templated answer passes validation for p, e, b and a combined bp flag, each carrying its own marking', async () => {
    const { db, close } = await createTestDb();
    try {
      await insertEurostatTestTable(db, {
        statusOverrides: Object.fromEntries(Object.entries(FLAGS).map(([region, flag]) => [`${region}|2020`, flag])),
      });
      for (const region of Object.keys(FLAGS)) {
        const response = await answerFor(db, region);
        expect(response.result.cells[0]!.status).toBe(FLAGS[region]);
        expect(response.result.cells[0]!.provisional).toBe(true);
        expect(response.answer.body).toContain(EXPECTED_MARKING[region]);
        expect(response.answer.validation).toEqual({ ok: true, problems: [] });
      }
    } finally {
      await close();
    }
  });

  it("rejects the wrong or a missing marking: 'voorlopig' on an estimate, nothing on a p cell, nothing on a combined flag", async () => {
    const { db, close } = await createTestDb();
    try {
      await insertEurostatTestTable(db, {
        statusOverrides: Object.fromEntries(Object.entries(FLAGS).map(([region, flag]) => [`${region}|2020`, flag])),
      });
      const estimate = await answerFor(db, 'BE');
      const mislabelled = estimate.answer.body.replace(' (schatting)', ' (voorlopig cijfer)');
      const estimateReport = validateAnswerBody(mislabelled, estimate.result);
      expect(estimateReport.ok).toBe(false);
      expect(estimateReport.problems.some((p) => p.startsWith('R11') && p.includes("'schatting'"))).toBe(true);

      const breakCell = await answerFor(db, 'NL');
      const unmarkedBreak = validateAnswerBody(breakCell.answer.body.replace(' (methodebreuk)', ''), breakCell.result);
      expect(unmarkedBreak.problems.some((p) => p.startsWith('R11') && p.includes("'methodebreuk'"))).toBe(true);

      const provisional = await answerFor(db, 'DE');
      const unmarked = validateAnswerBody(provisional.answer.body.replace(' (voorlopig cijfer)', ''), provisional.result);
      expect(unmarked.problems.some((p) => p.startsWith('R11') && p.includes("'voorlopig cijfer'"))).toBe(true);

      const combined = await answerFor(db, 'EU27_2020');
      const unmarkedCombined = validateAnswerBody(combined.answer.body.replace(' (voorlopig cijfer)', ''), combined.result);
      expect(unmarkedCombined.ok).toBe(false);
      expect(unmarkedCombined.problems.some((p) => p.startsWith('R11'))).toBe(true);
    } finally {
      await close();
    }
  });
});

// E2a final-review fix wave (M2): the answer text keeps a Eurostat
// aggregate's composition — "de EU (27 landen)", and EA19/EA20/EA stay
// distinguishable — instead of baseRegionLabel stripping it like a CBS
// "(gemeente)" disambiguator. CBS labels are unaffected.
describe('Eurostat aggregate labels keep their composition in answer text (fix wave M2)', () => {
  it('EA19, EA20 and EA render as three distinct prose labels; a CBS "(gemeente)" suffix is still stripped', () => {
    const labels = ['EA19', 'EA20', 'EA'].map((code) => baseRegionLabel(dutchDisplayNameForGeo(code)!));
    expect(labels).toEqual([
      'de eurozone (19 landen)',
      'de eurozone (20 landen)',
      'het eurogebied (wisselende samenstelling)',
    ]);
    expect(baseRegionLabel('Utrecht (gemeente)')).toBe('Utrecht');
    expect(baseRegionLabel('Utrecht (PV)')).toBe('Utrecht');
  });

  it('a templated EU27_2020 answer names "de EU (27 landen)" and still validates (the 27 is bound to the region label)', async () => {
    const { db, close } = await createTestDb();
    try {
      await insertEurostatTestTable(db);
      const intent: StructuredIntent = {
        schemaVersion: INTENT_SCHEMA_VERSION,
        target: { kind: 'canonical', key: EUROSTAT_TEST_CANONICAL_KEY },
        regions: ['EU27_2020'],
        period: { kind: 'codes', codes: ['2020JJ00'] },
        derivation: 'none',
      };
      const question = '[test] EU27 label';
      const response = await respondToIntent(db, question, buildParseOutcome(question, intent), {
        answerClient: new NeverCallAnswerClient(),
        referenceDate: '2026-09-23',
        templateOnly: true,
      });
      if (response.kind !== 'answer') throw new Error(`expected an answer, got ${response.kind}`);
      expect(response.answer.body).toContain('de EU (27 landen)');
      expect(response.answer.validation).toEqual({ ok: true, problems: [] });
    } finally {
      await close();
    }
  });
});

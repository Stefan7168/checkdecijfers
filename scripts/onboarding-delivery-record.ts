// WP27 stage C — records the delivery-parse fixture for the #124 measurement
// e2e (brief § Stage C tests + § known measurement question). Runs the EXACT
// hermetic job flow the e2e replays (fixture CBS, scripted fit accept for the
// stock table, throwing answer stub → template fallback), except the intent
// client is live+recording: the ONE real LLM call here is the delivery
// re-run's parse of the bijstand question WITH the 18 onboarded 37789ksz
// measures in its vocabulary — the exact prompt whose behavior #124 asks
// about (all 18 tagged with the topic term: does the parse answer, or does
// R7 rule 4 fire a clarification?).
//
// Usage:  npm run onboarding-delivery:record     (ANTHROPIC_API_KEY via .env)
// Spend:  one intent-parse call on the intent model (Haiku tier) — ~cents.
// Output: tests/fixtures/llm/onboarding-delivery/<hash>.json, replayed by the
//         "#124 measurement" e2e in tests/ingestion/onboarding-job.test.ts.
//         Re-record whenever the intent prompt bytes or the 37789ksz fixture
//         vocabulary change (the replay client fails loudly on a hash miss).
//
// The console verdict IS the #124 measurement. If it prints CLARIFIED, that
// finding goes to the owner — do not silently tune vocab registration to
// dodge it (brief's explicit instruction).
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { FixtureSource, loadFixtureDocs } from '../src/cbs-adapter/fixture-source.ts';
import { AnthropicLlmClient, RecordingLlmClient } from '../src/answer/llm/client.ts';
import type { LlmClient, LlmResponse } from '../src/answer/llm/client.ts';
import { reserveOnboardingDebit } from '../src/billing/ledger.ts';
import { applyPricingDefaults } from '../src/billing/pricing-apply.ts';
import { createPendingRequest, getPendingRequest } from '../src/ingestion/onboarding-store.ts';
import { runOnboardingJob } from '../src/ingestion/onboarding.ts';
import { createTestDb } from '../tests/helpers/pglite-db.ts';

const FIXTURES = fileURLToPath(new URL('../tests/fixtures/cbs', import.meta.url));
const RECORD_DIR = fileURLToPath(new URL('../tests/fixtures/llm/onboarding-delivery', import.meta.url));

// Byte-identical to the e2e's constants (tests/ingestion/onboarding-job.test.ts).
const STOCK_TABLE = '37789ksz';
const STOCK_MEASURE = 'D000203_2';
const FLOWS_TABLE = '85615NED';
const BIJSTAND_QUESTION = 'Hoeveel mensen zaten er in 2023 in de bijstand?';
const REFERENCE_DATE = '2026-07-06';

function throwingAnswerClient(): LlmClient {
  return {
    async complete(): Promise<LlmResponse> {
      throw new Error('record script: force template fallback (no answer-LLM spend)');
    },
  };
}

async function main(): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY is not set (run via npm run onboarding-delivery:record, .env)');
    process.exit(1);
  }

  const { db, close } = await createTestDb();
  try {
    await applyPricingDefaults(db);
    const source = new FixtureSource({
      [STOCK_TABLE]: loadFixtureDocs(`${FIXTURES}/${STOCK_TABLE}`),
      [FLOWS_TABLE]: loadFixtureDocs(`${FIXTURES}/${FLOWS_TABLE}`),
    });

    const userId = randomUUID();
    const requestId = randomUUID();
    await db.query('update signup_grant_config set credits = 150');
    await db.query('select public.grant_signup_credits($1)', [userId]);
    const debit = await reserveOnboardingDebit(db, userId, requestId, 100);
    if (debit.kind !== 'debited') throw new Error(`setup: ${debit.kind}`);
    const row = await createPendingRequest(db, {
      userId,
      requestId,
      questionText: BIJSTAND_QUESTION,
      topicTerm: 'bijstand',
      tableId: FLOWS_TABLE,
      finderConfidence: 0.9,
      candidateIds: [FLOWS_TABLE, STOCK_TABLE],
      debitTransactionId: debit.entry.id,
    });

    const summary = await runOnboardingJob({
      db,
      source,
      // Scripted fit: A3 routes past the flows table deterministically; the
      // stock table is accepted without an LLM (the fit gate's own behavior is
      // already pinned hermetically — THIS record measures the DELIVERY parse).
      fit: async (_q, schema) => {
        if (schema.tableId !== STOCK_TABLE) throw new Error(`unexpected fit call for ${schema.tableId}`);
        return { measureCode: STOCK_MEASURE, confidence: 0.95, reading: 'record-script accept' };
      },
      intentClient: new RecordingLlmClient(new AnthropicLlmClient(), RECORD_DIR, () => 'wp27-124-bijstand-delivery-parse'),
      answerClient: throwingAnswerClient(),
      notify: async () => {},
      referenceDate: REFERENCE_DATE,
    });

    const after = await getPendingRequest(db, row.id);
    console.log(`\nrecorded → ${RECORD_DIR}`);
    console.log(`job outcome: ${summary.processed?.outcome ?? 'none'}`);
    console.log(`row status:  ${after?.status}  fit_note: ${JSON.stringify(after ? (await db.query('select fit_note from pending_table_requests where id = $1', [row.id])).rows[0]?.fit_note : null)}`);
    if (summary.processed?.outcome === 'delivered') {
      const audit = await db.query('select final_text from audit_answers where id = $1', [
        after!.deliveryAuditAnswerId,
      ]);
      console.log(`\n#124 MEASUREMENT: ANSWERED — the parse resolved one of the 18 tagged measures.`);
      console.log(`delivered text:\n${audit.rows[0]?.final_text}`);
    } else {
      console.log(`\n#124 MEASUREMENT: DID NOT ANSWER (${after?.failureSummary ?? 'no summary'})`);
      console.log('If this is a clarification (R7 rule 4 on the 18 same-tagged measures): report the');
      console.log('finding to the owner — do NOT silently tune vocab registration to dodge it.');
    }
  } finally {
    await close();
  }
}

await main();

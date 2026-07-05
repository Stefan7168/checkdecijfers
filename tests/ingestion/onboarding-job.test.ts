// The on-demand onboarding JOB, end-to-end and hermetic (WP16 sub-part 2, ADR
// 026, design §3/§7). A FixtureSource replaces live CBS; stub LLM clients
// replace the live model (the intent stub emits the onboarded canonical key;
// the answer stub THROWS, so the compose ladder falls to its deterministic
// template — the delivered numbers therefore come straight from the
// fixture-ingested cells, exactly the "numbers come from the fixture" pin).
//
// The success path proves the whole loop: pending row + fixture CBS → register
// → sync → vocab → a DELIVERED answer whose value is the fixture cell → ledger
// net −100 → row 'delivered'. The failure paths prove every terminal state is
// refunded, never a kept charge and never an escaped exception.
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { FixtureSource, loadFixtureDocs } from '../../src/cbs-adapter/fixture-source.ts';
import type { CbsSource } from '../../src/cbs-adapter/types.ts';
import { getBalance, reserveOnboardingDebit } from '../../src/billing/ledger.ts';
import { applyPricingDefaults } from '../../src/billing/pricing-apply.ts';
import type { LlmClient, LlmResponse } from '../../src/answer/llm/client.ts';
import type { RawParse } from '../../src/answer/intent/types.ts';
import { createPendingRequest, getPendingRequest } from '../../src/ingestion/onboarding-store.ts';
import { onboardedKey } from '../../src/ingestion/onboarding-vocab.ts';
import {
  MAX_ATTEMPTS,
  STALE_RUNNING_MS,
  runOnboardingJob,
  type OnboardingJobDeps,
} from '../../src/ingestion/onboarding.ts';
import type { OnboardingNotifyEvent } from '../../src/ingestion/onboarding-notify.ts';
import type { Db } from '../../src/db/types.ts';
import { createTestDb } from '../helpers/pglite-db.ts';

const FIXTURES = fileURLToPath(new URL('../fixtures/cbs', import.meta.url));

// 82235NED (housing stock): Perioden-only, national — its observations sit at
// dims = {} and region_code = '', the answerable empty-coordinate shape, so an
// auto-onboarded canonical measure resolves cleanly. Measure D002936
// (Beginstand voorraad) for 2024JJ00 = 8204 in the committed fixture.
const TABLE = '82235NED';
const MEASURE = 'D002936';
const EXPECTED_2024_VALUE = 8204;

function fixtureSource(): CbsSource {
  return new FixtureSource(loadFixtureDocs(`${FIXTURES}/${TABLE}`));
}

/** Intent stub: emits a single confident candidate for the onboarded key. The
 * job passes the onboarded measures as extra vocabulary, so this key is legal
 * at schema validation and resolves against the freshly-registered
 * canonical_measures row. */
function intentStub(year: number): LlmClient {
  const raw: RawParse = {
    version: 3,
    kind: 'data_query',
    candidates: [
      {
        canonicalKey: onboardedKey(TABLE, MEASURE),
        regions: null,
        period: { kind: 'year', year },
        derivation: 'none',
        confidence: 0.97,
        reading: `onboarded measure for ${year}`,
      } as never,
    ],
    unmatchedMeasureTerm: null,
    nearestCanonicalKeys: [],
    note: null,
  };
  return {
    async complete(): Promise<LlmResponse> {
      return {
        outputText: JSON.stringify(raw),
        model: 'stub-intent',
        stopReason: 'end_turn',
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    },
  };
}

/** Answer stub that THROWS — the compose ladder then falls to the
 * deterministic template, whose numbers come from the validated cells. */
function throwingAnswerClient(): LlmClient {
  return {
    async complete(): Promise<LlmResponse> {
      throw new Error('stub answer client: force template fallback');
    },
  };
}

/** A CbsSource whose fetchTableSchema throws — the fetch-failure path. */
function throwingSource(): CbsSource {
  const base = fixtureSource();
  return {
    ...base,
    fetchTableSchema: () => Promise.reject(new Error('CBS is down')),
    fetchObservationCount: base.fetchObservationCount.bind(base),
    fetchObservations: base.fetchObservations.bind(base),
    fetchCodeList: base.fetchCodeList.bind(base),
    fetchCatalog: base.fetchCatalog.bind(base),
  };
}

interface Harness {
  db: Db;
  notified: OnboardingNotifyEvent[];
  deps: (over?: Partial<OnboardingJobDeps>) => OnboardingJobDeps;
}

async function harness(source: CbsSource = fixtureSource()): Promise<Harness & { close(): Promise<void> }> {
  const { db, close } = await createTestDb();
  // The refund path reads the 'heavy' onboarding price from action_class_prices
  // (never inlined, ADR 006) — seed it like the real DB, exactly as
  // onboarding-trigger.test.ts does.
  await applyPricingDefaults(db);
  const notified: OnboardingNotifyEvent[] = [];
  const deps = (over: Partial<OnboardingJobDeps> = {}): OnboardingJobDeps => ({
    db,
    source,
    intentClient: intentStub(2024),
    answerClient: throwingAnswerClient(),
    notify: async (e) => void notified.push(e),
    referenceDate: '2026-07-06',
    ...over,
  });
  return { db, notified, deps, close };
}

/** Grants a user 150 credits, debits the 100-credit onboarding cost, and
 * queues a pending row for TABLE — the exact state triggerOnboarding leaves. */
async function queueRequest(
  db: Db,
  question: string,
  topicTerm: string,
): Promise<{ userId: string; requestId: string; pendingId: number; debitId: number }> {
  const userId = randomUUID();
  const requestId = randomUUID();
  await db.query('update signup_grant_config set credits = 150');
  await db.query('select public.grant_signup_credits($1)', [userId]);
  const debit = await reserveOnboardingDebit(db, userId, requestId, 100);
  if (debit.kind !== 'debited') throw new Error(`setup: ${debit.kind}`);
  const row = await createPendingRequest(db, {
    userId,
    requestId,
    questionText: question,
    topicTerm,
    tableId: TABLE,
    finderConfidence: 0.9,
    debitTransactionId: debit.entry.id,
  });
  return { userId, requestId, pendingId: row.id, debitId: debit.entry.id };
}

describe('runOnboardingJob — success (the full delivered path)', () => {
  it('registers, syncs, registers vocab, and DELIVERS an answer from the fixture cell; ledger nets −100', async () => {
    const h = await harness();
    try {
      const { userId, pendingId } = await queueRequest(
        h.db,
        'hoeveel woningen waren er in 2024',
        'woningvoorraad',
      );
      // After the debit the user is at 150 − 100 = 50.
      expect(await getBalance(h.db, userId)).toBe(50);

      const summary = await runOnboardingJob(h.deps());
      expect(summary.processed).toEqual({ id: pendingId, tableId: TABLE, outcome: 'delivered' });

      const row = await getPendingRequest(h.db, pendingId);
      expect(row!.status).toBe('delivered');
      expect(row!.deliveryAuditAnswerId).not.toBeNull();
      expect(row!.finishedAt).not.toBeNull();

      // The delivered answer's number is the fixture cell (8204), and it came
      // through the FULL validated pipeline (audit row written).
      const audit = await h.db.query(
        'select final_text from audit_answers where id = $1',
        [row!.deliveryAuditAnswerId],
      );
      const text = audit.rows[0]!.final_text as string;
      expect(text).toContain(EXPECTED_2024_VALUE.toLocaleString('nl-NL'));

      // Ledger: −100 (onboarding debit), NO compensation on a delivered answer.
      expect(await getBalance(h.db, userId)).toBe(50);
      const compensations = await h.db.query(
        "select count(*)::int as n from credit_transactions where user_id = $1 and reason = 'compensation'",
        [userId],
      );
      expect(Number(compensations.rows[0]!.n)).toBe(0);

      // Delivered notification.
      expect(h.notified).toHaveLength(1);
      expect(h.notified[0]!.outcome).toBe('delivered');
    } finally {
      await h.close();
    }
  });

  it('delivery audit row is tagged source_tag onboarding_delivery', async () => {
    const h = await harness();
    try {
      const { pendingId } = await queueRequest(h.db, 'hoeveel woningen in 2024', 'woningvoorraad');
      await runOnboardingJob(h.deps());
      const row = await getPendingRequest(h.db, pendingId);
      const audit = await h.db.query('select source_tag from audit_answers where id = $1', [
        row!.deliveryAuditAnswerId,
      ]);
      expect(audit.rows[0]!.source_tag).toBe('onboarding_delivery');
    } finally {
      await h.close();
    }
  });
});

describe('runOnboardingJob — failure paths (all terminal + refunded)', () => {
  it('fetch throw → failed + full 100 refund → net 0 → notify failed', async () => {
    const h = await harness(throwingSource());
    try {
      const { userId, pendingId } = await queueRequest(h.db, 'q', 't');
      const summary = await runOnboardingJob(h.deps());
      expect(summary.processed!.outcome).toBe('failed');

      const row = await getPendingRequest(h.db, pendingId);
      expect(row!.status).toBe('failed');
      expect(row!.failureSummary).toContain('Onverwachte fout');

      // 150 grant − 100 debit + 100 refund = 150 net (turn net 0).
      expect(await getBalance(h.db, userId)).toBe(150);
      expect(h.notified[0]!.outcome).toBe('failed');
      expect(h.notified[0]!.refundedCredits).toBe(100);
    } finally {
      await h.close();
    }
  });

  it('unanswerable delivery (intent emits an unknown key → clarify) → refund → net 0', async () => {
    const h = await harness();
    try {
      const { userId, pendingId } = await queueRequest(h.db, 'q', 't');
      // Intent stub that emits an UNMATCHED term (no candidate) → the re-run
      // clarifies, never answers → unanswerable.
      const unmatchedIntent: LlmClient = {
        async complete(): Promise<LlmResponse> {
          const raw: RawParse = {
            version: 3,
            kind: 'data_query',
            candidates: [],
            unmatchedMeasureTerm: 'iets onbekends',
            nearestCanonicalKeys: [],
            note: null,
          };
          return {
            outputText: JSON.stringify(raw),
            model: 'stub',
            stopReason: 'end_turn',
            usage: { inputTokens: 0, outputTokens: 0 },
          };
        },
      };
      const summary = await runOnboardingJob(h.deps({ intentClient: unmatchedIntent }));
      expect(summary.processed!.outcome).toBe('unanswerable');

      const row = await getPendingRequest(h.db, pendingId);
      expect(row!.status).toBe('unanswerable');
      // Full refund → net 0.
      expect(await getBalance(h.db, userId)).toBe(150);
      expect(h.notified[0]!.outcome).toBe('unanswerable');
      expect(h.notified[0]!.refundedCredits).toBe(100);
    } finally {
      await h.close();
    }
  });
});

describe('runOnboardingJob — claim / reclaim / attempt cap', () => {
  it('claims exactly one row per invocation, oldest first; empty queue → processed null', async () => {
    const h = await harness();
    try {
      // Empty queue.
      const empty = await runOnboardingJob(h.deps());
      expect(empty.processed).toBeNull();
    } finally {
      await h.close();
    }
  });

  it('reclaims a stale running row back to pending (attempt_count bumped)', async () => {
    const h = await harness();
    try {
      const { pendingId } = await queueRequest(h.db, 'q', 't');
      // Force it to a stale 'running' state older than the threshold.
      await h.db.query(
        `update pending_table_requests set status = 'running',
           claimed_at = now() - ($1 || ' milliseconds')::interval * 2
         where id = $2`,
        [STALE_RUNNING_MS, pendingId],
      );
      // A job invocation reclaims it (back to pending, attempt bumped) THEN
      // claims + processes it in the same run.
      const summary = await runOnboardingJob(h.deps());
      expect(summary.reclaimed).toContain(pendingId);
      // It was reclaimed, then claimed + delivered in the same invocation.
      expect(summary.processed!.id).toBe(pendingId);
      const row = await getPendingRequest(h.db, pendingId);
      expect(row!.attemptCount).toBe(1);
    } finally {
      await h.close();
    }
  });

  it('attempt cap: a stale running row past MAX_ATTEMPTS is terminally failed + refunded', async () => {
    const h = await harness();
    try {
      const { userId, pendingId } = await queueRequest(h.db, 'q', 't');
      await h.db.query(
        `update pending_table_requests set status = 'running', attempt_count = $1,
           claimed_at = now() - ($2 || ' milliseconds')::interval * 2
         where id = $3`,
        [MAX_ATTEMPTS, STALE_RUNNING_MS, pendingId],
      );
      const summary = await runOnboardingJob(h.deps());
      expect(summary.capExhausted).toContain(pendingId);

      const row = await getPendingRequest(h.db, pendingId);
      expect(row!.status).toBe('failed');
      // Full refund on the terminal cap-fail → net 0.
      expect(await getBalance(h.db, userId)).toBe(150);
      expect(h.notified.some((e) => e.outcome === 'failed' && e.refundedCredits === 100)).toBe(true);
    } finally {
      await h.close();
    }
  });
});

describe('runOnboardingJob — oversize table is sliced before ingest', () => {
  it('an over-cap $count builds a slice, records the note, and still delivers', async () => {
    // A source whose $count reports far over the cap forces the slice path.
    // 82235NED is national-only (Perioden dim), so the slice pins a period
    // floor (last N years) — the 2024 cell still lands, so delivery answers.
    const base = fixtureSource();
    const oversizeSource: CbsSource = {
      ...base,
      fetchTableSchema: base.fetchTableSchema.bind(base),
      fetchCodeList: base.fetchCodeList.bind(base),
      fetchObservations: base.fetchObservations.bind(base),
      fetchCatalog: base.fetchCatalog.bind(base),
      fetchObservationCount: async () => 10_000_000,
    };
    const h = await harness(oversizeSource);
    try {
      const { pendingId } = await queueRequest(h.db, 'hoeveel woningen in 2024', 'woningvoorraad');
      const summary = await runOnboardingJob(h.deps());
      expect(summary.processed!.outcome).toBe('delivered');
      const row = await getPendingRequest(h.db, pendingId);
      expect(row!.sliceNote).toContain('versmald');
      // The registered slice pinned a period floor → the table's stored slice
      // is non-null (recorded on cbs_tables by registerTables).
      const t = await h.db.query('select slice from cbs_tables where id = $1', [TABLE]);
      const slice = t.rows[0]!.slice;
      expect(slice).not.toBeNull();
    } finally {
      await h.close();
    }
  });
});

describe('runOnboardingJob — piggyback', () => {
  it('a second request for an already-synced table skips fetch and still delivers', async () => {
    const h = await harness();
    try {
      // First request onboards + syncs the table.
      await queueRequest(h.db, 'hoeveel woningen in 2024', 'woningvoorraad');
      await runOnboardingJob(h.deps());

      // Second request for the SAME table but a DIFFERENT year — a different
      // user so the one-active-per-(user,table) index doesn't block it.
      const { pendingId } = await queueRequest(h.db, 'hoeveel woningen in 2023', 'woningvoorraad');
      // The table is already synced → the job piggybacks (no re-fetch) and
      // delivers straight from the already-ingested cells.
      const summary = await runOnboardingJob(h.deps({ intentClient: intentStub(2023) }));
      expect(summary.processed).toEqual({ id: pendingId, tableId: TABLE, outcome: 'delivered' });
    } finally {
      await h.close();
    }
  });
});

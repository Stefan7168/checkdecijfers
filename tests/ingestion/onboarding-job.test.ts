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
import { ReplayLlmClient } from '../../src/answer/llm/client.ts';
import type { RawParse } from '../../src/answer/intent/types.ts';
import {
  createPendingRequest,
  findActiveRequest,
  getPendingRequest,
  setResolvedTable,
} from '../../src/ingestion/onboarding-store.ts';
import {
  DEFAULT_MEASURE_FIT_CONFIG,
  type MeasureFitFn,
  type MeasureFitResult,
} from '../../src/ingestion/onboarding-fit.ts';
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
const DELIVERY_PARSE_FIXTURES = fileURLToPath(new URL('../fixtures/llm/onboarding-delivery', import.meta.url));

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

// WP27 stage C: the bijstand candidate-chain family (stage-A captures). NOTE
// 85615NED is SCHEMA-ONLY (metadata + real $count, ZERO observation pages) —
// correct for the metadata-only fit gate, but any test that lets the job
// INGEST it dies with a misleading "sync fetched 0 rows … refusing to ingest"
// (brief § Stage C executor notes). The fit gate must route past it.
const STOCK_TABLE = '37789ksz';
const STOCK_MEASURE = 'D000203_2'; // "Totaal bijstandsuitkeringen"; 2023JJ00 = 390.2 in the fixture
const FLOWS_TABLE = '85615NED';
const BIJSTAND_QUESTION = 'Hoeveel mensen zaten er in 2023 in de bijstand?';

/** Record-form FixtureSource serving the whole candidate family (brief §
 * Stage C: "FixtureSource with the Record<tableId, docs> form serving BOTH
 * bijstand tables from Stage A's captures"). */
function bijstandSource(): CbsSource {
  return new FixtureSource({
    [TABLE]: loadFixtureDocs(`${FIXTURES}/${TABLE}`),
    [STOCK_TABLE]: loadFixtureDocs(`${FIXTURES}/${STOCK_TABLE}`),
    [FLOWS_TABLE]: loadFixtureDocs(`${FIXTURES}/${FLOWS_TABLE}`),
  });
}

/** Intent stub: emits a single confident candidate for the onboarded key. The
 * job passes the onboarded measures as extra vocabulary, so this key is legal
 * at schema validation and resolves against the freshly-registered
 * canonical_measures row. */
function intentStub(year: number, table: string = TABLE, measure: string = MEASURE): LlmClient {
  const raw: RawParse = {
    version: 3,
    kind: 'data_query',
    candidates: [
      {
        canonicalKey: onboardedKey(table, measure),
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
 * queues a pending row — the exact state triggerOnboarding leaves. Defaults
 * to the legacy shape (TABLE, no candidate chain); WP27 stage-C tests pass
 * `tableId` (the finder's pick, the dedupe identity) + `candidateIds`. */
async function queueRequest(
  db: Db,
  question: string,
  topicTerm: string,
  opts: { tableId?: string; candidateIds?: string[] } = {},
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
    tableId: opts.tableId ?? TABLE,
    finderConfidence: 0.9,
    candidateIds: opts.candidateIds ?? [],
    debitTransactionId: debit.entry.id,
  });
  return { userId, requestId, pendingId: row.id, debitId: debit.entry.id };
}

/** A recording MeasureFitFn: scripted verdict (or throw) per table id, and a
 * call log so tests can pin exactly WHICH candidates reached the LLM step
 * (A3's "skipped WITHOUT a fit-LLM call" is an assertion on this log). */
function fitScript(
  script: Record<string, MeasureFitResult | 'throw'>,
): { fit: MeasureFitFn; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    fit: async (_question, schema) => {
      calls.push(schema.tableId);
      const verdict = script[schema.tableId];
      if (verdict === undefined) throw new Error(`fitScript: unscripted table ${schema.tableId}`);
      if (verdict === 'throw') throw new Error(`fitScript: scripted throw for ${schema.tableId}`);
      return verdict;
    },
  };
}

/** A fit fn for tests where the gate must never run (legacy rows, resumed
 * rows) — reaching it is the failure. */
function throwingFit(): MeasureFitFn {
  return async () => {
    throw new Error('fit gate must not run for this row');
  };
}

const FIT_GEEN: MeasureFitResult = { measureCode: null, confidence: 0.9, reading: 'geen passende maat' };
const FIT_ACCEPT_STOCK: MeasureFitResult = {
  measureCode: STOCK_MEASURE,
  confidence: 0.95,
  reading: 'telt het totale aantal bijstandsuitkeringen',
};

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

// Session-30 review follow-ups (both double-confirmed by the adversarial
// verify pass): the refund amount must be the STORED debit, and one poisoned
// exhausted row must never wedge the whole queue.
describe('runOnboardingJob — refund reverses the STORED debit, never the live price', () => {
  it('a heavy-class reprice between debit and refund still refunds exactly what was debited', async () => {
    const h = await harness(throwingSource());
    try {
      const { userId, pendingId } = await queueRequest(h.db, 'q', 't');
      // The owner reprices 'heavy' AFTER the debit, BEFORE the job runs (the
      // ADR 026 pricing seam — deliberately easy to change). The queued row
      // was debited 100; a refund that re-read the price would compensate
      // 150 → net +50 minted on a FAILED onboarding.
      await h.db.query(`update action_class_prices set credits = 150 where action_class = 'heavy'`);

      const summary = await runOnboardingJob(h.deps());
      expect(summary.processed).toEqual({ id: pendingId, tableId: TABLE, outcome: 'failed' });

      // 150 grant − 100 debit + exactly 100 back = 150. Not 200.
      expect(await getBalance(h.db, userId)).toBe(150);
      // The refund email states the true amount.
      expect(h.notified[0]!.refundedCredits).toBe(100);
    } finally {
      await h.close();
    }
  });
});

describe('runOnboardingJob — a poisoned exhausted row never wedges the queue', () => {
  it('refund throw on one exhausted row: the job still claims another pending row; the poisoned row is retried next run', async () => {
    const h = await harness();
    try {
      // Row A: exhausted (stale running at the attempt cap).
      const a = await queueRequest(h.db, 'vraag A', 'tA');
      await h.db.query(
        `update pending_table_requests set status = 'running', attempt_count = $1,
           claimed_at = now() - ($2 || ' milliseconds')::interval * 2
         where id = $3`,
        [MAX_ATTEMPTS, STALE_RUNNING_MS, a.pendingId],
      );
      // Row B: an ordinary pending row behind it.
      const b = await queueRequest(h.db, 'vraag B', 'tB');

      // A db that fails EXACTLY row A's compensation insert — the shape of a
      // transient ledger error (or the migration-013 guard missing). The
      // refund runs inside failAndRefund's TRANSACTION (refund + finalize are
      // atomic by design), so the poison must wrap the TX client recursively
      // — poisoning only the outer handle never reaches the refund, and the
      // rollback is exactly what keeps row A retryable.
      const poison = (target: Db): Db => ({
        query: (text: string, params?: unknown[]) =>
          /insert into credit_transactions/i.test(text) && (params ?? []).includes(a.debitId)
            ? Promise.reject(new Error('boom: transient ledger failure'))
            : target.query(text, params),
        withTransaction: (fn) => target.withTransaction((tx) => fn(poison(tx))),
      });
      const poisoned = poison(h.db);

      // The job must NOT throw (the route would 500), and step 2 must still
      // claim row B — one poisoned row may not stall the whole queue.
      const summary = await runOnboardingJob(h.deps({ db: poisoned }));
      expect(summary.capExhausted).toContain(a.pendingId);
      expect(summary.processed!.id).toBe(b.pendingId);
      expect(summary.processed!.outcome).toBe('delivered');

      // Row A is still 'running' at the cap: NOT lost, NOT silently failed
      // without its refund — the next invocation re-selects it.
      const rowA = await getPendingRequest(h.db, a.pendingId);
      expect(rowA!.status).toBe('running');

      // Next run (ledger healthy again): row A is failed + refunded in full.
      await runOnboardingJob(h.deps());
      const rowAAfter = await getPendingRequest(h.db, a.pendingId);
      expect(rowAAfter!.status).toBe('failed');
      expect(await getBalance(h.db, a.userId)).toBe(150);
    } finally {
      await h.close();
    }
  });
});

// ---------------------------------------------------------------------------
// WP27 stage C — the measure-fit gate (ADR 027 D2, brief § Stage C tests)
// ---------------------------------------------------------------------------

describe('runOnboardingJob — fit gate: candidate fallback (WP27 stage C)', () => {
  it('candidate 1 misfits (fit verdict geen) → candidate 2 DELIVERS; resolved_table_id set, table_id untouched', async () => {
    const h = await harness(bijstandSource());
    try {
      const script = fitScript({ [TABLE]: FIT_GEEN, [STOCK_TABLE]: FIT_ACCEPT_STOCK });
      const { userId, pendingId } = await queueRequest(h.db, BIJSTAND_QUESTION, 'bijstand', {
        tableId: TABLE, // the finder's (wrong) pick, candidate 1
        candidateIds: [TABLE, STOCK_TABLE],
      });

      const summary = await runOnboardingJob(
        h.deps({ fit: script.fit, intentClient: intentStub(2023, STOCK_TABLE, STOCK_MEASURE) }),
      );
      expect(summary.processed!.outcome).toBe('delivered');
      // Both candidates are time-only with JJ codes → both reach the fit LLM,
      // in chain order.
      expect(script.calls).toEqual([TABLE, STOCK_TABLE]);

      const row = await getPendingRequest(h.db, pendingId);
      expect(row!.status).toBe('delivered');
      // D2a: the fit choice lives in resolved_table_id; the dedupe identity
      // is untouched.
      expect(row!.resolvedTableId).toBe(STOCK_TABLE);
      expect(row!.tableId).toBe(TABLE);

      // fit_note diagnostics: measure code + the model's one-line reading.
      const note = await h.db.query('select fit_note from pending_table_requests where id = $1', [
        pendingId,
      ]);
      expect(note.rows[0]!.fit_note).toBe(
        `${STOCK_MEASURE}: telt het totale aantal bijstandsuitkeringen`,
      );

      // The delivered number is the STOCK table's fixture cell (390.2 for
      // 2023JJ00), through the full validated pipeline.
      const audit = await h.db.query('select final_text from audit_answers where id = $1', [
        row!.deliveryAuditAnswerId,
      ]);
      expect(audit.rows[0]!.final_text as string).toContain((390.2).toLocaleString('nl-NL'));

      // Delivered → the 100-credit debit stands.
      expect(await getBalance(h.db, userId)).toBe(50);
    } finally {
      await h.close();
    }
  });

  it('A3(a): a breakdown-dimension candidate (85615NED) is skipped undeliverable WITHOUT a fit-LLM call — the live #111 shape', async () => {
    const h = await harness(bijstandSource());
    try {
      // The measured live behavior (ADR 027 § Amendments): the finder picks a
      // person-level table whose deliverability no model can see from
      // title/summary; the chain must route past it deterministically.
      const script = fitScript({ [STOCK_TABLE]: FIT_ACCEPT_STOCK });
      const { pendingId } = await queueRequest(h.db, BIJSTAND_QUESTION, 'bijstand', {
        tableId: FLOWS_TABLE,
        candidateIds: [FLOWS_TABLE, STOCK_TABLE],
      });

      const summary = await runOnboardingJob(
        h.deps({ fit: script.fit, intentClient: intentStub(2023, STOCK_TABLE, STOCK_MEASURE) }),
      );
      expect(summary.processed!.outcome).toBe('delivered');
      // THE A3 pin: the flows table never reached the LLM step (its breakdown
      // dimensions failed the deterministic pre-check) — and was never
      // ingested (schema-only fixture: ingesting it would die loudly).
      expect(script.calls).toEqual([STOCK_TABLE]);

      const row = await getPendingRequest(h.db, pendingId);
      expect(row!.resolvedTableId).toBe(STOCK_TABLE);
      expect(row!.tableId).toBe(FLOWS_TABLE);
      // Only the stock table was registered/ingested.
      const tables = await h.db.query(
        `select id from cbs_tables where id in ($1, $2)`,
        [FLOWS_TABLE, STOCK_TABLE],
      );
      expect(tables.rows.map((r) => r.id)).toEqual([STOCK_TABLE]);
    } finally {
      await h.close();
    }
  });

  it('A3(b): a bare-year question skips a time-only candidate lacking JJ codes, without a fit-LLM call', async () => {
    // A synthetic quarters-only candidate isolates pre-check (b) from (a):
    // time-only dims (passes a) but no whole-year codes (fails b).
    const base = bijstandSource();
    const KW_ONLY = 'KWONLY01';
    const overlay: CbsSource = {
      fetchTableSchema: async (tableId) =>
        tableId === KW_ONLY
          ? {
              tableId: KW_ONLY,
              title: 'Kwartaalcijfers zonder jaartotalen',
              dimensions: [{ name: 'Perioden', kind: 'TimeDimension' }],
              measures: [{ code: 'M0001', title: 'Iets per kwartaal', unit: 'aantal', decimals: 0, description: '' }],
            }
          : base.fetchTableSchema(tableId),
      fetchCodeList: async (tableId, dimension) =>
        tableId === KW_ONLY
          ? [
              { code: '2023KW01', title: '2023 1e kwartaal', dimensionGroup: null, status: null, index: null },
              { code: '2023KW02', title: '2023 2e kwartaal', dimensionGroup: null, status: null, index: null },
            ]
          : base.fetchCodeList(tableId, dimension),
      fetchObservations: base.fetchObservations.bind(base),
      fetchObservationCount: base.fetchObservationCount.bind(base),
      fetchCatalog: base.fetchCatalog.bind(base),
    };
    const h = await harness(overlay);
    try {
      const script = fitScript({ [STOCK_TABLE]: FIT_ACCEPT_STOCK });
      const { pendingId } = await queueRequest(h.db, BIJSTAND_QUESTION, 'bijstand', {
        tableId: KW_ONLY,
        candidateIds: [KW_ONLY, STOCK_TABLE],
      });

      const summary = await runOnboardingJob(
        h.deps({ fit: script.fit, intentClient: intentStub(2023, STOCK_TABLE, STOCK_MEASURE) }),
      );
      expect(summary.processed!.outcome).toBe('delivered');
      expect(script.calls).toEqual([STOCK_TABLE]);
      const row = await getPendingRequest(h.db, pendingId);
      expect(row!.resolvedTableId).toBe(STOCK_TABLE);
    } finally {
      await h.close();
    }
  });

  it("all candidates 'geen' → unanswerable with the scoped message + full refund", async () => {
    const h = await harness(bijstandSource());
    try {
      const script = fitScript({ [TABLE]: FIT_GEEN, [STOCK_TABLE]: FIT_GEEN });
      const { userId, pendingId } = await queueRequest(h.db, BIJSTAND_QUESTION, 'bijstand', {
        tableId: TABLE,
        candidateIds: [TABLE, STOCK_TABLE],
      });

      const summary = await runOnboardingJob(h.deps({ fit: script.fit }));
      expect(summary.processed!.outcome).toBe('unanswerable');

      const row = await getPendingRequest(h.db, pendingId);
      expect(row!.status).toBe('unanswerable');
      expect(row!.failureSummary).toBe(
        'Geen van de onderzochte tabellen bevat een maat die deze vraag beantwoordt.',
      );
      expect(row!.resolvedTableId).toBeNull();
      // Full refund; notify says unanswerable.
      expect(await getBalance(h.db, userId)).toBe(150);
      expect(h.notified[0]!.outcome).toBe('unanswerable');
    } finally {
      await h.close();
    }
  });

  it('ALL candidates errored (schema fetch throws) → failed with the honest infra message, never "geen passende maat" (D2b)', async () => {
    const h = await harness(throwingSource());
    try {
      const { userId, pendingId } = await queueRequest(h.db, BIJSTAND_QUESTION, 'bijstand', {
        tableId: TABLE,
        candidateIds: [TABLE, STOCK_TABLE],
      });

      const summary = await runOnboardingJob(h.deps({ fit: throwingFit() }));
      expect(summary.processed!.outcome).toBe('failed');

      const row = await getPendingRequest(h.db, pendingId);
      expect(row!.status).toBe('failed');
      expect(row!.failureSummary).toBe(
        'Onverwachte fout bij het ophalen: geen van de kandidaat-tabellen kon bij het CBS worden gecontroleerd.',
      );
      expect(await getBalance(h.db, userId)).toBe(150);
      expect(h.notified[0]!.outcome).toBe('failed');
    } finally {
      await h.close();
    }
  });

  it('fit ERROR on candidate 1 (throw), accept on candidate 2 → delivered (an error is not a verdict)', async () => {
    const h = await harness(bijstandSource());
    try {
      const script = fitScript({ [TABLE]: 'throw', [STOCK_TABLE]: FIT_ACCEPT_STOCK });
      const { pendingId } = await queueRequest(h.db, BIJSTAND_QUESTION, 'bijstand', {
        tableId: TABLE,
        candidateIds: [TABLE, STOCK_TABLE],
      });

      const summary = await runOnboardingJob(
        h.deps({ fit: script.fit, intentClient: intentStub(2023, STOCK_TABLE, STOCK_MEASURE) }),
      );
      expect(summary.processed!.outcome).toBe('delivered');
      expect(script.calls).toEqual([TABLE, STOCK_TABLE]);
      const row = await getPendingRequest(h.db, pendingId);
      expect(row!.resolvedTableId).toBe(STOCK_TABLE);
    } finally {
      await h.close();
    }
  });

  it('a verdict EXACTLY at the acceptance threshold is ACCEPTED — the boundary is inclusive (>=)', async () => {
    // Stage-C adversarial review finding (mutation-confirmed by both
    // skeptics): no test supplied confidence === acceptThreshold, so >= vs >
    // was unpinned — exactly the line where accept-vs-honest-refund is
    // decided. References the CONSTANT (not a literal) so stage D's
    // recalibration keeps this boundary pinned at whatever the calibrated
    // value becomes.
    const h = await harness(bijstandSource());
    try {
      const script = fitScript({
        [STOCK_TABLE]: {
          measureCode: STOCK_MEASURE,
          confidence: DEFAULT_MEASURE_FIT_CONFIG.acceptThreshold,
          reading: 'precies op de drempel',
        },
      });
      const { pendingId } = await queueRequest(h.db, BIJSTAND_QUESTION, 'bijstand', {
        tableId: STOCK_TABLE,
        candidateIds: [STOCK_TABLE],
      });
      const summary = await runOnboardingJob(
        h.deps({ fit: script.fit, intentClient: intentStub(2023, STOCK_TABLE, STOCK_MEASURE) }),
      );
      // With a single candidate, a >-mutation would reject it → unanswerable;
      // the inclusive boundary must deliver.
      expect(summary.processed!.outcome).toBe('delivered');
      const row = await getPendingRequest(h.db, pendingId);
      expect(row!.resolvedTableId).toBe(STOCK_TABLE);
    } finally {
      await h.close();
    }
  });

  it('an under-threshold accept counts as geen: measure named but confidence below the threshold → next candidate', async () => {
    const h = await harness(bijstandSource());
    try {
      const script = fitScript({
        [TABLE]: { measureCode: MEASURE, confidence: 0.5, reading: 'zou kunnen' },
        [STOCK_TABLE]: FIT_ACCEPT_STOCK,
      });
      const { pendingId } = await queueRequest(h.db, BIJSTAND_QUESTION, 'bijstand', {
        tableId: TABLE,
        candidateIds: [TABLE, STOCK_TABLE],
      });
      const summary = await runOnboardingJob(
        h.deps({ fit: script.fit, intentClient: intentStub(2023, STOCK_TABLE, STOCK_MEASURE) }),
      );
      expect(summary.processed!.outcome).toBe('delivered');
      const row = await getPendingRequest(h.db, pendingId);
      expect(row!.resolvedTableId).toBe(STOCK_TABLE);
    } finally {
      await h.close();
    }
  });
});

describe('runOnboardingJob — fit gate: legacy rows and resumed rows (D2a/D2c)', () => {
  it('legacy row ([]) on an already-synced table: NO source call, NO fit call — the byte-identical today-path pin', async () => {
    // First a normal delivering run syncs the table…
    const h = await harness();
    try {
      await queueRequest(h.db, 'hoeveel woningen in 2024', 'woningvoorraad');
      const first = await runOnboardingJob(h.deps());
      expect(first.processed!.outcome).toBe('delivered');

      // …then a SECOND legacy request for the same table runs with a source
      // whose EVERY method throws and a fit that throws if consulted: the
      // piggyback path must deliver without touching either (the brief's
      // throwing-source guard — the fit gate added no hidden metadata read to
      // the legacy path).
      const dead: CbsSource = {
        fetchTableSchema: () => Promise.reject(new Error('legacy path must not fetch schema')),
        fetchCodeList: () => Promise.reject(new Error('legacy path must not fetch code lists')),
        fetchObservations: (() => {
          throw new Error('legacy path must not fetch observations');
        }) as never,
        fetchObservationCount: () => Promise.reject(new Error('legacy path must not count')),
        fetchCatalog: (() => {
          throw new Error('legacy path must not fetch the catalog');
        }) as never,
      };
      const { pendingId } = await queueRequest(h.db, 'hoeveel woningen in 2024 nogmaals', 'woningvoorraad');
      const summary = await runOnboardingJob(h.deps({ source: dead, fit: throwingFit() }));
      expect(summary.processed).toEqual({ id: pendingId, tableId: TABLE, outcome: 'delivered' });
      const row = await getPendingRequest(h.db, pendingId);
      expect(row!.resolvedTableId).toBeNull();
      expect(row!.candidateIds).toEqual([]);
    } finally {
      await h.close();
    }
  });

  it('reclaim-after-accept resumes at ingest: resolved_table_id is honored, the fit loop NEVER re-runs, no second table ingested', async () => {
    const h = await harness(bijstandSource());
    try {
      // Simulate the post-accept crash state a reclaim leaves behind: the
      // row is pending again, candidate chain present, resolved_table_id
      // already recorded by the crashed attempt (setResolvedTable committed
      // before the crash).
      const userId = randomUUID();
      const requestId = randomUUID();
      await h.db.query('update signup_grant_config set credits = 150');
      await h.db.query('select public.grant_signup_credits($1)', [userId]);
      const debit = await reserveOnboardingDebit(h.db, userId, requestId, 100);
      if (debit.kind !== 'debited') throw new Error(`setup: ${debit.kind}`);
      const row = await createPendingRequest(h.db, {
        userId,
        requestId,
        questionText: BIJSTAND_QUESTION,
        topicTerm: 'bijstand',
        tableId: FLOWS_TABLE,
        finderConfidence: 0.9,
        candidateIds: [FLOWS_TABLE, STOCK_TABLE],
        debitTransactionId: debit.entry.id,
      });
      await setResolvedTable(h.db, row, STOCK_TABLE, `${STOCK_MEASURE}: eerdere poging`);

      const summary = await runOnboardingJob(
        h.deps({ fit: throwingFit(), intentClient: intentStub(2023, STOCK_TABLE, STOCK_MEASURE) }),
      );
      expect(summary.processed!.outcome).toBe('delivered');

      // Only the resolved table was ingested; the flows table never was.
      const tables = await h.db.query(`select id from cbs_tables where id in ($1, $2)`, [
        FLOWS_TABLE,
        STOCK_TABLE,
      ]);
      expect(tables.rows.map((r) => r.id)).toEqual([STOCK_TABLE]);
    } finally {
      await h.close();
    }
  });

  it('re-ask during running: the dedupe pins on the UNCHANGED table_id, not the resolved one', async () => {
    const h = await harness(bijstandSource());
    try {
      const { pendingId } = await queueRequest(h.db, BIJSTAND_QUESTION, 'bijstand', {
        tableId: FLOWS_TABLE,
        candidateIds: [FLOWS_TABLE, STOCK_TABLE],
      });
      const row = await getPendingRequest(h.db, pendingId);
      await setResolvedTable(h.db, row!, STOCK_TABLE, 'fit accepted');

      // A re-ask routes on the finder's pick (the ORIGINAL table_id): the
      // active-row lookup must still find this row — asking twice must not
      // queue or charge twice (ADR 027 D2a: identity never mutated).
      const active = await findActiveRequest(h.db, row!.userId, FLOWS_TABLE);
      expect(active).not.toBeNull();
      expect(active!.id).toBe(pendingId);
      expect(active!.resolvedTableId).toBe(STOCK_TABLE);
    } finally {
      await h.close();
    }
  });
});

describe('runOnboardingJob — the #124 measurement e2e (REAL parser replay, WP27 stage C)', () => {
  it('the 37789ksz delivery parse ANSWERS across 18 same-tagged measures — R7 rule 4 does not fire (measured 2026-07-10)', async () => {
    // The brief's known measurement question: onboarding-vocab tags EVERY
    // registered 37789ksz measure with the topic term ('bijstand', 18
    // measures, three bijstand-titled) — would the delivery parse clarify
    // (→ unanswerable + refund despite a perfect fit-gate pass) instead of
    // answering? MEASURED via a recorded REAL Haiku parse (scripts/
    // onboarding-delivery-record.ts, owner-approved spend): it answers,
    // resolving "Totaal bijstandsuitkeringen" directly. This replay pins that
    // measured behavior into CI; a prompt/vocab change that breaks it fails
    // here loudly (the replay client throws on a hash miss → re-record).
    const h = await harness(bijstandSource());
    try {
      const script = fitScript({
        [STOCK_TABLE]: { measureCode: STOCK_MEASURE, confidence: 0.95, reading: 'record-script accept' },
      });
      const { userId, pendingId } = await queueRequest(h.db, BIJSTAND_QUESTION, 'bijstand', {
        tableId: FLOWS_TABLE,
        candidateIds: [FLOWS_TABLE, STOCK_TABLE],
      });

      const summary = await runOnboardingJob(
        h.deps({
          fit: script.fit,
          intentClient: new ReplayLlmClient(DELIVERY_PARSE_FIXTURES),
        }),
      );
      expect(summary.processed!.outcome).toBe('delivered');

      const row = await getPendingRequest(h.db, pendingId);
      expect(row!.status).toBe('delivered');
      expect(row!.resolvedTableId).toBe(STOCK_TABLE);

      // The owner's acceptance shape (stage D re-verifies this LIVE): the
      // stock number from the fixture cell, CBS's measure named verbatim
      // (owner decision A1: it counts uitkeringen, not persons).
      const audit = await h.db.query('select final_text from audit_answers where id = $1', [
        row!.deliveryAuditAnswerId,
      ]);
      const text = audit.rows[0]!.final_text as string;
      expect(text).toContain('Totaal bijstandsuitkeringen');
      expect(text).toContain((390.2).toLocaleString('nl-NL'));
      expect(text).toContain('37789ksz');

      // Delivered → the debit stands (150 − 100).
      expect(await getBalance(h.db, userId)).toBe(50);
    } finally {
      await h.close();
    }
  });
});

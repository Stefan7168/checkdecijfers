// The on-demand CBS onboarding JOB (WP16 sub-part 2, ADR 026, design §3): the
// cron-invoked engine that drains the pending_table_requests queue. One
// invocation reclaims stale rows, claims ONE pending row, and runs
// register → sync → vocabulary → delivery (or, on any failure, refund +
// terminal-fail). It is the ONLY out-of-band path that fetches from CBS
// (principle b holds by construction — never the request path).
//
// THE HARD INVARIANT (design §3): every code path a claimed row can take ends
// with the row in a TERMINAL state (delivered / unanswerable / failed) AND, on
// any non-delivery, a full 100-credit refund. No exception may escape
// per-row processing without the row finalized + refunded — processOneRow
// wraps the whole attempt in try/catch that finalizes. A crash between claim
// and finalize is caught by the next invocation's stale-running reclaim.
//
// Money boundary: the job DOES touch the ledger (the refund), unlike the
// answer module — but only via the existing compensate() primitive (ADR 026
// decision 2: refund-on-failure is the gate's mechanism, reused; migration 013
// widened compensate's guard to accept the onboarding_cost debit). It never
// invents billing logic.
import type { CbsSource } from '../cbs-adapter/types.ts';
import { compensate } from '../billing/ledger.ts';
import type { Db } from '../db/types.ts';
import { answerQuestionAudited } from '../answer/audit/respond-audited.ts';
import type { AuditedRespondOptions } from '../answer/audit/respond-audited.ts';
import { registerTables, syncTable } from './pipeline.ts';
import type { Phase0Table } from './registry-seed.ts';
import { estimateSlice, fetchCount } from './onboarding-slice.ts';
import { registerOnboardingVocabulary } from './onboarding-vocab.ts';
import type { NotifyFn } from './onboarding-notify.ts';
import {
  claimOnePending,
  finalizeDelivered,
  finalizeFailed,
  finalizeUnanswerable,
  getPendingRequest,
  reclaimStaleRunning,
  recordSliceNote,
  type PendingTableRequest,
} from './onboarding-store.ts';

/** A running row older than this is presumed crashed and reclaimed to pending
 * (design §3 step 1). Comfortably longer than one job invocation's own
 * deadline budget so a still-working invocation is never reclaimed out from
 * under itself. */
export const STALE_RUNNING_MS = 20 * 60 * 1000; // 20 minutes

/** Terminal attempt cap (design §3 step 1): a row reclaimed this many times is
 * failed + refunded rather than retried forever. */
export const MAX_ATTEMPTS = 3;

/** How long the answer's LLM parse+compose may cost is normal per-question
 * spend (design §3.7). The delivery re-run is tagged distinctly for reporting. */
const DELIVERY_SOURCE_TAG = 'onboarding_delivery' as const;

/** Everything the job needs, all injected so it is fully hermetic in tests
 * (the CbsSource is a FixtureSource; the LLM clients are stubs; notify is a
 * recording stub) and wired to the real implementations in the cron route. */
export interface OnboardingJobDeps {
  db: Db;
  /** The CBS data source — fixture in tests, ODataV4Source in production. */
  source: CbsSource;
  /** Intent + answer LLM clients for the delivery re-run (design §3.7). */
  intentClient: AuditedRespondOptions['intentClient'];
  answerClient: AuditedRespondOptions['answerClient'];
  /** Best-effort email notifier (design §3). */
  notify: NotifyFn;
  /** 'today' for the delivery re-run's relative-period resolution. Injected so
   * the job is clock-testable (docs/05 staleness rule), exactly like the chat
   * action's referenceDate(). */
  referenceDate: string;
}

export interface OnboardingJobSummary {
  /** Ids reclaimed from stale 'running' back to 'pending'. */
  reclaimed: number[];
  /** Ids terminally failed by the attempt cap during reclaim. */
  capExhausted: number[];
  /** The row processed this invocation, with its terminal outcome — null when
   * the queue was empty. */
  processed:
    | { id: number; tableId: string; outcome: 'delivered' | 'unanswerable' | 'failed' }
    | null;
}

/** Refunds the onboarding debit in full (design §3.7/§3.8), idempotently
 * (compensate's related_transaction_id dedup). Best-effort-safe: a refund
 * failure is logged and re-thrown ONLY to the per-row finalizer, which has
 * already put the row terminal — a refund that fails is a loud operator
 * problem, never a silently-kept charge. Returns the credits refunded.
 *
 * The amount is the STORED debit's own delta, never a fresh price read: the
 * debit and the refund run in different invocations, minutes to a day apart,
 * and the 'heavy' class can be legitimately repriced in between (the ADR 026
 * pricing seam). Re-reading the price here minted or destroyed credits on a
 * reprice — debit 100, refund 150, net +50 on a FAILED onboarding, with the
 * dashboard then showing a negative charge (session-30 review, money lens,
 * double-confirmed). The synchronous gate never had this bug: it debits and
 * compensates the same in-memory value within one turn. */
async function refundOnboarding(
  db: Db,
  row: PendingTableRequest,
  auditAnswerId: number | null,
): Promise<number> {
  const { rows } = await db.query('select delta from credit_transactions where id = $1', [
    row.debitTransactionId,
  ]);
  if (rows.length === 0) {
    // Structurally unreachable (debit_transaction_id is a FK into the
    // ledger) — but a refund path must fail LOUD, never guess an amount.
    throw new Error(`onboarding refund: debit transaction ${row.debitTransactionId} not found`);
  }
  const amount = -Number(rows[0]!.delta);
  await compensate(db, row.userId, row.debitTransactionId, amount, auditAnswerId);
  return amount;
}

/** True when the table is already registered AND has at least one successful
 * sync (last_sync_at set) — design §3 step 3's piggyback check. */
async function alreadyIngested(db: Db, tableId: string): Promise<boolean> {
  const { rows } = await db.query(
    `select 1 from cbs_tables where id = $1 and status = 'active' and last_sync_at is not null`,
    [tableId],
  );
  return rows.length > 0;
}

/** Register + sync one table through the EXISTING pipeline with a
 * runtime-derived Phase0Table (there is no separate TableSeed type — SCAFFOLD
 * handoff). The five ingestion validators run inside syncTable; a failed sync
 * or a needs_review quarantine is a step-8 failure. Returns the sync result. */
async function registerAndSync(
  db: Db,
  source: CbsSource,
  tableId: string,
  slice: Phase0Table['slice'],
): Promise<{ ok: true } | { ok: false; summary: string }> {
  const seed: Phase0Table = {
    id: tableId,
    ...(slice ? { slice } : {}),
    updateCadence: 'on-demand (WP16 sub-part 2)',
    servesTasks: [],
  };
  // registerTables is idempotent (already-registered → skipped); safe on a
  // retry after a prior partial run.
  await registerTables(db, source, [seed]);
  const result = await syncTable(db, source, tableId);
  if (result.outcome !== 'succeeded') {
    return {
      ok: false,
      summary:
        `Het inladen van tabel ${tableId} bij het CBS is mislukt ` +
        `(stap: ${result.failureStage ?? 'onbekend'}). ${result.failureSummary ?? ''}`.trim(),
    };
  }
  return { ok: true };
}

/**
 * Processes ONE claimed row end-to-end. The whole body is wrapped so that ANY
 * throw becomes a terminal 'failed' + refund + notify — the row can never be
 * left 'running' by an escaped exception (design §3.8).
 */
async function processOneRow(
  deps: OnboardingJobDeps,
  row: PendingTableRequest,
): Promise<'delivered' | 'unanswerable' | 'failed'> {
  const { db, source } = deps;
  try {
    // Step 3 — piggyback: skip fetch/ingest if the table is already synced.
    if (!(await alreadyIngested(db, row.tableId))) {
      // Step 4 — size + slice.
      const schema = await source.fetchTableSchema(row.tableId);
      const codeLists: Record<string, Awaited<ReturnType<CbsSource['fetchCodeList']>>> = {};
      for (const dim of schema.dimensions) {
        codeLists[dim.name] = await source.fetchCodeList(row.tableId, dim.name);
      }
      const count = await fetchCount(source, row.tableId);
      const estimate = estimateSlice(schema, codeLists, count);
      await recordSliceNote(db, row.id, estimate.note);

      // Step 5 — register + sync (existing validators run inside).
      const synced = await registerAndSync(db, source, row.tableId, estimate.slice ?? undefined);
      if (!synced.ok) {
        return await failAndRefund(deps, row, synced.summary);
      }
    }

    // Step 6 — vocabulary: derive canonical_measures from the ingested measure
    // metadata. Its output is the delivery re-run's extra parser vocabulary.
    const vocab = await registerOnboardingVocabulary(db, {
      tableId: row.tableId,
      topicTerm: row.topicTerm,
    });
    if (vocab.onboarded.length === 0) {
      // Nothing registerable → the delivery re-run can't ever answer. Honest
      // refund, not a fabricated attempt.
      return await unanswerableAndRefund(
        deps,
        row,
        `De opgehaalde tabel ${row.tableId} bevat geen maat die we onder deze vraag konden aanbieden.`,
      );
    }

    // Step 7 — delivery: re-run the ORIGINAL question through the full normal
    // audited pipeline (NOT through the gate — the 100 already covers it), with
    // the onboarded measure(s) added to the parser vocabulary. An ANSWER is the
    // only success; anything else is unanswerable → refund (design §0.4 gate).
    const delivered = await answerQuestionAudited(db, row.questionText, {
      referenceDate: deps.referenceDate,
      userId: row.userId,
      sourceTag: DELIVERY_SOURCE_TAG,
      requestId: row.requestId,
      intentClient: deps.intentClient,
      answerClient: deps.answerClient,
      extraCanonicalMeasures: vocab.onboarded,
    });

    if (delivered.response.kind === 'answer' && delivered.auditId !== null) {
      await finalizeDelivered(db, row.id, { deliveryAuditAnswerId: delivered.auditId });
      await deps.notify({
        userId: row.userId,
        questionText: row.questionText,
        topicTerm: row.topicTerm,
        outcome: 'delivered',
        failureSummary: null,
        refundedCredits: null,
      });
      return 'delivered';
    }

    // A refusal/clarification (or an answer whose audit write failed — an
    // unrecorded answer must NOT be delivered, R8) → unanswerable + refund.
    const summary =
      delivered.response.kind === 'answer'
        ? `Het antwoord kon niet betrouwbaar worden vastgelegd (audit).`
        : `De vraag kon niet betrouwbaar worden beantwoord met de opgehaalde cijfers.`;
    return await unanswerableAndRefund(deps, row, summary, delivered.auditId);
  } catch (error) {
    // Step 8 — any throw: terminal fail + refund + notify. The row NEVER stays
    // running because of an escaped exception.
    const summary = `Onverwachte fout bij het ophalen: ${
      error instanceof Error ? error.message : String(error)
    }`;
    return await failAndRefund(deps, row, summary);
  }
}

/** Terminal 'unanswerable' + refund + notify (design §3.7). The refund and the
 * status transition happen in ONE transaction so the row can never be left
 * refunded-but-not-terminal (or terminal-but-not-refunded) by a crash between
 * the two statements — the "terminal + refunded" invariant is atomic. `notify`
 * runs AFTER the commit (best-effort, must not roll the refund back). */
async function unanswerableAndRefund(
  deps: OnboardingJobDeps,
  row: PendingTableRequest,
  summary: string,
  auditAnswerId: number | null = null,
): Promise<'unanswerable'> {
  const refunded = await deps.db.withTransaction(async (tx) => {
    const amount = await refundOnboarding(tx, row, auditAnswerId);
    await finalizeUnanswerable(tx, row.id, summary);
    return amount;
  });
  await deps.notify({
    userId: row.userId,
    questionText: row.questionText,
    topicTerm: row.topicTerm,
    outcome: 'unanswerable',
    failureSummary: summary,
    refundedCredits: refunded,
  });
  return 'unanswerable';
}

/** Terminal 'failed' + refund + notify (design §3.8). Refund + status in ONE
 * transaction (see unanswerableAndRefund); notify after commit. */
async function failAndRefund(
  deps: OnboardingJobDeps,
  row: PendingTableRequest,
  summary: string,
): Promise<'failed'> {
  const refunded = await deps.db.withTransaction(async (tx) => {
    const amount = await refundOnboarding(tx, row, null);
    await finalizeFailed(tx, row.id, summary);
    return amount;
  });
  await deps.notify({
    userId: row.userId,
    questionText: row.questionText,
    topicTerm: row.topicTerm,
    outcome: 'failed',
    failureSummary: summary,
    refundedCredits: refunded,
  });
  return 'failed';
}

/**
 * One cron invocation (design §3). Reclaims stale rows + terminally fails
 * attempt-cap-exhausted rows, then claims and processes exactly ONE pending
 * row. One table per invocation; the 2-minute cadence drains the queue.
 */
export async function runOnboardingJob(deps: OnboardingJobDeps): Promise<OnboardingJobSummary> {
  const { db } = deps;

  // Step 1 — reclaim stale 'running' rows; terminally fail those past the cap.
  const { reclaimedIds, exhaustedIds } = await reclaimStaleRunning(db, STALE_RUNNING_MS, MAX_ATTEMPTS);
  for (const id of exhaustedIds) {
    // These rows are still 'running' (reclaimStaleRunning leaves them for us):
    // load the full row so we can refund + notify, then finalize failed.
    // Per-row isolation, mirroring processOneRow's own catch-all: one
    // un-refundable row (a transient DB error mid-refund, a migration-013-
    // missing guard throw) must not wedge the whole queue. Without this the
    // throw escaped the job, the route 500'd, and step 2 never claimed ANY
    // other pending row on any later invocation — the poisoned row was
    // re-selected forever (session-30 review, double-confirmed). The failed
    // row itself stays 'running' at the cap, so the NEXT invocation retries
    // exactly this refund (compensate is idempotent) — retried, not lost.
    try {
      const row = await getPendingRequest(db, id);
      if (!row) continue;
      await failAndRefund(
        deps,
        row,
        `Het ophalen is na ${MAX_ATTEMPTS} pogingen gestopt (steeds vastgelopen). De credits zijn teruggestort.`,
      );
    } catch (error) {
      console.error(`onboarding job: exhausted row ${id} could not be failed+refunded (queue continues):`, error);
    }
  }

  // Step 2 — claim ONE pending row (FOR UPDATE SKIP LOCKED).
  const claimed = await claimOnePending(db);
  if (claimed === null) {
    return { reclaimed: reclaimedIds, capExhausted: exhaustedIds, processed: null };
  }

  const outcome = await processOneRow(deps, claimed);
  return {
    reclaimed: reclaimedIds,
    capExhausted: exhaustedIds,
    processed: { id: claimed.id, tableId: claimed.tableId, outcome },
  };
}

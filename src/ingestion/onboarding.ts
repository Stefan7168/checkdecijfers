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
import type { LlmClient } from '../answer/llm/client.ts';
import { compensate } from '../billing/ledger.ts';
import type { Db } from '../db/types.ts';
import { answerQuestionAudited } from '../answer/audit/respond-audited.ts';
import type { AuditedRespondOptions } from '../answer/audit/respond-audited.ts';
import { registerTables, syncTable } from './pipeline.ts';
import type { Phase0Table } from './registry-seed.ts';
import { estimateSlice, fetchCount } from './onboarding-slice.ts';
import {
  DEFAULT_MEASURE_FIT_CONFIG,
  hasOnlyTimeDimensions,
  hasYearlyPeriodCodes,
  measureFit,
  questionNamesBareYear,
  type MeasureFitFn,
} from './onboarding-fit.ts';
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
  setResolvedTable,
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
  /** WP27 stage C: LLM client for the measure-fit check (the Haiku pin lives
   * in onboarding-fit.ts — ADR 027 D4). Required in production (the cron
   * route passes it); ignored when `fit` is injected directly. When BOTH are
   * absent and a fit-gated row arrives, the gate's closure throws → that
   * candidate records 'errored' → all-errored ends the row failed+refunded
   * (honest infra failure, never a guessed fit). */
  fitClient?: LlmClient;
  /** Measure-fit fn override (tests — routing is provable without the LLM
   * harness, exactly like OnboardingFinderDeps.rerank). Defaults to the
   * production closure over measureFit(fitClient). */
  fit?: MeasureFitFn;
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

/** WP27 stage C (ADR 027 D2): one fit-gate pass over the row's candidate
 * chain. Metadata only (R1): per candidate it reads fetchTableSchema (and,
 * for a bare-year question, the time dimension's code list) — never a cell.
 * Amendment A3's deterministic pre-checks run BEFORE any LLM call; either
 * failure is a VERDICT ('undeliverable', groups with 'geen' — advance), while
 * a schema/code-list/LLM throw is an ERROR (also advance, but counted
 * separately: all-errored must end 'failed' with the honest infra message,
 * never "geen passende maat" — D2b). */
type FitGateOutcome =
  | { kind: 'accepted'; tableId: string }
  | { kind: 'no_fit'; summary: string }
  | { kind: 'all_errored'; summary: string };

async function runFitGate(deps: OnboardingJobDeps, row: PendingTableRequest): Promise<FitGateOutcome> {
  const { db, source } = deps;
  const fit: MeasureFitFn =
    deps.fit ??
    ((question, schema) => {
      if (!deps.fitClient) {
        // Fail loud, per candidate: recorded as 'errored' below, so a
        // misconfigured deployment ends all-errored → failed + refunded —
        // an honest infra failure, never a skipped-gate wrong table.
        throw new Error('onboarding job: fitClient is required when no fit fn is provided');
      }
      return measureFit(question, schema, { client: deps.fitClient });
    });

  let errored = 0;
  for (const candidate of row.candidateIds) {
    let schema;
    try {
      schema = await source.fetchTableSchema(candidate);
    } catch {
      errored += 1;
      continue;
    }

    // A3(a) — time-only dimensions, BEFORE any LLM call: a breakdown/geo
    // dimension means the v1 ingest stores no dims='{}' rows and the
    // vocabulary registers ZERO measures (the actual live #111 failure) — a
    // measure-honest fit would accept it and the row would still die at
    // delivery. 'undeliverable' verdict → next candidate.
    if (!hasOnlyTimeDimensions(schema)) continue;

    // A3(b) — a bare-year question needs whole-year (JJ) period codes
    // (requireGrain('JJ') refuses otherwise). Code list fetched lazily, only
    // when the question actually names a year (metadata read, R1-safe).
    if (questionNamesBareYear(row.questionText)) {
      const timeDim = schema.dimensions.find((d) => d.kind === 'TimeDimension')!;
      let codes;
      try {
        codes = await source.fetchCodeList(candidate, timeDim.name);
      } catch {
        errored += 1;
        continue;
      }
      if (!hasYearlyPeriodCodes(codes)) continue;
    }

    // The measure-fit check (Haiku, closed choice + 'geen', hard allowlist).
    let verdict;
    try {
      verdict = await fit(row.questionText, schema);
    } catch {
      // Throw/invalid output → 'errored', next (D2b) — never a fit, never a
      // misfit.
      errored += 1;
      continue;
    }
    if (verdict.measureCode !== null && verdict.confidence >= DEFAULT_MEASURE_FIT_CONFIG.acceptThreshold) {
      // Accepted: record on the DB row AND the in-memory object (D2a) so a
      // reclaimed retry resumes at ingest — never a second fit loop.
      await setResolvedTable(db, row, candidate, `${verdict.measureCode}: ${verdict.reading}`);
      return { kind: 'accepted', tableId: candidate };
    }
    // 'geen' (or under-threshold) → next candidate.
  }

  if (errored === row.candidateIds.length) {
    return {
      kind: 'all_errored',
      summary:
        'Onverwachte fout bij het ophalen: geen van de kandidaat-tabellen kon bij het CBS worden gecontroleerd.',
    };
  }
  return {
    kind: 'no_fit',
    summary: 'Geen van de onderzochte tabellen bevat een maat die deze vraag beantwoordt.',
  };
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
    // WP27 stage C (ADR 027 D2) — decide WHICH table this row ingests:
    //  - resolvedTableId set → a reclaimed retry after an accepted fit:
    //    resume at ingest deterministically, never re-run the fit loop (D2a).
    //  - empty candidateIds → legacy row: EXACTLY the pre-WP27 path — no fit
    //    gate, no gate schema fetch, no fit LLM (D2c). This is also every
    //    production row until stage D applies migration 015 (pre-015 the
    //    stage-B probe drops the chain, so rows read back []), which keeps
    //    the gate mechanically dormant — and spend-free — until the
    //    owner-supervised live step.
    //  - otherwise → the fit gate picks the first candidate whose measures
    //    answer the question, or ends the row honestly (D2b).
    let targetTableId = row.resolvedTableId ?? row.tableId;
    if (row.resolvedTableId === null && row.candidateIds.length > 0) {
      const gate = await runFitGate(deps, row);
      if (gate.kind === 'all_errored') {
        return await failAndRefund(deps, row, gate.summary);
      }
      if (gate.kind === 'no_fit') {
        return await unanswerableAndRefund(deps, row, gate.summary);
      }
      targetTableId = gate.tableId;
    }

    // Step 3 — piggyback: skip fetch/ingest if the table is already synced.
    // From here on every step reads targetTableId (resolved ?? original);
    // row.tableId itself stays the untouched dedupe identity (D2a).
    if (!(await alreadyIngested(db, targetTableId))) {
      // Step 4 — size + slice.
      const schema = await source.fetchTableSchema(targetTableId);
      const codeLists: Record<string, Awaited<ReturnType<CbsSource['fetchCodeList']>>> = {};
      for (const dim of schema.dimensions) {
        codeLists[dim.name] = await source.fetchCodeList(targetTableId, dim.name);
      }
      const count = await fetchCount(source, targetTableId);
      const estimate = estimateSlice(schema, codeLists, count);
      await recordSliceNote(db, row.id, estimate.note);

      // Step 5 — register + sync (existing validators run inside).
      const synced = await registerAndSync(db, source, targetTableId, estimate.slice ?? undefined);
      if (!synced.ok) {
        return await failAndRefund(deps, row, synced.summary);
      }
    }

    // Step 6 — vocabulary: derive canonical_measures from the ingested measure
    // metadata. Its output is the delivery re-run's extra parser vocabulary.
    const vocab = await registerOnboardingVocabulary(db, {
      tableId: targetTableId,
      topicTerm: row.topicTerm,
    });
    if (vocab.onboarded.length === 0) {
      // Nothing registerable → the delivery re-run can't ever answer. Honest
      // refund, not a fabricated attempt.
      return await unanswerableAndRefund(
        deps,
        row,
        `De opgehaalde tabel ${targetTableId} bevat geen maat die we onder deze vraag konden aanbieden.`,
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

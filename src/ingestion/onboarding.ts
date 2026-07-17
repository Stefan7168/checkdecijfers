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
import { ONBOARDED_KEY_PREFIX, registerOnboardingVocabulary } from './onboarding-vocab.ts';
import type { OnboardedMeasure } from '../answer/intent/prompt.ts';
import type { NotifyFn } from './onboarding-notify.ts';
import {
  claimOnePending,
  finalizeDelivered,
  finalizeFailed,
  finalizeUnanswerable,
  findDeliveredAnswerAuditId,
  getPendingRequest,
  reclaimStaleRunning,
  recordSliceNote,
  recordSliceNoteIfEmpty,
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
  /** #144 (ADR 034): OPTIONAL semantic checker for the delivery re-run — a
   * delivered onboarding answer is exactly as user-visible as a live turn, so
   * the cron route wires it behind the SAME env flags the chat action uses.
   * Absent (tests, dormant flag) → byte-identical pre-#144 behavior. */
  semanticCheck?: AuditedRespondOptions['semanticCheck'];
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

/** The subset of tableIds that are already registered AND have at least one
 * successful sync (last_sync_at set) — design §3 step 3's piggyback predicate
 * as a batched set lookup. EXPORTED since #166: the onboarding finder screens
 * its confident pick AND the alternates in the candidate chain with this SAME
 * predicate (one definition, no drift between the trigger-side and job-side
 * notions of "we already hold this data"), in ONE roundtrip on the live chat
 * path (session-50 follow-up: the per-id loop was 1+N sequential queries). */
export async function alreadyIngestedSet(db: Db, tableIds: readonly string[]): Promise<Set<string>> {
  if (tableIds.length === 0) return new Set();
  const { rows } = await db.query(
    `select id from cbs_tables where id = any($1) and status = 'active' and last_sync_at is not null`,
    [tableIds],
  );
  return new Set(rows.map((r) => String(r.id)));
}

/** Single-table convenience over alreadyIngestedSet — the job's step-3 check. */
export async function alreadyIngested(db: Db, tableId: string): Promise<boolean> {
  return (await alreadyIngestedSet(db, [tableId])).has(tableId);
}

/** The measure codes on this table covered by CURATED vocabulary — rows whose
 * key is NOT 'onboarded:'-prefixed (the two write paths' structural marker:
 * src/registry/defaults.ts short keys vs onboarding-vocab.ts auto-derived
 * keys). #166 job-side belt, per-measure since the session-50 follow-up: Step 6
 * must not auto-derive an `onboarded:<id>:*` row NEXT TO a curated key for the
 * same measure (the #165 duplicate-vocab pollution), while measures WITHOUT
 * curated coverage keep deriving so a partially-curated table stays
 * deliverable. */
export async function curatedMeasureCodes(db: Db, tableId: string): Promise<Set<string>> {
  const { rows } = await db.query(
    `select measure from canonical_measures where table_id = $1 and key not like '${ONBOARDED_KEY_PREFIX}%'`,
    [tableId],
  );
  return new Set(rows.map((r) => String(r.measure)));
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

/** #119 (delivery idempotency, design brief change 2) — shared crash-recovery
 * finalize. Called once a prior attempt's answer-kind audit row has been
 * found (findDeliveredAnswerAuditId, onboarding-store.ts — ⟨F1⟩'s kind='answer'
 * guard lives there). Finalizes the row exactly like the normal step-7
 * success branch below and sends the SAME 'delivered' notify shape — from the
 * user's view this is still exactly-once, because the crash that stranded
 * this row happened BEFORE the first notify ever fired (notify runs strictly
 * after finalize on every path, never before). Shared by both re-entry
 * points a crashed row can take: processOneRow's claim-time check, and
 * runOnboardingJob's exhausted-attempt check — the latter existing
 * specifically so a crash row that hits MAX_ATTEMPTS is finalized-delivered
 * instead of falling into failAndRefund, which would refund a 100-credit
 * charge for an answer the user already received (user keeps answer +
 * refund — a real, if tiny, money leak the original #119 sketch missed). */
async function recoverDelivered(
  deps: OnboardingJobDeps,
  row: PendingTableRequest,
  deliveryAuditAnswerId: number,
): Promise<void> {
  await finalizeDelivered(deps.db, row.id, { deliveryAuditAnswerId });
  await deps.notify({
    userId: row.userId,
    questionText: row.questionText,
    topicTerm: row.topicTerm,
    outcome: 'delivered',
    failureSummary: null,
    refundedCredits: null,
  });
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
    // #119 — crash recovery, FIRST thing in the try block, before ANY
    // ingest/fit/delivery work: a PREVIOUS attempt at this exact row may have
    // already run step 7 below (answerQuestionAudited), written a real
    // answer-kind onboarding_delivery audit row, and then crashed BEFORE
    // finalizeDelivered ran and BEFORE the notify fired. The 20-minute stale
    // reclaim (design §3 step 1) then re-queues this row for another attempt.
    // Re-running the whole pipeline from here would ingest/vocab/deliver a
    // SECOND time: a second onboarding_delivery audit row, a second "Goed
    // nieuws" email, and a dashboard that (per open-questions #119) reads as
    // 200 credits charged for one question. The answer already exists and was
    // never shown to the user (notify always runs strictly after finalize),
    // so finalize + notify exactly once, right here, and STOP — never re-enter
    // the pipeline for a row that already has a real answer on record.
    const recovered = await findDeliveredAnswerAuditId(db, row.requestId);
    if (recovered !== null) {
      await recoverDelivered(deps, row, recovered);
      return 'delivered';
    }

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
    // #166 belt (per-measure since the session-50 follow-up): measures already
    // covered by a CURATED key are excluded from auto-derivation — deriving a
    // parallel `onboarded:<id>:*` row next to a curated key is the exact
    // duplicate-vocab pollution #165 had to clean up in prod. Measures WITHOUT
    // curated coverage still derive, so a partially-curated table stays
    // deliverable for those (charged work keeps its answer route). A question
    // that only the curated vocabulary covers answers via the standard prompt;
    // one that nothing covers ends unanswerable + refund (honest, principle c).
    // Reachable only through the trigger-vs-curation race (the finder guard
    // null-routes an already-ingested pick) or a pre-guard pending row.
    const curated = await curatedMeasureCodes(db, targetTableId);
    const vocab = await registerOnboardingVocabulary(db, {
      tableId: targetTableId,
      topicTerm: row.topicTerm,
      excludeMeasures: curated,
    });
    if (curated.size > 0) {
      const skipNote = `Tabel ${targetTableId} heeft beheerde vocabulaire (curated) voor ${curated.size} van de maten; automatische afleiding daarvoor overgeslagen (#166).`;
      // Durable diagnostic where the note slot is free; a real slice-estimate
      // note (steps 4-5 this attempt, OR a previous attempt that died before
      // Step 6 — the reclaimed-retry case, session-50 review) is never
      // clobbered: the conditional write is a no-op then, console is the floor.
      console.log(`[onboarding ${row.id}] ${skipNote}`);
      await recordSliceNoteIfEmpty(db, row.id, skipNote);
    }
    if (vocab.onboarded.length === 0 && curated.size === 0) {
      // Nothing registerable and no curated route either → the delivery re-run
      // can't ever answer. Honest refund, not a fabricated attempt (the
      // pre-#166 semantics, unchanged for uncurated tables).
      return await unanswerableAndRefund(
        deps,
        row,
        `De opgehaalde tabel ${targetTableId} bevat geen maat die we onder deze vraag konden aanbieden.`,
      );
    }
    const extraVocabulary: OnboardedMeasure[] = vocab.onboarded;

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
      // #144 (ADR 034): same reject-only checker as a live chat turn — absent
      // when the flag is dormant.
      ...(deps.semanticCheck ? { semanticCheck: deps.semanticCheck } : {}),
      extraCanonicalMeasures: extraVocabulary,
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
    // running because of an escaped exception (design §3.8) — EXCEPT a throw
    // that lands AFTER the delivery already succeeded.
    //
    // #119 (extended 2026-07-13, adversarial-review finding): step 7
    // (answerQuestionAudited) COMMITS the delivery audit row BEFORE
    // finalizeDelivered (above) runs, so a throw from that finalize (or any
    // later step) means the answer is delivered AND paid-for. Refunding it here
    // would hand the user their answer AND their 100 credits back — the exact
    // money leak the two OTHER re-entry points already guard against (this
    // function's claim-time recovery check + runOnboardingJob's exhausted-
    // attempt check). Re-check the same way and RECOVER instead of refunding.
    // If recovery itself throws (the same transient DB error), the exception
    // escapes and the row stays 'running' for the 20-minute stale reclaim to
    // retry the top-of-try recovery — degrading to the existing crash-recovery
    // path, never a wrong refund. A genuine failure (no delivery row on record)
    // still terminally fails + refunds below, exactly as before.
    const recovered = await findDeliveredAnswerAuditId(db, row.requestId);
    if (recovered !== null) {
      await recoverDelivered(deps, row, recovered);
      return 'delivered';
    }
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
      // #119 — same crash-recovery check as processOneRow's claim-time entry
      // (recoverDelivered, above), but for the OTHER re-entry point a crashed
      // row can take: one that crashed between the delivery audit write and
      // finalizeDelivered, then got reclaimed enough times to hit
      // MAX_ATTEMPTS instead of being re-claimed promptly. Without this check
      // such a row would fall straight into failAndRefund below and refund a
      // 100-credit charge for an answer the user ALREADY received — the user
      // keeps the answer AND the refund. Finalize-delivered instead; never
      // refund a delivered answer.
      const recovered = await findDeliveredAnswerAuditId(db, row.requestId);
      if (recovered !== null) {
        await recoverDelivered(deps, row, recovered);
        continue;
      }
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

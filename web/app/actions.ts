// The chat UI's only entry point into the backend (ADR 018 decision 3, WP13
// ADR 020): a thin Server Action wrapper around the two audited functions,
// now gated by the billing module (src/billing/, WP13) — never the answer
// pipeline itself. No business logic lives here beyond that gating —
// marshaling plus two infra guards (input-length bound, error logging), so a
// future Route Handler swap (for real stage-status streaming) stays confined
// to this one file.
'use server';

import { randomUUID } from 'node:crypto';

import { redirect } from 'next/navigation';
import { after } from 'next/server';

import {
  answerClarificationReplyAudited,
  answerQuestionAudited,
  deleteUserQuestionHistory,
  deleteThreadQuestionHistory,
  FEEDBACK_TEXT_MAX_LENGTH,
  upsertAnswerFeedback,
} from '../backend/answer/audit/index.ts';
import { buildConversationContext, validateConversationContext } from '../backend/answer/context/index.ts';
// #252: the SAME live `ingestion_batches.request_urls` side-lookup
// replay-assemble.ts and question-history.tsx already wire in — this Server
// Action is the third and last `buildAnswerProof` call site (ADR 048
// Amendment 6, D7(b)), and it is genuinely server-side (unlike chat.tsx's
// own client-side buildAnswerProof call two lines away in the render), so it
// can run the lookup too. Never duplicated SQL: fetchRequestUrlsByBatch is
// the one function that touches `ingestion_batches`.
import { batchIdsForProof, buildAnswerProof, fetchRequestUrlsByBatch } from '../lib/answer-proof.ts';
import type { RequestUrlsByBatch } from '../lib/answer-proof.ts';
// WP218 phase 2: the account-level chart-style wipe, called from
// deleteMyQuestionHistory below. Imported directly from the module, not
// through backend/chart/index.ts's barrel — that store is file-only
// (unwired) until migration 028's supervised apply (see the migration's own
// header), same posture as the retention-job.ts composition roots.
import { deleteUserChartStyle } from '../backend/chart/user-styles.ts';
import type { ConversationContext } from '../backend/answer/context/index.ts';
import { AnthropicLlmClient } from '../backend/answer/llm/client.ts';
import type { ComposedResponse, PendingClarification } from '../backend/answer/respond/types.ts';
// WP26 mechanism A (ADR 024): the click-option trust boundary — the reply
// turn's counterpart to validateConversationContext above.
import { withValidatedClickOptions } from '../backend/answer/respond/validate-pending.ts';
import {
  chargeAndRun,
  compensateSplit,
  getActionClassPrice,
  getBalance,
  reserveWebSearchDebit,
} from '../backend/billing/index.ts';
import type { GatedResponse, SplitDebitResult } from '../backend/billing/index.ts';
// WP129+130 (#130, ADR 032): the Anthropic web-search client is constructed
// HERE (server-only) and injected into the audited pipeline — the barrel is
// the intended construction seam (its own comment says so). SourceSelection is
// the validated structural payload; SOURCES gives the known registry keys the
// untrusted client payload is filtered against.
import { AnthropicWebSearchClient } from '../backend/websearch/index.ts';
import type { SourceSelection } from '../backend/websearch/index.ts';
import { SOURCES } from '../backend/sources/registry.ts';
import { buildOnboardingFinder } from '../backend/ingestion/onboarding-finder.ts';
import { QUESTION_FINDER_CONFIG } from '../backend/catalog/types.ts';
// #148: the 'started' branch below still uses the amount triggerOnboarding
// actually debited (result.credits) for netCost, never a second independent
// price read — that fix is unchanged. onboardingPrice IS imported again as of
// the ADR 026 addendum (session 101): the confirm-first offer shows an
// ESTIMATED price before anything is charged (nothing to read result.credits
// FROM yet), a different case from #148's drift bug — the real charge at
// confirm time always re-reads the live price itself, same as any other
// price display in this product.
import { onboardingPrice, sliceCacheTableIds, triggerOnboarding } from '../backend/ingestion/onboarding-trigger.ts';
import {
  signOnboardingOffer,
  verifyOnboardingOffer,
} from '../backend/ingestion/onboarding-offer-token.ts';
import {
  ONBOARDING_ALREADY_PENDING_TEXT,
  ONBOARDING_ALREADY_PENDING_TEXT_EN,
  ONBOARDING_OFFER_TEXT,
  // I4 fix (2026-09-27 review): the English siblings of the two Dutch
  // overrides below, so an English reader's `response.english.text` gets
  // overridden to match, never left holding ONBOARDING_PENDING_TEXT_EN's
  // "requesting now" wording on a turn that only just asked permission.
  ONBOARDING_OFFER_TEXT_EN,
  ONBOARDING_OFFER_UNAVAILABLE_TEXT,
  ONBOARDING_OFFER_UNAVAILABLE_TEXT_EN,
  ONBOARDING_PENDING_TEXT,
  ONBOARDING_PENDING_TEXT_EN,
  // Breadth step 5 (Task 5): pollTableLane's fail-closed refusal for a
  // finished row whose audit write failed (the same one the pipeline shows).
  toInternalRefusal,
} from '../backend/answer/respond/refusals.ts';
import { loadOnboardedVocabulary } from '../backend/ingestion/onboarding-vocab.ts';
import type { OnboardedMeasure } from '../backend/answer/intent/prompt.ts';
// WP135 (ADR 033): the chat-thread entity (Stage A). A NEW top-level backend
// module reached through the web/backend → ../src symlink. Thread attach is a
// POST-HOC UPDATE on audit rows (never touches the answer pipeline or the
// ledger); replay + context rebuild are existing deterministic code (zero LLM).
import {
  attachOrCreateThread,
  getThreadDatasetId,
  getThreadRows,
  listThreads,
  validateThreadOwnership,
} from '../backend/threads/index.ts';
// ADR 037 D10: loadMyThread's dataset-thread dispatch leg — deterministic,
// zero LLM, exactly like the CBS replay it sits beside.
import { getDatasetTurnsByThread } from '../backend/attachments/read.ts';
import { deleteOneDataset, deleteUserDatasets } from '../backend/attachments/retention.ts';
import { lastChartState, replayDatasetTurns } from '../backend/attachments/replay.ts';
import type { DatasetChatMessage } from '../backend/attachments/replay.ts';
import type { RawDatasetState } from '../backend/attachments/respond.ts';
import { getDataset } from '../backend/attachments/store.ts';
import type { DatasetProfile, DatasetStatus } from '../backend/attachments/types.ts';
import type { ThreadSummary } from '../backend/threads/index.ts';
import { rebuildContext, replayParts } from '../backend/threads/replay.ts';
import { assembleMessages } from '../lib/replay-assemble.ts';
import type { ChatMessage } from '../lib/replay-assemble.ts';
import { currentUserId } from '../lib/current-user.ts';
import { getDb } from '../lib/db.ts';
// ADR 058 (English answers, Task 8): the reader's language + the resulting
// audited-options gate. `englishAnswerOptions` lives outside this 'use server'
// file (a plain sync export here would break the build) — see its own header
// comment for the dormancy discipline (byte-identical Dutch path unless BOTH
// ENGLISH_ANSWERS_ENABLED='1' AND the reader is on English).
import { englishAnswerOptions } from '../lib/english-answers.ts';
import { getLang } from '../lib/i18n/server.ts';
// #65 / WP25: durable error logging at the outermost catch sites. Fail-open by
// contract (reportError never throws) — see web/lib/error-report.ts.
import { reportError } from '../lib/error-report.ts';
import { kickOnboardingJob } from '../lib/onboarding-kick.ts';
// Breadth step 5 (Task 5): the table lane — its store (our db only), its job
// kick (post-response, like the onboarding kick) and its request-path helpers.
import {
  createTableLaneRequest,
  readTableLaneAuditResult,
  readTableLaneDimensionMembers,
  readTableLaneNetCost,
  readTableLaneRequest,
} from '../backend/ingestion/table-lane-store.ts';
import type { TableLaneEnvelope } from '../backend/answer/table-lane/types.ts';
import type { TableLaneRow } from '../backend/ingestion/table-lane-store.ts';
import { buildTableLaneRefusal } from '../backend/answer/table-lane/templates.ts';
import type { OnboardingRouting, TableFinder } from '../backend/answer/intent/policy.ts';
import { kickTableLaneJob } from '../lib/table-lane-kick.ts';
import { matchBreakdownReply, tableLaneEnabled } from '../lib/table-lane.ts';
import type { PollTableLaneOutcome, ReplyTableLaneChoice, ReplyTableLaneOutcome, TableLaneFoundTable } from '../lib/table-lane.ts';
export type { PollTableLaneOutcome, ReplyTableLaneChoice, ReplyTableLaneOutcome, TableLaneFoundTable } from '../lib/table-lane.ts';
import { referenceDate, semanticCheckOptions } from '../lib/turn-options.ts';
import { createClient } from '../lib/supabase-server.ts';
// #149 (session-47 hunt): the SAME UUID-shape check the trial action already
// uses (trial-actions.ts) — reused, not duplicated, to close the identical
// gap on the paid path below.
import { isUuid } from '../lib/trial.ts';

// Auth check happens HERE, inside the Server Action — not only in proxy.ts.
// Next's own data-security guidance is explicit that a Proxy matcher is an
// optimistic check, never the authorization boundary: a matcher change or a
// Server Function moved to a different route can silently stop being
// covered by Proxy without anyone noticing, so every Server Function must
// verify itself (web/lib/current-user.ts).

// referenceDate() — 'today' in Europe/Amsterdam, the one un-pinned clock —
// and semanticCheckOptions() (#144) live in web/lib/turn-options.ts, shared
// with the onboarding-cron delivery re-run and the table-lane job.

// Infra guard, not a pipeline rule: bounds single-request token spend on the
// public endpoint (the client input caps at 500 chars; this is the belt
// behind it). Throwing here produces no response at all — nothing is shown,
// so nothing needs auditing (R8 governs produced responses). Rate limiting
// proper stays Phase 1–2 (docs/03 non-goals, ADR 005).
const MAX_INPUT_LENGTH = 2000;

// TYPE FIRST, THEN SIZE. `text` is a Server Action ARGUMENT — attacker-
// controlled, and its declared `string` type is erased at runtime. Checking
// only `.length` lets any object with a small `.length` through, and the
// dangerous shape is specific and cheap to send: an Anthropic content-block
// array, `[{ type: 'text', text: <400 kB> }]`, whose `.length` is 1. It then
// flows verbatim into `messages: [{ role: 'user', content: request.question }]`
// (src/answer/llm/client.ts) — where the API ACCEPTS it, because it is valid
// input — driving a prompt bounded only by Next's request-body limit (~1 MB,
// some 500x this ceiling) at the same flat credit price, and on the anonymous
// path for one pot question.
//
// guardPending below already type-checks every field it bounds, for exactly
// this reason and naming exactly this threat ("array-stuffed"); the top-level
// arguments were simply never given the same check (found by the trial-surface
// hunt, 2026-07-25 — it reaches the PAID path too, not only the trial).
function guardLength(text: string): void {
  if (typeof text !== 'string') {
    throw new Error(`input rejected: not a string within ${MAX_INPUT_LENGTH} chars`);
  }
  if (text.length > MAX_INPUT_LENGTH) {
    throw new Error(`input rejected: ${text.length} chars exceeds ${MAX_INPUT_LENGTH}`);
  }
}

/** The billing idempotency key is client-generated and equally untrusted: it
 * becomes `credit_transactions.request_id`, the one thing standing between a
 * double-submit and a double debit. The trial action has always type-checked
 * it (trial-actions.ts); the paid path had not. Same bound, same reason.
 *
 * #149 (session-47 hunt, closed session 66): length/type alone let a
 * well-typed but non-UUID string (truncated, hand-typed, or otherwise
 * malformed) through to `reserveDebit`'s SQL, where the uuid-typed
 * `credit_transactions.request_id` column rejects it with a raw Postgres
 * "invalid input syntax for type uuid" error INSIDE the transaction —
 * rolled back cleanly (no debit, no spend; fail-safe for money either way)
 * but surfacing as a masked 500 from deep inside the DB layer instead of a
 * clean, well-labeled guard-clause error at the top of the action (worse
 * logs/observability, no other consequence — the real client always sends
 * `crypto.randomUUID()`, and chat.tsx already catches the rejection and
 * shows a normal retry). `isUuid` (web/lib/trial.ts) already closed this
 * exact gap for the anonymous trial action; reused here rather than
 * duplicated, so the two paths can't drift onto different shape checks. */
const MAX_REQUEST_ID_LENGTH = 100;

function guardRequestId(requestId: string): void {
  if (
    typeof requestId !== 'string' ||
    requestId.length === 0 ||
    requestId.length > MAX_REQUEST_ID_LENGTH ||
    !isUuid(requestId)
  ) {
    throw new Error(`input rejected: malformed requestId`);
  }
}

// The same spend belt, applied to the PendingClarification a reply turn carries.
// `pending` is client-held and sent back verbatim (like rawContext/rawSelection)
// — attacker-controlled, and its type is not enforced at runtime. Its
// question/questionNl/options flow VERBATIM into the clarify LLM prompt
// (src/answer/intent/clarify.ts buildClarifyUserPayload), yet guardLength above
// only bounds the top-level `reply`/`question` args — so without this belt an
// oversized (or array-stuffed) pending drives an unbounded prompt to the model
// at the SAME flat 'simple'/'clarification' price, a cost-asymmetry drain on the
// owner's real API spend (found session 47, billing-path hunt). Bounds every
// prompt-bound field to the same MAX_INPUT_LENGTH ceiling and caps the option/
// axis lists, and — like guardLength — THROWS before the billing gate debits, so
// a rejected payload costs no credit, no LLM call and writes no audit row (R8
// governs produced responses). Throw, not degrade: a legitimate pending is
// server-generated and always well under the bound, and chat.tsx already catches
// the rejected action and shows its normal retry message. Real rate limiting
// stays Phase 1–2 (docs/03 non-goals, ADR 005) — this only closes the belt gap.
const MAX_PENDING_OPTIONS = 20;

function guardPending(pending: PendingClarification): void {
  for (const [field, value] of [
    ['question', pending.question],
    ['questionNl', pending.questionNl],
    ['referenceDate', pending.referenceDate],
  ] as const) {
    if (typeof value !== 'string' || value.length > MAX_INPUT_LENGTH) {
      throw new Error(`pending.${field} rejected: not a string within ${MAX_INPUT_LENGTH} chars`);
    }
  }
  for (const [field, arr] of [
    ['options', pending.options],
    ['axes', pending.axes],
  ] as const) {
    if (!Array.isArray(arr) || arr.length > MAX_PENDING_OPTIONS) {
      throw new Error(`pending.${field} rejected: not an array within ${MAX_PENDING_OPTIONS} entries`);
    }
  }
  // Entries, not just the array length. `options` was already bounded; `axes`
  // was not, so twenty megabyte-sized strings passed the belt and were then
  // persisted verbatim into audit_answers.pending_clarification.
  for (const [field, arr] of [
    ['options', pending.options],
    ['axes', pending.axes],
  ] as const) {
    for (const entry of arr as unknown[]) {
      if (typeof entry !== 'string' || entry.length > MAX_INPUT_LENGTH) {
        throw new Error(
          `pending.${field} entry rejected: not a string within ${MAX_INPUT_LENGTH} chars`,
        );
      }
    }
  }
  // The reply must resolve relative periods against the SAME clock as the
  // original parse, and this is the field that carries it. A length check is
  // not enough: it is fed straight to parseReferenceDate, which accepts only
  // YYYY-MM-DD. A well-formed LIE ("2019-01-01") silently moves what "vorige
  // maand" means; a malformed one throws deep in the parse and surfaces as an
  // 'internal' refusal, which also fires an admin alert — an amplifier a
  // client should not be able to hold. Same regex as parseReferenceDate, kept
  // deliberately literal so the two cannot drift apart unnoticed.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(pending.referenceDate)) {
    throw new Error('pending.referenceDate rejected: not a YYYY-MM-DD date');
  }
  // WP26 mechanism A (ADR 024, take-path A2): the click options ride the same
  // client-held pending. They never enter a prompt (the deterministic rung is
  // the only reader), so the spend asymmetry above does not apply — but the
  // ARRAY still has to be bounded before anything walks it. Shape validation
  // of the intents themselves is fail-closed, not throwing:
  // withValidatedClickOptions below drops what does not check out and the reply
  // takes the normal LLM merge, which is exactly today's behavior.
  if (pending.clickOptions !== undefined) {
    if (!Array.isArray(pending.clickOptions) || pending.clickOptions.length > MAX_PENDING_OPTIONS) {
      throw new Error(
        `pending.clickOptions rejected: not an array within ${MAX_PENDING_OPTIONS} entries`,
      );
    }
  }
}

// ADR 026 addendum (session 101): the onboarding offer token is NOT free text
// — it never reaches an LLM prompt, so MAX_INPUT_LENGTH's rationale (bounding
// prompt-driven spend) does not apply to it. But it DOES embed `questionText`
// (itself bounded to MAX_INPUT_LENGTH by guardLength at mint time) plus the
// rest of OnboardingOfferPayload, base64url-encoded, plus an HMAC signature —
// so a plain reuse of `guardLength`'s 2000-char cap is too SMALL and would
// reject a legitimate token for any question anywhere near that length
// (code-review finding: a 2000-char question mints a ~3158-char token). 8000
// comfortably covers the worst realistic case (two ~2000-char string fields,
// JSON + base64 overhead, the signature) with headroom, while still bounding
// SOMETHING before any work happens — the same "guard before any billing
// touches it" discipline guardLength/guardPending already apply, sized
// correctly for what this string actually is.
const MAX_ONBOARDING_OFFER_TOKEN_LENGTH = 8000;

function guardOnboardingOfferToken(token: string): void {
  if (typeof token !== 'string' || token.length === 0 || token.length > MAX_ONBOARDING_OFFER_TOKEN_LENGTH) {
    throw new Error(`onboarding offer token rejected: not a string within ${MAX_ONBOARDING_OFFER_TOKEN_LENGTH} chars`);
  }
}

// WP129+130 (#129, ADR 032): the source-tags selection is UNTRUSTED client
// input (a Server Action argument — attacker-controlled, like every other one
// here). It is coerced to a SourceSelection BEFORE the billing gate and NEVER
// throws: any malformed shape degrades to `undefined` (the legacy no-selection
// behavior, byte-identical to a pre-WP submit). `sources` is filtered to KNOWN,
// chat-selectable registry keys — an unknown OR a registered-but-dormant key
// (WP30c/E1: `chatSelectable: false`, e.g. 'eurostat') is dropped, never
// trusted. This is the SAME gate `chat.tsx`'s chip UI uses (SourceInfo's
// `chatSelectable`) — deliberately one load-bearing flag, not two independent
// ones that could drift: a crafted payload naming a real-but-dormant source
// key must be refused here even though the client UI never offers it, so a
// future source's public exposure flips on in exactly one place (D3(d)'s
// owner-signed sweep), never by accident via this validator alone continuing
// to accept a key nothing else has decided is public yet. `web` is coerced to
// a strict boolean. When WEBSEARCH_ENABLED !== '1' the whole selection is
// FORCED to undefined (the server belt behind the dormant UI): a crafted
// payload cannot reach the web path while the feature is dormant, so
// `selection?.web === true` anywhere below already implies the flag is on.
function validateSelection(raw: unknown): SourceSelection | undefined {
  if (process.env.WEBSEARCH_ENABLED !== '1') return undefined;
  if (raw === null || typeof raw !== 'object') return undefined;
  const obj = raw as { sources?: unknown; web?: unknown };
  if (!Array.isArray(obj.sources)) return undefined;
  const known = new Set(Object.keys(SOURCES).filter((key) => SOURCES[key]!.chatSelectable));
  const sources = obj.sources.filter((s): s is string => typeof s === 'string' && known.has(s));
  return { sources, web: obj.web === true };
}

// WP26 mechanism A (ADR 024): the clickable-clarification rollout flag —
// DORMANT until the owner-supervised go-live sets CLARIFY_CLICK_ENABLED='1'
// (the #53/#144 dormancy pattern). While unset, policy.ts builds no options,
// runs no extra dry-runs, serializes no extra envelope bytes, and the
// deterministic take-rung in respond.ts is inert: every turn behaves exactly
// as it did before WP26. Rolled back by unsetting it — a pending offered while
// it was on simply falls through to the normal LLM merge afterwards.
function clickOptionsEnabled(): boolean {
  return process.env.CLARIFY_CLICK_ENABLED === '1';
}

// WP26 mechanism B (ADR 024): the answer-first defaults — same dormancy
// pattern. While ANSWER_FIRST_ENABLED is unset, the query layer defaults no
// axis: a question with no region on a geo measure clarifies exactly as it does
// today. Independent of CLARIFY_CLICK_ENABLED so the owner can go live with,
// and roll back, each mechanism on its own.
function answerFirstEnabled(): boolean {
  return process.env.ANSWER_FIRST_ENABLED === '1';
}

// #162 (ADR-DRAFT slot-filling, hermetic half): the number-free-phrasing
// experiment rung. DORMANT — the flag stays UNSET until the owner-supervised
// A/B (blind pairwise phrasing judge + owner read-back, ADR-draft §6) decides;
// while unset every compose call runs the see-and-echo ladder byte-identically.
// Same dormancy pattern as SEMANTIC_CHECK_ENABLED / ONBOARDING_ENABLED.
function slotPhrasingEnabled(): boolean {
  return process.env.SLOT_PHRASING_ENABLED === '1';
}

// #112 (the go-live money bug): a fresh chat turn must KNOW what has already
// been onboarded, or re-asking an answered topic re-triggers the full
// 100-credit onboarding instead of answering at the normal question price.
// Rides the SAME master switch as the finder and the history read (the
// session-27 incident rule: while dormant, no code path may touch
// onboarding-owned state) and fails SOFT: a load failure degrades this turn
// to the Phase-0 vocabulary — worst case is exactly yesterday's behavior
// (the finder path), never a blocked or unanswered turn.
async function onboardedVocabulary(): Promise<OnboardedMeasure[]> {
  if (process.env.ONBOARDING_ENABLED !== '1') return [];
  try {
    return await loadOnboardedVocabulary(getDb());
  } catch (error) {
    console.error('onboarded-vocabulary load failed (turn continues with Phase-0 vocabulary):', error);
    return [];
  }
}

// WP15 (ADR 021): what the chat gets back on every submit — the billing
// envelope unchanged, plus the structured context the CLIENT should hold and
// send back on the next question. `context` is null whenever the response
// leaves no honest referent (clarifications, parse-level refusals, a gated
// non-'ok' outcome) — the caller (chat.tsx) must then keep whatever context
// it already held, never overwrite it with null (ADR 021 decision 1: a
// smalltalk/refusal detour must not erase the referent).
export interface AskOutcome {
  gated: GatedResponse;
  context: ConversationContext | null;
  /** WP135 (ADR 033 D1): the thread this turn attached to — lazily created on
   * the first completed question of a fresh chat, or the resumed thread's id.
   * Null when the caller sent no rawThreadId (Dashboard/benchmark/runner paths,
   * byte-identical to today) or when nothing was attachable (a failed attach
   * degrades to a threadless-but-audited answer). The client adopts it for the
   * next turn and captures it alongside a pending clarification (⟨A6⟩). */
  threadId: number | null;
  /** ADR 026 addendum (session 101): present only on the turn where the
   * finder just confidently matched an unloaded topic and the confirm-first
   * gate minted a signed offer instead of triggering the fetch immediately
   * (#109's reversal, owner decision 4). `priceCredits` is a live-read
   * ESTIMATE for display only — the real charge at confirm time re-reads the
   * price itself, same as every other price shown in this product. Null on
   * every other outcome, including 'onboarding_already_pending' (nothing new
   * to confirm) and a resumed/replayed thread (never reconstructed on
   * replay, same posture as `carrier` — ADR 033 ⟨A6⟩). */
  onboardingOffer: { token: string; priceCredits: number } | null;
  /** #252: the live `ingestion_batches.request_urls` lookup for this turn's
   * own proof (present only on a gated-ok 'answer' response — every other
   * kind, including a refusal/clarification/non-'ok' gate, has no proof to
   * look up against and stays `null`, same as `proof` itself on the client
   * message). Computed AFTER the answer/debit is already settled below
   * (outcomeProofRequestUrls), never inside chargeAndRun's charged section —
   * a lookup hiccup must cost this turn's URL badges, never its answer or
   * its charge. Threading this through AskOutcome is what lets chat.tsx set
   * `message.proofRequestUrls` for a LIVE turn exactly as
   * replay-assemble.ts / question-history.tsx already do for a resumed one
   * (previously `null` there always — the last of the three
   * `buildAnswerProof` call sites ADR 048 Amendment 6 named, see
   * open-questions #252). */
  proofRequestUrls: RequestUrlsByBatch | null;
  /** Breadth step 5 (Task 5): present only on the turn askQuestion routed to
   * the table lane (TABLE_LANE_ENABLED, a thread-aware curated miss the finder
   * matched to a CBS table): the queued table_lane_requests row the client
   * polls (pollTableLane) while it shows a progress bubble instead of this
   * turn's routing refusal. Null on every other outcome. */
  /** Session 153 (#363): the found CBS table travels with the row id so the
   * waiting bubble can say what it found while the job runs. */
  tableLane: { rowId: number; table?: TableLaneFoundTable } | null;
}

// WP135 ⟨A1⟩: the ONLY thread write from the request path — a post-hoc UPDATE
// after the pipeline returns, run ONLY on a gated-ok outcome carrying an audit
// id (insufficient_credits, duplicate_request, the ⟨W4⟩ early return, and thrown
// exceptions never reach here — so a thread is created lazily, never empty).
// attachOrCreateThread THROWS on a non-attachable row; a failed attach must
// never block or roll back an already-audited answer, so it degrades to a
// threadless (logged) answer. Called only when the caller is thread-aware
// (rawThreadId !== undefined); the Dashboard/benchmark path never is.
async function attachThread(
  settled: GatedResponse,
  userId: string,
  validatedThreadId: number | null,
): Promise<number | null> {
  if (settled.kind !== 'ok' || settled.auditId === null) return null;
  try {
    return await attachOrCreateThread(getDb(), userId, validatedThreadId, settled.auditId);
  } catch (error) {
    console.error('thread attach failed (answer still returned, threadless):', error);
    return null;
  }
}

/** gated.kind === 'ok' -> the context handed to the NEXT turn, built from
 * this turn's own response; every other kind -> null (nothing was produced
 * to derive a referent from). Deterministic, server-side only — the client
 * never constructs a ConversationContext itself.
 *
 * Fail-open on the build itself: by the time this runs the answer is already
 * produced, audited AND debited — a context-derivation hiccup may cost the
 * NEXT turn its referent, never the user this turn's paid answer. */
async function outcomeContext(gated: GatedResponse): Promise<ConversationContext | null> {
  if (gated.kind !== 'ok') return null;
  try {
    return await buildConversationContext(getDb(), gated.response);
  } catch (error) {
    console.error('conversation-context build failed (answer still returned):', error);
    return null;
  }
}

/** #252: this turn's own `ingestion_batches.request_urls`, fetched
 * ALONGSIDE (never inside) the already-settled gated response — the same
 * outcomeContext posture above, applied to the proof panel's URL badges
 * instead of the next turn's referent. `null` on every non-'ok' gate, every
 * non-'answer' response kind (a refusal/clarification carries no validated
 * cells to look batch ids up from — buildAnswerProof would return null for
 * it anyway, same belt question-history.tsx already relies on), and on a
 * `buildAnswerProof` miss (a redacted/malformed envelope, R8's own
 * degradation). Never throws: `fetchRequestUrlsByBatch` already degrades to
 * `{}` on any DB error or absent batch row, and the try/catch here is
 * defense-in-depth around `buildAnswerProof`/`batchIdsForProof` themselves —
 * by the time this runs the answer is already produced, audited AND
 * debited, so a hiccup here must cost only this turn's URL badges, never the
 * answer or the charge the user already paid for. */
async function outcomeProofRequestUrls(gated: GatedResponse): Promise<RequestUrlsByBatch | null> {
  if (gated.kind !== 'ok' || gated.response.kind !== 'answer') return null;
  try {
    const proof = buildAnswerProof(gated.response);
    if (proof === null) return null;
    return await fetchRequestUrlsByBatch(getDb(), batchIdsForProof(proof));
  } catch (error) {
    console.error('proof request-urls lookup failed (answer still returned):', error);
    return null;
  }
}

// requestId: a client-generated UUID (crypto.randomUUID(), one per submit —
// chat.tsx) threaded all the way into the billing gate's idempotency key
// (credit_transactions_one_debit_per_request). Without it, a Server Action
// re-invoked by a browser retry or a double submit would debit the same
// logical question twice.
//
// rawContext: the client-held ConversationContext from a PRIOR turn, sent
// back verbatim (untrusted — see web/backend/answer/context/validate.ts).
// Validated BEFORE the billing gate even runs: a garbage context must
// degrade to a standalone parse, never affect gating or throw.
export async function askQuestion(
  question: string,
  requestId: string,
  rawContext?: unknown,
  rawSelection?: unknown,
  // WP135 ⟨A1⟩: the client's active thread id (null on a fresh chat, a number
  // to continue one). ABSENT (undefined) ⇒ the caller is not thread-aware
  // (Dashboard/benchmark/runner) and NO thread work happens at all — today's
  // behavior byte-identical; benchmark rows keep thread_id NULL.
  rawThreadId?: unknown,
  // Breadth step 5 (Task 7): the row id of the previous table-lane ANSWER in
  // this conversation (untrusted, client-held — see validateTableLaneFollowUp).
  // Read only behind TABLE_LANE_ENABLED on a thread-aware turn; absent or
  // invalid ⇒ today's path exactly.
  rawTableLaneFollowUp?: unknown,
): Promise<AskOutcome> {
  guardLength(question);
  guardRequestId(requestId);
  // ADR 058 (English answers, Task 8): read once per action (never per
  // pipeline stage) — the SAME server-only cookie-then-Accept-Language
  // resolution the header/layout already use (web/lib/i18n/server.ts).
  const lang = await getLang();
  const userId = await currentUserId();
  if (userId === null) {
    return { gated: { kind: 'unauthenticated' }, context: null, threadId: null, onboardingOffer: null, proofRequestUrls: null, tableLane: null };
  }
  // ⟨A1⟩ READ-ONLY ownership check (never an INSERT); a forged/foreign id
  // coerces to null → a fresh thread, never a cross-attach, never a leak.
  const threadAware = rawThreadId !== undefined;
  const validatedThreadId = threadAware
    ? await validateThreadOwnership(getDb(), userId, rawThreadId)
    : null;
  const conversationContext = await validateConversationContext(getDb(), rawContext ?? null);
  // WP129+130 (#129, ADR 032): validate the untrusted selection payload BEFORE
  // the gate (never throws; forced undefined while the flag is off).
  const selection = validateSelection(rawSelection);
  // Breadth step 5 (Task 7): the follow-up link, validated BEFORE the gate
  // (read-only, never throws). Flag off or not thread-aware ⇒ never read.
  const followUp =
    threadAware && tableLaneEnabled() && rawTableLaneFollowUp !== undefined
      ? await validateTableLaneFollowUp(userId, requestId, rawTableLaneFollowUp, validatedThreadId)
      : null;
  // ⟨W4⟩ Upfront affordability (UX only, race-tolerated): a web-opted turn
  // transiently needs simple + web_addon = 30 in BOTH modes — the untouched
  // gate holds the base 20 before the pipeline, and the web reserve of 10
  // happens INSIDE it, before the refund posts, so 30 must be AVAILABLE even
  // though web-only NETS 10. (`selection?.web === true` implies the flag is on
  // — validateSelection forces undefined otherwise.) The race with the gate is
  // tolerated by the reserve closure's honest skip (insufficient_balance
  // section, no charge).
  const webAddonPrice = selection?.web === true ? await getActionClassPrice(getDb(), 'web_addon') : 0;
  if (selection?.web === true) {
    const simplePrice = await getActionClassPrice(getDb(), 'simple');
    const required = simplePrice + webAddonPrice;
    const balance = await getBalance(getDb(), userId);
    if (balance < required) {
      // ⟨W4⟩/⟨A1⟩ early return: no gate, no audit id ⇒ no thread (lazy by
      // construction — an empty thread is never created here).
      return { gated: { kind: 'insufficient_credits', balance, required }, context: null, threadId: null, onboardingOffer: null, proofRequestUrls: null, tableLane: null };
    }
  }
  // #112: loaded BEFORE the billing gate — the load is read-only and must
  // never run (or fail) inside the charged section.
  const extraVocabulary = await onboardedVocabulary();
  // WP129+130 (#130, ADR 032): the taken web debit lives in this holder so the
  // settlement (and the catch) below can keep-or-refund it. The reserve()
  // closure sets it INSIDE the pipeline (debit-before-spend).
  const webDebitHolder: { split: SplitDebitResult | null } = { split: null };
  try {
    const gated = await chargeAndRun(getDb(), userId, requestId, () =>
      answerQuestionAudited(getDb(), question, {
        referenceDate: referenceDate(),
        userId,
        sourceTag: 'user',
        requestId,
        conversationContext,
        intentClient: new AnthropicLlmClient(),
        answerClient: new AnthropicLlmClient(),
        // #144 (ADR 034): the reject-only semantic checker — dormant until the
        // supervised go-live sets the env flags (see semanticCheckOptions).
        ...semanticCheckOptions(),
        // #162: the slot-phrasing experiment rung — dormant (flag unset).
        slotPhrasing: slotPhrasingEnabled(),
        // #112: the already-onboarded vocabulary, so a repeat question on an
        // onboarded topic parses onto its 'onboarded:' key and answers
        // directly (normal price) — the finder below only sees topics the
        // parse could NOT match. [] while the switch is off or nothing is
        // onboarded → prompt bytes identical to the calibrated Phase-0 one.
        extraCanonicalMeasures: extraVocabulary,
        // WP26 mechanisms A + B (ADR 024): dormant until the supervised flips.
        clickOptionsEnabled: clickOptionsEnabled(),
        answerFirstEnabled: answerFirstEnabled(),
        // WP129+130 (#129, ADR 032): the validated selection rides the audited
        // options as a STRUCTURAL input (never prompt text) — respond* uses it
        // for the web-only / no-sources pre-parse belt, and attach uses it to
        // decide whether a web attempt is owed. Absent ⇒ byte-identical.
        ...(selection !== undefined ? { sourceSelection: selection } : {}),
        // WP129+130 (#130, ADR 032): the web client + reserve() closure are
        // constructed ONLY when WEBSEARCH_ENABLED='1' AND the Internet chip is
        // selected — the ONBOARDING_ENABLED dormancy pattern: until the RUNBOOK
        // go-live sets the flag + applies migration 018, no path constructs the
        // Anthropic web client or touches the websearch_cost ledger row, so
        // production behaves byte-identically pre-WP129+130. The closure debits
        // INSIDE the pipeline (debit-before-spend) and stashes the taken entry
        // in webDebitHolder for the settlement below.
        ...(process.env.WEBSEARCH_ENABLED === '1' && selection?.web === true
          ? {
              webClient: new AnthropicWebSearchClient(),
              webBilling: {
                reserve: async (): Promise<boolean> => {
                  const reserved = await reserveWebSearchDebit(getDb(), userId, requestId, webAddonPrice);
                  if (reserved.kind === 'debited') {
                    webDebitHolder.split = reserved.split;
                    return true;
                  }
                  // insufficient (a race the upfront check tolerates) or
                  // duplicate (unreachable — the base gate short-circuits a
                  // duplicate requestId before run() executes): honest skip.
                  return false;
                },
              },
            }
          : {}),
        // WP16 sub-part 2 (ADR 026): the table finder is injected ONLY here —
        // an unloaded topic the finder confidently maps to a CBS table becomes
        // an 'onboarding_pending' acknowledgment instead of the B15
        // clarification. Absent everywhere else (benchmark, tests, the reply
        // action below), so the unmatched exit stays byte-identical there.
        // Gated on ONBOARDING_ENABLED='1' so "dormant until the supervised
        // live step" is mechanical, not aspirational: until the RUNBOOK step
        // applies migrations 012+013 and sets the env vars, production
        // behaves byte-identically pre-WP16 — no finder, no per-question
        // rerank spend, no path that can touch the not-yet-migrated tables.
        //
        // Breadth step 5 (Task 7, fix round 1 Ruling R14): a validated
        // follow-up link wraps the finder slot as a FALLBACK — the real finder
        // (when ONBOARDING_ENABLED) runs first and a confident pick of a
        // DIFFERENT table wins; otherwise the previous lane answer's table is
        // used. The slot is consulted only on a curated miss (the unmatched
        // exit), so a curated hit always wins. `followUp` is null whenever the
        // flag is off, so the ONBOARDING_ENABLED branch below is then exactly
        // today's.
        ...(followUp !== null
          ? {
              tableFinder: tableLaneFollowUpFinder(
                followUp,
                process.env.ONBOARDING_ENABLED === '1'
                  ? buildOnboardingFinder({ db: getDb(), userId, rerankClient: new AnthropicLlmClient() })
                  : undefined,
              ),
            }
          : process.env.ONBOARDING_ENABLED === '1'
            ? {
                tableFinder: buildOnboardingFinder({
                  db: getDb(),
                  userId,
                  rerankClient: new AnthropicLlmClient(),
                }),
              }
            : {}),
        // Session 153 (the front door): behind TABLE_LANE_ENABLED, a question
        // the parser calls out_of_scope is still searched for a CBS table
        // (recall 'any' mode over the whole question); a confident pick goes
        // to the table lane below, otherwise the out_of_scope refusal stands.
        // Thread-aware callers only, like the lane itself. Flag off ⇒ absent ⇒
        // byte-identical.
        ...(threadAware && tableLaneEnabled() && process.env.ONBOARDING_ENABLED === '1'
          ? {
              questionFinder: buildOnboardingFinder({
                db: getDb(),
                userId,
                rerankClient: new AnthropicLlmClient(),
                recall: { mode: 'any' },
                findConfig: QUESTION_FINDER_CONFIG,
                searchTermsClient: new AnthropicLlmClient(),
              }),
            }
          : {}),
        // ADR 058 (English answers, Task 8): dormant unless
        // ENGLISH_ANSWERS_ENABLED='1' AND the reader is on English — {} ⇒
        // byte-identical to today (englishAnswerOptions's own dormancy).
        ...englishAnswerOptions(lang),
      }),
    );
    // Breadth step 5 (Task 5): behind TABLE_LANE_ENABLED, a thread-aware
    // curated miss the finder matched to a CBS table goes to the table lane
    // (answered at the normal question price by the background job) instead
    // of the 100-credit onboarding offer below. The routing turn itself stays
    // free (the gate already refunded its refusal) and is NOT attached to the
    // thread — the job attaches the lane's own audited answer. Only
    // thread-aware callers (the workspace chat): the job creates a thread when
    // the row has none, which a threadless caller (Dashboard) would never
    // show. Flag off (or not thread-aware) ⇒ this block is skipped and the
    // code below runs exactly as before.
    // Fix round 1 (review Minor 1): set when a FOLLOW-UP LINK routing could
    // not be queued while onboarding is dormant (see below).
    let dormantLinkFailure = false;
    // Final review M1: on a routable turn the web add-on is settled FIRST —
    // before the lane row (and its debit) is created and before the kick —
    // so a throwing settlement leaves nothing queued or charged. The holder is
    // cleared once settled, so no later path (nor the catch) settles it again.
    // Flag off (or not routable) ⇒ laneGated is `gated` itself and the code
    // below runs exactly as before.
    let laneGated: GatedResponse = gated;
    if (threadAware && tableLaneEnabled() && tableLaneRoutable(gated) !== null) {
      laneGated = await settleWebAddon(gated, webDebitHolder.split, webAddonPrice, userId);
      webDebitHolder.split = null;
      const routed = await routeToTableLane(laneGated, { userId, requestId, question, lang, validatedThreadId, followUp });
      if (routed !== null && routed.kind === 'failed') {
        // Nothing was charged (one transaction). A finder routing falls back
        // to today's offer path (Task 5). A LINK routing exists even with
        // ONBOARDING_ENABLED off, so there it must never reach the offer
        // path: the turn becomes the lane's own free failure text instead.
        dormantLinkFailure = routed.fromLink && process.env.ONBOARDING_ENABLED !== '1';
      } else if (routed !== null) {
        if (routed.kind === 'insufficient') {
          // The routing refusal was refunded by the gate; the (normally
          // absent) web add-on was already settled above.
          return {
            gated: { kind: 'insufficient_credits', balance: routed.balance, required: routed.required },
            context: null,
            threadId: null,
            onboardingOffer: null,
            proofRequestUrls: null,
            tableLane: null,
          };
        }
        after(() => kickTableLaneJob());
        const found = await foundTableFor(tableLaneRoutable(gated)?.tableId ?? null);
        return {
          gated: laneGated,
          context: null,
          threadId: validatedThreadId,
          onboardingOffer: null,
          proofRequestUrls: null,
          tableLane: { rowId: routed.rowId, ...(found !== null ? { table: found } : {}) },
        };
      }
    }
    // WP16 sub-part 2 (ADR 026, design §2; confirm-first addendum, session
    // 101): if the pipeline acknowledged an onboarding fetch, the gate already
    // fully refunded the 20-credit question debit (net 0). Since #109's
    // reversal this step no longer spends the 100-credit fetch itself — it
    // mints a signed, stateless offer instead (confirmOnboardingFetch below
    // does the actual charge+queue, only on an explicit click). This step
    // never fabricates: it only reads a refusal the pipeline already produced
    // and audited, and its own failure (secret unset) degrades to an honest
    // "not available right now" with nothing charged or queued.
    const { gated: finalGated, offer } = dormantLinkFailure
      ? { gated: withTableLaneFailedText(laneGated), offer: null }
      : await maybeTriggerOnboarding(laneGated, {
          userId,
          requestId,
          question,
        });
    // ⟨W3⟩ Web add-on settlement on the FINAL gated object (post-onboarding) —
    // keep the +10 iff a cited web section shipped on an audited 'ok' turn,
    // else refund the taken debit (a no-op when none was taken).
    const settled = await settleWebAddon(finalGated, webDebitHolder.split, webAddonPrice, userId);
    // WP135 ⟨A1⟩: attach the audited answer to its thread (created lazily if
    // this is a fresh chat). Only runs on a gated-ok outcome with an audit id.
    const threadId = threadAware ? await attachThread(settled, userId, validatedThreadId) : null;
    return { gated: settled, context: await outcomeContext(settled), threadId, onboardingOffer: offer, proofRequestUrls: await outcomeProofRequestUrls(settled), tableLane: null };
  } catch (error) {
    // WP129+130 (ADR 032): a web debit taken before the pipeline threw is
    // compensated here (the base question debit is already compensated inside
    // chargeAndRun before this rethrow reaches us — ADR 020). Then rethrow.
    if (webDebitHolder.split !== null) {
      await compensateSplit(getDb(), userId, webDebitHolder.split, webAddonPrice, null);
    }
    // Vercel function logs used to be the owner's ONLY visibility into
    // production infra failures (WP12 review) — and their short retention once
    // rotated a stack trace away before anyone looked (#65's origin, session
    // 18). Console first (unchanged), then the durable error_log copy (WP25;
    // fail-open — a failed write can never mask or replace `error`), then
    // rethrow exactly as before: the client still receives Next's generic
    // masked error, never these details.
    console.error('askQuestion failed:', error);
    await reportError('askQuestion', error, { requestId, userId });
    throw error;
  }
}

/** The result of the confirm-first onboarding gate: the (possibly rewritten)
 * gated response, plus the signed offer to show — present only when this
 * turn just became a "confirm this fetch?" prompt. */
interface OnboardingGateResult {
  gated: GatedResponse;
  offer: { token: string; priceCredits: number } | null;
}

// WP16 sub-part 2 (ADR 026, design §2; confirm-first addendum, session 101,
// #109's reversal): runs AFTER chargeAndRun so the question debit is already
// refunded (the acknowledgment is a refusal → gate refund → net 0). Only
// fires on an 'ok' gated result whose response is the 'onboarding_pending'
// refusal carrying the structured onboarding envelope — every other gated
// shape (insufficient/duplicate/unauthenticated, or any non-onboarding
// response) passes through untouched, offer null.
//
// Since the addendum this NO LONGER charges the 100-credit onboarding cost
// itself — it mints a signed, stateless offer (src/ingestion/onboarding-
// offer-token.ts) and rewrites the shown text; confirmOnboardingFetch (below)
// does the actual charge+queue, only once the user explicitly clicks. Nothing
// about triggerOnboarding's own billing behavior changed — only WHEN and
// WHERE it is called (there, not here).
async function maybeTriggerOnboarding(
  gated: GatedResponse,
  ctx: { userId: string; requestId: string; question: string },
): Promise<OnboardingGateResult> {
  if (gated.kind !== 'ok') return { gated, offer: null };
  const response = gated.response;
  if (
    response.kind !== 'refusal' ||
    response.reason !== 'onboarding_pending' ||
    response.onboarding === null
  ) {
    // 'onboarding_already_pending' also lands here and passes through
    // unchanged: the pipeline already knew a fetch is in flight (a REAL one,
    // from an earlier confirmed offer) — nothing new to offer or confirm.
    return { gated, offer: null };
  }

  const secret = process.env.ONBOARDING_OFFER_SECRET;
  if (!secret) {
    // Fail closed — same posture as createEmbedCode's "unavailable" (RUNBOOK:
    // "fail closed, no error pages"). Nothing charged, nothing queued; an
    // honest message instead of an offer nobody could actually confirm.
    // Means the confirm-first go-live RUNBOOK step hasn't set this secret yet.
    return {
      gated: {
        ...gated,
        response: {
          ...response,
          text: ONBOARDING_OFFER_UNAVAILABLE_TEXT,
          // I4 fix (2026-09-27 review): `response.english` is present ONLY
          // when this turn ran for an English reader (the pipeline's own
          // `lang === 'en'` gate) — override its `.text` the same way the
          // Dutch `.text` above is overridden, keeping it absent otherwise.
          ...(response.english
            ? { english: { ...response.english, text: ONBOARDING_OFFER_UNAVAILABLE_TEXT_EN } }
            : {}),
        },
      },
      offer: null,
    };
  }

  // Ruling R16 (breadth step 5 final review): never offer a slice-cache
  // table (filled per question by the table lane — its whole-table sync
  // refuses, so the offer could only fail and refund). Flag on or off,
  // Dashboard or workspace. A slice-cache pick gets the same honest
  // "not available right now" text as the fail-closed branch above (nothing
  // charged, nothing queued); slice-cache alternates are dropped from the
  // candidate chain. Safe while migration 037 is unapplied: nothing then reads
  // as slice-cache and the offer is exactly today's.
  const sliceTables = await sliceCacheTableIds(getDb(), [
    response.onboarding.tableId,
    ...response.onboarding.candidateIds,
  ]);
  if (sliceTables.has(response.onboarding.tableId)) {
    return {
      gated: {
        ...gated,
        response: {
          ...response,
          text: ONBOARDING_OFFER_UNAVAILABLE_TEXT,
          ...(response.english
            ? { english: { ...response.english, text: ONBOARDING_OFFER_UNAVAILABLE_TEXT_EN } }
            : {}),
        },
      },
      offer: null,
    };
  }
  const candidateIds =
    sliceTables.size === 0
      ? response.onboarding.candidateIds
      : response.onboarding.candidateIds.filter((id) => !sliceTables.has(id));

  const token = signOnboardingOffer(
    {
      userId: ctx.userId,
      requestId: ctx.requestId,
      tableId: response.onboarding.tableId,
      topicTerm: response.onboarding.topicTerm,
      confidence: response.onboarding.confidence,
      // WP27 stage B: the candidate chain rides the envelope into the token —
      // the same last in-memory link that used to go straight into the
      // trigger now waits inside the token for confirmOnboardingFetch instead.
      candidateIds,
      questionText: ctx.question,
      ackAuditAnswerId: gated.auditId,
    },
    secret,
  );
  // A live-read ESTIMATE for display, not a debit — see the import comment
  // above for why this differs from #148's fixed drift bug (no debit exists
  // yet to read an authoritative amount FROM).
  const priceCredits = await onboardingPrice(getDb());
  return {
    gated: {
      ...gated,
      response: {
        ...response,
        text: ONBOARDING_OFFER_TEXT,
        // I4 fix (2026-09-27 review): same override-the-English-sibling-too
        // rule as the unavailable-degrade branch above.
        ...(response.english ? { english: { ...response.english, text: ONBOARDING_OFFER_TEXT_EN } } : {}),
      },
    },
    offer: { token, priceCredits },
  };
}

// Breadth step 5 (Task 5): queue a table-lane request for a routable curated
// miss. Routable = a gated-ok 'onboarding_pending' / 'onboarding_already_pending'
// refusal whose onboarding envelope names a table (in practice only
// 'onboarding_pending' carries one — buildOnboardingRefusal sets it null on the
// 'already' copy). Returns null when the turn is not routable, AND when the
// queue insert throws: createTableLaneRequest debits and inserts in ONE
// transaction, so a throw has charged nothing, and the turn falls back to
// today's offer path rather than failing (reported durably, #65). Reads and
// writes only our own database — never CBS (principle b); the job does that.
async function routeToTableLane(
  gated: GatedResponse,
  ctx: {
    userId: string;
    requestId: string;
    question: string;
    lang: 'nl' | 'en';
    validatedThreadId: number | null;
    /** Task 7: the validated previous lane answer (validateTableLaneFollowUp). */
    followUp?: TableLaneRow | null;
  },
): Promise<
  | { kind: 'queued'; rowId: number }
  | { kind: 'insufficient'; balance: number; required: number }
  | { kind: 'failed'; fromLink: boolean }
  | null
> {
  const onboarding = tableLaneRoutable(gated);
  if (onboarding === null || gated.kind !== 'ok') return null;
  // Task 7: a follow-up (the routing came from the link's finder, so the
  // table IS the previous answer's) continues that row: the job's parser reads
  // the previous question (prompt version 3). Checked on the table id too, so
  // only the link's own routing can ever carry it.
  const followUp =
    ctx.followUp != null && ctx.followUp.tableId === onboarding.tableId ? ctx.followUp : null;
  try {
    const result = await createTableLaneRequest(getDb(), {
      userId: ctx.userId,
      requestId: ctx.requestId,
      threadId: ctx.validatedThreadId,
      lang: ctx.lang,
      question: ctx.question,
      tableId: onboarding.tableId,
      finderConfidence: onboarding.confidence,
      ...(followUp !== null ? { parentId: followUp.id, previousQuestion: followUpPreviousQuestion(followUp) } : {}),
      // Final review I2/I3: the free routing turn this row replaces — the
      // question history hides it, per-conversation deletion redacts it.
      routingAuditId: gated.auditId,
    });
    if (result.kind === 'insufficient') return result;
    return { kind: 'queued', rowId: result.row.id };
  } catch (error) {
    console.error('table-lane routing failed (falling back):', error);
    await reportError('askQuestion.tableLane', error, { requestId: ctx.requestId, userId: ctx.userId });
    return { kind: 'failed', fromLink: followUp !== null };
  }
}

/** The onboarding envelope of a turn the table lane can take — a gated-ok
 * 'onboarding_pending' / 'onboarding_already_pending' refusal that names a
 * table — else null (see routeToTableLane). */
/** Session 153 (#363): the found table's id and CBS title for the waiting
 * bubble — read from our own catalogue mirror (never CBS); any failure is
 * just no title (the bubble then says only what it did before). */
async function foundTableFor(tableId: string | null): Promise<TableLaneFoundTable | null> {
  if (tableId === null) return null;
  try {
    const { rows } = await getDb().query('select title from cbs_catalog where table_id = $1', [tableId]);
    const title = rows[0]?.title;
    return { id: tableId, title: typeof title === 'string' ? title : null };
  } catch {
    return { id: tableId, title: null };
  }
}

function tableLaneRoutable(gated: GatedResponse): { tableId: string; confidence: number } | null {
  if (gated.kind !== 'ok') return null;
  const response = gated.response;
  if (
    response.kind !== 'refusal' ||
    (response.reason !== 'onboarding_pending' && response.reason !== 'onboarding_already_pending') ||
    response.onboarding === null ||
    !response.onboarding.tableId
  ) {
    return null;
  }
  return response.onboarding;
}

/** Fix round 1 (review Minor 4): the previous-question context a follow-up
 * row carries — the parent's own context plus the parent's question, keeping
 * at most the TWO most recent prior questions, one per line (oldest first).
 * Each question's own line breaks are flattened to spaces so the window is
 * exact; the parser reads the result verbatim (JSON-quoted). */
const FOLLOW_UP_MAX_PRIOR_QUESTIONS = 2;
function followUpPreviousQuestion(parent: TableLaneRow): string {
  const flat = (q: string) => q.replace(/\s*[\r\n]+\s*/g, ' ').trim();
  const prior = parent.previousQuestion ? parent.previousQuestion.split('\n') : [];
  return [...prior, flat(parent.question)].slice(-FOLLOW_UP_MAX_PRIOR_QUESTIONS).join('\n');
}

/** Fix round 1 (review Minor 1): the audited, gate-refunded routing refusal
 * (net 0) shown with the table lane's own failure wording
 * ('table_lane_failed' — "… niet gelukt. Je betaalt hier niets voor.") instead
 * of an onboarding offer. The audited row is unchanged (the same text-only
 * override the offer path applies); the reason stays the audited one. */
function withTableLaneFailedText(gated: GatedResponse): GatedResponse {
  if (gated.kind !== 'ok' || gated.response.kind !== 'refusal') return gated;
  const response = gated.response;
  const failed = buildTableLaneRefusal('table_lane_failed', {
    tableId: response.onboarding?.tableId ?? '',
    tableTitle: null,
    detail: 'follow-up routing could not be queued',
  });
  return {
    ...gated,
    response: {
      ...response,
      text: failed.text,
      ...(response.english && failed.en ? { english: { ...response.english, text: failed.en.text } } : {}),
    },
  };
}

// Breadth step 5 (Task 7): the follow-up link askQuestion received — the row
// id of the previous table-lane ANSWER in this conversation, untrusted. Usable
// only when it is the reader's own row (owner-scoped read), finished ('done')
// with an ANSWER (a lane question, refusal or failure never becomes a
// follow-up), and in the very thread this turn continues. Anything else — or a
// failing read (reported, #65) — returns null: the link is ignored and the turn
// takes today's path. Reads only our own database (principle b).
async function validateTableLaneFollowUp(
  userId: string,
  requestId: string,
  raw: unknown,
  validatedThreadId: number | null,
): Promise<TableLaneRow | null> {
  if (!isTableLaneRowId(raw) || validatedThreadId === null) return null;
  try {
    const row = await readTableLaneRequest(getDb(), raw, userId);
    if (row === null || row.status !== 'done' || row.outcomeKind !== 'answer' || row.threadId !== validatedThreadId) {
      return null;
    }
    return row;
  } catch (error) {
    console.error('table-lane follow-up read failed (link ignored):', error);
    await reportError('askQuestion.tableLaneFollowUp', error, { requestId, userId, extra: { rowId: raw } });
    return null;
  }
}

// Breadth step 5 (Task 7): the finder a validated follow-up link stands in
// for. The pipeline consults a finder ONLY on its unmatched exit (a curated
// miss — src/answer/intent/policy.ts resolveUnmatched), so this can never
// override a curated answer; it answers the previous lane answer's table
// without a catalog search (no rerank spend), as a fresh (never
// already-pending) routing — routeToTableLane then queues the follow-up row.
//
// Fix round 1 (Ruling R14): the link is a FALLBACK, not an override. The real
// finder (when available) runs first; a confident pick of a DIFFERENT table
// wins and routes as a new question (routeToTableLane adds follow-up fields
// only for the linked table), so a topic change is never answered from the
// old table. No pick, no finder, or the same table ⇒ the linked table.
function tableLaneFollowUpFinder(parent: TableLaneRow, finder: TableFinder | undefined): TableFinder {
  return async (term: string, question: string): Promise<OnboardingRouting> => {
    if (finder !== undefined) {
      const pick = await finder(term, question);
      if (pick !== null && pick.tableId !== parent.tableId) return pick;
    }
    return {
      tableId: parent.tableId,
      topicTerm: term,
      confidence: parent.finderConfidence,
      alreadyPending: false,
      candidateIds: [parent.tableId],
    };
  };
}

// ⟨W3⟩/⟨W1⟩ (WP129+130, ADR 032): the web add-on settlement. Runs AFTER the
// pipeline (and, for askQuestion, AFTER maybeTriggerOnboarding) on the FINAL
// gated object. The +10 add-on is KEPT iff a web section with >= 1 cited
// finding was actually DELIVERED on an AUDITED 'ok' turn:
//   finalGated.kind === 'ok'
//   && finalGated.response.webSection?.status === 'ok'
//   && finalGated.auditId !== null   (the ⟨W1⟩ belt — a refusal shipped
//                                     UNRECORDED by persistOrFailClosed's
//                                     fail-closed branch has auditId null and
//                                     its webSection stripped; paid, unverified
//                                     web content must never be kept unrecorded)
// then netCost gains the add-on price. EVERY other shape with a TAKEN web debit
// ⇒ compensateSplit() the debit (Task 6: bucket-first, same as the base debit) —
// the money invariant: netCost mirrors the compensation actually applied,
// never drifting from the append-only ledger.
// (With the ⟨W3⟩ skip-list an onboarding turn can no longer carry a web debit,
// but the rule is stated generally so it stays correct if that ever changes.)
// A null holder (no web debit taken) ⇒ nothing to settle.
async function settleWebAddon(
  finalGated: GatedResponse,
  webSplit: SplitDebitResult | null,
  price: number,
  userId: string,
): Promise<GatedResponse> {
  if (webSplit === null) return finalGated;
  const keep =
    finalGated.kind === 'ok' &&
    finalGated.response.webSection?.status === 'ok' &&
    finalGated.auditId !== null;
  if (keep) {
    return { ...finalGated, netCost: finalGated.netCost + price };
  }
  const auditId = finalGated.kind === 'ok' ? finalGated.auditId : null;
  await compensateSplit(getDb(), userId, webSplit, price, auditId);
  return finalGated;
}

export async function replyToClarification(
  pending: PendingClarification,
  reply: string,
  requestId: string,
  rawSelection?: unknown,
  // WP135 ⟨A6⟩: the threadId the CLIENT captured ALONGSIDE `pending` at question
  // time (stored together in chat state), NOT the sidebar's current active
  // thread — so a reply always attaches to its originating thread (the client
  // falls back to its live thread only when the captured one is null, i.e.
  // that turn's own attach failed — #73 v2 review round 2, chat.tsx). On
  // ownership-validation failure it attaches to a fresh thread, never
  // cross-attaches. ABSENT ⇒ not thread-aware (byte-identical to today).
  rawThreadId?: unknown,
): Promise<AskOutcome> {
  guardLength(reply);
  guardRequestId(requestId);
  // ADR 058 (English answers, Task 8): same once-per-action read as askQuestion.
  const lang = await getLang();
  // Session 47 (billing-path hunt): bound the untrusted, client-held `pending`
  // to the same spend belt as `reply`/`question` — its prompt-bound fields
  // reach the clarify LLM at a flat price, so an oversized one must be rejected
  // BEFORE the gate debits, no charge, no LLM call.
  guardPending(pending);
  const userId = await currentUserId();
  if (userId === null) {
    return { gated: { kind: 'unauthenticated' }, context: null, threadId: null, onboardingOffer: null, proofRequestUrls: null, tableLane: null };
  }
  const threadAware = rawThreadId !== undefined;
  const validatedThreadId = threadAware
    ? await validateThreadOwnership(getDb(), userId, rawThreadId)
    : null;
  // WP15: a pending from a follow-up clarification embeds the conversational
  // referent — client-held, so it gets the SAME registry validation as a
  // fresh question's context before it can reach the clarify prompt. A
  // forged/garbled one drops to a contextless reply merge (fail closed).
  const { conversationContext: rawEmbedded, ...pendingRest } = pending;
  const embeddedContext = await validateConversationContext(getDb(), rawEmbedded ?? null);
  // WP26 mechanism A (ADR 024): the same trust-boundary treatment for the
  // click options — every returned intent re-checked against the intent schema
  // and the registry's canonical keys before the deterministic rung may take
  // one. Anything malformed is dropped (fail closed to the LLM merge), and a
  // pending with nothing left keeps the pre-WP26 field set exactly.
  const safePending: PendingClarification = withValidatedClickOptions({
    ...pendingRest,
    ...(embeddedContext ? { conversationContext: embeddedContext } : {}),
  });
  // WP129+130 (#129, ADR 032): same untrusted-selection validation + ⟨W4⟩
  // upfront affordability (30 in both web modes) as askQuestion. A reply turn
  // that resolves to an ANSWER or a data-shaped refusal owes the web attempt
  // and charges the +10 (a clarification outcome here means still-ambiguous →
  // refusal, so the round is over — attach's own kind-check handles the skip).
  const selection = validateSelection(rawSelection);
  const webAddonPrice = selection?.web === true ? await getActionClassPrice(getDb(), 'web_addon') : 0;
  if (selection?.web === true) {
    const simplePrice = await getActionClassPrice(getDb(), 'simple');
    const required = simplePrice + webAddonPrice;
    const balance = await getBalance(getDb(), userId);
    if (balance < required) {
      return { gated: { kind: 'insufficient_credits', balance, required }, context: null, threadId: null, onboardingOffer: null, proofRequestUrls: null, tableLane: null };
    }
  }
  // #112: same pre-gate load as askQuestion (read-only, fail-soft).
  const extraVocabulary = await onboardedVocabulary();
  const webDebitHolder: { split: SplitDebitResult | null } = { split: null };
  try {
    const gated = await chargeAndRun(getDb(), userId, requestId, () =>
      answerClarificationReplyAudited(getDb(), safePending, reply, {
        referenceDate: referenceDate(),
        userId,
        sourceTag: 'user',
        requestId,
        intentClient: new AnthropicLlmClient(),
        answerClient: new AnthropicLlmClient(),
        // #144 (ADR 034): same checker seam on the reply turn.
        ...semanticCheckOptions(),
        // #162: same slot-phrasing seam on the reply turn (dormant, flag unset).
        slotPhrasing: slotPhrasingEnabled(),
        // #112: the reply merge must accept the same onboarded keys the first
        // turn could have parsed into the pending's candidates — without this
        // the round dead-ends in an internal refusal (paid dead-end). Still
        // NO tableFinder here: a reply-turn onboarding trigger stays an
        // unmade decision.
        extraCanonicalMeasures: extraVocabulary,
        // WP26 mechanism A (ADR 024, take-path A2): enables the deterministic
        // label-match rung — a reply equal to an offered option resolves from
        // the stored intent, with no LLM call at all.
        clickOptionsEnabled: clickOptionsEnabled(),
        answerFirstEnabled: answerFirstEnabled(),
        // WP129+130 (#129/#130, ADR 032): the validated selection + web wiring,
        // identical to askQuestion (the reply turn carries the same chips and
        // charges the +10 if it answers/refuses with data). Absent ⇒ byte-
        // identical to today.
        ...(selection !== undefined ? { sourceSelection: selection } : {}),
        ...(process.env.WEBSEARCH_ENABLED === '1' && selection?.web === true
          ? {
              webClient: new AnthropicWebSearchClient(),
              webBilling: {
                reserve: async (): Promise<boolean> => {
                  const reserved = await reserveWebSearchDebit(getDb(), userId, requestId, webAddonPrice);
                  if (reserved.kind === 'debited') {
                    webDebitHolder.split = reserved.split;
                    return true;
                  }
                  return false;
                },
              },
            }
          : {}),
        // ADR 058 (English answers, Task 8): same dormant-unless-both-flags
        // gate as askQuestion (a reply can settle into an answer too, e.g. a
        // takeable chip).
        ...englishAnswerOptions(lang),
      }),
    );
    // ⟨W3⟩ Settlement — no maybeTriggerOnboarding on the reply path (no finder),
    // so the gated object IS final; keep-or-refund the add-on the same way.
    const settled = await settleWebAddon(gated, webDebitHolder.split, webAddonPrice, userId);
    // WP135 ⟨A6⟩: attach the reply to the CAPTURED thread (validatedThreadId),
    // lazily creating one on ownership-validation failure — never a cross-attach.
    const threadId = threadAware ? await attachThread(settled, userId, validatedThreadId) : null;
    // The reply path never injects a finder (see the comment above this
    // function's pipeline call), so no turn here can ever be an onboarding
    // offer — always null, never computed.
    return { gated: settled, context: await outcomeContext(settled), threadId, onboardingOffer: null, proofRequestUrls: await outcomeProofRequestUrls(settled), tableLane: null };
  } catch (error) {
    // WP129+130 (ADR 032): compensate a taken web debit before rethrowing (the
    // base debit is already compensated inside chargeAndRun — ADR 020).
    if (webDebitHolder.split !== null) {
      await compensateSplit(getDb(), userId, webDebitHolder.split, webAddonPrice, null);
    }
    console.error('replyToClarification failed:', error);
    // #65 / WP25: same durable copy + unchanged rethrow as askQuestion above.
    await reportError('replyToClarification', error, { requestId, userId });
    throw error;
  }
}

// ADR 026 addendum (session 101): the result of an explicit confirm click.
// Deliberately NOT AskOutcome — that type's context/threadId are for the NEXT
// question, and this action produces no new pipeline turn (no question was
// asked, nothing to reconstruct), so wrapping it in a fabricated
// ComposedResponse/AuditedResponse would create an R8-relevant "answer" with
// no audit row behind it. The precedent this follows instead is
// GatedResponse's OWN 'insufficient_credits'/'duplicate_request'/
// 'unauthenticated' variants: real, meaningful outcomes with NO audit trail,
// because none carries a data value or anything worth reconstructing —
// exactly this action's shape too. `text` rides the result directly (the
// SAME byte-pinned copy the pre-addendum flow always showed) so chat.tsx
// never has to import or re-derive pipeline copy itself.
export type ConfirmOnboardingOutcome =
  | { kind: 'unauthenticated' }
  | { kind: 'started'; text: string; netCost: number }
  | { kind: 'duplicate'; text: string }
  | { kind: 'insufficient_credits'; balance: number; required: number };

// The explicit-confirmation counterpart to askQuestion's onboarding offer
// (#109's confirm-first reversal, owner decision 4). Verifies the signed
// token and, only on success, calls the SAME triggerOnboarding askQuestion
// used to call unconditionally before this addendum — that function's own
// billing behavior (the debit+queue transaction, refund-on-refusal via
// gate.ts) is completely unchanged; only WHEN and from WHERE it is called
// moved.
//
// Reuses the token's ORIGINAL requestId rather than minting a new one, so a
// double-click or a retried Server Action invocation dedupes on the exact
// same credit_transactions_one_onboarding_per_request index a retried
// askQuestion already relied on — no new idempotency logic needed.
//
// An invalid/expired/tampered token, or a missing ONBOARDING_OFFER_SECRET,
// THROWS rather than returning a typed outcome — mirrors guardRequestId/
// guardPending's existing convention (a malformed or stale input is rejected
// before anything is charged; chat.tsx already catches a rejected action and
// shows its normal retry message — the same UI a malformed requestId already
// gets today).
export async function confirmOnboardingFetch(token: string): Promise<ConfirmOnboardingOutcome> {
  guardOnboardingOfferToken(token);
  // I4 fix (2026-09-27 review): this outcome's `text` is user-visible copy
  // built directly here (not a pipeline envelope with its own `.english`
  // sibling), so it must pick its language the same way every other
  // server-action reply does — the same once-per-action getLang() read
  // askQuestion/replyToClarification already use.
  const lang = await getLang();
  const userId = await currentUserId();
  if (userId === null) return { kind: 'unauthenticated' };

  const secret = process.env.ONBOARDING_OFFER_SECRET;
  if (!secret) {
    throw new Error('onboarding offer confirmation unavailable: ONBOARDING_OFFER_SECRET not set');
  }
  const payload = verifyOnboardingOffer(token, secret);
  if (payload === null) {
    throw new Error('onboarding offer rejected: invalid or expired token');
  }
  // The token proves this SERVER minted it for SOME user — cross-check the
  // embedded userId against the real, currently authenticated session before
  // trusting anything else in the payload. A token is bound to the user it
  // was minted for the moment it left the server; nobody else's click can
  // spend it, however the token itself was obtained.
  if (payload.userId !== userId) {
    throw new Error('onboarding offer rejected: token does not belong to this session');
  }

  const result = await triggerOnboarding(getDb(), {
    userId,
    requestId: payload.requestId,
    questionText: payload.questionText,
    tableId: payload.tableId,
    topicTerm: payload.topicTerm,
    finderConfidence: payload.confidence,
    candidateIds: payload.candidateIds,
    ackAuditAnswerId: payload.ackAuditAnswerId,
  });

  switch (result.kind) {
    case 'started':
      // #113 kick-on-trigger, unchanged from the pre-addendum behavior.
      after(() => kickOnboardingJob());
      // I4 fix: an English reader gets the English sibling, never the
      // Dutch ONBOARDING_PENDING_TEXT this always returned before.
      return {
        kind: 'started',
        text: lang === 'en' ? ONBOARDING_PENDING_TEXT_EN : ONBOARDING_PENDING_TEXT,
        netCost: result.credits,
      };
    case 'duplicate':
      // An active row already exists (a concurrent confirm click, or a
      // retried Server Action) — no second charge, same copy the pipeline
      // itself would have shown for a genuine re-ask.
      after(() => kickOnboardingJob());
      // I4 fix: same language pick as 'started' above — no reason for this
      // sibling outcome to stay Dutch-only for an English reader.
      return {
        kind: 'duplicate',
        text: lang === 'en' ? ONBOARDING_ALREADY_PENDING_TEXT_EN : ONBOARDING_ALREADY_PENDING_TEXT,
      };
    case 'insufficient':
      return { kind: 'insufficient_credits', balance: result.balance, required: result.required };
  }
}

// Breadth step 5 (Task 5): the table lane's two Server Actions. Both read
// ONLY our own database (principle b — CBS is contacted inside the job, never
// here), both require the session user, and both treat an unknown id and
// another user's row alike ('gone'), so a row's existence never leaks.

const TABLE_LANE_GONE = { status: 'gone' } as const;

/** A just-finished row's thread can lag its terminal status by a moment: the
 * job settles first and attaches the thread after (fix round 1 of Task 4, so a
 * superseded invocation never surfaces its answer). Within this window a done
 * row with no thread read yet is reported as still running, so the client
 * adopts the real thread instead of none; after it, the row is reported done
 * with threadId null (a failed attach — never an invented id). */
const TABLE_LANE_ATTACH_GRACE_MS = 15_000;

function isTableLaneRowId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

/** The client polls this while it shows the table lane's progress bubble. */
export async function pollTableLane(rowId: number): Promise<PollTableLaneOutcome> {
  if (!isTableLaneRowId(rowId)) return TABLE_LANE_GONE;
  const userId = await currentUserId();
  if (userId === null) return TABLE_LANE_GONE;
  try {
    const row = await readTableLaneRequest(getDb(), rowId, userId);
    if (row === null) return TABLE_LANE_GONE;
    if (row.status === 'pending' || row.status === 'running') return { status: row.status };
    // done or failed: the row is settled (status and money move in one
    // transaction), so the ledger now holds this turn's final cost.
    const netCost = await readTableLaneNetCost(getDb(), row.id, userId);
    if (netCost === null) return TABLE_LANE_GONE;
    if (row.auditId === null) {
      // The job's audit write failed twice; the row was settled as a refusal
      // (full refund) with no audit row. Show the same fail-closed refusal
      // the pipeline shows in that case — never an unrecorded answer.
      return {
        status: 'done',
        gated: {
          kind: 'ok',
          netCost,
          response: toInternalRefusal(row.question, 'table-lane: the outcome has no audit row', row.lang),
          auditId: null,
        },
        threadId: row.threadId,
      };
    }
    const audited = await readTableLaneAuditResult(getDb(), row.auditId, userId);
    if (audited === null) return TABLE_LANE_GONE;
    const threadId = audited.threadId ?? row.threadId;
    if (
      threadId === null &&
      row.finishedAt !== null &&
      Date.now() - row.finishedAt.getTime() < TABLE_LANE_ATTACH_GRACE_MS
    ) {
      return { status: 'running' };
    }
    return {
      status: 'done',
      gated: { kind: 'ok', netCost, response: audited.response as ComposedResponse, auditId: row.auditId },
      threadId,
    };
  } catch (error) {
    console.error('pollTableLane failed:', error);
    await reportError('pollTableLane', error, { userId, extra: { rowId } });
    throw error;
  }
}

/** The table-lane button question a clarification row's audited envelope
 * carries (TableLaneEnvelope.question), or null. */
function tableLaneQuestionOf(response: unknown): NonNullable<TableLaneEnvelope['question']> | null {
  if (response === null || typeof response !== 'object') return null;
  const envelope = response as { kind?: unknown; tableLane?: { question?: unknown } };
  if (envelope.kind !== 'clarification') return null;
  const question = envelope.tableLane?.question;
  if (question === null || question === undefined || typeof question !== 'object') return null;
  const dimension = (question as { dimension?: unknown }).dimension;
  if (typeof dimension !== 'string' || dimension.length === 0) return null;
  return question as NonNullable<TableLaneEnvelope['question']>;
}

/** Server Action arguments are attacker-controlled: a reply is exactly one of
 * `{ code }` or `{ text }`, each a bounded string; anything else is malformed
 * (null → no match, free). An over-long text THROWS, like every other
 * top-level text argument (guardLength). */
function parseTableLaneChoice(choice: unknown): { code: string } | { text: string } | null {
  if (choice === null || typeof choice !== 'object') return null;
  const c = choice as { code?: unknown; text?: unknown };
  if (typeof c.text === 'string' && c.code === undefined) {
    guardLength(c.text);
    return { text: c.text };
  }
  if (typeof c.code === 'string' && c.text === undefined && c.code.length <= MAX_INPUT_LENGTH) {
    return { code: c.code };
  }
  return null;
}

/** A reader's reply to a table-lane button question — a clicked member code
 * or typed text. Binding ruling (plan Global Constraints, verbatim): "A typed
 * reply to a breakdown question is matched against ALL members of that
 * dimension from `dimension_labels` (normalized exact title match, or exact
 * code); no match → the same question again, free; never a nearest match."
 * A clicked code is checked against the same FULL member list. A match queues
 * a child row (the parent's question, table and choices plus this one, in the
 * same thread) at the normal question price; no match creates nothing. */
export async function replyToTableLane(
  rowId: number,
  choice: ReplyTableLaneChoice,
  requestId: string,
): Promise<ReplyTableLaneOutcome> {
  const parsed = parseTableLaneChoice(choice);
  if (!isTableLaneRowId(rowId)) return { kind: 'gone' };
  // Final review I4: the kill switch covers replies too — a reply is new
  // paid work (a fresh debit, parse and answer). Flag off ⇒ nothing is read or
  // queued; the client shows its "no longer open" text for a click and sends
  // typed text as a fresh question (Ruling R13). Rows that already hold
  // credits are still finished by the daily sweep (Ruling R10).
  if (!tableLaneEnabled()) return { kind: 'gone' };
  const lang = await getLang();
  const userId = await currentUserId();
  if (userId === null) return { kind: 'gone' };
  // The child row's request id: the client's own UUID (its idempotency key
  // against a double click), else a fresh server-side one — audit_answers.
  // request_id is a uuid column, so a non-UUID can never be stored.
  const childRequestId =
    typeof requestId === 'string' && requestId.length <= MAX_REQUEST_ID_LENGTH && isUuid(requestId)
      ? requestId
      : randomUUID();
  try {
    const db = getDb();
    const parent = await readTableLaneRequest(db, rowId, userId);
    if (parent === null || parent.status !== 'done' || parent.outcomeKind !== 'clarification' || parent.auditId === null) {
      return { kind: 'gone' };
    }
    const audited = await readTableLaneAuditResult(db, parent.auditId, userId);
    const question = audited === null ? null : tableLaneQuestionOf(audited.response);
    if (audited === null || question === null) return { kind: 'gone' };
    if (parsed === null) return { kind: 'no_match' };

    const members = await readTableLaneDimensionMembers(db, parent.tableId, question.dimension);
    const match =
      'code' in parsed
        ? members.some((m) => m.code === parsed.code)
          ? { code: parsed.code }
          : null
        : matchBreakdownReply(parsed.text, members);
    if (match === null) return { kind: 'no_match' };

    const result = await createTableLaneRequest(db, {
      userId,
      requestId: childRequestId,
      // The thread the job attached the question to (the audit row's), else
      // the row's own — both read from the database, never from the client.
      threadId: audited.threadId ?? parent.threadId,
      lang,
      question: parent.question,
      tableId: parent.tableId,
      finderConfidence: parent.finderConfidence,
      parentId: parent.id,
      previousQuestion: parent.previousQuestion,
      choices: [...parent.choices, { dimension: question.dimension, code: match.code }],
      // Final review I1: a lane question takes ONE reply — if it already has
      // a child (a retry after a lost response, a second tab, a stale client),
      // the store returns that child as a duplicate and charges nothing.
      isReply: true,
    });
    if (result.kind === 'insufficient') {
      return { kind: 'insufficient_credits', balance: result.balance, required: result.required };
    }
    // A duplicate is this same reply retried, or this question's existing
    // reply child (I1) — either way `started` with that row. A request id that
    // already belongs to a row of another parent is never reused across rows.
    if (result.kind === 'duplicate' && result.row.parentId !== parent.id) return { kind: 'gone' };
    after(() => kickTableLaneJob());
    return { kind: 'started', rowId: result.row.id };
  } catch (error) {
    console.error('replyToTableLane failed:', error);
    await reportError('replyToTableLane', error, { requestId: childRequestId, userId });
    throw error;
  }
}

// #14 (GDPR): self-service "Verwijder mijn vraaggeschiedenis" (WP14,
// docs/08-build-plan.md). THE CRITICAL SECURITY PIN: the user id scoping this
// delete comes ONLY from currentUserId()'s server-side, getClaims()-verified
// session — never from a client-supplied argument — so this action can only
// ever redact the CALLING user's own rows, by construction (there is no
// parameter here a caller could substitute another user's id into).
//
// Redacts rather than physically deletes (src/answer/audit/retention.ts):
// the ledger (credit_transactions) is NEVER touched, by construction (this
// function calls nothing in src/billing/); the owner-decided UX is a
// "verwijderde vraag" placeholder row that keeps its credit amount visible
// (web/components/question-history.tsx renders the redacted sentinel).
export async function deleteMyQuestionHistory(): Promise<{ deletedCount: number }> {
  const userId = await currentUserId();
  if (userId === null) {
    throw new Error('not authenticated');
  }
  const redacted = await deleteUserQuestionHistory(getDb(), userId);
  // WP218 phase 2: the account-level chart-style wipe rides the same
  // "delete my question history" action, but it is a SEPARATE store
  // (user_chart_styles, a preference row — not question history) whose own
  // failure must never be reported as a failure of the history delete above,
  // which already committed by this point. deleteUserChartStyle already
  // degrades to `false` on an absent table (pre-migration-028) instead of
  // throwing — this try/catch is the belt for any OTHER failure (a real db
  // error), fail-soft the same way reportError itself is fail-open.
  try {
    await deleteUserChartStyle(getDb(), userId);
  } catch (error) {
    await reportError('deleteMyQuestionHistory', error, { userId });
  }
  // #322 I-3 (session 129, ADR 037 point 6): the account-level delete also
  // covers the reader's uploaded files — every dataset, its chat turns,
  // chart edits and any public publication, redacted in one transaction
  // (src/attachments/retention.ts). Unlike the chart-style wipe above this
  // is NOT fail-soft: an upload can hold third parties' personal data, so a
  // failure here must reach the reader as a failed delete (the button shows
  // "deleting did not work"), never a silent success. Re-clicking is safe —
  // the history redaction above and this leg are both idempotent.
  try {
    await deleteUserDatasets(getDb(), userId);
  } catch (error) {
    await reportError('deleteMyQuestionHistory', error, { userId });
    throw error;
  }
  return { deletedCount: redacted.length };
}

// WP128 (#128): 👍/👎 on an answer + optional free text on 👎. FAIL-SOFT
// EVERYWHERE — deliberately UNLIKE deleteMyQuestionHistory above (which
// throws on unauth): feedback must never break or block anything, so the
// ENTIRE body sits in one try/catch and every path (unauthenticated,
// malformed/attacker-controlled input, db error incl. the missing table in
// the pre-migration-017 deploy window, ownership miss) returns { ok: false }.
// Free feature: no billing gate, no charged entry point — this function
// calls no billing function. The ownership + kind + source_tag guard lives
// in the insert statement itself (src/answer/audit/feedback.ts): feedback
// can only attach to the CALLING user's own user-tagged answer rows.
export async function submitAnswerFeedback(
  auditId: number,
  verdict: 'up' | 'down',
  feedbackText?: string,
): Promise<{ ok: boolean }> {
  try {
    const userId = await currentUserId();
    if (userId === null) return { ok: false };
    // Server Action arguments are attacker-controlled — validate as unknown.
    if (verdict !== 'up' && verdict !== 'down') return { ok: false };
    if (typeof auditId !== 'number' || !Number.isSafeInteger(auditId) || auditId <= 0) {
      return { ok: false };
    }
    if (
      feedbackText !== undefined &&
      (typeof feedbackText !== 'string' || feedbackText.length > FEEDBACK_TEXT_MAX_LENGTH)
    ) {
      return { ok: false };
    }
    const ok = await upsertAnswerFeedback(getDb(), {
      auditAnswerId: auditId,
      userId,
      verdict,
      feedbackText: feedbackText ?? null,
    });
    return { ok };
  } catch (err) {
    console.error('answer feedback write failed', err);
    return { ok: false };
  }
}

// WP135 (ADR 033 D1/D2): the sidebar's thread list — the CALLING user's threads
// only, most-recent-activity first, titles derived at read time (a fully
// redacted thread is filtered out). Auth via currentUserId() (getClaims), like
// deleteMyQuestionHistory. Fail-soft: unauth or a read error returns [] (the
// page is auth-guarded regardless), so a hiccup empties the sidebar rather than
// breaking the workspace.
export async function listMyThreads(): Promise<ThreadSummary[]> {
  try {
    const userId = await currentUserId();
    if (userId === null) return [];
    return await listThreads(getDb(), userId);
  } catch (error) {
    console.error('listMyThreads failed:', error);
    return [];
  }
}

/** Session 90 (owner request, in chat): delete ONE chat from the sidebar (the
 * ⋯ menu on a thread row). Ownership is validated first, exactly like
 * loadMyThread — a forged/foreign/unknown id is `{ ok: false }`, never an
 * error that could leak a thread's existence. Then the thread-kind dispatch
 * (ADR 037 D10): a dataset thread deletes its dataset (`deleteOneDataset`,
 * the same leg "Verwijder dit bestand" uses — its turns redact with it), a
 * CBS thread redacts its own audit rows (`deleteThreadQuestionHistory`, the
 * per-thread twin of deleteMyQuestionHistory above: redact-not-delete, ledger
 * never touched). Either way the thread vanishes from `listThreads` by
 * construction — its title source is gone — with no `chat_threads` write and
 * no schema change. Fail-soft like the rest of the thread family (the sidebar
 * shows an inline "couldn't delete" line on `{ ok: false }`), but reported
 * durably (#65) since a silent failure here would look like a working delete. */
export async function deleteMyThread(rawThreadId: unknown): Promise<{ ok: boolean }> {
  let userId: string | null = null;
  try {
    userId = await currentUserId();
    if (userId === null) return { ok: false };
    const threadId = await validateThreadOwnership(getDb(), userId, rawThreadId);
    if (threadId === null) return { ok: false };
    const datasetId = await getThreadDatasetId(getDb(), userId, threadId);
    if (datasetId !== null) {
      return { ok: await deleteOneDataset(getDb(), userId, datasetId) };
    }
    await deleteThreadQuestionHistory(getDb(), userId, threadId);
    return { ok: true };
  } catch (error) {
    console.error('deleteMyThread failed:', error);
    await reportError('deleteMyThread', error, { userId });
    return { ok: false };
  }
}

/** WP135 (ADR 033 D3): a resumed thread's replayed messages + its next-turn
 * conversation context. An empty result (never an error) for a thread not owned
 * by the caller.
 *
 * ADR 037 D10: widened to a discriminated union so a dataset thread's
 * resumption carries what IT needs (the profile for a still-`needs_decision`
 * dataset, the D8-step-2 `rawState` referent for a `ready` one) rather than
 * CBS-shaped fields that don't apply. `kind: 'empty'` replaces the old
 * `threadId: null` sentinel — every existing CBS-thread caller already
 * branches on the result shape (`Workspace.selectThread`), so this is the
 * same "shared-code surgery, not a bypass" D10 itself calls for. */
export type LoadedThread =
  | { kind: 'empty' }
  | { kind: 'cbs'; threadId: number; messages: ChatMessage[]; context: ConversationContext | null }
  | {
      kind: 'dataset';
      threadId: number;
      datasetId: number;
      displayName: string;
      status: DatasetStatus;
      profile: DatasetProfile;
      messages: DatasetChatMessage[];
      rawState: RawDatasetState | null;
    };

const EMPTY_LOADED_THREAD: LoadedThread = { kind: 'empty' };

/** The dataset-thread leg (ADR 037 D10): deterministic replay of the stored
 * `dataset_turns` rows, zero LLM, mirroring the CBS leg's shape below. A
 * dataset that no longer exists (the redact-not-delete posture means this
 * should not happen for a validated thread, but `getDataset`'s ownership
 * check is the authority, not an assumption) degrades to the empty result —
 * same fail-safe posture as an unowned thread. */
async function loadDatasetThread(userId: string, threadId: number, datasetId: number): Promise<LoadedThread> {
  const dataset = await getDataset(getDb(), userId, datasetId);
  if (dataset === null) return EMPTY_LOADED_THREAD;
  const rows = await getDatasetTurnsByThread(getDb(), userId, threadId);
  const messages = replayDatasetTurns(rows);
  const state = lastChartState(rows);
  return {
    kind: 'dataset',
    threadId,
    datasetId,
    displayName: dataset.displayName,
    status: dataset.status,
    profile: dataset.profile,
    messages,
    rawState: state === null ? null : { datasetId, lastInstruction: state.lastInstruction },
  };
}

// Resume = deterministic replay of the thread's stored envelopes (zero LLM) +
// the registry-REVALIDATED conversation context. Ownership is validated first;
// a thread not owned by the caller (or unknown, or a forged id) returns the
// empty result — never an error that could leak a thread's existence (the
// ADR-021 fail-safe). validateConversationContext runs against the LIVE
// registry here (brief §3), so a stale referent degrades honestly on the next
// turn rather than answering from a moved-on registry.
export async function loadMyThread(rawThreadId: unknown): Promise<LoadedThread> {
  try {
    const userId = await currentUserId();
    if (userId === null) return EMPTY_LOADED_THREAD;
    const threadId = await validateThreadOwnership(getDb(), userId, rawThreadId);
    if (threadId === null) return EMPTY_LOADED_THREAD;
    // ADR 037 D10: dispatch BEFORE doing any CBS-shaped work — a dataset
    // thread has no audit_answers rows to replay at all.
    const datasetId = await getThreadDatasetId(getDb(), userId, threadId);
    if (datasetId !== null) return loadDatasetThread(userId, threadId, datasetId);
    const rows = await getThreadRows(getDb(), userId, threadId);
    // open-questions #324 gap 2: a resumed thread's CSV export gets English
    // column headers for an English-interface reader — assembleMessages is
    // otherwise a pure, zero-LLM reconstruction; this is its one reader-facing
    // field that is a fully pre-rendered string (see that module's own
    // comment on the parameter).
    const messages = await assembleMessages(replayParts(rows), getDb(), await getLang());
    const rebuilt = await rebuildContext(getDb(), rows);
    const context = await validateConversationContext(getDb(), rebuilt);
    return { kind: 'cbs', threadId, messages, context };
  } catch (error) {
    console.error('loadMyThread failed:', error);
    return EMPTY_LOADED_THREAD;
  }
}

// WP135 (ADR 033 D6, WP24 absorbed): the genuinely-new "Log uit" action — clear
// the Supabase session, then send the browser to /login. Separate from the
// magic-link sign-in (login/actions.ts); this file gains it only because the
// account menu the workspace shell renders needs it. NO UI reaches it while
// WORKSPACE_ENABLED is off (⟨A5⟩): the shell that surfaces it does not render.
export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/login'); // next/navigation — throws NEXT_REDIRECT, never returns
}

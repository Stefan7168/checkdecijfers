// WP135 chat workspace (ADR 033 D3, ⟨A3⟩): the WEB-SIDE half of thread replay.
// Stage A's src/threads/replay.ts produced STRUCTURAL parts (it cannot import
// web/lib because web/backend is the ../src symlink); this module turns those
// parts into full ChatMessage objects by calling the SAME live-path builders
// the receive handler uses — buildCitation, buildAnswerCsv, statCardData — over
// each replayed envelope, and the SAME shared kind reclassifier. So
// citation/csv/card (and thereby a stat card's dock-tab eligibility)
// reconstruct byte-identically to a live render, not by a parallel copy.
//
// No React, no 'use client': safe to run inside the loadMyThread Server
// Action. Every builder here already imports only client-proven pure leaves,
// so nothing pulls the Anthropic SDK or a client component onto the server.
//
// WP30c D7(b) (ADR 048, Amendment 6, WP30c/E1 brief Task 6): this module is
// no longer itself pure — `assembleMessages` now takes a `db` and awaits
// ONE genuinely new live read per answer message, `fetchRequestUrlsByBatch`
// (web/lib/answer-proof.ts), alongside (never inside) the otherwise-still-
// synchronous `buildAnswerProof` call. The result is a fresh side-lookup,
// kept OUTSIDE the R8-reconstructed envelope and threaded onto the message
// as its own `proofRequestUrls` field — never merged into `proof` itself,
// and never something replayed from stored JSON. This IS one of the three
// `buildAnswerProof` call sites the brief names (the others are
// question-history.tsx and, since #252 (session 109), chat.tsx's live turn —
// that one is `'use client'` so it cannot run this lookup itself, but now
// gets the SAME result server-side via AskOutcome.proofRequestUrls, computed
// inside askQuestion/replyToClarification, web/app/actions.ts).
import type {
  ReplayAssistantPart,
  ReplayPart,
} from '../backend/threads/replay.ts';
import type { AnswerResponse } from '../backend/answer/respond/types.ts';
import type { Db } from '../backend/db/types.ts';
import { batchIdsForProof, buildAnswerProof, fetchRequestUrlsByBatch } from './answer-proof.ts';
import type { AnswerProof, RequestUrlsByBatch } from './answer-proof.ts';
import { buildCitation } from './citation.ts';
import type { ChatMessage } from './chat-message.ts';
import { messageKind } from './chat-message.ts';
import { buildAnswerCsv } from './csv.ts';
import { statCardData } from './stat-card-data.ts';

export type { ChatMessage } from './chat-message.ts';

/** ⟨A7⟩ The single placeholder a redacted row replays as — the chat-side
 * equivalent of the dashboard's isDeleted posture, NOT a user+assistant pair.
 * The visible copy lives in chat.tsx; this carries a stable text for
 * completeness. */
function redactedMessage(): ChatMessage {
  return {
    role: 'redacted',
    kind: null,
    text: 'Deze vraag is verwijderd.',
    chart: null,
    // Not yet in the structural replay parts (see ChatMessage's own doc
    // comment) — a redacted row has no envelope to derive one from anyway.
    chartAlternates: [],
    cost: null,
    citation: null,
    card: null,
    csv: null,
    proof: null,
    proofRequestUrls: null,
    answerView: null,
    provisional: false,
    suggestions: [],
    auditId: null,
    webSection: null,
    // ADR 033 ⟨A6⟩: carriers are not restored on resume — a redacted row has
    // no envelope to guess one from anyway.
    carrier: null,
    insufficientCredits: null,
    // ADR 026 addendum: same posture as carrier — never restored on resume.
    onboardingOffer: null,
  };
}

function userMessage(text: string): ChatMessage {
  return {
    role: 'user',
    kind: null,
    text,
    chart: null,
    chartAlternates: [],
    cost: null,
    citation: null,
    card: null,
    csv: null,
    proof: null,
    proofRequestUrls: null,
    answerView: null,
    provisional: false,
    suggestions: [],
    auditId: null,
    webSection: null,
    // A user turn never carried a carrier live either.
    carrier: null,
    insufficientCredits: null,
    onboardingOffer: null,
  };
}

/** WP30c D7(b): the request_urls side-lookup for a single proof, or `null`
 * when there is no proof to look up against (a non-answer, or `buildAnswerProof`
 * itself returned null — the redacted-envelope / malformed-row belt). Never
 * throws: `fetchRequestUrlsByBatch` already degrades to `{}` on any DB error
 * or absent batch row, so the WORST case here is an empty map, never a
 * rejected promise reaching the caller. */
async function fetchProofRequestUrls(db: Db, proof: AnswerProof | null): Promise<RequestUrlsByBatch | null> {
  if (proof === null) return null;
  return fetchRequestUrlsByBatch(db, batchIdsForProof(proof));
}

async function assistantMessage(db: Db, part: ReplayAssistantPart): Promise<ChatMessage> {
  const response = part.response;
  const isAnswer = response.kind === 'answer';
  const answer = isAnswer ? (response as AnswerResponse) : null;
  // The zero-loss structural view (Stage A) augmented web-side with the
  // tableId/source the chip's StatLine deep-link needs (both live in the
  // envelope's attribution, not in ReplayAnswerView). Defensive reads: an
  // old/minimal envelope may lack `result`.
  const attribution = answer?.result?.attribution;
  const answerView: ChatMessage['answerView'] =
    part.answerView === null
      ? null
      : {
          body: part.answerView.body,
          assumptionLine: part.answerView.assumptionLine,
          regionSetLine: part.answerView.regionSetLine ?? null,
          stalenessWarning: part.answerView.stalenessWarning,
          definitionLine: part.answerView.definitionLine,
          alternatesLine: part.answerView.alternatesLine ?? null,
          markingLine: part.answerView.markingLine,
          attribution: part.answerView.attributionLine,
          tableId: attribution?.tableId ?? '',
          ...(attribution?.source !== undefined ? { source: attribution.source } : {}),
          // #170(1): the badge's measured sync date; old/minimal envelopes
          // replay without one and the badge shows no date.
          syncedAt: attribution?.syncedAt ?? null,
        };
  // Built once, synchronously, exactly as before; the live request_urls
  // lookup below is fetched ALONGSIDE it, never inside buildAnswerProof
  // itself (Amendment 6 — that builder stays a pure, synchronous leaf).
  const proof = answer !== null ? buildAnswerProof(answer) : null;
  const proofRequestUrls = await fetchProofRequestUrls(db, proof);
  return {
    role: 'assistant',
    kind: messageKind(response),
    // R8: the exact stored text the user saw (Stage A pins finalText === stored).
    text: part.finalText,
    chart: part.chart,
    // #254: unlike `chart`, Stage A never lifted this onto its own
    // ReplayAssistantPart field — read it straight off the stored envelope,
    // the SAME `answer` narrowing citation/card/csv already use two lines
    // down (⟨A3⟩: the raw envelope IS the replay source of truth). [] on a
    // non-answer, same as the live receive path.
    chartAlternates: answer?.chartAlternates ?? [],
    cost: part.creditsCharged,
    // The SAME live-path builders over the SAME envelope (⟨A3⟩): identical
    // citation/card/csv reconstruction.
    citation: answer !== null ? buildCitation(answer) : null,
    card: answer !== null ? statCardData(answer) : null,
    csv: answer !== null ? buildAnswerCsv(answer) : null,
    proof,
    proofRequestUrls,
    answerView,
    provisional: part.provisional,
    suggestions: part.suggestions,
    // Feedback only anchors to real answers (the receive-path convention).
    auditId: isAnswer ? part.auditId : null,
    webSection: part.webSection,
    // ADR 033 ⟨A6⟩: carriers are not restored on resume — no live `pending`
    // exists to bind a resumed chip to, so this is always `null`, never a
    // guess. A resumed message's own question-shaped chips (suggestions
    // above) still render; they just fill the input instead of taking.
    carrier: null,
    insufficientCredits: null,
    // ADR 026 addendum (session 101): same posture as carrier — a token
    // minted for an earlier session may already be expired, and resume is a
    // deterministic reconstruction from stored audit rows, never a place to
    // reconstruct live interactive state. Always null, never a guess.
    onboardingOffer: null,
  };
}

/** Turn the structural replay parts into the ChatMessage list the workspace
 * hands Chat as `initialMessages`. Deterministic (zero LLM) except for the
 * one genuinely new live read this Task adds (WP30c D7(b)): the
 * request_urls side-lookup per answer message, which is why this is now
 * `async` and takes `db` — every other builder here is unchanged pure
 * reconstruction from the stored envelope. */
export async function assembleMessages(parts: ReplayPart[], db: Db): Promise<ChatMessage[]> {
  return Promise.all(
    parts.map((part) => {
      switch (part.role) {
        case 'redacted':
          return redactedMessage();
        case 'user':
          return userMessage(part.text);
        case 'assistant':
          return assistantMessage(db, part);
      }
    }),
  );
}

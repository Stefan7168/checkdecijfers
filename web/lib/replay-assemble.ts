// WP135 chat workspace (ADR 033 D3, ⟨A3⟩): the WEB-SIDE half of thread replay.
// Stage A's src/threads/replay.ts produced STRUCTURAL parts (it cannot import
// web/lib because web/backend is the ../src symlink); this module turns those
// parts into full ChatMessage objects by calling the SAME live-path builders
// the receive handler uses — buildCitation, buildAnswerCsv, statCardData — over
// each replayed envelope, and the SAME shared kind reclassifier. So
// citation/csv/card (and thereby a stat card's dock-tab eligibility)
// reconstruct byte-identically to a live render, not by a parallel copy.
//
// Pure leaf (no React, no 'use client'): safe to run inside the loadMyThread
// Server Action. Every builder here already imports only client-proven pure
// leaves, so nothing pulls the Anthropic SDK or a client component onto the
// server.
import type {
  ReplayAssistantPart,
  ReplayPart,
} from '../backend/threads/replay.ts';
import type { AnswerResponse } from '../backend/answer/respond/types.ts';
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
    cost: null,
    citation: null,
    card: null,
    csv: null,
    answerView: null,
    provisional: false,
    suggestions: [],
    auditId: null,
    webSection: null,
  };
}

function userMessage(text: string): ChatMessage {
  return {
    role: 'user',
    kind: null,
    text,
    chart: null,
    cost: null,
    citation: null,
    card: null,
    csv: null,
    answerView: null,
    provisional: false,
    suggestions: [],
    auditId: null,
    webSection: null,
  };
}

function assistantMessage(part: ReplayAssistantPart): ChatMessage {
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
          stalenessWarning: part.answerView.stalenessWarning,
          definitionLine: part.answerView.definitionLine,
          markingLine: part.answerView.markingLine,
          attribution: part.answerView.attributionLine,
          tableId: attribution?.tableId ?? '',
          ...(attribution?.source !== undefined ? { source: attribution.source } : {}),
          // #170(1): the badge's measured sync date; old/minimal envelopes
          // replay without one and the badge shows no date.
          syncedAt: attribution?.syncedAt ?? null,
        };
  return {
    role: 'assistant',
    kind: messageKind(response),
    // R8: the exact stored text the user saw (Stage A pins finalText === stored).
    text: part.finalText,
    chart: part.chart,
    cost: part.creditsCharged,
    // The SAME live-path builders over the SAME envelope (⟨A3⟩): identical
    // citation/card/csv reconstruction.
    citation: answer !== null ? buildCitation(answer) : null,
    card: answer !== null ? statCardData(answer) : null,
    csv: answer !== null ? buildAnswerCsv(answer) : null,
    answerView,
    provisional: part.provisional,
    suggestions: part.suggestions,
    // Feedback only anchors to real answers (the receive-path convention).
    auditId: isAnswer ? part.auditId : null,
    webSection: part.webSection,
  };
}

/** Turn the structural replay parts into the ChatMessage list the workspace
 * hands Chat as `initialMessages`. Deterministic, zero LLM. */
export function assembleMessages(parts: ReplayPart[]): ChatMessage[] {
  return parts.map((part) => {
    switch (part.role) {
      case 'redacted':
        return redactedMessage();
      case 'user':
        return userMessage(part.text);
      case 'assistant':
        return assistantMessage(part);
    }
  });
}

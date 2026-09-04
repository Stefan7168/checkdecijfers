// WP135 chat workspace (ADR 033): the ChatMessage / AnswerView shape and the
// kind reclassification, EXTRACTED here from chat.tsx so BOTH the live receive
// path (chat.tsx) and the deterministic thread replay (web/lib/replay-assemble.ts,
// called from a Server Action) share ONE definition — byte-identity by
// construction, not by parallel copies (⟨A3⟩). This module is a pure leaf: no
// React, no 'use client'/'use server', so the server-side replay assembly can
// reference the type and the reclassifier without pulling the client Chat
// component into the server bundle.
import type { ChartSpec } from '../backend/chart/types.ts';
import type { ComposedResponse, PendingClarification } from '../backend/answer/respond/types.ts';
import type { WebSection } from '../backend/websearch/types.ts';
import type { AnswerProof } from './answer-proof.ts';
import type { AnswerCsv } from './csv.ts';
import type { StatCardData } from './stat-card-data.ts';

/** WP23 (#90/#84): an answer renders from its STRUCTURAL fields — body in
 * the bubble, staleness/definition/marking as their own lines, attribution
 * as a chip with the #86 StatLine link. Zero loss by construction: these are
 * exactly the fields compose.ts assembles `text` from; `text` itself (the
 * R8 audit string) is untouched server-side. */
export interface AnswerView {
  body: string;
  /** WP26 mechanism B (ADR 024): the defaulted-axis disclosure ("Dit is het
   * landelijke cijfer voor heel Nederland. …") — deterministic code's own
   * sentence, shown directly under the body. Null when no axis was defaulted,
   * and on every answer stored before WP26 (A1: the key is simply absent). */
  assumptionLine: string | null;
  stalenessWarning: string | null;
  definitionLine: string | null;
  /** #39: the alternate-reading disclosure ("Er is ook een andere lezing
   * beschikbaar: …") — deterministic code's own sentence, shown with the
   * definition line. Null when the answer's canonical default has no
   * registry-recorded alternates, and on every answer stored before #39
   * (A1: the key is simply absent). */
  alternatesLine: string | null;
  markingLine: string | null;
  /** The full R4 attribution sentence — ALWAYS visible on the chip, never
   * behind a click. */
  attribution: string;
  tableId: string;
  /** Source-registry key for the deep link + label (WP30a); absent on
   * answers stored before WP30a → resolves to 'cbs' (A1). */
  source?: string;
  /** #170(1): our last successful sync (ISO) for the source badge's measured
   * date; null when an old/minimal stored envelope lacks it (the badge then
   * shows no date — measured only, never invented). */
  syncedAt: string | null;
}

export interface ChatMessage {
  /** WP135 (ADR 033 ⟨A7⟩): 'redacted' is a replay-only placeholder for a
   * redacted audit row ("Deze vraag is verwijderd.") — never produced by the
   * live receive path, which only appends 'user'/'assistant'. */
  role: 'user' | 'assistant' | 'redacted';
  /** WP23 (#84): message-type styling. Null on user messages; 'info' for
   * the gated non-'ok' kinds and the meta/smalltalk/onboarding acknowledgments. */
  kind: 'answer' | 'clarification' | 'refusal' | 'info' | null;
  text: string;
  chart: ChartSpec | null;
  /** Credits charged for this turn (GatedResponse.netCost live; the ledger
   * join's creditsCharged on replay) -- null on user messages and on any
   * non-'ok' gated outcome (nothing was charged). */
  cost: number | null;
  /** WP20 #78: the ready-to-paste quote — built once at receive time (and at
   * replay time) from the validated answer envelope; null on non-answers. */
  citation: string | null;
  /** WP20 #80: single-number card data; null unless the answer is a
   * single-cell result (stat-card-data.ts decides). */
  card: StatCardData | null;
  /** WP21 #52: the exported data file — built once at receive/replay time from
   * the validated envelope (csv.ts); null on non-answers. */
  csv: AnswerCsv | null;
  /** Session 72 design brief (#70/#79/#89/#90-deep): the "Bewijs dit cijfer"
   * drill-through data — built once at receive/replay time from the SAME
   * validated envelope (answer-proof.ts); null on non-answers, and on a
   * redacted row (#14). */
  proof: AnswerProof | null;
  /** WP23 (#90): structural answer rendering; null on non-answers. */
  answerView: AnswerView | null;
  /** WP23 (#71): any quoted cell is provisional — the amber pill. */
  provisional: boolean;
  /** WP29 (#73, ADR 029): servability-gated follow-up chips under an answer.
   * Clicking FILLS the input (the #75 convention — never sends). [] on user
   * messages and non-answers. */
  suggestions: string[];
  /** WP128 (#128): the audit_answers row id this answer was stored under —
   * the anchor the feedback buttons write against. Null on user messages,
   * non-answers, and when the audit write failed. */
  auditId: number | null;
  /** WP129+130 (#130, ADR 032): the unverified-web augmentation outcome for
   * THIS turn. Rendered BELOW everything else in the bubble, keyed on this
   * FIELD VALUE (never message.kind). Null on user messages, non-'ok' gated
   * outcomes, and turns that owed no web attempt. */
  webSection: WebSection | null;
  /** #73 v2 follow-up (moved off `chat.tsx`'s index-keyed `carriersRef` once
   * this file was free — ADR 033 ⟨A6⟩ addendum): the click-takeable pending
   * THIS message's own follow-up/rescue chips bind to, so a click on an
   * older message's chip resolves against ITS OWN carrier and never the
   * newest one, even when two messages carry a byte-identical chip label
   * (the G4 "Vergelijk met Nederland" case). Set in the SAME state update
   * that appends the message (chat.tsx) — never a render behind, or a chip
   * could briefly render with no bound carrier. `null` on user messages, on
   * an answer/refusal with no rescueOnly pending, on a clarification (an
   * open round is not a carrier — see chat.tsx's chipRef), and on EVERY
   * replayed/resumed message (ADR 033 ⟨A6⟩: carriers are not restored on
   * resume — replay-assemble.ts has no live pending to put here, so it
   * always sets `null`, never a guess). The former per-message `threadId`
   * alongside `pending` was dropped in the same follow-up: proven (⟨A6⟩
   * addendum, the live-thread-fallback fix) to always equal the live
   * `threadId` state or null at send time, so a click-time carrier lookup
   * needs no thread id of its own — chat.tsx sends the live `threadId`. */
  carrier: { pending: PendingClarification } | null;
}

export type MessageKind = 'answer' | 'clarification' | 'refusal' | 'info';

/** WP23 review (display-honesty lens) + WP16 sub-part 2 (ADR 026): meta and
 * smalltalk replies and the onboarding acknowledgments ride the refusal
 * ENVELOPE by design (the text ANSWERS the question) — the refusal header
 * would visually claim the opposite. They present as plain 'info'. This is the
 * ONE reclassification used by both the live receive handler and thread replay
 * (⟨A3⟩): a stale parallel copy is exactly what would drift the two apart. */
export function messageKind(response: ComposedResponse): MessageKind {
  if (
    response.kind === 'refusal' &&
    (response.reason === 'meta' ||
      response.reason === 'smalltalk' ||
      response.reason === 'onboarding_pending' ||
      response.reason === 'onboarding_already_pending')
  ) {
    return 'info';
  }
  return response.kind;
}

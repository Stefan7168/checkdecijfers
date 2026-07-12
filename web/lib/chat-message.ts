// WP135 chat workspace (ADR 033): the ChatMessage / AnswerView shape and the
// kind reclassification, EXTRACTED here from chat.tsx so BOTH the live receive
// path (chat.tsx) and the deterministic thread replay (web/lib/replay-assemble.ts,
// called from a Server Action) share ONE definition — byte-identity by
// construction, not by parallel copies (⟨A3⟩). This module is a pure leaf: no
// React, no 'use client'/'use server', so the server-side replay assembly can
// reference the type and the reclassifier without pulling the client Chat
// component into the server bundle.
import type { ChartSpec } from '../backend/chart/types.ts';
import type { ComposedResponse } from '../backend/answer/respond/types.ts';
import type { WebSection } from '../backend/websearch/types.ts';
import type { AnswerCsv } from './csv.ts';
import type { StatCardData } from './stat-card-data.ts';

/** WP23 (#90/#84): an answer renders from its STRUCTURAL fields — body in
 * the bubble, staleness/definition/marking as their own lines, attribution
 * as a chip with the #86 StatLine link. Zero loss by construction: these are
 * exactly the fields compose.ts assembles `text` from; `text` itself (the
 * R8 audit string) is untouched server-side. */
export interface AnswerView {
  body: string;
  stalenessWarning: string | null;
  definitionLine: string | null;
  markingLine: string | null;
  /** The full R4 attribution sentence — ALWAYS visible on the chip, never
   * behind a click. */
  attribution: string;
  tableId: string;
  /** Source-registry key for the deep link + label (WP30a); absent on
   * answers stored before WP30a → resolves to 'cbs' (A1). */
  source?: string;
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

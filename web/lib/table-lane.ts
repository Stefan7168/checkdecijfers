// The table lane's request-path helpers (breadth step 5, Task 5). Kept OUT of
// web/app/actions.ts for the same reason as web/lib/english-answers.ts: that
// file is 'use server', so every one of its runtime exports must be an async
// Server Action — a plain synchronous export would break the build.
//
//   - tableLaneEnabled(): the master switch. Read ONLY through this helper.
//     Unset / anything but exactly '1' ⇒ off: askQuestion routes nothing to
//     the lane and behaves exactly as before, and replyToTableLane queues no
//     reply (final review I4). pollTableLane stays open so a reader still sees
//     a row that was already queued. (The daily sweep in
//     /api/onboarding-cron is deliberately NOT gated on it — Ruling R10 — so
//     held credits never wait on a flag flip.)
//   - the client contract of the two table-lane Server Actions
//     (pollTableLane, replyToTableLane) — types only.
//   - matchBreakdownReply: the pure typed-reply matcher.
import type { GatedResponse } from '../backend/billing/index.ts';

export function tableLaneEnabled(): boolean {
  return process.env.TABLE_LANE_ENABLED === '1';
}

/** pollTableLane's result. `done` carries the audited response of the row's
 * outcome (answer, button question or refusal — a failed row's refusal too)
 * as a gated-ok envelope whose netCost is what the row's debit settled to.
 * `threadId` is only ever a thread id read from the database (the audit row's
 * thread, else the request row's). `gone` = unknown id or another user's row
 * (indistinguishable on purpose). */
export type PollTableLaneOutcome =
  | { status: 'pending' | 'running' }
  | { status: 'done'; gated: GatedResponse; threadId: number | null }
  | { status: 'gone' };

/** A reader's reply to a table-lane button question: a button click carries
 * the member code; a typed reply carries the text. */
export type ReplyTableLaneChoice = { code: string } | { text: string };

export type ReplyTableLaneOutcome =
  | { kind: 'started'; rowId: number }
  /** Nothing matched (free, nothing created) — the client asks the same
   * question again. */
  | { kind: 'no_match' }
  | { kind: 'insufficient_credits'; balance: number; required: number }
  /** Unknown row, another user's row, or a row that is not an open
   * button question. */
  | { kind: 'gone' };

/** trim, lowercase, collapse whitespace, strip diacritics. */
export function normalizeReply(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Binding ruling (plan Global Constraints, verbatim): "A typed reply to a
 * breakdown question is matched against ALL members of that dimension from
 * `dimension_labels` (normalized exact title match, or exact code); no match →
 * the same question again, free; never a nearest match."
 *
 * `members` is the dimension's FULL member list. A reply matches a member when
 * it equals that member's code exactly (after trimming) or its title after
 * normalizeReply on both sides. The match must be unique: a reply that fits
 * several members (a shared title, or one member's code and another's title)
 * is no match — the reader is asked again, never given a pick. */
export function matchBreakdownReply(
  reply: string,
  members: { code: string; title: string }[],
): { code: string } | null {
  const trimmed = reply.trim();
  const normalized = normalizeReply(reply);
  if (normalized.length === 0) return null;
  const hits = new Set<string>();
  for (const member of members) {
    if (member.code === trimmed || normalizeReply(member.title) === normalized) hits.add(member.code);
  }
  if (hits.size !== 1) return null;
  const [code] = hits;
  return { code: code! };
}

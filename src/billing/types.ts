// WP13 — Phase 1 access (ADR 006 seams 2-4, ADR 020): the credit ledger,
// pricing config, and Stripe/iDEAL contract. This module attaches OUTSIDE the
// answer pipeline: it wraps the audited entry points (src/answer/audit/) via
// the userId parameter that already existed and a brand-new billing gate
// (gate.ts) -- nothing in src/answer/intent|compose, src/query, or src/chart
// changes.
import type { AuditedResponse } from '../answer/audit/index.ts';

// 'onboarding_cost' added WP16 sub-part 2 (migration 012, ADR 026): the
// 100-credit debit that funds an on-demand CBS table onboarding, alongside
// 'question_cost' as a negative-delta, request_id-scoped reason.
// 'websearch_cost' added WP129+130 (migration 018, ADR 032): the +10-credit
// add-on for a web-search-augmented turn — a sibling negative-delta,
// request_id-scoped reason, one per (user, request), reversible by a
// compensation exactly like the other two debits.
export type LedgerReason =
  | 'signup_grant'
  | 'purchase'
  | 'question_cost'
  | 'compensation'
  | 'onboarding_cost'
  | 'websearch_cost';

/** Phase 1 note (docs/08-build-plan.md WP13, open-questions #4): every
 * current ANSWER is 'simple' -- no code path yet produces 'analysis'/'heavy'.
 * Those exist for forward compatibility only (a future WP's drill-down /
 * claim-verification classifier). 'clarification' is live from day one
 * (open-questions #58): a doorvraag round is priced separately from a real
 * answer -- never free like an outright refusal -- but its price must never
 * exceed 'simple' (the ledger's CHECK constraint forbids a non-positive
 * compensation delta; see src/billing/gate.ts).
 *
 * 'web_addon' (WP129+130, migration 018, ADR 032): NOT an answer class — the
 * price of the web-search add-on, read by web/app/actions.ts when the
 * "Internet" chip is on and charged as a separate 'websearch_cost' debit. It
 * is well below 'simple', so the clarification-price trigger (migration 008,
 * which only relates 'clarification' to 'simple') is unaffected. */
export type ActionClass = 'simple' | 'analysis' | 'heavy' | 'clarification' | 'web_addon';

export interface ActionClassPrice {
  actionClass: ActionClass;
  credits: number;
}

export interface CreditPack {
  id: string;
  label: string;
  priceCents: number;
  currency: string;
  credits: number;
}

/** The billing gate's result (src/billing/gate.ts), one layer outside
 * AuditedResponse. Deliberately NOT a new RefusalReason -- that would touch
 * src/answer/respond/types.ts, off-limits this WP. Consumed by
 * web/app/actions.ts and rendered by web/components/chat.tsx as distinct UI
 * states; these are normal return values, never exceptions, so they must
 * never be funneled through the chat's generic error handling. */
export type GatedResponse =
  // netCost: the credits actually charged for THIS response after any
  // compensation (0 on a refusal, the clarification price on a
  // clarification, the full estimate on an answer) -- computed in
  // src/billing/gate.ts, where the compensation amount is already known.
  // Lets the chat UI show a per-answer cost without a second DB read.
  | ({ kind: 'ok'; netCost: number } & AuditedResponse)
  | { kind: 'unauthenticated' }
  | { kind: 'duplicate_request' }
  | { kind: 'insufficient_credits'; balance: number; required: number };

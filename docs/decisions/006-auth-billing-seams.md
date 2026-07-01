# ADR 006 — Auth and billing: deferred, with seams reserved now

**Status:** accepted, 2026-07-02

## Context

Interview decisions: credit packs, credits never expire, indicative prices that must be easy to change; auth in Phase 1, billing in Phase 2 ([03-mvp-scope.md](../03-mvp-scope.md)). The notes prototype a Supabase-RPC credit deduction (`deduct_credits`, HTTP 402) and then critique it themselves: no rollback story, no audit trail, vendor lock-in, "beslissingsstress" UX. The kickoff requires the seams to be designed now so later phases attach cleanly.

## Decision

**Build neither in Phase 0. Reserve four seams:**

1. **Identity seam** — every `audit_answers` record carries a nullable `user_id` from day one (null = anonymous Phase 0 benchmark runs). Auth provider (Supabase Auth, NextAuth, or similar) is chosen in Phase 1; nothing in the core pipeline may assume how identity is obtained.
2. **Credit ledger seam** — when billing lands, credits are an **append-only ledger** (`credit_transactions`: user, delta, reason, related answer/purchase), *not* a mutable balance column. This supports never-expiring credits naturally, gives the audit/rollback story the notes' PoC lacked (failed delivery → compensating entry), and makes "balance" a cheap SUM. The notes' stored-procedure/402 pattern is recorded as rejected.
3. **Pricing-config seam** — credit costs per action class (simple/analysis/heavy) and pack prices live in one config table/file, never inline in code, honoring "prices must be easy to change." The pipeline includes a cost-estimation step from Phase 0 (a no-op returning 0) so the pre-spend confirmation UX (estimate → confirm → run) attaches without re-plumbing.
4. **Payment provider** — Stripe with iDEAL enabled is the working choice for Phase 2 (iDEAL is non-negotiable for Dutch customers; the notes are unanimous). Enterprise/newsroom invoicing stays manual (e.g. Moneybird) until volume justifies more.

Business rules already decided that the ledger must honor: clarifying questions cost 0 credits; cost shown before the expensive step runs; credits never expire.

## Alternatives considered

1. **Build auth + billing into Phase 0.** Rejected — the phase gate exists precisely to prevent this; neither tests the hard part.
2. **Mutable balance column + stored procedure** (the notes' PoC). Rejected for the ledger, per the notes' own critique.
3. **Usage-based subscription (Stripe metered billing).** Contradicts the decided model (no subscription) — rejected; revisit only if the newsroom tier wants it.

## Consequences

- Phase 0 code stays free of dead auth/billing branches; later phases attach at named seams instead of refactoring the pipeline.
- The 402-style "insufficient credits" flow becomes an orchestrator policy check when billing lands — one gate at the cost-estimation step.

## Revisit triggers

- Phase 1 start → choose auth provider (criteria: managed, magic-link/email-first, boring).
- Phase 2 start → implement ledger + Stripe/iDEAL; legal check on "credits never expire" wording in the terms (logged in [open-questions.md](../open-questions.md)).
- Newsroom tier (Phase 3) → domain-based access, admin surface, manual invoicing flow.

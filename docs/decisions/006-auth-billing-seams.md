# ADR 006 — Auth and billing: deferred, with seams reserved now

**Status:** accepted, 2026-07-02

## Context

Interview decisions: credit packs, credits never expire, indicative prices that must be easy to change; auth in Phase 1, billing in Phase 2 ([03-mvp-scope.md](../03-mvp-scope.md)). The notes prototype a Supabase-RPC credit deduction (`deduct_credits`, HTTP 402) and then critique it themselves: no rollback story, no audit trail, vendor lock-in, "beslissingsstress" UX. The kickoff requires the seams to be designed now so later phases attach cleanly.

## Decision

**Build neither in Phase 0. Reserve four seams:**

1. **Identity seam** — every `audit_answers` record carries a nullable `user_id` from day one (null = anonymous Phase 0 benchmark runs). Auth provider: **Supabase Auth**, resolved 2026-07-04 (see Update below); nothing in the core pipeline may assume how identity is obtained.
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

- ~~Phase 1 start → choose auth provider (criteria: managed, magic-link/email-first, boring).~~ **Resolved 2026-07-04 — Supabase Auth, see Update below.**
- Phase 2 start → implement ledger + Stripe/iDEAL; legal check on "credits never expire" wording in the terms (logged in [open-questions.md](../open-questions.md)).
- Newsroom tier (Phase 3) → domain-based access, admin surface, manual invoicing flow.

## Update (2026-07-04)

Owner decision: the "Phase 2 start" trigger above (ledger + Stripe/iDEAL) now fires early, at the reprioritized Phase 1 start — see [06-roadmap.md](../06-roadmap.md) Phase 1 and [open-questions #47](../open-questions.md). Reason: the chat is being integrated into a real, public website page imminently, which needs paid-access gating before it goes live, not after a validated beta. The four seams above are otherwise unchanged; this only moves *when* seams 2–4 get built, not their design.

## Update (2026-07-04) — auth provider chosen

**Supabase Auth**, resolved against the criteria above. Reasoning: already the Postgres host for this project (zero new vendor, no added cost), a first-class official Next.js App Router integration (`@supabase/ssr`) matching the Server Actions architecture already built in `web/` (ADR 018), and native magic-link/email-OTP support meeting the "boring" criterion directly. Checked against [ADR 002](002-postgres-system-of-record.md)'s vendor-neutrality commitment: that commitment is scoped to the CBS data/registry/audit layer staying swappable across Postgres hosts — it does not rule out Supabase-specific services like Auth, and this ADR's own alternatives list already named Supabase Auth as a candidate. Accepted trade-off: user identity rows live in Supabase's own `auth` schema, somewhat more vendor-tied than the core data ADR 002 protects — a normal cost of a managed auth provider, not treated as a blocker.

**Must-do at setup, not discovered later:** connect a custom SMTP provider (**Resend** is the working choice) in the Supabase Auth settings before real signups begin. Supabase's built-in email sender is meant for development/testing and is tightly rate-limited — left as default, real journalists' magic-link emails could silently fail to arrive once more than a handful sign up in the same hour.

# MVP scope — Phase 0

**Decision (interview Q4, delegated to and confirmed by the architect):** Phase 0 is a thin prototype of *only the hard part* — proving that a question can travel from natural language to a validated, attributed, deterministic answer. Everything else is commodity work that proves nothing.

**This document is the phase gate.** Any AI session or contributor proposing to add something must check it against this page first (see [CLAUDE.md](../CLAUDE.md)). If it's not in scope below, it goes to [06-roadmap.md](06-roadmap.md), not into the build.

## The Phase 0 pipeline

Question (Dutch, free text)
→ intent parsing (LLM, strict schema; no data access)
→ query plan against the table registry
→ deterministic query over pre-loaded CBS data (SQL)
→ validation (existence, units, period, region)
→ cost estimation (a no-op returning 0 in Phase 0 — the billing seam, ADR [006](decisions/006-auth-billing-seams.md))
→ answer composition (LLM phrases; numbers injected verbatim from validated results)
→ output: text + attribution + freshness + simple chart when trend/comparison
→ audit record written for every answer.

At every step where confidence fails, the pipeline exits to **clarification or refusal** — that behavior is *in scope and mandatory*, because a prototype that only handles answerable questions doesn't test the hard part.

## In scope

| Item | Detail |
|---|---|
| 5–10 pre-loaded CBS tables | Bulk-ingested into our own database; topics per the benchmark assumption in [02-user-scenarios.md](02-user-scenarios.md); exact IDs validated against the live CBS catalog 2026-07-02 — the 8-table set in [07-phase0-table-set.md](07-phase0-table-set.md) |
| Chat UI, minimal | One conversation, no history persistence requirements beyond the session |
| Validated answers | Numbers computed by code; LLM sees only validated result objects ([05-data-rules.md](05-data-rules.md)) |
| Attribution + freshness | Table ID, title, sync date, covered period on every answer |
| Simple charts | Line/bar/table from a server-built chart spec; no interactivity, no exports *(chart/image export stays out of Phase 0; the Phase 1 CSV **data** export shipped later under [open-questions #52](open-questions.md) / WP21, and WP20's stat-card PNG under #80 — this row described Phase 0 truthfully when frozen)* |
| Refusal & clarification | Per principle 3 (c) in [CLAUDE.md](../CLAUDE.md); exercised by benchmark tasks B15–B20 |
| Audit record per answer | Question, parsed intent, query plan, result IDs, numbers used, table versions, timestamps — backend-verifiable |
| The 20-task benchmark | Run by hand against CBS StatLine; the gate below |
| Ops guardrails from day one | CI runs the ingestion fixtures, invariant tests, and benchmark scorer on every push — deploys block on red (the owner's trust signal is "CI is green", not a session's word); provider spend caps + billing alerts; automated dependency alerts |

## Success criteria (the Phase 0 gate)

1. **≥ 80% of answerable benchmark tasks (≥ 12 of B1–B14) fully pass** — number, attribution, freshness, chart/derived-marking all correct.
2. **100% of refusal tasks (B15–B20) pass.** One fabricated number anywhere = hard fail of the whole gate, regardless of other scores.
3. **100% attribution**: every answered task shows table ID + sync date; every number reconstructable from the audit record.
4. **Median response under ~10 seconds** for answerable tasks. Informational only — this criterion cannot fail the gate (honesty over speed; the notes' 100ms claims apply only to later cache layers).

Pass → proceed to Phase 1 (see roadmap). Fail → iterate on the pipeline within Phase 0; do not widen scope to compensate.

## Non-goals (explicit, each tagged with its phase)

| Non-goal | Phase | Why not now |
|---|---|---|
| Accounts / auth | Phase 1 | Commodity; proves nothing about answer quality |
| Billing, credits, Stripe/iDEAL | Phase 2 | Business model is decided ([01-product-vision.md](01-product-vision.md)); building it before the pipeline works is waste |
| More than ~10 tables / semantic table discovery | Phase 1–2 | Registry lookup suffices at this scale; see ADR [002](decisions/002-postgres-system-of-record.md). **Note: semantic/catalog table discovery is now WP16 (priority #1) — [08-build-plan.md](08-build-plan.md).** |
| Drill-down buttons on answers | Phase 1–2 | Deterministic follow-up queries; additive UX that proves nothing about the hard part |
| Free browse layer (public SEO data pages) | Phase 1 (late)–2 | No LLM in the path, but Phase 0 proves the answer pipeline, not page rendering. **Scope note (session 52, 2026-07-17): the "Ontdek Nederland in grafieken" section on the landing (ADR [035](decisions/035-homepage-discovery-charts.md)) is NOT this layer — one owner-approved curated section on the existing `/` (#53(c), session-51 product-finish pivot), not per-table public pages/SEO routes; those stay phased here** |
| Shareable answer pages, OpenGraph images, programmatic SEO | Phase 2 | Stefan's own idea — preserved in roadmap; needs public URLs + moderation thinking |
| Social-format exports, interactive chart studio, embeds, huisstijl | Phase 2–3 | The "Visualisatie Studio" — seam reserved via chart-spec ADR [007](decisions/007-chart-spec-rendering.md) |
| Scoop alerts | Phase 3 | Needs background scanning infra + accounts |
| Newsroom/enterprise licenses | Phase 3 | Needs billing + admin surface |
| User-facing audit-trail UI | Phase 2+ | Phase 0 keeps audit records backend-verifiable only |
| Enrichment sources (PDOK/Kadaster, RIVM, UWV, …) = new data sources beyond CBS | **Reprioritized to build priority #2 (owner, session 23, 2026-07-05) — right after WP16, no longer Phase 3+; still not in Phase 0.** | Separate ingestion adapters; broadens the claim from "CBS cell" to "official sources" ([open-questions #102](open-questions.md)) |
| Answer caching / Redis / rate limiting | Phase 1–2, trigger-based | ADR [005](decisions/005-caching-strategy.md) |
| Non-Dutch UI | Not planned | Product copy is Dutch by convention |

## What Phase 0 deliberately risks

- **Throwaway polish**: the UI may be ugly. Fine.
- **Manual operations**: ingestion may be run by hand. Fine — but through the same adapter code path that later phases will schedule.
- **No users**: Phase 0 validates against the benchmark, not against traffic. The first external users arrive in Phase 1.

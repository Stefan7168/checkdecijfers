# ADR 026 — WP16 sub-part 2: async job engine, pricing, verification scope, v1 cut

**Status:** accepted, 2026-07-05
**Deciders:** Stefan (job engine, pricing, verification rigor, v1 scope — all four confirmed the session's recommendation), session 26

## Context

WP16 sub-part 1 (table discovery) is built and live-calibrated (ADR [025](025-cbs-catalog-table-discovery.md)). The epic's remaining sub-parts (2: async fetch+ingest job + pending-question state; 3: slice-sizing; 4: automated verification; 5: answer-on-arrival + credit handling — [08-build-plan.md](../08-build-plan.md) WP16) had four open decisions that would stop an unsupervised build session: how the multi-minute fetch job actually runs on Vercel (no cron/queue infra exists anywhere in this repo today), what the fetch-triggered answer costs, what "verification" concretely checks, and how much of the epic ships in v1. The owner asked to resolve as many decisions as possible up front specifically so a longer, less-supervised build session could follow.

## Decisions

**1. Job engine: Vercel Cron + a status table**, not Vercel Workflow DevKit or Vercel Queues. A new `pending_table_requests` row records a discovered table id + requesting question; a single Vercel Cron entry polls it every few minutes and runs fetch → ingest → verify inline in one function invocation. At the sub-part-3 size cap (below), one table's ingestion is comparable in scale to today's manual `ingest sync` runs (minutes, not the ~19-minute catalog-metadata refresh, which is 4,858 *rows of metadata*, not one table's *cells*) — it fits Vercel's current 300s default Fluid Compute timeout. Rejected Workflow DevKit/Queues for v1: both are new paradigms this repo has never used, and the project's whole operational bias (ADR [001](001-single-app-vs-split.md): "one repo, one language... the mental model every future AI session must reconstruct") favors the boring, already-understood primitive over the more powerful one, especially for a solo non-developer owner. **Revisit trigger:** the size cap needs raising past what fits in 300s, or the cron-polling latency (up to one poll interval of added wait) becomes a real UX complaint.

**2. Pricing: the on-demand-fetch answer costs the same as the existing "heavy" tier — 100 credits** ([#24](../open-questions.md), [#4](../open-questions.md)/[#58](../open-questions.md) pricing history). It is genuinely the most expensive thing the pipeline does (real CBS fetch + full ingestion + verification, minutes of runtime) — pricing at the existing ceiling is honest without adding a fifth price tier before there's usage data to justify one. **Refund on verification failure is already solved, not new policy:** `src/billing/gate.ts` compensates in FULL on any refusal outcome or thrown exception (verified this session, gate.ts lines ~78-85) — a verification failure that raises the normal refusal path is refunded automatically. Sub-part 2's implementation obligation is to route failure through that existing mechanism, not invent new billing logic.

**3. Verification scope for v1: internal consistency only.** The brief's "independent cross-check against a second reference figure where available" is defined, for v1, as reusing the existing ingestion validators (schema fingerprint, plausibility bounds, period/dimension parsing — docs/05) — there is no genuinely separate second data source integrated yet (CBS doesn't publish an independent second figure; a real external cross-check is priority-#2 territory, [#102](../open-questions.md)'s "new data sources beyond CBS"). Claiming a stronger external check now would overstate the gate. **Revisit trigger:** priority #2 lands a second source → extend the verification gate to a genuine cross-source check for tables where both sources overlap.

**4. v1 scope: the core discover → fetch → verify → answer loop only.** Deferred as separable follow-on work, not silently dropped: successor/staleness re-discovery ([#108](../open-questions.md)), the proactive onboarding-suggestion chip ([#109](../open-questions.md)), and the full TTL/eviction machinery ([#110](../open-questions.md)) except the one verified correctness bug in #110(a) — `ingest sync --all` resolves its target list from the hardcoded `PHASE0_TABLES` seed, not the DB's registered set, so an on-demand-onboarded table would never be refreshed by the existing refresh path. That fix rides this build since it touches the same ingestion-registry code.

## Alternatives considered

- **Vercel Workflow DevKit** for the job engine — rejected for v1 on the same "boring beats powerful, for a solo non-dev owner" grounds as ADR 001's core argument; noted as the natural upgrade if the 300s ceiling is ever hit.
- **A new 5th pricing tier** above "heavy" — rejected: adds ledger/reporting complexity for a feature with zero usage data yet; reusing "heavy" is honest and reversible (pricing config is designed to be cheap to change, ADR [006](006-auth-billing-seams.md)).
- **A genuine external second-source check** — rejected for v1: no second source exists to check against; would block sub-part 2 on priority #2 landing first, a whole phase away.
- **Folding in #108/#109/#110 now** — rejected: each is a real feature with its own design surface; bundling them risks a much larger, harder-to-review build before the core loop itself is proven.

## Consequences

- Sub-part 2 needs one new migration (a `pending_table_requests` table, applied live in a supervised step, same pattern as migration 011) and one new Vercel Cron entry (first cron config in this repo). **As built (session 27, 2026-07-06): TWO migrations — 012 (the table + widening the ledger's reason/delta-sign/request-id CHECKs for `onboarding_cost`) and 013 (widening migration 008's compensation trigger, which only allowed reversing `question_cost` — a gap the build surfaced with a test asserting the throw — plus the `source_tag` CHECK for `onboarding_delivery`); the cron config landed in `web/vercel.json` (the Vercel project's rootDirectory is `web/`).**
- The fetch job is genuinely out-of-band (a cron-invoked route, never the request path) — principle (b) holds by construction, same argument as ADR 001/003.
- Pricing reuses existing infrastructure (the `heavy` action-class price) rather than adding a new row — zero ledger schema change for pricing.
- Verification is honestly scoped to what the pipeline can actually check today; the gap to a "genuine second source" is tracked, not hidden.

## Revisit triggers

- A table's estimated ingestion time approaches the 300s function ceiling → escalate to Vercel Workflow DevKit (one job-engine swap, isolated behind the same "run the pending row" function).
- Real fetch-flow usage data suggests 100 credits is mispriced (too high suppresses the exact coverage-wall fix WP16 exists for; too low doesn't cover cost) → re-price via the existing pricing-config seam.
- Priority #2 (new data sources) lands → extend verification to a genuine cross-source check.
- #108/#109/#110's full scope becomes the actual next priority once the core loop is live and proven.

# Roadmap

Phases 0→3, anchored in the interview decisions ([01-product-vision.md](01-product-vision.md), Decision log). Later-phase candidates mined from the notes are **slotted or explicitly rejected** below — per Stefan's Q1 instruction, nothing gets silently lost. Dates are deliberately absent; phases advance on their gates, not on the calendar.

## Phase 0 — Prove the hard part (current)

Scope and gate live in [03-mvp-scope.md](03-mvp-scope.md). One sentence: question → validated, attributed, deterministic answer (+ simple chart), over 5–10 ingested CBS tables, with refusal behavior — measured by the 20-task benchmark.

**Success:** ≥80% of answerable benchmark tasks fully pass; 100% of refusal tasks pass; zero fabricated numbers; full audit traceability.

## Phase 1 — Private beta with real journalists

**Adds:** accounts (identity seam, ADR [006](decisions/006-auth-billing-seams.md)); table set grows toward ~25–50 (manual registry + alias workflow — the precursor to demand-driven onboarding, see feature pool; watch the pgvector trigger in ADR [002](decisions/002-postgres-system-of-record.md)); question history; feedback capture per answer ("klopt dit?"); basic abuse limits; **GDPR checklist for accounts** (activates the reserved section in [04-architecture.md](04-architecture.md) — privacy policy, LLM-provider DPA, retention decisions).

**Success:** ~10–25 active beta journalists (recruited from the freelance/small-newsroom target group); in-the-wild accuracy consistent with the benchmark; qualitative "would you pay per check?" signal that confirms (or kills) the credit-pack thesis before Phase 2 builds it.

## Phase 2 — Paid public launch

**Adds:** credit packs via Stripe + iDEAL on the append-only ledger (ADR 006); free allowance; pre-spend cost transparency (estimate → confirm; clarifying questions cost 0); **shareable answer pages with OpenGraph chart images** (Stefan's programmatic-SEO idea — pages render from audit records; static-image renderer over the chart spec, ADR [007](decisions/007-chart-spec-rendering.md)); watermark/"Gegenereerd via checkdecijfers.nl" on shared visuals; user-facing audit-trail view (the answer's source appendix); payments GDPR items; public-launch rate limiting (ADR [005](decisions/005-caching-strategy.md) trigger).

**Success (indicative, from the notes' Year-1 model — validate, don't worship):** on the order of 250 active users within a year of paid launch; average spend near the notes' ~€12.60/user/mo estimate; repeat-purchase rate demonstrating the no-subscription model retains users.

## Phase 3 — Expansion (options, sequenced by Phase 2 evidence)

Pick by demand signal, not all at once: **demand-driven table onboarding** (user-triggered fetch of not-yet-loaded tables — ingest-and-review queue, not instant answers; guardrails in the feature pool below; may start late in Phase 2 if refusal telemetry shows demand); **scoop alerts** (seam = ingestion batch diffs, incl. the silent-correction log; the notes priced this at ~€29/mo as a subscription — whether alerts are subscription-priced or credit-funded must be re-decided against the "no subscription" promise, [open-questions.md](open-questions.md) #17); **newsroom licenses** (€250–500/mo indicative; domain access + admin + manual invoicing); **Visualisatie Studio** (social formats, custom sizes, interactivity, embeds; renderers over the chart spec); **enterprise huisstijl theming**; **premium audit-trail exports** (the notes' "Ironclad Audit Trail" — sell certainty, €300–500/user/mo was the B2B anchor); **enrichment sources** (PDOK/Kadaster, RIVM, UWV, Waarstaatjegemeente, open.overheid.nl as a *document* source type — likely triggers the Python split, ADR [001](decisions/001-single-app-vs-split.md)); **vertical pivot option** (vastgoed/policy B2B per the notes' researched pivot — trigger: journalist TAM proves too small in Phase 2 *and* enrichment sources exist, since that audience buys enriched analysis, not bare CBS lookups); **whitelabel / API-first distribution** (the engine inside partner software — coupled to the vertical pivot, see feature pool).

**Success (option-conditional):** each shipped option must earn its keep within two quarters of launch — alerts: a meaningful share of active users (order of 15%) enables one; newsroom tier: ≥3 paying newsrooms; Studio/exports: measurable share-driven signups; enrichment and pivot options are judged by their trigger conditions, not by ambition.

## Feature pool: slotted or rejected

| Candidate (from notes) | Verdict | Where / why |
|---|---|---|
| Scoop alerts | **Phase 3** | Real differentiator; needs accounts + batch-diff infra |
| Newsroom licenses (domain access, dashboard) | **Phase 3** | Needs billing + admin; the notes' "glijbaan" upsell path |
| Premium audit-trail exports | **Phase 3** | Extends the Phase 2 audit-trail view |
| Shareable answer pages / OpenGraph / programmatic SEO | **Phase 2** | Stefan's own idea; doubles as the growth engine |
| Demand-driven table onboarding (user clicks to fetch a not-yet-loaded CBS table; backend adapter only, size preflight — spinner for small tables, async job + notify for large ones) | **Phase 2–3** (Stefan, 2026-07-02) | Turns B17-style refusals into demand-driven catalog growth. Guardrails: CBS never in the answer path (principle b); the full validation pipeline applies; a fetched table becomes answerable **only after mapping review** — instant "provisional" answers rejected for now ([open-questions.md](open-questions.md) #21); rate/credit-gated once billing exists; CBS-catalog search likely pulls the pgvector trigger (ADR [002](decisions/002-postgres-system-of-record.md)) |
| Watermarked shared visuals | **Phase 2** | Free marketing on every share |
| Visualisatie Studio (formats, interactive, embeds) | **Phase 2–3** | Seam reserved (ADR 007); studio after sharing basics |
| Enterprise huisstijl charts | **Phase 3** | Enterprise-tier differentiator |
| PDOK/Kadaster, RIVM, UWV, Waarstaatjegemeente, open.overheid.nl | **Phase 3+** | Adapter-per-source; gate on core success |
| Vastgoed/policy vertical ("Dutch Spatial Intelligence Engine") | **Phase 3+ option** | Kept per interview Q2, with explicit triggers |
| Whitelabel / API-first B2B2B distribution (engine sold into vastgoed/corporatie/monitoring software vendors; notes' anchor ~€2.000/mo) | **Phase 3+ option** | Rides the vertical pivot: zero-marketing distribution channel, but needs enrichment + a stable public API first |
| Syndication marketplace / chart resale | **Parked, unscheduled** | Two-sided market; revisit only with strong Phase 2 sharing traction |
| Embed-affiliate kickback (10% credits) | **Parked, unscheduled** | Depends on embeds + billing; niche mechanics |
| **BYO API key** | **Rejected** | The notes' own verdict: "you will lose 95% of your conversion funnel"; UX poison for non-developers |
| **Trojan Horse demand-data reports** (resell aggregated query trends) | **Recommended reject** — architect judgment, Stefan to confirm ([open-questions.md](open-questions.md) #20) | Monetizing user query patterns conflicts with the trust positioning and creates a GDPR burden the product doesn't need |
| **Citation-funding / ads model** | **Recommended reject** — architect judgment, Stefan to confirm ([open-questions.md](open-questions.md) #20) | Ad incentives contaminate a neutrality-based brand |
| **Individual subscription (€15–49/mo)** | **Rejected** | Interview Q3: credit packs; irregular demand makes subscriptions churn machines |
| **Credit expiry (1 year)** | **Rejected** | Interview Q3: credits never expire |

## Standing revisit triggers (cross-phase)

- Big-tech CBS integration ships with real attribution → re-evaluate moat (vision doc, risk 1).
- CBS re-activates SDMX migration → second `CbsSource` adapter (ADR 003).
- LLM spend > ~€50/mo → prompt caching (ADR 004). Repeated questions > ~20% → answer cache (ADR 005).
- Table catalog > ~50 or matching misses → pgvector (ADR 002). Enrichment lands → Python split assessment (ADR 001).

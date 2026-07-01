# Architecture

Recommended architecture for Phase 0–2, per the ADRs in [decisions/](decisions/). Summary: **one full-stack TypeScript app** (ADR [001](decisions/001-single-app-vs-split.md)) over **one Postgres database** (ADR [002](decisions/002-postgres-system-of-record.md)), with CBS data **bulk-ingested behind an adapter** (ADR [003](decisions/003-cbs-access-layer.md)) and the LLM confined to **two schema-validated roles** (ADR [004](decisions/004-llm-usage.md)).

## System shape

```
                 ┌────────────────────────────────────────────────┐
                 │  Next.js app (single deployment)               │
                 │                                                │
 user ──chat──▶  │  UI (chat, answer view, chart renderer)        │
                 │        │                                       │
                 │  orchestrator (server)                         │
                 │   1. intent parse ──────────▶ LLM (schema)     │
                 │   2. plan against table registry               │
                 │   3. deterministic SQL query ──▶ Postgres      │
                 │   4. validation (existence/units/period)       │
                 │   5. cost-estimation step (no-op in Phase 0)   │
                 │   6. answer phrasing ───────▶ LLM (schema)     │
                 │   7. verbatim-number check                     │
                 │   8. chart spec (deterministic)                │
                 │   9. audit record ──────────▶ Postgres         │
                 │      ▲ any failed step → clarify or refuse     │
                 └────────────────────────────────────────────────┘
                          ▲
   ingestion script ──────┘   (out-of-band, same repo, CLI/scheduled)
   CbsSource adapter ◀── CBS OData v4 / bulk channels
```

## Components and why they earn their place

| Component | Justification | ADR |
|---|---|---|
| Next.js full-stack app | One repo/language/deploy for a solo non-developer + AI sessions; streaming chat UI ecosystem | [001](decisions/001-single-app-vs-split.md) |
| Postgres (managed) | System of record for CBS data, registry, audit records; boring and sufficient | [002](decisions/002-postgres-system-of-record.md) |
| `CbsSource` adapter + ingestion script | Bulk ingestion per principle (b); isolates the SDMX migration risk; schema-fingerprint defense against table redesigns | [003](decisions/003-cbs-access-layer.md) |
| Claude API, two narrow calls | Intent parsing + phrasing only; strict schemas; verbatim-number check | [004](decisions/004-llm-usage.md) |
| Chart spec + dumb renderer | "Dom en voorspelbaar" viz layer; the seam for every future export format | [007](decisions/007-chart-spec-rendering.md) |
| **Absent on purpose:** Redis, vector DB, Python service, queue | Each has a named trigger instead of a standing cost | [005](decisions/005-caching-strategy.md), [002](decisions/002-postgres-system-of-record.md), [001](decisions/001-single-app-vs-split.md) |

Components from the notes **kept as input but not adopted (yet)**: separate Python/FastAPI backend (migration target with triggers, ADR 001), Supabase-as-platform (Postgres hosting candidate only; no feature may depend on Supabase-specific behavior), Upstash Redis (trigger-based, ADR 005), pgvector (trigger-based, ADR 002), Stripe+iDEAL (Phase 2, ADR 006), Vercel AI SDK (fine as a chat-UI library at implementation time; the pipeline does not depend on it).

## Future-build seams (Stefan's Q1 requirement: don't lose the ideas)

Each parked feature has a named seam it will attach to — future sessions should extend these, not invent new paths:

| Future feature (roadmap) | Seam that already anticipates it |
|---|---|
| Visualisatie Studio (social exports, sizes, interactive, huisstijl) | Chart spec: new renderers over the same spec (ADR 007) |
| Shareable answer pages + OpenGraph (programmatic SEO) | Audit record = permanent answer snapshot to render a page from; static-image renderer over chart spec |
| User-facing audit trail ("Ironclad Audit Trail") | `audit_answers` already stores question→plan→result IDs→numbers; the UI is a view over it |
| Scoop alerts | Ingestion batches record what changed per sync — an alert is a subscription over batch diffs |
| Newsroom licenses / huisstijl | Identity seam (ADR 006) + theme object in chart spec (ADR 007) |
| Enrichment sources (PDOK/Kadaster, RIVM, UWV, Waarstaatjegemeente, open.overheid.nl) | Additional `Source` adapters beside `CbsSource`; likely trigger for the Python split (ADR 001) |
| Credits/billing | Ledger + pricing-config + cost-estimation step (ADR 006) |

## Cost picture (indicative)

| Scale | Monthly cost | Dominated by |
|---|---|---|
| 0 users (Phase 0) | ~€0–10 | Free tiers; LLM only for dev + benchmark runs (cents/question) |
| ~100 active users | ~€25–75 | Managed Postgres paid tier; LLM at ~30 q/user/mo × ~€0.01–0.02 |
| ~1,000 active users | ~€200–600 | LLM tokens → triggers: prompt caching, answer cache (ADRs 004, 005) |

## GDPR / AVG — reserved section (activated in the phase that introduces accounts/payments)

Phase 0 processes no personal data by design: no accounts, no payment data, and benchmark questions are our own. From **Phase 1 (accounts)** and **Phase 2 (payments)** onward, three flows become personal-data processing and must be handled before launch of those phases — reserved here, deliberately not designed yet:

1. **Account data** (email, usage history) → privacy policy, lawful basis, retention schedule, export/delete capability.
2. **Payment data** → Stripe as processor (DPA with Stripe); we store references, never card/bank data.
3. **User questions sent to the LLM provider** — the sensitive one: journalists type investigative queries (the notes flag this explicitly). Requires: DPA with the LLM provider (Anthropic) covering no-training and retention terms; a decision on question-log retention and anonymization (identity seam keeps `user_id` separable from question text); disclosure in the privacy policy that questions transit an LLM provider.

Seams reserved now: nullable `user_id` on audit records (separable identity), pricing/billing isolated behind the ledger, question text stored in exactly one place (audit record) so retention policy has one enforcement point.

**Trigger to activate:** the Phase 1 go decision. Add "GDPR checklist complete" to the Phase 1 definition of done in [06-roadmap.md](06-roadmap.md).

# checkdecijfers.nl

**Chat your way from official-statistics research to an embedded, sourced chart — where the AI
never does the math.** ([ADR 047](docs/decisions/047-repositioning-embedded-sourced-chart.md), the
current specialization statement.) A user asks a question in plain Dutch; deterministic code
computes the answer from CBS data ingested into our own database; the AI only parses the question
and phrases the result. Every number is traceable to an official CBS cell, with source table and
freshness date shown. When data is missing, ambiguous, or stale, the product refuses or asks — it
never guesses. CBS is the primary source; Eurostat is a second data source built as an internal,
flag-gated adapter (`EUROSTAT_EXPLORER_ENABLED`, [ADR 048](docs/decisions/048-eurostat-data-source.md)) —
not yet reachable from the public chat. The interface itself is bilingual (a Dutch/English switch
in the header). A chart can be switched between line/area/bar/horizontal-bar/table, and — on a
CBS/Eurostat chart narrowed to exactly two time points — dumbbell/slope, or a heatmap grid when
comparing multiple regions across multiple periods, each offered only when it stays honest for the
data on screen ([ADR 056](docs/decisions/056-chart-copilot.md) phase 5). A chart can also be read as its
alternate definition or as period-over-period %-change instead of the level, restyled with
templates — per chart or as an account default — captioned with a journalist headline and free-text
notes, paired with plain-language insights or built into a multi-chart story, downloaded as PNG,
SVG, PDF, or a transparent chart-only PNG, and embedded on another site, frozen with attribution and
a backlink by default (a **Live** embed that keeps itself current is the paid tier's pitch — the
real subscription mechanism behind it is built and merged, still flag-gated off pending its go-live
steps, see [docs/STATUS.md](docs/STATUS.md)). A public gallery (`/galerij`) shows real, sourced
stories on the same chart engine.

## Why

CBS StatLine is authoritative but notoriously hard to use; general-purpose AI chatbots are easy to use but invent numbers. For journalists — our first audience — a wrong number is a career risk. The gap: StatLine's trustworthiness at chatbot speed, priced for freelancers (credit packs today, a real monthly Live-embed tier built and awaiting the owner's merge-go — see [ADR 047](docs/decisions/047-repositioning-embedded-sourced-chart.md) and [open-questions #205](docs/open-questions.md)).

## Status

**Phase 1 — LIVE in production.** Phase 0 is complete; the product is deployed and handling real credits (the owner is the only user so far). Google SSO + magic-link auth, the credit ledger, on-demand CBS table onboarding, follow-up suggestion chips, chart embeds, and a public gallery are all live. Behind the scenes, the owner is proactively e-mailed on ingestion batch failures/quarantines, missed CBS syncs, and health-probe failures — problems surface before a user hits them. The single live tracker is [docs/STATUS.md](docs/STATUS.md) — read its top block first — with the phase checklist, benchmark scoreboard, and what's next. This README deliberately doesn't duplicate it.

For development: a hermetic local harness (`scripts/dev-harness/`, see [docs/RUNBOOK.md](docs/RUNBOOK.md) § "Local real-browser harness") runs the entire logged-in product in a real browser against fixture data — no database, no LLM spend, no secrets — for UI checks and audits.

## Doc map

| Read | For |
|---|---|
| [CLAUDE.md](CLAUDE.md) | **Start here for any AI coding session** — working agreements, principles, phase gate |
| [docs/STATUS.md](docs/STATUS.md) | Where the project stands: phase checklist, benchmark scoreboard, next up |
| [docs/RUNBOOK.md](docs/RUNBOOK.md) | The owner's guide: accounts, secrets, recurring duties, how to run sessions |
| [docs/01-product-vision.md](docs/01-product-vision.md) | What/why/who, positioning, business model, decision log |
| [docs/02-user-scenarios.md](docs/02-user-scenarios.md) | Personas, scenarios with acceptance criteria, the 20-task benchmark |
| [docs/03-mvp-scope.md](docs/03-mvp-scope.md) | Phase 0 scope, success gate, explicit non-goals |
| [docs/04-architecture.md](docs/04-architecture.md) | System shape, component justifications, future-build seams, GDPR reservation |
| [docs/05-data-rules.md](docs/05-data-rules.md) | CBS data strategy, testable anti-hallucination invariants, CC BY 4.0, platform risk |
| [docs/06-roadmap.md](docs/06-roadmap.md) | Phases 0→3; every notes-derived feature slotted or rejected |
| [docs/decisions/](docs/decisions/) | ADRs for every load-bearing technical choice (57 and counting — [047](docs/decisions/047-repositioning-embedded-sourced-chart.md) is the current positioning/direction one) |
| [docs/open-questions.md](docs/open-questions.md) | Open ambiguities + the assumptions made (terminally-closed rows in [open-questions-archive.md](docs/open-questions-archive.md)) |
| [docs/lessons-learned.md](docs/lessons-learned.md) | Process lessons per session — surprises, dead ends, tool quirks |

Historical inputs (never authority): `checkdecijfers.nl.md` (original brainstorm), `KICKOFF_PROMPT.md` (this documentation effort's brief), `Archive/` (competitor research, untracked).

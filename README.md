# checkdecijfers.nl

**AI-assisted Q&A over official Dutch statistics (CBS) — where the AI never does the math.** A user asks a question in plain Dutch; deterministic code computes the answer from CBS data ingested into our own database; the AI only parses the question and phrases the result. Every number is traceable to an official CBS cell, with source table and freshness date shown. When data is missing, ambiguous, or stale, the product refuses or asks — it never guesses.

## Why

CBS StatLine is authoritative but notoriously hard to use; general-purpose AI chatbots are easy to use but invent numbers. For journalists — our first audience — a wrong number is a career risk. The gap: StatLine's trustworthiness at chatbot speed, priced for freelancers (credit packs, no subscription).

## Status

**Documentation phase — no code exists yet, by design.** This repo currently contains the product documentation set and its inputs. Next step: Phase 0 build per [docs/03-mvp-scope.md](docs/03-mvp-scope.md), after Stefan's review of these docs.

## Doc map

| Read | For |
|---|---|
| [CLAUDE.md](CLAUDE.md) | **Start here for any AI coding session** — working agreements, principles, phase gate |
| [docs/STATUS.md](docs/STATUS.md) | Where the project stands: phase checklist, benchmark scoreboard, next up |
| [docs/01-product-vision.md](docs/01-product-vision.md) | What/why/who, positioning, business model, decision log |
| [docs/02-user-scenarios.md](docs/02-user-scenarios.md) | Personas, scenarios with acceptance criteria, the 20-task benchmark |
| [docs/03-mvp-scope.md](docs/03-mvp-scope.md) | Phase 0 scope, success gate, explicit non-goals |
| [docs/04-architecture.md](docs/04-architecture.md) | System shape, component justifications, future-build seams, GDPR reservation |
| [docs/05-data-rules.md](docs/05-data-rules.md) | CBS data strategy, testable anti-hallucination invariants, CC BY 4.0, platform risk |
| [docs/06-roadmap.md](docs/06-roadmap.md) | Phases 0→3; every notes-derived feature slotted or rejected |
| [docs/decisions/](docs/decisions/) | ADRs 001–008 for every load-bearing technical choice |
| [docs/open-questions.md](docs/open-questions.md) | All ambiguities + the assumptions made |

Historical inputs (never authority): `checkdecijfers.nl.md` (original brainstorm), `KICKOFF_PROMPT.md` (this documentation effort's brief), `Archive/` (competitor research, untracked).

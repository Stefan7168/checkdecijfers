# CLAUDE.md — working agreements for AI sessions

You are working on **checkdecijfers.nl**: chat Q&A over official CBS statistics where deterministic code computes every number and the LLM only parses questions and phrases validated results. The product owner (Stefan) is a non-developer; write and explain accordingly.

## Reading order for a fresh session

1. This file.
2. [docs/STATUS.md](docs/STATUS.md) — where the project stands right now: phase checklist, latest benchmark score, what's next.
3. [README.md](README.md) — one-page orientation.
4. [docs/03-mvp-scope.md](docs/03-mvp-scope.md) — **the phase gate**; what is and isn't in scope right now.
5. [docs/05-data-rules.md](docs/05-data-rules.md) — the invariants your change must not break.
6. [docs/04-architecture.md](docs/04-architecture.md) + the relevant [docs/decisions/](docs/decisions/) ADRs.
7. As needed: [docs/01-product-vision.md](docs/01-product-vision.md), [docs/02-user-scenarios.md](docs/02-user-scenarios.md), [docs/06-roadmap.md](docs/06-roadmap.md), [docs/open-questions.md](docs/open-questions.md).

## Source of truth

**`docs/` is the source of truth. `checkdecijfers.nl.md` is historical input — never authority.** If the brainstorm notes and the docs disagree, the docs win. If you find a real gap in the docs, update the docs (and `docs/open-questions.md`) rather than quietly following the notes.

## Product principles (confirmed by the product owner, 2026-07-02 — binding)

Three principles, also referenced as (a)/(b)/(c) across the docs:

1. **(a) The LLM never calculates or interprets raw CBS tables.** It parses intent and explains results computed and validated by deterministic code. Every number traceable to a database cell. (Invariants R1–R3, R5, R9–R10 in [docs/05-data-rules.md](docs/05-data-rules.md).)
2. **(b) CBS data is bulk-ingested into our own database** — never queried live from the frontend or the request path. (ADR [003](docs/decisions/003-cbs-access-layer.md).)
3. **(c) When data is missing, ambiguous, or stale: refuse or ask for clarification. Never guess.** A fabricated number is the worst possible bug in this product — worse than downtime.

**Public-claim rule** (confirmed in the same interview): the public claim is **"every number traceable to an official CBS cell, with source and date shown"** — never absolute slogans like "0% hallucination".

## Conventions

- **English** for code, comments, docs, commit messages. **Dutch** only for product copy / UI text (and benchmark task phrasing).
- Every load-bearing technical choice gets an ADR in `docs/decisions/` (context, decision, ≥2 real alternatives, trade-offs, revisit triggers). Small choices don't.
- Mark every assumption inline (`**Assumption:** …`) and mirror it in [docs/open-questions.md](docs/open-questions.md). Never present a guess as settled.
- Keep the module boundaries from ADR [001](docs/decisions/001-single-app-vs-split.md) (`ingestion/`, `cbs-adapter/`, `query/`, `validation/`, `answer/`, `chart/`) — they are the future split seam.
- Database schema changes happen only via numbered, committed migration files — never ad-hoc console edits. A later session must be able to rebuild the schema from the repo alone.
- Secrets live only in the hosting platform's environment store; a runbook doc lists each secret and its rotation steps in owner-followable language.
- CI runs the ingestion fixtures, invariant tests, and benchmark scorer on every push and blocks deploys on red. "The tests pass" is a claim only CI can make — the owner's trust signal is a green pipeline, not a session's word.
- The owner runs a monthly **maintenance session** with a standing agenda: dependency alerts, provider deprecation notices, spend dashboards, backup status.

## Phase gate

**Before adding anything, check [docs/03-mvp-scope.md](docs/03-mvp-scope.md).** If the feature isn't in the current phase: don't build it. Propose it as a roadmap change instead. The non-goals table exists to be pointed at. Auth, billing, caching, exports, alerts, and extra data sources all have designated phases and seams — respect them.

## Definition of done for any change

1. The change violates no invariant in [docs/05-data-rules.md](docs/05-data-rules.md) — and if it touches the answer pipeline, the invariant tests prove it.
2. The 20-task benchmark ([docs/02-user-scenarios.md](docs/02-user-scenarios.md)) still passes at or above the current gate; refusal tasks pass at 100%. No fabricated number, ever.
3. Relevant docs updated in the same change (scope, ADRs, open-questions). If the change moves project state — a phase-checklist item completed, a benchmark run, a changed "next up" — update [docs/STATUS.md](docs/STATUS.md) too, with **measured results, never aspirational ones**. Docs that lag the code are bugs.
4. New assumptions marked and mirrored in open-questions.
5. Explained in plain language the product owner can follow: what changed, why, how it was verified.

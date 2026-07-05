# CLAUDE.md — working agreements for AI sessions

You are working on **checkdecijfers.nl**: chat Q&A over official CBS statistics where deterministic code computes every number and the LLM only parses questions and phrases validated results. The product owner (Stefan) is a non-developer; write and explain accordingly.

## Reading order for a fresh session

1. This file.
2. [docs/STATUS.md](docs/STATUS.md) — where the project stands right now: phase checklist, latest benchmark score, what's next.
3. [docs/08-build-plan.md](docs/08-build-plan.md) — **the work plan**: the ordered remaining work packages with per-WP scope, invariants, design decisions, and done-definition. A build session's job is "the next WP here."
4. [README.md](README.md) — one-page orientation.
5. [docs/03-mvp-scope.md](docs/03-mvp-scope.md) — **the phase gate**; what is and isn't in scope right now.
6. [docs/05-data-rules.md](docs/05-data-rules.md) — the invariants your change must not break.
7. [docs/04-architecture.md](docs/04-architecture.md) + the relevant [docs/decisions/](docs/decisions/) ADRs.
8. As needed: [docs/01-product-vision.md](docs/01-product-vision.md), [docs/02-user-scenarios.md](docs/02-user-scenarios.md), [docs/06-roadmap.md](docs/06-roadmap.md), [docs/open-questions.md](docs/open-questions.md).

## Source of truth

**`docs/` is the source of truth. `checkdecijfers.nl.md` is historical input — never authority.** If the brainstorm notes and the docs disagree, the docs win. If you find a real gap in the docs, update the docs (and `docs/open-questions.md`) rather than quietly following the notes.

**Doc freshness — no stale docs** (added session 23, 2026-07-05, after a fresh session was confused by buried/contradictory framing and mis-stated a settled decision to the owner):

- **[docs/STATUS.md](docs/STATUS.md) is the plan of record.** A fresh session reads it first (reading order above) and treats its **top block — current priorities + current state — as authoritative** over any older phrasing anywhere else. If a lower doc contradicts STATUS's top block, STATUS wins and the lower doc is a bug to fix now.
- **Source-of-truth precedence when docs conflict:** STATUS (current state/priorities) → [08-build-plan](docs/08-build-plan.md) (the WP + its spec) → [ADRs](docs/decisions/) (the decision + rationale) → [06-roadmap](docs/06-roadmap.md) / [03-mvp-scope](docs/03-mvp-scope.md) (phasing/scope) → `checkdecijfers.nl.md` (never authority). The higher one wins; the lower must be corrected in the same change, never silently followed.
- **A doc that contradicts a newer decision is a bug — not merely one that lags the code.** When a decision changes, update *every* place it is stated in the same change, and **grep the repo for the OLD framing** to catch stale copies. A decision stated in one doc and contradicted in another is exactly what confuses the next session.
- **Before telling the owner something "isn't how it works" or "isn't decided," check the docs + memory for a recorded decision first.** A recorded owner decision outranks a session's from-memory summary — re-derive from the source, never restate the opposite from a compressed recollection. (This rule exists because session 23 mis-stated the on-demand-CBS-fetch decision (WP16) from a collapsed summary of principle (b); see [lessons-learned.md](docs/lessons-learned.md).)

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
- **Git workflow — build phase** (owner decision, 2026-07-03): commit and push directly to `main`, no feature branches, no pull requests, no merge approval per change. Reasoning: the project isn't live, there's one contributor (AI sessions) and one reviewer (Stefan, who finds the branch/PR/merge-click cycle friction with no offsetting benefit pre-launch). CI still runs on every push and is still the gate — a red push must be fixed, not ignored, same as before. **Revisit trigger:** first real deploy / external users / a second human contributor — switch back to branch + PR + review-before-merge at that point, not before.
- Build sessions may delegate implementation to subagents for large work packages; each brief must name the specific invariants at stake, and the session reviews the result against [docs/05-data-rules.md](docs/05-data-rules.md). Green CI remains the only "done" signal regardless of who wrote the code.
- **Delegation cost-tier rule** (owner decision, 2026-07-02): the session's own model — the most capable in play — does the *thinking*: scoping, briefs, synthesis, and the final review/judgment of delegated results. Delegated *legwork* (searches, catalog lookups, mechanical implementation, first-pass verification) runs on cheaper model tiers, explicitly pinned per subagent. Running easy fan-out tasks on the session's top-tier model is a cost bug. Express tiers by role ("cheap tier for mechanical steps"), never as hardcoded model names in reusable prompts — names go stale. When reporting delegated work, say which tier ran it.
- The owner runs a monthly **maintenance session** with a standing agenda: dependency alerts, provider deprecation notices, spend dashboards, backup status, and a short triage of [docs/open-questions.md](docs/open-questions.md) (prune what's gone stale, flag what's now priority — added 2026-07-04, session 18, since the list grows every build session).
- **Process lessons** (surprises, dead ends, tool/provider quirks, things done differently next time) are appended to [docs/lessons-learned.md](docs/lessons-learned.md) at the end of each session — newest on top, evidence-backed, curated at phase gates. Product decisions don't go there; those are ADRs.

## Phase gate

**Before adding anything, check [docs/03-mvp-scope.md](docs/03-mvp-scope.md).** If the feature isn't in the current phase: don't build it. Propose it as a roadmap change instead. The non-goals table exists to be pointed at. Auth, billing, caching, exports, alerts, and extra data sources all have designated phases and seams — respect them.

## Definition of done for any change

1. The change violates no invariant in [docs/05-data-rules.md](docs/05-data-rules.md) — and if it touches the answer pipeline, the invariant tests prove it.
2. The 20-task benchmark ([docs/02-user-scenarios.md](docs/02-user-scenarios.md)) still passes at or above the current gate; refusal tasks pass at 100%. No fabricated number, ever.
3. Relevant docs updated in the same change (scope, ADRs, open-questions). If the change moves project state — a phase-checklist item completed, a benchmark run, a changed "next up" — update [docs/STATUS.md](docs/STATUS.md) too, with **measured results, never aspirational ones**. Docs that lag the code are bugs. When a decision changes, update **every** place it is stated and grep for the old framing (see *Source of truth → Doc freshness*) — a doc that contradicts a newer decision is a bug that confuses the next session.
4. New assumptions marked and mirrored in open-questions.
5. Explained in plain language the product owner can follow: what changed, why, how it was verified.

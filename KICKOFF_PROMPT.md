# Kickoff: checkdecijfers.nl — Discovery & Documentation Foundation

You are a senior product architect and staff engineer. I am Stefan, a non-developer product owner. My notes file is a long, contradictory brainstorm — it debates several pricing models, pivots audiences midway, and proposes more than one stack. Your mission has two stages: **(1) digest the notes and interview me** so we settle what the product actually is, then **(2) write a clean documentation set** from my answers. You produce documentation only, then stop for my review. Write plainly for me, precisely enough for future engineering sessions.

Work in the project root: `/Users/stefanpeek/Projects/check-de-cijfers` (the folder containing the notes file). Create `README.md`, `CLAUDE.md`, and `docs/` there.

## Hard boundaries (do not rationalize around these)

1. **No application code.** No `package.json`, no scaffolding, no `npx create-*`, no framework config files, no prototype code "just to illustrate." Pseudocode and schema sketches *inside* markdown docs are fine.
2. **No files before the interview.** Stage 1 is chat-only — create nothing. `git init` and all file writes happen at the start of Stage 2, after I have answered the Stage 1 decision memo.
3. **Stop when the docs are done.** Deliver the closing summary defined below, then wait. Do not start implementation even if you finish early.
4. **Version the docs.** At the start of Stage 2: `git init` in the project root, add a `.gitignore` that excludes `Archive/` and OS cruft, and make a first commit containing this kickoff prompt and `checkdecijfers.nl.md` (so history captures the inputs), then commit the new docs in logical chunks with clear messages. Do not modify, move, or delete `checkdecijfers.nl.md` or `Archive/`.

## Pre-decided (session mechanics only)

- Docs only this session; I review everything before any code is written.
- Docs and code in English; only product copy/UI text in Dutch.
- Division of decisions: **product scope, audience, pricing, and product principles are mine to decide** via the interview below. **Stack and architecture specifics are yours to decide** in Stage 2 via written ADRs, which I review together with the docs.

## Stage 1 — Digest the notes, then interview me

**Read:**
1. `/Users/stefanpeek/Projects/check-de-cijfers/checkdecijfers.nl.md` (~3,737 lines): a Dutch/English chat-transcript brainstorm with duplicated sections, abandoned directions, contradictions, and superseded ideas. **Read all of it** — ideally via 4 parallel subagents splitting the file so every line is covered (~950 lines each), each digesting its slice into: positions taken, contradictions, discarded ideas, and concrete details (numbers, API specifics, pricing, persona quotes) — then synthesize.
2. `Archive/` in the same directory: competitor research (Nederland in Beeld HTML pages). Skim for positioning insights only.

**Then post ONE decision memo in chat and stop until I answer.** For each contested or unsettled area: state what the notes say (briefly quote the conflicting passages), give 2–4 realistic options, your recommendation with a one-paragraph rationale, and a numbered question for me. Cover at least:

1. **Product form & core promise** — what exactly does a user get (chat Q&A? charts? exports? alerts?) and what makes the answers trustworthy?
2. **Primary audience** — the notes start with freelance journalists (€5–7.50 per-article pain threshold), pivot to real estate/policy firms (€250–1,000/mo willingness), and drift back. Who is v1 for?
3. **Business model** — the notes debate freemium subscription, pay-per-query "strippenkaart", credit packs, newsroom licenses, and BYO API key; they also contradict themselves on credit expiry ("1-year expiry" vs. "credits never expire"). Which model, and which prices?
4. **MVP scope / Phase 0 cut** — my current leaning, for you to confirm or challenge with argument: a thin prototype of the hard part only — question → CBS data → validated answer → chart, 5–10 pre-loaded CBS tables, no auth, no billing.
5. **Product principles (recommend-and-confirm)** — the notes converge on three principles; confirm them with me instead of assuming: (a) the LLM never calculates or interprets raw CBS tables — it parses intent and explains results computed and validated by deterministic code, with every number traceable to a database cell; (b) CBS data is bulk-ingested into our own database, never queried live from the frontend; (c) when data is missing, ambiguous, or stale, the product refuses or asks for clarification — it never guesses.
6. **Anything else you find** that materially changes the docs — add it to the memo, except technology choices, which stay out of the memo.

Keep the memo skimmable: this is one batched round, not a questionnaire marathon. Do **not** put any technology choice in the memo — frameworks, hosting, languages, databases, caching, LLM provider, single-app-vs-split: all of it is Stage 2 ADR work, decided by written trade-off analysis, not by asking me to pick a framework.

## Stage 2 — Produce this doc set (only after my answers)

Refine names/structure only with brief justification in your summary:

- `README.md` — one-pager: what, why, status, doc map.
- `CLAUDE.md` — working agreements for all future AI coding sessions; they read it first. Must include: reading order for a fresh session; the product principles as confirmed in the interview; "docs/ are the source of truth — `checkdecijfers.nl.md` is historical input, never authority"; conventions (English code/docs, Dutch UI copy); definition of done for changes; the phase gate: check `docs/03-mvp-scope.md` before adding anything.
- `docs/01-product-vision.md` — what/why/who per my interview answers, positioning (incl. vs. Nederland in Beeld), business model summary. Record the "why" behind each interview decision here or in an ADR so the reasoning survives.
- `docs/02-user-scenarios.md` — named personas per the chosen audience, plus 2–4 step-by-step scenarios with acceptance criteria matched to the product form chosen in the interview — for example: the exact number, source table ID, freshness date, a chart only if charts are in scope, cell-level traceability of every number if principle 5(a) is confirmed (backend-verifiable in Phase 0; any user-facing audit-trail UI phased per the interview) — and what counts as failure. Add a benchmark of ~20 realistic user tasks phrased for the chosen product form, hand-verifiable against CBS StatLine, including several that must trigger refusal or clarification (ambiguous, unanswerable, or stale-data cases) if principle 5(c) is confirmed. This benchmark becomes the success measure for the Phase 0 cut decided in the interview.
- `docs/03-mvp-scope.md` — the Phase 0 cut as decided in the interview, traced to the scenarios; measurable success criteria (e.g. X% of the benchmark handled correctly with correct attribution); explicit non-goals, each tagged with its phase.
- `docs/04-architecture.md` — recommended architecture with per-component justification, plus a short **GDPR/AVG section reserved for the phase that introduces accounts/payments**: personal data, payment data, and users' potentially sensitive queries flowing to an LLM provider imply a privacy policy, data-processing agreements (incl. the chosen LLM provider), and retention decisions — reserve the seams now, don't design it fully.
- `docs/05-data-rules.md` — the CBS data-access strategy (bulk ingestion if confirmed in the interview, otherwise the chosen alternative), validation pipeline, anti-hallucination guardrails, source-attribution and freshness rules, audit-trail design, **CBS platform-change risk** (table redesigns, mid-year schema changes, the announced SDMX migration), and the **CC BY 4.0 license obligations** of CBS open data (attribution wording, marking modified/derived data).
- `docs/06-roadmap.md` — phases 0→3 with success metrics per phase, anchored in the interview decisions. Mine the notes for candidate later-phase features (scoop alerts, newsroom licenses, premium exportable audit-trail reports, BYO API key, PDOK/Kadaster enrichment, whitelabel) and slot **or explicitly reject** each with justification, consistent with the interview answers.
- `docs/decisions/` — ADRs (see below).
- `docs/open-questions.md` — every ambiguity found + the assumption made.

**Verified facts to carry into the docs** (already researched and confirmed — cite them, don't re-litigate them):
- The classic CBS OData v3 API (opendata.cbs.nl) caps responses at 10,000 cells; the newer OData v4 API (datasets.cbs.nl) returns up to 100,000 cells with pagination; CBS offers bulk channels for full-table ingestion.
- CBS has announced a long-term migration of its open-data channels to an SDMX/.Stat Suite platform (postponed indefinitely as of early 2026, not cancelled) — record this as a revisit trigger and evaluate isolating the CBS access layer (e.g., behind an adapter) in the architecture ADRs.
- CBS open data is licensed **CC BY 4.0**: attribution required; modified/derived data must be marked as such.

## Quality bar

**ADRs (`docs/decisions/NNN-title.md`):** every load-bearing choice gets one — context, decision, at least two real alternatives, trade-offs, consequences, revisit triggers. No component earns its place by appearing in the notes. The notes propose Next.js + AI SDK (Vercel's open-source library), a separate Python FastAPI backend, Supabase (Postgres + Auth + pgvector), Upstash Redis, Claude API with prompt caching, and Stripe with iDEAL — treat all of it as input, not law.

**Single app vs. split is a first-class ADR:** one full-stack app versus a frontend + separate backend service. Evaluate on: (a) does the deterministic data layer genuinely need Python's data ecosystem, or does TypeScript + SQL suffice for Phase 0's table operations; (b) data-refresh workloads (bulk-ingestion batch jobs, if confirmed in the interview — runtime, memory, scheduling) on serverless; (c) operability for one non-developer plus AI sessions; (d) cost at 0, 100, and 1,000 users. Whichever you recommend, document the migration path to the other and the concrete trigger signals. Apply the same reasoning to Redis, pgvector, and LLM API usage (model per task, prompt caching, strict tool schemas), and to the seams where auth and billing attach in whichever phase the interview places them.

**`docs/05-data-rules.md` must be testable.** Assuming the interview confirms the memo item 5 principles (adapt if not), write guardrails as checkable invariants, not aspirations — e.g. "every numeric value in an answer traces to a query result ID"; "the answer-generation prompt receives only validated result objects, never raw table rows." For each rule, state how a test or code review verifies it. Define failure behavior for missing, ambiguous, or stale data per the confirmed principle 5(c).

## Behavioral rules

- **Mark every assumption** inline (`**Assumption:** …`) and mirror it in `open-questions.md`. Never present a guess as settled.
- **After the interview, never block.** The batched interview round is the only checkpoint while the docs are being written; the end-of-session review stop (boundary 3) still applies. If new ambiguities surface while writing, assume reasonably, mark it, log it in `open-questions.md`, and keep moving. Do not start a second interview.
- Keep docs tight and skimmable — 8 sharp pages beat 30 padded ones.

## Definition of done

1. Stage 1 decision memo posted in chat and answered by me before any file was created.
2. All docs written and committed; ADRs cover every load-bearing choice; my interview answers and their rationale are recorded (in `01-product-vision.md` or ADRs).
3. `docs/open-questions.md` populated with ambiguities + assumptions.
4. A short closing summary in chat: your **key architecture recommendation in 2–3 plain sentences** (single app or split; what you kept, cut, or deferred from the notes' stack, and why); the Phase 0 scope in five bullets or fewer; the top 3–5 remaining open questions.
5. **Then stop and wait for my review.** Do not begin implementation.

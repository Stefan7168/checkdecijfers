# ADR 010 — Canonical measures (alias list) as a DB table, keyed by concept not raw text

**Status:** accepted, 2026-07-03

## Context

ADR [002](002-postgres-system-of-record.md) sketched a `dimension_labels`-adjacent "alias policy: each everyday term maps to one canonical headline measure and preferred table" but explicitly deferred its shape ("refined at build time"). The Phase 0 checklist ([STATUS.md](../STATUS.md)) separates "table registry + alias list" from "intent parsing" as distinct work packages — the alias list has to exist *before* intent parsing is designed, so its shape can't assume intent parsing's internals.

Two things are getting conflated in "canonical default" and need separating:

1. **Incidental defaults** — dimensions no question ever varies unless it says so (population's Geslacht/Leeftijd/BurgerlijkeStaat totaal). These already have a home: `cbs_tables.default_coordinates` (migration 001, populated but empty until now).
2. **Semantic defaults** — dimensions where the *choice itself* is what an everyday term means ("werkloosheid" specifically means the seasonally-adjusted series; "faillissementen" in press usage specifically excludes personal bankruptcies). These have no home yet.

## Decision

**A new table, `canonical_measures`** (migration 002), one row per everyday concept (`population_on_1_january`, `unemployment_rate_seasonally_adjusted`, ...), holding: table + measure + the semantic dimension coordinates, a Dutch `definition_label` (always shown when the default fires — canonical-default transparency, invariant R7), and `everyday_terms` (Dutch words a question might use).

**Keyed by a stable concept string, not the raw Dutch word.** `everyday_terms` is documentation and future intent-parser-prompt input, not a lookup table our code string-matches against. Reasoning: the architecture ([04-architecture.md](../04-architecture.md)) already commits intent parsing to a schema-validated LLM call (ADR [004](004-llm-usage.md)) — the LLM's job is exactly the natural-language-to-concept mapping ("werkloosheid", "werkloosheidscijfer", "hoeveel mensen zonder baan" all mean the same concept). Building a second, competing string-matcher here would duplicate that job with a worse tool (no vector DB, no fuzzy matching — ADR 002 already rejected that path for table discovery, same logic applies here). The registry's job starts *after* the LLM has picked a concept key: resolve that key to CBS coordinates, deterministically.

**Alternates are kept, not discarded.** Every canonical measure with more than one CBS reading (B6, B9, and the CPI/house-price/income variants) records its alternates in the same row, mirroring the shape already used in `benchmark/answer-key.json`. A future answer can cite "we gebruiken X; Y is ook beschikbaar" without a second registry lookup.

**Separate from `cbs_tables.default_coordinates`, not merged into it.** Keeping the "nobody varies this" defaults on the table row and the "this choice is the meaning" defaults in `canonical_measures` keeps each honest about what it is: a `cbs_tables` row change means "we re-sliced or re-registered a table"; a `canonical_measures` change means "we changed what a Dutch word means" — a product decision, reviewable independently (see the open-questions entries this ADR's seed data resolves provisionally: [#35](../open-questions.md), [#36](../open-questions.md)).

**Data lives in code** (`src/registry/defaults.ts`), applied idempotently by `src/registry/apply.ts`, not written directly as SQL seed data. One reviewable TypeScript diff when a default changes; migrations stay schema-only (CLAUDE.md: "Database schema changes happen only via numbered, committed migration files — never ad-hoc console edits" — data isn't schema, but the same one-reviewable-place spirit applies).

## Alternatives considered

1. **Fold aliases into `dimension_labels`.** ADR 002's original sketch. Rejected: `dimension_labels`'s key is `(table_id, dimension, code)` — a label for one coordinate — which doesn't fit "an everyday term selects a table *and* a measure *and* a dimension coordinate" without overloading the key shape or adding a sentinel dimension name. A dedicated table is cleaner and self-documents its purpose.
2. **Raw-string alias table, matched by our own code before the LLM call.** Would need fuzzy matching (typos, inflections, synonyms not anticipated) to be useful — exactly the vector-DB-shaped problem ADR 002 deferred. Rejected for Phase 0; revisit only if the eventual intent parser's concept-selection accuracy needs a second signal.
3. **Code-only config, no DB table** (matching `PHASE0_TABLES` in `src/ingestion/registry-seed.ts`). Rejected for consistency: the table registry itself already lives in Postgres (system-of-record principle, ADR 002); a future `query/` module reading canonical measures alongside `cbs_tables` from the same database is simpler than reading one table from Postgres and another from a TS import.

## Consequences

- Intent parsing (next-next work package) is scoped tighter: its job is "select a `canonical_measures.key` (or ask for clarification)", not "understand CBS dimension codes."
- Every canonical default is transparent and revisable in one place; two of today's eight (`housing_stock_start_of_year`, `bankruptcies_businesses`) are marked as assumptions pending owner confirmation, not silently settled.
- `everyday_terms` will likely move into the intent parser's prompt/schema description verbatim when that work package lands — designed to be reused, not just documentation.

## Revisit triggers

- The table catalog grows past what a hand-maintained `canonical_measures` table can hold legibly (same ~50-table trigger as ADR 002's pgvector reconsideration).
- Intent-parser accuracy on concept selection needs a second, deterministic signal (e.g. exact-string fast path before the LLM call) — `everyday_terms` is already there to seed it.

## As-built addendum (2026-07-06, session 29 — #115 lever b)

`canonical_measures` gained one **nullable** column, `definition_text` (migration 014), carrying the FULL verbatim CBS measure `Description` (its meaning + any scale). Distinct from `definition_label`, which stays the short concept phrase that doubles as the answer's sentence *subject* — a paragraph can't live there. **The decision was a dedicated column, NOT widening `definition_label` to nullable** (the shape first sketched): that keeps every seed row (`definition_text` NULL) and thus every benchmark answer byte-identical by construction, while on-demand-onboarded measures store CBS's real definition for their "Definitie:" line. Populated only by onboarding (`src/ingestion/onboarding-vocab.ts` → `cleanCbsDefinition`, which keeps the whole blurb verbatim, never trimming to a block — a live-caught fix); seed rows leave it NULL. Rationale + the deploy-order-safe read (gated on the `onboarded:` key prefix so the hot seed path never touches the new column) in [open-questions #115](../open-questions.md).

## As-built addendum (2026-07-17, session 49 — coverage sprint table #1)

The coverage sprint ([open-questions #163](../open-questions.md)(3)) added the first post-Phase-0 CURATED
entries: table `83693NED` with **three canonical measures on one table** (`consumer_confidence_seasonally_adjusted`,
`economic_climate_seasonally_adjusted`, `willingness_to_buy_seasonally_adjusted`) — the Phase-0 one-key-per-table
shape was incidental, never a rule; each CBS-persbericht figure that users ask for by name earns its own key.
The headline key repeats the werkloosheid canonical-default pattern (everyday term → the seasonally-adjusted
series, stated in `definitionLabel`); the prod vocab overlap with the WP16-onboarded uncorrected sibling
`83694NED` was resolved by trimming the sibling's auto-derived terms ([#165](../open-questions.md)). Two
operational facts this addendum pins for future adds: (1) any `CANONICAL_MEASURES` change re-hashes every
intent/followup/clarify/delivery LLM replay fixture ([#164](../open-questions.md) — budget a re-record);
(2) `AVAILABLE_GRAINS` in `src/answer/intent/prompt.ts` is a SEPARATE hand-maintained map — omitting the new
key silently advertises `['JJ']` to the LLM, wrong for a monthly-only table. Verification-task convention for
curated adds: frozen `CC*` tasks in `benchmark/coverage-key.json`, scored hermetically by
`tests/query/coverage-key.test.ts` (the docs/05 onboarding rule), leaving B1–B20 and its gate counts untouched.

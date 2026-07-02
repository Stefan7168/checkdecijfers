# Build plan — Phase 0 pipeline (the work plan)

**What this is:** the ordered sequence of the remaining Phase 0 work packages — one build session each (RUNBOOK: "one chat session = one work package"). Each entry states its scope, the invariants at stake, the key design decisions/contracts, and what "done" means. A session's kickoff is then just *"do the next work package in [docs/08-build-plan.md](08-build-plan.md)"* — the brief already lives here, not in a chat message.

**How this differs from the neighbours** (so nothing is duplicated):
- [03-mvp-scope.md](03-mvp-scope.md) — the phase **gate**: what is/isn't in Phase 0. Doesn't change per session.
- [06-roadmap.md](06-roadmap.md) — the **phases** (0–3) at a high level.
- [STATUS.md](STATUS.md) — the **live tracker**: the tick-list, the latest benchmark score, the immediate next-up. Changes every session.
- **This doc** — the **order and the briefs**: what each remaining session actually builds, and the design decisions that must stay consistent across sessions.

**Status of the decisions here:** they are the *plan of record*, not frozen law. The implementing session firms them up against the code in front of it and records any deviation (with reasoning) in its ADR / lessons-learned. New load-bearing choices get an ADR per [CLAUDE.md](../CLAUDE.md).

**Completed so far** (details in [STATUS.md](STATUS.md) phase history): WP1 CI skeleton + validated table set · WP2 ingestion + validation pipeline · WP3 benchmark answer key frozen · WP4 table registry + alias list.

---

## Sequencing note — why build order ≠ runtime order

The runtime pipeline runs intent → query → answer ([04-architecture.md](04-architecture.md)). The **build** order deliberately differs: we build the deterministic core (query / validation / derivations) **before** the LLM intent parser. Reasons (decided 2026-07-03): the deterministic layer is the anti-hallucination core, it needs no LLM or API key so it is fully testable in hermetic CI, and it lets us score B1–B14 against the frozen answer key with zero LLM involved — so when the parser lands next it targets a *known-good* query layer and a *fixed* intent contract, and any failure is unambiguously the parser's.

---

## WP5 — Deterministic query + validation + registered derivations  ← NEXT

**Module:** `src/query/` (ADR [001](decisions/001-single-app-vs-split.md) boundary). Reads `canonical_measures` + `observations` (from WP4); no LLM anywhere in this WP.

**Scope:** take a *structured intent*, resolve it to CBS coordinates, run the SQL, validate, attach attribution, apply any registered derivation, and return either a `ValidatedResult` or a typed refusal.

**Defines the structured-intent contract** (the input) — a typed object that the future intent parser (WP6) must emit. Because we build query-first, WP5 *fixes* this contract. Minimal-but-sufficient for B1–B14: a `canonical_measures` key (or explicit table + measure + dims), region code(s), period(s) or a period range + grain, and a derivation kind (`none | difference | max | series`). Write it as a typed contract in `src/query/` and mark it as the intent parser's target.

**Output — `ValidatedResult`:** value, unit, decimals, CBS status, the full coordinate set (region / period / dims), attribution (table id, title, our sync date, covered period), and a stable result id so every number is traceable (**R1**).

**Derivations = registered functions only (R5):** `difference` (B13), `max` (B14), and pre-registered `direction` + `first/last` for every series result (**R9**, so honest trend sentences have something to bind to). Each derivation records its source result ids and carries the "bewerking van CBS-gegevens door checkdecijfers.nl" marking ([05-data-rules.md](05-data-rules.md), CC BY).

**Validation + refuse-don't-guess (principle c):** existence / unit / period / region checks; when data is missing, out-of-scope, or stale, return a **typed refusal**, never a value. Distinguish "outside the loaded slice" from "not published by CBS" ([05-data-rules.md](05-data-rules.md)). Expose the freshest available period so a B20-style freshness refusal has something to offer.

**Invariants at stake:** R1, R4, R5, R9, R10, R11. (R2/R3 are LLM-output checks — WP7, not here.)

**Done =** score benchmark tasks **B1–B14 against [benchmark/answer-key.json](../benchmark/answer-key.json)** using hand-authored structured intents, passing in hermetic CI (PGlite + committed fixtures, ADR [009](decisions/009-hermetic-test-database.md); never against Supabase). Converts the matching `todo`-marked obligations in `tests/invariants` into real tests. Green CI is the only done-signal.

---

## WP6 — Intent parsing (LLM)

**Module:** `src/answer/` intent step (ADR [004](decisions/004-llm-usage.md): LLM confined to schema-validated roles). First WP to spend Anthropic tokens — confirm the spend cap first.

**Scope:** Dutch question → **ranked candidate intents + confidence** (the WP5 contract), per **R7**: more than one candidate above cutoff, or a top candidate below threshold → clarification, never a best guess (user-facing ambiguity: region / period / materially different definitions). Registry-internal variant choice resolves to the canonical default instead, stated transparently.

**Open design questions to resolve here:** confidence threshold + calibration procedure against a labelled ambiguous-question set ([open-questions #19](open-questions.md)); **how to test an LLM call in hermetic CI** (record/replay fixtures or a fake client for CI, plus a separate live-eval path that is not on the CI gate). Likely an ADR.

**Invariants:** R7. Regression: B15/B16 (clarify), and B3/B5 un-disambiguated variants must resolve to the canonical default without clarifying ([02-user-scenarios.md](02-user-scenarios.md), Scoring).

**Done =** the answerable tasks resolve to the right structured intent (feeding the proven WP5 layer); the clarification tasks ask exactly one compact question.

---

## WP7 — Answer composition (LLM phrasing + guards)

Phrase validated results in Dutch with numbers injected verbatim; enforce **R2** (prompt sees only validated result objects), **R3** (verbatim numbers, digit-form, one regeneration then fail closed to a template), **R9/R10** (semantic + unit binding). Includes the attribution/freshness line (**R4**) and provisional marking (**R11**). Done = B1–B14 pass end-to-end with zero fabricated numbers.

## WP8 — Chart spec + dumb renderer

Deterministic chart spec from validated results; pure renderer over the spec (**R6**), attribution inside the spec (ADR [007](decisions/007-chart-spec-rendering.md)). Done = B4/B8 render a correct line chart whose points equal their cells.

## WP9 — Refusal & clarification behaviour

The full failure-behaviour table in [05-data-rules.md](05-data-rules.md): scope / forecast / causal / freshness refusals and one-round clarification. Partly cross-cutting (WP5 gives typed refusals, WP6 gives clarification) — this WP makes B15–B20 all pass. Done = 6/6 refusal tasks pass, no guessed numbers.

## WP10 — Audit record per answer (R8)

One `audit_answers` row per answer/refusal: question, intent, query plan, result ids, numbers, table versions, timestamps, final text + chart spec. Done = the record *reconstructs* every answer; benchmark scorer reads these.

## WP11 — Ops guardrails + full benchmark run

Finish the guardrails (billing alerts; confirm spend caps; Dependabot security alerts) and record the **first full 20-task benchmark run** in STATUS — the Phase 0 gate decision ([03-mvp-scope.md](03-mvp-scope.md): ≥12/14 answerable, 6/6 refusal, zero fabricated numbers).

---

*When a WP completes: tick it in [STATUS.md](STATUS.md), record measured results, and — if a design decision here changed — update this file so it stays the plan of record.*

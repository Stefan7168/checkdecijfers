# Build plan — Phase 0 pipeline (the work plan)

**What this is:** the ordered sequence of the remaining Phase 0 work packages — one build session each (RUNBOOK: "one chat session = one work package"). Each entry states its scope, the invariants at stake, the key design decisions/contracts, and what "done" means. A session's kickoff is then just *"do the next work package in [docs/08-build-plan.md](08-build-plan.md)"* — the brief already lives here, not in a chat message.

**How this differs from the neighbours** (so nothing is duplicated):
- [03-mvp-scope.md](03-mvp-scope.md) — the phase **gate**: what is/isn't in Phase 0. Doesn't change per session.
- [06-roadmap.md](06-roadmap.md) — the **phases** (0–3) at a high level.
- [STATUS.md](STATUS.md) — the **live tracker**: the tick-list, the latest benchmark score, the immediate next-up. Changes every session.
- **This doc** — the **order and the briefs**: what each remaining session actually builds, and the design decisions that must stay consistent across sessions.

**Status of the decisions here:** they are the *plan of record*, not frozen law. The implementing session firms them up against the code in front of it and records any deviation (with reasoning) in its ADR / lessons-learned. New load-bearing choices get an ADR per [CLAUDE.md](../CLAUDE.md).

**Completed so far** (details in [STATUS.md](STATUS.md) phase history): WP1 CI skeleton + validated table set · WP2 ingestion + validation pipeline · WP3 benchmark answer key frozen · WP4 table registry + alias list · WP5 deterministic query + validation + registered derivations (contract in ADR [011](decisions/011-query-contract.md); two additions beyond the brief below: comparisons also pre-register a non-explicit ranking so B10's "meer dan" has an R9 binding target, and freshness refusals offer period + status but **never a value** — [open-questions #37](open-questions.md), resolved).

---

## Sequencing note — why build order ≠ runtime order

The runtime pipeline runs intent → query → answer ([04-architecture.md](04-architecture.md)). The **build** order deliberately differs: we build the deterministic core (query / validation / derivations) **before** the LLM intent parser. Reasons (decided 2026-07-03): the deterministic layer is the anti-hallucination core, it needs no LLM or API key so it is fully testable in hermetic CI, and it lets us score B1–B14 against the frozen answer key with zero LLM involved — so when the parser lands next it targets a *known-good* query layer and a *fixed* intent contract, and any failure is unambiguously the parser's.

---

## WP5 — Deterministic query + validation + registered derivations  ✅ done 2026-07-03

Built as briefed; the brief's contract sketch is now the real, frozen contract in [src/query/types.ts](../src/query/types.ts) (ADR [011](decisions/011-query-contract.md) records the load-bearing choices: coordinate result-ids, the ten-kind refusal taxonomy, one-varying-axis rule, no dim overrides on canonical targets). Done-criterion met and in CI: B1–B14 reproduce the frozen key through hand-authored intents + B20 refuses with the right freshness offer, hermetically; R1/R4/R5/R9/R10/R11 query-layer invariant tests are real ([STATUS.md](STATUS.md) for measured results).

---

## WP6 — Intent parsing (LLM)  ✅ done 2026-07-03

Built as briefed; both open design questions resolved in ADR [012](decisions/012-intent-parsing-llm-harness.md): **hermetic CI** = record/replay fixtures keyed by a full-request hash behind an LLM-client seam (a changed prompt/schema/model/registry fails loudly; the live eval `npm run intent:eval` is off-gate), and **R7 thresholds** = 0.9/0.35, calibrated against a 45-case labelled set ([benchmark/intent-labelled-set.json](../benchmark/intent-labelled-set.json), resolves [open-questions #19](open-questions.md)). Done-criteria met and measured (45/45 live, zero flips over 3 repeats; [STATUS.md](STATUS.md)). Notable beyond the brief: the LLM emits registry vocabulary only (canonical keys, region *names*, structured period specs) — deterministic code owns name→code resolution and "groei in jaar X" cell selection; WP6 also classifies forecast/causal/out-of-scope/compound/smalltalk (the classification WP9 will phrase); period-policy default for present-tense questions is owner-revisable ([open-questions #40](open-questions.md)).

---

## WP7 — Answer composition (LLM phrasing + guards)  ✅ done 2026-07-03

Built as briefed; ADR [013](decisions/013-answer-composition.md) records the load-bearing choices: WP6's harness generalized into one shared seam with a second fixture set (intent fixture hashes preserved byte-identically), `claude-sonnet-5` for phrasing (mid-tier per ADR 004), values handed to the model pre-formatted, the user's question deliberately excluded from the phrasing prompt (R2 literal; open-questions #41), the R3 ladder (one regeneration → validator-clean template; null-cell results skip the LLM), attribution/marking/definition as structural fields, and factor units never expanded (#42). Done-criterion met and in CI: B1–B14 end-to-end hermetically with zero fabricated numbers; measured live 14/14 (prompt v3, repeat=2, zero fallbacks). Notable beyond the brief: an adversarial multi-agent review (23 double-confirmed findings, five executable validator bypasses) hardened the validator before commit — cardinal number-words, 'daling'/separable verbs, fullwidth digits, derivation-value binding, count collisions ([STATUS.md](STATUS.md) for measured results).

## WP8 — Chart spec + dumb renderer  ✅ done 2026-07-03

Built as briefed, with one recorded deviation (ADR [014](decisions/014-chart-spec-v1-and-renderer.md)): the Phase 0 renderer is a **pure, dependency-free SVG generator**, not the Recharts client wrapper — no app exists yet to mount a client component, and `src/` runs under Node type stripping where JSX cannot be imported; the Recharts wrapper (ADR [008](decisions/008-ui-foundation.md) constraint 3, unchanged) lands with the chat-UI session over the same spec, and the SVG renderer doubles as the server-side path ADR 008 reserved for Phase 2 static images. ChartSpec v1 is versioned + zod-validated; policy: `series` → line, `comparison` → bar, `single`/`derived` → no chart. Done-criterion met and in CI (seventh gate step): B4/B8 render correct line charts whose points equal their frozen-key cells, the renderer provably adds no numbers (token-provenance check) and omits no point; R6 is a real invariant test ([STATUS.md](STATUS.md) for measured results).

## WP9 — Refusal & clarification behaviour  ✅ done 2026-07-03

Built as briefed (ADR [015](decisions/015-refusal-clarification-composition.md) records the load-bearing choices): refusal/clarification phrasing is **deterministic templates, never an LLM**; one `ComposedResponse` envelope (answer/clarification/refusal) is the pipeline's single output — the seam WP10's audit records wrap; the clarification reply is parsed **merged with the pending partial intent** through a clarify-mode extension of the WP6 prompt (base prompt bytes untouched — the 45 intent fixtures stayed valid; own labelled reply set + fixtures + `npm run clarify:eval`, calibrated live 7/7 with zero flips ×3); still-ambiguous-after-round → refusal-with-guidance on **both** clarification shapes (parser-level and query-level `needs_clarification` — the adversarial review's HIGH catch); the docs/05 staleness row is implemented on both branches (cadence ×1.5 max-age assumption, open-questions [#43](open-questions.md)). Done-criterion met and in CI: B15–B20 pass 6/6 end-to-end hermetically, plus compound/smalltalk and the S3 completes-as-S1 flow against frozen-key answers; refusal/clarification texts carry no numeric token without a structured source ([STATUS.md](STATUS.md) for measured results).

## WP10 — Audit record per answer (R8)  ✅ done 2026-07-03

Built as briefed (ADR [016](decisions/016-audit-records.md) records the load-bearing choices): one `audit_answers` row per produced response (answers, refusals **and clarifications** — migration 004), written by audited wrap functions **before** the response is returned, with a **fail-closed policy** (a failing audit store withholds the answer/clarification — internal refusal — and annotates refusals); the envelope is stored verbatim as the authoritative snapshot with promoted scalar columns for querying; the stored `intent` is the query plan (deterministic layer); `reconstructionReport` re-verifies every row **from the row alone** (stored body re-passes the R3/R9/R10/R11 validator, attribution/text/chart re-derive byte-identically, tamper tests prove teeth). The ADR 015 wrap-site obligations are discharged: reply text + pending clarification on reply rows, the three prompt-version constants + per-call model IDs/token counts/latency on every row. Done-criterion met and in CI: R8 is a real invariant test (the suite carries **zero** todos — all eleven invariants tested), and the **benchmark scorer reads audit records**: `benchmark:run` drives all 20 tasks + the B15/B16 reply rounds + the B3/B5 un-disambiguated variants through the audited pipeline hermetically and dumps the rows; `benchmark:score` scores the dump against the frozen key and fails CI below the docs/03 gate ([STATUS.md](STATUS.md) for measured results).

## WP11 — Ops guardrails + full benchmark run  ← NEXT

Finish the guardrails (billing alerts; confirm spend caps; Dependabot security alerts) and record the **first full 20-task benchmark run** in STATUS — the Phase 0 gate decision ([03-mvp-scope.md](03-mvp-scope.md): ≥12/14 answerable, 6/6 refusal, zero fabricated numbers). The hermetic run/score pair exists since WP10 (CI runs it on every push); WP11's run is the **live** one — real LLM calls through the audited pipeline, real latency for the scoreboard's median-response column — recorded with spend figures and reconciled against the Anthropic Console.

---

*When a WP completes: tick it in [STATUS.md](STATUS.md), record measured results, and — if a design decision here changed — update this file so it stays the plan of record.*

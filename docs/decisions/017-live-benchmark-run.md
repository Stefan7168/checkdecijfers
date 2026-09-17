# ADR 017 — Live benchmark run policy (WP11)

**Status:** accepted (2026-07-03) · **Owner sign-off:** follows the confirmed principles and docs/02/03's benchmark definition; no new product-policy decisions
**Relates to:** docs/02 (Scoring), docs/03 (the Phase 0 gate), ADR [012](012-intent-parsing-llm-harness.md) (record/replay seam — the hermetic half), ADR [016](016-audit-records.md) (audit records are what the scorer reads)

## Context

Since WP10, CI proves the whole pipeline hermetically on every push: `benchmark:run` drives all 20 docs/02 tasks through the audited pipeline over PGlite + replayed LLM fixtures, and `benchmark:score` gates on the result. What that cannot prove: that the *live* system — real Anthropic calls, the real Supabase database over TLS, real latency — produces the same outcomes. The docs/03 gate decision and the STATUS scoreboard's median-response column need a **live** run. WP11 adds it.

## Decision 1 — One runner, two modes; the live run is the hermetic run with real edges

`scripts/run-benchmark.ts` gained a `--live` flag. The task iteration, drift checks, reply rounds and dump shape are the **same code** in both modes; live mode swaps exactly three things: `AnthropicLlmClient` for the three replay clients, `connectFromEnv()` (live Supabase, pinned-CA TLS) for the fixture-ingested PGlite, and the dump target (`benchmark/audit-run-live.json`, `mode: 'live'`). The scorer takes the dump path as an argument and applies the identical gate.

**Why:** a separate live script would drift from what CI proves — same-code-different-edges is the only structure where a live/hermetic disagreement is guaranteed to mean "the live edge behaves differently" and never "the two runners do different things".

**Alternatives considered:**
- *Separate live script*: rejected — two flows scoring one benchmark is a drift generator; WP2's lesson about drifted copies applies to code as much as to task phrasings.
- *Reuse the `answer:eval` calibration harness*: rejected — it scores composed answers, not the audited end-to-end flow; the WP10 point is that the scorer reads audit records.

One deliberate behaviour change over the WP10 runner, applying to both modes: a clarify task whose first response is *not* a clarification no longer crashes the runner — the reply round is skipped and the **scorer** fails the task (wrong kind + missing reply round). Live, a wrong outcome must reach the scoreboard as a scored failure, never abort the run unrecorded.

## Decision 2 — Reference dates stay pinned to the labelled set's clock

The live run injects the same `referenceDate` (2026-08-15, from `benchmark/intent-labelled-set.json`) as the hermetic run — not the wall clock.

**Why:** the frozen answer key defines expected outcomes *under that clock*: "vorige maand" must resolve beyond the loaded CPI slice so B20 exercises the freshness refusal, and relative periods must land on frozen-key cells. The clock is an injected parameter by design (WP6, clock-injection for staleness); a wall-clock run would not be "more live", it would be scoring a different benchmark than docs/02 froze.

**Alternatives considered:**
- *Wall clock*: rejected — the moment CBS publishes new periods (or today drifts past the key's assumptions), pass/fail stops meaning what docs/02 says it means. Latency and parsing-correctness — the things only a live run can measure — do not depend on the injected date.

## Decision 3 — The live database is the target; the run's audit rows are kept

The live run executes against the live Supabase database and writes **real** `audit_answers` rows — they are the R8 trail of the run and stay (append-only). The runner loads back **only the rows it created** (by id) for the dump; `loadAllAuditRecords` remains correct only on a fresh PGlite (the hermetic runner still asserts this run's rows are *all* rows there).

**Why:** real DB latency is part of the median-response measurement; the live schema (migration 004) is part of what the run proves; and an audit trail you prune after reading is not an audit trail.

**Alternatives considered:**
- *PGlite fixtures + live LLM only*: rejected — measures the LLM edge but not the database edge, and proves nothing about the live schema/connection the product will actually run on.
- *Delete the rows after scoring*: rejected — R8's value is that every produced response is reconstructable later; benchmark responses are produced responses.

**Revisit trigger:** at first deploy, live user traffic will share `audit_answers` with benchmark rows (both `user_id = null` today). If benchmark reruns become routine or reporting needs to exclude them, add a run-tag column via a numbered migration ([open-questions #44](../open-questions.md)).

## Decision 4 — Committed provenance is the scorer's report, never the dump

`benchmark:score:live` scores `benchmark/audit-run-live.json` and writes `benchmark/live-benchmark-report.json` (committed): per-task verdicts and problems, gate counts, the latency block (answerable median/min/max — docs/03's criterion 4 is scoped to answerable tasks — plus the all-20 first-turn median), informational counters, prompt versions, per-model token usage. Both dumps stay gitignored. The report is written for failing runs too — an honest red run is provenance, not something to suppress. Every latency or usage figure STATUS cites must be reproducible from this report (adversarial-review fix, 2026-07-03 — the first draft cited ad-hoc computed figures no committed artifact backed).

**Why:** the scorer is the only judge; committing *its* output (not the runner's) keeps the provenance chain "runner produces records → scorer judges records → report is the judgment". The full dump duplicates what the live `audit_answers` table already holds authoritatively.

## Decision 5 — Spend accounting comes from the audit rows

Per-model token totals are aggregated from the run's own `llm_calls` (recorded per ADR 016) into the dump and the report; the in-session € estimate prices those totals, and STATUS records it with the standing "reconcile against the Anthropic Console" note. No separate metering.

**Why:** the audit row is already the authoritative usage record per answer (docs/05); a second bookkeeping path could disagree with it.

## Session 110 addendum — B20 data-conditional live expectation (#216)

**Context.** B20 ("Wat was de inflatie van vorige maand?") is scored as a `freshness` refusal — the docs/02 answer key assumes the loaded CPI table (86141NED) never yet covers "vorige maand" relative to the run's referenceDate. That held for the hermetic run (pinned fixtures, Decision 2's clock injection keeps it true forever) but broke on a real `benchmark:run:live` execution (found session 89, 2026-09-08, [open-questions #216](../open-questions.md)): CBS publishes the CPI roughly two weeks after month end, and by the time a live run actually executes, the real, live table may already cover that period. The live run then produces a fully correct, attributed, non-fabricated ANSWER — which is the right outcome, not a bug — but the pinned frozen-key expectation (always a refusal) scored it as a failure.

**Decision.** The LIVE scorer's B20 expectation is now DATA-CONDITIONAL, derived only from the run's own recorded evidence, never from a guess or from re-checking CBS: if the audit record shows the pipeline found the asked period COVERED — a real `answer`, attributed to exactly the previous calendar month of the run's own `referenceDate` (computed deterministically from the dump, e.g. `2026-08-15` → `2026MM07`), carrying zero fabricated numbers (the pre-existing R1 unbacked-number scan still runs, unchanged) — B20 passes as an answerable task would. If the period was NOT covered, the pre-existing freshness-refusal check (refusal reason, freshness offer matches the frozen key, no value leak) applies completely unchanged. This conditional is gated on `dump.mode === 'live'` — the hermetic path (pinned fixtures, ADR 012's record/replay seam) can never produce an 'answer' kind for B20, so it is provably byte-for-byte unaffected; confirmed by re-running `npm run benchmark:run` + `npm run benchmark:score` (14/14, 6/6, 0 fabricated, PASS, B20 printing `[not covered -> refusal expected]`).

**Why this shape, not the open-questions row's originally-sketched alternative** (asking about a period further back than CBS's typical publication lag, so the gap "stays true regardless of when CBS's release lands"): that alternative still hard-codes an assumption about CBS's lag (today ~2 weeks per the session-89 finding, previously assumed ~6 weeks) into the *task*, which is exactly the kind of guess principle (c) forbids baking into a scoring key — a future lag change would silently reintroduce the same failure mode, just at a different offset. Deriving the expectation from the run's OWN recorded evidence (what the pipeline actually found, checked for correctness) instead of from an assumption about CBS's publication cadence keeps the gate honest under any lag, and keeps the hermetic task definition (docs/02, the frozen key) completely untouched — only the LIVE scorer's judgment logic changed.

**Alternatives considered:**
- *Change B20's question to a period further from "now"* (the open-questions row's original sketch): rejected per above — still an assumption-based offset, and HARD-forbidden for this fix specifically (touching task phrasing invalidates the recorded LLM fixtures the hermetic gate replays — real spend to re-record).
- *Drop B20 from the live run entirely*: rejected — a freshness refusal (or its correct-answer counterpart) is exactly the kind of real-edge behavior only a live run can prove; removing it loses coverage rather than fixing the assumption.
- *Hard-code today's known CBS lag into the scorer as a fixed threshold*: rejected — same "assumption baked into a scoring key" problem as the rejected task-phrasing alternative, just moved into code; the run's own evidence is the only input that can never go stale.

**As-built, not yet run live.** Built and verified session 110 (2026-09-17) against the hermetic pair and a scorer-teeth suite (`tests/benchmark/scorer-teeth.test.ts`) that constructs synthetic `mode: 'live'` dumps — including one genuine, reconstructable 'answer' `AuditRecord` built via the real deterministic pipeline (`respondToIntent`, `templateOnly: true` — no LLM call) over the real ingested fixture database's actual freshest loaded CPI month (2026MM06) — pinning both branches (covered→answer passes; an advanced/covered freshness offer on a refusal still fails; not-covered→refusal still passes; an answer attributed to the wrong/uncovered period fails). The next real `npm run benchmark:run:live` (owner-supervised spend) has not been executed against this change.

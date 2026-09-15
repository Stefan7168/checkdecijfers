# STATUS

> **Tracker, not a source of truth.** Scope and the gate are defined in [03-mvp-scope.md](03-mvp-scope.md), the benchmark in
> [02-user-scenarios.md](02-user-scenarios.md). This file only records progress against them. Update it whenever project state changes (see the
> definition of done in [CLAUDE.md](../CLAUDE.md)) — with **measured results only, never aspirational ones**.

> **Session log lives in [status-archive.md](status-archive.md)** — full per-session "Last updated" entries, verbatim, newest on top.
> **Convention (since 2026-07-12, session 41):** at session wrap-up, PREPEND the full session entry to
> [status-archive.md](status-archive.md) and update only the lean top block below. Keep STATUS.md readable in one
> Read call: hard-wrap every line at ~150 chars, no kilobyte-long lines.
> **Doc-freshness sweep, 2026-09-15 (session 103):** the session-94 "known debt" note above (this line's
> predecessor) claimed sessions 56 through 99 were never archived — checked before acting on that claim,
> and it was wrong: every one of those sessions already had a full, more detailed entry in
> [status-archive.md](status-archive.md) (verified directly, e.g. session 89's archive entry is a
> numbered multi-part account where this file's copy was a short paragraph). What was actually stale was
> this file itself, which had never been trimmed back down to the lean top block the session-41
> convention calls for. The ~1,180-line duplicate narrative block that used to sit below this point is
> now removed; any standing decision embedded in it (e.g. KvK staying parked, [#54](open-questions.md))
> already lives independently in [open-questions.md](open-questions.md) and was not lost.

**▶ SESSION 104 (2026-09-15/16): PR #32 MERGED (`6af91dd`) and LIVE — verified logged in on production, not
just CI-green.** The owner reacted very negatively to `/bevolking-3d-demo` compared to his own separate
reference site (`checkdecijfers-3d-demo.vercel.app`) and authorized autonomous overnight rework. Built by a
background agent in an isolated worktree per
[superpowers/plans/2026-09-16-bevolking-3d-demo-v2.md](superpowers/plans/2026-09-16-bevolking-3d-demo-v2.md),
independently re-verified by the orchestrating session before merge (typecheck, 1801/1801 tests, real build,
`/code-review` LOW — zero findings; one real finding from CI itself — a live GitHub PR link in the ADR
violating #132 — caught and fixed before green). **After merge, logged into PRODUCTION for real** (the
owner's own Google session, via Claude in Chrome, since the OAuth callback is hardcoded to production and
there is no PR preview deployment) and confirmed live: the floating legend card renders, the 5-step guided
narrative renders, and dragging the year slider from 1995 to 2024 turns the previously all-grey map into a
full blue/orange choropleth terrain exactly as designed. Full as-built: ADR
[049](decisions/049-3d-municipality-map-demo.md)'s v2 addendum. Deferred scope (the commuting-flow `/pendel`
demo the owner also linked, and the other 16 pages on his reference site): [open-questions #258](open-questions.md)
— not built, not decided, tracked for the owner to triage. Branch + PR per [#118](open-questions.md)(b)
(autonomous build, owner-present merge — the owner explicitly said "Just merge it" once shown the before
screenshot and CI-green status, [#118](open-questions.md)(a)). Worktree `bevolking-3d-demo-v2` still needs
cleanup (`git worktree remove`) — not yet done as of this block being written.

**▶ NEXT SESSION STARTS HERE (written 2026-09-15, session 103 — a long session, both autonomous stretches
and owner-present stretches; verify against `git log`/`gh pr list` before trusting anything below, since
more may have landed after this was written).** **Two PRs MERGED to `main` this session — PR #30 (the 3D
municipality map DEMO, `49cd975`) and PR #31 (chart-card polish, `f733db7`) — both after an independent
`/code-review` pass (8 finder angles, 1-vote verify) found 9 real, confirmed issues across the two PRs,
all fixed and re-verified before merging, CI green on every step. Seven PRs remain open, untouched by
this stretch: #23 (WP30c E1 Eurostat), #24 (health-check `pro_subscriptions` fix), #25 (dead chart-story
cleanup), #26 (DatasetTurnEnvelope key manifest, #209), #27 (shared isRedacted helper, #227), #28
(useElementWidth reparenting fix, #234), #29 (this file's own known-debt trim — the note it refers to has
since been replaced by the "Doc-freshness sweep" note above). **Session 104 update: #24–#29 all merged
(#23 still open — CONFLICTING, and carries an unresolved "Constraint 0" question, so deliberately not
auto-merged; see [open-questions #249](open-questions.md)).** Full account, including the merge-conflict story and
the four process lessons this stretch surfaced: [status-archive.md](status-archive.md)'s session-103
entries (two, newest on top — the continuation covering PR #31 + the reviews + the merges, then the
original PR #30 build entry beneath it).

## Phase 0 checklist

- [x] Open questions #10, #18, #20 answered by Stefan (2026-07-02 — see [open-questions.md](open-questions.md))
- [x] Doc-set sign-off by Stefan (2026-07-02)
- [x] CBS table set chosen; IDs validated against the live catalog (2026-07-02, open-questions #1 resolved — 8 tables, all v4-reachable, every
      benchmark period confirmed present: [07-phase0-table-set.md](07-phase0-table-set.md))
- [x] Benchmark answer key frozen (2026-07-03: [benchmark/answer-key.json](../benchmark/answer-key.json) — 14/14 answerable tasks + B20 freshness
      reference, values re-verified against the live ingest, not just copied from docs; [02-user-scenarios.md](02-user-scenarios.md), Scoring)
- [x] Ingestion + validation pipeline with fixture tests (2026-07-03: five ordered checks, quarantine, correction-diff log, idempotent syncs; the 10
      inherited `todo` obligations are now 21 real fixture tests + 8 adapter tests on an embedded real-Postgres test DB (ADR
      [009](decisions/009-hermetic-test-database.md)); adversarial review found and fixed 2 ordering/defaulting bugs; live ingest recorded above)
- [x] Table registry + alias list (2026-07-03: ADR [010](decisions/010-registry-canonical-measures.md);
      `cbs_tables.default_coordinates`/`.period_semantics` populated for all 8 tables, `canonical_measures` alias list seeded with 8 canonical
      concepts, applied live and idempotently; 14 hermetic tests incl. cross-checks against the frozen benchmark key)
- [x] Intent parsing (schema-validated, ranked candidates + confidence) (2026-07-03: `src/answer/intent/` per ADR
      [012](decisions/012-intent-parsing-llm-harness.md) — LLM emits registry vocabulary only, deterministic resolution to CBS codes, R7 thresholds
      calibrated at 0.9/0.35 against a 45-case labelled set, 45/45 measured live with zero flips over 3 repeats; CI replays committed LLM fixtures
      hermetically)
- [x] Deterministic query + validation + registered derivations (2026-07-03: `src/query/` per ADR [011](decisions/011-query-contract.md) — intent
      contract fixed for WP6, coordinate result-ids, registered derivations with CC BY marking, ten-kind refusal taxonomy incl. slice-vs-unpublished
      distinction and value-free freshness refusals; B1–B14 reproduce the frozen key + B20 refuses correctly, hermetically in CI)
- [x] Answer composition with verbatim/semantic/unit checks (2026-07-03: ADR [013](decisions/013-answer-composition.md) — `src/answer/compose/` +
      shared LLM harness; R1/R2/R3/R4/R5/R9/R10/R11 answer-side invariant tests real; B1–B14 end-to-end hermetic in CI with zero fabricated numbers;
      14/14 measured live, prompt v3, zero template fallbacks)
- [x] Chart spec + dumb renderer (2026-07-03: `src/chart/` per ADR [014](decisions/014-chart-spec-v1-and-renderer.md) — versioned zod-validated
      ChartSpec v1 built deterministically from validated results, pure dependency-free SVG renderer, R6 real; B4/B8 line charts reproduce the frozen
      key hermetically in CI; Recharts client wrapper deferred to the chat-UI session per ADR 014)
- [x] Refusal & clarification behavior (2026-07-03: ADR [015](decisions/015-refusal-clarification-composition.md) — `src/answer/respond/`
      deterministic templates + one-round clarify-reply merge; B15–B20 6/6 hermetic in CI; staleness both branches clock-injected; clarify-reply
      calibrated live 7/7, zero flips ×3)
- [x] Audit record per answer (R8) (2026-07-03: ADR [016](decisions/016-audit-records.md) — migration 004 `audit_answers`, one row per
      answer/refusal/clarification written before the response returns, fail-closed on audit failure; `reconstructionReport` re-verifies every row
      from the stored row alone with tamper tests proving teeth; benchmark scorer reads audit records: hermetic run/score pair in CI, gate PASS
      measured 14/14 + 6/6 + 0 fabricated)
- [x] CI gate live (2026-07-02): GitHub Actions runs typecheck + the eight gate suites + the benchmark run/score pair on every push. State after WP10
      (2026-07-03): **432 real tests + 0 todos** — the query suite scores B1–B14 against the frozen key (hand-authored intents), the answer suite
      drives B1–B14 **and B15–B20 plus the clarification round** end-to-end over replayed intent/answer/clarify fixtures (ADR
      [012](decisions/012-intent-parsing-llm-harness.md)/[013](decisions/013-answer-composition.md)/[015](decisions/015-refusal-clarification-composition.md)),
      the chart suite proves B4/B8 line charts against the frozen key, the audit suite proves R8 (rows reconstruct, fail-closed, tamper detection),
      and `benchmark:run`+`benchmark:score` produce and score the full 20-task run from audit records (a missing dump is a CI failure) — still no
      secrets and no network. After WP11 (2026-07-03): **445 real tests** — the benchmark suite gained the scorer-teeth tests, which score tampered
      dumps through the real scorer subprocess and pin every docs/03 gate leg (both sides of the ≥12/14 boundary, 6/6, zero-fabricated, the
      fail-closed duplicate-id/missing-dump guards). **After WP12 (2026-07-04): `gate` job also runs `web/`'s own typecheck + 6-test suite; a second
      job, `deploy`, is gated on `gate` via `needs:` and is the only thing that ever deploys (Vercel git integration deliberately not connected) —
      deploy-blocking-on-red is live, not just planned.**
- [x] Provider spend caps, billing alerts, and dependency alerts set (complete 2026-07-04: Anthropic €25/mo spend cap confirmed set 2026-07-02;
      **Anthropic billing alert confirmed set by the owner 2026-07-04** (RUNBOOK step done); **dependency alerts complete** 2026-07-03 — weekly
      grouped version-update PRs via `.github/dependabot.yml`, Dependabot *security alerts* enabled by the owner (verified via the GitHub API,
      `/vulnerability-alerts` → 204), Dependabot *security-update PRs* enabled via the API in WP11 (`/automated-security-fixes` → `enabled: true`);
      web/'s own independent lockfile got a matching second Dependabot entry in WP12)
- [x] Full benchmark run recorded below (2026-07-03, WP11: live run through the audited pipeline — gate criteria measured PASS, see scoreboard;
      provenance in [benchmark/live-benchmark-report.json](../benchmark/live-benchmark-report.json), policy in ADR
      [017](decisions/017-live-benchmark-run.md))
- [x] Minimal chat UI + first deploy (2026-07-04, WP12: [web/](../web/) — Next.js App Router chat UI over the audited entry points, Recharts wrapper
      over ChartSpec v1, CI-gated Vercel deploy; ADR [018](decisions/018-chat-ui-and-deploy.md). **Live at https://checkdecijfers.vercel.app** — all
      four `ComposedResponse` kinds (answer, chart, clarify-then-refusal, direct refusal) measured working against the real deployment)

## Benchmark scoreboard

| Date | Answerable (of 14) | Refusal (of 6) | Fabricated numbers | Median response | Gate verdict |
|---|---|---|---|---|---|
| 2026-07-03 (live, WP11) | **14/14** | **6/6** | **0** | 6,465 ms (all 20 first turns; answerable-only 7,289 ms) | **PASS** |

Gate: ≥12/14 answerable, 6/6 refusal, **zero** fabricated numbers ([03-mvp-scope.md](03-mvp-scope.md)). Also reported, informational: median latency,
clarification count on B1–B14, template-fallback count, un-disambiguated phrasing check ([02-user-scenarios.md](02-user-scenarios.md), Scoring).


## Phase history

| Phase | Status | Gate result |
|---|---|---|
| Docs / discovery | ✅ complete (2026-07-02) | — |
| Phase 0 | ✅ complete (started 2026-07-02, closed 2026-07-04) | **PASS** — criteria measured 2026-07-03 (live run, see scoreboard row + [benchmark/live-benchmark-report.json](../benchmark/live-benchmark-report.json)); owner (Stefan) signed off in session, 2026-07-04; WP12 (chat UI + deploy) closed the checklist 2026-07-04 |
| Phase 1 | — | — |
| Phase 2 | — | — |

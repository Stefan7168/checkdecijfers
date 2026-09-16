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

**▶ NEXT SESSION STARTS HERE (written 2026-09-17, session 107 — spanned 2026-09-16 into 2026-09-17;
verify against `git log`/`gh pr list` before trusting this, since more may have landed after it was
written).** **Session 107 closed out TWO independent threads, both merged to `main`, CI green on
both:**

**(1) The chart alternate-reading toggle** — [ADR 051](decisions/051-chart-alternate-reading-toggle.md),
resumed from session 106's pause (Task 6 finished: the anonymous trial chat wired in, owner's
explicit choice), whole-branch review, **MERGED (`b31d84a`, run `35115201383`)**.
[#254](open-questions.md)'s second gap is resolved for the seasonally-adjusted/same-measure-alternate
half (~20 registered concepts); level-vs-%-change stays open, needs a new registered derivation +
an ADR 011 revision.

**(2) Eurostat WP30c E1's "Constraint 0"** — resolved directly by the owner in chat ("no real API
spend" meant money, not any live call). The live fixture capture found + fixed two real API-shape
defects (the Catalogue endpoint's real TSV shape; the Statistics API's real sparse `value` object
shape — [ADR 048](decisions/048-eurostat-data-source.md)'s As-built addendum) and a genuine
cross-branch migration-number collision (`031_source_doi.sql` vs. an unrelated
`031_chart_headlines.sql`, renumbered to 032/033). **MERGED (`46527a8` + `1b23298`, run
`35125746817`).** Full verification (covers both threads combined, run after the second merge):
backend 165 files/2466 tests, web 117 files/1854 tests, benchmark 14/14 + 6/6 + 0 fabricated, real
`next build`, both typechecks clean, `/code-review` LOW clean on each thread.

**Owner then explicitly asked to apply migrations and register a real table — RUNBOOK "WP30c E1"
steps 4-5, now done.** Migrations 032/033 applied to production, verified live. `eurostat:tipsbd30`
(Tier-1 capital ratio banking sector) registered and synced: 532 real rows, 0 corrections. **This
surfaced a fifth real defect, in `registerTables` itself:** its own insert never wrote
`cbs_tables.source`, so every table ever registered silently landed tagged `'cbs'` — invisible until
the first non-CBS registration. Not a live-chat safety gap (the deny gate derives source from the
table id's own prefix, never this column) but a real display bug (the explorer's own query couldn't
find the table). Fixed + regression-tested (`0a5c2c8`, CI green, run `35132208250`); the one
affected production row corrected directly, verified against the live DB. Full account: ADR 048's
second As-built addendum. **Eurostat WP30c E1 is now fully through all 5 RUNBOOK steps** — still
genuinely open: `doi` is never populated ([#264](open-questions.md), a separate gap), and a full
`/eurostat-explorer` browser click-through wasn't done (needs the owner-supervised
`EUROSTAT_EXPLORER_ENABLED` flip) — the explorer's own backing query, run directly against the live
database, does confirm the table is findable.

Session 106 also shipped, separately and already live before this: the Supademo chart-polish
comparison's one pending decision (`framePadding: 'none' → 'small'`, owner-confirmed, `c934f1d`) —
the broader "match Supademo's polish" question stays logged, not built ([#260](open-questions.md)).
The 3D-demo thread stays closed — do not resume it without a new, explicit owner ask. Full account
of sessions 106-107: [status-archive.md](status-archive.md). Session 108 kickoff (written before the
migration/registration work above — the "Eurostat next step" it names is now done, see this block
instead): [session-briefs/2026-09-17-session-108-kickoff.md](session-briefs/2026-09-17-session-108-kickoff.md).

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

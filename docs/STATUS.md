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

**▶ NEXT SESSION STARTS HERE (written 2026-09-17 UTC, session 110 — the session ran ~05:50Z to ~17:30Z,
which is already 2026-09-18 in the machine's local time zone, so `git log` shows both dates — verify
against `git log`/`gh run list` before trusting this).** **Session 110 was
fully autonomous (owner away: "work for hours, use subagents, make the web app finished, do not ask
me questions").** FOURTEEN waves, ~70 subagents in their own worktrees, every batch merged into
`main`, verified once serially and pushed — 226 commits, 276 files, from `261d254` to `6745194`.
CI: green on every code push except two (`35239287984`, `35247423023` — a stale e2e pin, fixed by
`42f0eb3`, run `35248020384` green; last code run `35250447097` green incl. deploy). Production
(`checkdecijfers.vercel.app`) answered 200 on `/` and `/api/health` at wrap-up. Full account:
[status-archive.md](status-archive.md) session 110.

- **[#253](open-questions.md) region-set query — BUILT, tasks 1–8** ([ADR 054](decisions/054-region-set-query.md),
  [plan](superpowers/plans/2026-09-17-region-set-query.md)): "alle provincies / gemeenten in Utrecht"
  → one cell per region, ranking claimed ONLY over a complete set (RS1), sorted bars, template-only
  answer, R8 reconstruction. **Reachable only via a hand-authored intent until Task 9** (parser
  exposure = owner-supervised 103-fixture re-record, [#267](open-questions.md)).
- **UX audit + fixes, two passes** — [pass 1](session-briefs/2026-09-17-session-110-ux-audit.md) (25 findings;
  17 mechanical + 4 design-decided rows FIXED: phone sidebar overlay; a malformed auth cookie no longer
  500s every route; …) and [pass 2](session-briefs/2026-09-17-session-110-ux-audit-pass2.md) over the
  surfaces pass 1 could not reach (17 findings, ALL 17 mechanical rows FIXED: the trial keeps its last
  answer on screen; embed snippet height + the embed document grows with content; story Auto-play runs
  to the end; Enter activates annotation points; …). Left for the owner: pass-1 row 22 ("Draft" banner),
  pass-2 rows 18/19 (source-aware footer on Eurostat pages; the "go Pro" pitch in embed footers).
- **Chart export** — PDF (vector) + "PNG, chart only (transparent)" ([ADR 053](decisions/053-chart-export-formats.md)); defaults byte-identical.
- **[#23](open-questions.md) alerts COMPLETE** — missed-sync (cadence from `period_semantics`) + health-probe, both on the daily cron.
- **Wave 14:** the route split — anonymous visitors no longer download the workspace (−222 KB raw
  first-load JS, ADR 033 D8); two red CI runs from a stale e2e pin fixed the same hour.
- **Wave 13:** pass-4 design rows built (qualified region labels, one region per line, shared
  period prefix dropped), a verification-only browser pass (36 of 40 fixes VERIFIED; the 4
  residuals fixed the same hour), the logged-in bundle measured (identical to anonymous — route
  split is the next target). Owner rows: [#271](open-questions.md) EN interface still answers in Dutch.
- **Waves 11–12:** a "trend per region" chip on comparison answers (the doorway into ADR 055), two
  more e2e tests (7/7), a fourth UX audit over the new shape with all 11 mechanical rows fixed
  (z-indexed bar labels, width-relative margins, end-label collisions, small-multiples axis sizing +
  period caption, region-named chip, humanised gap notes).
- **Wave 10 — [ADR 055](decisions/055-multi-region-series.md) multi-region time series BUILT and
  reachable through the parser today:** up to 6 named regions over a period range (one line per
  region, per-region trend claims only where both endpoints exist — MS1 —, structural coverage
  disclosure, small multiples finally reachable). No fixture re-record was needed. Pending owner
  spend: a live benchmark run + live `audit:verify` ([#270](open-questions.md)).
- **Wave 9:** pass-3 design rows built (hbar extreme labels, one colour per comparison, "Hoogste/
  Laagste" insight titles, an honest multi-region × multi-period refusal + offer chips) and a
  **Playwright e2e smoke in CI** through the hermetic harness (a hard gate since its first green run,
  run `35223290808`).
- **Waves 7–8:** a third UX audit (via the harness's intent injector) + an axe-core audit, all
  mechanical rows FIXED — **P1** the proof panel was missing on every STORED answer (a `'use client'`
  import in a server path, throw swallowed); comparison charts open on horizontal bars at every
  series count with row-proportional height; story auto-play cancel is input-based (the real root
  cause); contrast/landmarks/heading-order; zod out of the chart render path (landing −374 KB raw);
  lazy-loaded modal/style panel/story stage/notes; security read clean; nl/en copy pass.
- **Wave 6:** the hermetic harness now renders region-set answers (`HARNESS_INTENT_INJECT=1`,
  `!!regionset provincies`) and a registered Eurostat fixture table; embeds auto-resize via
  `postMessage`; the Eurostat explorer's footer names Eurostat; README + web/README rewritten; fifth
  open-questions triage (43 rows archived, 142 live).
- **Smaller:** [#254](open-questions.md)(a) %-change on income alternates; [#262](open-questions.md)(c)/[#229](open-questions.md)
  embed toggle + live embeds rebuild alternates; [#216](open-questions.md) live-scorer B20 data-conditional;
  [#134](open-questions.md)(c) refusal offer chip; 16–40-series comparisons open on hbar;
  [#245](open-questions.md) Action 3 test-DB reset helper (795 s → 200 s over 40 files).

**Measured (final tree, after wave 14):** backend 188 files / 2769 tests, web 121 / 2108 (+ 7 Playwright e2e), benchmark
14/14 + 6/6 + 0 fabricated, real `next build`, `/code-review` LOW 0 findings (every batch), root + web
typecheck clean; **live `audit:verify` (read-only, ids 1–900 at wrap-up): every existing row
reconstructs — 271 clean, 2 pinned known divergences, 36 redacted rows verified, 0 problems** — so
the session's reconstructor changes (regionSetLine/regionSeriesLine, the subReason pairing, the
date-scoped region-series tolerance) hold on production data. First batch (`2bdbb4c`, run `35196289551`): backend 180/2666, web 117/1933.

**Owner steps pending (in order):** `npm run registry:apply` (#254(a) marker lives in the live
`canonical_measures.alternates`); `npm run backfill:eurostat-doi -- --apply` (#264, session 109);
`npm run benchmark:run:live` (confirms #216, real spend); region-set Task 9 (#267, real spend); audit
row 22 sign-off. **Standing candidates:** a third UX pass on what pass 2 still could not reach (small multiples,
region-set rendering, the Eurostat explorer past its empty state, headline/insights happy paths —
needs an intent-injection hook in the harness); the landing lazy-load split (measured, reverted — needs
`chart.test.tsx`'s synchronous assertions made async first, see the build-performance brief); WP30c E2 (#250(a) wording sign-off first);
[#260](open-questions.md) Supademo polish (needs brainstorming). Session 111 kickoff:
[session-briefs/2026-09-17-session-111-kickoff.md](session-briefs/2026-09-17-session-111-kickoff.md).

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

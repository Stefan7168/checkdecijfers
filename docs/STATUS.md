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

**▶ NEXT SESSION STARTS HERE (written 2026-09-19, session 115 — owner delegated: "spawn multiple
agents and get work done autonomously," present in chat throughout; verify against `git log` before
trusting this).** Session 115 built **chart co-pilot phase 4 — storytelling primitives** (ADR
[056](decisions/056-chart-copilot.md) "As built — phase 4", plan
[superpowers/plans/2026-09-19-chart-copilot-phase4.md](superpowers/plans/2026-09-19-chart-copilot-phase4.md))
via subagent-driven development — 8 tasks in three waves (2 parallel foundation tasks, 5 parallel UI
tasks merged one at a time, 1 test-coverage task), a final whole-branch review on the most capable
tier that found and the session fixed 1 Critical (a real authorization hole) + 10 Important
cross-task findings in one fix wave + one scoped re-review + a handful of controller-direct
residuals, pushed to `main` `edbf6d30..4902737c` (50 commits) + docs. CI run `35440310164` green
including deploy. Kickoff for the next session:
[session-briefs/2026-09-19-session-116-kickoff.md](session-briefs/2026-09-19-session-116-kickoff.md).

- **What phase 4 is:** six new chart-editing primitives, panel-only (chat-doorway wiring and
  own-data support both deferred, [#289](open-questions.md)) — goal line and era shading (reader-typed
  value/range + label, the value/band drawn as a native Recharts marker with no `label` prop so the
  reader's typed TEXT never enters an export); dim-not-hide (a third shown/dimmed/hidden series state,
  built for both cards); a reader-chosen headline number (click a point to feature it, falls back to
  the default rather than blanking on a zoom/reading change); a difference arrow and an average line
  (computed server-side, on demand, via `requestChartDerivation` re-running a registered R5 derivation
  over an already-audited chart's own cells — no new CBS fetch, no new audit row, never in the
  browser).
- **A real, live authorization hole was found and fixed same session.** `requestChartDerivation` read
  any user's audited answer by a fully-guessable client-supplied id with no ownership/GDPR-redaction
  check — unlike its sibling `createEmbedCode`, which already has exactly that check. Fixed to match;
  8/8 tests pass. Never deployed with the hole open (found and fixed before this branch's first push).
- **A real process incident, found and remediated same session:** mid-fix-round, a subagent operated
  against the main repo checkout instead of its assigned `git worktree`, producing a genuinely
  unreviewed commit on `main`'s HEAD. Caught by the controller's own sanity check (not the agent's own
  report, which mis-described it as a stalled background command), remediated with a local
  `git reset --hard` to the last known-good merge before continuing — nothing pushed, nothing lost,
  fully recoverable via reflog. See [lessons-learned.md](lessons-learned.md) session 115 for the full
  account and four related lessons.
- **Owner step BLOCKED, unchanged from session 114:** `npm run attachments:record` /
  `chart-copilot:record` still hit the Anthropic workspace usage cap (400, "regain access on
  2026-10-01") — every model-backed (real API) path still refuses; not run/re-checked this session,
  hand-authored fixtures remain the test basis. **Correction to an earlier draft of this entry:** the
  Playwright e2e suite is NOT blocked by this cap — it runs hermetically against an LLM stub, no real
  Anthropic calls at all, and DID run this session via CI. It found 5 real bugs on its first-ever real
  execution (none of these tests had run against a real browser before): 3 test-selector bugs (a
  locator matching 6 elements on a real page instead of 1; Playwright's `getByLabel` substring-matching
  a wrong element; a hardcoded period-code format that doesn't match real CBS codes) and 2 real product
  bugs — the goal-line e2e assumption was fine, but Task 5's own e2e test assumed a default headline
  exists on a 2-series chart (it doesn't, by design), and — the one that actually matters — setting a
  headline override closed its own popover immediately, so the "show default" toggle it's supposed to
  reveal could never be seen. All 5 fixed in this session's own final CI-green loop; **only the true
  live-API paths (`:record`, `benchmark:run:live`) remain blocked by the cap.**
- **New/changed open rows:** [#289](open-questions.md) (own-data + chat-doorway support deferred for
  all six primitives — a documented scope boundary, not a gap), [#290](open-questions.md) (derived
  overlay is permanently CBS-only, decided), [#291](open-questions.md)–[#294](open-questions.md) (small
  UX/testing residuals from the final review, all deliberately deferred).
- **THE NEXT BUILD PRIORITY IS PHASE 5 — chart-fit scorer + new honest forms** (stacked, 100% stacked,
  dumbbell, slope, heatmap, scatter, pie/donut, scorer-gated), then the six house styles + homepage
  themes row ([#275](open-questions.md)).
- **Owner steps pending — unchanged from sessions 110/111/114** (registry:apply, DOI backfill, live
  benchmark, region-set Task 9, audit row 22) **plus the two `:record` runs after 2026-10-01, plus the
  live benchmark (`benchmark:run:live`, real API spend, distinct from the hermetic `benchmark:run` that
  already runs green in CI) for phase 4 once the cap lifts.**

**Measured (session 115, at push, HEAD `4902737c`):** root typecheck + web typecheck clean; root
204 files / 2,977 tests; web 144 files / 2,433 tests; `next build` clean; final whole-branch review
(most capable tier) — 1 Critical + 10 Important found and fixed, 0 remaining Critical/Important; CI run
`35440310164` green (all jobs incl. deploy) — Playwright e2e 18/18, after a 5-round fix loop against
real CI failures the local jsdom/typecheck/next-build checks couldn't catch (see above). **Not run this
session:** the live benchmark and the two `:record` scripts (Anthropic workspace usage cap, real API
spend, unchanged since 2026-09-14); a separate `/code-review` LOW pass as a literal command (substituted
by the more thorough whole-branch review, which is the stronger check but not literally that command).

---

**Previous top block (session 114, kept verbatim below for one session):**

**▶ NEXT SESSION STARTS HERE (written 2026-09-18, session 114 — owner present at the start, then
fully delegated; verify against `git log` / `gh run list` before trusting this).** Session 114 did the
phase-2 owner steps as far as the world allowed AND built **chart co-pilot phase 3 — the CBS/Eurostat
chat doorway** (ADR [056](decisions/056-chart-copilot.md) "As built — phase 3", plan
[superpowers/plans/2026-09-18-chart-copilot-phase3.md](superpowers/plans/2026-09-18-chart-copilot-phase3.md))
via subagent-driven development — 4 tasks in two worktree waves, 1 fix round, a final review on the
most capable tier (8 minor findings, 4 fixed in a final wave, 4 recorded), pushed to `main`
`6c7d9c4e..f09945c7` (16 commits) + docs. CI run `35361186023` green incl. deploy; production
answered 200 on `/api/health` afterwards.

- **Owner steps DONE (live):** migrations 034 + 035 applied 11:14 UTC (RUNBOOK checks pass);
  `pricing:apply` upserted `dataset_turn`; `ATTACHMENTS_ENABLED=1` set in Vercel Production and
  deployed by re-running CI run `35325857423` (a bare `vercel --prod` fails — lessons-learned). The
  own-data tier is LIVE for upload, chart, Data panel, undo and persistence.
- **Owner step BLOCKED:** `npm run attachments:record` (and the new `chart-copilot:record`) hit the
  Anthropic workspace usage cap — 400 "regain access on 2026-10-01" — the same cap refusing every
  live chat since 2026-09-14. Not a bug ([#288](open-questions.md)); hand-authored fixtures remain
  the test basis. Every model-backed path (chat, both co-pilot doorways) refuses until the cap lifts.
- **What phase 3 is:** under a CBS/Eurostat chart, "Pas deze grafiek aan" → one cheap-tier call
  returns SELECTION-ONLY view commands by label (form, hide/spotlight, period range, style, template,
  title/caption, a note at a point) + a `dataRequest` flag; code maps labels to keys against the spec,
  digit-guards text against the spec's own strings, the card re-validates and dispatches with
  `source: 'chat'`. Priced at the `clarification` class via `question_cost` (no DDL); never writes
  `audit_answers`. A data request becomes the chip "Stel als vervolgvraag" (the reader's own words
  through the follow-up path); a compatible follow-up card is badged "Grafiek uitgebreid" and mounts in
  the previous card's saved look. Hermetic: 3 fixtures + `web/e2e/cbs-copilot.spec.ts`.

**Measured (session 114, at push, HEAD `f09945c7`):** root typecheck + web typecheck clean; root
202 files / 2,970 tests; web 140 files / 2,383 tests; benchmark 14/14 answerable, 6/6
refusal/clarify, 0 fabricated; Playwright `chart-copilot`, `own-data-copilot`, `cbs-copilot` 3/3
green; `next build` clean; `/code-review` LOW 0 findings; final review (most capable tier) 0 critical.

---

**▶ NEXT SESSION STARTS HERE (written 2026-09-18, session 113 — owner present; verify against
`git log` / `gh run list` before trusting this).** Session 113 BUILT **chart co-pilot phase 2 — the
own-data co-pilot** (ADR [056](decisions/056-chart-copilot.md) "As built — phase 2", ADR
[037](decisions/037-user-data-attachments.md) addendum) via subagent-driven development — 9 tasks,
~30 subagents, 5 tasks needed one fix round, one final whole-branch review + one fix wave — merged
fast-forward to `main` `f5bb6cd..caa23a7` (25 commits). CI run `35325857423` green incl. deploy; production answered 200 on `/` and `/api/health` afterwards. Kickoff for the next session:
[session-briefs/2026-09-18-session-114-kickoff.md](session-briefs/2026-09-18-session-114-kickoff.md).

- **What is built (dormant behind `ATTACHMENTS_ENABLED`, unset everywhere):** on a chart from the
  reader's own file — a fixed aggregate/derived set computed by the executor with traceable rowRefs
  (schema v2), the shared card shell (one undo history, style panel, notes, title/caption,
  per-turn persistence), a deterministic Data panel, and the "Pas deze grafiek aan" chat doorway
  (one cheap-tier call; label→key mapping + allowlists + digit guard server-side, `validateCommand`
  client-side; recipe chips, per-reply Undo/Retry/👍👎, three example chips). Hermetic proof:
  four hand-authored LLM fixtures + `web/e2e/own-data-copilot.spec.ts` (upload → chart → chat →
  bars + chips → ⌘Z → reload → restored), green in a real browser with zero model calls.
- **⚠ OWNER STEPS (RUNBOOK):** (1) `npm run db:migrate` applies 034 + 035 together (`chart_edits`
  + its own-data key; until then chart edits are silently not saved); (2) `npm run attachments:record`
  once — four real cheap-tier calls, read the printed diff; (3) flip `ATTACHMENTS_ENABLED=1` + the
  WP202 smoke test. Order matters: 1 → 2 → 3.
- **Found on the way:** the own-data tier had NEVER run in a real browser — its first run crashed on
  a pg `Date` reaching the card (fixed at the row mapper, `b6ea88b`); four more real defects caught
  by the review loops (`oneOf` schema, hydrate ordering, retention leg pre-035, refused-text digit
  guard) — see [lessons-learned.md](lessons-learned.md).
- **New open rows:** [#280](open-questions.md)–[#284](open-questions.md) (chip click opens the
  panel not the row; `count` semantics; the Data panel's English problem line; reply lives in the
  card; the fixture/record scripts). Stale "phase 1 not yet merged" wording in architecture/scope
  docs corrected.
- **THE NEXT BUILD PRIORITY IS PHASE 3 — the CBS/Eurostat chat doorway** (spec §3.3, §5 phase 3):
  the same `ChartCopilotInput` on `ChartView`, a selection-only schema generated from the live
  chart's `capabilities`, compatible follow-ups shown as "Grafiek uitgebreid"; numbers never through
  the model (R1/R6/R11). Also worth the owner's eye first: apply 034 + 035 and flip the flag so
  phase 2 gets real use before phase 3 lands on the CBS card.
- **Owner steps pending — unchanged from sessions 110/111** (registry:apply, DOI backfill, live
  benchmark, region-set Task 9, audit row 22) **plus the three above.**

**Measured (session 113, at merge, HEAD `caa23a7`):** root typecheck + web typecheck clean; root
196 files / 2,908 tests; web 139 files / 2,346 tests; benchmark 14/14 answerable, 6/6
refusal/clarify, 0 fabricated; Playwright `chart-copilot.spec.ts` + `own-data-copilot.spec.ts`
2/2 green; `next build` clean; `/code-review` LOW 0 findings.

---


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

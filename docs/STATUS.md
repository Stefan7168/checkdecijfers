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

**▶ NEXT SESSION STARTS HERE (written 2026-09-20, session 119 — owner present in chat; verify against
`git log`/`df -h`/CI before trusting this).** **No code changed this session — it was consumed entirely
by a real local-disk-full incident.** The owner was asked which of phase 5b's three open follow-ups to
build next and answered **"All, use subagents"**: scatter ([#296](open-questions.md)), the six house
styles + homepage themes row ([#275](open-questions.md)), and the six deferred Minor findings from
phase 5b's final review ([#300](open-questions.md)–[#305](open-questions.md)). Before any of that work
could start, a `git worktree add` + `node_modules` copy (needed for an isolated build worktree, per
[feedback_worktree_isolation_mechanics] — a worktree needs its own REAL, non-symlinked `node_modules`)
hit `ENOSPC`: the machine's disk had reached 0 bytes free, severely enough that even Bash's own tool
output could not be written for several calls. Session paused; the owner freed space externally. This
session then verified the disk had recovered (3.9Gi free, later confirmed 16Gi after this session's own
cleanup), removed the half-copied `node_modules` (12G reclaimed) and the empty scratch worktree/branch
(`cdc-wt-phase5b-minors` / `phase5b-minors-cleanup` — zero commits, safe to delete), and confirmed `main`
itself was never touched (still at `ff359c24`, clean, CI unchanged from session 118's own verification).

- **Nothing was built.** The owner's "All, use subagents" answer is the standing instruction for the
  next session — not a re-ask. Two of the three need real design work first (scatter needs a new
  two-measure-per-point chart-spec shape; house styles needs new presentation keys and, since it's
  visual/naming, ideally a quick look from the owner) before any SDD plan gets written; the Minor
  findings ([#300](open-questions.md)–[#305](open-questions.md)) are small and bounded enough to start
  directly. See the kickoff brief for a concrete first move.
- **Disk-space lesson for next session:** this machine's `node_modules` is ~15G (root) + ~833M (`web/`)
  — roughly 16G per real, non-symlinked worktree copy. Running scatter + house styles + Minors as three
  *parallel* worktrees, each with its own real `node_modules`, will not fit in the space this session
  recovered (16Gi free right now). Check `df -h /` before creating each worktree, and prefer running
  the three efforts sequentially (one worktree at a time, removed after merge) over three in parallel,
  unless free space is confirmed comfortably above ~50G.
- **Owner steps pending — unchanged from sessions 110/111/114/115/116/117/118** (registry:apply, DOI
  backfill, live benchmark, region-set Task 9, audit row 22, the two `:record` runs +
  `benchmark:run:live` once the Anthropic workspace usage cap lifts, 2026-10-01).
- **Kickoff for the next session:**
  [session-briefs/2026-09-20-session-120-kickoff.md](session-briefs/2026-09-20-session-120-kickoff.md) —
  a suggested build order (Minors first, no design gate; house styles second; scatter last, the biggest
  schema change) and the disk-space math for sequencing worktrees safely on this machine.

**Measured (session 119):** nothing rebuilt or retested — no code changed. `git status` clean on `main`
@ `ff359c24`; `git worktree list` shows only `main` (the scratch worktree from this session's aborted
start was removed); CI unchanged since session 118 (`gh run list` still shows `35478491548` as the most
recent run, green, all 5 jobs incl. deploy — the session-118 docs-only push correctly triggered no new
run, re-confirmed).

---

**Previous top block (session 118, kept verbatim below for one session):**

**▶ NEXT SESSION STARTS HERE (written 2026-09-20, session 118 — direct continuation of session 117's
unfinished build, same owner-present/fully-delegated session; verify against `git log`/CI before
trusting this).** **Chart co-pilot phase 5b — the "verified whole" — is COMPLETE and MERGED to `main`**
(spec [superpowers/specs/2026-09-17-chart-copilot-design.md](superpowers/specs/2026-09-17-chart-copilot-design.md)
§11, plan [superpowers/plans/2026-09-19-verified-whole-phase5b.md](superpowers/plans/2026-09-19-verified-whole-phase5b.md),
full history [.superpowers/sdd/2026-09-19-verified-whole-phase5b/progress.md](../.superpowers/sdd/2026-09-19-verified-whole-phase5b/progress.md)).
Merge commit `c7723c34` (`90b786f6..c7723c34` pushed to `main`), CI green. The branch and worktree
(`verified-whole-phase5b` / `../cdc-wt-verified-whole-phase5b`) are deleted — fully absorbed into `main`.

- **What shipped:** pie, stacked, and 100%-stacked chart forms are now honestly offered on a CBS/Eurostat
  chart when its regions are a complete, CBS-known roster (all provinces of NL, all landsdelen, all
  gemeenten of one named province) — verified on demand, server-side, that the visible parts genuinely
  sum to the real published total (tolerance = larger of half a unit at the whole's own precision or
  0.5% of its value), reusing this product's existing region-roster logic and needing no new CBS fetch,
  no new audit row. Donut is a presentation variant of pie (`pieHole`), not a fourth chart form. Scatter
  (the other capability split out of phase 5, [#296](open-questions.md)) stays explicitly deferred, not
  part of this phase — still not started.
- **Resuming session 117's open item:** Task 4's 2 open Important findings from that session (missing
  test coverage on the 100%-stacked omission boundary; imprecise reused refusal copy) were fixed in one
  round and re-reviewed clean (commit `ba941c9a`) — see the ledger for detail.
- **Task 5 (chat-doorway wiring + contract/property/e2e coverage) built and reviewed clean, 0 findings**
  (commit `d6635d3f`) — `CBS_COPILOT_PROMPT_VERSION` 2→3, `ChartForm` vocabulary now 11 forms end to end.
- **The final whole-branch review (opus) found one real, narrow gap, now closed:** an INCOMPLETE region
  roster (a member with no observation row at all — distinct from a withheld/null member, which already
  refused correctly) was invisible to the sum check and could pass within tolerance on a
  gemeenten-in-provincie roster (small gemeenten can sit under the ~0.5% tolerance). Fixed with a
  coverage gate (`RegionSetCoverage.complete`, mirroring the existing `deriveRegionRanking` precedent)
  before any DB query runs, a new honest `incomplete_roster` refusal reason, and a proving test — plus a
  bundled fix for an unhandled promise rejection that could leave a chart stuck on "checking" forever.
  Fix commit `4e861b78`, scoped re-review clean, 0 new findings. **Ready to merge** was the reviewer's
  own verdict; several Minor findings (chat-vs-tab capability-list edge cases, donut unreachable from
  chat, a latent typing gap, an untested-by-real-pipeline multi-period code path, a stale ADR line, a
  null-coercion nit) were deliberately deferred, not silently dropped — see
  [open-questions #300](open-questions.md) through **#305**.
- **Two plan-drafting gaps found and correctly handled during the build (from session 117, unchanged):**
  `RegionScope` has a 4th variant (`all_gemeenten`) the plan's brief missed, correctly refused (no
  verified-whole concept — CBS's own municipality grouping excludes `GM0997`/`OVERIG`, so that roster
  doesn't provably partition the national total); the on-demand verification server action was built to
  take an authenticated audit-record id rather than the plan's literal client-supplied-spec signature — a
  real, independently re-derived security improvement (closes a fabrication risk, not just a privacy
  gap), re-confirmed by the final review too.
- **No new owner step from this session** — the feature is server-side, opt-in-by-data-shape, and needs
  no migration, no env flag, no manual apply.
- **Owner steps pending — unchanged from sessions 110/111/114/115/116/117** (registry:apply, DOI
  backfill, live benchmark, region-set Task 9, audit row 22, the two `:record` runs +
  `benchmark:run:live` once the Anthropic workspace usage cap lifts, 2026-10-01).
- **What's next is an open product choice, not a mandated task:** scatter (phase 5b's other deferred
  capability, needs a new two-measure-per-point chart-spec shape first, [#296](open-questions.md)); the
  six house styles / homepage themes row ([#275](open-questions.md)); or the Minor findings above if the
  owner wants them closed rather than tracked. No single "next session starts here" task is dictated —
  ask, or pick whichever has the clearest owner signal. Kickoff brief:
  [session-briefs/2026-09-20-session-119-kickoff.md](session-briefs/2026-09-20-session-119-kickoff.md).

**Measured (session 118, merged `main` @ `c7723c34`):** root typecheck + web typecheck clean; full web
suite 146 files / 2,581 tests green (solo run); full root suite 201 files / 2,988 tests green (solo
run); invariants 26/26; hermetic benchmark scorer — answerable 14/14 (gate ≥12), refusal/clarify 6/6
(gate 6/6), fabricated numbers 0 (gate 0), **GATE VERDICT: PASS**; real Turbopack `next build` clean —
all re-run directly on the merged result, not only trusted from the branch's own CI. CI run
`35478491548` on the merge commit — check `gh run view 35478491548` for final status if trusting this
before it's confirmed green.

---

**[Doc-freshness trim, 2026-09-20, session 119: the session-116 and session-113 "previous top block"
copies that used to sit here were removed — each had already been kept well past the session-41
convention's "one session" window (both survived session 117's mid-build, non-wrap stop). Nothing they
recorded was lost: session 116's own detail lives in
[status-archive.md](status-archive.md) and [08-build-plan.md](08-build-plan.md); session 113's likewise.
Same class of trim as session 103's, see the note near the top of this file.]**

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

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

**▶ NEXT SESSION STARTS HERE (written 2026-09-22, session 122 further continuation — verify against
`git log`/CI before trusting this).** **`main` is NOW AT `b64ffe7`** — closed the residual [#311](open-questions.md)
gap: `setDimmed`/`setHeadlineOverride` were never actually chat-reachable for own-data, despite this
STATUS file's own prior top block (below, now superseded) claiming otherwise — that claim was true of the
PANEL doorway only (both dispatch generically through the shared reducer), never checked against the
CHAT doorway's own schema.ts, which had neither kind at all. Found while triaging the next piece of
autonomous work (owner: "Work continuously autonomously") rather than assuming the prior claim was
correct — exactly the check CLAUDE.md's Doc-freshness rule calls for. Ported both from the CBS tier
(`xLabel`/`rowRef` naming), `COPILOT_PROMPT_VERSION` 3→4, fixtures regenerated offline. **LIVE, CONFIRMED
not just pushed:** CI run [35706081745](https://github.com/Stefan7168/checkdecijfers/actions/runs/35706081745)
measured green end to end — all 3 `backend` shards, `web` (typecheck, unit tests, real Playwright e2e),
and `deploy` (build → Vercel deploy → post-deploy smoke check, job
[106676511114](https://github.com/Stefan7168/checkdecijfers/actions/runs/35706081745/job/106676511114))
every job and every step `success`. **Locally measured, all green before push:** root+web typecheck clean; root vitest 206f/3171t (was 3159 — 8 new
unit tests mirroring the CBS tier's own, +2 fixture-drift cases); web vitest 146f/2606t unchanged; real
Playwright `own-data-copilot.spec.ts` 4/4 (2 new, both passed first try — no wrong-assumption round this
time) and `chart-copilot.spec.ts` 22/22 (CBS-tier regression, unaffected); hermetic benchmark
14/14+6/6+0 fabricated, GATE PASS; `/code-review` LOW: no findings; real `next build`: clean. The
headline-override e2e test needed real source-reading, not CBS-tier-parity assumption: this card has no
"headline figure" block at all (CBS/Eurostat-only journalist feature) — verified via the shared
`ChartNotes` popover's own toggle instead, found by reading `user-chart.tsx` directly. Full account: ADR
056's new "As built — setDimmed/setHeadlineOverride own-data wiring" section.
**Residual, not part of this fix:** the own-data equivalents of the CBS tier's #308 work (`addEraShading`,
mean-overlay, goal-line still lack a dedicated own-data e2e case) remain open, not scheduled.

---

**Superseded by the above, kept as history:** `main` was previously at `7cf6035` (on top of `14bc8ba`) —
closed the two Minor findings the phase-6 final review deliberately left open, [#307](open-questions.md)
(the mean-overlay prompt claim, wrong in BOTH tiers — the own-data prompt inherited it when copied from
the CBS tier's structure) and [#308](open-questions.md) (real-browser render proof for the other four
chat command kinds: `setDimmed`, `setHeadlineOverride`, `addDerivedOverlay`, `addGoalLine`). Picked up
fully autonomously (owner: "Work continuously autonomously") by triaging STATUS/open-questions for the
next legitimate, non-owner-gated work rather than idling. LIVE, CONFIRMED not just pushed: CI run
[35703474846](https://github.com/Stefan7168/checkdecijfers/actions/runs/35703474846) measured green end
to end via a scheduled check-in — all 3 `backend` shards, `web` (typecheck, unit tests, real Playwright
e2e incl. the new command-kind cases), and `deploy` (build → Vercel deploy → post-deploy smoke check, job
[106668252243](https://github.com/Stefan7168/checkdecijfers/actions/runs/35703474846/job/106668252243))
every job and every step `success`. Locally measured, all green before push: root+web typecheck clean;
root vitest 206f/3159t (one hardcoded prompt-version-pin test updated to match the intentional bump); web
vitest 146f/2606t unchanged; real Playwright `chart-copilot.spec.ts` 22/22 (18 existing + 4 new) and
`own-data-copilot.spec.ts` 2/2, both confirmed via an `exact` llm-stub hit; hermetic benchmark
14/14+6/6+0 fabricated, GATE PASS; `/code-review` LOW: no findings; real `next build`: clean. First-run
finding caught and fixed before commit (wrong test assumption, not a product bug — see
lessons-learned.md session 122 point 8). Full account: ADR 056's "As built — prompt-accuracy fix + full
e2e render coverage" section. Its "residual" note (the own-data equivalent of #308) is superseded by the
block above, which covers setDimmed/setHeadlineOverride specifically — the other three own-data kinds
(era shading, mean-overlay, goal-line) remain the actual open residual.

---

**Superseded by the above, kept as history:** `main` was previously at `e9f3cae` — own-data co-pilot
parity (goal line, era shading, difference/mean overlay brought to the "eigen data" card; `setDimmed`/
`setHeadlineOverride` were BELIEVED already own-data-wired — **wrong, corrected same day: true of the
panel only, the chat doorway had neither; closed in a follow-up, `b64ffe7`, see the current top block**)
is LIVE, CONFIRMED not just pushed: CI run
[35696279101](https://github.com/Stefan7168/checkdecijfers/actions/runs/35696279101) measured green end
to end — `web` (typecheck, unit tests, real Playwright e2e incl. the new chat-driven difference-overlay
case) and all 3 `backend` shards (incl. hermetic benchmark 14/14+6/6+0 fabricated) passed, and `deploy`
(build → Vercel deploy → post-deploy smoke check, job
[106645022872](https://github.com/Stefan7168/checkdecijfers/actions/runs/35696279101/job/106645022872))
also completed `success` — confirmed via two scheduled check-ins, not assumed. Built on owner delegation
("You are the expert, continue") as three file-disjoint subagent dispatches (`superpowers` plugin not
available this session, confirmed by trying it — used direct `Agent` worktrees instead) plus a direct
integration pass that found and fixed a real interface mismatch between two of the three pieces (a shared
`resultIds: string[]` command shape vs. a label-based server-action signature — see ADR 056's "As built —
own-data co-pilot parity" section for the full account). Full detail: [open-questions #311](open-questions.md).
Own-data equivalents of phase 5/5b (extra chart forms, verified-whole) remain unbuilt and unscheduled.

---

**Superseded by the above, kept as history:** `main` was previously at `baa5c36` (code `ce43e92` + a
same-session docs-sync commit on top) — the owner explicitly said "push to main" and the session
fast-forward-pushed the code directly
(`git push origin ce43e92:main`; `origin/main` was freshly fetched and confirmed an ancestor of `HEAD`
immediately before pushing, so this was a genuine zero-conflict fast-forward, not a force-push). **Chart
co-pilot phase 6 + the full session-122 fix wave are now LIVE on `main`, CONFIRMED, not just pushed:** CI
run [35690440761](https://github.com/Stefan7168/checkdecijfers/actions/runs/35690440761) on `ce43e92`
measured green end to end — root+web typecheck, all 3 backend test shards, web unit tests, hermetic
benchmark (14/14+6/6+0 fabricated), and the real Playwright e2e suite all passed (`gate`), and `deploy`
(build → Vercel deploy → post-deploy smoke check) also completed `success` (job
[106626835581](https://github.com/Stefan7168/checkdecijfers/actions/runs/35690440761/job/106626835581),
confirmed via a scheduled check-in 3 minutes after the push, not assumed). The session's designated
branch, `claude/chart-copilot-phase6-fixes-wpim88`, is now fully subsumed by `main` (kept on `origin`, not
deleted — not asked for — but no longer the active target for new work).

- **Why a third branch:** this session's own harness assigned a designated branch,
  `claude/chart-copilot-phase6-fixes-wpim88`, with an explicit "never push to a different branch
  without explicit permission" constraint — a platform-level rule for this particular session, distinct
  from CLAUDE.md's own owner-present-pushes-to-`main` convention. The session merged
  `origin/worktree-chart-copilot-phase6` (`58db5097`, session 121's own unmerged phase-6 work) into the
  designated branch first (clean merge, zero conflicts — `main` had only one docs-only commit,
  `41fe3ab5`, that the phase-6 branch lacked), then built the fix wave on top. **RESOLVED same session
  (continuation): the owner explicitly said "push to main"; the designated branch's tip (`ce43e92`) was
  fast-forward-pushed straight onto `main`, one command, zero conflicts, exactly as predicted above.**
- **Session 122: the mandated fix wave (session 121's final review) is APPLIED and FULLY VERIFIED**, on
  branch `claude/chart-copilot-phase6-fixes-wpim88` @ `0f7c7f18`, pushed to `origin`:
  - `iconFor()` (`web/lib/chart-copilot-reply.ts`) gained explicit arms for all five phase-6 command
    kinds instead of falling through to the 'style' default: `setDimmed`→series, `setHeadlineOverride`/
    `addGoalLine`/`addEraShading`→note, `addDerivedOverlay`→form.
  - `map.ts`'s `addGoalLine`/`addEraShading` `not_available` refusals now say `control: 'notes'` (were
    `'form'`) — matches the applied chip's own destination (final review's I2).
  - `respond.ts` passes the `trimmed` message into `mapCbsCopilotOutput`, not the raw one.
  - **New `overlays: boolean` capability** (`types.ts`, `chart-capabilities.ts`, `map.ts`'s
    `addDerivedOverlay` case) — false on any form but line/area now refuses the command outright
    instead of silently storing one that renders nothing (**#310, closed** — the more serious of the two
    required pre-merge fixes). **No `SYSTEM_PROMPT` byte changed and the real Playwright suite proves
    it: every one of the 18 real-browser cases matched its fixture "exact" (never the risky prefix
    fallback), and the request log shows `overlays:false` for the hbar-form province charts and
    `overlays:true` for the line-form city charts — the field flows correctly end to end with zero
    fixture regeneration.**
  - Two stale doc comments fixed (`dataRequest`'s paraphrase of the current prompt wording;
    `goalLineValueInMessage`'s now-documented bare-year false-accept), plus test coverage for all of the
    above (new `copilot-fixtures.test.ts` assertion: every `CASES` entry maps to a command or a refusal).
  - **Full verification, all measured this session:** root+web typecheck clean; root vitest 205 files /
    3095 tests green (was 3080 — +15 new assertions); web vitest 146 files / 2594 tests green (was
    2593); real Playwright `chart-copilot.spec.ts` 18/18 green (real Chromium, `CHROMIUM_PATH` pointed
    at the pre-installed `/opt/pw-browsers/chromium-1194` binary — this environment's Playwright package
    version didn't match the pre-installed browser revision, a environment quirk, not a code issue);
    hermetic benchmark **14/14 answerable, 6/6 refusal, 0 fabricated, GATE PASS**; `/code-review` LOW on
    the diff: no findings; real `next build`: clean.
  - **The merge landed this same session (continuation, owner said "push to main"):** `docs/04-
  architecture.md`'s capability rows and open-questions #289/#301/#310 are now updated to say "shipped
  on `main`" rather than "built, verified, not yet on `main`" — see those files directly, not this
  paragraph, for the current wording.
- **Owner steps pending — unchanged from sessions 110 through 121** (registry:apply, DOI backfill, live
  benchmark, region-set Task 9, audit row 22, the two `:record` runs + `benchmark:run:live` once the
  Anthropic workspace usage cap lifts, 2026-10-01 — still also covers confirming the two phase-6 cases
  session 121 added). The merge-to-`main` item is done, no longer pending.

- **Owner asked for genuinely architectural work, not more polish**, after reviewing session 118-120's
  output (small fixes/templates) — see [open-questions #306](open-questions.md) for the full options
  survey. Chose: finish wiring the chart co-pilot's chat vocabulary to features that already existed on
  the on-screen panel but were chat-blind, plus unblock #301/#275 from session 120 (below).
- **Branch `worktree-chart-copilot-phase6`, pushed to `origin` (NOT `main`) at `58db5097`.** Built via
  `superpowers:subagent-driven-development`, 6 sequential tasks, one worktree, one implementer at a
  time (per session 116's own lesson on shared-file fragility) — plan:
  [superpowers/plans/2026-09-20-chart-copilot-phase6-chat-wiring.md](superpowers/plans/2026-09-20-chart-copilot-phase6-chat-wiring.md),
  full ledger (every dispatch, every review, every fix round, every ruling) at
  `.claude/worktrees/chart-copilot-phase6/.superpowers/sdd/2026-09-20-chart-copilot-phase6-chat-wiring/progress.md`
  (git-ignored, only exists on disk on this machine — read it before resuming, don't re-derive from
  memory).
  - **Task 1:** re-applied #301 (`pieHole` donut via chat) and #275 (five house styles via chat) —
    BOTH were built correctly and then reverted in session 120 on the assumption the fix needed live
    LLM spend. It didn't: regenerating fixtures OFFLINE (`chart-copilot:fixtures`/`attachments:fixtures`,
    free, no network) fixes the hash shift for every existing case; only the two genuinely new cases are
    still owed real-model confirmation via `:record` once the spend cap lifts. See
    [[feedback_llm_prompt_embedded_lists_hash_risk]] (updated this session) and
    [open-questions #301](open-questions.md)/[#275](open-questions.md).
  - **Tasks 2-5:** five brand-new chat command kinds, making ALL SIX of phase 4's "storytelling
    primitives" ([open-questions #289](open-questions.md)) chat-reachable for the first time: dim-instead-
    of-hide (`setDimmed`), pick-the-headline-number (`setHeadlineOverride`), shade a period
    (`addEraShading`), a computed difference-or-average overlay (`addDerivedOverlay`, covers BOTH the
    difference-arrow and average-line primitives), and a goal line (`addGoalLine`). CBS/Eurostat card
    only, own-data tier explicitly out of scope (disclosed, not silently dropped).
  - **Task 5's goal line went through an unusually careful two-round safety review** (this tier's ONE
    field where the model writes a bare number, not a label) — the FIRST version's guard compared digit
    STRINGS not actual numbers and would have accepted a value 10x/1000x off or sign-flipped from what
    the reader typed; caught by the implementer itself, confirmed by an opus-tier reviewer that
    EXECUTED the guard function on constructed adversarial inputs (not just read it), fixed, then
    re-verified by execution again. See lessons-learned session 121 point 2.
  - **Task 6:** proved it all works — full local suite green, INCLUDING the fixture-drift-guard tests
    deliberately left red through tasks 2-5 (29/29) and the full real Playwright e2e suite (27/27).
  - **Final whole-branch review (opus): "Ready to merge, WITH FIXES."** Two real Important findings,
    both small, both prompt-byte-free (no fixture regen needed): (I1) the new difference/average overlay
    command has no form gate, so asking for it on a bar/pie/stacked chart stores a command that renders
    nothing and can't be removed — this is the EXACT defect session 116's own final review closed for
    the on-screen panel, reopened through the new chat doorway; (I2) the new commands' confirmation-chip
    destination is inconsistent (one command's own success path and its own refusal path point at two
    different panels). The reviewer wrote the complete fix (new `overlays` capability field + a handful
    of one-line corrections) and explicitly verified it needs NO fixture regeneration. **APPLIED AND
    VERIFIED session 122 — see the top of this block**, not this stale paragraph. The reviewer also
    caught that an EARLIER task review's stated mechanism for a related finding (iconFor() "unmounting"
    the era-shading UI) was wrong when independently re-checked — the underlying issue was still real,
    just not for the claimed reason; see lessons-learned session 121 point 3.
  - **Deliberately documented, not fixed** (low-risk, or expensive to fix — a `SYSTEM_PROMPT` byte
    change re-hashes all 14 co-pilot fixtures and forces a full Playwright re-run): the chat's "average"
    ignores an active zoom window despite the prompt claiming otherwise
    ([open-questions #307](open-questions.md)); the new e2e test proves 1 of 5 new kinds render for real
    in a browser, not all 5 ([#308](open-questions.md)); `setDimmed` silently un-hides a series the
    reader had separately hidden ([#309](open-questions.md)).

**Measured (session 121, on the branch, NOT main — historical; session 122's own fix-wave verification
at the top of this block supersedes the "not applied"/"not merged" framing below, though `main` itself
is still unmoved):** root + web typecheck clean; root vitest 205 files
/ 3,080 tests green; web vitest 146 files / 2,593 tests green; fixture-drift-guard 29/29 green (was
deliberately 9-red through tasks 2-5); full real Playwright e2e 27/27 green (`chart-copilot.spec.ts`
18/18). Final whole-branch review: **"Ready to merge: With fixes"** — not merged, not pushed to `main`,
no PR opened (the fix wave above is the session-122 owner-present session's mandated first step, not a
merge-blocking design question). `git status` clean on both `main` and the branch; `git worktree list`
shows `main` + the phase-6 worktree (kept, not removed — the branch/worktree must survive to resume).

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

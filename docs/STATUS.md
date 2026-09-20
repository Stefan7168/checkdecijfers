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

**▶ NEXT SESSION STARTS HERE (written 2026-09-20, session 120 — owner present in chat; verify against
`git log`/CI before trusting this).** **All three of session 119's "All, use subagents" follow-ups are
closed**, plus a real CI break and a real owner-reported bug, both caught and fixed same session.
`main` @ `aca6a7ad`, CI green (`gh run view 35503056717`).

- **Minors:** #300/#302/#304/#305 shipped (`a7054518`); #303 stays informational by design; **#301
  (`pieHole` chat-reachable) was built, verified correct, then reverted before push** — it shifts the
  co-pilot's LLM request hash, breaking all ten recorded fixtures, blocked on real LLM spend (Anthropic
  usage cap, lifts 2026-10-01).
- **House styles:** five confirmed and built — Salmon Editorial, Studio Grey, Broadsheet, Autumn
  Letter, Brutalist Ink (`bf47bfa8`) — all from EXISTING `ChartPresentation` keys, no new presentation
  key needed. **The sixth piece (a homepage "themes" gallery row) was designed in chat — reuse the
  existing `consumentenvertrouwen` curated chart + the existing `GalleryCard`/`ChartView` pattern
  already used 3× on the landing — but the owner asked to hold: "I have to think about better options."
  Not approved, not built** — don't assume that sketch stands; re-propose or ask fresh.
- **A real CI catch:** the house-styles push also widened `TEMPLATE_IDS` (chat-reachability by name for
  the five new looks) — broke 4 real-browser Playwright e2e tests, because `capabilities.templates`
  reaches the co-pilot's LLM prompt and shifts the request hash, same class of bug as #301. No vitest
  suite caught it; only the real Playwright run did. Reverted (`35513e4f`), verified locally with the
  actual e2e suite (24/24), CI confirmed green. Standing lesson:
  [[feedback_llm_prompt_embedded_lists_hash_risk]] — before widening any list that reaches an LLM
  prompt, grep `prompt.ts`/`schema.ts` first, and verify with real e2e, not just vitest fixtures.
- **A real owner-reported bug, found and fixed same session:** the Style popup's Templates grid made
  Broadsheet and Autumn Letter look like they had no boundary at all in light theme (owner: "clearly
  overflowing"). Root cause: `TemplateThumb`'s frame stroke used the THEME's own `--border` token,
  never checked against an arbitrary template's paper colour — those two near-white papers sat at
  ~1.0-1.1 contrast against it (below this project's own `COLOR_REFUSE_BELOW=1.25`). Fixed with a
  fixed, non-theme stroke (`aca6a7ad`) — decorative-preview-only, the real applied chart is unaffected.
  See ADR 043 decision 11.
- **Scatter: held, not built.** The owner delegated the build-or-hold call ("You decide as a UX
  expert"). Investigation found the real bottleneck is the QUERY layer (every query is
  one-measure-by-construction), a materially bigger, multi-session lift than "widen `ChartPoint`" — and
  a cheaper "two-period" variant would be redundant with the already-shipped slope chart. Held per the
  project's cheapest-mechanism-first/escalate-on-evidence rule, with a clear revisit trigger (real usage
  evidence) recorded in [open-questions #296](open-questions.md).
- **Owner steps pending — unchanged from sessions 110/111/114/115/116/117/118/119** (registry:apply, DOI
  backfill, live benchmark, region-set Task 9, audit row 22, the two `:record` runs +
  `benchmark:run:live` once the Anthropic workspace usage cap lifts, 2026-10-01).
- **No mandated next task.** Candidates: a fresh design for the homepage themes row (the owner wants
  better options than what was sketched this session); re-apply #301/TEMPLATE_IDS chat-reachability
  once the LLM cap lifts and fixtures can be re-recorded; or pick a fresh priority — ask the owner
  rather than assuming. Kickoff:
  [session-briefs/2026-09-20-session-121-kickoff.md](session-briefs/2026-09-20-session-121-kickoff.md).

**Measured (session 120, final):** root + web typecheck clean; full web suite 146 files / 2,593 tests
green (solo run); full root suite 205 files / 3,014 tests green (solo run); benchmark scorer 3 files /
32 tests green; full Playwright e2e suite 24/24 green (run locally, confirmed again by CI); real
Turbopack `next build` clean. CI run `35503056717` (the final push) green, all 5 jobs incl. deploy —
one earlier push this session (`bf47bfa8`) went red and was fixed by the next commit (`35513e4f`), not
ignored. `git status` clean, `git worktree list` shows only `main`. Disk: 12Gi free at session end (was
16Gi at session start — normal build/test/Playwright-install churn, not an incident).

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

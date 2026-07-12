# STATUS

> **Tracker, not a source of truth.** Scope and the gate are defined in [03-mvp-scope.md](03-mvp-scope.md), the benchmark in
> [02-user-scenarios.md](02-user-scenarios.md). This file only records progress against them. Update it whenever project state changes (see the
> definition of done in [CLAUDE.md](../CLAUDE.md)) — with **measured results only, never aspirational ones**.

> **Session log lives in [status-archive.md](status-archive.md)** — full per-session "Last updated" entries, verbatim, newest on top.
> **Convention (since 2026-07-12, session 41):** at session wrap-up, PREPEND the full session entry to
> [status-archive.md](status-archive.md) and update only the lean top block below. Keep STATUS.md readable in one
> Read call: hard-wrap every line at ~150 chars, no kilobyte-long lines.

**▶ NEXT SESSION STARTS HERE (2026-07-13, session 42 FINAL — WP135 supervised go-live; owner present throughout).**

- **(1) WP135 chat workspace is LIVE IN PRODUCTION.** Supervised go-live RUN session 42 per RUNBOOK § "WP135 chat workspace" (now the
  as-executed record): migration 019 applied (exactly one), guarded FK + grants/RLS live-verified (0 anon/authenticated grants, RLS on,
  0 policies), `WORKSPACE_ENABLED=1` + CI-gated redeploy (`ae604db`, gate+deploy green), owner smoke tests PASS (2 threads, 1+3 audit rows,
  zero orphans, live credits chip, chart dock, resume identical). GDPR spot-check (step 5) skipped — optional. Rollback: unset flag + redeploy.
- **(2) Go-live finding fixed + LIVE same session:** logout pending state (`5ba3fb8`, `useFormStatus` "Bezig…"; full verification block green —
  backend 1250/1250, web 302/302, benchmark 14/14 + 6/6 + 0 fabricated, real `next build`). Cosmetic residual: `/login`'s stripped header
  doesn't render in prod (statically prerendered route; sensitive env empty at build) — harmless; fix rides any later /login work.
- **(3) PR 35 post-merge main CI verified green** (`963fc66`) — the session-41 loose end is closed.
- **(4) #136 recorded AND resolved: `AGENTS.md` = committed symlink to `CLAUDE.md` in both dirs** (`ccd6f3d`; new CLAUDE.md Conventions
  bullet; web/CLAUDE.md now holds the Next-16 warning with the dead bundled-docs pointer rephrased). RESIDUAL: owner runs one Codex session
  to confirm it reads the agreements through the symlink (owner: "Codex zoekt het later uit"). Chip task_f54d2672 dismissed (superseded). Its CI run (`ccd6f3d`) was in_progress at close — expected green (docs+symlink only); next session confirms (PR-35 precedent).
- **(5) Next per the stack: #134(a) refusal period-suggestion chips OR WP26 (supervised).** Residuals unchanged: #132 route B ~2026-07-19
  (forks==0 is the T-0 go/no-go), #131 L1 lane, WP30c (#123), chips format.ts NUL (task_e718f60d) + wrapup-hook false-positive
  (task_6f27827b — fires on kickoffs quoting "NEXT SESSION STARTS HERE"; ignore on a session's FIRST message).


**▶ TOP PRIORITY STACK — owner decision, session 23 (2026-07-05); this ORDER overrides the "decision-gated" framing below.** The owner set an explicit
sequence; everything else queues behind it:
0. **✅ DONE + live-verified on production (2026-07-05): GDPR retention purge + self-service deletion (#14).** `npm run gdpr:purge` + a "Verwijder mijn
   vraaggeschiedenis" button, both **redact** the content (question + answer + the topic columns gone; the financial skeleton stays — a
   `credit_transactions` FK blocks a real row-DELETE). Reviewed + committed (`6aafb40`); 715 backend + 135 web tests green. The purge ran clean on
   prod (0 rows — nothing is 2 years old yet); ongoing retention = the monthly maintenance session. Owner confirmed the redact-and-retain posture.
   *Full detail: the session entry in [status-archive.md](status-archive.md) + the #14 section in [08-build-plan.md](08-build-plan.md). ([#59](open-questions.md) — the separate
   account-deletion FK tension — stays open; #14 does not touch it.)*
1. **On-demand CBS fetch when data is missing — WP16.** If a question needs data not in our DB, fetch the CBS table via API → verify → store → answer,
   with *"je tabel wordt voorbereid"* wait-messaging (email + dashboard "wordt aan gewerkt"). Was Phase 2-3, now **#1, the biggest build.
   Execute-ready brief in [08-build-plan.md](08-build-plan.md); Fable-authorized on the hard sub-parts (owner).** **Sub-part 1 (table discovery) — ✅
   HERMETIC FOUNDATION BUILT (session 24, 2026-07-05), full gate green; design + the Fable judgment in ADR
   [025](decisions/025-cbs-catalog-table-discovery.md).** Shipped hermetically (€0 spend, no live DDL): a `cbs_catalog` mirror (migration 011) + Dutch
   FTS (verified on PGlite), `CbsSource.fetchCatalog()`, and `src/catalog/` = ingest + Stage-1 FTS recall + Stage-2 rerank (hard allowlist,
   `TABLE_RERANK_MODEL='claude-haiku-4-5'`) + the `findTable` router (confident/disclose/none). **The Fable answer (owner asked): topic→table does NOT
   earn Fable in v1** — a closed shortlist multiple-choice with a hard allowlist, safer structurally than by model size; one named constant with a
   recorded Haiku→Sonnet→Fable escalation ladder gated on a measured miss. **Sub-part 1 supervised live step — ✅ DONE (session 25, owner present):**
   migration 011 applied to prod (grants/RLS live-confirmed locked by inheritance — 0 anon/authenticated grants, RLS on, 0 policies); real
   `catalog:refresh` mirrored 4,858 rows; `tablefinder:record` run live (Haiku) → `DEFAULT_FIND_TABLE_CONFIG.highConfidence` **calibrated to 0.8**
   (confident floor 0.85 measured/stable, failure-safe = disclose) + an end-to-end replay test now on the gate (`tests/catalog/find-replay.test.ts`,
   8/8 hermetic); 3 finder misses fixed (1 mislabel zonnepanelen→85004NED + 2 alias recall gaps) → 8/8. **Residual — ✅ CLOSED session 31 (WP27 stage
   A, PR #17):** the labelled set now has a disclose-expected case (`inkomen-vaag`) and the confident/disclose boundary is directly measured
   ([#104](open-questions.md)). **WP16 sub-part 2 — ✅ LIVE IN PRODUCTION (go-live session 28, 2026-07-06, owner-supervised).** On-demand CBS fetch
   works end to end; both paths verified live (delivered: consumentenvertrouwen→CBS `83694NED`, −24, full CC BY attribution, 100 credits kept;
   unanswerable+refund: bijstand → `85615NED`, ledger compensation +100). A go-live proxy bug was caught pre-flight + fixed (`42b275b`). **➡ Both
   go-live follow-ups are DONE: #115 shipped sessions 28–29; #111 CLOSED via WP27 (sessions 31–33, ADR [027](decisions/027-finder-shape-fit-gate.md))
   — the bijstand question now ANSWERS live (stage-D acceptance test, session 33). See the session log in [status-archive.md](status-archive.md) for the records.** (Built session
   27: 888 backend tests, benchmark 14/14 + 6/6 + 0 fabricated, 154 web tests.) Full build detail in the WP16 section of
   [08-build-plan.md](08-build-plan.md); residuals [#111](open-questions.md) (delivery coverage: national single-dimension tables answer,
   geo/sub-coordinate refuse-and-refund) + [#112](open-questions.md) (extended-vocab prompt variant unmeasured). The original seam notes, for the
   record: **Seam precision (session-26 review): that seam is TWO structurally different exits, not one** — the `unmatchedMeasureTerm` parse exit
   carries free text and fits `findTable(topic)` directly (the live seam); the `runQuery`→`buildQueryRefusal`/`table_not_registered` branch has no
   free-text phrase left and needs its own adapter (and is effectively unreachable with the current hand-curated registry) — exact shapes in the WP16
   brief ([08-build-plan.md](08-build-plan.md)). Sub-part-2 design inputs logged as [#107](open-questions.md)–[#110](open-questions.md) (slice
   greediness, successor re-discovery, onboarding chip, data lifecycle/eviction — incl. the verified gap that `sync --all` is seed-bound, not
   registry-driven). **All four blocking decisions now LOCKED (session 26, ADR [026](decisions/026-on-demand-fetch-job-architecture.md)): Vercel Cron
   job engine, 100-credit pricing on the existing "heavy" tier, internal-consistency-only verification for v1, core-loop-only scope**
   (successor/chip/eviction deferred, except the one verified #110(a) registry-driven-refresh bug). **Ready for an execute build session — no further
   owner decisions needed to start the hermetic foundation** (mirrors sub-part 1: build + gate green first, live DDL + real spend in a separate
   supervised step after).
2. **New data sources beyond CBS** (likely API-based). **▶ ARCHITECTURE DESIGNED (session 30, 2026-07-08, owner-steered
   source-neutral/Nederland-scope): ADR [030](decisions/030-multi-source-architecture.md) + [audit
   dossier](session-briefs/2026-07-08-multi-source-dossier.md); build = WP30 in [08-build-plan.md](08-build-plan.md), after WP27; the concrete first
   source is an OPEN owner decision (WP30c).** Broadens the public claim from "official CBS cell" to "official sources" (CLAUDE.md needs a matching
   update) and likely triggers the ADR 001 Python split.
3. **Answer/question-quality optimization on the widened data base** — re-run the experience audit + ship the clarify-policy fix (WP26, now tier-3,
   ready but after the data work).

*Grounded in the session-23 experience audit (110 questions, live, measured): 40 answer / 32 clarification / 38 refusal; **20 of 56 answerable
questions did not just answer**, and **all 14 out-of-coverage questions hit the wall** — the coverage wall (1/2) is a bigger lever than the
clarify-policy (3) alone.*

**Current phase:** Phase 0 complete; **WP21 (CSV export #52) + WP22 (live-feedback smalls #95/#96a/#97a) + WP23 (display smalls
#84/#86/#90/#91/#92/#71/#75) all shipped 2026-07-05, session 22 overnight**, **#14 GDPR retention + self-service deletion shipped 2026-07-05
(code-only/hermetic session, item 0 above)** on top of the #77 fix (session 21, ADR [023](decisions/023-explicit-date-range-parsing.md)), WP19+WP20
(session 20), WP18/WP17 and the live-verified end-user flow — **next follows the TOP PRIORITY STACK above (GDPR #14 done → WP16 → new sources → WP26),
NOT the old "decision-gated" framing:** the session-22 wrap-up items (#98/#99 site shell, #96b, #97b, #53) and the **#65 error logging** brief
([08-build-plan.md](08-build-plan.md)) are real open items but no longer the front of the queue; anonymous-trial [#53] has its full brief (the
session-19 owner-delegated order is complete), **plus a large decided-but-unbuilt backlog — everything below is owner-confirmed, no priority order
implied:**
  - **Bug-shaped, from live testing:** explicit multi-period/multi-region auto-display ([#64](open-questions.md)); durable error logging beyond
    Vercel's short retention ([#65](open-questions.md))
  - **WP16, demand-driven table onboarding:** now owner-confirmed wanted, with its user-facing copy and "costs credits" pricing decided
    ([08-build-plan.md](08-build-plan.md), [#24](open-questions.md))
  - **Clarification UX — now designed as one WP (WP26), session 23, ADR [024](decisions/024-answer-first-defaults-and-clickable-options.md); awaits
    owner read-back of the safelist + a supervised build:** clickable pre-verified suggestion buttons ([#66](open-questions.md)/Mechanism A) +
    smart-default-with-escape-hatch on the narrow safe set instead of always clarifying ([#72](open-questions.md)/Mechanism B) — the two root causes
    of the "paid dead-end" (net 10 credits for nothing), zero prompt bytes, pricing deferred ([#101](open-questions.md))
  - **Dashboard polish — ✅ all four built in WP19 (session 20, entry in [status-archive.md](status-archive.md)):** collapse a clarification round into one history item
    ([#67](open-questions.md)); live balance updates instead of only-on-reload ([#68](open-questions.md)); low-balance warning banner
    ([#69](open-questions.md)); a brief credits-economy explainer under the "Credits kopen" button ([#76](open-questions.md))
  - **"Next-level" UX ideas, all owner-approved:** clickable source-attribution drill-through ([#70](open-questions.md)); a visual "voorlopig" badge
    ([#71](open-questions.md)); follow-up suggestion chips under an answer ([#73](open-questions.md)); a live status panel for pending WP16 onboarding
    requests ([#74](open-questions.md)); example-question chips on an empty chat ([#75](open-questions.md))
  - **GDPR:** [#14](open-questions.md) question-log retention — **✅ built** (2026-07-05, code-only/hermetic session): 2-year purge CLI + self-service
    deletion, both via redaction (see item 0 above). Live purge run against production is still outstanding, owner-supervised, whenever a maintenance
    window opens.
  - **Second creative-brainstorm batch (2026-07-05, owner-filtered, rows [#78–#93](open-questions.md)):** top-5 = citation-copy button (#78), "bewijs
    dit cijfer" audit exposure (#79, brief first — merge with #70/#90), stat card + PNG download (#80), revision-risk gauge (#81, LARGE — needs
    revision statistics, brief with #88), pre-send cost transparency (#82); plus batch questions (#83), message-type styling (#84), honest
    waiting-steps (#85, real steps blocked on the ADR 018 streaming seam), CBS deep-link (#86), historical-range chip (#87, real R5 derivation),
    revision awareness (#88), "waarom dit antwoord" (#89), source chip (#90), number typography (#91), chart-footer rearrangement (#92); **three ideas
    explicitly REJECTED by the owner (#93: watch-list, pattern-encoding, comparison card)**. Owner authorized immediate execution alongside recording
    — **the three small top-5 items (#78/#80/#82) were built the same day as WP20 (session 20, entry in [status-archive.md](status-archive.md))**;
    CSV export [#52] stays next in the standing order after that
  
  **KvK is deliberately parked until the website is finished (owner decision 2026-07-04, [#54](open-questions.md)) — do not raise it as a next step.**

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

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
**▶ THE PLOT (owner, 2026-09-30, session 152 — read this before anything else):** the product is a LAYER. A question comes in; the
  layer finds the right table anywhere in CBS or Eurostat, fetches only what it needs, checks it, and answers. It is NOT a set of curated
  copies kept fresh. Work, in order, and nothing else:
  1. **CBS: switch on the any-table route** (ADR 062 table lane) — reader recorded + calibrated and the table-lane benchmark
     PASSED and the route is LIVE (session 153); `37789ksz` evicted 2026-10-02 — no CBS table is a whole copy any more.
  2. **Eurostat: the same route** — find across the whole Eurostat catalogue, read a dataset's structure the connector's way (built,
     dark), fetch only what the question needs ([study](session-briefs/2026-09-30-eurostat-mcp-deep-study.md) §5.4 steps 3–5).
  3. **Stop:** converting, refreshing, curating or polishing specific tables/datasets. The four Eurostat datasets are NOT converted or
     refreshed by hand any more; they go when the Eurostat route answers. Storage work only as far as the two routes need it.
  The owner said "you completely lost the plot" when the session proposed refreshing and converting four Eurostat datasets — the same
  mistake as pinning one welfare table (CLAUDE.md "Breadth comes from the layer").

**▶ SESSION 153 (2026-10-01, owner present) — THE ANY-TABLE ROUTE PASSES ITS GATE; THE FLIP WAITS FOR THE OWNER'S GO
  ([#338](open-questions.md), [#360](open-questions.md), [#361](open-questions.md), ADR 062 "As built — recording + calibration"):**
  owner decided #360 "add all" and approved the spend. The table reader was recorded live for the first time. The cheap
  model failed (26/50 labelled; it read "CO2" as all greenhouse gases and "nu vergeleken met 2015" as one year ago), so the
  reader moved to the mid tier (`claude-sonnet-5`), with the owner's OK. Five code fixes (no AI): named-year guard, harmless
  extra entries dropped, facts-before-doubt refusal order, total picks left to the resolver, the seasonal-adjustment rule
  in code (a sixth, "place served by the chosen row", was withdrawn: the verification block showed a
  birth-country hazard). Threshold calibrated to 0.6. **Measured on both recordings: labelled 44/50
  (all six misses refuse or ask), table-lane benchmark 12/14 answers (the floor), 9/9 refuse/ask, 0 invented — GATE PASS.** AI spend
  ~$4.24 (estimate undercounts billed tokens 2.5×; fixed in the dry-run print). Per table-lane question ~1.8 cents.
  **Owner GO the same session: `gate.enforcedInCi` = true, `TABLE_LANE_ENABLED=1` LIVE in Vercel Production** (the live
  check found the closed front door — part 2 below; `37789ksz` was evicted on 2026-10-02 once welfare questions were
  shown to reach a welfare table through the route).

**▶ SESSION 153, part 3 — LIVE FIXES AFTER THE OWNER'S SIDE-BY-SIDE WITH CHATGPT ([#363](open-questions.md), [#364](open-questions.md)):**
  the first live lane question hung — the job kick went to graphmaker.studio (no DNS yet); fixed with a fallback to
  checkdecijfers.vercel.app (`5f103506`); both live questions then answered (vans 9,517 ✓, pigs 9.188 million ✓ = the CBS
  cells). Then, owner's pick: "naar verwachting" for a provisional figure is now rejected (R11), and a question naming no
  period shows a short trend (6 years / 8 quarters / 13 months) ending at the latest; the long-series text now leads with
  the latest value, and a series with period gaps (pigs: April/December) is drawn as bars instead of no chart. Speed (#363):
  measured per step; the waiting bubble now names the found table and the job's real state, polls every 1 s at first, and
  the lane fetches code lists in parallel. Search ranking: catalogue-common words no longer drown the topic word,
  Dutch plurals reach singular titles (front door 31/32 on the tuning set; **27/30 on a frozen held-out set of new topics**
  — old path 1/30; 0 non-questions routed). Eurostat (dark): the Dutch → English search bridge takes Dutch Eurostat
  questions from 0/12 to 10/12 in the shortlist (#357), and the lane now PLANS a Eurostat dataset correctly in a hermetic
  test (totals, freq, Dutch country names); the source-aware job is built too (dark); the table-reader recording on Eurostat
  ran (owner GO, ~$0.50): 13/17, 0 invented numbers (#357). Next: step 5 — ≥5 Eurostat benchmark tasks, the public-claim
  sweep, then switching the Eurostat finder on (owner); decide #365 (asylum citizenship total, licence reading).

**▶ SESSION 153, part 2 — THE FRONT DOOR ([#362](open-questions.md), ADR 062 "As built — the front door"):** the owner's
  live check after the flip ("Hoeveel bestelauto's werden er in 2024 gesloopt?") was refused as out of scope — the curated
  question reader turned the topic away before any table search. Built (no existing prompt changed): a whole-question
  table search (any word, prefix, Dutch participle base) used for out-of-scope questions and as the fallback for unplaced
  topics, behind the table-lane switch. Measured on 38 real questions: **5 → 22 of 32 reach a right table, 0 of 6
  non-questions routed;** then the meaning step (the cheap model proposes CBS-style search words on a no-pick): **27 of 32**.
  Read-only end-to-end proof: the vans question lands on the CBS cell 9,517. `37789ksz` eviction held at first, then DONE
  2026-10-02 (rehearsal: welfare questions route to 37789ksz / 85585NED; read-only e2e plans 'Totaal bijstandsuitkeringen'). AI spend this session ~$7. **Owner live re-check PASSED 2026-10-02:** the vans
  question answers 9.517 from 85245NED in production.

**▶ SESSION 152 (2026-09-30, owner present) — ALL 17 PINNED CBS TABLES NOW LIVE ON SLICE STORAGE ([#358](open-questions.md), ADR
  [065](decisions/065-retire-whole-table-copies-one-route.md)):** owner GO "all 20, stop on problem". 17 pinned tables converted one at a time,
  each proven cell-for-cell IDENTICAL to CBS before and after (0 differences; consumer prices 616,714 cells); refreshing them is now the
  daily warm job's work, not a hand sync. A live read-only probe (real query path, no AI) served every curated measure. Fixed on the way:
  a conversion after-check false alarm (`425937f0`) and a retry-wait edge caught by CI (`67e07782`). Built in parallel by agents and merged:
  table-lane split at 150 codes (#358 11), `--budget-seconds` a hard bound (5), period-note status in slice storage so `70072ned` can
  convert (3), slice storage as the default test build (2, first half). Still whole-table: 3 unpinned tables (#358 12 — recommendation:
  pin `37789ksz`, drop `83694NED` + `85615NED`, owner decision), `70072ned` (not loaded), 4 Eurostat datasets (by the owner's later direction NOT converted; see THE PLOT).
  **Later the same session:** owner correction — breadth comes from the LAYER, never from curating one table (rule in CLAUDE.md);
  the `37789ksz` pin was withdrawn (owner: keep it until the table lane is on, then evict — a step in the 1 October plan);
  `83694NED` + `85615NED` EVICTED from production with the new targeted `tables:evict --table` (`ed68a522`). Owner asked for a deeper
  look at the Eurostat connector by cyanheads: [deep study](session-briefs/2026-09-30-eurostat-mcp-deep-study.md) — borrow his portal
  plumbing, keep our answer rules. Built + pushed (`585d9bad`, `d0232889`, `103e517b`, all dark, no AI, no schema): the four Eurostat datasets can ride slice
  storage (#358 4 — converting them is an owner-present step), Eurostat call limits + permanent-error classes + the confidentiality
  split (study step 0), the SDMX structure reader (step 1: 30/30 sampled datasets read, 28/30 fit), combined-flag notes by the owner's
  "join the notes" rule, observed decimals + the licence rule over every geography dimension. Then, on-plot: Eurostat in the finder (dark;
  Dutch recall 0/12), the table-lane benchmark (step 6 harness), region classes + new period shapes in the lane, the "miljard" unit fix
  (`6d7f23d9`, `3e84e452`, `cdea032d`, `b388a14c`). Final verification: backend 289 files / 5,251 tests, benchmark PASS, web 3,524,
  build, 40 e2e. Open: EA21, mixed grains (#357); #359 audit rows; #360 prompt additions before the recording.

**▶ SESSION 151 (2026-09-30, owner present) — THE WHOLE-TABLE COPIES ARE BEING RETIRED; EVERYTHING BUILT EXCEPT THE PRODUCTION CONVERSION
  (ADR [065](decisions/065-retire-whole-table-copies-one-route.md), [#356](open-questions.md)–[#358](open-questions.md)):**
  the owner asked whether the architecture and our own copy of CBS are worth it. Research (blind test of a general assistant, five open
  CBS/Eurostat connectors read in source, our usage): [value research](session-briefs/2026-09-30-architecture-and-value-research.md),
  [connector study](session-briefs/2026-09-30-cbs-connectors-code-study.md). Owner decisions: retire the hand-refreshed copies, keep the
  pinned definitions; run ONLY part A of the 1 October plan (B and C are on hold). **Built, verified and pushed:** time limits on every
  CBS/Eurostat call, a Eurostat freshness check that spots a frozen dataset, and the one-route machinery
  ([design](superpowers/specs/2026-09-30-one-route-warm-slices-design.md)): planner, pinned slice registration, warm job, parity report,
  supervised conversion + way back + re-baseline, a job route the daily run kicks, a failure e-mail. **Gate passed hermetically:** on
  slice storage the 20-task benchmark scores 14/14, 6/6, 0 invented numbers, identical in answers, charts and refusals to whole-table
  storage. **Read-only dry runs against production: all 17 pinned CBS tables are cell-for-cell identical to CBS and ready to convert.**
  Production storage was unchanged at the end of session 151 — **converted in session 152** (block above).
  Found + fixed by dogfooding: the login proxy redirected the two kicked job routes (`/api/warm-job`, `/api/table-lane-job`) to /login.

**▶ SESSION 150 (2026-09-30, owner present) — EUROSTAT SIBLING TABLES LOADED (DARK), TWO DEFECTS FIXED ([#313](open-questions.md)):** owner asked
  for Eurostat data work; E2a step 5 ran for real: unemployment (2,112 rows), inflation (4,760), GDP growth (2,244) are registered, pinned and
  synced in production, nothing reader-visible. Found + fixed: monthly periods are `YYYY-MM`; inflation moved from the frozen `prc_hicp_manr` to
  `prc_hicp_minr`. Commit `7517aa1b`. `registry:apply` waits for the regional `70072ned` load. Kickoff:
  [session-briefs/2026-09-30-session-150-kickoff.md](session-briefs/2026-09-30-session-150-kickoff.md).

**▶ SESSION 149 (2026-09-29 late night, owner present) — NEW-CBS-DATA E-MAIL ALERT BUILT ([#355](open-questions.md)):** owner said "up to you";
  the daily cron now e-mails when CBS has newer data than our copy (day 0, then weekly; read-only, no AI, never syncs). Commit `5d8bb265`;
  CI run 36603120766 green end to end incl. deploy. Freshness report still reads 0 of 20 behind. Nothing else moved.
  Kickoff: [session-briefs/2026-09-30-session-149-kickoff.md](session-briefs/2026-09-30-session-149-kickoff.md).

**▶ SESSION 148 (2026-09-29 night, owner present) — STALE SHOWCASE FOUND + FIXED ([#355](open-questions.md)):** 13 of 20 CBS
  tables were behind CBS (up to 52 days; the homepage GDP card said 1.3, CBS had revised it to 1.6). Built `npm run
  ingest:freshness` (read-only, SAFE/REVIEW verdict per table), refreshed all 13 (batches 46–58, no quarantine; the report now
  reads 0 of 20 behind), fixed the English chart unit "Aantal". Pushed `92746fe5`, CI 36592945949 green incl. deploy. The 1 October
  plan was corrected (a FOURTH record script) and ten Eurostat step-0 cases drafted. OPEN owner decision: automate the check
  (recommend: e-mail via the daily cron first). Kickoff: [session-briefs/2026-09-29-session-148-kickoff.md](session-briefs/2026-09-29-session-148-kickoff.md).

**▶ SESSION 147 (2026-09-29 evening, owner present) — VERIFY-ONLY, WRAPPED:** no code or data changed. Tree clean at `62896015`,
  CI green, prod 200, DNS records for graphmaker.studio still absent. Nothing scheduled can run before 2026-10-01 (spend roof
  resets 02:00 CEST). Kickoff: [session-briefs/2026-09-29-session-147-kickoff.md](session-briefs/2026-09-29-session-147-kickoff.md).

**▶ SESSION 146 (2026-09-29, owner present) — OWN DATA IMPORT BUILT + LIVE-PUSHED ([#354](open-questions.md)):** Excel/ODS/JSON
  uploads, pasted tables, Google Sheet share links, starter questions, euro/percent + quarter columns, readable dense lines.
  Migration 039 applied live (constraint verified read-only). Tried 7 fake sheets (`npm run` n/a — `node scripts/make-fake-sheets.ts`
  → `tests/fixtures/attachments/sheets/`) with the real AI (~$0.3 of the $2 OK'd). Verified: 4650 root + 3475 web tests, benchmark PASS,
  build, 10 e2e. The 1 October recording run below is UNCHANGED and still the next scheduled item.

**▶ NEXT SESSION STARTS HERE (written 2026-10-01, session 153 — verify against `git log` / Actions runs before trusting this).
The CBS any-table route is LIVE (`TABLE_LANE_ENABLED=1`, CI gate enforced). Single priority: widen the front door —
the front door is at 27/32 (`npm run frontdoor:eval`, [#362](open-questions.md)); the owner's live re-check of the vans
question PASSED 2026-10-02 (9.517, 85245NED); `37789ksz` is evicted. Next: the remaining front-door misses (#362), then the Eurostat route.
The older bullets below are history.**

- **⚑ DATA IS FRESH AS OF 2026-09-29 (session 148, [#355](open-questions.md)):** `npm run ingest:freshness` reads 0 of 20 CBS tables
  behind. Nothing REFRESHES them automatically, but since session 149 the daily cron e-mails the owner when CBS has newer data — still
  re-run the report at the start of each session and in the monthly maintenance session; SAFE syncs with `--accept-new-codes`,
  REVIEW needs a person (RUNBOOK "New-CBS-data alert" + release-day sync).

- **⚑ BREADTH RESUMED (session 145, owner pick): migrations 037 + 038 APPLIED on the live database** (owner present;
  exactly those two; `slice_fetches`, `table_lane_requests`, the `cbs_tables` columns, 8 indexes, RLS, the widened
  `failure_stage` check verified read-only; all 21 tables `ingest_mode = 'full'`). Still dark for readers:
  `TABLE_LANE_ENABLED` unset, the parser never recorded. Dry run measured: 39 cases, 114,136 input tokens.
- **⚑ THE 1 OCTOBER RUN IS PLANNED:** [session-briefs/2026-10-01-recording-run-plan.md](session-briefs/2026-10-01-recording-run-plan.md)
  — A table parser → B regional Part 2 (branch `regional-stats-part2`) → C Eurostat step 0, ~$4.35 budget of the $50
  roof (resets 2026-10-01 00:00 UTC), pass/fail gates, three owner decisions (incl. renaming only the intent +
  table-parse prompts). **On/after 2026-10-01, owner present: follow that plan; that is the single next priority.**
- **⚑ SEO LANDING PAGE BUILT DARK ([#353](open-questions.md), `04fa8350`, CI 36569565684 green):** `/netherlands-cbs-data`
  live at the vercel address with `noindex` — the 12 curated stories + the open coverage list, nl + en, zero AI. One
  switch (`SEO_PAGES_INDEXABLE` in `web/lib/seo-pages.ts`, `false`) turns robots allow-list + index/canonical + sitemap on
  together — flip only after the domain is live (RUNBOOK "SEO landing pages"). Eurostat page waits for curated Eurostat
  series (one dataset loaded, none curated). Found + fixed: `/robots.txt` had 307'd to `/login` on prod since it existed.
- **Domain (ADR [064](decisions/064-rebrand-graphmaker-studio.md)):** hostnames ADDED to Vercel; the two Cloudflare A
  records are the owner's step (none as of 2026-09-29 12:00 UTC) — RUNBOOK "Wiring graphmaker.studio"; then the
  `NEXT_PUBLIC_APP_URL` switch (owner present), then the SEO switch.
- **Launch deferred by the owner twice ([#352](open-questions.md)) — do not raise before 2026-10-27 unless the owner
  does.** The Look is complete (ADR 063 gate passed session 144).
- **Owner account steps, parked by the owner ("neither today", session 145):** brand colours need a Brandfetch key;
  the Pro plan needs the Stripe Price + webhook events (RUNBOOK sections). Not code.
- **Direction (ADR 063, unchanged):** ONE product — a beautiful, sourced chart of official Dutch and European statistics.
- **CI:** every push of session 145 green (36569565684; doc pushes skip CI). **Spend:** zero in session 145.
- **Phase 0 gate** (below) is passed and unchanged; principles (a)/(b)/(c) untouched.

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

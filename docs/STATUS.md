# STATUS

> **Tracker, not a source of truth.** Scope and the gate are defined in [03-mvp-scope.md](03-mvp-scope.md), the benchmark in
> [02-user-scenarios.md](02-user-scenarios.md). This file only records progress against them. Update it whenever project state changes (see the
> definition of done in [CLAUDE.md](../CLAUDE.md)) — with **measured results only, never aspirational ones**.

> **Session log lives in [status-archive.md](status-archive.md)** — full per-session "Last updated" entries, verbatim, newest on top.
> **Convention (since 2026-07-12, session 41):** at session wrap-up, PREPEND the full session entry to
> [status-archive.md](status-archive.md) and update only the lean top block below. Keep STATUS.md readable in one
> Read call: hard-wrap every line at ~150 chars, no kilobyte-long lines.

**▶ NEXT SESSION STARTS HERE (session 50, 2026-07-17, owner-present — COVERAGE-SPRINT TABLES #2 + #3 DONE END-TO-END + LIVE, and PRs #54/#55
reviewed + merged. (1) PR REVIEW/MERGE: 18-agent adversarial pre-merge review confirmed 1 HIGH on PR #54 (guard screened only the finder's top
pick while the WP27 fit gate resolves over the whole candidate chain) — fixed pre-merge; #54 squash `71d85a2`, #55 squash `347bfdf`. A PARALLEL
owner-present max-review then landed 12 more findings (file + [dispatch record](session-briefs/2026-07-17-pr54-max-review-findings.md)) — ALL
dispatched in follow-up `c7f6063` (per-measure belt, active-check-first order, batched `alreadyIngestedSet`, fetch-neutral unanswerable mail),
gate+deploy green: the #166 guard is LIVE hardened. (2) TABLE #2 `85880NED` (BBP flash): owner chose FULL ingest over a CbsSlice
measure-allowlist; build surfaced [#167](open-questions.md) — 17 PHANTOM MeasureCodes entries (zero observations table-wide) that quarantine
even a healthy full ingest → curated `Phase0Table.excludeMeasures` (registration/sync/conformance skip them; fingerprint deliberately
unfiltered; strictness pinned by counter-test). Fixture capture-sliced to 2020+ (22,230 obs ~4MB, 86141NED pattern — 27 test files + 5 scripts
rebuild the ingested DB per run). (3) TABLE #3 `85770NED` (PPI): vocab batch re-pointed CC8-CC10 to canonical keys. FIVE keys total
(gdp_growth_yoy_volume = canonical default 'economische groei'/'bbp', gdp_growth_qoq_volume, producer_prices_yoy = default
'producentenprijzen'/'ppi', import_prices_yoy, producer_price_index_level) + AVAILABLE_GRAINS (measured); CC5-CC7 frozen after build-day
re-measurement on BOTH platforms (1.4 / −1.1 / 0.2, v4=v3 exact). ONE #164 re-record (owner spend-approved): 93 fixtures; intent 62/63 + ×3
(os-v02 deliberately re-labelled none→'difference' — verified B13-registered better behavior, note in the labelled set; r-autos measured
unstable live refusal↔clarification, both safe, recorded fixture = expected clarification so the gate replay is deterministic), followup 22/22,
clarify 7/7. Build commit `57be40a`, gate+deploy green. Verification (serial, CI-shaped): ingestion 179, invariants 22, benchmark 28, registry
14, query 98, answer 551, chart 40, audit 99, billing 102, catalog 69, db 48, sources 56, websearch 31, threads 29; benchmark 14/14 + 6/6 + 0
fabricated PASS; web 323/323; real build; audit:verify 1-253 exit 0; /code-review low ×3 = 0 findings. LIVE STEPS (owner-present): sync
85770NED batch 16 = 654 rows/0 corr; 85880NED single-stream sync FAILED at fetch (batch 17 — CBS's unfiltered stream ~6KB/s + terminations,
~53 min) → PARALLEL CHUNKED capture (5 flavor workers, 99,676 rows in ~6 min) + `sync-from-capture` batch 18 = 99,676 rows/0 corr, all five
validators live; registry:apply 11 tables/16 keys AFTER verified deploy (RUNBOOK ordering rule); LLM-free spot-checks: ALL SIX frozen cells
exact on prod (PPI 7.2/9.3/−5.9; BBP 1.4/−1.1/0.2). New committed tooling: `scripts/spot-check-canonical.ts`,
`scripts/capture-observations-chunked.ts`, `scripts/sync-from-capture.ts` (RUNBOOK curated-table steps 4-5). ▶ NEXT = sprint tables #4-#9 per
the [specs doc](session-briefs/2026-07-17-coverage-tables-2-9-measured-specs.md) (releases 3/8-20/8), EACH starting with the RUNBOOK
phantom-measure probe (#167). Owner dates: 22/7 06:30 persberichtdag-generale (sync `85773NED` that morning), 23/7 06:30 sync `83693NED`
(julicijfer — first release table #1 serves on day one), ~30/7 BBP-flash + PPI-junicijfer syncs (85880NED needs the chunked escape hatch),
#132 route B check on/after 19/7. Kickoff: [session-briefs/2026-07-17-session-51-kickoff.md](session-briefs/2026-07-17-session-51-kickoff.md).)**

**Session 49 (2026-07-17 — coverage-sprint table #1 `83693NED` DONE END-TO-END + LIVE (build `c4134bc`, sync batch 15, registry:apply 9/11,
#165 trim 115/115, LLM-free verify −39); sprint-wide finds #164/#165/#166 recorded; #118 code-review-LOW governance addition `09b6191`;
overnight addendum: PR #54 (#166 guard) + PR #55 (table #3 prep) built awaiting review, tables #2-#9 measured (specs doc), "80590NED v3-only"
REFUTED, table #2 descoped pending the slice decision (since resolved s50). Parallel review session same day: PR #54 max-review 12 findings
(dispatched s50), dependabot #51-#53 merged, #53 deploy-red → TS ^5 pin `eec3973`. Full entries in [status-archive.md](status-archive.md).)**

**Session 48 (2026-07-17 — the parallel owner-"spar" strategy session, docs-only: ELEVEN owner decisions #153-upd/#158–#163 + the #118
standing-push revision; #153 proefrit executed (wbn.nl ❌ −4% claimed vs +13,7% CBS-measured); coverage sprint scouted + briefed (8 gap tables,
two load-bearing finds: no full-gemeente price index anywhere [CONFIRMED s49]; "80590NED is v3-only" [REFUTED s49 overnight — v4 works with the lowercase id, docs/07 quirk #1]). Full entry in [status-archive.md](status-archive.md).)**

**Session 47 (2026-07-16→17 — THREE adversarial security/data-integrity hunts (each 4-6 lenses, dual-verified, Sonnet
fan-out) + a frontend-render scout. THREE fixes merged+live, each on an EXPLICIT owner word (#118b). (1) BILLING/MONEY-PATH: NO live credit-
conservation bug; one reachable-today gap FIXED ([#145], PR #48 `7e42656`) — `guardPending` bounds the untrusted reply-turn `pending`. (2) GDPR-
REDACTION: a real HIGH leak the inline scout MISSED — `pending_table_requests.fit_note` (LLM sentence paraphrasing the question) + topic-disclosing
table-ids survived erasure; FIXED ([#151], PR #49 `af287e1`; fit_note all rows, table-ids terminal only). (3) INGESTION/DATA-INTEGRITY: quarantine
ENFORCEMENT on the value path is airtight (`resolve.ts:306` refuses a needs_review table before any cell is served); two hardenings FIXED ([#155]
freshestForCanonical status gate + [#156] one validated dimension set per sync, PR #50 `b654010`). CLEAN lenses: money-conservation, cross-user,
derived-surface, frontend XSS/injection. Tracked NOT built: [#146] Stripe payment_status (dormant, card-only; RUNBOOK pre-delayed-method gate added),
[#147]-[#150] billing low/latent, [#152] feedback insert-race (self-healing), [#154] retained-cell false-fresh date (MEDIUM-HIGH, a DESIGN WP — the
finder's batch_id sketch is flawed), [#157] a/b deliberately dropped. ⚠ [#151] is FORWARD-ONLY: pre-deploy prod rows keep unredacted fit_note/table-
ids until a purge/re-deletion — a one-off backfill is a supervised step. See open-questions #145-157.)**

**Session 46 (2026-07-16 — #144 DONE END-TO-END in ONE session:** built + adversarially reviewed + merged (PR #47, squash `94b90e4`, owner in-chat
approval per #118(b)) + the supervised go-live EXECUTED (calibration, fail-open+admin-alert decision, flag flip, live smoke). The semantic checker is
LIVE and ACTIVE in production; the whole session-44 data-integrity hunt list is now CLOSED.)

- **#144 — the semantic fabrication check — ✅ DONE END-TO-END (ADR [034](decisions/034-semantic-fabrication-check.md); PR
  [#47](https://github.com/Stefan7168/checkdecijfers/pull/47) squash `94b90e4` + go-live commits `8eef383`/`deabbfb`; all gates + deploys green,
  prod HTTP 307).** The additive REJECT-ONLY cheap-tier LLM checker over validated bodies that leaned on a residual-prone exemption
  (`ClassifiedToken.soft`) — the shared close for the #140 (descriptor-echo) and #141 (temporal-marker+un-listed-noun) deterministic ceilings.
  Corpus-MEASURED scope (the brief's "most answers skip the call" assumption inverted: naive = 100% trigger on the 18 stored legit bodies →
  shipped = 0%, while both residual shapes still fire); a fabricated verdict takes the same R3 ladder (regenerate → template); verdict stored on
  the envelope, recorded-not-rederived, its SCOPE re-derived by R8 with tamper teeth; checker calls = `llm_calls` role `semantic_check`; wired on
  all three answer paths (question, reply, onboarding delivery). **Adversarial review (5 lenses × dual refute-verify + a SERIALIZED mutation
  probe, 26 agents, cheap tier): 1 CRITICAL confirmed with executed repro + closed same day (the date-form compound-noun bypass — "nog 31
  januari-meldingen extra" skipped the checker gate; DATE_FORM_AFTER now requires a year/punctuation after the month), 2 refuted-but-adopted
  hardenings (maxTokens scales with suspects; treat-as-data covers all payload fields), mutation probe 5/5 RED, flag-off byte-neutrality 0
  findings.** **Go-live (owner present): calibration run 1 (prompt v1) = 8/9 — FN on the month-compound case, the model fell into the SAME trap
  the code had; prompt v2 (teaches the DATE_FORM_AFTER rule) = 9/9 FP=0 FN=0 flips=0, also at --repeat=3; replay leg pins the calibrated behavior
  on the gate (`tests/answer/semantic-check-replay.test.ts`, commit `8eef383`). Owner decisions in-chat: merge ✓; FAIL-OPEN + ADMIN ALERT per
  skip (`src/answer/audit/alerts.ts` → e-mail via Resend to ADMIN_ALERT_EMAIL with audit row/user/question/error/meaning, console.error as the
  floor; SEMANTIC_CHECK_FAILMODE deliberately unset). Env flags set via vercel CLI; the flip-deploy (`deabbfb`, run 29513127181) gate+deploy ✓;
  live smoke: owner question → audit row 253 carries `skipped_no_suspects` (prompt v2, ZERO extra LLM calls), pre-#144 row 252 has no key (A1),
  `npm run audit:verify -- 253 253` exit 0.** Merge-block verification: backend 1333/1333, web 314/314 (solo re-run; 2 parallel-load flakes),
  benchmark 14/14 + 6/6 + 0 fabricated, real next build, `audit:verify -- 1 252` exit 0 (225/227 + the 2 pre-existing pinned divergences).

**Session 45 (2026-07-16, THREE PRs merged + LIVE, all data-integrity; full entries in [status-archive.md](status-archive.md)):** #141 HIGH
period-exemption hole (PR #44 `d192775`), the #142/#143/row-227 trio (PR #45 `6291dfc`), format.ts raw-NUL cleanup (PR #46 `f909e66`); merges
that session in-chat DELEGATED (#118(b) precedent — NOT automatically renewed; session 46 asked and received explicit per-merge approval);
the #144 design brief was written there and executed by session 46.

**Session 44 (2026-07-13 → 2026-07-16, 3 PRs merged: #134(b) too-old retry chip PR #41 `12518eb`, auth/ownership hunt CLEAN + open-redirect fix
PR #42 `4e2a2fd`, the #140 validator narrowing PR #43 `882c808`; full entries in [status-archive.md](status-archive.md)).**

- **Next — the coverage sprint ([#163](open-questions.md)(3), owner-approved 2026-07-17):** build order, validated slices and caveats in
  [session-briefs/2026-07-17-coverage-sprint-brief.md](session-briefs/2026-07-17-coverage-sprint-brief.md); per-table measured record in
  [11-coverage-table-set.md](11-coverage-table-set.md). **Table #1 `83693NED` ✅ DONE + LIVE (session 49); next = #2 `85880NED` + #3 `85770NED`
  before 30/7 as ONE batch (#164 re-record constraint).**
  **Fresh hunts are PAUSED per #163(1)** — un-hunted surfaces (auth/session-flow, answer-composition/LLM-harness) stay listed for when hunts
  resume. Tracked follow-ups #146-150 + #152 low/latent; #151 backfill sweep = supervised; #154 = a design WP, owner's call on priority.
- **Next — owner decisions (queue behind the sprint per #163):** **#138** (v2 regional refusal chip — needs a code→region-label source), **WP26**
  (answer-first defaults + clickable clarify options — aligns with #163(1) market contact), **#121** (fail-closed template rung), **#131**
  (multilingual L1), **WP30c** (source choice), **#162** (slot-filling experiment — ADR-grade if the A/B wins). Tracked-not-focus: #132 route B
  ~2026-07-19 (check on/after 19 juli), #104/#112 (need live-LLM spend), /login header cosmetic.


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

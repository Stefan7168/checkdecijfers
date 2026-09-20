# Build plan — Phase 0 pipeline (the work plan)

## Executor guardrails — binding for every future build session (added session 41, 2026-07-12, sized for mid-tier models)

1. Follow [CLAUDE.md](../CLAUDE.md)'s reading order; [STATUS.md](STATUS.md)'s top block outranks any other phrasing. If two docs disagree, STOP, fix per the precedence rule, then build.
2. Never build without **(a)** an execute-ready WP section/brief naming scope + invariants + done-definition, and **(b)** the FULL verification block green BEFORE any PR or merge: `npm ci` (root + web), typecheck (root + web), all backend suites, the web suite, `benchmark:run` + `benchmark:score` = 14/14 + 6/6 + 0 fabricated, and a real next build — run serially, exit codes checked. **Plus (owner, 2026-07-17, session 49): an automatic `/code-review` pass at LOW effort over the diff before every code push** — fix or consciously dispatch every confirmed finding first (docs-only pushes are exempt: no code diff). Green CI is the only "done".
3. Zero prompt bytes unless the WP explicitly authorizes them; never re-record LLM fixtures as a side effect.
4. Live DDL, real API spend, and env-flag flips happen ONLY in an owner-supervised step — never autonomously.
5. Core-product or money-path code goes on its own branch + PR; merge ONLY on the owner's explicit in-chat approval ([open-questions #118](open-questions.md)). **Revised (owner, 2026-07-17, #118): in OWNER-PRESENT sessions this per-merge approval is replaced by a standing authorization — push/merge directly once the full verification block (rule 2) is green. Branch+PR+approval remains binding for AUTONOMOUS sessions; rule 4 (supervised live DDL/spend/env) is unchanged.**
6. On missing or ambiguous data/requirements: refuse or ask the owner. A guess presented as settled is this product's worst bug (principle (c)).
7. Design trade-offs beyond the brief: stop and write the question to the owner; do not decide silently.
8. Big files — [STATUS.md](STATUS.md), [open-questions.md](open-questions.md) and this build plan — each have an archive twin ([status-archive.md](status-archive.md), [open-questions-archive.md](open-questions-archive.md), [build-plan-archive.md](build-plan-archive.md)): read the lean file, and grep the archive only when a specific number/WP is missing from it.

---

**What this is:** the ordered sequence of the remaining Phase 0 work packages — one build session each (RUNBOOK: "one chat session = one work package"). Each entry states its scope, the invariants at stake, the key design decisions/contracts, and what "done" means. A session's kickoff is then just *"do the next work package in [docs/08-build-plan.md](08-build-plan.md)"* — the brief already lives here, not in a chat message.

**How this differs from the neighbours** (so nothing is duplicated):
- [03-mvp-scope.md](03-mvp-scope.md) — the phase **gate**: what is/isn't in Phase 0. Doesn't change per session.
- [06-roadmap.md](06-roadmap.md) — the **phases** (0–3) at a high level.
- [STATUS.md](STATUS.md) — the **live tracker**: the tick-list, the latest benchmark score, the immediate next-up. Changes every session.
- **This doc** — the **order and the briefs**: what each remaining session actually builds, and the design decisions that must stay consistent across sessions.

**Status of the decisions here:** they are the *plan of record*, not frozen law. The implementing session firms them up against the code in front of it and records any deviation (with reasoning) in its ADR / lessons-learned. New load-bearing choices get an ADR per [CLAUDE.md](../CLAUDE.md).

**Completed so far** (details in [STATUS.md](STATUS.md) phase history): WP1 CI skeleton + validated table set · WP2 ingestion + validation pipeline · WP3 benchmark answer key frozen · WP4 table registry + alias list · WP5 deterministic query + validation + registered derivations (contract in ADR [011](decisions/011-query-contract.md); two additions beyond the brief below: comparisons also pre-register a non-explicit ranking so B10's "meer dan" has an R9 binding target, and freshness refusals offer period + status but **never a value** — [open-questions #37](open-questions.md), resolved).

---

**✅ COMPLETE (the COVERAGE SPRINT, owner-approved strategy [#163](open-questions.md)(3))** — onboard the 8 validated
publication-calendar gap tables via the curated route ([how-to-add-a-source.md](how-to-add-a-source.md), NOT the WP16 fit-gate). Execute-ready
brief with build order, slices and caveats: [session-briefs/2026-07-17-coverage-sprint-brief.md](session-briefs/2026-07-17-coverage-sprint-brief.md);
per-table measured record: [11-coverage-table-set.md](11-coverage-table-set.md).
**Table #1 `83693NED` (consumentenvertrouwen) ✅ DONE END-TO-END session 49 (2026-07-17, six days before its 23 July 06:30 release):** curated
onboarding (commit `c4134bc`, CI gate+deploy green) + live prod sync (batch 15, 3,864 cells, 0 corrections) + registry defaults + the [#165](open-questions.md)
vocab-overlap trim + LLM-free live verify (−39, juni 2026; JJ ask refuses `not_published`). Verification tasks CC1-CC4 frozen in
[benchmark/coverage-key.json](../benchmark/coverage-key.json), scored on the gate by `tests/query/coverage-key.test.ts` (docs/05 onboarding rule).
**✅ Tables #2 `85880NED` (BBP, FULL ingest per the owner decision + the [#167](open-questions.md) phantom-measure exclusion) and #3 `85770NED`
(PPI) are DONE END-TO-END + LIVE (session 50, 2026-07-17, build commit `57be40a`)** — one combined vocab batch (5 canonical keys) + ONE fixture
re-record per the [#164](open-questions.md) constraint; CC5-CC10 frozen + green on the gate; all six frozen cells re-verified LLM-free on
production. **Tables #4-#9 (specs ready, each with the RUNBOOK phantom-measure probe) queued behind the session-51 owner pivot: PRODUCT-FINISH FIRST** — (a) ✅ the 'Ontdek Nederland in grafieken' homepage section (LLM-free) **DONE session 52, 2026-07-17 (ADR [035](decisions/035-homepage-discovery-charts.md): `src/chart/curated.ts` + `web/lib/ontdek.ts`/`web/components/ontdek.tsx`, gate-pinned by `tests/chart/curated.test.ts`)**, (b) ✅ the #53 anonymous-trial pot **DONE END-TO-END session 52 (ADR [036](decisions/036-anonymous-trial-pot.md): built `9317acb` + supervised go-live RUN same day, owner present — THE TRIAL IS LIVE on `/`; migration 020 applied to prod; pot ops via `npm run trialpot:set`; record in the RUNBOOK '#53' section)**. **▶ Tables #4-#9 (85828NED, 85937NED, 85429NED, 85792NED, 80590ned, 83625NED): BUILT DORMANT session 53 (2026-07-17, autonomous prep branch `coverage-tables-4-9-prep` per #118(b))** — all six probed live (the #167 step caught 7 SLICE-EMPTY Productie-measures on 85828NED), seeds + registry defaults + floored fixtures + CC11-CC31 frozen (every value v3+v4+fixture-verified; incl. a `no_data` methodebreuk-refusal pin and a null+'Impossible' R11 pin), hermetic gate green. **✅ COMPLETED session 54 (2026-07-18, owner-present, [#168](open-questions.md) RESOLVED): PR #56 merged (`5e3a8e2`) → the vocab batch executed (`49135ef`: 10 canonical keys, prompt v6 incl. the deferred ADR-023 tot-fix + the scoped grain-sibling rule, ONE #164 re-record over six calibration rounds — intent 72/72 ×3 zero flips) → live syncs ×6 (batches 19-24, 136,511 rows, 0 corrections/quarantines) + registry:apply + 10 LLM-free spot-checks ALL exact. ALL NINE coverage tables are LIVE and answering.** Spin-off: [#172](open-questions.md) (finder-chain regression, escalation WP). The sprint's table set is COMPLETE — next per the owner queue: release-day syncs (22/7, 23/7, ~30/7) and the owner-decision stack (WP26 with its trial-conversion stake, #138, #121, #131, WP30c, #162). *(Status 2026-07-24, session 55: the 22/7+23/7 syncs were caught up after a six-day interruption (batches 26/27); #138, #121 and #154 are DONE + LIVE; the ~30/7 syncs and the remaining stack (WP26, #131, WP30c, #162) stand — STATUS.md leads.)*
~~Table 8 needs ADR-003's v3 path~~ REFUTED by the 2026-07-17 overnight validation: `80590ned` IS on v4 under its lowercase id (docs/07 quirk #1) — no v3 path needed; measured build specs for #2-#9: [session-briefs/2026-07-17-coverage-tables-2-9-measured-specs.md](session-briefs/2026-07-17-coverage-tables-2-9-measured-specs.md). Fresh
hunts are PAUSED per #163(1); the owner-stack items (#138/WP26/#121/#131/WP30c) queue behind the sprint.

---

## Sequencing note — why build order ≠ runtime order

The runtime pipeline runs intent → query → answer ([04-architecture.md](04-architecture.md)). The **build** order deliberately differs: we build the deterministic core (query / validation / derivations) **before** the LLM intent parser. Reasons (decided 2026-07-03): the deterministic layer is the anti-hallucination core, it needs no LLM or API key so it is fully testable in hermetic CI, and it lets us score B1–B14 against the frozen answer key with zero LLM involved — so when the parser lands next it targets a *known-good* query layer and a *fixed* intent contract, and any failure is unambiguously the parser's.

---

## WP16 — On-demand CBS fetch when data is missing (demand-driven table onboarding)  ✅ CORE LOOP LIVE IN PRODUCTION (sub-parts 1+2, session 24–39) — session-30/39 follow-ups all merged+deployed; known v1 limitations noted in the sub-part-2 entry below; Fable-authorized on the hard sub-parts

*Owner reprioritized this to #1 (Stefan, session 23, 2026-07-05): "dit verdient de voorrang… nummer 1, het allerergste wat we gaan doen; als het ingewikkeld is moet Fable dat doen." It was Phase 2-3; it is now the next big build, ahead of WP26. The design has been decided across multiple sessions ([open-questions #21](open-questions.md)/[#24](open-questions.md), roadmap feature pool) — this brief makes it execute-ready. This entry is now the source of truth; do not describe missing-data behaviour as a flat refusal.*

**The behaviour (owner design):** when a question needs data that isn't in our database, DON'T dead-end — **fetch the needed CBS table from the CBS API, run it through the full ingestion+validation pipeline, store it, then answer from our own database.** Because this takes time, the user is told **"je tabel wordt voorbereid"**, and — owner's UX — **gets an email when it's ready and sees on the dashboard that their question is being worked on.** A refusal becomes "we halen het voor je op."

**The guardrail that makes this safe (principle b / ADR 003 — NOT a contradiction of the fetch):** CBS is called in the FETCH+INGEST step, never in the answer path. The number always flows CBS API → validation pipeline → our DB → answer; a raw API response is never piped into an answer. On-demand fetch and the anti-hallucination promise both hold — that is the whole reason it goes through ingestion rather than a live lookup.

**Only-after-verification (the anti-fabrication gate, [#21](open-questions.md) + docs/05 table-onboarding rule):** a freshly-fetched table becomes answerable ONLY after automated verification passes — structural existence check + label-consistency check against CBS's own published labels + an independent cross-check against a second reference figure where available. High confidence on all three auto-publishes with **zero human click**; genuine multi-definition ambiguity yields an honest **multi-candidate** answer (every candidate with its definition label), never a silent pick or a bare refusal. A check, not a manual approval.

**This is an EPIC, not one WP — its hard sub-parts (likely separate build sessions; Fable on the hard ones per the owner):**
1. **Table discovery / CBS-catalog search** — the hardest part: map a user topic we don't have ("bijstand", "criminaliteit") to the right CBS table id(s) out of CBS's full catalog. Likely pulls the pgvector trigger (ADR [002](decisions/002-postgres-system-of-record.md)). A wrong table is a principle-(c) risk — the verification gate below is the backstop.
2. **Async fetch+ingest job + "pending question" state** — the fetch can take minutes, so it cannot be a synchronous chat turn: a background job, a pending-question record, and the notification surface (email + dashboard "wordt aan gewerkt"). **Decided (ADR [026](decisions/026-on-demand-fetch-job-architecture.md), session 26): Vercel Cron polling a new `pending_table_requests` status table, running fetch→ingest→verify inline in one function invocation** (fits Vercel's 300s default timeout at the sub-part-3 size cap) — not Workflow DevKit or Queues; those are new paradigms this repo hasn't used, rejected for v1 on the same "boring beats powerful" grounds as ADR 001. First cron entry in this repo (new `vercel.ts`/`vercel.json` `crons` array). Email notification: use the Resend API directly (the account/API key already exist per RUNBOOK — today's magic-link email rides Supabase's SMTP relay to the same account, this is a new direct send).
3. **Slice-sizing for a newly-fetched table** — a freshly-requested table can be huge; a sensible ingestion slice must be chosen. **Decided (session 26): greedy by default** (ingest the whole table — follow-up questions roam beyond the triggering one, and a narrow slice just re-triggers a second paid onboarding wait, the [#77](open-questions.md)/[#97](open-questions.md) dead-end pattern); **auto-slice only above an estimated ~150,000 cells** (computed pre-fetch from the catalog metadata's dimension cardinalities, never "gigantic by feel" — roughly a quarter of the CPI table that forced the [#33](open-questions.md) DB-budget discussion), sliced to the question's own topic + sensible defaults (national totals, recent years). Calibrate the exact number against measured Phase-0 table sizes at build time; it's a config constant, cheap to retune.
4. **The automated three-check verification** (above) — the anti-fabrication gate; reuses the existing ingestion validation pipeline (schema fingerprint, plausibility, period parsing, dimension mapping, unit consistency — docs/05). **Decided (ADR 026, session 26): "second reference figure" = internal consistency only for v1** — no genuinely separate second source exists yet to cross-check against (that's priority-#2/new-sources territory); claiming a stronger external check now would overstate the gate. Revisit once priority #2 lands a real second source.
5. **Answer-on-arrival + credit handling** — once verified+stored, answer the pending question; this response **costs credits, not free like a refusal**. **Decided (ADR 026, session 26): 100 credits (the existing "heavy" tier price) — reuse, not a new 5th tier.** Refund-on-verification-failure needs NO new logic: `src/billing/gate.ts` already compensates in full on any refusal outcome or thrown exception (verified this session) — a verification failure just needs to raise the normal refusal path.

**▶ v1 scope cut (ADR 026, session 26): the core discover→fetch→verify→answer loop only.** [#108](open-questions.md) (successor re-discovery), [#109](open-questions.md) (the proactive onboarding-suggestion chip — **since resolved as already met in substance, session 66: the live confident path fetches immediately with the row's three honesty guards enforced, so no separate chip build remains; see the row**), and [#110](open-questions.md)'s full TTL/eviction machinery are real but deliberately separate follow-on work — except the one verified correctness bug in #110(a) (`ingest sync --all` is hardcoded to the 8 seed tables, not the DB's registered set), which rides this build since it touches the same ingestion-registry code an on-demand table needs to participate in refreshes at all.

**▶ Sub-part 1 (table discovery) — ✅ HERMETIC FOUNDATION BUILT (session 24, 2026-07-05); live steps deferred to a supervised session. Design + the Fable judgment: ADR [025](decisions/025-cbs-catalog-table-discovery.md).**

*Built this session, all hermetic (€0 LLM spend, no live DDL), full gate green (757 backend tests incl. 42 new catalog tests, benchmark 14/14+6/6+0 fabricated, clean typecheck):* `migrations/011_cbs_catalog.sql` (a `cbs_catalog` mirror, separate from `cbs_tables`, with a Dutch `tsvector`+GIN index — FTS verified on PGlite); `CbsSource.fetchCatalog()` (real in `odata-v4.ts`, replayed from a real captured `tests/fixtures/cbs/_catalog.json` in `fixture-source.ts`); `src/catalog/` = ingest (idempotent mirror refresh + prune) + Stage-1 FTS recall (`recallCandidates`, alias hints, Text/non-nl excluded) + Stage-2 rerank scaffolding (schema + prompt + the **hard allowlist validator** + `TABLE_RERANK_MODEL='claude-haiku-4-5'`) + the `findTable` orchestrator (confident/disclose/none routing, rerank injected so routing is testable without LLM fixtures); `scripts/tablefinder-eval.ts` + `benchmark/tablefinder-labelled-set.json` (seed) + `catalog:refresh` CLI + a `--catalog` capture routine.

*The Fable flag (owner asked): the topic→table rerank does **NOT** earn Fable in v1 — it is a closed multiple-choice over a supplied shortlist with a hard allowlist, an easier shape than intent parsing (which runs on Haiku). The principle-(c) risk is contained structurally (allowlist + conservative threshold + disclosure + the verify gate), not by model size; Fable would be a cost bug. The model is one named constant with a recorded escalation ladder Haiku→Sonnet→Fable, gated on a measured accuracy miss. (ADR 025 decision 3.)*

*Supervised session step — ✅ DONE (session 25, owner present; commits `b9eb026`+`bfe36d3`, CI green):* migration 011 applied to production; the RUNBOOK per-migration grants/RLS check ran live and confirmed `cbs_catalog` is locked by inheritance from migration 003 (0 `anon`/`authenticated` grants, RLS on, 0 policies — `information_schema.role_table_grants` + `pg_class.relrowsecurity`); real `catalog:refresh` mirrored **4,858 rows**; `tablefinder:record` recorded the rerank replay fixtures live (Haiku); `DEFAULT_FIND_TABLE_CONFIG.highConfidence` **calibrated to 0.8** (confident floor 0.85 measured/stable, failure-safe = disclose; the disclose boundary is not yet directly measured — [#104](open-questions.md)); an end-to-end replay test is now on the gate (`tests/catalog/find-replay.test.ts`). Also fixed en route: 1 seed mislabel (zonnepanelen→85004NED) + 2 Stage-1 recall gaps via alias hints (bevolking, woningvoorraad).

**▶ Sub-part 2 — ✅ LIVE IN PRODUCTION (go-live session 28, 2026-07-06, owner-supervised; both paths verified live — delivered consumentenvertrouwen→83694NED + unanswerable-refund bijstand; see the session log in [status-archive.md](status-archive.md) for the full record incl. the pre-flight proxy bug fix `42b275b`). Built hermetically session 27, merged to main. Owner-flagged follow-ups from the go-live: [#111](open-questions.md) finder stock-vs-flow (must answer simple questions — **problem dossier written session 30 ([2026-07-07-111-problem-dossier.md](session-briefs/2026-07-07-111-problem-dossier.md)); design step gated on the owner’s model-tier answer — ✅ SUPERSEDED: CLOSED session 33 (2026-07-10) via WP27 stages A–D, ADR [027](decisions/027-finder-shape-fit-gate.md); the owner's live acceptance test passed, the dead-end bijstand question answers**), [#115](open-questions.md) weak onboarded-answer quality (**✅ DONE + live-verified session 29** — CBS's real per-measure `Description` now renders as the "Definitie:" line via a dedicated nullable `canonical_measures.definition_text`, migration 014; see ADR [010](decisions/010-registry-canonical-measures.md)/[013](decisions/013-answer-composition.md) as-built notes), [#116](open-questions.md)/[#117](open-questions.md) delivery UX (the #117 live-update pairs with #115's deferred definition "expander").** *Historical (pre-go-live): it was DORMANT until the supervised live step — dormancy was MECHANICAL: the finder is only constructed when `ONBOARDING_ENABLED=1` (was unset in prod), so the deployed app behaved byte-identically pre-WP16 until the owner flipped it (a session-27 post-merge review catch: without the gate, a confident finder pick against the not-yet-migrated tables degraded to an internal-refusal — safe and refunded, but a UX regression vs the honest clarification).* Built from the frozen [canonical design](session-briefs/2026-07-06-wp16-sub2-design.md) by an orchestrated Opus/Sonnet build (4 stages + gate loop + 4-lens adversarial review, every finding double-verified; stage-by-stage record: [handoff log](session-briefs/2026-07-06-wp16-sub2-handoff-log.md)). **Measured: 888 backend tests (768→888), benchmark 14/14 + 6/6 + 0 fabricated GATE PASS, 154 web tests, clean typechecks.** What shipped: migrations 012 (`pending_table_requests` + ledger `onboarding_cost` widening) + 013 (compensation-trigger + `source_tag` widening); the finder as an **injected optional dep** (absent → B15 byte-identical, `toStrictEqual`-pinned — benchmark untouched by construction); the acknowledgment as refusal-reason `onboarding_pending` (gate.ts **byte-untouched**, verified); `triggerOnboarding` (atomic 100-credit debit + pending row); the cron job (`src/ingestion/onboarding.ts`: claim/reclaim/attempt-cap → slice estimate (`fetchObservationCount` on both sources, 150k cap) → register+sync through the existing validators → runtime vocabulary (`extraCanonicalMeasures`, **default-empty → prompt bytes byte-identical**, fixtures untouched) → delivery through the full normal audited pipeline → Resend notify, every path terminal + refunded); `web/vercel.json` cron + fail-closed route; dashboard pending/delivered/failed states. The e2e pin is non-vacuous: the delivered number can only come from the fixture-ingested cell (the answer-LLM stub throws). **Session-30 follow-up PRs (2026-07-07, autonomous review of sessions 27–29, per #118; ALL MERGED + DEPLOYED 2026-07-07/08):** PR #13 #112 onboarded-vocab on live turns (the 100-credit re-ask bug); PR #14 #115 definition expander + dashboard ack-row dedupe; PR #15 validator negative-cell/long-unit blind spots (heals the live R8 trail); PR #16 exact-delta refund + queue-wedge isolation + kick auth cross-pin + doc truth. Recorded-not-fixed: [#119](open-questions.md) deliver→finalize atomicity, [#120](open-questions.md) GDPR misses onboarding data (chip spawned), [#121](open-questions.md) template-rung validation enforcement. **➡ #119 and #120 (and #116, and the #133 reconstruction policy) were BUILT session 39 (2026-07-12) → PRs 30/32/31/29, ALL MERGED + DEPLOYED the same session on the owner's in-chat approval — LIVE; see STATUS.** **Known v1 limitation (honest, never a wrong number):** onboarded GEO/regional and non-totaal sub-coordinate tables refuse-and-refund rather than answer — the clean answerable case is national single-dimension tables ([#111](open-questions.md)); the extended-vocabulary prompt variant is fixture-unmeasured ([#112](open-questions.md)).

***The original sub-part-2 wiring plan (for the record; superseded by the build above):*** wire `findTable` into the answer flow behind the async fetch → verify → store job + pending-question state + notification described above. **Seam precision (session-26 review): the missing-data seam is TWO structurally different exits, not one.** (1) The `unmatchedMeasureTerm` parse exit (`buildUnmatchedClarification`, `src/answer/intent/policy.ts`) carries the user's free-text Dutch measure phrase — a clean fit for `findTable(topic)`'s Stage-1 FTS input, no adapter needed; **this is the live seam.** (2) `respond.ts`'s `runQuery`→`buildQueryRefusal` branch reaches `table_not_registered` (`src/query/resolve.ts`) only *after* a canonical key already resolved to a concrete table id — no free-text phrase survives to that point, so wiring it needs a different input (e.g. the measure's stored definition label; NOT the raw table id, which FTS won't match), and its user-facing refusal copy is today the generic "Deze data is niet bij ons geregistreerd." carrying no table/measure identity (unlike its sibling refusal kinds — it needs that identity before it can honestly say what would be fetched). Exit (2) is effectively unreachable with the current hand-curated registry (every canonical key maps to an ingested table by construction), so sub-part 2 can wire (1) first and treat (2) as its own small follow-on. This is where "we don't have this" becomes "je tabel wordt voorbereid". Still needs live DDL (fetched tables land in prod) → supervised; Fable-authorized on the hard verification sub-part. Design inputs logged as open questions: slice greediness [#107](open-questions.md), successor re-discovery [#108](open-questions.md), the onboarding suggestion chip [#109](open-questions.md), data lifecycle/eviction — including making `sync --all` registry-driven — [#110](open-questions.md), plus the disclose-case calibration gap [#104](open-questions.md).

*Original recommended v1 design (session 23; delegated research on Sonnet, synthesised by the session) — kept for the record:*

*CBS catalog capabilities (measured live this session):*
- v4 catalog `datasets.cbs.nl/odata/v1/CBS/Datasets` — server-side `$filter=contains(Title,'…')` works; `$select`/`$top` for paging. ~4,858 tables.
- ⚠️ **`$search` is a NO-OP** on v4 — returns HTTP 200 + *irrelevant* results, never errors. A direct principle-(c) footgun; **never use `$search`** (any code assuming it does real full-text search passes tests and returns wrong tables in prod).
- `Summary`/description is **not filterable** on the Datasets listing (only on the per-table `/Properties` singleton). The legacy `opendata.cbs.nl/ODataCatalog` (Tables + Themes + Tables_Themes) *does* expose a filterable ShortDescription + a real theme taxonomy — but it's the API CBS is steering away from, and its count (5,943) ≠ v4's (4,858): ~1,000 tables differ (coverage risk — a table CBS has could read as "we don't have that").

*Architecture (per principle b — never live-query the catalog from the request path):*
- **Bulk-ingest the catalog metadata into our own DB**, refreshed on a schedule (~5k tables is tiny); search locally — not a live CBS call per question.
- Add discovery as a **new `CbsSource` method** (`fetchCatalog`/`searchCatalog`) on both `odata-v4.ts` (real) and `fixture-source.ts` (captured fixture) — keeps ADR 003 isolation, closes the ADR's own revisit trigger. **Verify the exact catalog endpoint path empirically first** (the docs/07 "catalog quirks" precedent — don't assume the URL shape).
- New migration for a `cbs_catalog` table (**known-to-exist, not-yet-ingested**), kept SEPARATE from `cbs_tables` (**registered + ingested**). Don't conflate or repurpose columns.

*Topic → table matching — the crux; recommended v1 is two-stage, keyword-only:*
- **Stage 1 (deterministic recall):** Postgres full-text search (`tsvector`/`plainto_tsquery` — zero new infra, already the system of record per ADR 002) over the ingested catalog metadata (title + summary + dimension names), plus hand-maintained **alias hints** for politically-renamed topics (bijstand, migratieachtergrond). Output: a shortlist of ~10–30 candidate table ids (metadata only, never data cells).
- **Stage 2 (LLM rerank):** the same narrow LLM role as intent parsing (ADR 004) — input the topic phrase + the shortlist's titles/descriptions, output a schema-validated ranked pick + confidence. **HARD validator: the picked table id MUST be in the shortlist** (allowlist check, mirrors R3's verbatim-number rule) — the LLM can never invent a table id. Near intent-parsing token cost (a few KB of titles, not the whole catalog).
- **Confidence routing:** high → WP16's fetch+verify gate (the real backstop); low/tied → **multi-candidate disclosure BEFORE any ingest** (cheap — just show candidate titles, "welke bedoel je?"), so a wrong pick never triggers the expensive ingest. Reuses the [#21](open-questions.md)/[#39](open-questions.md) disclosure pattern.
- **Defer pgvector/embeddings** (ADR 002's designated upgrade) until measured evidence keyword recall misses relevant tables — an *additive* second recall signal into the same Stage-2 shortlist then, not a v1 redesign. Don't build the semantic-search project before the cheap version is proven insufficient (phase-gate + cost-tier discipline).

*Principle-(c) guards to build in:* the Stage-2 allowlist (no invented ids); a **conservative** confidence threshold early (favour disclosure over auto-proceed); **disclose-then-ingest-the-confirmed-one**, never ingest-several-then-pick (ingest costs real minutes + credits); the verification gate is the backstop but NOT zero-risk (the #21 shared-blind-spot residual stands); a freshly-discovered candidate hits the same schema-fingerprint/`needs_review` defense (ADR 003) on first fetch. *Still to settle at build:* the exact catalog endpoint path/shape; the catalog-refresh cadence (open — CBS publishes no explicit number); the alias-hint seed list.

**Invariants at stake:** principle (b) (CBS only in the fetch/ingest step, never the answer path); principle (c) (the verification gate — never auto-publish a table we can't verify; honest multi-candidate on ambiguity, never a guess); principle (a) (no new LLM-computation surface — disclosure/answer reuse the verbatim-value machinery); the full ingestion validation pipeline applies to every fetched table; R8 audit covers both the pending state and the eventual answer.

**Hard build facts:** needs **live DDL** (fetched tables land in the production DB) → supervised, never autonomous; needs **async job + notification infra** (the auth email provider is already enabled); rate/credit-gated. **Fable-authorized on the hard sub-parts (owner, session 23).**

**Open design sub-decisions to settle per sub-part:** the catalog-search mechanism + its confidence threshold; the auto-publish vs multi-candidate-disclosure confidence thresholds; the slice-sizing rule; the exact credit price + refund-on-verification-failure; the email/dashboard copy and pending-state UX.

**Done means (per sub-part):** full local gate green; the automated verification pinned (a verifiable table auto-publishes, a genuinely-ambiguous one yields the multi-candidate answer, an unverifiable one refuses honestly — never a fabricated cell); the async flow + notification tested; migrations hermetically tested before the supervised live apply; adversarial review per the house rule; docs/05 table-onboarding row + roadmap updated; STATUS updated with measured results.

---

## WP29 — follow-up suggestion chips under an answer (#73, owner request 2026-07-08)  ✅ MERGED + DEPLOYED — LIVE (session 35, 2026-07-11: PR #24, merge `0c4b324`, gate + deploy green) · EXTENDED with a refusal-side variant for [#134](open-questions.md)(a) (session 43, 2026-07-13, PR #36 `97c696b`) + the [#137](open-questions.md) range-chip (PR #40 `db34700`) + [#134](open-questions.md)(b) too-old `not_published` chip (session 44, 2026-07-13, PR #41 squash `12518eb`, MERGED + LIVE) — servability-gated retry chips on period-coverage refusals (single floor period, or the clamped working sub-range for a range ask); #134(b) adds the too-old `not_published` case (earliest-served floor via a new `run.ts earliestAvailablePeriod` + a too-old-vs-mid-gap classification; mid-gap stays prose), pinned end-to-end by a seeded-gap test; ADR [029](decisions/029-follow-up-suggestion-chips.md) second + third + fourth as-built notes · **#73 v2 (session 72, 2026-09-03, autonomous per #118(b), branch `feat/73-v2-click-take-chips`; PR #122 MERGED + LIVE 2026-09-03, session 75, owner-approved in chat, squash `4fd6ea5`): every follow-up chip is a zero-LLM click take on the WP26 chip carrier — ADR 029 v2 as-built note (the first note in that file)**

The owner's "give users ideas, provoke the next question" ask = brainstorm #73, previously deferred until suggestions could be SERVABILITY-backed. **Design: ADR [029](decisions/029-follow-up-suggestion-chips.md); literal execute brief: [session-briefs/2026-07-08-follow-up-chips-brief.md](session-briefs/2026-07-08-follow-up-chips-brief.md).** Four deterministic generators (adjacent period / trend / region variant / same-table topic) over the answered intent + registry, every chip gated through the `echoServability` dry-run (the recorded #73 blocker, now the design's core rule), max 3, zero LLM, zero prompt bytes, `suggestions` as a structural envelope field (R8 `text` byte-untouched). v1 click = FILL the input (the #75 convention, #82 cost line stays the money surface — no new charged entry point); v2 = the WP26 Mechanism-A handler swap once that ships (designed-in seam). *(➡ v2 BUILT session 72, 2026-09-03 — not as a handler swap: each takeable chip is minted as a `ClickOption` on the #197 chip carrier, so a click is the WP26 take; the handler is unchanged. PR #122 merged 2026-09-03, `4fd6ea5`.)* Independent of WP27/WP28. **✅ Built exactly per the brief (as-built record in ADR 029): `src/answer/respond/suggestions.ts` + envelope field + chat.tsx chips; 12 new backend tests + 2 web tests; full gate green (backend 1000/1000, web 195/195, benchmark 14/14 + 6/6 + 0 fabricated PASS); adversarial review 3 heavy lenses clean, 1 test-gap closed mutation-verified. **MERGED + DEPLOYED — LIVE (owner-approved in-chat merge `0c4b324`, main gate + deploy green).** Follow-up chips now render under live answers; click fills the input (#75).**

## #128 — thumbs up/down answer feedback (not a numbered WP; owner-confirmed small standalone, BEFORE WP26)  ✅ MERGED + DEPLOYED — LIVE (2026-07-12, PR #28 merge f13fc39); migrations 016+017 APPLIED same session (A1 re-verify → #133)

Built per the frozen brief ([session-briefs/2026-07-12-wp128-brief.md](session-briefs/2026-07-12-wp128-brief.md), incl. as-built deviations) and the [open-questions #128](open-questions.md) spec: migration 017 (FILE — applies with 016 in the RUNBOOK's supervised window), the guarded write-only store, the fail-soft free server action, FeedbackButtons in the chat, GDPR hard-delete interplay inside the redaction transaction. Both adversarial review rounds ran (35 + 23 agents). The 👎-shortlist read path is deliberately NOT built — that is WP26-lane; dashboard/onboarded-answer feedback pairs with the #117/#74 lane.

## WP129+130 — source-tags chips + web search as a separated, unverified augmentation channel (#129 + #130, owner-confirmed as ONE WP)  ✅ FULLY LIVE (session 40, 2026-07-12: PR 33 merged `e410ea2` on owner in-chat approval; supervised go-live RUN same day — migration 018 + pricing + flag + smoke tests ledger-verified both modes; tool-variant correction to `web_search_20250305` en route, ADR 032 § Go-live correction)

The most principle-touching feature to date, built on the full WP27/WP30b pattern: ADR [032](decisions/032-websearch-augmentation.md) (ACCEPTED — all ten owner decisions from the closed interview), a pre-build adversarial design review (39 agents: 7 mid-tier lenses × dual heavy-tier refuting skeptics; 16 raw → 8 confirmed / 5 split / 3 killed — headline: the triple-confirmed unrecorded-refusal R8 blocker ⟨W1⟩ and the Server-Action time-budget collision ⟨W2⟩), the [frozen executor brief](session-briefs/2026-07-12-wp129-130-brief.md) with amendments ⟨W1⟩–⟨W9⟩ folded, then the build per that brief. **What it is:** the #129 chips ("CBS data" from the source registry, pre-checked + "Internet", default off) make source selection a STRUCTURAL pipeline input riding the audit envelope; the #130 channel is a NEW self-contained LLM call (native `web_search_20260209`, `WEBSEARCH_MODEL` constant, max 3 searches, NL) rendering ≤4 cited findings under "Van het web (niet door checkdecijfers geverifieerd)" below the validated body or refusal — web findings never enter the validated body/validators/attribution/charts/context/benchmark (the separation IS the honesty model; every existing prompt byte-identical, every fixture replays). **Money:** +10 `web_addon` as its own `websearch_cost` ledger debit (migration 018, FILE-ONLY; the WP16 four-part pattern + compensation-trigger widening), reserve-before-spend inside the pipeline, settlement on the final gated object, auto-refund whenever no cited section is delivered on an audited turn; `gate.ts` + all existing ledger functions byte-untouched. Worked-out consequences flagged for the owner: web-only nets 10 (needs 30 available transiently), clarifications never charge the add-on, onboarding acknowledgments skip web entirely. **Go-live RAN session 40 (2026-07-12, owner-supervised) — now LIVE in production** (RUNBOOK as-executed: migration 018 → `pricing:apply` → `WEBSEARCH_ENABLED=1` → smoke test → orphan query; the go-live tool-variant correction to `web_search_20250305` is in ADR 032 § Go-live correction). See the ✅ FULLY LIVE heading above.

## WP30 — multi-source architecture: formalize the narrow waist (priority #2, designed 2026-07-08)  ✅ WP30a MERGED + DEPLOYED — LIVE (session 36, 2026-07-11, PR #26, merge `7864271`); ✅ WP30b MERGED + DEPLOYED — LIVE (session 37, 2026-07-12, PR #27, merge `f6bcf26`, main gate + deploy green); ✅ WP30c E1 BUILT + real-API-verified + MERGED to `main`, CI green (session 101 continuation build, Constraint 0 resolved + real captures + merge session 107, 2026-09-16/17, PR #23, merge `46527a8`/`1b23298`) — internal/flag-gated only, no public go-live, no real table registered yet — see the WP30c entry below

The "new data sources beyond CBS" architecture, designed source-NEUTRALLY (owner steer: subject scope stays "Nederland"; the concrete source is undecided). **Decisions: ADR [030](decisions/030-multi-source-architecture.md); evidence: the [audit dossier](session-briefs/2026-07-08-multi-source-dossier.md)** (3-agent code audit: the interface waist already exists — what is missing is source IDENTITY, not a rewrite). Shape: a code-level source registry as the single display/behavior authority; `Attribution.source`; prefixed table ids + an additive `source` column (NO compound-key rewrite on the live schema); adapter-boundary translation into the existing period/region grammars; per-source status/null-reason vocabularies; an executable adapter CONFORMANCE HARNESS so "add source N" becomes a weaker-model task. Stages: **WP30a** waist formalization (hermetic, every CBS answer byte-identical — pinned), **WP30b** contract + harness + how-to guide, **WP30c** the first real source (**DEFERRED by the owner, 2026-07-08 — CBS-first for now; candidates Eurostat/LISA/politie tracked in #123**; was: blocked on the owner choosing one — proposal + assessment + recommendation in [open-questions #123](open-questions.md): data.overheid.nl is a catalog, not a source; recommended first source = data.politie.nl on the StatLine-voor-derden infrastructure; ships together with the owner-signed public-claim wording change). The pre-build adversarial design review RAN session 36 (62 agents → ADR 030 amendments A1–A7 + the frozen [WP30a executor brief](session-briefs/2026-07-11-wp30a-brief.md)); **WP30a was then BUILT the same session per that brief** (source registry + Attribution.source + display consolidation incl. the refusals third-copy, migration 016 as a file, benchmark source fields, A1 R8-regression + migration + golden-pin tests; post-build diff review 11 agents → 1 confirmed stale-test blocker, fixed in-session; as-built notes in ADR 030). **WP30b (conformance harness + guide) is deliberately its OWN later session (A5).** ➡ **WP30b BUILT (session 37, 2026-07-11), the WP27 pattern in full:** its own pre-build adversarial design review (46 agents: 6 mid-tier lenses × dual heavy-tier skeptics; 20 raw → 2 confirmed / 2 split / 16 killed) froze the [WP30b executor brief](session-briefs/2026-07-11-wp30b-brief.md) (amendments ⟨B1⟩–⟨B7⟩ — biggest: the onboarding-cron route stays BYTE-untouched, seam-now/wire-at-WP30c); then built per the brief — `src/sources/conformance.ts` (families F0–F5 over per-source fixture manifests; CBS = the positive control over all 14 fixture tables; a 23-case harness-can-fail suite), `encodePeriodCode` round-trip, the A6 recall wiring (`src/catalog/current-status.ts`, registry-driven 'current' partition, shortlist byte-identical — find-replay hash pins green), the registry-driven provisional rule (`definitiveStatuses` + `isProvisionalStatus` + `sourceKeyForTableId`; run.ts's two `'Definitief'` literals gone, R8-safe by construction), `adapterFor` (CLIs only), and [docs/how-to-add-a-source.md](how-to-add-a-source.md) incl. the verified WP30c wiring landmines (catalog-prune wipe, `language='nl'` filter, compose `resolveSource(undefined)`, cron-route adapter, region-taxonomy family). Two measured as-built deviations in ADR 030 § WP30b as-built (F2 scoped to servable tables — 80416ned's 7,492 DAILY codes are a deliberate fit-gate specimen; D4 checked in BOTH directions).

## WP30c — Eurostat as the second source, phase E1: adapter + internal explorer (owner decision 2026-09-14, [open-questions #248](open-questions.md); design + pre-build adversarial review: ADR [048](decisions/048-eurostat-data-source.md))

**✅ BUILT (session 101 continuation, autonomous overnight, 2026-09-14/15) — branch `wp30c-e1-eurostat-adapter`
(PR #23), ✅ MERGED to `main` session 107 (2026-09-16/17) — see below for that merge's own account.** Frozen executor brief
([session-briefs/2026-09-14-wp30c-e1-executor-brief.md](session-briefs/2026-09-14-wp30c-e1-executor-brief.md))
per the process line below, its own second adversarial review (4 lenses, 6 confirmed findings folded in as
Amendments B1–B6), then built. A real chip-visibility gap this build found (not anticipated by either
adversarial review round) is also fixed: registering the Eurostat source alone would have surfaced a live
"Eurostat data" chip to real users — see ADR 048's as-built note.

**✅ Constraint 0 resolved + real-API verification done (session 107, 2026-09-16, resuming the same branch):**
the owner confirmed directly in chat that "no real Eurostat API spend" meant money, not any live call
(Eurostat's API is free/public/read-only). The live capture (`npm run fixtures:capture:eurostat`) found and
fixed TWO real API-shape defects the original build's disclosed uncertainty had anticipated — the Catalogue
endpoint returns tab-separated TEXT, not the JSON shape originally guessed, and the Statistics API's real
`value` field is a sparse offset-keyed object, not always a dense array. **Read ADR 048's "As-built addendum"
for the full account.** `tests/fixtures/eurostat/` now carries real, `"synthetic": false` specimens (the full
real catalog + two small real datasets — the original three demo codes turned out too large, 742K-21M real
cells, to usefully commit). Full verification: root + web typecheck clean; backend suite 165 files/2466 tests
green (solo); web suite 117 files/1854 tests green (solo); hermetic benchmark 14/14 + 6/6 + 0 fabricated
(GATE PASS); a real `next build` succeeds; `/code-review` LOW clean (1 finding — a missed stale
migration-number reference in the explorer's own empty-state copy — fixed same session). **A cross-branch
migration NUMBER collision found + fixed along the way** (`031_source_doi.sql` vs. an unrelated
`031_chart_headlines.sql` that landed on `main` mid-session): renumbered to 032/033, see ADR 048's As-built
addendum. **MERGED to `main` (`46527a8` + `1b23298`), CI green** (`gate` + `deploy`, run `35125746817`).

**✅ Steps 4-5 also done, same session, on the owner's explicit go-ahead ("apply migrations and register a
real table"):** migrations 032/033 applied to production, verified live. `eurostat:tipsbd30` registered and
synced — 532 real rows, 0 corrections. **A fourth real defect found in the process** (a genuine bug, distinct from
the Constraint-0 work): `registerTables` never wrote `cbs_tables.source` at all — every table ever
registered silently landed tagged `'cbs'`, invisible until the first non-CBS registration. Not a live-chat
safety gap (the deny gate never reads this column); a real display bug (the explorer's own query couldn't
find the table). Fixed + regression-tested (`0a5c2c8`), CI green (run `35132208250`); the one affected
production row corrected directly. Full account: ADR 048's second As-built addendum,
[#249](open-questions.md). **Still open:** `doi` was never populated (nothing sources it — [#264](open-questions.md), a separate gap); a full `/eurostat-explorer` browser click-through wasn't done (needs
the owner-supervised `EUROSTAT_EXPLORER_ENABLED` flip) — the explorer's own backing query, run directly
against the live DB, does confirm the table is now findable.

The original entry below is kept as the design record; it no longer describes the current state.

**Execute-ready (historical framing, kept as the design record — see the BUILT block above for current state).** The #123 source choice is made: Eurostat. ADR 048 is the full brief (Decision D1–D10,
Alternatives, Consequences, Assumptions, Revisit triggers) plus its own completed pre-build adversarial design
review (Amendments 1–12) — read it in full before starting; this entry is a pointer, not a restatement.

**Scope of E1 only** (E2 natural-language querying and E3 research-assistant stay unscheduled, lifted into this
doc only when the owner schedules them; the pattern-discovery track, ADR 048 D10, is a separate, later,
not-yet-scheduled track with its own future ADR): a new `src/eurostat-adapter/` sibling to `src/cbs-adapter/`
(ADR 048 D1), a registry entry + `adapterFor` line, fixture captures + a Eurostat conformance manifest, the
source-scoped catalog prune (D4's blocking pre-work), the D7 proof-panel migrations (per-dataset DOI;
`request_urls` on `ingestion_batches`, file-only pending the owner's supervised apply), and an INTERNAL,
flag-gated (`EUROSTAT_EXPLORER_ENABLED`, unset in production) explorer — pick a dataset, filter, table + chart
through the real `runQuery` → `buildChartSpec` path, CSV export, proof panel underneath, zero LLM. **The public
site must stay byte-identical** (ADR 048 D3(b) — already re-pinned by Amendment 1's fix, `058efdf`: the
pre-existing "Eurostat — coming" homepage notice that predated this rule has been removed).

**Invariants at stake:** principles (a)/(b)/(c) unchanged (D1/D6/D8); R1/R8 (every number traceable; a
reconstructed envelope untouched by the new proof fields, D7); the WP30a golden pins (every CBS answer, chart,
CSV, audit row stays byte-identical through E1). **Done-definition, per ADR 048 D9 as amended:** `npx vitest run
tests/sources` green with Eurostat as a second positive control; the new Amendment-3 test (a live NL chat
question can never surface an `eurostat:`-id result while the flag is unset); the Amendment-7 unit/region-label
check (`parseFactorUnit`/`baseLabel` against real Eurostat data, fail-open logged not silent); the Amendment-8
conformance-coverage decision for the DOI/`request_urls` fields made explicit, not left implicit; the
Amendment-12 live smoke probe confirming the 500k/5M/413 cell-count thresholds before the fit gate is treated
as final; 2–3 frozen-key verification tasks per ingested dataset; ≥ 3 real datasets rendered on the dev server;
the full verification block green; the public site byte-identical.

**Process:** per the WP27/WP30 precedent, run the FULL pre-build adversarial design review again on the actual
executor brief once one is frozen from this entry + ADR 048 (a second pass, same discipline as WP30a/WP30b got —
this ADR's own review checked the DESIGN, not a frozen line-by-line executor brief). Autonomous sessions: branch
+ PR per [open-questions #118](open-questions.md)(b) — this is core-product code. Live DDL (the D7 migrations)
and any real Eurostat API spend stay owner-supervised, never autonomous (guardrail 4 above).

## #144 — the semantic fabrication check (not a numbered WP; the shared close for the #140/#141 deterministic ceilings)  ✅ DONE END-TO-END (session 46, 2026-07-16: PR #47 squash `94b90e4` merged on owner approval AND the supervised go-live EXECUTED same session — checker LIVE + ACTIVE, fail-open + admin alert)

Built per the frozen [design brief](session-briefs/2026-07-16-144-semantic-check-brief.md); decisions in ADR [034](decisions/034-semantic-fabrication-check.md). An additive, REJECT-ONLY cheap-tier LLM checker over validated answer bodies that leaned on a residual-prone exemption (`ClassifiedToken.soft`, corpus-measured scope: 0% of stored legit bodies trigger, both proven residual shapes do). A fabricated verdict takes the same R3 ladder rung (regenerate → template); verdict stored on the envelope, recorded-not-rederived, scope re-derived by R8 (tamper-tested); checker calls tracked as `llm_calls` role `semantic_check`; wired on all three user-visible answer paths (question, reply, onboarding delivery) behind `SEMANTIC_CHECK_ENABLED` (dormant default). **Go-live EXECUTED same session (owner present; as-executed record in RUNBOOK § "#144 semantic checker"):** calibration 9/9 FP=0 FN=0 flips=0 at --repeat=3 (prompt v2 — run 1 caught an FN on the month-compound residual), replay leg on the gate, owner decision = FAIL-OPEN + ADMIN ALERT per skip (alerts.ts), env flags set, flip-deploy run 29513127181 ✓, live smoke audit row 253 `skipped_no_suspects` + audit:verify exit 0. Nothing remains on #144.

## WP135 — chat-workspace redesign: persisted conversations, right-pane visual dock, site shell (#135, absorbs WP24)

*Added session 41 (2026-07-12) after the design round + owner interview. Design + all decided choices: ADR [033](decisions/033-chat-workspace-redesign.md); this entry is the buildable summary.*

**✅ BUILT session 41 (2026-07-12, same session, owner present):** frozen brief (62-agent pre-build review → amendments A1–A7) → staged build (migration 019 file-only, `src/threads/`, workspace UI; 24 backend + 41 web tests new; full block: benchmark 14/14 + 6/6 + 0 fabricated GATE PASS, real `next build`) → 22-agent post-build review → 2 confirmed blockers fixed same session (websearch add-on in the replay credits-join; thread-switch race). **Merged to `main` on the owner's explicit in-chat instruction; dormant until the supervised go-live — **✅ go-live RUN session 42 (2026-07-13, owner present): LIVE in production** (as-executed record: RUNBOOK § "WP135 chat workspace"; logout pending-state fix `5ba3fb8` rode the go-live). Residuals: per-thread delete (deferred, ADR 033 D2); the dashboard creditsCharged fix spun off (chip task_7de27dc7).**

**Scope (five owner asks + the shell):** (1) conversation full-width until a `chart`/stat-card answer arrives, then the visual docks in a right-hand pane (conversation stays left); (2) multiple visuals → tabs, labels deterministic from the envelope, tab state derived by replay — never stored; (3) a conversation sidebar (vandaag/gisteren/afgelopen 7 dagen) + "nieuwe chat"; (4) credits chip in a new top nav; (5) WP29 chips stay — the whole message envelope (chips, feedback, source/attribution chips, provisional badge, staleness/definition/marking lines, refusal header, citation/CSV buttons, pre-send cost line, web section) renders **byte-identically**. Plus the absorbed WP24 shell: top nav (wordmark, live balance chip on the #68 pattern, "Credits kopen", account menu with relocated delete-history + a genuinely new "Log uit" server action), stripped header on `/login`, and the [#99](open-questions.md) footer (privacy link deferred, no dead links).

**Data:** migration 019 — `chat_threads` (**no text columns by design**: id, user_id, created_at, last_activity_at) + nullable `audit_answers.thread_id` (FK, no ON DELETE — the redact-not-delete posture). Thread created lazily on the first completed question; client-sent `threadId` is ownership-validated server-side (bound parameters, the ADR-021 trust-boundary treatment). Titles derived read-time from the first row's `question` — redaction of audit rows automatically empties the sidebar (fully-redacted threads are filtered out at read time; the dashboard's placeholder posture is unchanged). Retention: the existing 2-year #14 purge + self-service deletion cover threads with **zero new legs** (owner-decided, ADR 033 D2).

**Resume:** opening a conversation replays the stored `response` envelopes (R8: replayed `final_text` byte-equal), and rebuilds conversation context server-side via the existing deterministic `buildConversationContext` + ADR-021 revalidation — stale referents degrade honestly to standalone parse/clarification. Owner-decided: resumed threads accept new questions.

**Rollout:** dormant behind `WORKSPACE_ENABLED` (the WP129+130 pattern — flag off = today's dashboard byte-identical); migration 019 live DDL + flag flip only in an owner-supervised go-live step. Zero prompt bytes anywhere in this WP.

**Invariants at stake:** R2 (no free text into prompts; ids only), R8 (envelope replay byte-equality), #14/#120 (every store of question-derived text inside the redaction scope — satisfied structurally: threads store none), cross-user isolation on the NEW read paths (`listThreads`/`loadThread` — the same bound-parameter pins as the #14 deletion path), ADR 032 (the web section NEVER docks — the separation is the honesty model), ADR 006 (no hardcoded numbers in shell copy), R4 (footer is an additional echo, never a replacement for per-answer attribution), ledger untouched.

**Done means:** full verification block green (npm ci ×2, typecheck ×2, backend + web vitest, benchmark 14/14 + 6/6 + 0 fabricated — serially, exit codes checked); the byte-identity rendering pins + cross-user pins + replay pins all in the suite; flag-off byte-identity proven; docs (ADR 033 as-built, #135/#98/#99 rows, STATUS) updated same-change; PR open for owner review — **merge only on owner approval.**

**Residuals out of scope, tracked:** per-thread delete (fast-follow, #135 row); #74 "mijn aanvragen" panel + #117 live updates (their seam = behind the nav, unchanged here — **✅ landed 2026-08-27, session 66: at-a-glance line + `router.refresh()` poll inside `QuestionHistory`, so both the `/geschiedenis` surface and the flag-off Dashboard have it; see the #74/#117 rows**); #53 guest-mode shell variant; a real table renderer (would dock by the same rule).

---

## WP24 (working number) — site shell: header, footer, logout — ✅ ABSORBED INTO WP135 (owner decision, session 41, 2026-07-12; ADR [033](decisions/033-chat-workspace-redesign.md) D6) — do not build separately

*Placeholder (added 2026-07-05/06, session boundary) from the [UX design brief](10-ux-design-brief.md) — full reasoning and evidence there; this entry is the buildable summary. Superseded by WP135 above: the workspace's top nav IS this header (credits-in-nav was WP24's balance chip), and the #99 footer ships with it (privacy link deferred until #14(d) exists). Kept below for the original scope reasoning.*

**Scope:** a new `web/components/site-header.tsx` (wordmark linking to `/`, live balance chip reusing the existing `getBalance`/#68 pattern, "Credits kopen" link, and a genuinely new "Log uit" action — a server action wrapping Supabase sign-out, redirecting to `/login`; there is currently **no sign-out affordance anywhere in the app**, verified by grep) rendered by each authenticated page (`/`, `/credits`) exactly like today's per-page `currentUserId()` guard — not centralized into `layout.tsx`. A stripped header (wordmark only) on `/login`. A new site-wide footer added directly to `web/app/layout.tsx` (no data dependency, so it costs nothing structurally): one line carrying the CBS/CC BY 4.0 attribution + a privacy link (target TBD, see below) + an "over dit project" link.

**Blocked on exactly one thing:** [open-questions #99](open-questions.md)'s draft footer copy needs owner sign-off (approve as-is, edit, or reject) — the header has no open product question and can be built regardless. [#98](open-questions.md) (homepage-vs-dashboard IA) does **not** block this WP — the brief's Option A (recommended) requires zero change to today's `/` route; only Option B would reshape this WP's scope, and only if greenlit later.

**Invariants at stake:** ADR 006 (no price/number literals in copy — the balance chip reads live, never hardcoded); R4/CC BY (the footer is an ADDITIONAL site-level echo, never a replacement for the existing per-answer inline attribution, which stays exactly as detailed as it is); zero pipeline/schema/LLM change (this is 100% display-layer); the privacy link either points nowhere yet (omitted) or to a placeholder — never a broken promise implying #14 is already built.

**Done means:** full local gate green (typecheck both sides, all backend suites unaffected since nothing outside `web/` changes, web tests, real `next build`); tests for the logout action, the header's presence/absence rules (stripped on `/login`), and the footer's static content; adversarial review per the house rule; #99 marked built in open-questions; STATUS updated with measured results.

---

## WP26 (working number) — end the paid dead-end: clickable pre-verified clarification options (#66) + answer-first for structural defaults (#72)

**▶ STATUS 2026-07-25 (session 56): WP26 IS COMPLETE — A + B-region + B-period + WP26c built, pushed, CI green — DORMANT behind two flags, awaiting only the owner-supervised go-live.** Commits `8ee71c8` (A), `37a3c55` (B-region), `1a99b3d` (B-period), `1a4ca89` (WP26c). Owner read-back done in-chat this session: safelist approved unchanged, take-path **A2** chosen over A1, WP26c in scope. As-built detail (including three measured corrections to the execute-brief) lives in ADR [024](decisions/024-answer-first-defaults-and-clickable-options.md); the R7 third branch is now written into [05-data-rules.md](05-data-rules.md) as the ADR required. Zero prompt bytes, zero pricing change, no DDL, **€0 LLM spend** (the €5 plan / €10 cap was not needed — nothing here required a live model).

**Go-live — ✅ DONE: `CLARIFY_CLICK_ENABLED=1` 2026-09-02 (session 69) + `ANSWER_FIRST_ENABLED=1` 2026-09-03 (session 71), both smoke-tested by the owner (RUNBOOK). Original procedure:** set `CLARIFY_CLICK_ENABLED=1` and/or `ANSWER_FIRST_ENABLED=1` (independent; either can go first and roll back alone), then the §7.4 go/no-go smoke from the [execute-brief](session-briefs/2026-07-19-wp26-execute-brief.md). Flags unset = byte-identical to pre-WP26, pinned by neutrality tests.

**▶ ✅ BUILT (session 56, 2026-07-25) — all four mechanisms, LIVE since 2026-09-02/03 behind `CLARIFY_CLICK_ENABLED` and `ANSWER_FIRST_ENABLED` (both flipped by the owner, sessions 69 + 71); the owner-supervised flag flip no longer remains (RUNBOOK "WP26 answer-first + clickable options"). The re-sequencing note below is the HISTORICAL reason it waited, not its current status. ▶ Re-sequenced (owner, session 23): tier-3.** The owner set data coverage as priorities #1 (WP16 on-demand fetch) and #2 (new sources); WP26 is the tier-3 answer-quality item — safelist settled and ready to build, but sequenced **after** the data work.

*Owner-chosen (Stefan, 2026-07-05, session 23): build [#72](open-questions.md) and [#66](open-questions.md) **together as one WP**. Full design, the principle-(c) line, the safelist, and the deferred-pricing decision are in ADR [024](decisions/024-answer-first-defaults-and-clickable-options.md); this entry is the buildable summary. (Historical framing — see the STATUS block at the top of this section: WP26 was BUILT in session 56.) The direction is blessed; the **safelist was read back + settled by the owner in session 23 (ADR [024](decisions/024-answer-first-defaults-and-clickable-options.md) status line: B-region kept as-is, B-period upgraded to "recent trend", entity-collision cases stay-a-clarification-with-buttons; pricing stays deferred, #101)** — WP26 awaited only its supervised build, which ran in session 56; what remains is the supervised GO-LIVE (flag flip + smoke), not any owner decision about scope.*

**Why:** first real usage produced the recurring "paid dead-end" — a clarification charges 10 credits (measured, [gate.ts](../src/billing/gate.ts); an answer is 20, a refusal 0), the user replies, and the reply dead-ends in `still_ambiguous` — *"net 10 for nothing"*. Two independent root causes (code-verified in `policy.ts decide()` / `resolve.ts`): (1) we clarify when a canonical structural default exists; (2) when we do clarify, free-text replies ("Beiden", "Jan modaal inkomen 2024") fail the second LLM re-parse.

**Mechanism A — clickable, pre-verified options (#66):** each clarification option carries a **resolvable intent** (a full `StructuredIntent` for the rule-4 readings and the #56 echo suggestion; an `{axis,value}` patch on the pending partial intent for region presets), attached **only if it passes the existing `echoServability` dry-run**. The UI (`chat.tsx`) renders them as clickable chips. **AS BUILT (session 56 — the owner chose take-path A2 over this paragraph's original A1): there is NO new entry point.** `respondToClarificationReply` gained a deterministic first rung — a reply byte-equal to an offered label takes that option's stored intent and runs query → answer **with no LLM call**, so a click can never dead-end, and a TYPED reply that happens to equal an option is rescued too. Free-text that matches nothing stays the fallback (today's merge, unchanged). Options carry full resolved intents only; the `{axis,value}` patch idea was dropped as unnecessary. This *reduces* the R2/injection surface (no free text re-fed to the model) at the cost of one client-held payload, which is re-validated fail-closed on the way back.

**Mechanism B — answer-first for structural defaults (#72), narrow safelist:** answer with a disclosed default instead of clarifying, for structurally-determined readings only —
- **B-region:** no region named on a geo measure that has a national row → serve the national total, with a deterministic in-sentence `assumptionLine` (*"Dit is het landelijke cijfer voor heel Nederland."*) + a correction chip. Replaces the current query-layer missing-region refusal. **Assumption (dry-run-verified at build):** the measure has an NL-level row; if not, it falls back to clarify.
- **B-period (owner decided session 23 — the recent TREND, not a single value):** a genuine `none`/`period_missing` → a bounded recent trend (a gap-free series up to the freshest period at the measure's natural grain, the existing line chart), disclosed (*"het verloop over de afgelopen jaren, t/m {laatste periode}"*) with correction chips *"alleen het laatste cijfer"* / *"een andere periode"*. Degrades to a single value when only one period is loaded. Window N a build detail (proposal: last ~10 years / full loaded range if shorter). Reuses the `since`/`last_n` machinery — still zero prompt bytes.
- **NOT defaulted (stay clarifications, now clickable):** `region_ambiguous` (Utrecht gemeente vs provincie), rule-3 below-threshold single reading, rule-4 two materially-different readings, `unknown_canonical_key`, out-of-slice/composite regions. These are R7's existing "never a best guess" cases and stay that way.

*(⚠ As built, session 56: both B bullets above ship their **correction path as the disclosure sentence's second half, not as a chip** — a chip that fills the input with an instruction would be SENT as a question. Deviation recorded + reasoned in ADR 024's as-built notes; the information and its placement are unchanged.)*

**The line that keeps it honest (ADR 024 decision 2):** default only when the fallback is a *canonical, structurally-determined reading* (national aggregate / freshest period), (a) servability-checked, (b) disclosed in-sentence by deterministic code (an `assumptionLine` built exactly like `definitionLine` — non-optional in the answer schema, LLM cannot drop it), (c) paired with a pre-verified correction chip. Never a confidence-scored pick among competing entity/definition readings.

**Invariants at stake:** **R7** — this amends R7's user-facing-ambiguity policy (adds the third narrow branch); R7's row + the "Ambiguous intent"/"Still ambiguous" failure-table rows in [05-data-rules.md](05-data-rules.md) are edited **in the same change as the code**, with B15/B16 extended (not replaced) to pin that the non-safelisted classes still clarify. **Principle (c)** — the safelist IS the (c) judgment. **R1/R3/R9/R10** — a defaulted answer shows only verbatim cell values; the `assumptionLine` is deterministic non-numeric text; the value stays bound to NL + its stated period. **R8** — the per-option resolved intents must be in the audit record so a clicked resolution reconstructs from the row alone; a clicked answer re-verifies without a second LLM call. **#38** — defaults never create cross-product intents. **Zero prompt bytes** (like #64: all logic over data the pipeline already produces — no `prompt.ts`/`schema.ts`/`parse.ts` change, no fixture re-record, no live-LLM spend).

**Build prerequisites — a SUPERVISED build (go-live needs env flips + the safelist read-back), but NO live DDL:** the 2026-07-18 design
marathon resolved the open assumption — `audit_answers.pending_clarification` is jsonb (migration 004), the per-option intents ride the
existing column. **The execute-ready plan is [session-briefs/2026-07-19-wp26-execute-brief.md](session-briefs/2026-07-19-wp26-execute-brief.md)**
(corpus grounding, safelist read-back doc, the A2-vs-A1 take-path read-back item, the severable WP26c rescue-chip sub-part, calibration
protocol plan €5 / cap €10, test plan + flag rollout); build from that brief, not from this summary alone.

**Pricing — DEFERRED (owner decision, session 23): WP26 changes no cent-logic.** A defaulted answer flows through `gate.ts` as a normal `answer` (20); a clicked resolution likewise. Already a win: an ambiguous-region question that costs *clarify 10 + answer 20 = 30 over two rounds* (or 10-for-nothing when it dead-ends) becomes **one 20-credit answer**. Two optional sweeteners recorded for the owner ([open-questions](open-questions.md), new rows): (i) discount a *defaulted* answer below `simple`; (ii) price a *clicked, LLM-free* resolution cheaper (~5, respecting the ledger `clarification ≤ simple` CHECK). Both independent config/ledger changes, decidable anytime before launch.

**Done means:** full local gate green (backend suites + hermetic benchmark + web tests + typecheck both sides + real `next build`); new frozen-key benchmark cases (geo-no-region → national with the disclosure line + chip; a clicked rule-4 option → the picked reading, reconstructible without a second LLM call; the `none`-period default if B-period survives owner read-back); B15/B16 extended to pin the non-safelisted classes still clarifying and that no default path emits an unbound numeric token; audit reconstruction (R8) re-verifies a clicked answer from the row alone and the new `assumptionLine` re-derives byte-identically; adversarial multi-lens review per the house rule; R7 text + failure-table rows amended in the same change; #66/#72 marked built and the two pricing sweeteners recorded; STATUS updated with measured results; CI green, watched to completion.

---

---

# Briefs written by the 2026-07-05 overnight session (queue items 5–6) — build nothing here without the named prerequisite

## WP25 (working number) — #65 durable error logging  ✅ BUILT 2026-08-27 (session 66, autonomous); MERGED 2026-08-28 (session 67, PR #110, `5cccaa3`) — hermetic, live apply still supervised

> **✅ Built per this brief (2026-08-27, session 66), together with the #114 health route; merged session 67.** As-built:
> migration `024_error_log.sql` (FILE-ONLY until the supervised apply — [RUNBOOK](RUNBOOK.md) "migration
> 024" step), `src/db/error-log.ts` (fail-open `logError` + the 90-day retention primitives; the brief's
> suggested 90 days adopted as the default, [#65](open-questions.md)), `web/lib/error-report.ts` +
> catch-site writes in both chat actions, the Stripe webhook, the auth callback and the #114 health
> route, and an error_log leg in `runRetentionPurge` (honest `table-absent` skip pre-apply). Deviations
> from the literal brief, documented in the migration header: `context` NEVER holds question text (the
> brief's "never by default" hardened to structural — the table has no redaction machinery, so it must
> never need it), and a non-uuid request id lands in `context` rather than failing the uuid column.
> The original brief is kept below as the design record.

*Owner-decided (2026-07-04, session 18): build. Blocked tonight by the overnight brief's no-live-DDL constraint — the design needs a new table applied to production before its code deploys.*

**Design (decided here so the supervised session can execute immediately):** a new `error_log` table via numbered migration (next free number at build time): `id bigserial`, `occurred_at timestamptz default now()`, `source text` (the catch site: 'askQuestion' | 'replyToClarification' | 'stripe-webhook' | 'auth-callback'), `request_id uuid null` (the client idempotency key when one exists — joins to ledger/audit when the failure happened mid-flight), `user_id uuid null`, `message text` (error message), `stack text null`, `context jsonb null` (bounded, structured — never raw question text by default: GDPR posture; the audit record already stores questions under its own retention). INSERT-only from the app (no UPDATE/DELETE grants; a structural trigger like the ledger's is overkill for logs — row-level security + owner-only access suffices, decide at build). Write sites: the catch blocks in `web/app/actions.ts` (both actions), the Stripe webhook route's catch, the auth callback. **Fail-open on logging failure** (a broken logger must never break the product path — the reverse of the audit store's fail-closed rule, deliberately: R8 withholds answers, error logging never does). Retention: owner decision at build (suggest 90 days, a scheduled purge alongside the #14 job). Access: owner-only via SQL/dashboard; no UI in v1.
**Invariants:** zero pipeline change (catch-site instrumentation only); no prompt bytes; the fail-open rule test-pinned (a throwing logger stub must not change the action's outcome); migration hermetically tested via PGlite in CI before the supervised live apply (RUNBOOK per-migration check: zero anon/authenticated grants).
**Why a migration is required:** Vercel log retention measured too short for root-causing (live incident 2026-07-04, #65's origin: a production error left zero trace).

## #14 GDPR retention + self-service deletion  ✅ done 2026-07-05 (code-only/hermetic session)

*Reprioritized to do-now by the owner (Stefan, session 23, 2026-07-05): "zet dat maar vooraan in ons plan." This was code-only, no new schema, built and verified entirely hermetically (no live database writes, no prod migration, no real purge run, nothing committed by the building session — left for owner review per the session's hard constraints). Owner decisions taken as given going in: **2-year retention** (session 18); **one click + an inline confirmation step, not a typed-word confirmation** (session 23); **history shows a "verwijderde vraag" placeholder row, never hides it — the credit amount stays, the question text goes** (session 23) — this last point reverses the brief's earlier "hide vs show, decide at build" framing below.*

**What was built, and the one load-bearing deviation from the brief's literal SQL:** both pieces live in `src/answer/audit/retention.ts`, called by `scripts/gdpr-purge.ts` (`npm run gdpr:purge`, dry-run by default, `--apply` to run for real) and by `deleteMyQuestionHistory` (`web/app/actions.ts`, `getClaims()`-verified, wired to a "Verwijder mijn vraaggeschiedenis" button in `AccountPanel` via a new `DeleteHistoryButton` client component). The brief's SQL sketch was a literal `DELETE FROM audit_answers ...`; **building it exposed a real structural blocker the brief hadn't traced**: `credit_transactions.audit_answer_id` carries a plain FK to `audit_answers(id)` with no `ON DELETE` clause (migration 005 — deliberately not cascade, "the real tension between GDPR erasure and an immutable financial trail is left open on purpose"). Any clarification/refusal row a compensation entry references (which is most of them — `gate.ts` compensates every non-answer outcome) throws a foreign-key violation under a hard delete, confirmed empirically before writing any product code. The fix is also a strictly better match for the owner's placeholder-row decision: **both paths REDACT (`UPDATE`) rather than physically delete** — `question`/`final_text`/`response`/`reply_text`/`pending_clarification` are overwritten with a fixed sentinel (`REDACTED_QUESTION_TEXT`), so the row, its id, and its ledger join all survive untouched; only the question/answer text is gone. No schema change either way.

1. **Retention purge (a):** `purgeExpiredQuestionHistory(db, cutoff)` redacts every `source_tag='user'` row with `created_at` before the cutoff (`twoYearsBefore(now)`); benchmark/validation rows are excluded by the same `source_tag` filter the rest of the codebase already uses (WP13, #44) — no separate user_id check needed. Idempotent by construction (redacting an already-redacted row rewrites the identical sentinel).
2. **Self-service deletion (b):** `deleteUserQuestionHistory(db, userId)` redacts every `source_tag='user'` row for that user, any age. *(Session 90, 2026-09-09: a per-thread twin, `deleteThreadQuestionHistory(db, userId, threadId)`, backs the sidebar's ⋯ "Delete chat" — same redaction, same bound-parameter scoping, plus `thread_id`; see docs/05-data-rules.md's GDPR section.)* THE CRITICAL SECURITY PIN: `web/app/actions.ts`'s `deleteMyQuestionHistory` takes no id parameter at all — the user id comes only from `currentUserId()` (`getClaims()`), so there is no code path that could touch another user's rows. Confirmation UX: click "Verwijder mijn vraaggeschiedenis" → an inline red confirm box ("Weet je het zeker? ... Dit kan niet ongedaan worden gemaakt." + "Ja, verwijder" / "Annuleren") → only the second click calls the server action; success reloads the page (`window.location.reload()`, the same convention `chat.tsx`'s stale-deploy button already uses — no `next/navigation` router dependency, so the component drops into the existing `AccountPanel`/`Dashboard` render trees without needing a router-context mock).
3. **Ledger interaction (c) — resolved as "redact, never hide":** `credit_transactions` is never imported by `retention.ts`, so neither path can write to it, structurally. The dashboard (`src/billing/history.ts`'s `getQuestionHistory`, `web/components/question-history.tsx`) gained an `isDeleted` field, computed once (a redacted row's `question` matches the sentinel exactly) so the UI never needs to know the redaction mechanism. A redacted row — including either half of a WP19 #67 collapsed clarification round — renders as "Verwijderde vraag" with the credit total still shown and an honest "De tekst van deze vraag is verwijderd." expansion; a round with one redacted side degrades to that placeholder without losing the still-valid credit sum.
4. **Privacy policy (d):** still not built — deliberately out of scope here, per the original brief.

**R8 amendment, made (docs/05-data-rules.md audit-trail section):** "these records live forever" now explicitly splits by `source_tag` — `benchmark`/`validation` rows still live forever (engineering fixtures, not personal data); `user` rows are retained 2 years and are self-service deletable, both via redaction. R8's WRITE path is untouched — retention/deletion governs data after the fact, never the write-before-show guarantee.

**Tests (hermetic, `tests/audit/retention.test.ts`, 14 tests) + `web/components/delete-history-button.test.tsx` (5) + `question-history.test.tsx` additions (4):** deletion-scoped-to-user (the critical security pin — another user's row survives byte-identical), ledger-untouched (both a real gate-driven compensation's ledger rows and a plain purge leave `credit_transactions` byte-identical), purge/deletion scoped to `source_tag='user'` (a benchmark/validation row for the SAME user id survives both), purge-idempotent (a second run redacts nothing new), the FK-violation-on-hard-delete proof (documents WHY redaction was chosen), the `reply_round_complete` pairing constraint surviving redaction, and the placeholder UI (button two-stage confirm, dashboard placeholder rendering, no leaked sentinel text). **Full local gate green:** 714 backend tests (700 pre-existing + 14 new in `tests/audit/retention.test.ts`), 135 web tests (126 pre-existing + 5 new `delete-history-button.test.tsx` + 4 new placeholder-rendering cases in `question-history.test.tsx`), benchmark 14/14 + 6/6 + 0 fabricated (untouched), clean typecheck both sides (a pre-existing, unrelated `scripts/run-experience-audit.ts` break — confirmed present on a clean `main` via `git stash` before this WP touched anything, flagged as its own follow-up task rather than fixed inline here to keep this WP's diff scoped — was independently fixed and merged to `main` by a concurrent session partway through this one; re-verified clean after that merge), real `next build` green. **Not measured this session (by design — hermetic-only, no live DB writes, no commit/push):** an actual `--apply` purge run against production and its real row count. **✅ That follow-up owner-supervised step is now DONE (2026-09-05, session 78):** `GDPR_PURGE_APPLY=1` set in production, one live `--apply`-equivalent run triggered via the `/api/gdpr-purge-cron` route, 0 rows redacted/deleted (matching the hermetic dry-run exactly — see [#189](open-questions.md)).

## Phase-2-shaped design brief — the source drill-through cluster (#70 + #79 + #89 + #90-deep)

**✅ BUILT session 72 per the 2026-09-03 design brief; review round 2 by the parallel cloud session 74; PR #123 MERGED + LIVE 2026-09-03, session 75, owner-approved in chat, squash `ddca024`** (the defaults — label, inline disclosure, ids behind a toggle, collapsed — stand, veto by exception). Brief: [session-briefs/2026-09-03-source-drill-through-design.md](session-briefs/2026-09-03-source-drill-through-design.md). Shipped exactly as the brief below describes — one "Bewijs dit cijfer"/"Bewijs deze cijfers" panel, collapsed by default under the answer, depths 1→2→3 stacked, ids behind one "Technische details" toggle — in `web/lib/answer-proof.ts` (`buildAnswerProof`, the pure leaf) + `web/components/answer-proof.tsx` (`AnswerProof`), wired into `web/components/chat.tsx` beside the citation/CSV row. No backend/pipeline change, zero prompt bytes, zero DDL, no flag. See [open-questions #70](open-questions.md)/[#79](open-questions.md)/[#89](open-questions.md) for the per-depth detail. **Out of scope (unchanged by this build):** dashboard history has no proof panel yet — tracked as its own residual row in [open-questions.md](open-questions.md).

*All four approved individually; the batch notes and #90's row say they are ONE design (three buttons would be three ways to say "show me the proof"). #90's chip PRESENTATION shipped in WP23 (the chip is the collapsed state); this brief is the expansion.*

**One surface, three depths, all deterministic reads of data every answer already carries:**
- Depth 0 (SHIPPED as WP23's chip): the attribution sentence + "Bekijk bij CBS StatLine" (#86).
- Depth 1 (#89 "waarom dit antwoord"): expanding the chip shows the chosen `definitionLabel`, `periodSemantics`, and the not-chosen alternate readings with their own labels. Data: `Attribution` + `Attribution.alternates` — **the #39 threading was BUILT 2026-08-27 (session 66): alternates ride the attribution and a plain-text `alternatesLine` disclosure already renders; #89 upgrades that plain line to the clickable affordance, no new computation.**
- Depth 2 (#70 drill-through): per displayed number, the exact cell: table id, measure code+title, full coordinates (region/period/dims with labels), sync date, batch id, CBS status. Data: `ResultCell` — already client-side (WP20/21 proved it).
- Depth 3 (#79 "bewijs dit cijfer"): the followable step list — every applied derivation (R5 records: kind, source cells, value) + null/suppressed-cell notices, rendered as "wij lazen cel X (waarde A) en cel Y (waarde B); verschil = B−A". Data: `DerivationRecord[]` verbatim; the CSV export's `cel-id` column is the same trace in file form.
**Design decisions for the owner at the design session (#29 adjacency):** whether depths open inline (accordion under the answer) or in a side panel; whether depth 3 shows OUR internal resultId strings or only human labels (recommend labels + a "technische details" toggle); copy tone. **No new backend needed for any depth — the #39 alternates threading depth 1 needed shipped 2026-08-27 (session 66).** Every rendered value at every depth is a verbatim envelope field — zero new number sources (R1).

---

## #53 anonymous-trial page — ✅ BUILT AND LIVE (session 52, 2026-07-17, `9317acb`, ADR [036](decisions/036-anonymous-trial-pot.md))

> **⚠ The brief below is SUPERSEDED and kept only as the design record.** It reads as though the
> feature is unbuilt and its open questions are unanswered; they were answered by ADR 036 and the
> trial has been live on `/` since 2026-07-17 (pot ops via `npm run trialpot:set`). Do not treat
> anything below as an open decision — check ADR 036 and [STATUS.md](STATUS.md) first.

The overnight brief allows building #53 only if every product decision is already recorded. #53's row
explicitly records the OPPOSITE: "Not yet designed: the isolated-budget mechanism itself … and the
per-visitor tracking method". Trial size ("2 free questions") is an idea in the row, never a decision;
copy is unrecorded. → Full brief below; owner picks at the decision points.

**WP-shape:** a separate route (`/probeer`), NOT the account-gated `/` (the #47 decision stays closed:
this page must be unable to touch the main product's spend).
- **Isolated budget (owner decision needed):** (a) second Anthropic API key with its own hard spend cap —
  strongest isolation, one more secret to rotate (RUNBOOK entry), the cap is enforced by the provider;
  (b) app-level counter (a `trial_usage` table + daily cap constant) — no new key, but OUR code is the
  only wall. RECOMMEND (a) + a modest app-level daily counter as belt-and-suspenders; the provider cap
  is the one wall a code bug can't breach (matches the product's fail-closed posture).
- **Per-visitor limit (owner decision needed):** cookie (trivially bypassed, zero friction) vs
  IP-bucketed (NAT/campus collateral) vs both-soft. The row itself accepts bypass as tolerable because
  the blast radius is capped by the budget — RECOMMEND cookie + IP-bucket soft cap, framed as
  friction-not-security; the BUDGET is the security.
- **Trial size:** the row's original idea = 2 free questions/visitor. Needs confirming as THE number.
- **Copy:** needs owner voice; must state the limit up front and the account path ("2 gratis vragen —
  daarna gratis account met 100 credits") — numbers from live config, never hardcoded (ADR 006; the
  signup-grant read already exists).
- **Pipeline:** the full ordinary pipeline (a trial answer is a REAL answer — same invariants, R8 audit
  rows with a `source_tag='trial'`? → needs a source-tag enum addition (migration!) or reuse 'user'
  with null user_id; RECOMMEND a 'trial' tag value = one-line migration, keeps reporting clean →
  ANOTHER reason this waits for a supervised session: live DDL).
- **No login, no ledger:** the billing gate is bypassed on this route by construction (no user);
  the budget isolation substitutes for it. The gate module stays untouched.

## #87 historical-range chip — BRIEF, not built (fails the "cleanly testable small chip" bar for a reason the row doesn't mention)

The derivation itself (min/max/rank over a series) IS cleanly testable under the hermetic gate. What
the row understates: **for a single-value answer the required series is not fetched** — the query
layer fetches exactly the asked cells, so "laagste sinds 2015" under a 2026-answer needs a FETCH-WINDOW
design decision first:
  (a) silently widen every single-cell query to its full loaded series (cost trivial locally, but the
      audit row then stores cells the user never asked about — a shape change to R8 rows worth a
      deliberate call, and 'fetch what was asked' minimalism dies quietly);
  (b) opportunistic: show the chip ONLY on answers that already carry a series (series/comparison
      results) — cheap, honest, but the row's headline case (a chip under a SINGLE number) mostly
      won't trigger;
  (c) a second, explicit targeted query for the chip (new query-layer entry point, pre-registered
      derivation over its own fetched cells — clean, more surface).
RECOMMEND (c), briefed as its own WP: new DerivationRecord kind ('series_extremes': min/max cell ids +
values + since-boundary), R5-registered, R1-scan acceptance via the derivation record, deterministic
chip template (no LLM), benchmark-style pins over the fixture DB. Owner sees the (a)/(b)/(c) fork
before build — it changes what audit rows contain, which is his product's proof artifact.

## #197 — chart UX for end users (owner request, session 69, 2026-09-02) — steps 1+2 ✅ BUILT + LIVE, step 3 ✅ MERGED + LIVE (2026-09-03)

Not a numbered WP: an owner-initiated research → build thread. The brief IS the spec:
[session-briefs/2026-09-02-session-69-chart-ux-research.md](session-briefs/2026-09-02-session-69-chart-ux-research.md)
(8 ranked ideas, a build order, 10 owner decisions with leanings — GO given in-chat, leanings taken as
defaults the owner vetoes by exception; as-built record in [open-questions #197](open-questions.md)).

- **Step 1 ✅ `da47566`** — numbers on the chart (axis min/max, end-of-line, per-bar labels; spec strings
  only, bound via `data-label-for`), colour-blind-safe `--series-1..4` palette + dash patterns (**superseded
  session 87: Recharts' own stock palette, dash patterns dropped — [12-huisstijl.md](12-huisstijl.md)**) + hatched
  provisional bars, accessible name + announced tooltip, tap-to-pin on touch, menu-button semantics on the
  download menu, computed-paint inlining in the export (the #170(3) export was blank outside the page),
  toggle as a radiogroup, `schemaVersion` guard in `chart.tsx`, ADR 014 as-built rule for optional v1 fields.
- **Step 2 ✅ `1d2140f`** — Grafiek/Tabel switch on every chart (`tableModel`; > 15-series comparisons open on
  the table). No duplicate CSV entry in the menu (WP21's button already sits under every chat answer).
- **Step 3 ✅ BUILT (session 70, 2026-09-02) on branch `feat/197-3-comparison-chips`, MERGED 2026-09-03
  (session 71) as squash commit `83f790e` (PR #118), CI run 33699880673 gate + deploy green — merged only after
  the owner.s `CLARIFY_CLICK_ENABLED` smoke test passed in production (RUNBOOK "WP26 answer-first + clickable
  options", step 4: audit rows 261/262 — a clarification with two click options and the click-taken answer,
  `parse.model = deterministic/wp26-click-option`, zero tokens, `audit:verify` 2/2 clean).** The chips reuse
  exactly that take-path. What shipped: two comparison generators
  in `src/answer/respond/suggestions.ts` — "Vergelijk met Nederland" (the answered regions + the national row) /
  "Vergelijk met Amsterdam, Rotterdam, Den Haag en Utrecht" (a national answer + the G4), and "Vergelijk met
  <a year earlier>" (the registered `difference` derivation) — ahead of the region variant, which is skipped
  once a comparison surfaced. Each chip rides a `ClickOption` on a present-only `AnswerResponse.pending` (the
  WP26c chip-carrier shape, `rescueOnly`); a click is taken through the zero-LLM `templateOnly` take-path as a
  NEW validated result at the normal reply price (20 credits, the brief's leaning). Flag-gated: off ⇒ the
  pre-#197 chips and no `pending` key. Invariants held and pinned: R1 (every cell traceable), R6 (never a client
  merge), principle (c) (no national row → no compare chip; the dry-run decides — stub-pinned). **Deviation
  (default, veto by exception): no "Sinds 2008" chip** — an answer carries no loaded-slice floor and the module
  never sees the database, so a "since" year would be a guess; the trend chip already offers a proven window.
  As-built detail: ADR 029 (first as-built note) + ADR 024 (last addendum).
- **Idea 4 (trend headline) BUILT** (sessions 80-81, 2026-09-05) — see [open-questions #197](open-questions.md)
  and [ADR 014](decisions/014-chart-spec-v1-and-renderer.md)'s as-built notes for the full record; PR #6 open,
  not yet merged (autonomous session + core-product code, #118(b)). **The number half of "Wat zie ik hier?" —
  the sentence's own leading idea 4 always described a headline sentence PLUS a number-bearing takeaway, only
  the sentence half shipped in sessions 80-81 — is now BUILT (session 103, 2026-09-15, chart-card polish,
  Tasks 1-4 of [superpowers/plans/2026-09-15-chart-card-polish.md](superpowers/plans/2026-09-15-chart-card-polish.md),
  built autonomous (#118(b)), independently code-reviewed (2 findings fixed), MERGED + LIVE (`f733db7`)
  on the owner's explicit instruction, owner present):** `headlineFigure()`
  (`web/lib/chart-headline.ts`) selects the last plotted point of a single time series and renders it large
  above the chart, the trend sentence moved directly under it. **Ideas 6 (series legend) + 8 (small
  multiples) BUILT + MERGED + LIVE** (session 79, 2026-09-05). Idea 5 (revision history) still needs a migration
  (owner-supervised), unscheduled. Idea 7 unscheduled.

## WP202a — "Eigen data" attachments: chat with your own data + charts (ADR 037, #201/#202)

Owner idea (session 79, 2026-09-05) → brainstormed + designed + adversarially reviewed + owner
read-back, all same session (84, 2026-09-06) → build started same session. Full design + the
7-lens adversarial review + every "Fixed in review" correction:
[session-briefs/2026-09-06-chat-with-data-design.md](session-briefs/2026-09-06-chat-with-data-design.md).
Accepted decision record: [ADR 037](decisions/037-user-data-attachments.md). The two owner
decisions that shape this WP: **(H1)** the LLM only ever emits a structured, validated
instruction — deterministic code alone renders the chart from the user's stored data; **(H2)** a
user-data chart must be visibly/structurally impossible to confuse with a CBS chart. Product copy
is English throughout (open-questions #206), a departure from this file's other Dutch-copy WPs.

**Backend is fully built and tested; nothing is live.** Five slices, each with its own full
verification block + `/code-review` LOW pass (real findings caught and fixed in every slice —
see the commits for specifics):

1. **Core engine** (`1e090c3`) — `src/attachments/`: types (the `ChartInstruction`/
   `ClientChartInstruction` split that keeps LLM free-text server-only), limits, CSV/TSV ingest
   (own RFC 4180 parser — no prior art in this repo), numeric-format detection (nl/en/ambiguous),
   `DatasetProfile` construction, the closed-vocabulary validator (`instruct/schema.ts`, mirrors
   `src/catalog/rerank-schema.ts`), `execute.ts` + `chart.ts` (the only producer of
   `UserChartSpec`). Migrations 026 (`user_datasets`/`dataset_turns`) + 027 (ledger widening) —
   **FILE-ONLY, not applied to any real database.**
2. **DB/audit/GDPR** (`01840ee`) — `store.ts`, `file-store.ts` (Postgres `bytea`, verified via a
   real PGlite round-trip test, not left as an assumption), `audit.ts` (`writeTurn` — the
   delete-vs-write race fix: re-locks + re-checks dataset status as the first statement of its
   own transaction, writes NO turn at all if the dataset is gone mid-flight), `retention.ts`
   (self-service delete + per-file delete + the two-cutoff purge: 2yr for cells/turns matching
   #14, 90d for raw file bytes). Deliberately runs as its OWN transaction, not folded into
   `src/answer/audit/retention.ts`'s `redactMatchingRows` — documented trade-off, see the file.
3. **Billing** (`ce5dd5f`) — `debitDataset`/`reserveDatasetDebit` (ledger siblings of
   `debitWebSearch`), `src/billing/dataset-gate.ts`'s `chargeAndRunDataset` (the `chargeAndRun`
   pattern for the 3-kind envelope). `dataset_turn`/`dataset_ingest` prices were deliberately NOT
   in `pricing-defaults.ts` at build time — mechanism decided, exact credit amounts left open
   (§8 Q1). **✅ `dataset_turn` decided session 89 (2026-09-08, owner present, WP202 go-live
   checklist step 1): 20 credits**, now in `ACTION_CLASS_PRICES` (`478c943`) — see
   [09-pricing.md](09-pricing.md) and [RUNBOOK.md](RUNBOOK.md)'s WP202 checklist for the exact
   value and rationale. `dataset_ingest` still has, and always will have, no price row (CSV/TSV
   stays free in v1 by skipping the reserve call in code, D12). Not yet applied to production —
   RUNBOOK steps 2-6 (migrate, `pricing:apply`, flag flip, live smoke test) are still pending.
4. **LLM harness** (`d60edb7`) — `instruct/prompt.ts` + `parse.ts`, mirrors
   `src/catalog/rerank-prompt.ts`/`rerank.ts`. `DATASET_INSTRUCT_MODEL = 'claude-haiku-4-5'`,
   temperature 0. English prompt (new text, not a rewrite of the CBS-side Dutch prompts).
5. **Turn orchestration** (`fd3df3b`) — `respond.ts` (the `run()` callback
   `chargeAndRunDataset` invokes): pre-checks → rawState revalidation → the one LLM call →
   threshold/unsupported handling → execute/build → `writeTurn`. `templates.ts` holds every reply
   string, zero LLM prose in this tier (D8/ADR 015 rule reused).

Also: [ADR 037](decisions/037-user-data-attachments.md)'s own §8 Q6 copy was decided in Dutch
before the owner's later "we are english now" override (#206) landed in the same session —
translated in a small follow-up commit (`13751b5`) so the doc and code never contradicted #206.

**Verified state at session end (2026-09-06):** full backend suite green (2045/2045 on the last
complete run; the newest slice's own `tests/attachments/` suite — 183/183 — re-run separately on
top of it), benchmark gate PASS (14/14 + 6/6 + 0 fabricated, CBS pipeline untouched throughout),
typecheck clean, CI `gate` job green on every one of the 5 commits (`deploy` fails on all of them
on the same pre-existing Route B Vercel-secrets gap tracked in [open-questions #132](open-questions.md) — unrelated to this WP).

**Built this session (session 85):** `reconstructDatasetTurn` + `redactedTurnIntegrityReport`
(`src/attachments/reconstruct.ts`, the R8/D9 analog — same `{ok, problems}` shape as the CBS
side's `reconstructionReport`), `getDatasetTurnById` (`src/attachments/read.ts`, the AuditRecord
analog reader), and `scripts/verify-dataset-turns.ts` (`npm run attachments:verify -- <fromId>
<toId>`, mirrors `verify-audit-rows.ts`). One real bug found and fixed while writing this slice's
own tests, not in review: the module's `stableStringify` (duplicated locally per ADR 001's module
boundary, not imported from `src/answer/llm/client.ts`) didn't special-case `Date` — the pg/PGlite
driver hands back a live `Date` for `timestamptz` columns despite `UserDataset.createdAt` being
typed `string`, so a freshly-fetched dataset's `createdAt` serialized as `{}` and made EVERY chart
turn falsely fail reconstruction. 12 new tests (`tests/attachments/reconstruct.test.ts` +
`read.test.ts`), full backend suite green (2057/2057), typecheck clean, `/code-review` LOW: 0
findings. Migrations 026/027 are still file-only — nothing here touches a real database.

**Built this session (session 85, second slice):** `web/app/dataset-actions.ts` —
`ingestFile`, `decideDatasetFormat`, `askDataset`, `deleteMyDataset`. Turned out to be
considerably more than "one line": CSV/TSV-only ingest (extension-sniffed, not MIME —
XLSX/HTML/PDF have no parser yet), the per-user quota checks (D12 §4), a NEW
`resolveAmbiguousFormats` (`src/attachments/ingest/profile.ts`) for D5's two-chip numeric-format
decision, a NEW eager dataset-thread creation path (`createDatasetThread`,
`src/threads/index.ts` — a deliberate SECOND creation path alongside the existing lazy
`attachOrCreateThread`, its own stale "ONLY place" comment fixed to say so), and a NEW
`validateDatasetThreadOwnership` twin that double-binds a turn's thread to BOTH the caller AND
the specific dataset (nothing at the schema level otherwise stops a caller's own valid
`datasetId` pairing with a different one of their own threads). New English ingest-copy
templates (`ingestUnsupportedFileTypeText`/`ingestFileTooLargeText`/`ingestQuotaExceededText`,
`src/attachments/templates.ts`, #206). 33 new tests across `tests/attachments/profile.test.ts`,
`tests/threads/dataset-threads.test.ts`, and `web/app/dataset-actions.test.ts` (the last mirrors
`actions.test.ts`'s mocked-module convention). Full backend suite green (2068/2068), full web
suite green (638/638), both typechecks clean, a real `next build` clean, `/code-review` LOW: 0
findings both slices. Migrations 026/027 still file-only; nothing here is wired into any UI or
reachable by a real request yet (no route calls these actions).

**UI slice, in progress (session 85, third slice) — D10's thread-kind dispatch, first
increment:** `ThreadSummary.kind: 'cbs' | 'dataset'` (`src/threads/index.ts`) — REQUIRED, not
optional as the design doc's own sketch had it (one producer, `listThreads`, always knows which
kind a row is). `listThreads`' SQL gained a dataset-title subselect (`user_datasets.display_name`,
re-binding `user_id` under the join per this function's own defense-in-depth convention, `status
<> 'redacted'` so a fully-redacted dataset thread is filtered out exactly like a fully-redacted
CBS thread). One real bug caught by the test suite, not review: the new subselect's `ud.user_id =
$1` needed an explicit `::uuid` cast (`user_datasets.user_id` is `uuid`; PGlite/pg infer `$1` as
`text` without it) — `operator does not exist: uuid = text`, fixed before commit.
`ThreadSidebar` gained its FIRST-EVER dedicated test file (`thread-sidebar.test.tsx`, 6 tests —
a design-doc-named gap) pinning a paperclip prefix for `kind: 'dataset'` threads and BYTE-IDENTICAL
(no prefix) rendering for `kind: 'cbs'` ones. Full backend suite green (2073/2073), full web suite
green (644/644), both typechecks + a real `next build` clean, `/code-review` LOW: 0 findings.
**Not yet built for the thread-dispatch leg:** `loadMyThread`'s CBS/dataset dispatch (needs
`replayDatasetTurns` + a redaction-aware dataset-turn reader — D10's 4 "check redaction FIRST"
new-reader call-outs are all still open), and `Workspace`'s `Handoff` discriminated union to
mount `DatasetChat` instead of `Chat`.

**UI slice, second increment — D11's chart rendering:** `chart.tsx`'s `PlottableSpec` type-only
refactor (`buildRows`/`valueLabelPlan` now take the minimal structural subset they actually
touch, not the full `ChartSpec` — zero runtime change, confirmed by typecheck alone plus the
full existing `chart.test.tsx` suite passing byte-identical) and `web/components/user-chart.tsx`
(`UserChartView`) — the H2 renderer, its own first-ever test file (9 tests) pinning the badge,
dashed chrome, provenance+disclaimer footer, and the ABSENCE of anything CBS-shaped. New
`USER_DATA_BADGE` constant (`src/attachments/types.ts`, alongside the existing
`USER_DATA_DISCLAIMER`). v1 scope is deliberately smaller than `ChartView`: no small multiples,
no table view, no per-point/bar value labels (those render via chart.tsx-internal
`SeriesDot`/`SeriesBar`, not in the design doc's reuse list), no trend headline, **no CSV export**
(D11's CSV-injection defense for a "Download as CSV" of user data is not built — tracked as a
follow-up alongside the table view). Two real dead-code findings caught by `/code-review` LOW and
fixed before commit: an unused `useId()`/`domId` left over from adapting `ChartView`'s pattern,
and an unused direct `seriesStyle` import (it's genuinely reused, just indirectly via
`buildRows`). Full backend suite green (2073/2073), full web suite green (653/653, post-fix), both
typechecks + a real `next build` clean.

**UI slice, third increment — the full dataset-thread dispatch + `DatasetChat` (D8/D10):**
`getDatasetTurnsByThread` (`src/attachments/read.ts`) + `replayDatasetTurns`/`lastChartState`
(NEW `src/attachments/replay.ts` — deliberately produces the FINAL `DatasetChatMessage` shape
directly, unlike the CBS split in `src/threads/replay.ts`, since a `DatasetTurnEnvelope` already
carries everything needed with no web-only builder stage required; redaction-checked FIRST,
matching D9's explicit new-reader discipline) + `getThreadDatasetId` (`src/threads/index.ts`,
`loadMyThread`'s dispatch point). `web/app/actions.ts`'s `LoadedThread` widened to a
discriminated union (`'empty' | 'cbs' | 'dataset'`) and `loadMyThread` dispatches on
`getThreadDatasetId` BEFORE doing any CBS-shaped work; its own first-ever dedicated test file
(`actions-loadmythread.test.ts`, 7 tests — another design-doc-named gap). `web/components/
dataset-chat.tsx` (`DatasetChat`) — the turn loop, mirroring `chat.tsx`'s double-click guard
(one `crypto.randomUUID()` per submit, send disabled while in flight) and the D5 profile-card
two-chip decision UI (finally wiring `ambiguousFormatClarificationText`/
`AMBIGUOUS_FORMAT_OPTIONS`, dead code since the backend slice). `Workspace`'s `Handoff` widened
to a discriminated union mounting `DatasetChat` instead of `Chat`; a new mixed-CBS-and-dataset
thread-list test suite in `workspace.test.tsx` proves a CBS thread resumes byte-identically
regardless of dataset threads sharing the sidebar (the explicit D10 invariant).

v1 scope, deliberately smaller than `Chat` (documented, not silently cut): no dock support (
`UserChartView` always renders inline — `VisualDock`'s `userChart` branch is its own,
not-yet-built increment and not a dependency of `DatasetChat` at all), no resumed-turn cost
captions (no ledger join built for dataset-turn replay — `dataset_turn`/`dataset_ingest` prices
aren't even in `pricing-defaults.ts` yet).

**Three real findings caught by `/code-review` LOW and fixed before commit — the most
significant of this WP so far:**
1. **A real correctness bug**, not a nitpick: `DatasetChat` was mounted with no `key` in
   `Workspace`, so switching between two dataset threads reused the SAME component instance —
   `useState(initialMessages)` etc. only reads its argument on first mount, so the SECOND
   thread silently rendered the FIRST thread's stale messages. Fixed with `key={handoff.threadId}`
   (a full remount is simpler and equally correct here — unlike `Chat`, `DatasetChat` has no
   cross-thread state worth preserving via a `loadNonce`-style reset effect instead). A
   regression test in `workspace.test.tsx` was verified to actually fail without the fix (removed
   it, watched the test fail, restored it) before being counted as passing.
2. `DatasetChat`'s `generationRef` stale-response guard was declared and read but never
   incremented anywhere — inert, dead protection; removed (the `key` fix above makes an unmount
   the real guard, since React discards a stale response against an unmounted instance).
3. `getThreadDatasetId` took no `userId` parameter, unlike every other reader in
   `src/threads/index.ts`, which re-binds `user_id` under an already-scoped join as deliberate
   defense-in-depth even where a caller mistake is the only way it would ever matter. Hardened to
   match (not exploitable today — the sole caller only ever passes an already-validated
   `threadId` — but consistent with this module's own stated invariant).

Full backend suite green (2087/2087 — one earlier parallel run hit 3 PGlite resource-contention
flakes, a documented pre-existing class of issue; a clean re-run confirmed 0 real failures), full
web suite green (673/673), both typechecks + a real `next build` clean.

**UI slice, fourth increment — wiring "Bestand uploaden" to `ingestFile` (D10):** `chat.tsx`
gains a presence-driven `attachments?: ChatAttachments` prop (the `websearch` pattern) — a NEW
`ChatAttachments` type (`{enabled: true; onUploadFile: (file: File) => Promise<{ok, message?}>}`)
enables the button, wires a hidden `<input type="file" accept=".csv,.tsv,...">`, and owns its own
LOCAL busy/error state (explicitly NOT the main `busy`/`onBusyChange`, per D10's own fixed-in-
review note — reusing the main one would lock the sidebar for the full ~45s ingest budget). New
hooks/ref appended strictly after every existing one (D10 point 2). "Link toevoegen" and
"Databron verbinden" stay disabled regardless — their backends (url_html ingest, OAuth data
sources) don't exist yet. `Workspace` gains `handleUploadFile` (calls `ingestFile`, and on
success switches the handoff straight to the new dataset thread — no `loadMyThread` round trip
needed for a dataset with no turns yet — instead of Chat rendering any success state itself,
since it's about to unmount) plus a dormant `attachments?: {enabled: true}` prop mirroring
`websearch`'s own (not threaded from `page.tsx` yet — the flag doesn't exist).

**A real correctness finding from `/code-review` LOW, fixed before commit:** `handleUploadFile`
built the dataset handoff's `displayName` from the client's raw `File.name` instead of the
SERVER-persisted `display_name` `ingestFile` actually stored (which trims, caps at 200 chars,
and falls back to `'bestand'` on an empty name) — a long, whitespace-padded, or empty filename
could show a UI heading that didn't match what was actually in the database. Fixed by adding
`displayName` to `IngestOutcome`'s `'ok'` variant (the ACTUAL stored value) and having
`Workspace` use that instead of re-deriving it client-side — the same "every displayed string
traces to stored data" rule (R6) this codebase already applies to CBS answers. `chat.test.tsx`
gained the D10 fix #1 byte-identity pin (exact className/title + zero `input[type="file"]` nodes
when `attachments` is absent) plus 4 new tests for the enabled case; `workspace.test.tsx` gained
3 new tests including one proving the displayName fix (a deliberately-mismatched mock
`File.name` vs. the mocked stored name).

Full backend suite green (2087/2087), full web suite green (682/682), both typechecks + a real
`next build` clean.

**UI slice, fifth increment (session 86) — `VisualDock`'s `userChart` branch:** `DockVisual`
(`web/lib/dock-visuals.ts`) gained an additive `userChart: UserChartSpec | null` field (every
existing `chart`/`card` producer now sets it `null` — zero behavior change, confirmed by the full
pre-existing suite passing byte-identical) plus `datasetMessageHasVisual`/`deriveDatasetVisuals` —
the `messageHasVisual`/`deriveVisuals` analogs over `DatasetChatMessage[]`, one tab per chart-kind
assistant turn, labeled `"Your chart n"` — the design doc's own §8 Q6 decided this exact English
string (session 84's translation, alongside the badge/disclaimer copy), not a fresh naming choice;
**first shipped as `"My chart n"` in this increment's initial commit, caught and corrected the same
session** (the design doc's §8 wasn't checked before naming a brand-new string — see
lessons-learned.md). `VisualDock` gained the `userChart` render branch (`UserChartView`) — its own first-ever
dedicated test file, `visual-dock.test.tsx` (design doc's own "fixed in review" finding), pinning
both the chart/card path's byte-identity (`userChart: null` visuals render exactly as before) and
the new branch. `DatasetChat` gained `dockMode`/`onVisualsChange`/`activeVisualId`/
`onActivateVisual` props mirroring `Chat`'s own exactly (all optional, all no-ops without their
callback) — a chart turn now shows the same in-flow reference chip pattern as `Chat`'s own
("Chart in panel →") when docked, and renders inline exactly as before when not (`dockMode=false`
stays the default, so every prior test/call site is unaffected). `Workspace`'s dataset branch wires
`dockMode={isWide}`/`handleVisualsChange`/`activeVisualId`/`activateVisual` — the same handlers
already driving the CBS side, since `visuals`/`activeVisualId` reset on every thread switch
regardless of kind. This closes WP202a's last documented "no dock support" scope gap (ADR 037,
`docs/08-build-plan.md`'s own prior wording here, `dataset-chat.tsx`'s header comment — all updated
in the same change). 15 new tests (`web/lib/dock-visuals.test.ts` — new file, the module's first —
plus `visual-dock.test.tsx` and 4 new `dataset-chat.test.tsx` cases). Full backend suite green,
full web suite green (697/697), both typechecks + a real `next build` clean.

**`ATTACHMENTS_ENABLED` threaded through `page.tsx` (session 86):** the WP129/WP135 dormancy
pattern, mirroring `websearchEnabled` exactly — `const attachmentsEnabled = process.env
.ATTACHMENTS_ENABLED === '1'`, spread into `Workspace`'s `attachments` prop only inside the
`WORKSPACE_ENABLED` branch (Dashboard has no dataset-chat integration at all, so it's irrelevant
there). No price read needed (`dataset_turn`/`dataset_ingest` prices still aren't in
`pricing-defaults.ts`, §8 Q1 unrelated to this). Still **OFF in Vercel** — this is code-only, zero
behavior change until the owner sets the env var. Full backend suite green (2087/2087), full web
suite green (697/697, unaffected — no new test needed at this layer, matching the existing
`websearchEnabled`/`WORKSPACE_ENABLED` precedent of no page-level test file), both typechecks + a
real `next build` clean, `/code-review` LOW: 0 findings.

**"Link toevoegen" demo preview (session 86, owner request — NOT WP202b):** the owner asked to see
the attachment entry points for demoing the product to other people, before WP202b's real
`url_html` ingest is designed/built. `chat.tsx`'s "Link toevoegen" button is now clickable — it
opens the inline URL-input row the original design doc sketched (D10), and submitting shows an
honest "This isn't available yet — coming soon." message rather than fetching anything (principle
c: never fake it). Pure `web/`-only UI state, no dependency on `attachments`/any flag, no backend
call, no SSRF surface introduced (there is nothing to fetch with). "Databron verbinden" and
"Bestand uploaden" are unchanged. 4 new tests in `chat.test.tsx`, plus the existing byte-identity
test updated (it now pins "Link toevoegen" enabled, not disabled — a deliberate, reviewed change,
not drift). Full backend suite green (2087/2087, unaffected), full web suite green (701/701), both
typechecks + a real `next build` clean, `/code-review` LOW: 0 findings.

**Critical fix (session 86, `03addbd`) — `listThreads`/`getThreadDatasetId` throw on the real,
not-yet-migrated database:** the CI `deploy` job had been broken for weeks (missing GitHub Actions
secrets, unrelated to this WP — fixed same session); fixing it let the FIRST real deploy since
session 84 reach production, shipping this WP's own `t.dataset_id`/`user_datasets` references live
for the first time — and they threw immediately (migrations 026/027 are still file-only), breaking
thread selection/the sidebar and `/api/health` for every signed-in user, since `WORKSPACE_ENABLED`
is live. This is exactly the RUNBOOK #154 "schema-coupled code" class of bug, just never triggered
before because the code had never actually run against production. Fixed with a
`userDatasetsTableExists()` check-not-catch (mirrors `errorLogTableExists`/`trialTableExists`):
both functions fall back to the pre-ADR-037 CBS-only query when the migration hasn't run. Verified
live (`GET /api/health` → `{"ok":true}`). Full detail: STATUS.md/lessons-learned.md's session-86
entries.

**§7 docs sweep — DONE (session 86):** `docs/05-data-rules.md`'s new U-row section,
`docs/09-pricing.md`, `docs/13`, `docs/04-architecture.md` capability rows, `docs/03-mvp-scope.md`,
`docs/06-roadmap.md`, and RUNBOOK's "WP202 eigen data" go-live checklist are all written.

**Not yet built (WP202a's own remaining scope):**
- Fixtures (`tests/fixtures/llm/attachments/`, `attachments:record`/`:eval`, real-LLM-spend,
  owner-supervised), then the owner-supervised migration apply + the actual
  `ATTACHMENTS_ENABLED=1` flip + go-live.

## Session 92 (2026-09-09) — Story mode ✅ LIVE, chat polish ✅ LIVE, frame styling + floating Style panel ✅ LIVE; Embed ✅ BUILT (session 93, 2026-09-10, branch `embed-charts`, not merged — see below)

Spec: [superpowers/specs/2026-09-09-story-mode-and-embed-design.md](superpowers/specs/2026-09-09-story-mode-and-embed-design.md)
(Part A Story mode, Part B Embed, Part C Frame). Plans: `2026-09-09-story-mode.md`, `2026-09-09-chat-polish.md`,
`2026-09-09-chart-frame.md` under [superpowers/plans/](superpowers/plans/). As built: ADR [039](decisions/039-chart-presentation-panel.md)
addenda (Story mode; Frame styling + floating panel), ADR [040](decisions/040-interface-language-switch.md) addendum.
**Embed (Part B) — ✅ BUILT**, all 8 plan tasks (token signing, the dialog, framing headers, the public
`/embed/[token]` route with a frozen render): session 93 (2026-09-10), autonomous, branch `embed-charts`,
not yet merged, PR for owner review. The Live re-render path is real, tested and code-complete but
**GATED CLOSED** — it cannot turn on for anyone because the Pro-owner-email lookup it depends on doesn't
exist yet ([#224](open-questions.md)). Owner steps pending: set `EMBED_TOKEN_SECRET` (+ optionally
`PRO_ACCOUNT_EMAILS`) and merge the branch (RUNBOOK § "Embed go-live"). Full mechanism: ADR
[041](decisions/041-public-embed-pages.md). Follow-ups recorded in the spec and in ADR 041's Revisit
triggers (story in the embed, map chart type, homepage embeds, sizes, per-embed revocation, the real
#205 Pro plan). **Numbering note:** a second, unrelated ADR 041 ("chart-insights", session 94, below)
exists on a different branch that also merges here — two different files both numbered 041
(`041-public-embed-pages.md` / `041-chart-insights.md`); harmless as distinct filenames, but a future
session should renumber one to keep the sequence clean.

## Session 94 (2026-09-10) — three owner UI fixes ✅ LIVE, PR #9 conflict resolved (twice — once here, at
this same merge), the visual "next level" plan written (not built), two export fixes (#222 ✅/#223 mostly)
✅ LIVE, Insights ✅ BUILT (own branch, merged to `main`)

Owner-present, continuing session 93's embed-charts PR review. Three small UI fixes (Style panel floating→inline,
the docked-chart chip restyled into the footer action row, answer-box margin, chat width `2xl→4xl→3xl` after
owner feedback) merged to `main` directly (owner: "yes push to main"). **Visual plan** (not built):
[session-briefs/2026-09-10-visual-next-level-plan.md](session-briefs/2026-09-10-visual-next-level-plan.md) —
Fable 5.1's brief for a CSS-3D/scroll "Story stage", a designed default chart, a template system; its own
addendum identifies the reference demo as a 3D municipality map + scroll story + generator, via the Vercel API.
**Insights** (owner ask, replacing Story mode's selection; ADR [041](decisions/041-chart-insights.md), built
on branch `claude/checkdecijfers-embed-pr-review-acbrd5`, merged to `main`): `src/chart/insights.ts`
(deterministic outlier/jump ranking) + `src/chart/insights-phrase.ts` (AI phrasing via the digit-free
slot-filling mechanism `answer/compose/slots.ts` proved) + `web/app/chart-insights-actions.ts` (the server
action) + `chart.tsx` wiring (the existing `ChartStoryPanel` shell reused unchanged). Follow-ups tracked, not
built here: [#230](open-questions.md) delete `chart-story.ts`'s now-dead selection code (**✅ done, session 102,
2026-09-15, PR #25 MERGED session 104, 2026-09-16, `9e00dd4`** — see open-questions.md); [#231](open-questions.md)
no rate limit on Insights generation yet. Full verification block green (typecheck ×2, web 1304 tests,
backend 2211 tests solo, benchmark 14/14+6/6+0 fabricated, real build, docs 11/11, code-review LOW 0
findings) — see [STATUS.md](STATUS.md) for the exact numbers. **This push put PR #9 (embed-charts) into a
real conflict TWICE** — once on the first push (docs/open-questions.md only, resolved same session), and
again on this second push (this file, lessons-learned.md, open-questions.md, and chart.tsx — resolved in
this same merge, including renumbering #224/#225 to #230/#231 to avoid colliding with Embed's own
pre-existing #224-229 range).

## Visual upgrade programme (owner ask, session 94, 2026-09-10 — "lift the chart thing to the next level for our ICP") — ALL THREE PHASES ✅ MERGED + LIVE (2026-09-11: PR #10 `ca5ba19`, PR #11 `696c1c3`, PR #12 `29aadde`, CI green on each `main` commit, production answering — verified session 96; built session 95 autonomous, every phase verified in a real browser on the dev server)

**Source:** the session-94 plan ([session-briefs/2026-09-10-visual-next-level-plan.md](session-briefs/2026-09-10-visual-next-level-plan.md)) and the owner's pre-resolved decisions for the overnight run ([session-briefs/2026-09-10-overnight-visual-upgrade-kickoff.md](session-briefs/2026-09-10-overnight-visual-upgrade-kickoff.md)): "3D" means depth/tilt/motion around a FLAT chart (never 3D marks, never the 3D map — R6); retire "basic Recharts" as the default; templates v1 = looks only; zero new libraries; auto-play off by default; spotlight without zoom; migrations 028/029 stay owner steps.

**Fixed in every phase (invariants):** every number stays a spec string bound to its cell (R1/R6); the provisional marking (R11) can never be hidden — at every marker mode, tilt, scale, colour and theme; no numeric text anywhere in a card or a stage that is not a spec string (the whole-card digit scans); CSS transforms only on wrappers OUTSIDE the exported `<svg>`; no CSS `aspect-ratio`; no Recharts animation; both themes always; every new string in `messages.ts` in both languages, digit-free.

| Phase | Ships | AI / DB / cost | Size | Status |
|---|---|---|---|---|
| 1 — the designed default (plan §4) | `DEFAULT_PALETTE` (Okabe–Ito-anchored, ≥ 3:1 on both cards, first four colour-blind-safe — both test-pinned), `STOCK_PRESENTATION` = ends markers / horizontal grid / no axis lines / gradient area fill, a hairline baseline, haloed 12 px labels, height follows width (256–360 px, measured), a reduced-motion-aware entrance, header hierarchy, chip legend, a faint solid crosshair, an export guard for the tooltip cursor + active dot, two presets retuned, the panel's "Eerste en laatste" option + area-fill toggle. `CLASSIC_PRESENTATION`/`RECHARTS_PALETTE` kept for the Classic template. | none / none / none (0 kB) | 1 night | ✅ BUILT — plan [superpowers/plans/2026-09-11-designed-default-chart.md](superpowers/plans/2026-09-11-designed-default-chart.md), ADR [042](decisions/042-designed-default-chart.md); SDD: 5 tasks, per-task reviews (two Important findings fixed: hidden markers keep keyboard focus → `:focus-visible` reveal; the dashed crosshair was identical to the event marker → solid), a whole-branch review + one fix wave (the export guard also strips Recharts' active dot; `scrollbar-gutter: stable` on the dock; small multiples' baseline; stale comments). Verification: see [STATUS.md](STATUS.md). |
| 2 — templates v1 (plan §5) | `web/lib/chart-templates.ts` (Standard = the new default, Classic = the session-87 look, Newsroom — the ICP's publish-ready look, prioritised —, Presentation dark, Social 4:5, Minimal, Brand = the existing Brandfetch flow as a card), a Templates tab first in the Style panel with digit-free SVG thumbnails, the design-time contrast gate (templates × palette × themes × backdrops), `template_applied` on the counter, "Use for all my charts" = the account default; the homepage/empty-state strip as a later slice. Starter charts (a curated chart + a look) are v2, NOT this. | none / none / none | ~1 day | ✅ BUILT (session 95, same night, branch `visual-templates-v1` stacked on phase 1, PR #11 MERGED + LIVE 2026-09-11, `696c1c3`) — plan [superpowers/plans/2026-09-11-chart-templates-v1.md](superpowers/plans/2026-09-11-chart-templates-v1.md), ADR [043](decisions/043-chart-templates.md); SDD: 4 tasks (1+2 batched), reviews clean, a whole-branch review with one fix wave (Basis applies the stock look EXPLICITLY — `{}` was a no-op for users with a saved default; the gallery became a radiogroup; the digit scan now really visits the Sjablonen tab in both languages). The homepage/empty-state strip is NOT built (owner decision E; a later slice). Verification: see [STATUS.md](STATUS.md). |
| 3 — the Story stage (plan §3) | "Present" on the Insights/story panel opens a full-viewport overlay: a second chrome-less `ChartView` instance driven by the step index, CSS 3D tilt on entry (8°, settling flat before the first caption is centred — never while a number is read), a spotlight vignette on the plot + the existing ring/dimming (no zoom, no pan, no parallax in v1), captions that reveal on scroll, a scroll-progress hook (rAF-throttled), Escape/focus management, phone layout, reduced-motion path, an auto-play toggle OFF by default, `stage_open` on the counter. Option A only (0 kB); GSAP/Three.js stay measured escalations gated on the counter (migration 028) and an owner OK. Playwright on real pages, both themes, before "done". | none / none / none (0 kB) | 2+ days | ✅ BUILT (session 95, same night, branch `visual-story-stage` stacked on phase 2, PR #12 MERGED + LIVE 2026-09-11, `29aadde`) — plan [superpowers/plans/2026-09-11-story-stage-v1.md](superpowers/plans/2026-09-11-story-stage-v1.md), ADR [044](decisions/044-story-stage.md) with an as-built addendum. Five SDD tasks, a fable whole-branch review (eight Important, all fixed in one wave), a scoped re-review, one post-loop fix, and a `/code-review` LOW finding (auto-play stopped itself on its own scroll) fixed last. v1 as built vs the plan: spotlight WITHOUT pan or zoom, the entry tilt settles flat BEFORE the first caption is centred (not "during the first step"), no parallax, the stage shows the spec's default form and hides the definition line + trend headline on every viewport. Real-browser re-check on the final code (open from finding 3, boundary scroll, auto-play across its own scroll, wheel stop, Escape, phone 375 px, dark) done — see ADR 044's as-built addendum. Measured verification numbers: [STATUS.md](STATUS.md). |

**Order built / rule:** phase 1 → 2 → 3, one pull request per phase (the #118(b) rule: autonomous sessions never push to `main`); "If you finish everything": native scroll-driven CSS where it simplifies the hook, a WRITTEN proposal for the 3D-map idea (never a build), the homepage template strip — in that order; nothing that needs a library, a schema change or LLM spend.

## WP218 — chart styling programme (owner decisions on [#218](open-questions.md), session 90, 2026-09-09) — ✅ MERGED + LIVE (all six phases, built session 91 autonomous on branch `wp218-chart-styling`; PR #7 merged 2026-09-09, `05ec8ed`) — owner steps pending: apply migrations 028 + 029, optionally set `BRANDFETCH_API_KEY` (RUNBOOK § WP218 go-live)

**Source:** the session-90 architecture panel synthesis ([session-briefs/2026-09-09-session-90-chart-config-tool-synthesis.md](session-briefs/2026-09-09-session-90-chart-config-tool-synthesis.md), artifact https://claude.ai/code/artifact/5a971401-ce68-40d5-ad28-1a74f2246c39) plus the owner's answers A–H recorded on #218. The panel's mechanism stands (a `presentation` slice on the ADR 038 reducer + a pure resolver in `web/lib/chart-presentation.ts` that yields EFFECTIVE values and per-option honesty locks; the panel and the render both read only those); the owner's answers widen the scope beyond the panel's phase 1 and knowingly override two of its cheapest-first defaults (B colour picker + outside service; C database persistence).

**Fixed in every phase (invariants):** every number on a chart stays a spec string bound to its cell (R1/R6); the provisional marking (hollow marker / hatched bar, R11) can never be switched off — a chosen colour that would hide the hollow ring is refused with a reason; bars (and any magnitude-encoding form) keep a zero baseline (#48); the export shows exactly what is on screen; the session-87 stock look stays the default and becomes a test-pinned constant (superseded 2026-09-11, session 95: ADR [042](decisions/042-designed-default-chart.md) makes a designed look the pinned default; the session-87 literals survive as `CLASSIC_PRESENTATION`); panel copy is digit-free (the web-side honesty scans walk the whole card's text — ADR 038 correction, session 90).

| Phase | Ships | AI / DB / cost | Owner step | Size | Built (session 91, branch `wp218-chart-styling`) |
|---|---|---|---|---|---|
| 1 — the panel | Fold-out "Style"/"Opmaak" panel on every `ChartView` mount incl. Ontdek + trial (G). Tabs: **Chart** (thickness in 4 named steps (H), dots all/provisional-only, grid 3-way, axis lines, X-label angle, value labels (locked on bar), zero baseline (line only)); **Colours** (every colour in use as swatch + hex + picker; default = `RECHARTS_PALETTE`; a light+dark contrast warning; refusal when a pick would hide the R11 hollow ring); **Fonts** (curated web-font list). Each chart starts fresh (E) + "Standaard". Phase 0 first: extract today's literals into `STOCK_PRESENTATION`, fix small multiples' missing R11 marker (`dot={false}`). ADR 039. | none / none / none | go | ~4 days | ✅ shipped — phase 0 + phase 1 commits `27db553`..`394fcfc`, plus the tilted-label fix `5216e9c` |
| 2 — account default | "Save as my default" → a `user_chart_styles`-style row (one JSON per user) read on every chart; per-chart tweaks on top still start fresh (E). Migration (additive), GDPR retention leg + self-service delete (a user-keyed preference is personal data), RLS posture per migration 003. | none / **DDL, supervised** / none | supervised apply | ~2 days + apply | ✅ shipped (built together with phase 6) — commits `fef323a`, `4d51567`, `5c04af9`, `8df7b71`, plus controller fix `8112cb7`; migration `028_user_chart_styles.sql` is file-only, owner applies |
| 3 — brand colours + fonts | "Apply brand colours" (+ fonts): a server-side Brandfetch lookup by the login email's domain, with a website box when the domain has no brand (gmail etc.); result stored in the phase-2 row; attribution note. API key as a Vercel secret (RUNBOOK secrets table); check Brandfetch pricing/rate limits first. | none / none / **outside service** | key + pricing OK | ~2 days | ✅ shipped — commits `edbbf8e`, `977e093`, `3380009`, `5e68130`, plus controller fix `83ba1ff`; migration `029_brand_cache.sql` is file-only; `BRANDFETCH_API_KEY` is not set — owner step; the endpoint path form is UNCONFIRMED without a key |
| 4 — EN/NL switch ([#219](open-questions.md)) | Top-nav language switch; all interface strings via a message catalogue; charts follow the app language with a per-chart dropdown; CBS's own words via a maintained word list, never LLM translation. The Dutch CBS answer pipeline is untouched. Own design round first. | none / maybe (where the choice is stored) / none | design round | 5–8 days | ✅ shipped — commits `a08ccea`, `0335624`, `c052899`, `f70f967`, `4c26ccb`, `7e2651d`, plus controller fixes; ADR 040 |
| 5 — chart types (D) | Research brief on what users expect (a dropdown listing only honest types for the data, others greyed out with a one-line reason), then the build: horizontal bar for region comparisons, single-series area with a forced zero baseline, plus whatever the research finds honest; pie/stacked/scatter/ranked stay refused (R1/R5/R6/R9/R10). | none / none / none | research read-back | 1 + 2–3 days | ✅ shipped — commits `b0c815f`, `5f20821`, `1c5736b` |
| 6 — usage counter ([#220](open-questions.md)) | Our own anonymous counter table (event + day + count) via a server action; no third-party tool; counts panel usage only. | none / **DDL** (can ride phase 2) / none | — | ½ day | ✅ shipped (built together with phase 2, same commits: `fef323a`, `4d51567`, `5c04af9`, `8df7b71`, controller fix `8112cb7`); migration `028_user_chart_styles.sql` also carries `chart_style_usage`, file-only, owner applies |

**Order built:** phase 0 → phase 1 → phase 2+6 (built together, same plan) → phase 3 → phase 4 → phase 5, all 38 commits spanning `867393d..9fd6eb4` (2026-09-09, session 91, autonomous — the owner was away). The owner's "go" was given in chat that same session as "Start executing, work autonomously." Merged and live since 2026-09-09 (PR #7, `05ec8ed`; this sentence said "nothing is merged" until session 96 corrected it — the #118(b) branch + PR rule was followed, then the owner merged). See ADR [039](decisions/039-chart-presentation-panel.md) (the panel, account default, brand colours, chart types) and ADR [040](decisions/040-interface-language-switch.md) (the language switch) for the as-built mechanism, and [RUNBOOK.md](RUNBOOK.md) § "WP218 chart styling — the supervised go-live" for the owner steps still pending (migrations 028 + 029, optionally `BRANDFETCH_API_KEY`). **Build discipline used:** SDD per phase (`superpowers:writing-plans` → `subagent-driven-development`), a final whole-branch review, the full verification block; live DDL and the Brandfetch key remain owner-supervised steps not yet taken.

## Journey programme — the five minutes around the answer (the experience improvement plan, [#238](open-questions.md)) + the repositioning / ICP ([#237](open-questions.md)) — ▶ PHASES 0/1/3/4/5 BUILT, awaiting owner review (PR #14, session 97, 2026-09-11 autonomous, ADR [045](decisions/045-journey-programme-first-five-minutes.md); CI green, zero reviews yet)

**Source:** [session-briefs/2026-09-11-experience-improvement-plan.md](session-briefs/2026-09-11-experience-improvement-plan.md) (Fleur's journey end to end — 11 ranked recommendations R1–R11, 12 owner decisions, written by a parallel session the same day) and the ICP + direction recorded in [01-product-vision.md § Ideal customer profile](01-product-vision.md) (Fleur = ICP segment 1). **Sanity check, session 96:** all 11 of the plan's "verified current state" code claims were re-verified against `origin/main` by a cheap-tier agent with file + line evidence (noindex on every page; an out-of-coverage question fetches the table automatically at the 100-credit `heavy` class with NO confirmation step; the signup grant is exactly 100 credits; the low-balance line and the credits explainer are mounted only in the pre-workspace `dashboard.tsx`, never in the live `workspace.tsx`; the insufficient-credits message names `/credits` as plain text; the credits page shows only `€5 — 200 credits` + Buy; the workspace purchase banner says "Ververs daarna de pagina"; clarification options carry the follow-up-chips caption and a click only fills the composer; the Style panel opens on `chart`; no analytics anywhere under `web/`; migration 028 file-only) — **all TRUE.** The plan is sound to build from.

**Fixed in every phase (invariants):** everything deterministic — no AI call, no new library, no schema change (the plan's own rule, = CLAUDE.md cheapest-mechanism-first); every new string in `messages.ts` in both languages and digit-free where it lands on a card; the money path (R3) and anything that spends real LLM budget (the audit re-run) stay owner-supervised; R1's usage report is aggregates only, no personal data (GDPR posture of [#14](open-questions.md)); the chat composer stays bare (owner, session 87) unless decision 6 below changes it.

**Working defaults for the plan's 12 owner decisions** (session 96 recommendation, given in chat with the ICP; the owner answered "update the build plan accordingly" — recorded as **defaults the owner vetoes by exception**, NOT a line-by-line sign-off; R3 still needs an explicit go before its build because it is the money path):

| # | Decision | Working default | Why |
|---|---|---|---|
| 1 | Usage report over existing tables + apply migration 028 | **yes / owner applies 028** | aggregates only; the counter records nothing until 028 is applied |
| 2 | Re-run the July experience audit once (real LLM spend, a few euros) | **yes, once, owner-supervised** | the only way to measure the first-question wall after everything that shipped |
| 3 | Clarification options send on click | **yes** | the price is already shown on the clarification; follow-up chips under an answer keep filling the box |
| 4 | Ask before a 100-credit fetch | **yes — one chip "Haal op voor 100 credits"**; explicit owner go before build | ICP: "a few euros without approval"; the vision doc promises "confirmation for heavy queries" |
| 5 | First fetch cheaper vs larger grant | ~~larger grant (config value)~~ **owner override: no change, stays 100 credits** | no special case in the price table |
| 6 | "Wat kan ik vragen?" in the chat | **yes, collapsed, reframed as "which sources are built in"** (CBS today, Eurostat marked coming) | sources are the roadmap and the marketing ([#237](open-questions.md)) |
| 7 | Style panel opens on Sjablonen for an untweaked chart | **yes** | judgment call, no counter data yet |
| 8 | Fourth landing step "Publiceer" + Ontdek caption | **now, not with the tagline** | "from research to embedded chart" is the direction |
| 9 | Review privacy + methodology pages | **owner reads; session drafts from the docs** | legal read on the privacy text |
| 10 | Collapse the four inert composer chips into one "Eigen data (binnenkort)" | **yes, then reverted session 101** | reverses the session-86/90 chip requests knowingly — owner then saw the single chip live, read it as things vanishing, and asked for the four chips back (ADR 045 decision 4 as-built note) |
| 11 | Phone header | **move "Credits kopen" + "Geschiedenis" into the Account menu** | cheapest |
| 12 | Bigger journey items stay in later phases | **yes, one exception: a public gallery of ~10 real embedded stories moves forward** | the cheapest test of the new message ([#237](open-questions.md)) |

| Phase | Ships | AI / DB / cost | Size | Gate |
|---|---|---|---|---|
| 0 — know | Owner applies migration 028 (+029); a read-only usage report over `audit_answers` / ledger / trial tables (signups, first questions, outcomes, refusal reasons, trial conversions, feedback); decide the audit re-run. | none / none (028 is the pending WP218 DDL) / audit re-run = a few euros, supervised | ½ day | decisions 1–2 |
| 1 — the first-question bundle | R2 (clarification caption, `/credits` as a link, low-balance line + credits explainer mounted in the live workspace, purchase banner polls the balance instead of "refresh") + R11 (honest waiting copy) + R10 (credits page: cost per question, "≈ N vragen", "credits verlopen nooit"). | none / none / none | ~1½ days | decision 3 |
| 2 — the money-path decision | R3: the confirm-first chip before a 100-credit fetch (default) or the price-line stopgap; larger signup grant per decision 5. **Branch + PR always; owner go first.** | none / config-table value / none | 1–2 days | decisions 4–5, explicit |
| 3 — orientation | R4 (a deterministic "which sources / topics are loaded" disclosure built from the table registry, collapsed in the chat) + R5 items 1–3 (Ontdek caption naming Opmaak · Inzichten · Presenteren; Sjablonen as the panel's opening tab; the anonymous-trial Insights line) + the "Publiceer" landing step. | none / none / none | ~1½ days | decisions 6–8 |
| 4 — paperwork | R6: methodology page ([#207](open-questions.md)) + privacy policy ([#14](open-questions.md)(d)), footer links. | none / none / none | ~1 day + owner review | decision 9 |
| 5 — interaction + phone | R7 (one-click clarification options) + R8 (chips collapse) + R9 (a 375 px pass over the whole journey; header → Account menu, [#214](open-questions.md)). | none / none / none | ~2 days | decisions 10–11 |
| 6 — re-measure | Run the phase-0 report again; judge the next round and the §5 items on numbers. | — | — | — |
| **Parallel, positioning ([#237](open-questions.md))** | **(a) ✅ DONE, session 101 continued (2026-09-13): [ADR 047](decisions/047-repositioning-embedded-sourced-chart.md)**, with addenda on the vision Q1 and roadmap Phase 2/3. **(b) ✅ BUILD DONE, session 101 continued overnight (2026-09-13/14, autonomous):** the [#205](open-questions.md) Pro-plan brainstorm — scope, €19.99/mo · 1000 credits/period · resets, flag-gated rollout — spec'd ([superpowers/specs/2026-09-13-pro-subscription-tier-design.md](superpowers/specs/2026-09-13-pro-subscription-tier-design.md)), planned ([superpowers/plans/2026-09-13-pro-subscription-tier.md](superpowers/plans/2026-09-13-pro-subscription-tier.md)), and **built end to end (13/13 tasks, several real money-path bugs found and fixed via real-DB-verified review), PR #22 ✅ MERGED 2026-09-14 (`53c7703`, deployed) — the RUNBOOK go-live checklist's remaining steps (Stripe price object, env vars, webhook subscription) still gate before the flag can turn on for anyone** (see STATUS.md and status-archive.md's session-101-continued-overnight entry for the full account). (c) Eurostat as source two through the WP30 narrow waist, demand-driven, **never named publicly before it answers** — **✅ E1 (adapter + internal explorer) BUILT session 101 continuation (2026-09-14/15, autonomous), branch + PR pending owner review; still not publicly named or answering anything (E2 does that, its own owner-signed sweep)** — see the WP30c entry above. (d) ✅ DONE (ADR 046, session 98/99) — the landing page + public gallery. | (a)(b) none; (c) ingestion + registry work, no LLM; (d) none | (a) done · (b) built, PR #22 awaiting owner merge-go + go-live · (c) E1 built (PR pending), E2/E3 unscheduled · (d) done | (c) E2 needs its own design round |

**Session 97 (2026-09-12, autonomous) — BUILT on branch `journey-programme` (PR #14 — MERGED session 99, `677c5fb`): phases 0 (report only), 1, 3, 4, 5 per the working defaults; recorded in [ADR 045](decisions/045-journey-programme-first-five-minutes.md). Not built: phase 2 / R3 (explicit owner go), decision 5 (config value), the 028 apply, the audit re-run, the full R9.1 journey walk. Phase 6 waits for 028 + a first report run.**

**Owner decision, session 101 continued (2026-09-13, in chat, asked directly per decisions 4–5 above):** decision 4 — **yes**, build the confirm-first chip ("Haal op voor 100 credits") before an automatic fetch; decision 5 — **no change**, the signup grant stays 100 credits (owner overrides the "larger grant" working default). Phase 2 is now cleared to build — branch + PR + explicit owner review before merge, per the rule below (money path, no exception for an owner-present session).

**Session 98 (2026-09-12, autonomous) — BUILT the parallel-positioning item (d) on branch `journey-public-face`, stacked on `journey-programme` (PR #18 — MERGED session 99, `ac14392`): the landing rebuilt around the positioning sentence in both languages (new subtitle + a second "Bekijk de galerij"/"See the gallery" CTA), and a public gallery of TWELVE real curated stories on the live `ChartView` at `/galerij` — Present/Style/Insights all working, zero AI spend, zero server-action calls on the public pages. Recorded in [ADR 046](decisions/046-public-gallery-and-positioning-landing.md). The landing's old Ontdek section is no longer mounted (replaced by a 3-story gallery teaser + a link to the full gallery); `ontdek.tsx` stays compiling, unused there. Not built: items (a)(b)(c) above (the repositioning ADR itself, the Pro-plan brainstorm, Eurostat); embed code on the gallery cards (PR #9 not merged into this branch's base — tracked in [#237](open-questions.md)).

**Session 98 (2026-09-12, autonomous) — R9.1 (the full phone walk) BUILT on branch `journey-phone`, stacked on `journey-programme`: every step in the kickoff brief walked at 375px, light + dark, in real Chromium — landing/login/workspace, the sources disclosure, an answer round trip with chart, all five chart-form tabs + Vanaf/Tot, the Style panel, Insights, the Present stage, a clarification round, a refusal, insufficient credits, the purchase-success banner, `/geschiedenis`, the sidebar/thread list, the Account menu + delete-history flow, theme persistence, an EN spot-check. Six tap-target bugs found and fixed (header wordmark wrap, Account menu items, chart form tabs, NL\|EN switch, theme toggle, delete-history confirm buttons) — all gated with a responsive class so 1280px stays pixel-identical; each has a regression test. Full verification green (typecheck, web:typecheck, test:docs, 98 files/1498 web:test, web:build). Not fixed: the sidebar's `icon-xs`/`icon-sm` shared Button-token buttons, also under 44px but a shared design-system primitive with a wider blast radius than this WP — left for its own pass. See [session-briefs/2026-09-12-phone-walk-findings.md](session-briefs/2026-09-12-phone-walk-findings.md).**

**Session 97 update (2026-09-12): phases 0, 1, 3, 4, 5 are BUILT — PR #14**,
51 files / +3567 −264 / 22 commits, branch `journey-programme`, head `2c4ec80`. CI green (`gate`: success),
`mergeable_state: clean`, **but zero reviews and zero comments as of this update — nobody has looked at it yet.**
Built via five parallel worktrees + an Opus whole-branch review (3 HIGH/3 MEDIUM/5 LOW, all fixed) + a scoped
coverage-disclosure review + a partial real-browser pass (desktop + phone, light + dark — the PR body lists exactly
what was and wasn't walked in a browser: chat chips/captions, the credits page, the purchase poll, the phone
header and one-click options are unit-tested only, not browser-verified, since they need a login). Phase 2 (R3) is
deliberately excluded — still needs an explicit owner go per the rule above. Phase 6 (re-measure) is next after
merge + real usage. **Next step is the owner's, not a session's:** review PR #14 (its body lists the three owner
steps — read/fill in `/werkwijze` + `/privacy`, run `npm run db:migrate` for 028+029 then `npm run usage:report`,
decide R3), then merge. **Do not start rebuilding any of phases 0/1/3/4/5** — a sibling session independently
(re)built two of PR #14's phase-5 items before this was discovered; see [open-questions #241](open-questions.md)
and [lessons-learned.md](lessons-learned.md) (session 97) for the process fix.

**Session 98 (2026-09-12, autonomous) — stacked on PR #14, nothing merged in that session:** (d) the public face + gallery is BUILT (PR #18,
ADR 046); R9.1 the full phone walk is DONE with fixes (PR #19); the creator-e-mail lookup for Live embeds is BUILT
(PR #15, stacked on PR #9). Still not built: phase 2 / R3 (owner go), decision 5, the 028 apply, the audit re-run,
Eurostat. See [session-briefs/2026-09-12-session-99-kickoff.md](session-briefs/2026-09-12-session-99-kickoff.md).

**Session 99 (2026-09-12, owner present) — MERGED + LIVE:** PR #14 (phases 0/1/3/4/5, squash `677c5fb`), PR #18 (public
face + `/galerij`, `ac14392`), PR #19 (phone journey, `189d36b`), PR #20 (docs line + `scripts/dev-harness/`, `524b63f`),
PR #9 (embed, `650d664`) and PR #15 (creator-e-mail lookup for Live embeds, `8d0f0d4`) — all squash-merged
to `main` in that order, each on a green `gate`. **Still open for the owner after the merges:** apply migrations 028 + 029
(`npm run db:migrate`, live DDL — owner-supervised), run `npm run usage:report` once, read/fill in `/werkwijze` + `/privacy`,
set `EMBED_TOKEN_SECRET`, the one-line `auth.users` read check (RUNBOOK) for Live, and say go/no on R3 (phase 2 — still NOT
built, by rule). Phase 6 (re-measure) waits for real usage.

**Session 101 continued (2026-09-13, owner present) — phase 2 / R3 BUILT on branch `journey-r3-fetch-confirm`, PR #21 open, CI green, NOT merged (branch + PR + owner review required for this one even though the owner is present in the session, per the rule below).** The confirm-first chip before the 100-credit on-demand fetch (#109's reversal, decisions 4-5 answered directly in chat — see [open-questions #109](open-questions.md)) and its full mechanism (a signed, stateless offer token, no database change) are recorded as-built in [ADR 026](decisions/026-on-demand-fetch-job-architecture.md)'s addendum. New required secret, not yet set anywhere as of PR open: `ONBOARDING_OFFER_SECRET` (RUNBOOK Secrets register) — until the owner sets it, the feature fails closed to an honest "not available right now" message, never a silent revert to the pre-#109 automatic-charge behavior; the owner confirmed in chat that it has since been set. Decision 5 (larger signup grant) was answered **no** — no config/schema change. Full verification green before the PR opened (typecheck ×2, backend 149 files/2273 tests, web 104 files/1693 tests, hermetic benchmark, real build, two LOW code-review passes) and again in CI (`gate` run `34745805896`, `mergeable_state: clean` at that check). **Same-day wrap-up addendum:** the session's own docs-only wrap-up commit to `main` (`ac08356`) touched several of the same doc sections and briefly flipped PR #21 to `mergeable_state: dirty`; fixed same session by merging `main` back into `journey-r3-fetch-confirm` (a merge commit, no rebase) and re-pushing. **Second addendum:** that same wrap-up also introduced six live `github.com/.../pull/21` links across docs/ (this paragraph included), which is exactly what CI's `test:docs` suite exists to catch (#132 interim rule (i) — a live PR link 404s once #132 route (b) recreates the repo); fixed and re-pushed (`4a9c8eb` on `main`, merged into this branch) — the feature code diff itself was untouched throughout. **✅ MERGED 2026-09-14 (`eb15838`), CI green, deployed, smoke check passed.**

**Order / rule:** phase 0 → 1 → 2 → 3 → 4 → 5 → 6, the positioning items in parallel where they need no code. Owner present → direct push to `main` after the full verification block; autonomous → branch + PR ([#118](open-questions.md)(b)); **R3 always branch + PR + explicit owner go.** PR #9 (embed, `MERGEABLE`/`CLEAN` as of 2026-09-11 06:03 UTC) should merge before phase 3 so the "Publiceer" step has something real to point at.

## 3D municipality map DEMO — NOT a work package, out of the product flow deliberately (session 103, 2026-09-15, [ADR 049](decisions/049-3d-municipality-map-demo.md))

**Owner-approved after seeing a reference site he built himself; built autonomous (owner away), branch `demo-3d-municipality-map`, independently code-reviewed (7 findings fixed), MERGED + LIVE (`49cd975`) on the owner's explicit instruction.** Not numbered as a WP and not part of the phase checklist above on purpose — it is a standalone, login-gated, noindexed, unlinked demo page (`/bevolking-3d-demo`) over entirely FICTIONAL data (real CBS/PDOK municipality boundaries + names only), built as the owner-approved one-off exception to the zero-library rule (`three`+`@types/three`) that ADR [044](decisions/044-story-stage.md)'s kickoff had already ruled OUT of the real product ("a 3D chart makes equal values look unequal … a WebGL canvas is invisible to every honesty scan and to the export"). All 8 plan tasks built via strict TDD (failing test → run → implement → run → typecheck → commit, one commit per task): the fictional dataset generator (name-blind, deterministic, not tuned to any real place), a hand-rolled TopoJSON decoder + NL projection, the growth colour scale on the house palette, the boundary asset + dependency add, extruded column meshes, the WebGL scene (on-demand render loop, tween, orbit controls, raycast pick, dispose), the banner/component/digit-lock, and the noindexed login-gated page with bundle/product/discoverability isolation tests. `git diff --stat main -- src/ tests/ benchmark/ migrations/` is EMPTY — the real product, its tests, the benchmark and the invariant suite are byte-untouched. Full verification block and measured bundle numbers recorded in ADR 049 and the PR description. Never becomes a real feature without its own separate design round that re-answers the 3D-distortion and WebGL-invisible-to-honesty-scans objections — see ADR 049's revisit triggers.

## Journalist chart headline — session 105 (2026-09-16), [ADR 050](decisions/050-journalist-chart-headline.md)

**Owner priority pivot ("back to standard graphs instead of storytelling") → [#253](open-questions.md) checked and confirmed still blocked (no region-set query capability) → [#254](open-questions.md)'s headline gap picked instead, owner present.** (Accurate as of session 105; the region-set query capability was later built — see the WP253 entry near the end of this file and ADR [054](decisions/054-region-set-query.md).) Design approved in chat (spec:
[superpowers/specs/2026-09-16-chart-journalist-headline-design.md](superpowers/specs/2026-09-16-chart-journalist-headline-design.md)), then built end-to-end via subagent-driven development in one session: migration 031 (`chart_headlines`, FILE-ONLY) + GDPR retention, an ownership-guarded store module, AI drafting that reuses the existing Insights digit-free mechanism (plus a real bug fix along the way — `src/chart/insights.ts` gained `topFinding()`, since `scoreFindings(spec)[0]` turned out to be chronologically-first, not highest-scored), three Server Actions, i18n strings, the chat UI (draft/edit/save/display — this task also caught and fixed an already-merged, build-breaking curly-quote syntax bug from the i18n task), the public embed page, and PNG/SVG export. Final whole-branch review found 3 real Important issues (an export-wrap overflow, a line-height collision, and — the most serious — a raw character-slice that could truncate a filled-in NUMBER mid-digit); one fix wave resolved all three, independently re-verified including a hand-traced example proving the number-truncation fix. Full verification block green: benchmark gate 14/14 + 6/6 + 0 fabricated, full backend + web suites, real `next build`. **✅ MERGED to `main` (`7bf76ff`, CI + deploy green) and migration 031 applied live with the owner's explicit go-ahead, verified against production (RLS on, zero `anon`/`authenticated` grants). The feature is fully live.** Two things still genuinely open for the owner, not decided during the build: whether a headline should be visually marked as journalist-written vs. a validated figure, and whether a published headline should be retractable (today: editable, not removable short of deleting the chat).

## Chart alternate-reading toggle — sessions 106→107 (2026-09-16), [ADR 051](decisions/051-chart-alternate-reading-toggle.md)

**[#254](open-questions.md)'s second genuine gap ("context controls: level vs. %-change,
seasonally-adjusted vs. raw") picked as session 106's work, continuing autonomously in an
owner-present chat.** Design corrected against the real registry before build (the original kickoff
under-counted it by 20x — see the design spec) and built via subagent-driven development in an
isolated worktree: a shared `buildAlternateReading` function (replacing `curated.ts`'s narrow
inline version, now merging dims over the primary's own resolved coordinates instead of replacing
them), `AnswerResponse.chartAlternates` threaded through the answer pipeline, the chat client, and
`ChartViewState`'s reducer, a reading-toggle control on `ChartView` that swaps data without
tripping the spec-identity reset, and an Embed-disable addendum for when a non-primary reading is
shown. Session 106 built Tasks 1-5 plus a standalone period-code-match guard fix, all task-scoped
reviews clean, then paused mid-Task-6 on an owner wrap-up signal. **Session 107 resumed from the
SDD ledger**, finished Task 6 (the task reviewer's one finding — the anonymous trial chat
(`trial-chat.tsx`) wasn't wired despite already carrying the data — was fixed on the owner's
explicit choice, reversing the design doc's original deferral), then ran Task 7 (a full
whole-branch diff read, the complete verification block, a LOW `/code-review` pass, and this doc
update). **Full verification green: backend 158 files/2395 tests, web 116 files/1844 tests,
benchmark gate 14/14 + 6/6 + 0 fabricated, real `next build`, both typechecks clean, `/code-review`
LOW clean.** ~20 registered concepts (inflation, population, housing stock, GDP growth,
bankruptcies, household income, imports/exports, retail turnover, house prices, unemployment, and
others) now show a real toggle in chat, dock, and the trial. Level-vs-%-change stays open — it
needs a new registered derivation and an ADR 011 revision, a separate future design task.

## Period-over-period percent-change alternate reading — ACCEPTED + MERGED (2026-09-17), [ADR 052](decisions/052-period-over-period-percent-change.md)

**The level-vs-%-change half of [#254](open-questions.md) named above, built end to end (design +
implementation + tests + full verification block) in an isolated worktree, then reviewed via ADR
052's four open questions — the owner delegated the decision on all four to the parent session
rather than answering each himself.** A new registered `period_change` `DerivationRecord` kind
(src/query/types.ts) + its computing function `derivePeriodChangeSeries`
(src/query/derivations.ts, ADR 011 addendum) compute period-over-period percent change over an
already-answered, single-region LEVEL series — refusing the whole series on a null cell, an
irregular/gappy/mixed-grain period sequence, or a zero/negative previous-period base (never a
fabricated or misleading percentage). A new pure module, `src/chart/period-change.ts`
(`buildPeriodChangeReading` + `isPeriodChangeEligible`), is a DIFFERENT mechanism from ADR 051's
`buildAlternateReading` — no re-query, a transform of the primary's own already-fetched cells — and
is wired into the SAME `chartAlternates` dropdown ADR 051 built, as one extra entry, for 7
hand-curated canonical measures (`PERIOD_CHANGE_ELIGIBLE_KEYS`, src/registry/defaults.ts) with no
CBS-published mutation sibling: population, housing stock, average home price (national and
per-gemeente), bankruptcies, solar production, disposable household income. The reading's label
states which previous period it compares against ("t.o.v. vorig jaar"/"vorig kwartaal"/"vorige
maand", derived from the series' own `PeriodGrain`) — an owner-delegated refinement over the
original generic "vorige periode" wording. No migration, no schema change, no live DDL — the
eligibility list is a plain code constant. A separate, related follow-up
(`producer_price_index_level`'s own missing ADR 051 alternate) was investigated and consciously
NOT built in this change: a real companion measure code exists, but wiring it would invalidate the
intent parser's recorded LLM fixtures project-wide (confirmed empirically, not just read from a doc
comment — see ADR 052's "PPI alternate" section) — that needs its own owner-supervised session
budgeting for a real fixture re-record, logged in [#254](open-questions.md). Full reasoning for the
eligible/excluded split, and the full record of the owner-delegated decisions, is in ADR 052.
**Full verification green (measured 2026-09-17, after the owner-delegated label refinement and
rebase onto `main`'s migration-collision-check work, `eeae1b2`): both typechecks clean, backend 167
files / 2500 tests, web 117 files / 1854 tests, `benchmark:run` + `benchmark:score` = 14/14 + 6/6 +
0 fabricated, real `next build` green, `/code-review` LOW clean.**

*When a WP completes: tick it in [STATUS.md](STATUS.md), record measured results, and — if a design decision here changed — update this file so it stays the plan of record.*

## Session 110 (2026-09-17) — fully autonomous, three waves of subagents, 20 branches merged to `main` in one verified batch

**Owner instruction:** "work for hours autonomously, use subagents, make the web app finished, do not ask me
questions." The parent session read every open row, dispatched 19 subagents across three waves (own
worktrees; cheap tier for mechanical work, higher tier for design, invariant-heavy query work and the UX
audit), merged every branch locally, ran the verification block ONCE, then pushed (`2bdbb4c`, CI run
`35196289551`). **Measured:** backend 180/2666, web 117/1933, benchmark 14/14 + 6/6 + 0 fabricated, real
build, `/code-review` LOW 0 findings.

**Landed (see [status-archive.md](status-archive.md) session 110 for the per-item account):** the WP253
region-set query tasks 1–8 (entry above; Task 9 owner-supervised); a Playwright UX audit
([session-briefs/2026-09-17-session-110-ux-audit.md](session-briefs/2026-09-17-session-110-ux-audit.md)) with
21 of its 25 findings fixed; chart export PDF + transparent PNG ([ADR 053](decisions/053-chart-export-formats.md));
#23 missed-sync + health-probe alerts (all four triggers built); #254(a), #262(c)/#229, live-embed
alternates, #216, #134(c), the 16–40-series hbar default, and #245 Action 3 (test-DB reset helper, 4x).

**Process (reusable):** worktrees created BY THE PARENT from local `main` (`git worktree add … -b s110/x main`
+ `node_modules` symlinks) so later waves build on earlier merges; briefs name the FILES each agent may not
touch; "no backgrounding" stated up front; agents report what they saw and did not do — each such note became
a follow-up agent and several found real bugs. Lessons: [lessons-learned.md](lessons-learned.md) session 110.

**Waves 4–14, same session (the entry above describes waves 1–3; the full per-wave account is the
session-110 entry in [status-archive.md](status-archive.md)):** four more Playwright UX audits through
the hermetic harness (which gained an intent injector and a Eurostat fixture table so it could reach
region-set, multi-region and explorer surfaces), an axe-core pass and a verification-only pass — every
mechanical row fixed, incl. two P1s (the proof panel missing on every STORED answer; the default
region-set chart naming no region); a 7-test Playwright smoke as a hard CI gate; a SECOND core shape,
the multi-region time series (**WP-MRS / [ADR 055](decisions/055-multi-region-series.md)**, parser-
reachable in production with zero fixture changes) plus its "trend per region" chip; zod out of the
chart render path and a route split (anonymous first-load JS −374 KB then −222 KB raw); a security read;
README/RUNBOOK refresh; the fifth open-questions triage. Final measured: backend 188/2769, web
121/2108 (+7 e2e), benchmark 14/14 + 6/6 + 0 fabricated, real build, review clean each push.

**Next:** owner steps (registry:apply, DOI backfill, live benchmark + live `audit:verify` for ADR 055
(#270), Task 9 (#267), audit rows: pass-1 22, pass-2 19, #271); WP30c E2 after #250(a); the
203 KB workspace chunk's own interaction-only split (client-side, per the diagnosis brief).

## Session 109 (2026-09-17) — six parallel subagents on standing open-questions items, ALL MERGED to `main` in one verified batch

**Owner instruction (verbatim intent): "spawn a bunch of sub-agents … do not ask me questions, do whatever
you feel is right."** With no owner-queued priority (same as sessions 108/109 kickoff), the parent session
picked the six most buildable, mutually independent rows from [open-questions.md](open-questions.md), scoped
each to its real risk, and dispatched them concurrently (mechanical work on the cheap tier, the one shared
live-path file change on a higher tier, each in its own worktree). The parent merged every branch itself,
resolved the three predicted doc/test conflicts, ran the full verification block ONCE serially, ran
`/code-review` LOW over the whole merged diff (0 findings), and pushed. Per-item as-built notes live in the
rows and ADRs named here; the measured numbers are in [STATUS.md](STATUS.md)/[status-archive.md](status-archive.md).

- **[#264](open-questions.md) Eurostat DOI — ✅ BUILT.** `registerTables` constructs `10.2908/<CODE>` for
  `source = 'eurostat'` rows and writes it only after one out-of-band DataCite `findable` confirmation
  (`src/eurostat-adapter/doi.ts`; ADR [048](decisions/048-eurostat-data-source.md) third addendum). CBS rows
  never fetch, never get a DOI. **Owner step, not run:** `npm run backfill:eurostat-doi -- --apply` for the
  already-registered `eurostat:tipsbd30` row (RUNBOOK § DOI backfill).
- **[#251](open-questions.md) per-cell status — ✅ BUILT.** Optional `CbsObservationRow.status` override in the
  narrow waist; Eurostat emits the JSON-stat flag verbatim (unflagged → `'Published'`, the registry's single
  `definitiveStatuses` value; every flag incl. `c`/`:`/`n`/`z` stays provisional); CBS path byte-identical, pinned.
  Unblocks WP30c E2 on the provisional-marking axis (ADR 048 fourth addendum; `05-data-rules.md` R11 clause).
- **[#246](open-questions.md) Pro-bucket cost caption — ✅ BUILT.** `getQuestionHistory` and `getThreadRows`
  now net `pro_bucket_ledger` debits/compensations (incl. the derived websearch/dataset add-on ids) into the
  displayed cost; non-Pro users byte-identical (pinned). Display-only; unreachable until `PRO_SUBSCRIPTIONS_ENABLED`.
- **[#252](open-questions.md) live-chat proof URLs — ✅ BUILT.** `askQuestion`/`replyToClarification` return
  `proofRequestUrls`, computed server-side AFTER the answer is settled and debited, fail-open; the live turn's
  proof panel now shows "Opgehaalde URL's" like replay/history do (ADR 048 D7(b) note).
- **[#23](open-questions.md) ingestion alerts — ✅ BUILT (batch failures + quarantines).** At most one Resend
  admin email per `ingest sync` run or per terminally-failed onboarding-cron row, reusing `sendAdminAlertEmail`;
  fail-open, silent when env is unset. Missed-sync and `/api/health` alerting remain open (RUNBOOK § Ingestion alerts). **→ both BUILT session 110 (see the session-110 entry above).**
- **Research (docs-only): [#253](open-questions.md)** — verified the region-set query capability still does not
  exist; the row now carries a concrete minimal build scope. **[#254](open-questions.md)(a)** — all three
  household-income alternate concepts verified eligible for `period_change` from the committed 83932NED fixtures;
  extending needs a per-alternate eligibility marker (the key set is primary-only) and invalidates no LLM fixtures.

**Not done, deliberately:** the `tipsbd30` DOI backfill (live DB write → owner); #254(b) PPI fixture re-record
(real spend → owner); #245 Action 3 (waits on the owner's three sub-questions); #250(a) Dutch wording sign-off.

## WP253 — region-set query (session 110, 2026-09-17)

**Scope:** answer "one measure, one period, a SET of regions" — a set given as a region CLASS (all
provincies, all gemeenten, the gemeenten of one provincie), not just an explicit list of named
regions — the capability [#253](open-questions.md) names as the precondition for any map/geo chart.
Design: [docs/superpowers/specs/2026-09-17-region-set-query-design.md](superpowers/specs/2026-09-17-region-set-query-design.md).
Plan + full per-task as-built notes: [docs/superpowers/plans/2026-09-17-region-set-query.md](superpowers/plans/2026-09-17-region-set-query.md).
As-built decision record: ADR [054](decisions/054-region-set-query.md).

**Built (Tasks 1–8, all hermetic, no real LLM spend):**
- **Task 1** (`s110/253-region-set-query`) — `resolveRegionSet` (`src/query/region-set.ts`): reads
  the roster of a region CLASS from `dimension_labels.dimension_group`, never a hardcoded list,
  never guessed (an empty/unverifiable `GM<pv>` group refuses rather than falling back to a
  code-prefix scan). Deviation: "alle gemeenten" on `03759ned` measured at **834** codes, not the
  design's estimated 835 (`GM0997` correctly excluded).
- **Task 2** — `StructuredIntent.regionSet` (additive, `INTENT_SCHEMA_VERSION` stays `1`) + the
  resolver branch in `resolve.ts`. The one-varying-axis rule is **not relaxed**.
- **Task 3** — the `region_set` fetch branch + coverage record (`ValidatedResult.regionSet`) in
  `run.ts`: applicable/withheld cells are served; not-applicable (CBS `Impossible`) and missing
  members are disclosed, never silently dropped. Deviation: `REGION_SET_MAX_MEMBERS` (500) caps
  SERVED cells, not roster size (the design's wording was ambiguous; the as-built code resolved it
  explicitly, since a roster-size cap would have wrongly refused "alle gemeenten" outright).
- **Task 4** — `deriveRegionRanking` (RS1): a ranking derivation exists only when the served set is
  complete; an incomplete set produces no derivation at all, so R9 refuses any ranking claim by
  construction. Reuses `deriveMax`, no new `DerivationRecord` kind.
- **Task 5** (`s110/rs5`) — `region_set` charts as `kind: 'bar'` (no new chart kind); series order
  follows the ranking derivation's own order, or the query layer's own cell order with no ranking
  record — never a builder-invented sort.
- **Task 6** (`s110/rs6`) — the deterministic (zero-LLM) answer body (`renderRegionSet`, a summary
  when complete, the full per-member list when incomplete), the structural coverage-disclosure line
  (`regionSetLine`, outside the R1-scanned body), and a new refusal, `region_scope_on_national_measure`,
  for a class ask on a measure CBS only publishes nationally. Deviation from the design: this landed
  as an answer-layer `RefusalReason` + a new `QueryRefusal.refusal.subReason`, not an intent-layer
  `ResolutionFailure.reason` — the intent layer never sees this case. **Real bug fix along the way:**
  before this, the case would have served as the generic `internal` refusal, which pages the owner
  on every occurrence.
- **Task 7** (`s110/rs7`) — R8 reconstruction: `regionSetLine` re-derives byte-identically (a real,
  previously-latent bug — `reconstruct.ts` had no entry for it at all before this task), the coverage
  record is checked through the line it determines (never re-resolved against today's data), region-set
  BODIES are `rederived` (not merely `revalidated`, a deliberate strengthening — this is the one shape
  with a fully deterministic ground truth), `subReason`↔`reason` pairing is checked both directions, and
  a new ingestion conformance test (`tests/ingestion/region-set-groups.test.ts`) guards the `GM<pv>`
  group-naming assumption per registered geo table.
- **Task 8** (this entry + ADR 054 + the doc updates it lists) — docs.

**Not built — Task 9, owner-supervised, real LLM spend, deliberately deferred:** exposing
`regionScope` through the intent parser (`rawCandidateSchema` + its duplicate in
`rawParseSchemaWith`, `PROMPT_VERSION` 6→7 with a narrowly-scoped Regions rule, `RAW_PARSE_VERSION`
3→4) and re-recording 103 fixtures (`intent`, `followup`, `clarify`, `onboarding-delivery`) plus 5
new labelled benchmark cases. **Until Task 9 runs, this capability is unreachable by any real user
question** — everything above is hermetically built and tested against hand-authored intents only.
Procedure (verbatim from the plan): code + labelled cases → `intent:record` → `clarify:record` /
`followup:record` / `onboarding-delivery:record` → `intent:eval --repeat=3` checked against ADR 012's
0.9/0.35 thresholds → the full verification block (typechecks, all suites, benchmark 14/14 + 6/6 +
0 fabricated, real build) → `/code-review` LOW → push.

**Invariants:** R1/R5/R9 (RS1's ranking-honesty mechanism), R6 (verbatim chart projection, no
builder-invented sort), R8 (full reconstruction incl. the new refusal pairing), R11 (withheld cells
keep their CBS reason), principle (a) (the LLM never enumerates region codes — Task 9 will teach it
to classify a CLASS, never emit a list), principle (c) (never guess a roster; an incomplete class
answers honestly, never with a suppressed gap).

**Owner-delegated decisions (2026-09-17), full reasoning in ADR 054:** (1) an incomplete region class
answers without ranking words, never refuses outright; (2) "alle landsdelen" stays an honest
`outside_loaded_slice` refusal, no ingest-slice widening now; (3) two regional canonical measures are
enough to ship; (4) a fully deterministic (zero-phrasing-model) answer is accepted for this shape;
(5) the bar chart ships first, the map stays a separate, later decision.

**Done-definition:** MET for Tasks 1–8 (every task's own hermetic test suite green, `npm run
typecheck` clean at every step — see the plan's per-task "Measured at the end of task N" notes for
exact counts; the full backend/web suites and a live benchmark run were not re-run as one combined
pass in this docs-only task). **NOT MET** for the WP's own end-to-end goal ("a journalist can ask
this in chat") until Task 9 ships — tracked as its own, explicitly owner-gated step, not a residual
bug.

## WP-MRS — multi-region time series (session 110, 2026-09-17)

**Scope:** answer "one measure, 2–6 EXPLICITLY NAMED regions, a period range" — one line per region,
each region's own first/last/direction, no cross-region claim — the relaxation UX-audit pass-3 rows
[13 and 14](session-briefs/2026-09-17-session-110-ux-audit-pass3.md) named, and make small multiples
reachable from a real CBS answer for the first time.
Design: [docs/superpowers/specs/2026-09-17-multi-region-series-design.md](superpowers/specs/2026-09-17-multi-region-series-design.md).
Plan + full per-task as-built notes: [docs/superpowers/plans/2026-09-17-multi-region-series.md](superpowers/plans/2026-09-17-multi-region-series.md).
As-built decision record: ADR [055](decisions/055-multi-region-series.md).

**Built (Tasks 1–7, all hermetic, no real LLM spend):**
- **Task 1** (`s110/mrs12`) — the new `ResultShape` member `'region_series'`, `RegionSeriesCoverage`,
  the caps (`REGION_SERIES_MAX_REGIONS = 6`, `REGION_SERIES_MAX_CELLS = 500`), and the conditional
  resolver gate in `resolve.ts`. Deviation: an existing `tests/query/query.test.ts` pin that used
  exactly the newly-accepted case was re-pointed at the still-refused over-the-cap case; the
  one-varying-axis check moved to AFTER the derivation-arity switch, so `difference`/`max` over
  several regions now reads as a derivation-arity refusal rather than the generic scope limit.
- **Task 2** (`s110/mrs12`) — `run.ts`: the partition into `requested`/`partial`/`excluded`, per-region
  `deriveDirection`/`deriveFirstLast` slices (never the whole cell array — `checkSingleRegion` is what
  makes a slice the only legal input), `deriveMax` explicitly excluded from this shape, and the
  all-or-nothing floor (`diagnoseMissing`) below 2 surviving regions. Deviation: three existing answer
  suites that built a 2-named-region-over-a-range intent and asserted REFUSAL turned red the moment
  this shape started answering it (measured, not a bug in `src/`) — re-pointed in Tasks 4 and 6.
- **Task 3** (`s110/mrs3`) — `buildChartSpec` emits `kind: 'line'` (not `null`) for this shape, one
  series per region in intent order; the one real web-side gap, `web/lib/answer-proof.ts`'s
  `derivationStep`, now names each region in its own direction row instead of producing N identical
  rows.
- **Task 4** (`s110/mrs4`) — `renderRegionSeries` (deterministic, zero-LLM body), `buildRegionSeriesLine`
  (the structural coverage-disclosure line, outside the R1-scanned body), and the re-worded
  `multi_region_multi_period` refusal (the old wording had become false for named regions). Found and
  fixed a real MS1 hole here, not only in Task 5: a `region_series` with only ONE complete region
  carried only one trend candidate, so a hand-written clause about the OTHER (partial) region could
  silently borrow the complete region's backing — closed by gating on the result's own distinct
  region count, not the candidate list's.
- **Task 5** (`s110/mrs5`, built independently, merged first) — the validator fix:
  `trendBacking` (took the first `direction` record unconditionally) replaced by
  `trendCandidates`/`resolveTrendBacking`, so a multi-region result's trend clause must name exactly
  one region and bind to that region's own candidate. An ordinary single-region result (including a
  B13-style two-candidate case) is byte-identical to before — a real regression caught and fixed
  mid-build, not merely anticipated.
- **`s110/mrsline`** (between Tasks 4 and 6) — closed a real gap Task 4 flagged: `regionSeriesLine`
  (like ADR 054's `regionSetLine` before it) was assembled into `answer.text` but not read by the
  field-by-field answer views (`web/lib/chat-message.ts`, `web/components/chat.tsx`,
  `web/lib/copy-answer.ts`, `web/lib/replay-assemble.ts`, `src/threads/replay.ts`) — fixed in the same
  pass as the sibling `regionSetLine` fix.
- **Task 6** (`s110/mrs6`) — R8 reconstruction: the coverage line re-derives (checked THROUGH the
  sentence, never re-resolved against today's data), the body re-derives byte-identically (the shape
  gate widened from `region_set` alone to `region_set || region_series`, keeping the `region_set`
  problem strings byte-identical for the audit divergence register), manifest rows for both new keys
  (measured RED — 3 failed/7 passed — before this task, green after).
- **Task 7** (this entry + ADR 055 + the doc updates it lists) — docs.

**Invariants:** R1 (structural exemption only), R3, R5, R6 (verbatim chart projection, spec order is
render order), R8 (full reconstruction), R9, R10, R11 (withheld cells keep their CBS reason), **MS1**
(no trend claim without a same-region derivation record, no cross-region claim of any kind),
principle (a) (the LLM never enumerates region codes — none of this touches the intent contract),
principle (c) (a named region is never silently dropped to fit a cap; a gap is disclosed, not
guessed).

**Owner-delegated decisions (2026-09-17), full reasoning in ADR 055:** (1) the region cap is 6, not
the more conservative 4; (2) a named region with a gap answers the others and discloses the gap,
rather than refusing the whole ask; (3) a fully deterministic (zero-phrasing-model) answer is accepted
for this shape too, as ADR 054 already established for `region_set`.

**Done-definition:** MET for Tasks 1–7 (every task's own hermetic test suite green, `npm run
typecheck` clean at every step — see the plan's per-task "As-built notes" for exact counts; `npm run
audit:verify` against the live DB was not run in any hermetic worktree task, reasoned correct from the
code since the shape is forward-only). **NOT MET** for the live-LLM confirmation: no recorded fixture
of the 72 `intent`/23 `followup`/7 `clarify` fixtures scanned carries ≥2 regions and a range period,
so a `npm run benchmark:run:live` pass against this shape is the real go/no-go and has not yet been
run — owner-supervised spend, tracked as its own step, not a residual bug. Unlike WP253/ADR 054, this
capability needs **no** further parser work to become reachable — it already is.

## Chart co-pilot — chat and direct controls interleaved on one chart (owner decision 2026-09-17/18, session 111; ADR [056](decisions/056-chart-copilot.md), spec [superpowers/specs/2026-09-17-chart-copilot-design.md](superpowers/specs/2026-09-17-chart-copilot-design.md)) — phases 1 + 2 + 3 + 4 + 5 + 5b BUILT and MERGED (sessions 112/113/114/115/116/117-118); the six house styles + homepage themes row ([#275](open-questions.md)) and scatter ([#296](open-questions.md)) are the two live, NOT-yet-started candidates for what's next — no single one is mandated

**Why now:** the owner lifted the session-88 deferral of [#212](open-questions.md) ("chat-driven chart editing waits for usage evidence") — the focus is chart quality and specifically editing by chatting, "door elkaar heen" with the existing controls, "dat het echt een fijne UX is". Research that shaped it: [session-briefs/2026-09-17-competitor-g-deep-dive.md](session-briefs/2026-09-17-competitor-g-deep-dive.md).

**Invariants at stake:** R1/R6/R11 for the CBS tier (commands never carry numbers; `windowSpec()` stays a verbatim copy; narrate output passes the digit scan); ADR 037's tier separation; ADR 032 (web findings never become chart data). Cheapest-mechanism rule: phase 1 has zero LLM calls.

**Phases (each its own SDD plan; build order = this order):**
1. **Command log + undo/redo + in-place title/caption editing + account persistence — BUILT (session 112, 7 tasks via subagent-driven development, merged to `main` `7a9b737..3c295f1`, CI run 35306079885 green incl. deploy, live).** `web/lib/chart-commands.ts` (pure), the existing reducer actions became command kinds (incl. two inverse-only kinds, `setSeriesView` and `replacePresentation`), one gesture = one history entry with a transient/seal contract for drag-style controls, ⌘Z/⇧⌘Z/Ctrl+Z/Ctrl+Y plus buttons, `web/components/chart-history-menu.tsx` (click an entry to jump to it), in-place title/caption editing; `chart_edits` table via migration 034 (file-only, owner-supervised apply pending — see [RUNBOOK.md](RUNBOOK.md)) + a GDPR retention leg added to all three `hardDeletes[]` call sites in `src/answer/audit/retention.ts` ([#274](open-questions.md)). Zero model calls, as planned. Measured at merge: whole `web` suite 129 test files / 2166 tests passed (`cd web && npx vitest run`), all 17 root suites green, benchmark 14/14 + 6/6 refusal + 0 fabricated, both typechecks clean, `next build` clean, `/code-review` LOW 0 findings, one Playwright e2e (hide → Undo → Redo → keyboard shortcuts → reload → still hidden) passed. Known limits: the journalist headline is not on this history; the public embed page does not read `chart_edits` yet — see ADR 056's "As built — phase 1" section and [open-questions #277](open-questions.md)/[#278](open-questions.md). Phase 2 (own-data co-pilot, the chat doorway) is next.
2. **Own-data co-pilot — BUILT (session 113, 2026-09-18, nine tasks via subagent-driven development on branch `copilot-phase2`, plan [superpowers/plans/2026-09-18-chart-copilot-phase2.md](superpowers/plans/2026-09-18-chart-copilot-phase2.md)).** Instruction schema v2 (aggregate + the fixed derived set, sort by value) computed by the executor with traceable rowRefs; the shared card shell (persistence hook, history actions, editable text, legend) on both cards; the own-data card with form switch, style panel, notes, title/caption, a Data panel (doorway A) and the "Pas deze grafiek aan" chat doorway (one cheap-tier call, label→key mapping + digit guard server-side, `validateCommand` client-side, recipe chips, per-reply Undo/Retry/👍👎, three example chips); `chart_edits` keyed by the dataset turn (migration 035, file-only); hand-authored LLM fixtures + `attachments:fixtures`/`attachments:record`; Playwright proof `web/e2e/own-data-copilot.spec.ts`. As-built detail: ADR 056 § "As built — phase 2". **Owner steps:** apply 034 + 035, run `attachments:record` once, flip `ATTACHMENTS_ENABLED` (RUNBOOK).
3. **CBS/Eurostat co-pilot — BUILT (session 114, 2026-09-18, four tasks via subagent-driven development in two worktree waves + one fix round, plan [superpowers/plans/2026-09-18-chart-copilot-phase3.md](superpowers/plans/2026-09-18-chart-copilot-phase3.md); merge/deploy status in [STATUS.md](STATUS.md)):** the same `ChartCopilotInput` on the CBS card, a selection-only schema (`src/chart/copilot/`), labels→keys by lookup, digit guard over the spec's own strings, `chart-edit-gate` at the `clarification` price through `question_cost` (no DDL, no audit row); a data request becomes a one-click follow-up question and a compatible follow-up card is badged "Grafiek uitgebreid" wearing the previous card's look ([#285](open-questions.md)–[#288](open-questions.md)). See ADR 056 "As built — phase 3".
4. **Storytelling primitives — BUILT (session 115, 2026-09-19, 8 tasks via subagent-driven development, plan [superpowers/plans/2026-09-19-chart-copilot-phase4.md](superpowers/plans/2026-09-19-chart-copilot-phase4.md); final whole-branch review found + fixed 1 Critical security hole + 10 Important cross-task findings; merged to `main` `edbf6d30..041d3a49`).** Six primitives, CBS/Eurostat card first (own-data support deferred, [#289](open-questions.md)): goal line (reader-typed value, drawn as a `<ReferenceLine>` with no `label` prop so the typed text never enters an export, matching era shading's own `<ReferenceArea>` precedent); era shading (reader-marked period range + typed label, same export-safety pattern); dim-not-hide (a third shown/dimmed/hidden series state, on both the CBS and own-data cards); a reader-chosen headline number (click any point to feature it, falls back to the default on a zoom/reading where the override isn't present); a difference arrow and an average line (computed server-side, on demand, via `requestChartDerivation` re-running a registered R5 derivation over an already-audited chart's own cells — no new CBS fetch, no new audit row, never in the browser). **Not yet built:** chat-doorway reachability for any of the six ([#289](open-questions.md)) — phase 4 shipped panel-only, chat-second is a later step, not skipped scope.
5. **Chart-fit scorer + dumbbell/slope/heatmap — BUILT (session 116, 2026-09-19, 5 sequential tasks via subagent-driven development — a single worktree, one implementer at a time, `chart.tsx` proved too fragile for parallel edits — plan [superpowers/plans/2026-09-19-chart-fit-scorer-phase5.md](superpowers/plans/2026-09-19-chart-fit-scorer-phase5.md); final whole-branch review found + fixed 2 Important cross-task bugs; merged to `main` `dfdaee18..8abd187c`).** A rule-based (no LLM) scorer, `web/lib/chart-fit.ts`'s `allowedForms`, that both the on-screen tab switcher and the CBS chat co-pilot's capability list read from — the one place "is this shape honestly offered" is answered. Three new forms, CBS/Eurostat card only ([#295](open-questions.md)): slope (zero new render code — reuses the line chart verbatim, since a slope chart IS a 2-point line chart); dumbbell (a new `DumbbellOverlay`, reusing the existing `EndLabelsOverlay` hook mechanism rather than an unproven Recharts feature); heatmap (a plain CSS grid over the table form's own rows, discovered mid-build to require inheriting ~17 separate gates the table form has for its surrounding UI). **Split out of scope, decided by the owner before any code was written** ([#296](open-questions.md)): stacked, 100% stacked, scatter, and pie/donut need real new capabilities that don't exist yet (a two-measure-per-point chart spec; a "verified whole" concept in the query/registry layer) — [ADR 039](decisions/039-chart-presentation-panel.md)'s existing refusal of all four is unchanged, not revisited by this phase. See ADR 056 "As built — phase 5".
6. **Phase 5b — the "verified whole": pie, stacked, 100%-stacked — BUILT and MERGED (design session 117 2026-09-19/20, build session 118 2026-09-20, 5 tasks via subagent-driven development, plan [superpowers/plans/2026-09-19-verified-whole-phase5b.md](superpowers/plans/2026-09-19-verified-whole-phase5b.md); final whole-branch review (opus) found + fixed 1 Important cross-layer gap; merged to `main` `90b786f6..c7723c34`, CI green).** Picks up one of the two capabilities phase 5 split out. Region hierarchies only (provinces/landsdelen/gemeenten-of-a-province — the one place CBS already vouches for a complete set); verification on demand, server-side, the same "Option A" pattern as phase 4's difference/average, no new CBS fetch. Donut stays a presentation variant of pie. Scatter remains untouched, still deferred ([#296](open-questions.md)) — it needs its own two-measure-per-point chart-spec shape, a separate capability this phase never touched. The final review's one real finding — an incomplete region roster (a member with no observation row at all) was invisible to the sum check and could pass within tolerance on a small-gemeenten roster — was closed with a coverage gate mirroring the existing `deriveRegionRanking` precedent, before merge. See ADR 056 §"Phase 5b — as built" and [open-questions #300](open-questions.md)–[#305](open-questions.md) for the deferred Minor findings.

**Done-definition per phase:** the spec's §6 tests (apply/invert property test; chat-chip ↔ panel-control contract test; Playwright type→chips→panel→⌘Z; own-data executor fixture), benchmark 14/14 + 6/6 + 0 fabricated unchanged, no audit rows written by chart edits, `/code-review` LOW clean.


# ADR 048 — Eurostat as the second data source: adapter, catalog, pipeline, proof, and geography sequencing

**Status:** accepted at design level, 2026-09-14 (owner present in chat; three constraints settled there and
recorded at [open-questions #248](../open-questions.md) and in ADR [030](030-multi-source-architecture.md)'s
revisit-trigger addendum). **Not scheduled, no work-package number, no code.** Per the WP27/WP30 precedent, the
execute session runs the pre-build adversarial design review BEFORE writing code; the frozen executor brief
comes out of that review, not out of this ADR alone. **Pre-build adversarial design review completed same day
(4 lenses: data integrity/invariants, rollout enforceability, technical feasibility, architecture-fit/regression;
11 raw findings → 1 confirmed blocker fixed immediately outside this ADR, 5 more confirmed/cross-lens-corroborated
and folded into D3/D4/D5/D7/D9 below, 2 minor/no-fix-needed, 1 already-handled). See "Amendments from the
pre-build adversarial design review" below.
**Deciders:** Stefan (scope, destination, rollout posture); session (the engineering shape).
**Input:** the design spike [superpowers/specs/2026-09-14-eurostat-v2-design.md](../superpowers/specs/2026-09-14-eurostat-v2-design.md)
(§3 and §5 are what this ADR commits to; §4 is explicitly outside it — see D10).

## Context

ADR [047](047-repositioning-embedded-sourced-chart.md) (2026-09-13) named Eurostat as source two — *"after CBS's
current work settles, demand-driven and never announced before it answers"* — and required its own ADR before
any code, per the narrow-waist pattern ADR [030](030-multi-source-architecture.md) built for exactly this: a
code-level source registry (`src/sources/registry.ts`), a source-neutral adapter contract (`SourceAdapter`, the
alias of `CbsSource` in `src/cbs-adapter/types.ts`), prefixed table ids + a `source` column (D4, migration 016),
an executable conformance harness (`src/sources/conformance.ts`, families F0–F5) and a
[how-to-add-a-source guide](../how-to-add-a-source.md) listing seven verified, still-unwired WP30c landmines.
WP30a and WP30b are live; WP30c — the first real second source — was owner-deferred at
[open-questions #123](../open-questions.md) pending the choice of source. ADR 047 made that choice: Eurostat.

The [product vision's ICP](../01-product-vision.md) names Eurostat directly (the person "knows the number exists
at CBS or Eurostat but not where"; segment 4 is "reached through Eurostat and English"), and the session-96
[competitive research](../session-briefs/2026-09-11-competitive-research-localfocus-flourish-eurostat.md)
verified feasibility on the live site: four APIs (Statistics API in JSON-stat 2.0 over REST with CORS, SDMX 3.0,
SDMX 2.1, a Catalogue API); refresh twice daily (11:00 and 23:00 CET); **no versioning of past data**;
synchronous requests below 500,000 cells, async submit-and-poll for 500k–5M, HTTP 413 above; a fair-use policy
on concurrency and frequency; CC BY 4.0 with a prescribed line *"Source: [dataset DOI], [access date]"*; licence
exceptions for non-EU country data (USA, Japan, China) and some CH/AT trade data.

The design spike found that the pipeline needs **no new abstraction** for Eurostat, but that three questions
could not be settled by a session alone. The owner settled all three on 2026-09-14:

1. **Scope of this ADR:** the Eurostat-as-a-queryable-source track only. The "pattern discovery" feature the
   spike also designed (§4, a new S1–S10 invariant family) is a separate, later track.
2. **Destination:** the product becomes an **EU-wide knowledge base**; CBS/Dutch data was deliberately step one,
   never the ceiling (owner, verbatim intent at #248: *"We will not focus on Dutch. That's just the first step
   (CBS). The product will transform into an EU knowledge base."*). ADR 030 D2's Dutch-only region taxonomy was
   a scope steer for the CBS phase, not a permanent decision — ADR 030's revisit trigger has fired.
3. **Rollout posture:** demand-driven, never announced or marketed before it answers a real question — the
   posture WP16's CBS on-demand onboarding proved, restated in ADR 047.

## Decision

**D1 — Eurostat is one more `SourceAdapter` behind the existing waist; no new provider abstraction, no
parallel pipeline, no rename now.** The spike's `StatisticalProvider` shape (search datasets / get metadata /
get dimension values / query data) maps one-to-one onto `fetchCatalog` / `fetchTableSchema` / `fetchCodeList` /
`fetchObservations` + `fetchObservationCount` — the contract that already exists. The adapter lives in a new
sibling directory **`src/eurostat-adapter/`** next to `src/cbs-adapter/` (ADR [001](001-single-app-vs-split.md)'s
module set gains one entry; the guide's own instruction: "model it on `src/cbs-adapter/` — one directory"),
containing the live Statistics-API client, the parser into the existing wire types, a `FixtureSource` replaying
captured real responses through the same parser, and the grammar mapping of D6. No module outside it may know
Eurostat URL shapes (ADR [003](003-cbs-access-layer.md) decision 2, applied to source two). The `Cbs*` wire-type
names, the `cbs-adapter/` directory and the `cbs_tables`/`cbs_catalog` table names all **stay** — ADR 030 A5
measured the rename at 31+ files of diff noise on a live money product and deferred it; that verdict is
unchanged. A later hermetic cleanup (moving both adapters under `src/sources/`, renaming `Cbs*` → `Source*`) is
its own optional WP, never bundled into the source add. **(Amendment 11):** "no new abstraction, no parallel
pipeline" is accurate for E1's scope; it is NOT "one line changed forever" — D9 already scopes the
`adapterFor`/onboarding-cron rewiring (wiring point 4) to E2, a real touch of live money-path code, not E1. A
session reading only this headline should read D9 before touching that route.

**D2 — Destination and geography sequencing: EU-wide is the settled direction; the taxonomy widens in
phase E2, and phase E1 ships NL-scoped as a deliberate stepping stone.** Per #248, the region-taxonomy widening
— a `country` level plus a second, source-neutral region-code family (NUTS for Eurostat, CBS codes for CBS,
with the NL equivalences NUTS 0 `NL` = land, NUTS 1 `NL1`–`NL4` = the four landsdelen, NUTS 2 `NL11`…`NL42` =
the twelve provincies, NUTS 3 = the COROP areas CBS also publishes, recorded in `dimension_labels`) and the
consequent changes to `src/query/resolve.ts`, the region-prefix tables, `src/answer/intent/`'s region
vocabulary, the chips' `baseLabel` and the chart builder's region ordering, plus a migration — is **the expected
direction, not a hypothetical**. This ADR commits to the ORDER, not to the widening's design: **E1** ingests with
the NL-only NUTS↔CBS mapping (every non-NL `geo` row out of slice) so the adapter, the flag grammar, the
conformance families and the proof panel are proven on real data with zero waist change; **E2** widens the
taxonomy through its own design round (an executor brief with the same pre-build review, and — because it
touches `query/` and the intent schema — most likely its own ADR or a substantial amendment to ADR
[011](011-query-contract.md)), and only then may a Dutch question about a non-NL region be answered. An NL-only
Eurostat is therefore never the product; it is the proving step. The spike's option A/B framing is closed:
A-then-B.

**D3 — Rollout posture, named as a decision because a future session could easily default the other way:
Eurostat stays demand-driven and is never announced before it answers; E1's explorer is INTERNAL, flag-gated
and noindexed, never a public feature.** Concretely: (a) the E1 explorer route ships behind
`EUROSTAT_EXPLORER_ENABLED` (unset in production; owner + sessions only — the same class of owner-run proving
surface as `tables:evict --apply` or the coverage-sprint probes); (b) the public site stays **byte-identical**
through E1 — pinned by `web/components/coverage-disclosure.test.tsx`, `web/app/privacy/page.test.tsx` and
`web/app/galerij/page.test.tsx`, all three now asserting Eurostat is genuinely absent (Amendment 1: the
"Eurostat — binnenkort / coming" coverage-disclosure notice that used to exist here was itself a pre-D3
announcement, shipped before this rule — removed 2026-09-14, `058efdf`, not narrowed); none of the three
covers the query/finder path (Amendment 3 covers that gap in E1's done-definition below);
(c) the first public exposure of Eurostat IS the first served answer: a real question the finder maps to a
not-yet-loaded Eurostat dataset creates a `pending_table_requests` row and the ADR
[026](026-on-demand-fetch-job-architecture.md) job fetches → validates → verifies → answers on arrival — the WP16
loop, routed per table via `adapterFor` (guide wiring point 4: the onboarding-cron route must stop constructing
`new ODataV4Source()` directly before a Eurostat row can be claimed); (d) the public-claim wording change
("official CBS cell" → "official sources", CLAUDE.md, the meta 'sources' template, `/llms.txt`, the coverage
disclosure, `/systeemoverzicht`'s hand-written constants) ships WITH E2, owner-signed, in the same change as the
first answering dataset — never before. A session that finds itself building a Eurostat browse page, landing
section or marketing copy before E2 answers is violating this decision, not interpreting it.

**D4 — Catalog and metadata index: the existing mirror, source-scoped; discovery by the cheapest mechanism
first.** In E1, Eurostat's `catalog:refresh` runs the SAME way CBS's own does today — a manual/CLI script, NOT a
Vercel Cron job (Amendment 9: CBS's refresh has never actually run inside a serverless timeout, so "measure
against the cron ceiling" was a false baseline; making either source's refresh a real scheduled job is separate,
later design work). It reads the Catalogue API and writes rows into `cbs_catalog`
with ids `eurostat:<dataset code>` (ADR 030 D4), `source = 'eurostat'`, `language = 'en'`, the dataset's own
last-update timestamp in `modified` and its lifecycle status in `status` (the registry's
`currentCatalogStatuses` for Eurostat declared per A6). **Blocking pre-work:** `ingestCatalog`'s prune is not
source-scoped (`src/catalog/ingest.ts`, wiring point 1) — a Eurostat refresh would delete the CBS mirror rows;
it is scoped by `source` before any second refresh runs. Discovery for a Dutch question over an English catalog
proceeds in three steps, each gated on MEASURED misses, per the owner's cheapest-mechanism-first rule
(2026-09-08): (i) lift the finder's `language = 'nl'` filter per source (wiring point 2) and run English
full-text recall over `eurostat:` rows with per-source shortlist quotas (the A6 wiring exists); (ii) a curated
Dutch alias layer for the datasets people actually ask about, in `src/catalog/aliases.ts`'s existing pattern —
zero AI, zero schema; (iii) multilingual embeddings via pgvector (ADR [002](002-postgres-system-of-record.md)'s
designated upgrade path) only when (i)+(ii) show a measured miss rate worth the embedding spend and tuning
surface — never on catalog size alone. The rerank prompt shows each candidate's source (ADR 030 D5); that prose
is CBS-branded and fixture-frozen, so it changes only inside the owner-signed A4 sweep of D3(d).

**D5 — The query pipeline is the existing one; Eurostat adds no step.** The spike's *question → intent →
discovery → metadata/dimension validation → disambiguation → query → normalise → compute → cite* is already
[04-architecture.md](../04-architecture.md)'s pipeline: LLM intent parse to a strict schema with no data access
(ADR [004](004-llm-usage.md)/[012](012-intent-parsing-llm-harness.md)); finder + on-demand onboarding (ADRs
[025](025-cbs-catalog-table-discovery.md)/026/[027](027-finder-shape-fit-gate.md)); registry pinned defaults +
`dimension_labels` + ingestion validators 1–5; R7's one clarification round with dry-run-verified click options
(ADR [024](024-answer-first-defaults-and-clickable-options.md)); deterministic SQL + registered derivations (ADR
011); the attribution line + proof panel. Three Eurostat-specific rules inside those steps: (a) **a new
ambiguity class — the same statistic exists at CBS and at Eurostat** (ADR 030's "two+ sources covering the
same statistic" trigger): in E2 the live source chips (#129) decide — CBS pre-checked; when CBS has no reading,
Eurostat is **offered as an explicit clarification chip the reader must select, never auto-fetched** (Amendment
5: "offered" was ambiguous enough to permit a silent cross-source substitution — an honestly-attributed answer
the reader never actually asked for is still a guess about which source they meant, principle (c)); the richer
"here are both readings" answer (#39/#21) is E3; (b) **a comparability break (Eurostat flag `b`, or a NUTS revision) inside a
requested window is a refusal precondition on the `direction`/`first_last` derivations** in
`src/query/derivations.ts` — a "trend" across a definition change is a guess (principle (c)); this is the one
place a source flag legitimately reaches `src/query/`, as a registered-derivation precondition, never an LLM
concern; (c) **zero prompt bytes in E1** (ADR 030 A4) — the intent prompt, rerank prompt and meta templates
change only in E2's owner-signed sweep, with fixtures re-recorded there.

**D6 — Eurostat's native grammar maps INTO the waist at the adapter boundary (ADR 030 D2), with these
obligations:**
- *Periods:* `2024` / `2024-Q1` / `2024-01` (the real wire spelling; `2024-M01` is also accepted, see the 2026-09-30 addendum) map losslessly to `2024JJ00` / `2024KW01` / `2024MM01` (F2
  round-trip holds). Semester (`-S1`), weekly (`-W01`) and daily datasets are **refused by the fit gate in
  E1/E2** — ADR 030 D2's grain-extension revisit trigger, not silently mapped (CBS's own `80416ned` daily
  specimen is the precedent).
- *Measures and units:* a Eurostat dataset is one observed variable with `unit` (and `na_item`, `sex`, `age`,
  `nace_r2`, …) as dimensions; the adapter synthesises one measure per distinct `unit` code in the registered
  slice (code `<dataset>|<unit code>`, title = dataset title + unit label, `unit` = the unit label verbatim),
  pins the `unit` dimension in the slice so a table never mixes units (R10), and takes `decimals` from the
  captured fixture's observed maximum precision, pinned at registration and re-checked by the unit-consistency
  validator.
- *Statuses, flags, null reasons — verbatim, interpreted only in the registry:* the observation-flag string
  (`p` provisional, `e` estimated, `s` Eurostat estimate, `f` forecast, `b` break, `c` confidential, `d`
  definition differs, `u` low reliability, `n` not significant, `z` not applicable, `:` not available) rides in
  `observations.status`; the registry entry declares `definitiveStatuses: ['']` (the unflagged state — every
  flagged cell renders provisional unless `provisionalDisplay` gives it a specific suffix) — **⚠ SUPERSEDED,
  see the fourth as-built addendum (#251, session 109): the unflagged state is emitted as `'Published'`, not
  `''`, and the per-cell path this bullet assumed did not exist until #251 built it** — and
  `nullReasonLabels` for `:`/`c`/`z`. All Dutch suffix and null-reason wording is an **owner sign-off** (the
  guide's rule). Eurostat has no per-period publication status; the adapter reports every observed period as
  published (its provisional concept is per cell), which the ingestion validator's step-3 status requirement
  accepts as honest — see Assumption 4.
- *Identity and links:* ids `eurostat:<code>` (D4); `deepLink` → the dataset's stable data-browser table view
  (`https://ec.europa.eu/eurostat/databrowser/view/<code>/default/table`), mirroring the CBS choice in
  `web/lib/statline.ts` to link the table, not a cell; the #247 Text-Fragment highlight stays best-effort and may
  be null.
- *Licence exceptions enforced structurally at slice time:* rows for the excepted geographies are never
  ingested (the default slice restricts `geo` to EU/EFTA codes; the fit gate refuses a dataset whose only
  requested geo is excepted), pending the legal check in Assumption 2.
- *Fetch shape:* JSON-stat 2.0 over the Statistics API, server-side filtered per `CbsSlice` (`dimensionEquals`,
  `dimensionPrefixes` on `geo`, `periodFloor` on `time`), **synchronous only** — every fetch stays under the
  500k-cell threshold by construction of the WP16 150k-cell slice cap; the async submit-and-poll API is not
  implemented (a dataset that would need it fails the fit gate honestly). Eurostat fetches serialise (one at a
  time) in the CLI and the cron job — the fair-use policy is an ingestion-scheduling concern only, since no
  request-path call exists (principle (b)). **⚠ AS-BUILT NOTE (E2a step-5 prerequisite, session 125,
  2026-09-23):** "server-side filtered per `CbsSlice`" above was aspirational, not as-built, from E1 (session
  101/107) until this fix — `fetchAndParse` (`src/eurostat-adapter/statistics-api.ts`) built the request URL as
  `<base>/<code>?format=JSON&lang=EN` with NO filter params at all, applying the full `CbsSlice` (incl. the
  structural geo restriction) only client-side, AFTER the `SYNC_CELL_THRESHOLD` check had already run on the
  unfiltered declared cell count. Verified live (research doc
  `docs/superpowers/specs/2026-09-23-eurostat-e2a-step5-sibling-datasets.md`): all three E2a sibling datasets
  are 675,108 / several million / 8,191,372 cells unfiltered (over the 500k cap) but 2,112–4,488 cells once
  filtered — so the gap was not cosmetic, it made every one of them un-registerable. Now genuinely true:
  `dimensionEquals` entries become `<dim>=<code>` params, the structural geo restriction
  (`EU_EFTA_STAND_IN_GEO_CODES`) becomes repeated `geo=<code>` params whenever a slice is present, and
  `periodFloor` becomes `sinceTimePeriod=<Eurostat format>`. **Caveat the phrase above doesn't spell out:**
  `dimensionPrefixes` has NO Eurostat server-side equivalent and stays client-side only (geo is the one
  exception, already covered structurally, not via a per-slice `dimensionPrefixes.geo`) — the client-side
  filter (`matchesSlice`, jsonstat.ts) still runs unconditionally afterwards regardless (defence in depth,
  unchanged). A call with truly no slice at all (e.g. registering a table with no `Phase0Table.slice`, like
  `tipsbd30`, the one real registered Eurostat table) is byte-identical to the pre-fix URL. Tests:
  `tests/eurostat-adapter/statistics-api.test.ts`.

  **Fix round 2 (same session, 2026-09-23):** the fix above covered `fetchAndParse`/`fetchObservations` only —
  `registerTables` and `syncTable` (`src/ingestion/pipeline.ts`) independently call `fetchTableSchema` and
  `fetchCodeList` to read a table's schema/dimension metadata, and BOTH did so with no slice at all, so
  registering (or ever re-syncing) one of the three E2a siblings would still have fetched the unfiltered
  dataset for its schema and hit `AsyncApiRequiredError`, even with round 1's fix in place. Fixed by adding an
  optional `slice?: CbsSlice` parameter to `CbsSource.fetchTableSchema`/`fetchCodeList` (`src/cbs-adapter/
  types.ts`) — CBS's own adapters ignore it, so CBS registration/sync stays byte-identical — and threading
  `table.slice` (`registerTables`) / `registry.slice` (`syncTable`) through both calls. `StatisticsApiSource`
  and `EurostatFixtureSource` now route `fetchTableSchema`/`fetchCodeList` through the SAME per-(tableId,
  slice) cache (`loadDataset`/`parsed`) `fetchObservations` already used, so a registration + its first sync
  of one sliced table share ONE underlying fetch, not three. Tests:
  `tests/eurostat-adapter/register-sync.test.ts` (a stubbed over-cap-unfiltered/under-cap-filtered pair,
  proving registration throws `AsyncApiRequiredError` without a slice and succeeds — from exactly one fetch —
  with one).

**D7 — Proof and citation carry over on the existing "Bewijs dit cijfer" panel with two additive fields.**
`web/lib/answer-proof.ts` builds the panel once from the stored envelope (no arithmetic, every digit a shared
formatter over a stored cell or derivation; the R1 token-scan test as the belt) and `web/components/answer-proof.tsx`
renders it — Eurostat answers ride it unchanged, plus: (a) **a per-dataset DOI**, as an additive nullable
column on `cbs_tables` and `cbs_catalog` (the DOI is per dataset, not per source, so it does NOT go on
`SourceInfo`), rendered by `buildAttributionLine` for `source = 'eurostat'` as *"Bron: Eurostat, dataset {code} —
{titel} (DOI {doi}). Gegevens gesynchroniseerd op {datum}. Licentie: CC BY 4.0."* — the "access date" Eurostat
prescribes is exactly the sync date R4 already shows; (b) **the request URL(s) the ingestion job actually
called**, as an additive `request_urls text[]` on `ingestion_batches`, recorded for BOTH sources (it does not
exist for CBS today either) and shown under the panel's "Technische details" toggle per batch — a record of what
the out-of-band job fetched, never a link the answer path calls. Amendment 6: unlike the DOI, this is NOT a
drop-in additive field — `answer-proof.ts` (verified by reading it directly) is a pure, synchronous leaf with no
DB access, called identically at receive- and replay-time for byte-parity, while `request_urls` lives on
`ingestion_batches`, a table that module never touches; the executor must add an explicit read — a live lookup
by the already-stored `batchId`, fetched alongside the proof build, kept OUTSIDE the R8-reconstructed envelope
(never denormalised into it) — not assume the interface just grows a field. Both are migrations, additive,
R8-safe (batch rows are outside the reconstructed envelope; an absent DOI renders no DOI clause; pre-Eurostat
rows re-derive byte-identically because absent `source` still resolves to `cbs`, ADR 030 A1). The verbatim flag letter appears
in the cell table's status column with its registry-resolved meaning alongside (principle (a), R11).

**D8 — Ingestion posture: bulk, out-of-band, our store is the only history.** Principle (b) unchanged. Because
Eurostat keeps no past versions, the existing silent-correction defence ([05-data-rules.md § CBS platform-change
risk](../05-data-rules.md): syncs diff against previous values, changed historical cells logged per batch) becomes
MORE valuable, not less — an audit row is a frozen snapshot of a value Eurostat itself can no longer show.
Expected cadence per dataset comes from its own update-frequency metadata, enforced as staleness warnings
(the CBS rule). NUTS revisions (2021 → 2024 → …) are the Eurostat analogue of gemeentelijke herindelingen and
follow the same reviewed-`dimension_labels`-update playbook. ADR 026 decision 3's revisit trigger fires in E2: for
measures both sources publish for NL, the on-demand verification gate gains a registered cross-source
comparison, refusing the table on a mismatch beyond a stated tolerance.

**D9 — Phasing (unnumbered; lifted into [08-build-plan.md](../08-build-plan.md) only when the owner schedules
it):**
- **E1 — adapter + internal explorer (proves the adapter).** `src/eurostat-adapter/`, registry entry + `adapterFor`
  line, fixture captures + `tests/fixtures/eurostat/conformance.json`, the NEW region-taxonomy conformance
  family (wiring point 5), the source-scoped prune, the D7 migrations, the flag-gated explorer (pick a dataset,
  filter, table + chart through the REAL `runQuery` → `buildChartSpec` path, CSV via `buildAnswerCsv`, proof
  panel underneath; zero LLM). Done: `npx vitest run tests/sources` green with Eurostat as a second positive
  control; 2–3 frozen-key verification tasks per ingested dataset (the 05-data-rules onboarding rule);
  ≥ 3 real datasets rendered on the dev server; the full verification block green; the public site
  byte-identical (D3(b)'s tests green). **Added by the adversarial review:** (Amendment 3) a test proving a live
  NL chat question can never surface an `eurostat:`-id result while `EUROSTAT_EXPLORER_ENABLED` is unset —
  scoped by an explicit `source = 'cbs'`/flag check in the live path, not left to the not-yet-lifted language
  filter as an incidental gate; (Amendment 7) `parseFactorUnit`/`baseLabel` verified against real Eurostat unit
  strings and region labels — a mismatch must fail open and be logged, never silently accepted; (Amendment 8)
  the executor brief names the DOI/`request_urls` acceptance mechanism explicitly (a new conformance check, or
  a documented exception naming the R1 token-scan test as the sole belt per D7) rather than leaving it implicit.
- **E2 — natural-language querying through the chat pipeline.** The taxonomy widening (D2, own design round),
  discovery steps (i)+(ii) (D4), the cron route via `adapterFor`, compose/refusals threading the result's actual
  source instead of `resolveSource(undefined)` (wiring point 3), the source-chip ambiguity rule (D5a), the
  `b`-flag precondition (D5b), the owner-signed prompt/claim sweep (D3(d)), the ADR 026 cross-source check
  (D8), and ≥ 5 Eurostat benchmark tasks in the frozen key including ≥ 2 refusals (a semester dataset; an
  excepted-geo ask). Done: the new tasks pass at the gate with 14/14 + 6/6 + 0 fabricated unchanged; a live,
  owner-supervised smoke run onboards a real dataset through the job and answers on arrival; every public
  surface says "official sources" and names Eurostat as answering — in one change. **Added by the adversarial
  review:** (Amendment 4) the interim wait-message shown during an on-demand Eurostat fetch (WP16's
  `pending_table_requests` loop) must not name the source before the answer itself is ready — generic wait
  copy, matching CBS's own on-demand wait-messaging, not a source-specific line.
- **E3 — research-assistant layer.** Saved queries as pointers at audit rows (the #60 saved-charts seam); a
  registered `cross_source_difference` derivation kind (two cells, two sources, unit-checked, marked derived,
  both attributions — the first cross-source computation, [#103](../open-questions.md)'s narrowest slice); a
  "waarom verschillen deze cijfers" block assembled from STORED metadata only (`CbsMeasure.description`
  verbatim for CBS; Eurostat's dataset/ESMS metadata captured at ingestion into an additive column) — template
  first, LLM paraphrase under R2/R3/R9 only if the pre-build review judges it safe. A two-source comparison
  chart is a `ChartSpec` change (ADR [007](007-chart-spec-rendering.md) seam, R6) decided in E3's own brief.

**D10 — Out of this ADR: the pattern-discovery feature.** The spike's §4 (scanning indicator pairs across
regions and years for statistical associations; a deterministic stats module; digit-free LLM phrasing; a new
S1–S10 invariant family; the multiple-testing controls) is a **separate, later, not-yet-scheduled track** with
its own ADR when — and if — the owner schedules it. It is not designed further here; the spike remains its
design record. Nothing in D1–D9 depends on it, and nothing in it may ride on E1–E3's work packages.

## Amendments from the pre-build adversarial design review (session, 2026-09-14 — 4 lenses run in parallel:
data integrity/invariants, rollout enforceability, technical feasibility, architecture-fit/regression; each
briefed to refute by default and report nothing if nothing survived scrutiny. 14 raw findings → 1 confirmed
blocker, fixed the same day outside this ADR's own text; 6 more confirmed or cross-lens-corroborated, folded
into D3–D9 above; 4 real-but-fixable, added as new E1/E2 done-definition items above; 3 minor, noted below with
no structural fix; 1 already correctly handled by the ADR as written, confirmed not a rubber stamp.

**Amendment 1 — CONFIRMED BLOCKER, fixed immediately (rollout-enforceability lens).** D3(b)'s original text cited
`coverage-disclosure.test.tsx` as proof the product "never names Eurostat as answering" — but that test actually
PINNED an "Eurostat — binnenkort / coming" notice as REQUIRED output, the opposite of what it was cited for.
That notice (`web/components/coverage-disclosure.tsx`), shipped in the Journey programme (PR #14, merged to
`main` 2026-09-12) before ADR 047 or this ADR existed, was itself already the kind of pre-answer naming D3
forbids. The session verified this directly (confirmed the component is live on `main`'s homepage, read the
exact copy, confirmed the test's assertion) before reporting it, then asked the owner rather than deciding
alone: keep it and narrow the rule, or remove it. **Owner: remove it (2026-09-14).** Fixed same day, TDD (test
flipped to assert absence, confirmed RED against the still-present chip, then GREEN after removal): the notice
and its two `coverage.eurostat*` i18n keys deleted, commit `058efdf`, pushed, full suite green (1707/1707). D3(b)
above reflects the corrected, now-true claim.

**Amendment 2 — real-but-fixable, now resolved by Amendment 1 (rollout-enforceability lens).** The original D3(b)
also overstated the three cited tests as jointly proving silence, when `coverage-disclosure.test.tsx` asserted a
materially weaker property before the fix. Moot now that all three genuinely assert absence — noted so a future
reader doesn't re-introduce a weaker assertion there without noticing the bar it needs to clear.

**Amendment 3 — CONFIRMED, folded into D9's E1 done-definition (rollout-enforceability lens).** E1's only
protection against a live NL chat question surfacing an `eurostat:`-id result is that the finder's `language =
'nl'` filter (D4 discovery step i) hasn't been lifted yet — an incidental side effect of unfinished work, not an
explicit deny-gate. An unrelated future change (broader full-text recall, English-question support) could leak
Eurostat results into production with nothing catching it. Fix: an explicit `source`/flag-scoped test added to
E1's done-definition (D9 above).

**Amendment 4 — real-but-fixable, folded into D9's E2 done-definition (rollout-enforceability lens).** D3(c)'s
"first exposure = first answer" loop didn't specify that the interim wait-message during an on-demand Eurostat
fetch stays generic. Fix: added to E2's done-definition (D9 above).

**Amendment 5 — CONFIRMED, cross-lens corroborated (data-integrity lens finding 1 + architecture-fit lens
finding 4), folded into D5(a) above.** "Eurostat offered... when CBS has no reading" didn't specify whether
"offered" meant click-to-confirm or auto-answered; the auto-answered reading is a guess about which source the
reader meant (principle c) even though the resulting attribution would be honest. D5(a) above now requires an
explicit clarification chip, never an automatic fetch.

**Amendment 6 — CONFIRMED, cross-lens corroborated (data-integrity lens finding 2 + architecture-fit lens
finding 3), folded into D7(b) above.** The original D7(b) described `request_urls` as carrying over "almost as
-is," alongside the DOI. It doesn't: `answer-proof.ts` is a pure, synchronous, DB-free leaf (verified by reading
it), while `request_urls` lives on a table that module never touches — a genuinely new read path, not a drop-in
field. D7(b) above now names the mechanism (a live lookup by the stored `batchId`, outside the R8-reconstructed
envelope).

**Amendment 7 — real-but-fixable, folded into D9's E1 done-definition (architecture-fit lens finding 2).** ADR
030's own amendment A7 named `parseFactorUnit` (unit-notation parsing) and `baseLabel` (region-label formatting)
as source-native grammars with no D2 bullet, explicitly flagged "revisit at WP30c with the first real adapter."
This is that adapter, and D6's units/measures design doesn't reference either. Not a correctness risk (A7's own
fail-open behavior holds — nothing gets fabricated), but a real risk of a silently dropped or mis-rendered unit
chip or region label in E1's own explorer, which exists specifically to prove the adapter on real data. Fix:
verification added to E1's done-definition (D9 above), fail-open confirmed AND logged, not silently accepted.

**Amendment 8 — real-but-fixable, folded into D9's E1 done-definition (architecture-fit lens finding 3).** The
conformance harness (F0–F5) checks registry coherence, fixture replay, period round-trip, value/null-reason
completeness and the ingestion validators — none of them touch D7's new DOI column or `request_urls`. A broken
capture of either could pass every conformance family and still reach the internal explorer. D7 already names
the R1 token-scan test as a belt for the DOI; this amendment requires the executor brief to say explicitly
whether that belt is judged sufficient or a new conformance check is needed — not leave it unstated.

**Amendment 9 — CONFIRMED, folded into D4 above (technical-feasibility lens finding 1).** D4's original text
framed Eurostat's catalog-refresh runtime as something to "measure against the cron/function ceiling" — which
implied CBS's own refresh already respects that ceiling. It doesn't: `catalog:refresh` is a manual/CLI script
today (~19 minutes for ~4,858 rows), never a Vercel Cron job, so it has never actually run inside a serverless
timeout. A real scheduled job at roughly twice the row count would need genuine design (pagination, incremental
writes), not just a measurement against a constraint nothing currently respects. D4 above now has E1 run
Eurostat's refresh the same unscheduled way CBS's runs today; making either a real Cron job is separate, later
work.

**Amendment 10 — minor, no structural fix (already correctly scoped) (technical-feasibility lens finding 2).**
D2's "NUTS 3 = the COROP areas... recorded in `dimension_labels`" phrasing reads as a data-only fix; `RegionKind`
(`src/answer/intent/types.ts`) has no COROP value today, so it is new code across every touch point D2 itself
lists. No ADR change needed — D2 already scopes this to its own E2 design round — flagged here so the E2
executor brief doesn't underestimate the lift.

**Amendment 11 — minor, caveat added to D1 above (architecture-fit lens finding 1).** D1's "no new abstraction,
no parallel pipeline" headline is accurate for E1 but could be misread as "nothing more to design" — D9 already
scopes the real `adapterFor`/onboarding-cron rewiring (a live money-path route) to E2, not E1. Caveat added to
D1 above rather than a design change.

**Amendment 12 — real-but-fixable, folded into D9's E1 done-definition (technical-feasibility lens finding 3).**
The 500k-sync / 5M-async / 413-above cell-count thresholds (Context, above) are research-verified (session-96
live-site checks), not verified by a real API round-trip from this codebase. Fix: one live smoke probe against
a real large Eurostat dataset, added to E1's done-definition, before the sync-only fit gate (D6) is treated as
finalized rather than provisional.

**Not amended — reviewed and confirmed already correctly handled (technical-feasibility lens finding 4).** D6's
"Eurostat has no per-period publication status... reports every observed period as published" is already named
as Assumption 4 with an explicit fallback (an ADR-recorded contract amendment if the harness insists on
per-period status) — the review confirms this is a real, honestly-hedged fit question, not an assertion dressed
up as settled. No change.

## Alternatives considered

1. **A new `StatisticalProvider` abstraction (per the research) vs. reusing `SourceAdapter` (chosen) vs. a
   parallel Eurostat pipeline.** A new abstraction would wrap the same four operations under a second name and
   either duplicate or bypass the conformance harness — the executable contract that makes "add source N" a
   weaker-model task (ADR 030 D6). A parallel pipeline was already rejected in ADR 030 D1 ("duplicates exactly
   the validated machinery that makes the product trustworthy"); nothing about Eurostat reopens that. Reuse
   costs one grammar mapping (D6) and inherits every invariant test for free.

2. **Geography: widen the taxonomy BEFORE any Eurostat code (widen-first) vs. NL-scoped E1 then widen in E2
   (chosen) vs. NL-only forever.** NL-only forever is closed by #248. Widen-first is the "correct" order on
   paper — no throwaway NL-only mapping — but it front-loads the riskiest change (query semantics, intent
   vocabulary, a migration on a live money product) before a single Eurostat wire shape, flag or dataset has
   been measured, and the widening's design needs exactly the evidence E1 produces (which datasets, which NUTS
   levels, how the flags behave). The NL-only mapping is not thrown away either: the NL equivalences are the
   first rows of the widened `dimension_labels`. A-then-B keeps E1 hermetic-testable and waist-untouched.

3. **E1's explorer: public browse feature vs. internal flag-gated proving surface (chosen) vs. no explorer at
   all (go straight to E2).** Public conflicts head-on with the owner's rollout posture (D3) and with
   [03-mvp-scope.md](../03-mvp-scope.md)'s free-browse-layer row (a separate product decision with its own
   thin-content and SEO questions). No explorer is tempting — E2 is where value lands — but it means the first
   time a real Eurostat cell, flag, unit-per-measure mapping or DOI line is seen on a real chart is in a paid,
   live, on-demand answer; the coverage sprint and the WP16 calibration both showed that measuring a new
   grammar on real data BEFORE it can answer is what catches the phantom-measure / slice-empty class of bug.
   Internal keeps that measurement and costs one flag.

4. **Dataset discovery in Dutch over an English catalog: curated alias layer first (chosen) vs. multilingual
   embeddings from day one vs. LLM-translating the question before recall.** Embeddings meet ADR 002's
   trigger on catalog size alone, but the owner's cheapest-mechanism rule asks for measured evidence, and
   embeddings add a per-refresh spend plus a threshold-tuning surface for a miss rate nobody has measured.
   Translating the question is a prompt change (A4-gated), adds a paid call on every turn, and introduces a
   new way to misfire (a mistranslated measure word) on the one step where the product must not guess.
   Aliases are zero-AI, zero-schema, reviewable, and the miss rate they leave IS the evidence embeddings
   would need.

5. **Wire format: JSON-stat 2.0 (chosen) vs. SDMX-CSV vs. the async API.** JSON-stat is the Statistics API's
   documented primary format with CORS and carries the observation flags; SDMX-CSV is the fallback if a needed
   flag or metadata field turns out to be JSON-stat-invisible at capture time. The async API would allow
   datasets above 500k cells, but the WP16 slice cap already bounds fetches far below that, and async
   submit-and-poll is a second job shape the ADR 026 cron engine does not have — a real cost for a case the fit
   gate can simply refuse.

6. **Where the DOI lives: per-dataset column (chosen) vs. a field on `SourceInfo` vs. a `deepLink`-style
   function.** The DOI is per dataset, so a source-level field is wrong by construction; a function would have
   to derive a DOI from a dataset code, which Eurostat does not guarantee. A stored, captured-at-ingestion
   column is the only honest option — and keeps `SourceInfo` the pure client-bundled leaf WP30a made it.

7. **Request URLs: store on the batch (chosen) vs. reconstruct from the registered slice at proof time vs. not
   surface them.** Reconstruction is arithmetic-free but is still a re-derivation of what was fetched, from
   today's adapter code — a later adapter change would silently rewrite history. Storing the URL the job
   actually called is what "traceable" means. Not surfacing loses the one proof element the research asked for
   that the CBS panel never had.

8. **Rename `cbs-adapter/` → source-neutral now vs. sibling directory (chosen).** The A5 measurement stands:
   31+ files of diff noise, zero hermetic benefit, on a live money product. A sibling is the guide's own
   instruction.

## Consequences

- One new `src/` module (`eurostat-adapter/`); ADR 001's as-built list gets the note. Zero change to `src/query/`
  semantics, `src/answer/compose/`, `src/chart/`, prompts or the benchmark scorer in E1 — the guide's "what you
  must NOT touch" list is honoured by construction; E2's widening is the one deliberate waist change, in its own
  design round.
- Two additive migrations (DOI columns; `request_urls` on batches), file-only until the owner's supervised
  apply; a third (the taxonomy widening) is E2's, designed there.
- Every CBS answer, citation, chart, CSV and stored audit row stays byte-identical through E1 (the WP30a golden
  pins remain the proof); the public site stays byte-identical through E1 (D3(b)'s tests).
- The public claim widens to "official sources" exactly once, in E2, owner-signed, together with the first
  answering dataset — [open-questions #102](../open-questions.md)'s recorded implication, executed.
- The seven WP30c wiring points in the guide become E1/E2 obligations: 1 and 5 in E1; 2, 3, 4, 6, 7 in E2.
- Pricing unchanged: a Eurostat answer at the normal price; on-demand Eurostat onboarding at the existing
  100-credit heavy tier (ADR 026 decision 2); any extra-credit pricing for E3's cross-source comparison is an
  owner decision at #103, not made here.
- ADR 030's "Nederland scope" steer is superseded as a permanent scope statement (its addendum says so);
  ADR 047's sequencing statement ("Eurostat next, demand-driven, never announced before it answers") is now
  backed by a concrete, gated plan. [06-roadmap.md](../06-roadmap.md) Phase 3's data-sources row and
  [03-mvp-scope.md](../03-mvp-scope.md)'s enrichment-sources row should point here when this is scheduled (a
  doc sweep for the execute session, not a change this ADR makes on its own).
- The spike's §4 track (pattern discovery) is explicitly parked, with its design record intact.

## Assumptions carried forward from the design spike (each to be mirrored into open-questions.md when this is scheduled)

1. **Dataset count.** The "~8–10k Eurostat datasets vs. CBS's ~4,858" figure is from the owner's Perplexity
   research, unverified in this repo; the count is measured against the Catalogue API at design-review time
   before any sizing (mirror runtime, shortlist quotas) rests on it.
2. **Licence exceptions.** The exact list (non-EU country data; CH/AT trade) and its interpretation get a legal
   check before the registry entry lands (ADR 030's licence revisit trigger); slice-time exclusion is assumed
   sufficient pending that check.
3. **NUTS ↔ CBS equivalence** is exact for provincie/COROP under the current NUTS version and lives in
   `dimension_labels` with a reviewed seed, same as herindelingen; a NUTS revision uses the same playbook.
4. **Per-period status for a per-cell-flag source.** Conformance F2 and ingestion validator step 3 accept the
   adapter's "every observed period published; provisional-ness per cell" reading without a waist change; if
   the harness insists on a per-period status vocabulary, that is an ADR-recorded adapter-contract amendment,
   never a silent workaround.
5. **Period grains.** The datasets the ICP asks about are annual/quarterly/monthly; semester/weekly/daily
   refusal in E1/E2 costs little. Measured in E1 against real questions.
6. **Decimals** derived from a fixture's observed maximum precision are honest (never round a served value)
   and are pinned per table at registration.
7. **Discovery.** The first 20–30 asked-about datasets are coverable by the alias layer; the pgvector step is
   evaluated on a measured miss rate, never on catalog size alone.
8. **Catalog freshness.** A daily Catalogue-API refresh is enough (Eurostat updates twice daily); the CBS mirror
   refresh already takes ~19 minutes for 4,858 rows and is a manual/CLI script, not a Cron job today (Amendment
   9 above) — E1 keeps Eurostat's refresh the same way; making either a real scheduled job is separate work.
9. ~~**Both-sources ambiguity.**~~ Resolved by Amendment 5 above, folded into D5(a) as a decision, not an
   assumption: Eurostat is offered as an explicit clarification chip when CBS has no reading, never auto-fetched.
10. **Request-URL storage** has no GDPR angle: URLs carry dataset codes and filters, never user data.
11. **Attribution wording** — the Dutch Eurostat line, the flag suffixes and the null-reason labels — are owner
    sign-offs before E1's registry entry is written.

## Revisit triggers

- E1's fixture captures show a needed flag or metadata field that JSON-stat 2.0 does not carry → switch the
  wire format to SDMX-CSV (alternative 5), one parser change inside the adapter.
- Real questions (E1 measurement, later E2 usage) ask for semester/weekly datasets at a rate that matters → the
  ADR 030 D2 grain-extension design.
- The alias layer's measured miss rate stays high after the first 20–30 datasets → enable pgvector for the
  Eurostat catalog (ADR 002's path), with its spend recorded.
- A dataset the ICP needs exceeds the slice cap even NL-scoped → raise the cap (ADR 026's 300 s ceiling
  revisit) before implementing the async API.
- The E2 widening's design shows the intent schema or `resolve.ts` needs more than an additive region-code
  family → a full ADR 011 amendment rather than an E2 brief note.
- A second regional non-NL source (RIVM/Kadaster are NL; a future EU-level or member-state source) → the
  widened taxonomy is the waist it maps into; if it cannot, this ADR's D2 reopens.
- The owner schedules the pattern-discovery track → its own ADR, starting from the spike's §4 and the S-family
  draft there; this ADR is not extended for it (D10).
- Eurostat announces versioning, an API deprecation or a licence change → the adapter (D1) is the isolation
  seam, exactly as ADR 003 makes the CBS adapter the seam for the SDMX migration.

## As-built (E1, session 101 continuation, autonomous overnight, 2026-09-14/15)

**Built:** `src/eurostat-adapter/` (types, the JSON-stat 2.0 parser, the live `StatisticsApiSource`, the fixture
replay), an `adapterFor('eurostat')` line, the eurostat `SourceInfo` registry entry, the source-scoped catalog
prune (wiring point 1), the D7 migrations (032 DOI columns, 033 `request_urls` — file-only, unapplied), the
D7(a)/(b) attribution and proof-panel code, the Amendment-3 deny gate in `src/catalog/recall.ts`, and the
internal `EUROSTAT_EXPLORER_ENABLED`-gated explorer (`web/app/eurostat-explorer/`). Full detail, task by task:
[session-briefs/2026-09-14-wp30c-e1-executor-brief.md](../session-briefs/2026-09-14-wp30c-e1-executor-brief.md)
(the frozen brief, with its own second adversarial review's Amendments B1–B6 folded in) and
[STATUS.md](../STATUS.md)'s session-101 entry. Branch `wp30c-e1-eurostat-adapter`, PR pending — autonomous,
core-product code, never auto-merged (#118(b)).

**Deviated from this ADR, deliberately, and why:**
- **A new session-level scoping decision, "Constraint 0": no live Eurostat API call happened this session,
  even a free read-only one** — the build-plan's WP30c entry pairs "any real Eurostat API spend" with "Live
  DDL... never autonomous," and this session read that literally rather than assuming "spend" meant money
  only. Consequence: every fixture is hand-built and explicitly `"synthetic": true`, never captured; zero
  real Eurostat tables are registered; the Amendment-12 live smoke probe and Amendment 7's "verified against
  real data" half stay open ([#249](../open-questions.md)). This ADR's own D9 E1 done-definition ("≥3 real
  datasets rendered," a live smoke probe) is therefore NOT met by this build — a narrower, disclosed
  done-definition in the executor brief was met instead. If this reading is overly conservative, that is the
  owner's call on PR review, not this session's to assume.
- **D6's `definitiveStatuses: ['']` is shipped as `[]` instead.** **⚠ NO LONGER THE AS-BUILT STATE — superseded
  by the fourth as-built addendum (#251, session 109): it is now `['Published']` and the prerequisite named at
  the end of this bullet is BUILT.** The paragraph below records why `[]` was correct at the time.
  D6 assumed the unflagged status reaches
  `isProvisionalStatus` as a genuine per-cell status; it doesn't — `src/ingestion/pipeline.ts`'s `status`
  column has no per-cell path at all, only a per-period-code one (the CBS shape). An empty array makes every
  Eurostat cell render provisional unconditionally instead — strictly safer, per principle (c), but a real
  correction to D6's text, not a build detail. A scoped `pipeline.ts` change to carry a genuine per-row status
  is now a named prerequisite before any Eurostat cell may render as anything but maximally cautious
  ([#251](../open-questions.md)).
- **The chip-visibility gap this build actually found, that neither this ADR nor its own pre-build review
  anticipated:** merely registering a second `SourceInfo` entry made `web/components/chat.tsx`'s existing
  WP129+130 source-chip row (`Object.keys(SOURCES).map(...)`) render and default-select a new "Eurostat data"
  chip for every real user — a live violation of D3(b)/(c) that had nothing to do with any Eurostat data
  existing yet. Fixed with a new `SourceInfo.chatSelectable` field (`true` for cbs, `false` for eurostat,
  applied at both the chip UI and the server's untrusted-selection validator in `web/app/actions.ts`) — this
  is now the actual mechanism D3(d)'s "flips on in E2's owner-signed sweep" refers to, not a hypothetical.
- **`request_urls` (D7(b)) is wired at two of `buildAnswerProof`'s three call sites, not all three** — the
  live chat proof panel (`chat.tsx`, `'use client'`, no server context) doesn't show it; replay and question
  history do ([#252](../open-questions.md)). Applies to CBS proof panels too, so it is a coverage gap, not an
  Eurostat-specific one. **As-built (session 109, 2026-09-17): closed.** `web/app/actions.ts`'s
  `askQuestion`/`replyToClarification` now run the same `fetchRequestUrlsByBatch` lookup AFTER the answer is
  settled (fail-open, never inside the charged section) and thread it onto a new `AskOutcome.proofRequestUrls`
  field; `chat.tsx` reads it for the live turn exactly as `replay-assemble.ts`/`question-history.tsx` already
  did for a resumed one. All three call sites are wired; see [#252](../open-questions.md) for the measured
  test counts.

**A third real defect, found by the required final whole-branch review (after all tasks were built, before
the PR) — the most serious of the three:** Task 4's live-chat deny gate (`src/catalog/recall.ts`) was
originally implemented gated on `EUROSTAT_EXPLORER_ENABLED` — the SAME flag the internal explorer route
checks for its own visibility. That coupling meant flipping the explorer flag on — exactly what this ADR's
own RUNBOOK follow-up instructs doing, to check the explorer against a real registered table — would ALSO
have lifted the only protection keeping a registered Eurostat row out of live chat, a direct D3(c) violation
("never announced before it answers") with no code change needed to trigger it, just the documented next
step. Fixed: the deny gate is now unconditional, no flag at all — confirmed safe because the explorer never
depends on it (it reaches a table via an explicit-target intent, bypassing recall/discovery entirely). A
related, lower-severity gap in the SAME review pass: the pre-existing #108 status-flip detection
(`src/catalog/ingest.ts`) joined every registered table regardless of source, which would have caused a
CBS-only refresh to spuriously report every registered Eurostat table as "flipped" the moment a real
Eurostat catalog capture gives it a non-empty `currentCatalogStatuses` — fixed by scoping that join to the
refresh's own source, with a regression test that exercises the scoping directly (a real registry-status
dormancy, per Amendment B1, meant the bug couldn't be demonstrated with Eurostat's own current settings).

**Confirmed still correct, unchanged:** D1 (no new abstraction — the adapter models `cbs-adapter/` exactly),
D4 (id-prefix discipline), D5's zero-prompt-bytes claim (the benchmark ran byte-identical, 14/14+6/6+0
fabricated, before and after this build), D8's ingestion posture, and every Alternative/Consequence not named
above.

## As-built addendum — Constraint 0 resolved, real captures + two real defects found (session 107, 2026-09-16)

Session 107 resumed PR #23 (merge-conflict resolution against 53 commits of drift on `main`). Asked directly,
the owner confirmed the Constraint 0 reading above was overly conservative: "no real Eurostat API spend" meant
money, not any live call — Eurostat's API is free/public/read-only. This unblocked the RUNBOOK's owner-supervised
step, run live this session (steps 1-3 of 5; steps 4-5 — registering a real table and applying migrations 032/033
— stay owner-supervised, unstarted, since they need `npm run db:migrate`).

**Two real API-shape defects found, exactly what Constraint 0's own disclosed uncertainty anticipated:**

1. **The Catalogue "table of contents" endpoint returns tab-separated TEXT, not JSON.** The original
   `parseJsonStatCatalog` assumed a `link.item[]` JSON shape (a best-effort guess from Eurostat's documented
   conventions); the real endpoint 406s on an `Accept: application/json` header and returns a quoted,
   tab-separated file (`title\tcode\ttype\t...`) instead. Rewritten to parse the real TSV — `type: 'dataset' |
   'table'` rows are real, independently-queryable leaf nodes (both verified live against the Statistics API);
   `'folder'` rows are pure navigation, dropped. `statistics-api.ts` gained a `fetchText` alongside `fetchJson`
   (no `Accept` header on this one endpoint). The real toc file carries no per-entry lifecycle/status field at
   all — `status` stays `null` for every entry, and this is now a CONFIRMED absence, not "unknown pending a
   capture" ([#250](../open-questions.md) updated accordingly).
2. **Eurostat's real Statistics API returns `value` as a sparse, offset-keyed OBJECT, not a dense array** —
   e.g. `{"400": 7.7, "401": 9.3, ...}`, a spec-valid JSON-stat 2.0 alternative the original parser's
   `requireDataset` hard-rejected. `JsonStatDataset.value`'s type widened to `Array<number | null> |
   Record<string, number>`; `jsonstat.ts` gained `valueAt`/`validateValueShape` to handle both shapes (mirroring
   `normalizeStatus`'s existing dense-or-sparse handling for `status`). A THIRD, related finding surfaced by the
   conformance harness once real data flowed through: a cell absent from BOTH the sparse `value` map and the
   sparse `status` map (a normal shape for real EU data — not every geo×time combination is reported, unlike
   CBS's dense grid) was defaulting to `valueAttribute: 'None'`, which per `CbsObservationRow`'s own contract
   means "a real, present value with nothing to flag" — dishonest for an absent cell. Fixed: `'None'` now only
   applies when a value IS present; an absent value with no explicit flag defaults to Eurostat's own `':'`
   (not-available) flag, already registered in `registry.ts`'s `nullReasonLabels`.

**Real captures now committed** (`tests/fixtures/eurostat/`, `"synthetic": false`): the full real Catalogue TSV
(10,331 entries, 2.1MB) and two small real datasets, `tipsbd30`/`migr_asyapp1mp` (515/525 cells each) — chosen
fresh from the live catalog capture specifically because the original three demo codes
(`demo_pjan`/`namq_10_gdp`/`nrg_bal_c`) turned out to have real cell counts of 742,730/8,191,372/21,300,267 —
all three exceed `SYNC_CELL_THRESHOLD` (500,000), too large to usefully commit as synchronous-happy-path
fixtures. Their original hand-built specimens stay in place, unchanged, still used by unrelated unit tests.

**A third, unrelated real defect found while merging: a cross-branch migration NUMBER collision.**
`031_source_doi.sql` (this branch, built 2026-09-14/15) and `031_chart_headlines.sql` (an unrelated feature
that landed on `main` session 105, 2026-09-16, while this branch sat unmerged) both claimed migration number
031. `src/db/migrate.ts` tracks applied migrations by filename in a `done` set but inserts by NUMERIC
`version` into a `primary key` column — two different files with the same leading number pass the filename
check independently, then collide on the second `insert`. Surfaced as a real, reproducible test failure
(`duplicate key value violates unique constraint "schema_migrations_pkey"`) that made EVERY suite depending on
`createIngestedDb()`/`applyMigrations` fail, not just Eurostat's own — caught by running the full backend
suite after the merge rather than trusting the merge's own "no conflicts here" silence (two different
filenames never conflict in git, so this collision was invisible to the merge itself). Fixed by renumbering
this branch's two never-applied migrations: `031_source_doi.sql` → `032_source_doi.sql`,
`032_ingestion_batch_request_urls.sql` → `033_ingestion_batch_request_urls.sql` (plus their paired test files
and every code/doc cross-reference to the old numbers) — a pure rename, zero data or deployed-schema impact
since neither had ever been applied. **Lesson for future sessions:** two independently-developed branches can
each freely pick "the next number after what I see" and still collide once merged, since git's own conflict
detection only catches same-PATH edits, never same-NUMBER-different-file additions — the backend suite's own
`schema_migrations` primary key is what actually catches it, and only if the full suite runs post-merge before
declaring victory.

## Second As-built addendum — migrations applied, a real table registered, a fourth real defect found (session 107, 2026-09-16/17, on the owner's explicit go-ahead)

The owner directly instructed "apply migrations and register a real table," completing RUNBOOK "WP30c E1"'s
remaining steps 4-5 (full account: RUNBOOK's own WP30c E1 section).

**Migrations 032/033 applied to production** (`npm run db:migrate`) and verified directly against the live
database (columns exist, correct types; no new security advisories).

**A real table registered and synced: `eurostat:tipsbd30`, 532 real rows, 0 corrections** — via a one-off
script calling `registerTables`/`syncTable` directly with `adapterFor('eurostat')`, since neither the
`ingest` nor `catalog:refresh` CLI's own entry point was ever wired with a source-selection flag (both
hardcode `CBS_SOURCE_KEY`); the underlying pipeline functions were always source-agnostic.

**A fourth real defect found, this time in `registerTables` itself, not the adapter:** its `insert into
cbs_tables` never wrote the `source` column at all, so every table ever registered — Eurostat included —
silently landed tagged with the column's own default, `'cbs'`. Invisible until now because Eurostat was the
first non-CBS source anything has ever actually registered; `ingestCatalog`'s own insert into `cbs_catalog`
(the separate catalog-mirror table) already did this correctly, which is presumably why the gap in the
table-registry insert was never caught by the WP30c/E1 brief's own review rounds — a different function,
same table-adjacent concern, and the review checked the one that was already right. **Not a live-chat safety
gap**: `src/catalog/recall.ts`'s deny gate derives the source from the table id's own string prefix
(`sourceKeyForTableId`), by design never this column — its own comment states exactly why ("so this can
never drift"), and that design choice is what kept this from ever being a real exposure. It WAS a real
display bug: `web/lib/eurostat-explorer.ts`'s own `where source = $1` query could never have found this (or
any future) Eurostat table. Fixed by deriving and writing `source` via the same `sourceKeyForTableId` the
deny gate itself uses (commit `0a5c2c8`); two regression tests added (a bare-id CBS table still tags `cbs`,
an `eurostat:`-prefixed table tags `eurostat`, neither defaulting silently); the one already-registered
production row corrected directly via SQL, verified against the live database.

**Still genuinely open:** `doi` was never populated for this table (stays `null`) — nothing in
`registerTables` sources a DOI from anywhere, so ADR D7(a)'s "populated at catalog/registration time" was
itself never implemented, a separate, not-yet-scoped gap from the column-tagging bug above.

**Research update, session 108 (2026-09-17, subagent, docs-only — [open-questions #264](../open-questions.md)):**
D7(a)'s DOI source is now VERIFIED, closing the "not yet scoped" gap above. Eurostat mints one DOI per
dataset, pattern `10.2908/<CODE>` (code uppercased) per Eurostat's own "Anchoring of datasets" guide —
confirmed live via the public DataCite REST API (`GET https://api.datacite.org/dois/10.2908/<code>`) for
three real datasets including `tipsbd30` itself (200, `state: "findable"`, title matching what's already
registered here); the `doi.org` resolver path was confirmed live too. Neither the Catalogue endpoint nor
the Statistics API expose it — DataCite is the only verified programmatic source, and would be a NEW
third-party ingestion-time dependency (out-of-band, never the request path — consistent with principle
(b)) if built: construct the DOI deterministically, verify it with one DataCite call at registration time,
write `doi` only on a confirmed `findable` response, leave `null` otherwise rather than store an unverified
guess. Not built yet — still a future session's scoping/priority call; see open-questions #264 for the
full write-up. A full browser
click-through of `/eurostat-explorer` was not done (would need either flipping the production
`EUROSTAT_EXPLORER_ENABLED` flag, itself owner-supervised, or contending with another session's already-
running local dev server) — the explorer's own backing SQL query, run directly against the live database,
does now return this table, which is the load-bearing fact step 4 needed proven. Amendment 7/D9's "≥3 real
datasets rendered end-to-end" and the Amendment-12 live smoke probe are now reachable (one real table is
registered) but not yet exercised through the actual page. D6's `definitiveStatuses: []` correction and the
[#251](../open-questions.md) `pipeline.ts` per-cell-status prerequisite are unaffected by anything in this
addendum.

## Third As-built addendum — D7(a) DOI construction + verification built (session 109, 2026-09-17, #264)

`registerTables` (`src/ingestion/pipeline.ts`) now sources a DOI for every newly registered Eurostat table,
closing the gap the previous two addenda left open. New module `src/eurostat-adapter/doi.ts`:

- `eurostatDoiFor(tableIdOrCode)` — deterministic construction, zero API calls: `10.2908/<CODE uppercased>`,
  stripping an `eurostat:` prefix if present (a local `nativeIdFrom`, duplicated on purpose per this
  codebase's existing per-adapter convention, not imported from `src/sources/registry.ts`'s private helper).
- `verifyEurostatDoi(doi, { fetchImpl?, timeoutMs? })` — one cheap, out-of-band (never the request path) call
  to the public, unauthenticated DataCite REST API (`GET https://api.datacite.org/dois/<doi>`); returns
  `true` only on a 200 with `data.attributes.state === "findable"`. NEVER throws — a 404, any other non-2xx,
  a network error, a JSON-parse error, or a timeout all resolve to `false`, mirroring
  `src/chart/brandfetch.ts`'s `fetchBrand` fail-safe shape. `fetchImpl` is injectable so tests never touch
  the real network.

`registerTables` calls both, scoped to `sourceKeyForTableId(table.id) === EUROSTAT_SOURCE_KEY` rows only —
CBS has no DOI concept, so `cbs_tables.doi` stays `null` for every CBS row forever, with zero API calls
attempted for them (cheapest-mechanism-first). A `findable` result writes the constructed DOI in the same
insert as the rest of the registration row; anything else (unconfirmed, or a genuinely unexpected exception
from the verification call, belt-and-braces around a function that already never throws) leaves `doi` null
and logs a plain-language `console.warn` — this can never block or fail registration itself (D7(a)'s DOI
remains presentation-only support for the proof panel, not a fifth validation-pipeline check).

**`cbs_catalog.doi` is intentionally NOT populated by this change** — checked, not assumed:
`registerTables` never writes `cbs_catalog` at all; that table is refreshed separately by
`ingestCatalog` (`src/catalog/ingest.ts`), whose own upsert has no `doi` column in its `UPSERT_SQL` and
sources rows from the bulk Catalogue fetch, which (per the session-108 research this addendum builds on)
does not expose a DOI at all. D7(a)'s "populated at catalog/registration time" refers to the registration
step (`registerTables`), which is what this change does; extending `cbs_catalog` would be a separate,
unscoped gap if ever wanted.

**Backfill**: the already-registered `eurostat:tipsbd30` production row predates this fix and was NOT
touched by it (registration is a one-time, already-registered-tables-are-skipped operation). A new
idempotent script, `scripts/backfill-eurostat-doi.ts` (`npm run backfill:eurostat-doi`, dry-run by default,
`--apply` to write, mirroring `scripts/gdpr-purge.ts`'s shape), finds `source = 'eurostat' and doi is null`
rows and applies the same construct-then-verify rule. Not run against the live database by this session
(no live DB writes from a dispatched session) — documented as an owner RUNBOOK step
(docs/RUNBOOK.md's "DOI backfill" section under WP30c E1).

**Tests** (hermetic, `tests/ingestion/ingestion.test.ts`, PGlite, no real network): a Eurostat table gets
`doi` on a 200/`findable` DataCite response; stays `null` on a 404; stays `null` when the injected
`fetchImpl` throws (registration still succeeds); a CBS table never gets a `doi` and never triggers a
DataCite fetch at all; re-registering an already-registered table is a no-op skip with no second DataCite
call.

**Assumption carried forward** (mirrored in open-questions #264): DataCite's `findable` state for a
constructed `10.2908/<CODE>` DOI is being trusted as the correctness signal per the session-108 research
(3 real datasets spot-checked, no counter-example found); the rollout may not yet cover every one of
Eurostat's ~10,331 catalog entries, so a legitimately-published Eurostat dataset without a live DOI yet
would correctly register with `doi = null` under this rule, not a false negative in the code.

[#251](../open-questions.md) `pipeline.ts` per-cell-status prerequisite were unaffected by anything in this
addendum — both were then settled by the next one, below.

## Fourth As-built addendum — D6 per-CELL statuses BUILT; Amendment B1's `definitiveStatuses: []` superseded (session 109, 2026-09-17, [#251](../open-questions.md))

**What was wrong.** D6 said the observation flag "rides in `observations.status`" and that the registry
declares `definitiveStatuses: ['']`. Neither was true as built. `src/ingestion/pipeline.ts` derived
`observations.status` — the one column R11's `isProvisionalStatus` ever reads — *exclusively* from
`periodStatusByCode`, a per-PERIOD-code lookup built from the time dimension's code list. That is the honest
CBS shape (every cell in a CBS period shares one CBS status) but it left Eurostat's real per-CELL flags with
no path into the column at all. E1's fix (Amendment B1) was to ship `definitiveStatuses: []`, which makes
`isProvisionalStatus` return `true` unconditionally: every Eurostat cell rendered provisional, forever. Safe
(principle (c)) but permanently over-cautious, and an explicit prerequisite for E2.

**What is built now.** An **optional per-row status override in the narrow waist**:
`CbsObservationRow.status?: string` (`src/cbs-adapter/types.ts`). `pipeline.ts`'s staging loop reads
`row.status ?? periodStatusByCode.get(periodCode)` — the override when an adapter supplies one, the unchanged
per-period lookup otherwise. A present-but-blank override is a loud throw, never a silent definitive
(principle (c)). **CBS is untouched:** its adapter never sets the field (pinned by test — the key is absent
from every parsed CBS row, not merely `undefined`), so the new branch is never taken on a CBS sync and every
CBS status still comes from the period code list.

**The flag → status mapping (the D6 vocabulary, as built).** `src/eurostat-adapter/jsonstat.ts` emits one
status per observation. Deliberately *lossless*: the JSON-stat flag rides through verbatim, so
`provisionalDisplay` can render its specific Dutch suffix, and R11 can always separate provisional from
definitive.

| Eurostat cell state | emitted `status` | `isProvisionalStatus` | Why |
| --- | --- | --- | --- |
| no flag, value present | `Published` (`EUROSTAT_DEFINITIVE_STATUS`) | **false — definitive** | Eurostat published the figure and flagged nothing about it. The one definitive state. |
| `p` provisional | `p` | true | ' (voorlopig cijfer)' |
| `e` estimated | `e` | true | ' (schatting)' |
| `s` Eurostat estimate | `s` | true | ' (schatting door Eurostat)' |
| `f` forecast | `f` | true | ' (prognose)' |
| `b` break in series | `b` | true | ' (methodebreuk)' |
| `c` confidential | `c` | true | **Never definitive.** Also a `nullReasonLabels` key. |
| `d` definition differs | `d` | true | ' (afwijkende definitie)' |
| `u` low reliability | `u` | true | ' (lage betrouwbaarheid)' |
| `n` not significant | `n` | true | **Never definitive.** |
| `z` not applicable | `z` | true | **Never definitive.** Also a `nullReasonLabels` key. |
| `:` not available | `:` | true | **Never definitive.** Also a `nullReasonLabels` key. |
| no flag, **no value** (Eurostat's sparse shape) | `:` | true | Nothing was reported for this coordinate, so "published, definitive" would be a guess. Mirrors the same cell's `valueAttribute`. |

The mechanism that makes this safe is deliberately *structural*, not a list of exceptions: `definitiveStatuses`
holds exactly one value (`['Published']`), and **no Eurostat flag is that string**, so `c` / `:` / `n` / `z`
cannot become definitive even if the flag vocabulary grows. A new, unrecognised Eurostat flag lands outside
`definitiveStatuses` and is therefore marked provisional — the fail-safe direction, unchanged.

`'Published'` is the SAME constant the adapter already reported as each period's status (D6's "Eurostat has no
per-period publication status; the adapter reports every observed period as published"), on purpose: an
unflagged cell then gets an identical status whether it arrives via the override or via the period fallback,
so the two paths can never disagree. The registry spells it as a literal rather than importing it — that
module is a pure leaf bundled into client code — and a test pins the two equal.

**Consequently:** D6's `definitiveStatuses: ['']` text is superseded by `['Published']` (the `''` was always
unreachable — the empty string is not a status any adapter emits), and Amendment B1 / the first as-built
addendum's "`[]` instead" note describes a state that no longer exists.

**No migration.** `observations.status` is plain `text not null` with no CHECK constraint
(`migrations/001_ingestion_schema.sql`; nothing later alters it), so a new status vocabulary needs no DDL —
verified before writing this, and deliberately not accompanied by a migration file.

**Also added:** conformance family F3 now fails a source whose adapter emits a per-cell status that is not in
its manifest's `declaredPeriodStatuses` — the same discipline F2 already applies to period-level statuses. An
undeclared status is exactly how a typo'd flag could slip outside both `definitiveStatuses` and
`provisionalDisplay` and render unmarked.

**Still unchanged by this addendum:** Constraint 0's two remaining E1 inertness gates — `chatSelectable: false`
(Eurostat is still not selectable in live chat) and `currentCatalogStatuses: []` (confirmed permanent for that
endpoint, [#250](../open-questions.md); *superseded 2026-10-01 by the "finding a Eurostat dataset" addendum:
`['current']`, our own data-end judgement*) — and the open owner sign-off on the Dutch suffix / null-reason
wording (Amendment 11, [#250](../open-questions.md)(a)). **Update 2026-09-26 (session 131): the owner approved that wording as drafted — the sign-off is no longer open.**

## Fifth As-built addendum — footer trust line made source-aware for the Eurostat explorer only (session 110 UX audit pass 2, row 18, 2026-09-17)

**What was wrong.** The session-110 UX audit (pass 2, row 18) found the ONE internal page that is entirely
Eurostat data — `web/app/eurostat-explorer/page.tsx` — rendered the single global footer's CBS-only trust line
("Figures: CBS StatLine (CC BY 4.0) · Every number traceable to an official CBS table"), which is simply wrong
on a page with no CBS data on it at all. Harmless while the page is internal/flag-gated, but the parent session
judged that on this one internal route, correctness of attribution outweighs the "footer stays byte-identical
everywhere" posture D3 otherwise holds until Eurostat itself goes public.

**Decision.** Made the footer source-aware for exactly this one route, reusing the existing
`x-embed-route`-style proxy-header pattern rather than inventing a new mechanism: `web/proxy.ts` now exports
`sourceRouteHeaders`/`applySourceRouteHeader`, which set `x-source-route: eurostat` for the exact
`/eurostat-explorer` path only and strip any client-supplied value on every other path (same strip-then-set
discipline `applyEmbedRequestHeaders` already uses). `web/app/layout.tsx` reads that header, re-validates it to
exactly `"eurostat"`, and passes it to a new `SiteFooter({ sourceRoute })` prop, which selects the new
`footer.attributionEurostat` message key (added to both `nl`/`en` in `web/lib/i18n/messages.ts`, wording taken
from `src/sources/registry.ts`'s Eurostat entry: `attributionLabel: 'Eurostat'`, `license: 'CC BY 4.0'`) instead
of `footer.attribution`. Every other route keeps rendering the plain CBS line byte-for-byte — pinned in
`site-footer.test.tsx`, `layout.test.ts`, and `proxy.test.ts`.

**Not touched:** D3's public-facing posture itself (Eurostat is still `chatSelectable: false` and invisible to
real chat users); this only fixes copy on an internal, flag-gated, noindexed page. `chatSelectable`/
`currentCatalogStatuses` and Amendment 11's open owner sign-off are unaffected.

## Design-round note — E2's first slice proposed (session 124, 2026-09-23)

The E2 design round this ADR requires has started, as a PROPOSAL only:
[superpowers/specs/2026-09-23-eurostat-e2a-country-answers-design.md](../superpowers/specs/2026-09-23-eurostat-e2a-country-answers-design.md)
([open-questions #313](../open-questions.md)). It cuts E2 into slices, the first being "E2a: country-level answers":
reviewed Eurostat "siblings" of existing CBS measures, offered through a dry-run-verified clarification chip
when CBS has no reading for a named country (D5a / Amendment 5, never an automatic switch), one source per
answer, countries only (the adapter already drops every NUTS 1–3 row), and Dutch country names via a
maintained word list (the ADR 040 precedent). D2's taxonomy widening (sub-national NUTS) is deferred to a later
slice, not dropped. Nothing in this ADR's decisions changes; the proposal awaited six owner decisions (its §7). **Session 125 (2026-09-23): the owner approved all six** — D3 with a
wording change (the confirm chip names the source it will use; it is not framed as "CBS has no figure"). Steps 1–4 were
built dark and merged to `main` session 125 (sibling measures live in a sibling-only list, never `defaults.ts`); steps 0/5/6 wait for live spend after 2026-10-01.

## As-built addendum — E2a step 5 built (mechanical, still dark); a real D3(d) risk found and closed (session 125 continuation, 2026-09-23, branch `e2a-step5-staging`)

Step 5 (register the three reviewed sibling tables) is now mechanical: `src/sources/eurostat-siblings.ts`'s
`EUROSTAT_SIBLINGS_REVIEWED`/`EUROSTAT_SIBLING_MEASURES_REVIEWED` hold the three reviewed pairs, a committed
script (`scripts/register-eurostat-siblings.ts`, `npm run eurostat:siblings`) registers + syncs the tables,
and `src/registry/apply.ts` upserts a sibling's `canonical_measures` row once its table exists — all
independent of the runtime flag, `EUROSTAT_SIBLINGS_ENABLED`, which stays unset (step 6, unchanged, still
owner-signed). Full account: docs/RUNBOOK.md, "E2a step 5".

**A real D3(d) violation risk, found by an independent review and closed in the same change:** D3(d) above
requires the public surface (`/llms.txt`, the coverage disclosure) to stay byte-identical until the E2
wording flip ships. `src/registry/coverage.ts`'s `buildCoverageReport` is a PLAIN enumeration of
`canonical_measures` with no other filter — so the moment step 5's `registry:apply` upserts a sibling
measure (which can happen long before step 6, by design — step 5 is meant to be run ahead of the flip), the
public `/llms.txt` and the coverage-disclosure component would have listed the Eurostat table and its
NOT-yet-owner-signed Dutch label, exactly the historical Amendment-1 mistake this ADR's D3(b) already
records once (the "Eurostat — binnenkort" notice, a pre-D3 announcement removed 2026-09-14). **Fixed before
step 5 ever ran in a real database:** `buildCoverageReport` now excludes a reviewed sibling measure — table
and label both — for as long as it is not RUNTIME-active, gated through the exact same single function
(`eurostatSiblingTargetKeys`/`activeEurostatSiblings()`) the resolver, the offer-side clarification gate and
the click trust boundary already agree on, never a second copy of "which pairs are reviewed." Tests:
`tests/registry/coverage.test.ts`'s new describe block (flag off → both absent; flag on → both present,
using the real reviewed key `eu_unemployment_rate_harmonised`).

**A second, independent bug found in the SAME code path — confirmed LIVE on production, unrelated to E2a
itself (fix round 2, same session):** `web/lib/llms-txt.ts`'s renderer hardcoded `- CBS ${table.id}` for
every row. Harmless while every registered table really was CBS, but E1 already registered a non-CBS table
(`eurostat:tipsbd30`, [#249](../open-questions.md)) — the deployed `/llms.txt` was verified to read
`- CBS eurostat:tipsbd30 — Tier-1 capital ratio banking sector (...)`, naming the wrong source AND printing
a redundantly double-prefixed id. Fixed at the source: `buildCoverageReport` now resolves each table's real
`sourceDisplayName` (`resolveSourceForTable(id).displayName`) and bare `nativeId` (`nativeIdFrom`, newly
exported from `src/sources/registry.ts` for this) from the registry itself, and the renderer prints those —
never a second, hand-maintained assumption about which source a row belongs to. CBS lines are byte-identical
(no prefix to strip); a Eurostat line now reads `- Eurostat tipsbd30 — ...`. This was a display bug only —
D3's "never announced before it answers" rule was never at stake, since `tipsbd30` was already a publicly
visible coverage row before this fix (E1's own D3 posture never hid a registered table from `/llms.txt`,
only from chat and the finder).

## As-built addendum — first real E2a sibling registration: monthly grain fixed, inflation dataset swapped (2026-09-30, owner present)

`npm run eurostat:siblings -- --apply` (E2a step 5) was run for real for the first time and hit two defects the
hermetic suite could not see, because every Eurostat parser fixture was hand-built (no real monthly response had
ever been captured):

1. **Monthly period spelling.** The Statistics API's `time` codes are `YYYY-MM` (`2026-08`), not `YYYY-Mnn`.
   `MONTH_RE` (`src/eurostat-adapter/jsonstat.ts`) now accepts both; a comment in `statistics-api.ts` that claimed the
   response used `2024-M01` was wrong and is corrected. D6's "monthly" grain had therefore never worked on real data.
2. **The reviewed inflation dataset was frozen.** `prc_hicp_manr` labels itself "(1997-2025)", last updated
   2026-02-06, no period after 2025-12. Eurostat's HICP moved to ECOICOP ver.2: the live series is
   `prc_hicp_minr` (updated 2026-09-17, through 2026-08), classification dimension `coicop18` (all-items = `TOTAL`),
   unit `RCH_A`. The pair `cpi_yearly_inflation` ↔ `eu_hicp_annual_rate` now points at `eurostat:prc_hicp_minr`
   (`coicop18=TOTAL`); the key name is unchanged. Slice: 34 geos × 140 months = 4,760 cells, 24 flagged `e`.

**Measured live state after the fix** (production, dark): `eurostat:une_rt_q` 2,112 rows (to 2026-Q2; flags `b`, `bu`,
`d`, `u` present — the D5b break-in-series refusal has real cases), `eurostat:prc_hicp_minr` 4,760 rows (to 2026-08),
`eurostat:namq_10_gdp` 2,244 rows (to 2026-Q2, `p` flags); all pinned, DOIs verified at registration. NL latest values
match a fresh Eurostat fetch (GDP 1.8 `p`, unemployment 3.9, HICP 2.8). `registry:apply` (step 3) is NOT yet run: it
aborts while `70072ned` (in main's defaults, not yet loaded in production) is unregistered — it follows the regional
prod load.

**Guard added:** `tests/eurostat-adapter/sibling-real-responses.test.ts` parses the REAL captured responses
(`tests/fixtures/eurostat-siblings/`, refresh with `node scripts/capture-eurostat-fixtures.ts --siblings`) for every
reviewed registration and checks the reviewed measure code, every pinned coordinate and the period grammar against them.
**Revisit:** Eurostat retires/renames datasets without notice — a future freshness check for Eurostat tables (the CBS
`ingest:freshness` reports them as "not checked") would catch the next frozen one; tracked in [#313](../open-questions.md).
*(Built: the freshness report's "possibly frozen" verdict (#357), and — for a slice-stored dataset — the warm job, which
quarantines a dataset whose newest period is too old for its grain; ADR 065's #358 item 4 as-built note.)*

## As-built addendum — structure reader: a dataset's layout without downloading its numbers (2026-10-01, #357 study step 1, branch `eurostat-structure-reader`, dark)

**What it is.** `src/eurostat-adapter/sdmx-structure.ts` reads a Eurostat dataset's layout from Eurostat's own SDMX 2.1
structure messages, never from an observation download: the dataflow with its current data structure and partial code
lists (`dataflow/ESTAT/{CODE}/1.0?references=descendants&detail=referencepartial`) and the content constraint
(`contentconstraint/ESTAT/{CODE}/1.0`, the codes that actually occur, incl. `TIME_PERIOD`). It yields dimensions in key
order with their concept labels, the occurring codes with English labels, the **GEO level of every geo code** (Eurostat's
`LEVEL` annotation: `0` country, `1`–`3` NUTS, `AGG` aggregate), the time span and `UPDATE_DATA`. Technique credited to
cyanheads/eurostat-mcp-server (read, not copied; study doc §1.2). Verified live on `tipsbd30`, `une_rt_q`,
`prc_hicp_minr`, `namq_10_gdp`; captured verbatim in `tests/fixtures/eurostat-structure/` (refresh:
`node scripts/capture-eurostat-fixtures.ts --structure`).

**XML, not JSON (the study's Assumption A3, measured false).** Eurostat serves no JSON rendering that carries code lists:
the SDMX-JSON Accept header gets 406 on the 2.1 and 3.0 structure endpoints, and `format=JSON` is refused unless
`references=none`, which returns annotations only. So `src/eurostat-adapter/xml.ts` is a small strict XML reader (no new
dependency): it refuses a DOCTYPE/DTD, processing instructions, unknown entities, unbound prefixes, duplicate attributes
and anything else outside the subset these messages use. The SDMX reader is equally strict: an unexpected message
namespace, a second dataflow, an excluding cube region, a time range instead of listed periods, a constraint value with no
code, or a dimension the constraint says nothing about all throw `EurostatStructureError` (fail closed).

**Today's rules, applied generically** (`fitEurostatStructure`, `eurostatLayoutFromStructure`): one measure per `unit`
code (`<code>|<unit>`, titled "dataset title — unit label", the same shapes the JSON-stat path builds); a dataset without
a `unit` dimension (`no_unit_dimension`) or with a grain outside A/Q/M, by `freq` code or by period spelling
(`unsupported_grain`), is refused, never mapped by guesswork. Two new refusals: the constraint's time list must hold and
(one grain) run exactly between Eurostat's stated `OBS_PERIOD_OVERALL_OLDEST`/`_LATEST` (`time_span_mismatch` — the
study's A1, checked on every read, held on every dataset measured), and an `UPDATE_DATA` date is required
(`no_update_date`; it becomes the registration's `modified`, the value JSON-stat's `updated` also carries).

**Geo levels replace the hand list as the source of level information; the D6 licence exclusion stays a code rule on
top.** `EU_EFTA_STAND_IN_GEO_CODES` is now the union of `EU_EFTA_LICENSED_COUNTRY_CODES` (31) and
`EU_EFTA_LICENSED_AGGREGATE_CODES` (5) — the same 36 codes, test-pinned. A geo code is kept only when Eurostat's level says
country and it is a licensed country, or aggregate and it is a licensed aggregate; no level, or a level that disagrees with
its list, excludes it. Finding: the euro area's 2026 aggregate `EA21` exists and is outside the reviewed aggregates, so it
stays excluded until reviewed (Assumption 2); level `OTH` also occurs (excluded, unknown).

**Wiring: opt-in, production unchanged.** `StatisticsApiSource` gains `fetchStructure(tableId)` and a constructor option
`structureLayout`; with it, `fetchTableSchema`/`fetchCodeList` read the structure (two requests, no `SYNC_CELL_THRESHOLD`,
the whole dataset's codes) and `registerSchemaOnly` can register any fitting Eurostat id (proven hermetically on
`eurostat:tipsbd30`). Without it — every production caller today — the download path is byte-identical. The four live
datasets were deliberately not switched: their registered fingerprints cover the scoped unit only, so the structure's
full unit list would read as a redesign and quarantine them; a switch needs a re-baseline.

**Open (step 2 must settle): decimals.** No structure message states a unit's decimals (the primary measure is a bare
`Double`), and decimals set how a figure is rounded on screen (`formatValueNl`), so a guess could change a published
figure. The structure layout therefore takes decimals from a caller-supplied function and refuses a unit it cannot answer
for (`decimals_unknown`). An honest source is observed data — for example a small read at registration plus a slice-time
check that refuses any value carrying more decimals than registered. *(Built 2026-10-01 exactly so: see the addendum
"structure registration: decimals from a small observed read…" below.)*

**Measured (read-only crawl, not committed, 30 datasets drawn at random from the committed catalogue capture, structure
requests only, sequential):** 30/30 read cleanly; 28/30 fit (1 without `unit` — A5 ≈ 3%; 1 whose only geos are outside the
licence); every geo code carried a `LEVEL`; datasets hold 13–839 non-time codes (median 63); 5/30 declare over 500,000
cells and could never have been laid out by the old whole-dataset download. Total members (A4): of 75 classification
dimensions, 42 use `TOTAL` or `T`, at least 5 use other codes (`TOT_FTE`, `C-O`, `TOT_IN`, `IND_TOTAL`, `0`), about 28 have
none — a total must be read per dataset, never assumed. Also seen: 3/30 datasets have no `geo` dimension (geography in
`rep_mar`, `airp_pr`, …), which the licence rule, as before, did not restrict *(closed 2026-10-01: such a dataset is now
refused, and the rule restricts every dimension Eurostat marks as geography — see the addendum below)*; one dataset
mixes A, Q and M.

## Addendum — adapter step 0, defects 1–3 of the connector study (2026-09-30, #357)

Three small fixes from `docs/session-briefs/2026-09-30-eurostat-mcp-deep-study.md` §5.1, no AI and no schema change:
(1) **one total deadline per call** — a slice-bounded data call gets 30 s per attempt and 60 s in total (retries and waits
included), the catalogue file and an unsliced whole-dataset read 120 s and 240 s; the run budget (`stopAt`) still wins and
a call it cuts fails with the budget phrase, one that used up its own total fails as an ordinary source error (was: 300 s
x 3 attempts, about 15 minutes per call); (2) **permanent failures are not retried** — 400, 404, 413 and every other 4xx
except 408/429, plus an HTTP-200 body that is a 413 warning or a "no results" error, are thrown as a typed
`EurostatPermanentError` (`src/eurostat-adapter/errors.ts`: `not_found`, `invalid_dimension`, `invalid_period`,
`conflicting_params`, `too_large`, `no_results`, `rejected`) with a short specific summary; 5xx, 408, 429, timeouts and an
HTML page instead of JSON stay retried; (3) **the `"|C"` split** — the confidentiality code folded into a cell's status is
split off (`splitEurostatStatus`, `jsonstat.ts`): a confidential cell (`C`, `N`, `P`, or the flag `c`) is stored with no
value, `valueAttribute` and status `c` (the registered reason "door Eurostat niet gepubliceerd (vertrouwelijk)", the way a
CBS `Confidential` cell keeps its reason), any number that arrives beside the marker is dropped, and an unknown
confidentiality code fails the parse. The raw `"|C"` is never stored. Tests: `tests/eurostat-adapter/failure-classes.test.ts`,
`confidential-status.test.ts`, fixtures `tests/fixtures/eurostat-errors/` (hand-built to the study's shapes).

**Defect 4 — combined flags (owner-approved rule 2026-09-30, the owner's choice "Join the notes"; built 2026-10-01).**
Eurostat combines flag letters in one code (`bu` = break in series + low reliability, measured live in `une_rt_q`; `ep`;
`bdep`). Such a code now gets its note built from the already-approved single-letter notes, in the order its letters
appear, joined with "; " inside one pair of brackets: `bu` → " (methodebreuk; lage betrouwbaarheid)", `ep` → " (schatting;
voorlopig cijfer)"; English is built letter by letter the same way (" (break in series; low reliability)"). If ANY letter
is unknown (e.g. `bz`, `b:` — `z` and `:` are null-reason flags with no provisional note), every site keeps its old
fallback for an unknown marker (template " (voorlopig cijfer)", validator "voorlopig", refusal and English suffix: no
note). One helper, `provisionalNoteFor` in `src/sources/registry.ts` (registry flag `combinesFlagLetters: true`, Eurostat
only), feeds the Dutch template, the R11 validator, the refusal text and the English suffix, and the English translator's
caveat masking adds a cell's joined note — so they can never disagree. Every single-letter and every CBS status renders
byte-identically (pinned in `tests/sources/provisional-note.test.ts`); `nullReasonLabels` and the break check
(`isEurostatBreakFlag`, which already saw a `b` inside a combined code — now test-pinned) are unchanged.

## Addendum — structure registration: decimals from a small observed read, and the licence rule on every geography dimension (2026-10-01, #357 items (a) and (d), dark)

Two gaps kept the structure reader (addendum above) from registering a dataset generically. Both are closed in code;
the reader stays opt-in (`structureLayout` on `StatisticsApiSource`), and no production caller uses it. The four
registered datasets still go through the download path, so their decimals and cells are unchanged (proven by the
existing whole-table vs slice-build parity tests; their registered unit's decimals are 1).

**(a) Decimals.** Eurostat's structure never states them, so they are observed. With `decimals: 'observed'`, a
registration makes ONE small read per dataset (`observeUnitDecimals`; `decimalsProbeSlice` in
`src/eurostat-adapter/sdmx-structure.ts`): every unit at the latest period, licensed geography only, every other
dimension cut to its first codes (largest first) until the request can return at most **2,000 cells**
(`DECIMALS_PROBE_MAX_CELLS`, the per-question slice bound). A unit is settled by one value with decimals, or by 10
whole numbers (JSON drops trailing zeros: 9–10% of the four datasets' one-decimal values arrive as whole numbers); an
unsettled unit is read again over the latest two, then three periods (at most 3 reads). The read goes through the slice
request path (`buildRequestUrl`, the `data` call limits, `parseJsonStatDataset`) with only the period filtered
client-side, so a code Eurostat leaves out of a sparse answer is not an error there. A unit's decimals = the most any
seen value carries (the download path's own rule; `decimalsOf` moved unchanged to `src/ingestion/decimals.ts`). A unit
no read saw a value for is refused (`decimals_unknown`), never guessed. The result lands in the same registry field
as CBS's stated `Decimals` (`cbs_tables.units[measure].decimals`, via `CbsMeasure.decimals`). Measured on Eurostat's
real answer for `une_rt_q` (captured 2026-10-01): one read, 1,854 values, `PC_ACT` 1 and `PC_POP` 1 decimal,
`THS_PER` 0 — `PC_ACT` equals today's registration.

**When the small read saw fewer decimals than Eurostat later publishes.** The registered decimals are a lower bound.
At slice time `fetchSlice` checks every fetched value of a source flagged `decimalsFromObservedValues` (Eurostat only,
`src/sources/registry.ts`) against the registered decimals (`checkObservedDecimals`, `src/ingestion/validate.ts`): a
value with MORE decimals fails `unit_consistency`, the whole slice is refused, nothing is stored and the table is
quarantined (`needs_review`) with measure, value and both counts in the summary. The value is never rounded to fit and
the registered decimals are never raised silently; recovery is a reviewed re-registration. Fewer decimals (a dropped
trailing zero) pass and are stored unchanged. For the four download-path datasets the check can only fire where the
existing schema unit check already does (their decimals are the maximum over the whole reviewed scope). CBS tables are
not checked this way: CBS states decimals itself.

**(d) The licence rule restricts every geography dimension, found by Eurostat's own marks — never by name.** Verified on
real captures (`tests/fixtures/eurostat-structure/`, two added: `mar_mg_aa_cwhd`, `migr_asyappctza`): Eurostat marks
geography with the `GEO` code list, or a code list derived from it (`CITIZEN` carries the code-list annotation
`MASTER` = `geo`). Checked and not usable: an SDMX concept role (no captured message states one), and the `LEVEL`
annotation alone (`COICOP18` in `prc_hicp_minr` carries LEVEL 1–5 and AGG — it would have marked the price
classification as geography). `rep_mar` (`REP_MAR`: Belgium, Bulgaria, EU aggregates) and `airp_pr` (`AIRP_PR`: airport
routes) carry places with neither mark. So (`fitEurostatStructure`): every marked dimension keeps only licensed codes
and needs at least one (`no_licensed_geo`); a dataset with no marked dimension is refused (`no_identified_geography` —
"no geography" and "unmarked geography" cannot be told apart); an unmarked dimension naming a marked country or region
(same code, same English name) is refused (`unmarked_geography`). Kinds are unchanged: only a dimension named `geo` is
the waist's GeoDimension; a marked `citizen` is a plain dimension with restricted codes. **Assumption:** the licence
exceptions (Assumption 2) are read restrictively — a citizenship or partner breakdown by a non-EU country is also
withheld, although it is EU-reported data; a legal review may relax this per dimension. (**2026-10-02, #365:** the all-citizenships `TOTAL` in a GEO-derived list is now kept — see the session-153 addendum below.) Measured cost: in the
30-dataset crawl the 3 datasets without `geo` are exactly the unmarked kind, now refused.

**Open:** a dataset whose only marked dimension is not named `geo` would still get the adapter's `geo=` sweep on a data
request (`buildRequestUrl`). Unverified what Eurostat does with it: if it rejects the parameter the call fails loudly (a
permanent 400); if it ignores it, the marked dimension's listed licensed codes still restrict the request. Not seen in
any capture.
Mixed-grain datasets (#357 (e)) get their decimals read at whichever grain's latest code sorts last. Tests:
`tests/eurostat-adapter/decimals-and-geography.test.ts`; fixtures `tests/fixtures/eurostat-decimals/` (refresh:
`node scripts/capture-eurostat-fixtures.ts --decimals-probe <code>`).

## Addendum — finding a Eurostat dataset: theme breadcrumbs, a frozen-aware status, the finder behind a flag (2026-10-01, #357 study step 3, dark)

The Eurostat route (STATUS "THE PLOT") needs the same finder the CBS table lane uses to reach any Eurostat dataset.
Three changes, no schema change, no model call, off by default.

**1. Theme breadcrumbs into `summary`.** `parseJsonStatCatalog` no longer throws the table of contents' indentation
away: each dataset's ancestor folders (the generic roots "Database by themes" / "Cross cutting topics" and placeholder
folders such as `___` left out) become its breadcrumb, e.g. `Economy and finance › Prices › Harmonised index of
consumer prices (HICP)`, written into the empty `summary` column, which is already in the full-text index at weight B.
A code filed under several folders (2,031 of 7,569 in the 2026-09-16 capture; the rows are otherwise identical) is now
ONE entry at its first place, its distinct breadcrumbs one per line (before, every placement was an entry and the
upsert kept the last).

**2. A status Eurostat does not publish, judged from `data end`.** The file has no lifecycle field (#250(b)). Given a
clock, the parser sets `status` to `current` or `possibly_frozen` by the SAME limits the freshness report and the warm
job use (`src/ingestion/data-end-lag.ts`: monthly 4 months, quarterly 3 quarters, annual 30 months), and `null` when
`data end` is blank or of a grain those limits do not cover (weekly, daily, semester). `StatisticsApiSource` judges at
fetch time (new `now` option, default the real clock); the fixture source judges at the capture's own `capturedAt`, so
a replay never drifts; without a clock the status stays `null` as before. The registry's Eurostat
`currentCatalogStatuses` goes `[]` → `['current']`: a frozen or unjudged dataset is never "current" — not in the
finder's current quota, never added to the deliverability walk (`candidateWalk`), and a registered Eurostat table
leaving `current` would be reported by the #108 check once a Eurostat catalogue refresh runs (none exists yet;
`catalog:refresh` stays CBS-only, so production's mirror is unchanged).
**Measured on the 2026-09-16 capture: 3,772 current, 3,756 possibly frozen, 41 unjudged.** Of the possibly frozen,
3,569 are annual and 1,430 end in 2020–2023 (412 in 2023, 33 months before the capture) — many are slow annual
collections Eurostat still updates. **Assumption:** the 30-month annual limit, built to catch a retired series,
over-flags slow annual datasets; they still reach the shortlist through the historic slots and any slots the current
class leaves empty, shown as `possibly_frozen`. Whether to also weigh Eurostat's "last update of data" (a dataset
updated this year is not retired) is open (#357).

**3. The finder, behind `EUROSTAT_FINDER_ENABLED`.** `recallCandidates` reads the flag at call time
(`eurostatFinderEnabled()`: exactly `'1'` ⇒ on, the `EUROSTAT_SIBLINGS_ENABLED` / `TABLE_LANE_ENABLED` convention;
`RecallOptions.includeEurostat` overrides per call). Off (default, production): the SQL text and the Eurostat filter
are the pre-step-3 ones; the only difference is the Eurostat entry of the current-status parameters, which no CBS row
reads — a test compares every labelled topic's shortlist against a mirror with no Eurostat row at all, and the CBS
rerank replay hashes (`tests/catalog/find-replay.test.ts`) are unchanged. On: Eurostat's English rows join the same
Dutch full-text search and the same current-first quota. It is a separate flag from `EUROSTAT_EXPLORER_ENABLED` for the
reason in `recall.ts`'s header. **It must stay off in production** until a found Eurostat dataset can be answered
(study §5.4 steps 4–5, with the D3(d) sweep) and the rerank prompt knows Eurostat's statuses: today it tells the model
to prefer CBS's `Regulier`, a word no Eurostat row carries.

**Measured recall (Stage 1 only, no model call).** Labelled set `benchmark/eurostat-finder-labelled-set.json`: 12
Eurostat topics asked once in Dutch and once in English, plus the 6 CBS topics of the existing finder set. Script
`scripts/eurostat-finder-recall.ts`, report `benchmark/eurostat-finder-recall-report.json`, pinned by
`tests/catalog/eurostat-finder.test.ts`. There are no recorded rerank replies for these questions and recording them is
live spend, so this measures whether a right dataset is in the 24-row shortlist the rerank would see, and where.

| Group (flag on unless said) | top-1 | top-5 | in shortlist |
|---|---|---|---|
| English questions | 6/12 | 9/12 | 10/12 |
| Dutch questions | 0/12 | 0/12 | 0/12 |
| CBS questions (flag off and on: same places) | 2/6 | 6/6 | 6/6 |
| English, without the breadcrumbs | 4/12 | 7/12 | 9/12 |
| English, Eurostat rows ranked with the `english` configuration | 6/12 | 9/12 | 11/12 |
| English, Eurostat rows ranked with the `simple` configuration | 6/12 | 9/12 | 10/12 |

What it says: (i) **Dutch questions never reach a Eurostat dataset** — the Dutch topic ("werkloosheid",
"staatsschuld") shares no word with English titles; the next finding step is a Dutch→English bridge for the TOPIC
before recall, not a text configuration. (ii) The breadcrumbs earn their place: +2 top-1, +2 top-5, +1 shortlist.
(iii) **The Dutch text configuration costs one English case** (`minimum wage`: the Dutch stemmer does not join "wage"
and "wages"); the English configuration finds it and lifts `asylum applications` from 18th to 7th, but drops
`unemployment rate` from 3rd to 6th and `renewable energy` from 1st to 2nd — same top-1 and top-5. On this evidence a
per-source configuration (a migration) is not worth it. (iv) A one-word topic ("population") matches thousands of rows,
many through the "Population and social conditions" breadcrumb, and the right dataset misses the 24 — the rerank sees
the full question, recall does not. (v) The CBS questions keep their places with the flag on; no Eurostat row entered
their shortlists. Caveat: the CBS mirror here is the 83-row fixture, not production's 4,858 rows.
Tests: `tests/catalog/eurostat-finder.test.ts`, `tests/eurostat-adapter/jsonstat.test.ts` (breadcrumb, one entry per
code, status), `tests/sources/registry.test.ts`, `tests/eurostat-adapter/statistics-api.test.ts`.

### Addendum (2026-10-02, session 153) — the table lane reads a Eurostat dataset (#357 study step 4)

Built dark (flag `EUROSTAT_FINDER_ENABLED`): Eurostat totals found by label/code (exactly one `TOTAL`/`T`/"Total …",
position-free; the CBS rule unchanged), a one-member dimension as its own default, `freq` set from the resolved period
grain (never offered to the model), Dutch country names via the reviewed list, and a per-table source in the table-lane
job (Eurostat only for a `eurostat:` id while the flag is on). Seasonal adjustment is a dimension on Eurostat (`s_adj`),
not twin measures: a reading that leaves it open is filled by code from the question's words, else the period
(month/quarter → `SCA`, else `SA`; year → `NSA`) — the CBS rule's decision, no prompt change. Recorded with the owner
(mid tier, ~$0.50): 17 Dutch questions over five captured structures, **13/17, 0 invented numbers**
(`benchmark/eurostat-tableparse-set.json`, replay pinned in `tests/answer/table-parse/eurostat-calibration-replay.test.ts`).
Finding: the licence rule's restrictive reading withheld `TOTAL` in `CITIZEN`, so `migr_asyappctza` could not give a
country's total applications. **Owner GO 2026-10-02 ([#365](../open-questions.md)), built:** in a list DERIVED from GEO the
exact code `TOTAL` at Eurostat's aggregate level is kept (`isAllCodesTotal`) — the reporting country's own count over
every citizenship, not a breakdown by a non-EU country; never in the reporting `geo` list; every non-EU citizenship and
`EXT_EU27_2020` stay withheld. This narrows the addendum (d) Assumption above. Re-recorded asylum cases: **15/17**.

### Addendum (2026-10-02, session 153) — the first end-to-end Eurostat table-lane run (#357 step 5)

A Eurostat set in the table-lane benchmark (`benchmark/tablelane-eurostat-tasks.json`, 12 questions over six
NON-curated datasets, snapshot + key read independently from Eurostat) is the first time a Eurostat question ran the
whole lane: register → plan → slice → store → answer → audit. Canned 12/12; real model answers 6/6, 0 invented, refuse/ask
3/6 (no number shown in any). Found and fixed on the way: **decimals** — the registration read the newest period alone,
and Eurostat often publishes the newest year as a rounded estimate (`nrg_ind_ren` Sweden 2025: 65.4; 2023: 66.393), so
1 decimal was registered and the next question refused + quarantined the table; the first read now covers the latest
TWO periods (`DECIMALS_PROBE_FIRST_PERIODS`, at most three in two reads — the bound per read is unchanged). Still a
lower bound: a deeper period with more decimals still refuses (never rounds). **Wording** — lane refusals now name the
source ("Eurostat-tabel"); Eurostat's count unit `Number` is a bare count like `aantal` (template and R10); a base year
in parentheses in a unit label is not a factor. **Scorer** — the provisional rule is the source's own
(`isProvisionalStatus`).

**Dutch labels on the structure route (same day).** `src/eurostat-adapter/dutch-labels.ts`: a reviewed list keyed by
Eurostat code, applied in `eurostatLayoutFromStructure` only when Eurostat's own English label is exactly the listed
one (a reused code keeps English, never a wrong Dutch label); units keep their meaning ('%' only for a plain
percentage, the qualification moves to the measure title; factors stay factors). The download route is untouched, so
the four curated datasets keep their registrations; when they move to structure mode ((b), a re-baseline) their labels
change with it. Measured on re-recording: benchmark refuse/ask 3/6 → 5/6, calibration 15/17 (one miss swapped).

**The Dutch → English bridge in the live finder (same day).** `buildOnboardingFinder` gets an optional
`englishSearchTermsClient`, set by `web/app/actions.ts` only while `EUROSTAT_FINDER_ENABLED` is on: after the Dutch
search and the Dutch meaning step are both not confident, English words (`suggestEnglishSearchTerms`) are searched as
phrases and taken in turn per term (`recallPhrases`, `src/catalog/recall.ts`), then reranked against the reader's
question (`findTable`'s new `shortlist` option skips its own recall). Measured with the recorded words through the same
function: Dutch Eurostat questions shortlist 10/12, top-5 8/12, top-1 5/12; CBS cases unchanged (6/6).

### Addendum (2026-10-04, session 154) — D3(d) carried out: Eurostat is LIVE, with its own source chip

Owner signed the public-claim sweep (session-briefs/2026-10-02-eurostat-public-claim-sweep-draft.md, signed block) and
gave GO. In ONE change (`5267643e`…`b98b0db7`, CI run 37193394891 green incl. deploy) together with
`EUROSTAT_FINDER_ENABLED=1` in Vercel Production:
- **Wording** (items 1–9, 11–13): every general claim names CBS and Eurostat; footer adds "© Europese Unie, Eurostat
  (CC BY 4.0)"; coverage disclosure groups rows by source; /systeemoverzicht has a Eurostat card; three curated
  clarification questions and the waiting text are source-neutral (clarify fixtures re-recorded 7/7). Region-set
  coverage lines stay CBS (region sets are CBS-only). Audit re-derivation: refusal/meta/clarification texts are not
  rebuilt by the verifier, so no stored row diverges.
- **Item 10, owner decision: Eurostat gets its OWN chip.** `liveChatSourceKeys()` (chatSelectable AND the flag) feeds
  both the chip row and the server's selection check. CBS only → finders search CBS rows only, no English bridge;
  Eurostat only → finders search Eurostat rows only and a curated (CBS) reading is never answered: it is re-routed
  through the Eurostat-only whole-question finder, else the new `no_eurostat_table` refusal
  (`src/answer/respond/source-override.ts`, every ParseOutcome kind decided); neither → the old refusal.
  Selection absent (benchmark/tests/CLI) → byte-identical.
- **Prompts (owner chose re-record over the session's no-spend advice):** table reader v5 + rerank v3 name
  graphmaker.studio and both sources. The wording-only re-record let Eurostat E4/E5 slip back to "x 1 000 personen"
  for "hoe hoog was de werkloosheid"; one general MAAT line (a level question that asks no count takes the
  percentage when the table offers both; examples outside the labelled sets) fixed it. Measured: CBS calibration
  44/50 (all six misses refuse/ask), Eurostat 15/17 (E3 asks, E11 SA vs SCA), CBS table-lane benchmark 14/14 + 9/9 +
  0 invented (was 12/14), Eurostat lane 6/6 + 5/6 + 0 invented, table finder 11/11, front door 31/32 tuning, 25/30
  held-out (was 27/30; one change from the unchanged intent parse, one a neighbouring household table).
- **Same day, after the flip (owner's first live question refused):** production `cbs_catalog` held **0 Eurostat
  rows** — every finder measurement had run on fixture catalogues. `catalog:refresh -- --source eurostat` (new CLI
  option, prune scoped to the source) loaded 7,561 datasets (`e81cc977`); the owner's re-ask then answered Poland road
  deaths 2023 = 1,893 from `tran_sf_roadro`, Eurostat's own figure. Refreshing this index is a monthly hand step
  (RUNBOOK); a daily refresh was proposed, not decided.
- **Live read-only probe** (`scripts/eurostat-live-probe.ts`, production DB opened read-only, lane on local PGlite with
  the live adapter and the real reader, each number checked against Eurostat's API; ~$0.38): 9 Dutch questions → 5
  answered, 5/5 match, 0 wrong; 2 button questions (age group for `une_rt_a`, counterpart sector for `gov_10dd_ggd`),
  1 honest refusal after a weak finder pick (waste per inhabitant), 1 false "unreachable". Fixed (`53a99429`): a
  permanent source error (`retryable === false`, incl. `EurostatLayoutRefusalError`) is not retried and refuses as
  `table_lane_ineligible`; the number check accepts the upper bound of a hyphenated range copied from a title
  ("aged 15-24") — `audit:verify -- 1 349` byte-identical before/after. Also (`83563029`): onboarding acknowledgments
  name Eurostat for a Eurostat pick, and a Eurostat pick never falls back to the CBS-only paid onboarding offer.

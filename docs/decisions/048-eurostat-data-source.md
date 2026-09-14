# ADR 048 — Eurostat as the second data source: adapter, catalog, pipeline, proof, and geography sequencing

**Status:** accepted at design level, 2026-09-14 (owner present in chat; three constraints settled there and
recorded at [open-questions #248](../open-questions.md) and in ADR [030](030-multi-source-architecture.md)'s
revisit-trigger addendum). **Not scheduled, no work-package number, no code.** Per the WP27/WP30 precedent, the
execute session runs the pre-build adversarial design review BEFORE writing code; the frozen executor brief
comes out of that review, not out of this ADR alone.
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
its own optional WP, never bundled into the source add.

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
through E1 — the existing tests that assert Eurostat is never named as answering
(`web/components/coverage-disclosure.test.tsx`, `web/app/privacy/page.test.tsx`, `web/app/galerij/page.test.tsx`)
are the pin, and the "Eurostat — binnenkort / coming" copy in `web/lib/i18n/messages.ts` stays until E2;
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
first.** A scheduled `catalog:refresh` for Eurostat reads the Catalogue API and writes rows into `cbs_catalog`
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
same statistic" trigger): in E2 the live source chips (#129) decide — CBS pre-checked, Eurostat offered only
when selected or when CBS has no reading; never a silent cross-source pick; the richer "here are both
readings" answer (#39/#21) is E3; (b) **a comparability break (Eurostat flag `b`, or a NUTS revision) inside a
requested window is a refusal precondition on the `direction`/`first_last` derivations** in
`src/query/derivations.ts` — a "trend" across a definition change is a guess (principle (c)); this is the one
place a source flag legitimately reaches `src/query/`, as a registered-derivation precondition, never an LLM
concern; (c) **zero prompt bytes in E1** (ADR 030 A4) — the intent prompt, rerank prompt and meta templates
change only in E2's owner-signed sweep, with fixtures re-recorded there.

**D6 — Eurostat's native grammar maps INTO the waist at the adapter boundary (ADR 030 D2), with these
obligations:**
- *Periods:* `2024` / `2024-Q1` / `2024-M01` map losslessly to `2024JJ00` / `2024KW01` / `2024MM01` (F2
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
  flagged cell renders provisional unless `provisionalDisplay` gives it a specific suffix) and
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
  request-path call exists (principle (b)).

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
the out-of-band job fetched, never a link the answer path calls. Both are migrations, additive, R8-safe (batch
rows are outside the reconstructed envelope; an absent DOI renders no DOI clause; pre-Eurostat rows re-derive
byte-identically because absent `source` still resolves to `cbs`, ADR 030 A1). The verbatim flag letter appears
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
  byte-identical (D3(b)'s tests green).
- **E2 — natural-language querying through the chat pipeline.** The taxonomy widening (D2, own design round),
  discovery steps (i)+(ii) (D4), the cron route via `adapterFor`, compose/refusals threading the result's actual
  source instead of `resolveSource(undefined)` (wiring point 3), the source-chip ambiguity rule (D5a), the
  `b`-flag precondition (D5b), the owner-signed prompt/claim sweep (D3(d)), the ADR 026 cross-source check
  (D8), and ≥ 5 Eurostat benchmark tasks in the frozen key including ≥ 2 refusals (a semester dataset; an
  excepted-geo ask). Done: the new tasks pass at the gate with 14/14 + 6/6 + 0 fabricated unchanged; a live,
  owner-supervised smoke run onboards a real dataset through the job and answers on arrival; every public
  surface says "official sources" and names Eurostat as answering — in one change.
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
   refresh already takes ~19 minutes for 4,858 rows (ADR 026), so a mirror roughly twice the size has its
   runtime measured against the cron/function ceiling before scheduling.
9. **Both-sources ambiguity.** "Source chips decide" (D5a) is acceptable to the owner as the E2 rule; the
   richer both-readings answer is E3.
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

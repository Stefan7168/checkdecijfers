# Eurostat as the second data source — V2 design and implementation plan (proposal)

**Status:** PROPOSAL, written 2026-09-14. **V2 / post-launch scope. NOT scheduled. No work-package number
assigned. No ADR written. No code.** This is a planning artifact for the product owner to read, question and
amend before anything is put on the build plan. It records where the idea came from (a Perplexity exploration
by the owner, 2026-09), maps it onto what is actually in this repo today, and names every assumption inline
with `**Assumption:**` per [CLAUDE.md](../../../CLAUDE.md).

**Where it sits among the recorded decisions.** ADR [047](../../decisions/047-repositioning-embedded-sourced-chart.md)
(2026-09-13) already names Eurostat as source two — *"after CBS's current work settles, demand-driven and never
announced before it answers"* — and says a real Eurostat build *"needs its own ADR before code, per the WP30
narrow-waist pattern."* ADR [030](../../decisions/030-multi-source-architecture.md) built that pattern (WP30a +
WP30b are live; WP30c — the first real second source — is owner-deferred at
[open-questions #123](../../open-questions.md)). This document is the input to that future ADR, not a
replacement for it. Nothing here overrides [STATUS.md](../../STATUS.md)'s current priorities.

---

## 1. Summary

Add Eurostat (the EU statistics office; regional data organised by NUTS codes, public REST API, no key, CC BY 4.0)
as a second bulk-ingested source next to CBS, through the adapter-plus-registry "narrow waist" ADR 030 already
built for exactly this purpose — so a question about, say, youth unemployment in Dutch provinces versus Belgian
or German ones gets the same validated, cell-traceable, attributed answer the CBS pipeline gives today, with the
same "Bewijs dit cijfer" proof panel. Two threads: **(1)** Eurostat as a queryable provider, in three phases
(an internal explorer that proves the adapter → natural-language querying through the existing chat pipeline →
a "research assistant" layer with saved queries and CBS-versus-Eurostat comparison that explains *why* two
figures differ); **(2)** a separate, riskier "pattern discovery" feature that scans indicator pairs across
regions and years for statistical associations and offers them as investigable leads — which needs a genuinely
**new invariant family** in [05-data-rules.md](../../05-data-rules.md), because today's R1–R11 are written for
single-cell and simple-aggregate answers, not multi-variable statistics. Everything is V2 / post-launch and
unscheduled.

## 2. Why Eurostat

- **The ICP already names it.** [01-product-vision.md § Ideal customer profile](../../01-product-vision.md)
  (owner, 2026-09-11): the person "knows the number exists at CBS *or Eurostat* but not where"; segment (4),
  corporate and NGO communications teams, is "reached through Eurostat and English". The direction recorded
  there and in ADR 047 is *European and Dutch official data, CBS first, Eurostat next*.
- **Cross-country regional comparison is the thing CBS cannot give.** CBS is authoritative for the Netherlands;
  it has nothing on the same measure for Flanders, Nordrhein-Westfalen or the EU average. Eurostat's regional
  datasets (NUTS 1/2/3) are harmonised across member states — the one place a Dutch journalist can put a
  province next to its neighbours across the border with one definition.
- **The audience fit is the same job.** Journalists, municipal/policy communicators, researchers and students
  publish an official figure with its source under time pressure — Eurostat's data browser costs them the same
  30–60 minutes of clicking that StatLine does.
- **Feasibility is already verified on the live site** (session 96, 2026-09-11,
  [competitive-research brief](../../session-briefs/2026-09-11-competitive-research-localfocus-flourish-eurostat.md)):
  four APIs (Statistics API in JSON-stat 2.0 over REST with CORS, SDMX 3.0, SDMX 2.1, a Catalogue API);
  refreshed twice daily (11:00 and 23:00 CET); **no versioning of past data — only the latest version exists**;
  synchronous requests below 500,000 cells, asynchronous submit-and-poll for 500k–5M, HTTP 413 above; a fair-use
  policy on concurrency and request frequency (violations are forced async, not blocked); CC BY 4.0 with a
  prescribed source line *"Source: [dataset DOI], [access date]"*; and **licence exceptions** — non-EU country
  data (USA, Japan, China) and some CH/AT trade data may not be reused commercially.
- **Nobody else combines LLM chat with Eurostat or CBS the way this product does** (same brief).

**Assumption:** the "~8–10k datasets vs CBS's ~4,600" figure comes from the owner's Perplexity research, not from
anything verified in this repo. The CBS side is measured (~4,858 catalog rows, ADR
[003](../../decisions/003-cbs-access-layer.md)); the Eurostat count must be measured against the Catalogue API at
design-review time before any sizing decision (catalog mirror size, finder shortlist quotas) rests on it.

## 3. Architecture — Eurostat as a queryable provider

### 3.1 The provider abstraction already exists — do not build a second one

The research's `StatisticalProvider` (search datasets, get metadata, get dimension values, query data) maps
one-to-one onto the adapter contract this repo already has:

| Research's `StatisticalProvider` method | Existing contract (`SourceAdapter` = `CbsSource`, [`src/cbs-adapter/types.ts`](../../../src/cbs-adapter/types.ts), aliased in [`src/sources/adapters.ts`](../../../src/sources/adapters.ts)) |
|---|---|
| search datasets | `fetchCatalog()` — bulk-mirrored into `cbs_catalog`; the finder searches OUR copy ([ADR 025](../../decisions/025-cbs-catalog-table-discovery.md)) |
| get metadata | `fetchTableSchema(tableId)` — dimensions (kinds `Dimension`/`TimeDimension`/`GeoDimension`) + measures (code, title, unit, decimals, description) |
| get dimension values | `fetchCodeList(tableId, dimension)` |
| query data | `fetchObservations(tableId, slice?, dimensionNames?)` + `fetchObservationCount(tableId)` — **ingestion-time only**, never on the request path (principle (b), ADR 003) |

**Design decision (proposed): implement Eurostat as one more `SourceAdapter`, not a new abstraction.** ADR 030 D1
is explicit — "one canonical internal model; ALL source-specificity lives in per-source adapters that map into
it"; per-source parallel pipelines were rejected there because they "duplicate exactly the validated machinery
that makes the product trustworthy." The research's "search → metadata → dimensions → query" shape is the
adapter; the "local catalog + index" is the `cbs_catalog` mirror with its `source` column (migration 016,
ADR 030 D4); the "proof discipline" is the existing envelope + proof panel (§3.6).

### 3.2 Where it lives — module boundaries and the naming question

ADR [001](../../decisions/001-single-app-vs-split.md)'s as-built module set is `ingestion/`, `cbs-adapter/`,
`catalog/`, `registry/`, `query/`, `answer/`, `chart/`, `billing/`, `threads/`, `sources/`, `websearch/`,
`attachments/` (+ `usage/`), with `db/` beneath. The proposal adds exactly one new module and touches the
routing seam:

- **New: `src/eurostat-adapter/`** — a sibling of `src/cbs-adapter/`, containing the live Statistics-API client,
  the parser (JSON-stat 2.0 or SDMX-CSV → `CbsObservationRow`/`CbsTableSchema`/`CbsCatalogEntry`), a
  `FixtureSource` replaying captured real responses through the same parser, and the NUTS/period/flag mapping
  (§3.4). No module outside it may know Eurostat URL shapes (ADR 003 decision 2, applied to source two).
- **`src/sources/registry.ts`** gains an `eurostat` entry (§3.4); **`src/sources/adapters.ts`** gains one
  factory line. **`src/sources/conformance.ts`** gains a Eurostat fixture manifest and — new — the
  region-taxonomy family the guide already flags as missing (wiring point 5 in
  [how-to-add-a-source.md](../../how-to-add-a-source.md)).
- **Nothing new in `query/`, `answer/`, `chart/`** for phases 1–2, by construction of the waist. Phase 3's
  cross-source comparison adds ONE registered derivation kind in `src/query/derivations.ts` (§5, Phase E3).

**Design decision — the `cbs-adapter/` name: keep it, add a sibling; do not rename now.** ADR 030 A5 measured
the rename blast radius (`CbsSource` 13 files/41 occurrences, the `Cbs*` family 21 files, the import path 31
files) and deferred it; WP30b introduced the neutral alias `SourceAdapter` instead, and the how-to guide says to
model a new adapter on `src/cbs-adapter/` as its own directory. A `src/sources/cbs/` + `src/sources/eurostat/`
layout is the cleaner end state, but it is pure diff noise on a live money product and buys nothing hermetic.
Recommendation: `src/eurostat-adapter/` now; the rename of the `Cbs*` wire types to `Source*` (and the move of
both adapters under `src/sources/`) is a separate, optional, hermetic cleanup WP with a re-measured blast
radius — never bundled into the source add. The database table names (`cbs_tables`, `cbs_catalog`) likewise
stay: ADR 030 D4 chose prefixed ids + a `source` column over any rename or compound key.

### 3.3 Ingestion and catalog — principle (b) applied to Eurostat

- **Catalog mirror.** A scheduled `catalog:refresh` for Eurostat calls the Catalogue API (table of contents) and
  writes rows into `cbs_catalog` with ids `eurostat:<dataset code>` (D4), `source = 'eurostat'`, `language = 'en'`,
  the dataset's own last-update timestamp in `modified`, and its lifecycle status in `status`. **Pre-work,
  blocking:** `ingestCatalog`'s prune is not source-scoped (`src/catalog/ingest.ts`, wiring point 1) — a Eurostat
  refresh would DELETE the CBS mirror rows. Must be scoped by `source` before any second refresh runs.
- **Demand-driven onboarding, same as CBS.** ADR 047 says Eurostat is "demand-driven, never announced before it
  answers", the posture WP16 proved: a question the finder maps to a not-yet-loaded Eurostat dataset creates a
  `pending_table_requests` row; the cron job fetches → validates → verifies → answers on arrival (ADRs
  [026](../../decisions/026-on-demand-fetch-job-architecture.md)/[027](../../decisions/027-finder-shape-fit-gate.md)).
  The onboarding-cron route constructs `new ODataV4Source()` directly today (wiring point 4) — it must route
  per-table via `adapterFor` before a Eurostat row can be claimed.
- **Slicing.** Eurostat regional datasets are large (all member states × NUTS 3 × years × breakdowns). The
  adapter must support server-side filtering (the Statistics API filters by dimension code, e.g. `geo=NL21`,
  `time` ranges) so the WP16 slice cap (150k cells, ADR 026's 300 s function ceiling) holds. A `CbsSlice` maps
  onto Eurostat's URL filters directly (`dimensionEquals`, `dimensionPrefixes` on `geo`, `periodFloor` on `time`).
  Staying under 500k cells per request keeps every fetch on the synchronous path — the async submit-and-poll
  API is deliberately NOT implemented in v1 (a dataset that needs it fails the fit gate honestly).
- **No versioning at Eurostat ⇒ our store is the only history.** The silent-correction defence in
  [05-data-rules.md § CBS platform-change risk](../../05-data-rules.md) (syncs diff against previous values; changed
  historical cells logged per batch) applies unchanged and becomes MORE valuable: an audit row is a frozen
  snapshot of a value Eurostat itself can no longer show. Expected cadence per dataset comes from the dataset's
  own update-frequency metadata, enforced as staleness warnings, not schedules (the CBS rule, unchanged).
- **Fair use.** Twice-daily refresh at Eurostat means a sync more often than daily is wasted; the fair-use policy
  bounds concurrency — the ingestion CLI and the cron job serialise Eurostat fetches (one at a time). No
  request-path call exists, so fair use is an ingestion-scheduling concern only.
- **Licence exceptions are enforced at slice time, structurally.** Rows for the excepted geographies (USA, Japan,
  China; the CH/AT trade exceptions) are never ingested: the adapter's default slice restricts `geo` to EU/EFTA
  codes, and the fit gate refuses a dataset whose only requested geo is an excepted one. **Assumption:** the
  exact exception list and its interpretation need a legal check before the registry entry lands (ADR 030
  revisit trigger: "a source whose license forbids the current attribution/display pattern → legal check before
  D3 entry").

### 3.4 Mapping Eurostat's native grammar into the waist (ADR 030 D2) — the real design work

This is where an adapter for a REGIONAL, MULTI-COUNTRY, ENGLISH-LABELLED source differs from anything the
conformance harness has seen. Each item is a decision the future ADR must take; the recommendation and its
assumption are given.

1. **Geography — the biggest structural question in this document.** ADR 030 D2 keeps *"the Dutch taxonomy
   (land/landsdeel/provincie/gemeente) AS the canonical geography per the owner's Nederland-scope steer"*, and
   its revisit trigger says *"a chosen source outside Nederland scope → the region-taxonomy decision reopens."*
   Eurostat's whole value is cross-country. NUTS maps onto the Dutch taxonomy cleanly for the Netherlands — NUTS 0
   `NL` = land, NUTS 1 `NL1`–`NL4` = the four landsdelen, NUTS 2 `NL11`…`NL42` = the twelve provincies, NUTS 3 =
   the COROP areas (which CBS also publishes, `CR` codes), gemeenten are LAU-level and mostly absent from
   Eurostat regional tables — but a Belgian province or the EU-27 aggregate has NO place in a Dutch-only
   taxonomy. Two honest options: **(A) NL-only in v1** — the adapter maps Dutch NUTS codes into the existing
   taxonomy and marks every other `geo` row out of slice; the product can answer "what does Eurostat say about
   Groningen" but not "Groningen versus Flanders" — cheap, no waist change, but forfeits the differentiator;
   **(B) widen the geography waist** — add a `country` level plus a source-neutral region-code column
   (NUTS for Eurostat, CBS codes for CBS, with the NL NUTS↔CBS equivalences recorded in `dimension_labels`), so
   `resolve.ts`, the region-prefix tables, the intent schema's region vocabulary, the chips' `baseLabel`, and
   the chart builder's region ordering all learn a second code family — an ADR-level change touching `query/`,
   `registry/`, `answer/intent/` and a migration. **Recommendation:** B, but sequenced — Phase E1 (the internal
   explorer) ingests with NL-only mapping (A) to prove the adapter, and the ADR for B is written from what E1
   measures. **Assumption:** NUTS 2021 ↔ CBS provincie/COROP equivalence is exact for the current NUTS version;
   NUTS revisions (2021 → 2024) are the Eurostat analogue of gemeentelijke herindelingen and need the same
   reviewed-`dimension_labels`-update playbook 05-data-rules already prescribes.
2. **Periods.** Eurostat `time` codes: `2024` (annual), `2024-Q1`, `2024-M01` — all map into `YYYY(JJ|KW|MM)NN`
   losslessly (`2024JJ00`, `2024KW01`, `2024MM01`) and the F2 round-trip holds. **But** Eurostat also publishes
   semesters (`2024-S1`), weeks (`2024-W01`) and, for a few datasets, days — none representable in the waist's
   grain model. ADR 030 D2 names this an explicit REVISIT trigger; the how-to guide says STOP and run a design
   round. Recommendation: the fit gate refuses semester/weekly/daily datasets in v1 (like CBS's own `80416ned`
   daily-code specimen, kept in fixtures as a fit-gate case); a grain extension is its own later decision.
   **Assumption:** the datasets the ICP actually asks about (regional population, unemployment, GDP per capita,
   tourism nights, housing, education) are annual/quarterly/monthly — measure this against real questions in E1.
3. **Measures and units.** A Eurostat dataset has no separate "measure" list — it is one observed variable with
   `unit` (and often `na_item`, `sex`, `age`, `nace_r2`, …) as dimensions. The waist requires `measures[]` with
   `unit` and `decimals` per measure. Recommendation: the adapter synthesises one measure per distinct `unit`
   code in the registered slice (measure code = `<dataset>|<unit code>`, title from the dataset title + the
   unit label, `unit` = the unit label verbatim), pins the `unit` dimension in the slice so a table never mixes
   units (R10), and takes `decimals` from the observed values' maximum precision in the captured fixture.
   **Assumption:** JSON-stat 2.0 carries no per-cell decimals; deriving them from observed precision is honest
   (never rounds a served value) but must be pinned per table at registration and re-checked by the unit
   consistency validator (05-data-rules validation step 5).
4. **Statuses, flags and null reasons — VERBATIM, interpreted only in the registry.** Eurostat has no per-period
   publication status like CBS's `Definitief/Voorlopig`; instead every cell may carry observation flags —
   `p` provisional, `e` estimated, `s` Eurostat estimate, `f` forecast, `b` break in time series, `c`
   confidential, `d` definition differs, `u` low reliability, `n` not significant, `z` not applicable, `:` not
   available. Mapping: the flag string rides in `observations.status` verbatim (the CBS rule); the registry
   entry declares `definitiveStatuses: ['']` (the unflagged state) so every flagged cell renders provisional
   unless `provisionalDisplay` gives it a specific suffix (`p` → ' (voorlopig cijfer)', `e`/`s` → ' (raming
   Eurostat)', `f` → ' (prognose Eurostat)' — Dutch wording is an **owner sign-off**, per the guide);
   `nullReasonLabels` maps `:` and `c`/`z` to the true reason. The ingestion validator's "every observed period
   must carry a publication status; a missing status fails the batch" (05-data-rules step 3) is CBS-shaped —
   for Eurostat the adapter must supply a per-period status derived from nothing but the period codes it
   observed (all periods "published"), which is honest because Eurostat's provisional concept is per cell, not
   per period. **Assumption:** this reading of the validator is acceptable to the harness's F2 family without a
   waist change; if F2 insists on a per-period status vocabulary, that is an adapter-contract amendment to
   record in the ADR, not a silent workaround. **A comparability break (`b`) is load-bearing for principle (c):**
   the `direction`/`first_last` derivations must refuse across a `b`-flagged boundary (a "trend" over a
   definition change is a guess) — this is the ONE place a source flag has to reach `src/query/`, and it is a
   registered-derivation precondition, not an LLM concern (the CBS trendbreuk gap tracked at
   [open-questions #26](../../open-questions.md) is the same class).
5. **Language.** Eurostat labels are English (also FR/DE). The finder's recall filters `language = 'nl'` (wiring
   point 2) — a Eurostat catalog is invisible to it. Recommendation, cheapest mechanism first (owner convention,
   2026-09-08): (i) lift the language filter per source and run English full-text recall for `eurostat:` rows;
   (ii) a curated Dutch alias layer for the datasets people actually ask about, in `src/catalog/aliases.ts`'s
   existing pattern (an alias is zero AI, zero schema change); (iii) multilingual embeddings via pgvector ONLY
   on measured misses — ADR [002](../../decisions/002-postgres-system-of-record.md)'s trigger ("catalog > ~50 or
   matching misses") is met on count alone, but the convention is evidence, not speculation. The answer body
   stays Dutch; Eurostat's own words on a chart (unit, region names, dataset title) go through the maintained
   word list ADR [040](../../decisions/040-interface-language-switch.md) already uses for CBS words, never
   machine translation.
6. **Table identity and deep links.** Ids `eurostat:<code>`; `deepLink` →
   `https://ec.europa.eu/eurostat/databrowser/view/<code>/default/table` (the stable dataset view, mirroring
   the CBS choice to link the table, not a cell — [`web/lib/statline.ts`](../../../web/lib/statline.ts)); the
   Text-Fragment cell highlight (#247) stays best-effort and may simply be null for Eurostat.

### 3.5 The query pipeline — the research's steps ARE today's steps

The research describes *question → intent → dataset discovery → metadata/dimension validation → user
disambiguation if ambiguous → query → normalise → compute → cite*. Every step already exists; the table says which
code runs it and what, if anything, Eurostat changes:

| Research step | Today ([04-architecture.md](../../04-architecture.md)) | Eurostat delta |
|---|---|---|
| intent | LLM parse to a strict schema, no data access (ADR [004](../../decisions/004-llm-usage.md)/[012](../../decisions/012-intent-parsing-llm-harness.md)) | region vocabulary if geography option B (§3.4.1); otherwise none. **Zero prompt bytes until the owner-signed WP30c wording sweep** (ADR 030 A4). |
| dataset discovery | finder over the mirrored catalog: FTS recall + rerank over a hard-allowlisted shortlist (ADR 025), then on-demand onboarding (ADR 026/027) | source-scoped recall + shortlist quotas per source (A6 wiring exists); the rerank prompt shows each candidate's source (D5) — that prose is CBS-branded and fixture-frozen, so it is part of the same A4 sweep |
| metadata/dimension validation | registry pinned "totaal" defaults + `dimension_labels`; ingestion validators 1–5 | the NUTS mapping and unit-as-dimension pinning above; conformance F0–F5 + the new region family |
| disambiguation | R7: one clarification round with dry-run-verified click options (ADR [024](../../decisions/024-answer-first-defaults-and-clickable-options.md)) | a NEW ambiguity class: *the same measure exists at CBS and at Eurostat* (ADR 030's "two+ sources covering the same statistic" trigger). v1 rule: the source chips (#129, live) decide — CBS pre-checked; Eurostat is offered only when selected or when CBS has no reading. Never a silent cross-source pick. |
| query / normalise / compute | deterministic SQL + registered derivations (ADR [011](../../decisions/011-query-contract.md)) | none in phases 1–2; the `b`-flag precondition on trend derivations |
| cite | attribution line + proof panel (R4, §3.6) | the Eurostat-prescribed source line |

### 3.6 Proof and citation — mirroring "Bewijs dit cijfer"

[`web/lib/answer-proof.ts`](../../../web/lib/answer-proof.ts) builds the panel ONCE from the stored envelope (no
arithmetic, every digit a shared formatter over a stored cell or derivation; R1 token-scan test as the belt) and
[`web/components/answer-proof.tsx`](../../../web/components/answer-proof.tsx) renders three depths: why this
reading, the cells used (coordinates, sync date, batch id, status, best-effort highlight link), and the step
list. Eurostat answers ride the same panel with these additions, all envelope/registry data, none of it LLM-touched:

- **Attribution line.** Eurostat prescribes *"Source: [dataset DOI], [access date]"*. `SourceInfo` has no DOI
  field and the DOI is per dataset, not per source — so the DOI belongs on the catalog/registry row (an additive
  nullable column on `cbs_tables`/`cbs_catalog`, migration), and `buildAttributionLine` renders it for
  `source = 'eurostat'`: *"Bron: Eurostat, dataset {code} — {titel} (DOI {doi}). Gegevens gesynchroniseerd op
  {datum}. Licentie: CC BY 4.0."* The "access date" is our sync date — which is exactly what R4 already shows.
  Old rows re-derive byte-identically because absent `source` still resolves to `cbs` (ADR 030 A1).
- **Query URL and retrieval time per answer.** The research wants "dataset code, filters, retrieval time, query
  URL" surfaced. Retrieval time and filters exist (`syncedAt`, the registered slice, the batch id per cell). The
  **request URL does not exist anywhere today** — CBS ingestion never stored it. Proposal: `ingestion_batches`
  gains an additive `request_urls text[]` (the exact URLs the ingestion job called, for BOTH sources), and the
  proof panel's technical toggle shows "Opgehaald met: <url>" per batch. Principle (b) is untouched: the URL is a
  record of what the out-of-band job fetched, never a link the answer path calls. Migration, additive, R8-safe
  (batch rows are not part of the reconstructed envelope).
- **Flags in the cell table.** The verbatim flag letter in the status column, its registry-resolved meaning in
  a tooltip — the reader sees Eurostat's own marker, never our paraphrase alone (principle (a), R11).

### 3.7 Public-claim wording and the things that ship WITH source two (owner-signed, non-negotiable)

Per [how-to-add-a-source.md § owner preconditions](../../how-to-add-a-source.md) and ADR 030 WP30c: the public
claim widens from "every number traceable to an official CBS cell" to "official sources" — CLAUDE.md, the meta
'sources' template (ADR [022](../../decisions/022-meta-question-templates.md)), intent-prompt provenance prose,
the rerank prompt, UI copy (the "Eurostat — binnenkort" coverage group in `web/lib/i18n/messages.ts` and its
tests that assert Eurostat is never named as answering), `/llms.txt` coverage, the `/systeemoverzicht` hand-written
status constants — one sweep, LLM fixtures re-recorded, owner-signed. Until it ships: **zero prompt bytes.**
[open-questions #102](../../open-questions.md) already records the claim-widening as a settled implication.

## 4. The correlation-discovery feature ("find patterns you didn't know to look for")

### 4.1 What it is, and why it is a different animal

Scan combinations of indicators across regions and years for interesting statistical patterns — strong
correlations, contradictory trends (tourism up while population falls), regional outliers, trend breaks,
regional clusters — and surface them as **leads to investigate**, e.g. *"In 37 NUTS-2 regions, tourism overnight
stays rose sharply 2014–2024 while resident population fell; the negative association is stronger in coastal
regions."* Journalists, researchers and students get a starting point, not a conclusion.

Everything the product does today answers *"what is the number?"* over cells that already exist. This feature
MAKES numbers (a coefficient, a p-value, a cluster membership) that exist in no source cell. That is allowed by
principle (a) only if deterministic code makes them and the LLM never does — the same line R5 draws for
differences and rankings, drawn much further out. And principle (c)'s "never guess" gets a new face here:
**a correlation presented as a cause is a guess dressed as a finding.**

### 4.2 Architecture — a deterministic statistics layer, an LLM explanation layer, nothing in between

```
observations (CBS + Eurostat cells, our store)
      │  out-of-band scan job (CLI / scheduled, NEVER the request path — ADR 001/003 posture)
      ▼
src/patterns/ (new module)            deterministic: candidate pairs → align cells → statistic →
  ├ candidates.ts                     multiple-testing correction → stability checks → effect-size gate
  ├ stats.ts   (registered functions: pearson, spearman, bh_fdr, holm, iqr_outlier, …)
  ├ scan.ts                           writes pattern_findings rows (immutable per run)
  └ phrase.ts                         digit-free slot-filling prompt (ADR 041's mechanism), R3 belt
      │
      ▼
pattern_findings (new table)          full provenance per finding (§4.5) — the audit row of this feature
      │
      ▼
web: a "Patronen" surface             finding cards + a "Bewijs dit patroon" panel (the answer-proof pattern)
```

- **The statistics run offline, over our own store, on a schedule** — like ingestion, never per request. ADR 001
  lists "always-on background workloads" (trigger 3) and "statistical validation grows past SQL — significance
  testing" (trigger 4) as **migration triggers toward the Python split**. This feature fires both. Honest
  position: v1 (pairwise Pearson/Spearman, Benjamini–Hochberg FDR, IQR/z-score outliers) is small enough for
  TypeScript + SQL and stays inside the single app; regression-based outlier detection with confound controls,
  and clustering, are the point at which the ADR 001 split assessment is due — not something to hide inside a
  TS module. The future ADR must say which side of that line each phase sits on.
- **The LLM's only role is phrasing a computed, structured finding**, exactly as it phrases a validated CBS
  result today — and using the mechanism the Insights feature (ADR
  [041](../../decisions/041-chart-insights.md)) already proved for outlier findings: **digit-free slot-filling**,
  where the model writes prose with typed placeholders and deterministic code fills every number, region name,
  period and statistic from the stored finding. A fabricated number is then structurally unrepresentable, and
  the R3 verbatim scan runs as the second belt on the filled text. Fails closed per finding to a deterministic
  template caption (the ADR 041 rule).

### 4.3 The new invariant family this needs — flagged, not assumed

**Today's R1–R11 in [05-data-rules.md](../../05-data-rules.md) are written for single-cell and simple-aggregate
answers; they do NOT cover multi-variable statistical associations.** Concretely: R1's "every numeric value
traces to a query-result ID *or a registered derivation of it*" and R5's "derived values … list their source
cells" assume a derivation over a handful of named cells (`DerivationRecord.sourceResultIds`, today 2–~50 ids);
a correlation over 37 regions × 11 years × 2 indicators is a function of ~800 cells and of a METHOD (which
correction, which controls, which n), and R9's direction/ranking binding has no notion of "strength",
"association" or "significance". The attachments feature set the precedent for how to handle this honestly:
ADR [037](../../decisions/037-user-data-attachments.md) wrote a parallel **U1–U12** family rather than
stretching R1–R11. The proposal is a parallel **S-family** ("S" for statistical), drafted here for the ADR to
adopt or amend:

| S | Invariant (draft) | R analog | Verified by (draft) |
|---|---|---|---|
| **S1** | Every statistic shown (r, ρ, p, adjusted p, n, effect size, cluster id) traces to one stored `pattern_findings` row computed by a **registered statistical function** over stored cells identified by batch id + coordinate set; no statistic is computed at render time or by the LLM. | R1/R5 | token scan of the rendered finding against the stored row; a registered-function allowlist test; a mutation test (one changed cell ⇒ a different stored statistic, never a silently equal one) |
| **S2** | The phrasing prompt receives ONLY the structured finding (indicator labels, region/period sets, n, statistic values, method, controls, caveat flags) — never cell rows, never raw series. | R2 | serialized-prompt pin |
| **S3** | The LLM cannot emit a number: slot-filling with typed placeholders; deterministic code fills them; the R3 verbatim scan re-checks the filled body. | R3 | the ADR 041 digit-free pin + R3 belt |
| **S4** | **Association, never causation.** Every finding renders a deterministic label ("statistische samenhang — geen oorzakelijk verband aangetoond") outside the LLM-scanned body, AND the validator rejects causal language in the body — a maintained veto list of Dutch causal constructions ("veroorzaakt", "leidt tot", "door", "omdat", "zorgt voor", "het gevolg van", "dankzij", …) plus the same in English if the surface is bilingual. Rejection ⇒ regenerate once ⇒ template. | new (principle (c)) | correct-prose fixtures (legitimate association wording passes) + seeded causal fabrications fail |
| **S5** | Strength and direction words are bound to the statistic by code, not chosen by the model: "sterk"/"matig"/"zwak" thresholds on \|r\|, "positief"/"negatief" on its sign, "significant" only when the ADJUSTED p clears the pre-registered threshold. | R9 | binding test per word class |
| **S6** | **Multiple-testing correction is mandatory and disclosed**: every finding states the family size (how many pairs were tested in its run), the correction method (BH-FDR at a stated q, or Holm), and the adjusted p — a raw p is never shown alone. | new | schema-required fields; a finding row without them cannot be written (CHECK constraint) |
| **S7** | Minimum evidence gates are code, not configuration: minimum n (regions), minimum period span, no cell with a null-with-reason inside the aligned window, no comparability break (`b` flag / herindeling / NUTS revision) inside the window, one unit per side (R10). A candidate failing any gate is not a "weak finding" — it is not a finding. | R11/R10 | gate enumeration test; fixtures for each failure |
| **S8** | Full provenance on every finding: source key(s), dataset ids + versions, measure codes, pinned dimension coordinates, region set (codes), period window, n, statistic, raw and adjusted p, method, what was controlled for (or "niets"), the scan run id and every batch id read. The "Bewijs dit patroon" panel renders all of it from the row. | R4/R8 | the finding row is the reconstruction source; a panel snapshot test; a tamper test |
| **S9** | **Separation:** a finding never enters a CBS/Eurostat answer body, `audit_answers`, a `ChartSpec`, conversation context or the benchmark; the finding surface is its own component with its own badge, like the web section (ADR [032](../../decisions/032-websearch-augmentation.md)) and the user-data tier (ADR 037). | the ADR 032/037 separation pins | serialized-prompt scans over the CBS harness with findings present; type-level (a finding chart is not a `ChartSpec`) |
| **S10** | Cross-source pairs (a CBS series against a Eurostat series) are refused in v1 — [open-questions #103](../../open-questions.md)'s rule (every number still a verbatim cell from ONE validated source) plus the unit/definition alignment problem; allowed later only through a registered cross-source alignment (§5 Phase E3). | principle (a) | candidate generator excludes mixed-source pairs; pinned |

**Assumption:** this family is a draft by one session; the pre-build adversarial design review the WP27/WP30
precedent requires (6 lenses × dual skeptics) is where it gets confirmed, split or killed row by row.

### 4.4 False positives and multiple testing — how the design controls the risk

The naive version — correlate everything with everything across 10k datasets — is a false-positive factory:
200 indicators alone give 19,900 pairs, and at α = 0.05 with no correction roughly a thousand "findings" appear
from noise. Two further traps are specific to this data:

- **Two trending series always correlate.** Population and tourism both grow in most regions most years;
  correlating the raw levels over time gives a spurious high r. **Design decision (v1 shape):** correlate
  CHANGES, cross-sectionally — one number per region per indicator (e.g. the 2014→2024 change), n = regions —
  which is exactly the shape of the research's own example and avoids the time-series autocorrelation trap.
  Level-over-time correlations within one region are out of v1.
- **Regions are not independent** (spatial autocorrelation): neighbouring NUTS regions move together, so the
  effective n is smaller than the count and p-values are optimistic. v1 discloses this as a standing caveat
  on every regional finding (S8's "what was controlled for: niets" is honest) and pre-registers a conservative
  q; a spatial correction is Phase-3+ statistics and part of the ADR 001 split assessment.
- **Ecological fallacy**: a regional association says nothing about individuals — a fixed sentence in the
  finding's caveat block, deterministic, never the model's to omit.

Controls, all deterministic and all recorded on the finding row:

1. **A curated candidate list, not all pairs.** v1 scans a hand-curated set of indicator pairs (or a curated
   set of ~30–60 indicators, all pairs) chosen with the owner — the owner's cheapest-mechanism-first rule and
   the WP16 "demand-driven, never speculative" posture applied to scanning. Growth of the list is a reviewed
   change, not a knob.
2. **Family-wise correction per run**: Benjamini–Hochberg FDR at q = 0.05 over the whole run's family (or Holm
   for a small family); the family size and method are stored (S6). **Assumption:** q = 0.05 and the strength
   thresholds are calibration-time choices, set against a labelled set of known-real and known-spurious pairs
   the design review builds — mirrored in open-questions, never presented as settled here.
3. **Effect-size and stability gates**: \|r\| ≥ a minimum; a leave-one-region-out (or bootstrap CI) check that the
   sign and the "significant" verdict survive dropping any single region — a finding carried by one outlier
   region is not a finding.
4. **Evidence gates (S7)**: minimum n, minimum span, no nulls or breaks in the window, one unit per side.
5. **Refuse rather than rank low**: nothing below the gates is shown as "weak"; the scan simply produces fewer
   findings. A run with zero findings is a valid, honest run.

### 4.5 Labelling and citation of a finding

Every finding card carries, deterministically: the association label (S4), the finding sentence (LLM-phrased,
slot-filled, validated), the statistic line ("Spearman ρ = −0,41, n = 37 regio's, p (BH-gecorrigeerd) = 0,012,
familie: 1.770 paren"), the two attribution lines (one per indicator, each the normal R4 line with dataset id,
title, sync date, licence — the CC BY derived-data marking "bewerking van … door checkdecijfers.nl" applies,
R5's own rule), the caveat block (ecological fallacy; spatial dependence not corrected; provisional cells
present: yes/no), and the "Bewijs dit patroon" panel (S8) with the aligned region table (each region's two
values as stored cells with batch ids) and the step list ("1. Gelezen: 74 cellen … 2. Verandering berekend per
regio … 3. Rangcorrelatie … 4. Correctie voor 1.770 toetsen …"). Pricing: the owner has said cross-source
insight should cost extra credits ([#103](../../open-questions.md)); whether a scanned finding is free to browse
and charged to "open in chat" is an owner decision, not a design assumption.

## 5. Phased plan — proposal only, NOT SCHEDULED, no WP numbers

Each phase is shaped like a [08-build-plan.md](../../08-build-plan.md) entry (goal, scope, key decisions,
invariants at stake, done-definition) but is deliberately unnumbered. Order follows the research (explorer →
natural-language querying → research assistant), with one reconciliation stated up front:

> **Sequencing conflict to resolve with the owner.** The research's build order starts with a browse/filter
> explorer; ADR 047 says Eurostat is *"demand-driven and never announced before it answers."* A public explorer
> IS an announcement. The reconciliation proposed here: Phase E1's explorer is an **internal, flag-gated,
> noindexed proving surface** (owner + sessions only, like `tables:evict --apply` or the coverage-sprint
> probes), never a public feature — it exists to prove the adapter, the NUTS mapping and the proof panel on
> real data before a single Eurostat answer is served. The public face stays "Eurostat — binnenkort" until
> Phase E2 answers questions. The owner may instead decide a public explorer is wanted (a browse-layer product
> decision that would also reopen [03-mvp-scope.md](../../03-mvp-scope.md)'s free-browse-layer row).

### Phase E1 — Eurostat adapter + internal explorer (proves the adapter)

- **Goal:** a conformance-green `eurostat` adapter and a private surface where the owner can pick an ingested
  Eurostat dataset, filter on its dimensions, see the table and a chart built by the REAL `runQuery` →
  `buildChartSpec` path, and export CSV — with the proof panel underneath. Zero LLM.
- **Scope:** `src/eurostat-adapter/` (Statistics API client, JSON-stat 2.0 parser, `FixtureSource`, NL-only NUTS
  mapping — geography option A), registry entry + `adapterFor` line, fixture captures + `conformance.json`, the
  new region-taxonomy conformance family (wiring point 5), source-scoped catalog prune (wiring point 1),
  additive migrations (`request_urls` on batches, `doi` on catalog/registry rows), the explorer route behind a
  flag (`EUROSTAT_EXPLORER_ENABLED`, unset in production), CSV via the existing `buildAnswerCsv` pattern.
- **Key decisions:** JSON-stat 2.0 vs SDMX-CSV as the wire format (recommend JSON-stat — the API's documented
  primary format with CORS; SDMX only if JSON-stat drops a needed flag); synthetic measure-per-unit (§3.4.3);
  flags verbatim (§3.4.4); NL-only geo in this phase; sync-only fetches under 500k cells.
- **Invariants at stake:** ingestion validators 1–5 (schema fingerprint, plausibility, period parsing, dimension
  mapping, unit consistency) on a new grammar; R4/R11 through the registry entry; principle (b) — no request-path
  Eurostat call anywhere (a literal-scan pin like the cron route's); A1 byte-identity for every CBS answer,
  citation, chart and CSV (the WP30a golden pins stay green); A4 zero prompt bytes.
- **Done (draft):** `npx vitest run tests/sources` green with Eurostat as a second positive control; 2–3
  frozen-key verification tasks per ingested dataset (the 05-data-rules onboarding rule, hand-authored); the
  explorer renders a chart and a proof panel for ≥ 3 real datasets on the dev server; full verification block
  green; **the public site is byte-identical** (the "never names Eurostat as answering" tests still pass).
- **Owner steps this phase needs:** licence/legal check (§3.3), the Dutch wording for flag suffixes and null
  reasons, the geography decision (A now, B when?) — all recorded before build, per the guide's preconditions.

### Phase E2 — natural-language querying through the existing chat pipeline

- **Goal:** a question a user actually asks is answered from a Eurostat dataset through the SAME pipeline, with
  the same clarification/refusal behaviour, proof panel, audit row, credits and benchmark discipline.
- **Scope:** finder recall per source (lift `language='nl'`, English FTS + the Dutch alias layer), rerank prompt
  and intent-prompt provenance prose (the owner-signed A4 sweep — fixtures re-recorded), the onboarding-cron
  route via `adapterFor` (wiring point 4), compose/refusals threading the result's actual source instead of
  `resolveSource(undefined)` (wiring point 3), the source-chip rule for the CBS-and-Eurostat-both-have-it case
  (§3.5), the `b`-flag precondition in the trend derivations, geography option B if decided (its own ADR +
  migration), the public-claim wording sweep (§3.7), 5+ Eurostat benchmark tasks added to the frozen key
  including at least two refusals (a semester dataset; an excepted-geo ask).
- **Key decisions:** whether geography B ships here or later; the disambiguation rule between sources; whether a
  Dutch question about a non-NL region is in scope at all before B.
- **Invariants at stake:** R1–R11 end to end on a second grammar; R7 for the new ambiguity class; R8
  reconstruction for rows with `source = 'eurostat'`; the benchmark gate (14/14 + 6/6 + 0 fabricated) unchanged
  PLUS the new tasks; ADR 026's verification gate gains the "genuine second source" cross-check its revisit
  trigger promised — for measures both sources publish for NL, a registered comparison, refusing the table on a
  mismatch beyond a stated tolerance.
- **Done (draft):** the new benchmark tasks pass at the gate; a live smoke run through the on-demand job onboards a
  real Eurostat dataset and answers on arrival (owner-supervised, real spend); `/llms.txt`, the coverage
  disclosure, `/systeemoverzicht` and CLAUDE.md all say "official sources" and name Eurostat as answering —
  in the same change, owner-signed.

### Phase E3 — the research-assistant layer

- **Goal:** saved queries, and CBS-versus-Eurostat comparison that explains *why* two official figures for the
  same thing differ — definition, population, method, frequency — from the sources' own metadata, never from
  the model's general knowledge.
- **Scope:** saved queries ride the saved/pinned-charts dashboard seam ([06-roadmap.md](../../06-roadmap.md)
  Phase 2, [#60](../../open-questions.md)) — a pointer at an audit row, no new storage model; a new registered
  derivation kind `cross_source_difference` in `src/query/derivations.ts` (two cells, two sources, unit-checked,
  marked derived, both attributions) — the first cross-source computation in the product ([#103](../../open-questions.md));
  a deterministic "waarom verschillen deze cijfers" block assembled from stored metadata fields only
  (`CbsMeasure.description` verbatim for CBS; Eurostat's dataset/ESMS metadata captured at ingestion into an
  additive metadata column) — the LLM may paraphrase these stored texts under the R2 rule (they are attribution
  metadata, not raw rows) with the R3/R9 belts, or the block stays template-only if the review judges paraphrase
  too risky; the multi-reading disclosure design already anticipated at [#39](../../open-questions.md)/[#21](../../open-questions.md).
- **Key decisions:** template-only vs LLM-paraphrased metadata; extra-credit pricing (owner, #103); whether a
  comparison chart with two attribution lines needs a `ChartSpec` extension (ADR 007 seam — two series from two
  sources is a spec change, R6).
- **Invariants at stake:** R5 (a new registered derivation, listing both source cells and both sources); R10
  (units may differ across sources — refuse, never convert, unless a registered conversion exists); R2 (metadata
  in, never rows); principle (a) — "why they differ" is quoted, not diagnosed.
- **Done (draft):** a benchmark task where CBS and Eurostat both carry a figure and the answer shows both,
  attributes both, states the difference as a marked derivation and quotes both definitions; R8 reconstruction
  of that row.

### Phase P — pattern discovery (separate track; after E2 at the earliest)

- **Goal:** §4 as designed: an offline scan over a curated candidate list producing provenance-complete
  findings; a "Patronen" surface with slot-filled explanations under the S-family.
- **Scope:** `src/patterns/` (registered stats, scan CLI, `pattern_findings` migration), the S-family in
  05-data-rules with tests, the finding surface + "Bewijs dit patroon" panel, the causal-language veto list
  (owner-reviewed Dutch), calibration set for thresholds.
- **Key decisions:** curated list contents (owner); q and strength thresholds (calibration); Python-split
  assessment before regression/clustering (ADR 001 triggers 3/4); pricing/browse-vs-open-in-chat (owner);
  whether findings may include Eurostat-only, CBS-only, or both (S10 says never mixed in v1).
- **Invariants at stake:** the new S1–S10 in full; ADR 032/037-style separation from the answer pipeline; the
  benchmark's 0-fabricated gate must be provably unaffected (findings never enter it).
- **Done (draft):** the S-family tests green incl. tamper and seeded-causal-fabrication cases; a labelled
  calibration set where known-spurious pairs are NOT reported at the chosen q; a real scan run on ingested data
  reviewed by the owner finding-by-finding before the surface is reachable by anyone else.

## 6. Open questions and assumptions (to mirror into open-questions.md when this is scheduled)

1. **Geography scope — the biggest one. RESOLVED (owner, 2026-09-14, in chat):** the product's destination is
   an EU-wide knowledge base — CBS/Dutch data was deliberately the first step, not the product's final ceiling.
   Option A (NL-only Eurostat) is at most a temporary technical stepping stone, never the intended end state;
   option B (the region-taxonomy widening — a country level, a second region-code family, changes to
   `query/`/`registry/`/`answer/intent/`, a migration) is the expected direction. ADR 030's revisit trigger for
   "a chosen source outside Nederland scope" has fired (addendum added there). **Still open:** the exact phasing
   — whether the first Eurostat adapter ships narrowed to NL rows while the taxonomy widening is designed in
   parallel, or whether the widening lands before any Eurostat code — is for the future Eurostat ADR (ADR 047
   requires one before code) to decide, not settled by this note alone.
2. **Explorer: internal proving surface or public feature?** (§5 preamble.) **Assumption:** internal, flag-gated.
3. **Licence exceptions** (non-EU country data; CH/AT trade) — legal check of the exact list and whether
   slice-time exclusion is sufficient. **Assumption:** it is, pending that check.
4. **NUTS ↔ CBS region mapping** — exactness for provincie/COROP under the current NUTS version; the playbook for
   NUTS revisions; where the equivalence table lives (`dimension_labels` vs a new table). **Assumption:**
   `dimension_labels` with a reviewed seed, same as herindelingen.
5. **Period grains** — semester/weekly/daily datasets refused in v1. **Assumption:** the ICP's datasets are
   annual/quarterly/monthly; measure in E1.
6. **Per-period status for a source with per-cell flags** — whether conformance F2 accepts the adapter's
   "all observed periods published, flags per cell" reading without an amendment. **Assumption:** yes; else an
   ADR-recorded contract amendment.
7. **Dataset discovery in Dutch over an English catalog** — alias layer first, embeddings on measured misses.
   **Assumption:** the first 20–30 asked-about datasets are coverable by aliases; the pgvector trigger is
   evaluated on measured miss rate, not on catalog size alone. Cost note: embeddings mean a new per-refresh
   embedding spend and a tuning surface — exactly what the cheapest-mechanism rule defers.
8. **Catalog freshness** — daily Catalogue-API refresh (Eurostat updates twice daily; the CBS mirror refresh
   already takes ~19 minutes for 4,858 rows, so a 2× larger mirror needs its runtime measured against the
   cron/function ceiling). **Assumption:** daily is enough; a dataset's own `modified` drives staleness.
9. **Dataset-selection ambiguity** — the same statistic at CBS and Eurostat: source chips decide in v1 (§3.5);
   the richer #39-style "here are both readings" answer is E3. **Assumption:** chips-decide is acceptable to
   the owner as the v1 rule.
10. **Decimals** derived from observed precision (§3.4.3). **Assumption:** honest and pinned at registration.
11. **Request-URL storage on batches** — additive, both sources. **Assumption:** no GDPR angle (URLs contain
    dataset codes and filters, never user data).
12. **The S-family thresholds and the causal-language veto list** — calibration-time and owner-reviewed
    respectively. **Assumption:** none of the numbers in §4.4 (q = 0.05, minimum n, \|r\| floor) are settled.
13. **ADR 001 split** — v1 stats in TS; the assessment is due before regression/clustering. **Assumption:** the
    owner prefers to keep the single app as long as the stats stay pairwise.
14. **Pricing** — Eurostat answers at the normal price; on-demand Eurostat onboarding at the existing 100-credit
    heavy tier (ADR 026 decision 2, unchanged); cross-source comparison and findings at an owner-decided extra
    (#103). **Assumption:** no new price tier before usage data.
15. **Attribution wording** — the Dutch Eurostat line and the flag suffixes are owner sign-offs (the guide's
    rule for `nullReasonLabels`).

## 7. Explicitly out of scope for this document

- **No ADR.** ADR 047 requires a Eurostat ADR before code; this document is that ADR's input. The future ADR
  must carry ≥ 2 real alternatives per decision, trade-offs and revisit triggers per CLAUDE.md, and the
  pre-build adversarial design review the WP27/WP30 precedent established.
- **No WP number, no change to [08-build-plan.md](../../08-build-plan.md)'s active list, no STATUS.md change.**
  The phases above are shaped like WP entries so they can be lifted into the plan once the owner schedules them.
- **No code, no migration files, no fixture captures, no prompt bytes, no registry entry.** The only file this
  session produced is this one.
- **Not decided here:** anything marked **Assumption** above; the public-claim wording; pricing; the geography
  waist; the explorer's visibility; the Python split.
- **Not covered:** Eurostat as an *enrichment* for CBS answers (joining sources inside one answer body) — that is
  [#103](../../open-questions.md)'s multi-source design, of which E3's cross-source difference is the first,
  narrowest slice; maps (the #212 region-set capability, gated separately); the other Phase-3 sources (RIVM,
  Kadaster, …), which stay unordered after Eurostat per ADR 047.

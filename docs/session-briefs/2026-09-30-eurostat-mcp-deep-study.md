# The Eurostat connector by cyanheads: a deep read, and what a general Eurostat layer would look like for us (2026-09-30)

**Asked by the owner (2026-09-30):** "take a further look at the MCP that that guy is building for Eurostat data. I think
he knows better how to set up a portal to that data." Follows the five-connector skim in
[2026-09-30-cbs-connectors-code-study.md](2026-09-30-cbs-connectors-code-study.md) (open-questions #357).
**Method:** read-only, through the GitHub API only (`gh api repos/cyanheads/eurostat-mcp-server/...`, version 0.8.1,
last commit `f42c9364`, 2026-09-25). Nothing was cloned, installed or run. No call went to his hosted server or to
Eurostat. **No code was copied, and none should be.** Everything below is a technique to re-implement.

## In plain words (read this first)

1. **What he does better: the way in.** He reads Eurostat's own *description* of a dataset (which dimensions it has, which
   codes are valid, the region level of every code, the time span, the last update) without downloading any numbers.
   We learn a dataset's shape by downloading its numbers, which fails for big datasets. That is the main reason we can
   only handle four hand-picked Eurostat datasets today.
2. He covers the **whole Eurostat catalogue** (about 8,900 datasets, plus the detailed-trade collections on a second
   Eurostat server), keeps the **theme tree** (Economy › National accounts › …), and treats every error Eurostat can
   send back as a named case with a clear next step.
3. He handles several **Eurostat traps** we do not: a "confidential" marker hidden inside the status field, 42 combined
   status codes (for example "break in series + low reliability"), a "last N periods" option that counts from the
   dataset's latest period rather than the country's, and periods like "2020-13" that Eurostat silently turns into
   January 2021.
4. **What we do better: the answer.** In his tool the AI assistant picks the dataset, picks the codes, reads the numbers
   and does any sums itself. Nothing is stored, dated or checked against a known answer, and a partly-wrong request
   comes back as a partial result with a warning note. We store and check every cell, pin one definition per everyday
   term, refuse instead of guessing, and prove it with a 20-question benchmark.
5. **His search is simple:** every word must appear somewhere in the title, theme or code. No ranking, no handling of
   discontinued datasets. Ours ranks and flags frozen datasets. We should borrow his theme tree, not his search.
6. **So:** borrow his *portal plumbing*, keep our *answer rules*. The result would be a general "any Eurostat dataset"
   layer: the Eurostat twin of the CBS table lane, on the same slice storage (ADR 065).
7. **Recommended next step (no AI spend, no database change):** teach our Eurostat adapter to read a dataset's structure
   the way he does, and to fetch small slices by member lists and period ranges. Measure it by moving our four
   whole-table Eurostat datasets onto slice storage with an identical-cells check (#358 item 4). That both removes a
   leftover of the old whole-table path and proves the general route on real data.
8. Only after that: widen dataset finding to the whole Eurostat catalogue, then let the existing table-lane parser
   choose from a Eurostat dataset's own lists. That is the first step that costs AI calls, and the owner supervises it.
9. We found four small defects in our adapter worth fixing on the way (section 5.1). The largest is a time limit that
   can outlast the table-lane job's whole budget.
10. **Licence:** Apache-2.0. Reading his code and re-implementing the ideas creates no duty. Copying code would require
    shipping his licence and marking our changes. We copy nothing, and we credit him in the ADR as a courtesy.

---

## 1. The portal design, step by step (with evidence from his repo)

Paths below are in **his** repository unless marked "ours".

### 1.1 From a vague topic to a dataset

- **Catalogue source:** the Eurostat table-of-contents text file `…/api/dissemination/catalogue/toc/txt?lang=en`,
  parsed in `src/services/eurostat-catalogue/eurostat-catalogue-service.ts` (`fetchTocEntries`, `parseToc`). Each row
  holds title, code, type, last update, data start, data end and value count. The title's **leading spaces encode the
  tree depth** (4 per level). He rebuilds the theme hierarchy from that (`measureDepth`, `parentIndex`).
  Folders have 7 columns and datasets 8 (`docs/design.md`, "Catalogue API").
- **Second server:** the `DS-*` detailed-trade (Comext) and PRODCOM collections are not in that file. He merges the
  dataflow list from `…/api/comext/dissemination/sdmx/2.1/dataflow/ESTAT` into the tree (`mergeComextFlows`). If that
  list fails, search keeps working from the main file (`fetchAndParseToc`). One predicate, `isComextDataset` (`/^ds-/i`,
  `src/services/eurostat-hosts.ts`), routes every call to the right server.
- **Search:** the query is split into words. **Every word must appear** somewhere in "label + theme breadcrumb + code",
  ignoring case (`search()`). Results come in table-of-contents order. There is **no ranking, no stemming and no
  synonyms**. Each code appears once (first placement wins). Pages use a cursor tied to the query and the catalogue
  snapshot. The tool is `eurostat_search_datasets`.
- **Themes:** `eurostat_browse_themes` walks the tree from the top folders down. It reports `otherPlacements` when a
  folder code is filed under several branches (`browse()`).
- **Discontinued / frozen datasets: not handled.** Searching his `src/` for discontinued/archived/frozen/obsolete finds
  nothing relevant. `dataEnd` is shown and the model is left to notice. (We already flag these: ours,
  `src/ingestion/freshness.ts` `possibly_frozen`, commit `9d96ec8c`.)

### 1.2 From a dataset to its structure (the key part)

- **Two structure reads, no observations** (`src/services/eurostat-data/eurostat-data-service.ts`, `buildSdmxUrl`,
  `loadSdmxMetadata`):
  - `…/sdmx/2.1/dataflow/ESTAT/{code}/1.0?references=descendants&detail=referencepartial` returns the dataset's
    dimensions in key order, concept labels, the **partial code lists with labels** (only codes this dataset uses), and
    annotations: `OBS_COUNT`, `OBS_PERIOD_OVERALL_OLDEST/LATEST`, `UPDATE_DATA`, `ESMS_HTML`.
  - `…/sdmx/2.1/contentconstraint/ESTAT/{code}/1.0` returns the **codes that actually occur**, per dimension, including
    `TIME_PERIOD`.
  - A third, `…/sdmx/2.1/datastructure/ESTAT/{code}` requested **without** a version number, gives the key order for bulk
    downloads. A pinned `/1.0` returns the dataset's *first* structure, not its current one (`docs/design.md`,
    "SDMX 2.1 Dataset Structure API"; decisions log 2026-09-25).
- **Parsing:** his own minimal XML reader, which refuses DTDs (`src/services/eurostat-data/sdmx-metadata.ts`,
  `parseXml`, `parseSdmxDatasetMetadata`).
- **Region level of every code:** the `GEO` code list carries a `LEVEL` annotation (`0`=country, `1`–`3`=NUTS 1–3,
  `AGG`=aggregate such as EU27). He maps it to `geoLevelsByCode` (`parseGeoLevel`). This replaces any hand-kept list of
  which geo codes are countries.
- **Important limit: the "content constraint" is per dimension, not per combination.** `parseConstraintValues`
  collects the union of values per dimension across `CubeRegion`s. It does **not** tell you whether *this* sex × age ×
  country combination exists. That is only known after fetching (see 1.4).
- **Caveat he measured:** on the Comext server every constraint's `TIME_PERIOD` runs to 2026-12, months past the data,
  so he takes the time span from annotations, not from the constraint (`docs/design.md`, Comext table). Whether the
  main server's constraint time lists are exact is **Assumption A1** (unverified).
- Labels and units: labels come from the partial code lists (English by default; `lang` EN/FR/DE on data calls). Units
  are just another dimension (`unit`), and nothing special is done with them.

### 1.3 From structure to a bounded query

- **Statistics API** `…/statistics/1.0/data/{code}?format=JSON&lang=EN` with repeated `{dim}={code}` parameters,
  `geoLevel`, `sinceTimePeriod`, `untilTimePeriod`, `lastTimePeriod` (`buildUrl`, `queryDataset`).
- **Checked before any request** (`src/services/eurostat-periods.ts`): period literals for 9 forms (`YYYY`, `YYYY-MM`,
  `YYYY-Qn`, `-Sn`, `-Tn`, `-Mnn`, `-Wnn`, `-Dnnn`, `YYYY-MM-DD`). Impossible components are refused because Eurostat
  silently rolls them over (`2020-13` → 2021-01; week 53 of a 52-week year → week 1 of the next year). An inverted range
  is refused because Eurostat returns "everything outside the gap". `geo` + `geoLevel` together is refused (Eurostat
  400), and so are a period range plus `lastTimePeriod`.
- **`lastTimePeriod` trap:** N counts back from the **dataset's** latest period, not the requested slice's. A country
  that lags the others comes back empty. The tool text says so, and `explainNoResults` explains it when it happens.
  (Evidence: `tests/fixtures/une-rt-m-geo-de-xx-last1.json`, a real capture where Germany has no value for the
  dataset-wide latest month 2026-08 and `value` is `{}`.)
- **Size:** no cell estimate before sending. He sends, then classifies Eurostat's "too big" answers (1.5). Inline
  results are capped (preview ≤ 500, decode cap `OBS_CAP` = 5,000, `src/services/eurostat-data/types.ts`). Bigger
  matches go to an optional DuckDB "canvas" where the **model runs SQL** (`eurostat_dataframe_query`).
- **Whole datasets:** `eurostat_download_dataset` uses the SDMX 2.1 TSV bulk endpoint
  (`…/sdmx/2.1/data/{code}/{dot.key}?format=TSV&startPeriod=&endPeriod=`). It sniffs gzip that arrives **without** a
  `Content-Encoding` header and enforces a 50 MiB budget while streaming
  (`src/services/eurostat-bulk/eurostat-bulk-service.ts`).

### 1.4 From the response to an answer

- **JSON-stat decoding** by strides over the sparse `value`/`status` maps (`iterateObservations`, `computeStrides`). A
  cell counts when its index is in `value` **or** `status`, so a wholly confidential slice (all in `status`, `value: {}`)
  is data, not "no results" (`scanCells`; real capture `tests/fixtures/sts-inpr-m-ie-confidential.json`: six `"|C"`
  statuses, empty `value`).
- **Status flags:** JSON-stat folds the confidentiality code (`CONF_STATUS`: `C`, `N`, `P`) into the status string
  behind a `|`. A confidential cell reads `"|C"` and a provisional one `"p"`. He splits them (`splitStatus`). The
  `OBS_FLAG` list has **42 composite codes** (`bdep` = break + definition differs + estimated + provisional), held
  verbatim in `src/services/eurostat-codelists.ts`. PRODCOM puts `":C"` and unit text like `"KG"` in the value itself
  (`decodeTextValue`).
- **Missing values:** `missingObsCount` over the whole match. Unknown counts and period bounds are **omitted, never
  zeroed** (decisions log 2026-08-04).
- **Did every requested value come back?** Eurostat silently drops an unknown filter value. `findUnmatchedValues`
  compares what was sent with each dimension's returned `category.index`, ignoring case. **But he still returns the
  partial result**, with `unmatchedValues` and a `notice`. It is an error only when nothing at all matched
  (`queryDataset`; tool `eurostat-query-dataset.tool.ts`).
- **Empty results are diagnosed from the reply itself:** unmatched values; a `time` size of 0 means "outside the
  dataset's coverage", reported with the `OBS_PERIOD_OVERALL_*` annotations; or "these periods exist but carry no value"
  (`diagnoseEmptyMatch`, `explainNoResults`).
- **Useful annotations in every JSON-stat reply** (seen in his real captures, `extension.annotation`): `UPDATE_DATA`,
  `UPDATE_STRUCTURE`, `DISSEMINATION_TIMESTAMP_PLANNED` (the next planned release), `DISSEMINATION_DOI_XML` (the DOI),
  `OBS_COUNT`, `OBS_PERIOD_OVERALL_LATEST`. He uses only some of them. What exactly `…_PLANNED` promises is
  **Assumption A2**.

### 1.5 Robustness

| Concern | His choice | Evidence |
|---|---|---|
| Time limits | 30 s data and catalogue; 120 s structure (one Comext structure is 23 MB) and bulk | README config table; `.env.example` |
| Retries | Framework `withRetry`: 3 retries, 1 s base, exponential with jitter, 30 s cap; only transient errors; anything marked `retryable:false` fails at once. Bulk downloads are never retried | `framework-skills/api-utils/SKILL.md`; bulk `startDownload` comment |
| Rate limits | **None.** An HTML page instead of JSON is treated as "probably rate-limited" and retried | `fetchJson`, `fetchTocEntries`; no pacer used anywhere in `src/` |
| Error mapping | JSON error array: 404 → `not_found`; 200+id 100 → `no_results`; 400+id 150 → `invalid_dimension`; 400+id 140 or a label naming the period → `invalid_period`; other 400 → `conflicting_params`. The error body of a non-2xx is re-parsed so the live path maps the same way | `checkResponseErrors`, `fetchJson` |
| Too big / asynchronous | Statistics API: `warning.status 413` on HTTP 200, or a 413 error → **non-retryable** `async_response`. Bulk: SOAP fault 413 → `extraction_too_big`; an HTTP-200 `syncResponse`/`SUBMITTED` queue ticket → `async_queued`. **No polling, on purpose** ("the right recovery is adding filters") | `checkResponseErrors`; `classifyXmlBody`; `docs/design.md` "Why no async polling" |
| Caching | Catalogue in memory 12 h, served stale if a refresh fails, 60 s retry cooldown, one shared refresh. Structure per dataset 1 h, frozen, capped at 64 MiB by estimated size, failures not cached. **No data caching** | `loadShared`, `getSdmxMetadata`, `evictToBudget` |
| Cancellation | Shared loads run without any one caller's cancel signal, so one caller leaving does not fail the others | `src/services/shared-load.ts` |

## 2. The tool workflow and how it steers the model

Server-level instructions (`src/index.ts`, `instructions:`) spell out the chain: *search or browse → get_dataset_info →
get_dimension_values → query_dataset*, plus "filter to stay small" and when to use bulk download or SQL.

| Tool | In | Out |
|---|---|---|
| `eurostat_search_datasets` | words, limit, cursor | codes, labels, span, obs count, last update, theme path, `nextStep` |
| `eurostat_browse_themes` | folder code or none | children, breadcrumb, `otherPlacements`, `nextStep` |
| `eurostat_get_dataset_info` | code | dimensions with value counts + 10 samples, time range, obs count, last update, metadata link |
| `eurostat_get_dimension_values` | code, dimension, `geo_level` | all valid code/label pairs (≤ 2,000 inline) |
| `eurostat_query_dataset` | code, `filters` {dim: [codes]}, `geo_level`, since/until or `last_n_periods`, preview size, lang | decoded observations (code+label per dimension, value, flag, confidentiality), counts, `unmatchedValues`, `notice` |
| `eurostat_download_dataset` | code, filters, since/until | row counts, byte budget report, preview; whole table on the canvas |
| `eurostat_dataframe_describe` / `_query` (canvas only) | canvas id / one SELECT | tables / rows |

Each tool description names the tool to call before and after it. Search and browse return a `nextStep` sentence.
Every declared error carries a `reason` and a `recovery.hint` that names the next call, for example "Filter on unit,
na_item — the dimensions of nama_10_gdp this request left unfiltered" (`src/mcp-server/tools/narrowing-advice.ts`).
Errors are plain English sentences: what was sent, what went wrong, what to do next.

**What his design leaves to the model (we must keep all of this in code):** which dataset to use from an unranked list;
which codes to filter on (unit, `na_item`, seasonal adjustment, age band); which region level; how to read a partial
result with `unmatchedValues`; whether a status flag matters; and **all arithmetic**, including SQL over staged tables.
Aggregate members such as `TOTAL` or `EU27_2020` double-count when summed with their parts, and he only warns about it
in text.

## 3. Tests

About 670 test cases (count of `it(`/`test(` lines across `tests/**/*.test.ts`, vitest). Most stub the global `fetch`
with **hand-built** bodies. A smaller set replays **real recorded responses, stored byte for byte**, for exactly the
bug-shaped cases: an all-confidential slice, an unknown geo code `XX`, a fake unit, a range outside coverage (2030+,
before 1980), `last_n_periods` on a lagging country, and Comext 413/fault/queue replies (`tests/fixtures/*.json`,
`tests/fixtures/comext/`, commit `3252cc41`). The tests assert classification, decoding, flag splitting, counts,
unmatched values, cache behaviour and security edge cases (`tests/tools/security-and-edge-cases.test.ts`, 89 cases).
**None checks a figure against an independent answer key.** There is no accuracy benchmark.

## 4. Licence and attribution

Apache-2.0 (`LICENSE`), with a `CITATION.cff` naming Casey Hand. There is no `NOTICE` file. Re-implementing techniques
after reading creates no obligation. Copying or adapting code would require: including the licence, keeping his
notices, and stating our changes. **We copy nothing.** As a courtesy, the ADR that adopts these techniques names the
project as the source of the ideas. Eurostat's own data licence (CC BY 4.0, DOI line) is ours to honour either way and
is already built.

---

## 5. Mapped to us: a general "any Eurostat dataset" layer

### 5.1 Where we stand (checked in our code today)

- The adapter (ours, `src/eurostat-adapter/statistics-api.ts`, `jsonstat.ts`) learns a dataset's schema **from an
  observation download**. Without a slice it asks for the whole dataset and refuses anything declaring more than 500,000
  cells (`SYNC_CELL_THRESHOLD`, `AsyncApiRequiredError`). A schema-only registration (ADR 062 `registerSchemaOnly`) is
  therefore impossible for most Eurostat datasets.
- `buildRequestUrl` **refuses** `dimensionIn` and `periodIn`, the two slice fields the slice cache sends
  (ours, `src/ingestion/slice-cache.ts` ~line 893). **So the one route (ADR 065) cannot serve Eurostat at all today.**
  This is why the four Eurostat datasets are still whole-table (#358 item 4).
- Coverage is hand-kept. Three reviewed sibling pairs pin codes like `s_adj: 'SA', age: 'Y15-74'`
  (ours, `src/sources/eurostat-siblings.ts`); `tipsbd30` is registered separately; geo is limited to a hand list
  `EU_EFTA_STAND_IN_GEO_CODES`.
- The finder searches only `language = 'nl'` rows (ours, `src/catalog/recall.ts` line 95), and the catalogue's
  full-text column is built with the **Dutch** text configuration (ours, `migrations/011_cbs_catalog.sql`) over English
  Eurostat titles. `summary` is empty for every Eurostat row. *(Step 3, 2026-10-01: breadcrumbs now fill `summary`, and the finder reads Eurostat rows behind `EUROSTAT_FINDER_ENABLED`, off by default.)*
- **Defects found on the way (small, fix in step 0):**
  1. **Time limit longer than the job.** `REQUEST_TIMEOUT_MS = 300_000` per attempt × 3 attempts plus backoff. One hung
     Eurostat call can use up to ~15 minutes, far past the table-lane job's 240 s budget (ADR 062) once Eurostat runs
     inside that job. Today only the manual CLI calls it, so this is a future risk rather than a live one. His limit is 30 s.
  2. **Every failure is retried**, including 400/404/413, which fail identically every time (`fetchWith`).
  3. **`"|C"` stored as a flag.** A confidential cell's status arrives as `"|C"`. We store it verbatim, so it matches no
     `provisionalDisplay` or `nullReasonLabels` key and reads as "door Eurostat gemarkeerd als '|C'" (ours,
     `src/sources/registry.ts`). It is honest but not clean. Our break check (`isEurostatBreakFlag`,
     `src/query/derivations.ts`) correctly ignores it.
  4. **Composite flags shown as "voorlopig cijfer".** `bu`, `bp`, `ep` and the other 42 combined codes have no display
     entry, so they fall back to the generic provisional suffix. `bu` (break + low reliability) was **measured live** in
     `une_rt_q` (ADR 048, 2026-09-30 addendum). Display wording for these needs owner sign-off (the how-to-add-a-source
     rule).

### 5.2 Part by part: ADOPT, ADAPT or SKIP

| His part | Verdict | How, for us |
|---|---|---|
| Catalogue from the TOC file | **Have it** | Ours already parses it (`parseJsonStatCatalog`) and keeps `dataEnd`/`valueCount` |
| Theme tree from indentation | **ADAPT** | Rebuild the breadcrumb when parsing and write it into the empty `summary` column, so "regional", "labour market" and similar words are found. No schema change |
| Comext `DS-*` merge | **SKIP for now** | Trade detail and PRODCOM put text in values and are huge. Our fit gate should refuse them honestly until asked for |
| AND-substring search | **SKIP** | Ours ranks (full text + rerank). Measure English recall before anything else (below) |
| Frozen/discontinued | **Have it (ours is better)** | `possibly_frozen` from `dataEnd` lag |
| SDMX dataflow + content constraint for structure | **ADOPT** | New `fetchTableSchema`/`fetchCodeList` path that never downloads observations: dimensions, labels, valid codes, `UPDATE_DATA` as the "modified" date for `registerSchemaOnly`, one measure per `unit` code (today's rule). Write our own small XML reader, or use a JSON rendering if Eurostat serves one (**Assumption A3**) |
| GEO `LEVEL` annotation | **ADOPT** | Replaces `EU_EFTA_STAND_IN_GEO_CODES` as the source of "is this a country / NUTS 2 / aggregate". The licence-exception exclusion (ADR 048 D6) stays a deliberate code rule on top |
| Unversioned `datastructure` | **ADOPT (note)** | Only if we ever need key order; never pin `/1.0` |
| Period validation before sending | **ADAPT** | Our periods come from our own validated grammar, so the risk is low. Still add his checks (impossible components, inverted range) at the adapter boundary as a guard |
| `lastTimePeriod` | **SKIP** | Its dataset-wide meaning gives wrong "latest" answers for lagging countries. "Latest" is decided in code from stored cells per series (our existing freshness rule) |
| `sinceTimePeriod`/`untilTimePeriod` + repeated `{dim}=` | **ADOPT** | Map `dimensionIn` to repeated params and `periodIn` to a since/until range plus a client-side filter. Estimate cells **before** sending (members × periods ≤ the 2,000-cell slice cap), which he does not do |
| `geoLevel` parameter | **ADAPT later** | Useful for "per country" classes. The CBS lane refuses region classes today (#340–#345); keep parity |
| Stride decoding, sparse value/status | **Have it** | Ours `jsonstat.ts` |
| `"|"` split into flag + confidentiality | **ADOPT** | Fix defect 3: `"|C"` → status `c` (or a separate null reason), never the raw string |
| 42-code flag list | **ADOPT** | A display entry per composite code, built in code from the verbatim list. Dutch wording owner-signed |
| Text values (`KG`, `:C`) | **SKIP** | PRODCOM only; refuse at the fit gate |
| "Every requested value came back" | **ADAPT, stricter** | He returns partial data with a notice. We **refuse** (principle c). Ours already refuses for `dimensionEquals`; extend to member lists and every requested period |
| Empty-result diagnosis | **ADOPT** | Pick the refusal reason in code (unknown code / outside coverage / not yet published for this country). This feeds our typed refusals and their Dutch templates |
| Error classifier + non-retryable reasons | **ADOPT** | Fixes defect 2 |
| 30 s time limit, retry cap, one total deadline | **ADOPT** | Fixes defect 1: data slice ~30 s, catalogue long, one deadline inside the job budget |
| No async polling | **Agree** | Already our D6 posture; with 2,000-cell slices it never triggers |
| Catalogue/structure memory caches | **ADAPT** | Our "cache" is the database: the schema registration + `slice_fetches` dated by Eurostat's update stamp. `DISSEMINATION_TIMESTAMP_PLANNED` could let `ensureSlice` skip re-checks until the next release (**Assumption A2**, measure first) |
| Rate limiting | **Neither has it** | Serialise Eurostat calls per job (ADR 048 D6 already says so); add the per-source parallel cap from the s151 study when fetch-on-question goes live |
| Bulk TSV download, DuckDB canvas, model-written SQL | **SKIP** | Whole-table copies are being retired (ADR 065), and arithmetic by the model breaks principle (a) |
| Tools for a model, `nextStep`, recovery hints | **SKIP (for the product)** | Our LLM never drives the fetch. Keep as the template if we ever publish our own connector (#356) |
| Real recorded edge-case responses as fixtures | **ADOPT** | Record the same shapes for our tests: all-confidential slice, unknown code, outside coverage, lagging country, 413 warning |

### 5.3 What it replaces in our current Eurostat setup

- `SYNC_CELL_THRESHOLD` on the whole dataset → a per-slice cell estimate from the structure.
- `EU_EFTA_STAND_IN_GEO_CODES` as the level source → the GEO `LEVEL` annotation. The licence-excluded list stays.
- Whole-table registration of `tipsbd30`, `une_rt_q`, `prc_hicp_minr`, `namq_10_gdp` → slice storage (ADR 065).
- Hand-registered sibling **tables** → registered on demand by the general route. The three sibling **definitions**
  ("EU unemployment means `une_rt_q`, SA, 15–74, total") stay, the same way `defaults.ts` keeps CBS's pinned
  definitions (ADR 065 decision 2). That is a definition, not curation.
- Nothing here adds a pinned table, a fixture per dataset or a vocabulary entry. It is the layer (CLAUDE.md
  "Breadth comes from the layer").

### 5.4 Order of steps, each one measured

| # | Step | Measure of done | Size | AI calls | Schema |
|---|---|---|---|---|---|
| 0 | Fix defects 1–4 (time limit + deadline, non-retryable classes, `"|C"` split, composite-flag display) | Unit tests on recorded replies; flag wording signed by owner | ~150 lines + tests | 0 | none |
| 1 ✅ | Structure reader: dataflow + constraint → schema + code lists + geo levels + update date, no observations | For the 4 registered datasets: dimensions and code lists are a superset of today's; `registerSchemaOnly` accepts a Eurostat id; a read-only crawl of a sample of the catalogue reports the share of datasets whose structure reads cleanly and fits (time grain A/Q/M, a `unit` dimension). **Measured 2026-10-01 (branch `eurostat-structure-reader`):** superset holds for all 4 (same dimensions, titles, labels; more codes); `registerSchemaOnly` registers `eurostat:tipsbd30` from structure alone (hermetic); crawl of 30 random datasets: **30/30 read cleanly, 28/30 fit** (1 without `unit`, 1 with no licensed geo) | ~920 lines (strict XML reader 258, structure reader 601, adapter ~60) + 49 tests | 0 | none |
| 2 | Slices: `dimensionIn`/`periodIn`, cell estimate before sending, all-values-returned refusal, empty-reply diagnosis | Convert the 4 Eurostat datasets to slice storage with `ingest:parity` = IDENTICAL (#358 item 4); the whole-table path then has no Eurostat users | ~250 lines + tests | 0 | none expected (`slice_fetches` is source-neutral) |
| 3 ✅ | Finding: breadcrumbs into `summary`, Eurostat rows visible to the finder behind a flag | On a labelled set of ~30 Dutch/English questions, the right dataset is in the shortlist at a rate we write down. If the Dutch text configuration hurts English titles, **measure** before proposing a per-source configuration (that would be a migration). **Measured 2026-10-01 (dark, flag `EUROSTAT_FINDER_ENABLED`, recall stage only — no rerank replies exist and recording them is spend):** 30 questions (12 Eurostat topics in Dutch and in English, 6 CBS). English: top-1 6/12, top-5 9/12, in the 24-row shortlist 10/12. Dutch: 0/12 (a Dutch topic shares no word with English titles — needs a Dutch→English topic bridge). CBS: 6/6 in the shortlist, same places with the flag on and off. Breadcrumbs: without them English drops to 4, 7, 9. Text configuration: `english` for Eurostat rows gives 6, 9, 11 (finds `minimum wage`, the Dutch stemmer misses "wages"), `simple` 6, 9, 10 — not worth a migration. Frozen rule reused: 3,772 current, 3,756 possibly frozen, 41 unjudged of 7,569 (ADR 048 addendum "finding a Eurostat dataset") | ~100 lines + labelled set | 0 (rerank only at eval, fixtures) | none |
| 4 | Table-parse input for Eurostat: unit = measure, `freq` tied to the requested grain, a total rule for Eurostat codes (**Assumption A4**: `TOTAL`, `T` and similar), countries via the E2a word list; the model still picks only from offered lists | Dry run (zero spend), then an owner-supervised recording run on the cheap tier (by analogy with CBS: ~100k input tokens) | ~300 lines + labelled cases | recording run only | none |
| 5 | Wire to the table lane dark; ≥ 5 Eurostat benchmark tasks incl. ≥ 2 refusals; the D3(d) public-claim sweep in the same change | Benchmark gate unchanged (14/14 + 6/6 + 0 invented) plus the new tasks | wiring + tasks | benchmark runs | none |

**Step 1 as built (2026-10-01), what the measurement changed:** (a) **decimals are in no structure message** (the primary measure is a bare `Double`), and they set how a figure is rounded on screen, so a structure-only registration still needs each unit's decimals from observed data; the reader refuses (`decimals_unknown`) rather than guess. Step 2 must supply them, e.g. from a small read plus a slice-time check that refuses a value with more decimals than registered *(built so 2026-10-01, dark — ADR 048 addendum "structure registration…", #357 (a))*. (b) The structure mode is opt-in and not used by production: switching the four live datasets to it would change their fingerprints (all units, not the scoped one) and would need a re-baseline. (c) The euro area's 2026 aggregate `EA21` and code `OTH` levels exist; `EA21` is outside the reviewed licensed aggregates, so it is excluded until reviewed. (d) 3 of 30 sampled datasets have no `geo` dimension (their geography sits in `rep_mar`, `airp_pr`…); the licence rule, today as before, only restricts a dimension named `geo` *(closed 2026-10-01: it restricts every dimension Eurostat marks as geography, and a dataset with none is refused — same addendum, #357 (d))*. (e) One sampled dataset mixes A, Q and M in one table.

Steps 0–2 need no AI and no schema change. Live Eurostat GETs are free and read-only; the owner confirmed in session 107
that "no spend" meant money. Production conversions stay owner-supervised, one dataset at a time, as in session 152.

### 5.5 Assumptions (to mirror into open-questions #357 when this is scheduled)

- **A1:** on the main Eurostat server the content constraint's `TIME_PERIOD` list matches the published periods. On
  Comext it does not, per his measurement. Check against `OBS_PERIOD_OVERALL_LATEST` before trusting it. **Measured
  step 1: held on all 4 registered datasets and all 28 fitting sampled ones; the reader checks it every read and refuses
  on a mismatch (`time_span_mismatch`).**
- **A2:** `DISSEMINATION_TIMESTAMP_PLANNED` is the next scheduled release and is reliable enough to skip re-checks. Seen
  in his captures only; its meaning is unverified.
- **A3:** Eurostat may serve the same structure messages as SDMX-JSON, which would spare an XML reader. Unverified. His
  design doc mentions `format=json` only for the dataflow *list*. **Measured step 1: false.** SDMX-JSON gets 406 (2.1
  and 3.0); `format=JSON` returns JSON-stat only with `references=none` (annotations, no dimensions or codes). A small
  strict XML reader was written (`src/eurostat-adapter/xml.ts`), no new dependency.
- **A4:** Eurostat total members use a small set of codes (`TOTAL`, `T`, …). Measure on the structure crawl in step 1;
  never guess a default. **Measured step 1 (30 datasets, 75 classification dimensions): partly.** 42 have `TOTAL` or `T`,
  at least 5 more use other codes (`TOT_FTE`, `C-O`, `TOT_IN`, `IND_TOTAL`, `0`), and about 28 have no total member at
  all (age bands, for example). A total must be read per dataset from its labels, never assumed. Datasets hold 13–839
  non-time codes (median 63).
- **A5:** the share of Eurostat datasets without a `unit` dimension (our measure synthesis needs one) is small. Measure in
  step 1; a dataset without one is refused, never mapped by guesswork. **Measured step 1: 1 of 30 sampled (3%),
  `lfso_04wktpna11`; refused as `no_unit_dimension`.**
- His test count (~670) is a line count of test declarations, not a run. His "8,933 datasets" figure is from his
  May 2026 design pass (`CITATION.cff`, `docs/design.md`) and drifts upstream.

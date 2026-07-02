# Phase 0 CBS table set — validated against the live catalog

**Resolves [open-questions.md](open-questions.md) #1.** Validated 2026-07-02 against both live CBS catalogs (v3: opendata.cbs.nl; v4: datasets.cbs.nl), per the selection checklist in ADR [003](decisions/003-cbs-access-layer.md): platform availability, observation count, active status, and period coverage for the benchmark tasks in [02-user-scenarios.md](02-user-scenarios.md). Every recommendation below was independently re-verified by an adversarial second pass (all claims reproduced from the API, none inferred from descriptions). All values and statuses are **measured on 2026-07-02** — a later session should expect newer periods, not different history (barring CBS corrections, which the sync diff log will catch).

## The set (8 tables)

| Topic | Table | Title | Platform | Status | Size | Serves |
|---|---|---|---|---|---|---|
| Population | `03759ned` | Bevolking op 1 januari en gemiddeld; geslacht, leeftijd en regio | both | Regulier | v4: 100,741,875 obs — **slice required** | B1, B2, B10, B13, B14 |
| Consumer prices | `86141NED` | Consumentenprijzen; CPI 2025=100, index en mutaties | both | Regulier | v4: 611,030 obs | B3, B4, B20 |
| Unemployment | `85224NED` | Arbeidsdeelname; kerncijfers seizoengecorrigeerd | both | Regulier | v4: 4,046 obs | B5 |
| Housing stock | `82235NED` | Voorraad woningen; standen en mutaties vanaf 1921 | both | Regulier | v4: 889 obs | B6 |
| House prices | `85773NED` | Bestaande koopwoningen; verkoopprijzen prijsindex 2020=100 | **v4-only** | Regulier | v4: 4,264 obs | B7, B8, B16 (nearest-alternative wording) |
| Bankruptcies | `82242NED` | Faillissementen; kerncijfers | both | Regulier | v4: 3,084 obs | B9 |
| Household income | `83932NED` | Inkomen van huishoudens; inkomensklassen, huishoudenskenmerken | both | Regulier | v4: 260,946 obs — slice recommended | B12 |
| Solar electricity | `82610NED` | Hernieuwbare elektriciteit; productie en vermogen | **v4-only** | Regulier | v4: 3,863 obs | B11 |

**Platform conclusion:** all 8 tables are reachable via **OData v4 alone** — the v3 bulk-feed fallback budgeted in ADR 003 is **not needed for the Phase 0 set**. (ADR 003's context note that `70072NED`/`03759NED` were v3-only is superseded by today's measurement: both exist on v4, under *lowercase* identifiers — see quirks.) The `CbsSource` adapter needs one implementation.

## Registered slices (feeds the registry work package)

Per [05-data-rules.md](05-data-rules.md), partially ingested tables record their slice in the registry, and refusal wording distinguishes "outside the loaded slice" from "not published by CBS".

- **`03759ned`** — the full table is a Geslacht × Leeftijd (0–104) × BurgerlijkeStaat × RegioS × Perioden cross of >100M observations; Phase 0 needs none of the person-level breakdowns. Slice: `Geslacht=T001038` (totaal), `Leeftijd=10000` (totaal), `BurgerlijkeStaat=T001019` (totaal), all RegioS at national/provincial/gemeente level, periods ≥ 2019JJ00. This reduces the ingest to a small table while keeping every benchmark cell.
- **`83932NED`** — slice to `Inkomensklassen=T001226` (totaal) × `KenmerkenVanHuishoudens=1050010` (alle particuliere huishoudens); keep all Inkomensbegrippen (primair/bruto/besteedbaar/gestandaardiseerd) so the alias list can state the chosen definition.

## Measured facts per table (answer-key inputs)

Live-read reference values below are **context for freezing the answer key, not the key itself** — the key freezes against our *ingested* cells, pinned to a sync batch ([02-user-scenarios.md](02-user-scenarios.md), Scoring).

### `03759ned` — population
Yearly grain 1988–2026; `2024JJ00` and `2025JJ00` both **Definitief**. Live-read: NL 1-1-2025 = 18,044,027; NL 1-1-2024 = 17,942,942 (B13 growth = +101,085, a registered *difference* derivation); Utrecht (`GM0344`) 1-1-2024 = 374,238; Amsterdam (`GM0363`) 1-1-2024 = 931,298; Rotterdam (`GM0599`) 1-1-2024 = 670,610; G4 on 1-1-2025: Amsterdam 934,526 (max, B14 = registered *max* derivation), Rotterdam 672,960, Den Haag (`GM0518`) 568,945, Utrecht 376,757. Next CBS update: Q2 2027 — stable through Phase 0.

### `86141NED` — CPI
Successor to `83131NED` (2015=100, **stopgezet** 2026-03-10; its description names 86141NED as successor). Monthly 2009MM12–2026MM06. Headline cell for B3: measure `M000238` (Jaarmutatie CPI) × `T001112` (000000 Alle bestedingen) × `2024JJ00` = **3.3%**, Definitief; 2020–2024 year periods all Definitief (B4). Freshness (B20 input): latest month 2026MM06 is **Voorlopig** (snelle raming, 2.9%); latest **Definitief** month is 2026MM04. ⚠ Base-year break: index *levels* are 2025=100 and not comparable with the old 2015=100 series; jaarmutatie (%) is continuous. CBS also flags a June-2023 energy-price methodology change affecting jaarmutatie comparability through May 2024 (doesn't change the published values).

### `85224NED` — unemployment
Quarterly + annual grain, 2013–2026KW01; `2025KW04` **Definitief** (B5). ⚠ **The title says "seizoengecorrigeerd" but the table carries both variants** as dimension `SeizoenEnWerkdagcorrectie`: `A050903` = seasonally adjusted (our canonical default per the alias policy), `A042501` = unadjusted. Headline measure: `M001906` Werkloosheidspercentage, unit %, 1 decimal. Quarterly only — no monthly grain (monthly lives in `80590ned`, out of scope). Next update July 2026.

### `82235NED` — housing stock
National only, yearly 1921–2025, tiny. Stitches discontinued `81955NED` (2012–2024 source) with the new levensloop statistic (`86098NED`, 2025+) into one series. **Both stock semantics present** for B6: `BeginstandVoorraad_1` (1 januari 2024) = 8,204 and `EindstandVoorraad_9` (31 december 2024) = 8,274 — **unit "× 1 000"** (≈8.20M/8.27M woningen; the R10 factor-1,000 guard applies directly). `2024JJ00` Definitief. ⚠ ~50-unit source-break discontinuity at the 2024/2025 boundary (irrelevant for B6, relevant for any future net-change computation). The answer key must pin which semantics B6 uses.

### `85773NED` — house prices (v4-only)
National, monthly+quarterly+yearly, jan 1995–mei 2026; new figures ~22 days after each month. Measure `M001534` Gemiddelde verkoopprijs (euro). B7: `2024JJ00` = **€450,985**, Definitief. B8 series 2019–2024, all Definitief, no gaps: 307,978 / 334,488 / 386,714 / 428,591 / 416,153 / 450,985. ⚠ CBS's own note: the average sale price is not composition-adjusted (the official market gauge is the price index `M001505_2`) — phrasing should not present it as "the market"; the benchmark asks for the average price, which is exactly this cell. No v3 record exists — v4 path only.

### `82242NED` — bankruptcies
Monthly since 1981 with true quarterly and **yearly** grains (no derived 12-month sum needed). `2025JJ00` **Definitief**. ⚠ B9's answer depends on the `TypeGefailleerde` definition, which the answer key must pin: Totaal (`T001243`) = **4,105** vs Bedrijven en instellingen (`A047597`) = **3,226** (press usually cites the latter; the question says "faillissementen ... uitgesproken", the registry's canonical-default choice must be stated in the answer per the alias policy). ⚠ v3 `Frequency` label says "Permaand" — that's update cadence, not available grains; the year periods exist back to 1981JJ00.

### `83932NED` — household income
Annual 2011–2024; `2023JJ00` **Definitief** (2024 is Voorlopig). B12 cell: Inkomensbegrippen `A043966` (besteedbaar inkomen) × totaal-slice × measure `M003239` (gemiddeld inkomen) × `2023JJ00` = **57.6 × 1,000 euro = €57,600** — the R10 factor-1,000 guard applies. ⚠ Identifier is **uppercase on both platforms** (the lowercase quirk below does not apply to this table).

### `82610NED` — solar electricity (v4-only)
National, annual 1990–2025, two dimensions only (BronTechniek × Perioden). B11 cell: `M002264_1` Bruto elektriciteitsproductie (mln kWh) × `E006590` (Zonnestroom) × `2024JJ00` = **21,822 mln kWh** — status **NaderVoorlopig** (definitief expected ~Nov 2026). **R11 applies: the B11 answer must carry the "voorlopig cijfer" marking.** Cross-checked against `85004NED` (same value; same underlying CBS/RVO source, so internal consistency, not independent corroboration). No v3 record — v4 path only.

## Catalog quirks (adapter/ingestion sessions: read this)

1. **Identifier casing is per-table, on both platforms.** Old tables keep lowercase IDs everywhere (`03759ned`, `70072ned` — uppercase lookups return *empty*, not an error); newer tables are uppercase (`83932NED` is uppercase even on v3). The registry stores the exact as-published ID; the adapter must never case-normalize.
2. **`RegioS` codes in `03759ned` carry trailing-space padding** (e.g. `NL01␣␣`). Exact-match filters without trimming silently return zero rows. Handle at ingestion; store trimmed codes in `dimension_labels`.
3. **v3 `Frequency` describes update cadence, not available period grains.** Always enumerate `Perioden`/`PeriodenCodes`; never rule a table out (or in) from the frequency label.
4. **Period status is first-class on both platforms** (Definitief / Voorlopig / NaderVoorlopig, e.g. CPI's "snelle raming") — this feeds invariant R11 directly and must be ingested per observation, as the `observations` schema (ADR [002](decisions/002-postgres-system-of-record.md)) already requires.

## The notes' cited IDs — resolution

| Cited ID | What it is (measured) | Verdict for Phase 0 |
|---|---|---|
| `85552NED` | **Does not exist** on either platform (neighboring IDs checked; no successor references it). Likely a transcription error in the notes — plausibly `85005NED`, which is a solar *capacity* (vermogen) table and would have been the **wrong metric** for B11 ("opgewekt" = production). | Invalid; replaced by `82610NED` |
| `83765NED` | Kerncijfers wijken en buurten **2017** — a single-vintage table, Gediscontinueerd (current vintage of that series: `86165NED`). | Not needed (sub-municipal grain is out of scope) |
| `86103NED` | Aardgasbalans; aanbod en verbruik — active, v4-only. | Not a Phase 0 topic (roadmap: enrichment phases) |
| `70072NED` | Regionale kerncijfers Nederland — active on both (lowercase `70072ned`), 325 columns spanning ~50 statistics. | Rejected for population: schema-fingerprint churn risk (its changelog shows constant per-topic revisions) and breadth we don't need; `03759ned` is the clean population-only source |
| `85458NED` | Bevolking; herkomstland, geboorteland, leeftijd, regio — active, v4-only, 26M obs, only 2022–2026. | Not needed; no benchmark task requires origin breakdowns |
| `03759NED` | Bevolking op 1 januari en gemiddeld — active on both (lowercase `03759ned`). | **Selected** (with registered slice) |

## Method (reproducibility)

Discovery and verification ran as parallel agents making live `curl` calls against: v3 catalog `opendata.cbs.nl/ODataCatalog/Tables` (+ per-table `ODataApi/odata/{id}/TableInfos|Perioden|TypedDataSet`), v4 catalog `datasets.cbs.nl/odata/v1/CBS/Datasets` (+ per-dataset `Dimensions|{Dim}Codes|MeasureCodes|Observations`). Every recommended table passed an independent adversarial verification pass in which each load-bearing claim (title, platform, status, size, period presence, cell values) was re-derived from the API; all eight verdicts: CONFIRMED. Point-in-time queries of the v3/v4 query APIs were used for *validation only* — ingestion remains bulk-channel per ADR 003.

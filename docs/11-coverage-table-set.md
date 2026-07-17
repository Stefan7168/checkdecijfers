# Coverage-sprint table set — validated against the live catalog

**Companion to [07-phase0-table-set.md](07-phase0-table-set.md)** (that doc is the closed Phase-0 set of 8; this doc
is the authority for every table added by the coverage sprint, owner strategy [#163](open-questions.md)(3), executed
per the brief in [session-briefs/2026-07-17-coverage-sprint-brief.md](session-briefs/2026-07-17-coverage-sprint-brief.md)).
`src/ingestion/registry-seed.ts`'s `COVERAGE_TABLES` is the configuration mirror of this doc — the doc is the
authority, the file must follow it. Same method as docs/07: every load-bearing claim below is **measured** against
the live CBS catalogs (v3: opendata.cbs.nl; v4: datasets.cbs.nl), never inferred from descriptions; a later session
should expect newer periods, not different history.

## The set (grows per sprint table; build order in the sprint brief)

| # | Topic | Table | Title | Platform | Status | Size | Serves |
|---|---|---|---|---|---|---|---|
| 1 | Consumer confidence | `83693NED` | Consumentenvertrouwen, economisch klimaat en koopbereidheid; gecorrigeerd | both | Regulier | v4: 3,864 obs — full ingest | CC1–CC4 ([benchmark/coverage-key.json](../benchmark/coverage-key.json)) |
| 2 | GDP flash (economische groei) | `85880NED` | Bbp, productie en bestedingen; kwartalen, mutaties, nationale rekeningen | both | Regulier | v4: 99,676 obs — FULL ingest (owner decision s50; lean slice validator-refuted) | CC5–CC7 |
| 3 | Producer prices (PPI) | `85770NED` | Producentenprijzen (PPI); afzet-, invoer-, verbruiksprijzen, index 2021=100 | both | Regulier | v4 slice: ProdCom-totaal × afzet totaal+invoer = 654 obs, 100% dense | CC8–CC10 |

## Verification-task convention (docs/05 table-onboarding rule)

Every coverage table ships with 2–3 frozen-key benchmark-style verification tasks, ids `CC*`, frozen in
[benchmark/coverage-key.json](../benchmark/coverage-key.json) and scored hermetically by
`tests/query/coverage-key.test.ts` on the CI gate. The Phase-0 benchmark (B1–B20, its 14/14 + 6/6 + 0-fabricated
gate counts) stays untouched — CC tasks are additive, in their own key file, under the same honesty rule (values
independently re-queried from BOTH live CBS platforms before freezing; keys never edited to green).

## Measured facts per table

### `83693NED` — consumer confidence, seasonally adjusted (sprint #1; measured 2026-07-17)

- **Shape:** exactly one dimension (`Perioden`, TimeDimension) — **no geo dimension** (national-only, same shape as
  `82235NED`/`82610NED`); 8 measures × 483 monthly periods `1986MM04`–`2026MM06` = **3,864 observations exactly**
  (v4 `ObservationCount` 3864; v3 483 rows × 8 topic columns). Monthly grain ONLY — no KW/JJ keys exist, so a
  year-figure ask must refuse (`not_published`), pinned by CC4.
- **Measures (v4 codes — NOT the v3 `_1`-suffixed column names the sprint brief quoted):** headline
  `M001093` Consumentenvertrouwen, `D001095` Economisch klimaat, `M001128` Koopbereidheid (unit
  "gemiddelde saldo van de deelvragen", 0 decimals) + 5 sub-question measures `M001099`/`M001098`/`D001113`/
  `D001115`/`D001122` (unit "saldo positieve en negatieve antwoorden", 0 decimals). All values integers; no
  null cells, no string values observed (full scan at capture).
- **Statuses:** all 483 periods `Definitief` on both platforms — CBS treats this indicator as final on publication;
  the catalog prose notes small revisions land each February for the two prior years (the sync correction-diff log
  is the defense, R11 has nothing provisional to mark today).
- **Cadence:** published ~the 22nd of the **measured month itself** (June figure appeared 2026-06-22 06:30);
  **next release 23 July 2026 06:30** (v3 catalog free-text, the sprint deadline) — a sync on/after that morning
  picks up `2026MM07`.
- **Canonical measures (registry):** `consumer_confidence_seasonally_adjusted` (M001093),
  `economic_climate_seasonally_adjusted` (D001095), `willingness_to_buy_seasonally_adjusted` (M001128) — all three
  are separate persbericht figures. **Canonical-default choice (werkloosheid precedent, docs/05):** the everyday
  term "consumentenvertrouwen" maps to THIS seasonally-adjusted table, not the uncorrected sibling **`83694NED`**
  (WP16-onboarded in prod, session 28; different shape: 2017+, mixed grains, extra breakdowns). The live-prod vocab
  overlap with that sibling's `onboarded:83694NED:*` rows is resolved in the go-live step — see
  [open-questions #165](open-questions.md).
- **Reference values (frozen into CC1–CC3; v3+v4 cross-checked 2026-07-17):** 2026MM06 consumentenvertrouwen
  **−39**, economisch klimaat −64, koopbereidheid **−22**; 2013MM02 consumentenvertrouwen **−41** (pre-2022 record
  low); series start 1986MM04 = +2.

### `85880NED` — GDP flash, quarterly mutations (sprint #2; measured 2026-07-17, built session 50)

- **Shape:** two dimensions — `SoortMutaties` (Dimension, 5 codes: volume/waarde j-o-j en p-o-p + prijs j-o-j; all
  five are PERCENT MUTATIONS, there is no level flavor) × `Perioden` (TimeDimension, 156 codes: 125 KW + 31 JJ;
  ~10 recent periods `Voorlopig` incl. `2026KW01`). 210 measures (99 top-level + 111 detail) = **99,676 obs**
  (v4 count, re-measured on build day; smaller than the loaded CPI table).
- **Slice decision (owner, session 50): FULL ingest, deliberately NO slice.** The brief's lean 2-flavor slice
  (`SoortMutaties` A045299+A045300, 36,820 obs) was REFUTED by the hermetic validator during the s49 overnight
  prep: 26 of the 210 measures exist ONLY under the value/price flavors (income-side value-only concepts — lonen,
  winst — have no volume variant) → `row_plausibility` quarantines, working as designed. Alternatives measured in
  [session-briefs/2026-07-17-coverage-tables-2-9-measured-specs.md](session-briefs/2026-07-17-coverage-tables-2-9-measured-specs.md)
  (a `CbsSlice` measure-allowlist extension was the runner-up; rejected for touching the invariant-critical
  ingest mechanism on a vocab-batch day). The specs' "~18MB fixture" cost was avoided with the 86141NED
  capture-only-slice pattern: the FIXTURE keeps 2020+ only (`periodFloor: '2020JJ00'`, 22,230 obs measured,
  ~4MB) — all 210 measures and all 5 flavors stay covered so the hermetic full-ingest replay still proves
  row_plausibility, and every CC5–CC7 cell is included; LIVE ingest is genuinely unsliced. (Load-bearing:
  27 test files + 5 scripts rebuild the ingested DB per run, so fixture size multiplies straight into gate
  time; and the unfiltered v4 Observations stream serves at ~6KB/s from the local network — see
  `scripts/capture-cbs-fixtures.ts` CAPTURE_SLICES.)
- **Headline measure:** `M002782_1` "Bruto binnenlands product" (%; the title exists on FOUR codes — pin by CODE,
  specs conclusion 3: v3→v4 suffix numbering is NOT parallel). Grains per flavor: 121 KW + 30 JJ cells (measured
  live v4 on build day).
- **Canonical measures (registry, session-50 vocab batch):** `gdp_growth_yoy_volume` (M002782_1 ×
  A045299; canonical default for "economische groei"/"bbp" — CBS's persbericht headline) and
  `gdp_growth_qoq_volume` (M002782_1 × A045300; own key because alternates are prompt-hints, not resolvable
  targets). Value/price flavors and income-side detail measures are ingested but deliberately have no vocabulary
  yet.
- **Cadence:** flash ~30 days after quarter-end (next: Q2 on ~30 July 2026, the sprint deadline); the second
  estimate later REVISES flash quarters (R11 — recent quarters are Voorlopig).
- **Reference values (frozen into CC5–CC7; re-measured on BOTH platforms on build day 2026-07-17):** 2026KW01
  volume j-o-j **+1.4** (Voorlopig); 2023KW04 volume j-o-j **−1.1** (Definitief); 2026KW01 volume k-o-k **+0.2**
  (Voorlopig).

### `85770NED` — producer prices PPI (sprint #3; measured 2026-07-17 overnight, vocab session 50)

- **Shape:** three dimensions — `Afzetgebieden` (5 codes) × `AlleProdComCoderingen` (525 codes!) × `Perioden`
  (109: 101 MM + 8 JJ; last ~5 months `Voorlopig`). 3 measures: `M003367` PPI-index (2021=100, fully dense),
  `M003316` maandmutatie, `M003288` jaarmutatie (headline; nulls in the first series year — no base year, absent
  cells per R11).
- **Slice (registered):** `dimensionEquals: { AlleProdComCoderingen: 'A052584' }` (the hierarchy-root ProdCom
  total "B-E Nijverheid (geen bouw) en energie") + `dimensionPrefixes: { Afzetgebieden: ['A044074','A044077'] }`
  (totaal afzet + invoer; full codes as exact-match prefixes) → **654 obs, 100% dense**.
- **Canonical measures (registry, session-50 vocab batch):** `producer_prices_yoy` (M003288 × totaal; canonical
  default for "producentenprijzen"/"ppi"), `import_prices_yoy` (M003288 × invoer), `producer_price_index_level`
  (M003367 × totaal; explicit index-level asks). Grains MM+JJ (fixture-measured).
- **Cadence:** monthly, at latest the 30th day after the measured month (June figure lands ≤30 July 2026).
- **Reference values (frozen into CC8–CC10 in the s49 overnight prep; v3+v4 cross-checked 2026-07-17; re-pointed
  from explicit to canonical intents in session 50, values unchanged):** totaal 2026MM05 jaarmutatie **7.2**
  (index 128.7, Voorlopig); totaal 2023MM06 jaarmutatie **−5.9** (Definitief); invoer 2026MM05 jaarmutatie
  **9.3** (Voorlopig).

## Catalog quirks encountered (adds to docs/07's list)

1. **The sprint brief's measure identifiers were v3 column names** (`Consumentenvertrouwen_1`); the v4 codes the
   pipeline actually stores are `M001093`-style. Always re-validate identifiers against v4 `MeasureCodes` before
   writing registry rows — the kickoff's "hervalideer live vóór registry-rijen" rule caught this.
2. **`odata4.cbs.nl` is NOT the v4 host this repo uses** (`datasets.cbs.nl/odata/v1/CBS`, `src/cbs-adapter/odata-v4.ts:22`)
   — and it drops connections from some networks while `datasets.cbs.nl` works. Validate against the host the
   adapter really calls.
3. The known local IPv6 black-hole applies to fixture capture too — prefix with
   `node --import ./scripts/force-ipv4.mjs` (RUNBOOK standing rule).

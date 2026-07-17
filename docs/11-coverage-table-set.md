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
| 4 | Retail turnover (omzet detailhandel) | `85828NED` | Handel en diensten; omzet- en productieontwikkeling, index 2021=100 | both | Regulier | v4 slice: SBI 47 + its 7 subgroups, all grains = 46,442 obs (7 slice-empty Productie-measures excluded per #167) | CC11–CC13 |
| 5 | Household consumption | `85937NED` | Consumptieve bestedingen door huishoudens; nationale rekeningen, 2021=100 | both | Regulier | v4: 34,048 obs — full ingest | CC14–CC17 |
| 6 | Goods trade (in-/uitvoer) | `85429NED` | Internationale goederenhandel; grensoverschrijding, kerncijfers | both | Regulier | v4 slice: Landen-totaal × SITC-totaal = 1,132 obs | CC18–CC21 |
| 7 | House prices by region | `85792NED` | Bestaande koopwoningen; verkoopprijzen, prijsindex 2020=100, regio | both | Regulier | v4: 26,208 obs — full ingest (21 regions; RegioS is a PLAIN dimension) | CC22–CC24 |
| 8 | Monthly unemployment | `80590ned` | Arbeidsdeelname en werkloosheid per maand | both (v4 = LOWERCASE id) | Regulier | v4 slice: totaal × 15-75 jaar = 5,586 obs | CC25–CC28 |
| 9 | Home sale prices per gemeente | `83625NED` | Bestaande koopwoningen; gemiddelde verkoopprijzen, regio | both | Regulier | v4: 23,095 obs — full ingest (745 regions, REAL GeoDimension) | CC29–CC31 |

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

### `85828NED` — omzet detailhandel (sprint #4; measured + built session 53, 2026-07-17)

- **Shape:** two dimensions — `BedrijfstakkenBranchesSBI2008` (Dimension, 109 codes) × `Perioden` (TimeDimension,
  448: 317 MM `2000MM01`–`2026MM05` + 105 KW + 26 JJ, mixed). 21 measures in 3 families (Waarde / Volume /
  Productie, each with index + mutation variants). Table-wide 196,301 obs; **registered slice = the retail branch
  371600 ("47 Detailhandel (niet in auto's)") + its exactly 7 direct subgroups** (371700/372200/374000/374600/
  377400/378400/382500 = SBI 471/472/474/475/476/477/479 — **SBI 473 en 478 bestaan NIET in deze tabel**, the code
  sequence measurably skips them; coverage-gap note) → **46,442 obs**, full codes as exact-match prefixes, ALL
  grains kept. The FIXTURE keeps 2020+ only (12,096 obs, capture-only floor).
- **#167-probe result (the reason the probe step exists): the 7 "Productie"-family measures are SLICE-EMPTY** —
  they exist table-wide (industry branches) but carry ZERO rows for any retail branch → the same quarantine
  mechanism as table-wide phantoms, so they are curated into the seed's `excludeMeasures` (per-code documented in
  `src/ingestion/registry-seed.ts`). First slice-empty (vs phantom) use of the mechanism.
- **Headline:** `A042501_2` "Waarde / Ontwikkeling t.o.v. jaar eerder / Ongecorrigeerd" (%; = v3 'Ongecorrigeerd_4'
  — the suffix-mismatch proof case); index level `A042501_1` (unit verbatim **"2021 = 100" with spaces**). The YoY
  measure starts 12 months after the index (305 vs 317 MM rows for 371600 — no base month in year one).
- **Statuses:** only the six 2026-periods are Voorlopig (2026MM01–MM05 + 2026KW01); everything else Definitief.
- **Cadence:** monthly, first working day of the second month after the measured month (June lands Mon 3 Aug).
- **Reference values (frozen into CC11–CC13; v3+v4 cross-checked + fixture-verified 2026-07-17):** 371600 2026MM05
  omzet-YoY **1.8** (Voorlopig); 371700 (supermarkten) 2026MM05 **−0.6** (Voorlopig); 371600 2025JJ00 index
  **118.7** (Definitief). Extra measured, not frozen: 371600 2023MM06 = 7.0, 2020MM04 = −2.9.
- **Canonical measures (registry, session-54 vocab batch, 2026-07-18):** `retail_turnover_yoy` (A042501_2 ×
  371600; canonical default for 'omzet detailhandel') and `supermarket_turnover_yoy` (× 371700). CC11/CC12
  re-pointed at them; CC13 (index level) stays explicit — the index is an alternate, not a key.

### `85937NED` — consumptie huishoudens (sprint #5; measured + built session 53, 2026-07-17)

- **Shape:** two dimensions — `ConsumptieveBestedingen` (14 codes) × `Perioden` (448: 317 MM + 105 KW + 26 JJ,
  identical grid to 85828NED). 6 measures; **34,048 obs, full ingest** (small). The FIXTURE keeps 2020+ only
  (8,208 obs).
- **Load-bearing sparsity:** `M005269` "Volumemutaties, koopdaggecorrigeerd" (the headline measure) exists for
  **exactly 6 of the 14 categories** (A047812/A047813/A047825/A047837/A047875/A048214, 448 obs each) and ZERO for
  the other 8 — sparse-but-present, so NO #167 exclusion needed (row_plausibility is per-measure ≥1 row). The
  plain `M000282` volumemutaties is dense across all 14. Index level = `M001288_1` (2021=100).
- **Statuses — corrects the overnight specs doc:** 91 Voorlopig periods span **2021**JJ00/KW01/MM01 → 2026MM05
  (the specs said 2022→; CBS's own prose says 2022-2025 — the machine-readable Status field is broader than both;
  derive from PeriodenCodes, never prose).
- **Defaults:** `ConsumptieveBestedingen: 'A047812'` (binnenlandse consumptie totaal — the 86141NED
  headline-category pattern).
- **Cadence:** monthly, ~six to seven weeks after the measured month.
- **Reference values (frozen into CC14–CC17; v3+v4 cross-checked + fixture-verified 2026-07-17):** A047812 2025MM12
  koopdaggecorrigeerd **0.8** (index M001288_1 = 111.7, both Voorlopig); A047825 2025KW04 **1.6** (Voorlopig);
  A047812 2026MM05 **1.8** (Voorlopig); A047812 2020MM04 **−17.4** (Definitief, covid-depth at the fixture floor).

### `85429NED` — internationale goederenhandel (sprint #6; measured + built session 53, 2026-07-17)

- **Shape:** three dimensions — `Landen` (254) × `SITC` (11) × `Perioden` (148: 136 MM `2015MM01`–`2026MM04` +
  12 JJ). 8 measures (invoer/uitvoer/doorvoer in+uit/wederuitvoer/uitvoer-NL waardes in mln euro + 2 jaarmutaties
  in %). Table-wide 1,877,320 obs; **registered slice = totals only** (`Landen: 'T001047'` × `SITC: 'T001082'`)
  → **1,132 obs**. Fixture = the whole slice, NO floor (depth CCs pin 2015).
- **Twee gemeten vallen (beide in period semantics / registry):** (1) **`2026JJ00` = "2026 januari-april"** — the
  current-year JJ code is a PARTIAL-year cumulative, Voorlopig; never present it as a full-year figure (principle
  c; the period label carries the months). (2) **Jaarmutaties (`M001608`/`M001609`) have ZERO rows for all of 2015
  (no base year) and all of 2021 (methodebreuk 2020/2021)** — absent rows (13/year missing per measure: 12 MM +
  JJ), while 2016/2020/2022 are complete; level measures are complete everywhere. Suppression = absent rows:
  all 1,132 slice obs have ValueAttribute 'None' (exhaustively verified).
- **Statuses:** all of 2024 NaderVoorlopig; all of 2025 + 2026 (MM01–MM04 + JJ00) Voorlopig; earlier Definitief.
- **Cadence:** monthly, ~two months after the measured month.
- **Reference values (frozen into CC18–CC21; v3+v4 cross-checked + fixture-verified 2026-07-17):** 2026MM04 invoer
  **70.810 mln** (Voorlopig), jaarmutatie invoer **10.8** (Voorlopig); 2015MM01 invoer **36.083 mln** (Definitief,
  series-start depth); **CC21 = refusal**: uitvoer-jaarmutatie 2021JJ00 → `no_data` (the period IS published with
  levels — 2021JJ00 uitvoer = 714.212 mln measured — but the mutation row is deliberately absent; value-free
  refusal, never a self-computed change across the break).

### `85792NED` — huizenprijzen per regio (sprint #7; measured + built session 53, 2026-07-17)

- **Shape:** two dimensions — **`RegioS` with Kind="Dimension", NOT GeoDimension** (measured verbatim; the geo
  path — region resolution, regional chips — does NOT apply; RegioS is handled as a plain dimension with
  `default_coordinates: { RegioS: 'NL01' }`) × `Perioden` (156: 125 KW `1995KW01`–`2026KW01` + 31 JJ). Exactly
  **21 region codes**: NL01 + 4 landsdelen + 12 provincies + GM0363/GM0518/GM0599/GM0344 (Zuid-Holland = PV28).
  **Geen volle-gemeente-dekking** (the s48 finding stands — that's table #9's job). 8 measures in 3 groups:
  prijsindex (M001505_2, 2020=100 + mutaties M005104/M005355), verkochte woningen (M001532_2 aantal + mutaties
  M005157/M005284), gemiddelde verkoopprijs M001534 (euro) + totale waarde M001535 (mln euro).
- **Full ingest** (26,208 obs, dense 21×156×8, zero phantom/slice-empty); FIXTURE keeps 2020+ (5,208 obs).
- **Statuses: ALL 156 periods Definitief** — CBS publishes this table "direct definitief" (no revision cycle;
  the table description says so). Q2 2026 had not landed at build (latest 2026KW01); expected ~22/7.
- **Reference values (frozen into CC22–CC24; v3+v4 cross-checked + fixture-verified 2026-07-17):** NL01 2026KW01
  prijsindex **153.6**; Amsterdam 2025KW04 gemiddelde prijs **635.605**; Zuid-Holland (PV28) 2020JJ00 verkochte
  woningen **47.764**. Extra measured, not frozen: NL01 2025JJ00 gemiddelde prijs 479.527 (= table #9's NL01 cell,
  a nice cross-table consistency datum); NL01 2026KW01 index-jaarmutatie 5.2.

### `80590ned` — werkloosheid per maand (sprint #8; measured + built session 53, 2026-07-17)

- **⚠ LOWERCASE id on v4** (`80590ned`; uppercase 404s — docs/07 quirk #1, measured both ways; v3 accepts both
  casings). Three dimensions — `Geslacht` (3) × `Leeftijd` (4) × `Perioden` (399: 282 MM `2003MM01`–`2026MM06` +
  94 KW + 23 JJ). 14 measures = 7 pairs wel/niet-seizoengecorrigeerd; table-wide 67,032 obs, fully dense.
  **Registered slice = totaal × 15-75 jaar** (`Geslacht: 'T001038'` × `Leeftijd: '52052'`) → **5,586 obs**;
  fixture = the whole slice, NO floor (depth CC pins 2014). The mannen/vrouwen/leeftijds-uitsplitsingen are
  deliberately outside the v1 slice (the specs' own slice choice; widen later if the owner wants sex/age asks).
- **JJ-gap mechanism (refines the specs doc):** seasonally-adjusted measures DO have rows on JJ periods — with
  **`Value=null` + `ValueAttribute='Impossible'`** (seasonal adjustment doesn't exist on year basis), NOT absent
  rows. The pipeline serves that null honestly with its reason (R11) — pinned by CC28. The unadjusted twins carry
  real JJ year-averages (CC26 pins the asymmetry's other side).
- **Statuses: ALL 399 periods Definitief** (June + Q2 2026 added 2026-07-16, previous provisionals finalized).
- **Headline:** `M004210` "Werkloosheidspercentage / Seizoengecorrigeerd" (= v3 'Seizoengecorrigeerd_8');
  unadjusted twin `M001906_2`. **The quarterly `85224NED` keeps the canonical default for "werkloosheid"** —
  this table's own distinct terms ('maandwerkloosheid' etc.) come with the staged vocab batch (#165 discipline).
- **Cadence:** monthly, mid-month covering the previous month (June figures landed 16 July).
- **Reference values (frozen into CC25–CC28; v3+v4 cross-checked + fixture-verified 2026-07-17):** totaal 15-75
  2026MM06 seizoengecorrigeerd **3.8**; 2025JJ00 niet-gecorrigeerd **3.9**; 2014MM02 **8.7** (depth); **CC28 =
  null-cell**: 2025JJ00 seizoengecorrigeerd → value NULL + 'Impossible' (Definitief). Measured out-of-slice, not
  frozen: mannen 2026MM06 = 3.8. v3 padding widths for the record: Geslacht 7 chars, Leeftijd 8 chars.

### `83625NED` — gemiddelde verkoopprijzen per gemeente (sprint #9; measured + built session 53, 2026-07-17)

- **Shape:** two dimensions — **`RegioS` with Kind="GeoDimension"** (correctly typed here, unlike 85792NED — the
  geo path applies: regions travel through the intent's `regions` field) with **745 codes = 728 GM (incl.
  opgeheven gemeenten) + 12 PV + 4 LD + NL01** × `Perioden` (**31 JJ only**, `1995JJ00`–`2025JJ00`, ALL
  Definitief; 2025 added 2026-02-17, revisions "alleen bij uitzondering"). **One measure:** `M001534` gemiddelde
  verkoopprijs (euro). This is the per-gemeente local-angle engine for #160(b).
- **Density nuance (measured):** row-count dense (23,095 = 745×31 — every region×period has a ROW), but opgeheven
  gemeenten carry **`Value=null` + `ValueAttribute='Impossible'`** for years after their dissolution (probed:
  GM0738 Aalburg, null 2019+) — honest nulls through the standard R11 path, not gaps.
- **Full ingest** (23,095 obs); FIXTURE keeps 2015+ (8,195 obs; the depth CC pins 2015JJ00).
- **Reference values (frozen into CC29–CC31; v3+v4 cross-checked + fixture-verified 2026-07-17):** NL01 2025JJ00
  **479.527**; Amsterdam (GM0363) 2025JJ00 **630.621**; Amsterdam 2015JJ00 **303.925** (depth). Extra measured,
  not frozen: NL01/GM0363 1995JJ00 = 93.750/98.008 (series start, below the fixture floor — live-only).
- **Canonical measure (registry, session-54 vocab batch):** `average_home_sale_price_by_gemeente` (M001534, a
  REGIONAL_KEYS entry — regions via the intent's regions field). The bare "huizenprijs" stays with 85773NED
  (measured pin cs-kale-huizenprijs-blijft-85773); CC29-CC31 re-pointed at the key with regions.

## Session-54 vocab batch (2026-07-18) — tables #4-#9 vocabulary + ONE #164 re-record

Ten canonical keys added in one batch (`src/registry/defaults.ts` is the code record; the staged brief
[session-briefs/2026-07-17-coverage-4-9-vocab-batch-staged.md](session-briefs/2026-07-17-coverage-4-9-vocab-batch-staged.md)
was the design doc, executed with deviations noted there): `retail_turnover_yoy`, `supermarket_turnover_yoy`
(#4), `household_consumption_growth` (#5), `goods_imports_value`/`goods_exports_value`/`goods_imports_yoy`/
`goods_exports_yoy` (#6), `house_price_index_regional` (#7), `monthly_unemployment_seasonally_adjusted` (#8),
`average_home_sale_price_by_gemeente` (#9, REGIONAL). Batch outcome, all MEASURED:

- **Prompt v6** (two recorded changes): the deferred ADR-023 bare-"tot" wording fix, and the GRAIN-SIBLING
  tie-break rule — scoped to explicitly NAMED key pairs only (the first generic wording broke benchmark case B2
  4/4: generic period-words in a topic rule bleed into every question; prompt.ts carries the warning).
- **Final gate: intent 72/72 ×3 with ZERO flips** (correct-pick confidence min 0.92 / median 0.95), followup
  22/22, clarify 7/7, tablefinder 11/11 live + 11/11 hermetic replay.
- **Three reasoned relabels** (never green-making; each with measured rationale in the labelled sets):
  `dr-kw-only-kwartaalgrenzen` KW→MM (month-precise boundaries take the monthly series now it exists); `r-autos`
  stays clarification (bistable, original policy choice, matches the committed fixture); `f-v29-age-breakdown`
  clarification→refusal (stable majority after the vocab shifted the balance; WP26-adjacent conservatism).
  Plus the finder's `werkloosheid` case → 80590ned (production-moot: both tables curated, #166 screen).
- **[#172](open-questions.md) opened:** the bijstand-stock chain regression (upstream Haiku drift, detected on a
  byte-identical prompt) + the measured-and-reverted Sonnet escalation attempt (muddy confidence distribution vs
  the Haiku-calibrated 0.8 floor; params fix documented in `src/catalog/rerank.ts`).

## Catalog quirks encountered (adds to docs/07's list)

1. **The sprint brief's measure identifiers were v3 column names** (`Consumentenvertrouwen_1`); the v4 codes the
   pipeline actually stores are `M001093`-style. Always re-validate identifiers against v4 `MeasureCodes` before
   writing registry rows — the kickoff's "hervalideer live vóór registry-rijen" rule caught this.
2. **`odata4.cbs.nl` is NOT the v4 host this repo uses** (`datasets.cbs.nl/odata/v1/CBS`, `src/cbs-adapter/odata-v4.ts:22`)
   — and it drops connections from some networks while `datasets.cbs.nl` works. Validate against the host the
   adapter really calls.
3. The known local IPv6 black-hole applies to fixture capture too — prefix with
   `node --import ./scripts/force-ipv4.mjs` (RUNBOOK standing rule).
4. **Slice-empty ≠ phantom, same cure (session 53, `85828NED`):** a measure can exist table-wide but carry ZERO
   rows within the registered slice (the 7 Productie-measures exist only for industry branches, never retail) —
   `row_plausibility` quarantines exactly like a #167 phantom, and the same curated `excludeMeasures` fixes it.
   Consequence for the probe step: **probe per measure WITHIN the registered slice**, then table-wide only to
   classify the zero-row finds (phantom vs slice-empty).
5. **v3 fixed-width padding widths vary per dimension and per table** (measured session 53): 85792NED RegioS is
   6 wide ('NL01  '), 80590ned Geslacht is 7 ('3000   ') and Leeftijd 8 ('52052   '), while 85937NED and
   85429NED codes need NO padding at all. Determine empirically from a raw TypedDataSet row; never assume.
6. **v3 is casing-INSENSITIVE for table ids** (`80590ned` and `80590NED` both work on opendata.cbs.nl) while
   **v4 is casing-SENSITIVE** (uppercase 404s) — quirk #1's lowercase rule is a v4-only constraint.

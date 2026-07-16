# Coverage tables #2–#9 — measured build specs (autonomous overnight validation, 2026-07-17)

**Method:** 8 cheap-tier agents, every claim measured LIVE against BOTH CBS hosts (v4 `datasets.cbs.nl` — the
adapter's host — and v3 `opendata.cbs.nl`) on 2026-07-17; every frozen-key candidate cell cross-read on both
platforms (all matches exact). This doc supersedes the identifier/platform claims in the
[sprint brief](2026-07-17-coverage-sprint-brief.md) where they conflict — the brief quoted v3 COLUMN names
and one wrong platform verdict. All four open verification points (a)–(d) are RESOLVED below.

## Headline conclusions

1. **Zero adapter changes needed for tables #3-#9** — mixed-grain Perioden are already first-class
   (`period_grain` per row, like 85773NED/82242NED since Phase 0) and "pick these N codes" slices work via
   `dimensionPrefixes` with FULL codes (startswith == equality when no code extends another).
   **⚠ Table #2 (85880NED) is the ONE exception — REFUTED by the hermetic validator during the overnight
   prep:** the lean 2-flavor slice leaves 26 of the 210 registered measures with ZERO fetched rows (they
   exist only under the other SoortMutaties flavors) → `row_plausibility` correctly quarantines.
   **Session-50/owner decision needed, options measured:** (a) FULL ingest, no slice — ~99,676 obs in prod
   (smaller than the loaded CPI table) but an ~18MB committed fixture (the sliced capture was already
   6.4MB; note the CPI fixture avoids this via a capture-time slice, a pattern that does NOT help here
   because the INGEST slice itself is the problem); (b) a small `CbsSlice` measure-allowlist extension
   (v4 accepts `Measure eq` in `$filter`, verified live) + registration/units filtered to the allowlist —
   the lean 36,820-obs path the brief intended; (c) descope the detail measures question entirely and
   revisit. Table #2 was DESCOPED from the overnight prep-PR; CC5-CC7 reserved.
2. **`80590NED` is NOT v3-only — the v4 host serves it under the LOWERCASE identifier `80590ned`**
   (uppercase 404s; docs/07 catalog quirk #1, which the session-48 scout didn't apply). The ADR-003 v3 path
   is NOT needed for the sprint. Seed id must be `80590ned`.
3. **v3→v4 suffix numbering is NOT parallel** (measured proof: 85828NED's v3 `Ongecorrigeerd_4` = v4
   `A042501_2`, while `A042501_4` is a DIFFERENT measure). Never map by suffix or by title (85880NED has
   FOUR measures titled "Bruto binnenlands product"); only the per-table mappings below are trustworthy.
4. **`2026JJ00` can be a PARTIAL-year YTD code** (85429NED: title "2026 januari-april"). Period semantics
   for that table must say so; never present a current-year JJ00 as a full-year figure (principle c).

## Per-table specs (build order; all values measured 2026-07-17)

### #2 `85880NED` — BBP flash (release ~30/7, flash = 30 days after quarter-end)
- v4 ✓ Regulier; 99,676 obs; dims: SoortMutaties (Dimension, 5 codes) × Perioden (TimeDimension, 156 codes:
  125 KW + 31 JJ; 10 recent periods Voorlopig incl. 2026KW01). 210 measures (99 top-level + 111 detail).
- **Slice: ⚠ UNRESOLVED — the 2-flavor slice (`dimensionPrefixes: { SoortMutaties: ['A045299','A045300'] }`,
  36,820 obs) was REFUTED by the hermetic validator during the overnight prep** (26 of the 210 registered
  measures have zero rows under those flavors → `row_plausibility` quarantines, correctly). Owner/session-50
  decision between the measured options in headline conclusion 1: full ingest (~99,676 obs, ~18MB fixture) vs
  a small `CbsSlice` measure-allowlist extension (v4 accepts `Measure eq` in `$filter`, verified live) vs
  descope. CC5-CC7 reserved for this table.
- Headline measure: **`M002782_1`** "Bruto binnenlands product" (%; the title exists on 4 codes — pin by CODE).
- Canonical key sketch: `gdp_growth_yoy_volume` (M002782_1, dims {SoortMutaties: 'A045299'}, terms
  'economische groei', 'bbp', 'bruto binnenlands product'; alternate dims A045300 'kwartaal-op-kwartaal').
- Frozen-key candidates (v4=v3 exact): 2026KW01 YoY volume = **1.4**; 2023KW04 YoY = **−1.1**; 2026KW01 QoQ
  (A045300) = **0.2**.
- Supersession (open point c, RESOLVED): 84106NED (Gediscontinueerd, "Stopgezet") and 85880NED point at each
  other in their own prose — mutual, confirmed.

### #3 `85770NED` — PPI (release ≤30/7: "uiterlijk de 30e dag volgend op de verslagmaand")
- v4 ✓ Regulier; dims: Afzetgebieden (5) × AlleProdComCoderingen (525!) × Perioden (109: 101 MM + 8 JJ;
  last 5 months Voorlopig). 3 measures: `M003367` PPI-index (2021=100), `M003316` maandmutatie,
  **`M003288` jaarmutatie (headline; v3 'JaarmutatiePPI_3')**.
- **Open point (a) RESOLVED: ProdCom-totaalcode = `A052584`** "B-E Nijverheid (geen bouw) en energie"
  (hierarchy root).
- Slice: `dimensionEquals: { AlleProdComCoderingen: 'A052584' }` + `dimensionPrefixes: { Afzetgebieden:
  ['A044074', 'A044077'] }` (totaal afzet + invoer) → measured **654 obs, 100% dense**.
- Frozen-key candidates (v4=v3 exact): totaal 2026MM05 jaarmutatie = **7.2** (index 128.7); totaal 2023MM06
  jaarmutatie = **−5.9**; invoer 2026MM05 jaarmutatie = **9.3**.
- R11 note: observation ValueAttribute is uniformly 'None' — provisional status lives ONLY on Perioden
  Status (standard for our pipeline).

### #4 `85828NED` — omzet detailhandel (release ma 3/8, "eerste werkdag van de tweede maand na verslagmaand")
- v4 ✓ Regulier; merged 9-in-1; dims: BedrijfstakkenBranchesSBI2008 (109) × Perioden (448: 317 MM + 105 KW +
  26 JJ, mixed; 2026-periods Voorlopig). 21 measures.
- Branch 371600 = "47 Detailhandel (niet in auto's)"; direct subgroups = exactly 7 codes (471/472/474/475/
  476/477/479 — SBI 473 en 478 bestaan NIET in deze tabel; noteer als dekkingsgat in registry-notes).
- **Slice: `dimensionPrefixes: { BedrijfstakkenBranchesSBI2008: ['371600','371700','372200','374000',
  '374600','377400','378400','382500'] }`, ALL grains kept** (mixed grain is pipeline-native; the brief's
  "monthly only" was a size concern: 46,442 vs 32,904 obs — not worth new adapter capability). Period
  semantics documents MM/KW/JJ per grain.
- Headline: **`A042501_2`** "Ongecorrigeerd" onder Waarde→"Ontwikkeling t.o.v. een jaar eerder" (%; = v3
  'Ongecorrigeerd_4' — the suffix-mismatch proof case).
- Frozen-key candidates (v4=v3 exact): 371600 2026MM05 omzet-YoY = **1.8**; 371700 (supermarkten) 2026MM05 =
  **−0.6**; 371600 2025JJ00 omzet-index (A042501_1) = **118.7**.

### #5 `85937NED` — consumptie huishoudens (release ~6/8: "zes tot zeven weken na afloop verslagmaand")
- **Open point (b) RESOLVED: v4 ✓ LIVE** (not v3-only). Regulier; 34,048 obs; dims: ConsumptieveBestedingen
  (14 codes) × Perioden (448, MIXED 317 MM + 105 KW + 26 JJ — **corrects the brief's "monthly keys only"**;
  91 periods Voorlopig: 2022→2026MM05, MORE than CBS's own prose claims — derive status from PeriodenCodes,
  never from the prose). 6 measures.
- Headline total code **`A047812`** "Binnenlandse consumptie huishoudens"; headline measure **`M005269`**
  "Volumemutaties, koopdaggecorrigeerd" (= v3 'VolumemutatiesKoopdaggecorrigeerd_3').
- **Load-bearing: M005269 exists for only 6/14 categories** (A047812/A047813/A047825/A047837/A047875/A048214;
  absent for the 8 others). Slice options: full ingest (34,048 obs, small) with vocabulary only on A047812;
  registry notes document the 6/14 gap; fallback measure for categories = `M000282` (plain volumemutaties,
  fully dense).
- Frozen-key candidates (v4=v3 exact, all 6 measures): A047812 2025MM12 → koopdaggecorrigeerd **0.8**
  (index 111.7); A047825 2025KW04 → **1.6**; A047812 2026MM05 → **1.8**.

### #6 `85429NED` — internationale goederenhandel (release ~2 maanden na verslagmaand; geen vaste datum in
metadata — de "11/8" uit de brief is een eigen aanname, geen CBS-feit)
- v4 ✓; 1,877,320 obs table-wide; dims: Landen (254) × SITC (11) × Perioden (148: 136 MM + 12 JJ).
- Slice: `dimensionEquals: { Landen: 'T001047', SITC: 'T001082' }` → measured **1,132 obs** (dense behalve de
  gedocumenteerde gaten). Headline measures: `D001607` totale invoerwaarde, `D001636` totale uitvoerwaarde
  (mln euro), `M001608`/`M001609` jaarmutaties (%).
- **Twee vallen:** (1) **`2026JJ00` = "2026 januari-april"** — partial-year YTD, GEEN vol jaar; period
  semantics moet dit expliciet zeggen. (2) Jaarmutaties ontbreken VOLLEDIG voor 2015 (geen basis) én 2021
  (methodebreuk 2020/2021 — CBS publiceert bewust geen YoY over de breuk; registry-note per R11/#26).
  Suppressie = AFWEZIGE rijen, nooit null-met-attribuut (exhaustief geverifieerd: 0 van 1.877.320 obs heeft
  een ValueAttribute ≠ 'None').
- Frozen-key candidates (v4=v3 exact): 2026MM04 invoer = **70.810**, uitvoer = **77.531**, jaarmutatie
  invoer = **10.8**; 2021JJ00 uitvoer = **714.212**; 2015MM01 invoer = **36.083**.

### #7 `85792NED` — huizenprijzen regio (⚠ release ~22 dagen na kwartaal-einde → Q2 landt ~22/7, NIET 11/8
zoals de brief zegt — de kalenderregel "per gemeente 11/8" hoort vermoedelijk bij een ANDERE publicatie;
check de CBS-kalender die week)
- **Open point (b) RESOLVED: v4 ✓ LIVE.** Regulier; 26,208 obs (dense 21×156×8); dims: RegioS × Perioden
  (156: 125 KW + 31 JJ). **⚠ RegioS heeft Kind="Dimension", NIET "GeoDimension"** — het geo-pad van de
  pipeline (region resolution, regional chips) keyt op GeoDimension; v1-aanpak: RegioS als gewone dimensie
  met `default_coordinates: { RegioS: 'NL01' }` en de 4 steden/12 provincies via expliciete dims of eigen
  canonieke sleutels — ontwerpnotitie voor de bouwsessie.
- Regio's: exact 21 codes (NL01, 4×LD, 12×PV, GM0363/GM0518/GM0599/GM0344). **Bevestigd: géén
  volle-gemeente-dekking** (s48-bevinding blijft staan).
- 8 measures gemapt (o.a. `M001505_2` prijsindex 2020=100, `M001534` gemiddelde verkoopprijs, `M005355`
  index-jaarmutatie). Frozen-keys (v4=v3 exact): NL01 2026KW01 prijsindex = **153.6**; Amsterdam 2025KW04
  gemiddelde prijs = **635.605**; Zuid-Holland 2020JJ00 verkochte woningen = **47.764**.

### #8 `80590ned` — werkloosheid per maand (maandelijkse aanvulling; laatste update 16/7 met juni + Q2)
- **NIET v3-only: v4 werkt met LOWERCASE id `80590ned`** (uppercase 404t — docs/07 quirk #1; de brief en
  ADR-003-framing zijn hierop gecorrigeerd). Normale v4-adapterroute; seed id lowercase, exact zoals
  `03759ned`.
- Regulier; 67,032 obs (dense 3×4×399×14); dims: Geslacht (3) × Leeftijd (4) × Perioden (399: 282 MM +
  94 KW + 23 JJ — mixed; ALLE periodes momenteel Definitief). 14 measures (7 paren wel/niet
  seizoengecorrigeerd).
- **Headline: `M004210`** werkloosheidspercentage seizoengecorrigeerd (= v3 'Seizoengecorrigeerd_8'; CBS's
  eigen DefaultSelection). Slice: `dimensionEquals: { Geslacht: 'T001038', Leeftijd: '52052' }` (totaal ×
  15-75). Grain-note: seizoengecorrigeerde maten zijn per CBS-definitie LEEG op JJ-periodes (binnen één
  jaar geen seizoenscorrectie) — v4 laat die rijen weg; `AVAILABLE_GRAINS` voor de canonieke sleutel = MM
  (+KW meten bij de bouw).
- Frozen-keys (v4=v3 exact): totaal 15-75 2026MM06 seizoengecorrigeerd = **3.8**; 2025JJ00
  niet-gecorrigeerd (M001906_2) = **3.9**; mannen 2026MM06 = **3.8**.
- Relatie met geladen 85224NED (kwartaal, werkloosheid): het bestaande canonical-default ("werkloosheid" →
  85224NED KW) blijft; deze maandtabel krijgt eigen termen ('maandwerkloosheid', 'werkloosheid per maand')
  — vocab-overlap bewust vermijden, zelfde les als #165.

### #9 `83625NED` — gemiddelde verkoopprijzen per gemeente (open point d, RESOLVED: FIT als tabel #9)
- v4 ✓ Regulier; 23,095 obs (dense 745×31); dims: **RegioS Kind=GeoDimension** (wél correct getypeerd hier)
  met 728 GM-codes (incl. opgeheven gemeenten — registry-note) × Perioden (31 JJ, ALLE Definitief; jaarlijks,
  revisies "alleen bij uitzondering"). Eén measure: `M001534` gemiddelde verkoopprijs (euro).
- Geen slice nodig (klein). Dit is de lokale-hoek-motor voor #160(b): per-gemeente kaarten op de
  huizenprijs-release.
- Frozen-keys (v4=v3 exact): NL01 2025JJ00 = **479.527**; Amsterdam (GM0363) 2025JJ00 = **630.621**.

## Sprint-brede consequenties

- **Batching (#164):** tabellen #2+#3 (beide vóór 30/7) in één sessie met één vocab-wijziging + één
  heropname; #4–#9 kunnen daarna in één of twee batches (releases 3/8–20/8).
- **Elke tabel-sessie:** volg de RUNBOOK-procedure (tabel-#1-template); frozen-key waarden hierboven zijn
  kandidaten — HERMEET ze op de bouwdag vóór bevriezing (CBS kan tussentijds reviseren; de correctie-diff
  vangt dat, maar de key moet de bouwdag-waarheid pinnen).
- **v3-padding-quirk** (voor ooit-v3-werk): v3 filtert met fixed-width codes ('371600 ' mét spatie,
  'NL01  ') — gedocumenteerd hier zodat niemand het opnieuw ontdekt.

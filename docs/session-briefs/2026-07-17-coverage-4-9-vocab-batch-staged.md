# STAGED: de vocab-batch voor dekkingssprint-tabellen #4-#9 (één #164-heropname, owner-begeleid)

> **▶ UITGEVOERD sessie 54 (2026-07-18, owner-aanwezig)** — alle stappen gedraaid; afwijkingen van dit
> draaiboek, elk gemeten en vastgelegd in [11-coverage-table-set.md](../11-coverage-table-set.md) §
> "Session-54 vocab batch" + de labelled sets: prompt v6 (ADR-023-tot-fix + gescopete korrel-sibling-regel na
> een B2-regressie van de eerste generieke formulering), drie beredeneerde herlabels (dr-kw KW→MM, r-autos
> bistabiel-op-clarificatie, f-v29 → refusal), finder-werkloosheid → 80590ned (productie-moot, #166-gordel),
> en de bijstand-keten-regressie + gemeten-en-teruggedraaide Sonnet-escalatie als [#172](../open-questions.md).
> De 85792NED-named-region-ontwerpvraag bleef zoals hieronder beschreven open.

**Geschreven door sessie 53 (2026-07-17, autonome prep-branch `coverage-tables-4-9-prep`).** De zes tabellen
zijn BUILT DORMANT: seeds + registry-defaults + fixtures + CC11-CC31 staan op de branch en de hermetische gate
is groen — maar er is bewust NUL vocabulaire toegevoegd ([open-questions #168](../open-questions.md)). Reden:
elke wijziging aan `CANONICAL_MEASURES`/`AVAILABLE_GRAINS`/`REGIONAL_KEYS` verandert prompt-bytes en invalideert
alle ~93 LLM-fixtures (#164), en de heropname is live-LLM-spend — owner-begeleid per #118(b). Dit document is
het draaiboek voor die begeleide stap: alles hieronder is VOORSTEL (concept-sleutels, conceptteksten), de
gemeten feiten (grains, codes, gaten) zijn hard.

## Stappenplan (owner aanwezig)

1. Review + merge de prep-PR (branch `coverage-tables-4-9-prep`).
2. Voeg de canonieke sleutels hieronder toe aan `src/registry/defaults.ts` (+ `AVAILABLE_GRAINS` en
   `REGIONAL_KEYS` in `src/answer/intent/prompt.ts`) — in ÉÉN commit, alle zes tabellen tegelijk.
3. Voeg labelled cases toe voor de nieuwe termen (minimaal: één per canonieke sleutel + de twee
   botsingsgevallen hieronder) aan de intent-labelled-set.
4. ÉÉN heropname (Haiku-tier, sub-euro, owner-akkoord): leeg de vier `tests/fixtures/llm/`-dirs
   (de record-scripts ruimen stale hashes NIET op), dan `intent:record` / `followup:record` / `clarify:record` /
   `onboarding-delivery:record`, dan `intent:eval -- --repeat=3` (verwacht: nul flips).
4b. **Catalogus-fixture + tablefinder-heropname (s53-vondst, GEMETEN):** de prep-sessie draaide
   `--catalog-add` voor de zes ids en dat brak METEEN 4 van de 11 finder-replay-cases (huizenprijzen /
   werkloosheid / inwoners / woningvoorraad → failure-safe `disclose`): de nieuwe rijen verschuiven de
   Stage-1-shortlists in het gesamplede `_catalog.json`, de rerank-fixtures missen dan op hash. De merge is
   daarom TERUGGEDRAAID uit de prep-PR. In deze begeleide stap: draai
   `node --import ./scripts/force-ipv4.mjs scripts/capture-cbs-fixtures.ts --catalog-add 85828NED 85937NED
   85429NED 85792NED 80590ned 83625NED` opnieuw, gevolgd door `tablefinder:record` + eval — en KALIBREER de
   labelled set bewust: "huizenprijzen" hoort met drie koopwoning-tabellen in de catalogus nog steeds confident
   op 85773NED te landen (de curated sleutels vangen die vragen sowieso vóór de finder — de finder ziet alleen
   synonym-misses), en "werkloosheid" op 85224NED. NB: productie-routing is door de prep NIET veranderd — de
   live finder kijkt naar de volledige cbs_catalog-spiegel waar deze zes tabellen altijd al in stonden.
5. Her-punt de CC-intents in `tests/query/coverage-key.test.ts` van explicit → canonical (lijst hieronder;
   bevroren waarden blijven identiek — het s50-precedent voor CC8-CC10).
6. Vol verificatieblok + `/code-review` LOW + push; na groene CI de live stap (RUNBOOK stap 4-volgorde,
   #166-vondst 8: `registry:apply` pas NA geverifieerde deploy):
   `node --import ./scripts/force-ipv4.mjs --env-file=.env src/ingestion/cli.ts sync <id>` voor
   `85828NED 85937NED 85429NED 85792NED 80590ned 83625NED` (auto-registreert; geen van de zes had op 17/7 het
   trage-stream-probleem — de gefilterde captures liepen in minuten, de chunk-escape-hatch ligt klaar als een
   volle sync tóch hangt), dan `npm run registry:apply`, dan per tabel een LLM-vrije spot-check:
   `node --env-file=.env scripts/spot-check-canonical.ts <key> <periodCode>`.

## Voorgestelde canonieke sleutels (concept — gemeten grains/codes zijn hard, termen zijn owner-keuze)

### 85828NED (tabel #4)
- `retail_turnover_yoy` — measure `A042501_2` ("Waarde / Ontwikkeling t.o.v. jaar eerder / Ongecorrigeerd", %),
  dims `{ BedrijfstakkenBranchesSBI2008: '371600' }`. Termen: 'omzet detailhandel', 'detailhandelsomzet',
  'winkelomzet'. Grains `['JJ','KW','MM']` (gemeten: 25 JJ + 101 KW + 305 MM voor 371600). Alternates:
  indexniveau `A042501_1` ("2021 = 100", let op de spaties in de unit), kalendergecorrigeerd `A052581_2`.
- `supermarket_turnover_yoy` — zelfde maat, dims `{ ...: '371700' }` (SBI 471 supermarkten en warenhuizen).
  Termen: 'omzet supermarkten', 'supermarktomzet'. Grains idem.
- NB: de 7 overige branches (472/474/475/476/477/479) zitten in de slice en zijn via expliciete dims bereikbaar;
  eigen sleutels pas als er vraag naar blijkt.

### 85937NED (tabel #5)
- `household_consumption_growth` — measure `M005269` ("Volumemutaties, koopdaggecorrigeerd", %), dims
  `{ ConsumptieveBestedingen: 'A047812' }` (binnenlandse consumptie totaal — tevens de default-coördinaat).
  Termen: 'consumptie huishoudens', 'huishoudconsumptie', 'bestedingen huishoudens', 'consumptiegroei'.
  Grains `['JJ','KW','MM']`. Alternates: gewone volumemutatie `M000282` (wél dicht over alle 14 categorieën —
  M005269 bestaat maar voor 6 van de 14; zie docs/11), indexniveau `M001288_1`.

### 85429NED (tabel #6)
- `goods_imports_value` — `D001607` ("Totale invoerwaarde", mln euro), dims = de totalen-slice
  `{ Landen: 'T001047', SITC: 'T001082' }` (tevens defaults). Termen: 'invoerwaarde', 'goedereninvoer',
  'invoer van goederen'. Grains `['JJ','MM']`. ⚠ notes-veld MOET de twee vallen dragen: 2026JJ00 = "2026
  januari-april" (deel-jaar-cumulatief) en de jaarmutatie-gaten 2015/2021 (methodebreuk).
- `goods_exports_value` — `D001636`, zelfde dims. Termen: 'uitvoerwaarde', 'goederenuitvoer', 'uitvoer van
  goederen', 'export van goederen'.
- `goods_imports_yoy` / `goods_exports_yoy` — `M001608`/`M001609` (%, CBS's eigen jaarmutaties — R5: nooit zelf
  rekenen). Termen: 'jaarmutatie invoer' / 'jaarmutatie uitvoer'. Grains `['JJ','MM']` met de 2015/2021-gaten
  in notes.
- ⚠ Botsingswacht: 'invoerprijzen'/'importprijzen' blijven van `import_prices_yoy` (85770NED) — de termen
  hierboven gaan over WAARDE, niet prijs. Labelled case toevoegen: "Wat waren de invoerprijzen in mei?" mag NIET
  naar goods_imports_value routeren.

### 85792NED (tabel #7)
- `house_price_index_regional` — `M001505_2` ("Prijsindex verkoopprijzen", 2020=100), dims-default
  `{ RegioS: 'NL01' }` (RegioS is hier een GEWONE dimensie, géén GeoDimension — regionamen kunnen NIET via het
  geo-pad; zie ontwerppunt hieronder). Termen: 'prijsindex koopwoningen', 'huizenprijsindex', 'prijsindex
  bestaande koopwoningen'. Grains `['JJ','KW']`. Alternates: jaarmutatie `M005355`, verkochte woningen
  `M001532_2`, gemiddelde prijs `M001534`.
- ⚠ OPEN ONTWERPPUNT (uit de specs-doc, niet opgelost in de prep): stads-/provincie-vragen op deze tabel
  ("prijsindex in Utrecht") hebben geen route — regionresolutie keyt op GeoDimension en dit is er geen. Opties:
  per-regio sleutels (lelijk, ×21), een dims-resolutielaag voor named-region-op-gewone-dimensie (ontwerpwerk),
  of doorverwijzen naar #9 voor gemeente-vragen (alleen JJ + alleen gemiddelde prijs). Owner-keuze; tot die tijd
  antwoordt de sleutel landelijk met de transparante default (R7).

### 80590ned (tabel #8)
- `monthly_unemployment_seasonally_adjusted` — `M004210` ("Werkloosheidspercentage / Seizoengecorrigeerd", %),
  dims = de slice-totalen `{ Geslacht: 'T001038', Leeftijd: '52052' }` (tevens defaults). Termen:
  'maandwerkloosheid', 'werkloosheid per maand', 'maandelijkse werkloosheid'. Grains `['KW','MM']` — JJ bestaat
  als rijen maar altijd null+'Impossible' (CC28 pint dat; notes-veld vermeldt het). Alternate: ongecorrigeerd
  `M001906_2` (heeft wél echte JJ-jaargemiddelden).
- ⚠⚠ DE #165-REGEL: het kale woord **'werkloosheid' blijft van `unemployment_rate_seasonally_adjusted`
  (85224NED, kwartaal)** — deze sleutel krijgt uitsluitend maand-gekleurde termen. Labelled cases toevoegen:
  "Wat is de werkloosheid?" → 85224NED (ongewijzigd) én "Wat was de werkloosheid in juni?" → welke de
  kalibratie ook kiest, vastleggen (de maand-in-de-vraag-casus is precies de grensvraag die de eval moet
  beslissen — niet vooraf gokken).

### 83625NED (tabel #9)
- `average_home_sale_price_by_gemeente` — `M001534` ("Gemiddelde verkoopprijs", euro), dims `{}`, ECHT
  GeoDimension → **`REGIONAL_KEYS`-toevoeging** (regio's via het regions-veld, zoals population). Termen
  (concept, dé kalibratievraag van deze batch): 'huizenprijs per gemeente', 'verkoopprijs per gemeente',
  'gemiddelde verkoopprijs'. Grains `['JJ']`. Notes: opgeheven gemeenten = null+'Impossible' na opheffing;
  reeks vanaf 1995; revisies alleen bij uitzondering.
- ⚠ Botsingswacht: 'huizenprijs'/'koopwoningprijs' blijven van `average_existing_home_sale_price` (85773NED,
  landelijk maandelijks actueel). Labelled cases toevoegen: "Wat kostte een huis in Amsterdam in 2024?" →
  83625NED-sleutel + regio Amsterdam; "Wat is de gemiddelde huizenprijs nu?" → 85773NED (ongewijzigd).

## CC-herpunting bij stap 5 (waarden blijven bevroren)

| CC | van (explicit) | naar (canonical) |
|---|---|---|
| CC11 | 85828NED A042501_2 × 371600 | `retail_turnover_yoy` |
| CC12 | 85828NED A042501_2 × 371700 | `supermarket_turnover_yoy` |
| CC13 | indexniveau A042501_1 | blijft explicit (indexniveau is een alternate, geen sleutel) |
| CC14-CC17 | 85937NED M005269 | `household_consumption_growth` (CC15 houdt expliciete dims A047825 — niet de default-categorie) |
| CC18/CC20 | 85429NED D001607 | `goods_imports_value` |
| CC19 | 85429NED M001608 | `goods_imports_yoy` |
| CC21 (refusal) | 85429NED M001609 2021JJ00 | `goods_exports_yoy` (blijft `no_data`) |
| CC22 | 85792NED M001505_2 × NL01 | `house_price_index_regional` (default-dims) |
| CC23/CC24 | stad/provincie-cellen | blijven explicit (geen canonical route voor named regions op een gewone dimensie — zie ontwerppunt) |
| CC25/CC27/CC28 | 80590ned M004210 | `monthly_unemployment_seasonally_adjusted` |
| CC26 | ongecorrigeerd M001906_2 | blijft explicit (alternate) |
| CC29-CC31 | 83625NED M001534 + regions | `average_home_sale_price_by_gemeente` + regions |

## Waarom dit niet in de autonome sessie zat

#118(b): autonome sessies doen geen live-LLM-spend, geen prompt-byte-wijzigingen en geen live syncs; de
heropname raakt alle drie. Het s49-overnight → s50-precedent (tabel #3 prep zonder vocab → één batch met
owner) is bewust gevolgd, nu voor zes tabellen in één keer — precies waarvoor #164's batch-regel bestaat.

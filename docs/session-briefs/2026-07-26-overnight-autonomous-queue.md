# Overnight autonomous queue — na sessie 56 (WP26 compleet)

**Geschreven door sessie 56 op 2026-07-25, owner-aanwezig, op verzoek van de owner.**
Leesvolgorde: `CLAUDE.md` → `docs/STATUS.md` (▶-blok bovenaan is leidend) → dit bestand.
De chat van sessie 56 is straks weg; de repo is de bron.

---

## 0. De regels die deze sessie binden — lees ze eerst, ze zijn niet onderhandelbaar

Dit is een **autonome** sessie. De owner slaapt. Daarom:

1. **Branch + PR + owner-review vóór merge** voor alles wat core-product of geld-pad raakt
   (#118(b)). Push NIET naar `main`. De staande "push alles direct"-autorisatie geldt
   ALLEEN als de owner in de chat aanwezig is — dat is nu niet zo.
2. **Zero live-LLM productspend.** Geen `intent:eval`, geen `tablefinder:record`, geen
   `--live` benchmark, geen fixture-heropnames. Alles hermetisch.
3. **Zero prompt bytes.** `prompt.ts` / `schema.ts` / `parse.ts` blijven byte-identiek —
   anders invalideer je ~93 fixtures (#164) en dat kan alleen in een begeleid venster.
4. **Geen live DDL.** Geen migratie op productie. Een migratie mag als BESTAND landen
   (het #53/#154-patroon), maar wordt niet toegepast.
5. **Niet de WP26-vlaggen aanzetten.** `CLARIFY_CLICK_ENABLED` en `ANSWER_FIRST_ENABLED`
   blijven uit — de go-live is expliciet owner-begeleid (RUNBOOK-sectie "WP26 answer-first
   + clickable options").
6. **⚠ NIEUW, en het raakt jou direct: stapel geen deploys.** Zie [#173](../open-questions.md).
   De Supabase free tier heeft **15 sessie-verbindingen**; vijf snelle deploys op 25-07
   putten die uit en productie degradeerde ~6 minuten (`/llms.txt` 503, Ontdek-grafieken
   weggelaten). Werk op branches (die deployen niet naar productie), batch doc-commits, en
   draai GEEN `audit:verify` / `catalog:refresh` vanaf deze machine tijdens een deploy-venster.
   Kanarie: `curl -s -o /dev/null -w '%{http_code}' https://checkdecijfers.vercel.app/llms.txt`
   → 200.
7. **Verificatieblok vóór elke PR**: typecheck (root + web), volledige backend-suite, web-suite,
   benchmark (14/14 + 6/6 + 0 fabricated), echte `next build`, en `/code-review` LOW over de
   diff. `audit:verify` alleen als je de validator/compose/reconstruct-kant raakt — en dan
   buiten een deploy-venster (regel 6).
8. **Delegatie — LET OP, de owner heeft dit op 2026-07-25 aangescherpt.** De sessie draait op
   **Opus 5**; die orkestreert, scopet en velt het eindoordeel. Maar het **architectuurwerk en
   de echt complexe analyses gaan naar FABLE-agents** (`Agent`-tool met `model: "fable"`), niet
   naar het sessiemodel zelf en zeker niet naar een goedkope tier. Mechanisch legwork (greps,
   inventarisaties, eerste-pas-verificatie) blijft op Sonnet/Haiku.
   Dat is dus **drie** tiers met elk een rol:
   | Rol | Tier | Voorbeelden in deze wachtrij |
   |---|---|---|
   | Orkestratie, scoping, eindoordeel, merge-beslissing | sessiemodel (Opus 5) | de wachtrij afwerken, PR's schrijven, bevindingen wegen |
   | Architectuur + diepe/adversariële analyse | **Fable** (`model: "fable"`) | §3 architectuurmemo, item 3 (vertrouwensgrenzen), item 5 (#162-ontwerp) |
   | Mechanisch legwork, brede zoekacties, eerste-pas-verificatie | Sonnet / Haiku | item 4 (doc-sweep), greps, inventarisaties |

   De algemene regel "benoem tiers per ROL, hardcode geen modelnamen in herbruikbare prompts"
   blijft staan; deze tabel is een gedateerde owner-steer voor DEZE sessie, geen nieuwe
   permanente conventie. Rapporteer per stuk werk welke tier het draaide.
9. **Niets uit deze wachtrij is een owner-beslissing.** Kom je er één tegen (WP30c-keuze,
   #132-GO, prijsopties #101), dan NOTEER je hem en ga je door — je beslist niet namens hem.

---

## 1. Waar het project staat (geverifieerd 2026-07-25)

Productie is LIVE en verwerkt echt geld. **WP26 is compleet gebouwd en gepusht** — mechanisme A
(`8ee71c8`), B-region (`37a3c55`), B-period (`1a99b3d`), WP26c (`1a4ca89`) — alle CI-groen, alle
**dormant** achter twee onafhankelijke vlaggen. €0 LLM-spend. Wat rest is de begeleide go-live.

Niet voor deze sessie, maar wel om te weten: de ~30/7 BBP+PPI-syncs (`85880NED` MOET via de
chunked escape hatch, RUNBOOK stap 5) en de #132-route-B-GO zijn owner-begeleid.

---

## 2. De wachtrij — in volgorde, met stopconditie per item

Werk van boven naar beneden. **Per item: één branch, één PR, verificatieblok, dan door.**
Kom je vast te zitten, sla het item over en documenteer waarom — een half-afgemaakt item op
een branch is prima, een half-afgemaakte PR-beschrijving niet.

### Item 1 — [#173](../open-questions.md) optie (c): verklein de pool per instance  ⏱ klein, hoogste waarde · tier: sessiemodel zelf

Het incident van 25-07 in één regel: elke function-instance opent zijn eigen pg-pool, en samen
passen ze niet in de 15 sessie-slots van de free tier.

- Zoek waar de pg `Pool` wordt geconstrueerd (`src/db/client.ts`) en of `max` gezet is. Zo niet,
  is de node-pg-default **10 per instance** — één instance eet dan al twee derde van het plafond.
- Zet een expliciete, kleine `max` (voorstel: **2**) en onderbouw het getal in een comment met de
  meting uit #173. Serverless-instances handelen requests grotendeels serieel; een grote pool
  per instance koopt niets en kost het plafond.
- ⚠ **Kijk uit met de billing-gate**: die gebruikt een per-gebruiker advisory lock. Een te kleine
  pool kan onder gelijktijdigheid wachten introduceren. Test dat expliciet — `tests/billing/`
  moet groen blijven, en denk na over `connectionTimeoutMillis`.
- Done: PR met de meting in de beschrijving, volledige suite groen, en een RUNBOOK-regel die
  #173's "optie (c) gedaan, (b) blijft open" vastlegt.

### Item 2 — één gedeelde fixture-database voor de testsuites  ⏱ middel · tier: sessiemodel, legwork naar Sonnet

Er ligt al een task-chip voor (`task_f001935b`), met de volledige opdracht. Kern: elk testbestand
dat `createIngestedDb()` aanroept boot zijn EIGEN PGlite en ingest alle 17 SEED_TABLES opnieuw.
Daardoor is de `hookTimeout` inmiddels **vier keer** verhoogd (30→60→120→300s), en sessie 56 moest
óók de web-`testTimeout` op 15s zetten.

- Onderzoek een gedeelde/ge-snapshotte fixture-DB (globalSetup + goedkope restore per suite).
- ⚠ **Isolatie is de harde eis**: `tests/answer/answer-first-region.test.ts` en
  `answer-first-period.test.ts` VERWIJDEREN met opzet rijen en zetten ze terug in een `finally`.
  Een naïef gedeelde mutabele DB maakt die flaky en volgorde-afhankelijk.
- Acceptabele uitkomst is ook een **gemeten "niet de moeite"**-bevinding in `lessons-learned.md`,
  zodat de volgende sessie dit niet opnieuw uitzoekt. Dat is een echt resultaat, geen falen.

### Item 3 — adversariële review van WP26's nieuwe vertrouwensgrenzen  ⏱ middel · tier: Fable

WP26 introduceerde drie dingen die de client vasthoudt en terugstuurt. Die verdienen een
vijandige blik die niet van de bouwer zelf komt (ik heb ze gebouwd; ik ben niet de beste
reviewer van mijn eigen aannames):

- `PendingClarification.clickOptions` — volledige intents, client-gehouden. Validator:
  `src/answer/respond/validate-pending.ts`.
- `PendingClarification.rescueOnly` — bepaalt of een reply als VERSE vraag wordt behandeld.
- `RefusalResponse.pending` — een weigering die state draagt; nieuw in dit product.

Vragen om vijandig te beantwoorden: kan een gesmede pending geld kosten dat de gebruiker niet
verwacht? Kan hij een dure LLM-route openen? Kan `rescueOnly` een echte verduidelijkingsronde
kapen? Wat gebeurt er bij een pending uit een OUDE deploy (deploy-window-skew)? Levert de
byte-neutraliteit met vlaggen uit écht identieke envelopes op — bewijs het over een breder
oppervlak dan de huidige tests.

**Tier: Fable-agents** (`model: "fable"`), meerdere, elk met ÉÉN lens (geld-pad, injectie/forgery,
deploy-skew, byte-neutraliteit) — dit is precies het "complexere taken"-werk dat de owner daar wil
hebben. Het sessiemodel weegt de bevindingen en beslist wat gefixt of expliciet gedispatcht wordt;
een Fable-agent levert bevindingen, geen merge-besluiten.

### Item 4 — doc- en architectuurconsistentie na vier WP's  ⏱ klein-middel · tier: Sonnet/Haiku fan-out

Sessies 55 en 56 leverden veel: #170 smalls, #138, #172 stap-0, #121, #154 en heel WP26. Loop
`docs/04-architecture.md`, `docs/05-data-rules.md` en `docs/08-build-plan.md` na op interne
tegenspraak, en grep op oude framing. Sessie 56 ving er drie (het A1-entry-point dat nooit
gebouwd is, "Not started" bij een gebouwde WP, ADR 029's verwijzing naar een sibling die er niet
kwam) — ga ervan uit dat er meer zijn.

### Item 5 (alleen als er tijd over is) — [#162](../open-questions.md) slot-filling, ALLEEN de hermetische helft  · tier: Fable

ADR-draft ligt klaar (`session-briefs/2026-07-19-adr-draft-slot-filling.md`). Gemeten:
compose-fixtures zijn een apart hash-domein, dus #162 triggert #164 NIET. **Maar** de A/B-meetopzet
vraagt live spend — die helft is voor een begeleide sessie. Bouw hooguit het typed-slot-contract
hermetisch, op een branch, en zet de meetopzet in de PR-beschrijving als voorstel.

**Niet doen zonder de owner:** WP30c-keuze, #132-GO, #172-co-kalibratie, #104/#112, #151-backfill,
prijsopties #101, en de WP26-go-live.

---

## 3. Slotfase — laat FABLE de architectuur van de afgelopen WP's controleren

**Owner-opdracht, 2026-07-25, letterlijk:** de nieuwe chat draait op Opus 5, *"maar Fable moet aan
het werk worden gezet voor de architectuur en complexere taken — je snapt het wel, met agents
werken."* Dus: het sessiemodel voert dit NIET zelf uit. Je spawnt **Fable-agents**
(`Agent`-tool, `model: "fable"`) en jij bent de opdrachtgever + synthese.

Doe dit ALS LAATSTE, wanneer de branches er liggen — dan beoordeelt Fable de as-built
werkelijkheid, niet een plan. Geef elke agent leesrechten op de repo, de betreffende ADR's, en de
commit-SHA's hieronder, zodat het oordeel op code stoelt en niet op de docs die ik erover schreef.

Scope: **WP26 (A + B-region + B-period + C)**, en de WP's daar direct omheen: **#154**
(last_seen_batch_id-sentinel), **#121** (serve+alert + R8-marker), **#138** (regionale retry-chip),
**#172 stap-0** (candidateWalk), **#170** (SourceBadge + llms.txt).

Geef Fable een ARCHITECTUUR-opdracht, geen bug-jacht (die dekt item 3 al). De vragen die tellen:

1. **Houdt de laagscheiding nog?** ADR 001's modulegrenzen. WP26 zette een default in de
   QUERY-laag (B-region) en één in de ANSWER-laag (B-period), en stempelt `periodDefaulted`
   pas in `respondToIntent`. Is die asymmetrie principieel of toevallig? Wat is de juiste plek
   voor "een as is ingevuld"?
2. **Groeit het aantal boolean-vlaggen op de resultaat- en envelope-objecten verantwoord?**
   `regionDefaulted`, `periodDefaulted`, `rescueOnly`, `clickOptions`, `suggestions`,
   `assumptionLine`, `last_seen_batch_id` — allemaal present-only en additief. Op welk punt
   wordt dit een gemodelleerd begrip in plaats van een verzameling losse velden?
3. **Is R8 nog één mechanisme of zijn het er stiekem vijf?** Elke WP voegde een re-derivatie toe
   (attributie, definitie, assumptie, chart, semantic-check). Kloppen die nog als één contract?
4. **Twee vlaggen, vier mechanismen** — is de flag-granulariteit de juiste? Kan de owner in de
   praktijk terugrollen wat hij wil terugrollen?
5. **Waar is het ontwerp op capaciteit gaan wringen?** #173 is de eerste keer dat een
   architectuurkeuze (pool per instance) een productie-degradatie gaf. Zitten er meer van die
   aannames in?

**Werkverdeling die ik zou aanhouden:** één Fable-agent per vraag (1 t/m 5) zodat de lenzen niet
in elkaar overlopen, plus één afsluitende Fable-agent die de vijf deelmemo's tot één oordeel
synthetiseert. Het sessiemodel schrijft daarna de samenvatting voor de owner — inclusief waar het
oneens is met Fable, als dat zo is. Een review die alleen maar instemt is geen review.

Lever het op als een kort, meningsvol memo in `docs/session-briefs/` — **geen ADR**, want een ADR
is een beslissing en die is aan de owner. Concrete aanbevelingen, elk met de prijs erbij.

Relevante SHA's: WP26 `8ee71c8` / `37a3c55` / `1a99b3d` / `1a4ca89`; #154 + #121 + #138 + #172-stap-0
+ #170 staan in de sessie-55-entry van `docs/status-archive.md`.

---

## 4. Afsluiten van de overnacht-sessie

Draai het volledige wrap-up-ritueel uit `CLAUDE.md` (lessons, memory, de VOLLEDIGE docset, stale-doc
sweep, clean state, cleanup, kickoff-brief, en de finale zelf-audit). En houd je aan de gouden regel:
**elk feit tegen de bron verifiëren, nooit uit geheugen** — datums via `date`, PR's via `gh`, CI via
`gh run view`, productie via `curl`. Sessie 56 eindigde met een groene CI én een degraderende
productie; alleen een echte `curl` liet dat zien.

Laat voor de owner één helder overzicht achter: welke PR's klaarstaan voor review, wat je bewust
NIET hebt gedaan en waarom, en wat Fable's memo aanbeveelt.

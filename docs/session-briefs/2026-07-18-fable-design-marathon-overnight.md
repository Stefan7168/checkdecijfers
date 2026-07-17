# Overnight design-marathon (nacht 18→19 juli) — Fable's laatste nacht: denkwerk vastleggen voor de modelwissel

**Context (owner-besluit 18-07-2026, in-chat):** Fable is t/m morgen beschikbaar; daarna draaien sessies op
Opus/Sonnet. Fable's kracht = plannen en architectuur. Deze nacht wordt daarom een ONTWERP-marathon: de grote
open werkpakketten worden elk tot een execute-ready ontwerp uitgewerkt, zodat de uitvoering daarna door een
ander model kan zonder her-denkwerk. "Note everything, as if we leave this ship" geldt hier letterlijk — na
deze nacht IS het schip verlaten door dit model.

## Regels (autonome sessie — ongewijzigd, #118(b) + overnight-precedent)

- **NUL live-LLM-spend, NUL prompt-byte-wijzigingen, geen live DDL, geen live syncs, geen env-flips.**
- Ontwerp-docs zijn docs-only → direct naar `main` met `[skip ci]`. Code (alleen fase 7) → **branch + PR**,
  vol verificatieblok, owner-review wacht.
- Read-only netwerk mag (curl naar publieke API's — fase 5 heeft dat nodig; force-ipv4-preload waar node
  gebruikt wordt).
- Elke fase levert zijn doc af VOORDAT de volgende start (een halve marathon met vijf halve docs is
  waardeloos; drie afgemaakte ontwerpen zijn goud). Werk de fasen in volgorde af; stop netjes met de
  wrap-up-ritual wanneer de context krap wordt.
- Subagents: fan-out legwerk (corpus-greps, API-scouting, doc-sweeps) op Sonnet/Haiku; het ontwerp-denken
  doet de sessie zelf (delegation cost-tier rule).

## Fase 1 — WP26 execute-brief (answer-first defaults + klikbare clarify-opties; ADR 024)

Het #1-item van de owner-stack, met trial-conversie-belang (s52: twee losse proefvragen kregen eerlijke maar
conservatieve weigeringen). ADR [024](../decisions/024-answer-first-defaults-and-clickable-options.md) draagt
het ontwerp op hoofdlijnen; wat ONTBREEKT is het execute-ready bouwplan. Lever
`2026-07-19-wp26-execute-brief.md`:

1. **Corpus-gegrond:** hergebruik de s23-experience-audit (110 vragen, gemeten uitkomsten in de archieven) +
   de s52-smoke-weigeringen + de s54-relabels (f-v29, f-merge — beide WP26-adjacent geannoteerd in de
   labelled sets) als de meetbasis: WELKE vraagklassen verliezen vandaag een antwoord aan een weigering/
   clarificatie, met aantallen.
2. **De safelist concreet:** de exacte Mechanism-B-safelist (welke defaults answer-first mogen), per entry de
   R7-transparantieregel, als READ-BACK-DOC voor de owner (hij moet hem hardop kunnen goedkeuren).
3. **Mechanism A (klikbare opties):** de datastructuur (bestaat al deels — `pending.options`, de #56-dry-run,
   de s54-region_unknown-optie-labels), de UI-verandering (chips vullen het invoerveld, #75-conventie), en
   wat er NIET verandert (geen nieuw betaald entry-point).
4. **Kalibratieprotocol voor de owner-aanwezige bouwsessie:** welke labelled-set-uitbreidingen, welke
   record/eval-rondes, verwachte spend (les s54: reken €2/ronde, begroot meerdere rondes), welke bevroren
   pins mogen NIET bewegen (B15/B16-gedrag!), go/no-go-criteria.
5. Testplan + flag/rollout (dormant-by-design zoals #53) + de forecast-guard-nuance (de s52-smoke-weigering
   "inflatie juni 2026" was een forecast-guard — is dát WP26-scope of een eigen kleine fix? Beslis en
   onderbouw).

## Fase 2 — #162 slot-filling ADR-draft (nummervrije frasering — fabricage structureel onmogelijk)

Owner: "klinkt echt uitstekend". Architectuur-zwaar, perfect Fable-werk. Lever
`2026-07-19-adr-draft-slot-filling.md` (ADR-vorm: context, beslissing, ≥2 echte alternatieven, trade-offs,
revisit-triggers — een latere sessie promoveert hem naar `docs/decisions/` na owner-akkoord):

- Het typed-placeholder-contract ({periode}, {waarde1}, …): schema, validatie, hoe R1-traceerbaarheid per
  slot werkt; wat er met R3/verbatim-check en de #144-semantische-checker gebeurt (welke verdedigingslagen
  worden OVERBODIG, welke blijven);
- de interactie met ADR 013's ladder (regenerate → template) en met WP26's answer-first;
- migratiepad: A/B naast de huidige pijplijn (de #162-rij noemt het een experiment — ontwerp de meetopzet:
  welke metric beslist, hoeveel vragen, welke gate), rollback;
- de fixture/replay-consequenties (prompt-bytes wijzigen → #164-heropname; plan de batch).

## Fase 3 — #172 escalatie-WP-protocol (finder model+drempel-co-kalibratie)

Alle metingen staan in de s54-archive-entry en `src/catalog/rerank.ts`. Lever
`2026-07-19-172-escalation-protocol.md`: per-model drempelontwerp (of één drempel + per-model mapping),
params-matrix (temperature vs thinking per modelfamilie), labelled-set-uitbreiding (meer chain-gevallen),
meetprotocol (hoeveel records, welke stabiliteitseis), go-criteria (wanneer is Sonnet "aan", wanneer Fable
proberen — let op: na de modelwissel is Fable niet meer beschikbaar als sessiemodel maar WEL als API-model;
kosten/baten), en de restore-stap (chainContains-assertie terug). Begroot de spend voor de owner.

## Fase 4 — #154 correct ontwerp (retained-cell valse "gesynchroniseerd op"-datum)

De s47-vondst; het batch_id-schetsje van de finder is als GEBREKKIG genoteerd — ontwerp het goed. Lever
`2026-07-19-154-design.md`: per-cel versheidswaarheid (welke kolom/afleiding wél klopt), de
staleness-interactie (R11), migratie-impact (geen ad-hoc DDL — genummerde migratie), backfill-strategie,
en de testvorm die het s47-repro pint. Klein maar precies — dit is een eerlijkheidskwestie (publieke claim:
"met datum getoond").

## Fase 5 — #123/WP30c: rijksfinancien.nl-dossier (tweede bron — owner-beslismemo)

De sparring (18-07) maakte rijksfinancien.nl kandidaat ("begroot≠uitgegeven-val = onze kracht"). Lever
`2026-07-19-wp30c-rijksfinancien-dossier.md`:

- **Scout de API read-only** (subagents, curl): welke datasets, welk formaat, stabiliteit van identifiers,
  update-cadans, licentie — dezelfde meetdiscipline als docs/07/11 (geen claim zonder call).
- Map op de ADR [030](../decisions/030-multi-source-architecture.md)-seams: wat de adapter moet kunnen, wat
  het conformance-harnas al afdwingt, waar de eerste echte tweede-bron-pijn zit (period-grammatica? statussen?).
- Het beslismemo voor de owner: rijksfinancien vs politie-data (sparring-genoemd) vs wachten; per optie de
  eerste-tabel-kandidaten + benchmark-uitbreidingsvorm (CC-achtige sleutel per bron?). GEEN beslissing nemen —
  WP30c is en blijft owner-keuze; het memo maakt de keuze klein.

## Fase 6 — korte ontwerpnotities: #138, #121, en het 85792NED-named-region-punt

Eén doc `2026-07-19-small-designs.md`, drie secties: (a) #138 regionale weigering-chip — de eerlijke
code→regiolabel-bron (registry/codes-RegioS, nooit cellen) + chipvorm; (b) #121 template-rung fail-closed —
de twee opties met de owner-vraag scherp; (c) het s54-ontwerppunt: named-region-vragen op 85792NED (RegioS =
gewone dimensie) — opties uit het staged-brief (per-regio-sleutels / dims-resolutielaag / doorverwijzen naar
83625NED) met aanbeveling.

## Fase 7 — ALLEEN als er capaciteit over is: bouw de #170-smalls (branch + PR)

Owner-approved (sparring): (1) bronbadges op antwoorden/grafieken, (2) `llms.txt`, (3) grafiek-download-met-
bron, (4) Ontdek-annotaties/definitie-toggles. Hermetische code, nul LLM-bytes. Branch `visibility-smalls`,
vol verificatieblok + /code-review LOW, PR wacht op owner-review. Liever twee smalls af dan vier half.

## Wrap-up (verplicht, vol ritueel)

Naast de standaardlijst: (a) werk `docs/STATUS.md` + memory bij met wat AF is; (b) schrijf de kickoff voor de
eerste post-Fable-sessie (`2026-07-19-session-post-fable-kickoff.md`) met expliciet: de modelwissel (topmodel
= Opus; delegation cost-tier rule blijft — het sessiemodel doet denkwerk, fan-out op Sonnet/Haiku; werk de
memory `feedback_model_tier_allocation` bij), de owner-datums (22/7 06:30 `85773NED`, 23/7 06:30 `83693NED`,
~30/7 BBP+PPI met chunk-hatch, #132 route B op/na 19/7), de opgeleverde ontwerpen als menu voor de owner, en
de open owner-clicks (GitHub Budgets / Resend-confirm / Firewall-rule optioneel).

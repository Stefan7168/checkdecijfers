# Session-52 kickoff — product-af: Ontdek-grafieken + het #53-proefpotje (written by session 51, 2026-07-17)

Ga verder met checkdecijfers.nl. Lees eerst CLAUDE.md, dan docs/STATUS.md — het ▶-blok (sessie 51) is leidend.
Productie is LIVE en verwerkt echt geld; Stefan (geen developer) is de enige gebruiker — leg alles uit in gewone taal.

**Owner-pivot (s51, bindend): PRODUCT AF gaat vóór dekkingssprint-tabellen #4-#9 en de marketingkalender.**
De huisstijl (papier & inkt, [12-huisstijl.md](../12-huisstijl.md)) en de publieke landing op `/` staan live
(`4dc5273`). De klus, in volgorde:

1. **"Ontdek Nederland in grafieken" op de homepage** — LLM-vrij, geen geld-pad: server-gerenderde
   deterministische grafieken uit onze eigen database via de bestaande `src/chart/`-machine (ChartSpec + pure
   SVG-renderer). Reeksen die er al in zitten: consumentenvertrouwen (83693NED), economische groei (85880NED),
   inflatie, huizenprijzen. Elke grafiek mét de echte bronregel (R4). Huisstijl-regels volgen (grafiekkleuren
   = paletttokens; zie chart.tsx-aanpak s51).
2. **Het #53-proefpotje (geld-pad — EIGEN gereviewde wijziging, begeleide livegang):** anonieme bezoekers
   krijgen 2 proefvragen op de homepage. Owner-besluiten staan vast (zie #53-rij): potje in VRAGEN gemeten
   (deterministische DB-teller, check-vóór-serveren), leeg potje → proefveld degradeert naar "log in om verder
   te gaan" en herstelt vanzelf bij bijvullen (site kan NOOIT breken); buitenriem = APARTE Anthropic-API-sleutel
   met eigen hard bestedingsplafond (owner maakt die aan in de Anthropic-console — begeleide stap); per-bezoeker-
   limiet + rate limiting; R8-auditrijen ook voor anonieme antwoorden. Ontwerp eerst kort uitschrijven (ADR-vraag:
   anonieme identiteit + misbruikgrenzen), dan bouwen.
3. Daarna pas: dekkingssprint-tabellen #4-#9 (specs klaar; elk éérst de RUNBOOK-spookmaat-probe, #167).

**Verificatie-aandachtspunten:** de landing/huisstijl raakt géén prompt-bytes (LLM-fixtures veilig); het
proefpotje raakt LLM-spend → intent-fixtures NIET (zelfde prompt), maar wel live-spend-config. Volledig
verificatieblok vóór elke push (suites SERIEEL per map zoals CI; dev-server UIT tijdens het blok — de s51
load-flake-les); automatische `/code-review` low. Lokale dev: RUNBOOK "Local web dev server" (publieke
Supabase-waarden in web/.env.local). Voetregel staat site-breed — check hem visueel even in de INGELOGDE chat
(enige niet-bekeken oppervlak van s51).

**Ochtendtaken (owner-datums, operationeel):** wo 22/7 06:30 sync `85773NED` (generale); do 23/7 06:30 sync
`83693NED` (julicijfer); ~30/7 BBP-flash + PPI: sync `85770NED` direct, `85880NED` via de chunk-escape-hatch
(RUNBOOK stap 5). #132 route B op/na 19/7.

**Regels (ongewijzigd):** #118 owner-aanwezig = direct pushen ná groen blok; live DDL / echte spend / env-flips
owner-begeleid; jachten gepauzeerd (#163(1)); fan-out Sonnet/Haiku; principe (c): nooit gokken. Residuen:
#166-follow-up ("bedoel je …?"-copy, owner-sign-off), donker thema (volgt de huisstijl later), TS ^5-pin
(liftconditie dependabot.yml), #151-backfill (begeleid), #104/#112 (live-LLM-spend).

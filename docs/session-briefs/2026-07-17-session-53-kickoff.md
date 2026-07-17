# Session-53 kickoff — dekkingssprint-tabellen #4-#9 (written by session 52, 2026-07-17)

Ga verder met checkdecijfers.nl. Lees eerst CLAUDE.md, dan docs/STATUS.md — het ▶-blok (sessie 52) is
leidend. Productie is LIVE en verwerkt echt geld; Stefan (geen developer) is de eigenaar — leg alles uit in
gewone taal.

**Stand: product-af is KLAAR.** De huisstijl (s51), de Ontdek-grafieken (`752af59`, ADR 035) én het
#53-proefpotje (`9317acb`, ADR 036 — **LIVE na de begeleide livegang van 17/7**) staan alle drie op
productie. Het potje staat op 23/25; bijvullen/dichtzetten = `npm run trialpot:set -- <n>` (owner-begeleid,
DATABASE_URL). ⚠ Er is nu een TWEEDE geld-oppervlak: anonieme proefvragen draaien op de aparte
trial-API-sleutel (eigen workspace + hard plafond). Wijzigingen aan de landing/trial raken een live
geld-pad — eigen gereviewde changes, volle verificatie.

**De klus (owner-volgorde, s51-pivot afgerond): dekkingssprint-tabellen #4-#9.**
Specs + volgorde: [2026-07-17-coverage-tables-2-9-measured-specs.md](2026-07-17-coverage-tables-2-9-measured-specs.md)
en [11-coverage-table-set.md](../11-coverage-table-set.md). Bindende constraints:
- Elke tabel ÉÉRST de RUNBOOK-spookmaat-probe (#167) — CBS-metadata kan maten zonder observaties bevatten.
- #164: vocab-toevoegingen invalideren alle ~93 LLM-fixtures → batch de canonieke sleutels van meerdere
  tabellen in ÉÉN re-record, met owner-akkoord (sub-euro spend).
- Trage streams: de chunked-capture-escape-hatch (RUNBOOK stap 5) waar nodig.
- Live prod-syncs + registry:apply zijn de normale gang (sessies 49/50-precedent), maar meld ze.

**Ochtendtaken (owner-datums, operationeel):** wo 22/7 06:30 sync `85773NED` (generale); do 23/7 06:30 sync
`83693NED` (julicijfer); ~30/7 BBP-flash + PPI: `85770NED` direct, `85880NED` via de chunk-escape-hatch.
#132 route B op/na 19/7.

**Aandachtspunt met gewicht: WP26 heeft nu trial-conversie-belang.** Bij de livegang-smoke kregen twee
losjes geformuleerde vragen ("Wat was de inflatie in juni 2026?", "Wat is het consumentenvertrouwen?")
eerlijke maar conservatieve weigeringen (forecast-guard resp. meta-template) in plaats van het cijfer — een
proefbezoeker kan zo z'n 2 gratis vragen aan weigeringen kwijtraken. WP26 (answer-first, ADR 024) staat in
de owner-wachtrij; als de owner het naar voren haalt gaat het vóór de tabellen. Niet zelf starten zonder
owner-woord (live-LLM-kalibratie + owner-read-back vereist).

**Regels (ongewijzigd):** #118 owner-aanwezig = direct pushen ná het volle verificatieblok (typechecks +
alle suites SERIEEL, dev-server UIT + benchmark 14/14 + 6/6 + 0 fabricated + echte build + automatische
/code-review LOW); autonome sessies = branch+PR. Live DDL / echte spend / env-flips owner-begeleid. Fan-out
op Sonnet/Haiku, topmodel doet denkwerk. Principe (c): nooit gokken. Jachten gepauzeerd (#163(1)).

**Tooling-quirks (s52-lessen, lees lessons-learned):** het in-app browserpaneel is onbetrouwbaar op
streamed/Suspense-pagina's — prod-checks met `curl | grep`, interactie via de echte Chrome-extensie;
React-19-inputs alleen met echte toetsaanslagen; fail-safe caches op het TWEEDE request beoordelen.

**Residuen (tracked, geen focus):** owner-console-check trial-workspace (gevraagd, nog niet bevestigd —
RUNBOOK #53-sectie annoteren zodra bevestigd); #166-copy (owner-sign-off); donker thema; TS ^5-pin
(liftconditie); #151-backfill (begeleid); #104/#112 (live-LLM-spend); cookie-consent-lezing ADR 036 D1
(owner verifieert vóór launch); Vercel-Firewall-regels (owner-dashboard, optioneel).

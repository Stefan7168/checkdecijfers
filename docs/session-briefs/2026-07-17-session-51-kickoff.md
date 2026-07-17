# Session-51 kickoff — coverage-sprint tables #4-#9 (written by session 50, 2026-07-17)

Ga verder met checkdecijfers.nl. Lees eerst CLAUDE.md, dan docs/STATUS.md — het ▶-blok (sessie 50) is leidend.
Productie is LIVE en verwerkt echt geld; Stefan (geen developer) is de enige gebruiker — leg alles uit in gewone taal.

**Stand:** sprint-tabellen #1 (83693NED consumentenvertrouwen), #2 (85880NED BBP-flash, volle ingest) en #3
(85770NED PPI) zijn LIVE — alle zes CC-bevroren cellen LLM-vrij geverifieerd op prod. De #166-guard is live
inclusief alle max-review-hardening. Sleutels/grains/CC-taken van #2+#3 draaien op de poort.

**De klus: sprint-tabellen #4-#9** per [coverage-tables-2-9-measured-specs.md](2026-07-17-coverage-tables-2-9-measured-specs.md)
(releases 3/8–20/8; batching per [#164](../open-questions.md) — groepeer vocab-wijzigingen, één heropname per
sessie, sub-euro Haiku-spend melden + owner-akkoord vragen). Volg de STAANDE PROCEDURE in
[RUNBOOK.md](../RUNBOOK.md) ("adding a curated coverage-sprint table"), met TWEE nieuwe verplichte stappen uit s50:
1. **Spookmaat-probe (stap 1, [#167](../open-questions.md)):** vergelijk vóór het bevriezen van de spec de
   distinct-maten in Observations met MeasureCodes; codes met NUL rijen tabel-breed → `excludeMeasures` op de
   seed (met titel als comment). 85880NED had er 17; de specs van #4-#9 zijn hier NIET op gecontroleerd.
2. **Slow-stream-escape-hatch (stap 5):** grote ongefilterde tabellen kunnen bij sync falen (~6KB/s lokaal) —
   `capture-observations-chunked.ts` + `sync-from-capture.ts`. Frozen-key-waarden op de bouwdag HERMETEN
   (beide platforms) vóór bevriezing; identifiers zijn v4-geverifieerd in de specs.

**Ochtendtaken (owner-datums):**
- **wo 22/7 06:30 — persberichtdag-generale (huizenprijzen juni):** `node --import ./scripts/force-ipv4.mjs
  --env-file=.env src/ingestion/cli.ts sync 85773NED`; owner doet de social-kant.
- **do 23/7 06:30 — consumentenvertrouwen juli:** zelfde sync voor `83693NED` — eerste release waarvoor het
  product op dag één data heeft.
- **~30/7 — BBP-flash Q2 + PPI juni:** sync `85770NED` (klein, direct) + `85880NED` — die laatste heeft
  vrijwel zeker de chunk-escape-hatch nodig (RUNBOOK stap 5).
- **#132 route B checken op/na 19/7** (forks==0 = T-0).

**Regels (ongewijzigd):** #118-revisie = owner-aanwezig pusht/merged direct ná het volle verificatieblok
(typechecks, alle suites SERIEEL per map zoals CI, benchmark 14/14+6/6+0, echte build, automatische
`/code-review` low); live DDL / echte spend / env-flips owner-begeleid; jachten GEPAUZEERD per #163(1);
fan-out op Sonnet/Haiku; principe (c): nooit gokken. Autonome sessies: branch + PR per #118(b).

**Residuen (tracked, niet-focus):** #166-follow-up rijkere "bedoel je <curated term>?"-clarificatie (nieuwe
NL-copy → owner-sign-off); #151-backfill (begeleid); #146-150/#152/#154/#157; #104/#112 (live-LLM-spend);
/login-header cosmetisch; TS major-pin ^5 (liftconditie in dependabot.yml — maandonderhoud). Owner-stack
(#138/WP26/#121/#131/WP30c) + #162 queuen achter de sprint.

**Model:** tier-beleid ongewijzigd (topmodel denkt; legwerk op Sonnet/Haiku).

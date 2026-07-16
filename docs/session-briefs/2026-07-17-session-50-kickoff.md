# Session-50 kickoff — coverage-sprint tables #2 + #3 in ONE batch (written by session 49, 2026-07-17)

Ga verder met checkdecijfers.nl. Lees eerst CLAUDE.md, dan docs/STATUS.md — het ▶-blok (sessie 49) is leidend.
Productie is LIVE en verwerkt echt geld; Stefan (geen developer) is de enige gebruiker — leg alles uit in gewone taal.

**De klus: dekkingssprint tabellen #2 `85880NED` (BBP flash, release 30/7) + #3 `85770NED` (PPI, release 30/7) — SAMEN
in deze ene sessie, met ÉÉN gecombineerde vocab-wijziging + ÉÉN fixture-heropname** (sprint-constraint
[#164](../open-questions.md): elke vocab-toevoeging invalideert alle ~93 intent/followup/clarify/delivery-fixtures).
Volg de STAANDE PROCEDURE in [RUNBOOK.md](../RUNBOOK.md) ("adding a curated coverage-sprint table" — het bewezen
tabel-#1-template, sessie 49) en de brief [2026-07-17-coverage-sprint-brief.md](2026-07-17-coverage-sprint-brief.md);
per-tabel-record spiegelen in [11-coverage-table-set.md](../11-coverage-table-set.md).

**Tabel-specifiek (uit de brief, ONGEVERIFIEERD tot je het live meet):**
- `85880NED`: slice top-aggregaten (skip ~110 detailtopics), SoortMutaties A045299 (YoY volume, headline) + A045300
  (QoQ); mixed-grain Perioden → maand/kwartaalpatroon checken vóór ingest-config.
- `85770NED`: slice Afzetgebieden A044074 (totaal) [+ A044077 invoer]; ⚠ de ProdCom-totaalcode is NOG NIET geverifieerd
  — verificatiepunt (a) uit de brief, eerst live checken.
- ⚠ **v3-namen-val (sessie-49-les):** de briefs "headline"-identifiers (`BrutoBinnenlandsProduct_2`, `JaarmutatiePPI_3`)
  zijn waarschijnlijk v3-KOLOMnamen — hervalideer ALLES tegen v4 `MeasureCodes` op `datasets.cbs.nl` vóór registry-rijen
  (tabel #1: `Consumentenvertrouwen_1` bleek M001093). Basisjaar-breuken (2021=100) in registry-notes (R11/#26).

**Regels (ongewijzigd):** #118-revisie = owner-aanwezig pusht/merged direct; volledig verificatieblok vóór elke
code-push **inclusief de automatische `/code-review` low-effort pass (#118-aanvulling 17-07)**; live DDL / echte
spend / env-flips alléén owner-begeleid (de fixture-heropname is echte-maar-sub-euro Haiku-spend — meld en vraag
akkoord zoals sessie 49 deed); jachten GEPAUZEERD per #163(1); fan-out op Sonnet/Haiku; principe (c): nooit gokken.
Autonome sessies (chips/overnight): branch + PR per #118(b).

**Owner-datums / ochtendtaken:**
- **wo 22/7 06:30 — persberichtdag-generale (huizenprijzen juni):** die ochtend `node --import ./scripts/force-ipv4.mjs
  --env-file=.env src/ingestion/cli.ts sync 85773NED` draaien zodat het juni-cijfer erin zit; owner doet de social-kant.
- **do 23/7 06:30 — consumentenvertrouwen juli:** zelfde sync voor `83693NED` — tabel #1 staat live en pikt het
  julicijfer dan automatisch op (de eerste release waarvoor het product op dag één data heeft).
- **#132 route B checken op/na 19/7** (forks==0 = T-0).

**Residuen (tracked, niet-focus):** #166 al-curated-guard (taakchip staat klaar; geld-pad, owner-besluit); #151-backfill
(begeleid); #146-150/#152/#154/#157; #104/#112 (live-LLM-spend); /login-header cosmetisch. Owner-stack
(#138/WP26/#121/#131/WP30c) + #162 queuen achter de sprint. Verificatiepunten brief: (a) PPI-ProdCom ✱ deze sessie;
(b) v4-check 85937NED/85792NED en (c) 84106NED-crosscheck en (d) 83625NED-validatie mogen mee als de tijd het toelaat.

**Model:** tier-beleid ongewijzigd (topmodel denkt; legwerk op Sonnet/Haiku).

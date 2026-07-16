# Session-50 kickoff — coverage-sprint tables #2 + #3 in ONE batch (written by session 49, 2026-07-17)

Ga verder met checkdecijfers.nl. Lees eerst CLAUDE.md, dan docs/STATUS.md — het ▶-blok (sessie 49) is leidend.
Productie is LIVE en verwerkt echt geld; Stefan (geen developer) is de enige gebruiker — leg alles uit in gewone taal.

**De klus, in volgorde:**
1. **Review + merge de twee wachtende PRs** (owner-besluit): [PR #54](https://github.com/Stefan7168/checkdecijfers/pull/54)
   (#166-guard, geld-pad, gate groen) en [PR #55](https://github.com/Stefan7168/checkdecijfers/pull/55) (tabel #3
   `85770NED` PPI volledig geprept ZONDER vocabulaire — CC8-CC10 draaien al op de poort).
2. **Beslis tabel #2 `85880NED` (BBP, release 30/7):** de lean slice is door de validator weerlegd (26/210 maten nul
   rijen) — kies: volle ingest (~99.676 cellen, ~18MB fixture) óf een kleine CbsSlice-measure-allowlist-uitbreiding
   óf descope; gemeten opties in de specs (conclusie 1). Bouw daarna tabel #2 per het RUNBOOK-template.
3. **De vocab-batch voor #2+#3 samen: canonieke sleutels + AVAILABLE_GRAINS + ÉÉN fixture-heropname** (sprint-
   constraint [#164](../open-questions.md); heropname = sub-euro Haiku-spend, meld en vraag akkoord zoals sessie 49)
   + CC8-CC10 omwijzen van explicit- naar canonical-intents; dan verificatieblok + live prod-stap (sync + registry:apply).
Volg de STAANDE PROCEDURE in [RUNBOOK.md](../RUNBOOK.md) ("adding a curated coverage-sprint table") en spiegel
per-tabel-records in [11-coverage-table-set.md](../11-coverage-table-set.md).

**Tabel-specifiek — ✅ ALLES AL GEMETEN (s49-overnight, 8 agents, v3+v4 kruisgecheckt): volg
[coverage-tables-2-9-measured-specs.md](2026-07-17-coverage-tables-2-9-measured-specs.md)** — v4-maatcodes,
geverifieerde slices (beide met bestaande CbsSlice-mechanismen — géén adapterwijziging nodig), frozen-key-kandidaten
(op de bouwdag HERMETEN vóór bevriezing), en de vier open verificatiepunten (a)-(d) RESOLVED. Kern: #2 `85880NED`
headline `M002782_1`, slice = dimensionPrefixes op SoortMutaties ['A045299','A045300'] (36.820 obs); #3 `85770NED`
headline `M003288`, ProdCom-totaal = `A052584`, slice 654 obs dicht. Basisjaar-breuken (2021=100) + de
85429NED-methodebreuk in registry-notes (R11/#26). ⚠ `80590NED` bleek NIET v3-only (lowercase-id-val, quirk #1) —
het ADR-003-v3-pad is van tafel.

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

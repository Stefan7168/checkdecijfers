# Session-49 kickoff — build the coverage sprint (written by session 48, 2026-07-17)

Ga verder met checkdecijfers.nl. Lees eerst CLAUDE.md, dan docs/STATUS.md — het ▶-blok (sessie 48) is leidend; bij twijfel
wint STATUS's top-blok. Productie is LIVE en verwerkt echt geld; Stefan (geen developer) is de enige gebruiker — leg alles
uit in gewone taal.

**De klus: de DEKKINGSSPRINT** (owner-strategie [#163](../open-questions.md)(3)) — execute-ready brief:
[2026-07-17-coverage-sprint-brief.md](2026-07-17-coverage-sprint-brief.md). Eerste doel: **`83693NED`
(consumentenvertrouwen) — kleinste tabel, beide platforms, KLAAR VÓÓR de CBS-release van woensdag 23 juli 06:30.** Daarna
`85880NED` (BBP) + `85770NED` (PPI) vóór 30/7 — volgorde, slices en valkuilen staan in de brief. Route: curated onboarding
per [how-to-add-a-source.md](../how-to-add-a-source.md), NIET de WP16 fit-gate. Open verificatiepunten vóór de bouw staan
in de brief: PPI-ProdCom-totaalcode; v4-beschikbaarheid 85937NED/85792NED; 84106NED-supersessie-crosscheck; 83625NED
(gemeente-gemiddelde-prijzen) valideren als kandidaat #9.

**Regels — GEWIJZIGD op 2026-07-17, lees dit eerst:**

- **#118-REVISIE (owner): in owner-aanwezige sessies push/merge je ALLES direct — geen per-merge-akkoord, geen doorvragen.**
  ONGEWIJZIGD: het volledige verificatieblok vóór elke code-push (root+web typechecks + alle suites + benchmark 14/14 +
  6/6 + 0 fabricated + echte next build; `audit:verify` bij validator-wijzigingen), CI als harde poort, live DDL / echte
  spend / env-flips alléén owner-begeleid, autonome sessies branch+PR.
- **Jachten GEPAUZEERD per #163(1)** — start geen nieuwe security-hunt; marktcontact/distributie gaat voor.
- Fan-out op Sonnet/Haiku (topmodel alleen denkwerk); zero prompt-bytes tenzij de WP het autoriseert; principe (c): bij
  ontbrekende/dubbelzinnige data weigeren of vragen, nooit gokken.
- De brief is measured-only gevalideerd (2026-07-17), maar hervalideer identifiers live vóór je registry-rijen schrijft —
  catalogi bewegen.
- Draait er een tweede sessie tegelijk: eigen `git worktree` (les `4f0c3fe` + het s48-archief), scope `git add <paden>`,
  pull vóór elke push.

**Owner-datums:** wo 22/7 06:30 = eerste persberichtdag-generale (huizenprijzen juni — de data zit al in `85773NED`, de
owner doet de social-kant; het product hoeft alleen de sync te draaien); 23/7 06:30 = deadline tabel 1; **#132 route B
checken op/na 19/7** (forks==0 = T-0).

**Residuen (tracked, niet-focus):** #151-backfill (begeleide veeg, owner aanwezig), #146-150/#152/#154/#157, #104/#112
(live-LLM-spend), /login-header cosmetisch. Owner-stack (#138/WP26/#121/#131/WP30c) + het #162-slot-filling-experiment
queuen achter de sprint.

**Model:** Fable-5 als sessiemodel; tier-beleid ongewijzigd (goedkope tier voor legwerk, topmodel voor denkwerk).

# Session-54 kickoff — dekkingssprint-tabellen #4-#9 LIVE brengen (geschreven door sessie 53, 2026-07-18)

Ga verder met checkdecijfers.nl. Lees eerst CLAUDE.md, dan docs/STATUS.md — het ▶-blok (sessie 53) is
leidend. Productie is LIVE en verwerkt echt geld; Stefan (geen developer) is de eigenaar — leg alles uit in
gewone taal.

**Stand:** sessie 53 (autonoom, 17→18/7) heeft tabellen #4-#9 **BUILT DORMANT** opgeleverd op
[PR #56](https://github.com/Stefan7168/checkdecijfers/pull/56) (branch `coverage-tables-4-9-prep`): seeds,
registry-defaults, fixtures en CC11-CC31 bevroren — hermetische gate groen, maar **nul vocabulaire en niet
gesynct**: de zes tabellen beantwoorden in productie nog niets. Tracker: open-questions **#168**.

**De klus (owner aanwezig, ÉÉN samenhangende stap — volg het draaiboek
[2026-07-17-coverage-4-9-vocab-batch-staged.md](2026-07-17-coverage-4-9-vocab-batch-staged.md) letterlijk):**
1. Review + merge PR #56 (autonome sessie → owner-review vereist per #118(b)).
2. Vocab-batch: canonieke sleutels + AVAILABLE_GRAINS + REGIONAL_KEYS voor alle zes tabellen in één commit
   (conceptsleutels + botsingsanalyse staan in het draaiboek; de termkeuzes zijn owner-keuze).
3. Labelled cases toevoegen (minimaal de twee botsingsgevallen: "werkloosheid" → 85224NED blijft;
   "huizenprijs nu" → 85773NED blijft).
4. ÉÉN #164-heropname (Haiku-tier, sub-euro): vier llm-fixture-dirs legen → 4× record → `intent:eval --
   --repeat=3` (nul flips verwacht). **Plus stap 4b: `--catalog-add` van de zes ids + `tablefinder:record`**
   — de prep MAT dat de catalogusmerge alleen al 4/11 finder-cases naar failure-safe `disclose` flipt;
   kalibreer de labelled finder-set bewust.
5. CC-herpunting explicit → canonical (tabel in het draaiboek; bevroren waarden blijven identiek).
6. Vol verificatieblok + /code-review LOW + push; na groene CI + geverifieerde deploy: live syncs ×6
   (`node --import ./scripts/force-ipv4.mjs --env-file=.env src/ingestion/cli.ts sync <id>`) →
   `npm run registry:apply` (PAS NA de deploy — #166-vondst 8) → per tabel een LLM-vrije spot-check.

**Owner-datums (operationeel):** wo 22/7 06:30 sync `85773NED`; do 23/7 06:30 sync `83693NED`; ~30/7
BBP-flash + PPI (`85770NED` direct, `85880NED` via de chunk-escape-hatch, RUNBOOK stap 5); #132 route B
op/na 19/7.

**Aandachtspunt:** WP26 houdt zijn trial-conversie-belang (s52: twee losse smoke-vragen kregen eerlijke maar
conservatieve weigeringen). Als de owner WP26 naar voren haalt, gaat dat vóór — niet zelf starten
(live-LLM-kalibratie + owner-read-back vereist).

**Regels (ongewijzigd):** #118 owner-aanwezig = direct pushen ná het volle verificatieblok (typecheck +
alle suites SERIEEL + benchmark 14/14 + 6/6 + 0 fabricated + echte build + /code-review LOW); live DDL /
echte spend / env-flips owner-begeleid. Fan-out op Sonnet/Haiku, topmodel doet denkwerk. Principe (c):
nooit gokken. Jachten gepauzeerd (#163(1)).

**Residuen (tracked, geen focus):** owner-console-check trial-workspace; #166-copy (owner-sign-off);
donker thema; TS ^5-pin (liftconditie); #151-backfill (begeleid); #104/#112 (live-LLM-spend);
cookie-consent ADR 036 D1 (owner vóór launch); 85792NED named-region-ontwerppunt (draaiboek);
Vercel-Firewall (optioneel).

# Session 75 kickoff — paste this as the first message

Written at the session-74 close-out, 2026-09-03. Durable copy of the handoff; the chat may be gone, the repo is the
source of truth. Every fact below was verified against `git log`, the GitHub API (runs, PR heads) and the Vercel API
(the alias deployment) at the time of writing — this session ran in a Claude Code cloud container without `gh` or
`vercel`; the RUNBOOK's multi-agent item 10 says how the same checks are done there.

---

Lees in deze volgorde vóór je iets doet: `CLAUDE.md` → `docs/STATUS.md` (het bovenste blok is de waarheid — en tel de
sessie vanaf de bovenste archive-entry, niet vanaf de titel van deze brief) → `docs/session-briefs/2026-09-03-session-75-kickoff.md`
(dit bestand) → `docs/status-archive.md` (sessie-74-entry, bovenaan). Verifieer jezelf eerst met `date +%Y-%m-%d`,
`git log -3 --oneline`, de open PRs (verwacht: VIER — #120, #121, #122, #123; koppen `5c4c88f`, `ebd341f`, `002f5b0`,
`92d4db7`; alle met een groene gate), de laatste drie `main`-runs (alles `success`) en het deployment op de alias
`checkdecijfers.vercel.app` (moet uit de nieuwste `main`-commit komen; vanuit een cloud-sessie via de Vercel-MCP-tools:
`get_deployment` → `meta.githubCommitSha`, `web_fetch_vercel_url` voor `/`, `/llms.txt`, `/api/health` — `curl` geeft daar
`000` door de netwerkpolicy, dat is GEEN storing). Rood = eerst fixen. Check met `list_sessions` dat er geen tweede
sessie 75 RUNNING is (een IDLE oudere sessie telt niet).

Stand (sessie 74, 2026-09-03, autonoom): de vier PRs van sessie 72 zijn nu ook op HIGH gereviewd (RUNBOOK batch-item 10).
#122 en #123 kregen elk een ronde-2-fix op hun branch — #122: chip-binding op verzendmoment (een klik op een oudere chip
gooide een open clarificatieronde weg en verloor de race met een lopend antwoord), de landsnaam in de chips van een
B-defaulted antwoord, de `intent`-rol voor een stripped carrier, de live-thread-fallback; #123: een meervoud-eerlijke
"geen bewerking"-stap die ook de CC BY-markering van het antwoord volgt, twee never-throws-belts, `memo`, fixtures die
herberekening wél onderscheiden, een hervat-thread-rendertest. Elke delta is LOW-gereviewd; de batch is opnieuw
gesimuleerd (drie volgordes → één boom `9394d9c6…`) en het volledige blok op die gecombineerde boom is groen
(typecheck ×2, backend 116 files / 1780 tests, benchmark answerable 14/14 + refusal 6/6 + 0 fabricated (GATE PASS), web 50 files / 584 tests, real `next build` under TypeScript 7.0.2 (TypeScript step 0.7 s)). Gates op de definitieve koppen: #122 `002f5b0` runs 33788083444 (push) + 33788089643 (pull_request), both success; #123 `92d4db7` runs 33788997612 (push) + 33789010370 (pull_request) in progress at 18:20Z (updated below once they finish). Niets gemerged, niets geflipt, geen spend.

Dé volgende prioriteit, in deze volgorde:

1. **Owner aanwezig: merge de vier PRs** — volgorde vrij; één voor één, per PR de deploy laten afronden en een canary
   (`/`, `/llms.txt`, `/api/health` 200). Vetopunten per PR staan in de review-comments (sessie 72, 73 en 74); nieuw
   sinds ronde 2 van #122: de chips van een antwoord zónder genoemde plaats zeggen nu "… in Nederland …". Een veto = de PR
   sluiten of de default aanpassen, niet stilzwijgend mergen. Na de merges één docs-push (`test:docs` eerst): STATUS-topblok
   + de "PR pending owner review"-formuleringen in ADR 029 / open-questions #73, #79, #195, #196 / de build-plan-regels
   naar MERGED + LIVE, en de eviction-regel in 04-architecture, rij #196 en ADR 029's #195/#196-notitie naar de
   ronde-2-staat van #121 (`table_evicted`/`evicted`, one-snapshot fetch, skip-locked touch).
2. Daarna `GDPR_PURGE_APPLY=1` + één bewaakte run (owner), dan #162's A/B (echte spend, owner).

Bindende kaders en owner-steers: principes (a)/(b)/(c); R6 — een chip-take is altijd een NIEUW gevalideerd resultaat; de
tien #197-beslissingen + de sessie-70/72/74-defaults zijn defaults — owner veto bij uitzondering. Geen prompt-bytes, geen
fixture-herrecording, geen live DDL zonder owner. Sessiemodel denkt, fan-out op goedkopere tiers. `npm ci` (root + web)
vóór elke lokale verificatie; het volledige blok als losgekoppeld script (`scripts/verify-block.sh <checkout> <log>`, nu
bash, ~8 min); `npm run test:docs` (1 s) vóór elke docs-push; een kill-opdracht bevat níets anders dan de kill (RUNBOOK
multi-agent item 6). Autonoom en zonder owner-antwoord in de chat: NIET mergen (#118 regel b) — sessies 73 en 74 hielden
zich daaraan.

Niet herontdekken: #132 route B (owner: uitstellen); `npm run lint` in `web/` kapot (task chip); #197-ideeën 4–8
ongepland; de drie #197-follow-ups bewust niet gebouwd; #199 (bewijspaneel op het dashboard) heeft een klein
read-model-WP nodig; #178's TTL-helft blijft de owner's keuze; #198 geparkeerd. De review-follow-ups van sessie 74 staan
in rij #73 (carrier op `ChatMessage` zodra #123 gemerged is; de ⟨A6⟩ `capturedThreadId`-vereenvoudiging) en rij #79
(één gedeelde R5-predicaat; `csv.ts` hanteert een smallere regel) — pas ná de merges, ze raken de PR-bestanden. Zolang
de PRs open staan: raak op `main` NIET de bestanden aan die zij bewerken (open-questions, 04-architecture, 08-build-plan,
ADR 024/029/033, de RUNBOOK-plekken rond de dependency-hold, de flag-rij en WP26 stap 6).

Sessie-einde: de volledige wrap-up-ritual uit CLAUDE.md — ongevraagd, compleet, elk feit geverifieerd tegen
`git`/GitHub/prod, nooit uit het geheugen (en nooit uit een reviewer-claim: een datum uit `git blame` in een SHALLOW
clone is de grens-commit, geen geschiedenis — lessons-learned sessie 74).

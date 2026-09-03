# Session 76 kickoff — paste this as the first message

Written at the session-75 close-out, 2026-09-03 (19:1xZ). Durable copy of the handoff; the chat may be gone, the repo is
the source of truth. Every fact below was verified against `git log`, `gh pr list`, `gh run list`, `vercel inspect` and
`curl` at the time of writing. Supersedes `2026-09-03-session-75-kickoff.md` (written by the parallel cloud session 74;
this session, 75, executed it).

---

Lees in deze volgorde vóór je iets doet: `CLAUDE.md` → `docs/STATUS.md` (het bovenste blok is de waarheid — tel de sessie
vanaf de bovenste archive-entry, niet vanaf de titel van deze brief) → `docs/session-briefs/2026-09-03-session-76-kickoff.md`
(dit bestand) → `docs/status-archive.md` (sessie-75-entry, bovenaan). Verifieer jezelf eerst met `date +%Y-%m-%d`,
`git log -3 --oneline`, `gh pr list --state open` (verwacht: GEEN PRs van de sessie-72-batch meer — #120, #121, #122, #123
zijn gemerged; wél Dependabot #124 (root) en #125 (web), die zijn van de owner), `gh run list --branch main --workflow
ci.yml -L 3` (alles `success`; let op: een `dependabot.yml`-wijziging vuurt ook "Dependabot Updates"-runs af — filter op
de CI-workflow) en `vercel inspect https://checkdecijfers.vercel.app` (het deployment op de alias moet uit de nieuwste
`main`-commit komen; de deploy-job-log print `this run: … main tip: …`). Rood = eerst fixen. **Tweede-instantie-check:
`ListAgents`, niet alleen `list_sessions`** — een cloud-sessie (Claude Code web/telefoon-app) staat NIET in `list_sessions`;
in sessie 75 draaide er zo een parallel, onzichtbaar voor die check. Vergelijk ook elke open-PR-kop met wat de kickoff
verwacht: een verplaatste kop is een sessie die je nog niet kent.

Stand (sessie 75, 2026-09-03, owner aanwezig): de vier PRs van sessie 72 zijn GEMERGED + LIVE — #121 `527ef2e` (17:50Z,
run 33786945030), #120 `069a03e` (18:10Z, run 33788899139; TypeScript 7.0.2 bouwt productie), #122 `4fd6ea5` (18:26Z,
kop `002f5b0`; run 33790545774 groen, deploy zelf overgeslagen omdat de cloud-sessie's docs-commit `a249493` de tip was —
haar run 33791021811 deployde de gecombineerde staat), #123 `ddca024` (18:51Z, kop `92d4db7`, gemerged met
`--match-head-commit`; run 33793011578). Elke merge: eigen main-run, deploy op de alias, canaries `/`, `/llms.txt`,
`/api/health` 200. Blokken: gecombineerde boom vóór de merges (backend 116 files / 1780 tests, benchmark 6/6 + 0 verzonnen +
GATE PASS, web 49 / 579, echte `next build`), backstop op `main` `4fd6ea5`, en de eindboom `9394d9c6…` (backend 116 / 1780,
GATE PASS, web 50 / 584, `next build`) — identiek aan de boom die de cloud-sessie (haar close-out noemt zich sessie 74)
zelf verifieerde. Eén procesmisser, eerlijk vastgelegd: #122 is gemerged op een kop twee cloud-commits voorbij de lokaal
geverifieerde (gates groen, cloud-blok dekte hem, backstop bevestigde) → regel: `gh pr merge --match-head-commit <volle
40-tekens sha>` (RUNBOOK batch-item 11). Geen spend, geen prompt-bytes, geen DDL, geen flag-flips. Alle docs staan op
MERGED + LIVE; rijen #195/#196, ADR 029 en 04-architecture op #121's ronde-2-staat.

Dé volgende prioriteit, in deze volgorde — niets urgent:

1. **Dependabot #124/#125 (owner):** de eerste update-PRs sinds de TypeScript-hold de ignore-stanza verliet. Nooit blind
   mergen: per PR de changelogs lezen, een echte `next build` en het volledige blok (`scripts/verify-block.sh <checkout>
   <log>`, nu bash), dan `gh pr merge --squash --delete-branch --match-head-commit <volle sha>`, deploy afwachten, canary.
2. **`GDPR_PURGE_APPLY=1` + één bewaakte run (owner)** — dry-run-baseline 2026-09-03: 0 rijen in elke leg.
3. **#162's A/B (owner, echte spend ~€1-2).** Daarna #132 route B GO of uitstellen (laatst gevraagd 2026-09-02).
4. Owner-menu: WP30c-keuze (Rijksfinanciën `80504NED`, `Gediscontinueerd`), #199 (bewijspaneel op het dashboard — klein
   read-model-WP), #197-ideeën 4–8, de drie #197-follow-ups. **Hermetische review-follow-ups die een sessie autonoom kan
   oppakken (branch + PR, #118 regel b):** de carrier op `ChatMessage` nu #123 `chat-message.ts` heeft vrijgemaakt + de
   ⟨A6⟩ `capturedThreadId`-vereenvoudiging (rij #73); één gedeeld R5-predicaat, `csv.ts` hanteert een smallere regel
   (rij #79); eviction moet WIJKEN voor lopende reads vóór elke automatisering van `tables:evict --apply` (rij #196; task
   chip van sessie 73).

Bindende kaders en owner-steers: principes (a)/(b)/(c); R6 — een chip-take is altijd een NIEUW gevalideerd resultaat; de
tien #197-beslissingen + de sessie-70/72/74-defaults zijn defaults — owner veto bij uitzondering (nieuw sinds #122 ronde 2:
chips van een antwoord zónder genoemde plaats zeggen "… in Nederland …"; #123: label, inline, ids achter een toggle,
ingeklapt). Geen prompt-bytes, geen fixture-herrecording, geen live DDL zonder owner. Sessiemodel denkt, fan-out op
goedkopere tiers. 8 GB machine: `npm ci` (root + web) vóór elke lokale verificatie; het volledige blok losgekoppeld
(~8–10 min, mutex `pgrep -f "[n]ode.*vitest"`); `npm run test:docs` (1 s) vóór elke docs-push; na een merge wachten tot
zijn deploy klaar is vóór je opnieuw pusht; `gh run list --commit` wil de VOLLE sha. Autonoom en zonder owner-antwoord in
de chat: NIET mergen (#118 regel b) — met een owner die antwoordt: één gerichte vraag (`AskUserQuestion`, aanbeveling
eerst) en daarna gewoon doorwerken, zoals sessie 75. Review-diepte: LOW is de push-vloer, HIGH per core-product-PR vóór de
merge (RUNBOOK batch-item 10); herlees de PR-thread direct vóór elke merge (item 11).

Niet herontdekken: #132 route B (owner: uitstellen); `npm run lint` in `web/` kapot (task chip; typescript-eslint
peer-range < 6.1 blijft een waarschuwing onder TS 7); #197-ideeën 4–8 ongepland; de drie #197-follow-ups bewust niet
gebouwd; #178's TTL-helft blijft de owner's keuze; #198 geparkeerd. De sessie-74-blokken in STATUS en het archief zijn van
de cloud-sessie en beschrijven de stand vóór de merges — het sessie-75-blok bovenaan is de waarheid.

Sessie-einde: de volledige wrap-up-ritual uit CLAUDE.md — ongevraagd, compleet, elk feit geverifieerd tegen
`git`/`gh`/prod, nooit uit het geheugen en nooit uit een reviewer-claim.

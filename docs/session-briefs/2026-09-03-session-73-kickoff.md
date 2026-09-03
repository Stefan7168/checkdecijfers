# Session 73 kickoff — paste this as the first message

Written at the session-72 close-out, 2026-09-03. Durable copy of the handoff; the chat may be gone, the repo is the
source of truth. Every fact below was verified against `git log` / `gh pr list` / `gh run list` / `vercel inspect`
at the time of writing.

---

Lees in deze volgorde vóór je iets doet: `CLAUDE.md` → `docs/STATUS.md` (het bovenste blok is de waarheid) →
`docs/session-briefs/2026-09-03-session-73-kickoff.md` (dit bestand) → `docs/status-archive.md` (sessie-72-entry,
bovenaan). Verifieer jezelf eerst met `date +%Y-%m-%d`, `git log -3 --oneline`, `gh pr list --state open` (verwacht:
VIER open PRs — #120, #121, #122, #123, alle met een groene gate en een review-comment van sessie 72),
`gh run list --branch main -L 3` (alles `success`) en `vercel inspect https://checkdecijfers.vercel.app` (het
deployment op de alias moet uit de nieuwste `main`-commit komen). Rood = eerst fixen. Check met `list_sessions` dat er
geen tweede sessie 73 loopt.

Stand (sessie 72, 2026-09-03, autonoom): vier PRs gebouwd, geverifieerd (volledig verificatieblok per PR, LOW
code-review, CI-gate groen) en NIET gemerged — dat is de owner's stap (#118 regel b). Inhoud: #121 (#195/#196:
probes warmen tabellen niet meer op, de read wacht nooit achter een eviction-lock), #120 (TypeScript 7-pin
opgeheven, bewezen met een echte `next build`), #123 ("Bewijs dit cijfer": één paneel, drie dieptes, client-side over
de opgeslagen envelope — designbrief met defaults op `main`), #122 (#73 v2: elke vervolgchip is een zero-LLM click
take). Docs op `main`: stale-doc sweep `5aa48c3`, designbrief `093380b`, close-out. Onderhoud (alleen lezen): GDPR
dry-run 0 rijen, RLS 18/18 schoon, `npm audit` 0, geen Dependabot-alerts. `GDPR_PURGE_APPLY` onaangeroerd; #198
geparkeerd; #162 A/B niet gedraaid.

Dé volgende prioriteit, in deze volgorde:

1. **Owner aanwezig: review + merge de vier PRs**, serieel, per PR de deploy laten afronden en een canary
   (`/`, `/llms.txt`, `/api/health` 200) — de sessie-67-discipline. Volgorde-suggestie #121 → #120 → #123 → #122
   (#122 en #123 raken allebei `web/components/chat.tsx`, geen gedeelde regels; `git merge` lost het op, maar lees
   het resultaat). Vetopunten staan per PR in de review-comment; een veto = de PR sluiten of de default aanpassen,
   niet stilzwijgend mergen. Na #121: het RUNBOOK-blok "migration 025" is op die branch al bijgewerkt.
2. Daarna `GDPR_PURGE_APPLY=1` + één bewaakte run (owner), dan #162's A/B (echte spend, owner).

Bindende kaders en owner-steers: principes (a)/(b)/(c); R6 — een chip-take is altijd een NIEUW gevalideerd
resultaat; de tien #197-beslissingen + de sessie-70/72-defaults zijn defaults — owner veto bij uitzondering. Geen
prompt-bytes, geen fixture-herrecording, geen live DDL zonder owner. Sessiemodel denkt, fan-out op goedkopere tiers.
8 GB machine: `npm ci` (root + web) vóór elke lokale verificatie; het volledige blok als losgekoppeld script
(`scripts/verify-block.sh <checkout> <log>`, ~8 min, achter de mutex `pgrep -f "[n]ode.*vitest"` — nooit
`pgrep -f vitest` in een shell die dat woord zelf bevat); `npm run test:docs` (1 s) vóór elke docs-push; na een
merge wachten tot zijn deploy klaar is vóór je opnieuw pusht (de guard vangt het af, maar verspilt een build).

Niet herontdekken: #132 route B (owner: uitstellen); `npm run lint` in `web/` kapot (task chip; met TS 7 blijft de
typescript-eslint peer-range een bekende waarschuwing); #197-ideeën 4–8 ongepland; de drie #197-follow-ups
(tautologie, geschiedenis-titel, carrier bij hervatting) bewust niet gebouwd; #199 (bewijspaneel op het dashboard)
heeft een klein read-model-WP nodig; #178's TTL-helft blijft de owner's keuze.

Sessie-einde: de volledige wrap-up-ritual uit CLAUDE.md — ongevraagd, compleet, elk feit geverifieerd tegen
`git`/`gh`/prod, nooit uit het geheugen.

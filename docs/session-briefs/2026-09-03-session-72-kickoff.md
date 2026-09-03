# Session 72 kickoff — paste this as the first message

Written at the session-71 close-out, 2026-09-03. Durable copy of the handoff; the chat may be gone, the repo
is the source of truth. Every fact below was verified against `git log` / `gh pr list` / `gh run list` /
`vercel inspect` / production audit rows at the time of writing.

---

Lees in deze volgorde vóór je iets doet: `CLAUDE.md` → `docs/STATUS.md` (het bovenste blok is de waarheid)
→ `docs/session-briefs/2026-09-03-session-72-kickoff.md` (dit bestand) → `docs/status-archive.md`
(sessie-71-entry, bovenaan). Verifieer jezelf eerst met `date +%Y-%m-%d`, `git log -3 --oneline`,
`gh pr list --state open` (verwacht: leeg — PR #118 is gemerged), `gh run list --branch main -L 3` (alles
`success`) en `vercel inspect https://checkdecijfers.vercel.app` (het deployment dat de alias houdt moet
gebouwd zijn uit de nieuwste `main`-commit — zie de sessie-71-les over de deploy-race). Rood = eerst fixen,
geen nieuw werk. Check met `list_sessions` of er geen tweede sessie 72 loopt vóór je iets schrijft.

Stand (sessie 71, 2026-09-03): de WP26 smoke test is GESLAAGD in productie — `audit_answers` rij 261 is de
doorvraag met twee klik-opties, rij 262 de klik: `response->'parse'->>'model' = deterministic/wp26-click-option`,
0 tokens, `template`, 20 credits, `audit:verify` 2/2 clean (let op: `llm_calls` is `[]` op een klik — nooit
die kolom bevragen voor het click-model; RUNBOOK stap 4 heeft de juiste query). Daarop is PR #118 gesquashmerged
als `83f790e` (run 33699880673 gate + deploy groen); #197 stappen 1+2+3 zijn LIVE. Daarna een echte
productie-incident gevonden: twee CI-runs tegelijk op `main` (docs-push vlak na de merge) → de deploy die het
LAATST klaar was zette de alias op de oudere commit terwijl beide runs groen waren. Direct hersteld met
`vercel promote`, en structureel afgevangen: de deploy-job slaat zichzelf over als zijn commit niet meer de
tip van `main` is (RUNBOOK "Two CI runs in flight"). Vlaggen: `CLARIFY_CLICK_ENABLED` AAN en bewezen;
`ANSWER_FIRST_ENABLED` en `GDPR_PURGE_APPLY` onaangeroerd — die blijven van de owner, ook onder "werk
autonoom" (steer 25-07).

Dé volgende prioriteit, in deze volgorde, niets anders eerst:

1. Check of de owner RUNBOOK WP26 stap 6 heeft gedaan — in productie, niet door te vragen: `audit_answers`
   read-only (root `.env`, `connectFromEnv`) op rijen met id > 262 en `reply_text = 'Vergelijk met Nederland'`
   (verwacht: `kind = answer`, twee regio's in `result_ids` — GM0363 + NL01 — `parse.model` het click-model,
   0 tokens, 20 credits). Nul rijen → vraag de owner stap 6 te doen (vraag `Hoeveel inwoners had Amsterdam in
   2024?`, chip "Vergelijk met Nederland", Verstuur). Iets anders dan de chip typen moet als verse vraag
   beantwoord worden.
2. Na stap 6: `ANSWER_FIRST_ENABLED` is de volgende vlag — ALLEEN op expliciet owner-akkoord in de chat, één
   vlag tegelijk, pas als de laatste deploy gesetteld is (`/llms.txt` 200), RUNBOOK stappen 1–3 + 5;
   rollback-volgorde: klik-vlag eerst uit, B een dag later, nooit andersom.
3. Daarna `GDPR_PURGE_APPLY=1` + één bewaakte run (owner), dan #162's A/B (echte spend, owner).

Bindende kaders en owner-steers: principes (a)/(b)/(c); R6 — een chip-take is altijd een NIEUW gevalideerd
resultaat; de tien #197-beslissingen + de sessie-70-defaults zijn defaults — owner veto bij uitzondering, niet
opnieuw vragen. Vastgelegde follow-ups die je NIET zomaar bouwt: de "Nederland had de hoogste waarde"-
tautologie (R8-divergentie → known-divergences pin + `audit:verify` vóór wijziging), "geschiedenis-titel =
reply_text", carrier herstellen bij hervatting — alle drie in #197. Geen prompt-bytes, geen fixture-
herrecording, geen live DDL zonder owner. Sessiemodel denkt, fan-out op goedkopere tiers. 8 GB machine:
backend-suite solo, exit codes lezen (137 = OOM-kill), geen broncode wijzigen terwijl de suite draait. Na een
merge: wacht tot zijn run gedeployed heeft vóór je opnieuw pusht (de guard vangt het nu af, maar runs die vóór
de guard gestart zijn niet). `npm run test:docs` (1 s) vóór elke docs-push (#132: geen live PR-links in
`docs/`).

Bewust NIET gedaan, niet herontdekken: #132 route B (owner: uitstellen); `npm run lint` in `web/` kapot (task
chip bestaat); open-questions.md-prune "whenever a session has room" (de 28 oude lokale branches zijn nu wél
opgeruimd — `origin/main` is de enige remote branch); kaartweergave geparkeerd; #197-ideeën 4–8 ongepland.

Sessie-einde: de volledige wrap-up-ritual uit CLAUDE.md — ongevraagd, compleet, elk feit geverifieerd tegen
`git`/`gh`/prod, nooit uit het geheugen.

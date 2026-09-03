# Session 74 kickoff — paste this as the first message

Written at the session-73 close-out, 2026-09-03. Durable copy of the handoff; the chat may be gone, the repo is the
source of truth. Every fact below was verified against `git log` / `gh pr list` / `gh run list` / `vercel inspect`
at the time of writing.

---

Lees in deze volgorde vóór je iets doet: `CLAUDE.md` → `docs/STATUS.md` (het bovenste blok is de waarheid) →
`docs/session-briefs/2026-09-03-session-74-kickoff.md` (dit bestand) → `docs/status-archive.md` (sessie-73-entry,
bovenaan). Verifieer jezelf eerst met `date +%Y-%m-%d`, `git log -3 --oneline`, `gh pr list --state open` (verwacht:
VIER open PRs — #120, #121, #122, #123; koppen `5c4c88f`, `ebd341f`, `0ffe4c0`, `3d185a1`; alle `MERGEABLE`/`CLEAN`
met een groene gate), `gh run list --branch main -L 3` (alles `success`) en
`vercel inspect https://checkdecijfers.vercel.app` (het deployment op de alias moet uit de nieuwste `main`-commit
komen). Rood = eerst fixen. Check met `list_sessions` dat er geen tweede sessie 74 loopt.

Stand (sessie 73, 2026-09-03, autonoom): de vier PRs van sessie 72 zijn nu in ELKE volgorde conflictvrij te mergen. De
seriële merge-simulatie vond precies één conflict, alleen in docs (ADR 029 + open-questions, #121 tegen #122); dat is
vooraf opgelost: #121's docs staan op `main` (`8a3fb06`), `main` is in #122 (kop `0ffe4c0`) en #121 (kop `0a7bad8`)
gemerged — code op beide branches byte-identiek aan de door sessie 72 gereviewde koppen. De gecombineerde boom (alle
vier gemerged; drie volgordes → dezelfde boom) doorstond het volledige verificatieblok: typecheck ×2, backend 116
bestanden / 1771 tests, benchmark 14/14 + 6/6 + 0 verzonnen, web 49/575, echte `next build` onder TS 7.0.2. CI:
main-run 33749095613 (`8a3fb06`) groen, zijn deploy `checkdecijfers-87b7zd0jh…` op de alias, canaries 200; de gates op
de verplaatste koppen groen (#121: 33749196246 + 33749200112, #122: 33749190942 + 33749196611); alle vier PRs
`MERGEABLE`/`CLEAN` bij afsluiting. Niets gemerged, niets geflipt, geen spend. Rollback als #121 een veto krijgt: `git
revert 8a3fb06`.

Later in sessie 73 (owner: "pick up another task autonomously"): een HIGH-review van #121 vond vijftien geverifieerde
punten op de sessie-72-fix (LOW had hem schoon gelaten) — de verplaatste touch wachtte nog steeds achter het
eviction-lock, een TOCTOU in de re-check, rauwe periodecodes / een te nieuwe syncdatum / een uitgeschakelde
staleness-waarschuwing in dezelfde race, en de race die de owner als interne fout alarmeerde. Alles gefixt op de
branch (`0a7bad8` → `ebd341f`); één structurele follow-up opgeschreven. Branch-blok groen, LOW 0, gecombineerde boom
opnieuw volledig geverifieerd (drie volgordes → één boom `53f7ffd6…`); gates op `ebd341f`: runs 33756815650 +
33756820787 beide groen; alle vier PRs `MERGEABLE`/`CLEAN` bij afsluiting (GitHub las ~30 s `UNKNOWN` direct na de
docs-push — het herberekenvenster, RUNBOOK batch-item 8).

Dé volgende prioriteit, in deze volgorde:

1. **Owner aanwezig: review + merge de vier PRs** — de volgorde is nu vrij; wél één voor één, per PR de deploy laten
   afronden en een canary (`/`, `/llms.txt`, `/api/health` 200) — de sessie-67-discipline. Vetopunten staan per PR in
   de review-comment van sessie 72 (de sessie-73-notitie eronder legt de verplaatste kop uit); een veto = de PR
   sluiten of de default aanpassen, niet stilzwijgend mergen. Na de merges één docs-push (`test:docs` eerst):
   STATUS-topblok + de "PR pending owner review"-formuleringen in ADR 029 / open-questions #73, #195, #196 / de
   build-plan-regels naar MERGED + LIVE, en brengt de eviction-regel in 04-architecture, rij #196 en ADR 029's
   #195/#196-notitie naar de ronde-2-staat (`table_evicted`/`evicted`, one-snapshot fetch, skip-locked touch) — die
   drie plekken liggen in #122's conflictzone en zijn daarom NIET in sessie 73 aangepast.
2. Daarna `GDPR_PURGE_APPLY=1` + één bewaakte run (owner), dan #162's A/B (echte spend, owner).

Bindende kaders en owner-steers: principes (a)/(b)/(c); R6 — een chip-take is altijd een NIEUW gevalideerd
resultaat; de tien #197-beslissingen + de sessie-70/72-defaults zijn defaults — owner veto bij uitzondering. Geen
prompt-bytes, geen fixture-herrecording, geen live DDL zonder owner. Sessiemodel denkt, fan-out op goedkopere tiers.
8 GB machine: `npm ci` (root + web) vóór elke lokale verificatie; het volledige blok als losgekoppeld script
(`scripts/verify-block.sh <checkout> <log>`, ~8 min, achter de mutex `pgrep -f "[n]ode.*vitest"` — nooit
`pgrep -f vitest` in een shell die dat woord zelf bevat); `npm run test:docs` (1 s) vóór elke docs-push; na een
merge wachten tot zijn deploy klaar is vóór je opnieuw pusht. Autonoom en zonder owner-antwoord in de chat: NIET
mergen (#118 regel b) — sessie 73 hield zich daaraan en deed alleen het voorwerk.

Niet herontdekken: #132 route B (owner: uitstellen); `npm run lint` in `web/` kapot (task chip); #197-ideeën 4–8
ongepland; de drie #197-follow-ups bewust niet gebouwd; #199 (bewijspaneel op het dashboard) heeft een klein
read-model-WP nodig; #178's TTL-helft blijft de owner's keuze; #198 geparkeerd. Zolang de PRs open staan: raak op
`main` NIET de bestanden aan die zij bewerken (open-questions, 04-architecture, 08-build-plan, ADR 024/029, de
RUNBOOK-plekken rond regels ~83 / ~632 / ~1072) — dat maakt een nieuw conflict; RUNBOOK "Reviewing and merging a large
PR batch" item 9 is het recept voor een volgende PR-batch. De structurele #196-follow-up (eviction moet WIJKEN voor
een lopende read: een advisory lock per tabel of een 'marked for eviction'-fase) hoort VÓÓR elke automatisering van
`tables:evict --apply`; sessie 73 heeft hem opgeschreven, niet gebouwd. Review-diepte: LOW is de push-vloer, een
HIGH-pass per core-product-PR vóór de merge (RUNBOOK batch-item 10).

Sessie-einde: de volledige wrap-up-ritual uit CLAUDE.md — ongevraagd, compleet, elk feit geverifieerd tegen
`git`/`gh`/prod, nooit uit het geheugen.

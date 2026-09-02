# Session 71 kickoff — paste this as the first message

Written at the session-70 close-out, 2026-09-02 (evening). Durable copy of the handoff; the chat may be
gone, the repo is the source of truth. Every fact below was verified against `git log` / `gh pr list` /
`gh run list` / production audit rows at the time of writing.

---

Lees in deze volgorde vóór je iets doet: `CLAUDE.md` → `docs/STATUS.md` (het bovenste blok is de waarheid)
→ `docs/session-briefs/2026-09-02-session-71-kickoff.md` (dit bestand) → `docs/status-archive.md`
(sessie-70-entry, bovenaan). Verifieer jezelf eerst met `date +%Y-%m-%d`, `git log -3 --oneline`,
`gh pr list --state open` (verwacht: precies één draft PR, **#118**, branch `feat/197-3-comparison-chips`
op `e6b5846`) en `gh run list --branch feat/197-3-comparison-chips -L 2` + `gh run list --branch main -L 3`.
Rood = eerst fixen, geen nieuw werk. **Let op: sessie 70 draaide per ongeluk TWEE keer** (de kickoff werd
in twee sessies geplakt; de tweede werd reviewer in een worktree `.claude/worktrees/s70-reviewer`). Check
`git worktree list` en verwijder die worktree als hij er nog staat en niemand hem gebruikt
(`git worktree remove .claude/worktrees/s70-reviewer`); check ook met `list_sessions` of er geen tweede
sessie 71 loopt vóór je iets schrijft.

**Stand (sessie 70, 2026-09-02):** #197 stap 3 (vergelijkingschips) is GEBOUWD op de branch, geverifieerd
(backend 114 bestanden / 1733 tests, benchmark 14/14 + 6/6 + 0 fabricated, web 537/537, `next build`, LOW
review 0 findings, onafhankelijke design-review door de tweede sessie: 7 verdicts verwerkt; de
reviewer-sessie heeft `02a328e` daarna zelf opnieuw geverifieerd met dezelfde uitkomsten; haar ene
kleine finding — een overbodige, handmatig gekopieerde regio-grens naast de schema-gate — is verwijderd in
de follow-up `e6b5846`, branch-CI groen op beide commits) en staat als draft PR #118 — **NIET
gemerged.** Let op bij docs-pushes: de #132-test verbiedt live PR-links in `docs/` (schrijf `PR #118`,
nooit `[#118](https://…/pull/118)`); de twee wrap-up-commits van sessie 70 gingen daarop rood en zijn
gefixt in `fcbb479` (run 33642409302 groen, gate + deploy) en de reviewer-commit `f3c3236` erna ook groen
(run 33643051369) — check het zelf met `gh run list --branch main -L 3`.
Reden voor het niet-mergen: de WP26 smoke test is nog steeds niet gedaan — productie
`audit_answers` bevat nul rijen met `deterministic/wp26-click-option`; de drie rijen van de owner op
02-09 12:43Z (ids 257–259) waren Anthropic `529 overloaded_error`, elk terugbetaald (ledger 94/96/98),
geen code-bug. `CLARIFY_CLICK_ENABLED` staat AAN in productie (`83aa84c`). `ANSWER_FIRST_ENABLED` en
`GDPR_PURGE_APPLY` onaangeroerd (owner-supervised). #197 stappen 1+2 zijn live.

**Dé volgende prioriteit, in deze volgorde, niets anders eerst:**
1. **Check of de owner de WP26 smoke test heeft gedaan — in productie, niet door te vragen:** query
   `audit_answers` read-only (root `.env`, `connectFromEnv`, zie de sessie-70-archive-entry) op rijen met
   `llm_calls::text like '%wp26-click-option%'` of `reply_text is not null` sinds 02-09. Nul rijen = niet
   gedaan → vraag de owner de 3 stappen te doen (RUNBOOK "WP26 answer-first + clickable options", stap 4:
   inloggen, kale "Utrecht", chip klikken). Zonder bevestiging: **#118 niet mergen**, geen
   `ANSWER_FIRST_ENABLED`.
2. **Na bevestiging: merge #118** (owner aanwezig → jij mag direct; check eerst dat de branch-CI groen was
   — `gh run view 33638609958` en `33638618181` — en rebase/merge op de dan-actuele `main`; er staan
   alleen docs-only commits van sessie 70 op `main` na `f2f4bb6`, geen conflict te verwachten behalve
   mogelijk in `docs/open-questions.md`/`STATUS.md` — neem beide kanten). Daarna prod-canary: `/` 200 en
   RUNBOOK stap 6 ("Vergelijk met Nederland" onder een Amsterdam-antwoord: 2 balken, 20 credits, audit-rij
   met het click-model, `reply_text` = het label) — dat laatste is weer de owner (inloggen).
3. Daarna `ANSWER_FIRST_ENABLED` (één vlag tegelijk, owner-supervised; RUNBOOK rollback-volgorde: klik-vlag
   eerst uit, B een dag later), dan `GDPR_PURGE_APPLY=1` + één bewaakte run (owner), dan #162's A/B.

**Bindende kaders en owner-steers:** principes (a)/(b)/(c); R6 — een chip-take is altijd een NIEUW
gevalideerd resultaat, nooit een client-merge; de tien #197-beslissingen + de sessie-70-defaults (geen
"Sinds 2008"-chip; carrier-chips niet herspeeld bij thread-hervatting; audit-`question` = de
oorspronkelijke vraag, label = `reply_text`; cap blijft 3) zijn defaults — owner veto bij uitzondering,
niet opnieuw vragen. **Vastgelegde follow-ups die je NIET zomaar bouwt:** de "Nederland had de hoogste
waarde"-tautologie in de template-vergelijking (R8-divergentie → known-divergences pin + `audit:verify`
vóór wijziging), "geschiedenis-titel = reply_text", carrier herstellen bij hervatting — alle drie in #197.
Geen prompt-bytes, geen fixture-herrecording, geen live DDL zonder owner. Sessiemodel denkt, fan-out op
goedkopere tiers. 8 GB machine: backend-suite solo, exit codes lezen (137 = OOM-kill), en **geen
broncode wijzigen terwijl de suite draait** (sessie-70-les: de run wordt dan ongeldig zonder melding).

**Bewust NIET gedaan, niet herontdekken:** #132 route B (owner: uitstellen); `npm run lint` in `web/` kapot
(task chip bestaat); open-questions.md-prune en 26 oude lokale branches "whenever a session has room";
kaartweergave geparkeerd; #197-ideeën 4–8 ongepland.

**Sessie-einde:** de volledige wrap-up-ritual uit CLAUDE.md — ongevraagd, compleet, elk feit geverifieerd
tegen `git`/`gh`/prod, nooit uit het geheugen.

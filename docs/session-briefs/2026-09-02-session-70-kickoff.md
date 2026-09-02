# Session 70 kickoff — paste this as the first message

Written at the session-69 wrap-up, 2026-09-02. Durable copy of the handoff; the chat may be gone, the
repo is the source of truth. Every fact below was verified against `git log` / `gh run list` /
`gh pr list` / prod at the time of writing.

---

Lees in deze volgorde vóór je iets doet: `CLAUDE.md` → `docs/STATUS.md` (het bovenste blok is de waarheid)
→ `docs/session-briefs/2026-09-02-session-70-kickoff.md` (dit bestand) → `docs/status-archive.md`
(sessie-69-entry, bovenaan). Verifieer jezelf eerst met `date +%Y-%m-%d`, `git log -3 --oneline`,
`gh pr list --state open` en **`gh run list --branch main -L 4`** — de code-commits van sessie 69
(`da47566` run 33630872233, `1d2140f` run 33631282656) zijn gemeten groen (gate + deploy, dus live);
alleen de docs-only wrap-up-commits (`c40c35e`, `0f96af5`) liepen nog bij het afsluiten. Rood = eerst
fixen, geen nieuw werk.

**Stand (sessie 69, 2026-09-02, owner aanwezig):** migraties 022–025 staan live; `CLARIFY_CLICK_ENABLED`
staat AAN in productie (`83aa84c`) maar de LIVE smoke test (RUNBOOK "WP26 answer-first + clickable
options", 3 stappen: inloggen, kale "Utrecht", chip klikken) is NIET bevestigd — Claude kan niet
inloggen, dat is de owner. `ANSWER_FIRST_ENABLED` en `GDPR_PURGE_APPLY` onaangeroerd (echte verwijdering
en env-flips blijven owner-supervised — CLAUDE.md). #193 dicht (live `audit:verify`, 0 afwijkingen).
#170(3) chart-download PNG/SVG live (`4d7ac2d`). #197 chart-UX-onderzoek gedaan (5-agent Workflow, één
verzonnen "palette validator"-claim gevangen en verwijderd), owner zei GO; **stap 1 (`da47566`: labels,
kleurenblind-veilig palet, toegankelijkheid, tap-to-pin, menu-semantiek, export-fix) en stap 2
(`1d2140f`: Grafiek/Tabel-schakelaar) zijn gebouwd en gepusht.** Nul open PR's, `main` == `origin/main`.

**Dé volgende prioriteit — in deze volgorde, niets anders eerst:**
1. **Vraag de owner de WP26 smoke test te doen** (of check of hij dat al deed). Zonder bevestiging: geen
   stap 3, geen `ANSWER_FIRST_ENABLED`.
2. **Na bevestiging: #197 stap 3 — vergelijkingschips.** Spec: `docs/08-build-plan.md` sectie "#197" +
   `docs/session-briefs/2026-09-02-session-69-chart-ux-research.md` (shortlist #3, §3 stap 3). Vijfde
   generator in `src/answer/respond/suggestions.ts` (naast adjacentPeriod/trend/regionVariant/sameTopic,
   `MAX_SUGGESTIONS = 3`), volledig opgeloste `StructuredIntent`s, `echoServability`-gated (geen celwaarden
   in de dry-run), aangeboden als `ClickOption`s via het bestaande `templateOnly: true` take-path
   (`src/answer/respond/respond.ts`), 20 credits, echte audit-rij. Invarianten: R1, R6 (nooit een
   client-merge van twee antwoorden), principe (c): geen nationale rij in de tabel → geen "Vergelijk met
   Nederland"-chip. Dit is core-product + money-path code: volledig verificatieblok + LOW `/code-review`
   vóór elke push; owner aanwezig → direct naar `main` (#118); autonoom → branch + PR.
3. Daarna `ANSWER_FIRST_ENABLED` (owner-supervised, één vlag tegelijk), dan `GDPR_PURGE_APPLY=1` + één
   bewaakte run (owner doet het), dan #162's A/B (owner-terugkoppeling is deel van de methode).

**Bindende kaders en owner-steers:** principes (a)/(b)/(c); R6 — renderers rekenen niets, elk zichtbaar
getal is een spec-string gebonden via `data-label-for` (`web/components/chart.test.tsx` pint dit tegen de
ECHTE svg in jsdom: laat `ResizeObserver` undefined, `initialDimension` doet de rest); het #197-brief's
tien beslissingen zijn als defaults genomen (per-device voorkeuren, export bakt in wat op het scherm staat,
neutraal gevalideerd palet, template-only kopregel, chat én Ontdek) — owner veto bij uitzondering, niet
opnieuw vragen. Geen prompt-bytes, geen fixture-herrecording, geen live DDL zonder owner. Modelverdeling:
sessiemodel denkt, fan-out op goedkopere tiers (rollen, geen modelnamen). 8 GB machine: backend-suite
solo draaien, exit codes lezen (137 = OOM-kill, geen pass).

**Bekend en bewust NIET gedaan (niet herontdekken):** CSV-item in het download-menu (WP21-knop staat al
onder elk chat-antwoord); ideeën 4–8 van #197 (kopregel, "bewijs dit punt" + revisiehistorie — vraagt een
migratie —, reeks-toggles, lees-toggles, small multiples) ongepland; kaartweergave geparkeerd; #132 route
B opnieuw uitgesteld door de owner; `npm run lint` in `web/` is kapot (ESLint 10 vs eslint-plugin-react)
— task chip bestaat, staat niet op CI; open-questions.md ~320 KB prune en 26 oude lokale branches blijven
"whenever a session has room", branches alleen owner-present.

**Sessie-einde:** de volledige wrap-up-ritual uit CLAUDE.md (lessons, memory, STATUS + archive, stale-doc
sweep, clean state, cleanup, kickoff-bestand, self-audit) — ongevraagd, compleet, met elk feit
geverifieerd tegen `git`/`gh`/prod, nooit uit het geheugen.

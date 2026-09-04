# Session 77 kickoff — paste this as the first message

Written at the session-76 close-out, 2026-09-04 (~07:5xZ). Durable copy of the handoff; the chat may be gone, the
repo is the source of truth. Every fact below was verified against `git log`, `gh pr list`, `gh run list`,
`gh pr checks` and `curl` at the time of writing. Supersedes `2026-09-03-session-76-kickoff.md` (written by
session 75; this session, 76, executed it — twice, once per owner instruction to keep going).

---

Lees in deze volgorde vóór je iets doet: `CLAUDE.md` → `docs/STATUS.md` (het bovenste blok is de waarheid — sessie
76 heeft TWEE blokken: het hoofdblok en een "Later the same session" vervolg, beide bovenaan) →
`docs/session-briefs/2026-09-04-session-77-kickoff.md` (dit bestand) → `docs/status-archive.md` (sessie-76-entry,
bovenaan, items 1-16). Verifieer jezelf eerst: `date +%Y-%m-%d`, `git log -3 --oneline` (verwacht bovenaan
`157d1a1` — sessie 76's tweede docs-push), `gh pr list --state open` (verwacht precies vijf: **#126/#127/#128**
— sessie 76's eigen drie PRs, groen, NIET gemerged — plus Dependabot **#124** (GEBLOKKEERD, zie hieronder) en
**#125** (schoon, klaar voor merge)), `gh run list --branch main --workflow ci.yml -L 3` (alles `success`) en
`curl` op `/`, `/llms.txt`, `/api/health` (allemaal 200 — laatst geverifieerd na de `157d1a1`-deploy). Rood = eerst
fixen. **Tweede-instantie-check: `ListAgents`, niet alleen `list_sessions`** (zie sessie 75's les — een
cloud-sessie is onzichtbaar voor `list_sessions`). Vergelijk elke open-PR-kop met wat deze kickoff verwacht.

**Stand (sessie 76, 2026-09-04, AUTONOOM — owner: "I will be gone for hours... use multiple sub-agents", geen
antwoord in de chat de hele sessie):**

1. **Drie PRs gebouwd en open, NIET gemerged** (CLAUDE.md #118(b): autonome sessie + core-product code = branch +
   PR + owner review, nooit direct mergen) — de enige drie items die de docs expliciet aanwezen als "hermetisch,
   een sessie mag ze oppakken" (rijen #73/#79/#196):
   - **PR #126** (`fix/73-carrier-on-chatmessage`, kop `146594c`): de WP29 klik-chip-carrier verhuisd van een
     index-keyed ref naar `ChatMessage` zelf (nu `chat-message.ts` vrij is sinds #123); `capturedThreadId` +de
     carrier's eigen `threadId` gedropt (bewezen equivalent aan altijd de live `threadId` sturen). HIGH review:
     schoon, 0 findings.
   - **PR #127** (`fix/79-shared-derived-predicate`, kop `5bda716`): één gedeelde `isDerivedResult()` voor R5's
     markeringsregel; fixt een echte bug in `csv.ts` (liet de "Bewerking:"-regel weg bij een direction/first_last
     -only derivation, terwijl elk ander oppervlak 'm wél toonde). HIGH review: schoon, 0 findings.
   - **PR #128** (`fix/196-eviction-resolve-race`, kop `ef4e35a` na ronde 2): een advisory lock per tabel sluit de
     eviction-vs-`resolveIntent`-race. HIGH review vond 3 échte findings (een ongedocumenteerde lock-koppeling met
     `pipeline.ts`'s `--rebaseline`, een ondertelde query-cost tripwire, een ongedocumenteerde aanname) — alle drie
     gefixed in ronde 2, herverifieerd. **Let op vóór je merget:** de nieuwe lock is `SHARED` bij elke chat-query en
     `EXCLUSIVE` tijdens zowel `tables:evict --apply` als de handmatige `--rebaseline`-sync, zonder `lock_timeout` —
     vandaag geaccepteerd risico (beide kanten handmatig/supervised), maar lees PR #128's "Review round 2" sectie
     voor de volledige afweging gezien dit project's #173/#188/#190 pooler-geschiedenis.
2. **Dependabot #125: geverifieerd schoon, klaar voor je merge-klik.** Alle 8 bumps gecheckt tegen echt gebruik,
   geen relevante breaking change; volledig verify-block groen; comment geplaatst.
3. **Dependabot #124: GEBLOKKEERD — bevestigd met bisectie, geen gok.** `zod` 4.4.3→4.5.4 breekt het hermetische
   LLM-replay-fixture-systeem (`z.toJSONSchema()`'s output-bytes veranderen genoeg om de request-hash te
   veranderen); zod alleen terugzetten naar 4.4.3 (de andere 4 bumps ongemoeid) herstelde `GATE VERDICT: PASS`.
   Bewijs staat in PR #124's comments. **Niet mergen zoals-ie is.** Nieuwe rij **open-questions #200** legt de
   onderliggende kwetsbaarheid vast (elke toekomstige, niet-gedrags-wijzigende zod-bump kan hetzelfde doen).
4. **Rij #63 onderzocht (read-only, geen code aangeraakt):** het region-preset-gat is nog steeds bereikbaar na
   WP26, maar de praktische winst is klein vandaag (de enige klikbare optie zou bijna altijd zelf ook falen op het
   moment dat dit pad vuurt) — vastgelegd in de rij, bewust niet gebouwd.
5. **Onderhoud, read-only:** `gdpr:purge` dry-run opnieuw gemeten (0 rijen overal, ongewijzigd t.o.v. 03-09);
   `npm audit` root 0 kwetsbaarheden; web-kant tweemaal een npm-registry-timeout (geen bevinding, gewoon
   onbereikbaar — niet verder geprobeerd, lage waarde check).
6. **Twee losse docs-only pushes naar `main`** (`47a201d` toen `157d1a1`), allebei groen + gedeployed + canaries
   200. Geen spend, geen prompt-bytes, geen DDL, geen flag-flips, geen merges.

**Dé volgende prioriteit, in deze volgorde — niets urgent:**

1. **Merge #126/#127/#128 (owner):** onafhankelijke files, maar alle drie raken `docs/STATUS.md` en
   `docs/open-questions.md` op verschillende rijen — verwacht triviale doc-conflicts, geen code-conflicts (net als
   sessie 73's #121/#122-precedent). Elke PR draagt zijn eigen rij-#73/#79/#196-update; die landen op `main` bij de
   merge, niet eerder.
2. **Dependabot #125 (owner):** mergen kan direct, is schoon.
3. **Dependabot #124 (owner):** NIET mergen zoals-ie is — of opnieuw indienen zonder `zod`, of wachten tot de
   fixture-hash-kwetsbaarheid (rij #200) is aangepakt. Jouw keuze.
4. **`GDPR_PURGE_APPLY=1` + één bewaakte run (owner)** — dry-run-baseline 2026-09-04: 0 rijen overal.
5. **#162's A/B (owner, echte spend ~€1-2).** Daarna #132 route B GO of uitstellen (laatst gevraagd 2026-09-02).
6. **Owner-menu (ongewijzigd):** WP30c-keuze (Rijksfinanciën `80504NED`, `Gediscontinueerd`), #199 (bewijspaneel op
   het dashboard — klein read-model-WP), #197-ideeën 4–8, de drie #197-follow-ups.
7. **Rij #200 (fixture-hash-fragiliteit) en rij #63 (region-preset-gat)** liggen open, bewust niet geprioriteerd —
   geen actie nodig tenzij je anders beslist.

**Bindende kaders en owner-steers:** principes (a)/(b)/(c); R6 — een chip-take is altijd een NIEUW gevalideerd
resultaat; de tien #197-beslissingen + de sessie-70/72/74-defaults blijven defaults — owner veto bij uitzondering.
Geen prompt-bytes, geen fixture-herrecording (rij #200 laat zien waarom dat sowieso gevoelig ligt), geen live DDL
zonder owner. Sessiemodel denkt, fan-out op goedkopere tiers — al bleef sessie 76 op het sessiemodel voor alle
bouw/review-werk gezien de kern-product-inzet. 8 GB machine: `npm ci` (root + web) vóór elke lokale verificatie;
het volledige blok losgekoppeld (`scripts/verify-block.sh`, ~8-25 min afhankelijk van machinebelasting, mutex
`pgrep -f "[n]ode.*vitest"`); `npm run test:docs` (1-2 s) vóór elke docs-push (sessie 76 ving zichzelf twee keer op
een live-PR-markdown-link — #132 interim-regel (i) — vóórdat de test het deed, en één keer NA); na een merge
wachten tot zijn deploy klaar is vóór je opnieuw pusht; `gh run list --commit` wil de VOLLE sha. Autonoom en zonder
owner-antwoord in de chat: NIET mergen (#118 regel b) — dit gold de hele sessie 76, geen enkele PR is gemerged.
Review-diepte: LOW is de push-vloer, HIGH per core-product-PR vóór de merge (RUNBOOK batch-item 10) — sessie 76's
eigen Workflow-pijplijn (build → onafhankelijke HIGH-review → conditionele fix) vond op #128 drie échte problemen
die de bouw-agent's eigen LOW-zelfreview miste; de moeite van een onafhankelijke reviewer-agent waard op
core-product-PRs die de owner niet zelf kan bekijken.

**Niet herontdekken:** #132 route B (owner: uitstellen); `npm run lint` in `web/` kapot (task chip); #197-ideeën
4–8 ongepland; de drie #197-follow-ups bewust niet gebouwd; #178's TTL-helft blijft de owner's keuze; #198
geparkeerd; rij #200 en rij #63 zijn nieuw deze sessie, allebei bewust niet gebouwd (zie boven).

Sessie-einde: de volledige wrap-up-ritual uit CLAUDE.md — ongevraagd, compleet, elk feit geverifieerd tegen
`git`/`gh`/prod, nooit uit het geheugen en nooit uit een reviewer-claim.

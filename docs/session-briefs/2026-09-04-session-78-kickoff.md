Session 78 kickoff — paste this as the first message

Written at the session-77 close-out, 2026-09-04 (~12:4xZ). Durable copy of the handoff; the chat may be gone, the
repo is the source of truth. Every fact below was verified against `git log`, `gh pr list`, `gh pr checks`,
`gh run list`, `git worktree list`/`git branch`, and `npm run gdpr:purge` / `npm audit` at the time of writing.
Supersedes `2026-09-04-session-77-kickoff.md` (written by session 76; this session, 77, executed it).

Lees in deze volgorde vóór je iets doet: `CLAUDE.md` → docs/STATUS.md (het bovenste blok is de waarheid — sessie
77 heeft daar nu haar EIGEN blok, boven sessie 76's blok) → docs/session-briefs/2026-09-04-session-78-kickoff.md
(dit bestand) → docs/status-archive.md (sessie-77-entry, bovenaan) → docs/lessons-learned.md (sessie-77-entry —
lees dit VOORDAT je open-questions.md opnieuw gaat triëren, zie hieronder waarom).

Verifieer jezelf eerst: `date +%Y-%m-%d`, `git log -3 --oneline` (verwacht bovenaan `e01379c` — sessie 77's laatste
docs-push), `gh pr list --state open` (verwacht precies zes: #126/#127/#128
(sessie 76's drie PRs) + #129 (sessie 77's PR, alle vier groen, NIET gemerged) plus Dependabot
#124 (GEBLOKKEERD, zie STATUS) en #125 (schoon, klaar voor merge)), `gh run list --branch main -L 3`
(alles `success`), en `git worktree list` + `git branch` (verwacht ALLEEN `main` + de vier lokale tracking-branches
van de open PR's — sessie 77 ruimde 2 achtergebleven worktrees + 6 losse branches op, waarvan 2 zelfs van sessie 76
waren; controleer dit zelf in plaats van op een eerdere "opgeruimd"-claim te vertrouwen, zie lessons-learned).
Tweede-instantie-check: `ListAgents` (niet alleen `list_sessions`) — bij het schrijven van dit bestand geen andere
actieve sessie op deze repo. Rood = eerst fixen. Vergelijk elke open-PR-kop met wat deze kickoff verwacht.

Stand (sessie 77, 2026-09-04, AUTONOOM — owner: "up to you, work autonomously for hours and hours" in een
owner-aanwezige chat, daarna weg; één gerichte merge-authority-vraag gesteld en beantwoord ("leave queued for your
review") vóórdat er iets werd aangeraakt):

1. **Hertriage van open-questions.md (150 rijen) leverde vooral RUIS op — les voor de toekomst, niet alleen een
   resultaat.** Een 5-agent Workflow retourneerde 8 kandidaten; handmatige verificatie van ELK item toonde dat 7
   fout waren: 3 waren exacte duplicaten van sessie 76's eigen open PRs (#73/#79/#196 = PR
   #126/#127/#128), 1 was al onderzocht en bewust niet geprioriteerd (#63), 1 is al 5+ sessies een
   owner-menu item (#199), en 2 beschreven content die NIET bij de echte rij hoort — rij #90 bestaat niet eens in het
   levende bestand, rij #99's echte inhoud (de site-footer, allang afgetekend) heeft niets te maken met wat de
   agent verzon. **Alleen #200 richting (b) overleefde verificatie.** Een tweede, bewijs-verplichte stale-doc-sweep vond 2 kandidaten
   waarvan er ook 2 loos alarm bleken (rij #196: vergeleek een niet-gemergede PR-branch met `main`; rij #34: had de
   fix al verderop in dezelfde lange cel staan) — alleen rij #110 was een echte (kleine) omissie, direct gefixed.
   **CONCLUSIE, bevestigd over twee onafhankelijke sessies nu: de hermetische wachtrij is echt leeg.** Herhaal deze
   triage niet zonder een nieuwe invalshoek — lees eerst [lessons-learned.md](../lessons-learned.md)'s sessie-77-
   entry voor precies welke twee patronen valse positieven opleverden.
2. **PR #129** (`fix/200-fixture-hash-diagnostic`, ronde-2-kop `c5e5b34`): een diagnostische verbetering voor de
   hermetische LLM-fixture-replay-harness — bij een fixture-hash-miss wordt nu gezocht naar een "near-miss" fixture
   die alleen in `jsonSchema` verschilt (het #124 zod-bump-signaal), en die wordt dan bij naam genoemd i.p.v. een
   generieke foutmelding. HIGH review vond 1 echte low-severity bevinding (de melding overclaimde de oorzaak),
   gefixed in ronde 2. `requestHash()`/`stableStringify()`/`RecordingLlmClient`/alle vier `jsonSchema`-call-sites
   ONGEWIJZIGD — nul prompt-byte-risico, en `ReplayLlmClient` wordt nooit in productie gebruikt (alleen CI/tests).
   CI groen (`gate: pass` beide runs), 757/757 backend-tests. **OPEN, niet gemerged** — per #118(b).
3. Onderhoud, read-only: `npm audit` root + web beide 0 kwetsbaarheden; `gdpr:purge` dry-run 0 rijen overal (verse
   baseline, ongewijzigd t.o.v. elke eerdere meting).
4. Drie docs-only pushes naar `main` (`e28bae9`, `e01379c`, en de wrap-up-commit die dit bestand toevoegt), allemaal
   groen + gedeployed + smoke-check gepasseerd. Geen spend, geen prompt-bytes, geen DDL, geen flag-flips, geen
   merges.
5. Opruiming: 2 achtergebleven worktrees + 6 losse lokale branches verwijderd (waarvan 2 zelfs van sessie 76's
   eigen workflow, ondanks die sessie's eigen claim dat alles was opgeruimd — geverifieerd vóór verwijdering dat
   niets verloren ging).

Dé volgende prioriteit, in deze volgorde — niets urgent:

1. Merge #126/#127/#128/#129 (owner): verwacht triviale doc-conflicts (STATUS.md/open-questions.md), geen code.
2. Dependabot #125 (owner): mergen kan direct.
3. Dependabot #124 (owner): NIET mergen zoals-ie is (zod-regressie, zie PR #124's comments voor de bisectie).
4. `GDPR_PURGE_APPLY=1` + één bewaakte run (owner) — dry-run-baseline 2026-09-04: 0 rijen overal.
5. #162's A/B (owner, echte spend ~€1-2). Daarna #132 route B GO of uitstellen.
6. Owner-menu (ongewijzigd): WP30c-keuze, #199, #197-ideeën 4–8, de drie #197-follow-ups.
7. **Geen nieuwe hermetische-triage-ronde** tenzij er een genuinely nieuwe invalshoek is (niet: "scan open-
   questions.md opnieuw") — twee sessies hebben dat nu grondig gedaan en zijn tot dezelfde conclusie gekomen.

Bindende kaders: principes (a)/(b)/(c); geen prompt-bytes, geen fixture-herrecording, geen live DDL zonder owner.
8 GB machine: `npm ci` vóór elke lokale verificatie; scripts/verify-block.sh + mutex `pgrep -f "[n]ode.*vitest"`;
`npm run test:docs` vóór elke docs-push. Autonoom zonder owner-antwoord: NIET mergen (#118 regel b). Bij "werk
autonoom" met een levende owner-aanwezige chat: stel ÉÉN gerichte vraag als dat conflicteert met een herbevestigde
regel (zoals de merge-gate) — niet stilzwijgend negeren, niet stilzwijgend volgen (zie feedback-memory
`ask_before_reversing_standing_rules`, opnieuw toegepast sessie 77).
Niet herontdekken: #132 route B (uitstellen); `npm run lint` in `web/` kapot (task chip); #197-ideeën 4–8
ongepland; #178's TTL-helft/#198 blijven owner's keuze; rij #200(a) (hash-normalisatie, zou alle fixtures
her-recorden — owner-begeleid); rij #63 blijft bewust niet gebouwd.
Sessie-einde: de volledige wrap-up-ritual uit CLAUDE.md — ongevraagd, compleet, elk feit geverifieerd (incl.
`git worktree list`/`git branch`, niet alleen `git status`).

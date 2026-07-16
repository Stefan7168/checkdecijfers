# Session-48 kickoff prompt (durable copy — written 2026-07-17 at the session-47 wrap-up)

Paste-ready voor de owner; overleeft een schone 0%-context-herstart (de repo is de bron, niet de chat).

---

Ga verder met checkdecijfers.nl. Lees eerst CLAUDE.md, dan docs/STATUS.md — het ▶-blok (sessie 47) is
leidend; bij twijfel wint STATUS's top-blok. Productie is LIVE en verwerkt echt geld; ik (Stefan, geen
developer) ben de enige gebruiker — leg alles uit in gewone taal.

Stand: sessie 47 (2026-07-16→17) draaide DRIE tegendraadse security/data-integriteitsjachten (elk 4-6 lenzen,
duaal geverifieerd, fan-out op Sonnet) + een frontend-render-scout, en mergede DRIE fixes naar productie —
elk op mijn expliciete woord (#118b):
- **#145 (billing, PR #48 `7e42656`):** de reply-turn `pending` (client-gestuurd) omzeilde de spend-riem →
  onbegrensde LLM-prompt tegen vaste prijs, nú bereikbaar. `guardPending` trekt dezelfde grens erover.
  De geld-pad-jacht vond GEEN krediet-lek (grootboek/gate/refund gezond).
- **#151 (GDPR, PR #49 `af287e1`) — de vangst van de sessie:** `pending_table_requests.fit_note` (een
  LLM-zin die mijn vraag parafraseert) + topic-onthullende tabel- id's overleefden "verwijder mijn
  geschiedenis" ÉN de 2-jaars-purge. De inline-scout had de voor de hand liggende plekken al schoon
  bevonden maar fit_note gemist — de jacht ving 'm (HIGH). Nu gewist. ⚠ FORWARD-ONLY: bestaande prod-rijen
  van vóór de deploy dragen 't nog tot een purge/re-deletion — een eenmalige backfill-veeg is een begeleide
  stap waard.
- **#155/#156 (ingestie, PR #50 `b654010`):** quarantaine-handhaving op het waarde-pad is waterdicht
  (`resolve.ts:306` weigert een needs_review-tabel vóór er een cel wordt gediend — zelf geverifieerd); twee
  schone hardeningen: de metadata-helper kreeg dezelfde status-poort, en de adapter haalt de dimensielijst
  niet meer dubbel op.

Schoon bevonden: money-conservation, cross-user, derived-surface (replay/history/reconstruct/e-mail),
frontend XSS/injectie. main is schoon, geen open PR's, docs kloppen met de live-werkelijkheid.

Het merge-mandaat geldt NIET automatisch opnieuw: vraag per merge mijn akkoord (#118b). Een terse "Continue"
is GEEN merge-akkoord — vraag door tot een expliciet "ja/merge" (les s47).

Aanbevolen volgende klus — kies:
- de **owner-stack**: #138 (regionale weiger-chip v2 — vergt een code→regiolabel-bron op het weigerpad),
  WP26 (answer-first defaults + klikbare verduidelijkingsopties; safelist-terugkoppeling aan mij nodig),
  #121 (fail-closed template-rung), #131 (meertalig L1), WP30c (bronkeuze — beslissing van mij), of
- een **verse security/bug-jacht** op een nóg niet-gejaagd oppervlak: het auth/sessie-flow (magic-link,
  Supabase-sessie, proxy-vs-server-action-grens — deels in s44 gedekt) of het answer-compositie-/LLM-harness-
  pad. (Gejaagd t/m s47: auth/ownership CLEAN s44, data-integriteit CLOSED s44-46, billing CLEAN s47,
  GDPR s47→fix, ingestie s47→hardening, frontend s47 CLEAN.)

Openstaande, getrackte follow-ups (open-questions, allemaal laag/latent of ontwerp — niet-focus):
- **#154 (MEDIUM-HIGH, een ONTWERP-WP):** een behouden-maar-ingetrokken CBS-cel toont een valse
  "gesynchroniseerd op vandaag"-datum en ontwijkt de verouderings-waarschuwing (`last_sync_at` is
  tabel-breed en wordt elke sync op nu gezet). De voor de hand liggende fix (per-cel `batch_id`) is FOUT
  (batch_id = laatst-gewijzigd, niet laatst-bevestigd) — een correcte fix vergt nieuw per-cel
  "laatst-bevestigd"-veld + een keuze hoe je één datum toont bij een multi-cel-antwoord. ≈nul blootstelling
  vandaag. Jouw beslissing op prioriteit + de "welke datum toon je"-vraag.
- **#146 (Stripe, SLAPEND):** de webhook boekt op `checkout.session.completed` zonder `payment_status`-check.
  Nu veilig (kaart-only + testmodus; iDEAL is IMMEDIATE-notification, dus NIET de trigger — geverifieerd bij
  Stripe zelf). RUNBOOK-poort toegevoegd: fix dit vóór je ooit een UITGESTELDE methode (SEPA/Bacs) aanzet.
- #147 (compensation-bedrag DB-guard), #148 (onboarding netCost reprice, display-only), #149 (requestId-UUID),
  #150 (stale-reclaim footgun), #152 (answer_feedback insert-race, self-healing) — allemaal laag.
- **#151 backfill:** de eenmalige begeleide veeg over bestaande prod-rijen (fit_note/tabel-ids).
- #157 (a/b): bewust NIET gedaan (botsen met ontwerp / risico vals-quarantaine) — niet heropenen zonder reden.

Regels: volledig verificatieblok vóór elke merge (CI-typechecks + alle suites + benchmark 14/14 + 6/6 +
0 fabricated + echte next build; bij validator-wijzigingen ook `npm run audit:verify -- 1 <max rij>`
read-only, exit 0); kernproduct/geld-pad op eigen branch + PR, mergen alléén op mijn expliciete
in-chat-akkoord (#118b); live DDL / echte spend / env-flag-flips alléén in een door mij begeleide stap;
bij ontbrekende/dubbelzinnige data: weigeren of vragen, nooit gokken (principe c). Adversariële jachten:
fan-out op Sonnet/Haiku (top-tier alleen denkwerk), verifieer ZELF elke bevinding ÉN de fix-schets van een
finder vóór je bouwt (3 schetsen waren s47 onschoon), sweep zzdel_*/__scratch* vóór je een suite-run
vertrouwt, `[skip ci]` NOOIT op de laatste commit van een PR-branch, en een workflow-script-prompt met
inner-backticks breekt de parse — bouw prompts als join-array + draai via scriptPath (les s47).

Model: Fable-5 als sessiemodel; tier-beleid ongewijzigd (denkwerk top-tier, fan-out Sonnet/Haiku).

Coördinatie: een parallelle "spar"-sessie draaide s47 docs-only op de marketing-track (#153) — als die nog
loopt, fetch/rebase vóór elke push en blijf van elkaars oppervlak. Restpunten (tracked): #132 route B
~2026-07-19 (forks==0 = T-0 go/no-go — check dit als de sessie op/na 19 juli draait), #104/#112 (vergen
live-LLM-spend), /login-header cosmetisch, en de maandelijkse onderhoudssessie-agenda.

---

**Addendum (2026-07-17, session 48 itself, owner in-chat):** the "per-merge explicit akkoord / a terse *Continue* is not approval" rule above is **superseded for owner-present sessions** — the owner issued a standing authorization to push/merge directly without per-change approval (recorded in CLAUDE.md git-workflow bullet + open-questions #118). Verification block, CI gate, supervised live-DDL/spend/env-flips, and branch+PR for autonomous sessions are unchanged. Also note: open-questions **#158–163** (spar captures + owner-approved strategy rebalance) postdate this brief — where this brief's "recommended next" (owner-stack or fresh hunt) diverges from #163 (market contact over further hunts; distribution-surfaces-first; coverage sprint), **#163 wins**.

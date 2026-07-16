# Session-47 kickoff prompt (durable copy — written 2026-07-16 at the session-46 wrap-up)

Paste-ready voor de owner; overleeft een schone 0%-context-herstart (de repo is de bron, niet de chat).

---

Ga verder met checkdecijfers.nl. Lees eerst CLAUDE.md, dan docs/STATUS.md — het ▶-blok (sessie 46) is
leidend; bij twijfel wint STATUS's top-blok. Productie is LIVE en verwerkt echt geld; ik (Stefan, geen
developer) ben de enige gebruiker — leg alles uit in gewone taal.

Stand: sessie 46 (2026-07-16) maakte #144 in één sessie HELEMAAL af — de semantische verzin-checker is
gebouwd, adversarieel gereviewd (1 CRITICAL datumvorm-samenstelling-bypass gevonden én gedicht), gemerged
op mijn expliciet akkoord (PR #47, squash 94b90e4), en dezelfde avond door de begeleide go-live: kalibratie
9/9 (FP=0/FN=0, stabiel ×3, prompt v2 na een gemeten misser op de maand-samenstelling), replay-poot op de
CI-poort, mijn besluit = FAIL-OPEN + admin-mail per overslag (alerts.ts → ADMIN_ALERT_EMAIL), vlaggen gezet,
flip-deploy groen (run 29513127181), live smoke: audit-rij 253 draagt `skipped_no_suspects` en hervalideert
(audit:verify exit 0). De checker is LIVE en ACTIEF; hij kan alléén afkeuren, nooit goedkeuren. Daarmee is
de hele sessie-44-datajachtlijst dicht (#140 t/m #144). main is schoon, geen open PR's, docs kloppen met de
live-werkelijkheid (ADR 034 = het ontwerp; RUNBOOK § "#144 semantic checker" = het as-executed-verslag).

Het merge-mandaat geldt NIET automatisch opnieuw: vraag per merge mijn akkoord (#118b).

Aanbevolen volgende klus — kies:
- een gerichte security/bug-jacht op een nieuw oppervlak (billing-gate of GDPR-redactie — de laatste
  jachten op auth/ownership en data-integriteit waren schoon resp. zijn nu dicht), of
- de owner-stack: #138 (regionale weiger-chip v2 — vergt een code→regiolabel-bron op het weigerpad),
  WP26 (answer-first defaults + klikbare verduidelijkingsopties; safelist-terugkoppeling aan mij nodig),
  #121 (fail-closed template-rung), #131 (meertalig L1), WP30c (bronkeuze — beslissing van mij).

Regels: volledig verificatieblok vóór elke merge (CI-typechecks + alle suites + benchmark 14/14 + 6/6 +
0 fabricated + echte next build; bij validator-wijzigingen ook `npm run audit:verify -- 1 <max rij>`
read-only, exit 0); kernproduct/geld-pad op eigen branch + PR, mergen alléén op mijn expliciete
in-chat-akkoord (#118b); live DDL / echte spend / env-flag-flips alléén in een door mij begeleide stap;
bij ontbrekende/dubbelzinnige data: weigeren of vragen, nooit gokken (principe c). Adversariële reviews:
fan-out op Sonnet/Haiku (top-tier alleen denkwerk), een boom-muterende lens draait ALLEEN geserialiseerd
als laatste tegen een gecommitte staat, sweep zzdel_*/__scratch* vóór je een suite-run vertrouwt, en:
`[skip ci]` NOOIT op de laatste commit van een PR-branch (onderdrukt de hele PR-poort — les s46).

Semantische-checker-notities voor wie eraan raakt: elke prompt/schema/model-wijziging hervalt de replay-poot
(tests/answer/semantic-check-replay.test.ts) → herrecorden met `npm run semantic-check:record` (kleine echte
spend, begeleid) en de eval-poort FP=0/FN=0 ×3 geldt opnieuw; een bevestigde bypass is pas dicht als hij
drie keer bestaat (code-fix + gepinde regressietest + labelled-set-case — les s46).

Model: Fable-5 als sessiemodel; tier-beleid ongewijzigd (denkwerk top-tier, fan-out Sonnet/Haiku).

Restpunten (tracked, niet-focus): #132 route B ~2026-07-19 (forks==0 = T-0 go/no-go — check dit als de
sessie op/na 19 juli draait), #104/#112 (vergen live-LLM-spend), /login-header cosmetisch, en de
maandelijkse onderhoudssessie-agenda (o.a. de websearch-orphan-query en nu ook: een blik op
semantic-check-verdicts in audit_answers — `status='error'`-rijen horen een admin-mail te hebben opgeleverd).

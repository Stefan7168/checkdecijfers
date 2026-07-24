# Kickoff — sessie 56 (na sessie 55, de eerste post-Fable-sessie)

**Geschreven door sessie 55 (2026-07-18, autonoom).** Leesvolgorde: CLAUDE.md → docs/STATUS.md (▶-blok bovenaan is
leidend) → dit bestand. De chat is weg; de repo is de bron.

## Model: Fable zit in het plan (owner, 18-07, in-chat — vervangt de wissel-aanname)

Sessie 55 draaide op Fable 5 en de owner heeft dat mid-sessie tot plan verklaard: **"Fable is in our plan now."**
De s54-aanname "laatste Fable-sessie, daarna Opus/Sonnet" is daarmee ingetrokken — geen runtime-model-mismatch
meer melden. Ongewijzigd blijft de rol-gebaseerde delegatieregel: het sessiemodel doet het denkwerk,
fan-out/legwork op Sonnet/Haiku, tiers per rol benoemd, nooit modelnamen hardcoden.

## PR #57 — ✅ afgehandeld (owner kwam dezelfde dag terug in de chat: "Go")

**PR #57 is gemerged (`12381e3`) en LIVE geverifieerd:**
`/llms.txt` HTTP 200 op prod (20 registertabellen, gemeten syncdatums) en de SourceBadge op alle vier de
Ontdek-charts, elk aan zijn eigen tabel-ID gebonden. Deploy-run 29634774649 groen incl. de nieuwe
/llms.txt-smoke. ⚠ Twee keer gemeten merge-val: de squash-message vouwt branch-commit-subjects in de body — een
`[skip ci]` in een gefolde docs-commit skipte gate+deploy, en een trigger-commit die de marker CITEERDE werd óók
geskipt; regel: geen skip-ci-markers in branch-commits die gesquasht worden, en de token nooit letterlijk in een
commit-message citeren. Coördinatiepunt voor de owner blijft: `robots.ts` heeft nog de Phase-0 blanket-disallow —
llms.txt is direct fetchbaar maar robots-respecterende crawlers zien hem pas na de launch-versoepeling.

## Stand (geverifieerd, 2026-07-18)

Productie LIVE en verwerkt echt geld (checkdecijfers.vercel.app). Alle negen dekkingstabellen live; trial LIVE
(pot 23/25 bij s52-close). **#172 stap-0 is GEMETEN én GEBOUWD + LIVE** (meting `0937045`; bouw `4626f8a`,
ADR-027 A4): de fit gate loopt nu de volledige deliverability-walk (`candidateWalk` — pick + alternates + hele
current-shortlist-rest, geen cap); `walkContains: '37789ksz'` staat weer gate-blocking in de labelled set. De
s54-geregresseerde bijstand-klasse is structureel hersteld, onafhankelijk van het rerank-model. **Wat van #172
overblijft voor een begeleid venster: alleen de RerankProfile-co-kalibratie (×4 rondes + separation gap), de
live bijstand-onboarding-smoke en de maandelijkse drift-canary** (protocol-doc heeft de stand).

## Owner-datums — 22/7 en 23/7 GEMIST tijdens de onderbreking, maar ✅ INGEHAALD op 24-07 (sessie 55, owner-aanwezig)

Gemeten en uitgevoerd op 2026-07-24: `83693NED` schoon gesynct (+8 rijen, julicijfer 2026MM07, batch 26);
`85773NED` stopte eerst eerlijk op de nieuwe release-periodecodes (2026MM06/2026KW02) en ging per ontwerp in
quarantaine → beoordeeld → `--rebaseline --accept-new-codes` (+16 rijen, batch 27, weer active). Spot-checks
LLM-vrij exact: consumentenvertrouwen juli **−35**, gemiddelde verkoopprijs juni **€496.235** (beide Definitief).

**Nog open aan datums:**
1. **~30/7** — BBP+PPI-syncs (dichtbij!); `85880NED` MOET via de chunked escape hatch (RUNBOOK).
2. **#132 route B** — wacht op de expliciete owner-GO (uitstelweek is voorbij; forks==0 gemeten 24-07 — de
   go/no-go-voorwaarde houdt). NB: de interim-regel (PR-verwijzingen in docs als platte tekst) was sinds ~17/7
   geschonden geraakt (29 live links, ook door sessie 55 zelf) — op 24-07 allemaal geneutraliseerd; bewaak hem
   in elke wrap-up-sweep.

## Owner-menu (ontwerpen liggen klaar, zie het ▶-blok in STATUS voor links)

WP26 (trial-conversie; safelist-read-back → begeleide bouw, €5/€10) · WP30c (beslismemo, 4 opties) · #121
(alleen nog de één-regel-vraag: template-validator-verdict serve+alert of fail-closed — **de onvoorwaardelijke
helft is ✅ KLAAR, 24-07**: gemeten correctie op de brief (throw was al netjes gevangen → internal refusal; het
gat was stilte) + internal-refusal-admin-alert op beide beurten, #144-postuur) · #154 (rider op elk begeleid
venster) · #162 (na WP26) ·
#170 rest: (3) chart-download bundelen met de Phase-2 OG-WP, (4) annotaties/toggles.
**#138 is ✅ KLAAR + LIVE** (zelfde dag gebouwd, commit `f2d015a` — van het menu af).
Residuen: #131, #104/#112 (live-spend), /login-cosmetiek, #151-backfill (begeleid). Owner-clicks open: GitHub
Budgets, Resend-confirm, optionele Vercel-Firewall-rule.

## Kanttekeningen

- Zero prompt bytes bewaken; vocab-wijzigingen (85792NED-fix, #164) alleen gebatcht met een release-venster.
- Autonoom werk aan core/geld-pad: branch + PR + owner-review (#118(b)); owner-aanwezig: direct pushen mét het
  volle verificatieblok + automatische /code-review LOW.
- Nieuwe publieke route? → `web/proxy.ts`-allowlist + test (les s55).
- Wrap-up-ritueel (CLAUDE.md) volledig draaien; golden rule: elk feit tegen de bron verifiëren.

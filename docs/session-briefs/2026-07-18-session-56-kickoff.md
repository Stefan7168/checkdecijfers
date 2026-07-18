# Kickoff — sessie 56 (na sessie 55, de eerste post-Fable-sessie)

**Geschreven door sessie 55 (2026-07-18, autonoom).** Leesvolgorde: CLAUDE.md → docs/STATUS.md (▶-blok bovenaan is
leidend) → dit bestand. De chat is weg; de repo is de bron.

## ⚠ Check eerst het runtime-model

Sessie 55 draaide — anders dan de modelwissel-aankondiging — blijkens haar eigen omgeving nog op **Fable 5**
(`claude-fable-5`); de sessie-picker was toen nog niet omgezet. Check bij de start welk model deze sessie werkelijk
draait en meld een mismatch aan de owner. De delegatieregel is rol-gebaseerd en geldt hoe dan ook: het sessiemodel
doet het denkwerk, fan-out/legwork op Sonnet/Haiku, tiers per rol benoemd.

## PR #57 — ✅ afgehandeld (owner kwam dezelfde dag terug in de chat: "Go")

**[PR #57](https://github.com/Stefan7168/checkdecijfers/pull/57) is gemerged (`12381e3`) en LIVE geverifieerd:**
`/llms.txt` HTTP 200 op prod (20 registertabellen, gemeten syncdatums) en de SourceBadge op alle vier de
Ontdek-charts, elk aan zijn eigen tabel-ID gebonden. Deploy-run 29634774649 groen incl. de nieuwe
/llms.txt-smoke. ⚠ Twee keer gemeten merge-val: de squash-message vouwt branch-commit-subjects in de body — een
`[skip ci]` in een gefolde docs-commit skipte gate+deploy, en een trigger-commit die de marker CITEERDE werd óók
geskipt; regel: geen skip-ci-markers in branch-commits die gesquasht worden, en de token nooit letterlijk in een
commit-message citeren. Coördinatiepunt voor de owner blijft: `robots.ts` heeft nog de Phase-0 blanket-disallow —
llms.txt is direct fetchbaar maar robots-respecterende crawlers zien hem pas na de launch-versoepeling.

## Stand (geverifieerd, 2026-07-18)

Productie LIVE en verwerkt echt geld (checkdecijfers.vercel.app). Alle negen dekkingstabellen live; trial LIVE
(pot 23/25 bij s52-close). **#172 stap-0 is GEMETEN** (main `0937045`): `37789ksz` zit in de Stage-1-shortlist
(live 22/24) → recall is niet het gat, maar de cap-6 walk uit het protocol mist hem — het escalatie-WP moet de
walk over de volle Regulier-shortlist leggen of deliverability-aware maken (staat in de protocol-doc).

## Owner-datums (staand)

1. **wo 22/7 06:30** — sync `85773NED` (generale huizenprijzen-release).
2. **do 23/7 06:30** — sync `83693NED` (julicijfer consumentenvertrouwen).
3. **~30/7** — BBP+PPI-syncs; `85880NED` MOET via de chunked escape hatch (RUNBOOK).
4. **#132 route B** — check op/na 19/7.

## Owner-menu (ontwerpen liggen klaar, zie het ▶-blok in STATUS voor links)

WP26 (trial-conversie; safelist-read-back → begeleide bouw, €5/€10) · WP30c (beslismemo, 4 opties) · #121
(één-regel-vraag; throw-fix hoort er sowieso bij) · #154 (rider op elk begeleid venster) · #138 (klaar, geen
vraag) · #162 (na WP26) · #170 rest: (3) chart-download bundelen met de Phase-2 OG-WP, (4) annotaties/toggles.
Residuen: #131, #104/#112 (live-spend), /login-cosmetiek, #151-backfill (begeleid). Owner-clicks open: GitHub
Budgets, Resend-confirm, optionele Vercel-Firewall-rule.

## Kanttekeningen

- Zero prompt bytes bewaken; vocab-wijzigingen (85792NED-fix, #164) alleen gebatcht met een release-venster.
- Autonoom werk aan core/geld-pad: branch + PR + owner-review (#118(b)); owner-aanwezig: direct pushen mét het
  volle verificatieblok + automatische /code-review LOW.
- Nieuwe publieke route? → `web/proxy.ts`-allowlist + test (les s55).
- Wrap-up-ritueel (CLAUDE.md) volledig draaien; golden rule: elk feit tegen de bron verifiëren.

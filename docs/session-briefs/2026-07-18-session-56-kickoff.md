# Kickoff — sessie 56 (na sessie 55, de eerste post-Fable-sessie)

**Geschreven door sessie 55 (2026-07-18, autonoom).** Leesvolgorde: CLAUDE.md → docs/STATUS.md (▶-blok bovenaan is
leidend) → dit bestand. De chat is weg; de repo is de bron.

## ⚠ Check eerst het runtime-model

Sessie 55 draaide — anders dan de modelwissel-aankondiging — blijkens haar eigen omgeving nog op **Fable 5**
(`claude-fable-5`); de sessie-picker was toen nog niet omgezet. Check bij de start welk model deze sessie werkelijk
draait en meld een mismatch aan de owner. De delegatieregel is rol-gebaseerd en geldt hoe dan ook: het sessiemodel
doet het denkwerk, fan-out/legwork op Sonnet/Haiku, tiers per rol benoemd.

## Eerste agendapunt (owner-aanwezig): PR #57 reviewen

**[PR #57](https://github.com/Stefan7168/checkdecijfers/pull/57) — #170 smalls 1+2 (bron-badge + eerlijke
`/llms.txt`) — staat OPEN en wacht op owner-review per #118(b). Sessie 55 heeft NIET gemerged.** Vol
verificatieblok was groen (benchmark 14/14 + 6/6 + 0 fabricated; web 378/378; echte build; /code-review LOW
schoon); check de CI-status van de branch vóór de merge. Na merge bewijst de post-deploy-smoke `/llms.txt` live.
Meegelift in de PR: vitest-plafond 60→120s (de #125a-contentieklasse kwam terug na de verdubbeling van
SEED_TABLES). Coördinatiepunt voor de owner: `robots.ts` heeft nog de Phase-0 blanket-disallow — llms.txt is
direct fetchbaar maar robots-respecterende crawlers zien hem pas na de launch-versoepeling.

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

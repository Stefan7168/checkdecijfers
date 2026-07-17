# Kickoff — eerste post-Fable-sessie (na de modelwissel)

**Plak-klare kickoff, geschreven door de Fable overnight design-marathon (2026-07-18, Fable's laatste sessie).**
Leesvolgorde: CLAUDE.md → docs/STATUS.md (het ▶-blok bovenaan is leidend) → dit bestand. De chat is weg; de repo is
de bron.

## ⚠ De modelwissel — dit is de eerste sessie op het nieuwe regime

- **Sessies draaien vanaf nu op Opus/Sonnet; het topmodel is Opus.** De delegation cost-tier rule (owner, s23)
  overleeft de wissel onverkort: het SESSIEMODEL doet het denkwerk (scoping, briefs, synthese, eindreview); fan-out/
  legwork draait op **Sonnet/Haiku**, per subagent gepind, tiers benoemd per rol — nooit modelnamen hardcoden in
  herbruikbare prompts. Memory `feedback_model_tier_allocation` is bijgewerkt.
- Fable blijft beschikbaar als **API-model** (`claude-fable-5`) — relevant alleen voor het #172-finder-protocol
  (optionele trap, mét het daar genoteerde drift-voorbehoud). In-product API-pins (rerank=Haiku, compose=Sonnet,
  websearch=Sonnet) zijn ongewijzigd en NIET aan deze wissel gekoppeld.
- De marathon leverde **zes execute-ready ontwerpen** zodat de uitvoering zonder her-denkwerk kan; bouw vanuit de
  briefs, niet vanuit samenvattingen.

## Stand van het product (geverifieerd, 2026-07-18)

Productie is **LIVE en verwerkt echt geld** (checkdecijfers.vercel.app; kale domein geparkeerd BY DESIGN). Alle
negen dekkingstabellen live (s54, #168 resolved). De anonieme trial is LIVE (pot stond 23/25 bij s52-close; ops:
`npm run trialpot:set`). #118-workflow: owner-aanwezige sessies pushen/mergen direct met het VOLLE verificatieblok
(typechecks + alle suites + benchmark 14/14 + 6/6 + 0 fabricated + echte build + automatische /code-review LOW vóór
elke code-push; `audit:verify` bij validator-wijzigingen); **autonome sessies: branch + PR + owner-review** voor
core-product/geld-pad; live DDL / echte LLM-spend / env-flips altijd owner-begeleid.

## Eerst: de owner-datums (staand, uit s50/s54)

1. **wo 22/7 06:30** — sync `85773NED` (generale repetitie huizenprijzen-release).
2. **do 23/7 06:30** — sync `83693NED` (julicijfer consumentenvertrouwen).
3. **~30/7** — BBP+PPI release-syncs; **`85880NED` MOET via de chunked escape hatch**
   (`capture-observations-chunked.ts` + `sync-from-capture.ts`, RUNBOOK).
4. **#132 route B** — check op/na 19/7.

## Dan: de owner-stack — nu mét ontwerpen op tafel (het menu)

| Item | Ontwerp-doc (session-briefs/) | Wat het nog nodig heeft |
|---|---|---|
| **WP26** (trial-conversie-belang!) | `2026-07-19-wp26-execute-brief.md` | owner-read-back: safelist hardop + 2 items (A2-vs-A1 take-path; WP26c-scope) → begeleide bouwsessie; GEEN live DDL; plan €5 / cap €10 |
| **#170 smalls** (sparring-approved) | specs in `2026-07-18-sparring-competitive-analysis.md` | direct bouwbaar; autonoom = branch `visibility-smalls` + PR; hermetisch, nul LLM-bytes; liever twee af dan vier half |
| **WP30c** tweede bron | `2026-07-19-wp30c-rijksfinancien-dossier.md` | ALLEEN een owner-keuze (4 opties uitgewerkt; politie én rijksfinancien live-gescout); Prinsjesdag 15/9 = content-deadline als optie 2 lokt |
| **#172** finder-escalatie | `2026-07-19-172-escalation-protocol.md` | begeleide WP; stap 0 (shortlist-walk-verificatie) is hermetisch en €0 — kan elke sessie |
| **#154** datum-eerlijkheid | `2026-07-19-154-design.md` | rider op elk begeleid venster (migratie 021 file-only; flag-vrij; €0 LLM) |
| **#138** regio-chip | `2026-07-19-small-designs.md` §a | geen owner-vraag; ~halve sessie, €0 |
| **#121** template-rung | `2026-07-19-small-designs.md` §b | één-regel-owner-vraag (aanbeveling: serve + admin-alert); throw-fix hoort er sowieso bij |
| **85792NED** named-region | `2026-07-19-small-designs.md` §c | owner-akkoord op bounded override; meeliften op de VOLGENDE vocab-batch (#164) |
| **#162** slot-filling | `2026-07-19-adr-draft-slot-filling.md` | NA WP26; owner-read-back op de A/B-opzet (~€1-2); draft promoveert pas na een gemeten win |

Residuen (tracked-not-focus): #131 multilingual (geen ontwerp), #104/#112 (live-spend nodig), /login-header-cosmetiek,
#146-#150/#152/#157 low/latent, #151-backfill (begeleid).

## Open owner-clicks (uit de bill-shock-audit, RUNBOOK "Bill-shock protection")

1. **GitHub Budgets** — de 2026-gotcha: met een kaart aan het account factureert metered overage automatisch tenzij
   een stop-budget staat. 2. **Resend free-tier-confirm.** 3. **Optioneel: Vercel Firewall rate-limit-rule.**

## Kanttekeningen voor de bouwer

- **Zero prompt bytes bewaken**: WP26 en #154 en de smalls raken géén prompt-bytes; 85792NED-fix en elke
  vocab-uitbreiding WEL (→ #164 één-batch-regel, ~€2/ronde, batch plannen met een release-venster).
- **Meetcorrectie uit de marathon**: compose-fixtures (15 stuks, `answer:record`) zijn een EIGEN hash-domein — een
  compose-promptwijziging (#162) triggert #164 níét; oude+nieuwe fixtures kunnen naast elkaar bestaan.
- De marathon-docs zijn ontwerpen, geen besluiten: elk noemt expliciet zijn owner-vragen. Niets bouwen vóór het
  genoemde akkoord; #123/WP30c-keuze NIET zelf maken.
- Wrap-up-ritueel (CLAUDE.md) volledig draaien bij elk sessie-einde; golden rule: elk feit tegen de bron verifiëren,
  nooit uit geheugen.

# Session 67 — kickoff (written by session 66 at close, 2026-08-28)

**Paste-ready prompt:**

> Sessie 67 voor checkdecijfers.nl. Lees eerst `docs/CLAUDE.md`, dan `docs/STATUS.md` (het bovenste blok
> is leidend), dan dit bestand helemaal, en dan
> `docs/session-briefs/2026-08-28-session-66-close.md` voor de volledige sessie-66-overdracht, voordat je
> iets doet.
>
> **Verifieer ZELF met `date` en `gh pr list --state open`** — dit bestand is geschreven door sessie 66
> op 2026-08-28 en kan verouderd zijn tegen de tijd dat jij het leest.
>
> Sessie 66 (volledig autonoom, jij niet aanwezig) heeft de hele wachtrij van sessie 65 afgewerkt: **16
> PR's uit de wachtrij plus de eigen wrap-up-PR (#115) — #99 t/m #115, allemaal CI-groen, GEEN ervan
> gemerged.** Er is geen nieuwe wachtrij — de eerste taak is die PR's beoordelen en (waar akkoord) mergen,
> niet nieuw werk verzinnen. **Ook open, LOS van de wachtrij: #116 en #117 (Dependabot dependency-bumps,
> vanzelf verschenen ná het wachtrij-werk, CI-groen, bewust niet beoordeeld deze sessie) — normaal
> onderhoudswerk voor jouw triage, geen actie van sessie 66 op geweest.** Check zelf hoeveel PR's er NU
> open staan — dit is precies het soort telling die tussen het schrijven van dit bestand en het lezen
> ervan kan zijn veranderd.

## Wat te doen, in volgorde

1. **Review + merge de 17 PR's van sessie 66 (#99 t/m #115)** — meeste zijn onafhankelijk, geen vaste
   volgorde nodig. Eén echte afhankelijkheid: #103 (#39, alternate-reading disclosure) moet eerst landen
   voordat een toekomstige sessie aan de #89/#70/#79-UI-drieluik begint (bewust nog niet gebouwd deze
   sessie — dat drieluik heeft een gedeeld ontwerp nodig, nu wél mogelijk met #103's vorm als basis).
   #116/#117 (Dependabot) staan er los naast — normaal onderhoud, geen sessie-66-werk.
2. **Twee dingen om extra aandacht aan te geven bij het reviewen:**
   - **PR #111** (#110 tabel-eviction/TTL) kost één echte extra DB-round-trip per beantwoorde beurt — in
     de PR-beschrijving prominent gemeld gegeven #173's geschiedenis met de Supabase-pooler. Lees dat
     stuk voordat je merget.
   - **PR #113** (#162 slot-filling) is de meest invariant-gevoelige wijziging van de sessie (raakt
     R1/R3/R9-R11 direct) — heeft al de diepste review van de sessie gehad (flag-off-neutraliteit
     onafhankelijk herverifieerd, de kernlogica volledig gelezen), maar verdient een eigen blik gegeven
     wat het aanraakt.
3. **Na het mergen, live stappen die jouw aanwezigheid nodig hebben** (geen van alle dringend, geen
   ervan is een blocker voor iets anders):
   - Live migraties: 023 (#146-150), 024 (WP25 `error_log`), 025 (#110 eviction) — telkens een
     `npm run db:migrate` na de merge van de bijbehorende PR.
   - **#193's live `audit:verify`-stap** (R8-divergentiecheck tegen productie + eventuele
     `known-divergences.ts`-pinning) — de copy zelf staat al live (PR #91, een sessie terug); dit is het
     laatste restje.
   - **#162's A/B-meting** (blind paarsgewijze taalkwaliteits-rechter + jouw terugkoppeling, ~€1-2 echte
     spend) — pas zinvol zodra PR #113 gemerged is.
   - **#110's live `--apply`** van de eviction-CLI — pas zinvol zodra er echte on-demand-tabellen bestaan
     die oud genoeg zijn.
4. **Blijft van jou, ongewijzigd, niet aangeraakt:** de WP26-vlaggen (`CLARIFY_CLICK_ENABLED`,
   `ANSWER_FIRST_ENABLED`) en `GDPR_PURGE_APPLY`.
5. **Geen dringende deadline op iets hierboven** — als je liever eerst iets anders doet (bijv. de
   `open-questions.md`-triage die al een tijdje op de maandelijkse agenda staat, ~320KB en gegroeid),
   is dat prima. Er is geen wachtrij die op je wacht.

## Wat NIET te doen zonder er zelf voor te kiezen

- Geen van de 17 PR's hoeft in een bepaalde volgorde gemerged te worden (behalve #103 vóór een
  toekomstige #89/#70/#79-sessie, zie boven) — kies zelf wat het eerst logisch voelt.
- De #89/#70/#79-UI-drieluik is bewust NIET opgepakt — dat is een nieuwe, aparte beslissing (een gedeeld
  ontwerp over drie affordances), geen automatisch vervolg op #103.
- Twee oude, verweesde branches van vóór de pauze (`refactor/shared-intent-options`,
  `fix/vitest-exclude-worktrees`) staan nog lokaal — pas verwijderen als je zelf bevestigt dat ze
  overbodig zijn (ze zien er zo uit, maar `git branch -D` is destructief, dus dat is bewust aan jou
  gelaten in plaats van door een autonome sessie gedaan).

## Achtergrond, voor de volledigheid

Sessie 66's volledige overdracht (batch-voor-batch resultaat, twee genoemde aandachtspunten, operationele
lessen): [2026-08-28-session-66-close.md](2026-08-28-session-66-close.md). De oorspronkelijke wachtrij
(wat er gevraagd werd): [2026-08-27-session-66-autonomous-queue.md](2026-08-27-session-66-autonomous-queue.md).

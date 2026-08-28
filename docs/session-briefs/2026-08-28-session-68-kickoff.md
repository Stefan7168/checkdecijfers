# Session 68 — kickoff (written by session 67 at close, 2026-08-28)

**Paste-ready prompt:**

> Sessie 68 voor checkdecijfers.nl. Lees eerst `docs/CLAUDE.md`, dan `docs/STATUS.md` (het bovenste
> blok is leidend), dan dit bestand helemaal, en dan
> `docs/session-briefs/2026-08-28-session-67-close.md` voor de volledige sessie-67-overdracht,
> voordat je iets doet.
>
> **Verifieer ZELF met `date` en `gh pr list --state open`** — dit bestand is geschreven door sessie
> 67 op 2026-08-28 en kan verouderd zijn tegen de tijd dat jij het leest.
>
> Sessie 67 (owner aanwezig) heeft alle 19 open PR's van sessie 66 beoordeeld en gemerged (#99 t/m
> #117) — geen enkele achtergehouden. Twee echte (niet-live) bugs gevonden en gefixt vóór het
> mergen; twee restpunten vastgelegd als nieuwe open-questions rijen (#195, #196), geen
> merge-blokkers. **Er is GEEN wachtrij meer — main staat volledig bij, nul open PR's.** De
> volgende stap is vrij te kiezen uit de "▶ NEXT" lijst in STATUS.md, niets is dringend.

## Wat te doen, in volgorde (allemaal owner-supervised, niets dringend)

1. **Drie live migraties**, elk een `npm run db:migrate` zodra je zover bent — RUNBOOK heeft nu een
   eigen sectie per migratie met de exacte verificatiestappen:
   - **023** (#147, geld-pad: begrenst hoeveel een compensatie mag terugboeken t.o.v. de originele
     afschrijving — puur defense-in-depth, vandaag door geen enkele live aanroeper bereikbaar).
   - **024** (#65/WP25, `error_log`-tabel — tot deze migratie draait, faalt elke logregel stil open
     naar `console.error`, precies zoals nu).
   - **025** (#110, eviction/TTL-kolommen op `cbs_tables` — zet zelf niets in gang, er is geen cron
     en geen tabel oud genoeg om nu al uitgezet te worden).
2. **WP26 go-live** (`CLARIFY_CLICK_ENABLED`, `ANSWER_FIRST_ENABLED`) — één vlag tegelijk, RUNBOOK
   sectie "WP26 answer-first + clickable options".
3. **`GDPR_PURGE_APPLY=1`** plus één gevolgde run.
4. **#193's live `audit:verify`-stap** (R8-divergentiecheck tegen productie + eventuele
   `known-divergences.ts`-pinning) — de copy zelf staat al live sinds PR #91, dit is het laatste
   restje.
5. **#162's A/B-meting** (blind paarsgewijze taalkwaliteits-rechter + jouw terugkoppeling, ~€1-2
   echte spend) — nu mogelijk, PR #113 is gemerged.
6. **#132 route B**: GO of afwijzen (T-0 voorwaarde — `forks_count` — nog steeds 0, laatst gemeten
   2026-08-26).
7. Dan het eigen menu: WP30c-keuze (Rijksfinanciën `80504NED`, bevestigd gewone StatLine-tabel maar
   `Gediscontinueerd`) / [#170](../open-questions.md)(3) (blijft Fase-2-gebonden) / het #89/#70/#79
   UI-drieluik (nu mogelijk sinds #103 gemerged is, maar heeft eerst een eigen gedeeld-ontwerp-besluit
   nodig — geen automatisch vervolg).

## Twee dingen om extra aandacht aan te geven zodra je aan (1) of (5) begint

- **Vóór #111's live `--apply` ooit draait** (niet nu, geen actie vandaag nodig): lees
  [#195](../open-questions.md) en [#196](../open-questions.md) eerst — de echte kosten per beurt
  zijn hoger dan gemeld, en er is een race waarbij een gelijktijdige eviction een levende vraag ten
  onrechte kan afwijzen. Beide moeten dicht zijn vóór dat ooit geautomatiseerd wordt.
- **Migratie 024's foutmelding-toewijzing is al gefixt** (sessie 67 vond en repareerde een bug waarbij
  de admin-alert-e-mail altijd "de trial-tak" de schuld gaf, ook als de error_log-tak zelf faalde) —
  geen actie nodig, alleen ter info als je die e-mail ooit leest.

## Wat NIET te doen zonder er zelf voor te kiezen

- **26 verweesde lokale branches** staan er nog (7 pre-pauze branches met remote, 7 oude
  Dependabot-branches zonder remote, 12 `worktree-agent-*`-resten) — geen van alle raakt `main` of
  productie, maar `git branch -D` is destructief en blijft bewust aan jou. Volledige lijst in
  [2026-08-28-session-67-close.md](2026-08-28-session-67-close.md).
- **`open-questions.md`-triage** (~320KB, groeit elke sessie) staat al een tijdje op de maandelijkse
  agenda — prima om nu te doen als je liever eerst opruimt dan verder bouwt, geen wachtrij die op je
  wacht.

## Achtergrond, voor de volledigheid

Sessie 67's volledige overdracht (per-PR resultaten, alle merge-conflicten en hoe ze zijn opgelost,
de twee gevonden bugs, de canary-vergissing en de correctie):
[2026-08-28-session-67-close.md](2026-08-28-session-67-close.md). Sessie 66's oorspronkelijke werk
(de 19 PR's zelf, wat elke PR bouwt): [2026-08-28-session-66-close.md](2026-08-28-session-66-close.md).

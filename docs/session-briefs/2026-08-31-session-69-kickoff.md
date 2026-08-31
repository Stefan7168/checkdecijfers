# Session 69 — kickoff (written by session 68 at close, 2026-08-31)

**Paste-ready prompt:**

> Sessie 69 voor checkdecijfers.nl. Lees eerst `docs/CLAUDE.md`, dan `docs/STATUS.md` (het bovenste
> blok is leidend), dan dit bestand helemaal, en dan
> `docs/session-briefs/2026-08-31-session-68-close.md` voor de volledige sessie-68-overdracht, voordat
> je iets doet.
>
> **Verifieer ZELF met `date` en `gh pr list --state open`** — dit bestand is geschreven door sessie 68
> op 2026-08-31 en kan verouderd zijn tegen de tijd dat jij het leest.
>
> Sessie 68 (owner aanwezig, over drie kalenderdagen in één doorlopend gesprek) heeft `/systeemoverzicht`
> gebouwd — een publieke architectuur-overzichtspagina, op rechtstreeks verzoek van de eigenaar, GEEN
> onderdeel van de wachtrij. **Er is nog steeds GEEN wachtrij — main staat volledig bij, nul open PR's,
> alles van sessie 67's "▶ NEXT"-lijst staat onaangeroerd.** De volgende stap is vrij te kiezen uit die
> lijst in STATUS.md, niets is dringend.

## Wat te doen, in volgorde (allemaal owner-supervised, niets dringend, ongewijzigd sinds sessie 67)

1. **Drie live migraties**, elk een `npm run db:migrate` — RUNBOOK heeft een eigen sectie per migratie:
   **023** (#147, geld-pad compensatiegrens), **024** (#65/WP25, `error_log`-tabel), **025** (#110,
   eviction/TTL-kolommen).
2. **WP26 go-live** (`CLARIFY_CLICK_ENABLED`, `ANSWER_FIRST_ENABLED`) — één vlag tegelijk, RUNBOOK sectie
   "WP26 answer-first + clickable options".
3. **`GDPR_PURGE_APPLY=1`** plus één gevolgde run.
4. **#193's live `audit:verify`-stap** — de copy staat al live sinds PR #91, dit is het laatste restje.
5. **#162's A/B-meting** (blind paarsgewijze taalkwaliteits-rechter + jouw terugkoppeling, ~€1-2 echte
   spend) — mogelijk, PR #113 is gemerged.
6. **#132 route B**: GO of afwijzen (T-0 voorwaarde — `forks_count` — nog steeds 0).
7. Dan het eigen menu: WP30c-keuze / [#170](../open-questions.md)(3) / het #89/#70/#79 UI-drieluik (heeft
   eerst een gedeeld-ontwerp-besluit nodig).

## Wat NIET te doen zonder er zelf voor te kiezen

- **26 verweesde lokale branches** — geen van alle raakt `main` of productie, maar `git branch -D` is
  destructief en blijft bewust aan jou. Volledige lijst in de sessie-67-overdracht.
- **`open-questions.md`-triage** (~320KB) staat al een tijdje op de maandelijkse agenda — prima om nu te
  doen als je liever eerst opruimt.

## Achtergrond, voor de volledigheid

Sessie 68's volledige overdracht (de drie commits, de twee gevonden bugs, de verificatiestappen, een
tooling-kwirk met de Browser-pane):
[2026-08-31-session-68-close.md](2026-08-31-session-68-close.md). Sessie 67's overdracht (alle 19 PR's
beoordeeld en gemerged): [2026-08-28-session-67-close.md](2026-08-28-session-67-close.md).

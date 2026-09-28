# ADR 061 — Regional statistics from `70072ned`: a measure allow-list slice and status from CBS's period notes

**Status:** accepted 2026-09-28 (session 138, owner present: picked the 12-figure set, then "Go, build step 1 now" on the
plain-English design). **Part 1 (data only) built** on branch `regional-stats-part1` (`65c9cbb1..4e2804ca`, incl. the final-review fix
wave). The **prod load is deferred to Part 2** (see "As built — Part 1" below). **Part 2** (the 12 figures become answerable) waits for the AI spend roof to reset on 2026-10-01 and the
owner. Design: [superpowers/specs/2026-09-28-regional-statistics-design.md](../superpowers/specs/2026-09-28-regional-statistics-design.md);
plan: [part 1](../superpowers/plans/2026-09-28-regional-statistics-part-1.md).

**Relates to:** ADR [054](054-region-set-query.md) (region-set query — the questions these figures unlock), ADR
[060](060-two-measure-scatter.md) (the scatter gains real pairs), ADR [003](003-cbs-access-layer.md) (bulk ingestion),
[docs/07](../07-phase0-table-set.md) (phase 0 rejected `70072ned`; now selected with a slice), #251 (per-cell status hook),
[open-questions #333](../open-questions.md), [#334](../open-questions.md).

## Context

Only 2 of 26 canonical measures were regional (population on 1 January, average home sale price per gemeente), so ADR 054's
region-set query and ADR 060's scatter had almost nothing to work with. CBS's "Regionale kerncijfers Nederland" (`70072ned`)
carries ~50 statistics per gemeente/province, but measured live on 2026-09-28 it has three properties our pipeline could not
take as-is:

1. **Size:** 6,802,920 cells over 248 measure codes — far above the 500k synchronous cap.
2. **Topic churn:** CBS revises its topics constantly; the schema fingerprint covered every measure code, so any revision of a
   figure we do not use would quarantine the table. This is why phase 0 rejected it (docs/07).
3. **Code reuse in the v4 feed:** 34 measure codes carry 2–4 different values for the same (region, year) — e.g. `1050010_6`
   (household income) = 60.8 / 45.6 / 17.9 for Amsterdam 2024; v3 keeps them apart as `…_101/_111/_121`.
4. **No machine-readable status:** every one of the 32 periods has `Status: null`. CBS states status in prose: the table note
   says figures are final "tenzij is aangegeven in de toelichting bij 'perioden' of 'onderwerp' dat ze voorlopig of nader
   voorlopig zijn", and each period's note lists topics under "Uitkomsten zijn (nader) voorlopig over:". (Found during the
   build, Task 3; the design had assumed a normal per-period status.)

## Decision

1. **Measure allow-list on the slice** — `CbsSlice.measures?: string[]`. Sent to CBS as `(Measure eq 'a' or …)`, appended last
   so every existing slice's filter string is unchanged; the fixture source filters the same way; the Eurostat adapter refuses
   it. With a list set, registration units, served rows and the **schema fingerprint cover only the listed codes**; a listed
   code CBS no longer lists fails registration / the `schema_fingerprint` stage loudly. Tables without a list are
   byte-identical (same fingerprint, units, rows).
2. **The 12 owner-picked figures**, each measured to have exactly one value per (region, year) over the whole slice:
   `M000100` population density, `M003039` average WOZ value, `1014800` % owner-occupied, `2018790` % hbo/wo, `A018943_2`
   cars per 1,000, `X092783` distance to train station, `M000101_3` population growth per 1,000, `M000114` household size,
   `1050015_2` % single-person households, `M000200_2` businesses (1 January, rounded to 5), `X033647` benefit recipients
   (incl. AOW), `D000025` distance to large supermarket. Slice: those codes, `RegioS` NL/PV/GM, 2015+ = 106,683 cells.
   Household income is excluded (its code is reused, point 3).
3. **Duplicate cells keep failing closed** — the `row_plausibility` stage already refused a (measure, coordinates) pair seen
   twice; its message now names CBS code reuse as a possible cause.
4. **Per-cell status from CBS's period notes** (`src/ingestion/period-note-status.ts`, `Phase0Table.periodNoteStatus`), fed
   through the existing #251 per-cell status hook. A curated map from each note heading (normalised) to the served codes it
   covers — built over every heading CBS used in all 32 periods (15 normalised keys, `[]` = reviewed, covers none of ours).
   Status = the section's status when a heading covers the figure, otherwise Definitief (CBS's stated default). It fails the
   sync loudly on: an unknown section header, text outside a section, an unmapped heading, one figure in both sections, a
   config naming an unserved code, a period that suddenly has a machine status, and any served figure whose CBS description
   mentions "voorlopig" (topic notes, which we do not read). `checkPeriodParsing` accepts a status-less period only when every
   row in it carries a per-cell status.
5. **Two parts, split at the paid step.** Part 1 (this ADR's build): data only, nothing reader-visible — no canonical measure
   is added, so neither the intent vocabulary nor any LLM prompt changes. Part 2 adds the 12 `CANONICAL_MEASURES` +
   `REGIONAL_KEYS`, English labels, a curated scatter partner per figure, and re-records the intent/clarify/followup fixtures
   (cheap tier, owner-supervised, after 2026-10-01).
6. **Migration 025 stays frozen.** Its pinned-id list is history; seeds added later are pinned at registration (the CLI passes
   `{ pinned: true }`), and its drift test names them (`SEEDS_ADDED_AFTER_025`).

## Alternatives considered

- **v3 API for this table only** — v3 keeps the reused codes apart, but it is a second adapter path to maintain on the older
  platform, and it has the same prose-only status.
- **Several topic tables instead** — "Kerncijfers wijken en buurten" is one table *per year* (re-onboarding yearly); topic
  tables per figure multiply registrations, fixtures and freshness work by ~12.
- **Status: label every cell provisional, or every cell final** — both are wrong claims about CBS's data (R11). Reading
  CBS's own notes, fail-closed, is the only traceable option.
- **Status: structural match of note headings to CBS's measure-group tree** — tried first; the note headings use different
  names ("Wonen - Voorraad woningen" vs tree "Bouwen en wonen > Woningvoorraad"), so a reviewed closed map was required.
- **A temporary "hidden from the parser" flag to go live before 2026-10-01** — needs a second canonical-key enum (click
  validation must accept keys the parser must not emit); a new way to get it wrong for three days of chip-only value.

## Trade-offs

- A new or reworded heading in a future CBS note stops the table's sync until someone reviews and maps it — safe, but manual.
  So does a malformed note on any period, including ones below the slice floor.
- Changing the allow-list after registration needs the stored `cbs_tables.slice` updated too (registration skips existing
  tables) plus a `sync --rebaseline` — see RUNBOOK.
- Topic (measure-group) notes are not fetched; only measure descriptions are guarded. None of the 12 figures' groups carries a
  status note (checked 2026-09-28) — **Assumption**, [open-questions #334](../open-questions.md).
- CBS may publish no row at all for a small gemeente (Schiermonnikoog has no 2024 hbo/wo figure); ADR 054's coverage counts
  it as missing, so that class answer does not rank.

## Revisit triggers

- CBS publishes a machine-readable status for `70072ned` (the reader then refuses — remove the config).
- CBS disambiguates the reused v4 codes → household income per gemeente becomes addable.
- A second wide table needs the same treatment → consider fetching measure-group notes too.

## As built — Part 1 (session 138, 2026-09-28)

- Built via subagent-driven development: Tasks 1 (allow-list in the adapter), 2 (allow-list in ingestion), 3a (period-note
  status — added mid-build when Task 3 found `Status: null` on every period), 3 (seed + registry defaults + fixture, 26,675 rows,
  2024+). Final whole-branch review: 0 Critical, 3 Important, all fixed in one wave (`4e2804ca`):
  - the conformance manifest lists `70072ned` as schema-only (the harness does not apply allow-lists or period notes; the
    full sync is covered by `tests/ingestion`);
  - **the period-note map is tied to the served figures**: a sync fails `period_parsing` unless the registered
    `slice.measures` equals the seed's — otherwise an on-demand registration or a stale stored slice could serve a figure
    the map was never reviewed for, and store a provisional value as final;
  - pipeline tests for the topic-note guard and the slice guard.
- One process catch: an implementer edited the already-applied migration 025 to satisfy its drift test; reverted, and the
  test now freezes 025 and names later seeds (`SEEDS_ADDED_AFTER_025`).
- **Live proof without touching prod:** a full sync of the LIVE CBS API into a throwaway in-memory database succeeded —
  106,683 cells (exactly the number measured before the build), 12 figures, 741 region codes, 2015–2026; statuses
  94,827 Definitief / 6,669 Voorlopig / 5,187 NaderVoorlopig, matching CBS's notes (e.g. WOZ 2024 NaderVoorlopig, 2025
  Voorlopig; population density Definitief).
- **Prod load deferred to Part 2 (ruling after the final review):** the coverage report lists every active table, so a
  prod sync now would show "Regionale kerncijfers Nederland" on `/llms.txt` and the "what you can ask" box before any
  question about it can be answered. Prod pre-flight 2026-09-28: no `70072ned` row exists. Part 2 runs, in order, after
  the deploy with the canonical figures is live: `sync 70072ned` (auto-registers, pinned) → `registry:apply` → spot-check.

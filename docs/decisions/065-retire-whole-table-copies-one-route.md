# ADR 065 — Retire the whole-table copies: one route for all data, pinned definitions kept

**Status:** accepted as a DIRECTION (owner, in chat, session 151, 2026-09-30: "let's remove the 21 tables because that's
just no way forward. Let's delete that part consciously."). **Nothing has been deleted yet** — the deletion is gated and
sequenced below, and the design of the one route is the next piece of work, not part of this record.

**Supersedes:** ADR [062](062-breadth-table-lane-slice-cache.md) decision 1 ("Two lanes. The curated figures stay the fast
lane"). **Narrows:** ADR [003](003-cbs-access-layer.md) (whole-table ingestion stops being the way data enters).
**Evidence:** [session-briefs/2026-09-30-architecture-and-value-research.md](../session-briefs/2026-09-30-architecture-and-value-research.md),
[open-questions #356](../open-questions.md).

## Context

The database holds whole copies of 20 CBS tables and 4 Eurostat datasets, refreshed by hand (`npm run ingest sync`),
watched by a report and an e-mail alert (#355). Measured 2026-09-30: CBS has 1,277 current tables, so the copies cover
1.6% of them; one day after a full refresh two were already behind; all current tables together hold about 3.5 billion
cells, so copying everything was ruled out in ADR 062. The same day a blind test showed a general assistant reading exact
CBS cells from CBS's open data service for questions outside our copies. The owner's judgment: a hand-kept copy of a few
tables is not something to build on.

The copies carry two different things:

1. **Whole tables, refreshed by hand.** No future.
2. **A short list of everyday terms with a pinned, stated definition** (`src/registry/defaults.ts` — e.g. "unemployment"
   means the seasonally adjusted headline, "bankruptcies" means businesses). This is where the general assistant gave a
   different real figure in three of seven benchmark questions. It needs no copy of any table.

## Decision

1. **One route for every table.** A question is answered by fetching the cells it needs from the source, checking them
   with the existing validation, and storing them; the answer is composed only from stored, checked cells. This is ADR
   062's slice cache, made the only way in rather than the second lane.
2. **The pinned definitions stay** and sit on top of that route.
3. **What we store and refresh automatically** is what we have shown: cells behind answers, and above all behind charts
   on our own pages and charts someone has published. Not whole tables.
4. **Whole-table copies, the hand refresh, and the machinery that only exists for them are deleted — after the gate
   below, in a recorded order, not before.**

**Principles.** (a) and (c) are untouched. (b) reads "CBS data is bulk-ingested into our own database — never queried
live from the frontend or the request path". Its purpose holds in full: a reader only ever sees figures that are stored
and checked in our own database, and nothing in the browser or the request path talks to CBS (the background job does).
Only the word "bulk" stops being true. **Assumption:** the owner's decision covers rewording (b) to say this; the
wording change in [CLAUDE.md](../../CLAUDE.md) is made only on the owner's explicit confirmation.

## The gate before anything is deleted

The 20 benchmark questions are answered at the current gate (at least 12 of 14 answerable, 6 of 6 refusals, zero
invented numbers) from slice-stored data, measured, with the whole-table sync out of the path (the design's step 6). Until then the copies are the only working
path and the benchmark's frozen key is pinned to them.

**Known gaps between today's any-table lane and that gate** (from ADR 062's as-built notes, not re-measured):

- It has never answered a real question: the parser's first recording run is planned for 2026-10-01.
- It is a background job with a progress bubble (seconds to minutes); the pinned-definition questions are answered in
  one request today (6.5 s median). Pages that must load instantly (homepage, gallery, the SEO page, embeds) need their
  cells stored ahead of the visit.
- It refuses several question shapes the current path answers: a class of regions ("per province"), change over a year,
  now-versus-then, date ranges, relative periods.
- Slice-stored tables have no staleness warning and no recovery path after a quarantine.

## Order of work (each step measured before the next)

1. Run part A of the 1 October recording plan (the any-table parser) and its benchmark (ADR 062 step 6).
2. Design how the pinned definitions ride on the slice store. **Written 2026-09-30 on the owner's delegation:**
   [superpowers/specs/2026-09-30-one-route-warm-slices-design.md](../superpowers/specs/2026-09-30-one-route-warm-slices-design.md)
   — the pinned tables keep their declared scope, a background job fills and refreshes it in bounded, validated slice
   requests, the test suites switch to slice storage first, production converts one table at a time. First-time
   questions about other tables stay the table lane (ADR 062).
3. Build it dark; run the 20-task benchmark through it.
4. Switch over; then delete, in this order: the hand-refresh procedure and its report/alert; the whole-table sync path;
   the 100-credit table request (already superseded by ADR 062); the stored cells that no shown chart or answer uses.
5. Update every doc that describes the copies in the same change (doc-freshness rule).

## Consequences for work already queued

- **The 1 October recording plan** ([session-briefs/2026-10-01-recording-run-plan.md](../session-briefs/2026-10-01-recording-run-plan.md)):
  part A fits this decision. Part B (regional statistics) loads one more whole table (`70072ned`) into production and
  part C builds on the four whole Eurostat datasets. **Owner decision the same day ("apply everything you recommend"):
  run A only; B and C wait for step 2's design.** The plan file carries the notice.
- **No further whole tables are loaded**, CBS or Eurostat.
- The two CBS tables that were behind on 2026-09-30 were refreshed the same day on the owner's go (`37789ksz` batch 62,
  `85770NED` batch 63, no quarantine); the copies stay refreshed while they are live, because readers see them.

## Alternatives considered

- **Keep two lanes** (ADR 062 decision 1). Rejected by the owner: it keeps a hand-maintained set that covers 1.6% of CBS
  and goes stale daily, next to the route that actually scales.
- **Delete the copies today.** Rejected by the session and accepted by the owner's "consciously": they are the only
  working path, the homepage and every published chart read them, and the benchmark is pinned to them.
- **Drop the pinned definitions too and let the table's own totals decide.** Rejected: the definitions are the measured
  consistency advantage over a general assistant, and they cost one file.

## Revisit triggers

- The one route cannot reach the benchmark gate after the design round: revisit whether a small stored core is needed
  for speed, as a cache the system fills itself, never again as a hand-kept copy.
- CBS changes or rate-limits its open data service in a way that makes fetch-on-question unreliable.

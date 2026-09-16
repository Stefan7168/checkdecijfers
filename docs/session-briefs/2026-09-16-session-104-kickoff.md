# Session 105 kickoff — checkdecijfers.nl

Paste this whole file (or just the "Kickoff prompt" section) to start the next session.

## Reading order

Read `CLAUDE.md` first, then `docs/STATUS.md`'s top block (authoritative over anything below it if
they ever disagree), then `docs/08-build-plan.md` for the work plan. Everything below is a snapshot as
of 2026-09-16, session 104's end — verify against `git log`/`gh pr list` before trusting any of it,
since more may have landed since.

## Current state (verified, not recalled)

- `main` at `75aa611`. Session 104 merged **seven** PRs: **#32** (3D-demo v2 rework — choropleth floor,
  floating legend, 5-step guided narrative, ADR 049's v2 addendum) and **#24–#29** (a backlog of small,
  well-scoped fixes/cleanups from sessions 102–103: health-check gap, dead-code removal, an envelope
  key-manifest test, a shared helper extraction, a `useElementWidth` bug fix, and STATUS.md's own
  duplicate-narrative trim). Every one independently re-reviewed (diffs read in full, not rubber-stamped
  on green CI) before merging; zero real issues found across the six-PR backlog.
- **PR #23 (WP30c E1, Eurostat adapter) is the only PR still open**, deliberately not merged — it is
  CONFLICTING, touches 72 files, and its own description asks the owner directly to confirm a scoping
  call ("Constraint 0": whether "no live Eurostat API spend" should have been read as "no live call at
  all, ever," which is how it was built — the PR ships zero real Eurostat data as a result). See
  [open-questions #249](../open-questions.md). This is a separate track from the chart-quality work
  below — pick it up only if the owner has answered Constraint 0, or ask him directly if it comes up.
- `git status` clean, no stray worktrees, all six merged-PR branches (local + remote) deleted. CI green
  on every commit that ran it this session (docs-only pushes correctly skip CI per the existing
  convention).
- One disclosed mistake this session: killed a `next dev` process assuming it was this session's own
  leftover test server; it belonged to the owner's OTHER project ("Glaibaan"), which the RUNBOOK already
  documented as the usual holder of port 3000/3001 on this machine. No lasting harm, but re-read
  [RUNBOOK.md](../RUNBOOK.md)'s "Running the web app locally WITH the real database" section (and its
  session-104 addendum right below it) before touching any `next dev`/`next-server` process by PID on
  this machine — check the actual working directory first, every time.

## The owner's own priority pivot — this is the actual mandate

After session 104's 3D-demo work shipped and was shown working live, the owner said, in his own words:
**"let's focus the project back on the standard graphs instead of storytelling."** Asked what that
should mean concretely, he chose: run the chart/mapping-library investigation already queued since
session 103 rather than more 3D-demo or storytelling work. **The 3D-demo thread is closed for now — do
not resume it without a new, explicit owner ask,** even if it seems like a natural continuation of
session 104's momentum.

**Before diving in, read both rows in full and resolve one real tension between them:**

- [open-questions #253](../open-questions.md) — investigate whether a different charting/mapping
  library would serve this product's map/geo needs better. Its own "Recommended scope" text is explicit:
  do this comparison **"once a real region-set query capability exists (not before — there is no real
  data to map yet)."** **Check whether that precondition is actually met before treating this as
  actionable** — if a query can't yet return "every region's value" for some CBS measure, a map/geo
  library comparison has nothing real to render against, and doing it anyway risks becoming exactly the
  kind of open-ended, speculative work this session's own lessons argue against.
- [open-questions #254](../open-questions.md) — journalist chart-tool needs research (feeds #253).
  Already checked against what this product has today; **genuine, currently-actionable gaps found, with
  no map precondition blocking them:** (a) a journalist-authored headline/title mechanism (today's title
  is always the CBS table's own — there is real tension with principle (a): the LLM must not narrate a
  takeaway the pipeline hasn't validated, so this needs its own honesty-safe design, not a plain text
  box); (b) context controls (level vs. % change, seasonally-adjusted vs. raw, inflation/population
  normalization — session 69's idea 7, researched, never scheduled).

**If #253's precondition isn't met, #254's two genuine gaps are the more honest match for "focus on
standard graphs" — start there, or say clearly to the owner why the map investigation is blocked and
let him decide whether to unblock it (build the region-set query capability first) or redirect to #254's
gaps instead.** Don't silently pick one without naming this fork to him first if it's a real judgment
call in the moment.

## Binding constraints, unchanged

- No live DDL, no real LLM/API spend, no environment-flag flips — ever, autonomously.
- Full verification block (typecheck ×2, suites solo per the 8GB-OOM-avoidance convention, hermetic
  benchmark gate, real `next build`) plus a `/code-review` pass before every push.
- Branch + PR (never a direct merge) for autonomous core-product code changes — [open-questions
  #118](../open-questions.md)(b). Owner-present sessions may push/merge directly once CI is green —
  [#118](../open-questions.md)(a), standing authorization, no per-change confirmation needed.
- Docs-only changes push straight to `main` (no PR, no CI) per the existing convention.
- **Any charting-library change must be checked against the honesty mechanism first**: the main answer
  pipeline's chart renderer is audited via `chart.test.tsx`'s `scanForUnboundDigits`, which walks the
  rendered DOM's TEXT NODES to prove every visible digit is bound to a real CBS cell (R1/R6) — this only
  works for SVG/DOM output, not `<canvas>`. A canvas-based library (Chart.js and most high-performance
  chart libraries) would need that whole audit mechanism rebuilt, not just a styling swap. Already
  researched in #253 — read it before assuming a library choice is purely aesthetic.

## Suggested next step

Read [open-questions #253](../open-questions.md) and [#254](../open-questions.md) in full, check #253's
precondition against the current query/registry capability (can the product answer "every region's
value" for any measure today? — almost certainly still no, but verify against the actual code, not
memory), then either scope a concrete first slice of #254's genuine gaps (the journalist headline
mechanism is probably the more interesting/harder one; context controls the more mechanical one) or
report back to the owner that the map investigation needs the query-capability prerequisite unblocked
first, and let him choose. If the owner is present: this fork is exactly the kind of thing worth 30
seconds of his input before committing hours of work in either direction.

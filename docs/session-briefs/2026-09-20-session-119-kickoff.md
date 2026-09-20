# Session 119 kickoff — checkdecijfers.nl / graphmaker.studio

Read `CLAUDE.md` first, then `docs/STATUS.md`'s top block (authoritative over anything below it).
Verify everything below against `git log`/`gh run list` before trusting it.

## The short version — chart co-pilot phase 5b is DONE. This session starts fresh, it does not resume a build.

Session 118 (2026-09-20, direct continuation of session 117's owner-present/fully-delegated session)
finished and merged **chart co-pilot phase 5b — the "verified whole"** (pie/stacked/100%-stacked charts
for region-hierarchy CBS/Eurostat data). Merge commit `c7723c34` on `main`, CI green. The branch
(`verified-whole-phase5b`) and its worktree are both deleted — fully absorbed into `main`. There is no
open SDD ledger, no pending fix round, nothing mid-build. Unlike the last two kickoff briefs, this one
is a genuine "pick something new" starting point.

## What shipped (read ADR 056 §"Phase 5b — as built" for full detail)

Pie, stacked, and 100%-stacked chart forms are now honestly offered on a CBS/Eurostat chart when its
regions are a complete, CBS-known roster (all provinces, all landsdelen, all gemeenten of one named
province) — verified on demand, server-side, that the visible parts genuinely sum to a real
CBS-published total, with no new CBS fetch and no new audit row. Donut is a presentation variant of pie,
not a fourth form. `ChartForm` is now 11 members; `CBS_COPILOT_PROMPT_VERSION` is 3.

The final whole-branch review (run on Opus, the most capable available tier) found one real gap after
five individually-clean task reviews: `RegionSetCoverage.complete` — an existing type none of the five
tasks modified — was never consulted before verifying a roster, so an incomplete roster (a member with no
observation row at all, not the same as a withheld/null one) could pass the sum check within tolerance on
small-gemeenten rosters. Fixed with a coverage gate mirroring the existing `deriveRegionRanking`
precedent, a proving test, and a bundled promise-rejection fix — scoped re-review clean, merged.

## What's next is a genuinely open choice — nothing is mandated

Three live, not-yet-started candidates, none chosen for you:

1. **Scatter** ([#296](../open-questions.md)) — the other capability phase 5's "Split" decision deferred.
   Needs a new two-measure-per-point `ChartPoint`/`ChartSpec` shape first (every point carries exactly one
   value today) — a real schema change, not a small addition. This is the harder of the two "expand chart
   types" options remaining.
2. **The six house styles + homepage themes row** ([#275](../open-questions.md)) — the other standing
   candidate the owner was offered against phase 5b at session 117's start and didn't pick then. Still
   live.
3. **Closing the deferred Minor findings from phase 5b's final review** ([#300](../open-questions.md)–
   [#305](../open-questions.md)) — none is a data-integrity risk (already independently confirmed by two
   separate reviewers), all are small, none is scheduled. Worth doing only if the owner specifically wants
   them closed rather than tracked; otherwise leave them as open-questions rows.

Ask the owner, or if this is an autonomous/delegated session with no owner steer available, use judgment
on which candidate has the clearest signal — don't invent a fourth option or silently pick the smallest
one to look productive.

## Two things worth reading before starting new design work

1. **A whole-branch review's value was concretely proven this session, not just asserted.** Its one real
   finding lived entirely in the seam between the new feature and an unmodified upstream type
   (`RegionSetCoverage`) that no task's own diff ever touched — five clean task reviews structurally could
   not have caught it. If a future feature reads an existing type/field without modifying it, that's
   exactly the kind of dependency a final-review dispatch brief should name explicitly, not leave to the
   diff to surface on its own.
2. **Full delegation ("work autonomously") survives a session boundary cleanly when the resume state is
   honestly documented.** Session 117 wrapped mid-build with an explicit, detailed resumable state (SDD
   ledger, STATUS top block, a dedicated kickoff brief); session 118 picked it up and finished the whole
   build — fix round, Task 5, final review, one more fix round, merge — without the owner needing to
   repeat or clarify anything. The lesson generalizes: a careful mid-build wrap-up isn't diligence for its
   own sake, it's what makes a later session's full autonomy possible at all.

## Binding constraints and owner steers (carried forward, still true unless a new session hears otherwise)

- Cheapest mechanism first; plain full-sentence Dutch or English for the owner; no shorthand.
- Git: owner-present → push to `main` after the full verification block; autonomous → branch + PR
  ([#118](../open-questions.md)). Migrations file-only; live DDL, real LLM spend, env flags stay
  owner-supervised. The repo is public: "Competitor G" only, never the real name.
- Tier rule: session model thinks; implementers on a cheaper tier (Fable was the owner's standing steer
  across sessions 117-118, given in-chat — confirm it still stands if a brand-new session starts with no
  visible steer, since it's a role-based convention, not a hardcoded default); the whole-branch final
  review on the most capable tier.
- `ChartForm` is a widely-narrowed shared type (now 11 members). Any future widening needs a full repo
  grep of every narrowing site plus the full (non-scoped) typecheck and a real `next build` — this class
  of gap has now been hit and correctly handled twice (sessions 116 and 117 for `ChartForm`/`RegionScope`
  respectively).
- Recharts-specific: `<ReferenceLine>`/`<ReferenceArea>` must be direct JSX children, never wrapped in a
  custom component. Prefer the `EndLabelsOverlay`/`DumbbellOverlay` hook pattern for custom-positioned
  marks; native Recharts components (`PieChart`/`Pie`, `BarChart` with `stackId`) are also now a proven
  pattern in this codebase (phase 5b), not just custom overlays.
- No number is ever drawn that isn't a real fetched cell's own value, or pure arithmetic over
  already-verified reals. This is the one invariant every phase of this feature is built around.

## Tracked, not the focus

[#289](../open-questions.md)–[#295](../open-questions.md) (earlier phase residuals); [#300](../open-questions.md)–
[#305](../open-questions.md) (phase 5b's own deferred Minors); rebrand to graphmaker.studio
([#7](../open-questions.md)); the usual owner-steps backlog (registry:apply, DOI backfill, live
benchmark, region-set Task 9, audit row 22, the two `:record` runs + `benchmark:run:live` — all blocked
on the Anthropic workspace usage cap until 2026-10-01, unchanged for several sessions now).

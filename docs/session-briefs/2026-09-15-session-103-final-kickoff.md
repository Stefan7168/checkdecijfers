# Session 104 kickoff — checkdecijfers.nl

Paste this whole file (or just the "Kickoff prompt" section) to start the next session.

## Reading order

Read `CLAUDE.md` first, then `docs/STATUS.md`'s top block (authoritative over anything below it if
they ever disagree), then `docs/08-build-plan.md` for the work plan. Everything below is a snapshot
as of 2026-09-15, session 103's end — verify against `git log`/`gh pr list` before trusting any of
it, since more may have landed since.

## Current state (verified, not recalled)

- **`main` at `8a08f08`.** Two PRs merged this session: **PR #30** (3D municipality map DEMO,
  `49cd975`, ADR 049 — `/bevolking-3d-demo`, login-gated, fictional data, NOT part of the product)
  and **PR #31** (chart-card polish, `f733db7` — quiet controls, a headline figure, a lighter grid,
  on the REAL production chart renderer). Both went through an independent `/code-review` pass (8
  finder angles, medium effort) that found 9 real, confirmed issues across the two PRs — all fixed
  and re-verified (full suites, benchmark gate, real build, CI) before merging.
- **Seven PRs still open, untouched by this session's later stretch, all awaiting owner review:**
  #23 (WP30c E1 Eurostat — "Constraint 0" needs the owner's reading confirmed, see
  [open-questions #249](../open-questions.md)), #24 (health-check `pro_subscriptions` fix), #25
  (dead chart-story cleanup, #230), #26 (DatasetTurnEnvelope key manifest, #209), #27 (shared
  `isRedacted` helper, #227), #28 (`useElementWidth` reparenting fix, #234), #29 (this file's own
  `STATUS.md` known-debt trim — see the "Known debt" note near the top of `docs/STATUS.md`, still
  applies until #29 merges).
- **`git status` clean, no stray worktrees, production confirmed 200 (`checkdecijfers.vercel.app`).**
- **Two owner-review questions live on [open-questions #255](../open-questions.md)** (chart-card
  polish, PR #31): (a) should the new headline figure be suppressed on the inline chat card
  specifically, since the chat answer's own prose already states a number? (b) should `Opmaak` keep
  a visible text label instead of going icon-only? Both built to the plan's own stated defaults
  (shown everywhere, icon-only) — not yet an owner decision either way.
- **Task 5 of the chart-card-polish plan was deliberately NOT built** — it moves a pinned
  `STOCK_PRESENTATION` default and needs an explicit owner yes after seeing the merged Tasks 1-4 for
  real, not a session guess.

## What just happened, condensed

The owner asked, live in chat, for a Three.js 3D municipality map (after seeing a reference site he
built himself) and separately for a visual polish pass on the real chart card. Both were planned by
Fable 5.1 (verified against the real code before trusting either plan), built by two parallel
background agents in separate git worktrees, independently code-reviewed by this session (not the
build agents' own self-review), had every confirmed finding fixed, and were merged on the owner's
explicit "Merge both PRs" instruction. Full account: `docs/status-archive.md`'s two session-103
entries (newest on top) and `docs/lessons-learned.md`'s session-103 entries (two: the original PR
#30 build, and this continuation covering PR #31 + the reviews + the merges).

**Four process lessons worth reading before dispatching more parallel background builds:**
1. Subagents cannot "wait" on their own background processes — tell them explicitly, in the
   dispatch prompt itself, to run verification blocking, not backgrounded-and-hoping.
2. `git merge-tree <base> <a> <b>` needs the REAL merge-base (`git merge-base origin/main
   <branch>`), not current `main` passed as its own base — the wrong triple silently checks the
   wrong thing and can report "no conflict" when a real one exists.
3. Parallel worktrees touching `open-questions.md` can collide on row numbers with no visibility
   into each other's claims (or an already-open PR's claims) — check `docs/open-questions.md` for
   the true next-free number right before merging, don't trust what a background build claimed.
4. A broad `pkill` by an agent fighting resource contention risks killing a SIBLING agent's
   in-flight process on the same shared machine — name this risk explicitly in a dispatch prompt
   when running parallel builds, rather than discovering it mid-session.

## Binding constraints, unchanged

- No live DDL, no real LLM/API spend, no environment-flag flips — ever, autonomously.
- Full verification block (typecheck ×2, suites solo per the 8GB-OOM-avoidance convention,
  hermetic benchmark gate, real `next build`) plus a `/code-review` pass before every push.
- Branch + PR (never a direct merge) for autonomous core-product code changes — [open-questions
  #118](../open-questions.md)(b). Owner-present sessions may push/merge directly once CI is green —
  #118(a), standing authorization, no per-change confirmation needed.
- Docs-only changes push straight to `main` (no PR, no CI) per the existing convention.

## Suggested next step

Re-triage `docs/open-questions.md` fresh before picking any new autonomous target — don't reuse this
file's own judgment calls from earlier in the session, since merging PR #30/#31 may have changed
what's safely available (check for file overlap with the 7 still-open PRs' branches first). If the
owner is present: the seven open PRs are the more valuable thing to walk through together than
opening an eighth.

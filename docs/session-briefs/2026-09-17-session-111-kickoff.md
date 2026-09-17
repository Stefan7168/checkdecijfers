# Session 111 kickoff — checkdecijfers.nl

Read `CLAUDE.md` first, then `docs/STATUS.md`'s top block (authoritative over anything below it).
Verify everything below against `git log` / `gh run list` before trusting it — this brief may be stale.

## The short version

Session 110 (2026-09-17, owner away, fully autonomous) ran three waves of subagents and merged
20 branches into `main` in one verified batch (`2bdbb4c`, CI run `35196289551`): the region-set
query (tasks 1–8, ADR 054), a Playwright UX audit with 21 of 25 findings fixed, PDF/transparent-PNG
export (ADR 053), the last two #23 alert triggers, and a dozen smaller items. Measured: backend
180/2666, web 117/1933, benchmark 14/14 + 6/6 + 0 fabricated, real build, `/code-review` LOW clean.

## Owner steps (each is one command or one decision; none were run autonomously)

1. `npm run registry:apply` — the #254(a) `periodChangeEligible` marker lives in the live
   `canonical_measures.alternates`; until applied, production shows no %-change entry for the
   income alternates.
2. `npm run backfill:eurostat-doi -- --apply` (dry-run without `--apply` first) — #264, session 109.
3. `npm run benchmark:run:live` then `benchmark:score:live` — confirms the #216 fix on real data
   (real LLM spend).
4. Region-set Task 9 — expose the capability through the parser (#267): re-records 103 LLM
   fixtures, procedure in `docs/superpowers/plans/2026-09-17-region-set-query.md` Task 9.
5. UX-audit pass-1 row 22 — the trust pages (`/werkwijze`, `/privacy`) still show "Draft — under review";
   sign off or hide pre-launch. Pass-2 rows 18/19 (source-aware footer on Eurostat pages; the
   "Never go stale — go Pro" pitch inside embed footers) are product-voice calls too.

## What's next (no owner-queued priority)

- A THIRD UX pass on what pass 2 still could not reach: small multiples, region-set rendering,
  `/eurostat-explorer` past its empty state, the headline/insights happy paths — the harness needs an
  intent-injection hook first (see pass 2's "Could not reach"). Use `scripts/dev-harness/` (RUNBOOK
  § "Local real-browser harness") — zero LLM spend. Then a fix wave by file ownership.
- Landing lazy-load: measured and reverted in session 110 (it broke 56 synchronous `chart.test.tsx`
  assertions) — first make those assertions async, then re-apply; numbers + the module list are in
  `docs/session-briefs/2026-09-13-build-performance-diagnosis.md` "Landing bundle (session 110)".
  A worktree needs a REAL `npm ci` (not the symlinks) for Turbopack to build.
- WP30c E2 (Eurostat beyond the explorer) — #250(a) Dutch wording sign-off is the owner's first.
- #260 Supademo polish (brainstorming first), #212 tier-3 "edit feel" (design round).
- Stripe live-mode / KvK — never raise as a next step (#54).

## How session 110 ran its subagents (reuse this)

Create each worktree YOURSELF from local `main` (`git worktree add .claude/worktrees/sNNN-x -b sNNN/x main`)
and symlink `node_modules` + `web/node_modules` into it before dispatch — the Agent tool's own
`isolation: "worktree"` branches from `origin/main` and misses everything you merged locally. Every
brief says: no backgrounding (one blocking call each), targeted test files only with `--maxWorkers=1`,
never the full suite / `next build`, never `git add -A` (the symlink is untracked), the FILES other
agents own and it may not touch, commit on its branch, no push/PR/merge, no STATUS/archive/lessons/
build-plan edits. Ask it to report what it saw and did not do — those notes were the best follow-ups.
The parent merges (`--no-ff`), runs the full block ONCE serially, `/code-review` LOW, pushes.

## Standing reminders

Full verification block + `/code-review` LOW before every code push. Owner-present sessions push
directly to `main` once green; autonomous sessions keep branch + PR for core/money-path code (#118)
— session 110 pushed directly on the owner's explicit "work autonomously … finish the app" instruction,
recorded in the status archive. Live DDL, real spend, env-flag flips stay owner-supervised.

## Worktree state

All `s110/*` branches and `.claude/worktrees/{agent-*,s110-*}` worktrees were removed at wrap-up.
Pre-existing worktrees from earlier sessions (`embed-charts`, `experiment/162-slot-filling-ab`,
`journey-programme`, `visual-*`, `worktree-chart-alternate-reading-toggle`) are untouched.

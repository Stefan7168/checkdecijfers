> **Historical — superseded by [2026-09-17-session-111-kickoff.md](2026-09-17-session-111-kickoff.md) (session 110 ran and built most of what this brief lists as open).**

# Session 110 kickoff — checkdecijfers.nl

Read `CLAUDE.md` first, then `docs/STATUS.md`'s top block (authoritative over anything below it). Verify
everything below against `git log` / `gh run list` before trusting it — this brief may be stale.

## The short version

Session 109 (2026-09-17, owner present but hands-off: "spawn a bunch of sub-agents … do not ask me questions")
built or researched SIX independent open-questions items with six parallel subagents, merged all of them to
`main` in one batch, verified once serially (backend 168 files/2543 tests, web 117/1859, benchmark
14/14+6/6+0 fabricated, real `next build`, `/code-review` LOW 0 findings), and pushed. Check `gh run list`
for the CI run on the docs commit that closed the session.

## What landed

1. **#264 Eurostat DOI** — built. Constructed `10.2908/<CODE>`, stored only after a DataCite `findable`
   confirmation, CBS untouched. **Owner step still pending:** the live backfill of the one already-registered
   row, `npm run backfill:eurostat-doi -- --apply` (dry-run without the flag; RUNBOOK § DOI backfill).
2. **#251 per-cell status** — built. The narrow waist carries an optional `CbsObservationRow.status`;
   Eurostat's unflagged cells render definitive, every flag stays provisional; CBS is byte-identical (pinned).
   WP30c E2 is no longer blocked on provisional marking.
3. **#246 Pro-bucket cost caption** — built, display-only, unreachable until `PRO_SUBSCRIPTIONS_ENABLED`.
4. **#252 live-chat proof URLs** — built, server-side after settlement, fail-open.
5. **#23 ingestion alerts** — built for batch failures/quarantines (one admin email per run). Missed-sync and
   `/api/health` alerting remain open and need a cadence baseline first.
6. **Research:** #253's region-set query capability is still absent — the row now carries a concrete 5-point
   build scope; #254(a)'s three household-income alternates are verified eligible for `period_change`, but
   `PERIOD_CHANGE_ELIGIBLE_KEYS` is keyed by primary key only, so extending needs a per-alternate marker.

## What's next — no owner-queued priority

Candidates, roughly by buildability:
- The `tipsbd30` DOI backfill — owner-run, one command, verify with a dry run first.
- **#253 region-set query** — the real prerequisite for any map/geo work; the row's scope names the resolver,
  intent shape, the reusable `region_code = any(...)` SQL, and the R5/R9 honesty guard against ranking claims
  on partial coverage. Needs a design pass (brainstorming skill) before building.
- **#254(a)** extend `period_change` to the income alternates (small, hermetic, no fixture invalidation).
- **WP30c E2** — Eurostat beyond the internal explorer; #250(a) Dutch wording sign-off is the owner's.
- #260 Supademo polish (deferred), #245 Action 3 (owner sub-questions), #254(b) PPI re-record (real spend).
- Stripe live-mode / KvK — never raise as a next step (#54).

## How session 109 ran its subagents (reuse this)

Every brief said, up front: no backgrounding, every command one blocking foreground call, you never receive
a notification; targeted test files only with `--maxWorkers=1`, never the full suite (8 GB machine); the
named function you may touch in any shared file; commit on your branch, do not push/PR/merge, do not edit
STATUS/archive/lessons/build-plan. Result: zero stalls (session 108 needed three resumes). The parent
merges, runs the full verification block ONCE, runs `/code-review` LOW, pushes. Agent worktrees have no
`node_modules` — tell agents to symlink main's and remove the symlink before committing. Two agents
appending to the same ADR will conflict; that's a one-script "keep both" resolve, then renumber.

## Standing reminders

Full verification block + `/code-review` LOW before every code push. Owner-present sessions push/merge
directly to `main` once green. Autonomous sessions keep branch+PR for core/money-path code. Live DDL, real
spend, env-flag flips stay owner-supervised.

## Worktree state

All six `s109/*` branches and their `.claude/worktrees/agent-*` worktrees were removed after the merge.
Pre-existing worktrees from earlier sessions (`embed-charts`, `experiment/162-slot-filling-ab`,
`journey-programme`, `visual-*`, `worktree-chart-alternate-reading-toggle`) are untouched.

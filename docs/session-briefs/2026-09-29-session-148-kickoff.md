# Session 148 kickoff (written 2026-09-29 night, end of session 148)

Read order: `CLAUDE.md` → `docs/STATUS.md` top block → this file → then the plan it points to. Verify every claim against
`git log`, `gh run list --branch main -L 5`, `gh pr list` and prod (`curl -sI https://checkdecijfers.vercel.app/`) before acting.
This file **supersedes** [2026-09-29-session-147-kickoff.md](2026-09-29-session-147-kickoff.md) and, through it, the session-146
kickoff — their "Standing constraints" and "Tracked, not the focus" sections still hold word for word; read them too.

## What session 148 did (all verified 2026-09-29)

- **Found and fixed a stale showcase ([#355](../open-questions.md)).** Comparing the live site with CBS's own dates showed 13 of 20
  CBS tables behind (up to 52 days) and a homepage GDP figure CBS had since revised (1.3 → 1.6). Built `npm run ingest:freshness`
  (read-only; SAFE/REVIEW verdict per table), refreshed all 13 tables one at a time (batches 46–58, no quarantine), fixed the English
  chart unit "Aantal". Pushed `92746fe5`, CI 36592945949 green incl. deploy; live site re-checked after deploy.
- **Rehearsed the 1 October plan for free.** `regional-stats-part2` rebases cleanly onto `main` (108 commits of drift); the 65 red
  tests on the rebased tree are all intent-fixture hash misses; **the plan was missing a FOURTH record script**
  (`onboarding-delivery:record`) — now in [2026-10-01-recording-run-plan.md](2026-10-01-recording-run-plan.md) step B3.
- **Drafted the ten Eurostat step-0 cases:** [2026-10-01-eurostat-step0-cases.json](2026-10-01-eurostat-step0-cases.json).
- Zero AI spend. The real branch `regional-stats-part2` was not touched (the rebase ran in a deleted throwaway branch).

## Where things stand

- **Data is fresh as of 2026-09-29** but nothing keeps it fresh: **run `npm run ingest:freshness` first thing** in any session (and in
  the monthly maintenance session). SAFE tables: `npm run ingest sync <ids> --accept-new-codes` (owner-supervised, one table at a
  time, most-showcased last, stop on failure; RUNBOOK release-day sync). REVIEW tables: a person looks; never force.
- **Open owner decision (#355), recommendation first:** have the existing daily cron (`/api/onboarding-cron`, 06:00) also compare
  CBS's `Modified` dates and **e-mail the owner the exact command** when newer data exists; only if the monthly manual run proves a
  chore, auto-sync the SAFE tables. Ask it inside the same dialog as the recording-run decisions.
- Everything else is unchanged from the session-147 kickoff: own-data import live (#354); breadth dark with migrations 037 + 038
  live; SEO page `/netherlands-cbs-data` live but noindex (#353); DNS records for graphmaker.studio still missing (owner's step at
  Cloudflare: `A @ 76.76.21.21` and `A www 76.76.21.21`, DNS-only); launch deferred twice (#352, do not raise before 2026-10-27).

## The single next priority

**On/after 2026-10-01 00:00 UTC (= 02:00 CEST; never start on the evening of 2026-09-30), owner present:** run
[2026-10-01-recording-run-plan.md](2026-10-01-recording-run-plan.md) — A table parser → B regional Part 2 (**four** record scripts,
not three) → C Eurostat step 0 (use the drafted cases file). ~$4.35 budget of the $50 roof. Pre-flight first (zero spend; the B
rebase part is already rehearsed — re-run only if `main` moved a lot), then ONE dialog: the plan's three decisions + the #355
cron decision + the GO, everything readable inside the dialog.

If a session starts BEFORE 2026-10-01: the recording cannot run. Run `npm run ingest:freshness`; check DNS (`dig +short A
graphmaker.studio`); if the records exist do RUNBOOK wiring steps 2–3; otherwise offer the #355 cron decision or a wrap — do not
invent work. (Lesson of session 148: before offering a wrap, dogfood the live product against the source of truth.)

## Standing constraints

Principles (a)/(b)/(c); full verification block (`scripts/verify-block.sh <dir> <log> --e2e`, solo on the 8 GB machine; measured 2026-09-29: 12.5 min end to end with --e2e) +
`/code-review` LOW + green CI before any code push; no AI spend, no DDL without the owner; never `gh secret set`, never `spawn_task`;
`git checkout -- web/CLAUDE.md` before every commit; plain English, everything the owner must read goes INSIDE the question dialog.
Live data syncs: one table at a time, canary first, stop on failure (a validator failure quarantines the table until re-baselined).

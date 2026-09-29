# Session 149 kickoff (written 2026-09-30 local / 2026-09-29 UTC, end of session 149)

Read order: `CLAUDE.md` → `docs/STATUS.md` top block → this file → then the plan it points to. Verify every claim against
`git log`, `gh run list --branch main -L 5`, `gh pr list` and prod (`curl -sI https://checkdecijfers.vercel.app/`) before acting.
This file **supersedes** [2026-09-29-session-148-kickoff.md](2026-09-29-session-148-kickoff.md); its "Standing constraints" and
the session-147/146 kickoffs' "Tracked, not the focus" sections still hold word for word.

## What session 149 did (verified 2026-09-29/30)

- Owner delegated the one open decision (#355, "up to you") → built the **daily new-CBS-data e-mail** (commit `5d8bb265`): the cron
  compares CBS's `Modified` date with our `last_sync_at` for every served CBS table and mails the owner the tables + the command
  (day 0, then every 7th day). Read-only, zero AI, never syncs. Option (b), auto-sync, stays NOT built. RUNBOOK: "New-CBS-data alert".
- Verified before push: both typechecks, backend 4678 tests, benchmark PASS (6/6, 0 fabricated), web 3479 tests, real build, `/code-review` LOW clean.
- Zero AI spend, no DDL, no data written. `npm run ingest:freshness` read 0 of 20 behind.

## The single next priority (unchanged)

**On/after 2026-10-01 00:00 UTC (= 02:00 CEST; never start on the evening of 2026-09-30), owner present:** run
[2026-10-01-recording-run-plan.md](2026-10-01-recording-run-plan.md) — A table parser → B regional Part 2 (**four** record scripts) →
C Eurostat step 0 (cases in [2026-10-01-eurostat-step0-cases.json](2026-10-01-eurostat-step0-cases.json)). ~$4.35 of the $50 roof.
Pre-flight first (zero spend), then ONE dialog: the plan's three decisions + the GO, everything readable inside the dialog.
(The #355 cron decision is now closed — no need to ask it.)

If a session starts BEFORE 2026-10-01: the recording cannot run. Run `npm run ingest:freshness`; check DNS (`dig +short A
graphmaker.studio`; the owner's Cloudflare step: `A @ 76.76.21.21` and `A www 76.76.21.21`, DNS-only); if present do RUNBOOK wiring
steps 2–3; otherwise dogfood the live product against CBS, then wrap — do not invent work.

## Watch item

The first real e-mail from the new alert will arrive when CBS next changes a served table. If a table is behind and no mail came, check
`RESEND_API_KEY`/`ADMIN_ALERT_EMAIL` on Vercel and the `[new-cbs-data]` line in the cron's logs (RUNBOOK "If the alert misbehaves").

## Standing constraints

Principles (a)/(b)/(c); full verification block (`scripts/verify-block.sh <dir> <log> --e2e`, solo on the 8 GB machine) +
`/code-review` LOW + green CI before any code push; no AI spend, no DDL without the owner; never `gh secret set`, never `spawn_task`;
`git checkout -- web/CLAUDE.md` before every commit; plain English, everything the owner must read goes INSIDE the question dialog.
Live data syncs: one table at a time, canary first, stop on failure. Launch deferred twice (#352): do not raise before 2026-10-27.

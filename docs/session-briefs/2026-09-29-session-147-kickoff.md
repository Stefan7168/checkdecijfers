# Session 147 kickoff (written 2026-09-29 evening, end of session 147 — a verify-only session)

Read order: `CLAUDE.md` → `docs/STATUS.md` top block → this file → then the plan it points to. Verify every claim against
`git log`, `gh run list --branch main -L 5`, `gh pr list` and prod (`curl -sI https://checkdecijfers.vercel.app/`) before acting.
This file **supersedes** [2026-09-29-session-146-kickoff.md](2026-09-29-session-146-kickoff.md) (its standing constraints and
"tracked, not the focus" list still hold word for word — read that file's last two sections too).

## What session 147 did

Nothing that changes code or data. It verified state at 2026-09-29 (clean tree at `62896015`, pushed; CI 36576714588 green on
`175a20ea`; no open PRs; prod 200; no stray worktrees), found that the graphmaker.studio Cloudflare A records **still do not
exist** (`dig +short A graphmaker.studio` empty; `vercel domains inspect` still warns; nameservers are Cloudflare's), and, on the
owner's pick, wrapped up because nothing scheduled can run before 2026-10-01.

## Where things stand (all verified 2026-09-29)

- **Own-data import is live** (session 146, #354): Excel/ODS/JSON, pasted tables, Google Sheet share links; migration 039 applied.
- **Breadth is dark but its migrations 037 + 038 are live**; `TABLE_LANE_ENABLED` unset; the table parser has never called the AI.
- **SEO page `/netherlands-cbs-data` is live but noindex** (#353); flips only after the domain is wired.
- **Domain:** the owner's step is two DNS records in Cloudflare (RUNBOOK "Wiring graphmaker.studio" step 1: `A @ 76.76.21.21`
  and `A www 76.76.21.21`, both DNS-only / grey cloud). Offered again in session 147; the owner chose to wrap instead.
- **Launch:** deferred twice (#352) — do not raise before 2026-10-27 unless the owner does. Brand colours / Pro plan: parked.

## The single next priority

**On/after 2026-10-01 (the spend roof resets 2026-10-01 00:00 UTC = 02:00 CEST; never start on the evening of 2026-09-30),
owner present: run [2026-10-01-recording-run-plan.md](2026-10-01-recording-run-plan.md)** — A table parser → B regional Part 2
(branch `regional-stats-part2`) → C Eurostat step 0, ~$4.35 budget. Start with its pre-flight (zero spend), then ask the owner
its three decisions and the GO in ONE dialog with everything readable inside the dialog.

If a session starts BEFORE 2026-10-01: the recording cannot run. Check the DNS first (`cd web && vercel domains inspect
graphmaker.studio`); if the records exist, do RUNBOOK wiring steps 2–3; otherwise offer a wrap again — do not invent work.

## Standing constraints

Unchanged — see the "Standing constraints" and "Tracked, not the focus" sections of the session-146 kickoff. Highlights:
principles (a)/(b)/(c); full verification block + e2e + `/code-review` LOW + green CI before any code push; no AI spend, no DDL
without the owner; never `gh secret set`, never `spawn_task`; `git checkout -- web/CLAUDE.md` before every commit; plain English.

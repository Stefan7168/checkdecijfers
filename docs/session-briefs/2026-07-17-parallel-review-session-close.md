# Parallel review session — close-out (2026-07-17, owner-present, ran alongside session 50)

**This thread is CLOSED with nothing open.** The primary next-session kickoff is session 50's to write
(it was still running — vocab batch for sprint tables #2/#3 — when this thread wrapped). A fresh session
should read [STATUS.md](../STATUS.md) first as always; this file only records what the parallel thread
did and the one standing hold it introduced.

## What this thread did (all verified, all on main, CI green end-to-end)

1. **Max-effort review of PR #54** (the #166 already-curated guard, including session-50's then-uncommitted
   second leg): 10 finder angles + 6 adversarial verifiers + gap sweep → **12 findings (10 CONFIRMED,
   2 PLAUSIBLE), 6 refuted**. Durable record + session-50's full dispatch annotation:
   [2026-07-17-pr54-max-review-findings.md](2026-07-17-pr54-max-review-findings.md). All 12 landed in
   session-50's `c7f6063` (per-measure belt, active-check-first guard order, batched held-screen,
   fetch-neutral mail, doc corrections). Nothing from the review remains open; the one deliberately-deferred
   item (richer "bedoel je <curated term>?" clarification — new Dutch copy, owner sign-off) is recorded in
   open-questions #166.
2. **Dependabot triage:** PRs #51, #52, #53 reviewed and squash-merged serially after main green.
   #53's deploy went red (see hold below); fixed forward same hour in `eec3973`, gate + deploy green
   (run 29569012407). Prod was never affected.

## The one standing hold a future session must know

**TypeScript is major-pinned to ^5 in BOTH package.json files** — TS 7 breaks `next build`'s TypeScript
step on Next 16.x while every test gate stays green (the `tsc` CLI is fine; only Next's in-build
integration rejects the native-compiler package). Dependabot carries `ignore` rules (semver-major,
typescript) in both npm entries. Lift condition + procedure: the comment in
[.github/dependabot.yml](../../.github/dependabot.yml) and the RUNBOOK monthly-maintenance note — lift
both pins and both ignores together, prove with a real `next build` before pushing.

## Pointers

- Findings + dispatch record: [2026-07-17-pr54-max-review-findings.md](2026-07-17-pr54-max-review-findings.md)
- Session log entry: [status-archive.md](../status-archive.md) (2026-07-17, parallel review session)
- Lessons added: gate-green ≠ deploy-green for toolchain bumps; a queued cross-session message is not a
  merge gate; fetch+reset a fresh worktree before editing ([lessons-learned.md](../lessons-learned.md))

# Session 129 kickoff (written 2026-09-25, end of sessions 127–128)

Read order: `CLAUDE.md` → `docs/STATUS.md` top block → this file. Verify every claim here against `git log`,
`git log origin/main..main` and the Actions runs before acting on it.

## Where things stand

- **Nothing from sessions 127–128 is pushed.** On 2026-09-25 the owner said "keep working locally, don't push yet".
  Local `main` is 47+ commits ahead of `origin/main` (`598d0f10`). Production is unchanged since session 126
  (own-data parity phase A + PR #46). There is no CI run for any of the new work.
- **Built locally, dark:** own-data chart publishing (ADR 057, #318 B1), behind `OWN_DATA_PUBLISH_ENABLED` and
  migration 036 (file-only, never applied, still editable in place). Session 128 added the frozen publish-time look,
  `?lang=` precedence, a shared embed error page, a real-browser e2e, and fixed the security review's proven leaks
  (#322).
- **Also local:** nine backlog fixes (#317 #319 #321 #243 #283 #282 #309 #287 #304) and a move-only split of
  `web/components/chart.tsx` (6,535 → 4,761 lines).
- **Measured at `c966f9c4`:** typechecks clean; backend 3,346/3,346; benchmark GATE PASS (6/6, 0 fabricated);
  `next build` compiled. Web suite: every file passes alone; full-suite runs had 1–2 load-dependent timeouts on a
  machine at load average 12–15 (the owner's other project was running). Treat the web suite as NOT yet proven.

## The single next priority: get the local work reviewed, verified and pushed

1. Show the owner the plain-English summary (STATUS top block + `docs/status-archive.md`'s sessions 127–128 entry)
   and get an explicit GO / "push it". The owner does not review code (CLAUDE.md); the GO is on the summary.
2. On a quiet machine (`sysctl vm.swapusage`, `df -h /`, `uptime` first): `npm ci` in root and `web/` if the
   lockfiles moved, then `scripts/verify-block.sh` (detached, watch the log). If a web test times out, re-run the
   suite once alone before calling it a regression; a real failure fails the same way alone.
3. Run the new e2e from the MAIN checkout (symlinked worktrees can't run `next dev`):
   `cd web && npx playwright test e2e/own-data-publish.spec.ts e2e/own-data-copilot.spec.ts`. It has never passed
   yet; both local failures were timing (first compile, harness start-up), not assertions.
4. `/code-review` LOW over `origin/main..main` (`git add -N` any untracked new files first). Fix or rule on every
   finding.
5. Push (owner-present standing authorization, CLAUDE.md #118 revision — but get the in-chat GO first, RUNBOOK
   session 126). Watch CI to green, including deploy and the post-deploy smoke.

## After that (in order)

- **#322 I-3 — blocks the publish flag flip.** Wire `purgeExpiredDatasets` into the monthly purge cron
  (`web/app/api/gdpr-purge-cron/route.ts`) and `scripts/gdpr-purge.ts`, like the chart-styles leg, and decide with
  the owner whether "delete my question history" (or a new account-level delete) also calls `deleteUserDatasets`.
  This changes what the LIVE monthly purge deletes (it runs with `GDPR_PURGE_APPLY=1`), so owner GO first. Then
  correct ADR 037 point 6 / ADR 057 point 6 (both carry a session-128 correction note saying it is NOT wired).
- Residual #322 items: I-4 (c) store the pruned public payload at publish time, (d) a rate limit; a crafted log of
  200 data commands still costs one recalculation each per view (capped); dumbbell/slope with a hidden series fall
  back to bar publicly; count + split-by labels every series "Count of …".
- Then the owner-supervised switch-on: `npm run db:migrate` (036), `OWN_DATA_PUBLISH_ENABLED=1` in Vercel, redeploy,
  the live check in RUNBOOK "Own-data publishing (ADR 057) — switching it on".
- The owner's 13 pending decisions: `docs/session-briefs/2026-09-25-owner-decisions.md`.

## Standing constraints

- Principles (a)/(b)/(c); invariant P1 for anything on the public own-data page.
- No live DDL, real LLM spend or env-flag flips without the owner present. Never `gh secret set`. Never put flags in
  `.env`. Never call `spawn_task` (track follow-ups as open-questions rows). The repo is PUBLIC.
- Plain English for the owner; he does not read code.
- Anthropic API usage cap until 2026-10-01: no `:record` scripts, no live benchmark, E2a steps 0/5/6 wait.
- 8 GB machine: one vitest/tsc/playwright at a time across all agents; check swap + disk before each wave
  (RUNBOOK multi-agent gotchas #15).
- Model tiers: the session model thinks and reviews; cheap/mid tiers do legwork; opus for privacy/security review.

## Tracked, not the focus

E2a owner steps after 2026-10-01 (#313); owner steps pending since session 110/111 (cap-blocked); Dependabot PRs
#33–#36; stale worktree `chart-copilot-phase6` @ `58db5097` (owner's call); #272 lint blocked upstream (no
typescript-eslint support for TypeScript 7).

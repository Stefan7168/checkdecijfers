# Session 130 kickoff (written 2026-09-25, end of session 129)

Read order: `CLAUDE.md` → `docs/STATUS.md` top block → this file. Verify every claim here against `git log`,
`gh run list --branch main` and prod (`curl https://checkdecijfers.vercel.app/`) before acting on it.

## Where things stand

- **Everything is pushed and live.** Sessions 127–128 (own-data publishing, dark) and all of session 129 are on `main`
  and deployed. Last code CI runs green incl. deploy: 36122408632 (`f2fe860c`) and the Dependabot action-bump merge
  (check `gh run list -L 3 --branch main` — it was running at wrap-up time).
- **Session 129 shipped:** #322 I-3 (monthly purge + "delete my question history" cover uploaded datasets; owner GO);
  #294 English overlay unit words; #285 a chart edit that applied nothing is refunded (CBS) / priced as a
  clarification (own-data); #260 scoped (rounded free-end bar corners, tidier tooltip — palette unchanged); published
  dumbbell/slope keep their form with a hidden series; split aggregate/derived own-data series named by split value;
  Dependabot #33/#34 (actions/upload-artifact v7, actions/cache v6) merged.
- **Own-data publishing is still DARK** — nothing blocks the switch-on any more except the owner being present.

## Owner-only chores (a session cannot do these — write them down, don't ask again)

1. **Switch on own-data publishing** (owner present): `npm run db:migrate` (applies migration 036),
   `OWN_DATA_PUBLISH_ENABLED=1` in Vercel Production, redeploy, then RUNBOOK "Own-data publishing (ADR 057) —
   switching it on" live check (publish one chart, open the link logged-out, unpublish, link dies).
2. **After the Anthropic API cap lifts on 2026-10-01:** Eurostat E2a steps 0/5/6 (#313); the `:record` scripts; the
   live benchmark; the other cap-blocked steps pending since sessions 110/111.
3. **Decisions in `docs/session-briefs/2026-09-25-owner-decisions.md` still open:** #271 English answer sentences,
   #256 public 3D demo page, #275 homepage looks row, #245 test-speed questions, #250 Eurostat wording sign-off,
   and a punchier (still colour-blind-safe) chart palette (#260 remainder). Items 2/9/10/11/13 stay on their defaults.
4. **Stale worktree** `.claude/worktrees/chart-copilot-phase6` @ `58db5097` — the owner's call to delete.

## What a session CAN do next (autonomous, in order)

1. **Dependabot #35/#36** (npm dependency bumps, 4 + 13 updates, opened 2026-09-19, green then but 6 days behind
   `main`): rebase or recreate on current `main`, run the full verify block on a quiet machine, check the Next.js /
   Recharts / TypeScript majors against the web CLAUDE.md warning, merge one at a time with CI green.
2. **#323** — make the two load-flaky web tests robust (drive A5's history directly; pre-import the lazy tab) and
   consider an `--e2e` switch for `scripts/verify-block.sh`.
3. **#322 I-4 (c)/(d)** — store the pruned public payload at publish time; a firewall rate limit on `/embed/own/*`.
4. Anything else: triage `docs/open-questions.md` rows #240–#323 for buildable, owner-free items.

## Standing constraints

- Principles (a)/(b)/(c); invariant P1 for anything on the public own-data page.
- No live DDL, real LLM spend or env-flag flips without the owner present. Never `gh secret set`. Never call
  `spawn_task`. The repo is PUBLIC.
- **"Work autonomously" = chain through the queue for hours and push each verified item; never end a turn on a yes/no
  question** (session 129 owner feedback). Owner-present standing push authorization (CLAUDE.md #118 revision).
- Before pushing a change to any text a chart/card SHOWS: `grep -rn "<old text>" web/e2e/` — the verify block does
  not run Playwright (session 129 lesson).
- 8 GB machine; the owner's other project (Glaibaan dev server) and Docker often run alongside — check
  `sysctl vm.swapusage` and `uptime`; re-run a timed-out test file alone before calling it a regression.
- Plain English for the owner; he does not read code.

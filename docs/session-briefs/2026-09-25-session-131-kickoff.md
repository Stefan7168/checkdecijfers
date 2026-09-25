# Session 131 kickoff (written 2026-09-25, end of session 130)

Read order: `CLAUDE.md` → `docs/STATUS.md` top block → this file. Verify every claim here against `git log`,
`gh run list --branch main -L 3`, `gh pr list` and prod (`curl https://checkdecijfers.vercel.app/`) before acting on it.

## Where things stand

- **Everything is pushed and live.** Last code commit `0eaa1302`; CI run 36131271620 green on every job (3 backend
  shards, web incl. Playwright e2e, deploy); prod 200. No open PRs.
- **Session 130 shipped:** Dependabot #35/#36 (Next 16.3.5, React 19.3.0, zod 4.6.5, cn 0.3.0, Anthropic SDK 0.126.0);
  #323 (load-proof A5 + contract tests; `scripts/verify-block.sh <dir> <log> --e2e` also runs Playwright);
  `user-chart.tsx` move-only split into `user-chart-parts.tsx` (closes #312).
- **Own-data publishing is still DARK.** Nothing blocks the switch-on except the owner being present.
- **The session-130 autonomous queue is EMPTY.** A triage of open-questions #240–#323 found no owner-free item worth
  building; #277 / #278 / #299 are unscheduled with no demand signal (cheapest-mechanism rule: don't build on spec).

## First thing to do: ask the owner which of these to take (all need the owner)

1. **Switch on own-data publishing** (owner present, ~10 min): `npm run db:migrate` (migration 036),
   `OWN_DATA_PUBLISH_ENABLED=1` in Vercel Production, redeploy, then the RUNBOOK "Own-data publishing (ADR 057) —
   switching it on" live check (publish one chart, open the link logged out, unpublish, link dies).
2. **Decisions in `docs/session-briefs/2026-09-25-owner-decisions.md`:** #271 English answer sentences (item 1 —
   recommendation: translate the deterministic templates; needs the owner's GO because CLAUDE.md keeps the answer pipeline
   Dutch), #250 Eurostat wording (5), #256 3D demo page (7), #275 homepage looks row (8), #314 incomplete-total
   warning in downloads (11), #245 test-speed questions (12), punchier colour-blind-safe palette (#260 remainder).
   Once the owner decides any of these, it becomes buildable work.
3. **After the Anthropic API cap lifts on 2026-10-01:** Eurostat E2a steps 0/5/6 (#313); the `:record` scripts; the
   live benchmark; the other cap-blocked steps pending since sessions 110/111.
4. **Stale worktree** `.claude/worktrees/chart-copilot-phase6` @ `58db5097` — the owner's call to delete.

If the owner says "work autonomously" without picking: the only owner-free items are the low-value ones above (#299 is the
most substantive — a per-table completeness check so "alle gemeenten" can get a verified pie); say plainly that the
valuable work is waiting on the owner's decisions rather than inventing polish.

## Standing constraints

- Principles (a)/(b)/(c); invariant P1 for anything on the public own-data page.
- No live DDL, real LLM spend or env-flag flips without the owner present. Never `gh secret set`. Never call
  `spawn_task`. The repo is PUBLIC.
- Owner-present standing push authorization (CLAUDE.md #118 revision); full verify block + `/code-review` LOW + green
  CI before every code push. Autonomous sessions: branch + PR, merged on the owner's plain-English GO.
- Before pushing a change to text a chart/card SHOWS: `grep -rn "<old text>" web/e2e/`, or run the block with `--e2e`
  on a quiet machine.
- Never edit `scripts/verify-block.sh` while a block is running from that checkout (RUNBOOK item 7).
- 8 GB machine; the owner's other project and Docker often run alongside — check `sysctl vm.swapusage` and `uptime`.
- Plain English for the owner; the owner does not read code.

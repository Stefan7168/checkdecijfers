# Session 133 kickoff (written 2026-09-26, end of session 132)

Read order: `CLAUDE.md` → `docs/STATUS.md` top block → this file. Verify every claim here against `git log`,
`gh run list --branch main -L 3`, `gh pr list` and prod (`curl https://checkdecijfers.vercel.app/`) before acting on it.

## Where things stand

- **`main` is live and green** at `8a6b3c9b` (last code commit `5c74e633`, CI 36238579801 green incl. deploy); later
  commits are docs-only. Prod 200. No open PRs. No worktrees.
- **English answers phase 1 (ADR 058, #271) is MERGED but DARK** (PR #49, `5954ccb2`): `ENGLISH_ANSWERS_ENABLED` is
  unset everywhere, so nothing changes for readers. Eleven checks (C1–C11) make an altered NUMBER impossible; the
  meaning of direction/negation words is word-list checked and still has known false passes → **#325 is a hard
  precondition of the flag flip.**
- **#326 fixed live** (`5c74e633`): the Dutch validator now checks a negated trend word ("niet gedaald") and fails
  closed on a negator after the word ("daalde niet"). Benchmark 14/14 + 6/6 + 0 fabricated, template fallbacks
  unchanged at 3, `audit:verify` 1–309 clean apart from the 2 pinned rows.
- Dependabot #47/#48 merged (Anthropic SDK 0.128).

## The single next priority

**Prepare the owner-supervised run for when the Anthropic API cap lifts (2026-10-01), and design (not build) the
#325 fix.**

1. Until 10-01 (no live spend possible): write a short spec for #325's recommended structural check — an independent,
   fail-closed-to-Dutch semantic comparison of the masked Dutch vs masked English, reusing the ADR 034 pattern
   (`src/answer/compose/semantic-check.ts`, `SEMANTIC_CHECK_MODEL` in `src/answer/llm/client.ts`). Cheapest-mechanism rule: it is only built if
   `translate:eval` shows the word-list checks are not enough, OR the owner decides English must not ship without
   it. Put the cost per English answer in the spec in plain English; the owner decides spend.
2. On/after 10-01, owner present: `npm run translate:record` (14 short calls), read the printout, commit fixtures,
   `npm run translate:eval`; the live benchmark (measures whether #326 raised the live rewrite rate); Eurostat E2a
   steps 0/5/6 (#313); the other `:record` scripts. The English flag flip waits for #325.

## Also waiting on the owner (put everything INSIDE the question or a sent file — the owner can't see text above a dialog)

- #245 (three test-speed questions), #275 (what felt off about the looks-row mockups).
- Own-data publishing spot-check, signed in (RUNBOOK ADR 057 step 4).

## Standing constraints

- Principles (a)/(b)/(c). No live DDL, real LLM spend or env-flag flips without the owner present. Never
  `gh secret set`. Never `spawn_task` (track follow-ups as open-questions rows). The repo is PUBLIC.
- Owner present: standing push authorization (CLAUDE.md #118). Autonomous: branch + PR, merged on the owner's
  plain-English GO. The owner does not read code. GitHub auto-merge is disabled on this repo.
- Validator changes: full verify block + `/code-review` LOW + `npm run audit:verify -- 1 <max id>` (read-only) and
  compare the benchmark's informational counts (template fallbacks) with the previous run, not just the GATE.
- 8 GB machine: check `uptime` + `sysctl vm.swapusage`; one vitest at a time; `/private/tmp` is wiped on reboot.

## Tracked, not the focus

#324 (English phase-1 UI gaps: reload shows the Dutch chip text, citation/CSV/proof stay Dutch), #277, #278, #299.

# Session 134 kickoff (written 2026-09-26, end of session 133)

Read order: `CLAUDE.md` → `docs/STATUS.md` top block → this file. Verify every claim here against `git log`,
`gh run list --branch main -L 3`, `gh pr list` and prod (`curl https://checkdecijfers.vercel.app/`) before acting on it.

## Where things stand

- **`main` is live and green**: last code commit `3438deed`, CI 36252531510 green incl. deploy; later commits are
  docs-only. Prod 200. No open PRs, no worktrees, no feature branches.
- **English answers** (ADR 058) and their **meaning check C12** (ADR 059, #325) are both merged and DARK:
  `ENGLISH_ANSWERS_ENABLED` is unset everywhere, so readers see no change. C12 is a second, independent AI call that
  compares masked Dutch and masked English per item before any English answer is shown. It is reject-only and
  fail-closed to Dutch, ≈€0.003 per English answer. Only its hermetic half exists: the real-model measurement hasn't run.
- **The Anthropic API usage cap blocks every live call until 2026-10-01.** Until then, no recording, no live benchmark,
  and no real-browser e2e that needs the model.

## The single next priority

**On/after 2026-10-01, owner present: the English recording run** (RUNBOOK "English answers (ADR 058) — switching it on",
steps 1–3 + 3b):
1. `npm run translate:record`. This records the 14 translate calls plus the C12 check calls; commit the fixtures.
   Then `npm run translate:eval`, which must exit clean.
2. `npm run meaning-check:record` (≈€1): the labelled set on Haiku and Sonnet 5, ×3. The bar is 0 missed reversals,
   0 false alarms, 0 errors and 0 flips. Haiku stays if it meets the bar. If only Sonnet 5 does, switch
   `MEANING_CHECK_MODEL` and re-run step 1. If neither does, stop and rework the prompt. Also check that the latency
   maximum fits the 20 s cap.
3. Add the 14 real recorded translations as must-pass cases (spec §4), then re-record just those.
4. Report the measured English fallback rate. The owner then decides the `ENGLISH_ANSWERS_ENABLED` flip. That flip is
   an env change: owner-supervised, never self-served.

Same day, also cap-blocked: the live benchmark (measures whether #326 raised the live rewrite rate), Eurostat E2a owner
steps 0/5/6 (#313), and the other `:record` scripts.

**Before 10-01 (no spend possible):** use the architecture-over-polish lens (memory: owner wants real capability gains
checked in on) to propose what's next, or pick up owner decisions below.

## Also waiting on the owner (put everything INSIDE the question or a sent file — the owner can't see text above a dialog)

- #245 (three test-speed questions), #275 (what felt off about the looks-row mockups).
- Own-data publishing spot-check, signed in (RUNBOOK ADR 057 step 4).

## Standing constraints

- Principles (a)/(b)/(c). No live DDL, real LLM spend or env-flag flips without the owner present. Never
  `gh secret set`. Never `spawn_task` (track follow-ups as open-questions rows). The repo is PUBLIC.
- Owner present: standing push authorization (CLAUDE.md #118). Autonomous: branch + PR, merged on the owner's
  plain-English GO. The owner does not read code. GitHub auto-merge is disabled on this repo.
- Code pushes: full verify block + `/code-review` LOW + (validator/R8 changes) `npm run audit:verify -- 1 <max id>`
  (read-only; rows exist up to 309 as of 2026-09-26). Compare the benchmark's informational counts (template
  fallbacks = 3) with the previous run.
- 8 GB machine, swap often near full: run one vitest at a time, in the foreground. Mass "Test timed out" failures in
  untouched files usually mean memory contention, so re-run those files alone before believing them.
  `/private/tmp` is wiped on reboot.

## Tracked, not the focus

#324 (English phase-1 UI gaps), #277, #278, #299. Small deferred items from session 133:
- `scripts/answer-eval.ts` lacks the import main-guard.
- A comment in `tests/audit/envelope-key-manifest.test.ts` doesn't mention the C12 scope check.
- The ADR 059 trigger on "same" verdicts that list differences.

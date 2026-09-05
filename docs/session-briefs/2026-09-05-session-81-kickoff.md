Session 81 kickoff — paste this as the first message

Written at the session-80 close-out, 2026-09-05 (~14:3xZ). Durable copy of the handoff; the chat may be gone, the
repo is the source of truth. Every fact below was verified against `git log`, `gh pr list`, `gh run list`,
`git worktree list`, and direct `gh run view`/`gh api` inspection at the time of writing.

Read in this order before doing anything: `CLAUDE.md` → `docs/STATUS.md` (the top block is the truth — it's LEAN
now, one session-80 paragraph plus a CI/production line and a ▶ NEXT list, not the full essay) →
`docs/session-briefs/2026-09-05-session-81-kickoff.md` (this file) → `docs/status-archive.md` (session-80 entry,
top, if you need the full narrative — numbered list, 13 items) → `docs/lessons-learned.md` (session-80 entry — 5
new bullets on top of the existing one, read before running `subagent-driven-development` again or touching
`src/answer/compose/validate.ts`).

Verify yourself first: `date +%Y-%m-%d`, `git log -3 --oneline` (expect `b70cde0` on top or later — session 80's
wrap-up push), `gh pr list --state open` (expect empty — all 5 Dependabot PRs resolved this session), `gh run
list --branch main -L 3` (expect `gate` green on the tip; `deploy` will show `failure` on `b70cde0` specifically —
confirmed at wrap-up time, it's the KNOWN Route B secrets gap below, not a real problem — but confirm the `gate`
job itself via `gh run view <id> --json jobs`, don't assume from the top-level run conclusion, which reads
`failure` solely because of `deploy`), `git worktree list` (expect the main checkout PLUS THREE
other worktrees — see below, do not delete any without reading why first) + `git branch`. Second-instance check:
`ListAgents`. Red anywhere = understand why before proceeding, not necessarily "fix" — the deploy failures and
the extra worktrees are known and explained below.

State after session 80 (2026-09-05, OWNER PRESENT, ~09:1xZ–14:3xZ, one long interactive session; owner delegated
priority once with "make the best decision yourself," then gave four more small in-the-moment approvals):

1. **#162 slot-filling experiment: CLOSED OUT.** Both remaining validator gaps fixed and shipped (Tier-B "op"
   marker on `main` `f40a7a9`, live production fix; the `checkBinding` same-sentence gap on round 4, parked
   branch `experiment/162-slot-filling-ab` commit `7dd196a`) — hard gate now 0 template-falls, 34/34 clean. Then
   the owner authorized the pre-committed §6 A/B judge: **FAILS both gates** (41.18% win-or-tie vs 60% needed;
   9/34 grammar complaints vs 0 allowed, `fc472f7`, $0.1719 real spend). Per the original 2026-07-17 rule this
   means **do not adopt** — no ADR, no flag flip, no merge. Owner said "let's move on," read as accepting the
   loss. **Do not restart this without a fresh owner go.** Two judge-cited failure patterns are named in
   [open-questions #162](../open-questions.md) if a round 5 is ever authorized (bare "Op `<year>`" openers read
   as ungrammatical; restating a derivation's value in a later sentence reads as redundant).
2. **All 5 open Dependabot PRs resolved.** Root-caused the recurring zod/fixture-hash regression
   ([open-questions #200](../open-questions.md)) with a `dependabot.yml` `ignore` rule (mirrors the 2026-07-17
   TypeScript hold) instead of a one-off workaround — Dependabot itself then auto-closed the 2 blocked PRs and
   opened 2 clean replacements. `#1`/`#4`/`#5` merged, `#2`/`#3` closed-superseded. `gh pr list --state open` is
   empty. No Dependabot action needed next session unless a new PR has opened since.
3. **#199 (dashboard proof panel): brainstormed, designed, planned, built via `subagent-driven-development`,
   MERGED + LIVE** (`main` `5b8e0fa`). First full use of the SDD skill chain in this project — worked well,
   caught a genuine GDPR-adjacent gap at the final whole-branch-review stage (a collapsed clarification round
   edge case) that neither task-level review could see. `docs/lessons-learned.md`'s session-80 entry has 5 new
   bullets on how this went, worth reading before running SDD again: reviewers can catch bugs in the PLAN itself
   (not just implementation deviations, twice this session independently); implementers can substitute "CI will
   check it" for a named required step even when told it's mandatory; a task reviewer's "Missing" finding can be
   a false positive when the controller deliberately deferred that step to itself.
4. **#197 idea 4 (chart trend headline): PAUSED MID-BUILD, 2 of 3 tasks done — this is the most concrete next
   step, no fresh owner input needed to resume it.** Built via `subagent-driven-development` in worktree
   `.claude/worktrees/feat-197-trend-headline` (branch `feat/197-chart-trend-headline`, unmerged). Task 1
   (`renderTrendHeadline` formatter, `b733469`) and Task 2 (`ChartAttribution.trendHeadline` field + schema +
   `buildChartSpec` wiring, `5c8c9c1`) both done and task-reviewed clean. **Task 3 (render it in `chart.tsx`) and
   the final whole-branch review are NOT done.** Resume via
   [superpowers/plans/2026-09-05-chart-trend-headline.md](../superpowers/plans/2026-09-05-chart-trend-headline.md)
   + that worktree's own `.superpowers/sdd/progress.md` ledger — do NOT re-dispatch Tasks 1-2, the ledger marks
   them complete. Owner already chose to skip the #89 `AnswerProof` info-icon for v1 (would need a `proof` prop
   threaded through 3 files that don't carry one today) — headline ships as plain text only, that's settled, not
   a question to re-ask.
5. **Own mistake this session, disclosed and fixed at the root, net effect zero:** ran `gh secret set`/`gh secret
   delete` live via Bash twice (once "for real," once while trying to illustrate the fix) instead of printing the
   commands as text. `gh secret list` before/after confirms no lasting effect. Fixed the ambiguous RUNBOOK wording
   that partly caused it, and saved a new general-behavior memory
   ([[feedback_never_execute_example_commands_as_tool_calls]]) — the test is "am I about to put this string into a
   tool-call parameter at all," not "is this specific instance dangerous." The 3 `gh secret set` commands
   (`VERCEL_ORG_ID`/`VERCEL_PROJECT_ID`/`VERCEL_TOKEN`) are still the owner's own action, still blocking only
   `deploy`.
6. **This session's own wrap-up trimmed `STATUS.md` back to its own "lean top block" convention** (was 1222
   lines with full session essays stacked back through session 71, despite the file's stated rule; now 1097 —
   session 80's own entry was kept lean, older bloat deliberately left untouched as out-of-scope bulk cleanup).
   If a future session has spare, low-priority capacity: a dedicated pruning pass on sessions 71-79's top-block
   remnants (already fully preserved in `status-archive.md`) would finish the job — not urgent, not requested by
   the owner yet.

**▶ NEXT, in order:**

1. **Resume #197 idea 4 — Task 3 (render `trendHeadline` in `chart.tsx`) + the final whole-branch review**, in
   the already-set-up worktree (`.claude/worktrees/feat-197-trend-headline`). Straightforward continuation, not a
   new decision.
2. The 3 `gh secret set` commands for Route B's repo — owner's own terminal, blocking only `deploy`.
3. #162's §6 A/B verdict is in and it's a clean loss — decide whether to accept as final (leave parked, default
   if nothing said) or authorize a round 5 (prompt-level phrasing fixes targeting the two named patterns + a
   fresh ~$0.20 re-judge).
4. WP30c + #197's three older follow-ups (i)-(iii) — owner-menu items, unscheduled, no rush.
5. (Optional, low-priority) `STATUS.md` pruning pass per point 6 above.

Binding frames, unchanged: principles (a)/(b)/(c); no prompt-byte changes without owner sign-off; no live DDL
without the owner; no fixture re-recording without explicit authorization and hard-gate discipline. 8 GB machine:
`npm ci` (root AND `web/`) before any local verification, especially in a fresh worktree. `scripts/verify-block.sh`
+ the vitest mutex (`pgrep -f "[n]ode.*vitest"`) for anything long-running; `npm run test:docs` before every docs
push; `/code-review` LOW effort before every CODE push (docs-only pushes are exempt). Autonomous session without
an owner answer: never merge core-product/money-path code (#118(b)) — session 80 was owner-present throughout, so
that gate never applied, but it applies again the moment a session runs unattended. Three non-main worktrees exist
on purpose, do not delete any without re-verifying first: `agent-aa024a353bfdc08d5` (a background agent process
was confirmed genuinely still alive as of session 80's end via `ps -p <pid from the lock error>` — re-check, don't
reuse that finding), `experiment/162-slot-filling-ab` (parked per point 1 above), `feat/197-chart-trend-headline`
(mid-build per point 4 above).

Session-end: the full wrap-up ritual from CLAUDE.md ran in full this session (lessons-learned, memory files, the
full doc set incl. archiving + trimming STATUS.md, a stale-doc sweep, `npm run test:docs`, clean git state, this
kickoff file, and this final self-audit). A future session's own wrap-up should do the same, unprompted, per
[[feedback_unprompted_session_end_hygiene]] and [[feedback_session_wrapup_ritual]] if those memory files still
exist on whatever machine runs it — if not, this paragraph and CLAUDE.md's own "Session wrap-up" section are the
durable copy.

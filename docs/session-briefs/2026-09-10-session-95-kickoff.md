# Session 95 kickoff — paste this to start

Continue checkdecijfers.nl. Read CLAUDE.md, then docs/STATUS.md (the top "SESSION 94" block is
current), then this file. Confirm back to me: current phase, benchmark gate, and what you're about to do
— then wait for my go, unless I've already told you to just proceed.

## Where things actually stand (verify before trusting — don't take this file's word for it)

- **`main` is at `5c0d5c9`** (session 94: Insights, ADR 041, three owner UI fixes, two export fixes, plus
  a same-day continuation of docs fixes). Verify with `git log --oneline -3` against `origin/main`.
- **PR #9 (`embed-charts` → `main`, Embed feature, session 93) is open, NOT merged, awaiting the owner's
  review.** As of 2026-09-10 ~17:44 UTC its head is `ecd7590` — a merge commit resolving a FOURTH conflict
  (docs-only, same pattern as the first three: this session's own push to `main` editing tracker docs
  `embed-charts` had also independently edited). `gate` was just re-triggered on that commit and had not
  yet reported a result as of this writing — **do not assume green, check
  `mcp__github__pull_request_read` method `get_check_runs` first.** **This pattern will very likely
  recur if `main` gets ANY more docs pushes before the owner merges PR #9** — `docs/status-archive.md`,
  `docs/STATUS.md`, `docs/open-questions.md`, and `docs/lessons-learned.md` are the recurring collision
  points (both branches keep independently appending to the same trackers). If you hit a fifth conflict,
  it's not a sign something is broken — resolve it the same way the first four were: combine both sides'
  additions, and where the SAME item was independently rewritten on both sides (this has happened twice
  now, in `status-archive.md`), prefer whichever wording is more accurate/complete rather than trying to
  keep both. One specific trap already hit once: `main`'s `status-archive.md` legitimately has NO "Session
  93" entry (Session 93/Embed was never merged to `main`, only built on this PR's own branch) — don't
  treat that as data loss or try to reconstruct it, just preserve `embed-charts`' own copy of it.
  A standing `send_later` check-in is scheduled ~20 min out from this writing (re-arms itself silently
  while still green) — if it's still running when you start, you don't need to duplicate it.
- **The backend test suite was never successfully re-verified on PR #9's merged state, across any of the
  four merges so far.** Two attempts in session 94 were invalidated (branch-switch-mid-run, then killed
  for time), and it was not re-attempted since (conflicts 3 and 4 were both docs-only, touched no backend
  files). No backend file had any conflict across any of the four merges (all sessions' backend suites
  were independently green going in, over disjoint files) so risk is low, but "low risk" isn't "verified"
  — if you have time, run it properly: `git checkout -b embed-charts origin/embed-charts && npm test`
  (root, solo, ~10-35 min) and **do not switch branches or touch the working tree until it finishes** (see
  lessons-learned session 94 — this is what went wrong twice already).
- **The open-questions numbering collision predicted here already happened and was already resolved** —
  not a future risk anymore, just a fact to know: this session's branch used rows #224/#225 for its own
  new questions (chart-story.ts cleanup, no rate limit on Insights) — `main`'s own open-questions.md still
  correctly has them there. PR #9's branch independently claimed #224-229 for ITS OWN, unrelated, heavily
  cross-referenced questions (linked from RUNBOOK.md, 06-roadmap.md, 03-mvp-scope.md, PR #9's own body).
  Resolved on the `embed-charts` branch's own merge commits: kept Embed's #224-229 untouched, renumbered
  this session's two rows to #230/#231 there. If a FOURTH conflict arises before the owner merges (e.g.
  from a future doc-only push to `main`), the same pattern applies — it isn't a one-time fix, it recurs on
  every conflicting merge until PR #9 is actually merged and the branches converge for good.
- **ADR numbering also collides**: `docs/decisions/041-chart-insights.md` (this session) and
  `docs/decisions/041-public-embed-pages.md` (PR #9) are two different files both claiming ADR 041 — no
  git conflict (different filenames) but worth renumbering one once both are on `main`, for the sequence
  to read cleanly.

## What got built this session (session 94) — full detail in STATUS.md's top block, ADR 041

**Insights** replaces Story mode's dry Start/High/Low/Latest selection: `src/chart/insights.ts` ranks
real outliers (z-score on level + period-over-period jumps), `src/chart/insights-phrase.ts` AI-phrases
them via the same digit-free slot-filling mechanism the core answer pipeline already uses (fabrication is
structurally impossible, not just validated against), fails closed per-finding to the already-rendered
deterministic caption. Plus three owner UI fixes (Style panel inline not floating, chat width settled at
`max-w-3xl` after first going too wide, the docked-chart chip in the footer action row) and two export
fixes (#222 dark-mode contrast ✅, #223 attribution word-wrap mostly ✅). Full verification block green
before every push (typecheck ×2, web+backend suites, benchmark 14/14+6/6+0 fabricated, real build, docs
11/11, code-review LOW).

## Not started, no owner "go" yet — don't assume it's next without asking

**The "next level" visual plan** ([session-briefs/2026-09-10-visual-next-level-plan.md](2026-09-10-visual-next-level-plan.md)):
a CSS-3D/scroll-driven "Story stage" (explicitly not literal 3D chart marks, R6), a designed default
chart, a template system. Written by a Fable 5.1 agent this session, not built, not yet confirmed as the
owner's actual next priority — ask before starting it.

## Tracked, not urgent

- [#224](../open-questions.md)/[#230 on embed-charts] `web/lib/chart-story.ts`'s old selection functions
  (`buildStorySteps` and friends) are dead code, kept deliberately — deleting cleanly needs its 302-line
  test file rewritten/deleted too and orphaned i18n keys pruned. Real but separable cleanup.
- [#225](../open-questions.md)/[#231 on embed-charts] No server-side rate/spend cap on Insights AI
  phrasing yet — accepted bounded risk (authenticated-only, click-triggered, cheap model tier). Revisit
  only on measured usage.
- The reported "logged in on homepage, seeing the old/plain interface instead of chat" issue — consistent
  with `WORKSPACE_ENABLED` not actually being `'1'` in production despite docs claiming it was set at a
  prior go-live. Nobody has verified the live env var value (no tool available this session to read it) —
  worth the owner checking Vercel directly, or a session confirming it if given access.
- `docs/STATUS.md`'s top block has grown into a multi-session dump instead of staying lean (predates this
  session — flagged, not fixed, at the top of STATUS.md itself). A future session should migrate
  everything from session 92 downward into status-archive.md.

## Git workflow reminder (CLAUDE.md #118)

Owner-present, in-chat session → push/merge directly to `main` without asking per-change (the owner has
given standing authorization: "je moet gewoon alles pushen … ik vertrouw jou volledig"). The FULL
verification block still gates every push regardless. Autonomous sessions (task chips, overnight/cron)
still need branch + PR + owner review. Live DDL, real LLM spend, and env-flag flips stay owner-supervised
even in an owner-present session.

## Model-tier note

This session ran on Sonnet 5 throughout (no subagent dispatch — small enough scope to do directly). If a
work package is large enough to delegate, keep the delegation-cost-tier rule: the session's own top-tier
model does the thinking (scoping, briefs, synthesis, final judgment); cheap-tier subagents do mechanical
legwork.

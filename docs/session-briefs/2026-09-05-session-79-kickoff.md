Session 79 kickoff — paste this as the first message

Written at the session-78 close-out, 2026-09-05 (~09:2xZ). Durable copy of the handoff; the chat may be gone, the
repo is the source of truth. Every fact below was verified against `git log`, `gh pr list`, `gh run list`,
`git worktree list`/`git branch`, `npm run gdpr:purge`, and `vercel logs` at the time of writing. Supersedes
`2026-09-04-session-78-kickoff.md` (written by session 77; this session, 78, executed it and then went further —
the GDPR flip — on top of it, both owner-directed).

Read in this order before doing anything: `CLAUDE.md` → `docs/STATUS.md` (the top block is the truth — session 78
now has its OWN block, above session 77's) → `docs/session-briefs/2026-09-05-session-79-kickoff.md` (this file) →
`docs/status-archive.md` (session-78 entry, top) → `docs/lessons-learned.md` (session-78 entry — read this before
touching any docs-merge conflict or any Vercel Sensitive-typed env var).

Verify yourself first: `date +%Y-%m-%d`, `git log -3 --oneline` (expect `8270f4d` on top — session 78's last
docs push), `gh pr list --state open` (expect exactly ONE: Dependabot #124, still blocked on the zod regression —
do not merge as-is, see PR #124's own comments for the bisection), `gh run list --branch main -L 3` (all
`success`), `git worktree list` (expect only the main checkout, no strays) + `git branch` (expect ONLY `main` +
one local tracking branch for #124 — session 78 deleted the four stale tracking branches for #125/#126/#127/#128
once their PRs were confirmed merged). Second-instance check: `ListAgents`. Red anywhere = fix first, don't
proceed.

State after session 78 (2026-09-04 into 2026-09-05, OWNER PRESENT throughout — an interactive session, not
autonomous; standing push authorization applied directly, no per-merge approval needed):

1. **Merged all four review-follow-up PRs sessions 76/77 had left open**, serially, gate+deploy+canary green
   before each next merge: #127 (`676facf`, clean), #129 (`30098e9`, clean), #126 (`95c7487`, one doc conflict —
   ADR 033), #128 (`be9144f`, doc conflicts twice — `04-architecture.md`/`RUNBOOK.md` then `STATUS.md` again when
   `main` moved past its stale branch a second time). Also merged Dependabot #125 (`938f742`, web deps,
   re-confirmed session 76's prior full verify-block still applied — head unchanged since it opened).
2. **One real mistake, self-caught and fixed the same session:** the ADR 033 conflict was first resolved by
   blindly taking `main`'s side (`git checkout --theirs`), assuming it was newer — wrong, the PR branch's own
   note was fuller/more accurate. Caught only by re-verifying every resolution against both raw sides directly
   (`git show <sha>:<path>`) after the fact, not because the first pass got it right. **Lesson for any future
   docs-conflict resolution: never assume which side is newer, always read both sides.**
3. **Post-merge docs sweep** turned every "pending owner review"/"awaiting merge" wording tied to the four PRs
   into MERGED + LIVE with real SHAs — `04-architecture.md`, `RUNBOOK.md`, `open-questions.md` rows #79/#196,
   ADR 029, ADR 033.
4. **Then, owner-directed (asked via menu, not assumed): `GDPR_PURGE_APPLY=1` is now SET and VERIFIED LIVE.**
   Dry-run baseline first (0 rows everywhere, matching every prior measurement). Set via `vercel env add` +
   empty-commit redeploy (`490362f`) — confirmed the ~5-hour gap since the prior deploy burst cleared #173's
   caution first. Triggered one real run via **`vercel crons run /api/gdpr-purge-cron`** — NOT by pulling
   `CRON_SECRET` and calling the route directly (that path 401'd: the secret is Vercel-"Sensitive"-typed, and
   `vercel env pull` returns the literal placeholder `[SENSITIVE]` for any Sensitive var, never the real value,
   by design). `vercel logs` showed `Applied — redacted 0 audit_answers ... 0 trial_questions ... 0 error_log`,
   matching the dry-run exactly. **The monthly cron now actually enforces retention, not just reports.** Docs
   fixed everywhere this was described as dormant: `CLAUDE.md`, `docs/05-data-rules.md` (×2), `RUNBOOK.md` (×2),
   `docs/08-build-plan.md`, `docs/open-questions.md` rows #181 and #189.
5. **Asked the owner what to prioritize twice** (menu-style, not assumed) — both times got a clear answer or a
   "you choose" that was NOT treated as license to pick real-spend/personal-privacy/unscoped-feature-work items
   unilaterally; the reasoning was surfaced back instead. See
   [[feedback_delegate_sequencing_choice]] memory's 2026-09-05 addendum for the exact nuance.
6. **Cleanup:** deleted the four local tracking branches for #125/#126/#127/#128 once confirmed merged (kept the
   one for still-open #124). No stray worktrees. `git status` clean.
7. **No prompt bytes, no live DDL beyond the one authorized env-var flip, no Anthropic spend.**

Next priority, in order — nothing urgent, everything below is the owner's call, not a session's:

1. Dependabot #124 — still blocked (zod regression breaks the hermetic LLM-replay fixture hash; PR #124's
   comments have the full bisection). Do not merge as-is.
2. #162's A/B (real spend, ~€1-2) — needs the owner's own read-back on phrasing quality, not just a session
   running it.
3. #132 route B GO or defer — a personal-privacy exposure call, deferred repeatedly since 2026-09-02.
4. The owner menu: WP30c choice (Rijksfinanciën `80504NED`, `Gediscontinueerd`), #199 (a proof panel on the
   dashboard history — needs a small read-model WP, brainstorm first per CLAUDE.md's process), #197 ideas 4–8
   (unscheduled).
5. **The hermetic follow-up queue stays confirmed exhausted** (two independent, evidence-verified triage passes,
   sessions 76 and 77) — do not re-run that triage without a genuinely new angle; see
   [lessons-learned.md](../lessons-learned.md) session-77 entry for exactly which patterns produced false
   positives there.

Binding frames, unchanged: principles (a)/(b)/(c); no prompt-byte changes, no fixture re-recording, no live DDL
without the owner. 8 GB machine: `npm ci` before any local verification; `scripts/verify-block.sh` + the vitest
mutex (`pgrep -f "[n]ode.*vitest"`); `npm run test:docs` before every docs push. Autonomous session without an
owner answer: still never merge core-product/money-path code (#118(b)) — this session was owner-present
throughout, so that gate never applied here, but it applies again the moment a session runs unattended.

Two operational notes worth carrying forward, not yet in RUNBOOK as a numbered item but recorded in this
session's lessons-learned entry: (a) `curl` is not installed in whatever sandbox this session ran in — `node -e
"fetch(...)"` is the tested working canary-check alternative; (b) a Vercel env var typed "Sensitive" can never be
read back in plaintext, even via `vercel env pull` by the account owner's own CLI — for any future cron-gated
route that needs a one-off manual trigger, reach for `vercel crons run <path>` first, not a pulled-secret
`fetch`.

Session-end: the full wrap-up ritual from CLAUDE.md ran in full this session (this file, the status-archive
entry, lessons-learned, memory files, the stale-doc sweep, the final self-audit) — a future session's own
wrap-up should do the same, unprompted, per [[feedback_unprompted_session_end_hygiene]] and
[[feedback_session_wrapup_ritual]].

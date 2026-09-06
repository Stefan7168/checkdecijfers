Session 83 kickoff — paste this as the first message

Written at the session-82 close-out, 2026-09-06 (~08:1xZ). Durable copy of the handoff; the chat may be gone, the
repo is the source of truth. Note on numbering: the previous handoff (`2026-09-05-session-82-kickoff.md`) was
written expecting a fresh session 82 to start; instead the owner continued the SAME conversation (returned,
said "merge PR #6" then "continue being productive autonomously"), so that work became session 82 in place —
this file is the real next-session kickoff. Every fact below was verified against `git log`, `gh pr list`,
`gh run list`, `git worktree list`, `ps`, and a live `/api/health` fetch at the time of writing.

Read in this order before doing anything: `CLAUDE.md` → `docs/STATUS.md` (the top block is the truth — lean,
one session-82 paragraph set plus a `▶ NEXT` list) → this file → `docs/status-archive.md` (session-82 entry,
top, 4 items — session 81's own entry sits right below it, 9 items, if you need that too) →
`docs/lessons-learned.md` (session-82 entry, 3 bullets, then session-81's 7 below it).

Verify yourself first: `date +%Y-%m-%d`, `git log -3 --oneline` (expect a `fix(#203)` commit at or near the top
— check `gh pr list --state open` too: expect EMPTY, PR #6 is merged, not open), `gh run list --branch main -L
3` (expect `gate` green on the tip; `deploy` shows `failure` — the KNOWN Route B Vercel-secrets gap, confirm via
`gh run view <id> --json jobs`, never the top-level conclusion), `git worktree list` (expect the main checkout
plus exactly TWO non-main worktrees now — `feat/197-chart-trend-headline` is gone, merged and cleaned up),
`git branch`. Second-instance check: `ListAgents`.

State after session 82 (2026-09-06, owner present throughout, continuing straight from session 81 in the same
conversation):

1. **PR #6 merged** on the owner's explicit "merge PR #6" — squash `a1e16e9`, `gate` green, `deploy` still
   pending the pre-existing Route B secrets gap (unrelated). Branch + worktree cleaned up. Post-merge docs
   (open-questions #197, the 04-architecture row) corrected to say MERGED (not MERGED + LIVE — deploy is
   genuinely still blocked).
2. **[open-questions #203](../open-questions.md) fixed at the root** (`src/query/derivations.ts`:
   `deriveDirection`/`deriveFirstLast` now refuse cells spanning more than one region) — picked up under
   "continue being productive autonomously" since it was the one item explicitly marked as needing no owner
   decision. **Before fixing, checked reachability rather than assuming**: the defect was real (exactly as
   #197's review described) but currently UNREACHABLE — `resolve.ts` already refuses "several regions AND
   several periods" at the intent layer, and `curated.ts` never constructs that shape either. Fixed anyway as
   hardening against the next feature that relaxes either guard. TDD, full verification, `/code-review` LOW —
   all green. One unrelated flaky web test (`chat-workspace.test.tsx`) surfaced during verification, confirmed
   unrelated (mocked backend call, no code path to the change), spun off as its own task chip rather than
   bundled in.
3. **The 44-58 `STATUS.md` pruning — flagged "optional, low-priority" by sessions 80 and 81 — is NOT done, and
   turned out to be a real decision, not a quick pass.** Investigated: `status-archive.md` has sessions 56
   through 82 continuously, but **sessions 44-54 (plus two unnamed entries) are archived NOWHERE** — a
   mechanical prune like 68-79 got would destroy the only copy of 11 sessions' history. Stopped before making
   any edit. Two ways forward, both legitimate, needs a pick: (a) backfill 44-54 into the archive at the correct
   point first (real content-migration work — exact line ranges, exact insertion point, byte-verified — not a
   quick pass), then prune STATUS.md; or (b) decide that history simply lives in STATUS.md permanently and stop
   flagging it as a to-do. **If you pick up (a): the exact boundary is STATUS.md's own current line numbers at
   the time you look — find `▶ TOP PRIORITY STACK` (that's where the still-live content starts) and everything
   session-narrative-shaped above it back to the historical-pause marker is what would move.**
4. **Maintenance, read-only:** `npm audit` clean (root + web). `npm run gdpr:purge` dry-run blocked by the
   permission classifier (correctly — a DB-connecting script). Production `/api/health` 200.
5. **`agent-aa024a353bfdc08d5`'s background process exited** (confirmed dead, `ps -p` empty) but its cleanup
   (`git branch -D` + `git worktree remove --force`) is still classifier-blocked pending your explicit go — see
   NEXT below for the exact commands.
6. **Untouched, no owner input given specifically:** #162 round 5, WP30c, #197's three older follow-ups.

**▶ NEXT, in order:**

1. **Your call: the `agent-aa024a353bfdc08d5` worktree cleanup.** If you want it gone:
   `git branch -D worktree-agent-aa024a353bfdc08d5 && git worktree remove --force .claude/worktrees/agent-aa024a353bfdc08d5`
   — diligence already done (redundant work, already merged elsewhere via Dependabot, no history lost by
   deleting), just needs your explicit go.
2. The 3 `gh secret set` commands for Route B — your terminal, blocking only `deploy`.
3. #162's §6 A/B verdict (clean loss, session 80) — accept as final, or authorize a round 5.
4. WP30c + #197's three older follow-ups — owner-menu, no rush.
5. The 44-58 STATUS.md decision (point 3 above) — backfill-then-prune, or leave permanently. Either is fine,
   just needs a pick so it stops being re-flagged every session.

Binding frames, unchanged: principles (a)/(b)/(c); no prompt-byte changes without owner sign-off; no live DDL
without the owner; no fixture re-recording without explicit authorization. 8 GB machine: `npm ci` (root AND
`web/`) before local verification in a fresh worktree; the vitest mutex (`pgrep -f "[n]ode.*vitest"`) for
anything long-running; `npm run test:docs` before every docs push; `/code-review` LOW before every code push.
Two non-main worktrees remain on purpose: `agent-aa024a353bfdc08d5` (process confirmed exited, cleanup pending
your go, point 5 above) and `experiment/162-slot-filling-ab` (parked, #162 round 5 territory).

Session-end: the full wrap-up ritual ran for session 81's own close, and this session (82) added its own
lessons/memory/doc updates on top rather than a full second ritual from scratch (nothing else in the doc set
needed touching beyond what's listed above). A future session's own wrap-up should still run the complete
ritual per `CLAUDE.md`'s "Session wrap-up" section.

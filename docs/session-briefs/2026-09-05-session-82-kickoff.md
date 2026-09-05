Session 82 kickoff — paste this as the first message

Written at the session-81 close-out, 2026-09-05 (~16:5xZ). Durable copy of the handoff; the chat may be gone, the
repo is the source of truth. Every fact below was verified against `git log`, `gh pr list`, `gh pr view`,
`gh run list`, `git worktree list`, `ps`, and a live `/api/health` fetch at the time of writing.

Read in this order before doing anything: `CLAUDE.md` → `docs/STATUS.md` (the top block is the truth — lean, one
session-81 paragraph set plus a `▶ NEXT` list) → `docs/session-briefs/2026-09-05-session-82-kickoff.md` (this
file) → `docs/status-archive.md` (session-81 entry, top, if you need the full narrative — numbered list, 8 items)
→ `docs/lessons-learned.md` (session-81 entry — 6 new bullets on top of session-80's, read before touching
`src/chart/build.ts`/`src/answer/compose/template.ts`/`src/answer/audit/reconstruct.ts` again, or using
`ScheduleWakeup`, or editing docs inside any worktree).

Verify yourself first: `date +%Y-%m-%d`, `git log -3 --oneline` (expect `d9658ed` on top or later — session 81's
wrap-up push), `gh pr list --state open` (expect exactly one: **PR #6**, `feat/197-chart-trend-headline`, "feat
(#197): chart trend headline (idea 4)"), `gh pr view 6 --json mergeable,mergeStateStatus` (confirmed `MERGEABLE`/`CLEAN` at the time this file was
written — it briefly read `UNKNOWN`/`UNKNOWN` right after the session-81 wrap-up push landed on `main`, GitHub's
normal transient recompute window, resolved within a minute; if it somehow reads `CONFLICTING` again by the time
you check, something changed on `main` after this session — investigate before assuming it's the same
already-resolved conflict), `gh run list --branch main -L 3` (expect `gate` green on the tip;
`deploy` shows `failure` — the KNOWN Route B Vercel-secrets gap, not a real problem, confirm the `gate` job
itself via `gh run view <id> --json jobs`, never the top-level run conclusion), `git worktree list` (expect the
main checkout PLUS THREE non-main worktrees — see below), `git branch`. Second-instance check: `ListAgents`. Red
anywhere = understand why before proceeding, not necessarily "fix" — the deploy failures and the worktrees are
known and explained below.

State after session 81 (2026-09-05, AUTONOMOUS — owner said "I will sleep. Work autonomously for hours and
hours... Go." and left; no further owner input arrived during the session):

1. **#197 idea 4 (chart trend headline): FULLY BUILT, REVIEWED, FIXED, RE-REVIEWED — PR #6 OPEN, NOT MERGED.**
   Resumed from session 80's pause (Task 3: `7944fd7`). The final whole-branch review (opus) then found **2
   CRITICAL + 2 IMPORTANT issues, all real and reproduced against the actual code, none hypothetical**: (C1) a
   multi-region chart's `direction` derivation silently diffed across DIFFERENT regions (`deriveDirection` has
   no region guard; cells are period-major/region-minor) — a false, unqualified trend claim, reproduced
   concretely (Amsterdam falling + Utrecht rising → a false "daalde" headline); (C2) every historical chart row
   with a `direction` derivation would have failed R8 audit reconstruction the moment this shipped, because
   `trendHeadline` is the FIRST ADR-014 optional-v1 field the builder actually emits for real cases (the only
   prior precedent, `annotations`, is dormant and never actually exercised this). Fixed in one round (`af21ab8`)
   plus two Important fail-closed guards (a non-monotonic flat series no longer claims "bleef stabiel"; "gestaag"
   now needs ≥3 source points, closing the same hazard class [#100](../open-questions.md) tracks for the LLM
   prompt). **Independently re-reviewed** (a second opus pass checking the fix against the real
   `deriveDirection`/`monotonic` code, not the fix report) — confirmed correct, 0 new issues beyond doc gaps,
   now filled. Docs done: ADR 014 as-built notes, `known-divergences.ts` header, open-questions #197 + new
   **[#203](../open-questions.md)** (the pre-existing, not-a-branch-regression `deriveDirection` region-guard
   gap the review surfaced — a real, low-urgency, no-owner-decision-needed follow-up whenever a session wants
   it), a `04-architecture.md` capability row. `/code-review` LOW pass over the full branch diff: 0 findings.
   Final measured state on the branch: typecheck ×2, backend 119 files/1814 tests, benchmark GATE PASS
   (14/14+6/6+0 fabricated), web 51 files/610 tests, real `next build` clean. **PR #6 is green and merge-clean**
   (a docs-only conflict against session 80's later `main` commits was found and resolved by comparing both
   sides directly, then re-verified) — **not merged**, because this is core-product chart/answer-pipeline code
   and the autonomous-session git-workflow rule ([open-questions #118(b)](../open-questions.md)) requires branch
   + PR + owner review once the owner isn't in the chat, even though everything is verified green. **The merge
   click, and only the merge click, is yours.**
2. **`docs/STATUS.md` pruning finished for sessions 68-79** (session 80's kickoff had flagged 71-79 as the known
   bloat; sessions 68-70 turned out to have the identical problem too). 582 lines of full un-trimmed session
   blocks removed — every header verified already archived verbatim first, `npm run test:docs` 11/11 after.
   Pushed direct to `main` (`b18817a`, docs-only). The older 44-58 block and the "(Historical...)" section are
   deliberately still untouched — that range interleaves pure superseded narrative with still-referenced
   standing decisions (the "TOP PRIORITY STACK"), so it needs an actual read, not a mechanical line-range
   delete, and that was out of scope for this pass.
3. **Maintenance checks, read-only (matching sessions 76/77's established autonomous-safe precedent):** `npm
   audit` root and `web/`, both 0 vulnerabilities. `npm run gdpr:purge` (default dry-run/report-only mode) was
   attempted and **BLOCKED by the Claude Code auto-mode permission classifier** — a DB-connecting script against
   production, even read-only, was correctly judged out of scope for unattended execution; not retried, no
   workaround attempted. This is a WORKING safety boundary, not a gap to route around next time either — see
   `lessons-learned.md`'s session-81 entry. Production confirmed healthy throughout,
   `/api/health` 200 (checked directly via `node -e "fetch(...)"`; `curl` is not installed in this sandbox).
4. **Re-verified, not just re-trusted from the prior kickoff:** `agent-aa024a353bfdc08d5`'s worktree lock PID is
   a genuinely still-running `claude` process (`ps -p <pid>`, 13h16m elapsed at the time of the check this
   session — it will have grown further by the time you read this; re-check, don't reuse this number) — **do
   not touch this worktree**, it has real uncommitted changes (`package.json`/`package-lock.json`) matching
   real in-progress work, not stray debris. Separately, an UNREGISTERED stray directory
   (`.claude/worktrees/dependabot-npm-all-fix/` — no `.git`, just an orphaned `node_modules/.vite` folder,
   matching session 80's own documented `git worktree remove --force`-while-a-script-was-running incident)
   was found and deleted as routine cleanup — it was never a real git worktree (`git worktree list` never knew
   about it), so this is not the same class of thing as the two worktrees below.
5. **Declined by default, correctly, no owner input available:** #162's round 5 (a fresh ~$0.20 LLM-judge
   re-run) — session 80's own kickoff named "leave parked, default if nothing said," so nothing was spent or
   authorized. The 3 `gh secret set` commands for Route B (owner's own terminal, never a session's — this exact
   ambiguity already caused a real mistake once, per session 80's lesson). WP30c + #197's three older recorded
   follow-ups (i)-(iii) — unscheduled owner-menu items, untouched.

**▶ NEXT, in order:**

1. **Review + merge PR #6** (#197 idea 4) — green, conflict-free, nothing else needed from you but the merge
   click. After merging: a production canary (`/`, `/llms.txt`, `/api/health`) once its deploy finishes, and a
   post-merge docs sweep for any "PR pending owner review" wording tied to #197 idea 4 that should now say
   MERGED + LIVE (check `docs/open-questions.md` #197, `docs/decisions/014-chart-spec-v1-and-renderer.md`,
   `docs/04-architecture.md`'s new row).
2. The 3 `gh secret set` commands for Route B's repo — owner's own terminal, blocking only `deploy`.
3. #162's §6 A/B verdict (clean loss, recorded session 80) — accept as final (default, if nothing said) or
   authorize a round 5 (prompt-level phrasing fixes targeting the two named patterns in
   [open-questions #162](../open-questions.md) + a fresh ~$0.20 re-judge).
4. WP30c + #197's three older follow-ups (i)-(iii) — owner-menu items, unscheduled, no rush.
5. (Optional, whenever, no owner decision needed to start) [open-questions #203](../open-questions.md) —
   `deriveDirection` has no region guard; low urgency (nothing measured live-wrong today), real gap.
6. (Optional, low-priority) the older 44-58 `STATUS.md` block + historical section — a closer read than
   sessions 80/81's mechanical prune could safely do; see point 2 above.

Binding frames, unchanged: principles (a)/(b)/(c); no prompt-byte changes without owner sign-off; no live DDL
without the owner; no fixture re-recording without explicit authorization and hard-gate discipline. 8 GB
machine: `npm ci` (root AND `web/`) before any local verification, especially in a fresh worktree.
`scripts/verify-block.sh` + the vitest mutex (`pgrep -f "[n]ode.*vitest"`) for anything long-running; `npm run
test:docs` before every docs push (this session was reminded hard: it caught 3 live-GitHub PR links this
session accidentally wrote into `docs/STATUS.md`/`status-archive.md` before they were pushed — the #132 interim
rule, plain-text `PR #N` only, never a markdown link, because route (b) would 404 every one); `/code-review` LOW
effort before every CODE push (docs-only pushes are exempt). Autonomous session without an owner answer: never
merge core-product/money-path code ([#118(b)](../open-questions.md)) — session 81 was autonomous throughout, so
PR #6 stayed unmerged despite being fully green; this gate lifts only when the owner is back in the chat. Three
non-main worktrees exist on purpose, do not delete any without re-verifying first: `agent-aa024a353bfdc08d5` (a
background agent process re-confirmed genuinely still alive this session via `ps -p <pid from the lock error>`
— re-check, don't reuse that finding); `experiment/162-slot-filling-ab` (parked per point 5 above);
`feat/197-chart-trend-headline` (now PR #6 — once merged, this worktree + branch can finally be cleaned up per
`superpowers:finishing-a-development-branch`, not before).

Session-end: the full wrap-up ritual from CLAUDE.md ran in full this session (lessons-learned — 6 new bullets,
memory files incl. two new general-behavior notes, the full doc set incl. archiving + a lean STATUS + a new
04-architecture row, a stale-doc sweep, `npm run test:docs`, clean git state across every worktree, this
kickoff file, and this final self-audit). A future session's own wrap-up should do the same, unprompted, per
[[feedback_unprompted_session_end_hygiene]] and [[feedback_session_wrapup_ritual]] if those memory files still
exist on whatever machine runs it — if not, this paragraph and CLAUDE.md's own "Session wrap-up" section are the
durable copy.

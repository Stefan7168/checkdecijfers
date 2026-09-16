# Session 107 kickoff — checkdecijfers.nl

Read `CLAUDE.md` first, then `docs/STATUS.md`'s top block (authoritative over anything below it).
Verify everything below against `git log`/`git worktree list`/`gh run list` before trusting it — this
brief may be stale by the time you read it, and its whole point is to hand you a resume point, not a
final answer.

## The one thing that matters: session 106 is PAUSED mid-build, resume it first

Do not start anything new before resuming this. Session 106 (2026-09-16) built the chart
alternate-reading toggle ([open-questions #254](../open-questions.md)'s second gap, full record at
[#261](../open-questions.md)) via subagent-driven development, in an isolated worktree, and paused
mid-build on an owner wrap-up signal — 5 of 6 plan tasks plus one standalone fix are done and
review-clean; the branch is **not merged to `main`**.

**Resume steps:**

1. Check `git worktree list` for `worktree-chart-alternate-reading-toggle` at
   `.claude/worktrees/chart-alternate-reading-toggle`. If it's still there on this machine, use
   `EnterWorktree` with `path` pointed at it — do NOT create a fresh worktree, it already has 12
   clean, reviewed commits. If it's gone (a machine/account switch), the branch survives on
   `origin/worktree-chart-alternate-reading-toggle` (pushed as a durability backup, no PR opened) —
   check it out fresh from there instead; you'll be missing only the local SDD ledger (a per-machine
   scratch file, never committed), whose contents are reconstructed below and in
   `docs/status-archive.md`'s session-106 entry.
2. Read the SDD ledger if it survived:
   `.superpowers/sdd/2026-09-16-chart-alternate-reading-toggle/progress.md` inside the worktree —
   it has the full task-by-task record, every reviewer finding, and every controller ruling made
   along the way.
3. **The actual open item:** Task 6 (the final wiring task — the one that activates the toggle in
   `chat.tsx`/`visual-dock.tsx`, plus a controller-added addendum disabling the Embed button while a
   non-primary reading is shown) came back from review as "Needs fixes," ONE finding, not yet
   resolved: `web/components/trial-chat.tsx` (the anonymous homepage trial) already carries the data
   (`message.response.chartAlternates`) but was never wired to show the toggle, since it wasn't in
   Task 6's named file list. Two options, both already named by the reviewer — pick one: (a) wire it
   the same way `chat.tsx`/`visual-dock.tsx` were (small, same pattern, probably one more
   implementer+reviewer round), or (b) make a deliberate decision to leave the trial surface excluded
   and document why (record it in the same open-questions #261 row). Dispatch this as one more
   fix-and-re-review round via `subagent-driven-development`'s normal fix-loop mechanism, same as
   every prior round this session — resume via `SendMessage` to the Task 6 implementer if that agent
   is still addressable, or dispatch fresh with the finding + brief + report file paths if not.
4. Once Task 6 is clean: run Task 7 (the whole-branch review — the plan's own note says the
   controller does this one itself, on the most capable model tier, using
   `superpowers:requesting-code-review`'s `code-reviewer.md` template per the SDD skill's Final
   Review step). Point it at the ledger's parked/deferred Minor findings so it can triage which must
   be fixed before merge (there are several already recorded, none blocking).
5. Full verification block (typecheck ×2, full backend suite ~2400 tests, full web suite ~1840
   tests, benchmark 14/14+6/6+0 fabricated, real `next build`) + `/code-review` LOW pass, both
   standing pre-push requirements, unchanged by any of this.
6. Merge directly to `main` (owner-present convention, no PR — confirm the owner is actually present
   in THIS session before assuming standing authorization applies; if this session is autonomous,
   Task 6/7 still finish the same way but the merge itself needs branch+PR+owner review per
   [#118](../open-questions.md)(b) instead).
7. Push, confirm CI green (`gh run watch <run-id> --exit-status`), update STATUS.md/open-questions
   #261/build-plan/archive to reflect the FINISHED, merged, live state (they currently describe the
   paused state — that framing needs to flip once this actually ships).

## What NOT to re-litigate

- The design is settled and was corrected once already (the registry has 20 measures with
  `alternates`, not 1; `buildAlternateReading` merges dims rather than replacing them) — read
  `docs/superpowers/specs/2026-09-16-chart-alternate-reading-toggle-design.md` before questioning
  either of these, don't re-derive from a compressed memory of the session.
- The level-vs-%-change half of the original #254 ask is explicitly OUT of scope for this feature —
  it needs a new registered series-wide derivation and an ADR 011 revision, a separate future design
  task, not something to fold into finishing this one.
- The embed route (`/embed/[token]`) and the anonymous trial chat not getting the toggle in THIS
  slice were both deliberate scope calls (see the design spec's Follow-ups section) — the trial-chat
  finding above is about whether that specific exclusion should now be REVERSED or explicitly
  documented, not a sign the original scoping was wrong.

## Separately, already shipped and live this same session (2026-09-16)

The Supademo chart-polish comparison resolved chart-card-polish's one pending owner-gated decision
(`STOCK_PRESENTATION.framePadding: 'none' → 'small'`) — shown live, owner picked it, shipped,
verified live on production (`c934f1d`). Nothing to do here. The broader "match Supademo's polish"
question stays logged, not built ([open-questions #260](../open-questions.md)) — do not pick this up
without a new, explicit owner ask; it's a real design task (palette vibrancy, hover animation,
dark-mode palette, bar rounding) that needs the brainstorming skill's architectural path when it's
time, not a quick tweak.

## Standing reminders (unchanged)

Full verification block + `/code-review` LOW before every push (docs-only pushes exempt from the
code-review step, not from being pushed promptly). Owner-present sessions push/merge directly to
`main`, no per-change approval needed once green; autonomous sessions keep branch+PR for
core-product/money-path code. Live DDL, real spend, and env-flag flips stay owner-supervised
regardless of how broad the general push/merge authorization is — one targeted question if the owner
pushes back on this specific point, not silent compliance or a policy lecture.

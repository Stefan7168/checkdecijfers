# Session 84 kickoff — paste this as the first message

Written at the session-83 close-out, 2026-09-06 (~17:2xZ). Durable copy of the handoff; the chat may be gone,
the repo is the source of truth. Every fact below was verified against `git log`, `gh pr list`, `gh run view`,
`git worktree list`, `git branch`, and a live `/api/health` fetch at the time of writing.

Read in this order before doing anything: `CLAUDE.md` → `docs/STATUS.md` (the top block is the truth) → this
file → `docs/status-archive.md` (session-83 entry, top, 10 items — session 82's own entry sits right below it)
→ `docs/lessons-learned.md` (session-83 entry, top, 4 bullets, then session-82's below it).

Verify yourself first: `date +%Y-%m-%d`, `git log -5 --oneline` (expect `759ea3e` at the tip — a
`docs(wrap): session-83 close-out` commit; `gh pr list --state open` should be EMPTY), `gh run list --branch
main -L 3` (expect `gate` green on every recent commit; `deploy` shows `failure` — the KNOWN, still-unfixed
Route B Vercel-secrets gap, confirm via `gh run view <id> --json jobs`, never the top-level conclusion),
`git worktree list` (expect ONLY the main checkout — no other worktrees), `git branch` (expect `main` plus
exactly one other branch, `experiment/162-slot-filling-ab`, NOT checked out anywhere — that's correct, it's
parked history, not active work). Second-instance check: `ListAgents` / `mcp__ccd_session_mgmt__list_sessions`.

State after session 83 (2026-09-06, owner present throughout, fresh session opened by pasting the session-82
kickoff doc):

1. **Worktree cleanup (session-82 carryover):** `agent-aa024a353bfdc08d5`'s dead branch + worktree removed
   on the owner's go-ahead (`git worktree remove --force` + `git branch -D` — remove-before-delete order,
   since git refuses to delete a branch still checked out in a worktree).
2. **The "44-58 STATUS.md archive gap" session 82 reported was a FALSE POSITIVE — corrected, not
   backfilled.** Session 82's own grep-based check only matched one heading format
   (`^\*\*Last updated`); `status-archive.md` also uses a bare `**DATE (session N — ...)**` (session 50,
   archive line ~3562) and a `**Previous (DATE, ...)**` (the "Design marathon" entry, archive line ~3282) —
   both present, both missed by the pattern, not by content. Every session in the originally-flagged range
   (44 through 55, plus "Design marathon" and "Sparring session") was re-checked word-for-word against the
   archive: all fully present, in more detail than STATUS.md's own summary. No backfill was needed —
   STATUS.md's now-redundant narrative (Design-marathon-through-session-44) was pruned directly, matching
   the pattern already established for sessions 56/57/68-79/80/81 (zero narrative left in STATUS.md's body
   for any of those). **If you ever see "archive gap" mentioned again for this range, it's wrong — this is
   the correction, not a still-open question.**
3. **#162 (number-free slot-filling phrasing experiment) is now CLOSED, PERMANENTLY, by explicit owner
   decision** ("Accept as final on #162", in-chat). Round 5 (two targeted prompt-level fixes: prefer "in"
   over "op" before a bare-year period; don't restate a value placeholder that adds no new information) was
   run this session and still FAILED both A/B gates, WORSE than round 4 (win-or-tie 29.41% vs round 4's
   41.18%, gate ≥60%; still 9/34 grammar-flagged, a different set of pairs). `SLOT_PHRASING_ENABLED` stays
   unset in production PERMANENTLY — there is no round 6, and the ADR-draft is NOT promoted to an accepted
   ADR. The mechanism code (`src/answer/compose/slots.ts`) stays merged-but-permanently-inert on `main`
   (session 67, PR #113) — flag-off byte-identical production behavior, test-pinned. The experiment branch
   `experiment/162-slot-filling-ab` is kept (never pushed to origin, all 5 rounds' commits intact,
   `SLOT_COMPOSE_PROMPT_VERSION` now at 2) but its worktree was removed once the experiment closed — the
   branch itself is untouched and could be re-checked-out later, but revisiting this would be a FRESH
   decision, not a continuation. Full measured detail: `docs/open-questions.md` #162 (now marked ✅ CLOSED),
   `docs/04-architecture.md`'s capability row, `docs/RUNBOOK.md`'s `SLOT_PHRASING_ENABLED` entry — all three
   updated in the same change. **Do not propose a round 6 without a fresh, explicit owner ask.**
4. **Before spending on round 5, a lowballed cost estimate was caught and corrected rather than silently
   overspent or re-asked.** Quoted the owner "~$0.20" (round 4's judge-only cost) when asking permission;
   reading the actual recording script (`scripts/ab-162-experiment.ts`) before running anything showed a
   FULL re-recording is required whenever the prompt changes (not just re-judging), at ~$0.46 more — the
   estimate was corrected to ~$0.60 in the transcript before spending, verified to fit inside the
   experiment's own pre-blessed ~€1-2 total budget, and the work proceeded on that basis. **Cumulative #162
   spend across all 5 rounds: ≈$1.77** — this experiment's spend is now closed out, no further live-LLM
   spend against it is expected.
5. **A tooling quirk hit twice, recorded as an open item, NOT fixed:** `.claude/hooks/wrapup-detect.sh` (a
   `UserPromptSubmit` hook) fired a false "SESSION WRAP-UP SIGNAL DETECTED" twice this session — both times
   on the session's OWN `ScheduleWakeup`-injected continuation prompt (which happened to contain the words
   "wrap up" meaning "conclude this CI check," not an owner signal), not on anything the owner actually
   typed. Harmless (advisory only; recognized correctly both times per CLAUDE.md's actual trigger definition
   — "the OWNER signals" — and worked through rather than over-applied). Not fixed blind, since the hook's
   JSON input schema wasn't confirmed to carry a field distinguishing "typed by the owner" from "injected by
   ScheduleWakeup" — a wrong guess at that schema risks breaking the hook's real, hard-won false-positive
   suppression logic (the first-message marker, the paired-cue matching). **If you pick this up:** check
   whether the harness's `UserPromptSubmit` payload includes a source/origin field before adding a
   ScheduleWakeup-aware exclusion clause.
6. **4 process lessons appended** to `docs/lessons-learned.md` (session 83, top of file): the archive-gap
   verification methodology (a grep-based "X is missing" claim is only as strong as the pattern searched —
   verify by content before proposing a remediation task), the spend-estimate-correction discipline above,
   a "root-cause a hard-gate miss before attributing it to your own change" case (round 5's 4 template-falls
   all traced to one pre-existing, unrelated digit-leak mechanism — NOT caused by the new prompt rules —
   before proceeding to the judge), and the hook false-positive above.
7. **Untouched, no owner input given specifically:** the 3 `gh secret set` commands for Route B (owner's own
   terminal — this has been pending across multiple sessions now), WP30c + #197's three older follow-ups
   (owner-menu, no rush, unrelated to anything from this session).

▶ NEXT, in order:

1. The 3 `gh secret set` commands for Route B — your terminal, blocking only `deploy`. This has been pending
   for several sessions now; worth doing whenever convenient, no urgency beyond that.
2. WP30c + #197's three older follow-ups — owner-menu, no rush.
3. Nothing else is currently flagged as pending a decision. The next build/research priority is open — check
   `docs/open-questions.md` for anything that's aged into relevance, or ask the owner what's next.

Binding frames, unchanged: principles (a)/(b)/(c); no prompt-byte changes without owner sign-off (moot for
#162 specifically now — it's closed); no live DDL without the owner; no fixture re-recording without explicit
authorization. 8 GB machine: `npm ci` (root AND `web/`) before local verification in a fresh worktree; the
vitest mutex (`pgrep -f "[n]ode.*vitest"`) for anything long-running; `npm run test:docs` before every docs
push; `/code-review` LOW before every code push (docs-only pushes are exempt — every push this session was
docs-only, so none needed it). Exactly one non-main branch remains, `experiment/162-slot-filling-ab`, kept as
closed history — not checked out, not merged, not deleted.

Session-end: the full wrap-up ritual ran in this session per `CLAUDE.md`'s "Session wrap-up" section —
lessons, memory, the full doc set (STATUS/archive/open-questions/RUNBOOK/04-architecture), a stale-doc sweep,
clean-state verification, worktree cleanup, this kickoff doc, and a final self-audit all completed. A future
session's own wrap-up should still run the complete ritual per CLAUDE.md, not assume this one covers it.

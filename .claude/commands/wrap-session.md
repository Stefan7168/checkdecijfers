---
description: Run the full end-of-session wrap-up ritual for checkdecijfers.nl (comprehensive close-out).
---

Run the **Session wrap-up (end-of-conversation ritual)** exactly as defined in `CLAUDE.md` (the "Session wrap-up" section) — the COMPLETE checklist, in full, before you stop.

Reproduce the checklist as a literal list in your reply and mark each item ✅ done / ⏭️ N/A (with a one-line reason). Do NOT declare the session wrapped until every item is ✅ or ⏭️. If unsure whether a doc applies, open it and check — never assume.

## GOLDEN RULE — verify every fact against reality, never from memory

Every date, PR number, commit SHA, merge/deploy status, test count, and "LIVE"/"green"/"merged" claim you write into a doc MUST be verified against the actual source **before** you write it — not recalled from your own memory or your earlier messages in this chat (that is exactly how a wrong date slipped in session 44). Run these and trust THEM:
- **Dates:** `date +%Y-%m-%d` (today) and `git --no-pager log --date=short --format='%h %ad %s' -8` (when each commit actually landed). A session that spanned days must say so.
- **PR #s / SHAs / merge state:** `gh pr list --state all -L 5` and `git --no-pager log --oneline -8`.
- **CI / deploy / prod:** `gh run view <id>` and `curl -s -o /dev/null -w '%{http_code}' <prod-url>`.
- **Code claims (a file/function/line still exists, still does X):** `grep`/read the file — do not assert from memory.

## The checklist (see CLAUDE.md for the authoritative version)

1. Lessons → `docs/lessons-learned.md` (newest on top), or state there were none.
2. Memory files + the `MEMORY.md` index line.
3. The FULL doc set to the final MEASURED state — NOT just the trackers: `docs/STATUS.md` (lean top block: NEXT-SESSION + priority stack, hard-wrapped ~150 chars) + PREPEND the session's Last-updated entry to `docs/status-archive.md` (verbatim log, newest on top), `docs/open-questions.md`, `docs/08-build-plan.md`, `docs/RUNBOOK.md`, `README.md` (+ `web/README.md` if touched), the touched ADR(s) (as-built notes) + `docs/04-architecture.md`.
4. Stale-doc sweep: `grep -rn` across `docs/` for the OLD framing of anything changed this session; fix every hit (every doc that mentions it, not just the ones you edited).
5. Clean state: `git status` clean + pushed; `git worktree list` no strays; CI green per commit.
6. Cleanup: delete one-off scratch/verify scripts (incl. any `zzdel_*`/`__scratch*` review-agent test files), keep reusable ones; spin off out-of-scope hygiene as task chips.
7. Next-session prompt: hand a paste-ready kickoff AND save a durable copy to `docs/session-briefs/<date>-session-<n>-kickoff.md` (so the handoff survives a clean 0%-context restart).
8. **FINAL SELF-AUDIT (do this LAST, before declaring wrapped):** re-read your own STATUS/status-archive/memory/lessons edits from this session and cross-check EVERY date, PR#, SHA, test count, and status word against the verified sources from the Golden Rule above. Fix any mismatch. No process is perfect — this step is the backstop that catches the one thing you got wrong from memory. Only after this passes: declare the session wrapped.

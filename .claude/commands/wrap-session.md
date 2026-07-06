---
description: Run the full end-of-session wrap-up ritual for checkdecijfers.nl (comprehensive close-out).
---

Run the **Session wrap-up (end-of-conversation ritual)** exactly as defined in `CLAUDE.md` (the "Session wrap-up" section) — the COMPLETE checklist, in full, before you stop.

Reproduce the checklist as a literal list in your reply and mark each item ✅ done / ⏭️ N/A (with a one-line reason). Do NOT declare the session wrapped until every item is ✅ or ⏭️. If unsure whether a doc applies, open it and check — never assume.

The checklist (see CLAUDE.md for the authoritative version):
1. Lessons → `docs/lessons-learned.md`.
2. Memory files + the `MEMORY.md` index line.
3. The FULL doc set to the final measured state — NOT just the trackers: `docs/STATUS.md` (Last-updated + NEXT-SESSION block), `docs/open-questions.md`, `docs/08-build-plan.md`, `docs/RUNBOOK.md`, the touched ADR(s) (as-built notes) + `docs/04-architecture.md`.
4. Stale-doc sweep: `grep -rn` across `docs/` for the OLD framing of anything changed this session; fix every hit.
5. Clean state: `git status` clean + pushed; `git worktree list` no strays; CI green per commit.
6. Cleanup: delete one-off scratch scripts, keep reusable ones; spin off out-of-scope hygiene as task chips.
7. Next-session prompt when asked (or when it clearly helps).

# Session 106 kickoff — checkdecijfers.nl

Read `CLAUDE.md` first, then `docs/STATUS.md`'s top block (authoritative over anything below it), then `docs/08-build-plan.md`. Verify everything below against `git log`/`gh pr list`/`gh run list` before trusting it — this brief may be stale by the time you read it.

## Current state (verified at write time, 2026-09-16)

`main` at `7bf76ff`. Session 105 designed and built the journalist chart-headline feature end to end via subagent-driven development (8 tasks + a final whole-branch review + one fix wave, all clean), merged it directly to `main` (owner-present, standard convention — no PR), CI green (`gate` + `deploy` both succeeded, run `35080844042`), and — with the owner's separate, explicit go-ahead for that specific step — applied migration 031 live and verified it (RLS on, zero `anon`/`authenticated` grants). **The feature is fully live in production.** Full record: [ADR 050](../decisions/050-journalist-chart-headline.md), [open-questions #259](../open-questions.md), [status-archive.md](../status-archive.md)'s session-105 entry.

A journalist can now: ask a question, get a chart, click a button to get an AI-suggested headline for it (built from the chart's own most notable data point, using the same "the AI can't invent a number" mechanism as the existing Insights feature), edit that headline freely, save it, and see it show up in the chat, on a public shareable embed page, and in downloaded PNG/SVG images.

Two things the owner has not decided, don't guess at either:
- Should a saved headline visually show it was written by a person, as distinct from the app's own validated numbers?
- Should a saved headline be removable, not just editable? (Today: edit only — the only way to get rid of one is deleting the whole chat.)

## The actual mandate

[Open-questions #254](../open-questions.md) named two "standard graphs" quality gaps with no blocking precondition. Session 105 built the first (the headline). **The second is still queued, not started:** context controls on a chart — letting the reader switch between showing a level and showing the percent change, or between raw and seasonally-adjusted figures. Check #254's row for the full research context before scoping it.

Do not assume this is automatically next without checking `STATUS.md`'s top block first — the owner's priorities shifted mid-session more than once in recent sessions (session 104 pivoted away from 3D/storytelling work entirely; session 105 itself started on a map-library investigation that turned out to be blocked before landing on the headline feature). If nothing in `STATUS.md` points at #254's second gap specifically, ask rather than assume.

## Binding constraints (unchanged)

No live DDL, no real spend, no env-flag flips autonomously — even in an owner-present session, a specific live-database or billing action needs its own explicit yes, separate from a general "go ahead and build this." Full verification block (typecheck × 2, all backend + web suites, benchmark 14/14 + 6/6 + 0 fabricated, a real `next build`) plus a `/code-review` LOW pass before every push. Owner-present sessions push/merge directly once that's green (#118(a)); autonomous sessions keep branch + PR (#118(b)).

## Two process lessons from session 105, worth knowing before you dispatch subagents again

1. **A dispatched implementer or fix subagent will still background a long test/build command and stall, even when explicitly told not to in the same dispatch prompt.** It happened three times in one session. Expect it, don't be surprised by it: if an agent reports "completed" but its own text says something like "waiting for the background run," check the worktree (`git status`, `git log`) to confirm nothing was lost, then resume it via `SendMessage` — never dispatch a fresh `Agent` call for the same task, that spawns an independent duplicate that can race the original.
2. **Long stretches of technical process narration (task dispatched, review verdict, commit SHAs) leave the owner lost, even when everything is going correctly.** He said so plainly mid-session. Periodically translate progress into plain terms — what's actually happening and why — not just at decision points.

## If you're picking up #254's context-controls gap

Read #254's row in `docs/open-questions.md` in full first — it has the original research (level vs. %-change, seasonally-adjusted vs. raw, inflation/population normalization) and notes that the underlying "difference" math the query layer computes for other purposes might be reusable. This is a real design task, not a bounded bug fix — use the brainstorming skill, architectural path, same as session 105 did for the headline. Check whether "seasonally-adjusted" already exists as a separate CBS measure a user has to ask for by name (it does, per session 105's own investigation) before assuming a toggle needs to be built from scratch.

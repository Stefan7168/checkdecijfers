# Session 137 kickoff (written 2026-09-27 local, end of session 136)

Read order: `CLAUDE.md` → `docs/STATUS.md` top block → this file. Verify every claim here against `git log`,
`gh run list --branch main -L 3`, `gh pr list` and prod (`curl https://checkdecijfers.vercel.app/`) before acting on it.

## Where things stand

- **`main` is live and green.** Last feature push `bcdbd405` (CI 36315795992 green incl. deploy), then the session-136
  wrap-up commit (two comment fixes + docs). No open PRs, no worktrees. Session 136's log: `docs/status-archive.md`.
- **Live since session 136:** downloads carry the chart title + caption; the public embed shows the author's saved edits
  and house style (following later edits); reader-typed text reaches a public surface only when every number in it is on
  the chart (`web/lib/chart-publish.ts`); notes stay private; 'Totaal' → 'Total' on English charts. ADR 041/056 notes.
- **Spend roof:** the $50 monthly limit is nearly used until it resets on **2026-10-01**. No live LLM runs before then
  unless the owner raises the limit.

## The single next priority: regional statistics (owner-chosen, session 134)

1. **Retry CBS first** (#329, a CBS-side outage all of 2026-09-27, still down at 19:17 local):
   `curl -s -o /dev/null -w '%{http_code}' https://datasets.cbs.nl/odata/v1/CBS/70072ned/Properties` (000 = still down;
   also check the "Technische storing" banner on www.cbs.nl). If still down: do NOT design around it on paper (owner steer,
   session 135) — take the next unblocked item below and size it for the owner in one question box.
2. **If CBS is back: brainstorm → spec** for a regional-statistics set from ONE CBS table (candidate `70072ned`, ~325
   columns). Known design issue: the schema fingerprint (`src/ingestion/fingerprint.ts`) covers ALL measure codes, so every
   CBS column addition quarantines the table (`needs_review`); a registry slice of 8–12 headline measures probably needs a
   fingerprint over the sliced measures only. Re-check live: column list, cell count vs the 500k sync cap, GeoDimension,
   region groups (LD/PV/GM), revision cadence. Owner GO on the plain-English design before building. Adding regional keys
   changes the intent vocabulary → one Haiku re-record (after 10-01).

## If CBS is still down

- From 2026-10-01 (owner present, small spend): the next live benchmark (confirms #330 live) and #328 (B9-only re-record;
  plan in the row).
- Small unblocked items: #327 (three hygiene minors, invisible), #299 (all-municipalities verified whole; low value).
- Owner decisions, not urgent: #245 sub-questions, #275 homepage styles row (on hold at the owner's request), own-data
  publishing spot-check (RUNBOOK ADR 057 step 4), Eurostat E2a steps 0/5/6 (#313).

## Standing constraints

- Principles (a)/(b)/(c). No live DDL, real LLM spend or env-flag flips without the owner present. Never `gh secret set`.
  Never `spawn_task` (track follow-ups as open-questions rows). The repo is PUBLIC.
- Owner present: standing push authorization (CLAUDE.md #118). Autonomous: branch + PR, merged on the owner's plain-English
  GO. The owner does not read code; put every decision INSIDE the question box, in plain sentences. Don't stop after a
  finished item — size the next one and ask in the same turn.
- Code pushes: full verify block (`scripts/verify-block.sh`, detached) + `/code-review` LOW + (validator/R8 changes)
  `npm run audit:verify`. Hermetic benchmark informational: template fallbacks **0**.
- Render the real surface before designing a fix (RUNBOOK "Seeing a stored answer's public embed page locally"); read-only
  live queries via `createPool`, never a bare `pg.Client`.
- Never `git add -A` while an agent works in the same checkout. 8 GB machine: one vitest at a time, foreground.

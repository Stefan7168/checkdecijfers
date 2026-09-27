# Session 136 kickoff (written 2026-09-27 local, end of session 135)

Read order: `CLAUDE.md` → `docs/STATUS.md` top block → this file. Verify every claim here against `git log`,
`gh run list --branch main -L 3`, `gh pr list` and prod (`curl https://checkdecijfers.vercel.app/`) before acting on it.

## Where things stand

- **`main` is live and green.** Last code merge `e586732b` (CI 36311096315 green incl. deploy); docs-only commits after it.
  No open PRs, no worktrees. Session 135's full log: `docs/status-archive.md` "Session 135".
- **Live since session 135:** region-class questions ("per provincie", "welke gemeente in Utrecht …", ADR 054 Task 9);
  English refusals, clarifications and chart texts from hand-written templates and name tables, no AI call (ADR 058
  phases 2-3, #332); English replay/copy/proof/CSV gaps (#324); the sentence-final-year period-check bug (#330).
- **English answers** (ADR 058 phase 1) are live since 2026-09-26 (`ENGLISH_ANSWERS_ENABLED=1`). Still Dutch for English
  readers: the AI-worded Insights/journalist headline, hand-curated chart annotations, the model's own reading inside
  "Did you mean …?", CSV data values, the proof panel's explanatory sentences.
- **Spend roof:** the $50 monthly limit is nearly used until it resets on **2026-10-01**. No live LLM runs before then
  unless the owner raises the limit.

## The single next priority: regional statistics (owner-chosen, session 134)

1. **Retry CBS first** (#329, a CBS-side outage all of 2026-09-27):
   `curl -s -o /dev/null -w '%{http_code}' https://datasets.cbs.nl/odata/v1/CBS/70072ned/Properties` (000 = still down;
   also check the www.cbs.nl banner). If still down: do NOT design around it on paper (owner steer, session 135) — take the
   next unblocked item below.
2. **If CBS is back: brainstorm → spec** for a regional-statistics set from ONE CBS table (candidate `70072ned`, ~325
   columns). Key design issue already found: the schema fingerprint (`src/ingestion/fingerprint.ts`) covers ALL measure
   codes, so every CBS column addition quarantines the table (`needs_review`) — the reason phase 0 rejected it. A registry
   slice of 8–12 headline measures probably needs a fingerprint over the sliced measures only. Re-check live: column list,
   cell count vs the 500k sync cap, GeoDimension, region groups (LD/PV/GM), revision cadence. Owner GO on the plain-English
   design before building. Adding regional keys changes the intent vocabulary → one Haiku re-record (after 10-01).

## If CBS is still down

- After 2026-10-01: the next live benchmark (confirms #330 live) and #328 (B9-only re-record; plan in the row).
- Owner decisions, not urgent: #245 sub-questions, #275 homepage styles row (on hold at the owner's request), own-data
  publishing spot-check (RUNBOOK ADR 057 step 4), Eurostat E2a steps 0/5/6 (#313).

## Standing constraints

- Principles (a)/(b)/(c). No live DDL, real LLM spend or env-flag flips without the owner present. Never `gh secret set`.
  Never `spawn_task` (track follow-ups as open-questions rows). The repo is PUBLIC.
- Owner present: standing push authorization (CLAUDE.md #118). Autonomous: branch + PR, merged on the owner's plain-English
  GO. The owner does not read code; put every decision INSIDE the question box. Don't stop after a finished item — size the
  next one and ask in the same turn (lessons s135 #12).
- Code pushes: full verify block + `/code-review` LOW + (validator/R8 changes) `npm run audit:verify -- 1 <max id>` (rows
  up to 336). Hermetic benchmark informational: template fallbacks now **0**.
- Prompt changes: probe the single affected case first (the WP16 delivery re-run is the canary for vocabulary/rule bleed),
  then re-record; price `--repeat=3` (≈$2.40) before starting. After a prompt change, grep CI for `[llm-stub] prefix`.
- Never `git add -A` while an agent works in the same checkout. 8 GB machine: one vitest at a time, foreground (backend
  suite ≈9–14 min).

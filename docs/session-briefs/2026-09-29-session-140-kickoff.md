# Session 140 kickoff (written 2026-09-29 local, end of session 139)

Read order: `CLAUDE.md` → `docs/STATUS.md` top block → this file. Verify every claim against `git log`,
`gh run list --branch main -L 3`, `gh pr list` and prod (`curl https://checkdecijfers.vercel.app/`) before acting on it.

## Where things stand

- **`main` live and green:** last code merge `461920e6` (breadth step 4b, CI 36483049274 green incl. deploy, prod 200).
- **Direction (owner, session 138, #335): BREADTH FIRST** — any current CBS table answerable in the same chat. Spec
  `docs/superpowers/specs/2026-09-28-breadth-any-cbs-table-design.md`, ADR 062 (read its "As built" sections for steps 2,
  3, 4 and 4b — they are the interface reference for step 5).
- **Built, reviewed, merged, NOT wired to chat:**
  - Step 2 slice cache — `src/ingestion/slice-cache.ts` (`registerSchemaOnly`, `fetchSlice`, `ensureSlice`); migration
    037 FILE-ONLY (the owner applies it with `npm run db:migrate` before step 5 goes live).
  - Step 3 breakdown resolver — `src/query/breakdowns.ts` (`resolveBreakdowns`, `statedDefaultsText`).
  - Step 4/4b table-scoped parser — `src/answer/table-parse/` (`buildTableParseSchema` → `tableParse` returns
    `{result, audit}` → `namedFromParse`); typed errors `TableParseIneligibleTableError`, `TableParseValidationError`,
    `TableParseRegionUnavailableError`, `TableParseAmbiguousMeasureError`; `periodGrainUnavailable` is a FLAG (must be
    checked); confidence threshold 0.8 is uncalibrated (#338). **It has never called the AI** — no fixtures exist yet.
- **Spend:** $50 roof nearly used until **2026-10-01**. The step-4 recording run (~102k input tokens, cheap tier) is
  owner-supervised after that date — RUNBOOK "Table-parser recording run".

## Next, in order

1. **Plan + build step 5, dark behind a new env flag** (off in prod): curated lane miss → table finder (existing,
   `src/catalog/find.ts`) → `registerSchemaOnly` if new → table parse → breakdown resolver (ask with buttons when needed)
   → `ensureSlice` as a job outside the request (existing kick + job infra) with in-chat progress/poll → audited answer
   from stored cells → normal price, charged only on an answer. Design items to settle in the plan: #336 (lock/timeout,
   CBS-unreachable, staleness, URL length, retry on an older `Modified`) and #339 items 5–11 (one tagged-outcome wrapper
   so the threshold and grain flag cannot be forgotten; full `BreakdownQuestion` + typed reply for `anders`; "Nederland"
   on national-only tables; geo + region-coded tables; grain fallbacks; audit of the offered menu). Hermetic tests use
   stub LLM clients until the recording exists. Brainstorm the UX with the owner only if a decision is genuinely theirs
   (price and progress wording are already decided in the spec: D5/D6).
2. After 10-01 with the owner: the step-4 recording + calibration run; apply migration 037.
3. Step 6: table-lane benchmark (new frozen key over ~20 tables) → flag flip. Then invite ~10 journalists.

## Standing constraints

Principles (a)/(b)/(c). No live DDL / real LLM spend / env flips without the owner. Never `gh secret set`, never
`spawn_task`. Repo is PUBLIC. Owner present: push directly (#118); autonomous: branch + PR, merged on a plain-English GO.
The owner doesn't read code; put every decision INSIDE the question box. Code pushes: `scripts/verify-block.sh`
(detached, solo — kill any stale run first; re-run a red UI test file alone before believing it) + `/code-review` LOW.
Implementer briefs: foreground tests one at a time (8 GB), no `git stash`, never edit an applied migration; paste
safety-critical rulings into briefs verbatim.

# Session 139 kickoff (written 2026-09-28 local, end of session 138)

Read order: `CLAUDE.md` → `docs/STATUS.md` top block → this file. Verify every claim against `git log`,
`gh run list --branch main -L 3`, `gh pr list` and prod (`curl https://checkdecijfers.vercel.app/`) before acting on it.

## Where things stand

- **`main` live and green:** last code merge `19edcaee` (breadth step 2, CI 36430678653 green incl. deploy, prod 200).
- **Direction (owner, session 138, #335): BREADTH FIRST — any current CBS table answerable in the same chat.** Why: an
  owner sanity check measured no external users and 21 of 1,277 current CBS tables loaded. Read
  `docs/session-briefs/2026-09-28-sanity-check.md`, the spec `docs/superpowers/specs/2026-09-28-breadth-any-cbs-table-design.md`
  and ADR 062.
- **Step 1 ✅** (all 1,277 tables measured; reach ≈ 88%; scripts in `scripts/research/`). **Step 2 ✅** slice cache merged
  (`src/ingestion/slice-cache.ts`; migration 037 FILE-ONLY — the owner applies it with `npm run db:migrate` before step 5).
- **Step 3 (breakdown resolver) IN PROGRESS** on branch `breadth-step-3` (pushed), plan
  `docs/superpowers/plans/2026-09-28-breadth-step-3-breakdown-resolver.md`:
  - Task 1 ✅ `a358842e` — `CbsDimension.title` (reviewed, approved).
  - Task 2 BUILT, **task review NOT yet run** — `b46e8d7e` (`src/query/breakdowns.ts`, 32/32 tests, real CBS fixture
    `tests/fixtures/cbs-breakdowns/sample.json` + `scripts/research/extract-breakdown-samples.ts`). First action: dispatch
    its task review (spec + quality) against the plan's Task 2 + Global Constraints. The implementer flagged two points for
    that review: (a) the geo-like fixture case uses `86211NED/AlleRegioIndelingen` (the plan's `71476ned` example proved only
    3.3% region codes live); (b) a margins-classified dimension with no `Waarde` member asks instead of guessing (not
    explicit in the brief; follows principle c).
  - Task 3 (controller): reach check with `scripts/research/breakdown-reach.ts` against the crawl (expected: 1,363 of 1,785
    eligible breakdowns; 576 no-ask / 347 ask tables), full verify block, `/code-review` LOW, opus final review, merge.
    The measurement data is committed: `scripts/research/data/cbs-catalog-crawl-2026-09-28.jsonl.gz` (gunzip first) +
    `cbs-current-table-ids-2026-09-28.json`; re-crawl with `scripts/research/cbs-catalog-crawl.py` only if a fresh
    measurement is wanted.
- **Parked:** regional statistics Part 2 on branch `regional-stats-part2` (built + reviewed; only the paid re-record, merge
  and prod load remain). Part 1 (data layer) is on `main`; `70072ned` is NOT loaded in prod on purpose.
- **Spend:** $50 roof nearly used until **2026-10-01**; step 4 (table-scoped parser) needs a small recording then.

## Next, in order

1. Finish breadth step 3 (above), merge.
2. Plan + build step 4 (table-scoped parser: one closed-choice cheap-tier call per question against one table's schema;
   labelled eval set; recording after 10-01, owner-supervised).
3. Step 5 (orchestration + chat progress; prerequisites #336) — needs migration 037 applied by the owner.
4. Step 6 (table-lane benchmark → switch on). Then the standing recommendation: invite ~10 journalists.

## Standing constraints

Principles (a)/(b)/(c). No live DDL / real LLM spend / env flips without the owner. Never `gh secret set`, never
`spawn_task`. Repo is PUBLIC. Owner present: push directly (#118); autonomous: branch + PR, merged on a plain-English GO.
The owner doesn't read code; put every decision INSIDE the question box. Code pushes: `scripts/verify-block.sh` (detached) +
`/code-review` LOW (+ `npm run audit:verify` for validator/answer changes). Implementer briefs: foreground tests one at a
time (8 GB), **no `git stash`** (use `git show <sha>:<path>`), never edit an applied migration.

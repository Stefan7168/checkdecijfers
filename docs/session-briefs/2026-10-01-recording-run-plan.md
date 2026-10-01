# The 1 October recording run — one supervised session, three recordings (written session 145, 2026-09-29)

> **⚠ READ FIRST (2026-09-30, session 151, ADR [065](../decisions/065-retire-whole-table-copies-one-route.md)):** the owner decided to
> retire the whole-table copies. Part A (the any-table parser) fits that decision. **Part B loads one more whole table
> (`70072ned`) and part C builds on whole Eurostat datasets. Owner decision 2026-09-30: run part A ONLY; B and C are on
> hold until ADR 065 step 2's design says how they fit.** Everything below is unchanged and was written before that decision.

> **✅ PART A RAN 2026-10-01 (session 153, owner present).** Outcome differs from this plan in three ways: the cheap
> tier failed the calibration (26/50) and the parser moved to `claude-sonnet-5` (a measured escalation); the real cost was
> ~$4.24 in total (two Haiku runs, a Sonnet probe, two Sonnet runs) because billed tokens are ~2.5× the dry-run estimate;
> and five structural code fixes landed alongside. Gate PASSED on both Sonnet runs (12/14, 9/9, 0 invented), threshold 0.6.
> Details: ADR 062 "As built — recording + calibration". Parts B and C stay on hold. The flip waits for the owner's GO.

**Why this exists.** Three queued work items each need the AI once, to turn labelled questions into replayable
fixtures. All three waited for the monthly spend roof to start over (2026-10-01 00:00 UTC, $50 organisation
limit — RUNBOOK "Bill-shock protection", resolved 2026-09-26). This is the plan for running them back to back in
ONE owner-present session with no surprises: exact order, exact commands, what each step costs, what "pass"
means, and what to do when a step fails. Docs only — nothing here was run yet.

**Standing rules that apply.** Owner present for every live call (GO on the plain-English summary, no per-step
code review). Cheap tier only (Haiku 4.5: `INTENT_MODEL` in `src/answer/intent/client.ts`, `TABLE_PARSE_MODEL` in
`src/answer/table-parse/parse.ts`). No prompt byte changes beyond the ones listed in "Decisions" below. Full
verification block + `/code-review` LOW + green CI before every push. Zero live DDL except the regional prod load
(step B4, a data load through the existing sync, not a schema change).

## Cost basis (named, measured — never a components guess)

- **Per intent call: ~6.6K input tokens** (measured on the session-129 record run: 1,222,854 tokens / 186 calls —
  [lessons-learned](../lessons-learned.md), the "Rule going forward" entry).
- **Price basis: ~$1.02 per million Haiku input tokens**, derived from the same measured run
  (`intent:eval --repeat=3` ≈ 2.35M tokens ≈ $2.40 — [lessons-learned](../lessons-learned.md) item 5 of the
  session-130 entry). Output tokens are a small fraction (the parsers emit short JSON) and are ignored here; the
  estimates below are floors, budget them ×1.5.
- **Table parser: 114,136 input tokens for 39 cases, measured by the dry run on 2026-09-29** (`npm run
  tableparse:eval -- --dry-run`, session 145) — largest prompt 16,797 chars (~4.8K tokens).
- **Plus the table-lane benchmark (ADR 062 step 6, added 2026-09-30): 23 requests, 74,991 input tokens** (same dry
  run, measured 2026-09-30; largest 25,257 chars, ~7.2K tokens — table `37478hvv`, 102 measures). One record run is
  now 62 calls / ~189,127 tokens; the 39 labelled cases' bytes and count are unchanged.

| Recording | Calls | Tokens (floor) | Cost (floor) | Budget ×1.5 |
|---|---|---|---|---|
| A. Table parser + table-lane benchmark requests: 1 record + 1 replay (free) + 1 second record as stability | 62 + 62 | ~380K | ~$0.39 | $0.58 |
| B. Regional Part 2: intent 66 cases × (1 probe + 1 record + 3 stability) + clarify 7 + follow-up 24 legs + 1 onboarding-delivery call | ~360 | ~2.4M | ~$2.45 | $3.70 |
| C. Eurostat step 0: ~10 country questions × 2 (probe + record) | ~20 | ~130K | ~$0.15 | $0.25 |
| **Total** (B and C on hold since 2026-09-30 — A alone is ~$0.58 budgeted) | | **~2.9M** | **~$3.00** | **~$4.55** |

Well inside the $50 roof; leaves room for one full extra iteration of B (the expensive one) if a prompt fix is
needed. **If the roof is hit anyway** the API answers `400 … specified API usage limits` — every live question on
prod refuses too (the 2026-09-14 incident); stop, do not raise the limit yourself (owner account setting).

## Order and why

1. **A — table parser first.** Isolated: its fixtures (`tests/fixtures/llm/tableparse/`, a new directory) share no
   prompt with anything else, so nothing else can orphan them. Also the cheapest, so a wrong `.env` or a rate-limit
   surprise is found for cents.
2. **B — regional Part 2 second.** Re-records the intent/clarify/follow-up fixtures on the rebased branch. The
   registry additions (12 new canonical keys) change the intent prompt's vocabulary — that is WHY the re-record
   is needed, and why C must come after B: C measures the intent parser under the prompt that will be live.
3. **C — Eurostat step 0 last**, on `main` after B is merged: the probe must see the final prompt.

Each step ends with a push and green CI before the next starts — a failed step never contaminates the next.

## Pre-flight (session, before any live call — zero spend)

```
git status                       # clean, on main, fully pushed
npm run tableparse:eval -- --dry-run     # 39 cases ~114K + 23 benchmark requests ~75K = ~189K tokens (2026-09-30)
grep -c ANTHROPIC_API_KEY .env          # 1 — the MAIN key (the trial key is a separate, capped workspace)
```

Confirm in the Anthropic Console → Billing → Spend limits that the month has reset (spend ≈ $0 of $50). Do NOT
proceed on 2026-09-30 evening local time: the reset is 00:00 UTC on the 1st (02:00 CEST).

## Pre-flight already done for B (session 148, 2026-09-29, zero spend — re-run only if `main` moved a lot)

`regional-stats-part2` rebased onto that day's `main` in a throwaway branch: **no conflicts** (108 commits of drift, 6 of
its own), both typechecks clean. Full root suite on the rebased tree: **65 failed | 4480 passed | 169 skipped, all 65
downstream of intent-fixture hash misses** — `no recorded LLM fixture for this request` (the parse throws, the pipeline
refuses "internal", so the visible symptom is `expected 'refusal' to be 'answer'`) — across 19 files
(`tests/answer/*`, `tests/audit/*`, `tests/benchmark/scorer-teeth.test.ts`, `tests/invariants/invariants.test.ts`, and the
one the plan had missed, `tests/ingestion/onboarding-job.test.ts`). That is the expected shape; step B3 turns them
green. The throwaway branch was deleted; the real branch is untouched.

## A. Table parser recording + calibration (RUNBOOK "Table-parser recording run", #338, #339)

Precondition check: #339 items 1–4 are closed (step 4b, session 139); items 5+ in that row are watch items, not
blockers — re-read the row before starting, an open "changes prompt bytes" item means "do it first or re-record".

1. `npm run tableparse:eval -- --dry-run` — 39 cases + 23 `bench:` requests (62 calls, ~189K tokens), zero spend (sanity).
2. `TABLEPARSE_RECORD_OK=1 npm run tableparse:record` — the live run (~189K tokens: the 39 labelled cases, then the 23
   table-lane benchmark requests, recorded but not scored here; the last lines say `table-lane benchmark fixtures: 23/23
   recorded`). Writes
   `tests/fixtures/llm/tableparse/*.json` + `benchmark/tableparse-calibration-report.json`.
3. `npm run tableparse:eval -- --replay` — free; MUST reproduce the recorded scores byte-for-byte.
4. Stability (the script has `--dry-run` / `--replay` / `--record` only, no repeat flag — verified 2026-09-29):
   keep a copy of the first report, run `--record` a second time (~$0.19; it rewrites the fixtures), diff the two
   reports. **Pass:** zero flips on the accepted picks. Keep the second run's fixtures.
5. Read the report. **Pass gate:** every "answer" case picks the labelled measure/breakdown; every "refuse" and
   "ambiguous" case refuses (no fabricated pick); right-pick confidences sit clearly above wrong-pick confidences
   → set `DEFAULT_TABLE_PARSE_CONFIG.acceptThreshold` (#338) at a value with 0 wrong accepts on this set, the
   same procedure as `DEFAULT_MEASURE_FIT_CONFIG`'s 2026-07-10 calibration. **Fail:** a wrong pick accepted
   → fix the labelled set or the prompt (a prompt fix = re-run from step 2, ~$0.19), never loosen the label.
6. Add a CI replay test for the calibration set (the intent-eval precedent: replays the fixtures hermetically, fails on a
   missing one). The table-lane benchmark's CI replay test already exists (`tests/benchmark/tablelane-benchmark.test.ts`)
   and switches itself on the moment `tests/fixtures/llm/tableparse/` exists — run it locally before pushing.
7. Commit fixtures + report + threshold: `feat(table-parse): recorded fixtures + calibration (39 cases, prompt v3)`.
   Verification block, `/code-review` LOW, push, CI green. Record the measured numbers in STATUS, ADR 062 "As
   built — recording", #338.

Then step 6 of breadth (the table-lane benchmark) runs on these fixtures — **its harness is built (ADR 062 "As built —
step 6 (harness)")**, no further spend: `npm run tablelane:bench:run` (replay) then `npm run tablelane:bench:score`.
Gate: answer tasks ≥ 12 of 14, refuse + ask 9 of 9, invented numbers 0. **Known blocker found by its canned run:** the
"miljard" unit finding ([#339](../open-questions.md) item 14) fails L1–L3 until fixed — with it open, even perfect parses
score 11 of 14. The `TABLE_LANE_ENABLED` flip comes only after a passing score (then set `gate.enforcedInCi` to true in
`benchmark/tablelane-tasks.json`; RUNBOOK "Table lane").

**Right after the flip (owner decision 2026-09-30, session 152, #358 item 12):** evict the last hand-refreshed CBS table `37789ksz` — `npm run tables:evict -- --table 37789ksz` (dry run), then `--apply` with the owner. A welfare question then goes through the table lane like any other CBS table. After that no CBS table needs a hand sync; the whole-table path can be deleted once the Eurostat datasets are on the one route (#358 item 4) and `70072ned` is loaded as slices.

## B. Regional Part 2 recording + merge + prod load (plan Task 5, [#335](../open-questions.md), ADR 061)

Branch `regional-stats-part2` (6 commits ahead of `main` on 2026-09-29; 66 intent cases vs 56 on `main` — the 10 new
regional cases). Its replay tests are KNOWN RED until this step (fixtures keyed on the whole prompt hash).

1. `git fetch && git checkout regional-stats-part2 && git rebase main` — resolve conflicts (expect none in
   `benchmark/`, possibly in docs). `npm run typecheck` both roots.
2. **Probe first, cheap:** `npm run intent:eval` once live (~66 × 6.6K ≈ 440K tokens, ~$0.45). Read the failures:
   a failing NEW case = fix `everydayTerms`/`notes` in the registry entry, never loosen the expectation. Iterate the
   probe until the set is clean (each iteration ~$0.45).
3. **Record — FOUR scripts, not three (corrected session 148):** `npm run intent:record`, `npm run clarify:record`,
   `npm run followup:record` **and `npm run onboarding-delivery:record`** (one call, cents). The fourth embeds the same
   intent prompt; the pre-flight run below proved it goes red on the rebased branch
   (`tests/ingestion/onboarding-job.test.ts` → "the 37789ksz delivery parse ANSWERS…" got `unanswerable`), and
   [RUNBOOK](../RUNBOOK.md) "a prompt change needs" says the same (all four dirs). Delete the orphaned fixtures first —
   `git rm` the old `tests/fixtures/llm/{intent,clarify,followup,onboarding-delivery}/*.json` that the record does not
   rewrite; the session-130 lesson: orphans left behind make the hermetic gate pass by luck. After the delivery record,
   check its confidence stays ≥ 0.9 (#198). If the prompt text itself is edited (Decision 1's renames), bump
   `PROMPT_VERSION` first (RUNBOOK).
4. **Stability:** `npm run intent:eval -- --repeat=3` (~1.3M tokens, ~$1.35). **Pass:** all 66 pass, zero flips.
   A flip on an OLD case = a prompt regression → stop and diagnose before spending more.
5. Full `scripts/verify-block.sh` (benchmark 14/14 + 6/6 + 0 fabricated stays the gate), `/code-review` LOW, the
   final whole-branch review; merge to `main` (owner present → direct), push, CI green incl. deploy.
6. **Prod load (owner present; RUNBOOK "Regional statistics table `70072ned`"):** pre-flight query empty →
   `sync 70072ned` (expect ~106,683 rows, measured in the Part 1 throwaway sync) → `npm run registry:apply` →
   spot-check 3–5 cells against a fresh CBS fetch → one real question per surface in the browser (single region,
   region set, scatter chip). Then the live benchmark (#330).
7. Docs: STATUS, ADR 061 "As built — Part 2", build plan, #333(6), #334.

## C. Eurostat E2a step 0 — measure before building ([#313](../open-questions.md), spec §6 step 0)

On `main` after B. About ten real country questions under the UNCHANGED intent prompt ("werkloosheid in
Duitsland", "inflatie België vs Frankrijk", "EU-gemiddelde", "de eurozone", …): are foreign place names written
as typed, which `kind`, does the parser still pick the CBS measure key? Also: can the Eurostat adapter register a
filtered (country-only) slice (`npm run eurostat:siblings` dry run prints the request URLs — no spend).

1. Add the ~10 questions to the intent labelled set as NEW cases with the expected shape from spec §4 — **drafted in
   session 148: [2026-10-01-eurostat-step0-cases.json](2026-10-01-eurostat-step0-cases.json)** (6 labelled + 4
   `probe: true` observe-only cases; the file's `note` says how to copy them and how a label may be adjusted). The
   "can the adapter register a filtered slice" half of step 0 is ALREADY resolved (spec §4.1: branch
   `eurostat-server-filter`, merged) — only the ten parses remain.
2. `npm run intent:eval -- --only=<id-prefix>` live for those cases only (give the new cases one shared id
   prefix, e.g. `eurostat-`; `--only` exists, verified 2026-09-29; the report is not written for a subset run). **Pass:** names as typed, CBS key still picked, no prompt change needed → steps 1–4 of
   E2a stay as built, step 5 (register the three sibling tables) becomes the next owner step. **Fail:** the plan
   grows a prompt change + an owner-signed fixture re-record — a separate decision, not this session.
3. `npm run intent:record` for the new cases (they become hermetic benchmark tasks per spec §6 step 2); push.
4. Record the measured outcome in #313 and the E2a spec.

## Decisions for the owner, before the run (recommendation first)

1. **Prompt rename (ADR 064 "the model prompts").** Ten prompt files still introduce the model to
   "checkdecijfers.nl". Renaming a prompt orphans its fixtures. **Recommendation:** rename ONLY the two prompts
   whose fixtures this run records anyway — `src/answer/intent/prompt.ts` (re-recorded in B) and
   `src/answer/table-parse/parse.ts` (has no fixtures yet — free) — as the first commit of the session. Leave the
   other eight (compose on Sonnet, translate, meaning-check ×3 repeats, semantic-check, co-pilot, attachments,
   rerank, insights, onboarding-fit) for a later, separately budgeted full re-record: the model is never asked to
   write the brand into an answer, so a reader never sees the old name.
2. **Order A → B → C** as above (or skip C if the session runs long — it is independent and cheap).
3. **GO for ~$4.55 of spend** (the ×1.5 budget; part A alone ~$0.58 since B and C are on hold), plus up to one extra B
   iteration (~$2) if a prompt fix is needed.

## What can go wrong (and the answer)

- `400 specified API usage limits` → the roof; stop, owner checks Billing → Spend limits (never self-raise).
- Rate-limit `429` mid-record → the scripts retry; if a record ends partial, delete its partial fixtures and rerun
  that record command in full (fixtures are per case; a partial set fails the hermetic gate by design).
- A stability flip on an old intent case → prompt regression from the new vocabulary; diagnose with the
  "structural over word lists" rule (memory): change the mechanism, not the word list, after two rounds.
- The machine: 8 GB — run the verification block solo, never beside another vitest or the dev harness.
- `next build` rewrites `web/CLAUDE.md` — `git checkout -- web/CLAUDE.md` before every commit.

# Session 135 kickoff (written 2026-09-27 local, end of session 134)

Read order: `CLAUDE.md` → `docs/STATUS.md` top block → this file. Verify every claim here against `git log`,
`gh run list --branch main -L 3`, `gh pr list` and prod (`curl https://checkdecijfers.vercel.app/`) before acting on it.

## Where things stand

- **`main` is live and green** @ `c6d090e9` (docs-only after last code commit `156292fa`, deployed by tip run 36259837787, every job green
  incl. deploy). No open PRs, no worktrees.
- **English answers are LIVE** (`ENGLISH_ANSWERS_ENABLED=1` since 2026-09-26 ~18:00 UTC, owner GO). The meaning check C12 runs
  on Sonnet 5. Live check: audit row 336 verified. This is a live, money-path feature now: an English-interface reader's
  answer costs ≈€0.006 extra. Rollback = unset the flag + rerun the CURRENT tip's CI run (RUNBOOK "English answers" step 6).
- **The Anthropic "cap" was our own spend limit** (Console → Settings → Billing → "Spend limits"), now **$50/month**; ≈$11
  room left until it resets 2026-10-01. Real LLM spend is possible again but stays owner-supervised.
- **Live benchmark 2026-09-26: PASS** (14/14 + 6/6 + 0 fabricated, template fallbacks 4 — see #330).

## The single next priority (owner-chosen): regional statistics → region questions

Why: only 2 of 26 measures are regional (population `03759ned`, house price `83625NED`), and ADR 054's region-set query is
built but unreachable until #267 (the intent-parser step, real spend). The owner picked "regions first" over polish.

1. **First, retry CBS** ([#329](../open-questions.md)): on 2026-09-26 every CBS data API reset connections from this machine
   (`www.cbs.nl` was fine; last ingest 2026-09-16). `curl -s -o /dev/null -w '%{http_code}' https://datasets.cbs.nl/odata/v1/CBS/70072ned/Properties`.
   If it still fails, tell the owner and test another network before assuming a block.
2. **Then brainstorm → spec (architectural path)**: a regional-statistics set from ONE CBS table so all measures share one
   region roster and period axis. Candidate `70072ned` (Regionale kerncijfers Nederland, lowercase id on v4, ~325 columns).
   It was rejected in phase 0 (`docs/07-phase0-table-set.md`) for schema-fingerprint churn: each CBS revision parks the
   table as `needs_review`. Re-check live: column list, cell count vs the 500k sync cap (`src/ingestion/pipeline.ts`),
   GeoDimension kind, region groups (LD/PV/GM), revision cadence. Likely needs a registry slice to 8–12 headline measures.
   Research notes from session 134's (Sonnet-tier) agent: onboarding = `src/registry/defaults.ts` entries + English names
   (`english-names.data.ts`, coverage test) + CBS fixtures [code, zero spend]; `registry:apply` + `ingest` [live DB,
   owner-supervised]; `REGIONAL_KEYS`/`AVAILABLE_GRAINS` in `src/answer/intent/prompt.ts` change the parser vocabulary →
   intent fixtures re-record [LLM spend, owner-supervised] — bundle with #267.
3. Owner GO on the plain-English design summary before building. Zero-spend half first; the recording session is several
   dollars (probably after the 10-01 roof reset).

## Also open

- #328 English wording ("Pronounced bankruptcies of Companies and institutions" → hand override + lowercase mid-sentence).
- #330 R9 over-strictness in the live benchmark (3× exact quarter label, 1× intermediate dip).
- Owner decisions: #245, #275; own-data publishing signed-in spot-check (RUNBOOK ADR 057 step 4); Eurostat E2a steps 0/5/6
  (#313) and the other `:record` scripts are unblocked.

## Standing constraints

- Principles (a)/(b)/(c). No live DDL, real LLM spend or env-flag flips without the owner present. Never `gh secret set`.
  Never `spawn_task` (track follow-ups as open-questions rows). The repo is PUBLIC.
- Owner present: standing push authorization (CLAUDE.md #118). Autonomous: branch + PR, merged on the owner's plain-English
  GO. The owner does not read code.
- Code pushes: full verify block + `/code-review` LOW + (validator/R8 changes) `npm run audit:verify -- 1 <max id>` (rows
  exist up to 336 as of 2026-09-26). Compare the benchmark's informational counts (hermetic template fallbacks = 3).
- **Redeploying for an env flag:** rerun the run of `main`'s CURRENT tip, then confirm a new deployment with
  `vercel ls --prod`. Rerunning an older run skips its deploy and cancels the tip's run (session 134).
- 8 GB machine: run one vitest at a time, in the foreground (backend suite ≈14 min).

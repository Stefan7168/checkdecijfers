# Session 126 kickoff — checkdecijfers.nl / graphmaker.studio

Read `CLAUDE.md` first, then `docs/STATUS.md`'s top block (authoritative over anything below it, including
this file). Verify everything here against `git log` / `gh pr list` / `gh run list` before trusting it: this
file is a snapshot written 2026-09-23 at the close of session 125, not a live source.

## The short version

Everything from session 125 is merged to `main` and live (PRs #37–#44). **Eurostat in chat (slice E2a) is fully
built and staged but switched OFF**: the confirm chip, Dutch country names, source-aware wording, break-in-series
refusals (answers and chart editor), server-side filtered Eurostat downloads, and the three owner-approved topic
pairs (unemployment `une_rt_q`, inflation `prc_hicp_manr`, GDP growth `namq_10_gdp`) behind the env flag
`EUROSTAT_SIBLINGS_ENABLED`. Nothing a reader sees changes until the owner's steps below.

## What remains for E2a (all owner-supervised; do NOT do these autonomously)

1. **After the Anthropic API usage cap lifts on 2026-10-01 — step 0:** record the intent parse for ~10 real
   country questions under the unchanged prompt ("werkloosheid in Duitsland", "inflatie België vs Frankrijk",
   "EU-gemiddelde", "de eurozone", …). Small live AI spend → owner present. Confirms the parser writes foreign
   place names as typed and still picks the CBS key; also yields the ≥5 new Eurostat benchmark tasks (≥2 refusals,
   e.g. "werkloosheid in Japan"). If the parse is unreliable, the plan grows a prompt change + owner-signed
   fixture re-record.
2. **Step 5 (owner step, now mechanical):** `npm run eurostat:siblings` (dry run) → `npm run eurostat:siblings --
   --apply` → `npm run registry:apply` → the RUNBOOK's verification check. RUNBOOK section "E2a step 5". Live DB
   writes → owner present.
3. **Step 6 (the owner-signed flip):** the public wording sweep ("official sources", `/llms.txt`, the coverage
   disclosure, `/systeemoverzicht`, CLAUDE.md's public-claim line), the owner's sign-off on the three Dutch
   topic descriptions (marked **Assumption** in open-questions #313), the benchmark with the new tasks, then set
   `EUROSTAT_SIBLINGS_ENABLED=1` in Vercel and redeploy. Rollback = unset + redeploy. Never put the flag in the
   local `.env` (CLI/benchmark scripts load it).

## Binding constraints and owner steers (carried forward)

- **Owner: "I do not review code."** Never ask the owner to read diffs. Owner present → merge a verified, green
  PR yourself. Autonomous → branch + PR, and the hand-off asks for a GO on a plain-English summary. (CLAUDE.md,
  git workflow.)
- Full verification block (`scripts/verify-block.sh`, detached) + `/code-review` LOW before every code push; green
  CI is the gate. Before any docs-only push: `npx vitest run tests/docs`. One vitest process at a time on this
  8 GB machine — tell a second implementer to wait for `pgrep -f "node.*vitest"` to be empty.
- Live DDL, live DB writes, real LLM spend and env-flag flips stay owner-supervised.
- Cheapest mechanism first; plain full-sentence English for the owner; never call `spawn_task`; the repo is public
  ("Competitor G" only).
- Every new registry/measure entry needs a round-trip test through the real pipeline (session 125 lesson 6).

## Tracked, not the focus

- Owner steps still blocked on the API cap until 2026-10-01 (unchanged since sessions 110/111): registry:apply
  (now safe to run — unregistered sibling tables are skipped, not a blocker), DOI backfill, live benchmark,
  region-set Task 9, audit row 22, all `:record` real-model fixture confirmations.
- open-questions #315 ("Holland" tagged as a country now clarifies), #317 (conformance check reads Eurostat
  unfiltered — dormant).
- Dependabot PRs #33–#36; the stale, fully-merged worktree `chart-copilot-phase6` @ `58db5097` (owner's call to
  remove).
- [[feedback_architecture_over_polish]]: with E2a now owner-gated, the next architectural candidate from #306 is
  (b) two-measure charts (still HELD per #296) — ask the owner before starting it.

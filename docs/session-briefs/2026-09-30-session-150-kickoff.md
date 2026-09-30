# Session 150 kickoff (written 2026-09-30, end of session 150)

Read order: `CLAUDE.md` → `docs/STATUS.md` top block → this file → the plan it points to. Verify every claim against `git log`,
`gh run list --branch main -L 5`, `gh pr list` and prod (`curl -sI https://checkdecijfers.vercel.app/`) before acting.
This file **supersedes** [2026-09-30-session-149-kickoff.md](2026-09-30-session-149-kickoff.md); its "Standing constraints" and the
session-147/146 kickoffs' "Tracked, not the focus" sections still hold word for word.

## What session 150 did (verified 2026-09-30)

- Dogfooded the live SEO page against CBS's API: 6 of 8 card values match exactly. Freshness 0 of 20 behind. DNS for graphmaker.studio still absent.
- Owner-requested Eurostat data work = E2a step 5 for real: `eurostat:une_rt_q` (2,112 rows), `eurostat:prc_hicp_minr` (4,760),
  `eurostat:namq_10_gdp` (2,244) registered, pinned, synced in production, dark (`EUROSTAT_SIBLINGS_ENABLED` unset).
- Two defects found and fixed (commit `7517aa1b`): Eurostat months are `YYYY-MM` (adapter only knew `YYYY-Mnn`); the inflation pair's dataset
  `prc_hicp_manr` was frozen at 2025-12 → now `prc_hicp_minr` (`coicop18=TOTAL`). New guard: real captured responses in
  `tests/fixtures/eurostat-siblings/` + `tests/eurostat-adapter/sibling-real-responses.test.ts`. ADR 048 addendum, RUNBOOK, #313 updated.
- `registry:apply` (step 3) ABORTED, wrote nothing: `70072ned` (regional, in main's defaults) is not loaded in production. It follows the
  regional prod load (recording plan B6). Zero AI spend, no DDL.

## The single next priority (unchanged)

**On/after 2026-10-01 00:00 UTC, owner present:** run [2026-10-01-recording-run-plan.md](2026-10-01-recording-run-plan.md) — A table parser →
B regional Part 2 (four record scripts; B6 = `sync 70072ned` then `registry:apply`, which now also upserts the three Eurostat sibling
measures) → C Eurostat step 0 (cases in [2026-10-01-eurostat-step0-cases.json](2026-10-01-eurostat-step0-cases.json)). ~$4.35 of the $50 roof.
Pre-flight first (zero spend), then ONE dialog: the plan's three decisions + the GO, everything readable inside the dialog.

If a session starts BEFORE 2026-10-01 00:00 UTC: run `npm run ingest:freshness`, check DNS (`dig +short A graphmaker.studio`), then the free
Eurostat leftovers below — do not invent other work.

## Free Eurostat leftovers (no AI, owner present)

- `npm run backfill:eurostat-doi` (dry run) then `-- --apply`: `eurostat:tipsbd30` still has `doi = null` in production (RUNBOOK "DOI backfill").
- A Eurostat freshness check (the CBS report prints "Not checked: eurostat:tipsbd30"; ADR 048 addendum 2026-09-30 explains why: Eurostat
  retires datasets without notice). Cheapest first: extend `npm run ingest:freshness` read-only, using the response's `updated` field.
- Step 6 (the flip) and the public-wording sweep stay owner-signed and are NOT next.

## Watch item

First real e-mail from the new-CBS-data alert arrives when CBS next changes a served table (RUNBOOK "If the alert misbehaves").

## Standing constraints

Principles (a)/(b)/(c); full verification block (`scripts/verify-block.sh <dir> <log> --e2e`, solo on the 8 GB machine) + `/code-review` LOW +
green CI before any code push; no AI spend, no DDL without the owner; never `gh secret set`, never `spawn_task`; `git checkout -- web/CLAUDE.md`
before every commit; plain English, everything the owner must read goes INSIDE the question dialog. Live data syncs: one table at a time,
canary first, stop on failure. Launch deferred twice (#352): do not raise before 2026-10-27.

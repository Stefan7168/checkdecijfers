# Session 138 kickoff (written 2026-09-28 local, end of session 137)

Read order: `CLAUDE.md` → `docs/STATUS.md` top block → this file. Verify every claim against `git log`,
`gh run list --branch main -L 3`, `gh pr list` and prod (`curl https://checkdecijfers.vercel.app/`) before acting on it.

## Where things stand

- **`main` live and green**: last code `ad96af3c` (CI 36340666368 green incl. deploy), docs after it. No open PRs, no worktrees.
- **Live since session 137: two-measure charts** (ADR 060, #296): a zero-AI "Zet af tegen …" chip under a CBS region-set answer
  → an audited scatter (one dot per region). Only one pair today (population × average home price). Follow-ups #333.
- **Spend roof:** $50 monthly limit nearly used until **2026-10-01**. No live LLM runs before then unless the owner raises it.

## The single next priority: regional statistics (owner-chosen)

1. **Retry CBS first** (#329): `curl -s -o /dev/null -w '%{http_code}' https://datasets.cbs.nl/odata/v1/CBS/70072ned/Properties`
   (000 = still down, as at 01:35 local 09-28) and the "Technische storing" banner on www.cbs.nl. If still down: no paper
   design (owner steer) — size the next unblocked item for the owner in ONE question box (candidates: #333(1) cleaner region
   labels product-wide, #327, #299).
2. **If CBS is back: brainstorm → spec** for a regional-statistics set from ONE table (candidate `70072ned`): re-check columns,
   cell count vs the 500k sync cap, GeoDimension, region groups, revision cadence; the schema fingerprint covers ALL measure
   codes (slice issue). Every new `REGIONAL_KEYS` member automatically becomes a scatter pair — decide whether the chip then
   needs a small menu (#333(6)). Adding regional keys changes the intent vocabulary → one Haiku re-record (after 10-01).

## After 10-01 (owner-supervised, small spend)
Next live benchmark (confirms #330), #328 'Declared bankruptcies'.

## Standing constraints
Principles (a)/(b)/(c). No live DDL / real LLM spend / env flips without the owner. Never `gh secret set`, never `spawn_task`.
Repo is PUBLIC. Owner present: push directly (#118); autonomous: branch + PR, merged on a plain-English GO. The owner doesn't
read code; put every decision INSIDE the question box. Code pushes: `scripts/verify-block.sh` (detached) + `/code-review` LOW
(+ `npm run audit:verify` for validator/R8 changes). Browser checks: local harness (RUNBOOK, incl. the browser-pane login
trick). 8 GB machine: one vitest at a time; hard-link (not symlink) node_modules in a worktree before `next dev`.

# Session 154 kickoff (written 2026-10-02, at the session-153 wrap)

**Reading order:** CLAUDE.md → docs/STATUS.md top block (THE PLOT + "NEXT SESSION STARTS HERE") → this file. Verify every
fact below against `git log` / `gh run list` before trusting it.

## Where things stand (verified at wrap: `main` @ `1ef29d0c` + the wrap docs commit; every code commit green in CI incl. deploy;
prod `checkdecijfers.vercel.app` 200)

- **CBS any-table route: LIVE** since 2026-10-01 (`TABLE_LANE_ENABLED=1`, table-lane gate enforced in CI). Front door: tuning
  31/32, frozen held-out 27/30. Owner's live check passed (vans 9.517, 85245NED; the sentence now names what was counted).
- **Eurostat route: BUILT END TO END, DARK** behind `EUROSTAT_FINDER_ENABLED` (unset in production): catalogue finder + the
  Dutch → English bridge in the live finder (Dutch Eurostat questions top-5 8/12, shortlist 10/12), structure-read layouts with
  Dutch labels (reviewed list, `src/eurostat-adapter/dutch-labels.ts`), the job's per-table source, the reader recorded on
  Eurostat (calibration 15/17), its own table-lane benchmark set (`benchmark/tablelane-eurostat-*.json`; real model answers 6/6,
  0 invented, refuse/ask 5/6; gate NOT enforced in CI), every text next to an answer names the table's source (CBS byte-identical).
- AI spend session 153 ≈ $11.5 of the $50 monthly roof.

## The single next priority (owner present)

1. The owner reads and signs (or edits) the public-claim draft:
   [session-briefs/2026-10-02-eurostat-public-claim-sweep-draft.md](2026-10-02-eurostat-public-claim-sweep-draft.md) — 13 places
   with proposed wording + the prompt question (recommendation: change only the table-reader + rerank prompts, re-record CBS +
   Eurostat in one supervised run). Item 10 (source chips) needs a decision, not just text.
2. Then, in ONE change (ADR 048 D3(d), never before): apply the signed wording AND set `EUROSTAT_FINDER_ENABLED=1` in Vercel
   Production (owner-supervised env flip), then a live check with a handful of real Dutch Eurostat questions (e.g. road deaths in
   Poland 2023, municipal waste per inhabitant in Denmark 2022, asylum applications in France 2023) — compare each number with
   Eurostat's own site. Consider enforcing the Eurostat benchmark gate in CI only after a recorded run passes it fully.

## Binding constraints

- THE PLOT: the layer, never curating single tables (CLAUDE.md "Breadth comes from the layer").
- Principles (a)/(b)/(c); a fabricated number is the worst bug. Eurostat is never named publicly before it answers (D3).
- Live DDL, real LLM spend and env-flag flips stay owner-supervised. Owner-present: push to `main` directly after the full
  verification block + `/code-review` LOW + green CI (#118). Autonomous sessions: branch + PR.
- Model tiers by role: the session thinks; cheap tiers for fan-out legwork; the table reader is the mid tier (measured).

## Machine note

The machine is shared with the sibling project (Glaibaan), whose vitest agents block the verify block's machine-wide mutex.
Run `scripts/verify-block.sh` detached (`nohup … & disown`), wait on `=== DONE` in ≤30-min loops, rerun load timeouts solo
(RUNBOOK §verification, session-153 addition).

## Tracked, not the focus

- An EU-country question ("werkloosheid in Duitsland") can land confidently on a CBS table before the English bridge runs —
  measure first; a country-name cue routing to Eurostat is the candidate (#357).
- Front-door miss: household gas use per household (#362).
- #359: older audit rows no longer re-derive since the rebrand (in 296–346: 7 rows — 313, 315, 317, 319, 322, 323, 334 — two
  problems each; 41 rows over 1–336 per session 152) — pin as one documented divergence.
- E11 (SA vs SCA for GDP growth) and E7 (Bavaria → 'geen') are the two pinned Eurostat calibration misses.
- Dependabot PRs #51–#53 (web deps) open.

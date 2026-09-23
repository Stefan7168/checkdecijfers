# Session 127 kickoff — checkdecijfers.nl / graphmaker.studio

Read `CLAUDE.md` first, then `docs/STATUS.md`'s top block (authoritative over anything below it, including
this file). Verify everything here against `git log`, the GitHub PR list and the Actions runs before trusting it:
this file is a snapshot written 2026-09-23 at the close of session 126, not a live source.

## The short version

- **Own-data parity phase A is live** (PR #45, `4dcdbd1`): the own-data chart card has small multiples and a CSV
  download with the formula-injection defense ADR 037 D11 asked for. A same-session follow-up (branch
  `claude/session-126-kickoff-o0w2lk`) hides the own-data image download where there is no chart to export and
  passes it the chart's language and frame. Check whether that follow-up PR is merged; if not, it waits on the
  owner's GO.
- **Eurostat in chat (E2a) is built, staged and switched OFF**, unchanged since session 125.

## The single next priority: owner decisions on own-data parity phase B (#318)

Spec: `docs/superpowers/specs/2026-09-23-own-data-parity-design.md` §4.
- **B1 — publish an own-data chart (embed link / gallery).** Ask the owner. Recommendation: yes, opt-in per chart,
  snapshot the plotted points only (never the raw file), a visible "unverified, your own data" frame on the public
  page, and the link dies on file delete or the 2-year retention purge (GDPR, #189). Likely needs a migration (a
  turn-keyed embed token) → live DDL is owner-supervised. Write an ADR before building.
- **B2 — own data + CBS in one chart.** Reverses ADR 037's locked "never for v1"; needs its own brainstorm + ADR.
  Recommendation: wait for usage evidence.

## Owner-supervised, blocked until the API cap lifts on 2026-10-01

- E2a step 0 (record ~10 real country-question parses), step 5 (`npm run eurostat:siblings` → `-- --apply` →
  `npm run registry:apply`, RUNBOOK "E2a step 5"), step 6 (public wording sweep, owner sign-off on the three Dutch
  topic descriptions in #313, benchmark, `EUROSTAT_SIBLINGS_ENABLED=1` in Vercel + redeploy; never in local `.env`).
- Pending since sessions 110/111: registry:apply, DOI backfill, live benchmark, region-set Task 9, audit row 22,
  all `:record` real-model fixture confirmations.

## Binding constraints and owner steers

- **Owner: "I do not review code."** Never ask the owner to read diffs; give a plain-English summary and ask for GO.
- **Merging (new, session 126):** a self-merge via the GitHub tool tripped the auto-mode classifier after it
  succeeded ("Merge Without Review"), blocking even read-only follow-ups. Get an explicit in-chat "merge it" before
  the merge call (RUNBOOK). Never work around a classifier denial.
- Full verification block (`scripts/verify-block.sh`, detached) + `/code-review` LOW before every code push
  (`git add -N` new files first, or the review skips them); green CI is the gate. Docs-only push: `npx vitest run
  tests/docs` first. One vitest process at a time.
- Delegation briefs for a mechanism an ADR names: grep the ADR's decision id across `docs/` and quote the earlier
  spec in the brief (session 126 lesson 1).
- Live DDL, live DB writes, real LLM spend and env-flag flips stay owner-supervised. Cheapest mechanism first.
- Cloud container: prod URL is blocked by egress policy; use the deploy job's post-deploy smoke step as evidence.

## Tracked, not the focus

- #315 ("Holland" clarifies), #317 (conformance check reads Eurostat unfiltered — dormant).
- Dependabot PRs #33–#36; the stale, fully-merged worktree `chart-copilot-phase6` @ `58db5097` (owner's call).
- #306 (b) two-measure charts, still HELD per #296 — ask the owner before starting.

# Session 118 kickoff — checkdecijfers.nl / graphmaker.studio

Read `CLAUDE.md` first, then `docs/STATUS.md`'s top block (authoritative over anything below it).
Verify everything below against `git log` and the SDD ledger before trusting it.

## The short version — THIS SESSION RESUMES AN UNFINISHED BUILD, IT DOES NOT START FRESH

Session 117 (2026-09-19/20, owner present throughout — chose "phase 5b" when offered a choice against
the house-styles alternative, then delegated fully: "You are the expert. Just do whatever you think is
best, work autonomously") designed **chart co-pilot phase 5b — the "verified whole"** (pie/stacked/
100%-stacked charts, region-hierarchy scope) and built 4 of 5 planned tasks via subagent-driven
development, then was asked to wrap up before Task 4's fix round, Task 5, or the final whole-branch
review. **`main` is UNCHANGED — still at the phase 5b PLAN commit (`a02b148a`, docs only).** All real
code lives on branch `verified-whole-phase5b`, worktree `/Users/amity/Documents/cdc-wt-verified-whole-phase5b`
— both left in place. **Do not re-plan or re-brainstorm this. Read the SDD ledger first and resume it.**

## Your very first action

Read `/Users/amity/Documents/Check de Cijfers/.superpowers/sdd/2026-09-19-verified-whole-phase5b/progress.md`
(in the MAIN checkout, not the worktree) in full. It has the exact task/round state, every ruling made
so far, and the precise next action. The plan file it resumes is
`docs/superpowers/plans/2026-09-19-verified-whole-phase5b.md`; the design it argues from is
`docs/superpowers/specs/2026-09-17-chart-copilot-design.md` §11.

## What's already done and reviewed clean (do not re-open these)

1. **Task 1** (`6dc0dd78`) — `src/query/whole-verification.ts`: `parentCellRef`/`verifyPartsSumToWhole`,
   pure on-demand sum-verification logic. Found the real `RegionScope` type has FOUR variants (the plan
   assumed three) — `all_gemeenten` correctly refuses (CBS's own municipality grouping excludes a real
   code, `GM0997`/`OVERIG`, so it doesn't provably partition the national total — see
   [#299](../open-questions.md)).
2. **Task 2** (`4d834f0c`) — `ChartSpec.regionScope: RegionScope | null`, a new optional-v1 field (ADR
   014's pattern), always emitted by `buildChartSpec`, with the matching `reconstruct.ts` tolerance
   entry, tested in both directions on real hermetic-DB rows.
3. **Task 3** (`9cdbb4ff`) — the three `ChartForm` guards (`pieFormAllowed`/`stackedFormAllowed`/
   `stacked100FormAllowed`), a `pieHole` presentation key (donut is styling, never a fourth form), scorer
   wiring. A genuine provenance-not-codes contract test proves the guards check `regionScope`, not
   code-list equality.

## What's built but NOT yet complete — resume here

**Task 4** (`5eed921a`) — `web/app/chart-whole-verification-actions.ts` (the on-demand server action,
built to accept an authenticated audit-record id rather than the plan's own literal client-supplied-spec
signature — a real, reviewer-confirmed security improvement, see below) + native Recharts pie/stacked/
100%-stacked rendering in `chart.tsx`. **Reviewed with 0 Critical, 2 OPEN Important findings, no fix
round dispatched yet:**

1. `buildStack100Rows`'s negative/zero-total omission path (`chart.tsx` ~1899-1904) has zero test
   coverage — the exact boundary the "excluded before any division" honesty guarantee depends on.
2. The "omitted period" refusal copy (`chart.whole.omittedPeriods`) is reused for two different
   situations — a real server refusal AND a verified-but-zero/negative-total period — and is factually
   imprecise for the second case ("the CBS total is missing or does not match" when it's actually present
   and matches; the share is simply undefined).

**Per the SDD skill's own process: this is a fix-loop round 1, not a fresh task.** Resume the original
implementer conceptually (a fresh subagent in a new session can't literally resume the old agent id, but
carry the brief path, the report-file path at
`.superpowers/sdd/2026-09-19-verified-whole-phase5b/task-4-report.md`, and both findings verbatim,
framed as "read the report file for what was already built and tested, then fix these two specific
findings"). After the fix, dispatch a SCOPED re-review (not a fresh full review) per the skill's own
re-review template. Only once that's clean does Task 4 count complete.

## Then: Task 5 and the final review

Task 5 (chat-doorway wiring — including the `src/chart/copilot/prompt.ts` form-list + version bump,
planned as its own step this time rather than found late — plus contract/property/e2e coverage) has not
been dispatched. After it's reviewed clean, run the final whole-branch review on the most capable
available model — this project's repeated lesson is that this is where cross-task defects surface (phase
4: 1 Critical + 10 Important; phase 5: 2 Important; this phase's own Task 4 review already found a
security question worth taking seriously at the final review too, even though it resolved correctly).

## Two things worth reading before you touch any of this code

1. **A plan's own reading of a union/enum type, written from code that narrows over it rather than the
   type's own declaration, is a floor, not a ceiling.** This is now the SECOND session running to hit
   exactly this class of gap (session 116 hit the equivalent for `ChartForm` narrowing sites; session 117
   hit it for `RegionScope`). Any future plan built from partial reads of a large codebase should budget
   for the first task touching a shared type to re-derive it from the real declaration, not trust the
   plan's own paraphrase.
2. **The server action's security design is stronger than what was literally asked for, and correctly
   so.** The plan's brief specified `requestWholeVerification(spec: ChartSpec, periodCodes)`. The
   implementer built `requestWholeVerification(auditKey, periodCodes)` instead — reasoning that a
   client-supplied spec would let a fabricated spec make the server report a false "verified" for numbers
   never actually checked. The task reviewer independently re-derived the same conclusion from the code's
   real execution order, not the report's framing, and confirmed it's the right call. If you touch this
   action again, preserve this signature — do not "fix" it back to match the plan's literal text.

## Binding constraints and owner steers (carried forward, still true)

- Cheapest mechanism first; plain full-sentence Dutch or English for the owner; no shorthand.
- Git: owner-present → push to `main` after the full verification block; autonomous → branch + PR
  ([#118](../open-questions.md)). Migrations file-only; live DDL, real LLM spend, env flags stay
  owner-supervised. The repo is public: "Competitor G" only, never the real name.
- Tier rule: session model thinks; implementers on a cheaper tier (Fable, per the owner's standing steer
  this phase — confirm it still stands if a new session starts, since it was given in-chat); the
  whole-branch final review on the most capable tier.
- Worktree mechanics: this worktree already has REAL (not symlinked) `node_modules` at both root and
  `web/`, set up from the start this time (a session 116 lesson) — do not re-symlink it. When eventually
  removing a worktree, if `git worktree remove` is refused, SHOW the owner what's at stake before using
  `--force` (session 116 skipped that check once, safely but wrongly — don't repeat the skip).
- `ChartForm` is a widely-narrowed shared type. Grep the whole repo for every existing narrowing site
  before calling a type-widening task done, and run the FULL (non-scoped) typecheck plus `next build`.
- Recharts-specific: `<ReferenceLine>`/`<ReferenceArea>` must be direct JSX children, never wrapped in a
  custom component. For custom-positioned marks, prefer the `EndLabelsOverlay`/`DumbbellOverlay` hook
  pattern over inventing a new mechanism. Verify any Recharts-internals claim against the actual installed
  source before relying on it.
- No number is ever drawn that isn't a real fetched cell's own value, or pure arithmetic over
  already-verified reals. This is the one invariant every task in this phase is built around — hold any
  fix or addition to the exact same bar.

## Tracked, not the focus

[#289](../open-questions.md)–[#299](../open-questions.md) (phase 4/5/5b residuals, all deliberately
deferred, not silently dropped); [#275](../open-questions.md) (the six house styles + homepage themes
row — the owner's other standing candidate, not chosen this session but still live); rebrand to
graphmaker.studio ([#7](../open-questions.md)).

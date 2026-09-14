# Session 101 continued — kickoff (written 2026-09-13, wrap-up ~13:41 UTC)

Saved verbatim so the handoff survives a clean 0%-context restart. Paste the block below as the
opening message of the next session.

---

You're continuing checkdecijfers.nl. Read in this order: `CLAUDE.md` → `docs/STATUS.md` (top
block first — it's authoritative) → `docs/08-build-plan.md` → this brief. Don't re-derive anything
below from memory; it's already verified as of this wrap-up.

## Two open actions, both the owner's to take

**1. Merge PR #21** (R3 confirm-first onboarding fetch, reverses
[open-questions #109](../open-questions.md)). Re-verified at wrap-up:
`mergeStateStatus: CLEAN`/`mergeable: MERGEABLE`, CI run `34750329451` green. Nothing else is
blocking it. Per the money-path rule ([#118](../open-questions.md)), it always needs branch + PR +
explicit owner go — never merge it yourself even if asked to "just push," without that explicit
go on the merge itself, even in an owner-present session.

**2. Continue (or redirect) the Pro subscription tier build** ([#205](../open-questions.md)). The
owner approved a real recurring-billing design (reverses ADR 006/020's "no subscription"
decision) and a 13-task implementation plan, both committed to `main`:
- Design: [superpowers/specs/2026-09-13-pro-subscription-tier-design.md](../superpowers/specs/2026-09-13-pro-subscription-tier-design.md)
- Plan: [superpowers/plans/2026-09-13-pro-subscription-tier.md](../superpowers/plans/2026-09-13-pro-subscription-tier.md)

Build is running via **subagent-driven-development** (one implementer subagent per task,
sequential, task review after each) on a **kept git worktree**:
`.claude/worktrees/pro-subscription-tier` (branch `worktree-pro-subscription-tier`) — **not
pushed to origin, not merged.** **Tasks 1-3 of 13 are complete and reviewed clean. Task 4 (wiring
`reserveDebit`/`chargeAndRun` — the actual production hot path) is DONE and tested (commit
`9c7dd75`, full backend suite 151 files/2304 tests green) but NOT YET REVIEWED** — paused here for
this wrap-up, a deliberately safe resumption point.

**To resume:** invoke the `superpowers:subagent-driven-development` skill again pointed at the
plan file, or just read the ledger directly first:
`.claude/worktrees/pro-subscription-tier/.superpowers/sdd/2026-09-13-pro-subscription-tier/progress.md`
— it has every task's status, every ruling made (with reasoning and cost-if-wrong), and the exact
next step: generate Task 4's review package (`review-package` script, base `c99364c`, head
`9c7dd75`) and dispatch its task reviewer, then proceed to Task 5 onward. Do NOT re-dispatch Tasks
1-3 — the ledger's `Task N: complete` lines are the source of truth on what's actually done, trust
`git log` in the worktree over any recollection.

**Design decisions already made and NOT to re-litigate:** scope = Live embeds + a monthly credit
allowance (not unlimited chat); price = €19.99/month, 1000 credits/period; the allowance resets,
unused lost (isolated in its own ledger table, `pro_bucket_ledger`, specifically so this exception
can never leak into permanent/purchased credits — do not "simplify" this back to a shared-balance
clawback, a concrete fairness bug was traced through and rejected during the brainstorm); access
continues to `current_period_end` on cancel/failed payment; ships flag-gated off
(`PRO_SUBSCRIPTIONS_ENABLED`) — no real Stripe product, no real charge, until the owner explicitly
flips that flag later, separate from this build. Onboarding is deliberately EXCLUDED from
bucket-eligibility (Task 5, already done) — don't revisit that either without a real reason.

**When all 13 tasks are done and the final whole-branch review is clean:** push the branch, open a
PR (title/body per the plan's own Task 13 Step 6), and STOP — do not merge. That's the owner's
explicit go, same as PR #21.

## Also shipped this session, live in production, no action needed

ADR [047](../decisions/047-repositioning-embedded-sourced-chart.md) (repositioning direction,
formalized); sidebar tap-target fix ([#238](../open-questions.md)); [#245](../open-questions.md)
actions 1+2 — test-DB boot perf fix AND CI 3-way sharding, both built and verified via real CI +
deploy (one real bug found and fixed live on the sharding push — see
[status-archive.md](../status-archive.md)'s top entry for the full account); Dependabot #16/#17
merged (zero open Dependabot PRs now); README.md's stale "ADRs 001–009" pointer corrected (the
owner wants a Claude-Design slide deck built from current docs — README/vision/roadmap/ADR 047
are now current, checked this session).

## Standing constraints (don't relearn these the hard way)

- **Git workflow ([#118](../open-questions.md)):** owner-present session → push/merge directly for
  non-money-path work, no per-change approval needed. R3/money-path code (PR #21, the whole Pro
  subscription tier) is the standing exception: always branch + PR + explicit owner go, regardless
  of who's in the chat.
- **Full verification block before any code push:** typechecks + all suites + benchmark
  14/14+6/6+0 fabricated + a real build; `audit:verify` on validator changes; `/code-review` LOW
  over the diff. Docs-only pushes are exempt (no code diff) and skip CI (paths-ignore).
- **A backgrounded `vitest run` inside a subagent's sandbox can be silently killed mid-run with no
  error surfaced** — cost ~20 minutes of apparent hang on Task 1 of the Pro-plan build before
  being caught. Run final pre-commit verification in the foreground in every subagent dispatch.
- **The "CI queued 30min+" symptom is NOT exclusive to the private-repo Actions-minutes cause** —
  seen on this repo confirmed PUBLIC too (ordinary runner-pool variance). The fix (a fresh commit)
  is the same either way — don't spend time diagnosing which cause it is.
- **Model tiers for subagent dispatch:** the session's own model does scoping/briefs/synthesis/
  final review; mechanical/well-specified implementation tasks can run on a cheap tier (haiku);
  judgment/integration tasks (touching the billing hot path, reviewing money-path diffs) want a
  standard tier (sonnet) at minimum.

## Owner steps still open (carried forward, untouched this session, not blocking each other)

`npm run db:migrate` for migrations 028+029 then `npm run usage:report`; the trust-page contact
e-mail (leave the placeholder for now, owner's call); set `EMBED_TOKEN_SECRET` in Vercel + the
`auth.users` read check (RUNBOOK) for Live embeds.

## End of session checklist

Before you wrap up, re-run the CLAUDE.md "Session wrap-up" ritual in full (8 items, Golden Rule
fact-verification, reproduce the checklist with ✅/⏭️ marks).

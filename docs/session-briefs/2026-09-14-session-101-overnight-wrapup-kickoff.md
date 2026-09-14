# Session 101 continued overnight — wrap-up kickoff (written 2026-09-14, wrap-up ~16:30 UTC)

Saved verbatim so the handoff survives a clean 0%-context restart. Paste the block below as the
opening message of the next session.

---

You're continuing checkdecijfers.nl. Read in this order: `CLAUDE.md` → `docs/STATUS.md` (top
block first — it's authoritative) → `docs/08-build-plan.md` → this brief. Don't re-derive anything
below from memory; it's already verified as of this wrap-up.

## Two open actions, both the owner's to take — nothing else is blocking either

**1. Merge PR #21** (R3 confirm-first onboarding fetch, reverses
[open-questions #109](../open-questions.md)). Re-verified at this wrap-up:
`mergeStateStatus: CLEAN`/`mergeable: MERGEABLE`, CI green. Unrelated to tonight's work — this has
been ready since session 101's owner-present portion, before the owner went to sleep.

**2. Merge PR #22 — the Pro subscription tier** ([#205](../open-questions.md)). Built end-to-end
overnight, autonomously, on the kept worktree `.claude/worktrees/pro-subscription-tier`
(branch `worktree-pro-subscription-tier`). All 13 tasks of the owner-approved plan done, each
individually reviewed (several through 1-2 real fix rounds after genuine money-path bugs were
found — see below), plus a final whole-branch review that caught 3 more cross-task-invisible
issues, all fixed and re-verified. **Verify live before trusting this line** (mergeability can
drift if `main` moves again): `gh pr view 22 --json mergeable,mergeStateStatus`.

**Real bugs found and fixed along the way, every one caught only by actually running code against
a real migrated database, never by reading a diff alone** (full detail in
[status-archive.md](../status-archive.md)'s "Session 101 continued overnight" entry and the SDD
ledger at
`.claude/worktrees/pro-subscription-tier/.superpowers/sdd/2026-09-13-pro-subscription-tier/progress.md`):
a cross-ledger double-charge bug in the core debit path; the identical bug class pre-empted in the
plan text itself before an implementer touched it; two separate Stripe API shape bugs
(`Subscription.current_period_end`, `Invoice.subscription` — each would have silently broken the
feature in production despite every test passing); two atomicity gaps, both now transactional; a
missing try/catch that would have left the Upgrade button stuck on a Stripe outage; and, from the
final review specifically, a real cross-seam bug in the PRE-EXISTING credit-pack webhook handler
(a Pro signup's checkout event would have thrown and retried for ~3 days) plus a backwards
migrate/deploy order in the go-live RUNBOOK checklist that would have caused a total outage for
every user.

**Merging PR #22 does NOT turn anything on for real users.** `PRO_SUBSCRIPTIONS_ENABLED` stays
unset until the owner separately works through [RUNBOOK.md](../RUNBOOK.md)'s "Pro subscription
go-live" checklist (migration 030 applied FIRST — before deploy, this order is not optional — then
the real Stripe Price object, `STRIPE_PRO_PRICE_ID`, the webhook subscription, then the flag).

## Also shipped this session, live in production, no action needed

The chart visual + embed pass: a softer default chart chrome (rounded corners + soft shadow
instead of literally none), two new chart templates (Warm/Earth), and a live chart preview in the
embed dialog — merged straight to `main` (not money-path). Full detail:
[open-questions #243](../open-questions.md). One flagged-not-fixed residual: the embed preview
shows a reader's live on-screen state but the actual `/embed/[token]` URL doesn't encode
style/zoom/hidden-series overrides — an owner product decision, not a bug.

## Standing constraints (don't relearn these the hard way)

- **Git workflow ([#118](../open-questions.md)):** owner-present/owner-authorized session →
  push/merge directly for non-money-path work. R3/money-path code (both PR #21 and PR #22) is the
  standing exception: always branch + PR + explicit owner go, regardless of who's in the chat or
  whether the session is autonomous.
- **A dispatched subagent can overstep its assigned scope** — this happened once tonight (an
  implementer pushed a branch and opened a PR on its own initiative, before its own task review
  had even run). Say explicitly in a dispatch prompt what a subagent must NOT do (push, merge,
  open a PR) whenever that boundary matters, especially on a plan's last task.
- **A plan document's own illustrative code samples go stale the moment a fix round corrects the
  real implementation away from them** — happened 3 times this build with the same root cause
  before it was addressed as a pattern. When a fix round changes real code away from what a plan
  illustrates, grep that SAME plan document for every other copy of the stale illustration in the
  same pass — `docs/superpowers/plans/*.md` needs the same doc-freshness discipline as `docs/`
  proper, since `task-brief` extracts straight from the plan text.
- **This repo's own docs convention is bare `PR #NN`, never a live markdown link**
  ([#132](../open-questions.md), enforced by `tests/docs/doc-conventions.test.ts`) — the opposite
  of ordinary chat-formatting habit. Write it on reflex, not as something to fix afterward.
- **A long-running full test suite can fail with TIMEOUTS from pure system resource contention**,
  including orphaned processes from an already-removed worktree. A suspicious full-suite failure
  that's specifically timeouts (not wrong-value assertions) is worth a `ps aux | grep node` check
  before treating it as a real regression.

## Owner steps still open, carried forward, not blocking each other

`npm run db:migrate` for migrations 028+029 then `npm run usage:report`; the trust-page contact
e-mail; set `EMBED_TOKEN_SECRET` in Vercel + the `auth.users` read check (RUNBOOK) for Live embeds
to actually activate (separate from, and a prerequisite alongside, the Pro-tier go-live above).

## What's next

No further build priority is queued. Both pieces of pre-approved overnight work are done — the
next session's job is whatever the owner decides after reviewing PR #21 and PR #22, not something
to guess or invent. If the owner hasn't yet weighed in when a fresh session starts, the right move
is to ask what they'd like next, not to pick a new work package unprompted.

## End of session checklist

This wrap-up ran the full CLAUDE.md "Session wrap-up" ritual (8 items, Golden Rule fact-
verification, reproduced with ✅/⏭️ marks in the session transcript).

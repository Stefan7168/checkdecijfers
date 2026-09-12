# Session 97 (continued) handoff — PR #14 already covers the Journey programme (written 2026-09-12, owner present)

Read in this order: [CLAUDE.md](../../CLAUDE.md) → [STATUS.md](../STATUS.md) top block → this file →
[08-build-plan.md § Journey programme](../08-build-plan.md) → [PR #14 itself](https://github.com/Stefan7168/checkdecijfers/pull/14)
(read its body in full — it is the actual spec of what shipped).

## The one correction that matters

The prior kickoff ([session-briefs/2026-09-11-session-97-kickoff.md](2026-09-11-session-97-kickoff.md)) told a fresh
session to build Journey-programme phase 0, then phase 1. **Don't.** A sibling session already built phases
0/1/3/4/5 — the whole programme except the money-path item — and shipped it as **PR #14**, open since
2026-09-11T18:15 UTC, CI green (`gate`: success), `mergeable_state: clean`, **zero reviews, zero comments**. Verified
against live GitHub state on 2026-09-12, not from memory: `mcp__github__pull_request_read` (`get`, `get_check_runs`,
`get_reviews`, `get_comments`).

This session (the one continuing from the 2026-09-11 kickoff, before discovering PR #14) independently built two of
PR #14's phase-5 items anyway — the composer chip collapse (R8) and the phone-width header relocation (R9) — on
branch `journey-programme-v1` (commit `0961665`). That work is fully verified (web 1425/1425, backend 2211/2211,
both typechecks, real build) but **not opened as a PR** — PR #14's version of the same two features is more
thoroughly reviewed (Opus whole-branch pass + partial real-browser testing) and is the one that should proceed.
`journey-programme-v1` is safe to delete.

## Where things stand (verified 2026-09-12)

- **PR #14** — 51 files, +3567/−264, 22 commits. Delivers, per its own body: Phase 0 (`npm run usage:report`,
  aggregates-only), Phase 1 (chip captions, `/credits` link + pack name in the low-balance message, amber price
  line, purchase-poll instead of "refresh", `/credits` page maths + explainer), Phase 3 (collapsed sources
  disclosure, Ontdek caption, "Publiceer" landing step, Style panel opens on Sjablonen when untweaked, anonymous
  Insights line), Phase 4 (`/werkwijze` + `/privacy` as visibly-marked drafts), Phase 5 (one-click clarification
  options, the R8 chip collapse, the R9 phone header). **Deliberately excluded:** Phase 2 / R3 (money path — needs
  an explicit owner go), the larger signup grant, applying migration 028, the audit re-run.
- **Not yet real-browser-verified** (PR #14's own body says so): chat chips/captions, the credits page, the
  purchase poll, the phone header, one-click options — all unit-tested only, since they need a login.
- **PR #9 (embed)** — still open, `MERGEABLE`/`CLEAN`, head `6f80459` (STATUS.md previously had a stale SHA,
  `d427cdd` — corrected this session).
- Owner steps PR #14 itself asks for on merge: read `/werkwijze` + `/privacy`, fill in the contact e-mail (legal
  read on the privacy text advised); `npm run db:migrate` for 028+029, then `npm run usage:report`; say go/no on R3.

## The single next priority

**Get PR #14 reviewed and merged.** Concretely:
1. Read the PR body and diff. Check its "not yet real-browser-verified" list in an actual browser (light + dark,
   desktop + a phone width) — that is real, not-yet-closed risk on a PR about to ship copy and interaction changes.
2. If the owner is present: walk `/werkwijze` and `/privacy` together, decide the contact e-mail, decide R3 (build
   it as its own branch + PR + explicit go, or defer).
3. Once satisfied, merge PR #14, then do the three owner steps in its body.
4. Delete `journey-programme-v1` (redundant) and, once PR #14 is merged, `journey-programme` too, following this
   repo's normal post-merge branch cleanup.
5. Phase 6 (re-measure) waits until real usage accumulates post-merge — don't rush it.

## Binding constraints / owner steers (unchanged from the prior kickoff)

- Cheapest mechanism first: no AI call, no new library, no schema change anywhere in the journey programme.
- Never name a data source publicly before it answers questions (principle c). Eurostat is "coming", not "in".
- Plain English for the owner. No shorthand, no R-codes without the sentence.
- R3 (confirm before a 100-credit fetch) always needs branch + PR + an explicit owner go — never build on spec alone.

## Process lesson this correction exists because of

Before starting ANY autonomous, plan-driven build task — even one the owner just asked for in chat — check for
existing open PRs and sibling-session work on the same plan first (`mcp__github__list_pull_requests`, `STATUS.md`'s
own top block, and `mcp__Claude_Code_Remote__list_sessions` if a named session is in play). This session skipped
that check and built real, tested, wasted-effort duplicate work as a result. Full account in
[lessons-learned.md](../lessons-learned.md) (session 97) and [status-archive.md](../status-archive.md).

## Tracked but not the focus

- The repositioning ADR + roadmap re-phasing ([#237](../open-questions.md)) — needs the owner in the chat.
- The [#205](../open-questions.md) Pro-plan brainstorm (live embeds = the Pro reason) — needs the owner.
- Eurostat as source two — its own WP through the WP30 narrow waist, after the journey phases.
- STATUS.md known debt: session blocks 92→96 still not archived per convention.

## Model tiers

Session model thinks; implementers and reviewers on cheaper tiers per role; a whole-branch review on a strong tier
before "done" (PR #14 already had this — an Opus whole-branch review). Report which tier did what.

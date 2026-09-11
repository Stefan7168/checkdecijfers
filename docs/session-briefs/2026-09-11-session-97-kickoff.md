# Session 97 kickoff (written 2026-09-11, session 96, owner present)

> **SUPERSEDED.** [session-97-journey-programme-kickoff.md](2026-09-11-session-97-journey-programme-kickoff.md)
> (written later the same day, after the owner gave an explicit "work for hours, move the project big
> steps" mandate) is the current, more specific starting point for this same Journey-programme work —
> phase-by-phase, with the phase-2/R3 money-path exclusion spelled out and a "go big from the start" note.
> This file's own reading order and context are still accurate background, just not the live entry point.

Read in this order: [CLAUDE.md](../../CLAUDE.md) → [STATUS.md](../STATUS.md) top block → [08-build-plan.md § Journey
programme](../08-build-plan.md) → [session-briefs/2026-09-11-experience-improvement-plan.md](2026-09-11-experience-improvement-plan.md)
→ [01-product-vision.md § Ideal customer profile](../01-product-vision.md) → [open-questions #237 + #238](../open-questions.md).

## Where things stand (verified 2026-09-11)

- `main` is fully deployed: the visual-upgrade programme (PRs #10–#12) and WP218 (PR #7) are live. CI green.
- **PR #9 (embed)** is open, `MERGEABLE`/`CLEAN`. Merging it needs `EMBED_TOKEN_SECRET` set by the owner; Live
  re-render stays gated closed until a creator-email lookup exists (its own small piece of work, see the PR body).
- Owner steps still pending: migrations 028 + 029 (`npm run db:migrate`), optional `BRANDFETCH_API_KEY`.
- The product is live and handles money (#118): owner present → push to `main` after the full verification block;
  autonomous → branch + PR. **R3 (confirm before a 100-credit fetch) = money path = branch + PR + explicit owner go.**

## The single next priority: Journey programme, phase 0 then phase 1

Phase 0: ask the owner to apply migration 028; build the read-only usage report over the existing tables
(aggregates only, no personal data — GDPR posture of #14); decide with the owner whether to re-run the July
experience audit once (real LLM spend, a few euros — re-check the amount before starting).
Phase 1: the first-question bundle (R2 + R11 + R10) — all deterministic, both languages, digit-free on cards.
The 12 owner decisions carry working defaults in the build plan; the owner vetoes by exception. Decision 4 (R3)
needs an explicit go.

## Binding constraints / owner steers

- Cheapest mechanism first: no AI call, no new library, no schema change anywhere in the journey programme.
- The composer stays bare (session 87) — the "which sources are built in" disclosure is collapsed, not a wall of text.
- Never name a data source publicly before it answers questions (principle c). Eurostat is "coming", not "in".
- Plain English for the owner. No shorthand, no R-codes without the sentence.

## Tracked but not the focus

- The repositioning ADR + roadmap re-phasing (#237) — needs the owner in the chat.
- The #205 Pro-plan brainstorm (live embeds = the Pro reason) — needs the owner.
- Eurostat as source two — its own WP through the WP30 narrow waist, after the journey phases.
- STATUS.md known debt: session blocks 92→95 still not archived per convention.
- Weekly usage limit: the account hit it on 2026-09-11 (resets 18:00 Bangkok / 13:00 NL); plan agent fan-out accordingly.

## Model tiers

Session model thinks; implementers and reviewers on cheaper tiers per role; a whole-branch review on a strong tier
before "done". Report which tier did what.

# Session 101 kickoff — clear the deck, then Live-embed Pro plan (written 2026-09-12, owner present)

Read in this order: [CLAUDE.md](../../CLAUDE.md) → [STATUS.md](../STATUS.md) top block → this file →
[session-briefs/2026-09-12-session-100-kickoff.md](2026-09-12-session-100-kickoff.md) (owner steps in more detail) →
[session-briefs/2026-09-12-session-97-continued-part2-handoff.md](2026-09-12-session-97-continued-part2-handoff.md)
(PR #13's own state).

## Phase 0 — clear the deck (do this first, it's nearly free)

Six PRs' worth of built, reviewed, CI-green work is sitting inert because nobody's flipped the switches:

1. Merge PR #13 (Story stage motion) — walk it at 375px in `scripts/dev-harness/` first, that's the one real gap left.
2. `npm run db:migrate` for 028+029, then `npm run usage:report` once.
3. Read `/werkwijze` + `/privacy`, fill in the real contact e-mail, drop the draft-notice banners.
4. Set `EMBED_TOKEN_SECRET` in Vercel — this alone turns on embeds, which have been fully built and dead since PR #9.
5. Run the one-line `auth.users` read check from the RUNBOOK — this turns on Live re-render for Pro accounts.
6. Delete the merged branches GitHub's still listing as open.

None of this is a decision. It's unlocking value that's already paid for. Do it before anything else below.

## Phase 1 — the actual mountain: turn Live embeds into the Pro plan

Here's the thing that just became possible and nobody's built yet: **PR #15 (merged today) removed the only reason
Live embeds couldn't ship** — there's now a real creator-email lookup, so `hasProPlan` can stop being permanently
`false`. The owner already decided months ago (open-questions #237(b), #205) that live embeds — "the number updates
itself, forever, with no one touching it again" — *is* the Pro plan's reason to exist. The mechanism is sitting
one step away from being real. Nobody has built the actual Pro tier.

Build it:
- A `pro_plan` concept with a real upgrade path (not just the `PRO_ACCOUNT_EMAILS` allowlist hack that's there today
  for internal testing — an actual signup flow, however minimal).
- Gate Live re-render on it for real (the plumbing already exists in `src/billing/pro.ts` and `embed-live.ts` —
  read them before designing anything new).
- The upgrade moment: where does a free user actually see "this could update itself forever" and want it? Probably
  right on a frozen embed's own page, or the moment they create one. Design that moment — it's the whole pitch.
- Price it, but DO NOT wire real Stripe products/charge real money without the owner explicitly signing off on the
  number and structure first — build the mechanism and the UI behind a flag exactly like `EMBED_TOKEN_SECRET`
  already works, and stop at the same line R3 stops at. Cheapest mechanism first (CLAUDE.md convention) — no new
  service before checking whether the existing Stripe integration already covers this shape.

Use the parallel-worktree/subagent pattern session 98 used to ship six PRs in one sitting (docs/RUNBOOK.md has the
mechanics) — but own the shared doc files (STATUS.md, open-questions.md, lessons-learned.md) from ONE thread only.
Today cost real time to a numbering collision on the exact same open-questions.md row, three separate times,
because two sessions edited it concurrently. Don't repeat that.

## Non-negotiables (these don't bend for ambition)

- The LLM never computes or interprets a number. Every figure traceable to a CBS cell.
- Refuse or ask on anything ambiguous — never guess, especially near money.
- No real charge, no live pricing flip, no Stripe product creation without the owner's explicit go on the specifics.
- Full verification block (typecheck ×2, both test suites, benchmark 14/14+6/6+0 fabricated, real build, `/code-review`
  LOW) before every push. Green CI is the only "done" signal that counts.
- Owner-present in the chat → push straight to `main`. Autonomous/overnight → branch + PR, no exceptions.

If the owner's in the chat when you read this: ask which of Phase 1's open calls (the price, the upgrade moment,
whether this ships gated-off or actually live) they want to make themselves before you build past the gate.

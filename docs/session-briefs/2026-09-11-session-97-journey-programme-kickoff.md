# Session 97 kickoff — Journey programme, multi-agent, go big from the start (written 2026-09-11, owner present)

**The owner's explicit ask for this session: work autonomously "for hours and hours" and move the project
big steps.** Read this file's "Go big from the start" section before writing a single line of code — it
exists because the immediately preceding session got this wrong once already.

Read in this order: [CLAUDE.md](../../CLAUDE.md) → [STATUS.md](../STATUS.md) top block (verify every fact
against reality first — the Golden Rule) → [08-build-plan.md § Journey programme](../08-build-plan.md) in
full → this file.

## Go big from the start — the lesson this file exists to prevent repeating

Earlier the same day this file was written, the owner asked for autonomous multi-agent work on the Story
stage's visuals. The first wave was small and cautious (a bug fix, a 4px CSS tweak, a research note) —
technically solid, shipped clean, and drew immediate, blunt owner pushback: *"thats not gonna move the
fucking needle."* The second wave — bigger, sequenced, genuinely ambitious (an ambient colour-tied
atmosphere layer, editorial-scale typography, theatrical motion) — is what actually satisfied the ask, and
it shipped as PR #13.

**Do not make the same first move here.** The Journey programme below is large and already has an owner
mandate ("make sure the build plan is updated accordingly," working defaults recorded for all 12 decisions).
Start with a real, multi-phase, multi-agent plan across several hours — not one small item to "test the
waters." If a phase is small enough to finish in minutes, that is a signal to bundle it with siblings into
one wave, not to ship it alone and wait for a reaction.

## The mandate: Journey programme, phases 0 and 3–6 (skip phase 2 — see below)

Full spec: [08-build-plan.md § Journey programme](../08-build-plan.md) (phase table, the 12 owner working
defaults, the "Fixed in every phase" invariants). Source report:
[session-briefs/2026-09-11-experience-improvement-plan.md](2026-09-11-experience-improvement-plan.md).
Phase 1 is **already built** ([open-questions #239](../open-questions.md) on
`claude/checkdecijfers-embed-pr-review-acbrd5`, not yet on `main`) — do not re-build it; if this session's
own work reaches `main` before that branch does, reconcile rather than duplicate.

- **Phase 0 — know.** A read-only usage report over existing tables (signups, first questions, outcomes,
  refusal reasons, trial conversions, feedback) — aggregates only, no personal data (GDPR posture,
  [#14](../open-questions.md)). **Migration 028 needs the owner to actually run `npm run db:migrate` before
  the counters this report reads have any real data in them — this session cannot apply it.** Build the
  report code now regardless (it's correct and needed either way); call out clearly in the PR body that it
  will read empty/near-empty until the owner applies the migration, rather than blocking on that.
- **Phase 3 — orientation.** R4 (a deterministic "which sources/topics are loaded" disclosure built from the
  table registry, collapsed in the chat — never a wall of text, never naming Eurostat before it actually
  answers questions per principle (c)) + R5 items 1–3 (Ontdek caption and the anonymous-trial Insights line
  are **already built**, [#239](../open-questions.md) — only R5 item 2, the Style panel opening on Sjablonen
  for an untweaked chart, remains) + the "Publiceer" landing step (working default: now, not with the
  tagline).
- **Phase 4 — paperwork.** R6: a methodology page ([#207](../open-questions.md)) + a privacy policy
  ([#14](../open-questions.md)(d)), footer links. **The owner reads and approves the actual text before this
  ships** (decision 9's working default) — draft it, but treat "owner sign-off on the copy" as a real gate,
  not a formality to skip.
- **Phase 5 — interaction + phone.** R7 (clarification options send on click, no extra tap) + R8 (collapse
  the four inert composer chips into one "Eigen data (binnenkort)" — a deliberate reversal of two earlier
  chip requests, done knowingly) + R9 (a real 375px pass over the whole journey; move "Credits kopen" +
  "Geschiedenis" into the phone header's Account menu, [#214](../open-questions.md)).
- **Phase 6 — re-measure.** Run the Phase 0 usage report again once the above has been live a while; judge
  the next round on numbers, not vibes. Likely too soon to matter within this same session unless Phase 0's
  migration got applied early and enough real usage has accumulated — use judgement, don't force it.

**Phase 2 (R3, the money-path confirm-before-100-credit-fetch chip) is explicitly OUT of scope for this
session: it needs an explicit owner go before any build, per the working-defaults table's own decision 4.**
Do not build it, do not draft code for it, do not treat "the owner said work autonomously" as that go — money
paths stay owner-supervised regardless of how the rest of this session is scoped. Flag it clearly as ready
and waiting, nothing more.

**Positioning items (parallel, no code needed for most):** an ADR for the repositioning
([#237](../open-questions.md)) is worth drafting if there's a natural pause — it needs the owner to actually
read and react, so don't treat drafting it as "done," just as ready for their reaction.

## How to actually run this for hours — sequencing and parallelism

Phases 3, 4, and 5 above touch mostly-distinct parts of the codebase (the chat composer/disclosure area;
new standalone pages; interaction/phone-layout polish) — genuinely parallelizable, unlike this session's
Story-stage work where three items fought over one file. Use `isolation: 'worktree'` for anything running
concurrently with siblings, per this session's own established pattern (dispatch, merge each into a shared
feature branch as it lands, run the full verification block once at the end, not once per item). Phase 0's
usage-report code is a good first, independent, foundational task to land before the rest, since Phase 6
(re-measure) depends on it existing.

## Binding constraints, unchanged

- **This is autonomous, multi-hour, unattended work on core-product code: branch + PR, never direct to
  `main`** (#118(b) — the same rule this session's own Story-stage work followed, PR #13).
- Full verification block before any push: root + web typecheck, both test suites, hermetic benchmark
  (14/14 + 6/6 + 0 fabricated), real `next build`, `test:docs`, a LOW `/code-review` pass with findings
  fixed or consciously dispatched.
- Every new interface string gets both `nl` and `en` entries in `messages.ts`, digit-free where it lands on
  a card (R2/R11-style honesty discipline extends to this whole programme, per its own "fixed in every
  phase" list).
- Cheapest viable mechanism first — no AI call, no schema change, no new library anywhere in this programme
  (the plan's own rule).
- Check `origin/main` for new commits before starting each new phase, not just once at the start — a
  parallel session collided with this one earlier the same day this file was written; the lesson (see
  [lessons-learned.md](../lessons-learned.md)) is to fetch and skim before assuming the base hasn't moved.

## PRs to keep an eye on, not this session's primary job

Both PR #9 (embed) and PR #13 (Story stage visuals) were green and mergeable as of the end of the prior
session, both simply waiting on the owner's review — re-verify their state fresh rather than trusting this
line, and if either shows a new review comment or a merge conflict, handle it per CLAUDE.md's drive-to-green
rules before it goes stale, but don't let watching them substitute for the Journey-programme mandate above.

## Golden Rule reminder

Every fact in this file was verified against real state at write time (2026-09-11, ~17:00 UTC). Re-verify
before repeating any of it to the owner — PR states, migration status, and what's already built can all
have moved by the time this is read.

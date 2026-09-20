# Session 120 kickoff — checkdecijfers.nl / graphmaker.studio

Read `CLAUDE.md` first, then `docs/STATUS.md`'s top block (authoritative over anything below it,
including this file). Verify everything below against `git log`/`df -h`/`gh run list` before trusting it.

## The short version — nothing was built last session. The owner already decided what's next.

Session 119 (2026-09-20) shipped **zero code**. It asked the owner which of phase 5b's three open
follow-ups to build next, and the owner answered **"All, use subagents"** — all three, not a pick-one.
Before any of them could start, the session hit a genuine local **disk-full incident** (`ENOSPC`, 0 bytes
free) while setting up a worktree, and spent the rest of its time recovering (removing a 12G partial
`node_modules` copy and an unused scratch worktree/branch) and documenting. `main` was never touched —
still at `ff359c24`, same as session 118 left it. This is NOT a "pick something" kickoff like 119's own
was; the decision is already made. Start executing it.

## What the owner decided (2026-09-20, session 119, in chat, owner present)

Build **all three** of phase 5b's deferred follow-ups, using subagents:

1. **Scatter** ([#296](../open-questions.md)) — needs a new two-measure-per-point `ChartPoint`/`ChartSpec`
   shape first (every point carries exactly one value today). A real schema change — architectural, not
   bounded. **Needs a design pass before any implementation plan** — follow this project's own
   `superpowers:brainstorming` discipline (the hard gate: present the design, get the owner's approval,
   before writing a plan or touching code). Don't skip this just because "All, use subagents" sounds like
   blanket implementation approval — it authorizes building all three, not skipping the design gate on
   the ones that need one.
2. **The six house styles + homepage themes row** ([#275](../open-questions.md)) — six visual templates
   (salmon-paper editorial, warm-grey minimal, newspaper, cream newsletter, near-black brutalist, op-art)
   ported as this product's own presentation templates, new presentation keys (paper colour, display/body
   font pairing, panel rules, tick length, corner radius, legend style, colour-keyed headline words —
   spec §6). Visual and naming choices — genuinely worth a quick owner look (even just screenshots/a
   description of the six looks) before committing to an SDD build, not just a data-integrity concern.
   Same design-gate logic as scatter, though this one is more "confirm the direction" than "design a
   schema."
3. **Close the six deferred Minor findings from phase 5b's final review**
   ([#300](../open-questions.md)–[#305](../open-questions.md)) — none is a data-integrity risk (confirmed
   independently by two reviewers already), all are small and already fully specified in their
   open-questions rows:
   - #300: `cbsCapabilities` should read the same live verdict/window state the panel tabs already do,
     not just the structural spec (real code work, needs investigating `web/lib/chart-capabilities.ts`
     and how live verdict/window state is threaded through `web/components/chart.tsx`).
   - #301: add `pieHole` to `PRESENTATION_KEYS`/`patchSchema` (`src/attachments/copilot/{types,schema}.ts`)
     so donut is chat-reachable, not just Style-panel-reachable.
   - #302: type `cbsCapabilities`'s `spec` parameter as `PlottableSpec & Pick<ChartSpec, 'regionScope'>`.
   - #303: informational only — no code fix, leave as documentation.
   - #304: **partially done already** (session 118 fixed ADR 039's stale line). Still open:
     `docs/04-architecture.md`'s phase-5 capability row still says pie/stacked/100%-stacked/scatter "need
     real new capabilities that don't exist yet" (now false for three of the four — no phase-5b row was
     ever added there), and `docs/superpowers/plans/2026-09-09-wp218-phase-5-chart-types.md` (lines ~13,
     ~66) still quotes the pre-phase-5b blanket-refusal copy verbatim.
   - #305: one-line null-coercion fix in `web/app/chart-whole-verification-actions.ts`
     (`row.value_attribute == null ? null : String(row.value_attribute)`).
   **This one has no design gate — start here.** It's bounded, small, and every item already has its fix
   spelled out in open-questions.md.

## A hard constraint this session must respect: disk space

This machine hit **0 bytes free** last session, mid-`git worktree add`, badly enough that even a shell
tool's own output file couldn't be written. It recovered to 16Gi free by the end of session 119, after
removing a 12G stray partial `node_modules` copy. **Before creating ANY worktree that will copy a real
(non-symlinked) `node_modules`, run `df -h /` and confirm there's room.** This repo's `node_modules` is
~15G at the root plus ~833M in `web/` — call it ~16G per worktree. Running scatter + house styles +
Minors as three simultaneous worktrees needs ~48G, which will not fit unless free space is confirmed
well above that. **Default to running them one at a time** (one worktree, build, merge, remove, then the
next) unless `df -h /` clearly shows room for more. See [RUNBOOK.md](../RUNBOOK.md)'s "Multi-agent
autonomous sessions" section, item 14, and [lessons-learned.md](../lessons-learned.md) session 119.

## Suggested order (not mandated — a sensible default given the constraints above)

1. **Minors (#300–#305) first** — no design gate, bounded, one worktree, fast. Good way to confirm the
   worktree/build/review/merge loop and the disk situation are both healthy before committing to two
   bigger efforts.
2. **House styles (#275) second** — needs a quick design confirmation from the owner (the six looks, the
   new presentation keys) but no schema change; likely the smaller of the two remaining architectural
   efforts.
3. **Scatter (#296) last** — the real schema change (`ChartPoint`/`ChartSpec` widened to carry two
   measures per point). Needs the most design work and touches the widest surface (every existing
   narrowing site of these shared types) — the more time-boxed one to get right.

This ordering is a suggestion, not the owner's instruction — the owner said "all three," not "in this
order." Deviate if a different sequencing makes more sense once you're looking at the actual code.

## Two things worth reading before starting

1. **Session 119's own lesson: a real local resource exhaustion (disk-full) is a stop-and-tell-the-owner
   event, not something to route around.** See
   [feedback_disk_full_stop_and_ask] in memory and lessons-learned.md session 119. If it happens again,
   the same response applies: stop, report exactly what's known, ask the owner to act on their machine.
2. **Design gates still apply even under "work autonomously" / "use subagents" framing.** The owner's
   "All, use subagents" is authorization to build all three — it is not authorization to skip the
   brainstorming-skill's approval gate before an architectural change (scatter's schema, house styles'
   new keys). Present a short design, get a nod, then plan and build. Skipping that on a visual/naming
   feature especially — a non-developer owner cares about how the six styles actually look — would risk
   real rework.

## Binding constraints and owner steers (carried forward, still true unless a new session hears otherwise)

- Cheapest mechanism first; plain full-sentence English for the owner; no shorthand.
- Git: owner-present → push to `main` after the full verification block; autonomous → branch + PR
  ([#118](../open-questions.md)). Migrations file-only; live DDL, real LLM spend, env flags stay
  owner-supervised. The repo is public: "Competitor G" only, never the real name.
- Tier rule: session model thinks; implementers on a cheaper tier (Fable has been the owner's standing
  steer across sessions 117-118 — confirm it still stands if this session starts with no visible steer,
  since it's role-based, not a hardcoded default); a whole-branch final review (if the scope warrants one)
  on the most capable tier.
- `ChartForm` is a widely-narrowed shared type (now 11 members) — widening it again for scatter needs a
  full repo grep of every narrowing site plus the full (non-scoped) typecheck and a real `next build`.
- No number is ever drawn that isn't a real fetched cell's own value, or pure arithmetic over
  already-verified reals. This is the one invariant every phase of this feature is built around.

## Tracked, not the focus

[#289](../open-questions.md)–[#295](../open-questions.md) (earlier phase residuals); rebrand to
graphmaker.studio ([#7](../open-questions.md)); the usual owner-steps backlog (registry:apply, DOI
backfill, live benchmark, region-set Task 9, audit row 22, the two `:record` runs +
`benchmark:run:live` — all blocked on the Anthropic workspace usage cap until 2026-10-01, unchanged for
several sessions now).

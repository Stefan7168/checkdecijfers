# Story-mode visual polish — multi-agent kickoff (written 2026-09-11, end of session 96, owner present)

> **HISTORICAL — executed, not a live mandate.** The "fresh session" this doc anticipated never actually
> started; the same conversation continued instead, and this mandate was carried out within it as
> **PR #13** (branch `visual-story-motion`) — see [STATUS.md](../STATUS.md)'s top block and
> [ADR 044](../decisions/044-story-stage.md)'s addendum for what actually shipped, which differs from
> (and goes further than) this doc's own suggested starting points below. Kept for the record, not as
> instructions to re-run.

**This is the next session's actual mandate**, requested directly by the owner at the end of session 96:
*"I would really appreciate it if we can get things visual better, in regards to the story mode thing. can
you spawn multiple agents that start building this for hours and hours autonomously?"* — then, after a
self-interruption to note the context window was large, confirmed as a fresh-session task ("Let's do it in
a fresh session, wrap up").

**Do not confuse this with
[session-briefs/2026-09-11-session-97-kickoff.md](2026-09-11-session-97-kickoff.md) in this same
directory** — that file was written by a *different*, parallel session active on `main` the same day
(session 96 Thread B; see [lessons-learned.md](../lessons-learned.md) and
[STATUS.md](../STATUS.md)'s top block) and describes the "Journey programme" continuation (Phase 0 usage
report, then Phase 1). That work is real and tracked, but it is **not** what the owner just asked for here.
Treat it as background context / a later priority, not this session's job.

## Read in this order

1. [CLAUDE.md](../../CLAUDE.md) — especially the git-workflow rule (#118) below; this session's own
   constraint is different from a normal owner-present session, see "Binding constraint" below.
2. [STATUS.md](../STATUS.md) top block — current overall state (PR #9 green/mergeable and now waiting on
   the owner, not this session; the visual-upgrade programme (PRs #10–#12) fully merged and live).
3. [decisions/044-story-stage.md](../decisions/044-story-stage.md) — the ADR for the Story stage as it
   exists today, **read its "As built" and "Revisit triggers" sections closely** — they are the single best
   starting point for this work (see "Where to start" below).
4. [session-briefs/2026-09-10-visual-next-level-plan.md](2026-09-10-visual-next-level-plan.md) §3 (Story
   mode → scroll-driven 3D storytelling) — the fuller original design vision, including pieces deliberately
   NOT built in v1 (see below). Sections 4–5 (designed default chart, templates) are already built
   (PRs #10/#11) — skim only if a visual-polish idea touches those surfaces too.
5. [08-build-plan.md](../08-build-plan.md) — search for "Story stage" / "visual upgrade" for the full
   as-built history (sessions 92, 94, 95) and the "Order built / rule" note on how this programme has always
   shipped (phased, one PR per phase).

## Where to start — concrete, already-identified visual gaps (not an exhaustive list; the point of the
## multi-agent fan-out is to find more, and to actually build/polish, not just list)

From ADR 044's own "As built" and "Revisit triggers" sections, and the original plan's §3, things
**explicitly recorded as not-yet-built or parked** in the current Story stage:

- **No parallax in v1** — the original plan specified three layers (grid / series / annotation) moving at
  different scroll-parallax factors during the entry tilt and between steps; none of that shipped. The
  plane just settles flat. This is probably the single highest-leverage visual upgrade available.
- **No per-step camera framing** — the plan's `cameraForStep(step, markerBox, plotBox) → {x, y, scale}` idea
  (pan the plot toward the active point, dim/vignette the rest) was designed with pure, unit-testable
  functions and a deliberate **no-scale-in-v1** honesty carve-out (a zoomed-in chart implies an invented
  range unless disclosed — read the plan's "Honesty note on zoom" right after §3.4 before building any
  camera-scale feature). A pan-only camera (no scale) may still be worth building.
- **Auto-play has a known gap**: a scrollbar-thumb drag arms the "reader is scrolling" guard but does not
  stop auto-play in every browser (no wheel/touch/pointer-down reaches the scroller that way). Parked, not
  fixed.
- **The compact (non-stage) panel's IntersectionObserver is a no-op while the stage is open**, and on close
  a scroll reflow can still snap the shared step in the compact view — pre-existing behaviour, not
  introduced by the stage, never revisited.
- **Native scroll-driven CSS animations** (`animation-timeline: scroll()`) were explicitly deferred pending
  Safari/Firefox support — ADR 044 lists broader support as a revisit trigger to replace the hand-rolled
  scroll hook where it deletes code. Worth checking current browser support before investing here.
- **08-build-plan's own "if you finish everything" list** (end of the visual-upgrade programme section):
  native scroll-driven CSS where it simplifies the hook, a *written proposal only* (never a build) for the
  3D-municipality-map idea surfaced in the plan's addendum, and a homepage template strip — in that priority
  order, and only after the above.

None of this is prescriptive — multiple agents researching/prototyping in parallel may find better ideas
than this list. But start by reading ADR 044 and the plan rather than re-discovering the current state from
scratch.

## Binding constraint — this is autonomous, multi-hour, unattended work: branch + PR, not direct-to-`main`

The owner explicitly asked for agents to build "for hours and hours autonomously" — the owner will not be
actively chatting through that whole window. Per [CLAUDE.md](../../CLAUDE.md)'s #118(b) rule, that makes
this **autonomous session** work on **core-product code** (the chart/answer presentation layer), which
**requires branch + PR + owner review before merge** — never a direct push to `main`, regardless of how the
session was kicked off. This is not a new rule for this specific work: session 95 (2026-09-11, also
autonomous/overnight, also visual work) already established the precedent — three phases, three PRs
(#10, #11, #12), one per phase, exactly per 08-build-plan's own "Order built / rule" note. Follow that same
pattern here: **work on a feature branch, open a PR when a phase is done, do not merge it yourself.**

Standard full verification block still applies before every push (typecheck ×2, web + backend suites,
hermetic benchmark 14/14 + 6/6 + 0 fabricated, real `next build`, LOW `/code-review` pass) — this is
chart-rendering code with real invariants at stake even though it's "just visual": R11 (provisional-data
markers must survive any new motion/camera treatment), R4 (source attribution must never be washed out by a
vignette or dimmed layer — ADR 044's spotlight is already confined to the plot box for exactly this reason,
don't regress it), digit-free chrome (no "step N of M", the existing dot pattern), reduced-motion and
`(hover: none)` handling (the existing stage already gates all motion below `lg` / no-hover / reduced-motion
— any new motion feature must respect the same gates), and the export/embed boundary (the stage is
deliberately not exported and not in the embed — keep it that way unless the owner decides otherwise).

## Coordination risk — check `origin/main` periodically, not just once

This exact session (96) discovered a parallel Claude session working `main` concurrently, purely by luck (a
routine PR mergeable-state check flipping unexpectedly) — see the lessons-learned entry. A multi-hour,
multi-agent autonomous run is *more* exposed to this, not less: the owner or another session could push to
`main` at any point during the run. Have the orchestrating session `git fetch origin main` and skim new
commit subjects periodically (e.g. before starting each new phase/PR, not just at kickoff), and re-check
before opening or updating a PR.

## Practical constraints

- **Weekly usage limit**: Thread B's research work hit the account's weekly limit on 2026-09-11 (resets
  18:00 Bangkok / 13:00 NL) — re-check current usage before committing to a large agent fan-out, and budget
  accordingly (this is exactly the kind of open-ended, multi-agent, multi-hour work that can burn a lot of
  it quickly).
- **Cheapest mechanism first** (CLAUDE.md convention) still applies even to visual polish: prefer CSS/motion
  primitives already in the codebase over new libraries; no LLM calls for anything deterministic; no schema
  changes. GSAP is explicitly the *measured escalation*, not the default (ADR 044: only if the hand-rolled
  scrub stutters on a real mid-range phone/Safari — a claim that needs a real device check, not an
  assumption).
- **Model tiers**: per CLAUDE.md's delegation cost-tier rule, the orchestrating session does the thinking
  (scoping each phase, writing briefs, final review); implementers/reviewers run on cheaper pinned tiers.
  Report which tier did what.
- Real browser verification matters more than usual here — ADR 044's own "Consequences" note says motion/
  tilt/vignette/phone-layout/both-themes were checked in a real browser, not just jsdom, because jsdom
  cannot see any of it. Do the same for whatever gets built.

## Tracked but not the focus (context only, do not build unless it directly serves the visual-polish goal)

- The Journey programme (Phase 0 → Phase 1 → …) — [session-97-kickoff.md](2026-09-11-session-97-kickoff.md),
  [08-build-plan.md § Journey programme](../08-build-plan.md), [open-questions #238](../open-questions.md).
  Phase 1 of it was already built independently this session — see [open-questions #239](../open-questions.md).
- PR #9 (embed) — green and mergeable, waiting on the owner to set `EMBED_TOKEN_SECRET` and review; not
  blocked on anything from this session, just keep an eye out if a `main` merge conflict notice arrives.
- The repositioning/ICP work ([open-questions #237](../open-questions.md)) — needs the owner in the chat.

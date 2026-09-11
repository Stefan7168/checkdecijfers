# Overnight visual upgrade — paste this to start (autonomous, hours-long session)

Continue checkdecijfers.nl, fully autonomously, for as many hours as it takes to get through the
priority order below properly — don't stop after a quick win. The owner will be asleep; do not wait
for check-ins. Read, in order: CLAUDE.md → docs/STATUS.md → this file →
[docs/session-briefs/2026-09-10-visual-next-level-plan.md](2026-09-10-visual-next-level-plan.md)
(the full technical plan — read it in full before writing any code; everything below assumes you have).

## The mission, in the owner's own words

"I want you to really understand how we can improve the chart thing... lift it to the next level for
our ICP." He wants this executed with real product judgment, not a literal checklist — you're trusted
to make the calls a design lead would make.

**Who the ICP actually is (docs/01-product-vision.md, Q2 — don't lose sight of this):** freelance
journalists and small newsrooms, on deadline, who need a chart that looks publication-ready with
minimal fiddling — not a design tool, not a toy. The product's whole pitch is *Betrouwbaarheid,
Bronvermelding, Betaalbaarheid* (trustworthy, sourced, affordable). A "next level" chart experience
serves that ICP when it makes the default output look credible enough to paste into a published
article with zero extra work, and makes picking a professional look fast. It serves it less when it's
spectacle for its own sake. Keep re-deriving priority from this, not just from visual "wow."

## The plan already exists — use it, don't re-derive it

A Fable 5.1 agent wrote a thorough, well-researched plan earlier tonight (same session, session 94):
[2026-09-10-visual-next-level-plan.md](2026-09-10-visual-next-level-plan.md). It is genuinely good —
grounded in the real component code (not guessed), weighs real technique tradeoffs (§3.3's table),
and is explicit about which invariants (R1/R6/R11 — no fabricated numbers, ever, even in decoration)
every phase must hold. Read it in full. It ends with **15 open questions for the owner (§9)** it
couldn't resolve alone. Most of those would normally block a session — you don't have the owner
awake to ask. The calls below resolve the ones that matter, so you can proceed without guessing wrong
and burning the night on the wrong thing.

## Decisions resolved for you (so you don't stall or guess wrong)

1. **"3D" means depth, tilt, parallax and motion around a flat chart (§3.2, technique Option A) — NOT
   a literal 3D object or a 3D map.** The plan's own addendum (§12) found the reference demo is
   actually a 3D *map* of Dutch municipalities, and flags this as a real alternative reading of what
   the owner meant. Do not build that. Reasons this session is confident saying so without asking: (a)
   a 3D map is a wholly new geographic-data feature, not a chart enhancement — far outside tonight's
   scope and this product's current CBS-statistics-chat shape; (b) the plan's own perceptual-accuracy
   argument against literal 3D chart geometry (Tufte, Cleveland–McGill — equal values render as
   unequal sizes under perspective) is a genuine data-integrity concern for THIS product specifically,
   whose entire value proposition is "every number traceable and undistorted"; (c) picking wrong here
   is the single most expensive possible mistake tonight — it would burn most of the available hours
   building something to throw away. If, after building the flat/depth stage, real spare time remains,
   a documented proposal for the map idea (not a build) is a reasonable use of leftover hours — see
   "If you finish everything" below.
2. **Retire "basic Recharts style" as the default look — build the designed default (§4).** The
   owner's own words this session ("a graph is just a basic graph, which needs more styling") already
   answer plan item 1. Make the palette/grid/marker/type/motion calls yourself using the plan's own
   §4.2 recommendations as defaults (colour-blind-safe palette: yes: it costs nothing and regains a
   property the owner only gave up as a side effect of an unrelated decision). Use the design-canvas
   method §4.2 itself recommends (today's chart beside 2-3 real options, light + dark) to sanity-check
   your own choice before committing — but decide, don't leave it half-built waiting for a sign-off
   that isn't coming tonight.
3. **Templates v1 = looks only (§5), not starter charts.** Build the template set §5.3 proposes,
   including "Classic" (today's look, for continuity) and "Newsroom" (closest to the ICP's actual
   publish-ready need — prioritize making this one excellent). Starter charts (a curated chart + a
   look) are explicitly v2 (§7 phase 5) — do not build them tonight.
4. **The open Embed pull request (PR #9) status decides your branch strategy — check it fresh, don't
   assume.** As of this writing it's green and mergeable, waiting on the owner's review; it may or may
   not be merged by the time you start. Either way: **branch your work from the current tip of `main`**
   (not from the embed-charts branch). If PR #9 is still open when you're ready to push, expect your
   branch and it to both touch `chart.tsx` and the same tracker docs (`STATUS.md`, `status-archive.md`,
   `open-questions.md`, `lessons-learned.md`) — a real merge conflict is likely, not a sign anything is
   wrong. This exact session watched and resolved that same kind of conflict four times tonight; the
   playbook is proven and written up in `docs/lessons-learned.md`'s Session 94 entries and
   `docs/status-archive.md`'s Session 94 items 10-13: combine both sides' additions; where the identical
   item was independently rewritten on both branches, keep whichever wording is more accurate/complete
   rather than trying to preserve both. Don't let this stall you — resolve it the same way and keep
   going.
5. **Migrations 028/029 are NOT yours to apply.** The plan flags them as needed for the usage counter
   to work — that's a live-DDL, owner-supervised action per CLAUDE.md, off-limits to an autonomous
   session regardless of how confident you are. Proceed without the counter; note in your PR that
   "measured evidence" escalations (GSAP, Three.js, auto-play defaults) stay unmeasured until the
   owner applies them. This does not block anything in the priority order below.
6. **Bundle budget: zero new libraries for tonight, full stop.** Build the Story stage on Option A
   (CSS 3D transforms + a scroll-progress hook, 0 kB) as the plan recommends. Do not reach for GSAP or
   Three.js "since I have time" — the plan is explicit that those are measured escalations, gated on
   real device data and an owner OK neither of which exist tonight.
7. **Auto-play: off by default, build the toggle, don't default it on.** Zoom in the stage: spotlight
   only, no scale (v1 per the plan) — this is also the safer, more honest choice per the plan's own
   "Honesty note on zoom."

Everything else in §9 (exact palette hues, exact template roster beyond what's specified above, minor
sizing) is yours to decide with good taste — that's the "you're the expert" part. Make a call, write
it down (a one-line rationale in the commit/ADR is enough), move on.

## Priority order for the hours you have (do not skip ahead — see why below)

Work through these **in order**. Each is sized (roughly) against this project's own historical
build-session pace; you almost certainly will not finish all three to the project's usual full rigor
in one night, and that is fine — a properly finished phase 1 beats a rushed, half-broken phase 3.

1. **The designed default chart look (plan §4).** Do this first even though the plan's own ordering
   agrees — but the ICP reasoning above makes it doubly clear: this is the one change that improves
   *every* chart the product ever shows, with zero new interaction model, and it's the difference
   between "looks like a code demo" and "looks like something a journalist would paste into a piece."
   Highest leverage per hour of anything in the plan.
2. **Templates v1 (plan §5).** Directly serves "fast, professional, minimal fiddling" for the ICP.
   Prioritize "Newsroom" as the template that most directly matches what a freelance journalist on
   deadline actually wants.
3. **The Story stage (plan §3).** The most ambitious, most device-sensitive, most hours-consuming
   piece, and — be honest with yourself about this — the one that matters more to the product's own
   marketing/demo appeal than to a journalist's daily workflow. Build it properly if you have the
   hours after 1 and 2 are done and verified; a good, working, honest, well-tested phase 1+2 and an
   honestly-reported "phase 3 in progress" beats a phase 3 that skipped the verification block to get
   there.

**If you finish everything** (all three phases, fully verified, PR'd): use remaining time for phase-4
items the plan marks conditional-but-cheap (native scroll-driven CSS where it simplifies the hook,
a written (not built) proposal for the 3D-map idea per decision 1 above, or the homepage/empty-state
template strip from §5.2 entry point 2) — in that order of preference. Do not start anything requiring
a new library, a schema change, or real LLM spend.

## Process — same rigor this project always uses, nothing skipped for speed

- **Use `superpowers:subagent-driven-development`** the way sessions 92-94 already did for Story mode,
  the Style panel, and Insights: a written plan (`superpowers:writing-plans`) per phase, cheap-tier
  implementers per task, a fresh reviewer per task (top-tier for anything touching `chart.tsx` or the
  honesty-scan tests — this codebase's own history is full of things only that level of review catches),
  a whole-branch review before calling a phase done. Delegate legwork to cheap-tier subagents; you (the
  top-tier model) do the scoping, the review, and the judgment calls above — burning the expensive
  model on mechanical work is a cost bug, not diligence.
- **Full verification block before every push, no exceptions, same as every other session**: both
  typechecks, the web suite, the backend suite, the hermetic benchmark at 14/14 answerable + 6/6
  refusal/clarify + 0 fabricated, a real `next build`, `test:docs`, and an unprompted `/code-review` at
  LOW effort with every finding fixed or consciously dispatched. "It looks right" is not done; green
  CI is the only signal that counts, same as always.
- **Write the ADR(s).** The designed-default swap and the Story stage are both load-bearing choices
  (ADR 039 already reserved seams for exactly these) — update ADR 039's addenda or add new ADRs,
  whichever the existing numbering convention calls for. Watch for the numbering-collision issue this
  session hit repeatedly if PR #9 is still unmerged (check which ADR numbers exist on `main` AND on
  `origin/embed-charts` before claiming one).
- **Update the docs a session always updates**: STATUS.md, status-archive.md, open-questions.md
  (including marking §9's resolved items and the ones deliberately deferred), lessons-learned.md,
  12-huisstijl.md (the "basic Recharts" line becomes history), 03-mvp-scope.md if scope framing shifts.
- **Playwright, for real, on real pages, both themes** — this plan explicitly calls out that jsdom
  cannot prove scroll/motion/contrast; the session-92 lesson about a hidden browser pane never
  hydrating the chart subtree still applies. Don't call the Story stage done from unit tests alone.
- **Invariants R1/R6/R11 are non-negotiable in every phase** — no numeric text anywhere in a chart
  card or the stage that isn't a bound spec string; the honesty digit-scan tests must keep passing;
  a fabricated or distorted number is a worse failure than an unfinished feature. If a technique choice
  and an invariant conflict, the invariant wins, full stop — this is not a judgment call.

## The one hard rule that is NOT negotiable tonight: branch + PR, never push to `main`

This is an autonomous overnight session with nobody watching — CLAUDE.md's own git-workflow rule
(#118(b)) requires branch + PR + owner review before merge for exactly this situation, no exception
for how confident you are or how good the diff looks. Open one PR per completed phase (not one giant
PR at the end) so the owner can review and merge phase 1 the moment he's up, even if phase 3 is still
running or didn't make it. Each PR description should be readable by a non-developer in under a
minute: what changed, why, how it was verified, and — critically — a couple of real screenshots so he
can judge the look without reading code or running anything.

## If you hit a real blocker

A genuine ambiguity this brief doesn't resolve (not a taste call — an actual conflict between two
things this document or the plan both said) is rare given the decisions above, but if it happens:
write it into the PR description and `docs/open-questions.md` clearly, make the safest reasonable
default choice, keep going, and flag it prominently at the top of your final summary so it's the first
thing read in the morning. Don't stall waiting for an answer that can't come until the owner wakes up.

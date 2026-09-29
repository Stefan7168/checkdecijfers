# ADR 063 — Chart-first refocus: one product, one user, and "the look is done" as the gate

**Status:** accepted 2026-09-29 (session 141, owner present). Decided in a vision interview after the owner's own
diagnosis ("we are developing something that doesn't get published anytime soon … our look is still very childish …
some features don't really make sense"). The review that fed the interview:
[session-briefs/2026-09-29-vision-vs-build-review.md](../session-briefs/2026-09-29-vision-vs-build-review.md).

**Relates to:** ADR [047](047-repositioning-embedded-sourced-chart.md) (the "sourced chart" positioning — kept, now the
ONLY positioning), ADR [056](056-chart-copilot.md) (chart editing — kept, moved behind one Edit button), ADR
[042](042-chart-presentation-defaults.md) / [043](043-chart-house-styles.md) (templates — kept, no longer the front door),
ADR [062](062-breadth-table-lane-slice-cache.md) (breadth — merged dark, paused after step 5), ADR
[049](049-3d-municipality-map-demo.md) (3D demo — stays out of the product flow).

## Context

Three months, about 1,900 commits, about 163,000 lines, 63 decision records, 220 open questions, two accounts (the
owner and a test account), zero outside users. Three positionings coexist in the code and the docs: a fact-check chat
for journalists (July), a "sourced chart, embedded forever" tool (September), and the start of a general chart maker
(graphmaker.studio, mid-September). Each was added; none was removed.

The live site, checked in the browser on 2026-09-29: the homepage shows no chart above the fold; the gallery renders
grey placeholders on a cold visit (the first request took over five seconds); a chart card carries eleven form tabs,
period dropdowns, edit/undo/redo/history icons, an Insights panel, two "not CBS data" disclaimer boxes and a three-line
source paragraph, with the chart itself about a quarter of the card. Competitor G (the AI graph maker the owner
referenced) shows one headline, one number, the chart as the hero, and nothing to configure.

There has never been a launch gate. The roadmap says "dates are deliberately absent; phases advance on their gates",
and every gate is an engineering gate (benchmark scores, flag flips). "Beautiful charts" was never a work package with
a finish line: we built 13 templates, 8 fonts, 11 forms, a style panel and a chat co-pilot, never one default that
looks finished untouched.

## Decision (the owner's five answers, verbatim in spirit)

1. **One product.** A beautiful, sourced chart of official Dutch and European statistics. The chat is how you ask; the
   chart is what you get. Own-data upload stays as a secondary door, not the headline. Not a general chart maker (that
   stays a possible later step, not the focus).
2. **One user.** Anyone who has to publish a number: journalists, communication staff at municipalities and companies,
   teachers, bloggers, people posting on LinkedIn. The 60-second experience: open the site, ask, get a chart you would
   use, without training and without an account for the first chart.
3. **The gate.** The current build phase ends when the owner says "I would share this" about (a) the chart that appears
   after a question, (b) the Edit popup, and (c) the homepage. Then the owner invites people. No calendar date; the
   owner chose this over a fixed date, and accepted the recorded risk that "not yet" has already lasted three months.
4. **The look, concretely.** Ask a question, see the chart. The chart surface shows a headline, one number, the chart as
   the hero, one source line, and the buttons Edit, Download and Share. ONE Edit button opens ONE popup that holds ALL
   editing: chart type, style and template, period, goal lines and period ranges, notes and captions, insights, the
   "ask to change" co-pilot, derived overlays. Nothing is removed; everything is tidied. The popup is designed with the
   design skills available to the sessions, in light and dark. Competitor G is the reference for simplicity, not a
   template to copy. Iteration by screenshots shown side by side with Competitor G until the owner says done.
5. **The freeze.** No feature is removed and no code is deleted. But no NEW feature work until the gate passes: breadth
   step 6 and the table-lane flag flip, regional statistics part 2, Eurostat in chat, the Pro plan, brand colours all
   wait. The finished step-5 table-lane branch is merged dark first (owner: "I want everything merged, updated, the
   latest"), so no branch rots.

## Alternatives considered

- **A general AI chart maker (Competitor G head-on).** Rejected for now: it throws away the one advantage Competitor G
  does not have (official statistics built in, every number traceable) and needs a new front door and a new name
  before anyone has used the current one.
- **Back to the July fact-check chat.** Rejected: the owner's stated point of the product is visualisation; the
  refusal behaviour and source trail stay as the foundation, not as the product.
- **A dated gate (ten strangers in four weeks).** Recommended by the session, declined by the owner in favour of the
  look-is-done gate. Recorded so the next sanity check can revisit it if the look phase drags.
- **Hide or remove the cluttering features now.** Recommended by the session, declined by the owner: keep everything,
  move it behind the Edit button, tidy it with design skill.

## Consequences

- [STATUS.md](../STATUS.md)'s top block and [08-build-plan.md](../08-build-plan.md) now name ONE work package, "The
  Look", with the three parts above and the owner's "I would share this" as the done-definition per part.
- [01-product-vision.md](../01-product-vision.md) opens with the one-sentence product and the one user; the ICP and
  the July audience paragraph stay as history and detail beneath it.
- Every other roadmap item is marked paused until the gate, in the same change (doc-freshness rule).
- The sessions that build The Look use the design skills (interface design, data-visualisation, component library
  guidance) as a required step, not an optional one, and show the owner screenshots next to Competitor G at every
  iteration.
- The public claim ("every number traceable to an official CBS cell, with source and date shown") is unchanged.
  Principles (a), (b), (c) are unchanged; this ADR moves nothing in the answer pipeline.

## As built

- **Part (a), round 1 — session 142, 2026-09-29, `14e1687a` + `298d4d80` (CI 36529117701 green):** the card is title →
  headline / big number → chart → caveats → source line → one action row Edit · Download · Embed · Share · Insights (the
  owner's own five, open-questions #346); every control lives in the one Edit popup, nothing removed. Share = a link to
  the public embed page (cheapest mechanism, same signed token as Embed). Residual for part (b): #348 (keyboard cost
  of the bottom row).
- **Part (a), round 2 — session 143, 2026-09-29 (SHA in the status-archive entry):** the owner's reaction to the
  round-1 screenshots was two change requests with the ruling "fix those two first, then it's done" — the action row
  wrapped (chat list open: two lines; phone: three) and the subtitle carried CBS's raw code ("% 000000 Alle
  bestedingen"). Fixed with no JS and no schema change: the row is a CSS container whose button words collapse to icons
  in measured tiers (`web/lib/chart-action-row.ts`), and a display-only `stripDimensionCode` (`web/lib/dim-label.ts`).
  With that, **part (a) is signed off on the owner's ruling (#346)**; part (b) is next.
- **Part (b), round 1 — session 143, 2026-09-29 (SHA in the status-archive entry):** the popup got its shape on the
  owner's GO of a plain-English design: header (title, undo · redo · history, close), a left-hand preview of the card
  as it will be shared, three tabs on the right (Grafiek · Markeringen · Opmaak), a pinned footer (co-pilot box +
  Klaar). Download/Embed left the popup for the card's row; the Style panel's sub-tab "Grafiek" became "Lijnen en
  assen"; #348 (keyboard cost of the bottom row) fixed with one tab stop on the plot. Sign-off pending (#346).
- **Owner rethink, session 143 (#351):** after seeing a code-drawn-images content pipeline, the owner asked whether to
  rethink; decision: **popup first, then a server-made preview image for every Share link (part (a2), before (c))**.
  Not a rebuild of the on-screen renderer; the image model belongs to the homepage/white-glove page, never to a chart.
- **Part (a2), round 1 — session 143, 2026-09-29 (SHA in the status-archive entry):** every Share link now unfurls
  with a 1200×630 picture of the chart (`/embed/<token>/opengraph-image`): the saved headline, the headline figure
  verbatim, the brand, and the ADR 014 server SVG (attribution footer included) embedded whole, rasterised by Next's
  built-in image tool. No new dependency, no AI, no schema change, no outside service. Part (b) was ruled "good
  enough for now, revisit later" by the owner (not signed off); (c) the homepage is next.

## Revisit triggers

- The look phase passes four weeks (2026-10-27) without the owner saying "done" on part (a): re-run the sanity check
  and put the dated gate back on the table.
- The first ten outside users ask for something the freeze list holds (own data, Eurostat, live embeds): unfreeze that
  item, in that order, on that evidence.
- The owner decides to move to graphmaker.studio and the general chart maker: a new ADR, not an amendment here.

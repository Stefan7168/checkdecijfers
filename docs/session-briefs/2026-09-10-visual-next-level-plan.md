# Visual "next level" plan — Story mode as scroll-driven 3D storytelling, a designed default chart, and templates

**Status: proposal for the owner to react to — nothing in this document is decided, scheduled or built.**
Written 2026-09-10 (session 94) on request of the owner, who said the product "at this point doesn't look
good enough" and asked for a plan to take the chart / Story mode experience "to the next level". This is a
plan, not a build: no code, no branch, no docs other than this file were changed for it. Every "as built"
statement below was read directly from the repository at the time of writing (paths given), never
recalled from memory. Everything owner-facing is in plain English; the engineering detail sits under the
headings marked for build sessions.

The owner's own words, kept whole so the intent is his and not a paraphrase:

1. "Story mode is the one, I would say, with the 3D thing, scroll effects, etc."
2. "A graph is just a basic graph, which needs more styling as well."
3. "We can offer the best possible API credits, least usage, and premade templates. People can select
   templates and build upon them, but they can also start by chatting and creating these kinds of graphs."
4. "I want people to have a better look and feel of the graphs."

## 0. Read this first — the one thing that constrains everything below

**The reference site the owner pointed at (https://checkdecijfers-3d-demo.vercel.app/) could not be
viewed from this environment.** The session's headless browser and its web-fetch tool were both refused by
the network egress policy (the proxy's own status endpoint answered "gateway answered 403 to CONNECT —
policy denial"); this document's author made one more attempt with an independent fetch tool and got the
same refusal (`EGRESS_BLOCKED`). No further attempts were made to route around a policy block.

So: the 3D / scroll recommendations here are grounded in (a) the owner's description — "the 3D thing,
scroll effects" on Story mode — and (b) the established design patterns of scroll-driven data
storytelling ("scrollytelling": a chart that stays put while short text steps scroll past it and drive
what the chart shows — the layout The Pudding, the NYT/Bloomberg graphics desks, Our World in Data's
explainers and Flourish's "stories" all converge on; the technical toolbox of scroll-linked transforms,
GSAP ScrollTrigger-style pinning and scrubbing, parallax depth layers, and WebGL/Three.js scenes). They
are **not** a pixel-accurate reading of the unseen demo.

**Two things worth knowing about that demo:** open-questions [#208](../open-questions.md) (2026-09-06)
already records that the owner built "an index page with all different kinds of variations of
graph/storytelling" under a different account (`stefan@social.plus`) and wanted it "hosted on the same
URL checkdecijfers" — that session could not locate it and asked for the URL. The demo URL given now is
almost certainly that page (**Assumption** — the owner can confirm in one word). And since it is the
owner's own Vercel project, its **source code** is the best possible input for a tighter pass — far better
than a screenshot: a future session can read exactly which libraries and effects it uses. See §11.

## 1. In one paragraph, for the owner

The plan has three parts that can be built one after the other, each on its own. **First, the default
chart** (the one every answer shows): today it is, on purpose, the plain "stock Recharts" look you chose in
September — a purple/green/yellow palette from the library's own examples, a dashed grid in both
directions, a dot on every point. That decision is the reason a graph "is just a basic graph"; the fix is
a designed default look (palette, grid, type, spacing, a subtle entrance) that every chart on every page
gets automatically, with no new machinery — it is a different set of values in the style system you
already have. **Second, templates:** a "Templates" tab in the Style panel with small previews; picking one
applies a curated bundle of the style options that already exist (colours, font, grid, frame, aspect
ratio), and people then tweak it in the same panel and save it as their default exactly as today. Chatting
still makes the chart; a template only decides how it looks. **Third, Story mode:** keep the small story
under the chart as it is, and add a "Present" button that opens the same story as a full-screen, scroll-
driven stage: the chart stays fixed while each step scrolls past and moves the "camera" — a gentle tilt
and depth on entry, layers that move at different speeds, a spotlight that dims everything except the
point the step is about, captions that reveal as you scroll. The depth and motion are done with the
browser's own CSS 3D and scroll features, so they add no AI calls, no API calls, no database change, and
no heavy library. **None of the three needs any AI or API spend; all three are client-side and
deterministic.** What is deliberately *not* recommended: drawing the charts as 3D objects (3D bars,
rotating scenes) — that would make bars of the same value look different sizes and would sidestep the
checks that prove every number on a chart is a real CBS cell.

## 2. Verified current state (read directly from the repository, not from memory)

### 2.1 The chart renderer and its presentation layer

- `web/components/chart.tsx` is **2,745 lines** on this branch (`wc -l`; ADR 041 measured 2,843 on the
  `embed-charts` branch, which adds four embed props). Recharts `^3.10.1`. Every `<Line>`, `<Area>` and
  `<Bar>` is drawn with `isAnimationActive={false}` — a **recorded refusal**, not an accident: the
  session-90 architecture synthesis lists "Animation — REFUSED — export-at-click-time and reduced motion"
  ([session-briefs/2026-09-09-session-90-chart-config-tool-synthesis.md](2026-09-09-session-90-chart-config-tool-synthesis.md)).
  The same table refuses curve smoothing (`natural`/`basis` overshoot the labelled maximum; `monotone`
  deferred) and rounded bar corners (a rounded baseline floats the bar off zero).
- Marks are custom shapes — `SeriesDot`, `SeriesBar`, `RegionBar` — carrying `data-point`,
  `data-result-id` and every visible number as a spec string bound via `data-label-for`. Axis tick text is
  drawn by our own `AxisTick`, never Recharts' own number formatting. Axis and grid colours are the theme
  tokens `AXIS_COLOR = var(--muted-foreground)` / `GRID_COLOR = var(--border)` — the session-87 lesson that
  Recharts' hardcoded `#666`/`#ccc` do not follow dark mode ([lessons-learned.md](../lessons-learned.md)).
- **No animation or 3D library is installed.** `web/package.json` has only `tw-animate-css` (Tailwind
  utilities); the `d3-*` packages in the lock file are Recharts' own transitive dependencies. No
  `framer-motion`/`motion`, no `gsap`, no `three`, no scroll library.
- The presentation model, `web/lib/chart-presentation.ts`: `ChartPresentation` has 15 keys —
  `lineWidth` (4 named steps), `markers` (`all` | `provisionalOnly`), `grid`, `xLabels`, `axisLines`,
  `valueLabels`, `zeroBaseline`, `seriesColors`, `fontFamily` (7 curated options), `language`, and the six
  frame keys (`frameBackground`, `framePadding`, `frameCorners`, `frameShadow`, `frameInset`,
  `frameAspect`). `STOCK_PRESENTATION` is **deep-equal pinned by a test** so the session-87 look cannot
  drift; `sanitizeOverrides` allow-lists every key (unknown keys drop silently); `resolvePresentation`
  re-runs the honesty locks on every render; `judgeColor`/`judgeColorAgainst` refuse any colour below a
  1.25 contrast ratio against a backdrop (the R11 hollow ring would vanish) and warn below 3.0.
- **ADR 039 already reserved the template seam in so many words** (Alternatives, item 1): "presets remain
  possible later as named `Partial<ChartPresentation>` objects over the same overrides."
- The account default (`user_chart_styles`, migration `028_user_chart_styles.sql`) and the anonymous usage
  counter (`chart_style_usage`, same migration) are **file-only — the owner has not applied migration 028
  (nor 029)**. Consequence for this plan: the counter that the "escalate on measured evidence" rule
  depends on records **nothing** today. `CHART_STYLE_EVENTS` (`src/chart/user-styles.ts`) currently has
  nine events, including `story_open`, `story_step` and `frame_changed`.
- The Style panel (`web/components/chart-config-panel.tsx`, 1,710 lines): four tabs `chart | colors |
  font | frame`. **As of this session's commit `3047d47` on this branch, it is an inline `role="region"`
  card directly under the chart** — no longer the floating, portaled dialog ADR 039's session-92 addendum
  originally described (that addendum now carries a superseded note, dated the same day). The same commit
  moves the "Chart in panel" pill into the answer card's action row and widens the chat column to
  `max-w-4xl`. [12-huisstijl.md](../12-huisstijl.md) and [open-questions.md](../open-questions.md) #222
  are corrected in the same commit.

### 2.2 Story mode as built (session 92, ADR 039 addendum)

- `web/lib/chart-story.ts` — pure: `buildStorySteps(displayedSpec, lang)` → overview · start · highest ·
  lowest · latest · explore for a time series; overview · one step per series (max five) · explore for
  several series; overview · highest · lowest · explore for a comparison. Captions are templates filled
  only with spec strings. "Highest/lowest" is a selection, not a computation — **Assumption** recorded on
  [#221](../open-questions.md).
- `web/components/chart-story.tsx` — the trigger (the product's ONE gradient ring, `WandSparkles` icon)
  and the panel: one card per step in a **`max-h-40` (160 px) scroll area**, the card with the largest
  visible share (≥ 0.5) is the step (IntersectionObserver, threshold 0.5), Previous/Next, a dotted step
  list, arrow keys, Escape refocuses the trigger, `prefers-reduced-motion` already switches
  `scrollIntoView` to instant. A settle-based guard stops the observer fighting a programmatic scroll.
- `chart.tsx` reacts per step with the reducer's `setHighlight`; a point step draws a dashed ring
  `r + 5` outside the marker (the R11 hollow ring stays visible inside it), a bar step a dashed outline.
  Opening snapshots the reader's hidden/highlight/zoom state and restores it on close (`setView`); the
  legend, the Vanaf/Tot selects and the small-multiples toggle are locked with a readable reason while the
  story is open. **Zoom is deliberately not used** (a one-period window is a degenerate chart, a wider one
  an invented range). The trigger is offered only with ≥ 3 steps, never in table form or with small
  multiples on. Nothing is persisted; the ring and dimming are on screen and therefore export.
- Recorded follow-ups, not built: zoomed steps, auto-play, story inside the embed (`?story=1`),
  LLM-written captions "only on measured demand AND the owner asks".

### 2.3 Frame, export, and the honesty machinery every change must pass

- `web/components/chart-frame.tsx` wraps **only** the export container. After the session-92 Playwright
  battle test its aspect ratio sets an explicit **height** from the measured width (six rounds of fixes;
  CSS `aspect-ratio` was wrong in every combination — [lessons-learned.md](../lessons-learned.md)).
- `web/components/chart-download.tsx`: the export clones the live `<svg>` inside `chartContainerRef`,
  inlines computed paint **resolved against the light theme** (`withLightThemeResolution`, the #222 fix —
  commit `1f8d25b` on this branch, not yet on `main`), bakes the frame into an outer SVG, and rasterises
  the PNG through `<img>` → canvas at 2×. `measureSvg` reads `clientWidth`/`clientHeight`, which CSS
  transforms on an ancestor do **not** change — verified in the source; it matters for §3 (a transformed
  wrapper cannot corrupt an export's size). Known limits already on record: a PNG cannot load a web font
  (#218 as built), the attribution line can be cut off on a narrow chart ([#223](../open-questions.md)).
- **The honesty scans are the hard constraint.** Backend: R6's export-side scan asserts that the rendered
  SVG shows no numeric token that is not a spec string and that marker geometry is an exact affine image
  of the values (`tests/chart/`, `tests/invariants/`). Web: `web/components/chart.test.tsx` walks **every
  text node of the whole chart card** for digit tokens — any new copy inside the card (a "step 2 of 6",
  a "zoom 150%") fails the suite unless it is a spec string. ADR 038's session-90 correction and ADR 039's
  panel copy rule both exist because of this. Presentation state lives only in the client (ADR 038/039);
  the spec and the audit row never change (R8).

### 2.4 Decisions already on record that this plan touches — and would revise

- **"Use the basic Recharts style"** (owner, session 87, 2026-09-07; [12-huisstijl.md](../12-huisstijl.md)
  → Charts; the redesign spec's exact words: "explicitly do not design or keep a custom restyled palette
  ... if it happens to be colorblind-unsafe, that's an accepted trade-off"). The owner's new words ("a
  graph is just a basic graph, which needs more styling") **revise this decision**. §4 treats that as the
  first decision to take explicitly — the pinned `STOCK_PRESENTATION`, the huisstijl doc and ADR 039 all
  state the current one.
- **Owner decision E (#218): each chart starts fresh** — per-chart overrides clear on a spec swap; the
  account default sits underneath. A "remembered template for my next charts" for an anonymous visitor
  would be a third layer; §5 keeps E intact by default and puts the alternative to the owner.
- **The one-gradient rule** ([12-huisstijl.md](../12-huisstijl.md): the story trigger's ring is the only
  gradient in the app; "no other control gets a gradient"). Chart *backgrounds* already come in six
  gradient presets, so the rule is about interface chrome, not chart art; template thumbnails show chart
  art. Noted so nobody reads a thumbnail gallery as breaking the rule.
- **The Studio interaction model** ([#158](../open-questions.md), owner direction 2026-07-17): "AI
  suggests → user toggles → deterministic code renders", chat as a second input path, "except when it is
  about numbers". Templates are the "user toggles" half; the "AI suggests" half is the later, conditional
  piece (§5.2) — the same order ADR 038 Phase 4 already deferred to.
- **Cheapest viable mechanism first** (owner, 2026-09-08, CLAUDE.md) and the owner's own "least usage"
  in this very ask. The main Anthropic key hit its monthly usage cap on 2026-09-09 (audit row 302,
  session-93 kickoff) — cost-consciousness is not theoretical here.
- **Phase gate** ([03-mvp-scope.md](../03-mvp-scope.md)): Story mode is in scope (session 92); the Style
  panel, account defaults, brand colours, extra honest forms are in scope (WP218). What the non-goal row
  still keeps out: free-form sizing, public chart URLs and embeds (moving into scope via the `embed-charts`
  branch), pie/stacked/scatter/ranked forms, free text inside the chart, organisation theme objects in
  the spec (ADR 007, Phase 3). Nothing in this plan puts presentation into the spec; a *3D chart form*
  would be a new form and is not proposed. A full-screen story stage is a new surface for an in-scope
  feature — flagged in §9 for confirmation rather than assumed.

### 2.5 Things in flight that affect sequencing

- **Embed is built but not merged**: 21 commits on `origin/embed-charts` (the pull request from that
  branch is open against `main`; CI green per the session-94 kickoff written at the end of session 93,
  run `34433304606`; ADR 041 lives only on that branch). It adds `embed`, `embedMode`, `embedFooter`,
  `initialFormOverride` to `ChartView` — the same file every phase below edits. Building this plan on a
  different trunk than Embed guarantees a painful merge in `chart.tsx`; §7 puts the merge decision first.
- **This branch** (`claude/checkdecijfers-embed-pr-review-acbrd5`) carries the #222 export fix and the
  #224 scoping doc and the session-94 panel-move commits (§2.1).
- Pending owner steps unchanged from earlier kickoffs: migrations 028 + 029 (`npm run db:migrate`),
  optional `BRANDFETCH_API_KEY`, WP202a go-live steps 2–6.

## 3. Story mode → scroll-driven 3D storytelling

### 3.1 What the genre actually does (so the build is the real thing, not a bigger scroll box)

Every well-known scrollytelling piece has the same skeleton: a **sticky graphic** (the chart pinned in
the viewport) and a column of **steps** (short text panels) that scroll past it; scroll position picks
the active step, and the graphic changes state per step — highlight, annotate, re-frame, move the camera.
Today's Story mode is that skeleton **inverted**: the chart sits still in the chat column and the *steps*
scroll inside a 160 px box under it. That is right for a chat answer (compact, does not hijack the page),
and it is why it does not feel like "the 3D thing, scroll effects" — it is a stepper, not a stage.

The proposal therefore adds a second **layout** of the same story, not a second story: the **Story
stage** — a full-viewport surface where the chart is the sticky graphic, each step is a full-height panel,
and the scroll position between two steps drives a continuous transition ("scrubbing"). The step builder
(`buildStorySteps`), the captions, the highlight/ring reaction, the snapshot/restore and the digit-free
rules are reused unchanged. **"Present" (or "Full screen") on the existing story panel opens the stage;
Escape or a close button leaves it.**

### 3.2 What "3D" can honestly mean here

Two very different things hide behind "3D":

1. **Depth and motion of the presentation** — the chart plane tilts slightly toward you on entry and
   settles flat; the grid, the series and the annotation layer sit at different depths and move at
   different speeds as you scroll (parallax); the frame lifts off the page with a real shadow; a spotlight
   vignette dims everything except the step's point; captions slide in. The chart's data plane is always
   read **flat** at the moment a number is being read.
2. **Charts drawn as 3D objects** — extruded bars, a camera orbiting a scene, depth of field.

**Only the first is recommended.** The second is a well-documented perception problem (perspective makes
two bars of the same value look different; Tufte's and Cleveland–McGill's findings on 3D bar charts are the
standard reference), and here it also fails the machinery: R6's test that marker geometry is an *affine
image of the values* cannot hold under perspective; a WebGL canvas is opaque to the R1/R6 text scans, to
screen readers and to the export path (which serialises the live `<svg>`). It would mean a second renderer
with its own honesty proofs. That is not "next level", it is a different product with a weaker guarantee.
The plan therefore treats "3D" as depth, light and motion around a flat, honest chart. **§9, decision 4
asks the owner to confirm this reading** — if he means extruded objects, this plan should be stopped and
re-scoped rather than bent.

### 3.3 Technique options, with tradeoffs (for build sessions)

Bundle figures are **approximate, from general knowledge, and must be re-measured with the real `next
build` output (or bundlephobia) before any adoption — Assumption**, marked once here for the whole table.

| Option | What it is | Adds to the bundle | Strengths | Weaknesses / risks here |
|---|---|---|---|---|
| **A. CSS 3D transforms + a scroll-progress hook (no library)** | `perspective`, `transform-style: preserve-3d`, `rotateX/rotateY/translateZ` on layered wrappers *outside* the SVG; a small hook that turns scroll position between steps into a 0–1 progress (IntersectionObserver for the step, one rAF-throttled scroll listener for the scrub); every animated property is `transform`/`opacity` (compositor-only). | **0 kB** | Nothing to license or upgrade; GPU-cheap; the SVG and its `data-*` bindings are untouched, so every honesty test keeps passing as-is; export unaffected (`measureSvg` uses `clientWidth`); reduced-motion is one media query. | "3D" is a tilted plane, not geometry (by design, §3.2); scrub easing/pinning is hand-rolled — pinning inside the chat column or the `overflow-hidden` dock is fragile, which is why the stage is an **overlay**, not in place; needs a Playwright pass, jsdom cannot scroll. |
| **B. Native CSS scroll-driven animations** (`animation-timeline: view()` / `scroll()`) | The browser links a keyframe animation to scroll position — no JavaScript in the scroll path at all. | 0 kB | Best possible performance; declarative. | Support is uneven (Chromium since 2023; Safari only recently; Firefox behind a flag — **Assumption**, verify on caniuse at build time) → **progressive enhancement over A**, never the only path. |
| **C. GSAP + ScrollTrigger** | The industry-standard scrollytelling toolkit: pinning, scrubbed timelines, snapping, robust easing. | ~25–40 kB gzip for core + ScrollTrigger (**Assumption**); licence changed in 2025 (free for all uses under Webflow's ownership — **Assumption: verify the current licence text before adopting**). | Excellent scrub quality; battle-tested pinning; good docs. | Imperative DOM API beside React (needs the `useGSAP` pattern, refs, disciplined cleanup — the portal lesson says "lift state, don't fight the tree"); pinning inside scrolling containers is exactly its hardest case; another dependency to keep patched (Dependabot cadence). **The escalation from A if scrub quality on real devices proves insufficient — measured, not assumed.** |
| **D. `motion` (Framer Motion)** | React-native declarative animation: `useScroll`, `useTransform`, `motion.g` inside SVG (`pathLength` line-draw). | ~30–40 kB gzip (**Assumption**) | Fits React; can animate *inside* the SVG (draw-in of a line). | Animating Recharts' own paths fights the library (Recharts owns the `d` attribute and has its own animation system, deliberately off — §2.1); the export could capture a half-drawn state, the exact reason animation was refused; adds a dependency for what A does with CSS. Not recommended for v1. |
| **E. Three.js / react-three-fiber** | A real WebGL scene: extruded bars, camera orbit, lighting, particles. | ~150–200 kB gzip for the core + R3F, more with `drei` (**Assumption**) | Genuine 3D; spectacular demos. | A second renderer outside every honesty test; canvas is invisible to screen readers and to the SVG export; WebGL contexts are limited per page (a chat with many charts, a homepage with five, would lose contexts); mobile GPU/battery; largest bundle by far. **Not recommended for the chart. The only defensible use is a decorative backdrop behind the sticky chart in the stage, lazy-loaded (`next/dynamic`) only when the stage opens, with a CSS fallback — and even that only on measured demand for the stage itself.** |

### 3.4 Recommendation: the "Story stage" on option A (+ B as enhancement), C held as the measured escalation

**Build the stage with CSS 3D and a scroll-progress hook, no library.** Concretely:

- **A full-viewport overlay** (`position: fixed; inset: 0`, `role="dialog"`, `aria-modal="true"`, focus
  moved in, Escape closes, focus returned to the "Present" button — the house ARIA pattern; a portal for
  *position only*, state stays in `ChartView`, exactly ADR 039's precedent). On wide screens: the chart
  pinned on the left ~55 % of the width, steps in a scrolling column on the right; on phones: the chart
  pinned in the top ~45 % of the viewport, steps scrolling beneath, `touch-pan-y` kept.
- **A second `ChartView` instance in a `stage` mode** — chrome stripped the way the embed branch's
  `embedMode` already does (no tabs, no Style/Story triggers, no zoom selects, no Download, no notes) —
  rendered from the **same spec and the same resolved presentation values** as the chart it came from, and
  driven only by the step index. A second mounted instance is deliberate: the chat's chart stays exactly
  where it is (the dock is `overflow-hidden`, and moving DOM between parents means a remount anyway), and
  the stage instance holds no reader state of its own (no notes, no hidden series), so there is nothing to
  leak or restore (the session-79/89 cross-instance state lessons). **Assumption:** rendering the same spec
  twice is acceptable cost (Recharts renders a 256 px chart in a few ms; the homepage already renders five).
- **Per-step camera and focus, all presentation:** for a point step, read that marker's `cx`/`cy` from the
  live `[data-result-id]` circle **once per step change** (never per scroll frame), and derive a CSS
  transform for the *plot wrapper* (translate so the point sits in the spotlight; in v1 **no scale**, see
  the honesty note below); dim everything else via the existing highlight dimming plus a radial vignette
  layer; the dashed ring keeps doing what it does today. For overview/explore steps: transform identity,
  vignette off. The mapping `cameraForStep(step, markerBox, plotBox) → { x, y, scale }` and
  `progressToStyle(progress) → { transform, opacity }` are **pure functions with unit tests** — the only
  part jsdom can verify; the rest is a Playwright pass.
- **Depth on entry and between steps:** the chart plane enters with `perspective(1200px) rotateX(8deg)`
  easing to flat over the first scroll; the grid layer, series layer and annotation/caption layer move at
  three parallax factors (e.g. 0.85 / 1.0 / 1.15); the frame's shadow deepens as it "lifts"; the tilt is
  capped (≤ 12°) and only ever applied while no number is being read (overview/transition), so the R11
  ring and the value labels are always read on a flat plane. Below `lg` or on `(hover: none)`: no tilt, no
  parallax — fade/slide only (performance and legibility).
- **Captions reveal** (translate + fade, 200–300 ms) as their panel becomes active; the panel carries the
  same digit-free chrome as today (dots for position, never "step N of M").
- **Auto-play** as an optional toggle, off by default: a timer that advances the same index — it costs
  nothing in the stage and is a recorded follow-up already. **Decision for the owner (§9, item 7).**
- **Scroll-driven CSS animations (option B)** for the caption reveals and the parallax where supported,
  with the hook as the universal fallback — added only if it measurably simplifies the code; never a
  second behaviour to maintain.
- **Escalation rule:** if, measured on real devices (owner's phone, a mid-range Android, Safari), the
  hand-rolled scrub stutters or the pinning misbehaves, adopt GSAP (option C) for the stage only, behind
  the same pure functions — the transforms do not change, only what drives them.

**Honesty note on zoom.** A scale-up centred on a point pushes other points out of view — the on-screen
equivalent of ADR 038's zoom, which discloses its window. In the stage this is transient, unexportable
(the stage has no Download; the compact story's export behaviour is unchanged) and the caption repeats
the point's own value — but a screenshot of a zoomed stage under our attribution is the reputational
class #46(c) names. **v1 therefore uses spotlight (dim + vignette + ring + pan) without scale; a capped
zoom (≤ 1.3×) is a v2 option the owner can choose (§9, item 6)** — the same class of call as #221.

**Coexistence with today's mechanism:** `ChartStoryPanel` keeps its compact layout as the default; the
stage is opened from it and closed back to it; both read the same `storySteps` and `storyIndex`; the
snapshot/restore and the control locks are untouched (the stage instance has no controls to lock). The
counter gains `stage_open` (and `stage_autoplay` if built) beside `story_open`/`story_step`, so the
"measured demand" rule for any escalation has data — once migration 028 is applied.

### 3.5 Accessibility, mobile, export, embed

- `prefers-reduced-motion: reduce` → no tilt, no parallax, no scrub; steps still switch instantly with
  the highlight (today's behaviour). Mandatory, not optional (WCAG 2.3.3); the existing story already
  checks the query for `scrollIntoView`.
- Keyboard: arrow keys and the dots already move steps; the stage adds Escape/close and focus management;
  the caption panels are the accessible narrative (`aria-current="step"` as today).
- Export: the stage exports nothing; the chart in the chat behind it is unchanged. CSS transforms live on
  wrappers outside the exported `<svg>`; `measureSvg` is transform-immune (§2.3).
- Embed: the stage is **not** in the embed. "Story in the embed" stays the follow-up ADR 041 lists; when
  it is built, the compact layout is the sensible one for an iframe.
- Digit-free copy rule: every new string inside the stage ("Scroll to continue", "Present", "Auto-play")
  is added to `messages.ts` in both languages and contains no digits.

### 3.6 Owner decisions this section needs

Listed once, in plain English, in §9 (items 4–7 and 11).

## 4. The default chart (outside Story mode)

### 4.1 Why it looks "basic" today — a plain diagnosis from the code

The default is, literally, the look of Recharts' documentation examples: `#8884d8` purple, `#82ca9d`
green, `#ffc658` yellow as the first three series colours (`RECHARTS_PALETTE`), a `3 3` dashed grid in
**both** directions, axis lines shown, a 4 px dot on **every** point, 11 px labels, a fixed 256 px chart
height (`h-64`) whatever the width, and a plain popover tooltip. That is not a shortcoming of the
implementation — it is the pinned `STOCK_PRESENTATION`, i.e. the owner's session-87 decision executed
faithfully. Everything that makes a chart look "designed" — a considered palette, a quiet grid, restraint
in markers, hierarchy in the type, room to breathe, a little life on entry — was ruled out by that
decision. The fix is a **new default**, not new machinery.

### 4.2 Proposed direction — a designed default (working name "Editorial"; the owner names it)

Ranked by visual impact per unit of cost; every item is presentation over the unchanged spec:

1. **A designed categorical palette** — 6–8 hues chosen in OKLCH for even lightness and distinguishable
   hue, with a light-theme and a dark-theme variant each; every colour verified against both card colours
   (`#ffffff`, `#171717`) above the 1.25 R11 floor and, where possible, the 3.0 warning line; pairwise
   *distinguishability* between series (not pairwise contrast — the session-69 research over-stated that
   requirement, per lessons-learned). Recommended: a colour-blind-safe set (Okabe–Ito-derived or similar,
   verified) — the owner accepted losing that property in session 87 as a trade-off of "basic Recharts"; a
   designed palette regains it for free. **Assumption:** the owner is fine with that side effect.
2. **A quiet grid and axes** — horizontal hairlines only (`grid: 'horizontal'`), no vertical grid, axis
   lines off (`axisLines: 'hidden'`), a single light baseline — the FT/Economist/Our World in Data/CBS
   house look. These are **existing keys**: the new default is mostly different literals.
3. **Restraint in markers** — a new marker mode `'ends'` (the first and last plotted point of each series
   plus every provisional point, always) as the default for series with more than ~8 points; `all` stays
   available in the panel. The hollow R11 ring is unaffected (`provisionalOnly` semantics already prove the
   mechanism). This is one new enum value: schema, resolver, panel copy in both languages, tests.
4. **Line and fill** — 3 px lines for a single series, 2 px for several; the curve stays `linear` (the
   smoothing refusal stands: interpolation invents values between points). For the area form, a subtle
   vertical gradient fill (colour at ~25 % → 0 %) instead of a flat 25 % fill — one new key
   (`fillGradient: on | off`), honest because the area form already forces a zero baseline. Rounded bar
   tops are **not** proposed (the recorded refusal: low value, honesty cost at the baseline).
5. **Type hierarchy inside the card** — the title as a real 16 px semibold heading, the unit and the
   pinned dimensions as one muted subtitle line, value labels at 12 px with a **text halo** (SVG
   `paint-order: stroke` with a card-coloured stroke so labels stay legible where they cross a line —
   **Assumption:** the halo survives `inlineComputedPaint` and the `<img>` rasteriser; verify by opening the
   exported files, the session-69 lesson). Tabular numerals are already global.
6. **Height that follows width** — replace the fixed `h-64` with a measured-width rule (minimum 256 px,
   ~16:9 up to ~360 px) using the *same* explicit-height mechanism `ChartFrame` ended up with after the
   battle test — **never CSS `aspect-ratio`**. A wide dock chart stops looking squat.
7. **Tooltip and hover** — the existing honesty-bound tooltip with a swatch, tabular value and muted
   period (mostly there), plus a muted crosshair cursor line (Recharts' `Tooltip cursor` styling).
8. **A little life on entry** — a 250 ms fade/translate of the chart *wrapper* (a CSS class outside the
   exported `<svg>`) when a chart first appears, honouring `prefers-reduced-motion`. Recharts' own
   animation stays **off** (the recorded refusal: an export at click time must never capture a half-drawn
   line; this wrapper-only entrance cannot).
9. **Both themes, always** — the dark variant of the palette is part of the design, axes keep the theme
   tokens (the session-87 lesson), exports keep resolving against the light theme (#222).
10. **Legend as swatch chips** — the interactive hide/highlight legend keeps its behaviour and ARIA, in
    the chip styling the rest of the product uses.

Recommended way to choose it: the **design-canvas method** that worked in session 91 (two canvases drawn
from the real components, "current beside three options", picks within minutes): one canvas with today's
chart beside three designed defaults (e.g. "Editorial", "Newsroom", "Bright"), in light and dark, on a
single-series line, a five-region comparison and a provisional-heavy series. Pick, amend, build.

### 4.3 Mechanism and what it touches (for build sessions)

- `STOCK_PRESENTATION` literals change (deliberately updating the deep-equal pin), `RECHARTS_PALETTE` is
  replaced by a designed palette constant with a dark variant (the resolver's `seriesColor` reads the
  theme via a tiny hook or CSS variables — decide at build time; the export must keep resolving light),
  two new keys (`markers: 'ends'`, `fillGradient`), the halo attribute on label `<text>`, the height
  rule, the entrance class, the legend chips. Zero change to `src/chart/*`, `buildChartSpec`, stored
  specs, prompts or the database. A saved account default keeps winning for the keys it stored
  (`withAccountDefault` merges over the new stock look).
- Tests that will change **once, deliberately**: the `STOCK_PRESENTATION` pin, the "every stock palette
  colour passes `judgeColor`" pin (re-verify with the new palette), the byte-identical "Standaard restores
  the stock svg" export fixture, and **which gradient presets refuse against the default palette** — three
  of six refuse today; recompute at design time with a five-line `contrastRatio` table (the session-92
  lesson) and re-tune the presets in the same change if the new palette shifts that.
- Docs in the same change: [12-huisstijl.md](../12-huisstijl.md) → Charts (the "basic Recharts" paragraph
  becomes history), ADR 039 as-built addendum, the redesign spec's chart bullet gets a superseded note,
  `03-mvp-scope.md`'s WP218 sentence, open-questions #218.
- Surfaces that change look **automatically**, by construction (same `ChartView`): the chat, the dock,
  the five homepage "Ontdek" charts, the anonymous trial, the history view, and — once merged — the
  embed's frozen render. Flagged so the owner expects the homepage to change too.

### 4.4 Owner decisions this section needs

§9, items 1–3.

## 5. Templates

### 5.1 What a template is (and is not) here

**A template is a named, curated bundle of the presentation options that already exist** — colours, font,
grid/axes/markers/thickness, and the frame (background, gradient, padding, corners, shadow, inset,
aspect ratio) — optionally with a preferred chart form and a preferred story layout:

```
ChartTemplate = {
  id, nameKey (messages.ts, nl + en), descriptionKey,
  overrides: PresentationOverrides,      // Partial<ChartPresentation> — sanitizeOverrides-safe
  formPreference?: ChartForm,            // applied only if the form guards allow it
  storyLayout?: 'compact' | 'stage',
  preview: hand-drawn SVG thumbnail      // digit-free, ~60×36, the template's colours/background/grid
}
```

This is exactly the seam ADR 039 named ("named `Partial<ChartPresentation>` objects over the same
overrides"). **No new data-model concept is needed for v1**: templates are code constants in a new
`web/lib/chart-templates.ts`; applying one is `resetPresentation` + `setPresentation(template.overrides)`;
"build upon it" is the existing Style panel; "keep it" is the existing "Save as my default" (the account
row already stores effective overrides, so template + tweaks becomes the user's default with no new
persistence); every honesty lock re-runs per render, so a template can never switch value labels off on a
bar chart or hide a provisional marker; `sanitizeOverrides` drops anything a template carries that the
resolver does not know. A template is **never** in the chart spec or the audit row (ADR 039's alternative
3 explains why; ADR 007's "theme object in the spec" stays the Phase-3 enterprise seam it always was).

What a template is **not** in v1: a data starting point. The owner's phrase "select templates and build
upon them, but they can also start by chatting" is read here as *pick a look first, then ask* (v1) —
**Assumption**. The richer reading — a **starter template = a curated chart + a look** ("Inflation, last
five years, in the Newsroom look") — is possible with zero LLM spend through the same path the homepage's
five curated charts already use (`src/chart/curated.ts`: a hand-authored `StructuredIntent` → `runQuery`
→ `buildChartSpec`, no parser), but each starter is a hand-curated definition, not free text, and the
anonymous surface must stay a bounded, pre-built set (the session-69 research's own caution about "never a
free picker on the anonymous route"). That is v2 (§7, phase 5), gated on an owner decision.

### 5.2 Where people meet templates — coexistence with chat-driven creation and the Style panel

- **Chat-driven creation is untouched.** A question still produces the chart through the deterministic
  pipeline; the LLM still only parses intent. A template only skins the result. Nothing in this section
  adds a prompt byte or an LLM call — a template picker is the deterministic UI that already covers the
  whole menu, so a "make it look like Ocean" chat command (ADR 038 Phase 4, #158's "AI suggests" half) is
  neither needed nor proposed now; it stays conditional on counter data and an owner sign-off, as recorded.
- **Entry point 1 — the Style panel gets a first tab, "Templates":** a gallery of thumbnails (hand-drawn
  SVG previews, **not** live `ChartView` instances — six or more Recharts renders per panel would be the
  wrong kind of cost), the current template marked, a one-line description each; clicking applies it to
  the chart in front of you; the other tabs then show the template's values pre-filled (the "pre-filled
  with what the chart currently uses" principle of #218); "Standaard" resets as today. Because the panel
  is now an inline card under the chart (session 94), the gallery sits where the eye already is.
- **Entry point 2 — a "Templates" strip on the homepage or the empty chat state** (a row of the same
  thumbnails with "Try it" → opens the chat with the template preselected for the next chart). This is
  where owner decision E bites: applying a chosen look to *the next* chart means remembering the choice.
  Recommended v1: for signed-in users, "Use for all my charts" = the existing account default (no new
  mechanism); for anonymous visitors, either nothing persistent (E stands fully) or a browser-only memory
  (`localStorage`, cleared by "Standaard") — **owner decision, §9 item 9**. The strip is a small, separate
  slice after the tab.
- **Brand as a template:** "Brand" is simply the existing "Apply brand colours" (Brandfetch, signed-in,
  key-gated, capped at 100 calls a month) presented as a template card — no new mechanism, shown disabled
  with its existing reason when the key is absent.
- **Usage:** one new counter event, `template_applied` (with the template id as the event name suffix, no
  personal data), so the owner can see which looks people actually pick before investing in v2.

### 5.3 The first template set (proposal) and the design-time contrast rule

| Template (working names) | Look, in words | Uses only existing keys? |
|---|---|---|
| **Standard** | The new designed default (§4). | yes |
| **Classic** | Today's stock Recharts look, kept for continuity and comparison. | yes |
| **Newsroom** | Serif title (Merriweather, in `FONT_OPTIONS`), hairline grid, restrained palette, white ground, end labels only, no markers except provisional. | `markers: 'ends'` (new, §4) |
| **Presentation (dark)** | Dark inset card on a slate gradient, bright palette variant, thick lines, larger labels, `frameAspect: '16:9'`. | yes |
| **Social 4:5** | Gradient background, inset card, rounded corners, soft shadow, `frameAspect: '4:5'`, thick lines, value labels on. | yes |
| **Minimal** | No grid, no axis lines, end labels only, single accent colour for a single series. | yes |
| **Brand** | The Brandfetch flow as a card (signed-in, key present). | yes |

**Rule, made mechanical:** a test iterates every template × the default palette × both themes × the
template's own frame backdrops (`frameBackdrops`) and asserts **no `judgeColorAgainst` refusal** — the
session-92 lesson ("three of six gradient presets refused against the stock palette at two series; a
five-line contrast table at spec time would have caught it") turned into a gate. A template that would
refuse is a design bug fixed before it ships, never a disabled card.

**Fonts:** a template may set `fontFamily` from `FONT_OPTIONS` (Google fonts load on demand); the known
limit stands that a PNG export falls back to a system font. Say so on the template card? No — the export
menu is the right place, and it is a pre-existing limitation, tracked with #218.

### 5.4 Owner decisions this section needs

§9, items 8–10.

## 6. Cost — plainly

| Recommendation | LLM spend | Outside API spend | Database change | Bundle | Verdict |
|---|---|---|---|---|---|
| §4 designed default | none | none | none | ~0 (a palette constant, a few keys) | **fully client-side, deterministic** |
| §5 templates v1 (looks, tab, strip) | none | none (Brand card reuses the capped Brandfetch flow) | none (browser storage at most, owner decision) | ~0 (constants + SVG thumbnails) | **fully client-side, deterministic** |
| §3 Story stage v1 (CSS 3D + hook) | none | none | none | **0 kB** new dependencies | **fully client-side, deterministic** |
| Optional: GSAP escalation | none | none | none | ~25–40 kB gzip (**Assumption**, measure) + licence check | only on measured scrub problems |
| Optional: Three.js backdrop | none | none | none | ~150–200 kB gzip (**Assumption**, measure), lazy-loaded | only on measured stage demand + owner OK |
| Optional: saved named templates (v2) | none | none | **yes — a migration, supervised** | ~0 | only if `template_applied` shows use |
| Optional: starter templates (v2) | none (curated intents, no parser) | none | none (code) | ~0 | owner decision |
| Not proposed: LLM captions / chat-styled templates | **yes** | — | — | — | conditional on counter data AND an owner ask (as recorded in the story spec) |

So, in the owner's terms: **all three recommended parts are "least usage" — zero AI and zero API spend,
no new backend dependency, no schema change; the only cost is build time.** The single prerequisite for
the "escalate on measured evidence" rule to work at all is applying migration 028, otherwise every counter
above records nothing.

## 7. Build sequence — cheapest and highest-value first (with rough sizes)

Sizes are build-session estimates in the Subagent-Driven-Development shape this project uses (cheap-tier
implementers with fresh reviewers per task, a top-tier whole-branch review, then the full verification
block: typecheck ×2, web + backend suites, hermetic benchmark, real `next build`, docs test, LOW review;
Playwright on the production homepage charts at 1280 and 375 px in light **and** dark before "done" —
the session-92 lesson). Owner present → direct push to `main`; autonomous → branch + pull request (#118).

| Phase | What ships | Size | Gate / owner decision before it starts |
|---|---|---|---|
| **0 — prerequisites (owner)** | Decide the `embed-charts` pull request (merge or not) so `chart.tsx` has one trunk before this programme edits it; apply migrations 028 + 029 so the counter measures; commit the session-94 inline-panel move and correct ADR 039 / 12-huisstijl's "floating panel" wording. | 0 build days | — |
| **1 — the designed default (§4)** | Design canvas (today beside three options, light + dark, three chart shapes) → owner pick → palette, `STOCK_PRESENTATION`, `markers: 'ends'`, `fillGradient`, halo, width-following height, entrance fade, legend chips; pins updated; docs. Every chart everywhere improves at once, homepage included. | ~½ day canvas + 2–3 build days | Items 1–3 |
| **2 — templates v1 (§5)** | `chart-templates.ts`, the Templates tab with SVG thumbnails, the design-time contrast test, `template_applied`, "Use for all my charts" = account default; the homepage/empty-state strip as a second, small slice. | ~2 build days (+ ~½ day for the strip) | Items 8–10 |
| **3 — Story stage v1 (§3)** | The full-screen stage on the existing story: overlay, stage-mode `ChartView`, pure camera/progress functions with tests, tilt + parallax + spotlight + caption reveal, reduced-motion path, phone layout, "Present" button, Escape/focus, `stage_open`; Playwright pass. | ~4–6 build days | Items 4–7, 11 |
| **4 — stage v2 (conditional)** | Any of: capped zoom (item 6), auto-play toggle (item 7), native scroll-driven CSS where it simplifies, GSAP only if scrub quality measured poor, per-series camera for multi-series stories, "story in the embed" once Embed is merged, a lazy-loaded decorative backdrop only on measured demand and an explicit bundle OK. | 1–3 days each | counter data (`stage_open`) + the listed decisions |
| **5 — templates v2 (conditional)** | Starter templates (curated chart + look) on a bounded set; saved named templates per account (a migration, supervised); a template gallery page. | 2–4 days + supervised apply | `template_applied` data + items 8, 12 |

Why this order: phase 1 is the largest visible change for the least code and de-risks everything after it
(templates and the stage inherit the new default); phase 2 reuses phase 1's palette work and answers the
owner's "premade templates" ask with constants; phase 3 is the most work and the most device-sensitive, so
it goes after the cheap wins and after the Embed merge decision has settled `chart.tsx`.

## 8. Invariants and gotchas every phase must hold (the checklist for build sessions)

- **R1/R6/R11 by construction:** no new numeric text anywhere inside the card or the stage that is not a
  spec string bound via `data-label-for`; the hollow ring and the hatched bar stay visible at every tilt,
  scale and colour (the contrast floor 1.25 applies to every template backdrop; tilt ≤ 12°, never while a
  number is being read; no scale in stage v1).
- **The whole-card digit scan:** every new string is digit-free and lives in `messages.ts` in both
  languages; positions are dots, never "N of M".
- **Export never sees the stage or a transform:** CSS transforms only on wrappers outside the exported
  `<svg>`; `measureSvg` is transform-immune (verified); Recharts animation stays off; the compact story's
  export behaviour (ring + dimming bake in, panel text never does) is unchanged.
- **Both themes, always** (12-huisstijl house rule 3), with the Recharts-literal-colour lesson in mind:
  pass every colour explicitly; measure contrast in a real browser, not jsdom; exports resolve light.
- **No CSS `aspect-ratio`; explicit heights from measured widths** (the six-round battle-test lesson).
- **No portals to move controls; portals for position only; lift state** (the session-91 lesson).
- **The hidden Browser pane never hydrates the chart subtree** — verify interactively with Playwright on
  production's public charts or in a visible pane, never by screenshot alone.
- **Owner decision E stays unless the owner changes it** (§5.2); a template applies to the chart in front
  of the reader; the account default is the only persistence.
- **Second `ChartView` instances carry no reader state** (stage mode: driven by the step index only).
- **Design-time arithmetic for every curated colour set** (templates × palette × themes × backdrops) as a
  test, not a hope.
- **Every model constant stays what it is; nothing here adds a prompt byte.** If a later phase proposes
  one (LLM captions, chat-styled templates), it is a new owner decision with counter data in hand.

## 9. Decisions needed from the owner, in one list (plain full sentences)

1. Do you agree to **retire "use the basic Recharts style" as the default look** and replace it with a
   designed default? If yes, phase 1 happens; if no, phases 2 and 3 still work but every chart keeps the
   stock look underneath.
2. Should the new default palette be **colour-blind-safe** again (recommended — it costs nothing in a
   designed palette), or do you not care either way?
3. Will you **pick the default from a design canvas** (today's chart beside three designed options, in
   light and dark), the way you picked the panel layout in September? That is the fastest way to a real
   decision.
4. When you say "the 3D thing", do you mean **depth, tilt, layers and motion around the flat chart**
   (recommended and planned here), or **charts drawn as 3D objects** such as extruded bars (not
   recommended: it makes equal values look unequal and bypasses the checks that prove every number)?
   If the second, this plan should be stopped and re-scoped, not bent.
5. Should the story stage open as a **full-screen overlay** with a "Present" button (recommended), leaving
   the small story under the chart as it is, or should the chart itself grow into the story in place?
6. In the stage, may a point step **zoom in** on its point (capped, so most of the chart stays visible),
   or should it only **spotlight** the point (dim the rest, no zoom)? Spotlight is what v1 builds; zoom
   is a v2 choice.
7. Do you want **auto-play** (the steps advance by themselves) as a switch that is off by default?
8. For version 1, are templates **looks only** (colours, fonts, grid, frame, aspect ratio), with
   **starter charts** (a curated chart plus a look) as a later, separate step?
9. When a visitor who is not signed in picks a template, should it apply **only to the chart in front of
   them** (your "each chart starts fresh" decision stands), or should the browser **remember it for their
   next charts** until they reset it?
10. Which of the proposed first templates do you want, and should **"Classic" (today's look)** stay in
    the list for continuity?
11. Do you accept the **bundle budget rule** proposed here: zero new libraries for version 1; GSAP
    (roughly 25–40 kB) only if the hand-built scrolling is measured to stutter; Three.js (roughly
    150–200 kB, decoration only) only on measured demand and with your explicit OK?
12. Will you **apply migration 028 (and 029)** before this programme starts, so the usage counter can tell
    us which parts people actually use? Without it every "on measured evidence" step here is blind.
13. Will you **decide the open Embed pull request** (merge or not) before phase 1 touches `chart.tsx`?
14. Can you **share the demo** — ideally by adding its repository to a session so the exact effects and
    libraries can be read, otherwise a screen recording or screenshots plus the three to five things you
    liked most? (Is it the "index page with variations" from open-questions #208?)
15. Is the full-screen story stage acceptable as **an evolution of the in-scope Story mode** under the
    phase gate, or do you want it recorded as a separate scope change first?

## 10. Assumptions (marked here; to be mirrored into open-questions as one new row when the owner reacts)

- **Assumption:** the demo URL is the #208 "index page with variations of graph/storytelling".
- **Assumption:** "3D" means depth/tilt/parallax/motion around a flat chart, not extruded geometry (§3.2).
- **Assumption:** the library sizes in §3.3/§6 are approximate from general knowledge; they must be
  re-measured with the real build before any adoption; GSAP's licence must be re-read at adoption time.
- **Assumption:** browser support for native scroll-driven CSS animations is uneven enough that it can
  only be a progressive enhancement over the JavaScript hook; verify on caniuse at build time.
- **Assumption:** rendering the same spec in a second, chrome-less `ChartView` instance for the stage is
  an acceptable cost.
- **Assumption:** the owner is fine with a colour-blind-safe default palette as a side effect of §4.
- **Assumption:** a text halo via SVG `paint-order` survives both export paths — verify by opening the
  exported files.
- **Assumption:** "select templates and build upon them" means picking a look (v1), not a data starting
  point (v2).
- **Assumption:** the story stage's spotlight-without-zoom is honest without a disclosure line (the same
  class of call as #221 and the session-89 highlight); zoom, if ever chosen, gets its own review.
- **Assumption:** the second-instance stage is the right mechanism over an in-place transformation of the
  chat's chart; a build session may find the dock/overflow constraints argue otherwise and should say so.

## 11. For a tighter follow-up pass: what to share

1. **The demo's source** — add its GitHub repository to a session (it is your own Vercel project), or
   paste its `package.json` and the names of its main components. That tells a session exactly which
   effects and libraries it uses; no guessing.
2. Failing that, a **screen recording** of scrolling through it, or three to five screenshots, plus the
   **three to five specific things you liked** ("the chart tilts as it enters", "the numbers count up",
   "the background moves slower than the chart", "the dark gradient look").
3. **Where** you want the stage to appear first: chat answers, the dock, the homepage charts, or all.
4. Your answers to §9 — items 1, 4, 8 and 13 unlock the most.

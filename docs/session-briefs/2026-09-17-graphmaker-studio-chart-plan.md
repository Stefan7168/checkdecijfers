> **Naming note:** the competitor studied here is referred to as "Competitor G" throughout; its real name, URLs, people and investors are deliberately withheld because this repository is public. The owner knows which company is meant (owner instruction, 2026-09-18).

# graphmaker.studio — competitive read of Competitor G and a chart-quality plan

**Status:** DRAFT for the owner, written 2026-09-17 in a read-only session (another session owns the
repo; nothing here is committed). Once approved, this belongs in `docs/session-briefs/` plus an ADR
for the rename and one for the chart-engine direction.

**Question asked:** we are rebranding to graphmaker.studio, starting with "Dutch + European official
statistics built in" as the USP, and later widening into a general chart maker. Competitor G
(Competitor G's app / Competitor G's SDK site / their public agent-skills repo) is a competitor with beautiful charts. What
can we take over so we do not do double work, and what should we build better?

---

## 1. What Competitor G actually is (verified 2026-09-17)

Two products from one company (the competitor's company (UK)):

| | Competitor G's app | Competitor G's SDK site |
|---|---|---|
| What | Consumer/SaaS chart maker: paste data, CSV/XLSX, Google Sheets, AI chat, "insights", brand kits, share/embed | React charting SDK + paid "AI agents" API; the engine under Competitor G's app, sold to developers |
| Pricing | Free: 5 charts, Competitor G logo, limited AI. Plus $16/user/month: custom colours, no logo, unlimited. Business $36: Sheets auto-refresh, password links, brand kits | Free only for non-commercial use, or under "PolyForm Small Business" (fewer than 100 people AND under ~$1M revenue). Everyone else: 32-day trial, then "contact us" pricing |
| Chart types | 25+ (bar variants, line, pie/donut, funnel, heatmap, table, survey/Likert) | Grammar of graphics: point/line/area/bar/rule/tile geoms, plus recipes for pie, donut, radar, polar bars, combo/dual axis, heatmap, scatter/bubble, and plugin recipes for sankey, treemap, beeswarm, candlestick, dumbbell, lollipop, sketchy bars, voronoi, force graphs. Legacy docs also list funnel, waterfall, mekko |
| Storytelling | Auto "insights", annotations | Highlights with dimming, difference arrows, reference lines (target / average), era shading, headline (KPI) numbers, pinned numbers, comments, stickers, images, trendlines |
| Editor | Point-and-click | Every edit is a serializable command on one undo/redo history; drag annotations on the canvas; inline title editing; a pre-built settings panel |
| AI | Chat, chart suggestions | Six agents: chart maker, suggestions, mutate data, annotate, narrate (titles/captions), extract from unstructured text. Paid API |

**The crucial finding about "taking over from GitHub":**

- The GitHub repo `their public agent-skills repo` is MIT-licensed, but it contains **only documentation**: skill
  files that teach a coding agent how to use the SDK, six theme recipes, chart recipes, and a
  small demo bench. Two stars, three repos in the org, no engine source anywhere.
- The engine itself (`<their npm package>`, `<their npm package>`, `<their npm package>`) is
  **closed source**: compiled bundles on npm, no source maps, version `1.9.0-beta`, React 19 only,
  fifteen Tiptap peer dependencies, 3.7 MB unpacked. Licence in the package: PolyForm Noncommercial,
  PolyForm Small Business, or a 32-day trial. The docs say plainly: "Read licence and evaluation
  before you put a chart on a public page."
- So there is **no open-source chart engine to fork here.** What is genuinely reusable is the
  *design knowledge* in the recipes (colours, fonts, spacing rules, which storytelling primitives
  exist, how an editor should feel) and the mental model (spec-driven, serializable, command-based
  editing). That is exactly what we can copy without a licence problem. Colour values and layout
  rules are not protectable; brand names are ("Financial Times", "Braun", "Lenny's Newsletter" are
  their recipes' names, not ours to use).

**Should we build on their SDK?** My recommendation is **no**, for four reasons:

1. **Licence risk.** We qualify for Small Business today, but the moment the company grows past the
   thresholds, our renderer becomes a "contact us" negotiation with a competitor. That is the wrong
   dependency for the core of a product whose whole pitch is the chart.
2. **Our invariants.** Their engine computes inside the chart (aggregate, mean, smooth, stack,
   100%-fill). Our rule R6 says the renderer may not compute, round or omit anything; R11 says the
   provisional marker can never be hidden; R1 says every number traces to a cell. Proving those
   through a closed-source engine we cannot read is hard, and a beta engine can change under us.
3. **Closed source means we cannot fix bugs**, and we have already found and fixed several rendering
   defects in our own code this month (label overpainting, end-label collisions, margins).
4. **Cheapest mechanism first** (owner rule, session 88): the visual gap is mostly presentation, which
   we can close over our existing spec without a new engine or a new dependency.

One bounded exception worth a spike later: their **headless PNG renderer** and **data-import utils**
(CSV/TSV/XLSX/XLS/ODS to columns+rows) are the kind of thing we may want; but open-source
equivalents exist (SheetJS/`xlsx`, `papaparse`, `@resvg/resvg-js`), so even there the answer is
probably "no".

**The real open-source alternatives** if we ever replace Recharts for the general chart maker:
Vega-Lite (BSD-3, grammar of graphics, JSON spec, huge ecosystem) and Observable Plot (ISC, D3
authors, grammar-lite, very good defaults). Both are the "fork it from GitHub" option Competitor G is not.

---

## 2. Where we stand today (verified in the repo)

- **Engine:** Recharts 3, one `web/components/chart.tsx` of 4,257 lines. That size is the first
  sign that Recharts is being stretched beyond what it was made for.
- **Forms:** line, area, bar, horizontal bar, table. Plus small multiples and region-set bars
  (ADR 054/055).
- **Looks:** eight templates (Standard, Classic, Newsroom, Presentation, Social, Minimal, Warm,
  Earth) over about twenty presentation keys: line width, markers, grid, x-labels, axis lines, value
  labels, zero baseline, area fill, series colours, font, language, frame background/padding/
  corners/shadow/inset/aspect. Brand colours and a brand font via Brandfetch. Account-level default.
- **Storytelling:** the journalist headline (ADR 050), Insights (real outlier ranking), the Story
  stage (scroll-driven), click-to-annotate notes, hide/highlight series, zoom, the level-vs-%-change
  toggle, the alternate-reading toggle, curated event annotations on the homepage charts.
- **Output:** PNG, SVG, PDF (vector), transparent PNG, signed public embeds (frozen; Live gated).
- **Editor:** a config panel and an edit modal; no undo/redo; no inline title editing; no drag.
- **Data in:** CBS + Eurostat (E1, internal), user CSV/TSV upload built but dormant (WP202a), sheet
  link "coming soon".

We are ahead of Competitor G on **trust** (every number traceable, provisional markers, refusal, sourced
embeds) and on **official data built in**. We are behind on **breadth of chart forms, richness of
house styles, storytelling primitives, and editor feel.**

---

## 3. Gap table — what to adopt, in plain terms

| Area | Competitor G has | We have | Take over? |
|---|---|---|---|
| House styles | Six complete recipes: salmon-paper editorial, Rams minimal (warm greys, one orange), newspaper (white, ink-and-grey, one red), warm newsletter (cream, rounded, autumn ramp), neo-brutalist (near-black, dashed borders, acid green), op-art (magenta, concentric outlines) | Eight looks that mostly vary frame/gradient/line weight, all on the same type and grid vocabulary | **Yes — port the six as our own looks**, renamed. Needs new presentation keys (see Phase 1) |
| Typography in the chart | Display + body font pairing; title where key words take the series colour so the title is the legend | One font family; headline is plain text | **Yes** — colour-keyed headline words is a cheap, striking win |
| Paint control | Paper colour, panel rules top/bottom only, tick length, bar corner radius, legend pills, tooltip skin | Grid on/off, axis lines on/off, frame gradient | **Yes, selectively** — solid paper colour, panel rules, corner radius, legend style |
| Reference lines | Target line (user value), average line (computed), labels at start/end | none | **Yes** — average is a derived value with an R1 trace; a target is user content (own trust tier) |
| Difference arrow | Labels the gap between two points | none (the %-change toggle covers part) | **Yes** — the label is a registered derivation between two plotted cells |
| Era shading | A shaded band behind a period | none | **Yes** — user-set range, no numbers, presentation only |
| KPI headline number | "Total" or "current" big number above the chart | The journalist headline (a sentence) | **Partly** — a big-number variant of the headline, still built from plotted cells |
| Highlight with dimming | Predicate-based; everything else fades | hide/highlight series | **Yes** — dim instead of hide as the default emphasis |
| Editor: undo/redo | Every edit is a command; one gesture = one undo step; command log is serializable | Panel + modal, no history | **Yes** — our view-state is already a plain serializable object; a command log over it is small |
| Editor: canvas | Drag annotations, inline title editing, (+) menu on a hovered point | Click-to-annotate | **Later** — drag + inline title are worth it once undo exists |
| Chart forms | ~16 + plugins | 5 | **Yes, but only the honest ones**: stacked bar, 100% stacked, dot/dumbbell comparison, slope chart, scatter, heatmap (region × period), pie/donut for real shares of a complete whole. Not: radar, funnel, mekko, sankey, treemap (no CBS use case, and several invite dishonest readings) |
| Data import | CSV/TSV/JSON/XLSX/XLS/ODS, URL, paste, Google Sheets | CSV/TSV (dormant) | **Yes, for the general-chart-maker phase**: paste-a-table and XLSX via open-source parsers; Sheets link already planned |
| AI agents | Chart maker, suggest, mutate, annotate, narrate, extract | Intent parsing + phrasing only (principle a) | **No for CBS/Eurostat data** (principle a). For user-uploaded data: a later, measured phase only (cheapest-mechanism rule); "suggest a chart form" can be deterministic rules first |
| Export | PNG/SVG, slides, social sizes | PNG/SVG/PDF + embed | Parity; add social presets (1:1, 4:5, 9:16) when the aspect key already exists — it does |
| Pricing model | Free with logo, pay to remove logo + custom colours | Credits + Pro (live embeds) | **Reference only** — our attribution is a trust feature, not a paywall; keep it |

---

## 4. The plan — cheapest first, presentation before engine

Every phase below is "presentation over the unchanged spec" until Phase 5. Honesty locks (R1, R6,
R11) hold by construction because no phase before 5 touches how numbers reach the chart.

### Phase 0 — Rebrand (no chart work)
- Name graphmaker.studio, domain wiring, logo/wordmark, tagline. Suggested framing: **"Make the
  chart. The numbers are already checked."** with the USP line "Dutch (CBS) and European (Eurostat)
  official statistics built in — every number sourced." (Owner's earlier tagline "Turn your data
  into a story" can stay as the second line.)
- Docs: an ADR for the rename (name, domain, public claim: CBS/Eurostat-sourced, not "0%
  hallucination"), update open-questions #7 and #207, the i18n strings, embed attribution text,
  email sender, Vercel domain.
- Do NOT change chart technology in the same change. Rebrand and re-engine at once is how a
  session confuses itself.

### Phase 1 — House styles (1–2 sessions, zero running cost)
- Add the missing presentation keys: solid paper colour, display/body font pairing, panel rules
  (top/bottom/left/right on-off + weight), tick length, bar corner radius, legend style
  (text / pills), tooltip skin, title colour-keyed words.
- Port six looks under our own names, for example: *Salmon editorial*, *Studio minimal*,
  *Newspaper*, *Newsletter*, *Brutalist*, *Poster*. Each is a `PresentationOverrides` bundle like
  the existing eight, so account defaults, the honesty locks and exports all keep working.
- Template thumbnails and a gallery row on the landing ("one chart, six looks").
- Done when: every look passes the existing contrast gate in light and dark, PNG/PDF export is
  byte-stable per look, and the eight current templates are unchanged.

### Phase 2 — Storytelling primitives (deterministic, 2 sessions)
- Reference line: average (server-derived, traced) and target (user value, shown as user content).
- Difference arrow between two plotted points, label = registered derivation.
- Era shading (user range).
- Big-number headline variant.
- Dim-not-hide emphasis.
- All stored in the chart view-state (already serializable, already the embed's state).

### Phase 3 — Editor feel (1–2 sessions)
- A command log over the view-state: undo/redo, keyboard shortcuts, one gesture = one step.
- Inline title/subtitle editing.
- Drag to move annotations.
- This is what makes the product feel like a "studio" rather than a form.

### Phase 4 — More honest chart forms (2–3 sessions)
- In this order: stacked bar → 100% stacked → dot/dumbbell comparison → slope chart → heatmap
  (region × period) → scatter → pie/donut (only when the parts are a complete whole; refuse
  otherwise, same logic as RS1 for region sets).
- Each form ships with its honesty rule written down (when it is allowed, when it is refused).

### Phase 5 — Engine decision (an ADR, then possibly a spike)
- Trigger: chart.tsx past ~5,000 lines, or the first form Recharts cannot draw cleanly.
- Options: keep Recharts; our own SVG renderer over our spec (ADR 007 already says "server spec,
  dumb renderer"); Vega-Lite; Observable Plot. Not Competitor G (closed, licensed).
- A one-session spike renders the same three CBS charts in each candidate and compares
  output quality, bundle size, export fidelity, and how hard R6/R11 are to prove.

### Phase 6 — General chart maker (after the above)
- User data first-class: paste a table, XLSX/ODS, Google Sheets link (open-source parsers).
- A deterministic "suggest a chart form" (rules over column types), no AI call.
- Only then, measured on real usage: AI chart assistance for user data, as a separate trust tier.

---

## 5. What not to copy

- Their engine or SDK (closed source, licence flips at scale).
- Their theme names (brands).
- Logo-removal as the paywall: our attribution line is the trust feature.
- Radar/funnel/mekko/sankee charts: no official-statistics use case, several mislead.
- AI agents that mutate or narrate CBS data: breaks principle (a).

---

## 6. Open decisions for the owner

1. **Order:** house styles first (fast, visible) or new chart forms first?
2. **Engine spike:** allow a one-session comparison of Vega-Lite / Observable Plot / own SVG now, or
   keep Recharts until Phase 5's trigger fires?
3. **Rebrand scope:** name + domain + claim only, or also the "chart maker" story on the landing now?

## 7. Sources checked
- [competitor URL withheld] and /pricing (plans, prices)
- [competitor URL withheld] and [competitor URL withheld] (full docs index), /sdk-next/quickstart
- [competitor URL withheld]
- [competitor URL withheld] (cloned; MIT; docs only) and the org's three repos
- npm: `<their npm package>`, `viz-engine`, `react-renderer` 1.9.0-beta (downloaded; LICENSE.md +
  PolyForm texts read; compiled-only dist confirmed)
- Repo: ADR 007/039/042/043/047/053, `web/lib/chart-templates.ts`, `chart-presentation.ts`,
  `chart-view-state.ts`, `web/components/chart.tsx`, `docs/05-data-rules.md` R1/R6/R11

---

## 8. Owner steers given in chat, 2026-09-17 (same session — supersede the phase order above)

1. **Focus is chart quality now, not the rebrand mechanics or the engine question.** Phases 0 and 5
   above are parked; the owner did not want them raised.
2. **Chat-driven chart editing is the top priority and was never built.** Open-questions #212 was
   consciously deferred by the session-88 panel ("no LLM instruction schema in v1, wait for usage
   evidence"); the owner now overrides that deferral explicitly. Record this as the decision that
   lifts the parking, not as a drift.
3. **Two trust tiers, stated by the owner in plain words:** on the user's OWN data (upload, paste,
   sheet) people get full freedom — the AI may change type, style, filter, sort, group, derive
   columns, annotate, write titles and captions; no source rule, no refusals, no honesty caveats
   in the UI or in the docs discussion. On CBS/Eurostat data the same chat picks from the existing
   deterministic options and never touches a number (the USP, not a nuisance).
   **Assumption (mine, to confirm):** internet-sourced data (websearch augmentation, ADR 032) is
   treated like the user's own data — we make no source claim for it, so no source rules apply.
4. Owner's words: "we hoeven niet de hele tijd zo door te blijven zeuren erover" — stop restating
   the honesty rules for the own-data tier in every design.

Next deliverable: a spec for chat-driven chart editing, own-data tier first, CBS tier second,
one shared chat surface and one shared undo history.

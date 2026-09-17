> **Naming note:** the competitor studied here is referred to as "Competitor G" throughout; its real name, URLs, people and investors are deliberately withheld because this repository is public. The owner knows which company is meant (owner instruction, 2026-09-18).

# Competitor G deep dive — what graphmaker.studio should copy, beat, and avoid

**Written 2026-09-17.** Sources: hands-on in the logged-in Competitor G's app editor (the owner's account, the
existing "CO₂ emissions" chart; every test edit undone afterwards), Competitor G's app marketing pages and blog,
their docs site (agents API, editor panels, their chart config), the MIT `their public agent-skills repo` repo (cloned), the
npm packages (licence texts read), and a 102-agent fact-checked research run (20 sources, 19 confirmed
claims, 6 refuted). Supersedes the earlier "competitive read" file's sections 1–3; sections 4–8 of that
file (the phase plan and the owner's steers) still stand.

---

## 1. The product as it actually is (hands-on, 2026-09-17)

**Editor layout.** Left rail: New, Home, Search, Templates. A chart on a "device" frame in the middle.
Right rail, seven tools: **Ask AI · Graph · Fine tune · Design · Annotate · Size · Edit data.** Top right:
Export & Publish. Title, subtitle, caption and axis labels are edited **in place on the canvas** (click the
title → a small rich-text toolbar: heading level, bold/italic/underline, alignment, link).

**Graph** (one grid): Column, Stacked, 100% Stacked · Bar, Stacked, 100% Stacked · Line, Stacked Area, Pie ·
Donut, Scatter, Bubble · Funnel, Combo, Heatmap · Waterfall, Mekko, Table — 18 forms, one click each,
plus a "Data" drill-in.

**Fine tune** (accordion rows, every value a segmented control or toggle, never a free number):
- Line style: Show points (toggle) · Line curve Sharp/Smooth · Line thickness Auto/Custom
- Detail: Data labels (toggle) · Grid lines (toggle) · Missing values (dropdown: "Leave gap in chart", …)
- Headline number: Visible (toggle)
- Horizontal axis: Visible · Labels Auto/Edges
- Vertical axis (same shape)
- Legend: Top / Right / None
- Number format: Abbreviation Auto/None/Custom · Decimal places Auto/Custom

**Design:** Theme Light/Dark · Palette with three tabs **Preset / Brand / Freestyle** (Freestyle = per-series
colour + line style; **gated to Plus**) · Background · Border · Logo (**Plus**) · Text size (1x, a
multiplier) · Font.

**Annotate:** Freeform **Text · Arrow · Box · Difference** (a difference arrow between two points) ·
**Goal** (toggle + value) · **Trends and Averages** (Trend toggle, Average toggle) · **Highlight** (pick a
point; each highlighted value listed with a remove button) · Title & Subtitle · Caption & Source.

**Size:** presets Google Slides/PowerPoint 16:9 · Web/email 3:2 · LinkedIn 1.91:1 · Instagram 1:1 ·
TikTok/Instagram story 9:16 · X 16:9 · Mobile 9:16 · custom px (944×600 default).

**Edit data:** a spreadsheet modal with the chart-type grid beside it, "Swap rows and columns", "Clear table".

**Export & Publish:** "their badge" toggle (**removal = paid**), Export image at 1x/2x/… (Copy or
Download), **Generate link** (share/embed in Notion etc.) with "Viewers can make a copy", **Embed code**
with "Fit to container", chart options "Disable animation".

**New chart page:** "Create a chart" with **Connect Google Sheet · Upload Excel · Upload CSV · Paste data ·
Generate dataset · Start from scratch**, then "Examples" (one per chart form) and "Previously imported
data". **Templates page:** the same examples plus four *storytelling* templates whose titles are the
insight: "MRR grew 5x", "Achieved a NRR of 120%" (with a 🎯 120% goal marker), "Increased activation by
10%", "Organic traffic's share has decreased by 15%".

**Free tier as experienced:** banner "You have used 2 of your 5 chart limit", badge on every export,
Freestyle colours and Logo locked, AI works but is "limited".

## 2. Ask AI, tested with five real prompts on the owner's chart

| Prompt | What happened |
|---|---|
| "Make the line thicker, show only 1950 onwards, and add a note at the peak saying 'record high'" | ~12 s. A "Working on data…" spinner, then a **recipe**: "Here's how I built this chart: ✓ Filtered [Year] ≥ 1950". Then in prose: "**I can't change the line thickness directly.** If you'd like to request this as a new feature…". The note was silently ignored. **Regression:** the data step rebuilt the dataset from "Imported data" and **un-hid three series** (United States, China, UK) the chart had not been showing. |
| "Show only World" | Recipe: "✓ Selected [Year] and [World] for visualization". Fixed the series, but **dropped the ≥1950 filter** again (x-axis back to 1750). Each step is stateless. |
| "Turn it into a bar chart with a goal line at 4 tonnes" | Recipe: "✓ Chose a [bar chart] to show the data" + prose "I've added a goal line at 4 tonnes." Both applied. |
| "Add an arrow annotation at the highest point saying 'record high' and highlight that point" | "**It seems I couldn't add the arrow annotation or highlight the highest point.** … you can request this as a new feature." Nothing applied. |
| "Rewrite the title as a short insight headline and add a caption naming the source Our World in Data" | Title → "CO₂ emissions per capita reach a historical peak"; caption "Source: Our World in Data" added. Document renamed too. |

**The chat surface itself:** one input ("Show me"), messages as bubbles; each assistant reply has a
**recipe** (steps as chips carrying the same icons as the panels: a table icon for a column, a chart icon
for the chart type), prose for what it could not do, a 👍/👎 pair, and per-message **Undo (×) and Retry
(↻)**. Undo is strictly last-message-first (only the newest message shows ×). **Undo bug found:** after
undoing all five edits the data, series and goal line came back, but the canvas title stayed at the
AI-written headline and the caption was gone; I restored the title by hand.

**What this tells us.** In the consumer app the AI reliably does *data selection* (filter, series, chart
type), *goal/reference lines* and *narrative text*. It does **not** do styling (thickness, colours),
annotations or highlights through chat — those are click-only, and the AI says so in prose. Steps are
stateless, so a multi-step conversation can lose earlier edits. Their own blog says why: "Sometimes it's
just more efficient to click a button than type out 'Switch to a heatmap'" — the chat is a co-pilot
**next to** the panels, not a replacement, and they plan "a stronger connection between the editing
controls and chat interface".

## 3. How it works underneath (their docs site, verified)

- **Stateless config-in/config-out.** Every agent call is `POST /api/v0/<agent>` with `{ config: their chart config,
  userPrompt, metadata? }` and streams SSE `progress` → `complete { config, response: { message, steps?[] } }`.
  The returned config is what the renderer draws; `steps` is the recipe. Prompt cap 10,000 chars; effort
  low/medium/high; locales EN_GB/EN_US/AR/PT_PT.
- **Six LLM agents + one deterministic one:** generate (chart maker), suggestions (≤4: chartType +
  dataPrepPrompt + summary), mutate (filter/group/aggregate/derive/sort → a new dataset in the config),
  annotate, narrate (title/subtitle/caption as TipTap JSON), extract (dataset from text/image/PDF/sheet),
  and **evaluate: "a rule-based scorer with no language model"** that scores only the data and returns
  every chart type ranked with `verdict ok|disqualified` and typed factors (deal-breaker, pro, con, …) each
  with a weight and a reason.
- **AI chart-type union = 20 types**, no map/choropleth anywhere; the SDK adds radar/area but the agents
  cannot target them. Their own Vega-Lite comparison post admits "No small-multiples layouts, no map
  projections."
- **The their chart config vocabulary** (legacy reference): `type`, `options` (thickness, smooth, sorting, points),
  `axes` (labels, min/max, grid), `legend`, `appearance` (paletteId, seriesStyles, border, rounded corners,
  textScale, numberFormat, tooltips, animate), `content` (title/subtitle/caption, source {label,url},
  isBrandMarkHidden), `headlineNumbers` (show, compareWith, size), `dataLabels`, `referenceLines` (goal,
  trend), `annotations` (stickers, tooltips, highlights, text, arrows, shapes), `themeOverrides`.
- **The new SDK (sdk-next)** is a grammar of graphics (geoms point/line/area/bar/rule/tile; scales; coords
  cartesian/flip/polar; stats count/sum/mean/smooth; transforms filter/sort/aggregate/reshape), a
  **serializable stylesheet** with tokens/defaults/overrides and predicate-scoped rules (`where`, `state:
  dimmed|hovered`), **highlights** (predicate → everything else dims), **eight annotation kinds**
  (differenceArrow, shape, arrow, text, image, sticker, pinnedNumber, comment) with anchors that re-resolve on
  resize, ten **slots** to replace chrome, and an **editor where every edit is a serializable Command on one
  undo history** (transient dispatch + `seal()` = one gesture, one undo entry; commands carry an `author`).
- **Licence reality vs marketing.** npm packages ship PolyForm Noncommercial / Small Business (<100 people
  and <~$1M revenue) / 32-day trial; the homepage only says "free for non-commercial use, contact us for
  commercial". Closed source, no source maps, 1.9.0-beta, React 19 + 15 Tiptap peers, 3.7 MB. The
  "skills" repo is MIT but is documentation only.

## 4. Design knowledge worth lifting (licence-free)

**Six house styles** (colour and font constants in the recipes; names are theirs, values are not
protectable): salmon-paper editorial (`#FFF1E5` paper, claret `#990F3D`, Oxford blue `#0F5499`, serif
display + sans body, rules top/bottom only, **headline words coloured like their series so the title is
the legend**); Rams minimal (warm greys, ink bars, one orange `#F07E13` "indicator, never a series", no
grid); newspaper (white plates, ink + greys, one red `#D72B1C` reserved for the key observation); warm
newsletter (cream `#FFF3EA`, 28 px radius, orange `#F5820D` leading an autumn ramp, Plus Jakarta Sans);
neo-brutalist (near-black `#171717`, dashed 1 px frame, acid `#C8FF00` for data only, Space Grotesk
uppercase); op-art (magenta lead, concentric outline geoms).

**Their chart-design rules** (blog, "How to make a chart look attractive"): one story per chart; titles
as takeaways; one or two headline numbers; aspect ratio chosen for the destination; one accent colour, rest
neutral; highlight one element and desaturate the rest; one or two annotations beat a paragraph; informal
font for annotations so they read as commentary; difference arrows for change; goal lines for context;
legend on the right; direct labels instead of a legend where possible; monochrome ramps for many series;
straight lines for precision, smooth for gentle trends.

**Their storytelling ladder** (blog, "How to do data storytelling"): question → default chart → declutter
(softer colours, less axis, quieter grid) → conclusion-driven title → highlight the one trend → annotate
the change → add narrative context. Stacked bars for missed goals vs targets; 100% stacked for share
shifts; line + emphasis for one declining segment.

**Company facts** (their own posts): a failed full-stack analytics platform burning ~$200k/month, a
pivot to "their "Lite" relaunch" in January 2023 (one problem: pretty charts fast), 50k users in 10 months, 150k by
April 2025, "300,000+" claimed now; backed by four well-known VC funds. Product Hunt
4.9/5 over 12 reviews; complaints are small (tile locking, no Notion database connector, "not for super
complex data"). Their stated lesson: "Less is more… the product was too damn complex."

## 5. Where we already win, where we lose

**We win on:** provenance (every number → a cell, provisional markers, refusals); official data built in
(they have "Generate dataset" by AI, which is the opposite of sourced); region sets and multi-region
series where they have no map and no small multiples; live-proof URLs; exports without a vendor badge.

**We lose on:** breadth of forms (5 vs 18); the number of one-click storytelling primitives (goal line,
trend, average, difference arrow, box, arrow, headline number — we have headline + notes + insights);
house-style richness; in-place title/caption editing; per-message undo/retry; size presets for social;
"Generate link" for Notion-style embeds (we have embeds, not the one-click Notion flow); and of course
**chat editing, which they ship and we do not.**

## 6. What to build — chat editing, informed by what actually works there

Copy the shape, fix the two things that failed in the hands-on test.

1. **Same closed vocabulary for chat and panel.** The chat may only produce values the panel already
   offers (our `ChartPresentation` keys + form + period range + hidden/highlighted series + template +
   colours + annotation text + title/caption). That is why their recipe chips can reuse panel icons — one
   vocabulary, two doorways. Where they say "I can't change the line thickness", we can, because thickness
   is a panel option for us already.
2. **Stateful, not stateless.** Their steps rebuild from the imported data and lose earlier edits. Ours
   applies a *diff* onto the current view-state, so "show only Utrecht" after "from 2010" keeps both.
3. **The recipe is the reply.** Every AI turn returns steps (chips) + one prose line for anything refused;
   the refusal names the click path ("use Annotate → Arrow") instead of "request a feature".
4. **Per-message Undo and Retry, plus a real command log** (their SDK has it; their app's undo lost the
   title). One gesture = one undo entry, keyboard ⌘Z, and the log is what the embed stores.
5. **Two tiers, one surface** (owner steer 2026-09-17): own data → everything allowed, including
   aggregate/derive/sort like their mutate agent; CBS/Eurostat → selection only, numbers never pass
   through the model. Internet findings never become chart data (ADR 032), so no third tier.
6. **A deterministic chart-fit scorer** like their `evaluate` (rules over column types, ranked with
   reasons) drives "suggest a chart form" with zero LLM cost — the cheapest-mechanism rule, and it doubles
   as the honesty gate for pie/stacked (disqualify when the parts are not a complete whole).
7. **Narrate on request** (title/caption rewrite) is the one place the model writes text; every digit in
   it must be a plotted value (our R1 scan already enforces this for headlines).

**Then the storytelling primitives their panel has and ours lacks, in this order:** goal line → average
line → difference arrow → highlight-with-dimming → box/era shading → headline number → arrow/text
callouts with an informal font. All presentation over the unchanged spec.

**Then forms:** stacked, 100% stacked, dot/dumbbell, slope, heatmap, scatter, pie/donut (gated by the
scorer). Not funnel, waterfall, mekko, radar, sankey.

**Then house styles:** six looks ported under our own names, colour-keyed headline words, size presets.

## 7. What not to copy

Their SDK (closed, licence flips at scale); their theme names; the free-tier watermark as a business
model (our attribution line is the trust feature); "Generate dataset" (AI-invented data is the thing we
exist to prevent); stateless AI steps; annotations that the AI cannot reach.

## 8. Second hands-on pass (same day) — themes, canvas annotations, undo

- **Themes in the app are palettes, not house styles.** Design → Palette → Preset offers twelve
  families (Colorful, Pastel, Neon, Blue, Cyan, Green, Yellow, Orange, Red, Pink, Purple, Grey), each a
  3-colour ramp, plus Light/Dark, a per-series colour (10 fixed hexes: #B399FD #FC8497 #FBBC30 #279EFF
  #E83562 #40F8FF #F38650 #C82184 #31FCB4 #6D48D2) with Solid/Hatched fill, Background, Border, Logo
  (paid), Text size, Font. The rich editorial "house styles" (salmon paper, Rams, newspaper, newsletter,
  brutalist, op-art) exist **only in the SDK recipes**, not in the consumer app — so a homepage row of
  real house styles is something the app itself does not show today.
- **Canvas annotation UX.** Text: one click drops a draggable "Text" box on the chart with a floating
  toolbar (colour, text style, size, weight, alignment, delete). Difference: one click auto-inserts a
  difference arrow between the last two categories with the computed "+13.41%" — no picking, it guesses
  the pair. Arrow/Box behave like Text. Highlight lists highlighted points with a remove button.
- **⌘Z does nothing for canvas/panel edits.** Undo exists only per chat message. Their app has no
  global history; their SDK does. Our phase 1 (one command log for all doorways) is therefore ahead of
  their shipped app, not just level with it.
- Presenter mode (▷ next to Export) not reached in the narrow pane; low priority.
- Accidental side effect: opening the home page in the narrow layout hit "+ Chart" and created
  "Example column chart" (3 of 5 slots used). It carries a Text box and a Difference arrow from the
  tests; deleting it is the owner's call.

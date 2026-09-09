# Chart type picker — what users expect (research brief for WP218 phase 5)

Scope: web research only, no code changes. This answers the "research read-back" step
listed for WP218 phase 5 in [08-build-plan.md](../08-build-plan.md) ("Research
brief on what users expect... then the build"). It looks at how established chart tools let
people pick a chart type, and — the part that matters most for this product — how they
handle chart types that do NOT fit the data in front of the user.

Grounding in the current code: today's chart card is `web/components/chart.tsx`. It already
has exactly the pattern this brief ends up recommending, just for a 3-way choice: a
`role="tablist"` segmented control (`ChartForm = 'line' | 'bar' | 'table'`,
`web/lib/chart-view-state.ts`) where the Line tab is disabled with `disabled`, a `title`
tooltip, and a screen-reader-reachable reason (`aria-describedby` pointing at a hidden
paragraph) when `lineFormAllowed()` returns false for a multi-region comparison. That one
disabled-tab case is CheckDeCijfers' own working example of "Tableau's Show Me, in miniature."
The recommendation below is to grow that same mechanism, not to bolt on a second, different
control.

---

## 1. What users expect — 10 lines

1. They expect to see the choice, not hunt for it — a visible control near the chart, not buried in a menu.
2. They expect the tool to have already picked a sensible default (today: line for time series, bar for comparisons) and only ask them to change it if they want something else.
3. They expect "recommended" or "suggested" options to be visually first/separated from the full list (Google Sheets, Excel, Grafana all do this).
4. They expect a live preview of the switch, not a blind commit — seeing the shape change before/as they choose.
5. They expect chart types that plain don't fit their data to be visibly present but unavailable (greyed out), not silently missing — Tableau's Show Me is the clearest example: every icon stays visible, unusable ones just grey out.
6. They expect a reason when something is greyed out — even one line ("needs a date field", "needs two numbers") — not just a disabled look with no explanation.
7. They expect their other settings (colours, line thickness, labels) to carry over when they switch type, not reset — Excel users complain loudly on forums when this breaks.
8. They expect a small number of choices (2–6) to be all visible at once (segmented control / icon row); once the list gets longer they expect a dropdown or grid instead, not a longer row of buttons.
9. They expect icons to be labelled, not icons alone — a bare pictogram is genuinely ambiguous between "bar" and "column" or "area" and "line" at small size.
10. They do NOT expect to be taught chart theory — they expect the tool to have already silently removed chart types that would misrepresent data of this shape (a well-designed picker never even offers a pie chart for a 12-year time series); "why isn't X here" only needs an answer for borderline cases, not a lecture for every excluded type.

---

## 2. Comparison table

| Tool | Control type | Grouping | How an incompatible type is shown | Live preview |
|---|---|---|---|---|
| **Tableau (Show Me)** | Icon grid (fixed panel, ~24 icons) | Flat grid, one recommended type gets an orange outline | **Greyed out**, stays visible; hover shows the minimum fields it needs ("2+ measures", "a date field") | Yes — full chart redraws on click |
| **Datawrapper** | Icon grid with text labels, chosen from a "Chart type" step | Not by data-fit — by communication goal in their own guide (time, shares, correlation, flow, geography); the picker itself lists all types, filtering is left to the user's judgement, though a workspace admin can permanently **hide** types org-wide (Custom/Enterprise "Rules" setting) | Types Datawrapper's own guide calls out as risky (pie/donut for anything but a simple share, grouped bars for total comparisons) are not blocked in the UI — they're discouraged in documentation, not disabled in-app. UNCONFIRMED whether the picker itself greys anything out based on the loaded data (search results did not show this explicitly). | Yes — real-time preview pane next to the picker |
| **Google Sheets** | Dropdown, opened from the chart editor's "Chart type" field | **"Suggested" section first** (data-fit ranked), then flat categories below (Line, Area, Column, Bar, Pie, Scatter, …) | Everything stays selectable — Sheets doesn't grey out or block any type, it just doesn't suggest bad fits; picking a mismatched type (e.g. pie on 10 numeric columns) is allowed and just renders badly | Yes — the chart on the sheet updates immediately |
| **Excel (Recommended Charts)** | Dialog with two tabs: "Recommended Charts" (thumbnails, ranked) and "All Charts" (full list) | Recommended tab is a short ranked list computed from the selected range's shape; All Charts is the complete, ungated catalogue | No greying — "Recommended" is additive guidance, "All Charts" hides nothing; user can always pick anything | Yes — large live preview per thumbnail before inserting |
| **Grafana** | "Suggestions" panel (thumbnails with full-size preview) + a "All visualizations" escape hatch | Ranked suggestions driven by the data-source's field/frame types, most-likely-useful first | Doesn't grey out panel types — visualizations unsuited to the current data simply aren't suggested; the full catalogue is still one click away and always enabled | Yes — each suggestion is a real, fully rendered mini-preview of your own data |
| **Metabase** | Icon list/menu in a side panel | Not clearly grouped as "recommended vs. other" — this is an acknowledged open complaint (Metabase's own GitHub issues #3863, #11861) about the fade-out approach being confusing | **Greys out / fades** options it judges unsuited (e.g. "Number" or "Gauge" on a raw, ungrouped table) — but Metabase's own contributors flag this as a UX problem: users don't realize a faded option is still clickable, and clicking one can break the view. This is the "what not to copy" example. | Yes when a valid type is selected |
| **Vega-Lite / Observable Plot editors** | Code-first (a `mark` property: `bar`, `line`, `area`, `point`, `tick`, …); no picker UI at all in the base grammar — galleries exist as example collections, not an in-tool "not applicable" gate | N/A — no discovery UI; the developer chooses the mark type in code and the grammar will happily render a nonsensical encoding (no built-in "greying") | Not applicable — no picker exists to greek anything out; the burden of "does this mark suit this data" is entirely on the person writing the spec | Only via a separate editor (e.g. the Vega-Lite online editor), not the grammar itself |
| **Recharts / config playgrounds (e.g. tillitsdone.com/tools/rechart)** | UNCONFIRMED exact control (the page's static text didn't expose it to the fetch used here) — this class of tool is generally a tab or dropdown switch between a fixed list of chart components (Line/Bar/Area/Pie/etc.), each mapped 1:1 to a Recharts component, with a live-updating preview and a matching generated code snippet | Flat list, all always enabled — like Vega-Lite, a config playground has no real "your data" to judge fitness against, so it never disables anything | Not applicable / UNCONFIRMED — these tools are built for exploring the library's own API surface, not for guarding against a specific dataset's shape | Yes — that is the playground's entire purpose |

---

## 3. Recommendation for CheckDeCijfers

### Control type: keep ONE control, grow it — don't add a second

Recommendation: **extend the existing `role="tablist"` segmented control**, don't bolt a
separate dropdown next to it. The product's whole "more chart types" list is small by design
— pie/donut/stacked/scatter/ranked/cross-region-line are permanently off the table (data-honesty
rules), so even after adding everything honest the list tops out around 5 items:

**Line · Area · Bar · Horizontal bar · Table**

Five items is exactly the range (2–6) where UX guidance says a segmented control beats a
dropdown: every option stays visible, switching is one click, and — most importantly for
this product — a **greyed-out button with a visible reason is only possible when the option
is drawn on screen**. A dropdown that hides the disabled option inside a closed menu buries
exactly the information ("this is refused, and here's the one-line reason") that the
data-honesty rule most wants the user to see. Datawrapper, Google Sheets and Excel can afford
a dropdown/dialog because their menus run into the dozens of chart types; this product's
honest menu never will.

If usage data later shows people want still more honest types and the row gets crowded (say,
past 6), the fallback is Excel/Grafana's pattern: a short "Recommended" row of the 2–3 most
likely fits, plus a "More" affordance that opens the rest in a small grid with the same
greyed+reason treatment — never a plain unstructured dropdown list.

### Ordered option list

1. **Line** — time series, one or more series (today's default for `spec.kind === 'line'`).
2. **Area** — new, honest addition: single-series only, forced zero baseline (per the
   product's non-negotiable rule); disabled/hidden whenever more than one series is present,
   since a stacked or overlapping multi-series area draws a total no cell backs — exactly the
   stacked-area refusal already fixed as non-negotiable.
3. **Bar** — comparisons across regions/categories, always zero-baselined (today's default
   for `spec.kind === 'bar'`).
4. **Horizontal bar** — new, honest addition: same data as Bar, rotated; the natural choice
   once category labels (e.g. long municipality names) are the limiting factor. Recommend
   auto-suggesting this one instead of Bar when label length crosses a measured threshold —
   mirroring Google Sheets'/Excel's "suggested first" pattern — rather than asking the user to
   discover it.
5. **Table** — the existing, always-available fallback (today's `state.form === 'table'`).

"Markers only" / dot plot: keep it OFF the shipped list for now. It doesn't have a clear,
distinct honest use case beyond what Line-with-visible-points or a small-multiples view
already covers in this product, and the "cheapest viable mechanism first" rule argues against
shipping a fifth-plus option without measured demand. Note it in open-questions as a possible
phase-2 addition if users ask for it specifically (e.g. wanting to see individual points
without a connecting line implying interpolation between sparse periods).

### How to present a type refused for THIS dataset vs. refused for EVERY dataset

These are two different situations and should look different, matching the distinction
Tableau (this-dataset) and Datawrapper's own guide (every-dataset, handled by never offering
it at all) already draw:

- **Refused for this dataset only** (e.g. Area with 2+ series, Horizontal bar when it isn't
  yet needed, Line for a multi-region comparison — the case already built): **show the tab,
  grey it out, disable it, and give a one-line reason** — exactly today's `LINE_DISABLED_REASON`
  pattern: `title` for pointer users, `aria-describedby` pointing at a visually-present or
  visually-hidden explanatory line for keyboard/screen-reader users, `disabled` (not just
  `aria-disabled`) since this is a genuinely inert control state, not a toolbar item that
  still needs to be reachable. This matches Tableau's Show Me almost exactly and is the
  pattern users already parse correctly ("I see it, I see why not, I can still find it if the
  situation changes").
- **Refused for every dataset, permanently** (pie/donut, stacked bar/area, scatter,
  sorted/ranked bars, connected cross-region lines): **do not list it in the picker at all.**
  This mirrors how Google Sheets and Grafana handle types that are simply the wrong shape for
  the tool's purpose — they aren't shown fighting for attention next to real options. Offer a
  single, collapsed, low-emphasis note near the picker — a small "Why not pie or stacked
  bars?" disclosure (a `<details>` or an info icon with a short popover) — with one or two
  plain sentences: "These would draw a share, a total, or a ranking that no single CBS cell
  backs, so we don't offer them." This satisfies curious users without permanently spending
  screen space or looking like a real, just-currently-broken option (the Metabase mistake:
  their own contributors flagged that faded-but-clickable options confuse people into thinking
  they're a live, degraded choice rather than "never available here").

### How the existing Line/Bar/Table segment and the new picker relate

**One control, not two.** The current tablist already IS the mechanism this brief recommends
— `role="tablist"`, `aria-selected`, arrow-key navigation, a disabled tab with a reason. The
work for WP218 phase 5 is:

1. Add two more tabs (Area, Horizontal bar) to the same tablist, in the ordered position above.
2. Extend `ChartForm` (`web/lib/chart-view-state.ts`) from `'line' | 'bar' | 'table'` to
   include `'area' | 'horizontal-bar'`, and extend `lineFormAllowed`-style guard functions
   (one pure predicate per new type, same shape: takes the spec + series count, returns
   whether it's honest for this data) rather than scattering conditionals through the render.
3. Keep exactly one disabled-reason string per guard (mirroring `LINE_DISABLED_REASON`), so
   every "refused for this dataset" case reads and behaves identically.
4. Add the single collapsed "why not pie/stacked" note once, outside the tablist, not
   per-tab — it answers a different question ("why isn't this here at all") than the
   per-tab reason ("why is this here but disabled").

No second control, no separate "more chart types" dropdown layered on top of the segmented
tabs — that would split one decision ("how should this be drawn") across two UI elements and
contradict the "keep options visible, not buried" expectation from section 1.

### What happens to other settings on switch

Every tool surveyed that has real per-chart styling (Excel, Datawrapper, Grafana) either
carries formatting across a type switch by default or offers an explicit way to reapply it
(Excel's chart templates) — losing colours/thickness on a type change is a well-documented
user complaint, not an accepted norm. For this product: WP218 phase 1's `presentation`
overrides (`web/lib/chart-presentation.ts`) are already stored independently of `form` in the
view-state reducer, so switching Line → Area → Bar should keep colours/thickness/grid
settings untouched by construction — the resolver only ever reads `presentation`, never
`form`, for those values. The one exception the render must keep enforcing regardless of
which type is active: the zero-baseline and the R11 provisional-marking lock, which are
data-honesty invariants, not stylistic choices, and must never be user-overridable no matter
which of the five types is on screen.

---

## 4. Sources

- Tableau, *Use Show Me to Start a View*: https://help.tableau.com/current/pro/desktop/en-us/buildauto_showme.htm — greys out unsuited views, hover shows minimum field requirements, recommended type gets an orange outline.
- Tableau Show Me community/reference confirming the grey-out behavior: https://community.tableau.com/s/question/0D54T00000C6HZySAN/show-me-is-all-grayed-out-except-table and https://www.tutorialspoint.com/tableau/tableau_show_me.htm
- Datawrapper Academy, *How to disable certain visualization types for your team*: https://academy.datawrapper.de/article/270-how-to-disable-certain-visualization-types-for-your-team — org-wide hide via workspace "Rules" (Custom/Enterprise only).
- Datawrapper Blog, *A friendly guide to choosing a chart type*: https://www.datawrapper.de/blog/chart-types-guide — communication-goal grouping; explicit "ignore pie for this goal" / "don't use grouped bars for totals" guidance.
- Datawrapper Academy, *Understanding data column types*: https://academy.datawrapper.de/article/84-data-column-types
- Coupler.io, *How to Create a Chart or Graph in Google Sheets*: https://blog.coupler.io/how-to-make-a-chart-in-google-sheets/ — confirms the "Suggested" section appears first in the Chart type dropdown, followed by flat categories.
- Microsoft Support, *Create a chart with recommended charts*: https://support.microsoft.com/en-us/office/create-a-chart-with-recommended-charts-cd131b77-79c7-4537-a438-8db20cea84c0 — Recommended Charts tab + All Charts tab, live thumbnail previews.
- FM Magazine, *Using Excel's Recommended Charts feature*: https://www.fm-magazine.com/issues/2025/may/excel-using-the-recommended-charts-feature/
- Grafana Labs, *Visualization suggestions updates*: https://grafana.com/whats-new/2026-01-22-visualization-suggestions-updates/ — suggestions ranked from data-source field/frame metadata, full-size live preview, "All visualizations" escape hatch, no greying-out of the full catalogue.
- Grafana docs, *Visualizations*: https://grafana.com/docs/grafana/latest/visualizations/panels-visualizations/visualizations/
- Metabase GitHub issue #3863, *Don't fade out visualization options so aggressively*: https://github.com/metabase/metabase/issues/3863 — the "recommended vs faded" design debate, in Metabase's own words.
- Metabase GitHub issue #11861, *Selecting a greyed out visualization can break the interface*: https://github.com/metabase/metabase/issues/11861 — cited as the cautionary example (faded-but-clickable causes user confusion and real bugs).
- Vega-Lite docs, *Mark*: https://vega.github.io/vega-lite-v1/docs/mark.html and the example gallery: https://vega.github.io/vega-lite/examples/ — code-first mark selection, no in-tool fitness gating.
- Recharts config playground: https://tillitsdone.com/tools/rechart/ — UNCONFIRMED exact control widget; the fetched page text did not expose the picker's interaction details, only that it offers "intuitive controls" over chart settings with live preview.
- W3C WAI-ARIA APG, *Radio Group Pattern*: https://www.w3.org/WAI/ARIA/apg/patterns/radio/
- W3C WAI-ARIA APG, *Toolbar Pattern* (icon-button groups, `aria-label`, disabled handling): https://www.w3.org/WAI/ARIA/apg/patterns/toolbar/
- MDN, *ARIA: radiogroup role*: https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Roles/radiogroup_role
- eBay open source, icon-button accessibility guidance (icon needs a text alternative, never icon-only meaning): https://opensource.ebay.com/evo-web/components/icon-button/accessibility
- Mobbin, *Segmented Control UI Design*: https://mobbin.com/glossary/segmented-control — 2–6 option guidance, "all options equally important and visible."
- UX Movement, *Why Segmented Buttons Are Better Filters Than Dropdowns*: https://uxmovement.com/buttons/why-segmented-buttons-are-better-filters-than-dropdowns/
- Excel chart-formatting persistence discussion (chart templates preserve formatting across a type change; default behavior can lose it without one): https://www.exceldemy.com/how-to-keep-excel-chart-colors-consistent/ and https://techcommunity.microsoft.com/t5/excel/how-can-i-stop-excel-from-changing-the-colors-of-my-chart/td-p/80475

Internal (not web sources, cited for grounding): `web/components/chart.tsx` (the existing
tablist + `LINE_DISABLED_REASON` pattern), `web/lib/chart-view-state.ts` (`ChartForm`,
`lineFormAllowed`), `docs/08-build-plan.md` WP218 phase 5, `docs/05-data-rules.md` (R1/R5/R6/
R9/R10/R11, referenced by name in the build plan for the permanent refusals and the
provisional-marking/zero-baseline locks).

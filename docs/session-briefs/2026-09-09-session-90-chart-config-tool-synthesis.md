# Session 90 — chart configuration tool (#218): architecture panel synthesis

**Provenance.** Produced 2026-09-09 (session 90) by the Workflow `chart-config-tool-architecture`
(script persisted under the session directory as
`workflows/scripts/chart-config-tool-architecture-wf_f9fec7f2-fb6.js`; a copy of the design
angles/briefs is in [docs/session-briefs/2026-09-09-session-90-chart-config-tool-panel-script.md]
(2026-09-09-session-90-chart-config-tool-panel-script.md)): four independent Fable design agents
(angles: presets-only, per-chart-panel, saved-defaults-and-types, spec-seam) followed by one Fable
synthesis agent that re-read the code where the four disagreed. 5 agents, 1,014,545 subagent tokens,
180 tool calls, 19.5 minutes. Owner-requested shape (open-questions #218): the same 4-angle panel +
synthesis as session 88's chart-editing panel (ADR 038's origin).

**Status.** A PROPOSAL awaiting the owner's decisions A–H in §0 below — nothing here is built or
decided. Same status as the session-88 synthesis was before ADR 038. The reviewable artifact version
of this document is linked from open-questions #218.

**Verified by the session before handing over (not by the panel):** the session-89 chart controls
really are Dutch (`Lijn/Staaf/Tabel`, `Vanaf/Tot`, `Kleine grafieken` — `web/components/chart.tsx`);
`renderChartSvg` has only test callers (`grep -rn renderChartSvg src web --include='*.ts*'`);
`chart-download.tsx` rewrites only `stroke`/`fill`/font attributes (its `inlineComputedPaint`), so
`stroke-width` and geometry travel verbatim into exports; `chart-small-multiples.tsx` draws
`dot={false}` (the R11 small-multiples gap the synthesis flags is real).

---

## 0. Decisions the owner must make

**A. Language of the new controls: Dutch (matching the chart card's own Lijn/Staaf/Tabel, Vanaf/Tot, Kleine grafieken controls) or English (the session-84 convention for new UI chrome).** The chart card is the one component where both rules now collide: its controls shipped in Dutch on 2026-09-08, after the English-for-new-chrome decision, and the CBS chart audience is Dutch newsrooms. Recommended default: one language per component — Dutch here — unless you want the session-89 chart controls swept to English in the same change (CLAUDE.md calls such a sweep a separate explicit task, so that is a real choice, not a default).

**B. Whether a user may change series colours at all, given your session-87 "stock Recharts palette" decision.** Every option in this plan is colour-free (line weight, markers, grid, axis lines, label angle, value labels, baseline), so the default look and house rules 1/3 are untouched by construction. Recommended default: no colour controls in Phase 1; if you want any, Phase 2c offers *curated palettes only* (the stock set as default, the retired #197 colour-blind-safe set and a grey set as choices — each hand-checked in both themes), never a free colour picker (a per-pick contrast check is impossible to apply consistently: the stock palette's own `#ffc658` fails on white).

**C. How far a choice extends: per chart for this session (Phase 1), then "use this for all my charts (this browser)" via localStorage (Phase 2a), a database preference row only on a later trigger (Phase 3).** localStorage costs nothing, needs no migration, covers signed-in chat, the anonymous trial and Ontdek alike, and is the theme toggle's own precedent; its one visible limit is that phone and laptop do not share it — the button must say "(deze browser)". Recommended default: exactly that ladder; the DB row is built only when the saved-charts gallery (#60/#159) ships or someone explicitly asks for cross-device defaults.

**D. Which extra chart types are offered, and whether curve smoothing is.** Recommended: Phase 1 adds none (line/bar/table stay); Phase 2b adds two *variants inside the panel*, not new tabs — horizontal bar for region comparisons (long gemeente names) and filled area for a single-series time series with a forced zero baseline. Pie, stacked bar/area, scatter and sort-by-value are refused for the invariant reasons in §4 and are not rendered at all; curve smoothing stays off (linear only) — `natural`/`basis` overshoot or miss the plotted points, `step` asserts "constant within the period", and `monotone` is the one arguable case, deferred until anyone asks.

**E. What happens to a user's presentation choices when the visual dock swaps the spec on the same mounted chart.** ADR 038's reducer deliberately keeps `form` across such a swap ("a look is valid for any spec"); this plan does the same for presentation overrides and re-checks every honesty lock against the new spec on every render. Recommended default: persist-and-re-resolve (one line in `reset` flips it to "clear on swap" if you prefer).

**F. What counts as the "measured evidence" your cheapest-mechanism rule requires before Phase 2+.** The web app has no analytics dependency at all (verified: no `@vercel/analytics`, no `track(` call anywhere under `web/`), so nothing can be measured today without adding one — itself a new dependency you would have to approve. Recommended default: your own use plus newsroom feedback gates Phase 2; a single no-PII counter is proposed, not assumed, before Phase 3.

**G. Whether the panel (and a saved default) also appears on the public homepage charts (Ontdek) and the anonymous trial.** `ChartView` is one component with five mount points, so the cheapest build shows it everywhere, collapsed by default. Recommended default: everywhere — a closed "Opmaak" button is quiet — but say so if the marketing page should stay control-free.

**H. Line thickness as four named steps (Dun / Normaal / Dik / Extra dik = 1/2/3/4 px) instead of the reference tool's free pixel number.** Two reasons: the existing honesty tests scan every text node of the whole chart card for digits and require each to be a spec string (a "2 px" label would be the first non-CBS digit inside the card — the alternative is an exemption I recommend against), and a numeric field is fiddly on a phone. Recommended default: named steps, with the pixel value only in `aria-valuetext`/`title`.

## 1. In plain language

You asked for a tool where a reader can pick a chart type and adjust how an already-answered CBS chart looks — for example a thicker line — with the tool starting from what the chart currently shows, not from blank defaults. The plan builds that as a small "Opmaak" (formatting) panel that folds out under the existing Lijn / Staaf / Tabel switch on every chart. Every control shows the value that is on screen right now, changes only the drawing (line weight, markers, gridlines, axis lines, label angle, value labels, baseline), and never touches a number: every figure on the chart stays the exact CBS value it was, the provisional-figure marking cannot be switched off, bars keep their zero baseline, and the PNG/SVG download shows exactly what is on screen. The default look of every chart stays your session-87 stock-Recharts choice; the panel only adds a reader's override on top, with a one-click "Standaard" to go back.

Cost: the first two phases need no AI call, no database change, no new dependency and no money — they are pure client code, the same class as what shipped on 2026-09-08. "Remember this for all my charts" is stored in the reader's own browser (like the light/dark theme). Only a much later, optional phase (a cross-device preference row) would touch the database, and only if there is evidence anyone wants it.

What you must decide first: the eight items in §0 — above all the language of the controls (A), whether colours are ever adjustable (B), and whether the two extra chart variants (horizontal bar, filled area) are wanted at all (D).

1. Phase 0 — extract today's hard-coded look into one test-pinned constant; nothing visible changes.
2. Phase 1 — the Opmaak panel with seven options + Standaard, per chart, session-only.
3. Phase 2a — "Gebruik voor al mijn grafieken (deze browser)".
4. Phase 2b — horizontal bar and single-series area as panel variants (if D says yes).
5. Phase 2c — unit next to values, bar width, curated palettes (if B says yes), UserChartView parity.
6. Phase 3 — database preference row, only on the §0-C trigger.
7. Phase 4 — chat-routed presentation edits, only on evidence and your sign-off (ADR 038's deferred Phase 4).

## 2. The architecture decision

**Core mechanism: extend the ADR 038 client reducer with a `presentation` slice of plain-JSON user overrides, add one pure resolver module that turns (spec, on-screen form, overrides) into the *effective* values plus per-option honesty locks, and make both the Recharts render and the new panel read only those effective values.** Pre-fill is then a property of the design, not a snapshot: the panel shows `resolved.values`, which is by definition what Recharts just drew — including a form the reader already switched or a zoom already applied.

Why this beat the alternatives:

- *Beside* the reducer (a second reducer/state) would duplicate the atomic `reset` that session 89 introduced precisely to stop state leaking across a dock-tab spec swap (`web/components/chart.tsx:812-822`); presentation state must ride that same action or it reintroduces the leak.
- *Replacing* the reducer churns ~40 passing tests for no isolation benefit.
- *Presets-first* (three curated looks) does not deliver your literal example ("thicker line, nothing else") and reinterprets "pre-filled" as "pre-selected"; presets are kept as a *later, thin* layer over the same overrides object (a preset is just a named `Partial<ChartPresentation>`), so nothing is lost by not starting there.
- *A `src/chart/presentation.ts` vocabulary module* (the ADR 007 seam) ships the identical feature with one more module whose only benefit — two renderers that cannot disagree — is unrealisable today: `renderChartSvg` has zero production callers (verified: only `tests/chart/*` import it). The seam is honoured by a recorded promotion trigger instead: the day a second production renderer exists (OG image, PDF per #215, embed), the module moves to `src/chart/` and `renderChartSvg(spec, { presentation })` reads the same object.
- *Builder-emitted presentation in the spec (schema v2)* is rejected on R8 grounds: audit rows are written once and only ever updated by GDPR redaction; a reader's override could never live there, so the spec would carry constants forever for nothing.

**Files (repo root `/Users/amity/Documents/Check de Cijfers/`):**

| File | Change |
|---|---|
| `web/lib/chart-presentation.ts` (**new**, pure, no React/Recharts import) | `ChartPresentation` type; `STOCK_PRESENTATION` = today's literals; `resolvePresentation(ctx, overrides) → { values, locks, applicable }`; `dotGeometry(lineWidth)`; `xAxisHeight(angle, longestLabel)`; the Dutch/English lock-reason strings (per §0-A). |
| `web/lib/chart-presentation.test.ts` (**new**) | Pure cases: stock equals today's literals (deep-equal pin); each lock fires; provisional points force markers; bar locks value labels; unknown keys ignored. |
| `web/lib/chart-view-state.ts` (**modify**) | `presentation: Partial<ChartPresentation>` on `ChartViewState`; actions `setPresentation(patch)` / `resetPresentation`; `reset` preserves `presentation` exactly as it preserves `form`. `ChartForm` stays `'line' \| 'bar' \| 'table'`. |
| `web/components/chart-config-panel.tsx` (**new**) | Dumb controls over `{ values, locks, applicable, onChange, onReset, idPrefix }`; collapsible region (hand-rolled ARIA, house rule 4). |
| `web/components/chart.tsx` (**modify**, ~80 lines) | `const pres = resolvePresentation(...)` next to `activeForm`; `<Line strokeWidth type dot>`, `<CartesianGrid horizontal vertical>`, `<XAxis angle textAnchor height axisLine tickLine>`, `<YAxis axisLine tickLine domain>` read `pres.values`; `SeriesDot` gets radius/ring/visibility from `dotGeometry` explicitly; `yAxisDomain(effectiveKind, pres.values.zeroBaseline)`; panel mounted inside the card but **outside `chartContainerRef`**; `aria-describedby` reason on the already-disabled Lijn tab. |
| `web/components/chart-small-multiples.tsx` (**modify**, ~15 lines) | Receives `lineWidth`/`grid` and draws the R11 hollow marker for provisional points (today `dot={false}` — see the fact check below). |
| `web/components/user-chart.tsx` | Phase 0: its identical literals read `STOCK_PRESENTATION` (one home for the stock look). No controls until Phase 2c — it has no reducer, and its dashed frame is the user-data-vs-CBS distinction (ADR 037 H2); a shared `useChartPresentation` hook lifts the panel there as a separate small task. |
| `web/lib/chart-prefs-store.ts` (**new, Phase 2a**) | localStorage adapter, key `checkdecijfers:chart-presentation:v1`, zod allow-list parse (zod ^4 is already a web dependency), try/catch on every access, read after mount. |
| `web/components/chart-download.tsx` | **No change.** Verified: `inlineComputedPaint` rewrites only `stroke`/`fill` values that are `var()`/`currentColor` and adds missing font attributes; `stroke-width`, `transform`, `r`, presence/absence of grid lines travel verbatim, so the export is faithful by construction. One new pin test only. |
| Untouched | `src/chart/*` (build, schema, types, render), `reconstruct.ts`, `threads/replay.ts`, all prompts, all migrations. |

**State shape (Phase 1):**

```ts
export interface ChartPresentation {
  lineWidth: 'thin' | 'normal' | 'thick' | 'extraThick'; // 1 / 2 / 3 / 4 px
  markers: 'all' | 'provisionalOnly';    // hollow R11 markers can never be hidden
  grid: 'both' | 'horizontal' | 'none';
  xLabels: 'flat' | 'tilted';            // 0° / −45°, XAxis height reserved
  axisLines: 'shown' | 'hidden';         // axis line + tick marks only; labels never
  valueLabels: 'shown' | 'hidden';       // line only; locked on bar (no scale otherwise)
  zeroBaseline: 'auto' | 'zero';         // line only: zoom → zero, never the reverse
}
export const STOCK_PRESENTATION: ChartPresentation = { lineWidth: 'normal', markers: 'all',
  grid: 'both', xLabels: 'flat', axisLines: 'shown', valueLabels: 'shown', zeroBaseline: 'auto' };
export function resolvePresentation(
  ctx: { kind: ChartSpec['kind']; form: ChartForm; seriesCount: number; hasProvisional: boolean },
  overrides: Partial<ChartPresentation>,
): { values: ChartPresentation; locks: Partial<Record<keyof ChartPresentation, string>>;
     applicable: (keyof ChartPresentation)[] };
export function dotGeometry(w: ChartPresentation['lineWidth']): { r: number; ring: number }; // r = max(4, px + 2), ring 2
```

**Panel placement.** An "Opmaak" button (`aria-expanded`, `aria-controls`) at the right end of the Weergave tablist row opens a `<section role="region">` directly above the chart, full width, single column under 640 px. Not a popover: the dock `<aside>` is `overflow-hidden` at 18–40 % of the window (`web/components/workspace.tsx:284,410`), there is no popover/collapsible primitive in `web/components/ui/` (badge, button, card, dropdown-menu, input, resizable, separator, skeleton, textarea — no select, slider, popover), and hand-rolled ARIA is the house pattern (`chart-download.tsx`'s menu, huisstijl rule 4). Closed by default, so the card's height is unchanged for readers who never open it; hidden in Tabel form. Controls: `role="radiogroup"` for exclusive choices (the `chart-toggle.tsx` pattern), `aria-pressed` buttons for toggles (the legend pattern), locked options `disabled` + `aria-describedby` → visually-hidden reason; Escape closes and refocuses the trigger.

**Where the four proposals disagreed on facts — checked against the files:**

- *Does Recharts forward `strokeWidth` into a custom `dot` function?* Yes. `web/node_modules/recharts/es6/component/Dots.js:65-80` builds `dotProps = { r: 3, ...baseProps, ...customDotProps, ... }` where `baseProps` is the Line's own svg props (`svgPropertiesNoEvents`, Line.js:207) and calls `option(dotProps)` — that is how `SeriesDot` already receives `props.stroke`. per-chart-panel's "very probably arrives" is right; presets-only/spec-seam's caution still governs the design: the value arrives as a prop but nothing draws it, so the marker geometry is threaded explicitly from our own resolver (the session-89 `fillOpacity` lesson, `docs/lessons-learned.md:32`).
- *Is a panel inside `ChartView` scanned by the honesty tests?* Yes — per-chart-panel was wrong to say "never scanned". `chart.test.tsx:393-433` scans `container.textContent` of the whole render root; `:636-670` walks every text node under the root. Being outside `chartContainerRef` keeps the panel out of the *export* (the download reads only the live `<svg>` inside that ref), not out of the *scan*. Consequence: digit-free control copy is a hard constraint (§0-H), and ADR 038's own sentence "the R6 token-scan (which only ever inspects the exported `<svg>`)" is imprecise for the web tests — fix it in the ADR 038 addendum.
- *Small multiples and R11:* spec-seam's finding is real — `chart-small-multiples.tsx:83` draws `dot={false}`, so a provisional point has no hollow marker in that view while the "○ = voorlopig cijfer" key still renders under the card (`chart.tsx:1334`). Fixed in Phase 1 while the file is open (the `provisionalOnly` marker mode is exactly what it needs).
- *Only-renderer claim:* all four are right — `renderChartSvg` is imported only by `tests/chart/curated.test.ts`, `benchmark-charts.test.ts`, `render-svg.test.ts`.
- *`reset` preserves `form`:* right (`chart.tsx:816`, pinned by `chart.test.tsx:816`).
- *Custom bar `shape` and `radius`:* right — `SeriesBar` draws a raw `<rect>`; Recharts' `radius` is applied by its default `Rectangle` shape only, so any rounding would have to be hand-drawn (one reason it is set aside).
- *`ui/` inventory:* both proposals that listed it missed `dropdown-menu.tsx` (present, unused). Irrelevant to the design.
- *Ontdek rendering:* `ontdek.tsx` is a server component mounting the client `ChartView`, so a saved default must be read after mount (the `system-map-content.tsx:477-485` pattern); server render = stock, one-frame flash accepted, same as the theme.

## 3. The control inventory

Pre-fill source is always `resolvePresentation(...).values.<key>`; the column states where today's *default* comes from.

| Option | Control type | Pre-fill source (today's literal) | Applies to forms | Honesty / a11y / dark-mode / export guard | Phase |
|---|---|---|---|---|---|
| Chart type | existing Weergave tablist (Lijn/Staaf/Tabel) | `activeForm` (`chart.tsx:901`) | — | §4; refused-for-this-spec = disabled tab with reason; add `aria-describedby` (today `title` only, unreachable by keyboard/touch) | live (+ fix in 1) |
| Size of line | 4-way radiogroup Dun/Normaal/Dik/Extra dik (1/2/3/4 px) | `<Line strokeWidth={2}>` (`chart.tsx:1205`) | line, area (2b), small multiples | R11: `dotGeometry` grows the marker (`r = max(4, px+2)`, ring 2) so a 4 px stroke cannot swallow the hollow ring; cap 4 px; export carries `stroke-width` verbatim (pin test); no colour, so theme-neutral; digit-free labels (§0-H) | 1 |
| Hide dots | toggle "Punten" → `markers: all / provisionalOnly` | `dot={SeriesDot…}` r=4 (`chart.tsx:566`) | line, area | R11: provisional hollow markers always render; non-provisional dots become transparent-but-present (`opacity 0`, same `data-point`/`role="button"`/`tabIndex`) so `[data-point="value"]` counts, keyboard walking and click-to-annotate are unchanged; the "○ = voorlopig cijfer" key stays | 1 |
| Hide grid | 3-way Beide / Alleen horizontaal / Geen | `<CartesianGrid strokeDasharray="3 3">` (`:1163,1241`) | line, bar, area | No honesty cost (gridlines are unlabeled by design — no invented ticks); `horizontal`/`vertical` props verified; `GRID_COLOR` token already theme-paired | 1 |
| Hide X axis | **narrowed** to one "Aslijnen" toggle (`axisLine={false} tickLine={false}` on both axes) | Recharts defaults | all charts | R9: period/region labels are the binding of each value to its coordinate — never hideable; axis line and tick marks are decoration | 1 |
| Hide Y axis | folded into "Aslijnen" | bar already `tick={false}` (`:1243`) | — | #197/#48 disclosure: on a zoomed line the plotted min/max ticks ARE how a non-zero baseline is disclosed — never hideable | 1 |
| Label X angle | 2-way Horizontaal / Schuin (0° / −45°) | XAxis default 0 | line, bar, area | Geometry only; `xAxisHeight()` reserves room so the rotated label is not clipped in the export (svg height is fixed by `h-64`, the plot shrinks); `angle`/`textAnchor`/`height` verified; jsdom renders no axis `<Text>`, so verified via resolver + prop pins and the browser pass | 1 |
| Value labels (ours, #197) | toggle | `valueLabelPlan` | line | Line: end labels off, min/max axis ticks stay; bar: **locked** with reason — with Recharts' own ticks off by design, a bar without its label has no scale at all, and a "0" baseline tick is not a spec string | 1 |
| Start Y at zero | toggle | `yAxisDomain(kind)` line → `['auto','auto']` (`:127`) | line | #48 in the safe direction only (zoom → zero); bar can never un-floor; the labelled min/max ticks stay the plotted values | 1 |
| Reset | "Standaard" button | — | all | Dispatches `resetPresentation`; disabled when pristine; the DOM returns to the byte-identical stock render (test) | 1 |
| Copy link / save | "Gebruik voor al mijn grafieken (deze browser)" + "Vergeet" | — | all | §0-C; zod allow-list on read, guards re-run per spec so a stored `provisionalOnly` cannot erase R11 anywhere | 2a |
| Label X edge margin | **dropped** | computed from label widths (`labelWidthPx`) | — | Pure layout; no user value | — |
| Suffix for label X / Y | **dropped → replaced** by "Eenheid bij waarden" toggle appending `spec.unit` | `spec.unit` shown above the chart | all | R10: a user-typed suffix next to a CBS number is the factor-1,000 misreading R10 exists for; `spec.unit` is a spec string so the scan passes; incidentally fixes the unit-less export (side finding) | 2c / never (free text) |
| Label Y angle | **dropped** | — | — | Two short spec strings; nothing to gain | — |
| Hide Legend | **dropped** | our `SeriesLegend` (HTML, outside the svg) | — | The legend IS the hide/highlight control and carries the "N van M reeksen verborgen" disclosure (#46(a)); never in exports anyway | — |
| Hide Tooltip | **dropped** | — | — | The only surface showing an arbitrary point's exact value on hover/keyboard walk (the chart's `desc` tells keyboard users to arrow through points); no honesty upside, an a11y downside | — |
| Reference line label (free text) | **dropped** | — | — | Free text inside the exported svg = ADR 038's rejected alternative 3; `ChartNotes` (outside the export container) and curated `annotations` already cover it | — |
| Bar width | 3-way Auto / Smal / Breed (`maxBarSize`) | Recharts auto | bar, hbar | Cosmetic; zero floor untouched | 2c |
| Curated palettes | 3-way Standaard / Contrastrijk / Grijs | `RECHARTS_PALETTE` | multi-series | §0-B; each palette a sanctioned literal-hex list checked in both themes; hatch/hollow markers follow the series colour automatically | 2c, if B |
| Horizontal bar | toggle "Liggend" | vertical | bar (S3/S4 only) | §4 | 2b, if D |
| Fill under line (area) | toggle "Vlak" | off | line (S1 only) | §4 | 2b, if D |
| Chart height | — | `h-64` | — | Layout only; low value; free sizes are Studio scope | later |
| Curve type | — | `type="linear"` | — | §0-D: `natural`/`basis` overshoot or miss points (contradicts the labelled max / R6 "affine image"), `step` is a semantic claim; `monotone` deferred | later / never |
| Bar corner radius | — | none | — | Must be hand-drawn as a path (custom shape); rounding baseline corners makes bars float off zero | REFUSED (low value, honesty cost) |
| Animation | — | `isAnimationActive={false}` | — | Export-at-click-time and reduced motion | REFUSED |
| Free colour picker | — | — | — | House rule 3 (both themes) cannot be checked per pick; a pale colour turns the hollow R11 ring invisible on `var(--card)` | REFUSED |

Phase 1 changes **only geometry and the visibility of decoration inside the svg; no text inside the svg changes** — the cleanest possible R6 story. Text-changing options (unit on labels) start in Phase 2c.

## 4. Chart-type rules

Spec shapes that exist (`src/chart/build.ts`): **S1** single-series time series (`kind 'line'`, 1 series), **S2** multi-series time series (`kind 'line'`, N series), **S3** multi-region comparison (`kind 'bar'`, N series × 1 point), plus S4 single-region single-period bar (treated as S3 with N = 1).

| Chart type | single-series time series (S1) | multi-series time series (S2) | multi-region comparison (S3) | Reason (R1/R9/R10/#48) | How a refused type is presented |
|---|---|---|---|---|---|
| Line | allow | allow | **refuse** (live) | R9: a line across regions implies a trend never measured (ADR 038, `lineFormAllowed`) | disabled Lijn tab + reason (+ `aria-describedby`) |
| Bar (grouped) | allow | allow | allow | #48: Y floors at zero via `yAxisDomain(effectiveKind)` | — |
| Table | allow | allow | allow | — | — |
| Horizontal bar (`layout="vertical"`, Phase 2b) | refuse | refuse | **allow** | Same encoding rotated; zero floor moves to the number axis (`XAxis domain=[0,'auto'] tick={false}` — no invented ticks); spec order kept (R6: "the spec's order IS the render order"); refused for time series to keep the chronological axis reading left→right (R6) | "Liggend" toggle disabled with reason on S1/S2 |
| Area (single, Phase 2b) | **allow**, zero baseline forced | refuse | refuse | Fill encodes magnitude → `[0,'auto']` like a bar (#48's own logic; amends line-may-zoom for this variant only — owner call D); same `SeriesDot` keeps R11 markers; `connectNulls={false}` keeps gaps; multi-series areas occlude each other's markers and gaps, and the only readable multi-area is stacked (see next row) | "Vlak" toggle disabled with reason on S2/S3 |
| Stacked bar / stacked area / 100 % | refuse | refuse | refuse | R1/R5/R6: the stack's top edge is a sum no spec string carries and no derivation registered; regions are not additive parts of a whole (gemeente + provincie + Nederland double-count); rates cannot be stacked at all (R10); segments lose their own zero baseline (#48) | not rendered; enumerated in ADR 039 |
| Pie / donut | refuse | refuse | refuse | R9/R10: asserts parts-of-a-whole no spec shape has; R6: Recharts' percentage labels would be renderer-invented numbers (the idea-bank already prefers bars even for a future distribution shape) | not rendered; enumerated in ADR 039 |
| Scatter | refuse | refuse | refuse | Needs two measures per point; a spec has one unit/measure (R10). "Markers only" is a line *option*, not a type — and strictly fewer claims than a line | not rendered |
| Sorted / ranked bars | — | — | refuse | R6: reordering is computation a renderer may not do; a ranking implied by order is an R9 ranking claim needing a registered derivation in the query layer (server change, owner decision) | not rendered; recorded as an open row |
| Smoothed / step curves | refuse | refuse | — | `natural`/`basis` draw positions that are not data and can exceed the labelled max; `step` asserts stock-vs-flow semantics the spec does not carry; `monotone` deferred (§0-D) | not rendered |

Two presentation rules: a type refused for **this** spec is a disabled control with a one-sentence reason (today's Lijn pattern, plus the `aria-describedby` fix); a type refused for **every** shape is not rendered at all — a control nobody can ever activate is noise, and the reason lives in ADR 039 (and, if you want it reader-facing, one "i" note in the panel).

## 5. Build order

| Phase | What ships | AI / database / cost | Needs the owner first? | Size |
|---|---|---|---|---|
| 0 — extract | `chart-presentation.ts` with `STOCK_PRESENTATION` + resolver; `chart.tsx`, `chart-small-multiples.tsx`, `user-chart.tsx` read it instead of literals; small-multiples R11 marker fix; ADR 039 draft. **No visible change** — the full web suite is the regression guard. | none / none / none | No (docs-and-refactor; owner-present push per #118) | 0.5 day |
| 1 — the panel | `presentation` reducer slice; `chart-config-panel.tsx` with 7 options + Standaard; guards as locks; `aria-describedby` on the Lijn tab; ~35 new tests (pure resolver + reducer + DOM pins: pre-fill equals on-screen value after default/override/Lijn→Staaf→Lijn/dock swap; R11 hollow marker survives `provisionalOnly`; `[data-point]` count unchanged; membership scans with the panel open; export blob carries `stroke-width="3"`; Standaard restores the byte-identical stock svg); docs (ADR 039, ADR 038 addendum, 03-mvp-scope row 55, 12-huisstijl Charts, 04-architecture row, 05-data-rules verified-by cells, #218, 08-build-plan); browser pass at 375 px inline, in the dock at 18 %, light + dark, one PNG with Dik + Schuin. | none / none / none | Yes: A, E, G, H | 2–3 days incl. `/code-review` + whole-branch review |
| 2a — remember | `chart-prefs-store.ts`; "Gebruik voor al mijn grafieken (deze browser)" / "Vergeet"; zod allow-list; post-mount read; tier shown in the panel (Standaard · Mijn standaard · Deze grafiek). | none / none / none | Yes: C, G | 0.5–1 day |
| 2b — variants | Horizontal bar (S3/S4) and single-series area (S1) as panel toggles; `SeriesBar` orientation branch (label at `x+width+4`); forced zero domain tests; negative test that no `stackId`/`recharts-pie` ever renders. Recharts `Area`/`AreaChart` are already in the bundle. | none / none / none | Yes: D | 2 days |
| 2c — text & style extras | Unit-next-to-values (`spec.unit`), bar width, curated palettes (only if B), `UserChartView` parity via a shared hook. | none / none / none | Yes: B | 1–2 days |
| 3 — cross-device | Migration `user_preferences(user_id, chart_presentation jsonb, updated_at)`; server action via `web/lib/current-user.ts`; retention leg in `src/answer/audit/retention.ts` + self-service delete (a user-keyed preference is personal data by the RUNBOOK's scope). | none / **DDL (owner-supervised)** / none | Yes: C trigger fired + live DDL | 1 day + supervised apply |
| 4 — chat-routed edits | Thin schema emitting `Partial<ChartPresentation>`; deterministic apply; refuse anything outside the enum (ADR 038's deferred Phase 4). | **LLM** / none / spend | Yes: evidence + sign-off | not sized |

## 6. How each piece stays honest

| Piece | Numbers stay traceable (R1/R6) | Marking/wording stays accurate (R9/R11/#48) | Open risk (letter) |
|---|---|---|---|
| Resolver + reducer slice | Never enters `ChartSpec`, `buildChartSpec` or `audit_answers` (R8 rows byte-identical); a pure projection like `windowSpec` | Locks re-run on every render, so a stale override can never apply to a newly-unsafe spec | E |
| Line width | Geometry only; every visible number still a `formattedValue` bound via `data-label-for` | `dotGeometry` keeps the hollow R11 ring legible at every step; cap 4 px | H |
| Markers all / provisionalOnly | No point omitted: hidden dots are transparent hit targets, one `data-point` per value | Hollow provisional markers never hidden; key text unchanged | — |
| Grid / axis lines / label angle | Unlabeled decoration; no text changes | Y ticks (the non-zero-baseline disclosure) and X labels (the R9 binding) are never hideable | — |
| Value labels off (line) | Fewer spec strings shown, none invented; Tabel + tooltip remain the exact-value surfaces | Locked on bar (no scale otherwise); axis min/max ticks stay | — |
| Zero baseline on line | No new number ("0" is never rendered as a tick) | #48 in the safe direction only | — |
| Standaard / stock constant | `STOCK_PRESENTATION` deep-equals today's literals in a test — the session-87 look cannot drift without an explicit edit | — | B |
| Panel copy | Digit-free, so the existing whole-card token scans stay exemption-free | Lock reasons are fixed strings, never derived from data | A, H |
| Export | `chart-download.tsx` untouched; attributes serialise verbatim; the baked footer/`viewDisclosure` unchanged because no option changes *what* is shown | Rotated labels reserve axis height so nothing is clipped | — |
| Saved default (localStorage) | Never server-read; zod allow-list drops anything unknown; not an audit concern | Guards per spec, per render | C, G (and the "not personal data" reading is an **Assumption** to mirror in open-questions) |
| Horizontal bar (2b) | Spec order preserved (no sort); hatch pattern orientation-free | Zero floor on the number axis; region labels stay adjacent (R9) | D |
| Area (2b) | Verbatim points; nulls break the fill | Forced zero baseline; same hollow markers; fill under a provisional segment has no R11 convention yet (flag) | D |
| Refused types | Pie/stack would draw an unregistered sum/share (R1/R5/R6); scatter has no second measure (R10) | Not rendered, enumerated in ADR 039 | D |
| DB preference (3) | — | GDPR leg required | C |

## 7. Considered and set aside

- **Presets-only as the first slice** (Standaard/Minimaal/Presentatie): fewer states to test, but it does not deliver "thicker line, nothing else" and turns "pre-filled" into "pre-selected"; presets return later as named `Partial<ChartPresentation>` objects over the same mechanism.
- **A "Presentatie" preset with 14 px labels / a "Print" preset**: not in the ask; larger text needs `labelWidthPx` parameterised and the print variant re-introduces a custom palette the owner retired.
- **`src/chart/presentation.ts` as the Phase-1 home** (spec-seam H): the interoperability benefit needs a second production renderer that does not exist; kept as a recorded promotion trigger in ADR 007 instead.
- **Builder-emitted presentation / spec schema v2**: audit rows are immutable except GDPR redaction, so a reader's override could never live there; only constants would be stored forever.
- **Per-chart overrides keyed by `specIdentity` in a `Map`** (saved-defaults): reverses the session-89 "form persists across a swap" ruling for no honesty gain (locks already re-run per spec) and complicates "current values".
- **Extending the Weergave tablist to five tabs** for area/horizontal bar: squeezes 375 px and widens `ChartForm`/`lineFormAllowed`; variants live in the panel as presentation of the existing forms.
- **A free pixel-number input for line thickness**: breaks the exemption-free digit scan and is fiddly on a phone (§0-H).
- **`monotone`/`step`/`natural`/`basis` curves in Phase 1**: only `monotone` is arguable; zero demand; deferred.
- **Hide legend, hide tooltip, free-text reference-line label, free-text axis suffixes**: a11y regressions or R6/R10 exemptions, each with an honest existing substitute.
- **Bar corner radius**: hand-drawn path required (custom shape) and rounding the baseline corners misrepresents zero.
- **Free colour picker / per-series recolour**: house rule 3 cannot be enforced per pick; curated palettes only, and only if B.
- **Chart height / social formats / embeds**: Studio scope (§9).
- **Shareable URL state**: no public chart URL exists; #46(c) names "a customised view circulating as the official chart" as the risk; the honest sharing path stays the export with `viewDisclosure` baked in.
- **Named user presets now**: a second-order feature with zero usage data; the schema makes them a later list.
- **A DB `user_preferences` row now**: live DDL + retention leg for a multi-device benefit nobody has asked for.
- **A `@base-ui` Popover/Collapsible for the panel**: no new npm package, but the dock's `overflow-hidden` clips overlays and hand-rolled ARIA is the tested house pattern.
- **Adding `@vercel/analytics` on spec alone** to satisfy "measured evidence": a new dependency the owner must decide on (§0-F).
- **A chat-routed producer as the first slice**: the session-88 synthesis already rejected it ("the full menu of adjustments is small enough to put on screen directly"); stays ADR 038's conditional Phase 4.
- **A `useSyncExternalStore` store for the saved default**: works, but the simpler post-mount effect is the existing `system-map-content.tsx` precedent; either is acceptable.

## 8. Answers to the owner's three questions

**(a) Chart-type selection.** Line, bar and table stay, with the existing rule that a region comparison can never be a connected line. Honest additions are limited to two *variants* of what exists — horizontal bar for comparisons and a filled area for a single time series with a forced zero baseline — offered in Phase 2b only if you say yes (§0-D). Pie, stacked, scatter, sorted and smoothed forms are refused on named invariants (§4): each would draw a number or a claim (a total, a share, a rank, a smoothed value) that no CBS cell and no registered derivation backs. A type refused for *this* chart shows as a disabled control with a reason, like today's Lijn tab; a type refused for *every* chart is simply not offered.

**(b) Options pre-filled with current values.** The panel never reads stored overrides directly; it reads the resolver's *effective* values — the same object Recharts just drew from — so "current" means literally what is on screen now, including a form you already switched or a zoom already applied (§2). Seven options ship in Phase 1 (§3), each changing geometry or decoration only, with a "Standaard" that restores the byte-identical stock look; the stock look itself is a test-pinned constant, so your session-87 decision cannot drift.

**(c) How far choice extends.** Per chart for the session first (Phase 1, identical to ADR 038's model), then a one-click "use this for all my charts (this browser)" in localStorage (Phase 2a — zero cost, no migration, no GDPR surface, the theme toggle's precedent), and a database preference row only when the saved-charts gallery ships or someone asks for cross-device sync (Phase 3, §0-C). Named presets and shareable links are deliberately later or refused (§7).

## 9. What stays in the Visualisatie Studio non-goal

- Free-form sizing, aspect ratios, social/OG formats and slide exports (and #215's PDF/transparent PNG, which is an export decision, not a presentation option).
- Embeds, public chart URLs and shareable presentation state.
- Arbitrary drag-and-drop, free text/titles/captions inside the chart, free-form reference lines.
- Free colour picking and organisation/huisstijl theme objects (ADR 007 Phase 3's server-side theme; the enterprise tier).
- Pie, stacked, scatter and ranked forms, and any result shape (parts-of-a-whole, two-measure) the query layer would have to produce first.
- AI-suggested per-chart option sets (#158's "AI suggests → user toggles" model) and chat-routed edits beyond ADR 038's conditional Phase 4.
- A persisted multi-device preference store beyond the single conditional row in Phase 3.
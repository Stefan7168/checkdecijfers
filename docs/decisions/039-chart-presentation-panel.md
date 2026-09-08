# ADR 039 — Chart presentation panel: a pure resolver over the ADR 038 reducer

**Status:** accepted, 2026-09-09 (session 91, autonomous, branch `wp218-chart-styling`) — phases 0 and 1 of WP218 as built; later phases are appended as dated addenda at the end of this file.

## Context

Open-questions [#218](../open-questions.md): the owner asked (session 89) for a Recharts-style chart *configuration* tool — pick a chart type, adjust presentation options such as line thickness, with the tool pre-filled with what the chart currently shows. Session 90 ran a four-angle Fable architecture panel + synthesis ([session-briefs/2026-09-09-session-90-chart-config-tool-synthesis.md](../session-briefs/2026-09-09-session-90-chart-config-tool-synthesis.md)) and the owner answered its eight open decisions A–H in chat: A an English/Dutch switch for the whole app (WP218 phase 4, [#219](../open-questions.md)); B a Colours tab with swatch + hex + picker per series, default the stock Recharts palette, plus brand colours and fonts (phase 3); C styles saved in the user's account (phase 2); D more chart types after a best-practice research piece (phase 5); E each chart starts fresh; F an anonymous usage counter (phase 6, [#220](../open-questions.md)); G the panel everywhere, homepage and trial included; H four named thickness steps.

The binding invariants for anything that touches a chart: every number on a chart is a spec string bound to its cell (R1/R6); the provisional marking — hollow marker / hatched bar — can never be switched off (R11); bars keep a zero baseline ([#48](../open-questions.md)); the export shows what is on screen; the session-87 stock look ([12-huisstijl](../12-huisstijl.md) → Charts) stays the default. One constraint the panel surfaced and this session verified: the web-side honesty tests walk every text node of the whole chart card for digit tokens (`web/components/chart.test.tsx`), so any control copy inside the card must be digit-free (ADR [038](038-chart-view-state-editing.md)'s session-90 correction).

## Decision

**A presentation is a set of plain user overrides on top of a test-pinned stock look, resolved per render into effective values plus honesty locks; both the Recharts render and the panel read only those effective values.**

- `web/lib/chart-presentation.ts` (pure, no React/Recharts import) holds the `ChartPresentation` type — `lineWidth` (thin / normal / thick / extraThick = 1 / 2 / 3 / 4 px), `markers` (all / provisionalOnly), `grid` (both / horizontal / none), `xLabels` (flat / tilted), `axisLines`, `valueLabels`, `zeroBaseline` (auto / zero), `seriesColors` (series index → `#rrggbb`), `fontFamily` — the constant `STOCK_PRESENTATION` (today's literals, deep-equal pinned by a test so the session-87 look cannot drift), the Recharts palette (moved here from `chart.tsx`, re-exported there), and `resolvePresentation(ctx, overrides, base = STOCK)` → `{ values, locks, applicable, pristine }`. Overrides pass an allow-list parse (`sanitizeOverrides`, zod) on every call: unknown keys, wrong enum values, malformed colours and non-numeric indexes are dropped, never thrown on.
- **Locks re-run on every render**, so a stale override can never apply to a newly-unsafe spec: in bar form value labels are forced shown (without them a bar chart has no scale — the axis deliberately shows no numbers of its own) and the baseline forced to zero; line width, markers and baseline are not applicable to bars; in table form only the font applies. Lock reasons are fixed, digit-free Dutch strings.
- **The ADR 038 reducer gains a `presentation` slice** (`setPresentation(patch)`, `resetPresentation`); its existing `reset` action — fired when the visual dock or the Ontdek toggle swaps the spec on the same mounted `ChartView` — clears the slice (**owner decision E: each chart starts fresh**).
- **R11 by geometry:** `dotGeometry(lineWidth)` grows the marker with the line (`r = max(4, px + 2)`, ring 2) so a 4 px stroke cannot swallow the hollow ring; under `provisionalOnly` the non-provisional dots become transparent but stay in the DOM with their `data-point`, role, tab stop and click handler, so the point count, keyboard walking and click-to-annotate are unchanged and the hollow markers always render. `chart-small-multiples.tsx`, which drew `dot={false}`, now draws the hollow marker for provisional points (the R11 gap the panel found).
- **Colours (owner B) with a guard:** per series a swatch, a hex text box and a native colour picker, pre-filled with the effective colour; `judgeColor(hex)` refuses a colour whose WCAG contrast against EITHER theme's card (`#ffffff` light, `#171717` dark — `--card` in `globals.css`) is below 1.25 — the hollow ring would vanish — with a digit-free reason, and warns (still applies) below 3.0 per theme. Every stock palette colour passes (the stock `#ffc658` on white is ≈ 1.55:1: a warning, never a refusal); an untouched palette default never warns — that palette is the owner's accepted session-87 trade-off. Hex codes live only in `<input>` values, never in text nodes, which keeps the whole-card digit scans exemption-free.
- **Fonts:** a curated list (Roboto, Open Sans, Lato, Merriweather, Playfair Display from Google Fonts; Georgia, Arial system), loaded on demand by one `<link>` per family (`web/lib/font-loader.ts`) rather than bundled through `next/font`; the family is applied as CSS on the chart container so SVG text inherits it, and the export's `inlineComputedPaint` writes the computed family onto every text node. Known limit: the PNG export rasterises through an `<img>`, which cannot load web fonts, so a PNG falls back to a system font; the SVG keeps the family name.
- **Tilted labels** reserve axis height (`xAxisHeight`) and left margin (`xLabelOverhang`) so nothing is clipped on screen or in the export.
- **The panel** (`web/components/chart-config-panel.tsx`) is a dumb component over the resolved values: an `Opmaak` trigger at the right of the Weergave tablist, a `role="region"` with hand-rolled tabs Grafiek / Kleuren / Lettertype (house rule 4 — the tested ARIA patterns of `chart.tsx`/`chart-toggle.tsx`), radiogroups for exclusive choices, `aria-pressed` toggles, locked controls disabled with an `aria-describedby` reason, Escape closes and refocuses, `Standaard` resets (disabled while pristine). It mounts inside the card but outside the `chartContainerRef` export container, on every `ChartView` (chat, dock, Ontdek, trial — **owner G**), hidden in Tabel form. Copy is Dutch, matching the card's own controls, with an `en` variant in `PANEL_COPY` so phase 4 only passes a language.
- **Nothing in `src/` changes; `chart-download.tsx` is untouched** — `stroke-width`, `r`, `transform` and grid presence travel verbatim into the export (test-pinned: the SVG export carries `stroke-width="3"` after Dik), and `Standaard` restores a byte-identical stock svg.

## Alternatives considered

1. **Presets only** (Standaard / Minimaal / Presentatie) as the first slice — fewer states, but it does not deliver the owner's literal example ("a thicker line, nothing else") and turns "pre-filled with current values" into "pre-selected"; presets remain possible later as named `Partial<ChartPresentation>` objects over the same overrides.
2. **A second reducer / component state beside the ADR 038 reducer** — would duplicate the atomic `reset` that session 89 introduced to stop state leaking across a dock-tab spec swap; presentation must ride that same action or the leak returns.
3. **Presentation in the chart spec (schema v2, ADR 007's seam)** — audit rows are immutable except for GDPR redaction (R8), so a reader's override could never live there; the spec would carry constants forever. The seam is honoured by a promotion trigger instead (below).
4. **A free pixel input for thickness** — breaks the exemption-free digit scan and is fiddly on a phone (owner H: named steps).
5. **A Popover/Collapsible primitive for the panel** — the dock `<aside>` is `overflow-hidden`, and hand-rolled ARIA is the tested house pattern.
6. **Curated palettes only, no picker** (the panel's own recommendation) — overruled by the owner (B); the per-pick contrast judgement above is the compromise that keeps the R11 guard.

## Consequences

- Zero change to `src/chart/*`, `buildChartSpec`, stored specs, prompts, migrations; the R1–R11 backend suites are untouched by phases 0–1.
- `ChartView` grows by the resolver call and the panel mount; `chart.tsx` (already large) gains ~60 lines — the grid/axis JSX is now near-identical in three places (line, bar, small multiples), an extraction candidate noted for the final review.
- New surface for the honesty scans: the panel is inside the card, so its copy must stay digit-free; the panel's own tests walk every text node in both languages.
- The account default (phase 2) is a second layer under the per-chart overrides: `resolvePresentation(ctx, overrides, base)` already takes the base.

## Revisit triggers

- **A second production renderer** (OG image, PDF export #215, embeds): move the vocabulary to `src/chart/presentation.ts` so `renderChartSvg(spec, { presentation })` reads the same object (ADR 007's seam).
- **Usage counter data** (phase 6) showing which options are used decides whether phase 5's extra chart types and any later chat-routed presentation edits (ADR 038's deferred Phase 4) are worth building.
- **Brand fonts** (phase 3) may bring families outside the curated list — `fontStack` already accepts a regex-validated family name.

---

*Addenda for phases 2–6 are appended below as each is built.*

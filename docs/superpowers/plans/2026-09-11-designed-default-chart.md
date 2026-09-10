# Designed default chart look Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retire the "basic Recharts" look as the product's default and ship a designed default — a colour-blind-safe editorial palette, a quiet horizontal grid with a hairline baseline, first-and-last markers, a gradient area fill, haloed 12 px value labels, a height that follows the card's width, a 300 ms entrance, a clearer card header and chip-style legend — so every chart on every surface (chat, dock, homepage, trial, history, embed once merged) looks publication-ready with zero extra work.

**Architecture:** Everything is presentation over the unchanged spec (ADR 038/039): the designed default is a new set of literals in `STOCK_PRESENTATION` plus a new `DEFAULT_PALETTE` in the pure resolver (`web/lib/chart-presentation.ts`), one new marker mode (`'ends'`) and one new key (`areaFill`), a pure `chartHeightForWidth` rule, and small render changes in `chart.tsx`. The session-87 literals survive as `CLASSIC_PRESENTATION`/`RECHARTS_PALETTE` for the later "Classic" template. Zero change to `src/chart/*`, `buildChartSpec`, stored specs, prompts, the database or the bundle.

**Tech Stack:** Next.js 15 / React 19, Recharts 3, zod, Tailwind v4 + tw-animate-css (already installed), vitest + Testing Library (jsdom), the message catalogue (`web/lib/i18n/messages.ts`).

**Spec:** [docs/session-briefs/2026-09-10-visual-next-level-plan.md](../../session-briefs/2026-09-10-visual-next-level-plan.md) §4 (the designed default), with the decisions pre-resolved in [docs/session-briefs/2026-09-10-overnight-visual-upgrade-kickoff.md](../../session-briefs/2026-09-10-overnight-visual-upgrade-kickoff.md) (decision 2: build it; colour-blind-safe: yes; palette/grid/marker/type/motion calls are the session's).

## Design decisions taken for this plan (one line each, the rationale the ADR will carry)

- **Palette `DEFAULT_PALETTE` = `#0072b2 #d55e00 #009e73 #cc79a7 #b8860b #3a8fc4 #6a5acd #6f8d2a`.** The first four are Okabe–Ito's blue / vermillion / bluish-green / reddish-purple (the standard colour-blind-safe set), the rest are hand-tuned to the same luminance band. Measured (scratch script, WCAG formula = `contrastRatio`): every colour is ≥ 3.0 : 1 against BOTH cards (`#ffffff`, `#171717`) — no `judgeColor` warning on either theme, unlike five of the eight stock colours today — and the first four stay ≥ 0.07 apart in OKLab under protanopia, deuteranopia and tritanopia (Machado 2009). ONE palette for both themes: cheapest mechanism, no theme hook, and the export (which resolves against the light theme, #222) needs no special case.
- **Line width stays `'normal'` (2 px).** FT / Economist / OWID lines are ~2 px at this width; the weight comes from the palette and the quiet grid, not a thicker stroke. No series-count-dependent rule (YAGNI).
- **Markers default `'ends'`: the first and last PLOTTED point of each series plus every provisional point; the rest are drawn at opacity 0 exactly like `'provisionalOnly'` already does** (kept in the DOM: the `[data-point]` count, keyboard walking and click-to-annotate are unchanged). Absolute, no point-count threshold — deterministic and one enum value. `'all'` stays one click away.
- **Grid `'horizontal'`, axis lines `'hidden'`, plus a hairline baseline in the grid colour whenever a grid is shown at all** (grid none + axis lines off = a bare plot, as a reader would expect). The horizontal grid lines sit at the two honest labelled values (the plotted min and max — the explicit `ticks` already do that), so the "grid" is two hairlines, not a mesh.
- **Area fill: a vertical gradient (colour at 28 % → 2 %) by default, `areaFill: 'gradient' | 'flat'`.** Honest because the area form already forces a zero baseline; a flat 25 % fill stays one toggle away.
- **Value labels 12 px with a card-coloured halo** (`paint-order: stroke`, `stroke: var(--card)`, 3 px). The export inliner resolves `var(--card)` to the light card (#222 path), so the halo survives PNG/SVG. Axis ticks stay 11 px muted.
- **Height follows width:** `max(256, min(360, round(width × 9/16)))` from the container's measured width — the explicit-height mechanism `ChartFrame` ended up with after the battle test, never CSS `aspect-ratio`. Only when the frame aspect is `'auto'` and small multiples is off; 256 px until measured (SSR/jsdom unchanged).
- **Entrance:** tw-animate-css utilities on the export CONTAINER (never inside the svg): `animate-in fade-in slide-in-from-bottom-1 duration-300 motion-reduce:animate-none`. Recharts' own animation stays off (the recorded refusal: an export must never capture a half-drawn line).
- **Header:** the title becomes `text-base font-semibold`; unit and pinned dimensions become one muted line (separate spans, so tests that look up the unit text keep working).
- **Legend:** chip styling (`rounded-full border`), behaviour and ARIA untouched.
- **Tooltip:** a muted dashed crosshair on line/area, a muted band on bars; the export drops any `.recharts-tooltip-cursor` node so a touch device's active cursor can never bake into a PNG as a fake annotation line.
- **Two gradient presets retuned so no preset refuses against the default palette:** `dawn` `to` `#f472b6` → `#f9a8d4`; `sand` `to` `#b45309` → `#92400e` (the old `sand` refused the FIRST default colour, i.e. every chart). A test now gates presets × palette.
- **Naming:** `STOCK_PRESENTATION` keeps its identifier (every caller means "the product's default") and gets the new literals; `CLASSIC_PRESENTATION` + `RECHARTS_PALETTE` preserve the session-87 look for the Classic template (phase 2) and for continuity tests.

## Global Constraints
- **Honesty (docs/05-data-rules.md R1/R6/R11):** no new text inside the chart card; every whole-card digit scan in `chart.test.tsx` must keep passing; the hollow provisional marker is always drawn (`markerVisible` returns true for provisional); no rounded bar tops, no curve smoothing, no Recharts animation; the export's clone drops the tooltip cursor.
- **Do NOT weaken any honesty test to make a pin pass.** Only pins that literally encode the OLD default look (grid both, axis lines on, all markers, stroke width, 11 px labels, `#8884d8`) may change, and each change must be to the NEW default, stated in the test name.
- **Every new interface string** has an `nl` and an `en` entry in `web/lib/i18n/messages.ts` and contains no digits.
- **Both themes:** colours passed explicitly (hex), axes/grid keep `AXIS_COLOR`/`GRID_COLOR` tokens; the halo uses `var(--card)`.
- **No CSS `aspect-ratio`; explicit heights from measured widths; no new dependency; no schema/DB/prompt change.**
- **Commands:** web tests `cd web && npx vitest run <files>`; web typecheck `cd web && npx tsc --noEmit`; root typecheck `npx tsc --noEmit`. Commit trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Work on branch `visual-designed-default`; never push to `main`.
- **Do the edits yourself in this run — do not spawn subagents, do not "background" the task.**

## File map
- Modify `web/lib/chart-presentation.ts` (+ `.test.ts`): `DEFAULT_PALETTE`, `CLASSIC_PRESENTATION`, new `STOCK_PRESENTATION` literals, `MarkerMode 'ends'`, `areaFill`, `markerVisible`, `chartHeightForWidth` + `CHART_MIN_HEIGHT_PX`/`CHART_MAX_HEIGHT_PX`, retuned presets, resolver applicability.
- Modify `web/components/chart.tsx` (+ `.test.tsx`): palette export, `SeriesDot` marker visibility, area gradient defs, label halo/size, baseline rule, tooltip cursor, measured height, entrance class, header, legend chips.
- Modify `web/components/chart-download.tsx` (+ `.test.tsx`): drop `.recharts-tooltip-cursor` from the export clone.
- Create `web/lib/use-element-width.ts` (+ `.test.ts`): the ResizeObserver width hook; `web/components/chart-frame.tsx` reuses it and re-exports `CHART_MIN_HEIGHT_PX`.
- Modify `web/components/chart-config-panel.tsx` (+ `.test.tsx`), `web/lib/i18n/messages.ts`: the `ends` option and the `areaFill` toggle.
- Docs (controller, after the whole-branch review): ADR 042, `docs/12-huisstijl.md`, the redesign spec's superseded note, `docs/08-build-plan.md`, `docs/03-mvp-scope.md`, `docs/04-architecture.md`, `docs/open-questions.md`, STATUS/archive/lessons.

---

### Task 1: The designed default in the presentation model (pure)
**Files:**
- Modify: `web/lib/chart-presentation.ts`
- Test: `web/lib/chart-presentation.test.ts`

**Interfaces (produce exactly these):**
```ts
export type MarkerMode = 'all' | 'ends' | 'provisionalOnly';
export type AreaFill = 'gradient' | 'flat';
// ChartPresentation gains, after `zeroBaseline`:
//   /** Area form only: a vertical gradient fill (the designed default) or a flat 25 % fill. */
//   areaFill: AreaFill;
/** The session-87 "basic Recharts" example palette — kept for the Classic look; no longer the default. */
export const RECHARTS_PALETTE: readonly string[]; // unchanged literals
/** The designed default palette (ADR 042): Okabe–Ito's first four, then four hand-tuned hues in the same luminance band. Every entry ≥ 3.0:1 against both cards (pinned). */
export const DEFAULT_PALETTE: readonly string[] = ['#0072b2', '#d55e00', '#009e73', '#cc79a7', '#b8860b', '#3a8fc4', '#6a5acd', '#6f8d2a'];
/** The session-87 stock literals, verbatim — the "Classic" look. */
export const CLASSIC_PRESENTATION: ChartPresentation;
/** The designed default (ADR 042) every chart resolves on top of. */
export const STOCK_PRESENTATION: ChartPresentation;
export interface SeriesEndpoints { first: string; last: string } // periodCodes of the first and last PLOTTED point
export function markerVisible(mode: MarkerMode, provisional: boolean, periodCode: string, ends: SeriesEndpoints | null): boolean;
export const CHART_MIN_HEIGHT_PX = 256;
export const CHART_MAX_HEIGHT_PX = 360;
export function chartHeightForWidth(width: number): number;
export function seriesColor(values: Pick<ChartPresentation, 'seriesColors'>, index: number): string; // now cycles DEFAULT_PALETTE
```

- [ ] **Step 1: Write the failing tests** — in `web/lib/chart-presentation.test.ts`, REPLACE the existing `describe('STOCK_PRESENTATION — the session-87 stock look, pinned', …)` block with:

```ts
describe('the designed default (ADR 042) and the classic session-87 look, both pinned', () => {
  it('STOCK_PRESENTATION is the designed default: ends markers, horizontal grid, no axis lines, gradient area fill', () => {
    expect(STOCK_PRESENTATION).toEqual({
      lineWidth: 'normal',
      markers: 'ends',
      grid: 'horizontal',
      xLabels: 'flat',
      axisLines: 'hidden',
      valueLabels: 'shown',
      zeroBaseline: 'auto',
      areaFill: 'gradient',
      seriesColors: {},
      fontFamily: null,
      language: null,
      frameBackground: 'none',
      framePadding: 'none',
      frameCorners: 'square',
      frameShadow: 'none',
      frameInset: 'none',
      frameAspect: 'auto',
    });
  });
  it('CLASSIC_PRESENTATION deep-equals the literals chart.tsx drew in session 87 (kept for the Classic look)', () => {
    expect(CLASSIC_PRESENTATION).toEqual({
      lineWidth: 'normal',
      markers: 'all',
      grid: 'both',
      xLabels: 'flat',
      axisLines: 'shown',
      valueLabels: 'shown',
      zeroBaseline: 'auto',
      areaFill: 'flat',
      seriesColors: {},
      fontFamily: null,
      language: null,
      frameBackground: 'none',
      framePadding: 'none',
      frameCorners: 'square',
      frameShadow: 'none',
      frameInset: 'none',
      frameAspect: 'auto',
    });
  });
  it('the classic palette literals are unchanged and the default palette is the eight ADR-042 hues', () => {
    expect(RECHARTS_PALETTE).toEqual(['#8884d8', '#82ca9d', '#ffc658', '#ff7300', '#0088fe', '#00c49f', '#ffbb28', '#ff8042']);
    expect(DEFAULT_PALETTE).toEqual(['#0072b2', '#d55e00', '#009e73', '#cc79a7', '#b8860b', '#3a8fc4', '#6a5acd', '#6f8d2a']);
    expect(new Set(DEFAULT_PALETTE).size).toBe(DEFAULT_PALETTE.length);
    for (const c of DEFAULT_PALETTE) expect(c).toMatch(/^#[0-9a-f]{6}$/);
  });
});
```

  Then, in the existing `describe('resolvePresentation', …)` block, add:

```ts
  it('areaFill is applicable in area form only — never offered on line, bar, hbar or table', () => {
    expect(resolvePresentation({ ...lineCtx, form: 'area' }, {}).applicable.has('areaFill')).toBe(true);
    expect(resolvePresentation(lineCtx, {}).applicable.has('areaFill')).toBe(false);
    expect(resolvePresentation({ ...lineCtx, kind: 'bar', form: 'bar' }, {}).applicable.has('areaFill')).toBe(false);
    expect(resolvePresentation({ ...lineCtx, kind: 'bar', form: 'hbar' }, {}).applicable.has('areaFill')).toBe(false);
    expect(resolvePresentation({ ...lineCtx, form: 'table' }, {}).applicable.has('areaFill')).toBe(false);
  });
  it('an areaFill override passes through in area form and is sanitised like any enum', () => {
    expect(resolvePresentation({ ...lineCtx, form: 'area' }, { areaFill: 'flat' }).values.areaFill).toBe('flat');
    expect(sanitizeOverrides({ areaFill: 'striped' })).toEqual({});
    expect(sanitizeOverrides({ markers: 'ends' })).toEqual({ markers: 'ends' });
  });
```

  Update the two existing cycling expectations in `'merges series colours per index on top of the base and ignores junk'` from `RECHARTS_PALETTE[2]`/`RECHARTS_PALETTE[1]` to `DEFAULT_PALETTE[2]`/`DEFAULT_PALETTE[1]`.

  In `describe('colours — normalise, contrast, judge', …)`, REPLACE `'every stock palette colour is accepted (never refused) — the default look must always be choosable'` with these three tests (the CVD helper functions go at the top of the file, after the imports):

```ts
// Design-time arithmetic for the default palette (session-92 lesson turned
// into a gate). Machado et al. 2009, severity 1.0, applied in linear sRGB;
// distance measured in OKLab. Only what the pins below need — not a colour
// library.
const degamma = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
function hexToLinear(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255].map(degamma) as [number, number, number];
}
function linearToOklab([r, g, b]: [number, number, number]): [number, number, number] {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}
const CVD_MATRICES: Record<string, number[][]> = {
  protanopia: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deuteranopia: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
  tritanopia: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.3039]],
};
function simulate(matrix: number[][], rgb: [number, number, number]): [number, number, number] {
  return matrix.map((row) => row[0]! * rgb[0] + row[1]! * rgb[1] + row[2]! * rgb[2]) as [number, number, number];
}
function oklabDistance(a: [number, number, number], b: [number, number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}
```

```ts
  it('every DEFAULT palette colour clears the warning line on BOTH cards — never a warning, let alone a refusal (ADR 042)', () => {
    for (const hex of DEFAULT_PALETTE) expect(judgeColor(hex), hex).toEqual({ ok: true, warning: null });
  });
  it('every CLASSIC palette colour is still accepted (never refused) — the Classic look must stay choosable', () => {
    for (const hex of RECHARTS_PALETTE) expect(judgeColor(hex).ok).toBe(true);
  });
  it('the first four default colours stay apart under protanopia, deuteranopia and tritanopia (OKLab distance ≥ 0.07)', () => {
    const four = DEFAULT_PALETTE.slice(0, 4);
    for (const [name, matrix] of Object.entries(CVD_MATRICES)) {
      for (let i = 0; i < four.length; i++) {
        for (let j = i + 1; j < four.length; j++) {
          const a = linearToOklab(simulate(matrix, hexToLinear(four[i]!)));
          const b = linearToOklab(simulate(matrix, hexToLinear(four[j]!)));
          expect(oklabDistance(a, b), `${name}: ${four[i]} vs ${four[j]}`).toBeGreaterThanOrEqual(0.07);
        }
      }
    }
  });
```

  In `describe('frame', …)`, update the literal pin in `'FRAME_GRADIENT_PRESETS carries the six named lowercase-hex pairs'` so `dawn` is `{ id: 'dawn', from: '#fde68a', to: '#f9a8d4' }` and `sand` is `{ id: 'sand', from: '#fef3c7', to: '#92400e' }`, and add:

```ts
  it('no gradient preset refuses ANY default-palette colour — presets are checked against the palette at design time (session-92 lesson)', () => {
    for (const preset of FRAME_GRADIENT_PRESETS) {
      for (const hex of DEFAULT_PALETTE) {
        expect(judgeColorAgainst(hex, [preset.from, preset.to]).ok, `${preset.id} × ${hex}`).toBe(true);
      }
    }
  });
```

  Add two new describe blocks at the end of the file:

```ts
describe('markerVisible — the "ends" marker mode (ADR 042)', () => {
  const ends = { first: '2019JJ00', last: '2024JJ00' };
  it('all: every point; provisionalOnly: only provisional points', () => {
    expect(markerVisible('all', false, '2021JJ00', ends)).toBe(true);
    expect(markerVisible('provisionalOnly', false, '2024JJ00', ends)).toBe(false);
    expect(markerVisible('provisionalOnly', true, '2021JJ00', ends)).toBe(true);
  });
  it('ends: the first and last plotted point, every provisional point, nothing else', () => {
    expect(markerVisible('ends', false, '2019JJ00', ends)).toBe(true);
    expect(markerVisible('ends', false, '2024JJ00', ends)).toBe(true);
    expect(markerVisible('ends', false, '2021JJ00', ends)).toBe(false);
    expect(markerVisible('ends', true, '2021JJ00', ends)).toBe(true);
  });
  it('a provisional point is ALWAYS visible in every mode (R11), and ends without endpoints shows only provisional points', () => {
    for (const mode of ['all', 'ends', 'provisionalOnly'] as const) expect(markerVisible(mode, true, 'x', null)).toBe(true);
    expect(markerVisible('ends', false, '2019JJ00', null)).toBe(false);
  });
});

describe('chartHeightForWidth — the height follows the width, clamped (ADR 042)', () => {
  it('is 256 below ~455 px, 9:16 of the width between, 360 at 640 px and above; unmeasured is 256', () => {
    expect(chartHeightForWidth(0)).toBe(CHART_MIN_HEIGHT_PX);
    expect(chartHeightForWidth(-5)).toBe(256);
    expect(chartHeightForWidth(Number.NaN)).toBe(256);
    expect(chartHeightForWidth(320)).toBe(256);
    expect(chartHeightForWidth(455)).toBe(256);
    expect(chartHeightForWidth(560)).toBe(315);
    expect(chartHeightForWidth(640)).toBe(360);
    expect(chartHeightForWidth(1200)).toBe(CHART_MAX_HEIGHT_PX);
  });
});
```

  Add `DEFAULT_PALETTE`, `CLASSIC_PRESENTATION`, `markerVisible`, `chartHeightForWidth`, `CHART_MIN_HEIGHT_PX`, `CHART_MAX_HEIGHT_PX` to the file's import list.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npx vitest run lib/chart-presentation.test.ts`
Expected: FAIL — `DEFAULT_PALETTE`/`CLASSIC_PRESENTATION`/`markerVisible`/`chartHeightForWidth` are not exported; the STOCK pin differs.

- [ ] **Step 3: Implement** in `web/lib/chart-presentation.ts`:

  1. Types: `export type MarkerMode = 'all' | 'ends' | 'provisionalOnly';` and `export type AreaFill = 'gradient' | 'flat';`. Add to `ChartPresentation`, directly after `zeroBaseline: BaselineMode;`:
  ```ts
  /** ADR 042: area form only — a vertical gradient fill (colour at the top
   * fading to almost nothing at the baseline) or the flat fill. Honest
   * either way because the area form already forces a zero baseline. */
  areaFill: AreaFill;
  ```
  2. Replace the palette comment + `RECHARTS_PALETTE` block with:
  ```ts
  // Series palettes.
  // `RECHARTS_PALETTE` — the session-87 "basic Recharts" look (the colours
  // Recharts' own documentation examples use). Since ADR 042 (2026-09-11) it
  // is no longer the default: it stays for the Classic look and for the
  // continuity pins.
  export const RECHARTS_PALETTE: readonly string[] = ['#8884d8', '#82ca9d', '#ffc658', '#ff7300', '#0088fe', '#00c49f', '#ffbb28', '#ff8042'];
  // `DEFAULT_PALETTE` — the designed default (ADR 042). The first four are
  // Okabe–Ito's blue / vermillion / bluish green / reddish purple (the
  // standard colour-blind-safe set); the other four are hand-tuned to the
  // same luminance band. Every entry is ≥ 3.0:1 against BOTH card colours
  // (no judgeColor warning on either theme — pinned) and the first four stay
  // ≥ 0.07 apart in OKLab under simulated protanopia / deuteranopia /
  // tritanopia (pinned). One palette for both themes: no theme hook, and the
  // export (which resolves against the light theme, #222) needs no special
  // case. Cycles for series nine and up; the Tabel view remains the honest
  // surface for many series.
  export const DEFAULT_PALETTE: readonly string[] = ['#0072b2', '#d55e00', '#009e73', '#cc79a7', '#b8860b', '#3a8fc4', '#6a5acd', '#6f8d2a'];
  ```
  3. Replace the `STOCK_PRESENTATION` block with:
  ```ts
  /** The session-87 literals (chart.tsx before WP218) — the "Classic" look,
   * kept verbatim for the Classic template and pinned by a test. */
  export const CLASSIC_PRESENTATION: ChartPresentation = {
    lineWidth: 'normal',
    markers: 'all',
    grid: 'both',
    xLabels: 'flat',
    axisLines: 'shown',
    valueLabels: 'shown',
    zeroBaseline: 'auto',
    areaFill: 'flat',
    seriesColors: {},
    fontFamily: null,
    language: null,
    frameBackground: 'none',
    framePadding: 'none',
    frameCorners: 'square',
    frameShadow: 'none',
    frameInset: 'none',
    frameAspect: 'auto',
  };

  /** The product's stock look = the designed default (ADR 042, 2026-09-11):
   * markers on the first and last point only, a quiet horizontal grid, no
   * axis lines (a hairline baseline is drawn by chart.tsx whenever a grid
   * is shown), a gradient area fill. Deep-equal pinned by a test so the
   * decision cannot drift without an edit. Colour comes from DEFAULT_PALETTE
   * via `seriesColor` (an empty `seriesColors` map = the palette). */
  export const STOCK_PRESENTATION: ChartPresentation = {
    lineWidth: 'normal',
    markers: 'ends',
    grid: 'horizontal',
    xLabels: 'flat',
    axisLines: 'hidden',
    valueLabels: 'shown',
    zeroBaseline: 'auto',
    areaFill: 'gradient',
    seriesColors: {},
    fontFamily: null,
    language: null,
    frameBackground: 'none',
    framePadding: 'none',
    frameCorners: 'square',
    frameShadow: 'none',
    frameInset: 'none',
    frameAspect: 'auto',
  };
  ```
  4. `overridesSchema`: `markers: z.enum(['all', 'ends', 'provisionalOnly']).optional(),` and add `areaFill: z.enum(['gradient', 'flat']).optional(),` after `zeroBaseline`.
  5. `ALL_KEYS`: add `'areaFill'` after `'zeroBaseline'`. In `resolvePresentation`, inside the `if (ctx.form !== 'table')` block, after the `for (const key of FRAME_KEYS)` loop add:
  ```ts
    // ADR 042: the fill is a property of the area form alone.
    if (ctx.form !== 'area') applicable.delete('areaFill');
  ```
  6. `seriesColor`: `return values.seriesColors[index] ?? DEFAULT_PALETTE[index % DEFAULT_PALETTE.length]!;`
  7. Presets: `{ id: 'dawn', from: '#fde68a', to: '#f9a8d4' }` and `{ id: 'sand', from: '#fef3c7', to: '#92400e' }`, with a comment line above the array: `// ADR 042: dawn's and sand's dark ends were retuned so no preset refuses any DEFAULT_PALETTE colour (the old sand end refused the first default colour, i.e. every chart) — gated by a test.`
  8. After `dotGeometry`, add:
  ```ts
  /** The first and last PLOTTED point of one series (periodCodes) — the
   * anchors of the 'ends' marker mode. Built by chart.tsx from the DISPLAYED
   * (possibly zoomed) spec so the visible window's own ends get markers. */
  export interface SeriesEndpoints {
    first: string;
    last: string;
  }

  /** ADR 042: which point markers are drawn. A provisional point is ALWAYS
   * visible (R11 — the hollow ring is honesty, not styling); 'all' draws every
   * point; 'ends' the first and last plotted point; 'provisionalOnly' none
   * else. Hidden markers stay in the DOM at opacity 0 (chart.tsx), so the
   * [data-point] count, keyboard walking and click-to-annotate never change. */
  export function markerVisible(mode: MarkerMode, provisional: boolean, periodCode: string, ends: SeriesEndpoints | null): boolean {
    if (provisional || mode === 'all') return true;
    if (mode === 'provisionalOnly') return false;
    return ends !== null && (periodCode === ends.first || periodCode === ends.last);
  }

  /** ADR 042: the chart's height follows the card's measured width — 9:16 of
   * it, never below 256 px (the pre-ADR-042 fixed `h-64`) nor above 360 px —
   * so a wide dock or chat chart stops looking squat. An unmeasured width
   * (SSR, jsdom, 0) keeps the 256 px floor. Applied by chart.tsx as an
   * explicit height from a ResizeObserver, never via CSS aspect-ratio (the
   * session-92 battle-test lesson). */
  export const CHART_MIN_HEIGHT_PX = 256;
  export const CHART_MAX_HEIGHT_PX = 360;
  export function chartHeightForWidth(width: number): number {
    if (!Number.isFinite(width) || width <= 0) return CHART_MIN_HEIGHT_PX;
    return Math.max(CHART_MIN_HEIGHT_PX, Math.min(CHART_MAX_HEIGHT_PX, Math.round(width * (9 / 16))));
  }
  ```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd web && npx vitest run lib/chart-presentation.test.ts`
Expected: PASS (all tests in the file).

- [ ] **Step 5: Typecheck** — `cd web && npx tsc --noEmit`. Expected: errors ONLY in files later tasks own (`chart.tsx`'s `hideFinal`, `chart-frame.tsx` is fine). If `chart.tsx` errors on `areaFill` missing from an object literal, that is expected until Task 2. If there are errors in `chart-presentation.ts` itself, fix them.

- [ ] **Step 6: Commit**

```bash
git add web/lib/chart-presentation.ts web/lib/chart-presentation.test.ts
git commit -m "feat(chart): the designed default in the presentation model — DEFAULT_PALETTE, ends markers, areaFill, height rule (ADR 042)" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Marks — 'ends' markers, gradient area fill, haloed 12 px value labels
**Files:**
- Modify: `web/components/chart.tsx` (`seriesStyle` ~line 142, `SeriesDot` ~736, `SeriesBar` label ~950, `RegionBar` label ~1045, the `endpointsByKey` computation next to `endLabelByKey` ~1595, the Line/Area `dot={SeriesDot(…)}` call sites ~2235/2311, the `AreaChart` block ~2255)
- Test: `web/components/chart.test.tsx`

**Interfaces:**
- Consumes (Task 1): `DEFAULT_PALETTE`, `markerVisible`, `SeriesEndpoints`, `MarkerMode`, `AreaFill` from `../lib/chart-presentation.ts`.
- Produces: `SeriesDot`'s geometry parameter is now `{ r: number; ring: number; markers: MarkerMode; ends: SeriesEndpoints | null }` (default `{ ...dotGeometry('normal'), markers: 'all', ends: null }`); `export { RECHARTS_PALETTE, DEFAULT_PALETTE } from '../lib/chart-presentation.ts'`; `seriesStyle(i)` returns `DEFAULT_PALETTE[i % length]`.

- [ ] **Step 1: Write the failing tests** — in `web/components/chart.test.tsx`:

  (a) Change line 581 `expect(RECHARTS_PALETTE[0]).toBe('#8884d8');` to `expect(DEFAULT_PALETTE[0]).toBe('#0072b2');` and lines 580/586/587 from `RECHARTS_PALETTE` to `DEFAULT_PALETTE` (the `seriesStyle` cycling test now describes the default palette); add `DEFAULT_PALETTE` to the import from `'./chart.tsx'` (it is re-exported there, see Step 3). Line 711, 2717, 2727, 2845 (`toBe(RECHARTS_PALETTE[0])`): change to `DEFAULT_PALETTE[0]`.

  (b) In the `describe('WP218 phase 0 — the stock look still renders exactly today\'s literals', …)` block (~line 796), rename it to `describe('ADR 042 — the designed default renders its literals', …)` and replace the test with:

```ts
  it('line stroke-width 2, dot r 4 ring 2, horizontal grid only, no y-axis line', () => {
    const { container } = render(<ChartView spec={threePointSpec()} />);
    const path = container.querySelector('.recharts-line-curve');
    expect(path?.getAttribute('stroke-width')).toBe('2');
    const dot = container.querySelector('circle[data-point="value"]');
    expect(dot?.getAttribute('r')).toBe('4');
    expect(dot?.getAttribute('stroke-width')).toBe('2');
    expect(container.querySelector('.recharts-cartesian-grid-horizontal')).not.toBeNull();
    expect(container.querySelector('.recharts-cartesian-grid-vertical')).toBeNull();
    expect(container.querySelector('.recharts-yAxis .recharts-cartesian-axis-line')).toBeNull();
  });
  it('ends markers by default: the first and last plotted point are drawn, the middle one is hidden (opacity 0, still a data point), a provisional middle point stays visible', () => {
    const s = spec({
      series: [
        {
          label: 'Nederland',
          regionCode: null,
          points: [
            point({ resultId: 'a', periodCode: '2022JJ00', periodLabel: '2022', value: 1, formattedValue: '1,0' }),
            point({ resultId: 'b', periodCode: '2023JJ00', periodLabel: '2023', value: 2, formattedValue: '2,0' }),
            point({ resultId: 'c', periodCode: '2024JJ00', periodLabel: '2024', value: 3, formattedValue: '3,0' }),
            point({ resultId: 'd', periodCode: '2025JJ00', periodLabel: '2025', value: 4, formattedValue: '4,0', provisional: true, status: 'Voorlopig' }),
            point({ resultId: 'e', periodCode: '2026JJ00', periodLabel: '2026', value: 5, formattedValue: '5,0' }),
          ],
        },
      ],
    });
    const { container } = render(<ChartView spec={s} />);
    const dots = [...container.querySelectorAll('circle[data-point="value"]')];
    expect(dots.length).toBe(5);
    const byId = (id: string) => dots.find((d) => d.getAttribute('data-result-id') === id)!;
    expect(byId('a').getAttribute('data-marker')).toBeNull();
    expect(byId('e').getAttribute('data-marker')).toBeNull();
    expect(byId('b').getAttribute('data-marker')).toBe('hidden');
    expect(byId('c').getAttribute('data-marker')).toBe('hidden');
    expect(byId('d').getAttribute('data-marker')).toBeNull();
    expect(byId('d').getAttribute('fill')).toBe('var(--card)');
  });
  it('value labels are 12 px with a card-coloured halo (paint-order stroke) — end label on a line, bar label on a bar', () => {
    const line = render(<ChartView spec={threePointSpec()} />).container;
    const end = line.querySelector('text[data-role="end-label"]')!;
    expect(end.getAttribute('font-size')).toBe('12');
    expect(end.getAttribute('paint-order')).toBe('stroke');
    expect(end.getAttribute('stroke')).toBe('var(--card)');
    expect(end.getAttribute('stroke-width')).toBe('3');
    const axisTick = line.querySelector('text[data-role="axis-tick"]')!;
    expect(axisTick.getAttribute('font-size')).toBe('11');
    const bar = render(<ChartView spec={spec({ kind: 'bar', series: [{ label: 'Amsterdam', regionCode: 'GM0363', points: [point({ resultId: 'x', periodCode: '2023JJ00', periodLabel: '2023', value: 1, formattedValue: '1,0' })] }] })} />).container;
    const barLabel = bar.querySelector('text[data-role="bar-label"]')!;
    expect(barLabel.getAttribute('font-size')).toBe('12');
    expect(barLabel.getAttribute('paint-order')).toBe('stroke');
    expect(barLabel.getAttribute('stroke')).toBe('var(--card)');
  });
```

  (c) In the existing area-form describe (the one containing `'the whole-card membership scan passes in area form'`, ~line 2700+), add:

```ts
  it('area form fills with a vertical gradient by default (a <linearGradient> per series, fill url(#…)), and flat when areaFill is flat', () => {
    const { container } = render(<ChartView spec={threePointSpec()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Vlak' }));
    const gradient = container.querySelector('svg defs linearGradient');
    expect(gradient).not.toBeNull();
    const stops = gradient!.querySelectorAll('stop');
    expect(stops.length).toBe(2);
    expect(stops[0]!.getAttribute('stop-color')).toBe(DEFAULT_PALETTE[0]);
    const area = container.querySelector('.recharts-area-area');
    expect(area?.getAttribute('fill')).toBe(`url(#${gradient!.getAttribute('id')})`);
    fireEvent.click(screen.getByRole('button', { name: 'Opmaak' }));
    fireEvent.click(screen.getByRole('button', { name: 'Verloop in het vlak' }));
    expect(container.querySelector('.recharts-area-area')?.getAttribute('fill')).toBe(DEFAULT_PALETTE[0]);
  });
```
  (The `'Verloop in het vlak'` toggle is added by Task 5 — until then this ONE test stays failing; run the file and confirm it is the only failure at the end of this task, and say so in your report.) Also update the existing area-form assertions at ~2717 (`area?.getAttribute('fill')).toBe(RECHARTS_PALETTE[0])`) — that test asserted a flat fill; change it to assert the fill STARTS WITH `url(#` (gradient by default).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npx vitest run components/chart.test.tsx -t "ADR 042|area form fills|ends markers|value labels are 12"`
Expected: FAIL on the new tests (grid vertical still rendered, markers all visible, 11 px labels, no gradient).

- [ ] **Step 3: Implement** in `web/components/chart.tsx`:

  1. Import `DEFAULT_PALETTE`, `markerVisible`, `type MarkerMode`, `type SeriesEndpoints` from `'../lib/chart-presentation.ts'` (keep `RECHARTS_PALETTE` only if still referenced; the re-export line becomes `export { RECHARTS_PALETTE, DEFAULT_PALETTE } from '../lib/chart-presentation.ts';`). Rewrite the palette comment above it to say: the default is `DEFAULT_PALETTE` (ADR 042); the session-87 "basic Recharts" palette is kept as `RECHARTS_PALETTE` for the Classic look; the hollow/hatched provisional marker (R11) is unchanged. `seriesStyle`: `return { color: DEFAULT_PALETTE[index % DEFAULT_PALETTE.length]! };`
  2. `SeriesDot`: change the `geometry` parameter type and default to
  ```ts
  geometry: { r: number; ring: number; markers: MarkerMode; ends: SeriesEndpoints | null } = { ...dotGeometry('normal'), markers: 'all', ends: null },
  ```
  and replace `const hiddenFinal = geometry.hideFinal && !provisional && !isStory;` with
  ```ts
    // ADR 042: which markers are drawn follows the resolved marker mode
    // (all / ends / provisionalOnly) via the pure `markerVisible`; the point
    // the story ring is on is always drawn (final-review fix, kept).
    const hiddenFinal = !markerVisible(geometry.markers, Boolean(provisional), String(payload.periodCode), geometry.ends) && !isStory;
  ```
  Update the parameter's doc comment: `hideFinal` no longer exists; describe `markers`/`ends`.
  3. Next to `const endLabelByKey = …` add:
  ```ts
  // ADR 042 ('ends' marker mode): the first and last PLOTTED point per series,
  // from the DISPLAYED spec (a zoomed window's own ends get the markers).
  const endpointsByKey = new Map<string, SeriesEndpoints>();
  displaySpec.series.forEach((series, i) => {
    const plotted = series.points.filter((p) => p.value !== null && p.formattedValue !== null);
    if (plotted.length > 0) endpointsByKey.set(`s${i}`, { first: plotted[0]!.periodCode, last: plotted[plotted.length - 1]!.periodCode });
  });
  ```
  4. Both `dot={SeriesDot(…)}` call sites (Line and Area): replace `{ ...dotGeometry(pres.lineWidth), hideFinal: pres.markers === 'provisionalOnly' }` with `{ ...dotGeometry(pres.lineWidth), markers: pres.markers, ends: endpointsByKey.get(s.key) ?? null }`.
  5. Area gradient — inside `<AreaChart …>` add, before the `CartesianGrid`:
  ```tsx
              {/* ADR 042: a vertical gradient fill per series (colour at the
                * top, almost nothing at the zero baseline). The <defs> ride
                * inside the exported <svg>, so the PNG/SVG keeps it; `url(#…)`
                * needs no paint resolution (chart-download.tsx). */}
              <defs>
                {seriesMeta.map((s) => (
                  <linearGradient key={s.key} id={`fill-${domId}-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={s.color} stopOpacity={0.28} />
                    <stop offset="100%" stopColor={s.color} stopOpacity={0.02} />
                  </linearGradient>
                ))}
              </defs>
  ```
  and on the `<Area>`: `fill={pres.areaFill === 'gradient' ? `url(#fill-${domId}-${s.key})` : s.color}` and `fillOpacity={pres.areaFill === 'gradient' ? (dimmed ? 0.4 : 1) : dimmed ? 0.1 : 0.25}`.
  6. Value labels — on the three `<text>` elements with `data-role="end-label"` (SeriesDot), `data-role="bar-label"` (SeriesBar and RegionBar): change `fontSize={11}` to `fontSize={12}` and add `paintOrder="stroke" stroke="var(--card)" strokeWidth={3} strokeLinejoin="round"`. Add one comment on the first: `// ADR 042: a card-coloured halo keeps the label legible where it crosses a line or bar; the export inliner resolves var(--card) against the light card (#222).` Leave `AxisTick`/`RegionAxisTick` at 11 px. For the bar label's negative-value branch keep `y + height + 12`.
  7. `web/components/chart-small-multiples.tsx` is unchanged (it never drew non-provisional markers).

- [ ] **Step 4: Run the tests**

Run: `cd web && npx vitest run components/chart.test.tsx components/chart-small-multiples.test.tsx components/chart-download.test.tsx components/chart-notes.test.tsx components/chart-story.test.tsx components/chart-toggle.test.tsx`
Expected: PASS except the ONE area-toggle test that waits for Task 5. Any other failure that encodes the OLD default (e.g. a test asserting every dot is visible, `#8884d8`, or a vertical grid by default) is updated to the NEW default with its name adjusted; a failure of a digit-scan / binding / R11 test is a real bug to fix in the implementation, never in the test.

- [ ] **Step 5: Typecheck** — `cd web && npx tsc --noEmit` → no errors.

- [ ] **Step 6: Commit**

```bash
git add web/components/chart.tsx web/components/chart.test.tsx
git commit -m "feat(chart): ends markers, gradient area fill, haloed 12 px value labels, default palette (ADR 042)" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Quiet grid with a hairline baseline, tooltip crosshair, export cursor guard
**Files:**
- Modify: `web/components/chart.tsx` (a new exported helper next to `yAxisDomain` ~line 168; the four `<XAxis>`/`<YAxis>`/`<Tooltip>` blocks ~2163–2445)
- Modify: `web/components/chart-download.tsx` (`buildAttributedClone` ~line 216)
- Test: `web/components/chart.test.tsx`, `web/components/chart-download.test.tsx`

**Interfaces:**
- Produces: `export function baselineAxisLine(pres: Pick<ChartPresentation, 'axisLines' | 'grid'>): boolean | { stroke: string }` in `chart.tsx`.

- [ ] **Step 1: Write the failing tests**

  (a) In `chart.test.tsx`, the existing test `'grid Geen removes the grid; Aslijnen off removes axis lines; Schuin tilts the x labels and reserves height'` (~line 1774) starts from a default that no longer draws a y-axis line. Rewrite its opening so it first turns axis lines ON, and its ending so it turns them OFF again:

```ts
  it('grid Geen removes the grid; Aslijnen toggles the axis lines; Schuin tilts the x labels and reserves height', () => {
    const { container } = render(<ChartView spec={threePointSpec()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Opmaak' }));
    // ADR 042: axis lines are off by default — switch them on to measure the plot bottom off the y-axis line.
    fireEvent.click(screen.getByRole('button', { name: 'Aslijnen' }));
    const flatBottom = Number(
      container.querySelector('.recharts-yAxis .recharts-cartesian-axis-line')?.getAttribute('y2'),
    );
    fireEvent.click(screen.getByRole('radio', { name: 'Schuin' }));
    const tiltedBottom = Number(
      container.querySelector('.recharts-yAxis .recharts-cartesian-axis-line')?.getAttribute('y2'),
    );
    expect(tiltedBottom).toBeLessThan(flatBottom);

    fireEvent.click(screen.getByRole('radio', { name: 'Geen' }));
    expect(container.querySelector('.recharts-cartesian-grid-horizontal')).toBeNull();
    expect(container.querySelector('.recharts-cartesian-grid-vertical')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Aslijnen' }));
    expect(container.querySelector('.recharts-xAxis .recharts-cartesian-axis-line')).toBeNull();
    expect(container.querySelector('.recharts-yAxis .recharts-cartesian-axis-line')).toBeNull();
  });
```
  Keep the original comment about Recharts' `<Text>` in jsdom where it was.

  (b) Add to the `describe('ADR 042 — the designed default renders its literals', …)` block from Task 2:

```ts
  it('a hairline baseline in the grid colour replaces the x-axis line by default; Aslijnen on draws real axis lines; grid Geen removes the baseline too', () => {
    const { container } = render(<ChartView spec={threePointSpec()} />);
    const xLine = () => container.querySelector('.recharts-xAxis .recharts-cartesian-axis-line');
    const yLine = () => container.querySelector('.recharts-yAxis .recharts-cartesian-axis-line');
    expect(xLine()?.getAttribute('stroke')).toBe('var(--border)');
    expect(yLine()).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Opmaak' }));
    fireEvent.click(screen.getByRole('button', { name: 'Aslijnen' }));
    expect(xLine()?.getAttribute('stroke')).toBe('var(--muted-foreground)');
    expect(yLine()?.getAttribute('stroke')).toBe('var(--muted-foreground)');
    fireEvent.click(screen.getByRole('button', { name: 'Aslijnen' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Geen' }));
    expect(xLine()).toBeNull();
  });
  it('baselineAxisLine: full axis line when shown; a grid-coloured hairline when hidden but a grid exists; nothing when neither', () => {
    expect(baselineAxisLine({ axisLines: 'shown', grid: 'none' })).toBe(true);
    expect(baselineAxisLine({ axisLines: 'hidden', grid: 'horizontal' })).toEqual({ stroke: 'var(--border)' });
    expect(baselineAxisLine({ axisLines: 'hidden', grid: 'both' })).toEqual({ stroke: 'var(--border)' });
    expect(baselineAxisLine({ axisLines: 'hidden', grid: 'none' })).toBe(false);
  });
  it('the bar and horizontal-bar forms get the same hairline baseline on their category axis', () => {
    const cmp = spec({
      kind: 'bar',
      series: [
        { label: 'Amsterdam', regionCode: 'GM0363', points: [point({ resultId: 'a', periodCode: '2023JJ00', periodLabel: '2023', value: 1, formattedValue: '1,0' })] },
        { label: 'Rotterdam', regionCode: 'GM0599', points: [point({ resultId: 'r', periodCode: '2023JJ00', periodLabel: '2023', value: 2, formattedValue: '2,0' })] },
      ],
    });
    const { container } = render(<ChartView spec={cmp} />);
    expect(container.querySelector('.recharts-xAxis .recharts-cartesian-axis-line')?.getAttribute('stroke')).toBe('var(--border)');
    fireEvent.click(screen.getByRole('tab', { name: 'Liggend' }));
    expect(container.querySelector('.recharts-yAxis .recharts-cartesian-axis-line')?.getAttribute('stroke')).toBe('var(--border)');
    expect(container.querySelector('.recharts-xAxis .recharts-cartesian-axis-line')).toBeNull();
  });
```
  Import `baselineAxisLine` from `'./chart.tsx'`.

  (c) In `chart-download.test.tsx`, find the existing test that builds a chart svg and calls `attributedSvgMarkup` (search for `attributedSvgMarkup(`), copy its svg-construction lines into a new test in the same describe and add a cursor node:

```ts
  it('drops any Recharts tooltip cursor from the export — a touch device\'s active crosshair must never bake into a PNG as a fake annotation line', () => {
    // (build `svg` exactly like the neighbouring test does)
    const cursor = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    cursor.setAttribute('class', 'recharts-tooltip-cursor');
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('stroke', 'var(--muted-foreground)');
    cursor.appendChild(line);
    svg.appendChild(cursor);
    const markup = attributedSvgMarkup(svg, 'Bron: CBS', () => null);
    expect(markup).not.toContain('recharts-tooltip-cursor');
    expect(svg.querySelector('.recharts-tooltip-cursor')).not.toBeNull(); // the live chart is untouched
  });
```
  (Use the same `resolvePaint`/`frame` arguments the neighbouring test passes; the exact `attributedSvgMarkup` signature is in `chart-download.tsx`.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npx vitest run components/chart.test.tsx components/chart-download.test.tsx -t "baseline|hairline|Aslijnen|tooltip cursor"`
Expected: FAIL (no `baselineAxisLine` export; x-axis line still `var(--muted-foreground)` or absent; cursor survives the export).

- [ ] **Step 3: Implement**

  1. `chart.tsx`, after `yAxisDomain`:
  ```ts
  /** ADR 042: the category (period/region) axis line. With Aslijnen on it is
   * the full axis line in AXIS_COLOR (Recharts' `true`); with Aslijnen off a
   * hairline BASELINE in the grid colour is still drawn as long as any grid
   * is shown — a quiet chart keeps its ground; grid none + axis lines off is
   * a bare plot, as a reader would expect. The number axis follows
   * `axisLines` alone. Recharts accepts SVG props for `axisLine`. */
  export function baselineAxisLine(pres: Pick<ChartPresentation, 'axisLines' | 'grid'>): boolean | { stroke: string } {
    if (pres.axisLines === 'shown') return true;
    return pres.grid === 'none' ? false : { stroke: GRID_COLOR };
  }
  ```
  (Import `type ChartPresentation` if not already imported.)
  2. Line, Area and vertical Bar `<XAxis dataKey="periodLabel" …>`: `axisLine={baselineAxisLine(pres)}` (tickLine unchanged). Horizontal bar: the CATEGORY axis is `<YAxis type="category" …>` → `axisLine={baselineAxisLine(pres)}`; its number `<XAxis type="number" …>` keeps `axisLine={pres.axisLines === 'shown'}`.
  3. Tooltip cursor — line and area `<Tooltip …>`: add `cursor={{ stroke: 'var(--muted-foreground)', strokeDasharray: '3 3', strokeOpacity: 0.6 }}`; vertical bar and hbar `<Tooltip …>`: add `cursor={{ fill: 'var(--muted)', fillOpacity: 0.6 }}` (Recharts' default bar cursor is a hardcoded light grey that ignores dark mode). One comment on the first: `// ADR 042: a muted crosshair; the export drops it (chart-download.tsx).`
  4. `chart-download.tsx`, in `buildAttributedClone`, directly AFTER the `withLightThemeResolution(() => inlineComputedPaint(svg, clone, resolvePaint));` line (the inliner pairs clone and original element-by-element, so the removal must come after it):
  ```ts
  // ADR 042: never bake the tooltip's hover/tap cursor into a file — on a
  // touch device the last tapped point's dashed crosshair can still be
  // active at download time and would read as an annotation line.
  for (const cursor of clone.querySelectorAll('.recharts-tooltip-cursor')) cursor.remove();
  ```

- [ ] **Step 4: Run the tests**

Run: `cd web && npx vitest run components/chart.test.tsx components/chart-download.test.tsx components/chart-small-multiples.test.tsx`
Expected: PASS (except the Task-5 area toggle test). Same rule as Task 2 for any other pin that encoded the old axis-line default.

- [ ] **Step 5: Typecheck** — `cd web && npx tsc --noEmit` → no errors.

- [ ] **Step 6: Commit**

```bash
git add web/components/chart.tsx web/components/chart.test.tsx web/components/chart-download.tsx web/components/chart-download.test.tsx
git commit -m "feat(chart): hairline baseline, muted tooltip crosshair, export drops the cursor (ADR 042)" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Height follows width, entrance, header hierarchy, legend chips
**Files:**
- Create: `web/lib/use-element-width.ts`, `web/lib/use-element-width.test.ts`
- Modify: `web/components/chart-frame.tsx` (reuse the hook; re-export `CHART_MIN_HEIGHT_PX`)
- Modify: `web/components/chart.tsx` (the hook call right after `const pres = resolved.values;` ~line 1420; the export container `className`/`style` ~2110–2138; the card header ~1862–1869; `SeriesLegend` classes ~660–712)
- Test: `web/components/chart.test.tsx`, `web/components/chart-frame.test.tsx` (unchanged expectations — run it)

**Interfaces:**
- Produces: `export function useElementWidth(ref: RefObject<HTMLElement | null>, enabled: boolean): number` — the element's border-box width from a ResizeObserver, 0 until measured or when disabled / no ResizeObserver.
- Consumes (Task 1): `chartHeightForWidth`, `CHART_MIN_HEIGHT_PX`.

- [ ] **Step 1: Write the failing tests**

  (a) `web/lib/use-element-width.test.ts`:

```ts
import { act, render } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useElementWidth } from './use-element-width.ts';

type Callback = (entries: { target: Element }[]) => void;
let callbacks: Callback[] = [];
class FakeResizeObserver {
  constructor(private readonly cb: Callback) { callbacks.push(cb); }
  observe(): void {}
  disconnect(): void { callbacks = callbacks.filter((c) => c !== this.cb); }
}

function Probe({ enabled, width }: { enabled: boolean; width: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const measured = useElementWidth(ref, enabled);
  return (
    <div ref={ref} data-testid="box" data-fake-width={width}>
      {measured}
    </div>
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('useElementWidth', () => {
  it('is 0 without a ResizeObserver (jsdom, SSR) and when disabled', () => {
    const { getByTestId } = render(<Probe enabled width={700} />);
    expect(getByTestId('box').textContent).toBe('0');
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    const disabled = render(<Probe enabled={false} width={700} />);
    expect(disabled.getByTestId('box').textContent).toBe('0');
    expect(callbacks.length).toBe(0);
  });
  it('reports the observed border-box width and ignores sub-pixel jitter', () => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    const { getByTestId } = render(<Probe enabled width={700} />);
    const box = getByTestId('box');
    box.getBoundingClientRect = () => ({ width: 700 }) as DOMRect;
    act(() => callbacks[0]!([{ target: box }]));
    expect(box.textContent).toBe('700');
    box.getBoundingClientRect = () => ({ width: 700.3 }) as DOMRect;
    act(() => callbacks[0]!([{ target: box }]));
    expect(box.textContent).toBe('700');
    box.getBoundingClientRect = () => ({ width: 400 }) as DOMRect;
    act(() => callbacks[0]!([{ target: box }]));
    expect(box.textContent).toBe('400');
  });
});
```

  (b) In `chart.test.tsx`, add to the ADR 042 describe block:

```ts
  it('height follows width: unmeasured (jsdom) keeps the 256 px class; a measured 700 px card gets an explicit 360 px height, 400 px gets 256 px; a frame aspect ratio switches it off', () => {
    const { container } = render(<ChartView spec={threePointSpec()} />);
    const panel = () => container.querySelector('[role="tabpanel"]') as HTMLElement;
    expect(panel().className).toContain('h-64');
    expect(panel().style.height).toBe('');
  });
```
  and a second test using the same `FakeResizeObserver` pattern as (a) (declare it at the top of the ADR 042 describe with `vi.stubGlobal('ResizeObserver', …)` in a `beforeEach` and `vi.unstubAllGlobals()` in `afterEach`):

```ts
  it('a measured width sets the explicit height (700 → 360, 400 → 256) and the class no longer pins h-64', () => {
    const { container } = render(<ChartView spec={threePointSpec()} />);
    const panel = container.querySelector('[role="tabpanel"]') as HTMLElement;
    panel.getBoundingClientRect = () => ({ width: 700 }) as DOMRect;
    act(() => resizeCallbacks[0]!([{ target: panel }]));
    expect(panel.style.height).toBe('360px');
    expect(panel.className).not.toContain('h-64');
    panel.getBoundingClientRect = () => ({ width: 400 }) as DOMRect;
    act(() => resizeCallbacks[0]!([{ target: panel }]));
    expect(panel.style.height).toBe('256px');
  });
  it('the export container carries the entrance utilities, with the reduced-motion opt-out', () => {
    const { container } = render(<ChartView spec={threePointSpec()} />);
    const panel = container.querySelector('[role="tabpanel"]') as HTMLElement;
    for (const cls of ['animate-in', 'fade-in', 'slide-in-from-bottom-1', 'duration-300', 'motion-reduce:animate-none']) {
      expect(panel.className).toContain(cls);
    }
  });
  it('the card header: a semibold base-size title, then the unit and the pinned dimensions on one muted line', () => {
    const s = spec({ dimLabels: { Geslacht: 'Totaal' } });
    const { container } = render(<ChartView spec={s} />);
    const heading = container.querySelector('[role="heading"][aria-level="3"]') as HTMLElement;
    expect(heading.className).toContain('text-base');
    expect(heading.className).toContain('font-semibold');
    const subtitle = heading.nextElementSibling as HTMLElement;
    expect(subtitle.className).toContain('text-muted-foreground');
    expect(subtitle.textContent).toContain(s.unit);
    expect(subtitle.textContent).toContain('Geslacht: Totaal');
  });
  it('legend entries are chips (rounded-full, bordered) and keep their toggle semantics', () => {
    const { container } = render(<ChartView spec={twoSeriesSpec()} />);
    const legendButtons = [...container.querySelectorAll('[role="group"] button[aria-pressed="true"]')];
    expect(legendButtons.length).toBeGreaterThan(0);
    for (const b of legendButtons) {
      expect(b.className).toContain('rounded-full');
      expect(b.className).toContain('border');
    }
  });
```
  (`twoSeriesSpec()` — use whatever multi-series fixture helper the file already has for legend tests; search for `SeriesLegend` or `aria-pressed` tests and reuse their fixture. Check how the `spec()` helper accepts `dimLabels`; if it does not, build the spec the way the dim-label test near `dimEntries` does.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npx vitest run lib/use-element-width.test.ts components/chart.test.tsx -t "useElementWidth|height follows|measured width|entrance|card header|legend entries are chips"`
Expected: FAIL (module missing; no inline height; no animate-in classes; `text-sm` title; `rounded-md` legend).

- [ ] **Step 3: Implement**

  1. `web/lib/use-element-width.ts`:
  ```ts
  // ADR 042: one ResizeObserver width hook for every "explicit height from a
  // measured width" rule (chart.tsx's height-follows-width, chart-frame.tsx's
  // aspect ratio) — the session-92 battle-test lesson made mechanical: never
  // CSS aspect-ratio, always a height set from the measured border-box width.
  import { useEffect, useState, type RefObject } from 'react';

  /** The element's border-box width, 0 until measured. `enabled: false`, a
   * missing ResizeObserver (SSR, jsdom) or a missing element all yield 0,
   * so callers fall back to their fixed default. Sub-pixel jitter (< 0.5 px)
   * is ignored so a fractional re-layout never loops. */
  export function useElementWidth(ref: RefObject<HTMLElement | null>, enabled: boolean): number {
    const [width, setWidth] = useState(0);
    useEffect(() => {
      if (!enabled || typeof ResizeObserver === 'undefined' || !ref.current) return undefined;
      const observer = new ResizeObserver((entries) => {
        const next = entries[0]?.target.getBoundingClientRect().width ?? 0;
        setWidth((current) => (Math.abs(current - next) < 0.5 ? current : next));
      });
      observer.observe(ref.current);
      return () => observer.disconnect();
    }, [ref, enabled]);
    return enabled ? width : 0;
  }
  ```
  2. `chart-frame.tsx`: replace its own `useRef`/`useState`/`useEffect` ResizeObserver block with `const ref = useRef<HTMLDivElement>(null); const measuredWidth = useElementWidth(ref, aspect !== null);` (keep the comment about border-box width, shortened), and replace `export const CHART_MIN_HEIGHT_PX = 256;` with `export { CHART_MIN_HEIGHT_PX } from '../lib/chart-presentation.ts';` plus the import for local use. `chart-frame.test.tsx` must keep passing unchanged.
  3. `chart.tsx`:
     - Right after `const pres = resolved.values;` (above the schemaVersion guard — a Hook, must run unconditionally):
     ```ts
     // ADR 042: the chart's height follows the card's measured width (a pure
     // rule, chartHeightForWidth) whenever nothing else sizes the box — no
     // frame aspect ratio (ChartFrame sets the height then), no small
     // multiples (its own grid grows), not the table. 0 until measured →
     // the h-64 floor, so SSR/jsdom render exactly as before.
     const autoHeight = pres.frameAspect === 'auto' && !(smallMultiples && smallMultiplesAvailable) && state.form !== 'table';
     const measuredWidth = useElementWidth(chartContainerRef, autoHeight);
     const autoHeightPx = autoHeight && measuredWidth > 0 ? chartHeightForWidth(measuredWidth) : null;
     ```
     (`smallMultiplesAvailable` is already computed above the guard — verify by reading the file; if it is defined BELOW this point, compute `autoHeight` right after it instead, but the `useElementWidth` call itself must stay above the `if (spec.schemaVersion !== 1)` guard: pass `pres.frameAspect === 'auto'` as `enabled` there and apply the small-multiples/table conditions when deriving `autoHeightPx`.)
     - Export container `className`: replace the `'h-64'` branch with `autoHeightPx !== null ? '' : 'h-64'`, i.e.
     ```ts
          (pres.frameAspect !== 'auto' && !(smallMultiples && smallMultiplesAvailable)
            ? 'h-full'
            : smallMultiples && smallMultiplesAvailable
              ? 'h-auto'
              : autoHeightPx !== null
                ? ''
                : 'h-64')
     ```
     and prepend the entrance utilities to the class string: `'chart-enter animate-in fade-in slide-in-from-bottom-1 duration-300 motion-reduce:animate-none mt-2 w-full touch-pan-y '` with a comment: `// ADR 042: a 300 ms fade/rise of the export CONTAINER on mount — outside the exported <svg>, so a download can never capture it; Recharts' own animation stays off (the recorded refusal). motion-reduce: honours prefers-reduced-motion.`
     - `style`: merge — `style={{ ...(fontStack(pres.fontFamily) ? { fontFamily: fontStack(pres.fontFamily) } : {}), ...(autoHeightPx !== null ? { height: autoHeightPx } : {}) }}` — but keep `style={undefined}` when both are absent so the stock DOM stays attribute-identical: compute `const containerStyle = …; style={Object.keys(containerStyle).length > 0 ? containerStyle : undefined}`.
     - Header (~1862): 
     ```tsx
      <div role="heading" aria-level={3} className="text-base font-semibold leading-snug text-foreground">
        {displaySpec.title}
      </div>
      {/* ADR 042: one muted subtitle line — the unit first, then the pinned
        * dimensions — as separate spans (tests and the digit scan read them
        * per text node). */}
      <div className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-muted-foreground">
        <span>{displaySpec.unit}</span>
        {dimEntries.length > 0 ? <span>{dimEntries.map(([k, v]) => `${k}: ${v}`).join(' · ')}</span> : null}
      </div>
     ```
     (replacing the two separate `text-xs text-muted-foreground` divs). Leave the schema-refusal heading as is.
     - `SeriesLegend`: the series button's className becomes
     ```ts
                'inline-flex min-h-6 items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40 ' +
                (hidden ? 'border-border text-muted-foreground line-through' : 'border-border bg-background text-foreground hover:bg-muted')
     ```
     (the highlight button keeps its quiet text style).
     - Import `useElementWidth` from `'../lib/use-element-width.ts'` and `chartHeightForWidth` from `'../lib/chart-presentation.ts'`.

- [ ] **Step 4: Run the tests**

Run: `cd web && npx vitest run lib/use-element-width.test.ts components/chart.test.tsx components/chart-frame.test.tsx components/chart-config-panel.test.tsx`
Expected: PASS (except the Task-5 area toggle test). If a legend test pinned `rounded-md`, update it to the chip class; if a test pinned the unit's own element (`.text-xs` div), point it at the new span.

- [ ] **Step 5: Typecheck** — `cd web && npx tsc --noEmit` → no errors.

- [ ] **Step 6: Commit**

```bash
git add web/lib/use-element-width.ts web/lib/use-element-width.test.ts web/components/chart-frame.tsx web/components/chart.tsx web/components/chart.test.tsx
git commit -m "feat(chart): height follows width, entrance, header hierarchy, chip legend (ADR 042)" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: The Style panel — the "First and last" marker option and the area-fill toggle
**Files:**
- Modify: `web/components/chart-config-panel.tsx` (`RADIO_GROUPS` ~line 203; `ToggleKey`/`buildToggles` ~439–452)
- Modify: `web/lib/i18n/messages.ts` (both tables)
- Test: `web/components/chart-config-panel.test.tsx`, `web/components/chart.test.tsx` (the Task-2 area toggle test turns green)

**Interfaces:**
- Consumes (Task 1): `areaFill` applicable only in area form; `markers: 'ends'`.
- Produces: catalogue keys `chart.panel.markersOption.ends` (nl `Eerste en laatste`, en `First and last`), `chart.panel.areaFill` (nl `Verloop in het vlak`, en `Gradient fill`).

- [ ] **Step 1: Write the failing tests** — in `chart-config-panel.test.tsx` (reuse the file's own `lineCtx` / `render` helpers and its `resolvePresentation` import):

```ts
  it('the Punten radiogroup offers three modes in order — Alle punten, Eerste en laatste, Alleen voorlopige — and emits ends', () => {
    const onChange = vi.fn();
    render(<ChartConfigPanel resolved={resolvePresentation(lineCtx, {})} seriesMeta={[]} onChange={onChange} onReset={() => {}} idPrefix="p" open onOpenChange={() => {}} triggerId="t" />);
    const group = screen.getByRole('radiogroup', { name: 'Punten' });
    const names = [...group.querySelectorAll('[role="radio"]')].map((r) => r.textContent);
    expect(names).toEqual(['Alle punten', 'Eerste en laatste', 'Alleen voorlopige']);
    expect(screen.getByRole('radio', { name: 'Eerste en laatste' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('radio', { name: 'Alle punten' }));
    expect(onChange).toHaveBeenCalledWith({ markers: 'all' });
  });
  it('the area-fill toggle is offered in area form only, pressed by default, and emits flat', () => {
    const onChange = vi.fn();
    const { unmount } = render(<ChartConfigPanel resolved={resolvePresentation({ ...lineCtx, form: 'area' }, {})} seriesMeta={[]} onChange={onChange} onReset={() => {}} idPrefix="p" open onOpenChange={() => {}} triggerId="t" />);
    const toggle = screen.getByRole('button', { name: 'Verloop in het vlak' });
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith({ areaFill: 'flat' });
    unmount();
    render(<ChartConfigPanel resolved={resolvePresentation(lineCtx, {})} seriesMeta={[]} onChange={onChange} onReset={() => {}} idPrefix="p" open onOpenChange={() => {}} triggerId="t" />);
    expect(screen.queryByRole('button', { name: 'Verloop in het vlak' })).toBeNull();
  });
  it('English: the new option and toggle read First and last / Gradient fill', () => {
    render(<ChartConfigPanel lang="en" resolved={resolvePresentation({ ...lineCtx, form: 'area' }, {})} seriesMeta={[]} onChange={() => {}} onReset={() => {}} idPrefix="p" open onOpenChange={() => {}} triggerId="t" />);
    expect(screen.getByRole('radio', { name: 'First and last' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Gradient fill' })).toBeTruthy();
  });
```
  (Match the props the file's other `render(<ChartConfigPanel …/>)` calls pass — copy their exact shape; the toggle buttons in this panel are `aria-pressed` buttons whose accessible name is the label — verify against the existing `'Aslijnen'` toggle test and mirror it.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npx vitest run components/chart-config-panel.test.tsx -t "three modes|area-fill toggle|First and last"`
Expected: FAIL (two radios; no such toggle; missing keys is a TYPE error — run typecheck too).

- [ ] **Step 3: Implement**

  1. `messages.ts` — in the `nl` table right after `'chart.panel.markersOption.all': 'Alle punten',` add `'chart.panel.markersOption.ends': 'Eerste en laatste',`; after `'chart.panel.zeroBaseline': …` (search for it) add `'chart.panel.areaFill': 'Verloop in het vlak',`. In the `en` table at the mirrored spots: `'chart.panel.markersOption.ends': 'First and last',` and `'chart.panel.areaFill': 'Gradient fill',`.
  2. `chart-config-panel.tsx` — `RADIO_GROUPS` markers options become `all` → `ends` → `provisionalOnly` (`{ value: 'ends', labelKey: 'chart.panel.markersOption.ends' }` in the middle). `type ToggleKey = 'axisLines' | 'valueLabels' | 'zeroBaseline' | 'areaFill';` and append to `buildToggles`: `{ key: 'areaFill', label: t(lang, 'chart.panel.areaFill'), onValue: 'gradient', offValue: 'flat' },`. The toggle render already skips keys outside `resolved.applicable` (verify by reading the toggle-rendering loop; if it does not, add the same `if (!resolved.applicable.has(toggle.key)) return null;` gate the radio groups use).

- [ ] **Step 4: Run the tests**

Run: `cd web && npx vitest run components/chart-config-panel.test.tsx components/chart.test.tsx`
Expected: PASS — including Task 2's `'area form fills with a vertical gradient by default…'` test and every whole-card digit scan with the panel open.

- [ ] **Step 5: Typecheck both** — `cd web && npx tsc --noEmit` and, from the repo root, `npx tsc --noEmit` → no errors.

- [ ] **Step 6: Commit**

```bash
git add web/components/chart-config-panel.tsx web/components/chart-config-panel.test.tsx web/lib/i18n/messages.ts
git commit -m "feat(chart): Style panel offers First and last markers and the area gradient toggle (ADR 042)" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## After the tasks (controller)
1. Whole-branch review (top tier) against docs/05 R1/R6/R11 and this plan's Global Constraints; fix round.
2. Full web suite, both typechecks, backend suite (solo), hermetic benchmark, `next build`, `test:docs`, `/code-review` LOW.
3. Screenshots (light + dark, a single-series line, a multi-series line, a comparison bar) for the PR.
4. Docs: ADR 042, 12-huisstijl, the redesign spec's superseded note, 08-build-plan, 03-mvp-scope, 04-architecture, open-questions, STATUS/archive/lessons.
5. PR against `main` (never a push to `main`).

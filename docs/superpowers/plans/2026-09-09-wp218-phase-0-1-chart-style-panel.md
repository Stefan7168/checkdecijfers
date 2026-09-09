# WP218 Phase 0 + 1 — Chart Style Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every CBS chart (`ChartView`) a fold-out "Opmaak" panel — Grafiek / Kleuren / Lettertype tabs — whose controls are pre-filled with what is on screen right now, change only geometry, decoration, colour and font, and can never switch off an honesty marking.

**Architecture:** A new pure module `web/lib/chart-presentation.ts` holds the `ChartPresentation` type, the test-pinned `STOCK_PRESENTATION` (today's literals), and a resolver that turns (chart context, user overrides) into the EFFECTIVE values plus per-option honesty locks. The ADR 038 reducer (`web/lib/chart-view-state.ts`) gains a `presentation` slice of plain overrides. Both the Recharts render in `chart.tsx` and the new dumb panel component `chart-config-panel.tsx` read only the resolver's effective values, so "pre-filled with current values" is a property of the design, not a snapshot. Source of the design: `docs/session-briefs/2026-09-09-session-90-chart-config-tool-synthesis.md` §2–§6 plus the owner's answers A–H on open-questions #218 and `docs/08-build-plan.md` § WP218.

**Tech Stack:** Next.js 16 (App Router), React 19, Recharts 3.10, Vitest + `@testing-library/react` + jsdom, Tailwind v4, shadcn (`base-nova`), zod ^4 (already a web dependency).

## Global Constraints

- **Invariants that hold in every task:** every number on a chart stays a spec string bound to its cell (R1/R6); the provisional marking (hollow marker / hatched bar, R11) can never be switched off — a chosen colour that would hide the hollow ring is refused with a reason; bars keep a zero baseline (#48); the export shows exactly what is on screen; the session-87 stock look stays the default and is a test-pinned constant; **all panel copy is digit-free** (the web-side honesty tests walk every text node of the whole card — `web/components/chart.test.tsx` "membership over the REAL svg" — so a "2 px" label or a "#8884d8" text node would fail them; hex codes therefore live ONLY in `<input>` values, never in text nodes).
- **Nothing in `src/` changes** except nothing at all: no `buildChartSpec`, no schema, no migration, no prompt bytes, no audit write. `chart-download.tsx` is not modified (its `inlineComputedPaint` already carries `stroke-width`, `r`, `font-family` verbatim into the export).
- **Owner decisions (session 90, binding):** E — each chart starts fresh: a spec swap on the same mounted `ChartView` CLEARS presentation overrides (the reducer's `reset` sets `presentation: {}`); G — the panel appears on every `ChartView` mount (chat, dock, Ontdek homepage, anonymous trial) with no per-mount switch; H — line thickness is four NAMED steps (Dun / Normaal / Dik / Extra dik = 1/2/3/4 px), never a number; B — a Kleuren tab with swatch + hex + colour picker per series, default the Recharts palette, plus a light+dark contrast warning and a refusal when the hollow R11 ring would vanish; the Lettertype tab offers a curated list.
- **Language of the panel copy: Dutch**, matching the chart card's own controls (Lijn/Staaf/Tabel, Vanaf/Tot, Kleine grafieken). All strings live in one `PANEL_COPY` object with `nl` and `en` variants so WP218 phase 4 (the EN/NL switch, #219) only has to pass a `lang` prop. Copy is calm and concrete (house rule 6).
- **House rules (docs/12-huisstijl.md):** tokens not colours for surfaces (`bg-muted`, `text-muted-foreground`, `border-border`); both themes always; primitives first (`components/ui/button.tsx`, `components/ui/input.tsx`) but hand-rolled `role="tablist"`/`role="radiogroup"` where tests pin the ARIA contract; the chart series colours are the one sanctioned literal-hex spot.
- **Test conventions:** tests co-located as `<file>.test.ts(x)`; run one file with `cd web && npx vitest run <path>`; the whole web suite with `cd web && npm test` (784 tests green at the start of this plan — every task ends with it green); Base UI components open with `fireEvent.click` in jsdom. Never run the backend suite (`npm test` at the root) while a subagent is running — it is OOM-killed on this 8 GB machine; it is run once, solo, at the end of the branch.
- **Commits:** on branch `wp218-chart-styling` (autonomous session → branch + PR per CLAUDE.md #118 rule (b)). Conventional prefixes (`feat(chart):`, `test(chart):`, `refactor(chart):`), body says what and why, trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Do not push; the session pushes.

---

## File map

| File | Responsibility |
|---|---|
| `web/lib/chart-presentation.ts` (new) | Pure: `ChartPresentation`, `STOCK_PRESENTATION`, `RECHARTS_PALETTE` (moved here from chart.tsx, re-exported there), `resolvePresentation`, `dotGeometry`, `xAxisHeight`, `seriesColor`, `normalizeHex`, `contrastRatio`, `judgeColor`, `FONT_OPTIONS`, `fontStack`, `sanitizeOverrides`. No React, no Recharts import. |
| `web/lib/chart-presentation.test.ts` (new) | Pure cases. |
| `web/lib/chart-view-state.ts` (modify) | `presentation` slice + `setPresentation` / `resetPresentation` actions; `reset` clears it. |
| `web/lib/chart-view-state.test.ts` (modify) | Reducer cases. |
| `web/lib/font-loader.ts` (new) + test | `ensureFontLoaded(option)`: injects one Google Fonts `<link>` per family, idempotent, no-op for system fonts / on the server. |
| `web/components/chart-config-panel.tsx` (new) + test | The dumb panel: trigger button + `role="region"` with three tabs, reading only `ResolvedPresentation`; emits `PresentationOverrides` patches. |
| `web/components/chart.tsx` (modify) | Resolve presentation next to `activeForm`; Recharts props read `resolved.values`; `SeriesDot` geometry from `dotGeometry`; mount the panel outside `chartContainerRef`; `aria-describedby` reason on the disabled Lijn tab. |
| `web/components/chart-small-multiples.tsx` (modify) | Reads `lineWidth`/`grid`/`seriesColors` and draws the hollow R11 marker for provisional points (today `dot={false}` — the gap). |
| `web/components/user-chart.tsx` (modify, Phase 0 only) | Its identical `strokeWidth={2}` literal reads `LINE_WIDTH_PX[STOCK_PRESENTATION.lineWidth]`. No panel (it has no reducer; ADR 037 H2 keeps it separate). |
| `docs/decisions/039-chart-presentation-panel.md` (new) | The ADR (Task 9). |

---

### Task 1: `chart-presentation.ts` — type, stock constant, palette, resolver

**Files:**
- Create: `web/lib/chart-presentation.ts`
- Test: `web/lib/chart-presentation.test.ts`
- Modify: `web/components/chart.tsx` (only: `RECHARTS_PALETTE` moves — see Step 3)

**Interfaces:**
- Produces (used by every later task):

```ts
export type LineWidth = 'thin' | 'normal' | 'thick' | 'extraThick';
export const LINE_WIDTH_PX: Record<LineWidth, number> = { thin: 1, normal: 2, thick: 3, extraThick: 4 };
export type MarkerMode = 'all' | 'provisionalOnly';
export type GridMode = 'both' | 'horizontal' | 'none';
export type XLabelMode = 'flat' | 'tilted';
export type OnOff = 'shown' | 'hidden';
export type BaselineMode = 'auto' | 'zero';

export interface ChartPresentation {
  lineWidth: LineWidth;
  markers: MarkerMode;
  grid: GridMode;
  xLabels: XLabelMode;
  axisLines: OnOff;
  valueLabels: OnOff;
  zeroBaseline: BaselineMode;
  /** Series index → lowercase '#rrggbb'. Absent index = palette colour. */
  seriesColors: Record<number, string>;
  /** A family name from FONT_OPTIONS (or, later, a brand font); null = the page font. */
  fontFamily: string | null;
}
export type PresentationOverrides = Partial<ChartPresentation>;
export type PresentationKey = keyof ChartPresentation;

export const RECHARTS_PALETTE: readonly string[]; // moved here verbatim from chart.tsx
export const STOCK_PRESENTATION: ChartPresentation; // today's literals, test-pinned

export interface PresentationContext {
  kind: 'line' | 'bar';          // spec.kind (the chart's true shape)
  form: 'line' | 'bar' | 'table'; // what is on screen (activeForm)
  seriesCount: number;
  hasProvisional: boolean;
}
export interface ResolvedPresentation {
  values: ChartPresentation;                          // effective — what Recharts draws
  locks: Partial<Record<PresentationKey, string>>;    // key → digit-free Dutch reason
  applicable: ReadonlySet<PresentationKey>;           // keys the panel should show for this form
  pristine: boolean;                                  // no override survived sanitizing
}
export function resolvePresentation(ctx: PresentationContext, overrides: PresentationOverrides, base?: ChartPresentation): ResolvedPresentation;
export function dotGeometry(w: LineWidth): { r: number; ring: number }; // r = max(4, px + 2), ring = 2
export function xAxisHeight(mode: XLabelMode, longestLabel: string): number | undefined; // flat → undefined (Recharts default 30); tilted → min(96, ceil(longest.length * 6.5 * 0.71) + 20)
export function seriesColor(values: Pick<ChartPresentation, 'seriesColors'>, index: number): string;
export function sanitizeOverrides(raw: unknown): PresentationOverrides; // zod allow-list; unknown keys/values dropped, never throws
```

**Resolver rules (the whole honesty story — implement exactly):**

| Key | Applicable when | Lock (value forced, reason string) |
|---|---|---|
| `lineWidth` | form `line` | — |
| `markers` | form `line` | — (hollow provisional markers are drawn regardless of the value; the value only hides NON-provisional dots) |
| `grid` | form `line` or `bar` | — |
| `xLabels` | form `line` or `bar` | — |
| `axisLines` | form `line` or `bar` | — |
| `valueLabels` | form `line` or `bar` | form `bar` → forced `'shown'`, reason `PANEL_COPY.nl.lockValueLabelsBar` = `'Zonder waarden heeft een staafdiagram geen schaal: de as toont bewust geen eigen getallen.'` |
| `zeroBaseline` | form `line` | form `bar` → forced `'zero'`, reason `'Een staafdiagram begint altijd bij nul.'` (applicable false, but the lock is still reported so the panel can explain) |
| `seriesColors` | form `line` or `bar` | — (per-colour refusal happens in `judgeColor`, Task 2, before a value ever reaches the overrides) |
| `fontFamily` | always (also table) | — |

Nothing is applicable in form `table` except `fontFamily` (the panel hides everything else — Task 6).

`resolvePresentation` = `sanitizeOverrides(overrides)` → `values = { ...base, ...sanitized }` (with `seriesColors` = `{ ...base.seriesColors, ...sanitized.seriesColors }`) → apply locks → `pristine = Object.keys(sanitized).length === 0` (an empty `seriesColors: {}` counts as no override).

- [ ] **Step 1: Write the failing tests** — `web/lib/chart-presentation.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  LINE_WIDTH_PX,
  RECHARTS_PALETTE,
  STOCK_PRESENTATION,
  dotGeometry,
  resolvePresentation,
  sanitizeOverrides,
  seriesColor,
  xAxisHeight,
  type PresentationContext,
} from './chart-presentation.ts';

const lineCtx: PresentationContext = { kind: 'line', form: 'line', seriesCount: 2, hasProvisional: false };
const barCtx: PresentationContext = { kind: 'bar', form: 'bar', seriesCount: 3, hasProvisional: false };
const tableCtx: PresentationContext = { kind: 'line', form: 'table', seriesCount: 2, hasProvisional: false };

describe('STOCK_PRESENTATION — the session-87 stock look, pinned', () => {
  it('deep-equals the literals chart.tsx drew before this module existed', () => {
    expect(STOCK_PRESENTATION).toEqual({
      lineWidth: 'normal',
      markers: 'all',
      grid: 'both',
      xLabels: 'flat',
      axisLines: 'shown',
      valueLabels: 'shown',
      zeroBaseline: 'auto',
      seriesColors: {},
      fontFamily: null,
    });
    expect(LINE_WIDTH_PX.normal).toBe(2);
    expect(RECHARTS_PALETTE).toEqual(['#8884d8', '#82ca9d', '#ffc658', '#ff7300', '#0088fe', '#00c49f', '#ffbb28', '#ff8042']);
  });
});

describe('resolvePresentation', () => {
  it('with no overrides returns the base values, no locks on a line, pristine', () => {
    const r = resolvePresentation(lineCtx, {});
    expect(r.values).toEqual(STOCK_PRESENTATION);
    expect(r.locks).toEqual({});
    expect(r.pristine).toBe(true);
    expect([...r.applicable].sort()).toEqual(
      ['axisLines', 'fontFamily', 'grid', 'lineWidth', 'markers', 'seriesColors', 'valueLabels', 'xLabels', 'zeroBaseline'].sort(),
    );
  });

  it('applies an override and is no longer pristine', () => {
    const r = resolvePresentation(lineCtx, { lineWidth: 'thick', grid: 'none' });
    expect(r.values.lineWidth).toBe('thick');
    expect(r.values.grid).toBe('none');
    expect(r.pristine).toBe(false);
  });

  it('bar form: value labels are forced shown and the baseline forced to zero, each with a digit-free reason', () => {
    const r = resolvePresentation(barCtx, { valueLabels: 'hidden', zeroBaseline: 'auto' });
    expect(r.values.valueLabels).toBe('shown');
    expect(r.values.zeroBaseline).toBe('zero');
    expect(r.locks.valueLabels).toMatch(/staafdiagram/);
    expect(r.locks.zeroBaseline).toMatch(/nul/);
    expect(r.locks.valueLabels).not.toMatch(/\d/);
    expect(r.locks.zeroBaseline).not.toMatch(/\d/);
    expect(r.applicable.has('lineWidth')).toBe(false);
    expect(r.applicable.has('markers')).toBe(false);
    expect(r.applicable.has('zeroBaseline')).toBe(false);
    expect(r.applicable.has('grid')).toBe(true);
  });

  it('table form: only the font is applicable', () => {
    const r = resolvePresentation(tableCtx, { lineWidth: 'thick' });
    expect([...r.applicable]).toEqual(['fontFamily']);
  });

  it('a stale override for a locked key never leaks into the values (locks re-run per call)', () => {
    const chosenOnLine = resolvePresentation(lineCtx, { valueLabels: 'hidden' });
    expect(chosenOnLine.values.valueLabels).toBe('hidden');
    const sameOverridesOnBar = resolvePresentation(barCtx, { valueLabels: 'hidden' });
    expect(sameOverridesOnBar.values.valueLabels).toBe('shown');
  });

  it('merges series colours per index on top of the base and ignores junk', () => {
    const r = resolvePresentation(lineCtx, { seriesColors: { 1: '#ff0000' } }, { ...STOCK_PRESENTATION, seriesColors: { 0: '#00ff00' } });
    expect(r.values.seriesColors).toEqual({ 0: '#00ff00', 1: '#ff0000' });
    expect(seriesColor(r.values, 0)).toBe('#00ff00');
    expect(seriesColor(r.values, 1)).toBe('#ff0000');
    expect(seriesColor(r.values, 2)).toBe(RECHARTS_PALETTE[2]);
    expect(seriesColor(r.values, 9)).toBe(RECHARTS_PALETTE[1]); // cycles like seriesStyle did
  });

  it('an empty seriesColors override still counts as pristine', () => {
    expect(resolvePresentation(lineCtx, { seriesColors: {} }).pristine).toBe(true);
  });
});

describe('sanitizeOverrides — allow-list, never throws', () => {
  it('drops unknown keys, wrong enum values, malformed colours and non-objects', () => {
    expect(sanitizeOverrides(null)).toEqual({});
    expect(sanitizeOverrides('x')).toEqual({});
    expect(sanitizeOverrides({ lineWidth: 'huge', grid: 'none', bogus: 1 })).toEqual({ grid: 'none' });
    expect(sanitizeOverrides({ seriesColors: { 0: '#ABCDEF', 1: 'red', x: '#000000' } })).toEqual({ seriesColors: { 0: '#abcdef' } });
    expect(sanitizeOverrides({ fontFamily: 'Roboto' })).toEqual({ fontFamily: 'Roboto' });
    expect(sanitizeOverrides({ fontFamily: '<script>' })).toEqual({});
    expect(sanitizeOverrides({ fontFamily: null })).toEqual({ fontFamily: null });
  });
});

describe('geometry helpers', () => {
  it('dotGeometry keeps the hollow ring legible at every width (r = max(4, px + 2), ring 2)', () => {
    expect(dotGeometry('thin')).toEqual({ r: 4, ring: 2 });
    expect(dotGeometry('normal')).toEqual({ r: 4, ring: 2 });
    expect(dotGeometry('thick')).toEqual({ r: 5, ring: 2 });
    expect(dotGeometry('extraThick')).toEqual({ r: 6, ring: 2 });
  });
  it('xAxisHeight reserves room only for tilted labels, capped', () => {
    expect(xAxisHeight('flat', '2021 1e kwartaal')).toBeUndefined();
    expect(xAxisHeight('tilted', '2021')).toBe(Math.ceil(4 * 6.5 * 0.71) + 20);
    expect(xAxisHeight('tilted', 'x'.repeat(200))).toBe(96);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && npx vitest run lib/chart-presentation.test.ts`
Expected: FAIL — cannot resolve `./chart-presentation.ts`.

- [ ] **Step 3: Implement `web/lib/chart-presentation.ts`**

```ts
// WP218 (ADR 039): the chart PRESENTATION layer — pure, no React, no Recharts.
// A presentation is a set of plain user overrides on top of the session-87
// stock look; `resolvePresentation` turns (chart context, overrides) into the
// EFFECTIVE values Recharts draws from plus the per-option honesty locks the
// panel explains. Nothing here ever enters a ChartSpec, buildChartSpec or an
// audit record — it projects an unchanged server-built spec for display,
// exactly like windowSpec in chart-view-state.ts.
import { z } from 'zod';

export type LineWidth = 'thin' | 'normal' | 'thick' | 'extraThick';
export const LINE_WIDTH_PX: Record<LineWidth, number> = { thin: 1, normal: 2, thick: 3, extraThick: 4 };
export type MarkerMode = 'all' | 'provisionalOnly';
export type GridMode = 'both' | 'horizontal' | 'none';
export type XLabelMode = 'flat' | 'tilted';
export type OnOff = 'shown' | 'hidden';
export type BaselineMode = 'auto' | 'zero';

export interface ChartPresentation {
  lineWidth: LineWidth;
  markers: MarkerMode;
  grid: GridMode;
  xLabels: XLabelMode;
  axisLines: OnOff;
  valueLabels: OnOff;
  zeroBaseline: BaselineMode;
  seriesColors: Record<number, string>;
  fontFamily: string | null;
}
export type PresentationOverrides = Partial<ChartPresentation>;
export type PresentationKey = keyof ChartPresentation;

// Series palette — session 87 visual redesign (owner decision, docs/
// superpowers/specs/2026-09-07-chat-chart-visual-redesign-design.md): "use the
// basic Recharts style" = the colours Recharts' own documentation examples
// use. Moved here from chart.tsx (re-exported there) so the pure resolver can
// own the default colour without importing React.
export const RECHARTS_PALETTE: readonly string[] = ['#8884d8', '#82ca9d', '#ffc658', '#ff7300', '#0088fe', '#00c49f', '#ffbb28', '#ff8042'];

/** Today's literals (chart.tsx before WP218) — the stock look is pinned by a
 * deep-equal test so the session-87 decision cannot drift without an edit. */
export const STOCK_PRESENTATION: ChartPresentation = {
  lineWidth: 'normal',
  markers: 'all',
  grid: 'both',
  xLabels: 'flat',
  axisLines: 'shown',
  valueLabels: 'shown',
  zeroBaseline: 'auto',
  seriesColors: {},
  fontFamily: null,
};

export const HEX_COLOR = /^#[0-9a-f]{6}$/;
// A font family is a plain name: letters, digits, spaces — nothing that could
// leak into a CSS string or a Google Fonts URL as syntax.
export const FONT_FAMILY_NAME = /^[A-Za-z0-9 ]{1,40}$/;

const hexSchema = z.string().transform((s) => s.toLowerCase()).pipe(z.string().regex(HEX_COLOR));
const overridesSchema = z.object({
  lineWidth: z.enum(['thin', 'normal', 'thick', 'extraThick']).optional(),
  markers: z.enum(['all', 'provisionalOnly']).optional(),
  grid: z.enum(['both', 'horizontal', 'none']).optional(),
  xLabels: z.enum(['flat', 'tilted']).optional(),
  axisLines: z.enum(['shown', 'hidden']).optional(),
  valueLabels: z.enum(['shown', 'hidden']).optional(),
  zeroBaseline: z.enum(['auto', 'zero']).optional(),
  seriesColors: z.record(z.string(), z.unknown()).optional(),
  fontFamily: z.string().regex(FONT_FAMILY_NAME).nullable().optional(),
});

/** Allow-list parse of anything claiming to be overrides (a reducer patch, a
 * stored row, a URL someday). Unknown keys, wrong enum values, malformed
 * colours and non-numeric series indexes are DROPPED, never thrown on. */
export function sanitizeOverrides(raw: unknown): PresentationOverrides {
  if (raw === null || typeof raw !== 'object') return {};
  const out: PresentationOverrides = {};
  // Per-key parse so one bad key doesn't discard its siblings.
  for (const key of Object.keys(overridesSchema.shape) as PresentationKey[]) {
    if (!(key in raw)) continue;
    const parsed = overridesSchema.pick({ [key]: true } as never).safeParse({ [key]: (raw as Record<string, unknown>)[key] });
    if (!parsed.success) continue;
    const value = (parsed.data as Record<string, unknown>)[key];
    if (value === undefined) continue;
    if (key === 'seriesColors') {
      const colors: Record<number, string> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        const index = /^\d+$/.test(k) ? Number(k) : NaN;
        const hex = hexSchema.safeParse(v);
        if (Number.isInteger(index) && hex.success) colors[index] = hex.data;
      }
      out.seriesColors = colors;
    } else {
      (out as Record<string, unknown>)[key] = value;
    }
  }
  return out;
}

export interface PresentationContext {
  kind: 'line' | 'bar';
  form: 'line' | 'bar' | 'table';
  seriesCount: number;
  hasProvisional: boolean;
}

export interface ResolvedPresentation {
  values: ChartPresentation;
  locks: Partial<Record<PresentationKey, string>>;
  applicable: ReadonlySet<PresentationKey>;
  pristine: boolean;
}

// Lock reasons: fixed, digit-free Dutch strings (the whole-card honesty
// scans in chart.test.tsx tokenise every text node — a digit here would be
// the first non-CBS number inside the card). English variants live in
// PANEL_COPY (chart-config-panel.tsx) for phase 4; the resolver only ever
// needs one language because the panel maps reasons by key, not by text.
export const LOCK_REASONS = {
  valueLabelsBar: 'Zonder waarden heeft een staafdiagram geen schaal: de as toont bewust geen eigen getallen.',
  zeroBaselineBar: 'Een staafdiagram begint altijd bij nul.',
} as const;

const ALL_KEYS: PresentationKey[] = ['lineWidth', 'markers', 'grid', 'xLabels', 'axisLines', 'valueLabels', 'zeroBaseline', 'seriesColors', 'fontFamily'];

export function resolvePresentation(
  ctx: PresentationContext,
  overrides: PresentationOverrides,
  base: ChartPresentation = STOCK_PRESENTATION,
): ResolvedPresentation {
  const clean = sanitizeOverrides(overrides);
  const values: ChartPresentation = {
    ...base,
    ...clean,
    seriesColors: { ...base.seriesColors, ...(clean.seriesColors ?? {}) },
  };
  const locks: Partial<Record<PresentationKey, string>> = {};
  const applicable = new Set<PresentationKey>();
  if (ctx.form === 'table') {
    applicable.add('fontFamily');
  } else {
    for (const key of ALL_KEYS) applicable.add(key);
    if (ctx.form === 'bar') {
      applicable.delete('lineWidth');
      applicable.delete('markers');
      applicable.delete('zeroBaseline');
      values.valueLabels = 'shown';
      locks.valueLabels = LOCK_REASONS.valueLabelsBar;
      values.zeroBaseline = 'zero';
      locks.zeroBaseline = LOCK_REASONS.zeroBaselineBar;
    }
  }
  const pristine = Object.keys(clean).every((k) => k === 'seriesColors' && Object.keys(clean.seriesColors ?? {}).length === 0);
  return { values, locks, applicable, pristine };
}

/** R11: the hollow provisional ring must stay legible at every stroke width —
 * the marker grows with the line so a 4 px stroke cannot swallow a 2 px ring. */
export function dotGeometry(w: LineWidth): { r: number; ring: number } {
  return { r: Math.max(4, LINE_WIDTH_PX[w] + 2), ring: 2 };
}

/** Tilted x labels need reserved axis height or the export clips them (the
 * svg height is fixed by the container). 6.5 px/char at the 11 px label font
 * (labelWidthPx in chart.tsx) × sin 45° ≈ 0.71, plus padding, capped. */
export function xAxisHeight(mode: XLabelMode, longestLabel: string): number | undefined {
  if (mode === 'flat') return undefined;
  return Math.min(96, Math.ceil(longestLabel.length * 6.5 * 0.71) + 20);
}

export function seriesColor(values: Pick<ChartPresentation, 'seriesColors'>, index: number): string {
  return values.seriesColors[index] ?? RECHARTS_PALETTE[index % RECHARTS_PALETTE.length]!;
}
```

Note on `sanitizeOverrides`: if the per-key `pick` typing fights you, replace it with a straightforward hand-written switch per key using the same enums — behaviour (per-key drop, lowercase hex, integer index) is what the tests pin, not the zod call shape.

Then in `web/components/chart.tsx` replace the `export const RECHARTS_PALETTE = [...]` line with
`export { RECHARTS_PALETTE } from '../lib/chart-presentation.ts';` (keep the long owner-decision comment above it) and add `import { RECHARTS_PALETTE } from '../lib/chart-presentation.ts';` for `seriesStyle`'s own use (an `export { x } from` does not bind `x` locally).

- [ ] **Step 4: Run the tests**

Run: `cd web && npx vitest run lib/chart-presentation.test.ts components/chart.test.tsx`
Expected: PASS (chart.test.tsx still imports `RECHARTS_PALETTE` from chart.tsx — unchanged behaviour).

- [ ] **Step 5: Commit**

```bash
git add web/lib/chart-presentation.ts web/lib/chart-presentation.test.ts web/components/chart.tsx
git commit -m "feat(chart): chart-presentation module — stock look pinned, resolver with honesty locks (WP218 phase 0)"
```

---

### Task 2: Colour judgement + font options + font loader

**Files:**
- Modify: `web/lib/chart-presentation.ts` (append)
- Modify: `web/lib/chart-presentation.test.ts` (append)
- Create: `web/lib/font-loader.ts`, `web/lib/font-loader.test.ts`

**Interfaces:**
- Produces:

```ts
export const CARD_LIGHT = '#ffffff';  // globals.css :root --card oklch(1 0 0)
export const CARD_DARK = '#171717';   // globals.css .dark --card oklch(0.205 0 0) ≈ #171717
export function normalizeHex(input: string): string | null;      // '#ABC' → '#aabbcc', 'abc123' → '#abc123', 'red' → null
export function contrastRatio(hexA: string, hexB: string): number; // WCAG 2.x relative-luminance ratio, ≥ 1
export type ColorVerdict =
  | { ok: true; warning: 'light' | 'dark' | 'both' | null }
  | { ok: false; reason: string };
export function judgeColor(hex: string): ColorVerdict;
export interface FontOption { family: string; source: 'system' | 'google'; stack: string }
export const FONT_OPTIONS: readonly FontOption[];
export function findFont(family: string | null): FontOption | undefined;
export function fontStack(family: string | null): string | undefined; // undefined = inherit the page font

// web/lib/font-loader.ts
export function ensureFontLoaded(option: FontOption): void;
export const GOOGLE_FONTS_ORIGIN = 'https://fonts.googleapis.com';
```

**Thresholds (owner decision B, "the hollow ring must never vanish"):** the hollow R11 marker is a ring stroked in the series colour on a `var(--card)` fill. `judgeColor` REFUSES a colour whose contrast against EITHER card colour is below `1.25` (indistinguishable from the card in one theme — the ring disappears), reason `'Deze kleur is niet toegepast: de open markering voor voorlopige cijfers zou in een van de thema’s onzichtbaar worden.'`; it WARNS (still applied) when the contrast against a card is below `3` — `'light'` when only the light card fails, `'dark'` when only the dark one, `'both'`. Every stock palette colour must be `ok: true` (the stock `#ffc658` on white is ≈1.55:1 — a warning, never a refusal).

**Fonts:** a curated list, loaded on demand (no `next/font` bundle growth): Standaard (null — the page's Inter), then `Roboto`, `Open Sans`, `Lato`, `Merriweather`, `Playfair Display` (Google), `Georgia`, `Arial` (system). `fontStack('Roboto')` → `'"Roboto", ui-sans-serif, system-ui, sans-serif'`; serif families end in `serif`; `fontStack(null)` → `undefined`. `ensureFontLoaded` appends one `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;600&display=swap">` per Google family to `document.head`, keyed by `data-font-family`, idempotent; no-op for system fonts and when `document` is undefined. Known limit to document in ADR 039: the PNG export rasterises through an `<img>`, which cannot load web fonts, so a PNG falls back to a system font; the SVG export keeps the family name.

- [ ] **Step 1: Append the failing tests** to `web/lib/chart-presentation.test.ts`:

```ts
import { CARD_DARK, CARD_LIGHT, FONT_OPTIONS, contrastRatio, findFont, fontStack, judgeColor, normalizeHex } from './chart-presentation.ts';

describe('colours — normalise, contrast, judge', () => {
  it('normalizeHex accepts 3- and 6-digit forms with or without #, lowercases, rejects the rest', () => {
    expect(normalizeHex('#ABCDEF')).toBe('#abcdef');
    expect(normalizeHex('abc')).toBe('#aabbcc');
    expect(normalizeHex('#12345')).toBeNull();
    expect(normalizeHex('red')).toBeNull();
    expect(normalizeHex('')).toBeNull();
  });
  it('contrastRatio is the WCAG ratio (white/black = 21, identical = 1)', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 0);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0);
  });
  it('every stock palette colour is accepted (never refused) — the default look must always be choosable', () => {
    for (const hex of RECHARTS_PALETTE) expect(judgeColor(hex).ok).toBe(true);
  });
  it('refuses near-white (invisible on the light card) and near-black (invisible on the dark card) with a digit-free reason', () => {
    const white = judgeColor('#fefefe');
    expect(white.ok).toBe(false);
    if (!white.ok) expect(white.reason).not.toMatch(/\d/);
    expect(judgeColor(CARD_DARK).ok).toBe(false);
    expect(judgeColor('#1a1a1a').ok).toBe(false);
  });
  it('warns per theme when contrast is weak but the ring is still visible', () => {
    expect(judgeColor('#ffc658')).toEqual({ ok: true, warning: 'light' });
    expect(judgeColor('#3a3a3a')).toEqual({ ok: true, warning: 'dark' });
    expect(judgeColor('#ff0000')).toEqual({ ok: true, warning: null });
    expect(contrastRatio('#ffc658', CARD_LIGHT)).toBeLessThan(3);
  });
});

describe('fonts', () => {
  it('offers the curated list, page font first, and builds a safe stack', () => {
    expect(FONT_OPTIONS[0]).toEqual({ family: 'Roboto', source: 'google', stack: '"Roboto", ui-sans-serif, system-ui, sans-serif' });
    expect(FONT_OPTIONS.map((f) => f.family)).toEqual(['Roboto', 'Open Sans', 'Lato', 'Merriweather', 'Playfair Display', 'Georgia', 'Arial']);
    expect(fontStack(null)).toBeUndefined();
    expect(fontStack('Georgia')).toBe('"Georgia", ui-serif, Georgia, serif');
    expect(fontStack('Nope')).toBe('"Nope", ui-sans-serif, system-ui, sans-serif'); // an unknown (brand) family still gets a stack
    expect(findFont('Lato')?.source).toBe('google');
    expect(findFont('Arial')?.source).toBe('system');
  });
});
```

And `web/lib/font-loader.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { ensureFontLoaded, GOOGLE_FONTS_ORIGIN } from './font-loader.ts';

afterEach(() => {
  document.head.querySelectorAll('link[data-font-family]').forEach((n) => n.remove());
});

describe('ensureFontLoaded', () => {
  it('injects one Google Fonts stylesheet per family, once', () => {
    const option = { family: 'Open Sans', source: 'google' as const, stack: '' };
    ensureFontLoaded(option);
    ensureFontLoaded(option);
    const links = document.head.querySelectorAll('link[data-font-family="Open Sans"]');
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute('href')).toBe(`${GOOGLE_FONTS_ORIGIN}/css2?family=Open+Sans:wght@400;600&display=swap`);
    expect(links[0].getAttribute('rel')).toBe('stylesheet');
  });
  it('does nothing for a system font', () => {
    ensureFontLoaded({ family: 'Georgia', source: 'system', stack: '' });
    expect(document.head.querySelector('link[data-font-family]')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify they fail** — `cd web && npx vitest run lib/chart-presentation.test.ts lib/font-loader.test.ts` → FAIL (missing exports / module).

- [ ] **Step 3: Implement** — append to `chart-presentation.ts`:

```ts
// --- colours -----------------------------------------------------------------
// The card grounds the hollow R11 ring is drawn on (globals.css): light
// --card oklch(1 0 0) = #ffffff, dark --card oklch(0.205 0 0) ≈ #171717.
export const CARD_LIGHT = '#ffffff';
export const CARD_DARK = '#171717';
/** Below this ratio against a card the ring is indistinguishable from it. */
export const COLOR_REFUSE_BELOW = 1.25;
/** Below this the ring is visible but weak — warn, still apply. */
export const COLOR_WARN_BELOW = 3;

export function normalizeHex(input: string): string | null {
  const s = input.trim().replace(/^#/, '').toLowerCase();
  if (/^[0-9a-f]{6}$/.test(s)) return `#${s}`;
  if (/^[0-9a-f]{3}$/.test(s)) return `#${s[0]}${s[0]}${s[1]}${s[1]}${s[2]}${s[2]}`;
  return null;
}

function channel(c: number): number {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}
export function contrastRatio(hexA: string, hexB: string): number {
  const a = luminance(hexA);
  const b = luminance(hexB);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

export type ColorVerdict = { ok: true; warning: 'light' | 'dark' | 'both' | null } | { ok: false; reason: string };

export const COLOR_REFUSAL =
  'Deze kleur is niet toegepast: de open markering voor voorlopige cijfers zou in een van de thema’s onzichtbaar worden.';

/** Owner decision B with the R11 guard: a colour that would hide the hollow
 * provisional ring on EITHER theme's card is refused; a weak one is applied
 * with a per-theme warning. Every stock palette colour passes (pinned). */
export function judgeColor(hex: string): ColorVerdict {
  const light = contrastRatio(hex, CARD_LIGHT);
  const dark = contrastRatio(hex, CARD_DARK);
  if (light < COLOR_REFUSE_BELOW || dark < COLOR_REFUSE_BELOW) return { ok: false, reason: COLOR_REFUSAL };
  const weakLight = light < COLOR_WARN_BELOW;
  const weakDark = dark < COLOR_WARN_BELOW;
  return { ok: true, warning: weakLight && weakDark ? 'both' : weakLight ? 'light' : weakDark ? 'dark' : null };
}

// --- fonts -------------------------------------------------------------------
export interface FontOption {
  family: string;
  source: 'system' | 'google';
  stack: string;
}
const SANS = 'ui-sans-serif, system-ui, sans-serif';
const SERIF = 'ui-serif, Georgia, serif';
export const FONT_OPTIONS: readonly FontOption[] = [
  { family: 'Roboto', source: 'google', stack: `"Roboto", ${SANS}` },
  { family: 'Open Sans', source: 'google', stack: `"Open Sans", ${SANS}` },
  { family: 'Lato', source: 'google', stack: `"Lato", ${SANS}` },
  { family: 'Merriweather', source: 'google', stack: `"Merriweather", ${SERIF}` },
  { family: 'Playfair Display', source: 'google', stack: `"Playfair Display", ${SERIF}` },
  { family: 'Georgia', source: 'system', stack: `"Georgia", ${SERIF}` },
  { family: 'Arial', source: 'system', stack: `"Arial", ${SANS}` },
];
export function findFont(family: string | null): FontOption | undefined {
  return family === null ? undefined : FONT_OPTIONS.find((f) => f.family === family);
}
/** undefined = inherit the page font (the stock look). An unknown family
 * (a brand font, phase 3) gets a sans stack — the name is regex-validated by
 * sanitizeOverrides before it can reach here. */
export function fontStack(family: string | null): string | undefined {
  if (family === null) return undefined;
  return findFont(family)?.stack ?? `"${family}", ${SANS}`;
}
```

`web/lib/font-loader.ts`:

```ts
// WP218: on-demand Google Fonts loading for the chart's Lettertype tab. One
// <link> per family, idempotent, client-only. Not next/font: bundling seven
// families the page never uses by default would grow every page load for a
// panel most readers never open.
import type { FontOption } from './chart-presentation.ts';

export const GOOGLE_FONTS_ORIGIN = 'https://fonts.googleapis.com';

export function googleFontsHref(family: string): string {
  return `${GOOGLE_FONTS_ORIGIN}/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}:wght@400;600&display=swap`;
}

export function ensureFontLoaded(option: FontOption): void {
  if (option.source !== 'google' || typeof document === 'undefined') return;
  const existing = document.head.querySelector(`link[data-font-family="${CSS.escape(option.family)}"]`);
  if (existing) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = googleFontsHref(option.family);
  link.setAttribute('data-font-family', option.family);
  document.head.appendChild(link);
}
```

(If jsdom lacks `CSS.escape`, fall back to a simple `family.replace(/"/g, '')` — the family is already regex-validated to letters/digits/spaces.)

- [ ] **Step 4: Run** — `cd web && npx vitest run lib/chart-presentation.test.ts lib/font-loader.test.ts` → PASS. Adjust the warning-test colours only if the arithmetic says so (`#3a3a3a` vs `#171717` must be between 1.25 and 3; `#ffc658` vs white must be between 1.25 and 3) — never adjust the thresholds to fit a colour.

- [ ] **Step 5: Commit** — `git commit -m "feat(chart): colour judgement (R11 ring guard, per-theme warning) and curated fonts with on-demand loading (WP218)"`

---

### Task 3: Reducer slice — `presentation` overrides, clear on spec swap (owner E)

**Files:**
- Modify: `web/lib/chart-view-state.ts`
- Modify: `web/lib/chart-view-state.test.ts`

**Interfaces:**
- Produces: `ChartViewState.presentation: PresentationOverrides`; actions `{ type: 'setPresentation'; patch: PresentationOverrides }` and `{ type: 'resetPresentation' }`; `initialViewState` → `presentation: {}`; `reset` → `presentation: {}`.

- [ ] **Step 1: Append failing tests**

```ts
import { chartViewReducer, initialViewState } from './chart-view-state.ts';

describe('presentation slice (WP218)', () => {
  it('starts empty', () => {
    expect(initialViewState('line').presentation).toEqual({});
  });
  it('setPresentation merges a patch shallowly (a later key wins, others survive)', () => {
    let s = initialViewState('line');
    s = chartViewReducer(s, { type: 'setPresentation', patch: { lineWidth: 'thick' } });
    s = chartViewReducer(s, { type: 'setPresentation', patch: { grid: 'none' } });
    expect(s.presentation).toEqual({ lineWidth: 'thick', grid: 'none' });
    s = chartViewReducer(s, { type: 'setPresentation', patch: { lineWidth: 'thin' } });
    expect(s.presentation.lineWidth).toBe('thin');
  });
  it('setPresentation replaces seriesColors wholesale (the panel computes the new map)', () => {
    let s = initialViewState('line');
    s = chartViewReducer(s, { type: 'setPresentation', patch: { seriesColors: { 0: '#ff0000', 1: '#00ff00' } } });
    s = chartViewReducer(s, { type: 'setPresentation', patch: { seriesColors: { 1: '#0000ff' } } });
    expect(s.presentation.seriesColors).toEqual({ 1: '#0000ff' });
  });
  it('resetPresentation clears only the presentation, keeping form/zoom/hidden series', () => {
    let s = initialViewState('line');
    s = chartViewReducer(s, { type: 'setForm', form: 'bar' });
    s = chartViewReducer(s, { type: 'toggleSeries', key: 's0' });
    s = chartViewReducer(s, { type: 'setPresentation', patch: { grid: 'none' } });
    s = chartViewReducer(s, { type: 'resetPresentation' });
    expect(s.presentation).toEqual({});
    expect(s.form).toBe('bar');
    expect(s.hiddenKeys.has('s0')).toBe(true);
  });
  it('reset (a spec swap on the same mounted chart) clears the presentation — owner decision E: each chart starts fresh', () => {
    let s = initialViewState('line');
    s = chartViewReducer(s, { type: 'setPresentation', patch: { lineWidth: 'thick' } });
    s = chartViewReducer(s, { type: 'reset', initialForm: 'line' });
    expect(s.presentation).toEqual({});
  });
});
```

- [ ] **Step 2: Run** — `cd web && npx vitest run lib/chart-view-state.test.ts` → FAIL.

- [ ] **Step 3: Implement** — in `chart-view-state.ts`: `import type { PresentationOverrides } from './chart-presentation.ts';` add `presentation: PresentationOverrides;` to the interface with the comment "WP218 (ADR 039): plain user overrides on the stock look; the resolver (chart-presentation.ts) turns them into effective values per render, so a stale override can never apply to a newly-unsafe spec. Cleared by `reset` — owner decision E (session 90): each chart starts fresh."; extend the action union; `initialViewState` returns `presentation: {}`; add cases:

```ts
    case 'setPresentation':
      return { ...state, presentation: { ...state.presentation, ...action.patch } };
    case 'resetPresentation':
      return { ...state, presentation: {} };
```

`reset` already calls `initialViewState(action.initialForm)`, which now yields `presentation: {}` — verify the test passes without further change.

- [ ] **Step 4: Run** — PASS. Then `cd web && npm test` → all green (chart.test.tsx constructs states via the reducer only).

- [ ] **Step 5: Commit** — `git commit -m "feat(chart): presentation overrides slice on the view-state reducer, cleared per chart (WP218, owner E)"`

---

### Task 4: `chart.tsx` reads the resolver (Phase 0 — no visible change) + small multiples R11 marker + user-chart literal

**Files:**
- Modify: `web/components/chart.tsx`
- Modify: `web/components/chart-small-multiples.tsx`, `web/components/chart-small-multiples.test.tsx`
- Modify: `web/components/user-chart.tsx`
- Modify: `web/components/chart.test.tsx` (append)

**Interfaces:**
- Consumes: Task 1–3.
- Produces: `ChartSmallMultiples` props gain `presentation: ChartPresentation` (effective values); `SeriesDot` signature gains a trailing `geometry: { r: number; ring: number; hideFinal: boolean }` parameter; `buildRows(spec, colors?: (index: number) => string)` — optional colour resolver, default `seriesStyle`.

**Wiring in `ChartView` (after `activeForm`/`effectiveKind` are computed):**

```ts
const hasProvisional = spec.series.some((s) => s.points.some((p) => p.provisional));
const resolved = resolvePresentation(
  { kind: spec.kind, form: activeForm, seriesCount: spec.series.length, hasProvisional },
  state.presentation,
);
const pres = resolved.values;
const colorFor = (i: number) => seriesColor(pres, i);
```

`buildRows(viewSpec, colorFor)` so `seriesMeta[i].color` is the effective colour (legend swatches, tooltip swatches, hatch patterns all follow automatically). Then:

- `<Line strokeWidth={LINE_WIDTH_PX[pres.lineWidth]}>`; `dot={SeriesDot(..., { ...dotGeometry(pres.lineWidth), hideFinal: pres.markers === 'provisionalOnly' })}`.
- `SeriesDot`: `<circle r={geometry.r} strokeWidth={geometry.ring} ...>`; when `geometry.hideFinal && !provisional` render the circle with `opacity={0}` and `data-marker="hidden"` but KEEP `data-point="value"`, `role`, `tabIndex`, handlers (the `[data-point]` count, keyboard walking and click-to-annotate are unchanged); the end label still renders when `pres.valueLabels === 'shown'` — pass `endLabel` as `undefined` from ChartView when value labels are hidden.
- `<CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} horizontal={pres.grid !== 'none'} vertical={pres.grid === 'both'} />` — when `pres.grid === 'none'` render no `CartesianGrid` at all.
- `<XAxis ... axisLine={pres.axisLines === 'shown'} tickLine={pres.axisLines === 'shown'} angle={pres.xLabels === 'tilted' ? -45 : 0} textAnchor={pres.xLabels === 'tilted' ? 'end' : 'middle'} height={xAxisHeight(pres.xLabels, longestPeriodLabel)} />` where `longestPeriodLabel` is the longest `row.periodLabel` string; pass `height` only when defined.
- `<YAxis ... axisLine={pres.axisLines === 'shown'} tickLine={pres.axisLines === 'shown'} domain={pres.zeroBaseline === 'zero' ? [0, 'auto'] : yAxisDomain(effectiveKind)} />` on the line branch (the bar branch keeps `yAxisDomain(effectiveKind)` — always zero).
- Bar branch: `SeriesBar(...)` unchanged (bar labels are locked shown), grid/axis props as above; the hatch `<pattern>` uses `s.color` already.
- Font: the chart `tabpanel` div gets `style={fontStack(pres.fontFamily) ? { fontFamily: fontStack(pres.fontFamily) } : undefined}`; call `ensureFontLoaded(findFont(pres.fontFamily))` in a `useEffect` keyed on `pres.fontFamily` when the font is known and Google-sourced. (SVG `<text>` inherits `font-family` via CSS; `chart-download.tsx`'s `inlineComputedPaint` writes the computed family onto every text node, so the SVG export carries it.)
- Small multiples: `<ChartSmallMultiples spec={viewSpec} hiddenKeys={state.hiddenKeys} axisMode={axisMode} presentation={pres} />`.
- `user-chart.tsx`: `strokeWidth={LINE_WIDTH_PX[STOCK_PRESENTATION.lineWidth]}` — one home for the stock look; nothing else.

**Small multiples (the R11 gap):** replace `dot={false}` with a tiny local dot function that renders ONLY provisional points: `<circle cx cy r={geometry.r} fill="var(--card)" stroke={s.color} strokeWidth={geometry.ring} data-point="value" data-result-id=… />` (hollow = the same convention as `SeriesDot`); non-provisional points render nothing (as today). `strokeWidth={LINE_WIDTH_PX[presentation.lineWidth]}`, grid per `presentation.grid`, series colour via `buildRows(spec, (i) => seriesColor(presentation, i))`.

- [ ] **Step 1: Append failing tests**

To `chart-small-multiples.test.tsx` (use its existing spec helper; add a provisional point to one series):

```ts
it('R11: a provisional point gets a hollow marker in a small-multiples panel (WP218 phase 0 gap fix)', () => {
  const s = /* existing helper */ withProvisionalPoint();
  const { container } = render(<ChartSmallMultiples spec={s} hiddenKeys={new Set()} axisMode="shared" presentation={STOCK_PRESENTATION} />);
  const hollow = container.querySelectorAll('circle[data-point="value"]');
  expect(hollow.length).toBe(1); // exactly the provisional point, nothing else
  expect(hollow[0].getAttribute('fill')).toBe('var(--card)');
});
```

To `chart.test.tsx` (Phase 0 pins — the stock render is byte-identical):

```ts
describe('WP218 phase 0 — the stock look still renders exactly today\'s literals', () => {
  it('line stroke-width 2, dot r 4 ring 2, grid both, axis lines on', () => {
    const { container } = render(<ChartView spec={threePointSpec()} />);
    const path = container.querySelector('.recharts-line-curve');
    expect(path?.getAttribute('stroke-width')).toBe('2');
    const dot = container.querySelector('circle[data-point="value"]');
    expect(dot?.getAttribute('r')).toBe('4');
    expect(dot?.getAttribute('stroke-width')).toBe('2');
    expect(container.querySelector('.recharts-cartesian-grid-horizontal')).not.toBeNull();
    expect(container.querySelector('.recharts-cartesian-grid-vertical')).not.toBeNull();
    expect(container.querySelector('.recharts-xAxis .recharts-cartesian-axis-line')).not.toBeNull();
  });
});
```

(Recharts 3 class names: verify `.recharts-line-curve`, `.recharts-cartesian-grid-horizontal`, `.recharts-cartesian-grid-vertical`, `.recharts-cartesian-axis-line` against the rendered DOM in jsdom with `container.innerHTML` while writing the test; adjust selectors to what Recharts actually emits, never the assertion's meaning.)

- [ ] **Step 2: Run** — the new tests FAIL (prop/attribute missing); everything else still green.

- [ ] **Step 3: Implement** the wiring described above.

- [ ] **Step 4: Run** — `cd web && npm test` → all green. Also `cd web && npm run typecheck`.

- [ ] **Step 5: Commit** — `git commit -m "refactor(chart): render reads the presentation resolver (no visible change); small multiples draw the R11 hollow marker (WP218 phase 0)"`

---

### Task 5: `chart-config-panel.tsx` — the dumb panel (Grafiek tab)

**Files:**
- Create: `web/components/chart-config-panel.tsx`, `web/components/chart-config-panel.test.tsx`

**Interfaces:**
- Produces:

```ts
export type PanelLang = 'nl' | 'en';
export const PANEL_COPY: Record<PanelLang, { /* every string below */ }>;
export function ChartConfigPanel(props: {
  resolved: ResolvedPresentation;
  seriesMeta: { key: string; label: string; color: string }[];
  onChange: (patch: PresentationOverrides) => void;
  onReset: () => void;
  idPrefix: string;
  lang?: PanelLang; // default 'nl'
  /** WP218 phase 6: called once per open with the tab name; optional. */
  onOpen?: () => void;
}): JSX.Element;
```

**Structure & ARIA (hand-rolled, house rule 4, the `chart-toggle.tsx`/`chart.tsx` tablist pattern):**

- Trigger: `<Button variant="ghost" size="sm" aria-expanded={open} aria-controls={`${idPrefix}-style`}>` with a lucide `SlidersHorizontal` icon + text `copy.trigger` (`nl: 'Opmaak'`, `en: 'Style'`). Closed by default. Escape inside the region closes it and refocuses the trigger.
- Region: `<section id={`${idPrefix}-style`} role="region" aria-label={copy.regionLabel} className="basis-full mt-2 rounded-lg border border-border bg-muted/40 p-3 text-xs">` (`nl: 'Opmaak van de grafiek'`).
- Inner tabs: `role="tablist" aria-label={copy.tabsLabel}` with three `role="tab"` buttons (`Grafiek` / `Kleuren` / `Lettertype`; en `Chart` / `Colours` / `Font`), arrow keys move, one `role="tabpanel"`. Segment styling as `segmentTab` in chart.tsx.
- Grafiek tab, in this order, each a labelled `role="radiogroup"` of pill buttons (`role="radio"`, `aria-checked`, arrow keys) or an `aria-pressed` toggle; a control whose key is not in `resolved.applicable` is NOT rendered; a control whose key is in `resolved.locks` is rendered `disabled` with `aria-describedby` → a visually-hidden `<span id>` carrying the reason:
  1. `lineWidth` — label `Lijndikte`, options `Dun / Normaal / Dik / Extra dik`.
  2. `markers` — `Punten`: `Alle punten / Alleen voorlopige`.
  3. `grid` — `Rasterlijnen`: `Beide / Alleen horizontaal / Geen`.
  4. `xLabels` — `Labels op de x-as`: `Horizontaal / Schuin`.
  5. `axisLines` — toggle `Aslijnen tonen` (`aria-pressed={values.axisLines === 'shown'}`).
  6. `valueLabels` — toggle `Waarden tonen`.
  7. `zeroBaseline` — toggle `Y-as vanaf nul`.
  8. `Standaard` button (`copy.reset`) — `disabled={resolved.pristine}`; calls `onReset`.
- Every option value shown to the user is one of the words above — **no digit anywhere in the panel's text nodes** (test-pinned).

- [ ] **Step 1: Write failing tests** (`chart-config-panel.test.tsx`; render with a `resolvePresentation(lineCtx, {})` result and a `vi.fn()` `onChange`):

```ts
it('is closed by default and opens into a labelled region with three tabs', () => {
  render(<ChartConfigPanel resolved={resolvePresentation(lineCtx, {})} seriesMeta={meta} onChange={vi.fn()} onReset={vi.fn()} idPrefix="c" />);
  const trigger = screen.getByRole('button', { name: 'Opmaak' });
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByRole('region', { name: 'Opmaak van de grafiek' })).toBeNull();
  fireEvent.click(trigger);
  expect(trigger).toHaveAttribute('aria-expanded', 'true');
  const region = screen.getByRole('region', { name: 'Opmaak van de grafiek' });
  expect(within(region).getAllByRole('tab').map((t) => t.textContent)).toEqual(['Grafiek', 'Kleuren', 'Lettertype']);
});
it('pre-fills every control from the resolved values, not from a stored default', () => {
  const resolved = resolvePresentation(lineCtx, { lineWidth: 'thick', grid: 'none', axisLines: 'hidden' });
  render(/* open it */);
  expect(screen.getByRole('radio', { name: 'Dik' })).toHaveAttribute('aria-checked', 'true');
  expect(screen.getByRole('radio', { name: 'Geen' })).toHaveAttribute('aria-checked', 'true');
  expect(screen.getByRole('button', { name: 'Aslijnen tonen' })).toHaveAttribute('aria-pressed', 'false');
});
it('emits a patch for exactly the changed key', () => {
  const onChange = vi.fn();
  /* open, then */ fireEvent.click(screen.getByRole('radio', { name: 'Extra dik' }));
  expect(onChange).toHaveBeenCalledWith({ lineWidth: 'extraThick' });
  fireEvent.click(screen.getByRole('button', { name: 'Waarden tonen' }));
  expect(onChange).toHaveBeenCalledWith({ valueLabels: 'hidden' });
});
it('bar form: locked controls are disabled with a readable reason; inapplicable ones are absent', () => {
  const resolved = resolvePresentation(barCtx, {});
  /* open */
  const values = screen.getByRole('button', { name: 'Waarden tonen' });
  expect(values).toBeDisabled();
  expect(document.getElementById(values.getAttribute('aria-describedby')!)?.textContent).toMatch(/staafdiagram/);
  expect(screen.queryByRole('radiogroup', { name: 'Lijndikte' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Y-as vanaf nul' })).toBeNull();
});
it('Standaard is disabled while pristine and calls onReset otherwise', () => { /* two renders */ });
it('Escape closes the region and returns focus to the trigger', () => { /* keyDown Escape on region */ });
it('contains no digit in any text node, open, in either language', () => {
  for (const lang of ['nl', 'en'] as const) {
    const { container, unmount } = render(<ChartConfigPanel lang={lang} resolved={resolvePresentation(lineCtx, {})} seriesMeta={meta} onChange={vi.fn()} onReset={vi.fn()} idPrefix={lang} />);
    fireEvent.click(screen.getByRole('button', { name: lang === 'nl' ? 'Opmaak' : 'Style' }));
    for (const tab of screen.getAllByRole('tab')) fireEvent.click(tab); // visit every tab
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) expect(n.textContent).not.toMatch(/\d/);
    unmount();
  }
});
```

- [ ] **Step 2: Run** → FAIL (module missing).
- [ ] **Step 3: Implement** the component per the structure above (Kleuren/Lettertype tab bodies may be empty placeholders in this task; Task 6 fills them). Keep the per-key control definitions in a small table (`{ key, label, options: [{ value, label }] }`) so the radiogroups are one loop, not seven copies.
- [ ] **Step 4: Run** → PASS; `npm test` green.
- [ ] **Step 5: Commit** — `git commit -m "feat(chart): Opmaak panel — Grafiek tab over the resolved presentation (WP218 phase 1)"`

---

### Task 6: Kleuren + Lettertype tabs

**Files:**
- Modify: `web/components/chart-config-panel.tsx`, `.test.tsx`

**Kleuren tab** — one row per `seriesMeta` entry (`role="group" aria-label={series.label}`): a swatch `<span aria-hidden style={{ backgroundColor: color }} className="inline-block size-4 rounded-full border border-border" />`, the series label, an `<Input type="text" inputMode="text" aria-label={`${copy.colourOf} ${label}`} value={draft} />` (the draft is local state, initialised from the effective colour; on blur or Enter → `normalizeHex` → `judgeColor` → if `ok`, `onChange({ seriesColors: { ...current, [index]: hex } })` and set the row's warning text (`copy.warnLight` = `'Deze kleur is slecht leesbaar in het lichte thema.'`, `warnDark`, `warnBoth`); if refused → a `role="alert"` `<p>` with the reason, the draft snaps back to the effective colour), and an `<input type="color" aria-label={`${copy.pickColourOf} ${label}`} value={color} onChange>` following the same judge path. A `Standaardkleuren` button emits `onChange({ seriesColors: {} })`, disabled when no colour override exists. `current` = `resolved.values.seriesColors`.

**Lettertype tab** — a native `<select aria-label={copy.font}>` (the Vanaf/Tot pattern) with `<option value="">Standaard</option>` then one option per `FONT_OPTIONS` family; `onChange` → `onChange({ fontFamily: value || null })`. Preview: the option list itself is not styled (jsdom-neutral); the chart is the preview.

- [ ] **Step 1: Failing tests**

```ts
it('Kleuren: one row per series with swatch, hex input and colour picker pre-filled with the effective colour', () => {
  /* open, click tab Kleuren */
  const hex = screen.getByRole('textbox', { name: 'Kleur van Amsterdam (hex-code)' }) as HTMLInputElement;
  expect(hex.value).toBe('#8884d8');
  expect((screen.getByLabelText('Kleur van Amsterdam kiezen') as HTMLInputElement).value).toBe('#8884d8');
});
it('a valid hex commits on Enter as a per-index patch; a weak colour also shows a per-theme warning', () => {
  fireEvent.change(hex, { target: { value: 'ffc658' } });
  fireEvent.keyDown(hex, { key: 'Enter' });
  expect(onChange).toHaveBeenCalledWith({ seriesColors: { 0: '#ffc658' } });
  expect(screen.getByText('Deze kleur is slecht leesbaar in het lichte thema.')).toBeInTheDocument();
});
it('a colour that would hide the hollow provisional ring is refused with a reason and not emitted', () => {
  fireEvent.change(hex, { target: { value: '#fefefe' } });
  fireEvent.blur(hex);
  expect(onChange).not.toHaveBeenCalled();
  expect(screen.getByRole('alert').textContent).toMatch(/voorlopige cijfers/);
  expect(hex.value).toBe('#8884d8'); // snapped back
});
it('garbage in the hex box is ignored and snaps back', () => { /* 'red' → no call, value restored */ });
it('Standaardkleuren clears all colour overrides', () => { /* onChange({ seriesColors: {} }) */ });
it('Lettertype: the select lists Standaard + the curated families and emits fontFamily', () => {
  fireEvent.change(screen.getByRole('combobox', { name: 'Lettertype' }), { target: { value: 'Roboto' } });
  expect(onChange).toHaveBeenCalledWith({ fontFamily: 'Roboto' });
});
it('hex codes never appear as text nodes (only as input values)', () => { /* tree-walk after opening Kleuren: no /\d/ */ });
```

- [ ] **Step 2–5:** implement, run, `npm test` green, commit `feat(chart): Kleuren and Lettertype tabs with the R11 colour guard (WP218 phase 1, owner B)`.

---

### Task 7: Mount the panel in `ChartView` (+ `aria-describedby` on the disabled Lijn tab)

**Files:**
- Modify: `web/components/chart.tsx`, `web/components/chart.test.tsx`

**Wiring:** wrap the existing Weergave `role="tablist"` and the new panel in `<div className="mt-3 flex flex-wrap items-center gap-2">` (move the tablist's `mt-3` to the wrapper); render `<ChartConfigPanel resolved={resolved} seriesMeta={seriesMeta} onChange={(patch) => dispatch({ type: 'setPresentation', patch })} onReset={() => dispatch({ type: 'resetPresentation' })} idPrefix={domId} />` **only when `state.form !== 'table'`** and as a sibling OUTSIDE the `chartContainerRef` tabpanel (it is inside the card, so the honesty scans see it — digit-free by Task 5/6's tests — but outside the export). The Lijn tab, when disabled, gets `aria-describedby={`${domId}-line-reason`}` pointing at a visually-hidden span with the existing `title` text (the `title` stays).

- [ ] **Step 1: Failing tests** (append to chart.test.tsx; reuse `threePointSpec`, a provisional variant, and a multi-region bar spec):

```ts
describe('WP218 phase 1 — the Opmaak panel on the chart card', () => {
  it('pre-fills with what is on screen: after Dik, the line is 3 px and the panel says Dik; after Lijn→Staaf→Lijn it still says Dik', () => {
    render(<ChartView spec={threePointSpec()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Opmaak' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Dik' }));
    expect(container.querySelector('.recharts-line-curve')?.getAttribute('stroke-width')).toBe('3');
    fireEvent.click(screen.getByRole('tab', { name: 'Staaf' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Lijn' }));
    expect(screen.getByRole('radio', { name: 'Dik' })).toHaveAttribute('aria-checked', 'true');
  });
  it('R11: with "Alleen voorlopige" the hollow marker stays, final dots are transparent but still present as points', () => {
    const s = /* threePointSpec with one provisional point */;
    render(<ChartView spec={s} />);
    const before = container.querySelectorAll('[data-point="value"]').length;
    /* open, click radio 'Alleen voorlopige' */
    expect(container.querySelectorAll('[data-point="value"]').length).toBe(before);
    expect(container.querySelectorAll('circle[data-marker="hidden"]').length).toBe(before - 1);
    const hollow = [...container.querySelectorAll('circle[data-point="value"]')].find((c) => c.getAttribute('fill') === 'var(--card)');
    expect(hollow?.getAttribute('opacity')).not.toBe('0');
  });
  it('grid Geen removes the grid; Aslijnen off removes axis lines; Schuin tilts the x labels and reserves height', () => { /* attribute checks per option */ });
  it('Y-as vanaf nul on a line switches the domain to zero (bar is always zero regardless)', () => { /* .recharts-yAxis presence + prop pin via a small exported helper if needed */ });
  it('a colour change recolours line, legend swatch and tooltip swatch together', () => { /* Kleuren tab, hex input, then .recharts-line-curve stroke === '#ff0000' and legend span backgroundColor */ });
  it('a spec swap on the same mounted chart clears the presentation (owner E)', () => {
    const { rerender } = render(<ChartView spec={threePointSpec()} />);
    /* open, Dik */
    rerender(<ChartView spec={threePointSpec({ title: 'Ander' })} />);
    expect(container.querySelector('.recharts-line-curve')?.getAttribute('stroke-width')).toBe('2');
  });
  it('Standaard restores the byte-identical stock svg', () => {
    const { container } = render(<ChartView spec={threePointSpec()} />);
    const stock = container.querySelector('svg')!.outerHTML;
    /* open, Dik, Geen, then Standaard */
    expect(container.querySelector('svg')!.outerHTML).toBe(stock);
  });
  it('the whole-card digit scan still passes with the panel open on every tab (line and bar)', () => { /* copy the membership walker from the existing test; open panel; visit tabs */ });
  it('the panel is not offered in Tabel form and lives outside the export container', () => {
    /* click Tabel → no 'Opmaak' button; back to Lijn → the region is not a descendant of [role=tabpanel][aria-label=Grafiek] */
  });
  it('the disabled Lijn tab on a region comparison carries its reason via aria-describedby', () => { /* multi-region bar spec */ });
  it('the SVG export carries the chosen stroke-width verbatim', () => { /* attributedSvgMarkup(container.querySelector('svg'), 'x', () => ({})) includes stroke-width="3" after Dik */ });
});
```

- [ ] **Step 2–5:** run (FAIL), implement, `cd web && npm test` + `npm run typecheck` green, commit `feat(chart): mount the Opmaak panel on every ChartView; Lijn-tab reason reachable by keyboard (WP218 phase 1)`.

---

### Task 8: Browser pass

Start the dev server with the Browser pane (`preview_start` `{name: "web"}` — no database needed for the homepage's Ontdek charts, which render from the cached curated set; if the homepage needs the DB, use `web-db`), open `/`, and on an Ontdek chart: open Opmaak, set Dik + Schuin + Geen, switch Kleuren → change series one to `#ff0000`, Lettertype → Merriweather; screenshot light AND dark (`resize_window` `colorScheme`) at desktop and at 375 px. Confirm: no clipped tilted labels, the hollow marker visible on a provisional chart if one exists, the panel readable in dark mode, the tooltip swatch recoloured. Fix anything visibly broken, re-run the web suite, commit `fix(chart): …` if needed. Save one screenshot per theme to the session scratchpad (not the repo).

---

### Task 9: ADR 039 + docs

**Files:**
- Create: `docs/decisions/039-chart-presentation-panel.md`
- Modify: `docs/decisions/038-chart-view-state-editing.md` (addendum: the `presentation` slice rides the same reducer/reset), `docs/03-mvp-scope.md` (row 55: the panel's phase 1 shipped), `docs/12-huisstijl.md` (Charts: the stock look is `STOCK_PRESENTATION`, the panel's tokens; the series palette moved to `web/lib/chart-presentation.ts`), `docs/04-architecture.md` (chart capability row), `docs/05-data-rules.md` (R11 verified-by: the small-multiples marker + the colour guard), `docs/open-questions.md` #218 (phase 0/1 built — measured), `docs/08-build-plan.md` § WP218 (phase 1 ✅ with the commit list).

ADR 039 sections: Status (accepted, date, branch), Context (#218, the panel synthesis, owner answers A–H), Decision (resolver + reducer slice; locks; digit-free copy; colour guard thresholds 1.25 / 3 and why the stock `#ffc658` is a warning not a refusal; fonts on demand + the PNG-fallback limit; per-chart fresh start E; everywhere G), Alternatives (presets-only; a second reducer; spec schema v2; a free pixel input; Popover primitive — from the synthesis §7, with reasons), Consequences (no `src/` change; export unchanged; the `[data-point]` contract kept under `provisionalOnly`; language: Dutch now, `PANEL_COPY` for #219), Revisit triggers (a second production renderer → move to `src/chart/presentation.ts`; usage counter data → phase 5 variants; brand fonts → phase 3).

- [ ] Commit `docs(chart): ADR 039 chart presentation panel; WP218 phase 0/1 recorded`.

---

## Self-review (done by the plan author)

- Spec coverage: phase-0 extract ✔ (T1, T4), small-multiples R11 ✔ (T4), 7 Chart options + Standaard ✔ (T5/T7), Kleuren swatch+hex+picker + contrast warning + ring refusal ✔ (T2/T6), Lettertype curated ✔ (T2/T6), everywhere G ✔ (T7: inside ChartView), fresh per chart E ✔ (T3/T7), named steps H ✔ (T5), digit-free ✔ (T5/T6/T7 scans), export faithful ✔ (T7 last test), ADR 039 ✔ (T9), browser pass ✔ (T8). "Apply brand colours", account save, usage counter, EN/NL switch, chart-type dropdown are phases 2–6 (separate plans).
- Type consistency: `PresentationOverrides`, `ResolvedPresentation`, `seriesColor`, `dotGeometry`, `LINE_WIDTH_PX`, `fontStack`, `findFont`, `ensureFontLoaded` used with the same names/signatures throughout.

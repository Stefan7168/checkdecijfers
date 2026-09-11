# Chart templates v1 (looks only) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "Sjablonen / Templates" tab — first in the chart's Style panel — with six named looks (Basis/Standard, Klassiek/Classic, Redactie/Newsroom, Presentatie/Presentation, Sociaal/Social, Minimaal/Minimal) and a Brand card, each a curated bundle of the presentation options that already exist; picking one applies it to the chart in front of the reader in one click, the other tabs then show its values, "Standaard" resets as today, and "Bewaar als mijn standaard" keeps it — so a journalist on deadline gets a publication-ready look with one click and zero new machinery.

**Architecture:** A template is a code constant (`web/lib/chart-templates.ts`): `{ id, nameKey, descriptionKey, overrides: PresentationOverrides }` — exactly the seam ADR 039 named ("named `Partial<ChartPresentation>` objects over the same overrides"). Applying one is `resetPresentation` + `setPresentation(template.overrides)` in `chart.tsx`; every honesty lock re-runs per render; `sanitizeOverrides` guards every template. The thumbnail is a small generic SVG drawer that derives its look from the template's RESOLVED values (never hand-drawn per template, so it cannot drift). No spec change, no audit change, no schema, no LLM, no library (ADR 043).

**Tech Stack:** Next.js 15 / React 19, Recharts (untouched), zod, vitest + Testing Library (jsdom), the message catalogue.

**Spec:** [docs/session-briefs/2026-09-10-visual-next-level-plan.md](../../session-briefs/2026-09-10-visual-next-level-plan.md) §5 with the kickoff's decision 3 (templates v1 = looks only; starter charts are v2) — [docs/session-briefs/2026-09-10-overnight-visual-upgrade-kickoff.md](../../session-briefs/2026-09-10-overnight-visual-upgrade-kickoff.md). Builds on phase 1 (ADR 042, branch `visual-designed-default`): `STOCK_PRESENTATION` is the designed default, `CLASSIC_PRESENTATION`/`RECHARTS_PALETTE` hold the session-87 look, `markers` has `'ends'`, `areaFill` exists.

## Design decisions taken for this plan (the ADR 043 rationale)

- **Roster and values (over the designed default; every template is a `PresentationOverrides`, frame keys included):**
  - **standard** (nl *Basis*, en *Standard*): `{}` — the designed default itself.
  - **classic** (*Klassiek* / *Classic*): the session-87 look — `lineWidth 'normal'`, `markers 'all'`, `grid 'both'`, `axisLines 'shown'`, `areaFill 'flat'`, `seriesColors` = `RECHARTS_PALETTE` by index 0–7 (so the classic colours come back too). Kept for continuity (kickoff decision 3).
  - **newsroom** (*Redactie* / *Newsroom*) — the ICP's publish-ready look, the one to make excellent: `lineWidth 'thick'` (3 px, the FT weight), `markers 'provisionalOnly'` (a clean line; the honesty ring still shows), `grid 'horizontal'`, `axisLines 'hidden'`, `valueLabels 'shown'`, `framePadding 'small'`, `frameAspect '16:9'` (a landscape export; on screen the frame's measured-width rule sets the height). No serif font: newsroom charts (FT, Economist, NYT, Volkskrant) set charts in a sans; the product's own sans stays.
  - **presentation** (*Presentatie* / *Presentation*): `frameBackground { kind: 'gradient', from: '#334155', to: '#0f172a' }` (dark slate), `frameInset 'small'` (the chart on the card, so both themes and the export stay legible — the backdrops are the card colours), `framePadding 'medium'`, `frameCorners 'rounded'`, `frameShadow 'strong'`, `frameAspect '16:9'`, `lineWidth 'thick'`.
  - **social** (*Sociaal* / *Social*): `frameBackground` = the `ocean` preset (`#38bdf8` → `#1e3a8a`), `frameInset 'small'`, `framePadding 'medium'`, `frameCorners 'veryRounded'`, `frameShadow 'soft'`, `frameAspect '4:5'`, `lineWidth 'thick'`, `valueLabels 'shown'`.
  - **minimal** (*Minimaal* / *Minimal*): `grid 'none'`, `axisLines 'hidden'`, `markers 'provisionalOnly'`, `valueLabels 'shown'`.
  - **Brand** is NOT a template object: a card on the Templates tab, shown only when the panel's `brand` prop is present (signed in), whose button switches the panel to the Colours tab where "Pas merkkleuren toe" already lives. No new mechanism, no key gating in the tab (the Colours tab explains when the key is absent).
- **Every template passes the design-time contrast gate by construction:** the two templates with a coloured background use the inset card, so `frameBackdrops` are the card colours; a test iterates every template × every `DEFAULT_PALETTE` colour (and classic × `RECHARTS_PALETTE`) × that template's backdrops and asserts no `judgeColorAgainst` refusal (the session-92 lesson as a gate).
- **"Current" template = the most specific template whose every override equals the effective value** (`matchTemplate(values, pristine)`); `standard` only when the chart is pristine and no other template matches. A tweaked chart matches nothing — that is honest: it is no longer that template.
- **The Templates tab is FIRST in the tab order but the panel still opens on Grafiek/Chart.** Opening on Templates would change the flow of ~40 existing panel/chart tests and the reader's muscle memory in one go; the first position already puts the gallery where the eye is. Revisit on counter data (`template_*` events vs `panel_open`).
- **Usage counter:** one event per template (`template_standard` … `template_minimal`) on the existing anonymous counter (migration 028, file-only until the owner applies it) — the owner's "which looks do people pick" question needs the id, and the event enum is closed and server-validated, so six entries beat one entry plus a free-text suffix.
- **Thumbnails are derived, digit-free SVG** (`TemplateThumb`): the template's resolved values pick the background/inset/corners, grid lines (horizontal/vertical), the axis/baseline, the marker mode (all / ends / none) and the first series colour, drawn over one fixed polyline. ~50 lines, one component, zero per-template artwork.
- **Owner decision E stands:** a template applies to the chart in front of the reader; the account default is the only persistence; the homepage/empty-state strip is a later slice (not in this plan).
- **Naming collision avoided:** the standard template's Dutch name is *Basis* (not *Standaard*, which is the reset button) and its English name *Standard* (the reset button is *Default*).

## Global Constraints
- **Honesty (docs/05-data-rules.md R1/R6/R11):** a template can never switch value labels off on a bar chart, hide a provisional marker or move a baseline — the resolver's locks re-run per render, unchanged; the Templates tab carries no digits (descriptions say "staand formaat", never "4:5"); every whole-card digit scan in `chart.test.tsx` must pass with the Templates tab open, in both languages.
- **Every template's overrides survive `sanitizeOverrides` unchanged** (test-pinned) — a key the resolver does not know is a bug, not a silent drop.
- **The panel stays a dumb component:** it renders `CHART_TEMPLATES`, marks the current one from `resolved`, and emits `onApplyTemplate(id)`; `chart.tsx` owns reset + apply + the counter.
- **Every new interface string** has an `nl` and an `en` entry in `web/lib/i18n/messages.ts`, no digits.
- **No new dependency, no schema/DB/prompt change; the `chart_style_usage` migration is untouched** (its event regex `^[a-z_]{1,40}$` admits `template_newsroom`).
- **Commands:** web tests `cd web && npx vitest run <files>`; web typecheck `cd web && npx tsc --noEmit`; root typecheck `npx tsc --noEmit`; backend chart tests `npx vitest run tests/chart/user-styles.test.ts`. Commit trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Branch `visual-templates-v1` (from `visual-designed-default`); never push to `main`.
- **Do the edits yourself in this run — do not spawn subagents, do not "background" the task.**

## File map
- Create `web/lib/chart-templates.ts` (+ `.test.ts`): `ChartTemplateId`, `ChartTemplate`, `CHART_TEMPLATES`, `templateById`, `matchTemplate`.
- Modify `src/chart/user-styles.ts` (+ `tests/chart/user-styles.test.ts` if it pins the list, `web/app/usage-actions.test.ts`): six `template_*` events.
- Modify `web/lib/i18n/messages.ts`: `chart.panel.tabTemplates`, `chart.template.<id>` / `chart.template.<id>Description`, `chart.template.brand`, `chart.template.brandDescription`, `chart.template.brandOpen`.
- Create `web/components/chart-template-thumb.tsx` (+ `.test.tsx`): the derived SVG thumbnail.
- Modify `web/components/chart-config-panel.tsx` (+ `.test.tsx`): the Templates tab (first), cards, `onApplyTemplate` prop, the Brand card.
- Modify `web/components/chart.tsx` (+ `.test.tsx`): `onApplyTemplate` wiring (reset + apply + image clear + counter).
- Docs (controller): ADR 043, `docs/12-huisstijl.md`, `docs/08-build-plan.md`, `docs/04-architecture.md`, `docs/open-questions.md`, STATUS/archive/lessons.

---

### Task 1: The template roster (pure)
**Files:**
- Create: `web/lib/chart-templates.ts`, `web/lib/chart-templates.test.ts`

**Interfaces (produce exactly these):**
```ts
import type { MessageKey } from './i18n/messages.ts';
import { type ChartPresentation, type PresentationOverrides } from './chart-presentation.ts';
export type ChartTemplateId = 'standard' | 'classic' | 'newsroom' | 'presentation' | 'social' | 'minimal';
export interface ChartTemplate {
  id: ChartTemplateId;
  nameKey: MessageKey;         // `chart.template.${id}`
  descriptionKey: MessageKey;  // `chart.template.${id}Description`
  /** Partial<ChartPresentation>, sanitizeOverrides-safe; `{}` for standard. */
  overrides: PresentationOverrides;
}
export const CHART_TEMPLATES: readonly ChartTemplate[]; // in the order above
export function templateById(id: ChartTemplateId): ChartTemplate;
/** The most specific template whose every override equals the effective value; 'standard' only when pristine and nothing else matches; null when the chart matches no template. */
export function matchTemplate(values: ChartPresentation, pristine: boolean): ChartTemplateId | null;
```
(The `MessageKey` union must contain the twelve `chart.template.*` keys — Task 2 adds them; until then `tsc` reports the missing keys here. Order Task 2 before typechecking this task, or run Task 2's catalogue step first — see Task 2 Step 3, which may be done first.)

- [ ] **Step 1: Write the failing tests** — `web/lib/chart-templates.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  CLASSIC_PRESENTATION,
  DEFAULT_PALETTE,
  FRAME_GRADIENT_PRESETS,
  frameBackdrops,
  judgeColorAgainst,
  RECHARTS_PALETTE,
  resolvePresentation,
  sanitizeOverrides,
  STOCK_PRESENTATION,
  type PresentationContext,
} from './chart-presentation.ts';
import { CHART_TEMPLATES, matchTemplate, templateById } from './chart-templates.ts';

const lineCtx: PresentationContext = { kind: 'line', form: 'line', seriesCount: 2, hasProvisional: true };
const barCtx: PresentationContext = { kind: 'bar', form: 'bar', seriesCount: 3, hasProvisional: true };

describe('CHART_TEMPLATES — the v1 roster (ADR 043), pinned', () => {
  it('lists the six looks in order with their catalogue keys', () => {
    expect(CHART_TEMPLATES.map((t) => t.id)).toEqual(['standard', 'classic', 'newsroom', 'presentation', 'social', 'minimal']);
    for (const t of CHART_TEMPLATES) {
      expect(t.nameKey).toBe(`chart.template.${t.id}`);
      expect(t.descriptionKey).toBe(`chart.template.${t.id}Description`);
    }
  });
  it('standard is the designed default itself (no overrides); classic is the session-87 look with the classic colours', () => {
    expect(templateById('standard').overrides).toEqual({});
    const classic = templateById('classic').overrides;
    expect(classic).toEqual({
      lineWidth: 'normal',
      markers: 'all',
      grid: 'both',
      axisLines: 'shown',
      areaFill: 'flat',
      seriesColors: Object.fromEntries(RECHARTS_PALETTE.map((hex, i) => [i, hex])),
    });
    const r = resolvePresentation(lineCtx, classic);
    for (const key of ['lineWidth', 'markers', 'grid', 'axisLines', 'areaFill'] as const) expect(r.values[key]).toBe(CLASSIC_PRESENTATION[key]);
  });
  it('newsroom, presentation, social and minimal carry exactly their designed values', () => {
    expect(templateById('newsroom').overrides).toEqual({
      lineWidth: 'thick',
      markers: 'provisionalOnly',
      grid: 'horizontal',
      axisLines: 'hidden',
      valueLabels: 'shown',
      framePadding: 'small',
      frameAspect: '16:9',
    });
    expect(templateById('presentation').overrides).toEqual({
      lineWidth: 'thick',
      frameBackground: { kind: 'gradient', from: '#334155', to: '#0f172a' },
      frameInset: 'small',
      framePadding: 'medium',
      frameCorners: 'rounded',
      frameShadow: 'strong',
      frameAspect: '16:9',
    });
    const ocean = FRAME_GRADIENT_PRESETS.find((p) => p.id === 'ocean')!;
    expect(templateById('social').overrides).toEqual({
      lineWidth: 'thick',
      valueLabels: 'shown',
      frameBackground: { kind: 'gradient', from: ocean.from, to: ocean.to },
      frameInset: 'small',
      framePadding: 'medium',
      frameCorners: 'veryRounded',
      frameShadow: 'soft',
      frameAspect: '4:5',
    });
    expect(templateById('minimal').overrides).toEqual({ grid: 'none', axisLines: 'hidden', markers: 'provisionalOnly', valueLabels: 'shown' });
  });
  it('every template survives sanitizeOverrides byte-identical — no key the resolver does not know', () => {
    for (const t of CHART_TEMPLATES) expect(sanitizeOverrides(t.overrides)).toEqual(t.overrides);
  });
  it('design-time contrast gate: no template refuses any default colour (or, for classic, any classic colour) against its own backdrops', () => {
    for (const t of CHART_TEMPLATES) {
      const values = resolvePresentation(lineCtx, t.overrides).values;
      const backdrops = frameBackdrops(values);
      const palette = t.id === 'classic' ? RECHARTS_PALETTE : DEFAULT_PALETTE;
      for (const hex of palette) expect(judgeColorAgainst(hex, backdrops).ok, `${t.id} × ${hex}`).toBe(true);
    }
  });
  it('the honesty locks still win over a template on a bar chart (value labels stay shown, baseline stays zero)', () => {
    const r = resolvePresentation(barCtx, templateById('minimal').overrides);
    expect(r.values.valueLabels).toBe('shown');
    expect(r.values.zeroBaseline).toBe('zero');
    expect(r.locks.valueLabels).toBeDefined();
  });
});

describe('matchTemplate — which template the chart currently wears', () => {
  it('a pristine chart is standard; a chart wearing a template matches it; a tweaked chart matches nothing', () => {
    expect(matchTemplate(STOCK_PRESENTATION, true)).toBe('standard');
    for (const t of CHART_TEMPLATES) {
      if (t.id === 'standard') continue;
      const values = resolvePresentation(lineCtx, t.overrides).values;
      expect(matchTemplate(values, false), t.id).toBe(t.id);
    }
    const tweaked = resolvePresentation(lineCtx, { ...templateById('newsroom').overrides, lineWidth: 'thin' }).values;
    expect(matchTemplate(tweaked, false)).toBeNull();
  });
  it('a non-pristine chart that happens to equal the stock values is not standard, and the most specific match wins', () => {
    expect(matchTemplate(STOCK_PRESENTATION, false)).toBeNull();
    // minimal ⊂ nothing else, but a chart with minimal's keys AND newsroom's extra keys is neither
    const both = resolvePresentation(lineCtx, { ...templateById('minimal').overrides, framePadding: 'small' }).values;
    expect(matchTemplate(both, false)).toBe('minimal');
  });
});
```

- [ ] **Step 2: Run to verify failure** — `cd web && npx vitest run lib/chart-templates.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement** `web/lib/chart-templates.ts`:

```ts
// ADR 043: chart templates v1 — named LOOKS, each a curated bundle of the
// presentation options that already exist (ADR 039's own seam: "named
// Partial<ChartPresentation> objects over the same overrides"). Pure: no
// React, no Recharts. A template never enters a ChartSpec or an audit row;
// applying one is chart.tsx's resetPresentation + setPresentation, and every
// honesty lock re-runs per render exactly as for a hand-picked override.
import type { MessageKey } from './i18n/messages.ts';
import {
  FRAME_GRADIENT_PRESETS,
  RECHARTS_PALETTE,
  type ChartPresentation,
  type PresentationKey,
  type PresentationOverrides,
} from './chart-presentation.ts';

export type ChartTemplateId = 'standard' | 'classic' | 'newsroom' | 'presentation' | 'social' | 'minimal';

export interface ChartTemplate {
  id: ChartTemplateId;
  nameKey: MessageKey;
  descriptionKey: MessageKey;
  /** Partial<ChartPresentation>, sanitizeOverrides-safe (pinned); `{}` for standard. */
  overrides: PresentationOverrides;
}

const ocean = FRAME_GRADIENT_PRESETS.find((p) => p.id === 'ocean')!;

function template(id: ChartTemplateId, overrides: PresentationOverrides): ChartTemplate {
  return { id, nameKey: `chart.template.${id}`, descriptionKey: `chart.template.${id}Description`, overrides };
}

export const CHART_TEMPLATES: readonly ChartTemplate[] = [
  // The designed default itself (ADR 042).
  template('standard', {}),
  // The session-87 "basic Recharts" look, colours included — continuity.
  template('classic', {
    lineWidth: 'normal',
    markers: 'all',
    grid: 'both',
    axisLines: 'shown',
    areaFill: 'flat',
    seriesColors: Object.fromEntries(RECHARTS_PALETTE.map((hex, i) => [i, hex])),
  }),
  // The ICP's publish-ready look: a heavier line, no decoration but the
  // honesty ring, a landscape export.
  template('newsroom', {
    lineWidth: 'thick',
    markers: 'provisionalOnly',
    grid: 'horizontal',
    axisLines: 'hidden',
    valueLabels: 'shown',
    framePadding: 'small',
    frameAspect: '16:9',
  }),
  // A slide: the chart on its card over a dark slate gradient. The inset
  // card keeps the series legible on both themes and in the export (the
  // backdrops are the card colours — the contrast gate holds by construction).
  template('presentation', {
    lineWidth: 'thick',
    frameBackground: { kind: 'gradient', from: '#334155', to: '#0f172a' },
    frameInset: 'small',
    framePadding: 'medium',
    frameCorners: 'rounded',
    frameShadow: 'strong',
    frameAspect: '16:9',
  }),
  // A portrait social card on the ocean preset, same inset-card reasoning.
  template('social', {
    lineWidth: 'thick',
    valueLabels: 'shown',
    frameBackground: { kind: 'gradient', from: ocean.from, to: ocean.to },
    frameInset: 'small',
    framePadding: 'medium',
    frameCorners: 'veryRounded',
    frameShadow: 'soft',
    frameAspect: '4:5',
  }),
  // Nothing but the line, the labels and the honesty ring.
  template('minimal', { grid: 'none', axisLines: 'hidden', markers: 'provisionalOnly', valueLabels: 'shown' }),
];

export function templateById(id: ChartTemplateId): ChartTemplate {
  return CHART_TEMPLATES.find((t) => t.id === id)!;
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The most specific template whose EVERY override equals the effective
 * value — a tweaked chart matches nothing (it is no longer that look);
 * 'standard' only when the chart is pristine and nothing else matches. */
export function matchTemplate(values: ChartPresentation, pristine: boolean): ChartTemplateId | null {
  let best: ChartTemplate | null = null;
  for (const t of CHART_TEMPLATES) {
    if (t.id === 'standard') continue;
    const keys = Object.keys(t.overrides) as PresentationKey[];
    const wears = keys.every((key) => sameValue(values[key], t.overrides[key]));
    if (wears && (best === null || keys.length > Object.keys(best.overrides).length)) best = t;
  }
  if (best !== null) return best.id;
  return pristine ? 'standard' : null;
}
```

- [ ] **Step 4: Run** — `cd web && npx vitest run lib/chart-templates.test.ts` → PASS. (If `tsc` complains that `chart.template.*` is not a `MessageKey`, Task 2's catalogue keys are missing — do Task 2 Step 3's `messages.ts` edit, then re-run.)

- [ ] **Step 5: Commit**
```bash
git add web/lib/chart-templates.ts web/lib/chart-templates.test.ts
git commit -m "feat(chart): template roster v1 — six named looks over the presentation overrides (ADR 043)" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Catalogue keys and the six counter events (mechanical)
**Files:**
- Modify: `web/lib/i18n/messages.ts`, `src/chart/user-styles.ts`, `web/app/usage-actions.test.ts` (and `tests/chart/user-styles.test.ts` only if it pins the event list)

- [ ] **Step 1: Write the failing test** — in `web/app/usage-actions.test.ts` the two pinned event lists (search for `'frame_changed'`) gain, after `'frame_changed'`: `'template_standard', 'template_classic', 'template_newsroom', 'template_presentation', 'template_social', 'template_minimal'`. Run `cd web && npx vitest run app/usage-actions.test.ts` → FAIL.

- [ ] **Step 2: Implement**
  1. `src/chart/user-styles.ts` `CHART_STYLE_EVENTS`: append after `'frame_changed'` (with a comment `// ADR 043: one event per template picked, so the counter can say which looks people choose.`) the six `template_*` names above.
  2. `web/lib/i18n/messages.ts` — add to `nl` after `'chart.panel.tabFrame'` (search it) and mirror in `en`:
     ```ts
     'chart.panel.tabTemplates': 'Sjablonen',
     'chart.template.standard': 'Basis',
     'chart.template.standardDescription': 'De standaardlook: rustig raster, duidelijke lijnen.',
     'chart.template.classic': 'Klassiek',
     'chart.template.classicDescription': 'De vertrouwde look met punten op elk meetmoment.',
     'chart.template.newsroom': 'Redactie',
     'chart.template.newsroomDescription': 'Publicatieklaar: stevige lijn, geen franje, liggend formaat.',
     'chart.template.presentation': 'Presentatie',
     'chart.template.presentationDescription': 'Een kaart op een donkere achtergrond, klaar voor een slide.',
     'chart.template.social': 'Sociaal',
     'chart.template.socialDescription': 'Staand formaat met een kleurige rand voor sociale media.',
     'chart.template.minimal': 'Minimaal',
     'chart.template.minimalDescription': 'Alleen de lijn, de waarden en de open markering.',
     'chart.template.brand': 'Merk',
     'chart.template.brandDescription': 'Jouw merkkleuren en lettertype, opgehaald via je website.',
     'chart.template.brandOpen': 'Naar Kleuren',
     'chart.template.current': 'Huidig',
     'chart.template.galleryLabel': 'Sjablonen',
     ```
     English: `'Templates'`, `'Standard'` / `'The default look: a quiet grid, clear lines.'`, `'Classic'` / `'The familiar look with a dot on every point.'`, `'Newsroom'` / `'Publication-ready: a firm line, no frills, landscape.'`, `'Presentation'` / `'A card on a dark backdrop, ready for a slide.'`, `'Social'` / `'Portrait with a colourful frame for social media.'`, `'Minimal'` / `'Just the line, the values and the hollow marker.'`, `'Brand'` / `'Your brand colours and font, fetched from your website.'`, `'Go to Colours'`, `'Current'`, `'Templates'`. No digits anywhere.

- [ ] **Step 3: Verify** — `cd web && npx vitest run app/usage-actions.test.ts lib/chart-templates.test.ts` → PASS; `npx vitest run tests/chart/user-styles.test.ts` (repo root) → PASS; both typechecks clean.

- [ ] **Step 4: Commit**
```bash
git add web/lib/i18n/messages.ts src/chart/user-styles.ts web/app/usage-actions.test.ts
git commit -m "feat(chart): template catalogue keys (nl+en) and six template_* counter events (ADR 043)" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: The derived thumbnail and the Templates tab
**Files:**
- Create: `web/components/chart-template-thumb.tsx`, `web/components/chart-template-thumb.test.tsx`
- Modify: `web/components/chart-config-panel.tsx` (`TabKey`/`TAB_ORDER` ~line 180; `buildPanelCopy`; props ~622; the tablist ~1160; a new tabpanel before the Grafiek one ~1190), `web/components/chart-config-panel.test.tsx`

**Interfaces:**
- Produces: `export function TemplateThumb({ template }: { template: ChartTemplate }): ReactNode` — an `aria-hidden` `<svg viewBox="0 0 64 40">`, digit-free text content (no `<text>` at all); `ChartConfigPanelProps` gains `onApplyTemplate?: (id: ChartTemplateId) => void` (optional so every existing render call compiles); the tab order becomes `['templates', 'chart', 'colors', 'font', 'frame']` with `activeTab` still initialised to `'chart'`.
- Consumes (Tasks 1–2): `CHART_TEMPLATES`, `matchTemplate`, `templateById`, `type ChartTemplateId`; the catalogue keys.

- [ ] **Step 1: Write the failing tests**

  `web/components/chart-template-thumb.test.tsx`:
```tsx
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CHART_TEMPLATES, templateById } from '../lib/chart-templates.ts';
import { DEFAULT_PALETTE, RECHARTS_PALETTE } from '../lib/chart-presentation.ts';
import { TemplateThumb } from './chart-template-thumb.tsx';

describe('TemplateThumb — a digit-free thumbnail derived from the template', () => {
  it('renders one aria-hidden svg per template with no text nodes at all', () => {
    for (const t of CHART_TEMPLATES) {
      const { container } = render(<TemplateThumb template={t} />);
      const svg = container.querySelector('svg')!;
      expect(svg.getAttribute('aria-hidden')).toBe('true');
      expect(svg.querySelector('text')).toBeNull();
      expect((container.textContent ?? '').trim()).toBe('');
    }
  });
  it('derives its look: classic draws a vertical grid and every point in the classic colour; minimal draws no grid, no axis, no points; social has a gradient backdrop with an inset card', () => {
    const classic = render(<TemplateThumb template={templateById('classic')} />).container;
    expect(classic.querySelectorAll('[data-thumb="grid-v"]').length).toBeGreaterThan(0);
    expect(classic.querySelectorAll('[data-thumb="point"]').length).toBe(5);
    expect(classic.querySelector('[data-thumb="line"]')?.getAttribute('stroke')).toBe(RECHARTS_PALETTE[0]);
    const minimal = render(<TemplateThumb template={templateById('minimal')} />).container;
    expect(minimal.querySelector('[data-thumb="grid-h"]')).toBeNull();
    expect(minimal.querySelector('[data-thumb="axis"]')).toBeNull();
    expect(minimal.querySelectorAll('[data-thumb="point"]').length).toBe(0);
    expect(minimal.querySelector('[data-thumb="line"]')?.getAttribute('stroke')).toBe(DEFAULT_PALETTE[0]);
    const standard = render(<TemplateThumb template={templateById('standard')} />).container;
    expect(standard.querySelectorAll('[data-thumb="point"]').length).toBe(2);
    expect(standard.querySelector('[data-thumb="grid-h"]')).not.toBeNull();
    expect(standard.querySelector('[data-thumb="grid-v"]')).toBeNull();
    const social = render(<TemplateThumb template={templateById('social')} />).container;
    expect(social.querySelector('linearGradient')).not.toBeNull();
    expect(social.querySelector('[data-thumb="card"]')).not.toBeNull();
  });
});
```

  `web/components/chart-config-panel.test.tsx` — add a describe (reuse the file's `Harness`, `lineCtx`, `meta`, and add an `openTab('Sjablonen')` — widen `openTab`'s parameter type to include `'Sjablonen'`):
```tsx
describe('ChartConfigPanel — Sjablonen (templates) tab (ADR 043)', () => {
  it('is the first tab, the panel still opens on Grafiek, and the gallery lists the six templates in order with their descriptions', () => {
    render(<Harness resolved={resolvePresentation(lineCtx, {})} seriesMeta={meta} onChange={vi.fn()} onReset={vi.fn()} idPrefix="t" onApplyTemplate={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Opmaak' }));
    const tabs = screen.getAllByRole('tab').map((t) => t.textContent);
    expect(tabs[0]).toBe('Sjablonen');
    expect(screen.getByRole('tab', { name: 'Grafiek' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('tab', { name: 'Sjablonen' }));
    const cards = screen.getAllByRole('button', { name: /^(Basis|Klassiek|Redactie|Presentatie|Sociaal|Minimaal)$/ });
    expect(cards.map((c) => c.textContent?.startsWith('Basis') || c.getAttribute('aria-label'))).toBeTruthy();
    expect(cards.map((c) => c.getAttribute('aria-label'))).toEqual(['Basis', 'Klassiek', 'Redactie', 'Presentatie', 'Sociaal', 'Minimaal']);
    expect(screen.getByText('Publicatieklaar: stevige lijn, geen franje, liggend formaat.')).toBeTruthy();
  });
  it('marks the current template with aria-pressed and a "Huidig" badge: standard when pristine, newsroom when the chart wears it, none when tweaked', () => {
    const { unmount } = render(<Harness resolved={resolvePresentation(lineCtx, {})} seriesMeta={meta} onChange={vi.fn()} onReset={vi.fn()} idPrefix="t" onApplyTemplate={vi.fn()} />);
    openTab('Sjablonen');
    expect(screen.getByRole('button', { name: 'Basis' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getAllByText('Huidig').length).toBe(1);
    unmount();
    render(<Harness resolved={resolvePresentation(lineCtx, templateById('newsroom').overrides)} seriesMeta={meta} onChange={vi.fn()} onReset={vi.fn()} idPrefix="t" onApplyTemplate={vi.fn()} />);
    openTab('Sjablonen');
    expect(screen.getByRole('button', { name: 'Redactie' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Basis' })).toHaveAttribute('aria-pressed', 'false');
  });
  it('clicking a card emits onApplyTemplate with its id and nothing else', () => {
    const onApplyTemplate = vi.fn();
    const onChange = vi.fn();
    render(<Harness resolved={resolvePresentation(lineCtx, {})} seriesMeta={meta} onChange={onChange} onReset={vi.fn()} idPrefix="t" onApplyTemplate={onApplyTemplate} />);
    openTab('Sjablonen');
    fireEvent.click(screen.getByRole('button', { name: 'Sociaal' }));
    expect(onApplyTemplate).toHaveBeenCalledWith('social');
    expect(onChange).not.toHaveBeenCalled();
  });
  it('the Brand card appears only for a signed-in visitor (brand prop present) and switches to the Kleuren tab', () => {
    const { unmount } = render(<Harness resolved={resolvePresentation(lineCtx, {})} seriesMeta={meta} onChange={vi.fn()} onReset={vi.fn()} idPrefix="t" onApplyTemplate={vi.fn()} />);
    openTab('Sjablonen');
    expect(screen.queryByText('Merk')).toBeNull();
    unmount();
    render(<Harness resolved={resolvePresentation(lineCtx, {})} seriesMeta={meta} onChange={vi.fn()} onReset={vi.fn()} idPrefix="t" onApplyTemplate={vi.fn()} brand={{ lookup: vi.fn() }} />);
    openTab('Sjablonen');
    expect(screen.getByText('Merk')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Naar Kleuren' }));
    expect(screen.getByRole('tab', { name: 'Kleuren' })).toHaveAttribute('aria-selected', 'true');
  });
  it('English: Templates / Standard … Minimal / Current / Go to Colours', () => {
    render(<Harness lang="en" resolved={resolvePresentation(lineCtx, {})} seriesMeta={meta} onChange={vi.fn()} onReset={vi.fn()} idPrefix="t" onApplyTemplate={vi.fn()} brand={{ lookup: vi.fn() }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Style' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Templates' }));
    expect(screen.getByRole('button', { name: 'Standard' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Current')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Go to Colours' })).toBeTruthy();
  });
  it('the whole tab is digit-free (no ratio numbers leak into text)', () => {
    const { container } = render(<Harness resolved={resolvePresentation(lineCtx, {})} seriesMeta={meta} onChange={vi.fn()} onReset={vi.fn()} idPrefix="t" onApplyTemplate={vi.fn()} brand={{ lookup: vi.fn() }} />);
    openTab('Sjablonen');
    expect(container.textContent ?? '').not.toMatch(/\d/);
  });
});
```
  (Import `templateById` from `'../lib/chart-templates.ts'`; check `Harness` forwards extra props such as `brand` and `onApplyTemplate` to `ChartConfigPanel` — it spreads `{...props}`; the `ChartConfigPanelBrand` shape is `{ lookup: (website?: string) => Promise<…> }` — look at the interface and pass a `vi.fn()` cast if needed. Also update the existing test `'is closed by default and opens into a labelled region with four tabs'` to five tabs.)

- [ ] **Step 2: Run to verify failure** — `cd web && npx vitest run components/chart-template-thumb.test.tsx components/chart-config-panel.test.tsx -t "Sjablonen|TemplateThumb|four tabs"` → FAIL.

- [ ] **Step 3: Implement**

  `web/components/chart-template-thumb.tsx`:
```tsx
// ADR 043: a template's thumbnail, DERIVED from its resolved presentation
// values — never hand-drawn per template, so it cannot drift from what the
// template actually applies. Digit-free by construction (no <text>), hidden
// from assistive tech (the card's own name/description carry the meaning).
import type { ReactNode } from 'react';
import {
  FRAME_CORNER_PX,
  FRAME_GRADIENT_ANGLE,
  resolvePresentation,
  seriesColor,
} from '../lib/chart-presentation.ts';
import type { ChartTemplate } from '../lib/chart-templates.ts';

const W = 64;
const H = 40;
// One fixed, plausible polyline — five points, a rise, a dip, a rise.
const POINTS: [number, number][] = [
  [8, 30],
  [20, 22],
  [32, 26],
  [44, 14],
  [56, 10],
];

export function TemplateThumb({ template }: { template: ChartTemplate }): ReactNode {
  const values = resolvePresentation({ kind: 'line', form: 'line', seriesCount: 1, hasProvisional: false }, template.overrides).values;
  const colour = seriesColor(values, 0);
  const bg = values.frameBackground;
  const inset = values.frameInset !== 'none';
  const corner = Math.round(FRAME_CORNER_PX[values.frameCorners] / 4);
  const gradientId = `thumb-${template.id}-bg`;
  const plotTop = 6;
  const plotBottom = 34;
  const plotLeft = 6;
  const plotRight = 58;
  const visible = (i: number): boolean => {
    if (values.markers === 'all') return true;
    if (values.markers === 'ends') return i === 0 || i === POINTS.length - 1;
    return false;
  };
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden="true" data-template-thumb={template.id}>
      {bg !== 'none' && bg.kind === 'gradient' ? (
        <defs>
          <linearGradient id={gradientId} gradientTransform={`rotate(${FRAME_GRADIENT_ANGLE - 90})`}>
            <stop offset="0" stopColor={bg.from} />
            <stop offset="1" stopColor={bg.to} />
          </linearGradient>
        </defs>
      ) : null}
      <rect
        x={0}
        y={0}
        width={W}
        height={H}
        rx={corner}
        fill={bg === 'none' || bg.kind === 'image' ? 'var(--card)' : bg.kind === 'solid' ? bg.hex : `url(#${gradientId})`}
        stroke="var(--border)"
        data-thumb="frame"
      />
      {inset ? <rect x={4} y={4} width={W - 8} height={H - 8} rx={corner} fill="var(--card)" data-thumb="card" /> : null}
      {values.grid !== 'none' ? (
        <>
          <line x1={plotLeft} x2={plotRight} y1={plotTop + 4} y2={plotTop + 4} stroke="var(--border)" data-thumb="grid-h" />
          <line x1={plotLeft} x2={plotRight} y1={plotBottom - 6} y2={plotBottom - 6} stroke="var(--border)" data-thumb="grid-h" />
        </>
      ) : null}
      {values.grid === 'both'
        ? [20, 32, 44].map((x) => <line key={x} x1={x} x2={x} y1={plotTop} y2={plotBottom} stroke="var(--border)" data-thumb="grid-v" />)
        : null}
      {values.axisLines === 'shown' ? (
        <>
          <line x1={plotLeft} x2={plotLeft} y1={plotTop} y2={plotBottom} stroke="var(--muted-foreground)" data-thumb="axis" />
          <line x1={plotLeft} x2={plotRight} y1={plotBottom} y2={plotBottom} stroke="var(--muted-foreground)" data-thumb="axis" />
        </>
      ) : values.grid !== 'none' ? (
        <line x1={plotLeft} x2={plotRight} y1={plotBottom} y2={plotBottom} stroke="var(--border)" data-thumb="baseline" />
      ) : null}
      <polyline
        points={POINTS.map(([x, y]) => `${x},${y}`).join(' ')}
        fill="none"
        stroke={colour}
        strokeWidth={values.lineWidth === 'thick' || values.lineWidth === 'extraThick' ? 2.5 : 1.5}
        strokeLinejoin="round"
        data-thumb="line"
      />
      {POINTS.map(([x, y], i) => (visible(i) ? <circle key={i} cx={x} cy={y} r={2} fill={colour} data-thumb="point" /> : null))}
    </svg>
  );
}
```

  `web/components/chart-config-panel.tsx`:
  1. `type TabKey = 'templates' | 'chart' | 'colors' | 'font' | 'frame'; const TAB_ORDER: readonly TabKey[] = ['templates', 'chart', 'colors', 'font', 'frame'];` — `activeTab` stays `useState<TabKey>('chart')` with a comment (ADR 043: first in the order, not the default — see the plan's decision).
  2. `buildPanelCopy`: add `tabTemplates`, `templateCurrent`, `templateGalleryLabel`, `templateBrand`, `templateBrandDescription`, `templateBrandOpen` from the new keys.
  3. Props: `onApplyTemplate?: (id: ChartTemplateId) => void;` with a doc comment (chart.tsx owns reset + apply + counter; the panel only reports the pick).
  4. Tablist: `{tabButton('templates', copy.tabTemplates)}` first.
  5. New tabpanel rendered BEFORE the Grafiek one, gated like the others on `resolved.applicable.has('lineWidth')` is NOT right (a bar chart has no lineWidth) — gate on `resolved.applicable.has('grid')` (every non-table form):
```tsx
      {activeTab === 'templates' && resolved.applicable.has('grid') ? (
        <div id={panelId('templates')} role="tabpanel" aria-labelledby={tabId('templates')} className="mt-3">
          <div role="group" aria-label={copy.templateGalleryLabel} className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {CHART_TEMPLATES.map((template) => {
              const current = currentTemplate === template.id;
              return (
                <button
                  key={template.id}
                  type="button"
                  aria-label={t(lang, template.nameKey)}
                  aria-pressed={current}
                  onClick={() => onApplyTemplate?.(template.id)}
                  className={cn(
                    'flex flex-col items-start gap-1 rounded-lg border p-2 text-left text-xs transition-colors hover:bg-muted',
                    current ? 'border-foreground bg-secondary' : 'border-border',
                  )}
                >
                  <TemplateThumb template={template} />
                  <span className="flex w-full items-center justify-between gap-1">
                    <span className="font-medium text-foreground">{t(lang, template.nameKey)}</span>
                    {current ? <span className="rounded-full bg-foreground px-1.5 text-[10px] text-background">{copy.templateCurrent}</span> : null}
                  </span>
                  <span className="text-muted-foreground">{t(lang, template.descriptionKey)}</span>
                </button>
              );
            })}
            {brand ? (
              <div className="flex flex-col items-start gap-1 rounded-lg border border-dashed border-border p-2 text-xs">
                <span className="font-medium text-foreground">{copy.templateBrand}</span>
                <span className="text-muted-foreground">{copy.templateBrandDescription}</span>
                <Button type="button" variant="outline" size="xs" onClick={() => setActiveTab('colors')}>
                  {copy.templateBrandOpen}
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
```
     with `const currentTemplate = matchTemplate(resolved.values, resolved.pristine);` computed once per render near the top of the component, and imports for `CHART_TEMPLATES`, `matchTemplate`, `type ChartTemplateId`, `TemplateThumb`. (`text-[10px]` is a class name, not a text node — the digit-free rule is about text; `cn` is already imported.)
  6. `onTabsKeyDown` and the roving tabindex already iterate `TAB_ORDER`; verify by reading — no change expected.

- [ ] **Step 4: Run** — `cd web && npx vitest run components/chart-template-thumb.test.tsx components/chart-config-panel.test.tsx components/chart.test.tsx` → PASS (update the "four tabs" pin to five; any other failure is investigated, never a digit-scan weakened). Typecheck clean.

- [ ] **Step 5: Commit**
```bash
git add web/components/chart-template-thumb.tsx web/components/chart-template-thumb.test.tsx web/components/chart-config-panel.tsx web/components/chart-config-panel.test.tsx
git commit -m "feat(chart): Templates tab — derived thumbnails, current-template marking, Brand card (ADR 043)" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Applying a template from the chart
**Files:**
- Modify: `web/components/chart.tsx` (the `<ChartConfigPanel …>` mount — search `onReset={() => {`), `web/components/chart.test.tsx`

**Interfaces:**
- Consumes: `onApplyTemplate` (Task 3), `templateById` (Task 1), the `template_*` events (Task 2), `trackChartStyleEvent`.

- [ ] **Step 1: Write the failing tests** — in `chart.test.tsx`, a new describe (reuse `threePointSpec()`, the `ChartStyleProvider`-free default render, and the file's usage-sink stub pattern — search for `setChartUsageSink` to see how other tests capture events):
```tsx
describe('templates (ADR 043) — applying a look from the Sjablonen tab', () => {
  it('Klassiek: every point drawn, vertical grid, axis lines, classic colour; Basis restores the designed default; the counter records the pick', () => {
    const events: string[] = [];
    setChartUsageSink((e) => { events.push(e); });
    const { container } = render(<ChartView spec={threePointSpec()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Opmaak' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Sjablonen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Klassiek' }));
    expect(container.querySelector('.recharts-cartesian-grid-vertical')).not.toBeNull();
    expect(container.querySelector('.recharts-yAxis .recharts-cartesian-axis-line')).not.toBeNull();
    expect(container.querySelectorAll('circle[data-marker="hidden"]').length).toBe(0);
    expect(container.querySelector('.recharts-line-curve')?.getAttribute('stroke')).toBe(RECHARTS_PALETTE[0]);
    expect(screen.getByRole('button', { name: 'Klassiek' })).toHaveAttribute('aria-pressed', 'true');
    expect(events).toContain('template_classic');
    fireEvent.click(screen.getByRole('button', { name: 'Basis' }));
    expect(container.querySelector('.recharts-cartesian-grid-vertical')).toBeNull();
    expect(container.querySelector('.recharts-line-curve')?.getAttribute('stroke')).toBe(DEFAULT_PALETTE[0]);
    expect(events).toContain('template_standard');
    setChartUsageSink(null);
  });
  it('a template replaces earlier tweaks (reset first) and clears an uploaded frame image; Standaard afterwards returns to the default', () => {
    const { container } = render(<ChartView spec={threePointSpec()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Opmaak' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Dun' }));
    expect(container.querySelector('.recharts-line-curve')?.getAttribute('stroke-width')).toBe('1');
    fireEvent.click(screen.getByRole('tab', { name: 'Sjablonen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Minimaal' }));
    expect(container.querySelector('.recharts-line-curve')?.getAttribute('stroke-width')).toBe('2');
    expect(container.querySelector('.recharts-cartesian-grid-horizontal')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Grafiek' }));
    fireEvent.click(screen.getByRole('button', { name: 'Standaard' }));
    expect(container.querySelector('.recharts-cartesian-grid-horizontal')).not.toBeNull();
  });
  it('the whole card stays digit-free apart from spec strings with the Sjablonen tab open, in Dutch and in English', () => {
    // copy the body of the existing "with the panel open on every tab" digit scan and add the Sjablonen tab to the tabs it visits
  });
});
```
  (For the digit scan: find `'the whole-card digit scan still passes with the panel open on every tab (line and bar)'` and extend ITS tab list with `'Sjablonen'` instead of writing a new copy — then delete the placeholder third test above.)

- [ ] **Step 2: Run to verify failure** — `cd web && npx vitest run components/chart.test.tsx -t "templates \(ADR 043\)"` → FAIL (no `onApplyTemplate` wired; nothing happens on click).

- [ ] **Step 3: Implement** in `chart.tsx`, on the `<ChartConfigPanel …>` mount, next to `onReset`:
```tsx
          onApplyTemplate={(id) => {
            // ADR 043: a template REPLACES the reader's per-chart tweaks (a
            // look is a whole, not a layer), then applies as ordinary
            // overrides — every honesty lock re-runs per render exactly as
            // for a hand-picked value. The uploaded frame image is cleared
            // like the full reset does. Owner decision E is untouched: this
            // chart only; the account default is the only persistence.
            dispatch({ type: 'resetPresentation' });
            dispatch({ type: 'setPresentation', patch: templateById(id).overrides });
            setFrameImage(null);
            trackChartStyleEvent(`template_${id}`);
          }}
```
  Import `templateById` from `'../lib/chart-templates.ts'`. (`template_${id}` is typed: `ChartStyleEvent` is the enum union; if TypeScript rejects the template literal, write `trackChartStyleEvent((\`template_${id}\`) as ChartStyleEvent)` with the type imported from `'../backend/chart/user-styles.ts'` — the six ids are exactly the six events, pinned by Task 2's test.)

- [ ] **Step 4: Run** — `cd web && npx vitest run components/chart.test.tsx components/chart-config-panel.test.tsx` → PASS; both typechecks clean.

- [ ] **Step 5: Commit**
```bash
git add web/components/chart.tsx web/components/chart.test.tsx
git commit -m "feat(chart): apply a template from the Sjablonen tab — reset, apply, count (ADR 043)" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## After the tasks (controller)
1. Whole-branch review (top tier): honesty locks under every template × form, the digit scans with the tab open, the contrast gate, the derived thumbs, the counter enum in every pin.
2. Verification block; screenshots of the Templates tab + three applied looks (light + dark); docs (ADR 043, huisstijl, build plan, architecture, open-questions); PR stacked on `visual-designed-default`.

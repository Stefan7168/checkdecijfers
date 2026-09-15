# Chart card polish — quiet controls, headline figure, whitespace and grid Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the production chart card (`web/components/chart.tsx`'s `ChartView` — the component every CBS answer, the dock, the gallery, the trial and the embed page render through) read like a publication chart: the number leads, the chart is the evidence, the controls are quiet — without removing a single control, changing a single plotted value, or weakening any honesty pin.

**Architecture:** Four presentation-only changes over the unchanged spec and the unchanged ADR 039/042 presentation model. (1) A solid half-opacity grid hairline and a wider card padding (render constants in `chart.tsx`, no `STOCK_PRESENTATION` change). (2) The seven controls that today sit in two rows above the plot become one quiet row (Weergave tabs as underline tabs + the Vanaf/Tot selects) plus two header actions (Opmaak as an icon button, Inzichten unchanged) — same DOM order relative to the plot (controls before the `tabpanel`, so keyboard users still reach them before the chart's own focusable points), same accessible names, same ids, same gating. (3) A new pure `headlineFigure()` (`web/lib/chart-headline.ts`) selects the last plotted point of a single time series — a spec string bound to its `resultId`, the same selection rule `valueLabelPlan`'s end label already applies — rendered large above the chart with the existing `trendHeadline` sentence moved directly under it. (4) Nothing in `src/`, `buildChartSpec`, stored specs, prompts, the database, the bundle or `STOCK_PRESENTATION` changes; one optional, owner-gated task (5) would change `STOCK_PRESENTATION.framePadding`.

**Tech Stack:** Next.js 16 / React 19, Recharts 3, Tailwind v4, vitest + Testing Library (jsdom), the message catalogue (`web/lib/i18n/messages.ts`), the hermetic dev harness (`scripts/dev-harness/`) + Playwright for the real-browser pass.

**Spec:** None as a separate file — the main session's code-grounded diagnosis (2026-09-15, owner present: the production chart card screenshot compared against the owner's own reference demo, `checkdecijfers-3d-demo.vercel.app`) is reproduced in **§Diagnosis** below and is the accepted direction; this plan is the only artifact (the same convention as [superpowers/plans/2026-09-13-chart-visual-embed-pass.md](2026-09-13-chart-visual-embed-pass.md)).

## THIS IS PRODUCTION CODE — read before starting

`ChartView` is the one renderer behind every CBS answer in the chat (`web/components/chat.tsx:1280`), the visual dock (`web/components/visual-dock.tsx:104`, `frameless`), the public gallery (`web/components/gallery.tsx:58`, `frameless`), the anonymous trial (`web/components/trial-chat.tsx:105`), the story stage (`web/components/chart-story-stage.tsx:54`) and the public embed route (`web/app/embed/[token]/page.tsx:290`, `frameless embedMode`). Every task therefore:

- runs the **full verification block** before its commit (§Verification block below), including the hermetic benchmark gate — even though no task touches `src/`, the gate is what the owner trusts and it must be *re-run and its line quoted*, not assumed;
- keeps `scanForUnboundDigits` (`web/components/chart.test.tsx:1958`) green over the whole card — the headline figure is the only task that adds digits to the card, and every digit it adds is a spec string already in `harvestSpecStrings` (`chart.test.tsx:1988`: `formattedValue`, `periodLabel`, `unit`);
- **re-verifies ADR 039's honesty locks explicitly** (`judgeColor`'s refuse/warn thresholds, `markerVisible`'s "a provisional point is ALWAYS visible", the hatched provisional bar) with the named test runs in §Verification block — none of the tasks touch them, which is exactly why they must be run and named rather than waved through;
- ends with a **real-browser before/after** (light + dark, 1280 px + 375 px) via the dev harness, with the "before" shots taken from untouched `main` FIRST.

## Diagnosis (the accepted direction — verified against the current code, do not re-litigate)

1. **Control-row crowding.** `chart.tsx:2735-2861` renders, directly above the plot, one row with the five Weergave tabs (`Lijn · Vlak · Staaf · Liggend · Tabel`) in a filled `bg-muted` segmented track with a raised `shadow-sm` active segment (`segmentTab`, `chart.tsx:2174-2176`), then the `Opmaak` ghost button (`ChartConfigTrigger`, `chart-config-panel.tsx:721-742`) and the gradient-ringed `Inzichten` button (`ChartStoryTrigger`, `chart-story.tsx:33-55`); `chart.tsx:2862-2923` renders a SECOND row with the `Vanaf`/`Tot` labels and selects. Seven controls in two rows before the reader sees a single data point. The reference card carries no controls on the card at all.
2. **Tight padding.** `frameClass` (`chart.tsx:1298`) is `'mt-3 rounded-xl border border-border bg-card p-4 text-card-foreground'` — 16 px on the chat/trial card. The gallery article (`gallery.tsx:55`) and the dock's scroll area (`visual-dock.tsx:99`) also pad at `p-4`.
3. **No headline number.** Numbers appear only as 11 px axis ticks (`AxisTick`, `chart.tsx:1126-1146`) and the 12 px end-of-line / bar labels (`VALUE_LABEL_PROPS`, `chart.tsx:776`). The only "headline" is `attribution.trendHeadline` — a prose sentence with a direction verb and NO number (`src/answer/compose/template.ts:185-199`: `"<subject> steeg gestaag sinds <periodLabel>."`), rendered small BELOW the chart (`chart.tsx:3205-3209`). It is complementary to a headline figure, not a substitute (the research brief's idea 4, [session-briefs/2026-09-02-session-69-chart-ux-research.md](../../session-briefs/2026-09-02-session-69-chart-ux-research.md) row 4, always described the block as a takeaway headline + a number-bearing "what am I looking at"; only the sentence half was built in sessions 80-81).
4. **Grid weight.** `STOCK_PRESENTATION.grid` is `'horizontal'` (ADR 042 — two hairlines at the honest min/max ticks), but every `CartesianGrid` draws them with `strokeDasharray="3 3"` at full `var(--border)` (`chart.tsx:2317-2327`, `2434-2436`, `2536-2538`, `2601-2611`; `chart-small-multiples.tsx:121-130`). That `3 3` dash is byte-identical to the curated event-marker `<ReferenceLine>` (`chart.tsx:2366-2373`) — the very vocabulary clash ADR 042 decision 10 removed from the tooltip cursor, left standing on the grid.

**Current state you must know (it changed after ADR 042):** commit `b86556f` (2026-09-13) made `STOCK_PRESENTATION.frameCorners = 'rounded'` and `frameShadow = 'soft'` (`chart-presentation.ts:137-138`, pinned at `chart-presentation.test.ts:95-96`). So `isFramePristine(STOCK)` is FALSE and `ChartFrame` (`chart-frame.tsx`) already wraps the export container in a 12 px-radius, soft-shadow box with ZERO padding — the plot sits flush against a rounded, shadowed edge. ADR 042 §Decision 2 and its as-built text still describe `square`/`none`; that is a doc gap this plan's controller step closes.

## Design decisions taken for this plan (one line each, the rationale the ADR addendum will carry)

- **Controls stay ABOVE the plot in DOM order; only their visual weight changes.** Considered and rejected: moving the toolbar below the chart (a keyboard user would then have to Tab through every focusable data point — each `SeriesDot`/`SeriesBar` is `tabIndex=0` for click-to-annotate, `chart.tsx:879`/`993` — before reaching the form switch: a real a11y regression, and the APG tabs pattern expects the tablist before its panel); a CSS `order` swap (visual/DOM order decoupling — the exact footgun `chart-edit-modal.tsx`'s header comment records as a review finding); hover/focus-reveal at reduced opacity (`text-muted-foreground` at 60 % opacity fails 1.4.3 until hovered, and touch devices never hover); a disclosure toggle hiding the tabs (the Lijn/Staaf/Tabel switch is a core honesty affordance — "the Tabel view is the honest surface for many series" — and ~120 existing `getByRole('tab', …)` assertions expect it at render).
- **One quiet control row:** the Weergave tablist becomes underline tabs (inactive `text-muted-foreground`, active `text-foreground font-medium border-b-2 border-foreground`; no `bg-muted` track, no `shadow-sm`) — the dock's own house pattern ([12-huisstijl.md](../../12-huisstijl.md) §Layout: "the dock card … uses underline tabs"); the Vanaf/Tot selects join the SAME row, right-aligned (`ml-auto`), instead of a second row. `min-h-11 sm:min-h-6` stays on every tab (R9.1 pin, `chart.test.tsx:4633-4641`).
- **Two header actions:** `Opmaak` becomes an icon-only ghost button (`SlidersHorizontal`, `size="icon-sm"`, `aria-label` + `title` = the same catalogue string, so `getByRole('button', { name: 'Opmaak' | 'Style' })` is unchanged; `max-sm:size-11` for the 44 px phone target) at the top-right of the card next to the title, with `Inzichten` (unchanged component, its gradient ring kept — the product's one gradient, huisstijl) beside it. The card-actions-top-right idiom is universal; the accessible names, ids (`${domId}-style-trigger`, `-story-trigger`), `aria-controls`, `aria-expanded`, focus-return and gating (`!embedMode && !inStage`, `state.form !== 'table'`, `storyAvailable`) are byte-for-byte the same. **Owner-reviewable default:** if the owner wants the word "Opmaak" visible, the `compact` prop is simply not passed — one line.
- **Headline figure = the last PLOTTED point of a single time series** (`kind === 'line' && series.length === 1`), from the DISPLAYED spec (zoomed + translated), so under a Vanaf/Tot window it is the window's own last point, labelled with its own `periodLabel` — honest by disclosure, exactly like the existing end-of-line label (`valueLabelPlan`, `chart.tsx:396-409`, which already uses "the last plotted point of every line"). Provisional → the same `*` suffix every other value label carries, explained by the existing `○ = voorlopig cijfer` note. Not offered for multi-series charts (which series would lead?) nor comparisons (picking "the highest bar" is a selection over values — the class [open-questions #221](../../open-questions.md) records as an assumption; deferred), nor the table form (it shows everything), nor stage mode (ADR 044: the stage's caption is the sentence). **Shown in embed mode** — an embed is the same honest card, and a stand-alone card is exactly where a headline earns its place.
- **"Net change" is NOT in scope:** `ChartSpec` (`src/chart/types.ts`) carries no derivation records — only the prose `trendHeadline` reaches the spec from the `direction` derivation — so a change-since-X figure would need a new spec field (schema v2 per ADR 007/014) or a second builder. Recorded as a follow-up in open-questions, never computed client-side (R6).
- **The trend headline sentence moves up under the figure** (same `data-testid="trend-headline"`, same gating: `!inStage && state.form !== 'table' && !state.periodRange`): number in a sentence, chart as evidence below. Every existing trend-headline test queries by test id / text, never by position.
- **Grid: keep `STOCK_PRESENTATION.grid = 'horizontal'`, change how it is DRAWN.** The two hairlines sit at the honest min/max ticks — the only numbers on the y-axis; without a guide line those two labels float (`grid: 'none'` is the Minimaal template's job, one click away). The grid becomes a SOLID hairline at `strokeOpacity 0.5` via one shared `GRID_LINE_PROPS` (no dash — the `3 3` dash now belongs to event markers alone). `STOCK_PRESENTATION` and `DEFAULT_PALETTE` are therefore untouched by Tasks 1-4: no deep-equal pin, no template, no saved account default moves.
- **Padding: `frameClass` `p-4` → `p-5 sm:p-6`; the gallery article follows** (`gallery.tsx:55`). The dock's scroll area (`visual-dock.tsx:99`) stays `p-4`: it is a narrow side panel where width is the scarce resource — flagged, not changed.
- **Baseline default, not a new template — subject to the owner's confirmation.** Templates (ADR 043) are looks a reader *chooses*; the complaint is about the look every untouched chart *wears*. A "Polished" template would leave the default exactly as bad as today. Tasks 1-4 change only render code and card chrome, never a `STOCK_PRESENTATION` literal, so nothing a reader or a saved account default pinned moves. The one change that WOULD move a pinned default — `framePadding: 'none' → 'small'` so the plot no longer kisses the rounded, shadowed frame edge — is isolated in Task 5 and **must not be built until the owner says yes** (it changes every export's canvas, the `standard` template's derived overrides, and the STOCK deep-equal pin).

## Global Constraints

- **Honesty (docs/05-data-rules.md R1/R6/R11):** every visible number stays a spec string bound via `data-label-for`; the headline figure is a SELECTION of an existing point, never a computation; no new text inside the export container (`chartContainerRef`) — the figure, the sentence and every control live outside it, so `chart-download.tsx` (which reads only `containerRef.current?.querySelector('svg')`, `chart-download.tsx:735`) can never export them; the hollow provisional marker and hatched bar are untouched; Recharts animation stays off; the dashed vocabulary stays reserved for event markers and the story ring.
- **Do NOT weaken any honesty test to make a pin pass.** No existing assertion in `chart.test.tsx`, `chart-presentation.test.ts`, `chart-config-panel.test.tsx`, `chart-story.test.tsx`, `gallery.test.tsx` or `web/app/embed/[token]/page.test.tsx` may be deleted or loosened by Tasks 1-4. If one fails, the implementation is wrong. (Task 5 is the sole exception and names its pins.)
- **Every existing control keeps its accessible name, role, id, `aria-controls`/`aria-expanded`/`aria-describedby`, keyboard handling and gating.** `getByRole('tab', { name })`, `getByRole('button', { name: 'Opmaak' | 'Style' | 'Inzichten' | 'Insights' | 'Kleine grafieken' })`, `getByLabelText('Vanaf' | 'Tot')` and `getByRole('tablist', { name: 'Weergave' })` must all resolve exactly as today.
- **Every new interface string** has an `nl` and an `en` entry in `web/lib/i18n/messages.ts` (the `Messages` type is derived from the `nl` table — a missing `en` key is a compile error) and contains no digits.
- **Both themes:** tokens only (`var(--border)`, `text-muted-foreground`, …), no literal hex outside the sanctioned palette spots.
- **No CSS `aspect-ratio`, no new dependency, no schema/DB/prompt change, nothing in `src/`.**
- **Commands:** web tests `cd web && npx vitest run <files>`; web typecheck `cd web && npx tsc --noEmit`; root typecheck `npx tsc --noEmit`; root suites `npx vitest run`; benchmark `npm run benchmark:run && npm run benchmark:score`; build `cd web && npx next build` (then `git checkout -- web/CLAUDE.md` — Next 16 rewrites it, RUNBOOK gotcha); docs `npm run test:docs`. Commit trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- **Git:** work on branch `chart-card-polish` from `main`. Owner-present session → after the before/after screenshots have been shown in chat, merge/push to `main` under the CLAUDE.md standing authorization (this is chart presentation, not the money path). Autonomous session → open a PR for owner review (#118(b)). Never push a red tree.
- **Do the edits yourself in this run — no subagents inside a task, no "background" work.**

## File map

- Modify `web/components/chart.tsx` (+ `chart.test.tsx`): `frameClass` (1298), new `GRID_LINE_PROPS` next to `GRID_COLOR` (166-167), the four `CartesianGrid` sites, `segmentTab` → `quietTab` (2174-2176), the header (2712-2721), the control row + zoom row (2735-2923), the trend headline (3205-3209), the new headline block.
- Modify `web/components/chart-small-multiples.tsx`: the one `CartesianGrid` (121-130) reads `GRID_LINE_PROPS`.
- Modify `web/components/chart-config-panel.tsx` (+ `.test.tsx`): `ChartConfigTrigger` gains `compact`.
- Modify `web/components/gallery.tsx`: the article padding.
- Create `web/lib/chart-headline.ts` (+ `.test.ts`): `headlineFigure`.
- Modify `web/lib/i18n/messages.ts`: `chart.headline.label` (nl + en).
- Docs (controller, after the whole-branch review): ADR 042 addendum (incl. the `b86556f` rounded/soft as-built correction), `docs/12-huisstijl.md` (Charts + "Answer card and chart panel layout" — the Inzichten trigger is no longer "a row-mate of the Weergave tabs after Opmaak"), `docs/08-build-plan.md` (WP197 idea 4: the number half of "Wat zie ik hier?" is now built), `docs/open-questions.md` (new row: headline-in-chat duplication, net-change follow-up, Task 5 decision, dock padding), STATUS / status-archive / lessons-learned.

---

### Task 1: Quiet grid hairline and card padding

**Files:**
- Modify: `web/components/chart.tsx:166-167` (new constant), `:1298` (`frameClass`), `:2317-2327`, `:2434-2436`, `:2536-2538`, `:2601-2611` (the four `CartesianGrid` sites)
- Modify: `web/components/chart-small-multiples.tsx:8-12` (imports), `:121-130` (its `CartesianGrid`)
- Modify: `web/components/gallery.tsx:55`
- Test: `web/components/chart.test.tsx` (the `describe('ADR 042 — the designed default renders its literals', …)` block, `:832-951`), `web/components/chart-small-multiples.test.tsx` (run, expect unchanged)

**Interfaces:**
- Produces: `export const GRID_LINE_PROPS = { stroke: GRID_COLOR, strokeOpacity: 0.5 } as const;` in `chart.tsx` (imported by `chart-small-multiples.tsx`). `frameClass` literal becomes `'mt-3 rounded-xl border border-border bg-card p-5 text-card-foreground sm:p-6'`.

- [ ] **Step 1: Write the failing tests** — add to the `'ADR 042 — the designed default renders its literals'` describe in `chart.test.tsx` (after the `'height follows width: unmeasured (jsdom)…'` test):

```ts
  it('chart-card polish (2026-09-15): the grid is a SOLID half-opacity hairline in the grid colour — no dash (the 3 3 dash belongs to event markers alone)', () => {
    const { container } = render(<ChartView spec={threePointSpec()} />);
    const lines = [...container.querySelectorAll('.recharts-cartesian-grid-horizontal line')];
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line.getAttribute('stroke-dasharray')).toBeNull();
      expect(line.getAttribute('stroke')).toBe('var(--border)');
      expect(line.getAttribute('stroke-opacity')).toBe('0.5');
    }
    // The curated event marker keeps its dash — the two vocabularies stay distinct.
    const annotated = render(<ChartView spec={spec({ annotations: [{ periodCode: '2024JJ00', label: 'Testgebeurtenis' }] })} />).container;
    expect(annotated.querySelector('.recharts-reference-line line')?.getAttribute('stroke-dasharray')).toBe('3 3');
  });
  it('chart-card polish: the bar, horizontal-bar and small-multiples grids draw the same solid hairline', () => {
    const cmp = spec({
      kind: 'bar',
      series: [
        { label: 'Amsterdam', regionCode: 'GM0363', points: [point({ resultId: 'a', periodCode: '2023JJ00', periodLabel: '2023', value: 1, formattedValue: '1,0' })] },
        { label: 'Rotterdam', regionCode: 'GM0599', points: [point({ resultId: 'r', periodCode: '2023JJ00', periodLabel: '2023', value: 2, formattedValue: '2,0' })] },
      ],
    });
    const { container } = render(<ChartView spec={cmp} />);
    const barLine = container.querySelector('.recharts-cartesian-grid-horizontal line')!;
    expect(barLine.getAttribute('stroke-dasharray')).toBeNull();
    expect(barLine.getAttribute('stroke-opacity')).toBe('0.5');
    fireEvent.click(screen.getByRole('tab', { name: 'Liggend' }));
    const hbarLine = container.querySelector('.recharts-cartesian-grid-vertical line')!;
    expect(hbarLine.getAttribute('stroke-dasharray')).toBeNull();
    expect(hbarLine.getAttribute('stroke-opacity')).toBe('0.5');
    cleanup();
    const multi = render(<ChartView spec={twoSeriesSpec()} />).container;
    fireEvent.click(screen.getByRole('button', { name: 'Kleine grafieken' }));
    const smallLine = multi.querySelector('.recharts-cartesian-grid-horizontal line')!;
    expect(smallLine.getAttribute('stroke-dasharray')).toBeNull();
    expect(smallLine.getAttribute('stroke-opacity')).toBe('0.5');
  });
  it('chart-card polish: the chat card frame pads p-5 / sm:p-6 (was p-4); frameless surfaces still get no frame at all', () => {
    const framed = render(<ChartView spec={threePointSpec()} />).container.firstElementChild as HTMLElement;
    expect(framed.className).toContain('p-5');
    expect(framed.className).toContain('sm:p-6');
    expect(framed.className).not.toMatch(/\bp-4\b/);
    expect(framed.className).toContain('rounded-xl');
    cleanup();
    const frameless = render(<ChartView spec={threePointSpec()} frameless />).container.firstElementChild as HTMLElement;
    expect(frameless.className).toBe('');
  });
```

  (`twoSeriesSpec()` and `threePointSpec()` are the file's existing fixtures — search for `function twoSeriesSpec` / `function threePointSpec` and reuse them exactly; if `twoSeriesSpec` is single-period and small multiples is not offered for it, use `twoSeriesLineSpec()` instead — it is the fixture the small-multiples describe at `:1325` already uses.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npx vitest run components/chart.test.tsx -t "chart-card polish"`
Expected: FAIL — `stroke-dasharray` is `3 3` on every grid line, no `stroke-opacity`, the card class contains `p-4`.

  If Recharts 3 emits the opacity under a different attribute name than `stroke-opacity`, read the failing DOM in the test output and correct the ATTRIBUTE NAME in the test only (never the expected value); note it in the commit message.

- [ ] **Step 3: Implement**

  1. `chart.tsx`, directly after `export const GRID_COLOR = 'var(--border)';` (line 167):
  ```ts
  /** Chart-card polish (2026-09-15): the grid is a SOLID hairline at half
   * opacity. The former `3 3` dash was byte-identical to the curated
   * event-marker <ReferenceLine> dash below — ADR 042 decision 10 reserved
   * the dashed vocabulary for event markers and the story ring, and the grid
   * had been the one exception. One constant shared by every CartesianGrid
   * (line, area, bar, hbar, ChartSmallMultiples) so the five sites cannot
   * drift. `pres.grid` still decides WHICH lines exist (ADR 039/042). */
  export const GRID_LINE_PROPS = { stroke: GRID_COLOR, strokeOpacity: 0.5 } as const;
  ```
  2. Line-chart site (`:2317-2327`): replace `strokeDasharray="3 3"` and `stroke={GRID_COLOR}` with `{...GRID_LINE_PROPS}` (keep `horizontal` / `vertical={pres.grid === 'both'}` and the existing comment). Area site (`:2434-2436`): `<CartesianGrid {...GRID_LINE_PROPS} horizontal vertical={pres.grid === 'both'} />`. Hbar site (`:2536-2538`): `<CartesianGrid {...GRID_LINE_PROPS} vertical horizontal={pres.grid === 'both'} />`. Bar site (`:2601-2611`): same substitution as the line site. Grep the file for `strokeDasharray="3 3"` afterwards — the ONLY remaining hits must be the two `<ReferenceLine>` event markers (`:2371`, `:2463`).
  3. `chart-small-multiples.tsx`: add `GRID_LINE_PROPS` to the import from `'./chart.tsx'` (line 12), replace `strokeDasharray="3 3"` + `stroke={GRID_COLOR}` in its `CartesianGrid` (`:121-130`) with `{...GRID_LINE_PROPS}`; drop `GRID_COLOR` from the import if it is now unused (`npx tsc --noEmit` / eslint will tell you).
  4. `chart.tsx:1298`: `const frameClass = frameless || inStage ? '' : 'mt-3 rounded-xl border border-border bg-card p-5 text-card-foreground sm:p-6';` and add one comment line above it: `// Chart-card polish (2026-09-15): p-5 / sm:p-6 (was p-4) — the reference card the owner compared against breathes; the dock keeps its own p-4 (visual-dock.tsx), a narrow side panel.`
  5. `gallery.tsx:55`: `<article className="rounded-xl border border-border bg-card p-5 sm:p-6">`.

- [ ] **Step 4: Run the tests**

Run: `cd web && npx vitest run components/chart.test.tsx components/chart-small-multiples.test.tsx components/gallery.test.tsx components/chart-download.test.tsx`
Expected: PASS, every test. (`chart-download.test.tsx` is included because the export clones the live svg: a grid-line attribute change must not break any export pin — none pins the dash, verify by the run.)

- [ ] **Step 5: Typecheck** — `cd web && npx tsc --noEmit` → no errors.

- [ ] **Step 6: Commit**

```bash
git add web/components/chart.tsx web/components/chart.test.tsx web/components/chart-small-multiples.tsx web/components/gallery.tsx
git commit -m "feat(chart): solid half-opacity grid hairline (dash reserved for event markers), wider card padding (chart-card polish)" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: One quiet control row + two header actions

**Files:**
- Modify: `web/components/chart-config-panel.tsx:713-742` (`ChartConfigTriggerProps`, `ChartConfigTrigger`)
- Modify: `web/components/chart.tsx:2174-2181` (`segmentTab` → `quietTab`), `:2712-2721` (header), `:2735-2923` (the two control rows → one row + header actions)
- Test: `web/components/chart-config-panel.test.tsx`, `web/components/chart.test.tsx`

**Interfaces:**
- Produces: `ChartConfigTriggerProps` gains `compact?: boolean` (default `false` — the existing text rendering is byte-identical when omitted). In `chart.tsx` two new landmarks for tests and CSS: `data-slot="chart-card-actions"` (the header cluster) and `data-slot="chart-controls"` (the single control row).
- Consumes: nothing from Task 1.

- [ ] **Step 1: Write the failing tests**

  (a) `chart-config-panel.test.tsx` — add a describe after the `Harness` helper (reuse the file's own `lineCtx`, `meta`, and the prop shape its other `render(<Harness …/>)` calls use):

```ts
describe('ChartConfigTrigger compact (chart-card polish, 2026-09-15)', () => {
  it('compact renders an icon-only button whose accessible name and title are still Opmaak / Style, with the phone tap-target class', () => {
    const { unmount } = render(
      <ChartConfigTrigger open={false} onToggle={() => {}} controlsId="p-style" triggerId="p-style-trigger" compact />,
    );
    const button = screen.getByRole('button', { name: 'Opmaak' });
    expect(button.textContent).toBe('');
    expect(button).toHaveAttribute('title', 'Opmaak');
    expect(button).toHaveAttribute('aria-controls', 'p-style');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button.querySelector('svg')).not.toBeNull();
    expect(button.className).toContain('max-sm:size-11');
    unmount();
    render(<ChartConfigTrigger open onToggle={() => {}} controlsId="p-style" triggerId="p-style-trigger" compact lang="en" />);
    expect(screen.getByRole('button', { name: 'Style' })).toHaveAttribute('aria-expanded', 'true');
  });
  it('without compact the trigger still shows its text label (every existing harness test relies on this)', () => {
    render(<ChartConfigTrigger open={false} onToggle={() => {}} controlsId="p-style" triggerId="p-style-trigger" />);
    expect(screen.getByRole('button', { name: 'Opmaak' }).textContent).toBe('Opmaak');
  });
});
```

  (b) `chart.test.tsx` — add a new top-level describe directly before `describe('trend headline (#197 idea 4)', …)` (`:1583`):

```ts
describe('chart-card polish (2026-09-15) — a quiet control row and header actions', () => {
  it('Opmaak is an icon-only header action (name kept), Inzichten sits beside it; neither is inside the Weergave row', () => {
    const { container } = render(<ChartView spec={threePointSpec()} />);
    const actions = container.querySelector('[data-slot="chart-card-actions"]') as HTMLElement;
    const controls = container.querySelector('[data-slot="chart-controls"]') as HTMLElement;
    const opmaak = screen.getByRole('button', { name: 'Opmaak' });
    const inzichten = screen.getByRole('button', { name: 'Inzichten' });
    expect(actions).toContainElement(opmaak);
    expect(actions).toContainElement(inzichten);
    expect(opmaak.textContent).toBe('');
    expect(opmaak).toHaveAttribute('title', 'Opmaak');
    expect(controls).not.toContainElement(opmaak);
    expect(controls).not.toContainElement(inzichten);
    expect(controls).toContainElement(screen.getByRole('tablist', { name: 'Weergave' }));
    // The gradient ring around Inzichten (the product's one gradient) survives the move.
    expect(container.querySelector('[data-story-trigger-ring]')).toContainElement(inzichten);
  });
  it('the Vanaf/Tot selects share the Weergave row — one control row above the plot, not two — and keep their labels', () => {
    const { container } = render(<ChartView spec={fourYearLineSpec()} />);
    const controls = container.querySelector('[data-slot="chart-controls"]') as HTMLElement;
    expect(controls).toContainElement(screen.getByLabelText('Vanaf'));
    expect(controls).toContainElement(screen.getByLabelText('Tot'));
    // DOM order = keyboard order: the control row precedes the chart panel, so a keyboard user reaches the tabs before the chart's own focusable points.
    const panel = container.querySelector('[role="tabpanel"]') as HTMLElement;
    expect(controls.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
  it('the form tabs are quiet underline tabs: no muted track, the active tab underlined, the R9.1 tap-target classes kept', () => {
    render(<ChartView spec={threePointSpec()} />);
    const tablist = screen.getByRole('tablist', { name: 'Weergave' });
    expect(tablist.className).not.toContain('bg-muted');
    const active = screen.getByRole('tab', { name: 'Lijn' });
    expect(active).toHaveAttribute('aria-selected', 'true');
    expect(active.className).toContain('border-foreground');
    expect(active.className).not.toContain('shadow-sm');
    const inactive = screen.getByRole('tab', { name: 'Staaf' });
    expect(inactive.className).toContain('border-transparent');
    expect(inactive.className).toContain('min-h-11');
    expect(inactive.className).toContain('sm:min-h-6');
  });
  it('the header keeps its shape: the subtitle is still the heading\'s next sibling; the actions cluster is outside that column', () => {
    const s = spec({ dimLabels: { Geslacht: 'Totaal' } });
    const { container } = render(<ChartView spec={s} />);
    const heading = container.querySelector('[role="heading"][aria-level="3"]') as HTMLElement;
    expect(heading.nextElementSibling?.textContent).toContain('Geslacht: Totaal');
    expect(heading.parentElement).not.toContainElement(container.querySelector('[data-slot="chart-card-actions"]'));
  });
  it('Tabel form drops the Opmaak action (no Style panel in table form, as before) and keeps Inzichten off there too', () => {
    render(<ChartView spec={threePointSpec()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Tabel' }));
    expect(screen.queryByRole('button', { name: 'Opmaak' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Inzichten' })).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Lijn' }));
    expect(screen.getByRole('button', { name: 'Opmaak' })).toBeInTheDocument();
  });
  it('embed mode and stage mode render neither the actions cluster nor the control row', () => {
    const embed = render(<ChartView spec={threePointSpec()} embedMode embedFooter="x" />).container;
    expect(embed.querySelector('[data-slot="chart-card-actions"]')).toBeNull();
    expect(embed.querySelector('[data-slot="chart-controls"]')).toBeNull();
    cleanup();
    const stage = render(<ChartView spec={threePointSpec()} stage={{ step: null, overrides: {} }} />).container;
    expect(stage.querySelector('[data-slot="chart-card-actions"]')).toBeNull();
    expect(stage.querySelector('[data-slot="chart-controls"]')).toBeNull();
  });
  it('the whole-card digit scan still passes with the new header and control row, in Dutch and in English', () => {
    const s = fourYearLineSpec();
    const nl = render(<ChartView spec={s} />).container;
    scanForUnboundDigits(nl, harvestSpecStrings(s));
    cleanup();
    const en = render(<LangProvider initial="en"><ChartView spec={s} /></LangProvider>).container;
    scanForUnboundDigits(en, harvestSpecStrings(s));
  });
});
```

  (`fourYearLineSpec` is a function declaration at `:1601` — hoisted, usable above its definition. `LangProvider`'s prop name: copy it from the existing English tests near `:2959` (`describe('WP218 phase 4 — charts follow the app language…')`) — use exactly what they pass.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npx vitest run components/chart-config-panel.test.tsx components/chart.test.tsx -t "compact|quiet control row"`
Expected: FAIL — no `compact` prop (TypeScript error in the test file — run `npx tsc --noEmit` too), no `data-slot="chart-card-actions"`/`chart-controls`, the tablist still carries `bg-muted`.

- [ ] **Step 3: Implement**

  1. `chart-config-panel.tsx` — in `ChartConfigTriggerProps` add:
  ```ts
  /** Chart-card polish (2026-09-15): icon-only rendering for the card's
   * header — the label moves into `aria-label` + `title` (same catalogue
   * string, so the accessible name is unchanged) and the button takes the
   * 44 px phone tap target (R9.1) via `max-sm:size-11`. Default false =
   * the text button every existing harness/test renders, byte-identical. */
  compact?: boolean;
  ```
  and rewrite `ChartConfigTrigger`:
  ```tsx
  export function ChartConfigTrigger({ open, onToggle, controlsId, triggerId, lang = 'nl', compact = false }: ChartConfigTriggerProps): ReactNode {
    const label = t(lang, 'chart.panel.trigger');
    if (compact) {
      return (
        <Button
          id={triggerId}
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          title={label}
          aria-expanded={open}
          aria-controls={controlsId}
          onClick={onToggle}
          className="max-sm:size-11"
        >
          <SlidersHorizontal aria-hidden="true" />
        </Button>
      );
    }
    return (
      <Button id={triggerId} type="button" variant="ghost" size="sm" aria-expanded={open} aria-controls={controlsId} onClick={onToggle}>
        <SlidersHorizontal aria-hidden="true" />
        {label}
      </Button>
    );
  }
  ```
  (Check how the file already obtains `t` for `lang: PanelLang` — `buildPanelCopy(lang)` or a direct `t(lang, …)`; use whichever the existing trigger body used for `'chart.panel.trigger'`.)

  2. `chart.tsx:2174-2176` — replace `segmentTab` with:
  ```ts
  // Chart-card polish (2026-09-15): the Weergave tabs are quiet underline
  // tabs (the dock's own house pattern, 12-huisstijl §Layout) — no filled
  // track, no raised segment; the active tab is a 2 px underline in the
  // foreground colour. R9.1 (#238): `min-h-11 sm:min-h-6` keeps the 44 px
  // phone tap target, pinned by test.
  const quietTab = (active: boolean): string =>
    'min-h-11 sm:min-h-6 border-b-2 px-1.5 py-1 text-xs transition-colors disabled:cursor-not-allowed ' +
    (active ? 'border-foreground font-medium text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground');
  ```
  Keep `tabClass` (the small-multiples pills) unchanged. Replace every `segmentTab(` call in the five tab buttons with `quietTab(`.

  3. Header (`:2711-2721`) — replace the heading + subtitle block with:
  ```tsx
    <div className={frameClass}>
      {/* Chart-card polish (2026-09-15): title + subtitle on the left, the
        * card's two actions (Inzichten, Opmaak) top-right — the universal
        * card-actions idiom. The heading's next sibling stays the subtitle
        * (tests read the header by that relationship). Gating is byte-
        * identical to the old control row: no actions in embed or stage
        * mode; Opmaak never in Tabel form; Inzichten only when a story
        * exists. */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
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
        </div>
        {!embedMode && !inStage && (storyAvailable || state.form !== 'table') ? (
          <div className="flex shrink-0 items-center gap-1" data-slot="chart-card-actions">
            {storyAvailable ? (
              <ChartStoryTrigger open={storyOpen} onToggle={toggleStory} controlsId={storyControlsId} triggerId={storyTriggerId} lang={chartLang} />
            ) : null}
            {state.form !== 'table' ? (
              <ChartConfigTrigger open={styleOpen} onToggle={toggleStylePanel} controlsId={styleControlsId} triggerId={styleTriggerId} lang={chartLang} compact />
            ) : null}
          </div>
        ) : null}
      </div>
  ```
  (Delete the old `<ChartConfigTrigger …/>` and `<ChartStoryTrigger …/>` renders at `:2839-2859` — they must exist in exactly ONE place.)

  4. Control row — replace the block from `{!embedMode && !inStage ? (` at `:2735` through the end of the zoom row `) : null}` at `:2923` with ONE row. The five tab buttons keep every attribute they have today (`ref`, `role="tab"`, `aria-selected`, `aria-controls={panelId}`, `aria-describedby`, `tabIndex`, `disabled`, `title`, `onClick`) — only the wrapper classes and the `className={quietTab(…)}` change; the three `sr-only` reason spans stay where they are inside the row. The two selects keep every attribute they have today (`id`, `aria-label`, `value`, `disabled`, `title`, `aria-describedby`, `onChange` with `clampVanafChange`/`clampTotChange`, the `<option>` list):
  ```tsx
      {/* Chart-card polish (2026-09-15): ONE quiet control row above the
        * plot — the Weergave tablist left, the Vanaf/Tot window right — in
        * place of the former two rows (tablist + Opmaak + Inzichten, then
        * Vanaf/Tot). Kept ABOVE the export container on purpose: DOM order
        * is keyboard order, and every SeriesDot/SeriesBar is a tab stop
        * (click-to-annotate), so a reader must reach the form switch before
        * the chart's own points — moving the row under the plot would have
        * cost a keyboard user one Tab per data point. Spec Part B3 + ADR
        * 044: the whole row is a viewer-only control surface, gated on both
        * `!embedMode` and `!inStage` exactly as before. */}
      {!embedMode && !inStage ? (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2" data-slot="chart-controls">
          <div
            role="tablist"
            aria-label={t(chartLang, 'chart.weergaveLabel')}
            onKeyDown={onFormTabKeyDown}
            className="flex flex-wrap items-center gap-1"
          >
            {/* … the five existing tab buttons, verbatim, with className={quietTab(…) + (… ? '' : ' opacity-40')} … */}
          </div>
          {/* … the three existing sr-only reason spans, verbatim … */}
          {zoomAvailable ? (
            <div className="ml-auto flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              <label htmlFor={`${domId}-from`}>{t(chartLang, 'chart.from')}</label>
              {/* … the existing Vanaf <select>, verbatim … */}
              <label htmlFor={`${domId}-to`}>{t(chartLang, 'chart.to')}</label>
              {/* … the existing Tot <select>, verbatim … */}
            </div>
          ) : null}
        </div>
      ) : null}
  ```
  The disabled-tab modifier changes from `' cursor-not-allowed opacity-40'` to `' opacity-40'` (cursor now comes from `quietTab`'s `disabled:` utility) — or keep the old string; either is fine, but be consistent across the three gated tabs.

  5. Remove the now-unused `segmentTab`. `npx tsc --noEmit` must be clean; eslint must not report unused identifiers.

- [ ] **Step 4: Run the tests**

Run: `cd web && npx vitest run components/chart.test.tsx components/chart-config-panel.test.tsx components/chart-story.test.tsx components/chart-edit-modal.test.tsx components/gallery.test.tsx "app/embed/[token]/page.test.tsx"`
Expected: PASS, every test — including all ~120 pre-existing `getByRole('tab' | 'button' | 'tablist')` / `getByLabelText` assertions, the R9.1 pin (`:4633`), the story-trigger ring pin (`:3424`), the header pin (`:1031`), the embed-mode pins (`:4162-4198`), and every whole-card digit scan. A failure in ANY pre-existing test means the implementation dropped a name, id, attribute or gate — fix the implementation, never the test.

- [ ] **Step 5: Typecheck** — `cd web && npx tsc --noEmit` → no errors.

- [ ] **Step 6: Commit**

```bash
git add web/components/chart.tsx web/components/chart.test.tsx web/components/chart-config-panel.tsx web/components/chart-config-panel.test.tsx
git commit -m "feat(chart): one quiet control row (underline tabs + Vanaf/Tot) and icon header actions — every control, name and id kept (chart-card polish)" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: `headlineFigure` — the pure selection (no rendering yet)

**Files:**
- Create: `web/lib/chart-headline.ts`
- Create: `web/lib/chart-headline.test.ts`

**Interfaces:**
- Produces:
```ts
export interface HeadlineFigure {
  /** The point's own formattedValue, verbatim — never reformatted (R6). */
  value: string;
  provisional: boolean;
  periodLabel: string;
  unit: string;
  /** R1 traceability handle — rendered as data-label-for. */
  resultId: string;
}
export function headlineFigure(spec: Pick<ChartSpec, 'kind' | 'series' | 'unit'>): HeadlineFigure | null;
```

- [ ] **Step 1: Write the failing tests** — `web/lib/chart-headline.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { ChartSpec } from '../backend/chart/types.ts';
import { headlineFigure } from './chart-headline.ts';

type Point = ChartSpec['series'][number]['points'][number];
function point(overrides: Partial<Point> = {}): Point {
  return {
    resultId: 'r1',
    periodCode: '2024JJ00',
    periodLabel: '2024',
    value: 42,
    formattedValue: '42,0',
    decimals: 1,
    status: 'Definitief',
    provisional: false,
    valueAttribute: 'None',
    ...overrides,
  };
}
const single = (points: Point[]): Pick<ChartSpec, 'kind' | 'series' | 'unit'> => ({
  kind: 'line',
  unit: 'x 1 000',
  series: [{ label: 'Nederland', regionCode: null, points }],
});

describe('headlineFigure — the last plotted point of a single time series, a spec string bound to its cell', () => {
  it('returns the last plotted point verbatim with its period, the unit and the resultId', () => {
    const s = single([
      point({ resultId: 'a', periodCode: '2022JJ00', periodLabel: '2022', value: 1234.5, formattedValue: '1.234,5' }),
      point({ resultId: 'b', periodCode: '2023JJ00', periodLabel: '2023', value: 1300, formattedValue: '1.300,0' }),
    ]);
    expect(headlineFigure(s)).toEqual({ value: '1.300,0', provisional: false, periodLabel: '2023', unit: 'x 1 000', resultId: 'b' });
  });
  it('skips a trailing null (an honest gap) and takes the last point that is actually plotted', () => {
    const s = single([
      point({ resultId: 'a', periodLabel: '2022', value: 1, formattedValue: '1,0' }),
      point({ resultId: 'b', periodLabel: '2023', value: null, formattedValue: null, valueAttribute: 'Geheim' }),
    ]);
    expect(headlineFigure(s)?.resultId).toBe('a');
  });
  it('carries the provisional flag through (the renderer adds the same * suffix every other label uses)', () => {
    const s = single([point({ resultId: 'p', value: 5, formattedValue: '5,0', provisional: true, status: 'Voorlopig' })]);
    expect(headlineFigure(s)?.provisional).toBe(true);
  });
  it('is null for a multi-series chart, a comparison (bar kind), an empty series and an all-null series', () => {
    const two = { ...single([point()]), series: [single([point()]).series[0]!, { label: 'Utrecht', regionCode: 'GM0344', points: [point({ resultId: 'u' })] }] };
    expect(headlineFigure(two)).toBeNull();
    expect(headlineFigure({ ...single([point()]), kind: 'bar' })).toBeNull();
    expect(headlineFigure(single([]))).toBeNull();
    expect(headlineFigure(single([point({ value: null, formattedValue: null, valueAttribute: 'Geheim' })]))).toBeNull();
  });
  it('never formats: the value is the exact formattedValue string, whatever the numeric value is', () => {
    const s = single([point({ value: 17590672, formattedValue: '17.590.672' })]);
    expect(headlineFigure(s)?.value).toBe('17.590.672');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd web && npx vitest run lib/chart-headline.test.ts`
Expected: FAIL — module `./chart-headline.ts` not found.

- [ ] **Step 3: Implement** — `web/lib/chart-headline.ts`:

```ts
// Chart-card polish (2026-09-15): the headline figure — the one large number
// the chart card leads with. Pure, no React, no Recharts. This is a
// SELECTION over the spec, never a computation (R6): the last PLOTTED point
// of a single time series, exactly the rule `valueLabelPlan`'s end-of-line
// label already applies (chart.tsx). The value is the point's own
// `formattedValue`, verbatim, and the caller binds it to `resultId` via
// data-label-for like every other visible number (R1). Called with the
// DISPLAYED spec (zoomed + translated), so under a Vanaf/Tot window the
// figure is the window's own last point, labelled with its own period —
// honest by disclosure, like the end label.
//
// Deliberately null for: several series (no single subject to lead with),
// a comparison (bar kind — "the highest region" would be a selection over
// values of the kind open-questions #221 records as an assumption; not
// taken here), an empty or all-null series. A "net change since X" figure
// is NOT possible from a ChartSpec (it carries no derivation records) and
// must never be computed here — recorded as a follow-up in open-questions.
import type { ChartSpec } from '../backend/chart/types.ts';

export interface HeadlineFigure {
  /** The point's own formattedValue, verbatim — never reformatted (R6). */
  value: string;
  provisional: boolean;
  periodLabel: string;
  unit: string;
  /** R1 traceability handle — rendered as data-label-for. */
  resultId: string;
}

export function headlineFigure(spec: Pick<ChartSpec, 'kind' | 'series' | 'unit'>): HeadlineFigure | null {
  if (spec.kind !== 'line' || spec.series.length !== 1) return null;
  const points = spec.series[0]!.points;
  // Spec order is period-ascending (R6: the spec's order IS the render
  // order), so the last plotted point is the last non-null one.
  for (let i = points.length - 1; i >= 0; i--) {
    const p = points[i]!;
    if (p.value !== null && p.formattedValue !== null) {
      return { value: p.formattedValue, provisional: p.provisional, periodLabel: p.periodLabel, unit: spec.unit, resultId: p.resultId };
    }
  }
  return null;
}
```

- [ ] **Step 4: Run the test** — `cd web && npx vitest run lib/chart-headline.test.ts` → PASS.

- [ ] **Step 5: Typecheck** — `cd web && npx tsc --noEmit` → no errors.

- [ ] **Step 6: Commit**

```bash
git add web/lib/chart-headline.ts web/lib/chart-headline.test.ts
git commit -m "feat(chart): headlineFigure — the last plotted point of a single time series, a pure selection (chart-card polish)" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Render the headline figure above the chart; the trend sentence moves under it

**Files:**
- Modify: `web/components/chart.tsx` (imports; the derived-values block near `const plan = valueLabelPlan(…)` `:1844`; the render between the header row and the control row; the trend-headline block `:3205-3209`)
- Modify: `web/lib/i18n/messages.ts` (`nl` table after `'chart.keyboardHint'` ~`:371`; `en` table after its `'chart.keyboardHint'` ~`:1085`)
- Test: `web/components/chart.test.tsx`; run `web/components/gallery.test.tsx`, `web/app/embed/[token]/page.test.tsx`, `web/components/chart-story-stage.test.tsx`

**Interfaces:**
- Consumes (Task 3): `headlineFigure`, `HeadlineFigure`. Consumes (Task 2): `data-slot="chart-controls"` as the position anchor in tests.
- Produces: catalogue key `chart.headline.label` (nl `Laatste waarde in de grafiek`, en `Latest value on the chart`); DOM landmark `data-testid="headline-figure"`.

- [ ] **Step 1: Write the failing tests** — `chart.test.tsx`, a new describe directly after the Task-2 describe:

```ts
describe('chart-card polish (2026-09-15) — the headline figure', () => {
  it('leads with the last plotted value of a single time series, bound to its resultId, unit and period beside it, above the control row', () => {
    const { container } = render(<ChartView spec={fourYearLineSpec()} />);
    const figure = container.querySelector('[data-testid="headline-figure"]') as HTMLElement;
    const bound = figure.querySelector('[data-label-for="nl-2021"]') as HTMLElement;
    expect(bound.textContent).toBe('115');
    expect(figure.textContent).toContain('%');
    expect(figure.textContent).toContain('2021');
    expect(figure.textContent).toContain('Laatste waarde in de grafiek');
    const controls = container.querySelector('[data-slot="chart-controls"]') as HTMLElement;
    expect(figure.compareDocumentPosition(controls) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Outside the export container by construction (R6: never a new number in the file).
    expect(container.querySelector('[role="tabpanel"]')).not.toContainElement(figure);
  });
  it('follows the Vanaf/Tot window: the window\'s own last point, labelled with its own period', () => {
    const { container } = render(<ChartView spec={fourYearLineSpec()} />);
    fireEvent.change(screen.getByLabelText('Tot'), { target: { value: '2020' } });
    const figure = container.querySelector('[data-testid="headline-figure"]') as HTMLElement;
    expect(figure.querySelector('[data-label-for="nl-2020"]')?.textContent).toBe('110');
    expect(figure.querySelector('[data-label-for="nl-2021"]')).toBeNull();
  });
  it('a provisional latest value carries the * suffix, and a trailing null is skipped', () => {
    const s = spec({
      series: [{
        label: 'Nederland', regionCode: null,
        points: [
          point({ resultId: 'a', periodCode: '2023JJ00', periodLabel: '2023', value: 1, formattedValue: '1,0' }),
          point({ resultId: 'b', periodCode: '2024JJ00', periodLabel: '2024', value: 2, formattedValue: '2,0', provisional: true, status: 'Voorlopig' }),
          point({ resultId: 'c', periodCode: '2025JJ00', periodLabel: '2025', value: null, formattedValue: null, valueAttribute: 'Geheim' }),
        ],
      }],
      provisionalNote: 'Voorlopige cijfers zijn gemarkeerd met *.',
      nullNotes: ['2025: geheim.'],
    });
    const { container } = render(<ChartView spec={s} />);
    expect(container.querySelector('[data-testid="headline-figure"] [data-label-for="b"]')?.textContent).toBe('2,0*');
    scanForUnboundDigits(container, harvestSpecStrings(s));
  });
  it('no headline for a multi-series chart, a comparison, the Tabel form, or stage mode', () => {
    expect(render(<ChartView spec={twoSeriesFourYearLineSpec()} />).container.querySelector('[data-testid="headline-figure"]')).toBeNull();
    cleanup();
    expect(render(<ChartView spec={multiRegionBarSpec()} />).container.querySelector('[data-testid="headline-figure"]')).toBeNull();
    cleanup();
    const { container } = render(<ChartView spec={fourYearLineSpec()} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Tabel' }));
    expect(container.querySelector('[data-testid="headline-figure"]')).toBeNull();
    cleanup();
    expect(render(<ChartView spec={fourYearLineSpec()} stage={{ step: null, overrides: {} }} />).container.querySelector('[data-testid="headline-figure"]')).toBeNull();
  });
  it('the trend headline sentence sits directly under the figure (above the chart) and is still suppressed under a zoom', () => {
    const { container } = render(<ChartView spec={trendHeadlineLineSpec()} />);
    const figure = container.querySelector('[data-testid="headline-figure"]') as HTMLElement;
    const sentence = screen.getByTestId('trend-headline');
    expect(figure.nextElementSibling).toBe(sentence);
    const panel = container.querySelector('[role="tabpanel"]') as HTMLElement;
    expect(sentence.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Vanaf'), { target: { value: '2019' } });
    expect(screen.queryByTestId('trend-headline')).toBeNull();
    expect(container.querySelector('[data-testid="headline-figure"]')).not.toBeNull();
  });
  it('shows in embed mode (the honest card stands alone there) and the whole-card digit scan passes in both languages', () => {
    const s = fourYearLineSpec();
    const nl = render(<ChartView spec={s} embedMode embedFooter="x" />).container;
    expect(nl.querySelector('[data-testid="headline-figure"]')).not.toBeNull();
    scanForUnboundDigits(nl, harvestSpecStrings(s));
    cleanup();
    const en = render(<LangProvider initial="en"><ChartView spec={s} /></LangProvider>).container;
    expect(en.textContent).toContain('Latest value on the chart');
    scanForUnboundDigits(en, harvestSpecStrings(s));
  });
});
```

  (`twoSeriesFourYearLineSpec` `:1635`, `multiRegionBarSpec` and `trendHeadlineLineSpec` `:1623` are existing fixtures. The `embedFooter="x"` carries no digit; if a later fixture footer does, add it to the scan list the way the embed page test does at `page.test.tsx:390`.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd web && npx vitest run components/chart.test.tsx -t "headline figure"`
Expected: FAIL — no `[data-testid="headline-figure"]`; the trend headline's previous sibling is not the figure.

- [ ] **Step 3: Implement**

  1. `messages.ts` — `nl` table, after `'chart.keyboardHint': …`:
  ```ts
  // Chart-card polish (2026-09-15): the screen-reader prefix for the large
  // headline figure above the chart (the figure itself is a spec string).
  'chart.headline.label': 'Laatste waarde in de grafiek',
  ```
  `en` table, after its `'chart.keyboardHint': …`: `'chart.headline.label': 'Latest value on the chart',`.

  2. `chart.tsx` — import `headlineFigure` from `'../lib/chart-headline.ts'`. Directly after `const plan = valueLabelPlan({ ...displaySpec, kind: effectiveKind });` (`:1844`) add:
  ```ts
  // Chart-card polish (2026-09-15): the headline figure — the DISPLAYED
  // spec's last plotted point (single time series only; see
  // chart-headline.ts). Read from `displaySpec`, like the end label, so a
  // Vanaf/Tot window leads with its own last point and an English chart
  // shows the translated period/unit; the value/resultId fields are
  // untouched by translation (translateSpecForDisplay).
  const headline = headlineFigure(displaySpec);
  ```
  3. In the JSX, directly AFTER the header row from Task 2 (the closing `</div>` of `flex items-start justify-between`) and BEFORE the control row, insert:
  ```tsx
      {/* Chart-card polish (2026-09-15): the number leads, the chart is the
        * evidence. Outside the export container (chartContainerRef) by
        * construction — never in a PNG/SVG. Every token is a spec string
        * already covered by the whole-card digit scan (formattedValue,
        * unit, periodLabel); the value is bound to its cell via
        * data-label-for (R1). Not in the table form (it shows everything),
        * not in stage mode (ADR 044: the caption IS the sentence). */}
      {headline !== null && !inStage && state.form !== 'table' ? (
        <p className="mt-3 flex flex-wrap items-baseline gap-x-2" data-testid="headline-figure">
          <span className="sr-only">{t(chartLang, 'chart.headline.label')}</span>
          <span className="text-3xl font-semibold leading-none tracking-tight text-foreground tabular-nums" data-label-for={headline.resultId}>
            {headline.value}
            {headline.provisional ? '*' : ''}
          </span>
          <span className="text-sm text-muted-foreground">
            {headline.unit} · {headline.periodLabel}
          </span>
        </p>
      ) : null}
      {/* #197 idea 4: the deterministic trend sentence, moved up under the
        * figure (chart-card polish, 2026-09-15) — number in a sentence, the
        * chart as evidence below. Gating unchanged: never in the stage
        * (fix round 2, item 9 — the stage's caption is the sentence), never
        * in the table, never under a zoom (it describes the full range). */}
      {!inStage && state.form !== 'table' && !state.periodRange && spec.attribution.trendHeadline !== undefined ? (
        <p data-testid="trend-headline" className="mt-1 text-sm text-foreground">
          {spec.attribution.trendHeadline}
        </p>
      ) : null}
  ```
  and DELETE the old trend-headline block at `:3200-3209` (it must render in exactly one place).

- [ ] **Step 4: Run the tests**

Run: `cd web && npx vitest run components/chart.test.tsx components/gallery.test.tsx "app/embed/[token]/page.test.tsx" components/chart-story-stage.test.tsx components/chart-story.test.tsx`
Expected: PASS. The gallery's digit scan (`gallery.test.tsx:133-145`) and the embed page's (`page.test.tsx:390`) both harvest `unit`, `formattedValue` and `periodLabel`, so the figure's digits are covered; if either fails, the ONLY permitted fix is adding a spec field (never a literal) to that test's harvest list — and say so in the commit message.

- [ ] **Step 5: Typecheck both** — `cd web && npx tsc --noEmit` and, from the repo root, `npx tsc --noEmit` → no errors.

- [ ] **Step 6: Commit**

```bash
git add web/components/chart.tsx web/components/chart.test.tsx web/lib/i18n/messages.ts
git commit -m "feat(chart): headline figure above the chart, trend sentence under it — spec strings bound to their cells (chart-card polish)" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5 (OWNER-GATED — do not start without an explicit yes): frame padding as the default

**Why gated:** this is the one change that moves a `STOCK_PRESENTATION` literal (ADR 042's deep-equal pin), the `standard` template's derived overrides (ADR 043 decision 2), every export's canvas (the frame padding is exported, `chart-download.tsx`), and what a saved account default fills in. It is the "template vs. baseline default" question in its sharpest form. The main session must put it to the owner with the Task-1-4 before/after screenshots in hand; if the plot flush against the rounded, shadowed frame edge already reads fine after Task 1's wider card padding, skip this task entirely.

**Files:**
- Modify: `web/lib/chart-presentation.ts:136` (`framePadding: 'none'` → `'small'` in `STOCK_PRESENTATION` only; `CLASSIC_PRESENTATION` untouched — resolver-inert, per `b86556f`)
- Test: `web/lib/chart-presentation.test.ts:81-100` (the STOCK deep-equal pin), `web/lib/chart-templates.test.ts` (any pin that lists `standard`'s literal overrides — grep `framePadding`), `web/components/chart-config-panel.test.tsx`, `web/components/chart-frame.test.tsx`, `web/components/chart-download.test.tsx` (run; their "bare frame" fixtures were already decoupled from STOCK in `b86556f`)

- [ ] **Step 1: Update the pin first (this is a deliberate default change, the ADR 042 precedent):** in `chart-presentation.test.ts:94` change `framePadding: 'none'` to `framePadding: 'small'` inside the STOCK expectation and rename the test to `'STOCK_PRESENTATION is the designed default: ends markers, horizontal grid, no axis lines, gradient area fill, rounded soft-shadow frame with small padding'`. Grep `web/` for `framePadding: 'none'` in test files and update ONLY the pins that literally encode the stock default (a fixture that tests `isFramePristine`'s bare state stays `'none'` — that is the mechanism, not the default).
- [ ] **Step 2: Run** `cd web && npx vitest run lib/chart-presentation.test.ts lib/chart-templates.test.ts` → the STOCK pin FAILS.
- [ ] **Step 3: Implement** — `chart-presentation.ts:136`: `framePadding: 'small',` with the comment on the constant extended: `// 2026-09-15 (chart-card polish, owner-confirmed): small frame padding so the plot no longer sits flush against the rounded, shadowed frame edge b86556f introduced.`
- [ ] **Step 4: Run** `cd web && npx vitest run` (the whole web suite — a padding default touches ChartFrame's `naturalHeight`, the export canvas and the templates' contrast gate) → PASS after the Step-1 pins.
- [ ] **Step 5: Typecheck** — `cd web && npx tsc --noEmit`.
- [ ] **Step 6: Commit** — `git commit -m "feat(chart): small frame padding as the designed default (owner-confirmed, chart-card polish)" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"`.

---

## Verification block (run in full after Task 4, and again after Task 5 if it runs; quote every result line in the final report)

1. Typechecks: `npx tsc --noEmit` (root) and `cd web && npx tsc --noEmit`.
2. **Honesty locks, named and re-run** (nothing here was edited — that is the point; they must be GREEN, not assumed):
   - `cd web && npx vitest run lib/chart-presentation.test.ts -t "judgeColor|DEFAULT palette|CLASSIC palette|refuses near-white|warns per theme|markerVisible|gradient preset"` — ADR 039's colour refusal/warning thresholds, the R11 "a provisional point is ALWAYS visible" pin, the preset × palette gate.
   - `cd web && npx vitest run components/chart.test.tsx -t "provisional|hollow|hatch|R11|membership|binding|digit|scan"` — the hollow marker, the hatched bar, `data-label-for` binding, every whole-card digit scan (line, bar, area, hbar, panel open on every tab, nl + en).
   - `cd web && npx vitest run components/chart-small-multiples.test.tsx components/chart-download.test.tsx components/chart-frame.test.tsx lib/chart-templates.test.ts` — small multiples' own R11 marker, the export's active-dot/cursor guard, the frame, the template contrast gate.
3. Full web suite: `cd web && npx vitest run` (session 103's baseline: 105 files / 1736 tests — expect the same files + the new `chart-headline.test.ts`, more tests, zero failures).
4. Backend suite (untouched by this plan — run anyway, it is the gate): `npx vitest run` from the root.
5. **Benchmark gate:** `npm run benchmark:run && npm run benchmark:score` — expect the scorer's GATE PASS line with 14/14 answered, 6/6 refusals, 0 fabricated numbers; copy that exact line into the final report and the merge commit / PR body. Nothing in `src/` changed, so any deviation is an environment problem to investigate, never to skip.
6. Real build: `cd web && npx next build` → clean; then `git checkout -- web/CLAUDE.md` (Next 16 rewrites it).
7. Docs test: `npm run test:docs` (no PR links in any doc you touched).
8. `/code-review` at LOW effort over the branch diff; fix or consciously dispatch every confirmed finding before pushing.

## Real-browser before/after (required — jsdom has no layout engine; the session-101 lesson)

Take the BEFORE set from untouched `main` first (`git stash` or a second worktree — the RUNBOOK's hard-linked `node_modules` recipe for worktrees), then the AFTER set from the branch, same URLs, same widths.

1. Start the hermetic harness (RUNBOOK "How it works"): `node scripts/dev-harness/auth-stub.mjs & node scripts/dev-harness/llm-stub.mjs &`, then from `web/`: `source ../scripts/dev-harness/env.sh && npx next dev -p 3102`.
2. **Chat card (framed, single series, with trend headline):** `node scripts/dev-harness/ask.mjs` with benchmark task B4's question (`benchmark/tasks.json` — "B4 gives an answer WITH a chart") at 1280 px and 375 px; the harness prints `scrollWidth` — at 375 px it must equal the viewport width (no horizontal overflow from the wider padding or the single control row).
3. **Frameless surfaces:** the logged-out homepage / `/galerij` cards (`scripts/dev-harness/shot.mjs`) at both widths — a multi-series card (no headline, legend chips) and a single-series card (headline on).
4. **Dark theme:** repeat 2-3 with Playwright `page.emulateMedia({ colorScheme: 'dark' })` (the app follows the system theme unless the account menu toggle was used) — check the underline tab, the half-opacity grid hairline and the headline figure all read on the dark card.
5. **Keyboard pass, once, at 1280 px:** Tab from the card title — the order must be Inzichten → Opmaak → the active Weergave tab → Vanaf → Tot → the chart's first point. Press Enter on Opmaak: the modal opens; Escape: focus returns to the icon button (unchanged mechanism, `chart.tsx` `onClose`).
6. **Touch check at 375 px:** the icon-only Opmaak button measures ≥ 44 px (`max-sm:size-11`); the tabs measure ≥ 44 px (R9.1).
7. Save the shots to the session scratchpad and show the before/after pairs in chat (owner-present) or attach them to the PR (autonomous). Do not commit binaries.

## After the tasks (controller)

1. Whole-branch review (top tier) against docs/05 R1/R6/R11 and this plan's Global Constraints — specifically: no control lost its name/id/gate; the headline never enters the export container; the grid dash is gone from every grid and present on every event marker; fix round.
2. The full Verification block above + the real-browser pass.
3. **Docs, same change:** ADR 042 addendum "2026-09-15 — chart-card polish, as built" (the quiet control row + header actions; the headline figure and its selection rule; the solid half-opacity grid hairline; the `p-5 sm:p-6` card; AND the correction that since `b86556f` the stock frame is `rounded` + `soft`, not `square`/`none` as decisions 2 and the consequences text still say); `docs/12-huisstijl.md` §Charts (grid hairline, headline figure, padding) and §"Answer card and chart panel layout" (Inzichten/Opmaak are header actions now, not "row-mates of the Weergave tabs"); `docs/08-build-plan.md` WP197 idea 4 line (the number half of "Wat zie ik hier?" is built as the headline figure); `docs/open-questions.md` — one new row (take the next free number, ≥ #250 — grep first) recording: (a) the headline figure duplicates the chat answer's own prose number on the inline chat card — keep (consistency across dock/gallery/embed) or add a `headline={false}` at the chat mount only, owner call; (b) a "net change since X" headline needs a spec field (v2) — never client-side; (c) Task 5's `framePadding` default — owner decision; (d) the dock stays `p-4`; (e) Opmaak icon-only vs. text — owner-reviewable; STATUS.md top block + status-archive entry + lessons-learned (measured numbers only).
4. Owner-present: show the before/after pairs, then merge `chart-card-polish` into `main` (fast-forward or merge commit) and push; CI green is the done signal. Autonomous: open a PR with the screenshots and the benchmark gate line in the body; do not merge.

## Which existing tests change, and why — the complete list

- **Tasks 1-4: NO existing assertion is edited.** `chart-presentation.test.ts` (STOCK pin, palette pins, judgeColor, markerVisible, chartHeightForWidth), `chart-frame.test.tsx`, `chart-download.test.tsx`, `chart-templates.test.ts`, `chart-edit-modal.test.tsx`, `chart-story.test.tsx`, `chart-story-stage.test.tsx`, `gallery.test.tsx`, the embed page test and every backend suite stay byte-identical. In `chart.test.tsx` and `chart-config-panel.test.tsx` only NEW describes are added. Any pre-existing failure = implementation bug.
- **Task 5 only:** the `STOCK_PRESENTATION` deep-equal pin (`chart-presentation.test.ts:81-100`) and any `chart-templates.test.ts` pin that lists `standard`'s literal `framePadding` — updated to the new intended value, stated in the test name (ADR 042's own precedent), never loosened.
- **Why nothing else moves:** every control keeps its role, accessible name, id and gate (Task 2 changes classes, wrapper elements and position); the digit scans only check membership against spec strings, and the headline adds only `formattedValue` / `unit` / `periodLabel` (Task 4); the grid change is attribute-level on elements no pin reads (Task 1 — verified: `grep -n "3 3\|stroke-dasharray" chart.test.tsx` hits only the tooltip-cursor source pin at `:935-944` and the story ring at `:3531`, both untouched).

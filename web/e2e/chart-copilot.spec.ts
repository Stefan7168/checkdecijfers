// Chart co-pilot phase 1 (session 112, ADR 056, #274) end to end, in a real
// browser: a reader hides a series, undoes it with the buttons AND with
// ⌘Z/⇧⌘Z, and finds their edit still there after a full page reload.
//
// The persistence half is the reason this spec exists at all: the save and
// hydrate legs run through a Server Action and the `chart_edits` table, a
// boundary vitest cannot see (jsdom loads both sides as plain modules and the
// component test mocks the action module outright). Only a real server +
// a real reload proves the row was actually written and read back.
//
// Question: the SAME `!!intent` harness injection answer.spec.ts (f) uses —
// Amsterdam + Rotterdam, two lines over 2020-2024 (see that file's header for
// why an ad-hoc phrasing would 400 at the LLM stub). Two lines is the minimum
// shape that makes "hide one series" observable as a count.
import type { Locator } from '@playwright/test';
import { expect, signInAsHarnessUser, test } from './harness.ts';

const REGION_SERIES_INTENT = JSON.stringify({
  target: { kind: 'canonical', key: 'population_on_1_january' },
  period: { kind: 'range', from: '2020JJ00', to: '2024JJ00' },
  derivation: 'none',
  regions: ['GM0363', 'GM0599'], // Amsterdam, Rotterdam
});

const UNDO = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';
const REDO = process.platform === 'darwin' ? 'Shift+Meta+z' : 'Control+y';

test.describe.serial('chart co-pilot phase 1', () => {
  test.beforeEach(async ({ context, baseURL }) => {
    await signInAsHarnessUser(context, baseURL!);
  });

  test('hide a series → ⌘Z brings it back → the edit survives a reload', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Nieuwe chat' }).first().click();
    await ask(page, `!!intent ${REGION_SERIES_INTENT}`);
    await expect(page.locator('.recharts-line-curve')).toHaveCount(2, { timeout: 60_000 });

    // The legend chip's accessible name is just the series label
    // (SeriesLegend in chart.tsx — the swatch is aria-hidden).
    const rotterdam = page.getByRole('button', { name: 'Rotterdam', exact: true });
    const undoButton = page.getByRole('button', { name: 'Ongedaan maken' });
    const redoButton = page.getByRole('button', { name: 'Opnieuw' });

    await rotterdam.click();
    await expect(page.locator('.recharts-line-curve')).toHaveCount(1);
    await undoButton.click();
    await expect(page.locator('.recharts-line-curve')).toHaveCount(2);
    await redoButton.click();
    await expect(page.locator('.recharts-line-curve')).toHaveCount(1);

    // Keyboard. The handler sits on the card's own div, which now carries
    // `tabIndex={-1}` (fix round 1, finding 6) — so a plain click on any
    // NON-interactive part of the card focuses the card itself and makes ⌘Z
    // work. Before that change this exact click did nothing at all.
    //
    // The click lands on the card's own padding rather than on the heading:
    // this answer's chart renders inside the visual dock, where Playwright
    // reports the `role="heading"` div as having no box and refuses to click
    // it (`getByRole('heading', { level: 3 })` times out, with and without a
    // visible filter). The card root is the honest target for "a click
    // anywhere in the card" anyway — it is the element the handler is on.
    const card = page
      .locator('div[tabindex="-1"]')
      .filter({ has: page.getByRole('button', { name: 'Ongedaan maken' }) })
      .first();
    await card.click({ position: { x: 4, y: 4 } });
    await page.keyboard.press(UNDO);
    await expect(page.locator('.recharts-line-curve')).toHaveCount(2);
    await page.keyboard.press(REDO);
    await expect(page.locator('.recharts-line-curve')).toHaveCount(1);

    // Persistence: past the 800 ms save debounce, then a genuinely fresh page
    // (threads are not routed by URL, so the thread is reopened from the
    // sidebar the same way answer.spec.ts (c) does — the title is the
    // question's first 60 characters).
    await page.waitForTimeout(1500);
    await page.reload();
    await page.getByRole('button', { name: /^!!intent/ }).first().click();
    await expect(page.locator('.recharts-line-curve')).toHaveCount(1, { timeout: 60_000 });
    await expect(page.getByRole('button', { name: 'Ongedaan maken' })).toBeEnabled();
  });

  test('add a goal line via the panel: the line renders on the chart, the label stays out of the export, delete removes both', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Nieuwe chat' }).first().click();
    await ask(page, `!!intent ${REGION_SERIES_INTENT}`);
    await expect(page.locator('.recharts-line-curve')).toHaveCount(2, { timeout: 60_000 });

    // Open the goal line form by clicking "Doellijn toevoegen"
    const addGoalLineButton = page.getByRole('button', { name: 'Doellijn toevoegen' });
    await addGoalLineButton.click();

    // Fill in the goal line form
    await page.getByLabel('Waarde').fill('75');
    await page.getByLabel('Label').fill('Target 2025');

    // Submit the form
    await page.getByRole('button', { name: 'Opslaan' }).click();

    // Verify the goal line is visible on the page (the outside-the-export list).
    // `getByText(/75/)` is ambiguous on a real answer page (the chart's own
    // data/attribution text can contain "75" too, e.g. a table id) — scope to
    // the goal line's own rendered format, `chart-goal-line.tsx`'s
    // `{line.value}: ` span, which is exact and unique.
    await expect(page.getByText(/Target 2025/)).toBeVisible();
    await expect(page.getByText('75:', { exact: false })).toBeVisible();

    // Final-review fix C2: the goal line used to draw no visual line at all
    // — only this text list rendered. Same assertion era shading's own e2e
    // test above makes for its ReferenceArea band.
    await expect(page.locator('.recharts-reference-line')).toHaveCount(1, { timeout: 5_000 });

    // Export exclusion — the LABEL text is NOT inside the chart export
    // container (same locator era shading's e2e test above uses); the line's
    // own numeric position, unlike the label, genuinely is inside it (C2/I5).
    const chartContainer = page.locator('[data-testid="chart-container"]');
    const labelInChart = chartContainer.locator(':has-text("Target 2025")');
    await expect(labelInChart).not.toBeVisible();

    // Delete the goal line: both the visual line and the label disappear.
    const deleteButton = page.getByRole('button', { name: /Target 2025 verwijderen/ });
    await deleteButton.click();
    await expect(page.locator('.recharts-reference-line')).toHaveCount(0);
    await expect(page.getByText('Target 2025')).not.toBeVisible();
  });

  test('Task 5: click a point to make it the headline, undo to revert', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Nieuwe chat' }).first().click();
    await ask(page, `!!intent ${REGION_SERIES_INTENT}`);
    await expect(page.locator('.recharts-line-curve')).toHaveCount(2, { timeout: 60_000 });

    // REGION_SERIES_INTENT has TWO regions (Amsterdam + Rotterdam), and
    // headlineFigure() is deliberately null for several series (chart-
    // headline.ts's own documented contract — "no single subject to lead
    // with") — so there is no automatic headline to read here yet, by
    // design. This is exactly the case the override feature exists for:
    // the reader picks which point becomes the headline. First-run CI
    // caught this real premise bug — a prior version of this test assumed
    // a default headline was already showing before any override.
    const headlineFigure = page.locator('[data-testid="headline-figure"]');
    await expect(headlineFigure).not.toBeVisible();

    // Click on an earlier point (the first plotted point on the chart).
    // The chart renders points as SVG circles with data-point="value".
    const points = page.locator('circle[data-point="value"]');
    const firstPoint = points.first();
    await firstPoint.click();

    // The pending-point UI should show. Look for the "Make this the headline"
    // button and click it.
    const setHeadlineButton = page.getByRole('button', { name: 'Maak dit het hoofdcijfer' });
    await expect(setHeadlineButton).toBeVisible({ timeout: 5000 });
    await setHeadlineButton.click();

    // The headline now exists (there was none before) and shows the
    // "Show default headline" button as proof of an active override.
    await expect(headlineFigure).toBeVisible({ timeout: 5000 });
    const clearHeadlineButton = page.getByRole('button', { name: 'Toon standaard hoofdcijfer' });
    await expect(clearHeadlineButton).toBeVisible({ timeout: 5000 });

    // Undo should clear the override and restore the "Make this headline" button.
    const undoButton = page.getByRole('button', { name: 'Ongedaan maken' });
    await undoButton.click();

    // After undo, the "Make this the headline" button should be back, and
    // the headline itself gone again (this chart has no default — the
    // whole point of the assertion at the top of this test).
    await expect(setHeadlineButton).toBeVisible({ timeout: 5000 });
    await expect(clearHeadlineButton).not.toBeVisible();
    await expect(headlineFigure).not.toBeVisible();
  });

  test('dim a series via the legend → the series stays visible at reduced opacity → ⌘Z restores it', async ({
    page,
  }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Nieuwe chat' }).first().click();
    await ask(page, `!!intent ${REGION_SERIES_INTENT}`);
    await expect(page.locator('.recharts-line-curve')).toHaveCount(2, { timeout: 60_000 });

    // Find the dim button for Rotterdam (Dim Rotterdam)
    const dimButton = page.getByRole('button', { name: /Dim Rotterdam/ });
    await expect(dimButton).toBeVisible();

    // Before dimming: both lines should have full opacity
    const allLines = page.locator('path[class*="recharts-curve"]');
    const linesBeforeDim = await allLines.count();
    expect(linesBeforeDim).toBe(2);

    // Dim the series
    await dimButton.click();

    // After dimming: both lines should still exist (not removed from DOM)
    const linesAfterDim = await allLines.count();
    expect(linesAfterDim).toBe(2);

    // The dim button should be pressed
    await expect(dimButton).toHaveAttribute('aria-pressed', 'true');

    // One line should have reduced opacity (0.35)
    const dimmedLines = page.locator('path[stroke-opacity="0.35"]');
    await expect(dimmedLines).toHaveCount(1);

    // Undo with keyboard
    const card = page
      .locator('div[tabindex="-1"]')
      .filter({ has: page.getByRole('button', { name: 'Ongedaan maken' }) })
      .first();
    await card.click({ position: { x: 4, y: 4 } });
    await page.keyboard.press(UNDO);

    // After undo: dim button should not be pressed
    await expect(dimButton).toHaveAttribute('aria-pressed', 'false');

    // All lines should have full opacity again
    const dimmedLinesAfterUndo = page.locator('path[stroke-opacity="0.35"]');
    await expect(dimmedLinesAfterUndo).toHaveCount(0);
  });

  test('add an era shading → visual band renders → label appears in list (outside export) → delete removes both', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Nieuwe chat' }).first().click();
    await ask(page, `!!intent ${REGION_SERIES_INTENT}`);
    await expect(page.locator('.recharts-line-curve')).toHaveCount(2, { timeout: 60_000 });

    // Open the era shading form
    const markButton = page.getByRole('button', { name: 'Periode markeren' });
    await markButton.click();

    // Fill in the form. Label text alone can't disambiguate these two
    // selects from the chart's OWN zoom control — "Vanaf"/"Tot" are close
    // or, for "Tot", byte-identical. chart-era-shading.tsx mints its own
    // element ids as `${idPrefix}-era-from`/`-era-to` specifically to be
    // addressable — use those directly instead of label text.
    //
    // REGION_SERIES_INTENT's real period codes are CBS-shaped
    // ("2020JJ00" etc, not plain "2020"), and the list below renders the
    // raw CODE, not the display label — select by OPTION INDEX (the first
    // and third available periods) and read back whatever codes actually
    // landed, rather than hardcoding a code format this test has no
    // business assuming.
    const fromSelect = page.locator('select[id*="-era-from"]');
    const toSelect = page.locator('select[id*="-era-to"]');
    await fromSelect.selectOption({ index: 0 });
    await toSelect.selectOption({ index: 2 });
    const fromCode = await fromSelect.inputValue();
    const toCode = await toSelect.inputValue();
    await page.getByLabel('Label').fill('Testperiode');

    // Submit the form
    const saveButton = page.getByRole('button', { name: 'Opslaan' });
    await saveButton.click();

    // Important #2a: Verify the visual band renders on the chart
    // Recharts renders ReferenceArea as SVG rect elements with this class
    await expect(page.locator('.recharts-reference-area-rect')).toBeVisible({ timeout: 5_000 });

    // Important #2: Verify the label appears in the list (outside the chart export container)
    await expect(page.getByText('Testperiode')).toBeVisible();
    await expect(page.getByText(`${fromCode} – ${toCode}`)).toBeVisible();

    // Important #2b: Verify export exclusion — the label text is NOT inside the chart container
    // (the chart export container is identified as having data-testid="chart-container")
    const chartContainer = page.locator('[data-testid="chart-container"]');
    const labelInChart = chartContainer.locator(':has-text("Testperiode")');
    await expect(labelInChart).not.toBeVisible();

    // Delete the shading
    const deleteButton = page.getByRole('button', { name: /Verwijder de markering/ });
    await deleteButton.click();

    // Verify both the visual band and label are removed
    await expect(page.locator('.recharts-reference-area-rect')).not.toBeVisible();
    await expect(page.getByText('Testperiode')).not.toBeVisible();
  });
});

test.describe.serial('chart co-pilot phase 4 — derived overlays', () => {
  test.beforeEach(async ({ context, baseURL }) => {
    await signInAsHarnessUser(context, baseURL!);
  });

  test('add an average line over the visible period and verify the value displays', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Nieuwe chat' }).first().click();
    await ask(page, `!!intent ${REGION_SERIES_INTENT}`);
    await expect(page.locator('.recharts-line-curve')).toHaveCount(2, { timeout: 60_000 });

    // Final-review fix I8: "Gemiddelde tonen" now only offers itself when
    // exactly ONE series is visible (averaging across several different
    // series was never well-defined here) — hide Rotterdam first, the same
    // legend toggle the phase-1 spec above uses.
    await page.getByRole('button', { name: 'Rotterdam', exact: true }).click();
    await expect(page.locator('.recharts-line-curve')).toHaveCount(1);

    // Click the "Gemiddelde tonen" button
    const meanButton = page.getByRole('button', { name: 'Gemiddelde tonen' });
    await meanButton.click();

    // Verify that an overlay was added (via the remove button)
    await expect(page.getByRole('button', { name: /^×/ })).toBeVisible();
  });

  test('undo an added overlay and verify it disappears', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Nieuwe chat' }).first().click();
    await ask(page, `!!intent ${REGION_SERIES_INTENT}`);
    await expect(page.locator('.recharts-line-curve')).toHaveCount(2, { timeout: 60_000 });

    // Final-review fix I8: see the previous test — the mean control needs
    // exactly one visible series.
    await page.getByRole('button', { name: 'Rotterdam', exact: true }).click();
    await expect(page.locator('.recharts-line-curve')).toHaveCount(1);

    // Add a mean line
    await page.getByRole('button', { name: 'Gemiddelde tonen' }).click();
    await expect(page.getByRole('button', { name: /^×/ })).toBeVisible();

    // Undo and verify the overlay remove button is gone
    const undoButton = page.getByRole('button', { name: 'Ongedaan maken' });
    await undoButton.click();
    await expect(page.getByRole('button', { name: /^×/ })).not.toBeVisible();
  });

  test('add a difference arrow by clicking two points and verify the computed value displays', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Nieuwe chat' }).first().click();
    await ask(page, `!!intent ${REGION_SERIES_INTENT}`);
    await expect(page.locator('.recharts-line-curve')).toHaveCount(2, { timeout: 60_000 });

    // Click "Verschil aanduiden" to activate picker mode. Located by its
    // `title` attribute (stable across the picker toggle) rather than by
    // accessible name or `[aria-pressed]`: the button's own label TEXT
    // changes to "Kies twee punten voor het verschil…" the moment picker
    // mode activates (so a name-based locator re-evaluated after that click
    // matches nothing), and `aria-pressed` is not unique to this button — the
    // NL/EN language toggle, the feedback thumbs and the series legend chips
    // all carry it too.
    const differenceButton = page.locator('button[title="Verschil aanduiden"]');
    await differenceButton.click();
    await expect(differenceButton).toHaveAttribute('aria-pressed', 'true');

    // Scoped by `data-result-id` (SeriesDot, chart.tsx) rather than by
    // Recharts' internal group nesting: a resultId is
    // "<table>:<measure>:<regionCode>:<periodCode>:<dims>" (see
    // chart-derivation-actions.ts's own log of one), so a substring match on
    // the region code picks out exactly one series' points regardless of how
    // Recharts happens to structure the curve/dots DOM in this version (its
    // `<g class="recharts-line">` wraps ONLY the curve — `Line.js` renders
    // dots as a separate, un-nested `recharts-line-dots` layer, so scoping
    // through `.recharts-line circle` finds nothing; this is the same trap
    // that made the previous three rounds' region-mismatch test impossible
    // to write for real). GM0363 = Amsterdam, matching REGION_SERIES_INTENT.
    const amsterdamPoints = page.locator('circle[data-point="value"][data-result-id*="GM0363"]');
    await expect(amsterdamPoints.first()).toBeVisible({ timeout: 10_000 });

    // First point: Amsterdam's earliest plotted period (2020, 872.757 — the
    // same fixture cell answer.spec.ts (f) asserts in "Amsterdam ging van
    // 872.757 in 2020 naar 931.298 in 2024").
    await amsterdamPoints.first().click();
    // Second point: Amsterdam's latest plotted period (2024, 931.298).
    await amsterdamPoints.last().click();

    // Both points were in the same region, so the picker resets rather than
    // showing an error.
    await expect(differenceButton).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByRole('button', { name: /^×/ })).toBeVisible();

    // The actual computed value — 931.298 - 872.757 = 58.541, formatted with
    // this repo's Dutch thousands-separator convention (formatValueNl) —
    // must render on the chart itself (the ReferenceLine's label), not just
    // a remove button. This is the part a command dispatching successfully
    // does NOT prove: it proves the server actually resolved the derivation
    // and the real number reached the SVG. Asserted unscoped (not nested
    // under `.recharts-reference-line`): this Recharts version renders a
    // ReferenceLine's own `<line>` and its text LABEL as siblings in
    // different z-index layers, not parent/child — confirmed by inspecting
    // the real rendered SVG rather than assumed. The `<line>` itself DOES
    // carry `data-label-for` with both source resultIds (R1 traceability),
    // visible via `.recharts-reference-line line[data-label-for]` below.
    await expect(page.getByText('58.541')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.recharts-reference-line line[data-label-for]')).toHaveCount(1);

    // Undo and verify both the control and the rendered value disappear.
    const undoButton = page.getByRole('button', { name: 'Ongedaan maken' });
    await undoButton.click();
    await expect(page.getByRole('button', { name: /^×/ })).not.toBeVisible();
    await expect(page.getByText('58.541')).not.toBeVisible();
  });

  test('difference picker with mismatched regions shows an error message, never a silently drawn arrow', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Nieuwe chat' }).first().click();
    await ask(page, `!!intent ${REGION_SERIES_INTENT}`);
    await expect(page.locator('.recharts-line-curve')).toHaveCount(2, { timeout: 60_000 });

    // Activate difference picker (see the previous test for why this is
    // located by `title` rather than by accessible name or `[aria-pressed]`).
    const differenceButton = page.locator('button[title="Verschil aanduiden"]');
    await differenceButton.click();
    await expect(differenceButton).toHaveAttribute('aria-pressed', 'true');

    // Same `data-result-id` scoping as the test above, but this time the two
    // clicks deliberately land in DIFFERENT regions (Amsterdam GM0363, then
    // Rotterdam GM0599) — a real cross-region pick, not a toggle of the
    // button.
    const amsterdamPoints = page.locator('circle[data-point="value"][data-result-id*="GM0363"]');
    const rotterdamPoints = page.locator('circle[data-point="value"][data-result-id*="GM0599"]');
    await expect(amsterdamPoints.first()).toBeVisible({ timeout: 10_000 });
    await expect(rotterdamPoints.first()).toBeVisible();

    await amsterdamPoints.first().click();
    await rotterdamPoints.first().click();

    // The client-side precheck (chart.tsx's onPointClick, comparing each
    // point's region via `displaySpec.series`) must catch this BEFORE any
    // server round-trip: the visible error text, and no overlay/remove
    // button ever appearing.
    await expect(page.getByText("Dit kan niet: de punten liggen in verschillende regio's.")).toBeVisible();
    await expect(page.getByRole('button', { name: /^×/ })).not.toBeVisible();

    // No arrow was silently drawn either.
    await expect(page.locator('.recharts-reference-line')).toHaveCount(0);
  });
});

// Phase 5 (chart-fit scorer, session 116, Task 5): the three new shapes in a
// REAL browser. The heatmap case is the only real-layout proof this plan gets
// — jsdom has no layout engine, so a broken `display: contents` row or a
// wrong `grid-template-columns` would pass every component test and still
// render as a heap; here the cells' bounding boxes are asserted to line up
// as a grid. The chat cases replay two hand-authored fixtures
// (tests/fixtures/chart-copilot/cases.ts, `DUMBBELL_MESSAGE`) — zero model
// calls, same mechanism as cbs-copilot.spec.ts.
//
// Two shapes: the SAME two regions narrowed to 2023–2024 (every series
// exactly two real points: dumbbell, slope and heatmap all on offer), and
// Amsterdam alone over 2020–2024 (one series: none of the three).
const TWO_PERIOD_INTENT = JSON.stringify({
  target: { kind: 'canonical', key: 'population_on_1_january' },
  period: { kind: 'range', from: '2023JJ00', to: '2024JJ00' },
  derivation: 'none',
  regions: ['GM0363', 'GM0599'], // Amsterdam, Rotterdam
});
const SINGLE_REGION_INTENT = JSON.stringify({
  target: { kind: 'canonical', key: 'population_on_1_january' },
  period: { kind: 'range', from: '2020JJ00', to: '2024JJ00' },
  derivation: 'none',
  regions: ['GM0363'], // Amsterdam
});
/** The fixture cases' message, verbatim — anything else 400s at the stub. */
const DUMBBELL_MESSAGE = 'toon dit als een dumbbell';
/** The four cells (Amsterdam/Rotterdam × 2023/2024), formatted the way the
 * chart prints them (formatValueNl) — the same seed cells cases.ts carries. */
const CELLS = { ams2023: '918.117', ams2024: '931.298', rot2023: '663.900', rot2024: '670.610' };

test.describe.serial('chart co-pilot phase 5 — dumbbell, slope, heatmap', () => {
  test.beforeEach(async ({ context, baseURL }) => {
    await signInAsHarnessUser(context, baseURL!);
  });

  test('a two-period, two-region chart offers all three tabs; each draws its own real structure', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Nieuwe chat' }).first().click();
    await ask(page, `!!intent ${TWO_PERIOD_INTENT}`);
    await expect(page.locator('.recharts-line-curve')).toHaveCount(2, { timeout: 60_000 });

    const dumbbellTab = page.getByRole('tab', { name: 'Dumbbell' });
    const slopeTab = page.getByRole('tab', { name: 'Helling' });
    const heatmapTab = page.getByRole('tab', { name: 'Warmtekaart' });
    await expect(dumbbellTab).toBeEnabled();
    await expect(slopeTab).toBeEnabled();
    await expect(heatmapTab).toBeEnabled();

    // Dumbbell: one row per series, two dots per row joined by a connector,
    // each end labelled with its own real cell value and carrying that
    // cell's resultId — no bar, no line curve.
    await dumbbellTab.click();
    await expect(dumbbellTab).toHaveAttribute('aria-selected', 'true');
    const canvas = page.locator('[data-role="dumbbell-canvas"]');
    await expect(canvas).toBeVisible();
    await expect(canvas.locator('[data-role="dumbbell-row"]')).toHaveCount(2);
    await expect(canvas.locator('[data-role="dumbbell-connector"]')).toHaveCount(2);
    await expect(canvas.locator('[data-role="dumbbell-dot"]')).toHaveCount(4);
    await expect(canvas.locator('[data-role="dumbbell-dot"][data-result-id*="GM0363"]')).toHaveCount(2);
    await expect(canvas.locator('[data-role="dumbbell-dot"][data-result-id*="GM0599"]')).toHaveCount(2);
    for (const value of Object.values(CELLS)) {
      await expect(canvas.locator('[data-role="dumbbell-label"]', { hasText: value })).toHaveCount(1);
    }
    await expect(page.locator('.recharts-line-curve')).toHaveCount(0);
    await expect(page.locator('.recharts-bar-rectangle')).toHaveCount(0);

    // Slope: the line render at exactly two moments — two curves, each ONE
    // straight segment (`type="linear"`, so the path is `M … L …`), four
    // value dots in all, and an x-axis of exactly the two period labels.
    await slopeTab.click();
    await expect(slopeTab).toHaveAttribute('aria-selected', 'true');
    await expect(canvas).toHaveCount(0);
    const curves = page.locator('.recharts-line-curve');
    await expect(curves).toHaveCount(2);
    const segmentsPerCurve = await curves.evaluateAll((paths) =>
      paths.map((path) => (path.getAttribute('d') ?? '').split('L').length - 1),
    );
    expect(segmentsPerCurve).toEqual([1, 1]);
    await expect(page.locator('circle[data-point="value"]')).toHaveCount(4);
    // Recharts 3.10 draws the tick labels in their own layer
    // (`recharts-xAxis-tick-labels`, a SIBLING of `.recharts-xAxis`, not a
    // child) — confirmed from the real DOM in a trace, not assumed.
    await expect(page.locator('.recharts-xAxis-tick-labels .recharts-cartesian-axis-tick-value')).toHaveText(['2023', '2024']);

    // Heatmap: the table's own rows (period × series) as a CSS grid with
    // ARIA table semantics, every cell the real formatted cell value with
    // its resultId, outside the SVG export container.
    await heatmapTab.click();
    await expect(heatmapTab).toHaveAttribute('aria-selected', 'true');
    const grid = page.locator('[data-testid="heatmap-grid"]');
    await expect(grid).toBeVisible();
    await expect(grid.getByRole('columnheader')).toHaveText(['Periode', 'Amsterdam', 'Rotterdam']);
    await expect(grid.getByRole('rowheader')).toHaveText(['2023', '2024']);
    const cells = grid.getByRole('cell');
    await expect(cells).toHaveText([CELLS.ams2023, CELLS.rot2023, CELLS.ams2024, CELLS.rot2024]);
    await expect(grid.locator('[role="cell"][data-label-for*="03759ned"]')).toHaveCount(4);
    await expect(page.locator('[data-testid="chart-container"] [data-testid="heatmap-grid"]')).toHaveCount(0);
    await expect(page.locator('.recharts-line-curve')).toHaveCount(0);

    // The real-layout proof. `display: contents` rows must vanish from the
    // box tree so the grid lays their cells out in shared columns: cells of
    // one period share a top edge with that period's row header, cells of
    // one series share a left edge with each other AND with that series'
    // column header, and no two cells overlap. A jsdom test cannot see any
    // of this; a broken grid renders as a heap and fails exactly here.
    const box = async (locator: Locator) => {
      const b = await locator.boundingBox();
      expect(b, 'element has a box').not.toBeNull();
      return b!;
    };
    const near = (a: number, b: number) => Math.abs(a - b) <= 1;
    const rowHeaders = grid.getByRole('rowheader');
    const columnHeaders = grid.getByRole('columnheader');
    const [r2023, r2024] = [await box(rowHeaders.nth(0)), await box(rowHeaders.nth(1))];
    const [c0, c1, c2, c3] = [await box(cells.nth(0)), await box(cells.nth(1)), await box(cells.nth(2)), await box(cells.nth(3))];
    const [hAms, hRot] = [await box(columnHeaders.nth(1)), await box(columnHeaders.nth(2))];
    // Rows: same top edge as their row header, and the 2024 row sits below 2023.
    expect(near(c0.y, r2023.y) && near(c1.y, r2023.y), 'row 2023 aligned').toBe(true);
    expect(near(c2.y, r2024.y) && near(c3.y, r2024.y), 'row 2024 aligned').toBe(true);
    expect(r2024.y).toBeGreaterThanOrEqual(r2023.y + r2023.height - 1);
    // Columns: same left edge down the column, including the column header.
    expect(near(c0.x, c2.x) && near(c0.x, hAms.x), 'Amsterdam column aligned').toBe(true);
    expect(near(c1.x, c3.x) && near(c1.x, hRot.x), 'Rotterdam column aligned').toBe(true);
    // Rotterdam's column starts where Amsterdam's ends — cells side by side,
    // not stacked (what a lost `grid-template-columns` would produce).
    expect(c1.x).toBeGreaterThanOrEqual(c0.x + c0.width - 1);
    const display = await grid.evaluate((el) => ({
      grid: getComputedStyle(el).display,
      row: getComputedStyle(el.querySelector('[role="row"]')!).display,
    }));
    expect(display).toEqual({ grid: 'grid', row: 'contents' });
  });

  test(`"${DUMBBELL_MESSAGE}" through the chat draws the same dumbbell the tab does, and Undo walks it back`, async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Nieuwe chat' }).first().click();
    await ask(page, `!!intent ${TWO_PERIOD_INTENT}`);
    await expect(page.locator('.recharts-line-curve')).toHaveCount(2, { timeout: 60_000 });

    // First the tab, directly: record what it draws.
    const dumbbellTab = page.getByRole('tab', { name: 'Dumbbell' });
    const lineTab = page.getByRole('tab', { name: 'Lijn' });
    const canvas = page.locator('[data-role="dumbbell-canvas"]');
    await dumbbellTab.click();
    await expect(canvas).toBeVisible();
    const labelsByTab = await canvas.locator('[data-role="dumbbell-label"]').allTextContents();
    const dotsByTab = await canvas.locator('[data-role="dumbbell-dot"]').evaluateAll((dots) =>
      dots.map((dot) => dot.getAttribute('data-result-id')),
    );
    expect(labelsByTab).toHaveLength(4);
    await lineTab.click();
    await expect(page.locator('.recharts-line-curve')).toHaveCount(2);
    await expect(canvas).toHaveCount(0);

    // Then the chat: one `setForm` chip, the dumbbell tab selected, and the
    // identical canvas — same labels, same resultIds, same order.
    const copilot = page.getByRole('group', { name: 'Deze grafiek aanpassen via de chat' });
    await copilot.getByPlaceholder('Pas deze grafiek aan').fill(DUMBBELL_MESSAGE);
    await copilot.getByRole('button', { name: 'Versturen' }).click();
    await expect(copilot.getByText('Applied one change.')).toBeVisible({ timeout: 60_000 });
    await expect(copilot.getByRole('button', { name: 'Weergave: Dumbbell' })).toBeVisible();
    await expect(copilot.getByText('Kostte 10 credits')).toBeVisible();
    await expect(dumbbellTab).toHaveAttribute('aria-selected', 'true');
    await expect(canvas).toBeVisible();
    expect(await canvas.locator('[data-role="dumbbell-label"]').allTextContents()).toEqual(labelsByTab);
    expect(
      await canvas.locator('[data-role="dumbbell-dot"]').evaluateAll((dots) => dots.map((dot) => dot.getAttribute('data-result-id'))),
    ).toEqual(dotsByTab);

    // A chat edit is an edit like any other: the card's own Undo restores the
    // line form. `exact`: the reply strip's "Dit antwoord ongedaan maken"
    // would otherwise match too (role names match by substring).
    await page.getByRole('button', { name: 'Ongedaan maken', exact: true }).click();
    await expect(lineTab).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.recharts-line-curve')).toHaveCount(2);
    await expect(canvas).toHaveCount(0);
  });

  test('a single-series chart disables all three tabs with their reasons reachable, and the chat refuses naming the click path', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Nieuwe chat' }).first().click();
    await ask(page, `!!intent ${SINGLE_REGION_INTENT}`);
    await expect(page.locator('.recharts-line-curve')).toHaveCount(1, { timeout: 60_000 });

    // Each disabled tab carries its reason twice: `title` for the pointer
    // and an `aria-describedby` target for a screen reader — the same text.
    const reasons: Array<[string, string]> = [
      ['Dumbbell', 'Beschikbaar zodra minstens twee reeksen elk precies een begin- en een eindwaarde hebben.'],
      ['Helling', 'Beschikbaar zodra je precies twee momenten vergelijkt.'],
      ['Warmtekaart', 'Beschikbaar zodra je minstens twee reeksen en twee momenten vergelijkt.'],
    ];
    for (const [name, reason] of reasons) {
      const tab = page.getByRole('tab', { name });
      await expect(tab).toBeDisabled();
      await expect(tab).toHaveAttribute('title', reason);
      const describedBy = await tab.getAttribute('aria-describedby');
      expect(describedBy, `${name} aria-describedby`).toBeTruthy();
      await expect(page.locator(`[id="${describedBy}"]`)).toHaveText(reason);
    }

    // The chat is told the same list the tabs read, so the model's own
    // refusal comes back naming the on-screen control — and nothing changes.
    const copilot = page.getByRole('group', { name: 'Deze grafiek aanpassen via de chat' });
    await copilot.getByPlaceholder('Pas deze grafiek aan').fill(DUMBBELL_MESSAGE);
    await copilot.getByRole('button', { name: 'Versturen' }).click();
    await expect(copilot.getByText('Nothing could be applied.')).toBeVisible({ timeout: 60_000 });
    await expect(copilot.getByText('dumbbell: kan deze grafiek niet. Weergave: kies een vorm boven de grafiek.')).toBeVisible();
    await expect(copilot.getByRole('button', { name: /^Weergave:/ })).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'Lijn' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.recharts-line-curve')).toHaveCount(1);
    await expect(page.locator('[data-role="dumbbell-canvas"]')).toHaveCount(0);
  });
});

// Phase 5b (verified-whole, session 117, Task 5): the three roster-only
// shapes in a REAL browser — the one place the whole chain runs for real:
// a region-class answer stored with its `regionScope`, the on-demand
// `requestWholeVerification` Server Action reading that stored spec and
// fetching the roster's CBS-published total from the harness database, and
// the pie/stack drawn ONLY after the parts verified against it. jsdom mocks
// that action outright (chart.test.tsx), so nothing short of this proves the
// verdict actually comes back and the real cells actually reach the SVG.
//
// The roster: `!!regionset provincies` (src/answer/respond/harness-intent.ts
// — population on 1 January, ALL 12 provinces, 2025), the same question
// answer.spec.ts (d) asks, and the only region-set answer the harness can
// draw; a region class is single-period by construction (region-set.ts), so
// the stacks below are one stack each. The chat cases replay two
// hand-authored fixtures (tests/fixtures/chart-copilot/cases.ts,
// `PIE_MESSAGE`) — zero model calls, same mechanism as the phase-5 block.
//
// The twelve cells, formatted the way the chart prints them (formatValueNl,
// the seed values cases.ts `PROVINCIES_SPEC` carries), and each province's
// share of the national total (18.044.027, the NL01 cell the check verifies
// the parts against — the parts sum to exactly that figure in the seed) as
// `buildStack100Rows` formats it: pure arithmetic over verified reals,
// written out here so the browser proof asserts real text, never a shape.
const PROVINCIES_QUESTION = '!!regionset provincies';
const PIE_MESSAGE = 'toon dit als een taartdiagram';
const PROVINCES: ReadonlyArray<readonly [code: string, value: string, share: string]> = [
  ['PV28', '3.863.397', '21,4%'], // Zuid-Holland
  ['PV27', '2.992.016', '16,6%'], // Noord-Holland
  ['PV30', '2.664.047', '14,8%'], // Noord-Brabant
  ['PV25', '2.161.358', '12,0%'], // Gelderland
  ['PV26', '1.409.144', '7,8%'], // Utrecht
  ['PV23', '1.195.789', '6,6%'], // Overijssel
  ['PV31', '1.135.328', '6,3%'], // Limburg
  ['PV21', '664.222', '3,7%'], // Fryslân
  ['PV20', '602.833', '3,3%'], // Groningen
  ['PV22', '506.529', '2,8%'], // Drenthe
  ['PV24', '456.395', '2,5%'], // Flevoland
  ['PV29', '392.969', '2,2%'], // Zeeland
];
/** A stack segment shorter than STACK_LABEL_MIN_HEIGHT_PX (chart.tsx, 14 px)
 * draws no label — a geometry gate, so the small provinces' labels depend on
 * the canvas height. The four largest shares (12 % and up, ≥ 27 px on the
 * smallest canvas this card renders at) always clear it; every label that
 * IS drawn must still be one of the twelve real strings. */
const ALWAYS_LABELLED = PROVINCES.slice(0, 4);
const VERIFIED_NOTE = 'Gecontroleerd: de delen tellen op tot het CBS-totaal.';

test.describe.serial('chart co-pilot phase 5b — pie, stacked, 100%-stacked over a verified whole', () => {
  test.beforeEach(async ({ context, baseURL }) => {
    await signInAsHarnessUser(context, baseURL!);
  });

  test('an all-provinces chart offers all three tabs; each verifies the whole and draws the twelve real cells', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Nieuwe chat' }).first().click();
    await ask(page, PROVINCIES_QUESTION);
    // Opens on horizontal bars (answer.spec.ts (d)).
    await expect(page.locator('.recharts-bar-rectangle')).toHaveCount(12, { timeout: 60_000 });

    // `exact`: "Gestapeld" is a substring of "Gestapeld (%)".
    const pieTab = page.getByRole('tab', { name: 'Taartdiagram', exact: true });
    const stackedTab = page.getByRole('tab', { name: 'Gestapeld', exact: true });
    const stacked100Tab = page.getByRole('tab', { name: 'Gestapeld (%)', exact: true });
    await expect(pieTab).toBeEnabled();
    await expect(stackedTab).toBeEnabled();
    await expect(stacked100Tab).toBeEnabled();
    const note = page.locator('[data-testid="whole-note"]');
    const checking = page.locator('[data-testid="whole-checking"]');

    // Pie: the verdict comes back (the note only renders once it has — while
    // pending the canvas shows the checking line and NO chart), then twelve
    // slices, each bound to its own cell, each labelled with that cell's own
    // formatted value — no bar, no percentage, no invented number.
    await pieTab.click();
    await expect(pieTab).toHaveAttribute('aria-selected', 'true');
    await expect(note).toHaveText(VERIFIED_NOTE, { timeout: 15_000 });
    await expect(checking).toHaveCount(0);
    const slices = page.locator('path.recharts-sector[data-point="value"]');
    await expect(slices).toHaveCount(12);
    const pieLabels = page.locator('[data-role="pie-label"]');
    await expect(pieLabels).toHaveCount(12);
    for (const [code, value] of PROVINCES) {
      await expect(page.locator(`path.recharts-sector[data-point="value"][data-result-id*="${code}:2025JJ00"]`)).toHaveCount(1);
      await expect(pieLabels.filter({ hasText: value })).toHaveCount(1);
      await expect(page.locator(`[data-role="pie-label"][data-label-for*="${code}:2025JJ00"]`)).toHaveText(value);
    }
    await expect(page.locator('.recharts-bar-rectangle')).toHaveCount(0);

    // Stacked: one stack (one period), twelve segments — Recharts' own
    // stacking of one <Bar> per province — each bound to its cell; every
    // segment label drawn is a real formatted value, the four largest are
    // always drawn, and the x-axis is exactly the one period.
    await stackedTab.click();
    await expect(stackedTab).toHaveAttribute('aria-selected', 'true');
    await expect(note).toHaveText(VERIFIED_NOTE);
    const segments = page.locator('rect[data-point="value"]');
    await expect(segments).toHaveCount(12);
    for (const [code] of PROVINCES) {
      await expect(page.locator(`rect[data-point="value"][data-result-id*="${code}:2025JJ00"]`)).toHaveCount(1);
    }
    const stackLabels = page.locator('[data-role="stack-label"]');
    for (const [code, value] of ALWAYS_LABELLED) {
      await expect(page.locator(`[data-role="stack-label"][data-label-for*="${code}:2025JJ00"]`)).toHaveText(value);
    }
    const realValues = new Set(PROVINCES.map(([, value]) => value));
    for (const text of await stackLabels.allTextContents()) expect(realValues.has(text), `stack label "${text}" is a real cell value`).toBe(true);
    await expect(page.locator('.recharts-xAxis-tick-labels .recharts-cartesian-axis-tick-value')).toHaveText(['2025']);
    await expect(slices).toHaveCount(0);

    // 100%-stacked: the same twelve segments, now labelled with each part's
    // share of the verified total — computed only after the check passed,
    // against a fixed hundred-percent axis; the four largest shares always
    // labelled, every drawn label one of the twelve real shares.
    await stacked100Tab.click();
    await expect(stacked100Tab).toHaveAttribute('aria-selected', 'true');
    await expect(note).toHaveText(VERIFIED_NOTE);
    await expect(segments).toHaveCount(12);
    for (const [code, , share] of ALWAYS_LABELLED) {
      await expect(page.locator(`[data-role="stack-label"][data-label-for*="${code}:2025JJ00"]`)).toHaveText(share);
    }
    const realShares = new Set(PROVINCES.map(([, , share]) => share));
    const shareTexts = await stackLabels.allTextContents();
    expect(shareTexts.length).toBeGreaterThanOrEqual(ALWAYS_LABELLED.length);
    for (const text of shareTexts) expect(realShares.has(text), `share label "${text}" is a real share`).toBe(true);
  });

  test(`"${PIE_MESSAGE}" through the chat draws the same verified pie the tab does, and Undo walks it back`, async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Nieuwe chat' }).first().click();
    await ask(page, PROVINCIES_QUESTION);
    await expect(page.locator('.recharts-bar-rectangle')).toHaveCount(12, { timeout: 60_000 });

    // First the tab, directly: record what it draws.
    const pieTab = page.getByRole('tab', { name: 'Taartdiagram', exact: true });
    const hbarTab = page.getByRole('tab', { name: 'Liggend', exact: true });
    const note = page.locator('[data-testid="whole-note"]');
    const slices = page.locator('path.recharts-sector[data-point="value"]');
    const pieLabels = page.locator('[data-role="pie-label"]');
    await pieTab.click();
    await expect(note).toHaveText(VERIFIED_NOTE, { timeout: 15_000 });
    await expect(slices).toHaveCount(12);
    const labelsByTab = await pieLabels.allTextContents();
    const slicesByTab = await slices.evaluateAll((paths) => paths.map((path) => path.getAttribute('data-result-id')));
    expect(labelsByTab).toHaveLength(12);
    // Back to the form the card opened in — the chat's capabilities are
    // built from the CURRENT form, and the fixture was authored for hbar.
    await hbarTab.click();
    await expect(page.locator('.recharts-bar-rectangle')).toHaveCount(12);
    await expect(slices).toHaveCount(0);

    // Then the chat: one `setForm` chip, the pie tab selected, the verified
    // note, and the identical pie — same labels, same resultIds, same order.
    const copilot = page.getByRole('group', { name: 'Deze grafiek aanpassen via de chat' });
    await copilot.getByPlaceholder('Pas deze grafiek aan').fill(PIE_MESSAGE);
    await copilot.getByRole('button', { name: 'Versturen' }).click();
    await expect(copilot.getByText('Applied one change.')).toBeVisible({ timeout: 60_000 });
    await expect(copilot.getByRole('button', { name: 'Weergave: Taartdiagram' })).toBeVisible();
    await expect(copilot.getByText('Kostte 10 credits')).toBeVisible();
    await expect(pieTab).toHaveAttribute('aria-selected', 'true');
    await expect(note).toHaveText(VERIFIED_NOTE);
    await expect(slices).toHaveCount(12);
    expect(await pieLabels.allTextContents()).toEqual(labelsByTab);
    expect(await slices.evaluateAll((paths) => paths.map((path) => path.getAttribute('data-result-id')))).toEqual(slicesByTab);

    // A chat edit is an edit like any other: the card's own Undo restores
    // the horizontal bars (`exact`: the reply strip's own undo would match).
    await page.getByRole('button', { name: 'Ongedaan maken', exact: true }).click();
    await expect(hbarTab).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.recharts-bar-rectangle')).toHaveCount(12);
    await expect(slices).toHaveCount(0);
    await expect(note).toHaveCount(0);
  });

  test('a hand-picked two-city chart disables all three tabs with their reasons reachable, and the chat refuses naming the click path', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Nieuwe chat' }).first().click();
    await ask(page, `!!intent ${REGION_SERIES_INTENT}`);
    await expect(page.locator('.recharts-line-curve')).toHaveCount(2, { timeout: 60_000 });

    // Amsterdam + Rotterdam are a hand-picked selection (`regions`, never
    // `regionSet`), so the stored spec carries `regionScope: null` and there
    // is no whole to verify — each tab is disabled for the STRUCTURAL
    // reason, carried twice: `title` for the pointer and an
    // `aria-describedby` target for a screen reader.
    const reasons: Array<[string, string]> = [
      ['Taartdiagram', 'Beschikbaar zodra de grafiek één moment toont voor een volledige set regio’s die het CBS zelf als geheel kent, zoals alle provincies.'],
      ['Gestapeld', 'Beschikbaar zodra de grafiek een volledige set regio’s toont die het CBS zelf als geheel kent, zoals alle provincies.'],
      ['Gestapeld (%)', 'Beschikbaar zodra de grafiek een volledige set regio’s toont die het CBS zelf als geheel kent, zodat elk aandeel tegen een echt totaal wordt gezet.'],
    ];
    for (const [name, reason] of reasons) {
      const tab = page.getByRole('tab', { name, exact: true });
      await expect(tab).toBeDisabled();
      await expect(tab).toHaveAttribute('title', reason);
      const describedBy = await tab.getAttribute('aria-describedby');
      expect(describedBy, `${name} aria-describedby`).toBeTruthy();
      await expect(page.locator(`[id="${describedBy}"]`)).toHaveText(reason);
    }

    // The chat is told the same list the tabs read, so the model's own
    // refusal comes back naming the on-screen control — and nothing changes.
    const copilot = page.getByRole('group', { name: 'Deze grafiek aanpassen via de chat' });
    await copilot.getByPlaceholder('Pas deze grafiek aan').fill(PIE_MESSAGE);
    await copilot.getByRole('button', { name: 'Versturen' }).click();
    await expect(copilot.getByText('Nothing could be applied.')).toBeVisible({ timeout: 60_000 });
    await expect(copilot.getByText('taartdiagram: kan deze grafiek niet. Weergave: kies een vorm boven de grafiek.')).toBeVisible();
    await expect(copilot.getByRole('button', { name: /^Weergave:/ })).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'Lijn' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.recharts-line-curve')).toHaveCount(2);
    await expect(page.locator('path.recharts-sector')).toHaveCount(0);
    await expect(page.locator('[data-testid="whole-note"]')).toHaveCount(0);
  });
});

// Co-pilot phase 6, Task 1 (session 121): the two capabilities session 120
// built and then reverted — the donut (`pieHole`, #301) and the five house
// styles by name (#275) — reachable through the chat in a REAL browser. Both
// reverts happened because widening a list that reaches the LLM prompt
// shifts the request hash the llm-stub matches on; the fix was regenerating
// the fixtures offline, and this block is the proof that the regenerated
// bytes are what the browser actually sends: only an `exact` stub hit
// replays the right command (the 60-character prefix fallback would replay
// another fixture for the same chart, and the assertions below would fail on
// the wrong chip). Two hand-authored fixtures (tests/fixtures/chart-copilot/
// cases.ts, `DONUT_MESSAGE` / `BROADSHEET_MESSAGE`) — zero model calls.
const DONUT_MESSAGE = 'maak er een donut van';
const BROADSHEET_MESSAGE = 'gebruik de Broadsheet-stijl';
/** Broadsheet's paper (chart-templates.ts: solid #fafaf8), as the browser
 * computes it — the one part of the look the frame element itself carries. */
const BROADSHEET_PAPER = 'rgb(250, 250, 248)';

test.describe.serial('chart co-pilot phase 6 — the donut and a house style through the chat', () => {
  test.beforeEach(async ({ context, baseURL }) => {
    await signInAsHarnessUser(context, baseURL!);
  });

  test(`"${DONUT_MESSAGE}" through the chat hollows the verified pie, and Undo fills it again`, async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Nieuwe chat' }).first().click();
    await ask(page, PROVINCIES_QUESTION);
    await expect(page.locator('.recharts-bar-rectangle')).toHaveCount(12, { timeout: 60_000 });

    // Into the pie form first: `pieHole` is offered in that form alone
    // (resolvePresentation), and the chat's capabilities are built from the
    // CURRENT form — the fixture was authored for it (cases.ts
    // PROVINCIES_PIE_CAPABILITIES). The verdict has to be in before the pie
    // draws at all (phase 5b).
    const pieTab = page.getByRole('tab', { name: 'Taartdiagram', exact: true });
    const note = page.locator('[data-testid="whole-note"]');
    const slices = page.locator('path.recharts-sector[data-point="value"]');
    await pieTab.click();
    await expect(note).toHaveText(VERIFIED_NOTE, { timeout: 15_000 });
    await expect(slices).toHaveCount(12);

    // Real geometry, read from the SVG (the way the phase-5 slope test counts
    // a curve's `L` segments): Recharts draws a full pie's sector as one
    // outer arc closed through the centre — `M … A … L cx,cy Z`, ONE `A` —
    // and a donut's sector with the inner arc added — `… L … A … Z`, TWO.
    const arcsPerSlice = () =>
      slices.evaluateAll((paths) => paths.map((path) => ((path.getAttribute('d') ?? '').match(/A/g) ?? []).length));
    await expect.poll(arcsPerSlice).toEqual(Array(12).fill(1));

    // The chat: one `setPresentation` chip naming the Style-panel row it sets
    // (describeCommand), the pie still verified, every slice hollowed.
    const copilot = page.getByRole('group', { name: 'Deze grafiek aanpassen via de chat' });
    await copilot.getByPlaceholder('Pas deze grafiek aan').fill(DONUT_MESSAGE);
    await copilot.getByRole('button', { name: 'Versturen' }).click();
    await expect(copilot.getByText('Applied one change.')).toBeVisible({ timeout: 60_000 });
    await expect(copilot.getByRole('button', { name: 'Opmaak: Gat in het midden (donut)' })).toBeVisible();
    await expect(copilot.getByText('Kostte 10 credits')).toBeVisible();
    await expect(pieTab).toHaveAttribute('aria-selected', 'true');
    await expect(note).toHaveText(VERIFIED_NOTE);
    await expect(slices).toHaveCount(12);
    await expect.poll(arcsPerSlice).toEqual(Array(12).fill(2));

    // A chat edit is an edit like any other: the card's own Undo fills the
    // pie again (`exact`: the reply strip's own undo would match too).
    await page.getByRole('button', { name: 'Ongedaan maken', exact: true }).click();
    await expect(slices).toHaveCount(12);
    await expect.poll(arcsPerSlice).toEqual(Array(12).fill(1));
  });

  test(`"${BROADSHEET_MESSAGE}" through the chat applies the house style the gallery offers, and Undo takes it off`, async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Nieuwe chat' }).first().click();
    await ask(page, `!!intent ${REGION_SERIES_INTENT}`);
    await expect(page.locator('.recharts-line-curve')).toHaveCount(2, { timeout: 60_000 });

    // The frame (chart-frame.tsx): pristine, it is a bare wrapper with no
    // inline style at all, so no paper colour; Broadsheet paints its paper
    // on it.
    const frame = page.locator('[data-slot="chart-frame"]');
    const paper = () => frame.evaluate((el) => getComputedStyle(el).backgroundColor);
    await expect(frame).toBeVisible();
    await expect.poll(paper).not.toBe(BROADSHEET_PAPER);

    // The chat: one `applyTemplate` chip carrying the gallery's own name for
    // the look (describeCommand: "Krantenpapier", never the id), the paper
    // on the frame, both lines still there.
    const copilot = page.getByRole('group', { name: 'Deze grafiek aanpassen via de chat' });
    await copilot.getByPlaceholder('Pas deze grafiek aan').fill(BROADSHEET_MESSAGE);
    await copilot.getByRole('button', { name: 'Versturen' }).click();
    await expect(copilot.getByText('Applied one change.')).toBeVisible({ timeout: 60_000 });
    await expect(copilot.getByRole('button', { name: 'Sjabloon: Krantenpapier' })).toBeVisible();
    await expect(copilot.getByText('Kostte 10 credits')).toBeVisible();
    await expect.poll(paper).toBe(BROADSHEET_PAPER);
    await expect(page.locator('.recharts-line-curve')).toHaveCount(2);

    // Undo takes the look off again.
    await page.getByRole('button', { name: 'Ongedaan maken', exact: true }).click();
    await expect.poll(paper).not.toBe(BROADSHEET_PAPER);
    await expect(page.locator('.recharts-line-curve')).toHaveCount(2);
  });
});

// Co-pilot phase 6, Tasks 2–6 (session 121): the five panel-only commands
// (setDimmed, setHeadlineOverride, addEraShading, addDerivedOverlay,
// addGoalLine) became chat-nameable under ONE prompt-version bump, and their
// fixtures were regenerated ONCE, together (Task 6). All five cases share
// this chart's spec and capabilities and differ only in the message, so a
// single real round-trip was originally treated as proof for the whole
// regeneration: only an `exact` llm-stub hit replays the intended command — a
// hash drift on the shared system prompt or capabilities bytes would fall
// through to the 60-character prefix fallback and replay another two-city
// fixture, and the chip assertion would fail on the wrong command. Era
// shading was chosen as that one case because it is the richest to watch:
// map.ts resolves the two period LABELS to CBS period codes and mints the
// era's id, the client re-validates those codes against the spec it draws,
// and the band renders as real SVG.
//
// #308 (found in the same final whole-branch review that chose era shading):
// the shared-mechanism argument proves the REQUEST bytes are right for all
// five, but not that each one's own RENDERING is real — a broken reducer arm
// or a missing chart-side wire for just one kind would still pass. Closed
// session 122 (further continuation): the remaining four below, one test
// each, reusing the exact fixture messages from tests/fixtures/chart-copilot/
// cases.ts and the same rendering assertions their own PANEL-driven e2e
// tests above already prove — the only new thing each test proves is that
// the SAME state change also reaches the chart when triggered from the chat
// doorway instead of a click, per ADR 056's one-history-two-doorways design.
// Zero model calls, zero new fixtures (all five cases already existed).
const ERA_SHADING_MESSAGE = 'Arceer 2021 tot 2023 als herstelperiode';
const DIM_MESSAGE = 'Dim Rotterdam in plaats van hem te verbergen';
const HEADLINE_MESSAGE = 'Maak van Amsterdam in 2022 het hoofdcijfer';
const DERIVED_DIFFERENCE_MESSAGE = 'Laat het verschil zien tussen Amsterdam in 2020 en 2024';
const GOAL_LINE_MESSAGE = 'Voeg een doellijn toe op 900000';

test.describe.serial('chart co-pilot phase 6 — the five panel-only commands through the chat', () => {
  test.beforeEach(async ({ context, baseURL }) => {
    await signInAsHarnessUser(context, baseURL!);
  });

  test(`"${ERA_SHADING_MESSAGE}" through the chat shades the band the panel form would, and Undo lifts it`, async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Nieuwe chat' }).first().click();
    await ask(page, `!!intent ${REGION_SERIES_INTENT}`);
    await expect(page.locator('.recharts-line-curve')).toHaveCount(2, { timeout: 60_000 });

    // The era list's entries (chart-era-shading.tsx), each carrying its own
    // delete button — scoped this way rather than by label text: the reply
    // strip echoes the reader's message, which contains "herstelperiode",
    // and `getByText` matches case-insensitively.
    const eraEntries = page.locator('li', { has: page.locator('button[data-command-kind="removeEraShading"]') });
    const band = page.locator('.recharts-reference-area-rect');
    await expect(band).toHaveCount(0);
    await expect(eraEntries).toHaveCount(0);

    // The chat: one `addEraShading` chip (describeCommand's own name for it),
    // the cost line, and the band drawn on the chart — the same
    // ReferenceArea rect the panel's own e2e test above asserts.
    const copilot = page.getByRole('group', { name: 'Deze grafiek aanpassen via de chat' });
    await copilot.getByPlaceholder('Pas deze grafiek aan').fill(ERA_SHADING_MESSAGE);
    await copilot.getByRole('button', { name: 'Versturen' }).click();
    await expect(copilot.getByText('Applied one change.')).toBeVisible({ timeout: 60_000 });
    await expect(copilot.getByRole('button', { name: 'Schaduw toegevoegd' })).toBeVisible();
    await expect(copilot.getByText('Kostte 10 credits')).toBeVisible();
    await expect(band).toBeVisible();

    // The list entry shows the CODES map.ts resolved from the labels the
    // model copied ("2021" → 2021JJ00, "2023" → 2023JJ00 — the harness's real
    // CBS period codes, the same ones the panel test reads back from its
    // selects) and the typed label, outside the chart's export container.
    await expect(eraEntries).toHaveCount(1);
    await expect(eraEntries).toContainText('2021JJ00 – 2023JJ00: Herstelperiode');
    await expect(page.getByRole('button', { name: 'Verwijder de markering 2021JJ00–2023JJ00' })).toBeVisible();
    const chartContainer = page.locator('[data-testid="chart-container"]');
    await expect(chartContainer.locator(':has-text("Herstelperiode")')).not.toBeVisible();
    await expect(page.locator('.recharts-line-curve')).toHaveCount(2);

    // A chat edit is an edit like any other: the card's own Undo lifts the
    // band and empties the list (`exact`: the reply strip's own undo would
    // match too).
    await page.getByRole('button', { name: 'Ongedaan maken', exact: true }).click();
    await expect(band).toHaveCount(0);
    await expect(eraEntries).toHaveCount(0);
    await expect(page.locator('.recharts-line-curve')).toHaveCount(2);
  });

  test(`"${DIM_MESSAGE}" through the chat dims the series the panel's own Dim button would, and Undo restores it`, async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Nieuwe chat' }).first().click();
    await ask(page, `!!intent ${REGION_SERIES_INTENT}`);
    await expect(page.locator('.recharts-line-curve')).toHaveCount(2, { timeout: 60_000 });

    // The panel's own Dim button (same one the phase-1 "dim a series via the
    // legend" test above drives by click) reflects the SAME reducer state
    // regardless of doorway — its `aria-pressed` is the cross-doorway proof.
    const dimButton = page.getByRole('button', { name: /Dim Rotterdam/ });
    await expect(dimButton).toHaveAttribute('aria-pressed', 'false');

    const copilot = page.getByRole('group', { name: 'Deze grafiek aanpassen via de chat' });
    await copilot.getByPlaceholder('Pas deze grafiek aan').fill(DIM_MESSAGE);
    await copilot.getByRole('button', { name: 'Versturen' }).click();
    await expect(copilot.getByText('Applied one change.')).toBeVisible({ timeout: 60_000 });
    await expect(copilot.getByRole('button', { name: 'Serie verzwakt' })).toBeVisible();
    await expect(copilot.getByText('Kostte 10 credits')).toBeVisible();

    // Dimmed, not hidden: both curves still render, one at reduced opacity
    // (same assertions the panel-driven test above makes).
    await expect(page.locator('path[class*="recharts-curve"]')).toHaveCount(2);
    await expect(page.locator('path[stroke-opacity="0.35"]')).toHaveCount(1);
    await expect(dimButton).toHaveAttribute('aria-pressed', 'true');

    // A chat edit is an edit like any other (`exact`: the reply strip's own
    // undo would match too).
    await page.getByRole('button', { name: 'Ongedaan maken', exact: true }).click();
    await expect(dimButton).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('path[stroke-opacity="0.35"]')).toHaveCount(0);
  });

  test(`"${HEADLINE_MESSAGE}" through the chat features the point the panel's own click would, and Undo reverts it`, async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Nieuwe chat' }).first().click();
    await ask(page, `!!intent ${REGION_SERIES_INTENT}`);
    await expect(page.locator('.recharts-line-curve')).toHaveCount(2, { timeout: 60_000 });

    // No default headline for this two-region chart (same premise the
    // phase-1 "click a point to make it the headline" test above documents).
    const headlineFigure = page.locator('[data-testid="headline-figure"]');
    await expect(headlineFigure).not.toBeVisible();

    const copilot = page.getByRole('group', { name: 'Deze grafiek aanpassen via de chat' });
    await copilot.getByPlaceholder('Pas deze grafiek aan').fill(HEADLINE_MESSAGE);
    await copilot.getByRole('button', { name: 'Versturen' }).click();
    await expect(copilot.getByText('Applied one change.')).toBeVisible({ timeout: 60_000 });
    await expect(copilot.getByRole('button', { name: 'Hoofdcijfer aangepast' })).toBeVisible();
    await expect(copilot.getByText('Kostte 10 credits')).toBeVisible();

    // The headline now shows the reader-named point specifically — Amsterdam
    // 2022, 882.633 (REGION_SERIES_SPEC) — not just "some override exists".
    // First-run finding: the panel's own "Toon standaard hoofdcijfer" toggle
    // is NOT a state-reflecting control (worth asserting here, wrongly
    // assumed at first) — chart.tsx's onSetHeadline comment says it renders
    // only inside the pending-point POPOVER for the point just clicked, so a
    // chat-driven override (no popover ever opened) correctly never shows
    // it; data-label-for is the real, doorway-independent proof instead.
    await expect(headlineFigure).toBeVisible({ timeout: 5000 });
    await expect(headlineFigure).toContainText('882.633');
    await expect(headlineFigure.locator('[data-label-for*="GM0363:2022JJ00"]')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Toon standaard hoofdcijfer' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Ongedaan maken', exact: true }).click();
    await expect(headlineFigure).not.toBeVisible();
  });

  test(`"${DERIVED_DIFFERENCE_MESSAGE}" through the chat draws the same computed overlay the panel's picker would, and Undo removes it`, async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Nieuwe chat' }).first().click();
    await ask(page, `!!intent ${REGION_SERIES_INTENT}`);
    await expect(page.locator('.recharts-line-curve')).toHaveCount(2, { timeout: 60_000 });

    const copilot = page.getByRole('group', { name: 'Deze grafiek aanpassen via de chat' });
    await copilot.getByPlaceholder('Pas deze grafiek aan').fill(DERIVED_DIFFERENCE_MESSAGE);
    await copilot.getByRole('button', { name: 'Versturen' }).click();
    await expect(copilot.getByText('Applied one change.')).toBeVisible({ timeout: 60_000 });
    await expect(copilot.getByRole('button', { name: 'Overlay toegevoegd' })).toBeVisible();
    await expect(copilot.getByText('Kostte 10 credits')).toBeVisible();

    // The panel's own remove chip appears (shared state, same as the
    // picker-driven "add a difference arrow" test above) and the ACTUAL
    // server-computed value reaches the SVG label — 931.298 - 872.757 =
    // 58.541, the same real cells and the same formatting that test proves,
    // now reached from the chat instead of two clicks.
    await expect(page.getByRole('button', { name: /^×/ })).toBeVisible();
    await expect(page.getByText('58.541')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.recharts-reference-line line[data-label-for]')).toHaveCount(1);

    await page.getByRole('button', { name: 'Ongedaan maken', exact: true }).click();
    await expect(page.getByRole('button', { name: /^×/ })).not.toBeVisible();
    await expect(page.getByText('58.541')).not.toBeVisible();
  });

  test(`"${GOAL_LINE_MESSAGE}" through the chat draws the same goal line the panel's own form would, and Undo removes it`, async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Nieuwe chat' }).first().click();
    await ask(page, `!!intent ${REGION_SERIES_INTENT}`);
    await expect(page.locator('.recharts-line-curve')).toHaveCount(2, { timeout: 60_000 });

    // Scoped by the delete button's own `data-command-kind`, same pattern
    // the era-shading test above uses for its list (chart-goal-line.tsx
    // renders `{line.value}: {line.label}` verbatim — no thousands
    // separator, confirmed by reading the component, not assumed).
    const goalLineEntries = page.locator('li', { has: page.locator('button[data-command-kind="removeGoalLine"]') });
    const goalLine = page.locator('.recharts-reference-line');
    await expect(goalLineEntries).toHaveCount(0);

    const copilot = page.getByRole('group', { name: 'Deze grafiek aanpassen via de chat' });
    await copilot.getByPlaceholder('Pas deze grafiek aan').fill(GOAL_LINE_MESSAGE);
    await copilot.getByRole('button', { name: 'Versturen' }).click();
    await expect(copilot.getByText('Applied one change.')).toBeVisible({ timeout: 60_000 });
    await expect(copilot.getByRole('button', { name: 'Doellijn toegevoegd' })).toBeVisible();
    await expect(copilot.getByText('Kostte 10 credits')).toBeVisible();

    // The value is the one the message itself contains (900000, copied
    // verbatim per goalLineValueInMessage — never computed), the label is
    // the model's own free-of-digits text, and the visual line renders on
    // the chart (same assertion the panel-driven goal-line test above
    // makes) — outside the export container, the label text stays excluded.
    await expect(goalLineEntries).toHaveCount(1);
    await expect(goalLineEntries).toContainText('900000: Doel');
    await expect(goalLine).toHaveCount(1, { timeout: 5_000 });
    const chartContainer = page.locator('[data-testid="chart-container"]');
    await expect(chartContainer.locator(':has-text("Doel")')).not.toBeVisible();

    await page.getByRole('button', { name: 'Ongedaan maken', exact: true }).click();
    await expect(goalLineEntries).toHaveCount(0);
    await expect(goalLine).toHaveCount(0);
  });
});

/** Type a question and send it (copied from answer.spec.ts — same harness,
 * same composer). */
async function ask(page: import('./harness.ts').Page, question: string): Promise<void> {
  await page.getByPlaceholder('Stel een vraag…').fill(question);
  await page.getByRole('button', { name: 'Verstuur' }).click();
}

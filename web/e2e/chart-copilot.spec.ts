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

    // Get the initial headline value (the last point's value).
    const headlineFigure = page.locator('[data-testid="headline-figure"]');
    const initialHeadline = await headlineFigure.textContent();
    expect(initialHeadline).toBeTruthy();

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

    // The headline should change. Get the first point's value from the data.
    // Since we can't directly access Recharts' data, we verify the UI has
    // changed by checking that the headline is now different OR that the
    // "Show default headline" button is now visible (proof of override).
    const clearHeadlineButton = page.getByRole('button', { name: 'Toon standaard hoofdcijfer' });
    await expect(clearHeadlineButton).toBeVisible({ timeout: 5000 });

    // Undo should clear the override and restore the "Make this headline" button.
    const undoButton = page.getByRole('button', { name: 'Ongedaan maken' });
    await undoButton.click();

    // After undo, the "Make this the headline" button should be back.
    await expect(setHeadlineButton).toBeVisible({ timeout: 5000 });
    await expect(clearHeadlineButton).not.toBeVisible();
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

    // Fill in the form
    await page.getByLabel('Van').selectOption('2020');
    await page.getByLabel('Tot').selectOption('2021');
    await page.getByLabel('Label').fill('Testperiode');

    // Submit the form
    const saveButton = page.getByRole('button', { name: 'Opslaan' });
    await saveButton.click();

    // Important #2a: Verify the visual band renders on the chart
    // Recharts renders ReferenceArea as SVG rect elements with this class
    await expect(page.locator('.recharts-reference-area-rect')).toBeVisible({ timeout: 5_000 });

    // Important #2: Verify the label appears in the list (outside the chart export container)
    await expect(page.getByText('Testperiode')).toBeVisible();
    await expect(page.getByText(/2020 – 2021/)).toBeVisible();

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

/** Type a question and send it (copied from answer.spec.ts — same harness,
 * same composer). */
async function ask(page: import('./harness.ts').Page, question: string): Promise<void> {
  await page.getByPlaceholder('Stel een vraag…').fill(question);
  await page.getByRole('button', { name: 'Verstuur' }).click();
}

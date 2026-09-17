// (b)–(e) The logged-in answer pipeline, end to end, in a real browser: ask →
// deterministic answer → chart → proof panel, the same walk a journalist does.
//
// The LLM stub replays the committed fixtures, so ONLY the benchmark questions
// answer end to end (docs/RUNBOOK.md § "Local real-browser harness"). Every
// question below is therefore either a benchmark task or a `!!regionset`
// harness injection — never an ad-hoc phrasing, which would 400 at the stub and
// look like a product failure.
import { expect, signInAsHarnessUser, test, type Page } from './harness.ts';

const INFLATION_QUESTION = 'Hoe ontwikkelde de inflatie zich per jaar van 2020 t/m 2024?';
const PREDICTION_QUESTION = 'Wat wordt de inflatie in 2027?';

// ADR 055 (multi-region time series) — same `!!intent` harness injection as
// `!!regionset` above, but a raw hand-authored intent: no named preset covers
// this shape (docs/decisions/055-multi-region-series.md, scripts/dev-harness/
// README.md). Amsterdam + Rotterdam over 2020-2024 is the EXACT case
// tests/answer/region-series-answer.test.ts exercises against the same
// hermetic CBS fixture snapshot this harness restores, so the resulting
// numbers are known ahead of time (verified against
// tests/fixtures/cbs/03759ned/observations-page-1.json): both cities'
// population rose over the period, so both clauses read "gestegen".
const REGION_SERIES_INTENT = JSON.stringify({
  target: { kind: 'canonical', key: 'population_on_1_january' },
  period: { kind: 'range', from: '2020JJ00', to: '2024JJ00' },
  derivation: 'none',
  regions: ['GM0363', 'GM0599'], // Amsterdam, Rotterdam
});

// Row 13's `multi_region_multi_period` refusal, but with 7 NAMED regions
// (one over REGION_SERIES_MAX_REGIONS = 6) rather than a region CLASS — the
// combination `tests/answer/query-refusal-chips.test.ts` ("carries exactly
// one takeable chip") pins as the one that both refuses AND carries an offer
// chip: the chip takes the FIRST region (PV20 = "Groningen (PV)") over the
// same range, forced to `derivation: 'series'`. Taking a click-option chip
// always composes `templateOnly: true` (src/answer/respond/respond.ts), so
// this never risks an llm-stub MISS on a question the real parser never sees.
const OVER_CAP_REGIONS_INTENT = JSON.stringify({
  target: { kind: 'canonical', key: 'population_on_1_january' },
  period: { kind: 'range', from: '2020JJ00', to: '2024JJ00' },
  derivation: 'none',
  regions: ['PV20', 'PV21', 'PV22', 'PV23', 'PV24', 'PV25', 'PV26'],
});

/** Type a question and send it. Deliberately does NOT wait for "an answer":
 * each test waits for ITS OWN expected outcome instead, so a test can never
 * pass on a generic "something appeared". */
async function ask(page: Page, question: string): Promise<void> {
  await page.getByPlaceholder('Stel een vraag…').fill(question);
  await page.getByRole('button', { name: 'Verstuur' }).click();
}

// Serial: one harness user, one fixture database. The replay test re-opens the
// thread the first test created, and every question spends from the same
// balance — running these in parallel would be a race against a shared world.
test.describe.serial('the logged-in answer pipeline', () => {
  test.beforeEach(async ({ context, baseURL }) => {
    await signInAsHarnessUser(context, baseURL!);
  });

  test('(b) answers the benchmark inflation question with a chart and a proof panel', async ({ page }) => {
    await page.goto('/');
    await ask(page, INFLATION_QUESTION);

    // The deterministic answer: every one of these five numbers comes from a
    // CBS cell (principle a) — if the pipeline ever starts phrasing them from
    // the model instead, this string stops matching.
    const answer = page.getByText(/De inflatie bedroeg in 2020 1,3 %/);
    await expect(answer).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText('Bron: CBS StatLine, tabel 86141NED', { exact: false }).first()).toBeVisible();

    // R6: an answer with a series gets a chart.
    await expect(page.locator('.recharts-surface').first()).toBeVisible();

    // The namesake action, and what it opens.
    await page.getByRole('button', { name: 'Bewijs deze cijfers' }).first().click();
    const proof = page.getByRole('region', { name: 'Onderbouwing van dit antwoord' });
    await expect(proof.getByText('De gebruikte cellen')).toBeVisible();
    // Five cells read, five rows shown — the panel lists the ACTUAL cells, not
    // a summary of them.
    await expect(proof.locator('table tbody tr')).toHaveCount(5);
    await expect(proof.getByText('10,0%')).toBeVisible();
  });

  test('(c) the STORED answer still offers the proof panel after a fresh load', async ({ page }) => {
    // The session-110 P1 regression pin. `buildAnswerProof` runs from a client
    // component on the live turn and from SERVER paths on every stored one
    // (replay-assemble.ts, question-history.tsx, app/actions.ts); a server-only
    // failure there is invisible to vitest and to the test above, and shipped
    // once already. A fresh browser context + a fresh page load is the only
    // thing that tells the two paths apart.
    await page.goto('/');
    await page.getByRole('button', { name: INFLATION_QUESTION }).first().click();

    await expect(page.getByText(/De inflatie bedroeg in 2020 1,3 %/)).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole('button', { name: 'Bewijs deze cijfers' }).first()).toBeVisible();

    // Not just present — it still opens with the real cells behind it.
    const proof = page.getByRole('region', { name: 'Onderbouwing van dit antwoord' });
    await page.getByRole('button', { name: 'Bewijs deze cijfers' }).first().click();
    await expect(proof.getByText('De gebruikte cellen')).toBeVisible();
    await expect(proof.locator('table tbody tr')).toHaveCount(5);
  });

  test('(d) a region-set question states its coverage and charts all 12 provinces', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Nieuwe chat' }).first().click();
    // HARNESS_INTENT_INJECT=1 only: the `!!regionset` prefix hands the pipeline
    // a hand-authored intent, the one way to exercise ADR 054's region sets
    // before the LLM-facing vocabulary exists. Never reachable in production.
    await ask(page, '!!regionset provincies');

    // #253: the coverage disclosure — a region-class answer must say how much
    // of the class it actually covers, never imply a complete picture.
    await expect(page.getByText('Dekking: alle 12 provincies in deze tabel hebben een cijfer.')).toBeVisible({
      timeout: 60_000,
    });

    // Session 110 UX audit pass 3 row 1: a comparison-shaped spec opens on
    // horizontal bars, the only form that puts the region name on an axis —
    // twelve bars, each one labelled.
    await expect(page.locator('.recharts-bar-rectangle')).toHaveCount(12);
    await expect(page.getByText('Zuid-Holland (PV)').first()).toBeVisible();
    await expect(page.getByText('Zeeland (PV)').first()).toBeVisible();
  });

  test('(e) a prediction question is refused, costs 0 credits and offers an alternative', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Nieuwe chat' }).first().click();
    await ask(page, PREDICTION_QUESTION);

    // Principle (c): refuse rather than guess — and charge nothing for it.
    await expect(page.getByText('Dit kon ik niet beantwoorden')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText('geen antwoord = geen gok')).toBeVisible();
    // `exact` matters: the header badge and the composer's price line both
    // contain the word "credits" — this is the per-TURN cost under the card.
    await expect(page.getByText('0 credits', { exact: true })).toBeVisible();

    // A refusal is not a dead end: the retry chip offers what CBS CAN answer.
    await expect(page.getByText('Probeer in plaats daarvan:')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Wat was de inflatie in juni 2026?' })).toBeVisible();

    // And nothing that looks like an answer: a refusal has no chart.
    await expect(page.locator('.recharts-surface')).toHaveCount(0);
  });

  test('(f) a multi-region series states each region\'s own trend and charts one line per region', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Nieuwe chat' }).first().click();
    await ask(page, `!!intent ${REGION_SERIES_INTENT}`);

    // ADR 055 MS1: one clause per region, each bound to ITS OWN direction
    // record — both region names and a real Dutch trend participle, never a
    // cross-region claim. The exact figures are the fixture's own numbers.
    await expect(page.getByText('Amsterdam ging van 872.757 in 2020 naar 931.298 in 2024 (gestegen)')).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByText('Rotterdam ging van 651.157 in 2020 naar 670.610 in 2024 (gestegen)')).toBeVisible();

    // The chart: one line PER region (ADR 055 task 3), both in the legend.
    await expect(page.locator('.recharts-line-curve')).toHaveCount(2);
    await expect(page.getByRole('button', { name: 'Amsterdam', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Rotterdam', exact: true })).toBeVisible();

    // Proof panel: a region-named "Richting" step per region, not two
    // identical unlabelled rows (the row-14 gap this ADR closed).
    await page.getByRole('button', { name: 'Bewijs deze cijfers' }).first().click();
    const proof = page.getByRole('region', { name: 'Onderbouwing van dit antwoord' });
    await expect(proof.getByText('Richting van de reeks voor Amsterdam', { exact: false })).toBeVisible();
    await expect(proof.getByText('Richting van de reeks voor Rotterdam', { exact: false })).toBeVisible();
  });

  test('(g) an over-cap multi-region refusal offers a chip that answers a single-region series on click', async ({
    page,
  }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Nieuwe chat' }).first().click();
    await ask(page, `!!intent ${OVER_CAP_REGIONS_INTENT}`);

    // Row 13's honest refusal — a whole GROUP of regions (or more than the
    // cap), never the generic internal wording, and no digits (#37).
    await expect(page.getByText('Dit kon ik niet beantwoorden')).toBeVisible({ timeout: 60_000 });
    await expect(
      page.getByText(
        "maar deze vraag gaat over een hele groep regio's, of over meer regio's dan in één antwoord passen.",
        { exact: false },
      ),
    ).toBeVisible();
    await expect(page.getByText('0 credits', { exact: true })).toBeVisible();
    await expect(page.locator('.recharts-surface')).toHaveCount(0);

    // The offer chip: the FIRST named region over the full range, as a trend.
    // Since pass-4 row 5 (session 110) the chip names the region by its loaded
    // label ("Groningen"), falling back to the CBS code only when no label is
    // loaded — accept both so the pin is about the chip, not the label source.
    const chipLabel = /^Hoe ontwikkelde bevolking op 1 januari in (Groningen|PV20) zich van 2020 tot en met 2024\?$/;
    await expect(page.getByText('Probeer in plaats daarvan:')).toBeVisible();
    const chip = page.getByRole('button', { name: chipLabel });
    await expect(chip).toBeVisible();

    // Taking the chip fills the composer (refusal chips fill, they don't
    // send) — Verstuur then takes the click-option rung (templateOnly,
    // zero LLM calls) and answers a single-region series for Groningen.
    await chip.click();
    await expect(page.getByPlaceholder('Stel een vraag…')).toHaveValue(chipLabel); // toHaveValue accepts a RegExp
    await page.getByRole('button', { name: 'Verstuur' }).click();

    // The template body strips the CBS "(PV)" suffix (baseRegionLabel) — a
    // single line per requested period, naming the region it belongs to.
    // (A single-series chart shows no legend at all — `seriesMeta.length > 1`
    // in web/components/chart.tsx — so the region name only surfaces in the
    // body text, not as a legend button like the two-region case above.)
    await expect(page.getByText('in Groningen:', { exact: false }).first()).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('.recharts-line-curve')).toHaveCount(1);
  });
});

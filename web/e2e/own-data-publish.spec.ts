// Own-data chart publishing (ADR 057, session 127) end to end, in a real
// browser: upload a file, get a chart, hide a series, publish it, then open
// the public link in a browser context that carries NO session cookie at
// all — the actual reader this feature is for — and confirm what they see
// (and, just as important, what they do NOT see: the hidden series). Then,
// back as the author, unpublish and confirm the same link now refuses.
//
// Why this spec exists (and why a component/vitest test cannot replace it):
// own-chart-publish-actions.test.ts and page.test.tsx already prove the
// server-side replay/pruning logic in isolation, but nothing in the unit
// suite ever drives two SEPARATE browser identities against the SAME running
// server the way a real publish/read round trip needs — one authenticated
// context that publishes, one with a clean cookie jar that reads the link
// back exactly as an anonymous visitor would. jsdom has no second identity
// to be; only Playwright, against the real dev harness, does.
//
// `OWN_DATA_PUBLISH_ENABLED=1` is set for the harness's own dev server ONLY,
// in scripts/dev-harness/{run-next-dev.mjs,env.sh} — never in any .env file
// (CLAUDE.md: secrets/flags live in the hosting platform's env store or, for
// this harness, its own launcher scripts). Turning the flag on there changes
// nothing for any OTHER spec in this suite: every own-data-publish code path
// it unlocks (the Publish button on the card, the `/embed/own/[publicId]`
// route, the publish/unpublish Server Actions) is additive — a new button
// next to ones that were already there, a new route nobody else navigates
// to — and every one of those call sites still checks the flag itself
// (own-chart-publish-actions.ts, page.tsx), so the flag is genuinely just
// "is this additional button/route reachable", not a change to any existing
// render path own-data-copilot.spec.ts or chart-copilot.spec.ts exercises.
import { resolve } from 'node:path';
import { expect, signInAsHarnessUser, test } from './harness.ts';

/** Same fixture own-data-copilot.spec.ts already uploads: two gemeenten
 * (Amsterdam, Rotterdam) over two years, Jaar;Gemeente;Omzet;Kosten — so the
 * chart below has exactly two series, one of which this spec hides. */
const CSV = resolve(__dirname, '..', '..', 'tests', 'fixtures', 'attachments', 'verkoop.csv');

/** Verbatim question text — anything else 400s at the llm-stub (the fixture
 * is matched on (model, system, question), see own-data-copilot.spec.ts's
 * own header comment). Ingest itself is free (CLAUDE.md cheapest-mechanism
 * default, and pricing-defaults.ts's own comment: "CSV/TSV ingest itself
 * stays free in v1"); only this one question spends credits — one
 * 'dataset_turn' charge (20, `src/billing/pricing-defaults.ts`), a small
 * fraction of the harness's shared, finite balance (signup grant 100 +
 * pglite-preload.mjs's local top-up 2000). */
const QUESTION = 'Omzet per jaar per gemeente';

/** The source line typed into the publish dialog — plain author text, never
 * translated (own-chart-publish-actions.ts stores it verbatim, up to
 * PUBLICATION_SOURCE_LINE_MAX_CLIENT=120 chars) — distinctive enough that
 * finding it on the public page is not a coincidence. */
const SOURCE_LINE = 'Eigen verkoopadministratie (e2e-test)';

/** The series this spec hides via the legend before publishing — it must
 * never reach an anonymous visitor's page (ADR 057 invariant P1): not the
 * label, not the values, not even the category name in a blanked slot. */
const HIDDEN_SERIES = 'Rotterdam';
const VISIBLE_SERIES = 'Amsterdam';

test.describe.serial('own-data chart publishing', () => {
  test.beforeEach(async ({ context, baseURL }) => {
    await signInAsHarnessUser(context, baseURL!);
  });

  test('publish (with a hidden series) → a cookie-less visitor sees the pruned chart and source line → unpublish kills the link', async ({
    page,
    browser,
  }) => {
    // The public route is its own entry point, so `next dev` compiles it
    // (and the whole own-data card behind it) on the visitor's FIRST request —
    // measured over 60 s on a loaded 8 GB machine (session 128), past the
    // config's 90 s budget for the whole walk. test.slow() triples it here only.
    test.slow();
    // 1. Upload, ask the one question, get the chart — the same upload +
    // question own-data-copilot.spec.ts already proves; nothing new here.
    await page.goto('/');
    await page.getByRole('button', { name: 'Nieuwe chat' }).first().click();
    await expect(page.getByRole('button', { name: 'Bestand uploaden' })).toBeEnabled();
    await page.locator('input[type="file"]').setInputFiles(CSV);
    const composer = page.getByPlaceholder('Stel een vraag over je data…');
    await expect(composer).toBeVisible({ timeout: 60_000 });
    await composer.fill(QUESTION);
    await page.getByRole('button', { name: 'Verstuur' }).click();
    const card = page.locator('div.border-dashed[tabindex="-1"]');
    await expect(card).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('.recharts-line-curve')).toHaveCount(2, { timeout: 60_000 });

    // 2. Hide Rotterdam via the card's own legend (not the co-pilot chat —
    // this is the plain, client-side toggle SeriesLegend's own header
    // comment describes as "never touches the spec or the audit record", so
    // it costs no credits). The legend's group is labelled 'Reeksen'
    // ('chart.seriesGroupLabel'); the toggle button's accessible name is
    // just the series label (chart-series-legend.tsx: "aria-pressed={!hidden}
    // ... aria-pressed={hidden} would announce pressed exactly when the
    // series is OFF" — the label text alone, `exact: true` so it is not
    // matched by the neighbouring "Markeer Rotterdam"/"Dim Rotterdam"
    // buttons which also contain the name as a substring).
    const legend = page.getByRole('group', { name: 'Reeksen' });
    const hideToggle = legend.getByRole('button', { name: HIDDEN_SERIES, exact: true });
    await expect(hideToggle).toHaveAttribute('aria-pressed', 'true');
    await hideToggle.click();
    await expect(hideToggle).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('.recharts-line-curve')).toHaveCount(1);

    // 3. Open Publish. The dialog's own CTA button reads the same
    // ('Publiceren') as the trigger that opens it — both stay mounted at
    // once, so scope to `getByRole('dialog')` from here on to keep every
    // lookup unambiguous.
    const publishTrigger = page.getByRole('button', { name: 'Publiceren', exact: true });
    await publishTrigger.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Bezig met controleren…')).toHaveCount(0);
    await dialog.getByLabel('Bronregel (optioneel)').fill(SOURCE_LINE);
    await dialog.getByRole('button', { name: 'Publiceren', exact: true }).click();

    // The dialog swaps to the published state: a read-only Link field holds
    // the real `/embed/own/[publicId]` URL (own-chart-publish-dialog.tsx's
    // `buildOwnEmbedUrl`) — read it directly rather than trusting the Copy
    // button (clipboard permissions are not guaranteed in a CI browser).
    const linkField = dialog.locator('input[readonly]');
    await expect(linkField).toBeVisible({ timeout: 30_000 });
    const publicUrl = await linkField.inputValue();
    expect(publicUrl).toMatch(/\/embed\/own\/[A-Za-z0-9_-]{22}(\?|$)/);
    await expect(dialog.getByRole('button', { name: 'Depubliceren' })).toBeVisible();

    // 4. The actual proof: a SECOND browser context with an entirely empty
    // cookie jar (never `signInAsHarnessUser` here) — the real shape of the
    // reader this feature is for, not the author's own already-authenticated
    // tab reloaded.
    const guestContext = await browser.newContext();
    const guestPage = await guestContext.newPage();
    try {
      await guestPage.goto(publicUrl);

      // The chart renders: exactly one line curve (Rotterdam, hidden by the
      // author, must not draw), and the "own data / not checked" badge and
      // disclaimer (both hard-coded English constants regardless of UI
      // language — USER_DATA_BADGE/USER_DATA_DISCLAIMER in
      // backend/attachments/types.ts — rendered unconditionally, publicMode
      // included, per user-chart.tsx's own comment on that block).
      await expect(guestPage.locator('.recharts-line-curve')).toHaveCount(1, { timeout: 30_000 });
      await expect(guestPage.getByText('Your data · unverified')).toBeVisible();
      await expect(guestPage.getByText('User-uploaded data — not verified by checkdecijfers.')).toBeVisible();

      // The author's source line, verbatim (the dialog's default embedLang
      // matched the card's own display language, Dutch in this harness —
      // 'Bron: {source}' — checked as a substring so this assertion does not
      // also need to hard-code which language won).
      await expect(guestPage.locator('[data-label-for="source-line"]')).toContainText(SOURCE_LINE);

      // The hidden series is gone — not just undrawn, ABSENT from the
      // rendered HTML entirely (pruneForPublic blanks the slot's label/
      // values server-side, before this page's JSX or its hydration payload
      // ever exist — ADR 057 invariant P1). The one series still on screen
      // is a sanity check that the page did not simply fail to render
      // anything at all.
      const html = await guestPage.content();
      expect(html).not.toContain(HIDDEN_SERIES);
      expect(html).toContain(VISIBLE_SERIES);

      // 5. Back as the author (the original, signed-in `page`): unpublish.
      await dialog.getByRole('button', { name: 'Depubliceren' }).click();
      await dialog.getByRole('button', { name: 'Ja, depubliceren' }).click();
      await expect(dialog.getByRole('button', { name: 'Publiceren', exact: true })).toBeVisible({ timeout: 15_000 });

      // The SAME public link, reloaded by the SAME guest — `force-dynamic`
      // (page.tsx) means the very next request already sees the row gone.
      await guestPage.reload();
      await expect(guestPage.getByText('Deze grafiek is niet meer beschikbaar.')).toBeVisible({ timeout: 30_000 });
      const htmlAfterUnpublish = await guestPage.content();
      expect(htmlAfterUnpublish).not.toContain(HIDDEN_SERIES);
      expect(htmlAfterUnpublish).not.toContain(VISIBLE_SERIES);
      await expect(guestPage.locator('.recharts-line-curve')).toHaveCount(0);
    } finally {
      await guestContext.close();
    }
  });
});

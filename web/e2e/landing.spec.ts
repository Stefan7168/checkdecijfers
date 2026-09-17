// (a) The public face of the product, logged out. The one page every visitor
// sees first, and the one whose data reads are deliberately cached and
// fail-safe (ADR 035/046) — which is exactly why a silent degrade here is easy
// to miss: the gallery teaser renders a placeholder row instead of charts and
// nothing errors. This test insists on the real thing.
import { expect, test, useDutch } from './harness.ts';

test('the logged-out landing serves its headline and three real gallery charts', async ({
  page,
  context,
  baseURL,
}) => {
  await useDutch(context, baseURL!);
  await page.goto('/');

  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Chat met de officiële cijfers van Nederland',
  );

  // The teaser section always renders its heading; only the CARD area degrades
  // to a placeholder when no story could be built (#3, session 110 UX audit).
  // So the heading alone proves nothing — the charts have to be there.
  const teaser = page.locator('section', { has: page.getByRole('heading', { name: 'Verhalen uit de galerij' }) });
  await expect(teaser).toBeVisible();
  // Three curated stories, each one a rendered chart — not a skeleton, not an
  // icon: `.recharts-surface` is the chart's own SVG root.
  await expect(teaser.locator('.recharts-surface')).toHaveCount(3);
  // Every gallery card carries its headline figure (#253/ADR 046).
  await expect(teaser.locator('[data-testid="headline-figure"]')).toHaveCount(3);

  // No chargeable entry point on the public page: a logged-out visitor is
  // invited to start, never handed the composer.
  await expect(page.getByRole('link', { name: 'Begin met vragen' })).toBeVisible();
});

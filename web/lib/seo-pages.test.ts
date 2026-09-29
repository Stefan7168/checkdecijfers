// #353: the SEO landing pages' single indexing switch. While OFF every SEO
// page stays noindex like the rest of the pre-launch site; ON turns exactly
// these paths indexable (robots.ts allow-list, page metadata, sitemap).
import { describe, expect, it } from 'vitest';
import { APP_URL } from './app-url.ts';
import { SEO_PAGE_PATHS, SEO_PAGES_INDEXABLE, seoPageCanonical, seoPageRobots } from './seo-pages.ts';

describe('seo-pages', () => {
  it('lists the Netherlands page and no Eurostat page yet (owner, session 145)', () => {
    expect(SEO_PAGE_PATHS).toEqual(['/netherlands-cbs-data']);
  });

  it('is switched OFF until the graphmaker.studio domain is live', () => {
    expect(SEO_PAGES_INDEXABLE).toBe(false);
  });

  it('robots metadata follows the switch', () => {
    expect(seoPageRobots(false)).toEqual({ index: false, follow: false });
    expect(seoPageRobots(true)).toEqual({ index: true, follow: true });
  });

  it('canonical link exists only when ON, under the app URL', () => {
    expect(seoPageCanonical('/netherlands-cbs-data', false)).toBeUndefined();
    expect(seoPageCanonical('/netherlands-cbs-data', true)).toBe(`${APP_URL}/netherlands-cbs-data`);
  });
});

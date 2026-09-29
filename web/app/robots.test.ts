// #353: the robots file keeps the Phase-0 blanket disallow; with the SEO
// switch ON it allows exactly the SEO page paths and names the sitemap.
import { describe, expect, it, vi } from 'vitest';
import { APP_URL } from '../lib/app-url.ts';

const flag = vi.hoisted(() => ({ on: false }));
vi.mock('../lib/seo-pages.ts', async (importOriginal) => {
  const real = await importOriginal<typeof import('../lib/seo-pages.ts')>();
  return {
    ...real,
    get SEO_PAGES_INDEXABLE() {
      return flag.on;
    },
  };
});

import robots from './robots.ts';

describe('robots()', () => {
  it('OFF: disallows everything, no allow list, no sitemap', () => {
    flag.on = false;
    expect(robots()).toEqual({ rules: { userAgent: '*', disallow: '/' } });
  });

  it('ON: still disallows "/", allows exactly the SEO pages, names the sitemap', () => {
    flag.on = true;
    expect(robots()).toEqual({
      rules: { userAgent: '*', allow: ['/netherlands-cbs-data'], disallow: '/' },
      sitemap: `${APP_URL}/sitemap.xml`,
    });
  });
});

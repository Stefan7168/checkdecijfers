// #353: the sitemap lists the SEO pages only while the switch is ON; OFF it
// is empty (Next still serves /sitemap.xml, with no URLs).
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

import sitemap from './sitemap.ts';

describe('sitemap()', () => {
  it('OFF: no entries', () => {
    flag.on = false;
    expect(sitemap()).toEqual([]);
  });

  it('ON: one entry per SEO page under the app URL', () => {
    flag.on = true;
    expect(sitemap()).toEqual([{ url: `${APP_URL}/netherlands-cbs-data`, changeFrequency: 'weekly' }]);
  });
});

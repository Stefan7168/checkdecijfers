import type { MetadataRoute } from 'next';
import { APP_URL } from '../lib/app-url.ts';
import { SEO_PAGES_INDEXABLE, SEO_PAGE_PATHS } from '../lib/seo-pages.ts';

// #353 (session 145): the sitemap lists the SEO landing pages, and only while
// the switch in lib/seo-pages.ts is ON. OFF → an empty sitemap (Next still
// serves /sitemap.xml with no URLs, which is harmless pre-launch).
export default function sitemap(): MetadataRoute.Sitemap {
  if (!SEO_PAGES_INDEXABLE) return [];
  return SEO_PAGE_PATHS.map((path) => ({ url: `${APP_URL}${path}`, changeFrequency: 'weekly' as const }));
}

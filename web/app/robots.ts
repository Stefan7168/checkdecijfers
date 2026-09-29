import type { MetadataRoute } from "next";
import { APP_URL } from "../lib/app-url.ts";
import { SEO_PAGES_INDEXABLE, SEO_PAGE_PATHS } from "../lib/seo-pages.ts";

// Phase 0: internal/testing deployment, not the public launch — see the
// robots metadata note in layout.tsx. Remove/relax at public launch.
//
// #353 (session 145): with the SEO switch ON (lib/seo-pages.ts), exactly the
// SEO landing pages are allowed through the blanket disallow (a more specific
// allow wins over "/" for every major crawler) and the sitemap is named.
export default function robots(): MetadataRoute.Robots {
  if (!SEO_PAGES_INDEXABLE) {
    return {
      rules: {
        userAgent: "*",
        disallow: "/",
      },
    };
  }
  return {
    rules: {
      userAgent: "*",
      allow: [...SEO_PAGE_PATHS],
      disallow: "/",
    },
    sitemap: `${APP_URL}/sitemap.xml`,
  };
}

// #353 (owner idea, session 144; built session 145, 2026-09-29): the SEO
// landing pages — one static, LLM-free page per data source, built on the
// gallery pipeline — and their ONE indexing switch.
//
// Cheapest mechanism (CLAUDE.md conventions): a constant in this file, not an
// env var and not a database row. Flipping it is a one-line commit, made
// only once the graphmaker.studio domain is live (RUNBOOK "SEO landing
// pages"). While OFF every SEO page carries the same noindex as the rest of
// the pre-launch site (layout.tsx's blanket rule), robots.ts keeps its
// blanket disallow, and the sitemap is empty. ON: robots.ts allows exactly
// SEO_PAGE_PATHS, each page's metadata turns index + canonical under
// APP_URL, and /sitemap.xml lists them. Nothing else on the site changes.
//
// Only the Netherlands page exists (owner, session 145): the Eurostat page
// follows in the same shape once real Eurostat series are loaded AND
// curated — principle (c) forbids a page that promises more than we hold.
import type { Metadata } from 'next';
import { APP_URL } from './app-url.ts';

export const SEO_PAGES_INDEXABLE = false;

export const SEO_PAGE_PATHS = ['/netherlands-cbs-data'] as const;
export type SeoPagePath = (typeof SEO_PAGE_PATHS)[number];

export function seoPageRobots(indexable: boolean = SEO_PAGES_INDEXABLE): NonNullable<Metadata['robots']> {
  return indexable ? { index: true, follow: true } : { index: false, follow: false };
}

export function seoPageCanonical(path: SeoPagePath, indexable: boolean = SEO_PAGES_INDEXABLE): string | undefined {
  return indexable ? `${APP_URL}${path}` : undefined;
}

// /netherlands-cbs-data — the SEO landing page for the CBS source (#353,
// owner idea session 144, built session 145, 2026-09-29). Public, LLM-free
// Server Component in the exact /galerij shape: stripped SiteHeader, every
// string through getLang()/t(), the SAME cached curated-chart feed
// (web/lib/ontdek.ts — zero AI spend, ADR 035/046) and the SAME cached
// coverage list the landing shows (web/lib/coverage-disclosure.ts), here
// rendered open so a crawler and a reader both see the full holdings. NO
// server-action calls on this page load. Slug: source last (the later
// Eurostat page is /eurostat-data), owner-recommended spelling.
//
// Indexing: metadata follows lib/seo-pages.ts's one switch — noindex while
// OFF (the pre-launch posture of every page), index + canonical under
// APP_URL once the graphmaker.studio domain is live.
export const runtime = 'nodejs';

import type { Metadata } from 'next';
import Link from 'next/link';
import { getLang } from '../../lib/i18n/server.ts';
import { t } from '../../lib/i18n/messages.ts';
import { SiteHeader } from '../../components/site-header.tsx';
import { GalleryGrid } from '../../components/gallery.tsx';
import { CoverageDisclosureView } from '../../components/coverage-disclosure.tsx';
import { loadCoverageDisclosure } from '../../lib/coverage-disclosure.ts';
import { SEO_PAGES_INDEXABLE, seoPageCanonical, seoPageRobots } from '../../lib/seo-pages.ts';

const PATH = '/netherlands-cbs-data' as const;

export async function generateMetadata(): Promise<Metadata> {
  const lang = await getLang();
  const canonical = seoPageCanonical(PATH, SEO_PAGES_INDEXABLE);
  return {
    title: t(lang, 'seoNl.pageTitle'),
    description: t(lang, 'seoNl.metaDescription'),
    robots: seoPageRobots(SEO_PAGES_INDEXABLE),
    ...(canonical ? { alternates: { canonical } } : {}),
  };
}

export default async function NetherlandsCbsDataPage() {
  const [lang, coverage] = await Promise.all([getLang(), loadCoverageDisclosure()]);
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader stripped />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-12">
        <h1 className="text-2xl text-foreground">{t(lang, 'seoNl.heading')}</h1>
        <p className="mt-3 max-w-xl text-muted-foreground">{t(lang, 'seoNl.intro1')}</p>
        <p className="mt-2 max-w-xl text-muted-foreground">{t(lang, 'seoNl.intro2')}</p>

        <div className="mt-8">
          {/* The page's own <h2>s frame the grid, so each card's title
              renders as <h3> (heading order, as GalleryTeaser does). */}
          <h2 className="text-lg text-foreground">{t(lang, 'seoNl.chartsHeading')}</h2>
          <div className="mt-4">
            <GalleryGrid headingLevel={3} />
          </div>
        </div>

        <section className="mt-12">
          <h2 className="text-lg text-foreground">{t(lang, 'seoNl.holdingsHeading')}</h2>
          <p className="mt-2 max-w-xl text-sm text-muted-foreground">{t(lang, 'seoNl.holdingsIntro')}</p>
          <div className="mt-4">
            <CoverageDisclosureView coverage={coverage} defaultOpen />
          </div>
        </section>

        <div className="mt-12 border-t border-border pt-8 text-center">
          <Link
            href="/login"
            className="inline-block rounded-md bg-primary px-5 py-2.5 font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {t(lang, 'landing.ctaStart')}
          </Link>
        </div>
      </main>
    </div>
  );
}

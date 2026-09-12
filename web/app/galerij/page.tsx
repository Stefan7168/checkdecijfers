// /galerij — the public gallery of curated chart stories (#237/ADR 046, the
// "public face" journey-programme package). Public, LLM-free Server
// Component, same shell pattern as /werkwijze: stripped SiteHeader, every
// string through getLang()/t(), explicit noindex metadata (belt-and-
// suspenders alongside the site-wide blanket noindex in layout.tsx). NO
// server-action calls happen on this page load: ChartView's own public-page
// rule (chart.tsx's openStory) never fires generateInsights for an
// anonymous visitor, and the story data itself comes from
// web/lib/ontdek.ts's deterministic, cached, LLM-free curated-chart feed —
// zero AI spend, exactly like the landing's Ontdek section (ADR 035).
export const runtime = 'nodejs';

import type { Metadata } from 'next';
import Link from 'next/link';
import { getLang } from '../../lib/i18n/server.ts';
import { t } from '../../lib/i18n/messages.ts';
import { SiteHeader } from '../../components/site-header.tsx';
import { GalleryGrid } from '../../components/gallery.tsx';

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: t(await getLang(), 'gallery.pageTitle'),
    robots: { index: false, follow: false },
  };
}

export default async function GaleryPage() {
  const lang = await getLang();
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader stripped />
      {/* Fix-wave finding 3: max-w-3xl (768px) never let gallery.tsx's
          `lg:grid-cols-2` fire — the desktop page rendered as one very
          tall column. max-w-6xl gives the two-column grid room; the intro
          paragraph below keeps its own narrower max-w-xl for readability. */}
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-12">
        <h1 className="text-2xl text-foreground">{t(lang, 'gallery.heading')}</h1>
        <p className="mt-3 max-w-xl text-muted-foreground">{t(lang, 'gallery.intro')}</p>
        <p className="mt-2 text-sm text-muted-foreground">{t(lang, 'gallery.embedComingSoon')}</p>

        <div className="mt-8">
          <GalleryGrid />
        </div>

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

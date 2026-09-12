// The public gallery of curated chart stories (#237/ADR 046). Shared between
// the landing's gallery teaser (first three stories) and the full /galerij
// page — one card renderer and one data fetch path, so the two surfaces
// never drift. Server components: the data work happens in
// web/lib/ontdek.ts's getGalleryStories (the SAME deterministic, LLM-free
// pipeline as the Ontdek section, ADR 035), and the ONLY client-side pieces
// are the already-existing ChartView chrome (Present/Style/Insights) — no
// new client component, no server action on mount (ChartView's own
// public-page rule: an anonymous visitor never triggers generateInsights,
// see chart.tsx's openStory).
import Link from 'next/link';
import type { CuratedChart } from '../backend/chart/index.ts';
import { getGalleryStories } from '../lib/ontdek.ts';
import { getLang } from '../lib/i18n/server.ts';
import { t, type Lang, type MessageKey } from '../lib/i18n/messages.ts';
import { templateById, type ChartTemplateId } from '../lib/chart-templates.ts';
import { GALLERY_STORIES } from '../backend/chart/index.ts';
import { ChartView } from './chart.tsx';

/** Every gallery slug's chosen "look" (src/chart/curated.ts's `look` field,
 * kept as a bare string there per the src/-never-imports-web/lib module
 * boundary) resolved here, on the web side, to a real ChartTemplateId. A
 * slug with no matching definition, or an unrecognised look string, falls
 * back to 'standard' — never a thrown error on the public surface. */
function lookFor(slug: string): ChartTemplateId {
  const def = GALLERY_STORIES.find((d) => d.slug === slug);
  const id = def?.look;
  const known: ChartTemplateId[] = ['standard', 'classic', 'newsroom', 'presentation', 'social', 'minimal'];
  return known.includes(id as ChartTemplateId) ? (id as ChartTemplateId) : 'standard';
}

function GalleryCard({ chart, lang }: { chart: CuratedChart; lang: Lang }) {
  const titleKey = `gallery.story.${chart.slug}.title` as MessageKey;
  const leadKey = `gallery.story.${chart.slug}.lead` as MessageKey;
  return (
    <article className="rounded-xl border border-border bg-card p-4">
      <h3 className="text-lg text-foreground">{t(lang, titleKey)}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{t(lang, leadKey)}</p>
      <div className="mt-3">
        <ChartView
          spec={chart.spec}
          frameless
          initialPresentation={templateById(lookFor(chart.slug)).overrides}
          initialPanel="story"
        />
      </div>
    </article>
  );
}

function CardGrid({ charts, lang }: { charts: CuratedChart[]; lang: Lang }) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {charts.map((chart) => (
        <GalleryCard key={chart.slug} chart={chart} lang={lang} />
      ))}
    </div>
  );
}

/** The full gallery grid — every built story. Fail-safe like the Ontdek
 * section (ADR 035): no stories built (e.g. a cold DB) renders as nothing,
 * never a broken empty grid. */
export async function GalleryGrid() {
  const [charts, lang] = await Promise.all([getGalleryStories(), getLang()]);
  if (charts.length === 0) return null;
  return <CardGrid charts={charts} lang={lang} />;
}

/** The landing's gallery teaser (WP-E): the first three stories, plus a link
 * to the full gallery. */
export async function GalleryTeaser() {
  const [charts, lang] = await Promise.all([getGalleryStories(), getLang()]);
  if (charts.length === 0) return null;
  return (
    <section className="border-b border-border py-12">
      <h2 className="text-2xl text-foreground">{t(lang, 'gallery.teaserHeading')}</h2>
      <div className="mt-6">
        <CardGrid charts={charts.slice(0, 3)} lang={lang} />
      </div>
      <Link href="/galerij" className="mt-6 inline-block font-medium text-primary hover:underline">
        {t(lang, 'gallery.teaserAllLink')}
      </Link>
    </section>
  );
}

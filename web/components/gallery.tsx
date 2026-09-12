// The public gallery of curated chart stories (#237/ADR 046). Shared between
// the landing's gallery teaser (first three stories, compact) and the full
// /galerij page — one card renderer and one data fetch path, so the two
// surfaces never drift. Server components: the data work happens in
// web/lib/ontdek.ts's getGalleryStories (the SAME deterministic, LLM-free
// pipeline as the Ontdek section, ADR 035), and the ONLY client-side pieces
// are the already-existing ChartView chrome (Present/Style/Insights) — no
// new client component, no server action on mount (ChartView's own
// public-page rule: an anonymous visitor never triggers generateInsights,
// see chart.tsx's openStory; and openStory's `track: false` option keeps the
// auto-opened first card from counting as a usage event either).
import Link from 'next/link';
import type { CuratedChart } from '../backend/chart/index.ts';
import { getGalleryStories } from '../lib/ontdek.ts';
import { getLang } from '../lib/i18n/server.ts';
import { t, type Lang, type MessageKey } from '../lib/i18n/messages.ts';
import { CHART_TEMPLATES, templateById, type ChartTemplateId } from '../lib/chart-templates.ts';
import { GALLERY_STORIES } from '../backend/chart/index.ts';
import { ChartView } from './chart.tsx';

/** Every gallery slug's chosen "look" (src/chart/curated.ts's `look` field,
 * kept as a bare string there per the src/-never-imports-web/lib module
 * boundary) resolved here, on the web side, to a real ChartTemplateId. A
 * slug with no matching definition, or an unrecognised look string, falls
 * back to 'standard' — never a thrown error on the public surface. Checked
 * against `CHART_TEMPLATES` itself (not a re-declared literal list), so a
 * template ever renamed/removed there is reflected here automatically. */
function lookFor(slug: string): ChartTemplateId {
  const def = GALLERY_STORIES.find((d) => d.slug === slug);
  const id = def?.look;
  return CHART_TEMPLATES.some((tpl) => tpl.id === id) ? (id as ChartTemplateId) : 'standard';
}

function GalleryCard({
  chart,
  lang,
  openByDefault,
  compact,
}: {
  chart: CuratedChart;
  lang: Lang;
  /** Fix-wave finding 5: only the FIRST card on /galerij mounts with Insights
   * already open, as the one worked example — twelve panels open at once
   * (each locking its own chart's controls while open) made the page
   * unreadable. Every other card opens on the reader's own click of the
   * existing "Inzichten"/"Insights" trigger, exactly like any other chart. */
  openByDefault: boolean;
  /** Fix-wave finding 6: the landing teaser shows the question + the chart
   * only — no Insights pre-opened — so three cards read as a short teaser,
   * not three more full-height panels stacked under the hero. */
  compact: boolean;
}) {
  const titleKey = `gallery.story.${chart.slug}.title` as MessageKey;
  return (
    <article className="rounded-xl border border-border bg-card p-4">
      <h3 className="text-lg text-foreground">{t(lang, titleKey)}</h3>
      <div className="mt-3">
        <ChartView
          spec={chart.spec}
          frameless
          initialPresentation={templateById(lookFor(chart.slug)).overrides}
          initialPanel={!compact && openByDefault ? 'story' : undefined}
        />
      </div>
    </article>
  );
}

function CardGrid({
  charts,
  lang,
  compact = false,
}: {
  charts: CuratedChart[];
  lang: Lang;
  compact?: boolean;
}) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {charts.map((chart, i) => (
        <GalleryCard key={chart.slug} chart={chart} lang={lang} openByDefault={i === 0} compact={compact} />
      ))}
    </div>
  );
}

/** The full gallery grid — every built story, the first pre-opened as the
 * worked example. Fail-safe like the Ontdek section (ADR 035): no stories
 * built (e.g. a cold DB) renders as nothing, never a broken empty grid. */
export async function GalleryGrid() {
  const [charts, lang] = await Promise.all([getGalleryStories(), getLang()]);
  if (charts.length === 0) return null;
  return <CardGrid charts={charts} lang={lang} />;
}

/** The landing's gallery teaser (WP-E): the first three stories, compact
 * (question + chart, no Insights pre-opened), plus a link to the full
 * gallery. */
export async function GalleryTeaser() {
  const [charts, lang] = await Promise.all([getGalleryStories(), getLang()]);
  if (charts.length === 0) return null;
  return (
    <section className="border-b border-border py-12">
      <h2 className="text-2xl text-foreground">{t(lang, 'gallery.teaserHeading')}</h2>
      <div className="mt-6">
        <CardGrid charts={charts.slice(0, 3)} lang={lang} compact />
      </div>
      <Link href="/galerij" className="mt-6 inline-block font-medium text-primary hover:underline">
        {t(lang, 'gallery.teaserAllLink')}
      </Link>
    </section>
  );
}

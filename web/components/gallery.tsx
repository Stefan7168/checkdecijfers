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
import { Skeleton } from './ui/skeleton.tsx';

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
  headingLevel = 3,
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
  /** Session 110 a11y audit (#Fix-now 4): the card title's heading level.
   * Defaults to 3 (the landing teaser nests it under the landing page's own
   * <h2>Stories from the gallery</h2>); the standalone /galerij page passes
   * 2, since there the card sits directly under the page's own <h1> with no
   * <h2> in between (axe-core heading-order, moderate). */
  headingLevel?: 2 | 3;
}) {
  const titleKey = `gallery.story.${chart.slug}.title` as MessageKey;
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <article className="rounded-xl border border-border bg-card p-5 sm:p-6">
      <Heading className="text-lg text-foreground">{t(lang, titleKey)}</Heading>
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

/** #3 (session 110 UX audit): the honest "still loading" state for a cold
 * read (web/lib/deadline.ts's ANONYMOUS_READ_DEADLINE_MS degrade, #190) —
 * replaces the old silent `return null`, which on a slow serverless cold
 * start rendered the /galerij heading/intro/CTA with zero cards (and made
 * the landing's teaser vanish outright) with no skeleton and no message, so
 * the page read as broken rather than loading. The placeholder cards are
 * aria-hidden (loading-skeletons.tsx's own convention: nothing new for a
 * screen reader to announce until real content lands); the note itself is
 * a normal, announced paragraph so a reader who reloads knows why.
 * `count` mirrors the caller's own card count (full grid vs. teaser). */
function GalleryLoadingRow({ lang, count }: { lang: Lang; count: number }) {
  return (
    <div>
      <div
        className={`grid gap-6 ${count > 2 ? 'lg:grid-cols-3' : count > 1 ? 'lg:grid-cols-2' : ''}`}
        aria-hidden="true"
      >
        {Array.from({ length: count }, (_, i) => (
          <div key={i} className="rounded-xl border border-border bg-card p-5 sm:p-6">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="mt-4 h-48 w-full" />
          </div>
        ))}
      </div>
      <p className="mt-4 text-sm text-muted-foreground">{t(lang, 'gallery.loadingNote')}</p>
    </div>
  );
}

function CardGrid({
  charts,
  lang,
  compact = false,
  headingLevel,
  columns = 2,
}: {
  charts: CuratedChart[];
  lang: Lang;
  compact?: boolean;
  headingLevel?: 2 | 3;
  /** Wide-screen column count: two on /galerij, three for the landing's
   * teaser (WP-LOOK part c — the landing is max-w-6xl now, so three compact
   * cards fit in one row). */
  columns?: 2 | 3;
}) {
  return (
    <div className={`grid gap-6 ${columns === 3 ? 'lg:grid-cols-3' : 'lg:grid-cols-2'}`}>
      {charts.map((chart, i) => (
        <GalleryCard
          key={chart.slug}
          chart={chart}
          lang={lang}
          openByDefault={i === 0}
          compact={compact}
          headingLevel={headingLevel}
        />
      ))}
    </div>
  );
}

/** The full gallery grid — every built story, the first pre-opened as the
 * worked example. Fail-safe like the Ontdek section (ADR 035): no stories
 * built (e.g. a cold DB, or a build still in flight — #190) never renders a
 * broken empty grid — it renders GalleryLoadingRow's honest placeholder
 * instead of the old silent `null`. */
export async function GalleryGrid({ headingLevel }: { headingLevel?: 2 | 3 } = {}) {
  const [charts, lang] = await Promise.all([getGalleryStories(), getLang()]);
  if (charts.length === 0) return <GalleryLoadingRow lang={lang} count={2} />;
  return <CardGrid charts={charts} lang={lang} headingLevel={headingLevel} />;
}

/** The landing's gallery teaser (WP-E): the first three stories, compact
 * (question + chart, no Insights pre-opened), plus a link to the full
 * gallery. #3 (session 110 UX audit): the section itself (heading + link)
 * always renders now — only the card area degrades to GalleryLoadingRow —
 * so a cold read no longer makes the whole teaser vanish from the landing
 * page. */
export async function GalleryTeaser({ excludeSlug }: { excludeSlug?: string } = {}) {
  const [charts, lang] = await Promise.all([getGalleryStories(), getLang()]);
  // WP-LOOK part (c): the landing's hero already shows one story as the
  // real answer; the teaser skips that one so the page never shows the same
  // chart twice.
  const rest = excludeSlug === undefined ? charts : charts.filter((c) => c.slug !== excludeSlug);
  return (
    <section className="border-b border-border py-12">
      <h2 className="text-2xl text-foreground">{t(lang, 'gallery.teaserHeading')}</h2>
      <div className="mt-6">
        {rest.length === 0 ? (
          <GalleryLoadingRow lang={lang} count={3} />
        ) : (
          <CardGrid charts={rest.slice(0, 3)} lang={lang} compact columns={3} />
        )}
      </div>
      <Link href="/galerij" className="mt-6 inline-block font-medium text-primary hover:underline">
        {t(lang, 'gallery.teaserAllLink')}
      </Link>
    </section>
  );
}

/** The slug the landing's hero prefers (WP-LOOK part c): inflation is the
 * one series every reader has an opinion about. If it did not build (a cold
 * database, a freshness refusal), the first built story stands in — the
 * hero is "a real chart above the fold", not "the inflation chart". */
export const HERO_STORY_SLUG = 'inflatie';

/** Which story the hero shows for a given built set — exported so the
 * landing can hand the SAME slug to the teaser's `excludeSlug`. `null` when
 * nothing is built yet (the hero then renders its loading placeholder). */
export function heroStoryFor(charts: CuratedChart[]): CuratedChart | null {
  return charts.find((c) => c.slug === HERO_STORY_SLUG) ?? charts[0] ?? null;
}

/** WP-LOOK part (c), the homepage's hero: a real question and the product's
 * REAL answer card — the same ChartView, the same curated pipeline (ADR 035/
 * 046), the same digits-bound-to-a-spec rule — above the fold, so a visitor
 * sees what they get before reading a word about it. The question is the
 * story's own gallery title, set as a chat bubble the way the workspace
 * shows a sent question; the card below it is the part-(a) answer card
 * as-is (title, headline figure, chart, caveats, source line, action row).
 * Nothing is pre-opened, nothing is tracked, no generateInsights for an
 * anonymous visitor (ChartView's own public-page rule). A cold read renders
 * one honest placeholder card instead of an empty column. */
export async function HeroStory() {
  const [charts, lang] = await Promise.all([getGalleryStories(), getLang()]);
  const chart = heroStoryFor(charts);
  if (chart === null) return <GalleryLoadingRow lang={lang} count={1} />;
  const titleKey = `gallery.story.${chart.slug}.title` as MessageKey;
  return (
    <div>
      <p className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-muted px-4 py-2.5 text-foreground">
        {t(lang, titleKey)}
      </p>
      <article
        aria-label={t(lang, titleKey)}
        className="mt-3 rounded-xl border border-border bg-card p-5 shadow-sm sm:p-6"
      >
        <ChartView
          spec={chart.spec}
          frameless
          initialPresentation={templateById(lookFor(chart.slug)).overrides}
        />
      </article>
    </div>
  );
}

// The public face of checkdecijfers.nl — what a logged-out visitor sees at '/'
// (session-51 owner decision: the homepage IS the product, not a bare login
// redirect). Server component: NO LLM, NO chargeable entry point. The ONLY
// data reads are the deterministic curated-chart pipeline (session 52,
// ADR 035 — cached, fail-safe, LLM-free; they amend the original "no data
// reads" framing of #98, see the reconciled row), served here through
// HeroStory / GalleryTeaser / getGalleryStories (#237/ADR 046).
//
// WP-LOOK part (c), session 144 (2026-09-29, ADR 063): the page leads with a
// REAL chart above the fold — one story's question as a chat bubble and the
// product's own answer card under it (the part-(a) card, same ChartView, same
// pipeline, every digit bound to a spec string). That hero replaces the old
// frozen text-only "real example" block (the consumentenvertrouwen juni 2026
// = −39 cell, sessions 51–86, #193): a live, sourced chart is a stronger
// version of the same promise, and it can never go stale against the frozen
// benchmark key. The gallery teaser skips the hero's story so no chart shows
// twice. The frozen block's two rules still hold for anything rendered here:
// never invent a number (principle a), and never add a status suffix the real
// pipeline does not render (#193).
//
// The anonymous-trial chat (#53, ADR 036) is built and DORMANT: <TrialSectie />
// renders nothing until the supervised go-live sets TRIAL_ENABLED + the trial
// key + the ip-hash secret and seeds the pot — until then the CTA routes to
// /login, byte-identically.
//
// WP218 phase 4 (#219), Task 3 (Sweep B): every visible string goes through
// the i18n catalogue via getLang()/t() (Server Component). The hero chart's
// own text (title, source line, caveats) is the backend-built Dutch the real
// pipeline produces, in both languages, same as every chart on the site.
import Link from 'next/link';
import type { CoverageDisclosure } from '../lib/coverage-disclosure.ts';
import { getLang } from '../lib/i18n/server.ts';
import { t } from '../lib/i18n/messages.ts';
import { getGalleryStories } from '../lib/ontdek.ts';
import { CoverageDisclosureView } from './coverage-disclosure.tsx';
import { GalleryTeaser, HeroStory, heroStoryFor } from './gallery.tsx';
import { SiteHeader } from './site-header.tsx';
import { TrialSectie } from './trial.tsx';

const PRIMARY_CTA =
  'rounded-md bg-primary px-5 py-2.5 font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';
const SECONDARY_CTA =
  'rounded-md border border-border bg-card px-5 py-2.5 font-medium text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

export async function Landing({ coverage = null }: { coverage?: CoverageDisclosure | null } = {}) {
  // One cached read (web/lib/ontdek.ts) serves the hero AND tells the teaser
  // which story to skip; HeroStory/GalleryTeaser read the same in-process
  // promise, so this costs nothing extra.
  const [lang, stories] = await Promise.all([getLang(), getGalleryStories()]);
  const heroSlug = heroStoryFor(stories)?.slug;
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader stripped />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4">
        {/* Hero: the pitch on the left, the real thing on the right. On a
            phone the pitch comes first and the chart is one swipe down —
            the chart still opens above the fold's second screen. */}
        <section className="grid gap-10 border-b border-border py-12 lg:grid-cols-12 lg:items-start lg:gap-12 lg:py-16">
          <div className="lg:col-span-5 lg:pt-10">
            <h1 className="max-w-xl text-4xl leading-[1.1] tracking-tight text-foreground sm:text-5xl">
              {t(lang, 'landing.heroTitleV3')}
            </h1>
            <p className="mt-5 max-w-xl text-lg text-muted-foreground">{t(lang, 'landing.heroLeadV3')}</p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link href="/login" className={PRIMARY_CTA}>
                {t(lang, 'landing.ctaStart')}
              </Link>
              <Link href="/galerij" className={SECONDARY_CTA}>
                {t(lang, 'landing.ctaGallery')}
              </Link>
            </div>
            <p className="mt-6 max-w-xl text-sm text-muted-foreground">{t(lang, 'landing.heroClaim')}</p>
          </div>
          <div className="min-w-0 lg:col-span-7">
            <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t(lang, 'landing.heroExampleLabel')}
            </p>
            <HeroStory />
          </div>
        </section>

        {/* The #53 anonymous trial — dormant until the supervised go-live (ADR 036) */}
        <TrialSectie />

        {/* How it works — the honest mechanism in four steps (WP-B, journey
            programme phase 3 R5.4). One row of four on a wide screen, 2x2 on
            a tablet, a list on a phone. */}
        <section id="hoe-het-werkt" className="border-b border-border py-12">
          {/* `over-dit-project` is the site footer's "Over dit project" anchor
              (site-footer.tsx renders it on "/"): the logged-in workspace has
              a section with that id, the logged-out landing points it at this
              how-it-works heading — never a dead link (ADR 033 D6). */}
          <h2 id="over-dit-project" className="text-2xl text-foreground">
            {t(lang, 'landing.howItWorksHeading')}
          </h2>
          <ol className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            <li>
              <p className="tnum text-sm font-semibold text-primary">1</p>
              <h3 className="mt-1 text-lg text-foreground">{t(lang, 'landing.step1Title')}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{t(lang, 'landing.step1Body')}</p>
            </li>
            <li>
              <p className="tnum text-sm font-semibold text-primary">2</p>
              <h3 className="mt-1 text-lg text-foreground">{t(lang, 'landing.step2Title')}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{t(lang, 'landing.step2Body')}</p>
            </li>
            <li>
              <p className="tnum text-sm font-semibold text-primary">3</p>
              <h3 className="mt-1 text-lg text-foreground">{t(lang, 'landing.step3Title')}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{t(lang, 'landing.step3Body')}</p>
            </li>
            <li>
              <p className="tnum text-sm font-semibold text-primary">4</p>
              <h3 className="mt-1 text-lg text-foreground">{t(lang, 'landing.step4Title')}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{t(lang, 'landing.step4Body')}</p>
            </li>
          </ol>
        </section>

        {/* #237/ADR 046: three more stories from the same deterministic,
            LLM-free curated pipeline (ADR 035), minus the hero's own. */}
        <GalleryTeaser excludeSlug={heroSlug} />

        {/* WP-E (R4): the coverage disclosure — no example handler is passed
          * here, so CoverageDisclosureView renders each example as plain
          * text ("bijvoorbeeld: …") instead of a click-to-fill button; the
          * landing page has no composer to fill. */}
        {coverage ? (
          <section className="border-b border-border py-12">
            <h2 className="text-2xl text-foreground">{t(lang, 'coverage.landingHeading')}</h2>
            <div className="mt-4 max-w-xl">
              <CoverageDisclosureView coverage={coverage} />
            </div>
          </section>
        ) : null}

        {/* Credits, plainly */}
        <section className="py-12">
          <h2 className="text-2xl text-foreground">{t(lang, 'landing.pricingHeading')}</h2>
          <p className="mt-3 max-w-xl text-muted-foreground">{t(lang, 'landing.pricingBody')}</p>
          <Link href="/login" className={`mt-6 inline-block ${PRIMARY_CTA}`}>
            {t(lang, 'common.createFreeAccount')}
          </Link>
        </section>
      </main>
    </div>
  );
}

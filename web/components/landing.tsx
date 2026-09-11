// The public face of checkdecijfers.nl — what a logged-out visitor sees at '/'
// (session-51 owner decision: the homepage IS the product, not a bare login
// redirect). Server component: NO LLM, NO chargeable entry point. The ONLY
// data reads are the deterministic Ontdek discovery charts (session 52,
// ADR 035 — cached, fail-safe, LLM-free; they amend the original "no data
// reads" framing of #98, see the reconciled row). The example answer below is
// a REAL, live-verified CBS cell (frozen verification task CC1:
// consumentenvertrouwen juni 2026 = −39, Definitief, tabel 83693NED —
// re-verified LLM-free on production 2026-07-17) rendered in the product's
// real answer shape; refresh it CONSCIOUSLY when the frozen key ever changes,
// never invent one (principle a).
//
// ⚠ #193 (2026-08-07, corrected 2026-08-26): NEITHER the body NOR the source
// line carries a status suffix, and that is correct — do not "helpfully" add
// one back anywhere. `provisionalDisplay` (src/sources/registry.ts) maps only
// Voorlopig and NaderVoorlopig, so the real pipeline renders a definitive
// cell with no status text at all — not in the body (fixed here originally),
// and not in the source line either: `buildAttributionLine`
// (src/answer/compose/format.ts) is the ONE builder for that sentence on
// every surface, and its shape is fixed — Bron/tabel, sync date, period,
// license — with no status field, for any status value. An earlier version
// of this fix moved the fabricated "(definitief cijfer)" suffix INTO the
// source line ("Status bij CBS: definitief.") instead of removing it,
// re-introducing the exact bug it was fixing one line down — a claim about
// where the pipeline shows the status that the pipeline does not do anywhere.
// The anonymous-trial chat (#53, ADR 036) is
// built and DORMANT: <TrialSectie /> renders nothing until the supervised
// go-live sets TRIAL_ENABLED + the trial key + the ip-hash secret and seeds
// the pot — until then the CTA routes to /login, byte-identically.
//
// WP218 phase 4 (#219), Task 3 (Sweep B): every visible string now goes
// through the i18n catalogue via getLang()/t() (Server Component). The ONE
// deliberate exception is the "real example" answer block below — it mimics
// the product's own real answer shape (body + R4 attribution line), and the
// backend answer pipeline that produces that shape stays Dutch-only (out of
// scope per the design doc's own owner decision) — translating this frozen
// demo to English would show a shape the live product cannot actually
// produce in English, which is a worse inaccuracy than a Dutch demo on an
// English page. It stays Dutch verbatim in both languages, same as
// FOOTER_ATTRIBUTION and the other backend-built strings this sweep leaves
// untouched (see docs/superpowers/specs/2026-09-09-language-switch-design.md
// §1).
import Link from 'next/link';
import { getLang } from '../lib/i18n/server.ts';
import { t } from '../lib/i18n/messages.ts';
import { OntdekSectie } from './ontdek.tsx';
import { SiteHeader } from './site-header.tsx';
import { TrialSectie } from './trial.tsx';

const EXAMPLE_QUESTION = 'Wat is het consumentenvertrouwen in juni 2026?';

export async function Landing() {
  const lang = await getLang();
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader stripped />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4">
        {/* Masthead */}
        <section className="border-b border-border py-14 text-center sm:py-20">
          <h1 className="mx-auto max-w-2xl text-4xl leading-tight text-foreground sm:text-5xl">
            {t(lang, 'landing.heroTitle')}
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-lg text-muted-foreground">
            {t(lang, 'landing.heroSubtitle')}
          </p>
          <div className="mt-8 flex items-center justify-center gap-3">
            <Link
              href="/login"
              className="rounded-md bg-primary px-5 py-2.5 font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              {t(lang, 'landing.ctaStart')}
            </Link>
            <a
              href="#hoe-het-werkt"
              className="rounded-md border border-border bg-card px-5 py-2.5 font-medium text-foreground hover:bg-muted"
            >
              {t(lang, 'landing.ctaHowItWorks')}
            </a>
          </div>
        </section>

        {/* The #53 anonymous trial — dormant until the supervised go-live (ADR 036) */}
        <TrialSectie />

        {/* A real answer, in the product's real shape — Dutch verbatim always, see the file-header note. */}
        <section className="border-b border-border py-12">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t(lang, 'landing.exampleLabel')}
          </p>
          <div className="mt-4 space-y-3">
            <div className="ml-auto max-w-md rounded-lg bg-muted px-4 py-3 text-foreground">
              {EXAMPLE_QUESTION}
            </div>
            <div className="max-w-xl rounded-lg border border-border bg-card px-4 py-3">
              <p className="text-foreground">
                Het consumentenvertrouwen in Nederland was in juni 2026{' '}
                <span className="tnum font-semibold">−39</span>.
              </p>
              <p className="mt-2 border-t border-border pt-2 text-xs text-muted-foreground">
                Bron: CBS StatLine, tabel 83693NED — Consumentenvertrouwen,
                economisch klimaat en koopbereidheid; gecorrigeerd. Periode: juni
                2026. Licentie: CC BY 4.0.
              </p>
            </div>
          </div>
        </section>

        {/* How it works — the honest mechanism, now in four steps
            (WP-B, journey programme phase 3 R5.4: a fourth "Publiceer"/
            "Publish" step). 2x2 on `sm`+ so the grid stays balanced at 4. */}
        <section id="hoe-het-werkt" className="border-b border-border py-12">
          {/* `over-dit-project` is the site footer's "Over dit project" anchor
              (site-footer.tsx renders it on "/"): the logged-in workspace has
              a section with that id, the logged-out landing points it at this
              how-it-works heading — never a dead link (ADR 033 D6). */}
          <h2 id="over-dit-project" className="text-2xl text-foreground">
            {t(lang, 'landing.howItWorksHeading')}
          </h2>
          <ol className="mt-6 grid gap-6 sm:grid-cols-2">
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

        {/* Free discovery charts — deterministic, LLM-free (ADR 035) */}
        <OntdekSectie />

        {/* Credits, plainly */}
        <section className="py-12">
          <h2 className="text-2xl text-foreground">{t(lang, 'landing.pricingHeading')}</h2>
          <p className="mt-3 max-w-xl text-muted-foreground">{t(lang, 'landing.pricingBody')}</p>
          <Link
            href="/login"
            className="mt-6 inline-block rounded-md bg-primary px-5 py-2.5 font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {t(lang, 'common.createFreeAccount')}
          </Link>
        </section>
      </main>
    </div>
  );
}

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
// never invent one (principle a). The anonymous-trial chat (#53, ADR 036) is
// built and DORMANT: <TrialSectie /> renders nothing until the supervised
// go-live sets TRIAL_ENABLED + the trial key + the ip-hash secret and seeds
// the pot — until then the CTA routes to /login, byte-identically.
import Link from 'next/link';
import { OntdekSectie } from './ontdek.tsx';
import { SiteHeader } from './site-header.tsx';
import { TrialSectie } from './trial.tsx';

const EXAMPLE_QUESTION = 'Wat is het consumentenvertrouwen in juni 2026?';

export function Landing() {
  return (
    <div className="flex min-h-screen flex-col bg-paper">
      <SiteHeader stripped />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4">
        {/* Masthead */}
        <section className="border-b border-line-strong py-14 text-center sm:py-20">
          <h1 className="mx-auto max-w-2xl text-4xl leading-tight text-ink sm:text-5xl">
            Chat met de officiële cijfers van Nederland
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-lg text-ink-soft">
            Stel je vraag in gewone taal. Check de Cijfers rekent het antwoord uit
            op officiële CBS-statistieken — elk getal herleidbaar tot een
            CBS-tabel, met bron en datum erbij.
          </p>
          <div className="mt-8 flex items-center justify-center gap-3">
            <Link
              href="/login"
              className="rounded-md bg-accent px-5 py-2.5 font-medium text-white hover:bg-accent-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              Begin met vragen
            </Link>
            <a
              href="#hoe-het-werkt"
              className="rounded-md border border-line-strong bg-paper-raised px-5 py-2.5 font-medium text-ink hover:bg-paper-sunken"
            >
              Hoe het werkt
            </a>
          </div>
        </section>

        {/* The #53 anonymous trial — dormant until the supervised go-live (ADR 036) */}
        <TrialSectie />

        {/* A real answer, in the product's real shape */}
        <section className="border-b border-line py-12">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">
            Zo antwoordt het product — echt voorbeeld
          </p>
          <div className="mt-4 space-y-3">
            <div className="ml-auto max-w-md rounded-lg bg-paper-sunken px-4 py-3 text-ink">
              {EXAMPLE_QUESTION}
            </div>
            <div className="max-w-xl rounded-lg border border-line bg-paper-raised px-4 py-3">
              <p className="text-ink">
                Het consumentenvertrouwen in Nederland was in juni 2026{' '}
                <span className="tnum font-semibold">−39</span> (definitief cijfer).
              </p>
              <p className="mt-2 border-t border-line pt-2 text-xs text-ink-muted">
                Bron: CBS StatLine, tabel 83693NED — Consumentenvertrouwen,
                economisch klimaat en koopbereidheid; gecorrigeerd. Periode: juni
                2026. Licentie: CC BY 4.0.
              </p>
            </div>
          </div>
        </section>

        {/* How it works — the honest mechanism, in three steps */}
        <section id="hoe-het-werkt" className="border-b border-line py-12">
          <h2 className="text-2xl text-ink">Geen gokwerk, maar rekenwerk</h2>
          <ol className="mt-6 grid gap-6 sm:grid-cols-3">
            <li>
              <p className="tnum text-sm font-semibold text-accent">1</p>
              <h3 className="mt-1 text-lg text-ink">Jij vraagt</h3>
              <p className="mt-1 text-sm text-ink-soft">
                In gewone taal — &ldquo;wat doet de inflatie?&rdquo;, &ldquo;hoe
                hard groeide de economie?&rdquo;
              </p>
            </li>
            <li>
              <p className="tnum text-sm font-semibold text-accent">2</p>
              <h3 className="mt-1 text-lg text-ink">Code rekent</h3>
              <p className="mt-1 text-sm text-ink-soft">
                Het antwoord komt uit onze database met officiële CBS-cijfers —
                deterministische berekening, geen taalmodel dat cijfers verzint.
              </p>
            </li>
            <li>
              <p className="tnum text-sm font-semibold text-accent">3</p>
              <h3 className="mt-1 text-lg text-ink">Bron erbij</h3>
              <p className="mt-1 text-sm text-ink-soft">
                Elk getal met CBS-tabel, periode en publicatiestatus. Weten we het
                niet zeker, dan zeggen we dat — liever geen antwoord dan een
                verzonnen antwoord.
              </p>
            </li>
          </ol>
        </section>

        {/* Free discovery charts — deterministic, LLM-free (ADR 035) */}
        <OntdekSectie />

        {/* Credits, plainly */}
        <section className="py-12">
          <h2 className="text-2xl text-ink">Eerlijke prijs per vraag</h2>
          <p className="mt-3 max-w-xl text-ink-soft">
            Je betaalt per vraag met credits — geen abonnement. Een account
            aanmaken is gratis en zo gebeurd: e-mailadres invullen, inloglink
            aanklikken, vragen maar.
          </p>
          <Link
            href="/login"
            className="mt-6 inline-block rounded-md bg-accent px-5 py-2.5 font-medium text-white hover:bg-accent-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            Maak gratis een account
          </Link>
        </section>
      </main>
    </div>
  );
}

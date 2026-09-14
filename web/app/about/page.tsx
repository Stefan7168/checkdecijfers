// /about — owner punch-list item 6 (session 102). Same shell as /privacy
// (app/privacy/page.tsx is the direct model): an async Server Component,
// generateMetadata() from the catalogue, SiteHeader shown only when the
// workspace shell is on, content in the same max-w-2xl column with plain
// <section> blocks and every string via t().
//
// Content: a short, plain-language "About" section (docs/01-product-vision.md:
// deterministic CBS answers, every number traceable to an official cell,
// aimed at journalists/researchers/students under deadline pressure) and a
// "Contact us" section with a REAL mailto link — unlike privacy.contactBody,
// which is a deliberate TODO placeholder for the owner to fill in later, this
// page's contact line ships with the real address from day one.
import type { Metadata } from 'next';
import { getLang } from '../../lib/i18n/server.ts';
import { t } from '../../lib/i18n/messages.ts';
import { SiteHeader } from '../../components/site-header.tsx';

const CONTACT_EMAIL = 'hi@checkdecijfers.nl';

export async function generateMetadata(): Promise<Metadata> {
  return { title: t(await getLang(), 'about.pageTitle') };
}

export default async function AboutPage() {
  const lang = await getLang();
  const showShell = process.env.WORKSPACE_ENABLED === '1';

  return (
    <>
      {showShell ? <SiteHeader /> : null}
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-4">
        <h1 className="text-2xl text-foreground">{t(lang, 'about.heading')}</h1>

        <section>
          <h2 className="text-lg text-foreground">{t(lang, 'about.introHeading')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t(lang, 'about.introBody')}</p>
        </section>

        <section>
          <h2 className="text-lg text-foreground">{t(lang, 'about.contactHeading')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t(lang, 'about.contactIntro')}{' '}
            <a href={`mailto:${CONTACT_EMAIL}`} className="underline hover:text-foreground">
              {CONTACT_EMAIL}
            </a>
            .
          </p>
        </section>
      </div>
    </>
  );
}

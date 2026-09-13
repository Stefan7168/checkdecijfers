// /werkwijze — "Hoe we werken" / "How we work" (WP-B, journey programme
// phase 4 R6, docs/superpowers/plans/2026-09-12-journey-programme.md).
// Public, LLM-free Server Component: the public-claim sentence ("every
// number traceable to an official CBS cell, with source and date shown" —
// NEVER "0% hallucination", per CLAUDE.md's Public-claim rule), the three
// pipeline steps expanded, what "voorlopig" means (docs/05-data-rules.md
// R11), what a refusal means (docs/05-data-rules.md's failure-behavior
// table), and what the claim does NOT cover (user-uploaded data, web
// results, other sources later — principle c). Marked with a visible draft
// note (decision 9) so the owner sees this is unreviewed copy. Same shell
// pattern as /credits: SiteHeader only when WORKSPACE_ENABLED is on, else
// none; robots noindex is inherited from the global layout.tsx metadata
// (no per-page override needed, whole site is blanket-noindexed pre-launch).
import type { Metadata } from 'next';
import { getLang } from '../../lib/i18n/server.ts';
import { t } from '../../lib/i18n/messages.ts';
import { SiteHeader } from '../../components/site-header.tsx';

// The page title follows the reader's language, like every other string here:
// getLang() is a server read, so the title is resolved per request.
export async function generateMetadata(): Promise<Metadata> {
  return { title: t(await getLang(), 'werkwijze.pageTitle') };
}

export default async function WerkwijzePage() {
  const lang = await getLang();
  const showShell = process.env.WORKSPACE_ENABLED === '1';

  return (
    <>
      {showShell ? <SiteHeader /> : null}
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-4">
        <p className="rounded-md border border-border bg-muted px-3 py-2 text-xs text-muted-foreground">
          {t(lang, 'trust.draftNote')}
        </p>
        <h1 className="text-2xl text-foreground">{t(lang, 'werkwijze.heading')}</h1>
        <p className="text-base font-medium text-foreground">{t(lang, 'werkwijze.publicClaim')}</p>

        <section className="flex flex-col gap-4">
          <div>
            <h2 className="text-lg text-foreground">{t(lang, 'werkwijze.step1Title')}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t(lang, 'werkwijze.step1Body')}</p>
          </div>
          <div>
            <h2 className="text-lg text-foreground">{t(lang, 'werkwijze.step2Title')}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t(lang, 'werkwijze.step2Body')}</p>
          </div>
          <div>
            <h2 className="text-lg text-foreground">{t(lang, 'werkwijze.step3Title')}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t(lang, 'werkwijze.step3Body')}</p>
          </div>
        </section>

        <section>
          <h2 className="text-lg text-foreground">{t(lang, 'werkwijze.provisionalHeading')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t(lang, 'werkwijze.provisionalBody')}</p>
        </section>

        <section>
          <h2 className="text-lg text-foreground">{t(lang, 'werkwijze.refusalHeading')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t(lang, 'werkwijze.refusalBody')}</p>
        </section>

        <section>
          <h2 className="text-lg text-foreground">{t(lang, 'werkwijze.notCoveredHeading')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t(lang, 'werkwijze.notCoveredBody')}</p>
        </section>
      </div>
    </>
  );
}

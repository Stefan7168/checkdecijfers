// /bevolking-3d-demo — ADR 049: a DEMO of a 3D municipality map over
// FICTIONAL numbers. Not part of the product: not linked anywhere, noindexed
// (belt-and-suspenders next to the site-wide pre-launch noindex in
// layout.tsx and robots.ts), behind the login by default (not in
// proxy.ts's PUBLIC_EXACT_PATHS — open-questions #250 if that should change),
// no env flag (unlike the Eurostat explorer, this page is MEANT to be shown
// from production by the signed-in owner). Zero backend imports, zero LLM,
// zero audit rows, zero live external calls — pinned by isolation.test.ts.
// The banner below is server-rendered so the label exists before any JS.
import type { Metadata } from 'next';
import { SiteHeader } from '../../components/site-header.tsx';
import { t } from '../../lib/i18n/messages.ts';
import { getLang } from '../../lib/i18n/server.ts';
import { DemoBanner } from './demo-banner.tsx';
import { Map3dLoader } from './map3d-loader.tsx';

export async function generateMetadata(): Promise<Metadata> {
  return { title: t(await getLang(), 'lab3d.pageTitle'), robots: { index: false, follow: false } };
}

export default async function Bevolking3dDemoPage() {
  const lang = await getLang();
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader stripped />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        <DemoBanner lang={lang} />
        <h1 className="mt-6 text-2xl text-foreground">{t(lang, 'lab3d.title')}</h1>
        <p className="mt-2 max-w-xl text-muted-foreground">{t(lang, 'lab3d.intro')}</p>
        <div className="mt-6"><Map3dLoader lang={lang} /></div>
        <p className="mt-6 border-t border-border pt-3 text-xs text-muted-foreground">{t(lang, 'lab3d.footer')}</p>
      </main>
    </div>
  );
}

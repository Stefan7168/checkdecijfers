import type { Metadata } from "next";
import { Geist_Mono, Inter } from "next/font/google";
import "./globals.css";
import { ChartUsageTracker } from "../components/chart-usage-tracker.tsx";
import { SiteFooter } from "../components/site-footer.tsx";
import { ThemeProvider } from "../components/theme-provider.tsx";
import { getLang } from "../lib/i18n/server.ts";
import { LangProvider } from "../lib/i18n/lang-provider.tsx";

// Session 87 visual redesign (docs/12-huisstijl.md): the chosen mockup
// (Option B, "Inset Cards") sets interface text in Inter; Geist Mono stays for
// code/ids. The Newsreader serif display face went with the retired
// "papier & inkt" identity.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Check de Cijfers",
  description: "Chat met officiële CBS-cijfers — elk getal herleidbaar tot een CBS-tabel.",
  // Phase 0: internal/testing deployment on a *.vercel.app subdomain, not the
  // public launch (docs/03-mvp-scope.md — browse pages/SEO are a later
  // phase; the checkdecijfers.nl domain isn't even confirmed yet per
  // RUNBOOK.md). Remove this when the real public launch is ready.
  robots: {
    index: false,
    follow: false,
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // WP218 phase 4 (#219): cookie -> Accept-Language -> 'nl'
  // (docs/superpowers/specs/2026-09-09-language-switch-design.md §2.4). The
  // layout was already dynamic (every page reads the Supabase session), so
  // this adds no new dynamic-rendering behaviour.
  const lang = await getLang();

  return (
    // suppressHydrationWarning: next-themes writes the `dark` class onto <html>
    // before React hydrates (its inline script), which is the documented,
    // expected mismatch for exactly this element.
    <html
      lang={lang}
      suppressHydrationWarning
      className={`${inter.variable} ${geistMono.variable} h-full antialiased`}
    >
      {/* App shell: the page scrolls inside the flex-1 region so the one
          site-wide footer (ADR 033 D6) stays in view and the chat workspace
          can size its cards to the viewport. */}
      <body className="flex h-dvh flex-col">
        <LangProvider lang={lang}>
          <ThemeProvider>
            {/* Anonymous style-panel usage counter (WP218 phase 6, #220): pure
                wiring, renders nothing. Mounted once here so it's live for
                every page, not tied to any one chart mount. */}
            <ChartUsageTracker />
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</div>
            <SiteFooter />
          </ThemeProvider>
        </LangProvider>
      </body>
    </html>
  );
}

import type { Metadata } from "next";
import { Geist_Mono, Inter } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";
import { ChartUsageTracker } from "../components/chart-usage-tracker.tsx";
import { SiteFooter } from "../components/site-footer.tsx";
import { ThemeProvider } from "../components/theme-provider.tsx";
import { getLang } from "../lib/i18n/server.ts";
import { isLang, t } from "../lib/i18n/messages.ts";
import { LangProvider } from "../lib/i18n/lang-provider.tsx";
import { StylePanelOwnerProvider } from "../lib/style-panel-owner.tsx";

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

// WP218 phase 4 (#219): generateMetadata (rather than a static `metadata`
// export) so the title/description can read getLang() — the same cookie ->
// Accept-Language -> 'nl' resolution the layout itself uses below. The
// layout was already dynamic (every page reads the Supabase session), so
// this second getLang() read adds no new dynamic-rendering behaviour.
export async function generateMetadata(): Promise<Metadata> {
  const lang = await getLang();
  return {
    title: t(lang, "meta.title"),
    description: t(lang, "meta.description"),
    // Phase 0: internal/testing deployment on a *.vercel.app subdomain, not
    // the public launch (docs/03-mvp-scope.md — browse pages/SEO are a later
    // phase; the checkdecijfers.nl domain isn't even confirmed yet per
    // RUNBOOK.md). Remove this when the real public launch is ready.
    robots: {
      index: false,
      follow: false,
    },
  };
}

/** Final review (Fix 2): which `forcedTheme` value (if any) this request's
 * `x-embed-theme` header resolves to for next-themes' `<ThemeProvider>`.
 * `x-embed-theme` is set by web/proxy.ts's `embedRequestHeaders` — already
 * validated there down to exactly 'light'/'dark' (an absent header means
 * either a non-embed route, or `?theme=auto`/absent/invalid, all of which
 * mean "no override" the same way) — but this re-validates rather than
 * trusting the string raw, the same defense-in-depth discipline `isLang`
 * gets for `x-embed-lang` just below. Pure and exported so it is unit-tested
 * directly: `next/headers` makes this component server-only, and jsdom
 * cannot render this component's own `<html>`/`<body>` tree the way the rest
 * of this file's tests do for other components (see layout.test.ts's header
 * comment) — this function is the layer that CAN be proven directly,
 * mirroring `langFromAcceptLanguage`/`isPublicPath`/`embedRequestHeaders`. */
export function resolveEmbedForcedTheme(header: string | null): 'light' | 'dark' | undefined {
  return header === 'light' || header === 'dark' ? header : undefined;
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Fix round (Task 5 review, Piece 2; final review Fix 2 adds the third
  // header): web/proxy.ts marks every /embed/[token] request with
  // `x-embed-route` (Piece 1 made that route PUBLIC — this makes it a
  // genuinely clean, chart-only iframe per spec Part B3, "no site
  // header/footer", without a second root layout / route group, since it's
  // the only route that needs to differ). `x-embed-lang` carries that same
  // route's OWN resolved `?lang=` (proxy.ts validates it with the real
  // isLang guard before ever setting the header) — it wins over the cookie/
  // Accept-Language resolution below ONLY when present, since an anonymous
  // embed reader has no checkdecijfers.nl cookie of their own for getLang()
  // to meaningfully read anyway. `x-embed-theme` carries that same route's
  // OWN resolved `?theme=` (also proxy.ts-validated, to exactly
  // 'light'/'dark') and is passed to `<ThemeProvider forcedTheme={...}>`
  // below — this is what actually closes the bug the embed page's own OLD
  // per-route `<div className="dark">` wrapper could not: that wrapper only
  // ever flipped Tailwind's dark-mode-scoped tokens for markup INSIDE it, but
  // did nothing to stop `<ThemeProvider>` (mounted unconditionally, right
  // here, for every route) from resolving the READER's own OS/browser
  // `prefers-color-scheme` regardless of what `?theme=` said — so
  // `?theme=light` (the embed dialog's own DEFAULT option) silently did
  // nothing on a dark-mode reader, and `?theme=dark` never painted the page's
  // own background. `forcedTheme` is next-themes' own documented API for
  // exactly this "override the theme regardless of system/stored preference,
  // for this render" case (confirmed against the installed package's own
  // type definitions and runtime source, web/node_modules/next-themes) — it
  // drives the SAME class-on-`<html>` mechanism every other page's dark mode
  // already relies on, so the page background flips correctly too, not just
  // text/border tokens nested under a wrapper div. All three headers are
  // read here, above getLang(), so the embed branch can skip that call
  // entirely rather than resolve a value it's just going to discard.
  const headerList = await headers();
  const isEmbedRoute = headerList.get("x-embed-route") === "1";
  const embedLang = headerList.get("x-embed-lang");
  const forcedTheme = resolveEmbedForcedTheme(headerList.get("x-embed-theme"));

  // WP218 phase 4 (#219): cookie -> Accept-Language -> 'nl'
  // (docs/superpowers/specs/2026-09-09-language-switch-design.md §2.4). The
  // layout was already dynamic (every page reads the Supabase session), so
  // this adds no new dynamic-rendering behaviour. Skipped in favour of the
  // embed route's own `?lang=` above when that's present and valid — see
  // the comment above this block.
  const lang = isEmbedRoute && isLang(embedLang) ? embedLang : await getLang();

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
          <ThemeProvider forcedTheme={forcedTheme}>
            {/* Task 6 (chart frame plan): one Style panel open per page —
                every ChartView on the page shares this single owner slot, so
                opening one chart's floating panel closes any other chart's
                that was already open. Mounted once here, above every page's
                content, same as ChartUsageTracker below. */}
            <StylePanelOwnerProvider>
              {/* Anonymous style-panel usage counter (WP218 phase 6, #220): pure
                  wiring, renders nothing. Mounted once here so it's live for
                  every page, not tied to any one chart mount. */}
              <ChartUsageTracker />
              {/* ADR 042: [scrollbar-gutter:stable] keeps this scrollbar's appear/disappear from changing the width a chart's height-follows-width rule reacts to. */}
              <div className="flex min-h-0 flex-1 flex-col overflow-y-auto [scrollbar-gutter:stable]">{children}</div>
              {/* Fix round (Task 5 review, Piece 2): the embed iframe is
                  meant to be a clean, chart-only surface (spec Part B3) — the
                  site-wide footer has no business appearing inside a
                  third-party page's embedded chart. */}
              {!isEmbedRoute ? <SiteFooter /> : null}
            </StylePanelOwnerProvider>
          </ThemeProvider>
        </LangProvider>
      </body>
    </html>
  );
}

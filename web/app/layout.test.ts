// WP218 phase 4 (#219): generateMetadata() reads getLang() and returns the
// catalogue title/description — jsdom has no Next.js request context for the
// real cookies()/headers() reads, so getLang() is mocked. This only imports
// the metadata function, not the full RootLayout tree (rendering <html>/
// <body> conflicts with jsdom's own document — no test attempts that here).
//
// Final review (Fix 2): RootLayout's own forcedTheme wiring is tested below
// WITHOUT rendering either — `RootLayout(...)` is called directly (it is
// just an async function returning a plain React element tree, same idiom
// web/app/embed/[token]/page.test.tsx uses for EmbedPage), and the returned
// tree is walked as plain JS objects (React.isValidElement + .props) to find
// the <ThemeProvider> node and read its forcedTheme prop straight off it —
// never mounted via @testing-library/react's render(), which is exactly the
// jsdom <html>/<body> conflict this file's own top comment already warns
// about.
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { getLang } = vi.hoisted(() => ({ getLang: vi.fn() }));
vi.mock('../lib/i18n/server.ts', () => ({ getLang }));

const { headers } = vi.hoisted(() => ({ headers: vi.fn() }));
vi.mock('next/headers', () => ({ headers }));

// next/font/google needs the real Next.js build pipeline (it rewrites the
// call at compile time); stub it so importing layout.tsx for its
// generateMetadata export doesn't require that pipeline in a plain jsdom test.
vi.mock('next/font/google', () => ({
  Inter: () => ({ variable: '--font-inter' }),
  Geist_Mono: () => ({ variable: '--font-geist-mono' }),
}));
vi.mock('./globals.css', () => ({}));

import { ThemeProvider } from '../components/theme-provider.tsx';
import RootLayout, { generateMetadata, resolveEmbedForcedTheme } from './layout.tsx';

afterEach(() => {
  getLang.mockReset();
  headers.mockReset();
});

describe('generateMetadata()', () => {
  it('returns the Dutch title/description by default', async () => {
    getLang.mockResolvedValue('nl');
    const metadata = await generateMetadata();
    expect(metadata.title).toBe('Check de Cijfers');
    expect(metadata.description).toBe('Chat met officiële CBS-cijfers — elk getal herleidbaar tot een CBS-tabel.');
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });

  it('returns the English description under getLang() -> "en" (the title stays the brand name)', async () => {
    getLang.mockResolvedValue('en');
    const metadata = await generateMetadata();
    expect(metadata.title).toBe('Check de Cijfers');
    expect(metadata.description).toBe('Chat with official CBS statistics — every figure traceable to a CBS table.');
  });
});

// Final review (Fix 2): the pure header -> forcedTheme mapping, unit-tested
// directly for the same reason isPublicPath/embedRequestHeaders/
// langFromAcceptLanguage are — next/headers makes the surrounding component
// server-only, so this is the layer that can be proven without a real
// request context.
describe('resolveEmbedForcedTheme()', () => {
  it('resolves "dark" and "light" headers to themselves', () => {
    expect(resolveEmbedForcedTheme('dark')).toBe('dark');
    expect(resolveEmbedForcedTheme('light')).toBe('light');
  });

  it('resolves null (header absent — non-embed route, or ?theme= absent/auto/invalid upstream) to undefined', () => {
    expect(resolveEmbedForcedTheme(null)).toBeUndefined();
  });

  it('resolves any other string (defense in depth — proxy.ts should never actually send one) to undefined', () => {
    expect(resolveEmbedForcedTheme('auto')).toBeUndefined();
    expect(resolveEmbedForcedTheme('blue')).toBeUndefined();
    expect(resolveEmbedForcedTheme('Dark')).toBeUndefined();
    expect(resolveEmbedForcedTheme('')).toBeUndefined();
  });
});

/** Fake next/headers()-shaped object: only `.get` is ever called on it by
 * layout.tsx, so only `.get` needs to exist. */
function fakeHeaders(values: Record<string, string> = {}): { get(key: string): string | null } {
  return { get: (key: string) => values[key] ?? null };
}

/** Depth-first search for the first element of the given `type` in a
 * RootLayout-returned tree — plain object traversal (React.isValidElement +
 * .props.children), never touching the DOM, so it works identically whether
 * or not jsdom could otherwise render <html>/<body> (it can't, safely, per
 * this file's own top comment). Generic over the expected props shape (a
 * plain `ReactElement`'s own `.props` types as `unknown`) so callers below
 * get a properly typed `.props.forcedTheme` with no per-call-site cast. */
function findElement<P = Record<string, unknown>>(node: ReactNode, type: unknown): ReactElement<P> | null {
  if (node == null || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement<P>(child, type);
      if (found) return found;
    }
    return null;
  }
  if (!isValidElement(node)) return null;
  if (node.type === type) return node as ReactElement<P>;
  return findElement<P>((node.props as { children?: ReactNode }).children ?? null, type);
}

// Final review (Fix 2): proves RootLayout itself — not just the pure
// resolver above — actually wires the resolved value into
// <ThemeProvider forcedTheme={...}>, for each header state, without ever
// mounting the returned <html>/<body> tree into jsdom's own document.
describe('RootLayout — forcedTheme wiring into <ThemeProvider> (final review, Fix 2)', () => {
  it('passes forcedTheme="dark" through to ThemeProvider when x-embed-theme: dark', async () => {
    headers.mockResolvedValue(fakeHeaders({ 'x-embed-route': '1', 'x-embed-theme': 'dark' }));
    getLang.mockResolvedValue('nl');
    const element = await RootLayout({ children: null });
    const themeProvider = findElement<{ forcedTheme?: string }>(element, ThemeProvider);
    expect(themeProvider).not.toBeNull();
    expect(themeProvider!.props.forcedTheme).toBe('dark');
  });

  it('passes forcedTheme="light" through to ThemeProvider when x-embed-theme: light', async () => {
    headers.mockResolvedValue(fakeHeaders({ 'x-embed-route': '1', 'x-embed-theme': 'light' }));
    getLang.mockResolvedValue('nl');
    const element = await RootLayout({ children: null });
    const themeProvider = findElement<{ forcedTheme?: string }>(element, ThemeProvider);
    expect(themeProvider!.props.forcedTheme).toBe('light');
  });

  it('passes forcedTheme=undefined (no override — next-themes\' own system-preference default applies) when x-embed-theme is absent', async () => {
    headers.mockResolvedValue(fakeHeaders({}));
    getLang.mockResolvedValue('nl');
    const element = await RootLayout({ children: null });
    const themeProvider = findElement<{ forcedTheme?: string }>(element, ThemeProvider);
    expect(themeProvider!.props.forcedTheme).toBeUndefined();
  });

  it('passes forcedTheme=undefined on an ordinary (non-embed) route with no embed headers at all', async () => {
    headers.mockResolvedValue(fakeHeaders({ 'accept-language': 'nl' }));
    getLang.mockResolvedValue('nl');
    const element = await RootLayout({ children: null });
    const themeProvider = findElement<{ forcedTheme?: string }>(element, ThemeProvider);
    expect(themeProvider!.props.forcedTheme).toBeUndefined();
  });
});

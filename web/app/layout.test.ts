// WP218 phase 4 (#219): generateMetadata() reads getLang() and returns the
// catalogue title/description — jsdom has no Next.js request context for the
// real cookies()/headers() reads, so getLang() is mocked. This only imports
// the metadata function, not the full RootLayout tree (rendering <html>/
// <body> conflicts with jsdom's own document — no test attempts that here).
import { afterEach, describe, expect, it, vi } from 'vitest';

const { getLang } = vi.hoisted(() => ({ getLang: vi.fn() }));
vi.mock('../lib/i18n/server.ts', () => ({ getLang }));

// next/font/google needs the real Next.js build pipeline (it rewrites the
// call at compile time); stub it so importing layout.tsx for its
// generateMetadata export doesn't require that pipeline in a plain jsdom test.
vi.mock('next/font/google', () => ({
  Inter: () => ({ variable: '--font-inter' }),
  Geist_Mono: () => ({ variable: '--font-geist-mono' }),
}));
vi.mock('./globals.css', () => ({}));

import { generateMetadata } from './layout.tsx';

afterEach(() => {
  getLang.mockReset();
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

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { t } from '../../lib/i18n/messages.ts';
import { isPublicPath } from '../../proxy.ts';
import { YEAR_END, YEAR_START } from './fake-data.ts';
import { GROWTH_DOMAIN } from './scales.ts';

const lang = vi.hoisted(() => ({ current: 'nl' as 'nl' | 'en' }));
vi.mock('../../lib/i18n/server.ts', () => ({ getLang: async () => lang.current }));
vi.mock('../../components/site-header.tsx', () => ({ SiteHeader: () => <header data-testid="header" /> }));
vi.mock('./map3d-loader.tsx', () => ({ Map3dLoader: () => <div data-testid="loader" /> }));

import Bevolking3dDemoPage, { generateMetadata } from './page.tsx';

afterEach(() => { cleanup(); lang.current = 'nl'; });

describe('/bevolking-3d-demo page (ADR 049)', () => {
  it('is noindexed and titled as a demo with fictional data, in both languages', async () => {
    expect(await generateMetadata()).toMatchObject({ title: t('nl', 'lab3d.pageTitle'), robots: { index: false, follow: false } });
    lang.current = 'en';
    expect(await generateMetadata()).toMatchObject({ title: t('en', 'lab3d.pageTitle'), robots: { index: false, follow: false } });
    expect(t('nl', 'lab3d.pageTitle').toLowerCase()).toContain('demo');
    expect(t('en', 'lab3d.pageTitle').toLowerCase()).toContain('fictional');
  });
  it('renders the banner in the server HTML above the loader, and the fictional footer line', async () => {
    const { container } = render(await Bevolking3dDemoPage());
    const note = screen.getByRole('note');
    expect(note.textContent).toContain(t('nl', 'lab3d.badge'));
    const order = [...container.querySelectorAll('[role="note"], [data-testid="loader"]')];
    expect(order[0]).toBe(note);
    expect(container.textContent).toContain(t('nl', 'lab3d.footer'));
  });
  it('is behind the login by default — the route and its asset are NOT public paths', () => {
    expect(isPublicPath('/bevolking-3d-demo')).toBe(false);
    expect(isPublicPath('/demo/gemeente_2024.topojson')).toBe(false);
  });

  // Code-review fix (2026-09-15): the honesty digit-scan in map3d.test.tsx
  // only ever ran against <Map3d>'s own render tree — page.tsx's own
  // title/intro/footer text (rendered outside <Map3d>, e.g. the "3D" in the
  // intro and the "4.0" in the CC BY footer line) was never digit-traced,
  // only content-presence checked. A digit here is legitimate fixed copy,
  // never a fake-data number (page.tsx never imports fake-data.ts), so the
  // check is membership against the page's OWN translated strings — the
  // same "every digit must trace to a real source" idea as scanDigits, one
  // level up.
  it('every digit rendered by the page itself (not the mocked-out map) traces to the page\'s own fixed copy, in both languages', async () => {
    for (const testLang of ['nl', 'en'] as const) {
      lang.current = testLang;
      const { container, unmount } = render(await Bevolking3dDemoPage());
      // v2 (D4′): the Narrative card (rendered directly by the page, not
      // inside the mocked-out Map3dLoader) draws real digits from
      // GROWTH_DOMAIN/YEAR_START/YEAR_END via t()'s {vars} — its rendered
      // strings must be harvested here the same way the fixed copy is.
      const narrativeVars = { start: YEAR_START, end: YEAR_END, domain: Math.round(GROWTH_DOMAIN * 100) };
      const keys = ['lab3d.title', 'lab3d.intro', 'lab3d.badge', 'lab3d.badgeDetail', 'lab3d.footer', 'lab3d.narrativeStep1', 'lab3d.narrativeStep2', 'lab3d.narrativeStep3', 'lab3d.narrativeStep4', 'lab3d.narrativeStep5'] as const;
      const sourceStrings = keys.map((key) => t(testLang, key, narrativeVars));
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
      let seen = 0;
      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        const text = node.textContent ?? '';
        if (!/\d/.test(text)) continue;
        seen++;
        for (const tok of text.match(/\d[\d.,]*/g) ?? []) {
          expect(sourceStrings.some((s) => s.includes(tok)), `numeric token "${tok}" on the page has no source in its own copy`).toBe(true);
        }
      }
      expect(seen).toBeGreaterThan(0); // both languages' intro/footer genuinely carry a digit (3D, CC BY 4.0) — a false pass on an empty scan is not acceptable here either
      unmount();
    }
  });

  it('renders the D4′ guided narrative card below the map, with real domain numbers, and Vorige/Volgende step through it', async () => {
    const { container } = render(await Bevolking3dDemoPage());
    const order = [...container.querySelectorAll('[data-testid="loader"], [aria-label="' + t('nl', 'lab3d.narrativeTitle') + '"]')];
    expect(order[0]?.getAttribute('data-testid')).toBe('loader'); // narrative sits BELOW the map
    expect(screen.getByText(t('nl', 'lab3d.narrativeStep1'))).toBeInTheDocument();
    const next = screen.getByRole('button', { name: t('nl', 'lab3d.narrativeNext') });
    const prev = screen.getByRole('button', { name: t('nl', 'lab3d.narrativePrev') });
    expect(prev).toBeDisabled();
    fireEvent.click(next);
    expect(screen.getByText(t('nl', 'lab3d.narrativeStep2'))).toBeInTheDocument();
    expect(prev).not.toBeDisabled();
    const dots = screen.getAllByRole('tab');
    expect(dots).toHaveLength(5);
    fireEvent.click(dots[4]!);
    const domain = Math.round(GROWTH_DOMAIN * 100);
    expect(screen.getByText(t('nl', 'lab3d.narrativeStep5', { start: YEAR_START, end: YEAR_END, domain }))).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t('nl', 'lab3d.narrativeNext') })).toBeDisabled();
  });
});

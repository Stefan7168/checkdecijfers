import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { t } from '../../lib/i18n/messages.ts';
import { isPublicPath } from '../../proxy.ts';

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
});

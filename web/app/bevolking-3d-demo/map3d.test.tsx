import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../../lib/i18n/messages.ts';
import { DemoBanner } from './demo-banner.tsx';
import { YEAR_END, YEAR_START } from './fake-data.ts';
import { Map3d, TOPOJSON_URL } from './map3d.tsx';
import { TWO_SQUARES_TOPOLOGY } from './test-fixture.ts';

function stubMatchMedia(reduced: boolean): void {
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({ matches: reduced && query.includes('prefers-reduced-motion'), media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
}
async function renderLoaded(lang: 'nl' | 'en' = 'nl') {
  const fetchMock = vi.fn(async () => ({ ok: true, json: async () => TWO_SQUARES_TOPOLOGY }));
  vi.stubGlobal('fetch', fetchMock);
  const view = render(<Map3d lang={lang} />);
  await screen.findByRole('status'); // 'unavailable' in jsdom — the data loaded, the scene did not
  expect(fetchMock).toHaveBeenCalledWith(TOPOJSON_URL);
  return view;
}
/** The demo's own honesty scan: every digit-bearing text node must sit under
 * data-fictional (a fake number, labelled) or data-year (a calendar year).
 * `[role="status"]` is exempt for the same reason the plan already exempts
 * `lab3d.footer` ("CC BY 4.0") from this scan: it is FIXED UI copy — e.g.
 * "This browser cannot show 3D (no WebGL)." — never a number drawn from
 * fake-data.ts, so a digit inside it ("3D") carries no fictional statistic
 * to mislabel. */
function scanDigits(container: HTMLElement): void {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let seen = 0;
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (!/\d/.test(node.textContent ?? '')) continue;
    if (node.parentElement?.closest('[role="status"]')) continue;
    seen++;
    const el = node.parentElement;
    expect(el?.closest('[data-fictional="true"], [data-year]'), `digit "${node.textContent}" outside a labelled element`).not.toBeNull();
  }
  expect(seen).toBeGreaterThan(0);
}

beforeEach(() => stubMatchMedia(false));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('DemoBanner — the page-level label (ADR 049)', () => {
  it('renders the fixed badge text and the explanation, in both languages, as a note', () => {
    for (const lang of ['nl', 'en'] as const) {
      const { unmount } = render(<DemoBanner lang={lang} />);
      const note = screen.getByRole('note');
      expect(note.textContent).toContain(t(lang, 'lab3d.badge'));
      expect(note.textContent).toContain(t(lang, 'lab3d.badgeDetail'));
      unmount();
    }
    expect(t('nl', 'lab3d.badge')).toBe('DEMO — FICTIEVE DATA');
    expect(t('en', 'lab3d.badge')).toBe('DEMO — FICTIONAL DATA');
  });
  it('has no prop that could hide it (compile-time pin)', () => {
    // @ts-expect-error — DemoBanner accepts `lang` only; a `hidden`-style prop must not exist.
    expect(() => render(<DemoBanner lang="nl" hidden />)).not.toThrow();
  });
});

describe('Map3d — labels, controls and the digit lock (ADR 049)', () => {
  it('always shows the watermark and the height/colour note; in jsdom it reports 3D as unavailable but still loads the data', async () => {
    const { container } = await renderLoaded();
    expect(container.querySelector('[data-watermark][aria-hidden="true"]')?.textContent).toContain(t('nl', 'lab3d.watermark'));
    expect(screen.getByRole('status').textContent).toBe(t('nl', 'lab3d.unavailable'));
    expect(container.textContent).toContain(t('nl', 'lab3d.heightNote'));
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(expect.arrayContaining(['Aa', 'Bee']));
  });
  it('choosing a municipality shows its (fictional) numbers, every one labelled; the digit scan passes', async () => {
    const { container } = await renderLoaded();
    fireEvent.change(screen.getByLabelText(t('nl', 'lab3d.pickLabel')), { target: { value: 'GM0002' } });
    const details = container.querySelector('[aria-live="polite"][data-fictional="true"]');
    expect(details?.textContent).toContain('Bee');
    expect(details?.textContent).toContain(t('nl', 'lab3d.population'));
    expect(details?.textContent).toContain(t('nl', 'lab3d.growth'));
    expect(details?.textContent).toContain(t('nl', 'lab3d.badge'));
    scanDigits(container);
  });
  it('the year slider spans 1995–2025 and play advances one year per tick, stopping at the end', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { container } = await renderLoaded();
    const slider = screen.getByLabelText(t('nl', 'lab3d.year')) as HTMLInputElement;
    expect(slider.min).toBe(String(YEAR_START));
    expect(slider.max).toBe(String(YEAR_END));
    expect(container.querySelector('[data-year]')?.textContent).toBe(String(YEAR_START));
    fireEvent.change(slider, { target: { value: String(YEAR_END - 1) } });
    const play = screen.getByRole('button', { name: t('nl', 'lab3d.play') });
    fireEvent.click(play);
    expect(play).toHaveAttribute('aria-pressed', 'true');
    await act(async () => { vi.advanceTimersByTime(700); });
    expect(container.querySelector('[data-year]')?.textContent).toBe(String(YEAR_END));
    await act(async () => { vi.advanceTimersByTime(700); });
    expect(screen.getByRole('button', { name: t('nl', 'lab3d.play') })).toHaveAttribute('aria-pressed', 'false');
    scanDigits(container);
  });
  it('reduced motion is read once at mount (no tween, no damping) and the controls still work', async () => {
    stubMatchMedia(true);
    const { container } = await renderLoaded();
    expect(container.querySelector('[data-reduced-motion="true"]')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: t('nl', 'lab3d.resetView') }));
  });
  it('a failed asset fetch is an honest message, never an empty map', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })));
    render(<Map3d lang="en" />);
    expect((await screen.findByRole('status')).textContent).toBe(t('en', 'lab3d.loadFailed'));
  });
});

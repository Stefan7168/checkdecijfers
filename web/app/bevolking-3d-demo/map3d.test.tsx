import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../../lib/i18n/messages.ts';
import { DemoBanner } from './demo-banner.tsx';
import { buildFakeDataset, growthSince, populationIn, YEAR_END, YEAR_START, type FakeDataset } from './fake-data.ts';
import { Map3d, TOPOJSON_URL } from './map3d.tsx';
import { formatGrowth, formatPopulation } from './scales.ts';
import { TWO_SQUARES_TOPOLOGY } from './test-fixture.ts';
import { areaKm2, decodeMunicipalities } from './topojson.ts';

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

/** Rebuilds the SAME fictional dataset Map3d builds from the fixture
 * topology (buildFakeDataset is deterministic — code-review fix,
 * 2026-09-15), so scanDigits can verify every rendered digit against the
 * generator's actual output, not merely that it sits in a labelled wrapper. */
function fixtureDataset(): FakeDataset {
  const features = decodeMunicipalities(TWO_SQUARES_TOPOLOGY);
  return buildFakeDataset(features.map((f) => ({ code: f.code, name: f.name, areaKm2: areaKm2(f) })));
}

/** Every string this demo can legitimately show a digit inside: the fake
 * dataset's own population/growth output for every year in range and both
 * languages, every calendar year, and the three FIXED status strings (e.g.
 * "This browser cannot show 3D (no WebGL)."). Plays the same role
 * `harvestSpecStrings` plays for the real product's `scanForUnboundDigits`
 * (chart.test.tsx) — a digit token must trace to something in this list, not
 * merely sit under the right element. Folding the status strings in here
 * (rather than a blanket `role="status"` exemption) means a future digit
 * added to any OTHER status string, or a new role="status" element, is
 * caught: it simply won't match anything in this frozen list. */
function harvestFictionalStrings(dataset: FakeDataset): string[] {
  const out: string[] = [];
  for (const record of dataset.records) {
    for (let year = YEAR_START; year <= YEAR_END; year++) {
      out.push(formatPopulation(populationIn(record, year), 'nl'), formatPopulation(populationIn(record, year), 'en'));
      out.push(formatGrowth(growthSince(record, year), 'nl'), formatGrowth(growthSince(record, year), 'en'));
    }
  }
  for (let year = YEAR_START; year <= YEAR_END; year++) out.push(String(year));
  for (const key of ['lab3d.loading', 'lab3d.unavailable', 'lab3d.loadFailed'] as const) {
    out.push(t('nl', key), t('en', key));
  }
  return out;
}

/** The demo's own honesty scan (code-review fix, 2026-09-15): every digit
 * TOKEN in the rendered DOM must (a) sit under data-fictional or data-year
 * — placement — AND (b) match a string `sourceStrings` says the dataset or
 * fixed copy actually produced — content. (a) alone (the original version)
 * would pass a corrupted generator output or a pasted-in real number as
 * long as it sat in the right wrapper; this mirrors chart.test.tsx's
 * scanForUnboundDigits, adapted for fictional rather than validated data. */
function scanDigits(container: HTMLElement, sourceStrings: string[]): void {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let seen = 0;
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = node.textContent ?? '';
    if (!/\d/.test(text)) continue;
    const inStatus = t('nl', 'lab3d.loading') === text || t('en', 'lab3d.loading') === text
      || t('nl', 'lab3d.unavailable') === text || t('en', 'lab3d.unavailable') === text
      || t('nl', 'lab3d.loadFailed') === text || t('en', 'lab3d.loadFailed') === text;
    if (!inStatus) {
      const el = node.parentElement;
      expect(el?.closest('[data-fictional="true"], [data-year]'), `digit "${text}" outside a labelled element`).not.toBeNull();
    }
    seen++;
    for (const tok of text.match(/\d[\d.,]*/g) ?? []) {
      expect(sourceStrings.some((s) => s.includes(tok)), `numeric token "${tok}" has no source in the fictional dataset or fixed copy`).toBe(true);
    }
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
    scanDigits(container, harvestFictionalStrings(fixtureDataset()));
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
    scanDigits(container, harvestFictionalStrings(fixtureDataset()));
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

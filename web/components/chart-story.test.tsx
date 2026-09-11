// Story mode (session 92): the panel is a dumb, controlled component over
// StoryStep[] — closed until opened; the active card is marked; Next/
// Previous/arrow keys/dots report an index (never past the ends); Escape
// closes and returns focus to the trigger; and no digit ever appears in the
// panel that is not one of the steps' own (spec-derived) strings.
import { useState, type ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StoryStep } from '../lib/chart-story.ts';
import { ChartStoryPanel, ChartStoryTrigger, type ChartStoryPanelProps } from './chart-story.tsx';

afterEach(cleanup);

const steps: StoryStep[] = [
  { id: 'overview', kind: 'overview', title: 'Overzicht', caption: 'Van 2021 tot 2024.', highlight: null, point: null },
  { id: 'high-s0-2022JJ00', kind: 'high', title: 'Hoogste punt', caption: '2022: 3,5 %', highlight: null, point: { seriesKey: 's0', periodCode: '2022JJ00' } },
  { id: 'explore', kind: 'explore', title: 'Verken zelf', caption: 'Wissel van weergave met de tabs.', highlight: null, point: null },
];

function Harness(props: Partial<ChartStoryPanelProps> & { onIndexChange?: (i: number) => void }): ReactNode {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const idPrefix = 'c1';
  return (
    <>
      <ChartStoryTrigger open={open} onToggle={() => setOpen((o) => !o)} controlsId={`${idPrefix}-story`} triggerId={`${idPrefix}-story-trigger`} lang={props.lang} />
      <ChartStoryPanel
        steps={props.steps ?? steps}
        index={index}
        onIndexChange={(i) => {
          setIndex(i);
          props.onIndexChange?.(i);
        }}
        open={open}
        onClose={() => setOpen(false)}
        triggerId={`${idPrefix}-story-trigger`}
        idPrefix={idPrefix}
        lang={props.lang}
        onPresent={props.onPresent}
        needsLoginForAi={props.needsLoginForAi}
      />
    </>
  );
}

describe('ChartStoryTrigger + ChartStoryPanel', () => {
  it('is closed by default; the trigger names Insights and opens a labelled region', () => {
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Inzichten' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('region', { name: 'Inzichten bij de grafiek' })).toBeNull();
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const region = screen.getByRole('region', { name: 'Inzichten bij de grafiek' });
    expect(region.id).toBe('c1-story');
    expect(trigger).toHaveAttribute('aria-controls', 'c1-story');
  });

  it('renders every step as a card, marks the active one, and walks with Next/Previous without leaving the ends', () => {
    const onIndexChange = vi.fn();
    render(<Harness onIndexChange={onIndexChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Inzichten' }));
    const region = screen.getByRole('region', { name: 'Inzichten bij de grafiek' });
    const cards = within(region).getAllByRole('article');
    expect(cards).toHaveLength(3);
    expect(cards[0]).toHaveAttribute('aria-current', 'step');
    expect(screen.getByRole('button', { name: 'Vorige' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Volgende' }));
    expect(onIndexChange).toHaveBeenLastCalledWith(1);
    expect(within(region).getAllByRole('article')[1]).toHaveAttribute('aria-current', 'step');
    fireEvent.click(screen.getByRole('button', { name: 'Volgende' }));
    expect(screen.getByRole('button', { name: 'Volgende' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Volgende' }));
    expect(onIndexChange).toHaveBeenCalledTimes(2);
  });

  it('the dotted step list jumps to a step by its title; arrow keys walk; Escape closes and refocuses the trigger', () => {
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Inzichten' });
    fireEvent.click(trigger);
    const region = screen.getByRole('region', { name: 'Inzichten bij de grafiek' });
    const dots = within(within(region).getByRole('list', { name: 'Stappen' })).getAllByRole('button');
    expect(dots.map((d) => d.getAttribute('aria-label'))).toEqual(['Overzicht', 'Hoogste punt', 'Verken zelf']);
    fireEvent.click(dots[2]!);
    expect(within(region).getAllByRole('article')[2]).toHaveAttribute('aria-current', 'step');
    fireEvent.keyDown(region, { key: 'ArrowLeft' });
    expect(within(region).getAllByRole('article')[1]).toHaveAttribute('aria-current', 'step');
    fireEvent.keyDown(region, { key: 'ArrowRight' });
    expect(within(region).getAllByRole('article')[2]).toHaveAttribute('aria-current', 'step');
    fireEvent.keyDown(region, { key: 'Escape' });
    expect(screen.queryByRole('region', { name: 'Inzichten bij de grafiek' })).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('speaks English when asked', () => {
    render(<Harness lang="en" />);
    fireEvent.click(screen.getByRole('button', { name: 'Insights' }));
    expect(screen.getByRole('region', { name: 'Insights for this chart' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeInTheDocument();
    expect(screen.getByText('Scroll or use the arrows')).toBeInTheDocument();
  });

  // R5 item 3 (experience-improvement-plan, session 96): a real reason to
  // sign up, previously invisible — shown only when chart.tsx tells the
  // panel generateInsights came back 'unauthenticated'.
  it('shows the log-in-for-AI line only when needsLoginForAi is true', () => {
    render(<Harness needsLoginForAi />);
    fireEvent.click(screen.getByRole('button', { name: 'Inzichten' }));
    const link = screen.getByRole('link', { name: 'Log in voor AI-verwoorde inzichten' });
    expect(link).toHaveAttribute('href', '/login');
  });

  it('renders no login line by default (a logged-in visitor, or one still resolving)', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Inzichten' }));
    expect(screen.queryByText('Log in voor AI-verwoorde inzichten')).toBeNull();
  });

  it('a chosen step is never overridden by the observer while the programmatic scroll settles', () => {
    vi.useFakeTimers();
    let callback: IntersectionObserverCallback | null = null;
    const observe = vi.fn();
    const disconnect = vi.fn();
    class FakeObserver {
      constructor(cb: IntersectionObserverCallback) {
        callback = cb;
      }
      observe = observe;
      disconnect = disconnect;
      unobserve = vi.fn();
      takeRecords = vi.fn(() => []);
      root = null;
      rootMargin = '';
      thresholds = [];
    }
    const originalObserver = globalThis.IntersectionObserver;
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
    globalThis.IntersectionObserver = FakeObserver as unknown as typeof IntersectionObserver;
    HTMLElement.prototype.scrollIntoView = vi.fn();
    try {
      const onIndexChange = vi.fn();
      render(<Harness onIndexChange={onIndexChange} />);
      fireEvent.click(screen.getByRole('button', { name: 'Inzichten' }));
      expect(observe).toHaveBeenCalledTimes(3);
      const region = screen.getByRole('region', { name: 'Inzichten bij de grafiek' });
      const cards = within(region).getAllByRole('article');
      fireEvent.click(screen.getByRole('button', { name: 'Volgende' }));
      expect(onIndexChange).toHaveBeenLastCalledWith(1);
      const entry = (i: number, ratio: number) => ({ target: cards[i]!, intersectionRatio: ratio, isIntersecting: ratio > 0 }) as unknown as IntersectionObserverEntry;
      // Mid-animation: the observer sees the first card — must be ignored.
      act(() => callback!([entry(0, 1)], {} as IntersectionObserver));
      expect(onIndexChange).toHaveBeenCalledTimes(1);
      // The scroll settles (no scroll events for 150 ms) — the guard lifts.
      const scrollArea = cards[0]!.parentElement!;
      fireEvent.scroll(scrollArea);
      act(() => { vi.advanceTimersByTime(200); });
      act(() => callback!([entry(2, 1)], {} as IntersectionObserver));
      expect(onIndexChange).toHaveBeenLastCalledWith(2);
    } finally {
      globalThis.IntersectionObserver = originalObserver;
      HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
      vi.useRealTimers();
    }
  });

  // Task 5 (Story-stage plan): the Present button that opens the full
  // Story stage. It is the panel's own concern only to offer the button and
  // forward the click — chart.tsx owns what "present" actually does.
  it('offers no Present button when onPresent is not given', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Inzichten' }));
    expect(screen.queryByRole('button', { name: 'Presenteren' })).toBeNull();
  });

  it('with onPresent given, renders a Present button between Volgende and the dots, calling onPresent and carrying id "<idPrefix>-story-present"', () => {
    const onPresent = vi.fn();
    render(<Harness onPresent={onPresent} />);
    fireEvent.click(screen.getByRole('button', { name: 'Inzichten' }));
    const region = screen.getByRole('region', { name: 'Inzichten bij de grafiek' });
    const present = screen.getByRole('button', { name: 'Presenteren' });
    expect(present).toHaveAttribute('id', 'c1-story-present');
    // Order: Vorige, Volgende, Presenteren, then the dotted step list.
    const controls = within(region).getAllByRole('button');
    const volgende = screen.getByRole('button', { name: 'Volgende' });
    const dots = within(within(region).getByRole('list', { name: 'Stappen' })).getAllByRole('button');
    expect(controls.indexOf(volgende)).toBeLessThan(controls.indexOf(present));
    expect(controls.indexOf(present)).toBeLessThan(controls.indexOf(dots[0]!));
    expect(onPresent).not.toHaveBeenCalled();
    fireEvent.click(present);
    expect(onPresent).toHaveBeenCalledTimes(1);
  });

  it('shows no digit that is not one of the steps\' own strings (no "step 2 of 3" anywhere)', () => {
    const { container } = render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Inzichten' }));
    const allowed = steps.flatMap((s) => [s.title, s.caption]);
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    const tokens: string[] = [];
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      tokens.push(...((node.textContent ?? '').match(/\d[\d.,]*/g) ?? []));
    }
    expect(tokens.length).toBeGreaterThan(0);
    for (const tok of tokens) {
      expect(allowed.some((str) => str.includes(tok)), `token "${tok}" has no source in the steps`).toBe(true);
    }
  });
});

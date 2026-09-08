// WP218 phase 1 (#218 chart styling): the "Opmaak" panel's Grafiek tab — a
// dumb component over chart-presentation.ts's resolver. Proves: closed by
// default; every control pre-fills from the RESOLVED values, never a
// component-local default; clicking a control emits a patch for exactly the
// changed key (the caller's reducer re-resolves from there); a control
// outside `resolved.applicable` is absent and one inside `resolved.locks` is
// disabled with a readable reason exposed to assistive tech; Standaard/reset
// tracks `pristine`; Escape closes the region and returns focus to the
// trigger; and — the resolver's own honesty invariant, extended to the UI
// that edits it — no digit ever appears in the panel's rendered text, open,
// in either language.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolvePresentation, type PresentationContext } from '../lib/chart-presentation.ts';
import { ChartConfigPanel } from './chart-config-panel.tsx';

afterEach(() => {
  cleanup();
});

const lineCtx: PresentationContext = { kind: 'line', form: 'line', seriesCount: 2, hasProvisional: false };
const barCtx: PresentationContext = { kind: 'bar', form: 'bar', seriesCount: 3, hasProvisional: false };
const meta = [
  { key: 'a', label: 'Nederland', color: '#8884d8' },
  { key: 'b', label: 'Duitsland', color: '#82ca9d' },
];

describe('ChartConfigPanel — Grafiek tab', () => {
  it('is closed by default and opens into a labelled region with three tabs', () => {
    render(
      <ChartConfigPanel
        resolved={resolvePresentation(lineCtx, {})}
        seriesMeta={meta}
        onChange={vi.fn()}
        onReset={vi.fn()}
        idPrefix="c"
      />,
    );
    const trigger = screen.getByRole('button', { name: 'Opmaak' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('region', { name: 'Opmaak van de grafiek' })).toBeNull();
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const region = screen.getByRole('region', { name: 'Opmaak van de grafiek' });
    expect(within(region).getAllByRole('tab').map((t) => t.textContent)).toEqual([
      'Grafiek',
      'Kleuren',
      'Lettertype',
    ]);
  });

  it('pre-fills every control from the resolved values, not from a stored default', () => {
    const resolved = resolvePresentation(lineCtx, { lineWidth: 'thick', grid: 'none', axisLines: 'hidden' });
    render(
      <ChartConfigPanel resolved={resolved} seriesMeta={meta} onChange={vi.fn()} onReset={vi.fn()} idPrefix="c" />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Opmaak' }));
    expect(screen.getByRole('radio', { name: 'Dik' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Geen' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('button', { name: 'Aslijnen tonen' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('emits a patch for exactly the changed key', () => {
    const onChange = vi.fn();
    render(
      <ChartConfigPanel
        resolved={resolvePresentation(lineCtx, {})}
        seriesMeta={meta}
        onChange={onChange}
        onReset={vi.fn()}
        idPrefix="c"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Opmaak' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Extra dik' }));
    expect(onChange).toHaveBeenCalledWith({ lineWidth: 'extraThick' });
    fireEvent.click(screen.getByRole('button', { name: 'Waarden tonen' }));
    expect(onChange).toHaveBeenCalledWith({ valueLabels: 'hidden' });
  });

  it('bar form: locked controls are disabled with a readable reason; inapplicable ones are absent', () => {
    const resolved = resolvePresentation(barCtx, {});
    render(
      <ChartConfigPanel resolved={resolved} seriesMeta={meta} onChange={vi.fn()} onReset={vi.fn()} idPrefix="c" />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Opmaak' }));
    const values = screen.getByRole('button', { name: 'Waarden tonen' });
    expect(values).toBeDisabled();
    expect(document.getElementById(values.getAttribute('aria-describedby')!)?.textContent).toMatch(/staafdiagram/);
    expect(screen.queryByRole('radiogroup', { name: 'Lijndikte' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Y-as vanaf nul' })).toBeNull();
  });

  it('Standaard is disabled while pristine and calls onReset otherwise', () => {
    const { unmount } = render(
      <ChartConfigPanel
        resolved={resolvePresentation(lineCtx, {})}
        seriesMeta={meta}
        onChange={vi.fn()}
        onReset={vi.fn()}
        idPrefix="c"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Opmaak' }));
    expect(screen.getByRole('button', { name: 'Standaard' })).toBeDisabled();
    unmount();

    const onReset = vi.fn();
    render(
      <ChartConfigPanel
        resolved={resolvePresentation(lineCtx, { lineWidth: 'thick' })}
        seriesMeta={meta}
        onChange={vi.fn()}
        onReset={onReset}
        idPrefix="c"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Opmaak' }));
    const reset = screen.getByRole('button', { name: 'Standaard' });
    expect(reset).not.toBeDisabled();
    fireEvent.click(reset);
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it('Escape closes the region and returns focus to the trigger', () => {
    render(
      <ChartConfigPanel
        resolved={resolvePresentation(lineCtx, {})}
        seriesMeta={meta}
        onChange={vi.fn()}
        onReset={vi.fn()}
        idPrefix="c"
      />,
    );
    const trigger = screen.getByRole('button', { name: 'Opmaak' });
    fireEvent.click(trigger);
    const region = screen.getByRole('region', { name: 'Opmaak van de grafiek' });
    fireEvent.keyDown(region, { key: 'Escape' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('region', { name: 'Opmaak van de grafiek' })).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('contains no digit in any text node, open, in either language', () => {
    for (const lang of ['nl', 'en'] as const) {
      const { container, unmount } = render(
        <ChartConfigPanel
          lang={lang}
          resolved={resolvePresentation(lineCtx, {})}
          seriesMeta={meta}
          onChange={vi.fn()}
          onReset={vi.fn()}
          idPrefix={lang}
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: lang === 'nl' ? 'Opmaak' : 'Style' }));
      for (const tab of screen.getAllByRole('tab')) fireEvent.click(tab);
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) expect(n.textContent).not.toMatch(/\d/);
      unmount();
    }
  });
});

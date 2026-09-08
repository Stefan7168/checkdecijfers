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
import { FONT_OPTIONS, resolvePresentation, type PresentationContext } from '../lib/chart-presentation.ts';
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
// A distinct fixture for the Kleuren/Lettertype tests (own labels, so a
// mistaken match against the Grafiek describe block's fixture would fail
// loudly rather than silently pass on the wrong element).
const colorMeta = [
  { key: 'ams', label: 'Amsterdam', color: '#8884d8' },
  { key: 'rot', label: 'Rotterdam', color: '#82ca9d' },
];

/** Opens the panel and switches to the given tab — shared by every
 * Kleuren/Lettertype test below. */
function openTab(tab: 'Kleuren' | 'Lettertype'): void {
  fireEvent.click(screen.getByRole('button', { name: 'Opmaak' }));
  fireEvent.click(screen.getByRole('tab', { name: tab }));
}

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

describe('ChartConfigPanel — Kleuren tab', () => {
  it('one row per series with swatch, hex input and colour picker pre-filled with the effective colour', () => {
    render(
      <ChartConfigPanel
        resolved={resolvePresentation(lineCtx, {})}
        seriesMeta={colorMeta}
        onChange={vi.fn()}
        onReset={vi.fn()}
        idPrefix="k1"
      />,
    );
    openTab('Kleuren');
    expect(screen.getByRole('group', { name: 'Amsterdam' })).toBeInTheDocument();
    const hex = screen.getByRole('textbox', { name: 'Kleur van Amsterdam (hex-code)' }) as HTMLInputElement;
    expect(hex.value).toBe('#8884d8');
    expect((screen.getByLabelText('Kleur van Amsterdam kiezen') as HTMLInputElement).value).toBe('#8884d8');
    const hex2 = screen.getByRole('textbox', { name: 'Kleur van Rotterdam (hex-code)' }) as HTMLInputElement;
    expect(hex2.value).toBe('#82ca9d');
  });

  it('a valid hex commits on Enter as a per-index patch; a weak colour also shows a per-theme warning', () => {
    const onChange = vi.fn();
    render(
      <ChartConfigPanel
        resolved={resolvePresentation(lineCtx, {})}
        seriesMeta={colorMeta}
        onChange={onChange}
        onReset={vi.fn()}
        idPrefix="k2"
      />,
    );
    openTab('Kleuren');
    const hex = screen.getByRole('textbox', { name: 'Kleur van Amsterdam (hex-code)' }) as HTMLInputElement;
    fireEvent.change(hex, { target: { value: 'ffc658' } });
    fireEvent.keyDown(hex, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith({ seriesColors: { 0: '#ffc658' } });
    expect(screen.getByText('Deze kleur is slecht leesbaar in het lichte thema.')).toBeInTheDocument();
  });

  it('a valid hex also commits on blur (no Enter needed)', () => {
    const onChange = vi.fn();
    render(
      <ChartConfigPanel
        resolved={resolvePresentation(lineCtx, {})}
        seriesMeta={colorMeta}
        onChange={onChange}
        onReset={vi.fn()}
        idPrefix="k2b"
      />,
    );
    openTab('Kleuren');
    const hex = screen.getByRole('textbox', { name: 'Kleur van Amsterdam (hex-code)' }) as HTMLInputElement;
    fireEvent.change(hex, { target: { value: '#0088fe' } });
    fireEvent.blur(hex);
    expect(onChange).toHaveBeenCalledWith({ seriesColors: { 0: '#0088fe' } });
  });

  it('a colour that would hide the hollow provisional ring is refused with a reason and not emitted', () => {
    const onChange = vi.fn();
    render(
      <ChartConfigPanel
        resolved={resolvePresentation(lineCtx, {})}
        seriesMeta={colorMeta}
        onChange={onChange}
        onReset={vi.fn()}
        idPrefix="k3"
      />,
    );
    openTab('Kleuren');
    const hex = screen.getByRole('textbox', { name: 'Kleur van Amsterdam (hex-code)' }) as HTMLInputElement;
    fireEvent.change(hex, { target: { value: '#fefefe' } });
    fireEvent.blur(hex);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toMatch(/voorlopige cijfers/);
    expect(hex.value).toBe('#8884d8'); // snapped back
  });

  it('garbage in the hex box is ignored and snaps back', () => {
    const onChange = vi.fn();
    render(
      <ChartConfigPanel
        resolved={resolvePresentation(lineCtx, {})}
        seriesMeta={colorMeta}
        onChange={onChange}
        onReset={vi.fn()}
        idPrefix="k4"
      />,
    );
    openTab('Kleuren');
    const hex = screen.getByRole('textbox', { name: 'Kleur van Amsterdam (hex-code)' }) as HTMLInputElement;
    fireEvent.change(hex, { target: { value: 'red' } });
    fireEvent.blur(hex);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(hex.value).toBe('#8884d8'); // snapped back silently
  });

  it('the colour picker commits through the same judge path as the hex box', () => {
    const onChange = vi.fn();
    render(
      <ChartConfigPanel
        resolved={resolvePresentation(lineCtx, {})}
        seriesMeta={colorMeta}
        onChange={onChange}
        onReset={vi.fn()}
        idPrefix="k5"
      />,
    );
    openTab('Kleuren');
    const picker = screen.getByLabelText('Kleur van Amsterdam kiezen') as HTMLInputElement;
    fireEvent.change(picker, { target: { value: '#ffc658' } });
    expect(onChange).toHaveBeenCalledWith({ seriesColors: { 0: '#ffc658' } });
    expect(screen.getByText('Deze kleur is slecht leesbaar in het lichte thema.')).toBeInTheDocument();
  });

  it('Standaardkleuren is disabled while no colour override exists', () => {
    render(
      <ChartConfigPanel
        resolved={resolvePresentation(lineCtx, {})}
        seriesMeta={colorMeta}
        onChange={vi.fn()}
        onReset={vi.fn()}
        idPrefix="k6"
      />,
    );
    openTab('Kleuren');
    expect(screen.getByRole('button', { name: 'Standaardkleuren' })).toBeDisabled();
  });

  it('Standaardkleuren clears all colour overrides', () => {
    const onChange = vi.fn();
    render(
      <ChartConfigPanel
        resolved={resolvePresentation(lineCtx, { seriesColors: { 0: '#ffc658' } })}
        seriesMeta={colorMeta}
        onChange={onChange}
        onReset={vi.fn()}
        idPrefix="k6b"
      />,
    );
    openTab('Kleuren');
    const resetColors = screen.getByRole('button', { name: 'Standaardkleuren' });
    expect(resetColors).not.toBeDisabled();
    fireEvent.click(resetColors);
    expect(onChange).toHaveBeenCalledWith({ seriesColors: {} });
  });

  it('hex codes never appear as text nodes (only as input values)', () => {
    const { container } = render(
      <ChartConfigPanel
        resolved={resolvePresentation(lineCtx, {})}
        seriesMeta={colorMeta}
        onChange={vi.fn()}
        onReset={vi.fn()}
        idPrefix="k7"
      />,
    );
    openTab('Kleuren');
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) expect(n.textContent).not.toMatch(/\d/);
  });
});

describe('ChartConfigPanel — Lettertype tab', () => {
  it('lists Standaard + the curated families and emits fontFamily', () => {
    const onChange = vi.fn();
    render(
      <ChartConfigPanel
        resolved={resolvePresentation(lineCtx, {})}
        seriesMeta={colorMeta}
        onChange={onChange}
        onReset={vi.fn()}
        idPrefix="f1"
      />,
    );
    openTab('Lettertype');
    const select = screen.getByRole('combobox', { name: 'Lettertype' }) as HTMLSelectElement;
    const optionLabels = Array.from(select.options).map((o) => o.textContent);
    expect(optionLabels).toEqual(['Standaard', ...FONT_OPTIONS.map((f) => f.family)]);
    fireEvent.change(select, { target: { value: 'Roboto' } });
    expect(onChange).toHaveBeenCalledWith({ fontFamily: 'Roboto' });
  });

  it('pre-fills from the resolved font, and choosing Standaard clears it', () => {
    const onChange = vi.fn();
    render(
      <ChartConfigPanel
        resolved={resolvePresentation(lineCtx, { fontFamily: 'Lato' })}
        seriesMeta={colorMeta}
        onChange={onChange}
        onReset={vi.fn()}
        idPrefix="f2"
      />,
    );
    openTab('Lettertype');
    const select = screen.getByRole('combobox', { name: 'Lettertype' }) as HTMLSelectElement;
    expect(select.value).toBe('Lato');
    fireEvent.change(select, { target: { value: '' } });
    expect(onChange).toHaveBeenCalledWith({ fontFamily: null });
  });
});

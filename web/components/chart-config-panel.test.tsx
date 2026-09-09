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
import { useState, type ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FONT_OPTIONS, resolvePresentation, type PresentationContext } from '../lib/chart-presentation.ts';
import { ChartConfigPanel, ChartConfigTrigger, type ChartConfigPanelProps } from './chart-config-panel.tsx';

afterEach(() => {
  cleanup();
});

// Review fix (chart-panel-layout, option A): ChartConfigPanel is now a fully
// controlled component (no more internal open state, no more portaled
// trigger) — chart.tsx owns the boolean and renders ChartConfigTrigger
// separately in its own tablist row. This tiny harness plays that same role
// for the tests below, so every existing assertion (find the "Opmaak"/
// "Style" button, click it, expect aria-expanded/the region to open) keeps
// working unchanged: it holds the one boolean and wires the trigger and the
// panel to the same triggerId/controlsId pair chart.tsx uses.
function Harness(props: Omit<ChartConfigPanelProps, 'open' | 'onOpenChange' | 'triggerId'>): ReactNode {
  const [open, setOpen] = useState(false);
  const triggerId = `${props.idPrefix}-style-trigger`;
  const controlsId = `${props.idPrefix}-style`;
  return (
    <>
      <ChartConfigTrigger
        open={open}
        onToggle={() => setOpen((wasOpen) => !wasOpen)}
        controlsId={controlsId}
        triggerId={triggerId}
        lang={props.lang}
      />
      <ChartConfigPanel {...props} open={open} onOpenChange={setOpen} triggerId={triggerId} />
    </>
  );
}

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
      <Harness
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

  it('option A layout: each group label is its radiogroup\'s aria-labelledby target and sits in the same grid as the pills, and Tonen groups the three toggles', () => {
    render(
      <Harness
        resolved={resolvePresentation(lineCtx, {})}
        seriesMeta={meta}
        onChange={vi.fn()}
        onReset={vi.fn()}
        idPrefix="c"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Opmaak' }));
    const lineWidthGroup = screen.getByRole('radiogroup', { name: 'Lijndikte' });
    const grid = lineWidthGroup.parentElement as HTMLElement;
    expect(grid.className).toMatch(/grid-cols-\[112px_minmax\(0,1fr\)\]/);
    const label = document.getElementById(lineWidthGroup.getAttribute('aria-labelledby')!) as HTMLElement;
    // The label is the aria-labelledby TARGET, and a direct child of the very
    // same grid as the radiogroup it labels — not a wrapper div around the
    // pair, which would break the grid's own two-column auto-placement.
    expect(label.textContent).toBe('Lijndikte');
    expect(label.parentElement).toBe(grid);
    expect(lineWidthGroup.parentElement).toBe(grid);

    // Every radiogroup in the Grafiek tab lives in the SAME grid container —
    // one flat list of label/value pairs, not one grid per row.
    for (const name of ['Punten', 'Rasterlijnen', 'Labels op de x-as']) {
      expect(screen.getByRole('radiogroup', { name }).parentElement).toBe(grid);
    }

    // The three on/off toggles are grouped under one "Tonen" label, in that
    // same grid, rather than each getting its own label row.
    const showToggles = screen.getByRole('group', { name: 'Tonen' });
    expect(showToggles.parentElement).toBe(grid);
    expect(within(showToggles).getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Aslijnen',
      'Waarden',
      'Y-as vanaf nul',
    ]);
  });

  it('pre-fills every control from the resolved values, not from a stored default', () => {
    const resolved = resolvePresentation(lineCtx, { lineWidth: 'thick', grid: 'none', axisLines: 'hidden' });
    render(
      <Harness resolved={resolved} seriesMeta={meta} onChange={vi.fn()} onReset={vi.fn()} idPrefix="c" />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Opmaak' }));
    expect(screen.getByRole('radio', { name: 'Dik' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Geen' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('button', { name: 'Aslijnen' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('emits a patch for exactly the changed key', () => {
    const onChange = vi.fn();
    render(
      <Harness
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
    fireEvent.click(screen.getByRole('button', { name: 'Waarden' }));
    expect(onChange).toHaveBeenCalledWith({ valueLabels: 'hidden' });
  });

  it('bar form: locked controls are disabled with a readable reason; inapplicable ones are absent', () => {
    const resolved = resolvePresentation(barCtx, {});
    render(
      <Harness resolved={resolved} seriesMeta={meta} onChange={vi.fn()} onReset={vi.fn()} idPrefix="c" />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Opmaak' }));
    const values = screen.getByRole('button', { name: 'Waarden' });
    expect(values).toBeDisabled();
    expect(document.getElementById(values.getAttribute('aria-describedby')!)?.textContent).toMatch(/staafdiagram/);
    expect(screen.queryByRole('radiogroup', { name: 'Lijndikte' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Y-as vanaf nul' })).toBeNull();
  });

  it('Standaard is disabled while pristine and calls onReset otherwise', () => {
    const { unmount } = render(
      <Harness
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
      <Harness
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
      <Harness
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
        <Harness
          lang={lang}
          resolved={resolvePresentation(lineCtx, {})}
          seriesMeta={meta}
          onChange={vi.fn()}
          onReset={vi.fn()}
          idPrefix={lang}
          // WP218 phase 3 (owner B): the Merkkleuren block's copy joins this
          // scan too — a `brand` prop with an unused stub is enough to render
          // the heading/intro/button text (the need_website input only
          // appears after a real lookup, tested separately below).
          brand={{ lookup: vi.fn() }}
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: lang === 'nl' ? 'Opmaak' : 'Style' }));
      for (const tab of screen.getAllByRole('tab')) fireEvent.click(tab);
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) expect(n.textContent).not.toMatch(/\d/);
      unmount();
    }
  });

  it('WP218 phase 4: the "Taal van de grafiek" select offers Zoals de app/Nederlands/English and emits the chosen language', () => {
    const onChange = vi.fn();
    render(
      <Harness
        resolved={resolvePresentation(lineCtx, {})}
        seriesMeta={meta}
        onChange={onChange}
        onReset={vi.fn()}
        idPrefix="c"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Opmaak' }));
    const select = screen.getByRole('combobox', { name: 'Taal van de grafiek' }) as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual(['Zoals de app', 'Nederlands', 'English']);
    expect(select.value).toBe(''); // null -> follow the app language
    fireEvent.change(select, { target: { value: 'en' } });
    expect(onChange).toHaveBeenCalledWith({ language: 'en' });
    fireEvent.change(select, { target: { value: '' } });
    expect(onChange).toHaveBeenCalledWith({ language: null });
  });

  it('WP218 phase 4: the language select pre-fills from the resolved value and renders in English under lang="en"', () => {
    const resolved = resolvePresentation(lineCtx, { language: 'en' });
    render(
      <Harness lang="en" resolved={resolved} seriesMeta={meta} onChange={vi.fn()} onReset={vi.fn()} idPrefix="c2" />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Style' }));
    const select = screen.getByRole('combobox', { name: 'Chart language' }) as HTMLSelectElement;
    expect(select.value).toBe('en');
    expect([...select.options].map((o) => o.textContent)).toEqual(['Same as the app', 'Nederlands', 'English']);
  });

  it('WP218 phase 5: the "why no pie or stacked chart" note is collapsed by default and opens on click', () => {
    render(
      <Harness
        resolved={resolvePresentation(lineCtx, {})}
        seriesMeta={meta}
        onChange={vi.fn()}
        onReset={vi.fn()}
        idPrefix="c"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Opmaak' }));
    const summary = screen.getByText('Waarom geen taart- of gestapelde grafiek?');
    const details = summary.closest('details');
    expect(details).not.toBeNull();
    expect(details).not.toHaveAttribute('open');
    // The body text is present in the DOM either way (jsdom does not apply
    // the UA `display: none` that a real browser would use to hide a closed
    // <details>'s content) — the load-bearing assertion is the `open`
    // attribute above, not text presence.
    expect(
      screen.getByText(
        'Een taart- of gestapelde grafiek tekent een totaal of een aandeel dat in geen enkele CBS-cel staat. Een spreidingsgrafiek heeft twee meetwaarden per punt nodig, en deze grafiek heeft er één. Sorteren op waarde is een rangorde die niet gemeten is.',
      ),
    ).toBeInTheDocument();
    fireEvent.click(summary);
    expect(details).toHaveAttribute('open');
    expect(
      screen.getByText(
        'Een taart- of gestapelde grafiek tekent een totaal of een aandeel dat in geen enkele CBS-cel staat. Een spreidingsgrafiek heeft twee meetwaarden per punt nodig, en deze grafiek heeft er één. Sorteren op waarde is een rangorde die niet gemeten is.',
      ),
    ).toBeInTheDocument();
  });

  it('WP218 phase 5: the "why no pie or stacked chart" note renders in English under lang="en"', () => {
    render(
      <Harness
        lang="en"
        resolved={resolvePresentation(lineCtx, {})}
        seriesMeta={meta}
        onChange={vi.fn()}
        onReset={vi.fn()}
        idPrefix="c"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Style' }));
    expect(screen.getByText('Why no pie or stacked chart?')).toBeInTheDocument();
    expect(
      screen.getByText(
        'A pie or a stacked chart draws a total or a share that no CBS cell contains. A scatter plot needs two measures per point, and this chart has one. Sorting by value asserts a ranking that was never measured.',
      ),
    ).toBeInTheDocument();
  });

  // Review finding: the footer (the "why not pie" note + the full "Standaard"
  // reset) is a property of the Grafiek tab only now — on Kleuren it used to
  // sit right beside "Standaardkleuren", showing two resets side by side.
  it('the footer\'s Standaard (and the "why not" note) shows only on the Grafiek tab, not on Kleuren or Lettertype', () => {
    render(
      <Harness
        resolved={resolvePresentation(lineCtx, { lineWidth: 'thick' })}
        seriesMeta={colorMeta}
        onChange={vi.fn()}
        onReset={vi.fn()}
        idPrefix="footer1"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Opmaak' }));
    expect(screen.getByRole('button', { name: 'Standaard' })).toBeInTheDocument();
    expect(screen.getByText('Waarom geen taart- of gestapelde grafiek?')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Kleuren' }));
    expect(screen.queryByRole('button', { name: 'Standaard' })).toBeNull();
    expect(screen.queryByText('Waarom geen taart- of gestapelde grafiek?')).toBeNull();
    // Kleuren keeps its own, separate reset.
    expect(screen.getByRole('button', { name: 'Standaardkleuren' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Lettertype' }));
    expect(screen.queryByRole('button', { name: 'Standaard' })).toBeNull();
    expect(screen.queryByText('Waarom geen taart- of gestapelde grafiek?')).toBeNull();

    fireEvent.click(screen.getByRole('tab', { name: 'Grafiek' }));
    expect(screen.getByRole('button', { name: 'Standaard' })).toBeInTheDocument();
  });
});

describe('ChartConfigPanel — Kleuren tab', () => {
  it('an untouched default colour never warns, even a weak palette entry (the stock look is the owner\'s accepted trade-off)', () => {
    render(
      <Harness
        resolved={resolvePresentation(lineCtx, {})}
        seriesMeta={colorMeta}
        onChange={vi.fn()}
        onReset={vi.fn()}
        idPrefix="k0"
      />,
    );
    openTab('Kleuren');
    expect(screen.queryByText(/slecht leesbaar/)).toBeNull();
  });

  it('one row per series with swatch, hex input and colour picker pre-filled with the effective colour', () => {
    render(
      <Harness
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
      <Harness
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
    const amsterdamRow = screen.getByRole('group', { name: 'Amsterdam' });
    expect(within(amsterdamRow).getByText('Deze kleur is slecht leesbaar in het lichte thema.')).toBeInTheDocument();
  });

  it('a valid hex also commits on blur (no Enter needed)', () => {
    const onChange = vi.fn();
    render(
      <Harness
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
      <Harness
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
      <Harness
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
      <Harness
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
    const amsterdamRow = screen.getByRole('group', { name: 'Amsterdam' });
    expect(within(amsterdamRow).getByText('Deze kleur is slecht leesbaar in het lichte thema.')).toBeInTheDocument();
  });

  it('Standaardkleuren is disabled while no colour override exists', () => {
    render(
      <Harness
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
      <Harness
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
      <Harness
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

  // Review findings (post-Task-6): the local draft/warning/alert state is
  // keyed by series.key and must re-sync whenever the EFFECTIVE colour
  // (seriesMeta[i].color) changes from OUTSIDE the row — Standaardkleuren, a
  // Standaard reset, or a spec swap on the same mounted chart — rather than
  // holding on to whatever was last typed/committed forever.
  it('re-syncs the hex textbox and clears the warning once the effective colour resets to the palette default (Standaardkleuren)', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <Harness
        resolved={resolvePresentation(lineCtx, {})}
        seriesMeta={colorMeta}
        onChange={onChange}
        onReset={vi.fn()}
        idPrefix="k8"
      />,
    );
    openTab('Kleuren');
    const hex = screen.getByRole('textbox', { name: 'Kleur van Amsterdam (hex-code)' }) as HTMLInputElement;
    fireEvent.change(hex, { target: { value: 'ffc658' } });
    fireEvent.keyDown(hex, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith({ seriesColors: { 0: '#ffc658' } });

    // The parent applies the patch and re-resolves (the real chart.tsx
    // flow): the effective colour for Amsterdam now reflects the commit.
    rerender(
      <Harness
        resolved={resolvePresentation(lineCtx, { seriesColors: { 0: '#ffc658' } })}
        seriesMeta={[{ ...colorMeta[0]!, color: '#ffc658' }, colorMeta[1]!]}
        onChange={onChange}
        onReset={vi.fn()}
        idPrefix="k8"
      />,
    );

    // Standaardkleuren: overrides cleared, Amsterdam back to its default.
    rerender(
      <Harness
        resolved={resolvePresentation(lineCtx, {})}
        seriesMeta={colorMeta}
        onChange={onChange}
        onReset={vi.fn()}
        idPrefix="k8"
      />,
    );
    const hexAfter = screen.getByRole('textbox', { name: 'Kleur van Amsterdam (hex-code)' }) as HTMLInputElement;
    expect(hexAfter.value).toBe('#8884d8');
    expect(
      within(screen.getByRole('group', { name: 'Amsterdam' })).queryByText(
        'Deze kleur is slecht leesbaar in het lichte thema.',
      ),
    ).toBeNull();
  });

  it('a warning shown right after a commit disappears once the effective colour changes to something else', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <Harness
        resolved={resolvePresentation(lineCtx, {})}
        seriesMeta={colorMeta}
        onChange={onChange}
        onReset={vi.fn()}
        idPrefix="k9"
      />,
    );
    openTab('Kleuren');
    const hex = screen.getByRole('textbox', { name: 'Kleur van Amsterdam (hex-code)' }) as HTMLInputElement;
    fireEvent.change(hex, { target: { value: 'ffc658' } });
    fireEvent.keyDown(hex, { key: 'Enter' });
    const amsterdamRow = () => screen.getByRole('group', { name: 'Amsterdam' });
    expect(within(amsterdamRow()).getByText('Deze kleur is slecht leesbaar in het lichte thema.')).toBeInTheDocument();

    rerender(
      <Harness
        resolved={resolvePresentation(lineCtx, { seriesColors: { 0: '#ff0000' } })}
        seriesMeta={[{ ...colorMeta[0]!, color: '#ff0000' }, colorMeta[1]!]}
        onChange={onChange}
        onReset={vi.fn()}
        idPrefix="k9"
      />,
    );
    expect(within(amsterdamRow()).queryByText('Deze kleur is slecht leesbaar in het lichte thema.')).toBeNull();
  });

  it('a refusal alert clears once the effective colour changes from outside', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <Harness
        resolved={resolvePresentation(lineCtx, {})}
        seriesMeta={colorMeta}
        onChange={onChange}
        onReset={vi.fn()}
        idPrefix="k10"
      />,
    );
    openTab('Kleuren');
    const hex = screen.getByRole('textbox', { name: 'Kleur van Amsterdam (hex-code)' }) as HTMLInputElement;
    fireEvent.change(hex, { target: { value: '#fefefe' } });
    fireEvent.blur(hex);
    expect(screen.getByRole('alert')).toBeInTheDocument();

    rerender(
      <Harness
        resolved={resolvePresentation(lineCtx, { seriesColors: { 0: '#ff0000' } })}
        seriesMeta={[{ ...colorMeta[0]!, color: '#ff0000' }, colorMeta[1]!]}
        onChange={onChange}
        onReset={vi.fn()}
        idPrefix="k10"
      />,
    );
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('Enter followed by blur with the identical value commits only once', () => {
    const onChange = vi.fn();
    render(
      <Harness
        resolved={resolvePresentation(lineCtx, {})}
        seriesMeta={colorMeta}
        onChange={onChange}
        onReset={vi.fn()}
        idPrefix="k11"
      />,
    );
    openTab('Kleuren');
    const hex = screen.getByRole('textbox', { name: 'Kleur van Amsterdam (hex-code)' }) as HTMLInputElement;
    fireEvent.change(hex, { target: { value: '#0088fe' } });
    fireEvent.keyDown(hex, { key: 'Enter' });
    fireEvent.blur(hex);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('the colour picker also refuses a bad colour without emitting onChange', () => {
    const onChange = vi.fn();
    render(
      <Harness
        resolved={resolvePresentation(lineCtx, {})}
        seriesMeta={colorMeta}
        onChange={onChange}
        onReset={vi.fn()}
        idPrefix="k12"
      />,
    );
    openTab('Kleuren');
    const picker = screen.getByLabelText('Kleur van Amsterdam kiezen') as HTMLInputElement;
    fireEvent.change(picker, { target: { value: '#fefefe' } });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});

// WP218 phase 3 (#218 chart styling, owner decision B): the "Merkkleuren"
// block, under the series rows in the Kleuren tab. `brand` is a dumb
// lookup-only interface (chart.tsx supplies the real lookupBrand Server
// Action) — these tests drive it with plain vi.fn() stubs, exactly like the
// account-default row's onSave/onForget below.
describe('ChartConfigPanel — WP218 phase 3 (owner B): Merkkleuren block', () => {
  it('no brand prop → no block at all', () => {
    render(
      <Harness
        resolved={resolvePresentation(lineCtx, {})}
        seriesMeta={colorMeta}
        onChange={vi.fn()}
        onReset={vi.fn()}
        idPrefix="br0"
      />,
    );
    openTab('Kleuren');
    expect(screen.queryByText('Merkkleuren')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Pas merkkleuren toe' })).toBeNull();
  });

  it('success: applies only the accepted colours (a near-white brand colour is skipped) plus the font, in one onChange call; shows the status line and hands the applied brand to onBrandApplied', async () => {
    const onChange = vi.fn();
    const onBrandApplied = vi.fn();
    const lookup = vi.fn().mockResolvedValue({
      ok: true,
      brand: {
        name: 'Voorbeeld BV',
        domain: 'voorbeeld.nl',
        colors: ['#ff7300', '#fefefe'],
        font: { family: 'Lato', origin: 'google' },
        fetchedAt: '2026-01-01T00:00:00.000Z',
        cached: false,
      },
    });
    render(
      <Harness
        resolved={resolvePresentation(lineCtx, {})}
        seriesMeta={colorMeta}
        onChange={onChange}
        onReset={vi.fn()}
        idPrefix="br1"
        brand={{ lookup }}
        onBrandApplied={onBrandApplied}
      />,
    );
    openTab('Kleuren');
    fireEvent.click(screen.getByRole('button', { name: 'Pas merkkleuren toe' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Kleuren en lettertype van Voorbeeld BV toegepast, via Brandfetch.',
    );
    expect(onChange).toHaveBeenCalledTimes(1);
    // #fefefe (near-white) fails judgeColor — index 1 is skipped entirely,
    // not swapped in for a different colour.
    expect(onChange).toHaveBeenCalledWith({ seriesColors: { 0: '#ff7300' }, fontFamily: 'Lato' });
    expect(screen.queryByText('Een lettertype dat niet vrij beschikbaar is, is overgeslagen.')).toBeNull();
    expect(onBrandApplied).toHaveBeenCalledWith({
      domain: 'voorbeeld.nl',
      name: 'Voorbeeld BV',
      fetchedAt: '2026-01-01T00:00:00.000Z',
    });
  });

  it('success with no font: fontFamily is omitted from the patch (an existing font choice is never cleared) and the skipped-font note shows', async () => {
    const onChange = vi.fn();
    const lookup = vi.fn().mockResolvedValue({
      ok: true,
      brand: {
        name: 'Voorbeeld BV',
        domain: 'voorbeeld.nl',
        colors: ['#ff7300'],
        font: null,
        fetchedAt: '2026-01-01T00:00:00.000Z',
        cached: false,
      },
    });
    render(
      <Harness
        resolved={resolvePresentation(lineCtx, {})}
        seriesMeta={colorMeta}
        onChange={onChange}
        onReset={vi.fn()}
        idPrefix="br2"
        brand={{ lookup }}
      />,
    );
    openTab('Kleuren');
    fireEvent.click(screen.getByRole('button', { name: 'Pas merkkleuren toe' }));
    await screen.findByRole('status');
    expect(onChange).toHaveBeenCalledTimes(1);
    const patch = onChange.mock.calls[0]![0] as Record<string, unknown>;
    expect(patch).not.toHaveProperty('fontFamily');
    expect(patch).toEqual({ seriesColors: { 0: '#ff7300' } });
    expect(screen.getByText('Een lettertype dat niet vrij beschikbaar is, is overgeslagen.')).toBeInTheDocument();
  });

  it('need_website shows NO failure line — it just asks for the website (P3 task-4 review)', async () => {
    const lookup = vi.fn().mockResolvedValue({ ok: false, reason: 'need_website' });
    render(
      <Harness
        resolved={resolvePresentation(lineCtx, {})}
        seriesMeta={colorMeta}
        onChange={vi.fn()}
        onReset={vi.fn()}
        idPrefix="brnw"
        brand={{ lookup }}
      />,
    );
    openTab('Kleuren');
    fireEvent.click(screen.getByRole('button', { name: 'Pas merkkleuren toe' }));
    expect(await screen.findByLabelText('Website van je organisatie')).toBeInTheDocument();
    expect(screen.queryByText(/niet mogelijk|ging iets mis|geen merk|Probeer het later/)).toBeNull();
  });

  it('more brand colours than series: extra colours are dropped (bounded by the chart, never a stray index in the patch)', async () => {
    const onChange = vi.fn();
    const lookup = vi.fn().mockResolvedValue({
      ok: true,
      brand: { name: 'Drie BV', domain: 'drie.nl', colors: ['#ff7300', '#0088fe', '#00c49f'], font: null, fetchedAt: '2026-01-01T00:00:00.000Z', cached: false },
    });
    render(
      <Harness
        resolved={resolvePresentation(lineCtx, {})}
        seriesMeta={colorMeta}
        onChange={onChange}
        onReset={vi.fn()}
        idPrefix="br3c"
        brand={{ lookup }}
      />,
    );
    openTab('Kleuren');
    fireEvent.click(screen.getByRole('button', { name: 'Pas merkkleuren toe' }));
    await screen.findByRole('status');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toEqual({ seriesColors: { 0: '#ff7300', 1: '#0088fe' } });
  });

  it('need_website: reveals the website input, and the retry call carries the typed domain', async () => {
    const lookup = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, reason: 'need_website' })
      .mockResolvedValueOnce({
        ok: true,
        brand: {
          name: 'Voorbeeld BV',
          domain: 'voorbeeld.nl',
          colors: ['#ff7300'],
          font: null,
          fetchedAt: '2026-01-01T00:00:00.000Z',
          cached: false,
        },
      });
    render(
      <Harness
        resolved={resolvePresentation(lineCtx, {})}
        seriesMeta={colorMeta}
        onChange={vi.fn()}
        onReset={vi.fn()}
        idPrefix="br3"
        brand={{ lookup }}
      />,
    );
    openTab('Kleuren');
    fireEvent.click(screen.getByRole('button', { name: 'Pas merkkleuren toe' }));
    const input = await screen.findByRole('textbox', { name: 'Website van je organisatie' });
    expect(input).toHaveAttribute('placeholder', 'bijv. jouworganisatie.nl');
    fireEvent.change(input, { target: { value: 'voorbeeld.nl' } });
    fireEvent.click(screen.getByRole('button', { name: 'Pas merkkleuren toe' }));
    await screen.findByRole('status');
    expect(lookup).toHaveBeenNthCalledWith(2, 'voorbeeld.nl');
  });

  it('shows the digit-free copy for every failure reason and never calls onChange', async () => {
    const reasons: [string, string][] = [
      ['unavailable', 'Merkkleuren ophalen is op dit moment niet mogelijk.'],
      ['not_found', 'Voor dit domein is geen merk gevonden.'],
      ['invalid_domain', 'Dat ziet er niet uit als een website.'],
      ['rate_limited', 'Probeer het later nog eens.'],
      ['daily_cap', 'Probeer het later nog eens.'],
      ['error', 'Er ging iets mis. Probeer het later opnieuw.'],
      ['unauthenticated', 'Merkkleuren ophalen is op dit moment niet mogelijk.'],
    ];
    for (const [reason, expectedText] of reasons) {
      const onChange = vi.fn();
      const lookup = vi.fn().mockResolvedValue({ ok: false, reason });
      const { unmount } = render(
        <Harness
          resolved={resolvePresentation(lineCtx, {})}
          seriesMeta={colorMeta}
          onChange={onChange}
          onReset={vi.fn()}
          idPrefix={`brf-${reason}`}
          brand={{ lookup }}
        />,
      );
      openTab('Kleuren');
      fireEvent.click(screen.getByRole('button', { name: 'Pas merkkleuren toe' }));
      expect(await screen.findByRole('status')).toHaveTextContent(expectedText);
      expect(onChange).not.toHaveBeenCalled();
      unmount();
    }
  });

  it('busy-disables the apply button while a lookup is pending, re-enables once it settles', async () => {
    let resolveLookup!: (value: { ok: false; reason: 'unavailable' }) => void;
    const lookup = vi.fn(
      () =>
        new Promise<{ ok: false; reason: 'unavailable' }>((resolve) => {
          resolveLookup = resolve;
        }),
    );
    render(
      <Harness
        resolved={resolvePresentation(lineCtx, {})}
        seriesMeta={colorMeta}
        onChange={vi.fn()}
        onReset={vi.fn()}
        idPrefix="br4"
        brand={{ lookup }}
      />,
    );
    openTab('Kleuren');
    const button = screen.getByRole('button', { name: 'Pas merkkleuren toe' });
    fireEvent.click(button);
    expect(button).toBeDisabled();
    resolveLookup({ ok: false, reason: 'unavailable' });
    await screen.findByRole('status');
    expect(button).not.toBeDisabled();
  });

  it('English: heading/intro/button copy, applied status text, and stays digit-free', async () => {
    const lookup = vi.fn().mockResolvedValue({
      ok: true,
      brand: {
        name: 'Example BV',
        domain: 'example.com',
        colors: ['#ff7300'],
        font: { family: 'Lato', origin: 'google' },
        fetchedAt: '2026-01-01T00:00:00.000Z',
        cached: false,
      },
    });
    render(
      <Harness
        lang="en"
        resolved={resolvePresentation(lineCtx, {})}
        seriesMeta={colorMeta}
        onChange={vi.fn()}
        onReset={vi.fn()}
        idPrefix="br5"
        brand={{ lookup }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Style' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Colours' }));
    expect(screen.getByText('Brand colours')).toBeInTheDocument();
    expect(screen.getByText("Fetch your organisation's colours and font.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Apply brand colours' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Colours and font of Example BV applied, via Brandfetch.',
    );
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) expect(n.textContent).not.toMatch(/\d/);
  });
});

describe('ChartConfigPanel — Lettertype tab', () => {
  it('lists Standaard + the curated families and emits fontFamily', () => {
    const onChange = vi.fn();
    render(
      <Harness
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
      <Harness
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

  it('final-review fix: a fontFamily outside the curated FONT_OPTIONS (a brand font) shows as its own selected option, not a blank select', () => {
    render(
      <Harness
        resolved={resolvePresentation(lineCtx, { fontFamily: 'Poppins' })}
        seriesMeta={colorMeta}
        onChange={vi.fn()}
        onReset={vi.fn()}
        idPrefix="f3"
      />,
    );
    openTab('Lettertype');
    const select = screen.getByRole('combobox', { name: 'Lettertype' }) as HTMLSelectElement;
    expect(select.value).toBe('Poppins');
    const optionLabels = Array.from(select.options).map((o) => o.textContent);
    expect(optionLabels).toEqual(['Standaard', ...FONT_OPTIONS.map((f) => f.family), 'Poppins']);
  });
});

// WP218 phase 2 (#218 chart styling, owner C): the account-default footer
// row + status line + the "Mijn standaard is actief." hint. `account` is a
// dumb outcome-reporting interface here (chart.tsx owns the real server
// round trip and the useChartStyle()/usage-counter side effects) — these
// tests drive it with plain vi.fn() stubs.
describe('ChartConfigPanel — WP218 phase 2 (owner C): account default row', () => {
  it('no account prop → no row at all (Ontdek/trial)', () => {
    render(
      <Harness
        resolved={resolvePresentation(lineCtx, {})}
        seriesMeta={meta}
        onChange={vi.fn()}
        onReset={vi.fn()}
        idPrefix="acc0"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Opmaak' }));
    expect(screen.queryByRole('button', { name: 'Bewaar als mijn standaard' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Vergeet mijn standaard' })).toBeNull();
  });

  it('hasDefault false: only the save button is offered', () => {
    render(
      <Harness
        resolved={resolvePresentation(lineCtx, {})}
        seriesMeta={meta}
        onChange={vi.fn()}
        onReset={vi.fn()}
        idPrefix="acc1"
        account={{ hasDefault: false, onSave: vi.fn(), onForget: vi.fn() }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Opmaak' }));
    expect(screen.getByRole('button', { name: 'Bewaar als mijn standaard' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Vergeet mijn standaard' })).toBeNull();
    expect(screen.queryByText('Mijn standaard is actief.')).toBeNull();
  });

  it('hasDefault true + pristine: the hint shows above the Grafiek controls; a per-chart tweak hides it again', () => {
    const account = { hasDefault: true, onSave: vi.fn(), onForget: vi.fn() };
    const { rerender } = render(
      <Harness
        resolved={resolvePresentation(lineCtx, {})}
        seriesMeta={meta}
        onChange={vi.fn()}
        onReset={vi.fn()}
        idPrefix="acc2"
        account={account}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Opmaak' }));
    expect(screen.getByText('Mijn standaard is actief.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Vergeet mijn standaard' })).toBeInTheDocument();

    rerender(
      <Harness
        resolved={resolvePresentation(lineCtx, { lineWidth: 'thick' })}
        seriesMeta={meta}
        onChange={vi.fn()}
        onReset={vi.fn()}
        idPrefix="acc2"
        account={account}
      />,
    );
    expect(screen.queryByText('Mijn standaard is actief.')).toBeNull();
  });

  it('save flow: Opgeslagen. on ok, calls onSave exactly once', async () => {
    const onSave = vi.fn().mockResolvedValue('saved');
    render(
      <Harness
        resolved={resolvePresentation(lineCtx, {})}
        seriesMeta={meta}
        onChange={vi.fn()}
        onReset={vi.fn()}
        idPrefix="acc3"
        account={{ hasDefault: false, onSave, onForget: vi.fn() }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Opmaak' }));
    fireEvent.click(screen.getByRole('button', { name: 'Bewaar als mijn standaard' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Opgeslagen.');
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('save flow: the digit-free "unavailable" line on that outcome', async () => {
    const onSave = vi.fn().mockResolvedValue('unavailable');
    render(
      <Harness
        resolved={resolvePresentation(lineCtx, {})}
        seriesMeta={meta}
        onChange={vi.fn()}
        onReset={vi.fn()}
        idPrefix="acc4"
        account={{ hasDefault: false, onSave, onForget: vi.fn() }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Opmaak' }));
    fireEvent.click(screen.getByRole('button', { name: 'Bewaar als mijn standaard' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Opslaan is op dit moment niet mogelijk.');
  });

  it('save flow: the generic error line on a thrown/failed outcome', async () => {
    const onSave = vi.fn().mockResolvedValue('error');
    render(
      <Harness
        resolved={resolvePresentation(lineCtx, {})}
        seriesMeta={meta}
        onChange={vi.fn()}
        onReset={vi.fn()}
        idPrefix="acc5"
        account={{ hasDefault: false, onSave, onForget: vi.fn() }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Opmaak' }));
    fireEvent.click(screen.getByRole('button', { name: 'Bewaar als mijn standaard' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Er ging iets mis. Probeer het later opnieuw.');
  });

  it('forget flow: Vergeten. on success, calls onForget exactly once', async () => {
    const onForget = vi.fn().mockResolvedValue('forgotten');
    render(
      <Harness
        resolved={resolvePresentation(lineCtx, {})}
        seriesMeta={meta}
        onChange={vi.fn()}
        onReset={vi.fn()}
        idPrefix="acc6"
        account={{ hasDefault: true, onSave: vi.fn(), onForget }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Opmaak' }));
    fireEvent.click(screen.getByRole('button', { name: 'Vergeet mijn standaard' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Vergeten.');
    expect(onForget).toHaveBeenCalledTimes(1);
  });

  it('busy-disables both buttons while a save is pending, re-enables once it settles', async () => {
    let resolveSave!: (value: 'saved') => void;
    const onSave = vi.fn(
      () =>
        new Promise<'saved'>((resolve) => {
          resolveSave = resolve;
        }),
    );
    render(
      <Harness
        resolved={resolvePresentation(lineCtx, {})}
        seriesMeta={meta}
        onChange={vi.fn()}
        onReset={vi.fn()}
        idPrefix="acc7"
        account={{ hasDefault: true, onSave, onForget: vi.fn() }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Opmaak' }));
    const saveButton = screen.getByRole('button', { name: 'Bewaar als mijn standaard' });
    const forgetButton = screen.getByRole('button', { name: 'Vergeet mijn standaard' });
    fireEvent.click(saveButton);
    expect(saveButton).toBeDisabled();
    expect(forgetButton).toBeDisabled();
    resolveSave('saved');
    await screen.findByRole('status');
    expect(saveButton).not.toBeDisabled();
    expect(forgetButton).not.toBeDisabled();
  });

  it('English: row + hint copy, and every text node stays digit-free with the row shown', async () => {
    const onSave = vi.fn().mockResolvedValue('saved');
    render(
      <Harness
        lang="en"
        resolved={resolvePresentation(lineCtx, {})}
        seriesMeta={meta}
        onChange={vi.fn()}
        onReset={vi.fn()}
        idPrefix="acc8"
        account={{ hasDefault: true, onSave, onForget: vi.fn() }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Style' }));
    expect(screen.getByText('My default is active.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save as my default' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Forget my default' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save as my default' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Saved.');
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) expect(n.textContent).not.toMatch(/\d/);
  });
});

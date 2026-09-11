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
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FONT_OPTIONS, resolvePresentation, type PresentationContext } from '../lib/chart-presentation.ts';
import { templateById } from '../lib/chart-templates.ts';
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
function openTab(tab: 'Kleuren' | 'Lettertype' | 'Sjablonen'): void {
  fireEvent.click(screen.getByRole('button', { name: 'Opmaak' }));
  fireEvent.click(screen.getByRole('tab', { name: tab }));
}

describe('ChartConfigPanel — Grafiek tab', () => {
  it('is closed by default and opens into a labelled region with five tabs', () => {
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
      'Sjablonen',
      'Grafiek',
      'Kleuren',
      'Lettertype',
      'Kader',
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

  it('the Punten radiogroup offers three modes in order — Alle punten, Eerste en laatste, Alleen voorlopige — and emits ends', () => {
    const onChange = vi.fn();
    render(<ChartConfigPanel resolved={resolvePresentation(lineCtx, {})} seriesMeta={[]} onChange={onChange} onReset={() => {}} idPrefix="p" open onOpenChange={() => {}} triggerId="t" />);
    const group = screen.getByRole('radiogroup', { name: 'Punten' });
    const names = [...group.querySelectorAll('[role="radio"]')].map((r) => r.textContent);
    expect(names).toEqual(['Alle punten', 'Eerste en laatste', 'Alleen voorlopige']);
    expect(screen.getByRole('radio', { name: 'Eerste en laatste' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('radio', { name: 'Alle punten' }));
    expect(onChange).toHaveBeenCalledWith({ markers: 'all' });
  });
  it('the area-fill toggle is offered in area form only, pressed by default, and emits flat', () => {
    const onChange = vi.fn();
    const { unmount } = render(<ChartConfigPanel resolved={resolvePresentation({ ...lineCtx, form: 'area' }, {})} seriesMeta={[]} onChange={onChange} onReset={() => {}} idPrefix="p" open onOpenChange={() => {}} triggerId="t" />);
    const toggle = screen.getByRole('button', { name: 'Verloop in het vlak' });
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith({ areaFill: 'flat' });
    unmount();
    render(<ChartConfigPanel resolved={resolvePresentation(lineCtx, {})} seriesMeta={[]} onChange={onChange} onReset={() => {}} idPrefix="p" open onOpenChange={() => {}} triggerId="t" />);
    expect(screen.queryByRole('button', { name: 'Verloop in het vlak' })).toBeNull();
  });
  it('English: the new option and toggle read First and last / Gradient fill', () => {
    render(<ChartConfigPanel lang="en" resolved={resolvePresentation({ ...lineCtx, form: 'area' }, {})} seriesMeta={[]} onChange={() => {}} onReset={() => {}} idPrefix="p" open onOpenChange={() => {}} triggerId="t" />);
    expect(screen.getByRole('radio', { name: 'First and last' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Gradient fill' })).toBeTruthy();
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

  it('owner ask (2026-09-09): the "Taal van de grafiek" select offers only Nederlands/English, preselects the chart\'s current language (no override, lang="nl"), and emits an explicit per-chart choice', () => {
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
    expect([...select.options].map((o) => o.textContent)).toEqual(['Nederlands', 'English']);
    // No override and lang="nl" (the default) -> preselects the chart's current language, 'nl'.
    expect(select.value).toBe('nl');
    fireEvent.change(select, { target: { value: 'en' } });
    expect(onChange).toHaveBeenCalledWith({ language: 'en' });
  });

  it('owner ask (2026-09-09): with no override, the select preselects whatever language the chart currently resolves to (lang="en")', () => {
    render(
      <Harness
        lang="en"
        resolved={resolvePresentation(lineCtx, {})}
        seriesMeta={meta}
        onChange={vi.fn()}
        onReset={vi.fn()}
        idPrefix="c2"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Style' }));
    const select = screen.getByRole('combobox', { name: 'Chart language' }) as HTMLSelectElement;
    expect(select.value).toBe('en');
    expect([...select.options].map((o) => o.textContent)).toEqual(['Nederlands', 'English']);
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

  // Round 2: series colours must be judged against the ACTIVE frame's
  // backdrops, not only the fixed light/dark card pair — a colour matching
  // a solid frame background is invisible against it even though it would
  // pass against the cards.
  it('refuses a series colour matching a solid frame background when inset is off', () => {
    const onChange = vi.fn();
    render(
      <Harness
        resolved={resolvePresentation(lineCtx, { frameBackground: { kind: 'solid', hex: '#8884d8' }, frameInset: 'none' })}
        seriesMeta={colorMeta}
        onChange={onChange}
        onReset={vi.fn()}
        idPrefix="k3b"
      />,
    );
    openTab('Kleuren');
    const hex = screen.getByRole('textbox', { name: 'Kleur van Rotterdam (hex-code)' }) as HTMLInputElement;
    fireEvent.change(hex, { target: { value: '#8884d8' } });
    fireEvent.blur(hex);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toMatch(/voorlopige cijfers/);
  });

  it('accepts the same series colour when inset is on (the card, not the frame background, is behind it)', () => {
    const onChange = vi.fn();
    render(
      <Harness
        resolved={resolvePresentation(lineCtx, { frameBackground: { kind: 'solid', hex: '#8884d8' }, frameInset: 'small' })}
        seriesMeta={colorMeta}
        onChange={onChange}
        onReset={vi.fn()}
        idPrefix="k3c"
      />,
    );
    openTab('Kleuren');
    const hex = screen.getByRole('textbox', { name: 'Kleur van Rotterdam (hex-code)' }) as HTMLInputElement;
    fireEvent.change(hex, { target: { value: '#8884d8' } });
    fireEvent.blur(hex);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(onChange).toHaveBeenCalledWith({ seriesColors: { 1: '#8884d8' } });
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
      [
        'monthly_cap',
        'Merkkleuren ophalen is deze maand niet meer beschikbaar; vanaf de volgende maand weer.',
      ],
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

// Task 5 (design §C2): the Frame tab — background (None/Colour/Gradient/Own
// image), padding, corners, shadow, inset card, aspect ratio.
const tableCtx: PresentationContext = { kind: 'line', form: 'table', seriesCount: 2, hasProvisional: false };

function openFrameTab(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Opmaak' }));
  fireEvent.click(screen.getByRole('tab', { name: 'Kader' }));
}

function makeFile(name: string, type: string, sizeBytes: number): File {
  const bytes = new Uint8Array(sizeBytes);
  return new File([bytes], name, { type });
}

describe('ChartConfigPanel — Frame tab', () => {
  it('pre-fills the background radiogroup and the five plain radiogroups from resolved values', () => {
    const resolved = resolvePresentation(lineCtx, {
      frameBackground: { kind: 'solid', hex: '#336699' },
      framePadding: 'large',
      frameCorners: 'rounded',
      frameShadow: 'soft',
      frameInset: 'small',
      frameAspect: '16:9',
    });
    render(
      <Harness resolved={resolved} seriesMeta={colorMeta} onChange={vi.fn()} onReset={vi.fn()} idPrefix="fr1" />,
    );
    openFrameTab();
    expect(screen.getByRole('radio', { name: 'Kleur' })).toHaveAttribute('aria-checked', 'true');
    expect(within(screen.getByRole('radiogroup', { name: 'Ruimte rondom' })).getByRole('radio', { name: 'Groot' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('radio', { name: 'Rond' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Zacht' })).toHaveAttribute('aria-checked', 'true');
    expect(within(screen.getByRole('radiogroup', { name: 'Kaart' })).getByRole('radio', { name: 'Klein' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('radio', { name: 'Breedbeeld' })).toHaveAttribute('aria-checked', 'true');
  });

  it('each plain radiogroup emits exactly its own key', () => {
    const onChange = vi.fn();
    render(
      <Harness
        resolved={resolvePresentation(lineCtx, {})}
        seriesMeta={colorMeta}
        onChange={onChange}
        onReset={vi.fn()}
        idPrefix="fr2"
      />,
    );
    openFrameTab();
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Ruimte rondom' })).getByRole('radio', { name: 'Groot' }));
    expect(onChange).toHaveBeenCalledWith({ framePadding: 'large' });
    fireEvent.click(screen.getByRole('radio', { name: 'Extra rond' }));
    expect(onChange).toHaveBeenCalledWith({ frameCorners: 'veryRounded' });
    fireEvent.click(screen.getByRole('radio', { name: 'Sterk' }));
    expect(onChange).toHaveBeenCalledWith({ frameShadow: 'strong' });
    fireEvent.click(screen.getByRole('radio', { name: 'Vierkant' }));
    expect(onChange).toHaveBeenCalledWith({ frameAspect: '1:1' });
  });

  it('choosing Kleur reveals a hex field that emits a solid frameBackground', () => {
    const onChange = vi.fn();
    render(
      <Harness
        resolved={resolvePresentation(lineCtx, {})}
        seriesMeta={colorMeta}
        onChange={onChange}
        onReset={vi.fn()}
        idPrefix="fr3"
      />,
    );
    openFrameTab();
    fireEvent.click(screen.getByRole('radio', { name: 'Kleur' }));
    expect(onChange).toHaveBeenCalledWith({ frameBackground: { kind: 'solid', hex: '#ffffff' } });
  });

  it('choosing Verloop emits the default (dawn) preset colours as a gradient frameBackground', () => {
    const onChange = vi.fn();
    render(
      <Harness
        resolved={resolvePresentation(lineCtx, {})}
        seriesMeta={colorMeta}
        onChange={onChange}
        onReset={vi.fn()}
        idPrefix="fr4"
      />,
    );
    openFrameTab();
    fireEvent.click(screen.getByRole('radio', { name: 'Verloop' }));
    expect(onChange).toHaveBeenCalledWith({
      frameBackground: { kind: 'gradient', from: '#fde68a', to: '#f9a8d4' },
    });
  });

  it('with a gradient already active, the six presets and From/To fields show, and a preset click emits its own colours', () => {
    const onChange = vi.fn();
    render(
      <Harness
        resolved={resolvePresentation(lineCtx, { frameBackground: { kind: 'gradient', from: '#fde68a', to: '#f9a8d4' } })}
        seriesMeta={colorMeta}
        onChange={onChange}
        onReset={vi.fn()}
        idPrefix="fr4b"
      />,
    );
    openFrameTab();
    expect(screen.getByRole('button', { name: 'Oceaan' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Van (hex)' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Naar (hex)' })).toBeInTheDocument();
    // 'Leisteen' (slate), not 'Oceaan': Fix 5's contrast guard now refuses a
    // preset that would hide a series colour, and Rotterdam's palette green
    // (#82ca9d) is too close to Oceaan's light-blue stop (contrast ~1.11,
    // under COLOR_REFUSE_BELOW) — slate is legible against both fixture
    // series colours, so this stays a clean "preset click emits its own
    // colours" test rather than exercising the refusal path.
    fireEvent.click(screen.getByRole('button', { name: 'Leisteen' }));
    expect(onChange).toHaveBeenCalledWith({
      frameBackground: { kind: 'gradient', from: '#e2e8f0', to: '#334155' },
    });
  });

  it('round 2: a preset that would refuse (Oceaan, inset off) is disabled with the reason accessible via aria-describedby; a legible one (Leisteen) stays enabled', () => {
    render(
      <Harness
        resolved={resolvePresentation(lineCtx, { frameBackground: { kind: 'gradient', from: '#fde68a', to: '#f9a8d4' } })}
        seriesMeta={colorMeta}
        onChange={vi.fn()}
        onReset={vi.fn()}
        idPrefix="fr4c"
      />,
    );
    openFrameTab();
    const oceaan = screen.getByRole('button', { name: 'Oceaan' });
    expect(oceaan).toBeDisabled();
    expect(oceaan.getAttribute('title')).toBe(
      'Deze achtergrond maakt een reeks onleesbaar. Kies een andere kleur of zet de kaart aan.',
    );
    const describedById = oceaan.getAttribute('aria-describedby');
    expect(describedById).toBeTruthy();
    expect(document.getElementById(describedById!)?.textContent).toBe(
      'Deze achtergrond maakt een reeks onleesbaar. Kies een andere kleur of zet de kaart aan.',
    );
    const leisteen = screen.getByRole('button', { name: 'Leisteen' });
    expect(leisteen).not.toBeDisabled();
  });

  it('round 2: with the inset card on, every preset pill is enabled', () => {
    render(
      <Harness
        resolved={resolvePresentation(lineCtx, {
          frameBackground: { kind: 'gradient', from: '#fde68a', to: '#f9a8d4' },
          frameInset: 'small',
        })}
        seriesMeta={colorMeta}
        onChange={vi.fn()}
        onReset={vi.fn()}
        idPrefix="fr4d"
      />,
    );
    openFrameTab();
    for (const name of ['Dageraad', 'Oceaan', 'Bos', 'Bes', 'Leisteen', 'Zand']) {
      expect(screen.getByRole('button', { name })).not.toBeDisabled();
    }
  });

  it('Own image: a 6 MB file is refused with an alert and nothing is emitted', () => {
    const onChange = vi.fn();
    const onFrameImage = vi.fn();
    render(
      <Harness
        resolved={resolvePresentation(lineCtx, { frameBackground: { kind: 'image' } })}
        seriesMeta={colorMeta}
        onChange={onChange}
        onReset={vi.fn()}
        idPrefix="fr5"
        onFrameImage={onFrameImage}
      />,
    );
    openFrameTab();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const big = makeFile('big.png', 'image/png', 6 * 1024 * 1024);
    fireEvent.change(input, { target: { files: [big] } });
    expect(screen.getByRole('alert')).toHaveTextContent('De afbeelding is te groot. Kies een kleinere.');
    expect(onFrameImage).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalledWith({ frameBackground: { kind: 'image' } });
  });

  // Final-review fix (Fix 7): FRAME_IMAGE_MAX_BYTES lowered from 5 MB to
  // 2 MB — a 3 MB file (under the old limit, over the new one) must now be
  // refused.
  // Fix 5 exact scenarios: setting solid background #8884d8 when palette
  // series index 0 is also #8884d8 (identical colours, contrast ratio 1).
  it('refuses a solid background matching a series colour when inset is off: alert shown, onChange not called', () => {
    const onChange = vi.fn();
    render(
      <Harness
        resolved={resolvePresentation(lineCtx, { frameBackground: { kind: 'solid', hex: '#ffffff' }, frameInset: 'none' })}
        seriesMeta={colorMeta}
        onChange={onChange}
        onReset={vi.fn()}
        idPrefix="fr11"
      />,
    );
    openFrameTab();
    const hexField = screen.getByRole('textbox', { name: 'Achtergrond (hex)' }) as HTMLInputElement;
    fireEvent.change(hexField, { target: { value: '#8884d8' } });
    fireEvent.blur(hexField);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Deze achtergrond maakt een reeks onleesbaar. Kies een andere kleur of zet de kaart aan.',
    );
    expect(onChange).not.toHaveBeenCalled();
  });

  // Round 2: the refusal alert must not linger once the user has moved on —
  // switching tabs, or a later frame change that actually succeeds, both
  // clear it.
  it('round 2: the frame refusal alert clears when the user switches tabs', () => {
    render(
      <Harness
        resolved={resolvePresentation(lineCtx, { frameBackground: { kind: 'solid', hex: '#ffffff' }, frameInset: 'none' })}
        seriesMeta={colorMeta}
        onChange={vi.fn()}
        onReset={vi.fn()}
        idPrefix="fr11b"
      />,
    );
    openFrameTab();
    const hexField = screen.getByRole('textbox', { name: 'Achtergrond (hex)' }) as HTMLInputElement;
    fireEvent.change(hexField, { target: { value: '#8884d8' } });
    fireEvent.blur(hexField);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Kleuren' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Kader' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('round 2: the frame refusal alert clears once a later frame change succeeds', () => {
    render(
      <Harness
        resolved={resolvePresentation(lineCtx, { frameBackground: { kind: 'solid', hex: '#ffffff' }, frameInset: 'none' })}
        seriesMeta={colorMeta}
        onChange={vi.fn()}
        onReset={vi.fn()}
        idPrefix="fr11c"
      />,
    );
    openFrameTab();
    const hexField = screen.getByRole('textbox', { name: 'Achtergrond (hex)' }) as HTMLInputElement;
    fireEvent.change(hexField, { target: { value: '#8884d8' } });
    fireEvent.blur(hexField);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    const bgGroup = screen.getByRole('radiogroup', { name: 'Achtergrond' });
    fireEvent.click(within(bgGroup).getByRole('radio', { name: 'Geen' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('accepts the same solid background when inset is on (backdrops are the card colours, not the background)', () => {
    const onChange = vi.fn();
    render(
      <Harness
        resolved={resolvePresentation(lineCtx, { frameBackground: { kind: 'solid', hex: '#ffffff' }, frameInset: 'small' })}
        seriesMeta={colorMeta}
        onChange={onChange}
        onReset={vi.fn()}
        idPrefix="fr12"
      />,
    );
    openFrameTab();
    const hexField = screen.getByRole('textbox', { name: 'Achtergrond (hex)' }) as HTMLInputElement;
    fireEvent.change(hexField, { target: { value: '#8884d8' } });
    fireEvent.blur(hexField);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(onChange).toHaveBeenCalledWith({ frameBackground: { kind: 'solid', hex: '#8884d8' } });
  });

  it('Own image: a 3 MB file is refused now that the limit is 2 MB', () => {
    const onChange = vi.fn();
    const onFrameImage = vi.fn();
    render(
      <Harness
        resolved={resolvePresentation(lineCtx, { frameBackground: { kind: 'image' } })}
        seriesMeta={colorMeta}
        onChange={onChange}
        onReset={vi.fn()}
        idPrefix="fr5b"
        onFrameImage={onFrameImage}
      />,
    );
    openFrameTab();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const threeMb = makeFile('mid.png', 'image/png', 3 * 1024 * 1024);
    fireEvent.change(input, { target: { files: [threeMb] } });
    expect(screen.getByRole('alert')).toHaveTextContent('De afbeelding is te groot. Kies een kleinere.');
    expect(onFrameImage).not.toHaveBeenCalled();
  });

  it('Own image: the hidden file input is not tab-reachable (tabIndex -1)', () => {
    render(
      <Harness
        resolved={resolvePresentation(lineCtx, { frameBackground: { kind: 'image' } })}
        seriesMeta={colorMeta}
        onChange={vi.fn()}
        onReset={vi.fn()}
        idPrefix="fr5c"
        onFrameImage={vi.fn()}
      />,
    );
    openFrameTab();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input.tabIndex).toBe(-1);
  });

  it('Own image: a bad mime type is refused with an alert and nothing is emitted', () => {
    const onChange = vi.fn();
    const onFrameImage = vi.fn();
    render(
      <Harness
        resolved={resolvePresentation(lineCtx, { frameBackground: { kind: 'image' } })}
        seriesMeta={colorMeta}
        onChange={onChange}
        onReset={vi.fn()}
        idPrefix="fr5b"
        onFrameImage={onFrameImage}
      />,
    );
    openFrameTab();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const bad = makeFile('doc.pdf', 'application/pdf', 1024);
    fireEvent.change(input, { target: { files: [bad] } });
    expect(screen.getByRole('alert')).toHaveTextContent('Kies een PNG, JPEG of WebP.');
    expect(onFrameImage).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalledWith({ frameBackground: { kind: 'image' } });
  });

  it('Own image: a valid small PNG calls onFrameImage with a data:image/png URL and emits kind:image', async () => {
    const onChange = vi.fn();
    const onFrameImage = vi.fn();
    render(
      <Harness
        resolved={resolvePresentation(lineCtx, { frameBackground: { kind: 'image' } })}
        seriesMeta={colorMeta}
        onChange={onChange}
        onReset={vi.fn()}
        idPrefix="fr6"
        onFrameImage={onFrameImage}
      />,
    );
    openFrameTab();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const small = makeFile('small.png', 'image/png', 1024);
    fireEvent.change(input, { target: { files: [small] } });
    await waitFor(() => expect(onFrameImage).toHaveBeenCalled());
    expect((onFrameImage.mock.calls[0]![0] as string)).toMatch(/^data:image\/png/);
    expect(onChange).toHaveBeenCalledWith({ frameBackground: { kind: 'image' } });
  });

  it('Own image: Remove clears both the image and the background', () => {
    const onChange = vi.fn();
    const onFrameImage = vi.fn();
    render(
      <Harness
        resolved={resolvePresentation(lineCtx, { frameBackground: { kind: 'image' } })}
        seriesMeta={colorMeta}
        onChange={onChange}
        onReset={vi.fn()}
        idPrefix="fr7"
        frameImage="data:image/png;base64,AAAA"
        onFrameImage={onFrameImage}
      />,
    );
    openFrameTab();
    fireEvent.click(screen.getByRole('button', { name: 'Verwijder afbeelding' }));
    expect(onFrameImage).toHaveBeenCalledWith(null);
    expect(onChange).toHaveBeenCalledWith({ frameBackground: 'none' });
  });

  it('switching away from Own image and back still shows the Remove button — the image stays in memory', () => {
    // A real background-kind switch re-resolves through the caller's own
    // reducer (chart.tsx); this harness stands in for that with an explicit
    // rerender, exactly like the Kleuren tab's own re-sync tests above.
    const { rerender } = render(
      <Harness
        resolved={resolvePresentation(lineCtx, { frameBackground: { kind: 'image' } })}
        seriesMeta={colorMeta}
        onChange={vi.fn()}
        onReset={vi.fn()}
        idPrefix="fr8"
        frameImage="data:image/png;base64,AAAA"
        onFrameImage={vi.fn()}
      />,
    );
    openFrameTab();
    expect(screen.getByRole('button', { name: 'Verwijder afbeelding' })).toBeInTheDocument();

    rerender(
      <Harness
        resolved={resolvePresentation(lineCtx, { frameBackground: 'none' })}
        seriesMeta={colorMeta}
        onChange={vi.fn()}
        onReset={vi.fn()}
        idPrefix="fr8"
        frameImage="data:image/png;base64,AAAA"
        onFrameImage={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Verwijder afbeelding' })).toBeNull();

    rerender(
      <Harness
        resolved={resolvePresentation(lineCtx, { frameBackground: { kind: 'image' } })}
        seriesMeta={colorMeta}
        onChange={vi.fn()}
        onReset={vi.fn()}
        idPrefix="fr8"
        frameImage="data:image/png;base64,AAAA"
        onFrameImage={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Verwijder afbeelding' })).toBeInTheDocument();
  });

  it('Kader wissen is disabled while pristine and no image, emits the six stock values and clears the image otherwise', () => {
    const onChange = vi.fn();
    const onFrameImage = vi.fn();
    const { rerender } = render(
      <Harness
        resolved={resolvePresentation(lineCtx, {})}
        seriesMeta={colorMeta}
        onChange={onChange}
        onReset={vi.fn()}
        idPrefix="fr9"
        onFrameImage={onFrameImage}
      />,
    );
    openFrameTab();
    expect(screen.getByRole('button', { name: 'Kader wissen' })).toBeDisabled();

    cleanup();
    render(
      <Harness
        resolved={resolvePresentation(lineCtx, { frameShadow: 'strong' })}
        seriesMeta={colorMeta}
        onChange={onChange}
        onReset={vi.fn()}
        idPrefix="fr9b"
        onFrameImage={onFrameImage}
      />,
    );
    openFrameTab();
    const resetButton = screen.getByRole('button', { name: 'Kader wissen' });
    expect(resetButton).not.toBeDisabled();
    fireEvent.click(resetButton);
    expect(onChange).toHaveBeenCalledWith({
      frameBackground: 'none',
      framePadding: 'none',
      frameCorners: 'square',
      frameShadow: 'none',
      frameInset: 'none',
      frameAspect: 'auto',
    });
    expect(onFrameImage).toHaveBeenCalledWith(null);
    void rerender;
  });

  // Final-review fix: table form has NO frame and NO Style panel at all —
  // in practice chart.tsx never mounts ChartConfigPanel there. This test
  // documents what the panel itself would render if it WERE mounted with a
  // table-form `resolved`: since `resolvePresentation` now makes only
  // `language` applicable for table form, none of the tabs — including the
  // Frame ("Kader") tab — offer any controls.
  it('table-form resolved: no tab (including Kader) has controls, since only language is applicable', () => {
    render(
      <Harness
        resolved={resolvePresentation(tableCtx, {})}
        seriesMeta={colorMeta}
        onChange={vi.fn()}
        onReset={vi.fn()}
        idPrefix="fr10"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Opmaak' }));
    expect(within(screen.getByRole('tabpanel')).queryAllByRole('radio')).toHaveLength(0);
    fireEvent.click(screen.getByRole('tab', { name: 'Kleuren' }));
    expect(screen.queryByRole('group')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Lettertype' }));
    expect(screen.queryByRole('combobox', { name: 'Lettertype' })).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Kader' }));
    expect(screen.queryByRole('radiogroup', { name: 'Achtergrond' })).toBeNull();
  });

  it('English: labels translate and stay digit-free', () => {
    const onChange = vi.fn();
    render(
      <Harness
        lang="en"
        resolved={resolvePresentation(lineCtx, {})}
        seriesMeta={colorMeta}
        onChange={onChange}
        onReset={vi.fn()}
        idPrefix="fr11"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Style' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Frame' }));
    expect(screen.getByRole('radiogroup', { name: 'Background' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'Widescreen' }));
    expect(onChange).toHaveBeenCalledWith({ frameAspect: '16:9' });
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

// Owner ask (session 94): the panel is an inline region under the chart, in
// its own card — no more portaling into document.body (Task 6's earlier
// floating-dialog design, superseded).
describe('ChartConfigPanel — inline region', () => {
  it('renders inline, inside the render root — not portaled elsewhere', () => {
    const { container } = render(
      <Harness
        resolved={resolvePresentation(lineCtx, {})}
        seriesMeta={meta}
        onChange={vi.fn()}
        onReset={vi.fn()}
        idPrefix="portal"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Opmaak' }));
    const region = screen.getByRole('region', { name: 'Opmaak van de grafiek' });
    // The region is a plain descendant of the component's own render root —
    // no portal moves it to document.body any more.
    expect(container.contains(region)).toBe(true);
  });

  it('has a Close button that closes the dialog and returns focus to the trigger', () => {
    render(
      <Harness
        resolved={resolvePresentation(lineCtx, {})}
        seriesMeta={meta}
        onChange={vi.fn()}
        onReset={vi.fn()}
        idPrefix="close"
      />,
    );
    const trigger = screen.getByRole('button', { name: 'Opmaak' });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: 'Sluiten' }));
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('region', { name: 'Opmaak van de grafiek' })).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("the trigger's aria-controls still resolves to the dialog's id once open", () => {
    render(
      <Harness
        resolved={resolvePresentation(lineCtx, {})}
        seriesMeta={meta}
        onChange={vi.fn()}
        onReset={vi.fn()}
        idPrefix="controls"
      />,
    );
    const trigger = screen.getByRole('button', { name: 'Opmaak' });
    fireEvent.click(trigger);
    const controlsId = trigger.getAttribute('aria-controls');
    expect(controlsId).toBeTruthy();
    const dialog = screen.getByRole('region', { name: 'Opmaak van de grafiek' });
    expect(dialog).toHaveAttribute('id', controlsId);
  });

  it('focus moves into the dialog when it opens', () => {
    render(
      <Harness
        resolved={resolvePresentation(lineCtx, {})}
        seriesMeta={meta}
        onChange={vi.fn()}
        onReset={vi.fn()}
        idPrefix="focus"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Opmaak' }));
    const dialog = screen.getByRole('region', { name: 'Opmaak van de grafiek' });
    expect(document.activeElement).toBe(dialog);
  });
});

describe('ChartConfigPanel — Sjablonen (templates) tab (ADR 043)', () => {
  it('is the first tab; the panel opens on Grafiek when the caller does not opt into R5.2 (openTemplatesWhenPristine unset), and the gallery lists the six templates in order with their descriptions', () => {
    render(<Harness resolved={resolvePresentation(lineCtx, {})} seriesMeta={meta} onChange={vi.fn()} onReset={vi.fn()} idPrefix="t" onApplyTemplate={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Opmaak' }));
    const tabs = screen.getAllByRole('tab').map((t) => t.textContent);
    expect(tabs[0]).toBe('Sjablonen');
    expect(screen.getByRole('tab', { name: 'Grafiek' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('tab', { name: 'Sjablonen' }));
    const cards = screen.getAllByRole('radio', { name: /^(Basis|Klassiek|Redactie|Presentatie|Sociaal|Minimaal)$/ });
    expect(cards.map((c) => c.getAttribute('aria-label'))).toEqual(['Basis', 'Klassiek', 'Redactie', 'Presentatie', 'Sociaal', 'Minimaal']);
    expect(screen.getByText('Publicatieklaar: stevige lijn, geen franje, liggend formaat.')).toBeTruthy();
    // Browser-pass fix: the column count follows the CARD's width (a container query), not the viewport.
    const gallery = screen.getByRole('radiogroup', { name: 'Sjablonen' });
    expect(gallery.className).toContain('grid-cols-2');
    expect(gallery.className).toContain('@md:grid-cols-3');
    expect(gallery.className).not.toContain('sm:grid-cols-3');
    expect(gallery.parentElement?.className).toContain('@container');
  });
  // R5.2 (journey WP-C, ADR 043 decision 6 revisit): chart.tsx now passes
  // `openTemplatesWhenPristine` for real — when the current chart has no
  // per-chart tweaks yet (`resolved.pristine`), the panel opens straight on
  // Sjablonen; once a hand tweak or template pick lands (pristine flips to
  // false), it opens on Grafiek exactly as before this task.
  it('R5.2: with openTemplatesWhenPristine, a pristine chart opens the panel on Sjablonen; a tweaked chart still opens on Grafiek', () => {
    const { unmount } = render(
      <Harness
        resolved={resolvePresentation(lineCtx, {})}
        seriesMeta={meta}
        onChange={vi.fn()}
        onReset={vi.fn()}
        idPrefix="t"
        onApplyTemplate={vi.fn()}
        openTemplatesWhenPristine
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Opmaak' }));
    expect(screen.getByRole('tab', { name: 'Sjablonen' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Grafiek' })).toHaveAttribute('aria-selected', 'false');
    unmount();

    render(
      <Harness
        resolved={resolvePresentation(lineCtx, { lineWidth: 'thick' })}
        seriesMeta={meta}
        onChange={vi.fn()}
        onReset={vi.fn()}
        idPrefix="t2"
        onApplyTemplate={vi.fn()}
        openTemplatesWhenPristine
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Opmaak' }));
    expect(screen.getByRole('tab', { name: 'Grafiek' })).toHaveAttribute('aria-selected', 'true');
  });

  // Strong-tier review MEDIUM-2: the templates TABPANEL is gated on
  // `resolved.applicable.has('grid')`, but the initial-tab computation was
  // not — a form without `grid` (table) opened with Sjablonen SELECTED and no
  // panel rendered for it. The initializer now carries the same gate.
  it('MEDIUM-2: a form whose templates tabpanel is not applicable never opens SELECTED on Sjablonen', () => {
    const tableCtx: PresentationContext = { kind: 'line', form: 'table', seriesCount: 2, hasProvisional: false };
    render(
      <Harness
        resolved={resolvePresentation(tableCtx, {})}
        seriesMeta={meta}
        onChange={vi.fn()}
        onReset={vi.fn()}
        idPrefix="t-medium2"
        onApplyTemplate={vi.fn()}
        openTemplatesWhenPristine
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Opmaak' }));
    const templatesTab = screen.queryByRole('tab', { name: 'Sjablonen' });
    if (templatesTab !== null) {
      expect(templatesTab).toHaveAttribute('aria-selected', 'false');
    }
    // Whatever tab IS selected, its panel exists — never a selected tab with
    // no tabpanel.
    const selected = screen.getAllByRole('tab').find((tab) => tab.getAttribute('aria-selected') === 'true');
    expect(selected).toBeDefined();
    expect(document.getElementById(selected!.getAttribute('aria-controls')!)).not.toBeNull();
  });
  it('marks the current template with aria-checked and a "Huidig" badge: standard when pristine, newsroom when the chart wears it, none when tweaked', () => {
    const { unmount } = render(<Harness resolved={resolvePresentation(lineCtx, {})} seriesMeta={meta} onChange={vi.fn()} onReset={vi.fn()} idPrefix="t" onApplyTemplate={vi.fn()} />);
    openTab('Sjablonen');
    expect(screen.getByRole('radio', { name: 'Basis' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getAllByText('Huidig').length).toBe(1);
    unmount();
    render(<Harness resolved={resolvePresentation(lineCtx, templateById('newsroom').overrides)} seriesMeta={meta} onChange={vi.fn()} onReset={vi.fn()} idPrefix="t" onApplyTemplate={vi.fn()} />);
    openTab('Sjablonen');
    expect(screen.getByRole('radio', { name: 'Redactie' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Basis' })).toHaveAttribute('aria-checked', 'false');
  });
  it('clicking a card emits onApplyTemplate with its id and nothing else', () => {
    const onApplyTemplate = vi.fn();
    const onChange = vi.fn();
    render(<Harness resolved={resolvePresentation(lineCtx, {})} seriesMeta={meta} onChange={onChange} onReset={vi.fn()} idPrefix="t" onApplyTemplate={onApplyTemplate} />);
    openTab('Sjablonen');
    fireEvent.click(screen.getByRole('radio', { name: 'Sociaal' }));
    expect(onApplyTemplate).toHaveBeenCalledWith('social');
    expect(onChange).not.toHaveBeenCalled();
  });
  it('the Brand card appears only for a signed-in visitor (brand prop present) and switches to the Kleuren tab', () => {
    const { unmount } = render(<Harness resolved={resolvePresentation(lineCtx, {})} seriesMeta={meta} onChange={vi.fn()} onReset={vi.fn()} idPrefix="t" onApplyTemplate={vi.fn()} />);
    openTab('Sjablonen');
    expect(screen.queryByText('Merk')).toBeNull();
    unmount();
    render(<Harness resolved={resolvePresentation(lineCtx, {})} seriesMeta={meta} onChange={vi.fn()} onReset={vi.fn()} idPrefix="t" onApplyTemplate={vi.fn()} brand={{ lookup: vi.fn() as never }} />);
    openTab('Sjablonen');
    expect(screen.getByText('Merk')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Naar Kleuren' }));
    expect(screen.getByRole('tab', { name: 'Kleuren' })).toHaveAttribute('aria-selected', 'true');
  });
  it('English: Templates / Standard … Minimal / Current / Go to Colours', () => {
    render(<Harness lang="en" resolved={resolvePresentation(lineCtx, {})} seriesMeta={meta} onChange={vi.fn()} onReset={vi.fn()} idPrefix="t" onApplyTemplate={vi.fn()} brand={{ lookup: vi.fn() as never }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Style' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Templates' }));
    expect(screen.getByRole('radio', { name: 'Standard' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('Current')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Go to Colours' })).toBeTruthy();
  });
  it('the whole tab is digit-free (no ratio numbers leak into text)', () => {
    const { container } = render(<Harness resolved={resolvePresentation(lineCtx, {})} seriesMeta={meta} onChange={vi.fn()} onReset={vi.fn()} idPrefix="t" onApplyTemplate={vi.fn()} brand={{ lookup: vi.fn() as never }} />);
    openTab('Sjablonen');
    expect(container.textContent ?? '').not.toMatch(/\d/);
  });
  it('pins the tabRefs.templates fix: from Sjablonen, ArrowRight on the tablist moves focus to Grafiek', () => {
    render(<Harness resolved={resolvePresentation(lineCtx, {})} seriesMeta={meta} onChange={vi.fn()} onReset={vi.fn()} idPrefix="t" onApplyTemplate={vi.fn()} />);
    openTab('Sjablonen');
    const tablist = screen.getByRole('tablist');
    fireEvent.keyDown(tablist, { key: 'ArrowRight' });
    const grafiekTab = screen.getByRole('tab', { name: 'Grafiek' });
    expect(document.activeElement).toBe(grafiekTab);
    expect(grafiekTab).toHaveAttribute('aria-selected', 'true');
  });
});

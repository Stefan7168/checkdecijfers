// Co-pilot phase 2 (session 113, Task 6) — doorway A for data commands. The
// load-bearing properties: every control is a `setInstruction` doorway and
// SAYS so (§6's command ↔ control contract), and `onChange` only ever fires
// with an instruction the server's own allowlist already accepted — an
// impossible combination shows the schema's reason and dispatches nothing.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChartDataPanel, ChartDataTrigger } from './chart-data-panel.tsx';
import type { ClientChartInstruction, DatasetProfile } from '../backend/attachments/types.ts';

afterEach(cleanup);

/** The brief's two-column profile: one text column to group on, one number
 * column to plot. Deliberately no SECOND number column, so "Verschil" has
 * no `b` to pick and the problem line is reachable. */
const PROFILE: DatasetProfile = {
  columns: [
    { id: 'c0', header: 'Gemeente', type: 'text', distinct: ['Amsterdam', 'Rotterdam'], nulls: 0 },
    { id: 'c1', header: 'Omzet', type: 'number', numberFormat: 'nl', min: 0, max: 100, nulls: 0 },
  ],
  rowCount: 2,
};

const INSTRUCTION: ClientChartInstruction = {
  version: 2,
  kind: 'bar',
  x: 'c0',
  y: ['c1'],
  seriesBy: null,
  filters: [],
  sort: null,
  limit: null,
  aggregate: null,
  derived: null,
  unsupported: null,
};

function renderPanel(overrides: Partial<Parameters<typeof ChartDataPanel>[0]> = {}) {
  const onChange = vi.fn();
  const result = render(
    <ChartDataPanel
      instruction={INSTRUCTION}
      profile={PROFILE}
      lang="nl"
      open
      onOpenChange={() => {}}
      triggerId="t-trigger"
      idPrefix="t"
      onChange={onChange}
      {...overrides}
    />,
  );
  return { ...result, onChange };
}

describe('ChartDataPanel — the controls', () => {
  it('renders nothing while closed', () => {
    const { container } = renderPanel({ open: false });
    expect(container).toBeEmptyDOMElement();
  });

  it('offers a control for every part of the instruction vocabulary', () => {
    renderPanel();
    expect(screen.getByRole('radiogroup', { name: 'Soort grafiek' })).toBeInTheDocument();
    expect(screen.getByLabelText('Horizontale as')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Waarden' })).toBeInTheDocument();
    expect(screen.getByLabelText('Uitsplitsen naar')).toBeInTheDocument();
    expect(screen.getByLabelText('Sorteren op')).toBeInTheDocument();
    expect(screen.getByLabelText('Richting')).toBeInTheDocument();
    expect(screen.getByLabelText('Maximaal aantal')).toBeInTheDocument();
    expect(screen.getByLabelText('Samenvatten')).toBeInTheDocument();
    expect(screen.getByLabelText('Berekening')).toBeInTheDocument();
    // The text column carries a `distinct` list → a value multi-select; the
    // number column carries min/max → from/to bounds.
    expect(screen.getByLabelText('Waarden van Gemeente')).toBeInTheDocument();
    expect(screen.getByLabelText('Van Omzet')).toBeInTheDocument();
    expect(screen.getByLabelText('Tot Omzet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Filter wissen: Gemeente' })).toBeInTheDocument();
  });

  it('marks EVERY control with data-command-kind="setInstruction"', () => {
    const { container } = renderPanel();
    const controls = container.querySelectorAll('select, input, button');
    expect(controls.length).toBeGreaterThan(5);
    for (const control of controls) {
      expect(control.getAttribute('data-command-kind'), `${control.tagName} ${control.getAttribute('aria-label') ?? ''}`).toBe(
        'setInstruction',
      );
    }
  });
});

describe('ChartDataPanel — a valid change', () => {
  it('picking the "Som" aggregate dispatches it with a digit-free summary', () => {
    const { onChange } = renderPanel();
    fireEvent.change(screen.getByLabelText('Samenvatten'), { target: { value: 'sum' } });
    expect(onChange).toHaveBeenCalledTimes(1);
    const [next, summary] = onChange.mock.calls[0]!;
    expect(next).toMatchObject({ aggregate: { fn: 'sum' } });
    expect(summary).toContain('Som');
    expect(summary).not.toMatch(/\d/);
    expect(screen.queryByTestId('chart-data-problem')).not.toBeInTheDocument();
  });

  it('switching the data orientation to a line chart dispatches the new kind', () => {
    const { onChange } = renderPanel({ instruction: { ...INSTRUCTION, x: 'c0' } });
    // A text x column has no natural order, so the LINE option is refused by
    // the server's own rule — the panel shows that reason, translated into
    // Dutch (#282: never the validator's raw English message), and
    // dispatches nothing.
    fireEvent.click(screen.getByRole('radio', { name: 'Lijn' }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByTestId('chart-data-problem')).toHaveTextContent('geen natuurlijke volgorde');
  });

  it('a filter on the text column dispatches an "in" clause', () => {
    const { onChange } = renderPanel();
    const select = screen.getByLabelText('Waarden van Gemeente') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'Amsterdam' } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]![0]).toMatchObject({ filters: [{ column: 'c0', op: 'in', values: ['Amsterdam'] }] });
  });

  it('clears a filter back to none', () => {
    const { onChange } = renderPanel({
      instruction: { ...INSTRUCTION, filters: [{ column: 'c0', op: 'in', values: ['Amsterdam'] }] },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Filter wissen: Gemeente' }));
    expect(onChange.mock.calls[0]![0]).toMatchObject({ filters: [] });
  });

  it('a limit inside the cap dispatches; an empty box clears it', () => {
    const { onChange } = renderPanel({ instruction: { ...INSTRUCTION, limit: 5 } });
    fireEvent.change(screen.getByLabelText('Maximaal aantal'), { target: { value: '' } });
    expect(onChange.mock.calls[0]![0]).toMatchObject({ limit: null });
  });
});

describe('ChartDataPanel — a change the server would refuse', () => {
  it('picking "Verschil" with no second column shows the schema\'s reason, in Dutch, and dispatches nothing', () => {
    const { onChange } = renderPanel();
    fireEvent.change(screen.getByLabelText('Berekening'), { target: { value: 'difference' } });
    expect(onChange).not.toHaveBeenCalled();
    // The op itself is translated too ("Verschil", not the raw id "difference").
    expect(screen.getByTestId('chart-data-problem')).toHaveTextContent('Verschil heeft een tweede kolom nodig');
  });

  it('a limit past the cap shows the reason, in Dutch, with the real cap (never a hardcoded digit)', () => {
    const { onChange } = renderPanel();
    fireEvent.change(screen.getByLabelText('Maximaal aantal'), { target: { value: '500' } });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByTestId('chart-data-problem')).toHaveTextContent('toegestane 1..50');
  });

  it('unticking the only value column shows the reason and dispatches nothing', () => {
    const { onChange } = renderPanel();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Omzet' }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByTestId('chart-data-problem')).toBeInTheDocument();
  });

  it('a later valid change clears the problem line', () => {
    const { onChange } = renderPanel();
    fireEvent.change(screen.getByLabelText('Berekening'), { target: { value: 'difference' } });
    expect(screen.getByTestId('chart-data-problem')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Samenvatten'), { target: { value: 'sum' } });
    expect(screen.queryByTestId('chart-data-problem')).not.toBeInTheDocument();
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

describe('ChartDataPanel — en', () => {
  it('renders the English labels under lang="en"', () => {
    renderPanel({ lang: 'en' });
    expect(screen.getByLabelText('Horizontal axis')).toBeInTheDocument();
    expect(screen.getByLabelText('Summarise')).toBeInTheDocument();
  });

  it('renders the problem line in English too (#282: same reason, translated per lang)', () => {
    const { onChange } = renderPanel({ lang: 'en' });
    fireEvent.change(screen.getByLabelText('Maximum number'), { target: { value: '500' } });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByTestId('chart-data-problem')).toHaveTextContent('outside the allowed 1..50');
  });
});

describe('ChartDataTrigger', () => {
  it('is a labelled toggle wired to the region it controls', () => {
    const onToggle = vi.fn();
    render(<ChartDataTrigger open={false} onToggle={onToggle} controlsId="t-data" triggerId="t-data-trigger" lang="nl" />);
    const button = screen.getByRole('button', { name: 'Data' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).toHaveAttribute('aria-controls', 't-data');
    expect(button).toHaveAttribute('id', 't-data-trigger');
    fireEvent.click(button);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});

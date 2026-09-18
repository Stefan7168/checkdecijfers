import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeCommand } from '../lib/chart-commands.ts';
import type { ChartHistory } from '../lib/chart-history.ts';
import { ChartHistoryMenu, describeCommand } from './chart-history-menu.tsx';

afterEach(cleanup);

function history(): ChartHistory {
  return {
    past: [
      { command: makeCommand({ kind: 'setForm', form: 'bar' }, 'panel'), inverse: { kind: 'setForm', form: 'line' }, transient: false },
      { command: makeCommand({ kind: 'toggleSeries', key: 's1' }, 'canvas'), inverse: { kind: 'setSeriesView', hiddenKeys: [], highlightedKey: null }, transient: false },
    ],
    future: [{ command: makeCommand({ kind: 'setTitle', title: 'Kop' }, 'canvas'), inverse: { kind: 'setTitle', title: null }, transient: false }],
  };
}

describe('ChartHistoryMenu', () => {
  it('lists past entries newest-first with their source, then undone entries dimmed', () => {
    render(<ChartHistoryMenu history={history()} lang="nl" onUndoTo={() => {}} onRedoTo={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Geschiedenis van bewerkingen' }));
    const items = screen.getAllByRole('menuitem');
    expect(items[0]).toHaveTextContent('Reeks verborgen of getoond');
    expect(items[0]).toHaveTextContent('op de grafiek');
    expect(items[1]).toHaveTextContent('Weergave');
    expect(items[2]).toHaveTextContent('ongedaan gemaakt');
  });
  it('clicking a past entry undoes back to it; clicking an undone entry redoes up to it', () => {
    const onUndoTo = vi.fn();
    const onRedoTo = vi.fn();
    render(<ChartHistoryMenu history={history()} lang="nl" onUndoTo={onUndoTo} onRedoTo={onRedoTo} />);
    fireEvent.click(screen.getByRole('button', { name: 'Geschiedenis van bewerkingen' }));
    const items = screen.getAllByRole('menuitem');
    fireEvent.click(items[1]!);
    expect(onUndoTo).toHaveBeenCalledWith(0);
    fireEvent.click(items[2]!);
    expect(onRedoTo).toHaveBeenCalledWith(0);
  });
  it('empty history shows the empty line', () => {
    render(<ChartHistoryMenu history={{ past: [], future: [] }} lang="en" onUndoTo={() => {}} onRedoTo={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit history' }));
    expect(screen.getByText('No edits yet')).toBeTruthy();
  });
  it('describeCommand never emits a digit for a command without typed text', () => {
    const cmds = [
      makeCommand({ kind: 'setPeriodRange', range: ['2020JJ00', '2024JJ00'] }, 'panel'),
      makeCommand({ kind: 'setPresentation', patch: { lineWidth: 'thick', seriesColors: { 0: '#112233' } } }, 'panel'),
      makeCommand({ kind: 'setReading', index: 2 }, 'panel'),
    ];
    for (const c of cmds) expect(describeCommand(c, 'nl')).not.toMatch(/\d/);
  });
});

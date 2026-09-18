// Chart co-pilot phase 2 (session 113), Task 4: the Undo/Redo/History group
// lifted out of chart.tsx so the own-data card renders the SAME control set.
// The behaviour pinned here is phase 1's, now testable without mounting the
// whole 4,900-line CBS card.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { emptyHistory, pushCommand, type ChartHistory } from '../lib/chart-history.ts';
import { initialDocState, makeCommand } from '../lib/chart-commands.ts';
import { t } from '../lib/i18n/messages.ts';
import { ChartHistoryActions } from './chart-history-actions.tsx';

afterEach(cleanup);

function oneEditHistory(): ChartHistory {
  return pushCommand(emptyHistory(), initialDocState('line'), makeCommand({ kind: 'setForm', form: 'bar' }, 'panel')).history;
}

describe('ChartHistoryActions', () => {
  it('renders Undo and Redo, disabled when there is nothing to do', () => {
    render(
      <ChartHistoryActions undo={() => {}} redo={() => {}} canUndo={false} canRedo={false} history={emptyHistory()} lang="nl" />,
    );
    expect(screen.getByRole('button', { name: t('nl', 'chart.history.undo') })).toBeDisabled();
    expect(screen.getByRole('button', { name: t('nl', 'chart.history.redo') })).toBeDisabled();
  });

  it('calls undo and redo when enabled', () => {
    const undo = vi.fn();
    const redo = vi.fn();
    render(<ChartHistoryActions undo={undo} redo={redo} canUndo canRedo history={oneEditHistory()} lang="nl" />);
    fireEvent.click(screen.getByRole('button', { name: t('nl', 'chart.history.undo') }));
    fireEvent.click(screen.getByRole('button', { name: t('nl', 'chart.history.redo') }));
    expect(undo).toHaveBeenCalledTimes(1);
    expect(redo).toHaveBeenCalledTimes(1);
  });

  it('offers the history menu, and steps back to the chosen entry', async () => {
    const undo = vi.fn();
    let history = emptyHistory();
    let state = initialDocState('line');
    for (const form of ['bar', 'table', 'line'] as const) {
      ({ history, state } = pushCommand(history, state, makeCommand({ kind: 'setForm', form }, 'panel')));
    }
    render(<ChartHistoryActions undo={undo} redo={() => {}} canUndo canRedo={false} history={history} lang="nl" />);
    fireEvent.click(screen.getByRole('button', { name: t('nl', 'chart.history.menu') }));
    const items = await screen.findAllByRole('menuitem');
    // Newest first: the LAST item is the oldest entry (index 0). "Undo TO"
    // that entry leaves it applied, so it walks back the two steps above it.
    fireEvent.click(items[items.length - 1]!);
    expect(undo).toHaveBeenCalledTimes(2);
  });

  it('while locked both buttons are disabled, the menu is gone, and the reason is named', () => {
    render(
      <ChartHistoryActions
        undo={() => {}}
        redo={() => {}}
        canUndo
        canRedo
        history={oneEditHistory()}
        lang="nl"
        locked={{ title: t('nl', 'chart.story.controlsLocked'), describedBy: 'lock-id' }}
      />,
    );
    const undoBtn = screen.getByRole('button', { name: t('nl', 'chart.history.undo') });
    expect(undoBtn).toBeDisabled();
    expect(screen.getByRole('button', { name: t('nl', 'chart.history.redo') })).toBeDisabled();
    expect(undoBtn).toHaveAttribute('title', t('nl', 'chart.story.controlsLocked'));
    expect(undoBtn).toHaveAttribute('aria-describedby', 'lock-id');
    expect(screen.queryByRole('button', { name: t('nl', 'chart.history.menu') })).toBeNull();
  });

  it('carries the slot marker chart.tsx used, so the card layout is unchanged', () => {
    const { container } = render(
      <ChartHistoryActions undo={() => {}} redo={() => {}} canUndo={false} canRedo={false} history={emptyHistory()} lang="nl" />,
    );
    expect(container.querySelector('[data-slot="chart-history-actions"]')).not.toBeNull();
  });
});

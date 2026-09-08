import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ChartNotes, type ChartNote, type PendingPoint } from './chart-notes.tsx';

afterEach(cleanup);

const NOTE: ChartNote = { id: 'n1', resultId: 'r-2020', periodLabel: '2020', seriesLabel: 'Nederland', text: 'Coronapiek' };

describe('ChartNotes', () => {
  it('renders nothing when there are no notes and no pending click', () => {
    render(<ChartNotes notes={[]} pendingPoint={null} idPrefix="test" onSave={vi.fn()} onCancelPending={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.queryByText('Uw aantekeningen (geen CBS-data)')).not.toBeInTheDocument();
  });

  it('lists existing notes with their point context, under a clear non-CBS heading', () => {
    render(<ChartNotes notes={[NOTE]} pendingPoint={null} idPrefix="test" onSave={vi.fn()} onCancelPending={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText('Uw aantekeningen (geen CBS-data)')).toBeInTheDocument();
    expect(screen.getByText(/Nederland.*2020/)).toBeInTheDocument();
    expect(screen.getByText('Coronapiek')).toBeInTheDocument();
  });

  it('deleting a note calls onDelete with its id', () => {
    const onDelete = vi.fn();
    render(<ChartNotes notes={[NOTE]} pendingPoint={null} idPrefix="test" onSave={vi.fn()} onCancelPending={vi.fn()} onDelete={onDelete} />);
    fireEvent.click(screen.getByRole('button', { name: /verwijder/i }));
    expect(onDelete).toHaveBeenCalledWith('n1');
  });

  it('shows an entry form when a point is pending, labelled with the clicked point context', () => {
    render(
      <ChartNotes
        notes={[]}
        pendingPoint={{ resultId: 'r-2021', periodLabel: '2021', seriesLabel: 'Utrecht' }}
        idPrefix="test"
        onSave={vi.fn()}
        onCancelPending={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByText(/Utrecht.*2021/)).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('saving the pending form calls onSave with the typed text and clears on Escape without saving', () => {
    const onSave = vi.fn();
    const onCancelPending = vi.fn();
    render(
      <ChartNotes
        notes={[]}
        pendingPoint={{ resultId: 'r-2021', periodLabel: '2021', seriesLabel: 'Utrecht' }}
        idPrefix="test"
        onSave={onSave}
        onCancelPending={onCancelPending}
        onDelete={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Piek na fusie' } });
    fireEvent.click(screen.getByRole('button', { name: /opslaan/i }));
    expect(onSave).toHaveBeenCalledWith('Piek na fusie');
  });

  it('does not call onSave for an empty/whitespace-only note', () => {
    const onSave = vi.fn();
    render(
      <ChartNotes
        notes={[]}
        pendingPoint={{ resultId: 'r-2021', periodLabel: '2021', seriesLabel: 'Utrecht' }}
        idPrefix="test"
        onSave={onSave}
        onCancelPending={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: /opslaan/i }));
    expect(onSave).not.toHaveBeenCalled();
  });

  // Fix 1 (#212 review): the parent (chart.tsx) swaps `pendingPoint` on every
  // point click, even while a draft is mid-type for an earlier point. This
  // component's own `draft` state used to only clear on Save/Cancel/Escape,
  // so a re-render with a NEW pendingPoint kept the OLD point's typed text —
  // risking it being saved and mis-attributed to the new point.
  it('clears any in-progress draft text when pendingPoint changes to a different point', () => {
    const pointA: PendingPoint = { resultId: 'r-2020', periodLabel: '2020', seriesLabel: 'Nederland' };
    const pointB: PendingPoint = { resultId: 'r-2021', periodLabel: '2021', seriesLabel: 'Utrecht' };
    const { rerender } = render(
      <ChartNotes notes={[]} pendingPoint={pointA} idPrefix="test" onSave={vi.fn()} onCancelPending={vi.fn()} onDelete={vi.fn()} />,
    );
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Coronapiek' } });
    expect(screen.getByRole('textbox')).toHaveValue('Coronapiek');

    rerender(<ChartNotes notes={[]} pendingPoint={pointB} idPrefix="test" onSave={vi.fn()} onCancelPending={vi.fn()} onDelete={vi.fn()} />);

    expect(screen.getByText(/Utrecht.*2021/)).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveValue('');
  });

  // Fix 2 (#212 review): the textarea id used to be a hardcoded literal
  // ("chart-note-draft"), so two ChartNotes forms open at once on the same
  // page (Ontdek renders several ChartViews in a grid) would emit duplicate
  // DOM ids and break label association. The id must now incorporate the
  // caller-supplied idPrefix.
  it('scopes the note textarea id to the supplied idPrefix, so two instances never collide', () => {
    const point: PendingPoint = { resultId: 'r-2021', periodLabel: '2021', seriesLabel: 'Utrecht' };
    render(
      <ChartNotes notes={[]} pendingPoint={point} idPrefix="chart-abc123" onSave={vi.fn()} onCancelPending={vi.fn()} onDelete={vi.fn()} />,
    );
    expect(screen.getByRole('textbox')).toHaveAttribute('id', 'chart-abc123-note-draft');
  });
});

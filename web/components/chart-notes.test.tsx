import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ChartNotes, type ChartNote } from './chart-notes.tsx';

afterEach(cleanup);

const NOTE: ChartNote = { id: 'n1', resultId: 'r-2020', periodLabel: '2020', seriesLabel: 'Nederland', text: 'Coronapiek' };

describe('ChartNotes', () => {
  it('renders nothing when there are no notes and no pending click', () => {
    render(<ChartNotes notes={[]} pendingPoint={null} onSave={vi.fn()} onCancelPending={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.queryByText('Uw aantekeningen (geen CBS-data)')).not.toBeInTheDocument();
  });

  it('lists existing notes with their point context, under a clear non-CBS heading', () => {
    render(<ChartNotes notes={[NOTE]} pendingPoint={null} onSave={vi.fn()} onCancelPending={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText('Uw aantekeningen (geen CBS-data)')).toBeInTheDocument();
    expect(screen.getByText(/Nederland.*2020/)).toBeInTheDocument();
    expect(screen.getByText('Coronapiek')).toBeInTheDocument();
  });

  it('deleting a note calls onDelete with its id', () => {
    const onDelete = vi.fn();
    render(<ChartNotes notes={[NOTE]} pendingPoint={null} onSave={vi.fn()} onCancelPending={vi.fn()} onDelete={onDelete} />);
    fireEvent.click(screen.getByRole('button', { name: /verwijder/i }));
    expect(onDelete).toHaveBeenCalledWith('n1');
  });

  it('shows an entry form when a point is pending, labelled with the clicked point context', () => {
    render(
      <ChartNotes
        notes={[]}
        pendingPoint={{ resultId: 'r-2021', periodLabel: '2021', seriesLabel: 'Utrecht' }}
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
        onSave={onSave}
        onCancelPending={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: /opslaan/i }));
    expect(onSave).not.toHaveBeenCalled();
  });
});

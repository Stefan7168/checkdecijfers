import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ChartNotes, type ChartNote, type PendingPoint } from './chart-notes.tsx';

afterEach(cleanup);

const NOTE: ChartNote = { id: 'n1', resultId: 'r-2020', periodLabel: '2020', seriesLabel: 'Nederland', text: 'Coronapiek' };

const defaultProps = {
  headlineOverrideResultId: null as string | null,
  onSetHeadline: vi.fn(),
  onClearHeadline: vi.fn(),
};

describe('ChartNotes', () => {
  it('renders nothing when there are no notes and no pending click', () => {
    render(<ChartNotes notes={[]} pendingPoint={null} idPrefix="test" onSave={vi.fn()} onCancelPending={vi.fn()} onDelete={vi.fn()} {...defaultProps} />);
    expect(screen.queryByText('Uw aantekeningen (geen CBS-data)')).not.toBeInTheDocument();
  });

  it('lists existing notes with their point context, under a clear non-CBS heading', () => {
    render(<ChartNotes notes={[NOTE]} pendingPoint={null} idPrefix="test" onSave={vi.fn()} onCancelPending={vi.fn()} onDelete={vi.fn()} {...defaultProps} />);
    expect(screen.getByText('Uw aantekeningen (geen CBS-data)')).toBeInTheDocument();
    expect(screen.getByText(/Nederland.*2020/)).toBeInTheDocument();
    expect(screen.getByText('Coronapiek')).toBeInTheDocument();
  });

  it('deleting a note calls onDelete with its id', () => {
    const onDelete = vi.fn();
    render(<ChartNotes notes={[NOTE]} pendingPoint={null} idPrefix="test" onSave={vi.fn()} onCancelPending={vi.fn()} onDelete={onDelete} {...defaultProps} />);
    fireEvent.click(screen.getByRole('button', { name: /verwijder/i }));
    expect(onDelete).toHaveBeenCalledWith('n1');
  });

  // #13 (session 110 UX audit pass 2): every delete button's accessible
  // name used to be the plain visible label "Verwijder" — a screen-reader
  // user with several notes heard "Verwijder, Verwijder, Verwijder" with no
  // way to tell them apart.
  it("names each note's delete button with its own series and period, so several notes are distinguishable", () => {
    const noteB: ChartNote = { id: 'n2', resultId: 'r-2021', periodLabel: '2021', seriesLabel: 'Utrecht', text: 'Andere piek' };
    render(<ChartNotes notes={[NOTE, noteB]} pendingPoint={null} idPrefix="test" onSave={vi.fn()} onCancelPending={vi.fn()} onDelete={vi.fn()} {...defaultProps} />);
    expect(screen.getByRole('button', { name: 'Verwijder de notitie bij Nederland · 2020' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Verwijder de notitie bij Utrecht · 2021' })).toBeInTheDocument();
  });

  // #17 (session 110 UX audit pass 2): nothing on screen said notes are
  // excluded from downloads/embeds (deliberate, ADR 038) — the affordance
  // read like a normal, persisted annotation feature. Final-review fix I5
  // (session 115): the disclosure used to also claim notes are
  // "session-only" — wrong, a signed-in reader's notes DO persist via the
  // saved command log (use-chart-edits.ts), same as every other
  // chart-copilot command; only the exclusion from downloads/embeds is
  // actually true.
  it('discloses that notes are excluded from downloads/embeds', () => {
    render(<ChartNotes notes={[NOTE]} pendingPoint={null} idPrefix="test" onSave={vi.fn()} onCancelPending={vi.fn()} onDelete={vi.fn()} {...defaultProps} />);
    expect(screen.getByText('Aantekeningen staan niet in downloads of embeds.')).toBeInTheDocument();
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
        {...defaultProps}
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
        {...defaultProps}
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
        {...defaultProps}
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
      <ChartNotes notes={[]} pendingPoint={pointA} idPrefix="test" onSave={vi.fn()} onCancelPending={vi.fn()} onDelete={vi.fn()} {...defaultProps} />,
    );
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Coronapiek' } });
    expect(screen.getByRole('textbox')).toHaveValue('Coronapiek');

    rerender(<ChartNotes notes={[]} pendingPoint={pointB} idPrefix="test" onSave={vi.fn()} onCancelPending={vi.fn()} onDelete={vi.fn()} {...defaultProps} />);

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
      <ChartNotes notes={[]} pendingPoint={point} idPrefix="chart-abc123" onSave={vi.fn()} onCancelPending={vi.fn()} onDelete={vi.fn()} {...defaultProps} />,
    );
    expect(screen.getByRole('textbox')).toHaveAttribute('id', 'chart-abc123-note-draft');
  });

  // #8 (session 110 UX audit pass 2): opening the note editor never moved
  // focus into it — a keyboard user who activated an "Add a note at …"
  // point was dropped at the top of the document. The trigger (the point
  // the parent's own onPointClick handler leaves focused, exactly what
  // chart.tsx's SVG points do) is stood in for here by a plain <button>,
  // since ChartNotes itself never renders the trigger.
  describe('focus management (#8)', () => {
    function Wrapper({
      pending,
      onSave,
      onCancelPending,
    }: {
      pending: PendingPoint | null;
      onSave: (text: string) => void;
      onCancelPending: () => void;
    }) {
      return (
        <div>
          <button type="button">Add a note at Nederland, 2020</button>
          <ChartNotes notes={[]} pendingPoint={pending} idPrefix="test" onSave={onSave} onCancelPending={onCancelPending} onDelete={vi.fn()} {...defaultProps} />
        </div>
      );
    }

    it('moves focus into the note textarea once the editor mounts', () => {
      const { rerender } = render(<Wrapper pending={null} onSave={vi.fn()} onCancelPending={vi.fn()} />);
      const trigger = screen.getByRole('button', { name: /Add a note/ });
      trigger.focus();
      expect(document.activeElement).toBe(trigger);

      rerender(
        <Wrapper
          pending={{ resultId: 'r-2020', periodLabel: '2020', seriesLabel: 'Nederland' }}
          onSave={vi.fn()}
          onCancelPending={vi.fn()}
        />,
      );
      expect(document.activeElement).toBe(screen.getByRole('textbox'));
    });

    it('restores focus to the originating trigger on Save', () => {
      const onSave = vi.fn();
      const { rerender } = render(<Wrapper pending={null} onSave={onSave} onCancelPending={vi.fn()} />);
      const trigger = screen.getByRole('button', { name: /Add a note/ });
      trigger.focus();

      rerender(
        <Wrapper pending={{ resultId: 'r-2020', periodLabel: '2020', seriesLabel: 'Nederland' }} onSave={onSave} onCancelPending={vi.fn()} />,
      );
      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Coronapiek' } });
      fireEvent.click(screen.getByRole('button', { name: /opslaan/i }));

      expect(onSave).toHaveBeenCalledWith('Coronapiek');
      expect(document.activeElement).toBe(trigger);
    });

    it('restores focus to the originating trigger on Cancel', () => {
      const onCancelPending = vi.fn();
      const { rerender } = render(<Wrapper pending={null} onSave={vi.fn()} onCancelPending={onCancelPending} />);
      const trigger = screen.getByRole('button', { name: /Add a note/ });
      trigger.focus();

      rerender(
        <Wrapper
          pending={{ resultId: 'r-2020', periodLabel: '2020', seriesLabel: 'Nederland' }}
          onSave={vi.fn()}
          onCancelPending={onCancelPending}
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: /annuleren/i }));

      expect(onCancelPending).toHaveBeenCalled();
      expect(document.activeElement).toBe(trigger);
    });

    it('restores focus to the originating trigger on Escape', () => {
      const onCancelPending = vi.fn();
      const { rerender } = render(<Wrapper pending={null} onSave={vi.fn()} onCancelPending={onCancelPending} />);
      const trigger = screen.getByRole('button', { name: /Add a note/ });
      trigger.focus();

      rerender(
        <Wrapper
          pending={{ resultId: 'r-2020', periodLabel: '2020', seriesLabel: 'Nederland' }}
          onSave={vi.fn()}
          onCancelPending={onCancelPending}
        />,
      );
      fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });

      expect(onCancelPending).toHaveBeenCalled();
      expect(document.activeElement).toBe(trigger);
    });
  });
});

// AnswerProof (session 72 design brief, #70/#79/#89/#90-deep): closed by
// default, opened by a native trigger button, a "Technische details" toggle
// that gates ids/codes behind one control (D2/D4 of the brief — ONE panel,
// not three accordions). Presentation-only: the Dutch prose itself is
// already pinned by answer-proof.test.ts; this file pins the DISCLOSURE
// mechanics (D7: aria-expanded/aria-controls/aria-pressed, native buttons
// for keyboard reachability) and that the toggle actually gates the
// technical columns/suffixes.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { AnswerProof as AnswerProofData, ProofCell } from '../lib/answer-proof.ts';
import { AnswerProof } from './answer-proof.tsx';

afterEach(cleanup);

function fakeProofCell(overrides: Partial<ProofCell> = {}): ProofCell {
  return {
    resultId: '86141NED:CPI000000:NL01:2024JJ00',
    measure: 'CPI000000',
    measureTitle: 'Inflatie (CPI)',
    regionLabel: null,
    regionCode: null,
    periodLabel: '2024',
    periodCode: '2024JJ00',
    dims: {},
    dimLabels: {},
    valueText: '3,3%',
    status: 'Definitief',
    provisional: false,
    batchId: 7,
    ...overrides,
  };
}

function fakeProof(overrides: Partial<AnswerProofData> = {}): AnswerProofData {
  return {
    tableId: '86141NED',
    tableTitle: 'Consumentenprijzen; prijsindex 2015=100',
    tableVersion: 1,
    syncedAt: '2026-07-03',
    license: 'CC BY 4.0',
    reading: 'Inflatie (CPI)',
    periodSemantics: null,
    alternates: [],
    cells: [fakeProofCell()],
    steps: [
      {
        text: 'Gelezen: 1 cel uit tabel 86141NED: Inflatie (CPI), 2024 → 3,3%.',
        technical: ' [cel-id 86141NED:CPI000000:NL01:2024JJ00]',
      },
      { text: 'Geen bewerking toegepast: het antwoord is de waarde uit de cel.', technical: null },
    ],
    nullNotice: null,
    marked: false,
    ...overrides,
  };
}

describe('AnswerProof — closed by default', () => {
  it('shows the singular trigger for one cell, no region, aria-expanded false', () => {
    render(<AnswerProof proof={fakeProof()} />);
    const trigger = screen.getByRole('button', { name: 'Bewijs dit cijfer' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('region')).toBeNull();
    expect(screen.queryByText('Waarom dit antwoord')).toBeNull();
  });

  it('shows the plural trigger for more than one cell', () => {
    const proof = fakeProof({
      cells: [fakeProofCell(), fakeProofCell({ resultId: 'X', periodLabel: '2025', periodCode: '2025JJ00' })],
    });
    render(<AnswerProof proof={proof} />);
    expect(screen.getByRole('button', { name: 'Bewijs deze cijfers' })).toBeInTheDocument();
  });
});

describe('AnswerProof — open/close', () => {
  it('opens the region on click; aria-controls matches the rendered region id; all three depths present', () => {
    render(<AnswerProof proof={fakeProof({ periodSemantics: 'jaargemiddelde' })} />);
    const trigger = screen.getByRole('button', { name: 'Bewijs dit cijfer' });

    fireEvent.click(trigger);

    const region = screen.getByRole('region', { name: 'Onderbouwing van dit antwoord' });
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(trigger.getAttribute('aria-controls')).toBe(region.id);
    expect(screen.getByText('Waarom dit antwoord')).toBeInTheDocument();
    expect(screen.getByText('De gebruikte cellen')).toBeInTheDocument();
    expect(screen.getByText('Stap voor stap')).toBeInTheDocument();
    expect(screen.getByText('Gebruikte lezing: Inflatie (CPI).')).toBeInTheDocument();
    expect(screen.getByText('Periodebetekenis: jaargemiddelde')).toBeInTheDocument();
    expect(screen.getByText('Gelezen: 1 cel uit tabel 86141NED: Inflatie (CPI), 2024 → 3,3%.')).toBeInTheDocument();
  });

  it('(orchestrator review round 1) the open panel carries order-last and basis-full, so opening it cannot push the trigger/citation/CSV row apart', () => {
    // D5: the panel must render directly UNDER the citation/CSV row, never
    // splitting it — `order-last` keeps this element visually last in the
    // flex-wrap row regardless of its DOM position (it sits between the
    // trigger and the citation/CSV buttons in chat.tsx), and `basis-full`
    // is what forces it onto its own line at all.
    render(<AnswerProof proof={fakeProof()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Bewijs dit cijfer' }));
    const region = screen.getByRole('region', { name: 'Onderbouwing van dit antwoord' });
    expect(region).toHaveClass('order-last', 'basis-full');
  });

  it('a second click closes the region again', () => {
    render(<AnswerProof proof={fakeProof()} />);
    const trigger = screen.getByRole('button', { name: 'Bewijs dit cijfer' });
    fireEvent.click(trigger);
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('region')).toBeNull();
  });

  it('omits the "Periodebetekenis" line when null', () => {
    render(<AnswerProof proof={fakeProof({ periodSemantics: null })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Bewijs dit cijfer' }));
    expect(screen.queryByText(/Periodebetekenis/)).toBeNull();
  });
});

describe('AnswerProof — Technische details toggle', () => {
  it('starts off (aria-pressed false): no resultId/batchId text anywhere', () => {
    render(<AnswerProof proof={fakeProof()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Bewijs dit cijfer' }));
    const toggle = screen.getByRole('button', { name: 'Technische details' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByText(/86141NED:CPI000000:NL01:2024JJ00/)).toBeNull();
    expect(screen.queryByText('7')).toBeNull();
  });

  it('switching on sets aria-pressed true and reveals cel-id / batchId', () => {
    render(<AnswerProof proof={fakeProof()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Bewijs dit cijfer' }));
    const toggle = screen.getByRole('button', { name: 'Technische details' });

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    // Both the table's Cel-id column and the read step's [cel-id …] suffix.
    expect(screen.getAllByText(/86141NED:CPI000000:NL01:2024JJ00/).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Cel-id' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Batch' })).toBeInTheDocument();
  });

  it('gates an alternate\'s technical suffix behind the same toggle', () => {
    const proof = fakeProof({
      alternates: [{ label: 'niet-seizoengecorrigeerd', technical: ' — SeizoensCorrectie=NG' }],
    });
    render(<AnswerProof proof={proof} />);
    fireEvent.click(screen.getByRole('button', { name: 'Bewijs dit cijfer' }));
    expect(screen.getByText('Niet gekozen: niet-seizoengecorrigeerd')).toBeInTheDocument();
    expect(screen.queryByText(/SeizoensCorrectie=NG/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Technische details' }));
    expect(screen.getByText('Niet gekozen: niet-seizoengecorrigeerd — SeizoensCorrectie=NG')).toBeInTheDocument();
  });
});

describe('AnswerProof — honesty surfaces', () => {
  it('renders the null notice only when present', () => {
    const withNotice = fakeProof({
      nullNotice: '1 van de 2 cellen heeft geen waarde; de reden van CBS staat per cel in de tabel.',
    });
    render(<AnswerProof proof={withNotice} />);
    fireEvent.click(screen.getByRole('button', { name: 'Bewijs dit cijfer' }));
    expect(screen.getByText(withNotice.nullNotice!)).toBeInTheDocument();
  });

  it('renders no null notice when every cell has a value', () => {
    render(<AnswerProof proof={fakeProof({ nullNotice: null })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Bewijs dit cijfer' }));
    expect(screen.queryByText(/heeft geen waarde/)).toBeNull();
  });

  it('renders the CC BY marking only when `marked` is true', () => {
    render(<AnswerProof proof={fakeProof({ marked: true })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Bewijs dit cijfer' }));
    expect(screen.getByText('bewerking van CBS-gegevens door checkdecijfers.nl')).toBeInTheDocument();
  });

  it('renders no marking when `marked` is false', () => {
    render(<AnswerProof proof={fakeProof({ marked: false })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Bewijs dit cijfer' }));
    expect(screen.queryByText('bewerking van CBS-gegevens door checkdecijfers.nl')).toBeNull();
  });
});

describe('AnswerProof — keyboard reachability', () => {
  it('every interactive control is a native <button> (Enter/Space work with no extra handler)', () => {
    render(<AnswerProof proof={fakeProof()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Bewijs dit cijfer' }));
    for (const button of screen.getAllByRole('button')) {
      expect(button.tagName).toBe('BUTTON');
    }
  });
});

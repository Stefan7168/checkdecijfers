// AnswerProof (session 72 design brief, #70/#79/#89/#90-deep): closed by
// default, opened by a native trigger button, a "Technische details" toggle
// that gates ids/codes behind one control (D2/D4 of the brief — ONE panel,
// not three accordions). Presentation-only: the Dutch prose itself is
// already pinned by answer-proof.test.ts; this file pins the DISCLOSURE
// mechanics (D7: aria-expanded/aria-controls/aria-pressed, native buttons
// for keyboard reachability) and that the toggle actually gates the
// technical columns/suffixes.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AnswerProof as AnswerProofData, ProofCell } from '../lib/answer-proof.ts';
import { LangProvider } from '../lib/i18n/lang-provider.tsx';
import { AnswerProof } from './answer-proof.tsx';

// #9 (session 110 UX audit): jsdom does not implement scrollIntoView — same
// stub chat.test.tsx/answer-proof-replay.test.tsx already use.
Element.prototype.scrollIntoView = vi.fn();

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
    highlightUrl: 'https://opendata.cbs.nl/statline/#/CBS/nl/dataset/86141NED/table:~:text=2024-,3%2C3',
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

  it('links the cell value to its CBS highlight URL when one is present', () => {
    render(<AnswerProof proof={fakeProof()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Bewijs dit cijfer' }));
    const link = screen.getByRole('link', { name: '3,3%' });
    expect(link).toHaveAttribute(
      'href',
      'https://opendata.cbs.nl/statline/#/CBS/nl/dataset/86141NED/table:~:text=2024-,3%2C3',
    );
    expect(link).toHaveAttribute('title', 'Bekijk deze cel bij CBS');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('renders the plain value with no link when highlightUrl is null', () => {
    const proof = fakeProof({ cells: [fakeProofCell({ highlightUrl: null })] });
    render(<AnswerProof proof={proof} />);
    fireEvent.click(screen.getByRole('button', { name: 'Bewijs dit cijfer' }));
    expect(screen.getByText('3,3%')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '3,3%' })).toBeNull();
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

  // #9 (session 110 UX audit): clicking "Prove these numbers" used to open
  // the panel below the fold with no scroll — only a grey strip stayed
  // visible behind the composer, for the product's own namesake trust
  // action. Guarded for jsdom (no scrollIntoView in a real browser without
  // the stub above either — chart-story-stage.tsx/visual-dock.tsx's own
  // convention).
  it('scrolls the opened panel into view', () => {
    const spy = vi.fn();
    Element.prototype.scrollIntoView = spy;
    render(<AnswerProof proof={fakeProof()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Bewijs dit cijfer' }));
    const region = screen.getByRole('region', { name: 'Onderbouwing van dit antwoord' });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.instances[0]).toBe(region);
    expect(spy).toHaveBeenCalledWith({ block: 'nearest', behavior: 'smooth' });
  });

  it('does not scroll again on a re-render while already open', () => {
    const spy = vi.fn();
    Element.prototype.scrollIntoView = spy;
    const { rerender } = render(<AnswerProof proof={fakeProof()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Bewijs dit cijfer' }));
    expect(spy).toHaveBeenCalledTimes(1);
    rerender(<AnswerProof proof={fakeProof()} />);
    expect(spy).toHaveBeenCalledTimes(1);
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
    expect(screen.getByText('bewerking van CBS-gegevens door graphmaker.studio')).toBeInTheDocument();
  });

  it('renders no marking when `marked` is false', () => {
    render(<AnswerProof proof={fakeProof({ marked: false })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Bewijs dit cijfer' }));
    expect(screen.queryByText('bewerking van CBS-gegevens door graphmaker.studio')).toBeNull();
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

// WP218 phase 4 (#219): proves the language switch reaches this surface. The
// proof's own prose (proof.reading, steps[].text, nullNotice, alternates[].
// label) is backend-composed and stays Dutch regardless of app language
// (docs/superpowers/specs/2026-09-09-language-switch-design.md §1) — the
// static chrome this component itself authors (trigger label, headings,
// toggle) is asserted here. open-questions #324 gap 2 (fixed this session):
// the cell table's region/period/measure DISPLAY NAMES now also translate —
// see the block below.
describe('AnswerProof — en', () => {
  it('renders the English chrome under LangProvider lang="en"', () => {
    render(
      <LangProvider lang="en">
        <AnswerProof proof={fakeProof()} />
      </LangProvider>,
    );
    const trigger = screen.getByRole('button', { name: 'Prove this number' });
    fireEvent.click(trigger);
    expect(screen.getByRole('region', { name: 'Evidence for this answer' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Technical details' })).toBeInTheDocument();
  });
});

// open-questions #324 gap 2: `toEnglishAnswerProof` (web/lib/answer-proof.ts)
// — a DISPLAY-only swap of the cell table's region/period/measure names,
// never the Dutch prose (reading/steps/nullNotice/alternates) and never an
// id/code/raw value, on either language.
describe('AnswerProof — cell table display names (open-questions #324 gap 2)', () => {
  function translatableProof(): AnswerProofData {
    return fakeProof({
      reading: 'Consumentenvertrouwen',
      cells: [
        fakeProofCell({
          measureTitle: 'Consumentenvertrouwen',
          regionLabel: 'Noord-Holland',
          regionCode: 'PV27',
          periodLabel: '2021 1e kwartaal',
          periodCode: '2021KW01',
        }),
      ],
    });
  }

  it('translates region/period/measure DISPLAY names under English', () => {
    render(
      <LangProvider lang="en">
        <AnswerProof proof={translatableProof()} />
      </LangProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Prove this number' }));
    expect(screen.getByText('Consumer confidence')).toBeInTheDocument();
    expect(screen.getByText('North Holland')).toBeInTheDocument();
    expect(screen.getByText('2021 Q1')).toBeInTheDocument();
    // The chrome PREFIX translates ("Reading used:", already bilingual via
    // messages.ts) but the reading VALUE itself is backend-composed Dutch
    // prose, untouched — same discipline as the 'en' chrome test above.
    expect(screen.getByText('Reading used: Consumentenvertrouwen.')).toBeInTheDocument();
  });

  it('leaves every id/code/raw value verbatim in Technical details, on English too', () => {
    render(
      <LangProvider lang="en">
        <AnswerProof proof={translatableProof()} />
      </LangProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Prove this number' }));
    fireEvent.click(screen.getByRole('button', { name: 'Technical details' }));
    expect(screen.getByText('PV27')).toBeInTheDocument();
    expect(screen.getByText('2021KW01')).toBeInTheDocument();
    expect(screen.getByText('86141NED:CPI000000:NL01:2024JJ00')).toBeInTheDocument();
  });

  it('renders the SAME Dutch names on the Dutch interface, unchanged (no LangProvider — the app default)', () => {
    render(<AnswerProof proof={translatableProof()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Bewijs dit cijfer' }));
    expect(screen.getByText('Consumentenvertrouwen')).toBeInTheDocument();
    expect(screen.getByText('Noord-Holland')).toBeInTheDocument();
    expect(screen.getByText('2021 1e kwartaal')).toBeInTheDocument();
    expect(screen.queryByText('Consumer confidence')).toBeNull();
    expect(screen.queryByText('North Holland')).toBeNull();
    expect(screen.queryByText('2021 Q1')).toBeNull();
  });
});

// #296 part 2 Task 7: a scatter answer's proof lists BOTH tables.
describe('AnswerProof — scatter answer (two tables)', () => {
  it('shows the paired table\'s reading, cell table and steps under its own heading', () => {
    const paired = fakeProof({
      tableId: '03759ned',
      tableTitle: 'Bevolking op 1 januari',
      reading: 'Bevolking op 1 januari',
      cells: [fakeProofCell({ resultId: 'X1', measureTitle: 'Bevolking op 1 januari', valueText: '596.075' })],
      steps: [{ text: 'Gelezen: 3 cellen uit tabel 03759ned (de tabel hierboven).', technical: null }],
    });
    render(<AnswerProof proof={fakeProof({ paired })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Bewijs deze cijfers' }));
    expect(screen.getByText('Bevolking op 1 januari: tabel 03759ned')).toBeInTheDocument();
    expect(screen.getByText('Gebruikte lezing: Bevolking op 1 januari.')).toBeInTheDocument();
    expect(screen.getByText('596.075')).toBeInTheDocument();
    expect(screen.getByText('Gelezen: 3 cellen uit tabel 03759ned (de tabel hierboven).')).toBeInTheDocument();
    // The main table is still there, under its own measure-named heading
    // (named by measure, not axis: "swap axes" must not make it wrong).
    expect(screen.getByText('Inflatie (CPI): tabel 86141NED')).toBeInTheDocument();
    expect(screen.getByText('3,3%')).toBeInTheDocument();
  });

  it('a one-table proof shows no table headings', () => {
    render(<AnswerProof proof={fakeProof()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Bewijs dit cijfer' }));
    expect(screen.queryByText(/: tabel 86141NED$/)).toBeNull();
  });

  it('English chrome for the table headings, with the English measure names', () => {
    const cells = (measureTitle: string) => [fakeProofCell({ measureTitle })];
    render(
      <LangProvider lang="en">
        <AnswerProof
          proof={fakeProof({
            cells: cells('Gemiddeld inkomen'),
            paired: fakeProof({ tableId: '03759ned', cells: cells('Bevolking op 1 januari') }),
          })}
        />
      </LangProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Prove these numbers' }));
    expect(screen.getByText('Average income: table 86141NED')).toBeInTheDocument();
    expect(screen.getByText('Population on 1 January: table 03759ned')).toBeInTheDocument();
  });
});

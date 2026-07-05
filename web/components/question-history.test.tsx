// QuestionHistory (user dashboard, docs/06-roadmap.md "question history"):
// truncation, cost/date display, and the empty state -- the actual logic
// worth pinning in this otherwise-plain Server Component.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { QuestionHistoryEntry } from '../backend/billing/index.ts';
import { QuestionHistory } from './question-history.tsx';

afterEach(cleanup);

function entry(overrides: Partial<QuestionHistoryEntry> = {}): QuestionHistoryEntry {
  return {
    id: 1,
    kind: 'answer',
    question: 'Hoeveel inwoners heeft Nederland?',
    finalText: 'Nederland telt 18.044.027 inwoners.',
    createdAt: '2026-07-04T14:19:31.199Z',
    creditsCharged: 20,
    clarification: null,
    isDeleted: false,
    ...overrides,
  };
}

describe('QuestionHistory', () => {
  it('shows an empty-state message when there are no past questions', () => {
    render(<QuestionHistory items={[]} />);
    expect(screen.getByText('Nog geen eerdere vragen.')).toBeInTheDocument();
  });

  it('renders the question, credits charged, and the full answer text (available even collapsed)', () => {
    render(<QuestionHistory items={[entry()]} />);
    expect(screen.getByText('Hoeveel inwoners heeft Nederland?')).toBeInTheDocument();
    expect(screen.getByText(/20 credits/)).toBeInTheDocument();
    // Short text isn't truncated, so it legitimately appears twice (the
    // collapsed snippet and the expanded full text) — assert presence, not
    // uniqueness.
    expect(screen.getAllByText('Nederland telt 18.044.027 inwoners.').length).toBeGreaterThanOrEqual(1);
  });

  it('truncates a long answer in the collapsed snippet', () => {
    const longText = 'A'.repeat(200);
    render(<QuestionHistory items={[entry({ finalText: longText })]} />);
    expect(screen.getByText(`${'A'.repeat(120)}…`)).toBeInTheDocument();
  });

  it('omits the credits label when creditsCharged is null (a row with no attributable debit)', () => {
    render(<QuestionHistory items={[entry({ creditsCharged: null })]} />);
    expect(screen.queryByText(/credits/)).toBeNull();
  });

  // WP19 (open-questions #67): a collapsed clarification round renders as ONE
  // item -- original question, the exchange inside the fold, final outcome.
  it('renders a collapsed clarification round as one item with the full exchange', () => {
    render(
      <QuestionHistory
        items={[
          entry({
            kind: 'answer',
            question: 'Hoeveel inwoners heeft de gemeente?',
            finalText: 'Amsterdam telt 931.298 inwoners.',
            creditsCharged: 30,
            clarification: { text: 'Welke gemeente bedoel je?', reply: 'Amsterdam' },
          }),
        ]}
      />,
    );
    // One entry, one summary line -- never two rows for the same question.
    expect(screen.getAllByRole('group')).toHaveLength(1);
    expect(screen.getByText('Hoeveel inwoners heeft de gemeente?')).toBeInTheDocument();
    expect(screen.getByText('Welke gemeente bedoel je?')).toBeInTheDocument();
    expect(screen.getByText('Amsterdam')).toBeInTheDocument();
    // The round's TOTAL, shown once on the summary line and LABELED as a
    // total (review finding: unlabeled it reads as one answer's price).
    expect(screen.getByText(/30 credits totaal/)).toBeInTheDocument();
    expect(screen.getAllByText('Amsterdam telt 931.298 inwoners.').length).toBeGreaterThanOrEqual(1);
  });

  it('renders no exchange block and no "totaal" label when clarification is null', () => {
    render(<QuestionHistory items={[entry()]} />);
    expect(screen.queryByText('Verduidelijkingsvraag')).toBeNull();
    expect(screen.queryByText('Jouw antwoord')).toBeNull();
    // Binding both ways: a single-turn answer's price must NOT be labeled
    // as a total.
    expect(screen.queryByText(/totaal/)).toBeNull();
  });

  // #14 (GDPR self-service deletion + retention purge): a redacted row must
  // render as a "verwijderde vraag" placeholder -- never hidden (the row
  // itself, and its credit amount, must stay visible), never leaking the
  // original question or answer text.
  describe('deleted-question placeholder (#14)', () => {
    it('shows the placeholder label instead of the question, keeps the credit amount visible', () => {
      render(
        <QuestionHistory
          items={[
            entry({
              question: 'Deze vraag is verwijderd.',
              finalText: 'Deze vraag is verwijderd.',
              creditsCharged: 20,
              isDeleted: true,
            }),
          ]}
        />,
      );
      expect(screen.getByText('Verwijderde vraag')).toBeInTheDocument();
      expect(screen.getByText(/20 credits/)).toBeInTheDocument();
      // The row still expands to an honest "text is gone" note, never the
      // literal redaction sentinel and never silence.
      expect(screen.getByText('De tekst van deze vraag is verwijderd.')).toBeInTheDocument();
    });

    it('never renders the raw redaction sentinel text as if it were real content', () => {
      render(
        <QuestionHistory
          items={[
            entry({
              question: 'Deze vraag is verwijderd.',
              finalText: 'Deze vraag is verwijderd.',
              isDeleted: true,
            }),
          ]}
        />,
      );
      // The sentinel string must not appear verbatim anywhere in the
      // rendered output -- only the distinct placeholder copy should.
      expect(screen.queryByText('Deze vraag is verwijderd.', { exact: true })).toBeNull();
    });

    it('renders no clarification exchange for a deleted round, even if one was recorded', () => {
      render(
        <QuestionHistory
          items={[
            entry({
              question: 'Deze vraag is verwijderd.',
              finalText: 'Deze vraag is verwijderd.',
              clarification: { text: 'Welke gemeente bedoel je?', reply: 'Amsterdam' },
              isDeleted: true,
            }),
          ]}
        />,
      );
      expect(screen.queryByText('Welke gemeente bedoel je?')).toBeNull();
      expect(screen.queryByText('Amsterdam')).toBeNull();
    });

    it('a non-deleted row renders normally alongside a deleted one', () => {
      render(
        <QuestionHistory
          items={[
            entry({ id: 1, question: 'Deze vraag is verwijderd.', finalText: 'Deze vraag is verwijderd.', isDeleted: true }),
            entry({ id: 2, question: 'Hoeveel inwoners heeft Nederland?', isDeleted: false }),
          ]}
        />,
      );
      expect(screen.getByText('Verwijderde vraag')).toBeInTheDocument();
      expect(screen.getByText('Hoeveel inwoners heeft Nederland?')).toBeInTheDocument();
    });
  });
});

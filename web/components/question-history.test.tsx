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
});

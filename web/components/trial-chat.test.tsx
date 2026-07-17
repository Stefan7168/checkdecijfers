// The trial chat's client contract (ADR 036): the R8-audited response text
// renders verbatim, the budget counts down, every closed state swaps the
// input for the login nudge, and an error keeps the input (the question was
// refunded server-side).
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { askTrialQuestion } = vi.hoisted(() => ({ askTrialQuestion: vi.fn() }));
vi.mock('../app/trial-actions.ts', () => ({ askTrialQuestion }));

import { TrialChat } from './trial-chat.tsx';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function ask(question: string) {
  fireEvent.change(screen.getByLabelText('Stel je gratis proefvraag'), {
    target: { value: question },
  });
  fireEvent.submit(screen.getByRole('button', { name: /Vraag|Rekenen/ }).closest('form')!);
  await waitFor(() => expect(askTrialQuestion).toHaveBeenCalled());
}

describe('TrialChat', () => {
  it('renders the served response text verbatim and counts the budget down', async () => {
    askTrialQuestion.mockResolvedValue({
      kind: 'ok',
      response: { kind: 'answer', text: 'De inflatie was 2,9% (voorlopig). Bron: CBS.', chart: null },
      questionsLeft: 1,
    });
    render(<TrialChat initialQuestionsLeft={2} />);
    await ask('Wat is de inflatie?');
    expect(await screen.findByText(/De inflatie was 2,9%/)).toBeInTheDocument();
    expect(screen.getByText('Wat is de inflatie?')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('swaps the input for the login nudge when the budget hits zero', async () => {
    askTrialQuestion.mockResolvedValue({
      kind: 'ok',
      response: { kind: 'answer', text: 'Antwoord.', chart: null },
      questionsLeft: 0,
    });
    render(<TrialChat initialQuestionsLeft={1} />);
    await ask('Vraag twee');
    expect(await screen.findByText(/proefvragen gebruikt/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Stel je gratis proefvraag')).toBeNull();
  });

  it('degrades to the pot-empty nudge on closed', async () => {
    askTrialQuestion.mockResolvedValue({ kind: 'closed', reason: 'pot_empty' });
    render(<TrialChat initialQuestionsLeft={2} />);
    await ask('Vraag');
    expect(await screen.findByText(/proefpotje is op dit moment leeg/)).toBeInTheDocument();
  });

  it('a clarification renders read-only with the account nudge; the input stays open (ADR 036 D5)', async () => {
    askTrialQuestion.mockResolvedValue({
      kind: 'ok',
      response: { kind: 'clarification', text: 'Bedoel je de maand- of jaarmutatie?', chart: null },
      questionsLeft: 1,
    });
    render(<TrialChat initialQuestionsLeft={2} />);
    await ask('Wat doet de inflatie?');
    expect(await screen.findByText(/Bedoel je de maand- of jaarmutatie\?/)).toBeInTheDocument();
    expect(screen.getByText(/niet doorvragen op een verduidelijking/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /maak een gratis account/ })).toBeInTheDocument();
    expect(screen.getByLabelText('Stel je gratis proefvraag')).toBeInTheDocument();
  });

  it('keeps the input after an error — the question was refunded', async () => {
    askTrialQuestion.mockRejectedValue(new Error('masked'));
    render(<TrialChat initialQuestionsLeft={2} />);
    await ask('Vraag');
    expect(await screen.findByText(/niet verbruikt/)).toBeInTheDocument();
    expect(screen.getByLabelText('Stel je gratis proefvraag')).toBeInTheDocument();
  });
});

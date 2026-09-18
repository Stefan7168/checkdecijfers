// Co-pilot phase 2 (session 113, Task 8) — the chat doorway's own UI, in
// isolation: the input, the three example chips, and the reply strip
// (applied chips + one line per refusal + Undo/Retry/👍👎). Pure
// presentation over callbacks; every server round trip belongs to the card.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChartCopilotInput, RecipeChips } from './chart-copilot-input.tsx';
import type { AppliedChip } from '../lib/chart-copilot-reply.ts';

afterEach(cleanup);

const EXAMPLES = [
  { label: 'Totaal per Gemeente', message: 'Totaal per Gemeente' },
  { label: 'Hoogste eerst', message: 'Hoogste eerst' },
  { label: 'Geef de grafiek een kop', message: 'Geef de grafiek een kop' },
];

function applied(): AppliedChip[] {
  return [
    { command: { kind: 'setForm', form: 'bar' }, label: 'Weergave: Staaf', icon: 'form', opens: 'form' },
    { command: { kind: 'resetPresentation' }, label: 'Opmaak teruggezet', icon: 'style', opens: 'style' },
  ];
}

function props(overrides: Partial<Parameters<typeof ChartCopilotInput>[0]> = {}): Parameters<typeof ChartCopilotInput>[0] {
  return {
    lang: 'nl',
    busy: false,
    examples: EXAMPLES,
    reply: null,
    error: null,
    onSend: vi.fn(),
    onUndoReply: vi.fn(),
    onRetry: vi.fn(),
    onFeedback: vi.fn().mockResolvedValue({ ok: true }),
    onOpen: vi.fn(),
    ...overrides,
  };
}

function reply(overrides: Partial<NonNullable<Parameters<typeof ChartCopilotInput>[0]['reply']>> = {}) {
  return {
    applied: applied(),
    refused: [],
    dropped: 0,
    turnId: 12,
    netCost: 4,
    commandIds: ['id-1', 'id-2'],
    undone: false,
    canUndo: true,
    message: 'maak er een staafdiagram van',
    text: 'Twee dingen aangepast.',
    ...overrides,
  };
}

describe('ChartCopilotInput — the input', () => {
  it('uses the agreed placeholder', () => {
    render(<ChartCopilotInput {...props()} />);
    expect(screen.getByPlaceholderText('Pas deze grafiek aan')).toBeInTheDocument();
  });

  it('sends what the reader typed', () => {
    const onSend = vi.fn();
    render(<ChartCopilotInput {...props({ onSend })} />);
    fireEvent.change(screen.getByPlaceholderText('Pas deze grafiek aan'), { target: { value: '  zet Amsterdam in de schijnwerper  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Versturen' }));
    expect(onSend).toHaveBeenCalledWith('zet Amsterdam in de schijnwerper');
  });

  it('disables the send control while empty and while busy', () => {
    const { unmount } = render(<ChartCopilotInput {...props()} />);
    expect(screen.getByRole('button', { name: 'Versturen' })).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText('Pas deze grafiek aan'), { target: { value: 'x' } });
    expect(screen.getByRole('button', { name: 'Versturen' })).toBeEnabled();
    unmount();
    render(<ChartCopilotInput {...props({ busy: true })} />);
    expect(screen.getByRole('button', { name: 'Bezig…' })).toBeDisabled();
  });

  it('shows the three example chips and sends a chip\'s own words', () => {
    const onSend = vi.fn();
    render(<ChartCopilotInput {...props({ onSend })} />);
    for (const example of EXAMPLES) expect(screen.getByRole('button', { name: example.label })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Hoogste eerst' }));
    expect(onSend).toHaveBeenCalledWith('Hoogste eerst');
  });

  it('hides the example chips once there is a reply', () => {
    render(<ChartCopilotInput {...props({ reply: reply() })} />);
    expect(screen.queryByRole('button', { name: 'Hoogste eerst' })).not.toBeInTheDocument();
  });

  it('collapses to a chip on a phone and expands on click', () => {
    render(<ChartCopilotInput {...props()} />);
    // Two controls carry the same words: the sm-hidden expander chip and the
    // input itself (its placeholder). The chip is the mobile doorway.
    const chip = screen.getByRole('button', { name: 'Pas deze grafiek aan' });
    expect(chip.className).toContain('sm:hidden');
    fireEvent.click(chip);
    expect(screen.queryByRole('button', { name: 'Pas deze grafiek aan' })).not.toBeInTheDocument();
  });

  it('shows an error line as given', () => {
    render(<ChartCopilotInput {...props({ error: 'Dit bestand is niet meer beschikbaar.' })} />);
    expect(screen.getByText('Dit bestand is niet meer beschikbaar.')).toBeInTheDocument();
  });
});

describe('ChartCopilotInput — the reply', () => {
  it('renders one chip per applied command, and the assistant line', () => {
    render(<ChartCopilotInput {...props({ reply: reply() })} />);
    expect(screen.getByText('Twee dingen aangepast.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Weergave: Staaf' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Opmaak teruggezet' })).toBeInTheDocument();
  });

  it('opens the panel a chip belongs to', () => {
    const onOpen = vi.fn();
    render(<ChartCopilotInput {...props({ reply: reply(), onOpen })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Opmaak teruggezet' }));
    expect(onOpen).toHaveBeenCalledWith('style');
  });

  it('renders one line per refused request, naming the control that can', () => {
    render(
      <ChartCopilotInput
        {...props({
          reply: reply({
            refused: [
              { request: 'kleur van de lijn', reason: 'not_available', control: 'style' },
              { request: 'notitie bij de piek', reason: 'needs_click', control: 'notes' },
            ],
          }),
        })}
      />,
    );
    expect(screen.getByText(/kleur van de lijn.*Opmaak: open het paneel Opmaak\./)).toBeInTheDocument();
    expect(screen.getByText(/notitie bij de piek.*Notities: klik op een punt in de grafiek\./)).toBeInTheDocument();
  });

  it('says so when a command had to be dropped', () => {
    const { unmount } = render(<ChartCopilotInput {...props({ reply: reply({ dropped: 1 }) })} />);
    expect(screen.getByText('Eén onderdeel kon niet worden toegepast.')).toBeInTheDocument();
    unmount();
    render(<ChartCopilotInput {...props({ reply: reply({ dropped: 2 }) })} />);
    expect(screen.getByText('Een paar onderdelen konden niet worden toegepast.')).toBeInTheDocument();
  });

  it('shows the credit cost of this turn', () => {
    render(<ChartCopilotInput {...props({ reply: reply({ netCost: 4 }) })} />);
    expect(screen.getByText('Kostte 4 credits')).toBeInTheDocument();
  });

  it('undoes the whole reply through the command ids it dispatched', () => {
    const onUndoReply = vi.fn();
    render(<ChartCopilotInput {...props({ reply: reply(), onUndoReply })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Dit antwoord ongedaan maken' }));
    expect(onUndoReply).toHaveBeenCalledWith(['id-1', 'id-2']);
  });

  it('retries the same message — plainly labelled as a new charge', () => {
    const onRetry = vi.fn();
    render(<ChartCopilotInput {...props({ reply: reply(), onRetry })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Opnieuw proberen (kost credits)' }));
    expect(onRetry).toHaveBeenCalledWith('maak er een staafdiagram van');
  });

  it('takes a vote once the action CONFIRMS it, then disables both buttons', async () => {
    const onFeedback = vi.fn().mockResolvedValue({ ok: true });
    render(<ChartCopilotInput {...props({ reply: reply(), onFeedback })} />);
    const up = screen.getByRole('button', { name: 'Dit antwoord was goed' });
    fireEvent.click(up);
    expect(onFeedback).toHaveBeenCalledWith(12, 'up');
    expect(await screen.findByText('Bedankt voor je feedback.')).toBeInTheDocument();
    expect(up).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Dit antwoord was niet goed' })).toBeDisabled();
    fireEvent.click(up);
    expect(onFeedback).toHaveBeenCalledTimes(1);
  });

  it('never says thanks for a vote the action refused — and leaves a retry possible', async () => {
    const onFeedback = vi.fn().mockResolvedValue({ ok: false });
    render(<ChartCopilotInput {...props({ reply: reply(), onFeedback })} />);
    const up = screen.getByRole('button', { name: 'Dit antwoord was goed' });
    fireEvent.click(up);
    expect(await screen.findByText('Feedback kon niet worden opgeslagen.')).toBeInTheDocument();
    expect(screen.queryByText('Bedankt voor je feedback.')).not.toBeInTheDocument();
    expect(up).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Dit antwoord was niet goed' })).toBeEnabled();
  });

  it('handles a REJECTED feedback call the same way — no unhandled rejection', async () => {
    const onFeedback = vi.fn().mockRejectedValue(new Error('offline'));
    render(<ChartCopilotInput {...props({ reply: reply(), onFeedback })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Dit antwoord was goed' }));
    expect(await screen.findByText('Feedback kon niet worden opgeslagen.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dit antwoord was goed' })).toBeEnabled();
  });

  it('offers no vote at all without a stored turn to attach it to', () => {
    render(<ChartCopilotInput {...props({ reply: reply({ turnId: null }) })} />);
    expect(screen.queryByRole('button', { name: 'Dit antwoord was goed' })).not.toBeInTheDocument();
  });

  it('keeps a stale group Undo visible but disabled, with its reason', () => {
    render(<ChartCopilotInput {...props({ reply: reply({ canUndo: false }) })} />);
    const undo = screen.getByRole('button', { name: 'Dit antwoord ongedaan maken' });
    expect(undo).toBeDisabled();
    expect(undo).toHaveAttribute('title', 'Dit antwoord staat niet meer bovenaan. Gebruik Ongedaan maken of de geschiedenis.');
  });

  it('marks the chips as undone once the reply was taken back, and drops the Undo control', () => {
    render(<ChartCopilotInput {...props({ reply: reply({ undone: true }) })} />);
    expect(screen.queryByRole('button', { name: 'Dit antwoord ongedaan maken' })).not.toBeInTheDocument();
    const chip = screen.getByRole('button', { name: /Weergave: Staaf/ });
    expect(chip.className).toContain('line-through');
    expect(chip).toBeDisabled();
    // The strike-through is invisible to a screen reader, so it is said.
    expect(chip).toHaveAccessibleName('Weergave: Staaf ongedaan gemaakt');
  });

  it('does not offer a chip whose doorway is not mounted right now (Tabel form)', () => {
    const onOpen = vi.fn();
    render(<ChartCopilotInput {...props({ reply: reply(), onOpen, canOpen: (target) => target === 'form' })} />);
    const style = screen.getByRole('button', { name: 'Opmaak teruggezet' });
    expect(style).toBeDisabled();
    fireEvent.click(style);
    expect(onOpen).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Weergave: Staaf' })).toBeEnabled();
  });

  it('shows a clarification/refusal reply as text alone — no chips, no Undo', () => {
    render(<ChartCopilotInput {...props({ reply: reply({ applied: [], commandIds: [], text: 'Wat bedoel je precies?' }) })} />);
    expect(screen.getByText('Wat bedoel je precies?')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Dit antwoord ongedaan maken' })).not.toBeInTheDocument();
  });
});

describe('ChartCopilotInput — phase 3: follow-up hand-off and the locked note', () => {
  it('offers the follow-up chip and forwards the original message', () => {
    const onAskFollowUp = vi.fn();
    render(
      <ChartCopilotInput
        {...props({
          reply: reply({ followUp: 'gemiddelde temperatuur in Utrecht', applied: [], commandIds: [] }),
          onAskFollowUp,
        })}
      />,
    );
    expect(screen.getByText('Dit vraagt om andere data. Als vervolgvraag krijgt het een eigen antwoord en grafiek.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Stel als vervolgvraag' }));
    expect(onAskFollowUp).toHaveBeenCalledWith('gemiddelde temperatuur in Utrecht');
  });

  it('does not offer the follow-up chip without a handler, or without a followUp on the reply', () => {
    const { unmount } = render(
      <ChartCopilotInput {...props({ reply: reply({ followUp: 'iets anders' }) })} />,
    );
    expect(screen.queryByRole('button', { name: 'Stel als vervolgvraag' })).not.toBeInTheDocument();
    unmount();
    render(<ChartCopilotInput {...props({ reply: reply({ followUp: null }), onAskFollowUp: vi.fn() })} />);
    expect(screen.queryByRole('button', { name: 'Stel als vervolgvraag' })).not.toBeInTheDocument();
  });

  it('renders the locked note above the field when given', () => {
    render(<ChartCopilotInput {...props({ lockedNote: 'Dit past alleen de weergave aan, nooit de cijfers.' })} />);
    expect(screen.getByText('Dit past alleen de weergave aan, nooit de cijfers.')).toBeInTheDocument();
  });

  it('renders no locked note when absent', () => {
    render(<ChartCopilotInput {...props()} />);
    expect(screen.queryByText(/nooit de cijfers/)).not.toBeInTheDocument();
  });
});

describe('RecipeChips — also the replayed edit message in the thread', () => {
  it('renders labels with their panel icon, without needing a click handler', () => {
    render(<RecipeChips applied={[{ label: 'Data: Omzet per Gemeente', icon: 'data' }]} refused={[]} lang="nl" />);
    expect(screen.getByText('Data: Omzet per Gemeente')).toBeInTheDocument();
  });

  it('renders the refusal lines in en too', () => {
    render(<RecipeChips applied={[]} refused={[{ request: 'a pie chart', reason: 'not_available', control: 'form' }]} lang="en" />);
    expect(screen.getByText(/a pie chart.*View: pick a form above the chart\./)).toBeInTheDocument();
  });
});

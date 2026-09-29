// Breadth step 5 (Task 6): the workspace chat wired to the table lane - the
// progress bubble a routing turn leaves, the audited outcome swapped in by the
// poll, the breakdown question's buttons, and typed replies to it.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AskOutcome } from '../app/actions.ts';
import type { ComposedResponse } from '../backend/answer/respond/types.ts';
import type { GatedResponse } from '../backend/billing/index.ts';
import type { PollTableLaneOutcome, ReplyTableLaneChoice, ReplyTableLaneOutcome } from '../lib/table-lane.ts';
import { LangProvider } from '../lib/i18n/lang-provider.tsx';
import { fakeAnswerResponse } from '../test/fake-answer.ts';
import { Chat } from './chat.tsx';

const { askQuestion, replyToClarification, pollTableLane, replyToTableLane } = vi.hoisted(() => ({
  askQuestion: vi.fn<(...args: unknown[]) => Promise<AskOutcome>>(),
  replyToClarification: vi.fn<(...args: unknown[]) => Promise<AskOutcome>>(),
  pollTableLane: vi.fn<(rowId: number) => Promise<PollTableLaneOutcome>>(),
  replyToTableLane: vi.fn<
    (rowId: number, choice: ReplyTableLaneChoice, requestId: string) => Promise<ReplyTableLaneOutcome>
  >(),
}));
vi.mock('../app/actions.ts', () => ({
  askQuestion,
  replyToClarification,
  pollTableLane,
  replyToTableLane,
  submitAnswerFeedback: vi.fn(),
  confirmOnboardingFetch: vi.fn(),
}));
vi.mock('../app/chart-edits-actions.ts', () => ({ fetchChartEdits: vi.fn().mockResolvedValue({ ok: false }) }));
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  usePathname: () => '/chat',
}));

Element.prototype.scrollIntoView = vi.fn();

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  askQuestion.mockReset();
  replyToClarification.mockReset();
  pollTableLane.mockReset();
  replyToTableLane.mockReset();
});

const ROUTING_TEXT = 'ROUTING-REFUSAL-TEXT-NEVER-SHOWN';
const QUESTION = {
  dimension: 'Geslacht',
  dimensionTitle: 'Geslacht',
  options: [
    { code: 'T001038', title: 'Totaal mannen en vrouwen' },
    { code: '3000', title: 'Mannen' },
  ],
  totalOptions: 2,
};

function routingOutcome(rowId = 41): AskOutcome {
  return {
    gated: {
      kind: 'ok',
      netCost: 0,
      auditId: 5,
      response: { kind: 'refusal', reason: 'onboarding_pending', text: ROUTING_TEXT } as unknown as ComposedResponse,
    },
    context: null,
    threadId: null,
    onboardingOffer: null,
    proofRequestUrls: null,
    tableLane: { rowId },
  };
}

function laneAnswerGated(): GatedResponse {
  return {
    kind: 'ok',
    netCost: 20,
    auditId: 9,
    response: {
      ...fakeAnswerResponse({ body: 'Er zijn 5 dingen.' }),
      tableLane: { version: 1, rowId: 41, tableId: '83765NED', selectionNote: 'Selectie: Geslacht: Mannen', question: null },
    } as unknown as ComposedResponse,
  };
}

function laneQuestionGated(): GatedResponse {
  return {
    kind: 'ok',
    netCost: 5,
    auditId: 8,
    response: {
      kind: 'clarification',
      text: 'Welk geslacht bedoel je?',
      pending: null,
      tableLane: { version: 1, rowId: 41, tableId: '83765NED', selectionNote: null, question: QUESTION },
    } as unknown as ComposedResponse,
  };
}

function renderChat(props: React.ComponentProps<typeof Chat> = {}) {
  return render(
    <LangProvider lang="nl">
      <Chat {...props} />
    </LangProvider>,
  );
}

async function ask(text: string) {
  fireEvent.change(screen.getByPlaceholderText('Stel een vraag…'), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Verstuur' }));
  await screen.findByText(text);
}

describe('table lane in the chat', () => {
  it('shows a progress bubble (not the routing refusal), then swaps in the answer with its selection note', async () => {
    askQuestion.mockResolvedValue(routingOutcome());
    const onThreadId = vi.fn();
    const onOutcome = vi.fn();
    renderChat({ onThreadId, onOutcome });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText('Stel een vraag…'), { target: { value: 'Hoeveel dingen?' } });
      fireEvent.click(screen.getByRole('button', { name: 'Verstuur' }));
    });
    expect(screen.getByText('CBS-tabel ophalen…')).toBeTruthy();
    expect(screen.queryByText(ROUTING_TEXT)).toBeNull();

    pollTableLane.mockResolvedValueOnce({ status: 'running' }).mockResolvedValueOnce({
      status: 'done',
      gated: laneAnswerGated(),
      threadId: 12,
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000);
    });
    expect(screen.queryByText('CBS-tabel ophalen…')).toBeNull();
    expect(screen.getByText('Er zijn 5 dingen.')).toBeTruthy();
    expect(screen.getByText('Selectie: Geslacht: Mannen')).toBeTruthy();
    // The thread the job attached is adopted like a direct answer's.
    expect(onThreadId).toHaveBeenLastCalledWith(12);
    // The settled cost (not the free routing turn) reaches the balance callback.
    expect(onOutcome).toHaveBeenLastCalledWith(expect.objectContaining({ netCost: 20 }));
  });

  it('shows the over-budget line after 60 s and the not-ready line after 10 minutes', async () => {
    askQuestion.mockResolvedValue(routingOutcome());
    pollTableLane.mockResolvedValue({ status: 'running' });
    renderChat();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText('Stel een vraag…'), { target: { value: 'Hoeveel dingen?' } });
      fireEvent.click(screen.getByRole('button', { name: 'Verstuur' }));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(
      screen.getByText('Dit duurt langer dan normaal. Het antwoord verschijnt in dit gesprek zodra het klaar is.'),
    ).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(540_000);
    });
    expect(screen.queryByText('CBS-tabel ophalen…')).toBeNull();
    expect(
      screen.getByText('Het antwoord is nog niet klaar. Het verschijnt in dit gesprek zodra het er is.'),
    ).toBeTruthy();
  });

  it('a gone poll becomes the plain not-ready line', async () => {
    askQuestion.mockResolvedValue(routingOutcome());
    pollTableLane.mockResolvedValue({ status: 'gone' });
    renderChat();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText('Stel een vraag…'), { target: { value: 'Hoeveel dingen?' } });
      fireEvent.click(screen.getByRole('button', { name: 'Verstuur' }));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(
      screen.getByText('Het antwoord is nog niet klaar. Het verschijnt in dit gesprek zodra het er is.'),
    ).toBeTruthy();
  });
});

async function landQuestion() {
  askQuestion.mockResolvedValue(routingOutcome());
  pollTableLane.mockResolvedValue({ status: 'done', gated: laneQuestionGated(), threadId: 12 });
  renderChat();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  await act(async () => {
    fireEvent.change(screen.getByPlaceholderText('Stel een vraag…'), { target: { value: 'Hoeveel dingen?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verstuur' }));
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2_000);
  });
  vi.useRealTimers();
}

describe('table lane breakdown question in the chat', () => {
  it('renders the question text with a button per member', async () => {
    await landQuestion();
    expect(screen.getByText('Welk geslacht bedoel je?')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Totaal mannen en vrouwen' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Mannen' })).toBeTruthy();
  });

  it('a button click replies with the code, shows the choice, and opens a new progress bubble', async () => {
    await landQuestion();
    replyToTableLane.mockResolvedValue({ kind: 'started', rowId: 77 });
    fireEvent.click(screen.getByRole('button', { name: 'Mannen' }));
    await waitFor(() => expect(screen.getByText('CBS-tabel ophalen…')).toBeTruthy());
    expect(replyToTableLane).toHaveBeenCalledWith(41, { code: '3000' }, expect.any(String));
    expect(askQuestion).toHaveBeenCalledTimes(1);
    // The answered question no longer offers buttons.
    expect(screen.queryByRole('button', { name: 'Totaal mannen en vrouwen' })).toBeNull();
  });

  it('a typed reply goes to replyToTableLane, not askQuestion; no match keeps the question open', async () => {
    await landQuestion();
    replyToTableLane.mockResolvedValue({ kind: 'no_match' });
    fireEvent.change(screen.getByPlaceholderText('Stel een vraag…'), { target: { value: 'Onbekend' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verstuur' }));
    await screen.findByText(
      'Die naam staat niet in de lijst van deze tabel. Kies een knop of typ de naam precies zoals CBS hem noemt.',
    );
    expect(replyToTableLane).toHaveBeenCalledWith(41, { text: 'Onbekend' }, expect.any(String));
    expect(askQuestion).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Mannen' })).toBeTruthy();

    // A second typed attempt still answers the (still open) question.
    replyToTableLane.mockResolvedValue({ kind: 'started', rowId: 78 });
    fireEvent.change(screen.getByPlaceholderText('Stel een vraag…'), { target: { value: 'mannen' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verstuur' }));
    await waitFor(() => expect(screen.getByText('CBS-tabel ophalen…')).toBeTruthy());
    expect(replyToTableLane).toHaveBeenLastCalledWith(41, { text: 'mannen' }, expect.any(String));
    expect(askQuestion).toHaveBeenCalledTimes(1);
  });

  it('once the reply started, the next typed text is an ordinary new question', async () => {
    await landQuestion();
    replyToTableLane.mockResolvedValue({ kind: 'started', rowId: 77 });
    fireEvent.click(screen.getByRole('button', { name: 'Mannen' }));
    await waitFor(() => expect(screen.getByText('CBS-tabel ophalen…')).toBeTruthy());
    askQuestion.mockResolvedValue({
      gated: { kind: 'unauthenticated' },
      context: null,
      threadId: null,
      onboardingOffer: null,
      proofRequestUrls: null,
      tableLane: null,
    });
    await ask('Een nieuwe vraag');
    await waitFor(() => expect(askQuestion).toHaveBeenCalledTimes(2));
    expect(replyToTableLane).toHaveBeenCalledTimes(1);
  });

  it('a reply to a question that is no longer open shows the reask line and closes the question', async () => {
    await landQuestion();
    replyToTableLane.mockResolvedValue({ kind: 'gone' });
    fireEvent.click(screen.getByRole('button', { name: 'Mannen' }));
    await screen.findByText('Deze keuzevraag staat niet meer open. Stel je vraag opnieuw.');
    expect(screen.queryByRole('button', { name: 'Totaal mannen en vrouwen' })).toBeNull();
  });
});

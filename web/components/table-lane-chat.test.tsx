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
import { MESSAGES } from '../lib/i18n/messages.ts';
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

function laneQuestionGated(withEnglish = false): GatedResponse {
  return {
    kind: 'ok',
    netCost: 5,
    auditId: 8,
    response: {
      kind: 'clarification',
      text: 'Welk geslacht bedoel je?',
      // The REAL envelope shape Task 3's buildClarification produces: the member
      // titles ride along as suggestions and English chips, with a STRIPPED
      // rescue carrier as `pending`.
      suggestions: QUESTION.options.map((o) => o.title),
      pending: {
        question: 'Hoeveel dingen?',
        referenceDate: '2026-09-29',
        axes: ['measure'],
        questionNl: 'Welk geslacht bedoel je?',
        options: [],
        rescueOnly: true,
      },
      // An English reader's envelope also carries the English sibling (with chips).
      ...(withEnglish
        ? {
            english: {
              source: 'template',
              text: 'Which sex do you mean?',
              chips: QUESTION.options.map((o) => ({ label: o.title, submit: o.title })),
              untranslated: [],
            },
          }
        : {}),
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
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
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
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
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
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
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
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
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

  it('shows ONLY the lane buttons - no generic suggestion chips or hint (real envelope shape)', async () => {
    await landQuestion();
    expect(screen.getAllByRole('button', { name: 'Mannen' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Totaal mannen en vrouwen' })).toHaveLength(1);
    expect(screen.queryByText(MESSAGES.nl['chat.clarificationOptionsHint'])).toBeNull();
  });

  it('for an English reader too: the English question text, lane buttons only (no English chip row)', async () => {
    askQuestion.mockResolvedValue(routingOutcome());
    pollTableLane.mockResolvedValue({ status: 'done', gated: laneQuestionGated(true), threadId: 12 });
    render(
      <LangProvider lang="en">
        <Chat />
      </LangProvider>,
    );
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText('Ask a question…'), { target: { value: 'How many?' } });
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    vi.useRealTimers();
    expect(screen.getByText('Which sex do you mean?')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Mannen' })).toHaveLength(1);
    expect(screen.queryByText('Pick an option:')).toBeNull();
  });

  it('a typed name that matches answers the question through replyToTableLane', async () => {
    await landQuestion();
    replyToTableLane.mockResolvedValue({ kind: 'started', rowId: 78 });
    fireEvent.change(screen.getByPlaceholderText('Stel een vraag…'), { target: { value: 'mannen' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verstuur' }));
    await waitFor(() => expect(screen.getByText('CBS-tabel ophalen…')).toBeTruthy());
    expect(replyToTableLane).toHaveBeenCalledWith(41, { text: 'mannen' }, expect.any(String));
    expect(askQuestion).toHaveBeenCalledTimes(1);
  });

  it('R13: typed text that matches nothing closes the question and goes on as a fresh question', async () => {
    await landQuestion();
    replyToTableLane.mockResolvedValue({ kind: 'no_match' });
    askQuestion.mockResolvedValue({
      gated: { kind: 'unauthenticated' },
      context: null,
      threadId: null,
      onboardingOffer: null,
      proofRequestUrls: null,
      tableLane: null,
    });
    fireEvent.change(screen.getByPlaceholderText('Stel een vraag…'), { target: { value: 'Iets heel anders' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verstuur' }));
    await waitFor(() => expect(askQuestion).toHaveBeenCalledTimes(2));
    expect(replyToTableLane).toHaveBeenCalledWith(41, { text: 'Iets heel anders' }, expect.any(String));
    expect(askQuestion.mock.calls[1]![0]).toBe('Iets heel anders');
    // One bubble for the reader's text (not two), and the question is closed.
    expect(screen.getAllByText('Iets heel anders')).toHaveLength(1);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Mannen' })).toBeNull());
    expect(
      screen.queryByText(
        'Die naam staat niet in de lijst van deze tabel. Kies een knop of typ de naam precies zoals de tabel hem noemt.',
      ),
    ).toBeNull();
  });

  it('a button the server rejects (no_match) shows the info line and keeps the question open', async () => {
    await landQuestion();
    replyToTableLane.mockResolvedValue({ kind: 'no_match' });
    fireEvent.click(screen.getByRole('button', { name: 'Mannen' }));
    await screen.findByText(
      'Die naam staat niet in de lijst van deze tabel. Kies een knop of typ de naam precies zoals de tabel hem noemt.',
    );
    expect(screen.getByRole('button', { name: 'Mannen' })).toBeTruthy();
  });

  it('insufficient credits on a click keeps the question open', async () => {
    await landQuestion();
    replyToTableLane.mockResolvedValue({ kind: 'insufficient_credits', balance: 1, required: 20 });
    fireEvent.click(screen.getByRole('button', { name: 'Mannen' }));
    await screen.findByText(/Je hebt niet genoeg credits/);
    expect(screen.getByRole('button', { name: 'Mannen' })).toBeTruthy();
  });

  it('a double click on a button sends one reply (latch)', async () => {
    await landQuestion();
    let release!: (value: ReplyTableLaneOutcome) => void;
    replyToTableLane.mockImplementation(() => new Promise((r) => (release = r)));
    const button = screen.getByRole('button', { name: 'Mannen' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(replyToTableLane).toHaveBeenCalledTimes(1);
    await act(async () => {
      release({ kind: 'started', rowId: 77 });
    });
    expect(replyToTableLane).toHaveBeenCalledTimes(1);
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

describe('a lane result landing above newer turns', () => {
  it('leaves the newer turn\'s open clarification round (pending) alone', async () => {
    askQuestion.mockResolvedValueOnce(routingOutcome());
    pollTableLane.mockResolvedValue({ status: 'running' });
    renderChat();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText('Stel een vraag…'), { target: { value: 'Eerste vraag' } });
      fireEvent.click(screen.getByRole('button', { name: 'Verstuur' }));
    });
    // Meanwhile the reader asks a second, curated question that needs a clarification.
    askQuestion.mockResolvedValueOnce({
      gated: {
        kind: 'ok',
        netCost: 5,
        auditId: 30,
        response: {
          kind: 'clarification',
          text: 'Welk jaar bedoel je?',
          pending: { questionNl: 'Welk jaar bedoel je?' },
        } as unknown as ComposedResponse,
      },
      context: null,
      threadId: null,
      onboardingOffer: null,
      proofRequestUrls: null,
      tableLane: null,
    });
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText('Stel een vraag…'), { target: { value: 'Tweede vraag' } });
      fireEvent.click(screen.getByRole('button', { name: 'Verstuur' }));
    });
    expect(screen.getByText('Welk jaar bedoel je?')).toBeTruthy();

    // Now the first job lands as a button question - above the second turn.
    pollTableLane.mockResolvedValue({ status: 'done', gated: laneQuestionGated(), threadId: null });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(screen.getByText('Welk geslacht bedoel je?')).toBeTruthy();
    // Not the live round: its buttons are not offered ...
    expect(screen.queryByRole('button', { name: 'Mannen' })).toBeNull();

    // ... and the composer still answers the SECOND turn's clarification.
    replyToClarification.mockResolvedValue({
      gated: { kind: 'unauthenticated' },
      context: null,
      threadId: null,
      onboardingOffer: null,
      proofRequestUrls: null,
      tableLane: null,
    });
    vi.useRealTimers();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '2024' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verstuur' }));
    await waitFor(() => expect(replyToClarification).toHaveBeenCalledTimes(1));
    expect(replyToTableLane).not.toHaveBeenCalled();
    expect(askQuestion).toHaveBeenCalledTimes(2);
  });
});

// Breadth step 5 (Task 7): the next question after a landed lane ANSWER sends
// that row's id (askQuestion's 6th argument), so the server can reuse its
// table for a follow-up. Only the latest live-round landing counts: a lane
// question/refusal, or any other turn, clears the link.
describe('table-lane follow-up link', () => {
  const CURATED_CONTEXT = { version: 1, marker: 'curated-referent' } as unknown as AskOutcome['context'];

  function plainOutcome(response: ComposedResponse, context: AskOutcome['context'] = null): AskOutcome {
    return {
      gated: { kind: 'ok', netCost: 20, auditId: 3, response },
      context,
      threadId: 12,
      onboardingOffer: null,
      proofRequestUrls: null,
      tableLane: null,
    };
  }

  function laneRefusalGated(): GatedResponse {
    return {
      kind: 'ok',
      netCost: 0,
      auditId: 10,
      response: {
        kind: 'refusal',
        reason: 'table_lane_no_measure',
        text: 'Deze tabel heeft daar geen cijfer voor.',
        tableLane: { version: 1, rowId: 41, tableId: '83765NED', selectionNote: null, question: null },
      } as unknown as ComposedResponse,
    };
  }

  async function landLane(gated: GatedResponse) {
    askQuestion.mockResolvedValueOnce(routingOutcome(41));
    pollTableLane.mockResolvedValue({ status: 'done', gated, threadId: 12 });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText('Stel een vraag…'), { target: { value: 'Hoeveel dingen in 2019?' } });
      fireEvent.click(screen.getByRole('button', { name: 'Verstuur' }));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    vi.useRealTimers();
  }

  async function askNext(text: string, outcome: AskOutcome = plainOutcome(fakeAnswerResponse({ body: 'Volgend antwoord.' }) as unknown as ComposedResponse)) {
    askQuestion.mockResolvedValueOnce(outcome);
    const before = askQuestion.mock.calls.length;
    fireEvent.change(screen.getByPlaceholderText('Stel een vraag…'), { target: { value: text } });
    fireEvent.click(screen.getByRole('button', { name: 'Verstuur' }));
    await waitFor(() => expect(askQuestion.mock.calls.length).toBe(before + 1));
    return askQuestion.mock.calls[before]!;
  }

  it('after a lane answer the next question sends its row id (and drops the older curated referent)', async () => {
    renderChat({ onThreadId: vi.fn() });
    // An earlier curated answer left a curated referent behind ...
    askQuestion.mockResolvedValueOnce(plainOutcome(fakeAnswerResponse({ body: 'Curated.' }) as unknown as ComposedResponse, CURATED_CONTEXT));
    await ask('Hoeveel inwoners heeft Amsterdam?');
    await screen.findByText('Curated.');
    // ... then a table-lane answer lands: it is the conversation's referent now.
    await landLane(laneAnswerGated());
    expect(screen.getByText('Er zijn 5 dingen.')).toBeTruthy();

    const args = await askNext('En voor vrouwen?');
    expect(args[0]).toBe('En voor vrouwen?');
    expect(args[2]).toBeNull(); // the stale curated context is not sent
    expect(args[4]).toBe(12); // the thread the job attached
    expect(args[5]).toBe(41);
    expect(args).toHaveLength(6);
  });

  it('a lane refusal never becomes the link: the next question sends none', async () => {
    renderChat({ onThreadId: vi.fn() });
    await landLane(laneRefusalGated());
    const args = await askNext('En voor vrouwen?');
    expect(args).toHaveLength(5);
  });

  it('a lane button question never becomes the link either', async () => {
    renderChat({ onThreadId: vi.fn() });
    await landLane(laneQuestionGated());
    // R13: typed text that matches nothing goes on as a fresh question.
    replyToTableLane.mockResolvedValue({ kind: 'no_match' });
    const args = await askNext('Iets heel anders');
    expect(args).toHaveLength(5);
  });

  it('any newer turn clears the link: after a curated answer, no link is sent', async () => {
    renderChat({ onThreadId: vi.fn() });
    await landLane(laneAnswerGated());
    const first = await askNext('En voor vrouwen?');
    expect(first[5]).toBe(41);
    await screen.findByText('Volgend antwoord.');
    const second = await askNext('En in 2020?');
    expect(second).toHaveLength(5);
  });

  it('a chat that is not thread-aware never sends a link', async () => {
    renderChat();
    await landLane(laneAnswerGated());
    const args = await askNext('En voor vrouwen?');
    expect(args).toHaveLength(3);
  });
});

// Dashboard (WP19, open-questions #68): the displayed balance moves without
// a reload, driven ONLY by numbers the server already returned -- the gate's
// own netCost on an 'ok' outcome, the refusal's own balance on
// 'insufficient_credits'. Integration-shaped on purpose: a real Chat submit
// through the mocked Server Actions must move the real AccountPanel.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AskOutcome } from '../app/actions.ts';
import type { GatedResponse } from '../backend/billing/index.ts';
import type { ComposedResponse } from '../backend/answer/respond/types.ts';
import { fakeAnswerResponse } from '../test/fake-answer.ts';
import { Dashboard } from './dashboard.tsx';

Element.prototype.scrollIntoView = vi.fn();

const { askQuestion, replyToClarification } = vi.hoisted(() => ({
  askQuestion: vi.fn<(question: string, requestId: string, rawContext?: unknown) => Promise<AskOutcome>>(),
  replyToClarification: vi.fn<(pending: unknown, reply: string, requestId: string) => Promise<AskOutcome>>(),
}));
vi.mock('../app/actions.ts', () => ({
  askQuestion,
  replyToClarification,
}));

afterEach(() => {
  cleanup();
  askQuestion.mockReset();
  replyToClarification.mockReset();
});

function outcome(gated: GatedResponse): AskOutcome {
  return { gated, context: null };
}

/** Same documented narrow-cast discipline as chat.test.tsx, via the shared
 * WP20 fixture (chat.tsx now also reads answer.body + result fields for the
 * citation/card). */
function fakeAnswer(text: string, netCost: number): GatedResponse {
  return {
    kind: 'ok',
    auditId: 1,
    netCost,
    response: fakeAnswerResponse({ body: text }) as ComposedResponse,
  };
}

async function submit(text: string) {
  fireEvent.change(screen.getByPlaceholderText('Stel een vraag…'), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Verstuur' }));
  await screen.findByText(text);
}

function renderDashboard(initialBalance: number) {
  return render(
    <Dashboard
      initialBalance={initialBalance}
      simplePrice={20}
      clarificationPrice={10}
      signupGrantCredits={100}
      history={<div data-testid="history-slot" />}
    />,
  );
}

const WARNING = 'Je saldo is bijna op — er is nog genoeg voor één vraag.';

describe('Dashboard — live balance (#68)', () => {
  it('decrements the displayed balance by the gate\'s own netCost after an answer', async () => {
    askQuestion.mockResolvedValue(outcome(fakeAnswer('Nederland telt 18.044.027 inwoners.', 20)));
    renderDashboard(100);
    expect(screen.getByText('100 credits')).toBeInTheDocument();

    await submit('Hoeveel inwoners heeft Nederland?');
    await screen.findByText('Nederland telt 18.044.027 inwoners.');
    expect(screen.getByText('80 credits')).toBeInTheDocument();
    expect(screen.queryByText('100 credits')).toBeNull();
  });

  it('leaves the balance unchanged on a netCost of 0 (a fully refunded refusal)', async () => {
    askQuestion.mockResolvedValue(outcome(fakeAnswer('Dat kan ik niet beantwoorden.', 0)));
    renderDashboard(100);
    await submit('Wordt het morgen druk?');
    await screen.findByText('Dat kan ik niet beantwoorden.');
    expect(screen.getByText('100 credits')).toBeInTheDocument();
  });

  it('syncs the display to the server-reported balance on insufficient_credits', async () => {
    // A second tab spent the credits: the display still says 100, the server
    // knows better -- the refusal's own reported number wins.
    askQuestion.mockResolvedValue(outcome({ kind: 'insufficient_credits', balance: 5, required: 20 }));
    renderDashboard(100);
    await submit('Wat was de inflatie in 2024?');
    await screen.findByText(/5 over, 20 nodig/);
    expect(screen.getByText('5 credits')).toBeInTheDocument();
  });

  it('renders the server-rendered history slot untouched', () => {
    renderDashboard(100);
    expect(screen.getByTestId('history-slot')).toBeInTheDocument();
  });

  // Adversarial-review finding: the deliberate no-op kinds were untested --
  // a probe that zeroed the balance on these kinds passed every test.
  // Nothing was charged and no balance was reported: the display must not move.
  for (const gated of [{ kind: 'unauthenticated' }, { kind: 'duplicate_request' }] as const) {
    it(`leaves the balance untouched on kind "${gated.kind}"`, async () => {
      askQuestion.mockResolvedValue(outcome(gated));
      renderDashboard(100);
      await submit('Wat was de inflatie in 2024?');
      expect(screen.getByText('100 credits')).toBeInTheDocument();
    });
  }
});

describe('Dashboard — the pre-send cost line tracks the LIVE balance (#82 x #68, WP20)', () => {
  it('moves the saldo in the cost line after a charge, without a reload', async () => {
    askQuestion.mockResolvedValue(outcome(fakeAnswer('Nederland telt 18.044.027 inwoners.', 20)));
    renderDashboard(100);
    expect(screen.getByText(/saldo: 100 credits/)).toBeInTheDocument();

    await submit('Hoeveel inwoners heeft Nederland?');
    await screen.findByText('Nederland telt 18.044.027 inwoners.');
    expect(screen.getByText(/saldo: 80 credits/)).toBeInTheDocument();
    expect(screen.queryByText(/saldo: 100 credits/)).toBeNull();
  });
});

describe('Dashboard — the warning reacts to the LIVE balance (#69 x #68)', () => {
  it('appears without a reload once a charge drops the balance into the warning range', async () => {
    askQuestion.mockResolvedValue(outcome(fakeAnswer('Nederland telt 18.044.027 inwoners.', 20)));
    renderDashboard(45);
    expect(screen.queryByText(WARNING)).toBeNull();

    await submit('Hoeveel inwoners heeft Nederland?');
    await screen.findByText('Nederland telt 18.044.027 inwoners.');
    // 45 - 20 = 25: inside [20, 40).
    expect(screen.getByText('25 credits')).toBeInTheDocument();
    expect(screen.getByText(WARNING)).toBeInTheDocument();
  });
});

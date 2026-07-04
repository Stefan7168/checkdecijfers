// WP13 (ADR 020): the chat must render the billing gate's non-'ok'
// GatedResponse kinds as distinct messages — never via the generic
// try/catch (those are normal return values, not exceptions).
// WP15 (ADR 021): askQuestion/replyToClarification now return an AskOutcome
// ({ gated, context }), not a bare GatedResponse — the chat must hold the
// context across turns and thread it back as askQuestion's third argument.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AskOutcome } from '../app/actions.ts';
import type { GatedResponse } from '../backend/billing/index.ts';
import type { ConversationContext } from '../backend/answer/context/index.ts';
import type { ComposedResponse } from '../backend/answer/respond/types.ts';
import { fakeAnswerResponse, fakeCell } from '../test/fake-answer.ts';
import { Chat } from './chat.tsx';

// jsdom does not implement scrollIntoView (pre-existing chat.tsx effect,
// unrelated to WP13) — stubbed here rather than in the shared setup file,
// same scoping choice chart.test.tsx makes for ResizeObserver.
Element.prototype.scrollIntoView = vi.fn();

// Typed explicitly against the real AskOutcome/GatedResponse shapes
// (adversarial-review finding, WP13; kept for WP15's new return shape):
// web/tsconfig.json includes *.test.tsx in typecheck, and even so, an
// untyped `vi.fn()` mock's `mockResolvedValue({...})` argument is never
// checked against the real return type unless the mock itself is typed — a
// field-name typo (e.g. `creditsLeft` instead of `balance`, or `response`
// instead of `gated`) would pass both `web:typecheck` and, if chat.tsx
// happened not to render the mismatched field, `web:test` too. Both gaps
// stay closed here: the mock is pinned to AskOutcome.
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

/** Wraps a GatedResponse into the AskOutcome shape, with no context —
 * the common case for the pre-existing gated-branch tests below (none of
 * them exercise WP15 context propagation). */
function outcome(gated: GatedResponse, context: ConversationContext | null = null): AskOutcome {
  return { gated, context };
}

async function submit(text: string) {
  fireEvent.change(screen.getByPlaceholderText('Stel een vraag…'), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Verstuur' }));
  // Let the pending promise from askQuestion resolve.
  await screen.findByText(text);
}

/** A real ComposedAnswer/ValidatedResult has many more fields than chat.tsx
 * ever reads (since WP20: `.text`, `.chart`, `answer.body` and the
 * result fields citation/stat-card extraction touch) — the shared
 * fake-answer fixture keeps that narrow read-surface honest with one
 * documented, isolated cast, rather than leaving every GatedResponse literal
 * in the test body untyped (the exact gap the WP13 review found: an untyped
 * mock lets a field-name typo on the kinds that DON'T need this cast —
 * unauthenticated / duplicate_request / insufficient_credits, all plain
 * scalar shapes — pass silently. Those three stay fully typed against
 * GatedResponse above; only the envelope, deliberately, does not.) */
function fakeAnswer(text: string, netCost = 20): GatedResponse {
  return {
    kind: 'ok',
    auditId: 1,
    netCost,
    response: fakeAnswerResponse({ body: text }) as ComposedResponse,
  };
}

/** Minimal clarification 'ok' outcome — chat.tsx reads kind/text/pending. */
function fakeClarification(text: string, netCost = 10): GatedResponse {
  return {
    kind: 'ok',
    auditId: 2,
    netCost,
    response: { kind: 'clarification', text, pending: { questionNl: text } } as unknown as ComposedResponse,
  };
}

/** A minimal, registry-shaped ConversationContext for testing propagation
 * only — chat.tsx never inspects its fields, only holds and forwards the
 * object, so the exact values are arbitrary but the shape is pinned to the
 * real type (same discipline as fakeAnswer above). */
function fakeContext(topicKey = 'bevolking'): ConversationContext {
  return {
    version: 1,
    topicKey,
    regions: null,
    period: { kind: 'year', year: 2024 },
    derivation: 'none',
  };
}

describe('Chat — GatedResponse branches', () => {
  it('shows a sign-in prompt for kind "unauthenticated", never the generic error', async () => {
    askQuestion.mockResolvedValue(outcome({ kind: 'unauthenticated' }));
    render(<Chat />);
    await submit('Hoeveel inwoners heeft Nederland?');
    expect(await screen.findByText(/Log in via \/login/)).toBeInTheDocument();
    expect(screen.queryByText('Er ging iets mis bij het ophalen van het antwoord. Probeer het opnieuw.')).toBeNull();
  });

  it('shows a wait message for kind "duplicate_request"', async () => {
    askQuestion.mockResolvedValue(outcome({ kind: 'duplicate_request' }));
    render(<Chat />);
    await submit('Wat was de inflatie in 2024?');
    expect(await screen.findByText(/al verwerkt/)).toBeInTheDocument();
  });

  it('shows the balance and required credits for kind "insufficient_credits"', async () => {
    askQuestion.mockResolvedValue(outcome({ kind: 'insufficient_credits', balance: 0, required: 1 }));
    render(<Chat />);
    await submit('Wat was de inflatie in 2024?');
    expect(await screen.findByText(/0 over, 1 nodig/)).toBeInTheDocument();
  });

  it('renders the real answer text for kind "ok" (existing behavior, unaffected)', async () => {
    askQuestion.mockResolvedValue(outcome(fakeAnswer('Nederland telt 18.044.027 inwoners.')));
    render(<Chat />);
    await submit('Hoeveel inwoners heeft Nederland?');
    expect(await screen.findByText('Nederland telt 18.044.027 inwoners.')).toBeInTheDocument();
  });

  it('shows the netCost exactly once, bound to the assistant message — never on the user message', async () => {
    askQuestion.mockResolvedValue(outcome(fakeAnswer('Nederland telt 18.044.027 inwoners.', 20)));
    render(<Chat />);
    await submit('Hoeveel inwoners heeft Nederland?');
    // Exactly one caption in the whole document (the WP8 lesson: membership
    // without binding lets a caption render on every message and still pass).
    const captions = await screen.findAllByText('20 credits');
    expect(captions).toHaveLength(1);
    // ...and it sits inside the assistant's (left-aligned) message block, as
    // a sibling of the answer bubble — not inside the user's block.
    const assistantBlock = screen.getByText('Nederland telt 18.044.027 inwoners.').closest('.text-left');
    expect(assistantBlock).not.toBeNull();
    expect(assistantBlock).toContainElement(captions[0]!);
  });

  it('shows no cost caption for a non-"ok" gated outcome', async () => {
    askQuestion.mockResolvedValue(outcome({ kind: 'duplicate_request' }));
    render(<Chat />);
    await submit('Wat was de inflatie in 2024?');
    expect(await screen.findByText(/al verwerkt/)).toBeInTheDocument();
    expect(screen.queryByText(/credits$/)).toBeNull();
  });
});

describe('Chat — WP20 citation copy (#78)', () => {
  it('offers "Kopieer als citaat" under an answer and copies the built citation', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    askQuestion.mockResolvedValue(outcome(fakeAnswer('Nederland telt 18.044.027 inwoners.')));
    render(<Chat />);
    await submit('Hoeveel inwoners heeft Nederland?');

    fireEvent.click(await screen.findByRole('button', { name: 'Kopieer als citaat' }));
    expect(await screen.findByText('Gekopieerd!')).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith(
      'Nederland telt 18.044.027 inwoners. (CBS StatLine, tabel 86141NED, gesynchroniseerd 3 juli 2026)',
    );
  });

  it('offers no citation button on a non-answer (clarification) message', async () => {
    askQuestion.mockResolvedValue(outcome(fakeClarification('Welke gemeente bedoel je?')));
    render(<Chat />);
    await submit('Hoeveel werklozen zijn er?');
    expect(await screen.findByText('Welke gemeente bedoel je?')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Kopieer als citaat' })).toBeNull();
  });
});

describe('Chat — WP20 stat card (#80)', () => {
  it('renders the card for a single-cell answer, with the download button', async () => {
    const response = fakeAnswerResponse({
      body: 'De inflatie in 2024 was 3,3%.',
      shape: 'single',
      cells: [fakeCell()],
    });
    askQuestion.mockResolvedValue(outcome({ kind: 'ok', auditId: 1, netCost: 20, response: response as ComposedResponse }));
    render(<Chat />);
    await submit('Wat was de inflatie in 2024?');
    expect(await screen.findByText('3,3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download als afbeelding' })).toBeInTheDocument();
  });

  it('renders no card for a series answer', async () => {
    askQuestion.mockResolvedValue(outcome(fakeAnswer('De inflatie steeg van 2020 tot 2024.')));
    render(<Chat />);
    await submit('Hoe ontwikkelde de inflatie zich?');
    await screen.findByText('De inflatie steeg van 2020 tot 2024.');
    expect(screen.queryByRole('button', { name: 'Download als afbeelding' })).toBeNull();
  });
});

describe('Chat — WP20 cost transparency (#82)', () => {
  const pricing = { simple: 20, clarification: 10, balance: 100 };

  it('shows the pre-send cost line with live prices and balance', () => {
    render(<Chat pricing={pricing} />);
    expect(
      screen.getByText(
        'Een vraag kost ~20 credits · saldo: 100 credits. Stel ik eerst een verduidelijkingsvraag, dan kost die 10 credits en krijg je de rest terug.',
      ),
    ).toBeInTheDocument();
  });

  it('repeats the reply price at the clarification message itself', async () => {
    askQuestion.mockResolvedValue(outcome(fakeClarification('Welke gemeente bedoel je?')));
    render(<Chat pricing={pricing} />);
    await submit('Hoeveel werklozen zijn er?');
    expect(
      await screen.findByText('10 credits · antwoorden op de wedervraag kost ~20 credits'),
    ).toBeInTheDocument();
  });

  it('renders none of the cost surfaces without the pricing prop', async () => {
    askQuestion.mockResolvedValue(outcome(fakeClarification('Welke gemeente bedoel je?')));
    render(<Chat />);
    await submit('Hoeveel werklozen zijn er?');
    expect(screen.queryByText(/saldo/)).toBeNull();
    expect(await screen.findByText('10 credits')).toBeInTheDocument();
    expect(screen.queryByText(/wedervraag kost/)).toBeNull();
  });
});

describe('Chat — WP19 onOutcome reporting (open-questions #68)', () => {
  it('reports the gated outcome exactly once per submit, for ok and non-ok kinds alike', async () => {
    const onOutcome = vi.fn();
    const answer = fakeAnswer('Nederland telt 18.044.027 inwoners.');
    askQuestion.mockResolvedValueOnce(outcome(answer));
    askQuestion.mockResolvedValueOnce(outcome({ kind: 'insufficient_credits', balance: 5, required: 20 }));
    render(<Chat onOutcome={onOutcome} />);

    await submit('Hoeveel inwoners heeft Nederland?');
    expect(onOutcome).toHaveBeenCalledTimes(1);
    expect(onOutcome).toHaveBeenNthCalledWith(1, answer);

    await submit('Wat was de inflatie in 2024?');
    expect(onOutcome).toHaveBeenCalledTimes(2);
    expect(onOutcome).toHaveBeenNthCalledWith(2, { kind: 'insufficient_credits', balance: 5, required: 20 });
  });

  it('works without onOutcome (the prop is optional; existing call sites unaffected)', async () => {
    askQuestion.mockResolvedValue(outcome(fakeAnswer('Nederland telt 18.044.027 inwoners.')));
    render(<Chat />);
    await submit('Hoeveel inwoners heeft Nederland?');
    expect(await screen.findByText('Nederland telt 18.044.027 inwoners.')).toBeInTheDocument();
  });
});

describe('Chat — WP15 conversation context propagation (ADR 021)', () => {
  it('sends the context from a prior "ok" outcome as the next askQuestion call', async () => {
    const context = fakeContext();
    askQuestion.mockResolvedValueOnce(outcome(fakeAnswer('Nederland telt 18.044.027 inwoners.'), context));
    askQuestion.mockResolvedValueOnce(outcome(fakeAnswer('Rotterdam telt 656.050 inwoners.')));
    render(<Chat />);

    await submit('Hoeveel inwoners heeft Nederland?');
    expect(askQuestion).toHaveBeenNthCalledWith(1, 'Hoeveel inwoners heeft Nederland?', expect.any(String), null);

    await submit('En Rotterdam?');
    expect(askQuestion).toHaveBeenNthCalledWith(2, 'En Rotterdam?', expect.any(String), context);
  });

  it('leaves the held context in place when an "ok" outcome carries context null', async () => {
    const context = fakeContext();
    askQuestion.mockResolvedValueOnce(outcome(fakeAnswer('Nederland telt 18.044.027 inwoners.'), context));
    // A smalltalk/refusal detour: 'ok' but no honest referent (ADR 021).
    askQuestion.mockResolvedValueOnce(outcome(fakeAnswer('Hallo! Stel gerust een vraag over CBS-cijfers.'), null));
    askQuestion.mockResolvedValueOnce(outcome(fakeAnswer('Rotterdam telt 656.050 inwoners.')));
    render(<Chat />);

    await submit('Hoeveel inwoners heeft Nederland?');
    await submit('Hoi!');
    expect(askQuestion).toHaveBeenNthCalledWith(2, 'Hoi!', expect.any(String), context);

    await submit('En Rotterdam?');
    // Still the FIRST context — the null from turn 2 never overwrote it.
    expect(askQuestion).toHaveBeenNthCalledWith(3, 'En Rotterdam?', expect.any(String), context);
  });

  it('leaves the held context unchanged on a non-"ok" gated outcome (e.g. insufficient_credits)', async () => {
    const context = fakeContext();
    askQuestion.mockResolvedValueOnce(outcome(fakeAnswer('Nederland telt 18.044.027 inwoners.'), context));
    askQuestion.mockResolvedValueOnce(outcome({ kind: 'insufficient_credits', balance: 0, required: 1 }));
    askQuestion.mockResolvedValueOnce(outcome(fakeAnswer('Rotterdam telt 656.050 inwoners.')));
    render(<Chat />);

    await submit('Hoeveel inwoners heeft Nederland?');
    await submit('Wat was de inflatie in 2024?');
    expect(await screen.findByText(/0 over, 1 nodig/)).toBeInTheDocument();
    expect(askQuestion).toHaveBeenNthCalledWith(2, 'Wat was de inflatie in 2024?', expect.any(String), context);

    await submit('En Rotterdam?');
    // Still the FIRST context — the gated non-'ok' outcome changed nothing.
    expect(askQuestion).toHaveBeenNthCalledWith(3, 'En Rotterdam?', expect.any(String), context);
  });
});

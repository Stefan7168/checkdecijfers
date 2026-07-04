// WP13 (ADR 020): the chat must render the billing gate's non-'ok'
// GatedResponse kinds as distinct messages — never via the generic
// try/catch (those are normal return values, not exceptions).
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GatedResponse } from '../backend/billing/index.ts';
import type { ComposedResponse } from '../backend/answer/respond/types.ts';
import { Chat } from './chat.tsx';

// jsdom does not implement scrollIntoView (pre-existing chat.tsx effect,
// unrelated to WP13) — stubbed here rather than in the shared setup file,
// same scoping choice chart.test.tsx makes for ResizeObserver.
Element.prototype.scrollIntoView = vi.fn();

// Typed explicitly against the real GatedResponse union (adversarial-review
// finding, WP13): web/tsconfig.json used to exclude *.test.tsx from
// typecheck entirely, and even without that, an untyped `vi.fn()` mock's
// `mockResolvedValue({...})` argument was never checked against the real
// return type — a field-name typo (e.g. `creditsLeft` instead of `balance`)
// passed both `web:typecheck` and, if chat.tsx happened not to render the
// mismatched field, `web:test` too. Both gaps are now closed: test files are
// typechecked (tsconfig.json), and this mock is pinned to GatedResponse.
const { askQuestion } = vi.hoisted(() => ({
  askQuestion: vi.fn<(question: string, requestId: string) => Promise<GatedResponse>>(),
}));
vi.mock('../app/actions.ts', () => ({
  askQuestion,
  replyToClarification: vi.fn(),
}));

afterEach(() => {
  cleanup();
  askQuestion.mockReset();
});

async function submit(text: string) {
  fireEvent.change(screen.getByPlaceholderText('Stel een vraag…'), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Verstuur' }));
  // Let the pending promise from askQuestion resolve.
  await screen.findByText(text);
}

/** A real ComposedAnswer/ValidatedResult has many more fields than chat.tsx
 * ever reads (it only renders `.text` and, for an answer, `.chart`) — this
 * helper keeps that narrow read-surface honest with one documented, isolated
 * cast, rather than leaving every GatedResponse literal in the test body
 * untyped (the exact gap the WP13 review found: an untyped mock lets a
 * field-name typo on the kinds that DON'T need this cast — unauthenticated /
 * duplicate_request / insufficient_credits, all plain scalar shapes — pass
 * silently. Those three stay fully typed against GatedResponse above; only
 * this one, deliberately, does not.) */
function fakeAnswer(text: string): GatedResponse {
  return {
    kind: 'ok',
    auditId: 1,
    response: { kind: 'answer', text, chart: null } as unknown as ComposedResponse,
  };
}

describe('Chat — GatedResponse branches', () => {
  it('shows a sign-in prompt for kind "unauthenticated", never the generic error', async () => {
    askQuestion.mockResolvedValue({ kind: 'unauthenticated' });
    render(<Chat />);
    await submit('Hoeveel inwoners heeft Nederland?');
    expect(await screen.findByText(/Log in via \/login/)).toBeInTheDocument();
    expect(screen.queryByText('Er ging iets mis bij het ophalen van het antwoord. Probeer het opnieuw.')).toBeNull();
  });

  it('shows a wait message for kind "duplicate_request"', async () => {
    askQuestion.mockResolvedValue({ kind: 'duplicate_request' });
    render(<Chat />);
    await submit('Wat was de inflatie in 2024?');
    expect(await screen.findByText(/al verwerkt/)).toBeInTheDocument();
  });

  it('shows the balance and required credits for kind "insufficient_credits"', async () => {
    askQuestion.mockResolvedValue({ kind: 'insufficient_credits', balance: 0, required: 1 });
    render(<Chat />);
    await submit('Wat was de inflatie in 2024?');
    expect(await screen.findByText(/0 over, 1 nodig/)).toBeInTheDocument();
  });

  it('renders the real answer text for kind "ok" (existing behavior, unaffected)', async () => {
    askQuestion.mockResolvedValue(fakeAnswer('Nederland telt 18.044.027 inwoners.'));
    render(<Chat />);
    await submit('Hoeveel inwoners heeft Nederland?');
    expect(await screen.findByText('Nederland telt 18.044.027 inwoners.')).toBeInTheDocument();
  });
});

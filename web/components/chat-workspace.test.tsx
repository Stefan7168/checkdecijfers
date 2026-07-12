// WP135 (ADR 033 D4/⟨A6⟩): the workspace-mode behaviors chat.tsx gained.
//  - Test 7: the message ENVELOPE (body, attribution chip, cost caption,
//    citation/CSV buttons, suggestion chips, web section LAST-in-bubble) renders
//    byte-identically in dock mode vs inline mode vs today; only the VISUAL
//    moves (an inline card ⇄ an "in het paneel" reference chip), rendered once.
//  - Test 13: a reply binds to the thread captured at question time; a thread
//    switch (loadNonce bump) clears the pending clarification.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AskOutcome } from '../app/actions.ts';
import type { GatedResponse } from '../backend/billing/index.ts';
import type { ConversationContext } from '../backend/answer/context/index.ts';
import type { ComposedResponse } from '../backend/answer/respond/types.ts';
import type { WebSection } from '../backend/websearch/types.ts';
import { fakeAnswerResponse, fakeCell } from '../test/fake-answer.ts';
import { Chat } from './chat.tsx';

Element.prototype.scrollIntoView = vi.fn();

const { askQuestion, replyToClarification, submitAnswerFeedback } = vi.hoisted(() => ({
  askQuestion:
    vi.fn<(question: string, requestId: string, rawContext?: unknown, rawSelection?: unknown, rawThreadId?: unknown) => Promise<AskOutcome>>(),
  replyToClarification:
    vi.fn<(pending: unknown, reply: string, requestId: string, rawSelection?: unknown, rawThreadId?: unknown) => Promise<AskOutcome>>(),
  submitAnswerFeedback:
    vi.fn<(auditId: number, verdict: 'up' | 'down', feedbackText?: string) => Promise<{ ok: boolean }>>(),
}));
vi.mock('../app/actions.ts', () => ({ askQuestion, replyToClarification, submitAnswerFeedback }));

afterEach(() => {
  cleanup();
  askQuestion.mockReset();
  replyToClarification.mockReset();
  submitAnswerFeedback.mockReset();
});

function outcome(
  gated: GatedResponse,
  context: ConversationContext | null = null,
  threadId: number | null = null,
): AskOutcome {
  return { gated, context, threadId };
}

const WEB_HEADER = 'Van het web (niet door checkdecijfers geverifieerd)';
const SUGGESTION = 'Wat was de inflatie in 2025?';
const BODY = 'De inflatie in 2024 was 3,3%.';
const ATTRIBUTION = /Bron: CBS StatLine, tabel 86141NED/;

function okSection(): WebSection {
  return {
    status: 'ok',
    findings: [{ text: 'Een webbevinding.', citations: [{ url: 'https://www.example.nl/a', title: null }] }],
    model: 'claude-sonnet-5',
    searches: 1,
    usage: { inputTokens: 10, outputTokens: 5 },
    promptVersion: 1,
  };
}

/** A single-cell (stat-card) answer carrying a suggestion chip and a web
 * section — the full envelope surface plus a dockable visual. */
function statCardAnswer(): GatedResponse {
  const response = {
    ...fakeAnswerResponse({ body: BODY, shape: 'single', cells: [fakeCell()], suggestions: [SUGGESTION] }),
    webSection: okSection(),
  } as unknown as ComposedResponse;
  return { kind: 'ok', auditId: 1, netCost: 20, response };
}

function fakeClarification(text: string): GatedResponse {
  return {
    kind: 'ok',
    auditId: 2,
    netCost: 10,
    response: { kind: 'clarification', text, pending: { questionNl: text } } as unknown as ComposedResponse,
  };
}

function fakeAnswer(text: string): GatedResponse {
  return { kind: 'ok', auditId: 1, netCost: 20, response: fakeAnswerResponse({ body: text }) as ComposedResponse };
}

async function submit(text: string, placeholder = 'Stel een vraag…') {
  fireEvent.change(screen.getByPlaceholderText(placeholder), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Verstuur' }));
  await screen.findByText(text);
}

/** The envelope's rendered surface, order-preserving — compared across modes. */
function envelopeSignature(): string[] {
  return [
    screen.getByText(BODY).textContent ?? '',
    screen.getByText(ATTRIBUTION).textContent ?? '',
    screen.getByText('20 credits').textContent ?? '',
    screen.getByRole('button', { name: 'Kopieer als citaat' }).textContent ?? '',
    screen.getByRole('button', { name: 'Download als CSV' }).textContent ?? '',
    screen.getByRole('button', { name: SUGGESTION }).textContent ?? '',
    screen.getByText(WEB_HEADER).textContent ?? '',
    screen.getByText('Een webbevinding.').textContent ?? '',
  ];
}

describe('Chat — WP135 envelope byte-identity (dock vs inline vs today)', () => {
  it('today (no dock props): full envelope + inline card, no reference chip', async () => {
    askQuestion.mockResolvedValue(outcome(statCardAnswer()));
    render(<Chat />);
    await submit('Wat was de inflatie in 2024?');
    await screen.findByText(BODY);
    expect(screen.getByRole('button', { name: 'Download als afbeelding' })).toBeInTheDocument(); // inline card
    expect(screen.queryByText(/in het paneel/)).toBeNull();
    expect(screen.getByText(WEB_HEADER)).toBeInTheDocument();
  });

  it('dock mode: the visual becomes a reference chip (rendered once), envelope unchanged', async () => {
    askQuestion.mockResolvedValue(outcome(statCardAnswer()));
    render(<Chat dockMode onThreadId={vi.fn()} onVisualsChange={vi.fn()} />);
    await submit('Wat was de inflatie in 2024?');
    await screen.findByText(BODY);
    // The inline card is GONE; a single reference chip stands in for it.
    expect(screen.queryByRole('button', { name: 'Download als afbeelding' })).toBeNull();
    expect(screen.getByText(/Kaart in het paneel/)).toBeInTheDocument();
    // The envelope (incl. the web section) still renders.
    expect(screen.getByText(WEB_HEADER)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: SUGGESTION })).toBeInTheDocument();
  });

  it('the envelope signature is IDENTICAL across today, inline (dockMode false), and dock', async () => {
    askQuestion.mockResolvedValue(outcome(statCardAnswer()));

    render(<Chat />);
    await submit('Wat was de inflatie in 2024?');
    const today = envelopeSignature();
    cleanup();

    render(<Chat dockMode={false} onThreadId={vi.fn()} onVisualsChange={vi.fn()} />);
    await submit('Wat was de inflatie in 2024?');
    const inline = envelopeSignature();
    cleanup();

    render(<Chat dockMode onThreadId={vi.fn()} onVisualsChange={vi.fn()} />);
    await submit('Wat was de inflatie in 2024?');
    const dock = envelopeSignature();

    expect(inline).toEqual(today);
    expect(dock).toEqual(today);
  });

  it('the web section is LAST in the bubble in every mode (ADR 032)', async () => {
    askQuestion.mockResolvedValue(outcome(statCardAnswer()));
    render(<Chat dockMode onThreadId={vi.fn()} onVisualsChange={vi.fn()} />);
    await submit('Wat was de inflatie in 2024?');
    const block = screen.getByText(BODY).closest('.text-left')!;
    const text = block.textContent ?? '';
    // Attribution → suggestion chip → web section, in that DOM order.
    expect(text.indexOf('Bron: CBS StatLine')).toBeLessThan(text.indexOf(SUGGESTION));
    expect(text.indexOf(SUGGESTION)).toBeLessThan(text.indexOf(WEB_HEADER));
  });

  it('activating the reference chip reports its visual id to the workspace', async () => {
    const onActivate = vi.fn();
    askQuestion.mockResolvedValue(outcome(statCardAnswer()));
    render(<Chat dockMode onThreadId={vi.fn()} onVisualsChange={vi.fn()} onActivateVisual={onActivate} />);
    await submit('Wat was de inflatie in 2024?');
    fireEvent.click(screen.getByText(/Kaart in het paneel/));
    // The assistant message is index 1 (user is 0) ⇒ visual-1.
    expect(onActivate).toHaveBeenCalledWith('visual-1');
  });
});

describe('Chat — WP135 ⟨A6⟩ reply-thread binding', () => {
  it('captures the thread at question time and sends it as the reply rawThreadId', async () => {
    askQuestion.mockResolvedValue(outcome(fakeClarification('Welke periode?'), null, 5));
    replyToClarification.mockResolvedValue(outcome(fakeAnswer('In 2024 was het 3,3%.'), null, 5));
    render(<Chat onThreadId={vi.fn()} onVisualsChange={vi.fn()} />);
    await submit('Wat was de inflatie?');
    await screen.findByText('Welke periode?');
    fireEvent.change(screen.getByPlaceholderText('Welke periode?'), { target: { value: '2024' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verstuur' }));
    await screen.findByText('In 2024 was het 3,3%.');
    // 5th arg is the CAPTURED thread (5), not any newly-active sidebar thread.
    expect(replyToClarification).toHaveBeenCalledWith(expect.anything(), '2024', expect.any(String), undefined, 5);
  });

  it('a thread switch (loadNonce bump) clears the pending clarification', async () => {
    askQuestion.mockResolvedValue(outcome(fakeClarification('Welke periode?'), null, 5));
    const { rerender } = render(
      <Chat onThreadId={vi.fn()} onVisualsChange={vi.fn()} loadNonce={0} initialMessages={[]} initialContext={null} threadId={null} />,
    );
    await submit('Wat was de inflatie?');
    await screen.findByText('Welke periode?');
    expect(screen.getByPlaceholderText('Welke periode?')).toBeInTheDocument();
    // Simulate a sidebar switch: the workspace seeds the loaded thread + bumps
    // loadNonce, which resets Chat (pending cleared, ⟨A6⟩).
    rerender(
      <Chat onThreadId={vi.fn()} onVisualsChange={vi.fn()} loadNonce={1} initialMessages={[]} initialContext={null} threadId={99} />,
    );
    expect(await screen.findByPlaceholderText('Stel een vraag…')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Welke periode?')).toBeNull();
  });
});

describe('Chat — WP135 the dock is off below lg (mobile: no regression)', () => {
  it('renders visuals INLINE when dockMode is false, exactly as today', async () => {
    askQuestion.mockResolvedValue(outcome(statCardAnswer()));
    render(<Chat dockMode={false} onThreadId={vi.fn()} onVisualsChange={vi.fn()} />);
    await submit('Wat was de inflatie in 2024?');
    expect(screen.getByRole('button', { name: 'Download als afbeelding' })).toBeInTheDocument();
    expect(screen.queryByText(/in het paneel/)).toBeNull();
  });
});

// The workspace reports its dockable visuals so it can render the dock tabs.
describe('Chat — WP135 onVisualsChange reporting', () => {
  it('reports one card visual for a stat-card answer', async () => {
    const onVisuals = vi.fn();
    askQuestion.mockResolvedValue(outcome(statCardAnswer()));
    render(<Chat dockMode onThreadId={vi.fn()} onVisualsChange={onVisuals} />);
    await submit('Wat was de inflatie in 2024?');
    await screen.findByText(BODY); // wait for the assistant message + its effect
    // Last call reflects the settled messages.
    const last = onVisuals.mock.calls.at(-1)![0];
    expect(last).toHaveLength(1);
    expect(last[0].kind).toBe('card');
    expect(last[0].label).toBe('Kaart 1');
  });
});

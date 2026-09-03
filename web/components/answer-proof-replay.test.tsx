// Review round 2 (session 74) of PR #123: the proof panel through the REAL
// resume path — a stored thread row → replayParts (src/threads/replay.ts) →
// assembleMessages (the SAME builders as the live path) → <Chat
// initialMessages> → the trigger renders and opens over the replayed
// envelope. replay-assemble.test.ts proves the builder is deterministic and
// chat.test.tsx proves the LIVE trigger; nothing exercised the resumed render
// end to end (a HIGH-review coverage finding).
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ComposedResponse } from '../backend/answer/respond/types.ts';
import type { ThreadRow } from '../backend/threads/index.ts';
import { replayParts } from '../backend/threads/replay.ts';
import { assembleMessages } from '../lib/replay-assemble.ts';
import { fakeAnswerResponse, fakeCell } from '../test/fake-answer.ts';
import { Chat } from './chat.tsx';

// jsdom does not implement scrollIntoView (chat.tsx effect) — same stub as
// chat.test.tsx.
Element.prototype.scrollIntoView = vi.fn();

// Chat imports the Server Actions module; nothing here ever calls them.
vi.mock('../app/actions.ts', () => ({
  askQuestion: vi.fn(),
  replyToClarification: vi.fn(),
  submitAnswerFeedback: vi.fn(),
}));

afterEach(() => cleanup());

function row(response: ComposedResponse): ThreadRow {
  return {
    id: 42,
    kind: 'answer',
    question: 'Wat was de inflatie in 2024?',
    finalText: response.text,
    replyText: null,
    createdAt: '2026-07-12T10:00:00.000Z',
    creditsCharged: 20,
    response,
  };
}

describe('Chat — #70/#79/#89 on a RESUMED thread', () => {
  it('renders the trigger for a replayed answer and opens the panel over the replayed envelope', () => {
    const response = fakeAnswerResponse({
      body: 'De inflatie in 2024 was 3,3%.',
      shape: 'single',
      cells: [fakeCell()],
    }) as unknown as ComposedResponse;
    const initialMessages = assembleMessages(replayParts([row(response)]));
    expect(initialMessages).toHaveLength(2);
    render(<Chat initialMessages={initialMessages} />);

    const trigger = screen.getByRole('button', { name: 'Bewijs dit cijfer' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const region = screen.getByRole('region', { name: 'Onderbouwing van dit antwoord' });
    expect(region).toHaveTextContent('Gelezen: 1 cel uit tabel 86141NED: Inflatie (CPI), 2024 → 3,3%.');
    expect(region).toHaveTextContent('Geen bewerking toegepast: het antwoord is de waarde uit de cel.');
    expect(region).toHaveTextContent('Gebruikte lezing:');
  });
});

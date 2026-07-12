// WP135 (ADR 033 D3, ⟨A3⟩/⟨A7⟩): the web-side replay assembly. Pins that a
// replayed stat-card answer reconstructs card/citation/csv/creditsCharged
// IDENTICALLY to a live render (the SAME builders over the SAME envelope) and
// yields the SAME dock tab; that a meta refusal reclassifies to 'info' via the
// shared helper; and that a redacted row becomes ONE placeholder, never a
// user+assistant pair.
import { describe, expect, it } from 'vitest';
import { REDACTED_QUESTION_TEXT } from '../backend/answer/audit/retention.ts';
import type { ThreadRow } from '../backend/threads/index.ts';
import { replayParts } from '../backend/threads/replay.ts';
import type { ComposedResponse } from '../backend/answer/respond/types.ts';
import { buildCitation } from './citation.ts';
import { buildAnswerCsv } from './csv.ts';
import { deriveVisuals } from './dock-visuals.ts';
import { assembleMessages } from './replay-assemble.ts';
import { fakeAnswerResponse, fakeCell } from '../test/fake-answer.ts';

function row(overrides: Partial<ThreadRow> & { response: ComposedResponse }): ThreadRow {
  return {
    id: 1,
    kind: 'answer',
    question: 'Wat was de inflatie in 2024?',
    finalText: overrides.response.text,
    replyText: null,
    createdAt: '2026-07-12T10:00:00.000Z',
    creditsCharged: 20,
    ...overrides,
  };
}

describe('assembleMessages — ⟨A3⟩ replay completeness (stat-card answer)', () => {
  const response = fakeAnswerResponse({
    body: 'De inflatie in 2024 was 3,3%.',
    shape: 'single',
    cells: [fakeCell()],
  }) as unknown as ComposedResponse;

  const messages = assembleMessages(replayParts([row({ id: 42, response, creditsCharged: 20 })]));
  const [userMsg, assistantMsg] = messages;

  it('emits exactly one user turn then its assistant turn', () => {
    expect(messages).toHaveLength(2);
    expect(userMsg!.role).toBe('user');
    expect(userMsg!.text).toBe('Wat was de inflatie in 2024?');
    expect(assistantMsg!.role).toBe('assistant');
    expect(assistantMsg!.kind).toBe('answer');
  });

  it('reconstructs card, citation, csv and creditsCharged identical to a live render', () => {
    expect(assistantMsg!.card).not.toBeNull();
    expect(assistantMsg!.card!.value).toBe('3,3');
    // The SAME live-path builders over the SAME envelope ⇒ byte-identical.
    expect(assistantMsg!.citation).toBe(buildCitation(response as never));
    expect(assistantMsg!.csv).toEqual(buildAnswerCsv(response as never));
    // The cost caption comes from the ledger join (creditsCharged), not the
    // envelope — recomputed on replay or it silently vanishes.
    expect(assistantMsg!.cost).toBe(20);
  });

  it('R8: replayed text is byte-equal to the stored finalText', () => {
    expect(assistantMsg!.text).toBe(response.text);
  });

  it('the answerView carries the tableId the chip deep-links to', () => {
    expect(assistantMsg!.answerView).not.toBeNull();
    expect(assistantMsg!.answerView!.tableId).toBe('86141NED');
  });

  it('feedback anchors to the audit row id', () => {
    expect(assistantMsg!.auditId).toBe(42);
  });

  it('produces the SAME dock tab a live render would (Kaart 1)', () => {
    const visuals = deriveVisuals(messages);
    expect(visuals).toHaveLength(1);
    expect(visuals[0]!.kind).toBe('card');
    expect(visuals[0]!.label).toBe('Kaart 1');
  });
});

describe('assembleMessages — ⟨A3⟩ meta refusal reclassifies to info', () => {
  it('a replayed meta refusal becomes kind "info" via the shared helper (no refusal header)', () => {
    const response = {
      kind: 'refusal',
      reason: 'meta',
      text: 'Al mijn cijfers komen rechtstreeks uit officiële tabellen van CBS StatLine.',
      webSection: null,
    } as unknown as ComposedResponse;
    const [, assistantMsg] = assembleMessages(
      replayParts([row({ kind: 'refusal', response })]),
    );
    expect(assistantMsg!.kind).toBe('info');
    expect(assistantMsg!.card).toBeNull();
    expect(assistantMsg!.citation).toBeNull();
    expect(assistantMsg!.auditId).toBeNull();
  });
});

describe('assembleMessages — ⟨A7⟩ redacted row is one placeholder', () => {
  it('a redacted row replays as ONE placeholder message, never a user+assistant pair', () => {
    const response = fakeAnswerResponse({ body: 'ooit een antwoord' }) as unknown as ComposedResponse;
    const messages = assembleMessages(
      replayParts([row({ question: REDACTED_QUESTION_TEXT, response })]),
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]!.role).toBe('redacted');
    expect(messages[0]!.text).toBe('Deze vraag is verwijderd.');
  });
});

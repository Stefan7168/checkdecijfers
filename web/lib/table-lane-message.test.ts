// Breadth step 5 (Task 6): the pure ChatMessage helpers for the table lane and
// the replay of its stored outcomes (an answer keeps its selection note; a
// button question replays as plain text with no buttons).
import { describe, expect, it } from 'vitest';
import type { ComposedResponse } from '../backend/answer/respond/types.ts';
import type { Db } from '../backend/db/types.ts';
import type { ThreadRow } from '../backend/threads/index.ts';
import { replayParts } from '../backend/threads/replay.ts';
import { fakeAnswerResponse } from '../test/fake-answer.ts';
import {
  infoChatMessage,
  tableLaneNoteOf,
  tableLaneProgressMessage,
  tableLaneQuestionOfResponse,
} from './chat-message.ts';
import { buildAnswerCopy } from './copy-answer.ts';
import { assembleMessages } from './replay-assemble.ts';

const fakeDb = { query: async () => ({ rows: [] }) } as unknown as Db;

const QUESTION = {
  dimension: 'Geslacht',
  dimensionTitle: 'Geslacht',
  options: [
    { code: 'T001038', title: 'Totaal mannen en vrouwen' },
    { code: '3000', title: 'Mannen' },
  ],
  totalOptions: 3,
};

function laneEnvelope(overrides: Record<string, unknown> = {}) {
  return { version: 1, rowId: 7, tableId: '83765NED', selectionNote: null, question: null, ...overrides };
}

function answerWithNote(note: string | null): ComposedResponse {
  return {
    ...fakeAnswerResponse({ body: 'Er zijn 5 dingen.' }),
    tableLane: laneEnvelope({ selectionNote: note }),
  } as unknown as ComposedResponse;
}

function clarificationWithQuestion(): ComposedResponse {
  return {
    kind: 'clarification',
    text: 'Welk geslacht bedoel je?',
    // The real Task 3 shape: member titles as suggestions, English chips, and a
    // stripped rescue carrier.
    suggestions: QUESTION.options.map((o) => o.title),
    pending: { questionNl: 'Welk geslacht bedoel je?', options: [], rescueOnly: true },
    english: {
      source: 'template',
      text: 'Which sex do you mean?',
      chips: QUESTION.options.map((o) => ({ label: o.title, submit: o.title })),
      untranslated: [],
    },
    tableLane: laneEnvelope({ question: QUESTION }),
  } as unknown as ComposedResponse;
}

function row(response: ComposedResponse): ThreadRow {
  return {
    id: 1,
    kind: response.kind,
    question: 'Hoeveel dingen?',
    finalText: response.text,
    replyText: null,
    createdAt: '2026-09-29T10:00:00.000Z',
    creditsCharged: 20,
    response,
  } as unknown as ThreadRow;
}

describe('table-lane ChatMessage helpers', () => {
  it('maps a table-lane answer to its selection note', () => {
    expect(tableLaneNoteOf(answerWithNote('Selectie: Geslacht: Mannen'))).toBe('Selectie: Geslacht: Mannen');
  });

  it('gives no note for an answer without one, a curated answer, or a non-answer', () => {
    expect(tableLaneNoteOf(answerWithNote(null))).toBeNull();
    expect(tableLaneNoteOf(fakeAnswerResponse({ body: 'x' }) as unknown as ComposedResponse)).toBeNull();
    expect(tableLaneNoteOf(clarificationWithQuestion())).toBeNull();
  });

  it('extracts the button question of a table-lane clarification only', () => {
    expect(tableLaneQuestionOfResponse(clarificationWithQuestion())).toEqual({ rowId: 7, question: QUESTION });
    expect(tableLaneQuestionOfResponse(answerWithNote('n'))).toBeNull();
    const plain = { kind: 'clarification', text: 'x', pending: null } as unknown as ComposedResponse;
    expect(tableLaneQuestionOfResponse(plain)).toBeNull();
  });

  it('builds the progress bubble in the fetching phase', () => {
    const message = tableLaneProgressMessage(9, 'CBS-tabel ophalen…');
    expect(message.tableLane).toEqual({ rowId: 9, phase: 'fetching' });
    expect(message.text).toBe('CBS-tabel ophalen…');
    expect(infoChatMessage('hoi').tableLane).toBeUndefined();
  });
});

describe('assembleMessages - table lane replay', () => {
  it('replays a stored table-lane answer with its selection note', async () => {
    const response = answerWithNote('Selectie: Geslacht: Mannen · Uitgangspunt: Perioden: 2024');
    const [, assistant] = await assembleMessages(replayParts([row(response)]), fakeDb);
    expect(assistant!.tableLaneNote).toBe('Selectie: Geslacht: Mannen · Uitgangspunt: Perioden: 2024');
  });

  it('replays a stored table-lane question as plain text without buttons', async () => {
    const [, assistant] = await assembleMessages(replayParts([row(clarificationWithQuestion())]), fakeDb);
    expect(assistant!.text).toBe('Welk geslacht bedoel je?');
    expect(assistant!.tableLaneQuestion ?? null).toBeNull();
    expect(assistant!.tableLane ?? null).toBeNull();
    expect(assistant!.tableLaneNote).toBeNull();
    // No generic member-title chips either (they would send a bare title as a
    // fresh question), Dutch or English.
    expect(assistant!.suggestions).toEqual([]);
    expect(assistant!.nonAnswerEnglish?.chips).toEqual([]);
    expect(assistant!.nonAnswerEnglish?.text).toBe('Which sex do you mean?');
    expect(assistant!.carrier).toBeNull();
  });

  it('keeps the English chips of an ordinary (non-lane) clarification', async () => {
    const response = {
      kind: 'clarification',
      text: 'Welk jaar?',
      suggestions: ['2023', '2024'],
      pending: null,
      english: {
        source: 'template',
        text: 'Which year?',
        chips: [{ label: '2023', submit: '2023' }],
        untranslated: [],
      },
    } as unknown as ComposedResponse;
    const [, assistant] = await assembleMessages(replayParts([row(response)]), fakeDb);
    expect(assistant!.nonAnswerEnglish?.chips).toEqual([{ label: '2023', submit: '2023' }]);
  });

  it('replays a curated answer with no note', async () => {
    const response = fakeAnswerResponse({ body: 'x' }) as unknown as ComposedResponse;
    const [, assistant] = await assembleMessages(replayParts([row(response)]), fakeDb);
    expect(assistant!.tableLaneNote).toBeNull();
  });
});

describe('buildAnswerCopy - table lane selection note', () => {
  const view = {
    body: 'Er zijn 5 dingen.',
    assumptionLine: null,
    regionSetLine: null,
    regionSeriesLine: null,
    stalenessWarning: null,
    definitionLine: null,
    alternatesLine: null,
    markingLine: null,
    attribution: 'Bron: CBS.',
    tableId: '83765NED',
    syncedAt: null,
  };

  it('copies the note after the answer lines and before the attribution', () => {
    const { text, html } = buildAnswerCopy(view, null, ['Selectie: Geslacht: Mannen']);
    expect(text).toBe('Er zijn 5 dingen.\n\nSelectie: Geslacht: Mannen\n\nBron: CBS.');
    expect(html).toContain('<p>Selectie: Geslacht: Mannen</p>');
  });

  it('is unchanged without a note', () => {
    expect(buildAnswerCopy(view, null).text).toBe('Er zijn 5 dingen.\n\nBron: CBS.');
  });
});

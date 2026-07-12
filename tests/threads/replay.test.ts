// WP135 chat workspace (ADR 033 D3): hermetic pins for src/threads/replay.ts —
// deterministic structural replay + conversation-context rebuild. Zero LLM.
//
// Pins: R8 (replayed text byte-equal to stored final_text; answerView only when
// the structural fields are present), ⟨A4⟩ (a clarification round replays as
// exactly [question, clarification, reply, outcome] — the original question
// never duplicated), ⟨A7⟩ (a redacted row is ONE placeholder, and a redacted
// 'answer' row does not crash rebuildContext — it is skipped), and rebuildContext
// determinism (equals buildConversationContext over the last eligible envelope).
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { rebuildContext, replayParts } from '../../src/threads/replay.ts';
import type { ReplayAssistantPart, ReplayUserPart } from '../../src/threads/replay.ts';
import { getThreadRows } from '../../src/threads/index.ts';
import type { ThreadRow } from '../../src/threads/index.ts';
import { buildConversationContext } from '../../src/answer/context/build.ts';
import { REDACTED_QUESTION_TEXT } from '../../src/answer/audit/retention.ts';
import type { ComposedResponse } from '../../src/answer/respond/types.ts';
import type { Db } from '../../src/db/types.ts';
import { createTestDb } from '../helpers/pglite-db.ts';

async function withDb(fn: (db: Db) => Promise<void>): Promise<void> {
  const { db, close } = await createTestDb();
  try {
    await fn(db);
  } finally {
    await close();
  }
}

/** Build a ThreadRow directly (the replay layer is a pure function of the rows
 * getThreadRows returns). `response` is a plain object cast to the envelope
 * type — replay reads fields defensively, so a narrow fixture is deliberate. */
function mkRow(over: {
  id: number;
  kind: ThreadRow['kind'];
  question: string;
  response: unknown;
  finalText?: string;
  replyText?: string | null;
  createdAt?: string;
  creditsCharged?: number | null;
}): ThreadRow {
  return {
    id: over.id,
    kind: over.kind,
    question: over.question,
    finalText: over.finalText ?? over.question,
    replyText: over.replyText ?? null,
    createdAt: over.createdAt ?? '2026-01-01T00:00:00Z',
    response: over.response as ComposedResponse,
    creditsCharged: over.creditsCharged ?? null,
  };
}

/** An answer envelope with the #115 structural fields present (body +
 * attributionLine — the zero-loss floor). */
function answerEnvelopeWithView(opts: {
  question: string;
  finalText: string;
  provisionalCell?: boolean;
  chart?: unknown;
  suggestions?: string[];
}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    kind: 'answer',
    question: opts.question,
    text: opts.finalText,
    answer: {
      schemaVersion: 1,
      source: 'template',
      body: 'Nederland telde 17,9 miljoen inwoners.',
      definitionLine: 'Definitie: inwoneraantal per 1 januari.',
      markingLine: null,
      attributionLine: 'Bron: CBS StatLine, tabel 37296ned. Licentie: CC BY 4.0.',
      text: opts.finalText,
    },
    chart: opts.chart ?? null,
    suggestions: opts.suggestions ?? [],
    stalenessWarning: null,
    result: {
      cells: [{ resultId: 'c1', provisional: opts.provisionalCell ?? false }],
    },
  };
}

/** An answer envelope whose intent yields a non-null context WITHOUT any DB
 * lookup (regions empty ⇒ buildConversationContext skips the label query). */
function answerEnvelopeWithContext(topicKey: string, year: number): Record<string, unknown> {
  return {
    schemaVersion: 1,
    kind: 'answer',
    question: `vraag over ${topicKey}`,
    text: 'antwoord',
    answer: {
      schemaVersion: 1,
      source: 'template',
      body: 'body',
      definitionLine: null,
      markingLine: null,
      attributionLine: 'Bron: CBS StatLine. Licentie: CC BY 4.0.',
      text: 'antwoord',
    },
    chart: null,
    suggestions: [],
    stalenessWarning: null,
    result: {
      cells: [{ resultId: 'c1', provisional: false }],
      intent: {
        target: { kind: 'canonical', key: topicKey },
        regions: [],
        period: { kind: 'codes', codes: [`${year}JJ00`] },
        derivation: null,
      },
    },
  };
}

const REDACTED_ENVELOPE = {
  schemaVersion: 1,
  kind: 'answer',
  question: REDACTED_QUESTION_TEXT,
  text: REDACTED_QUESTION_TEXT,
  redacted: true,
};

// ---------------------------------------------------------------------------
// replayParts
// ---------------------------------------------------------------------------

describe('replayParts — R8 + zero-loss answerView (pin 2)', () => {
  it('R8: the replayed assistant text is byte-equal to the stored final_text', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const { rows: t } = await db.query(
        'insert into chat_threads (user_id) values ($1::uuid) returning id',
        [userId],
      );
      const threadId = Number(t[0]!.id);
      const finalText = 'Nederland telde 17.900.000 inwoners op 1 januari 2024 (voorlopig cijfer).';
      await db.query(
        `insert into audit_answers
           (schema_version, user_id, source_tag, kind, question, reference_date, response, final_text,
            prompt_versions, latency_ms, thread_id)
         values (1, $1, 'user', 'answer', $2, '2026-01-01', $3::jsonb, $4, '{}'::jsonb, 100, $5)`,
        [
          userId,
          'Hoeveel inwoners heeft Nederland?',
          JSON.stringify(answerEnvelopeWithView({ question: 'Hoeveel inwoners heeft Nederland?', finalText })),
          finalText,
          threadId,
        ],
      );

      const rows = await getThreadRows(db, userId, threadId);
      const parts = replayParts(rows);
      const assistant = parts.find((p): p is ReplayAssistantPart => p.role === 'assistant')!;
      // Byte-for-byte, never re-derived.
      expect(assistant.finalText).toBe(finalText);
    });
  });

  it('answerView is populated only when body + attributionLine are present', () => {
    const withView = mkRow({
      id: 1,
      kind: 'answer',
      question: 'q',
      response: answerEnvelopeWithView({ question: 'q', finalText: 'a', provisionalCell: true }),
    });
    const bare = mkRow({
      id: 2,
      kind: 'answer',
      question: 'q2',
      response: { schemaVersion: 1, kind: 'answer', question: 'q2', text: 'blob' }, // no `answer` field
    });
    const refusal = mkRow({
      id: 3,
      kind: 'refusal',
      question: 'q3',
      response: { schemaVersion: 1, kind: 'refusal', question: 'q3', text: 'weigering', reason: 'scope' },
    });

    const [uA, aA, uB, aB, uC, aC] = replayParts([withView, bare, refusal]);
    // Answer WITH structural fields → answerView present + provisional flag set.
    expect((aA as ReplayAssistantPart).answerView).toMatchObject({
      body: 'Nederland telde 17,9 miljoen inwoners.',
      attributionLine: 'Bron: CBS StatLine, tabel 37296ned. Licentie: CC BY 4.0.',
    });
    expect((aA as ReplayAssistantPart).provisional).toBe(true);
    // Answer WITHOUT the fields → null (web falls back to the finalText blob).
    expect((aB as ReplayAssistantPart).answerView).toBeNull();
    expect((aB as ReplayAssistantPart).provisional).toBe(false);
    // Refusal → never an answerView, never provisional.
    expect((aC as ReplayAssistantPart).answerView).toBeNull();
    expect((aC as ReplayAssistantPart).provisional).toBe(false);
    // Each row emits exactly one user-turn then its assistant turn.
    expect([uA.role, aA!.role, uB.role, aB!.role, uC.role, aC!.role]).toEqual([
      'user', 'assistant', 'user', 'assistant', 'user', 'assistant',
    ]);
  });

  it('#134(a): a resumed REFUSAL row replays its retry chip — parity with the live turn (regression: replay dropped refusal suggestions)', () => {
    const answerRow = mkRow({
      id: 1,
      kind: 'answer',
      question: 'a',
      response: answerEnvelopeWithView({ question: 'a', finalText: 'a', suggestions: ['Wat was X in 2024?'] }),
    });
    // A period-coverage refusal with a stored retry chip (freshness/outside_slice
    // — what #134(a) writes) plus a clarification (no suggestions field at all).
    const refusalRow = mkRow({
      id: 2,
      kind: 'refusal',
      question: 'b',
      response: {
        schemaVersion: 1,
        kind: 'refusal',
        question: 'b',
        text: 'Zo recent heb ik de cijfers nog niet — de meest recente periode is 2025.',
        reason: 'freshness',
        suggestions: ['Wat was inflatie in 2025?'],
      },
    });
    const clarifyRow = mkRow({
      id: 3,
      kind: 'clarification',
      question: 'c',
      response: { schemaVersion: 1, kind: 'clarification', question: 'c', text: 'welke regio?', axes: ['region'], options: [] },
    });

    const [, aAnswer, , aRefusal, , aClarify] = replayParts([answerRow, refusalRow, clarifyRow]);
    // The answer chip survives resume (pre-existing behaviour, still holds).
    expect((aAnswer as ReplayAssistantPart).suggestions).toEqual(['Wat was X in 2024?']);
    // The refusal retry chip survives resume — the regression this fixes.
    expect((aRefusal as ReplayAssistantPart).suggestions).toEqual(['Wat was inflatie in 2025?']);
    // A clarification carries no suggestions field → [] (unchanged).
    expect((aClarify as ReplayAssistantPart).suggestions).toEqual([]);
  });
});

describe('replayParts — ⟨A4⟩ clarification round (pin 11)', () => {
  it('a clarification round replays as exactly [question, clarification, reply, outcome]', async () => {
    await withDb(async (db) => {
      const userId = randomUUID();
      const question = 'Hoeveel inwoners heeft de gemeente?';
      const questionNl = 'Welke gemeente bedoel je?';
      const { rows: t } = await db.query(
        'insert into chat_threads (user_id) values ($1::uuid) returning id',
        [userId],
      );
      const threadId = Number(t[0]!.id);

      // Turn 1: the clarification offering.
      await db.query(
        `insert into audit_answers
           (schema_version, user_id, source_tag, kind, question, reference_date, response, final_text,
            prompt_versions, latency_ms, thread_id, created_at)
         values (1, $1, 'user', 'clarification', $2, '2026-01-01', $3::jsonb, $4, '{}'::jsonb, 100, $5, '2026-01-01T00:00:00Z')`,
        [
          userId,
          question,
          JSON.stringify({ schemaVersion: 1, kind: 'clarification', question, text: questionNl, pending: { questionNl } }),
          questionNl,
          threadId,
        ],
      );
      // Turn 2: the reply row — its `question` column ECHOES the original
      // question (respond-audited.ts convention), reply_text carries the reply.
      await db.query(
        `insert into audit_answers
           (schema_version, user_id, source_tag, kind, question, reference_date, response, final_text,
            prompt_versions, latency_ms, thread_id, created_at, reply_text, pending_clarification)
         values (1, $1, 'user', 'answer', $2, '2026-01-01', $3::jsonb, $4, '{}'::jsonb, 100, $5,
            '2026-01-01T00:01:00Z', $6, $7::jsonb)`,
        [
          userId,
          question, // echoed original question
          JSON.stringify(answerEnvelopeWithView({ question, finalText: 'Amsterdam telt 931.298 inwoners.' })),
          'Amsterdam telt 931.298 inwoners.',
          threadId,
          'Amsterdam',
          JSON.stringify({ question, questionNl }),
        ],
      );

      const parts = replayParts(await getThreadRows(db, userId, threadId));
      // Exactly four parts, in order — the original question NEVER duplicated.
      expect(parts).toHaveLength(4);
      expect(parts.map((p) => p.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
      expect((parts[0] as ReplayUserPart).text).toBe(question); // question
      expect((parts[1] as ReplayAssistantPart).finalText).toBe(questionNl); // clarification
      expect((parts[2] as ReplayUserPart).text).toBe('Amsterdam'); // reply (NOT the echoed question)
      expect((parts[3] as ReplayAssistantPart).finalText).toBe('Amsterdam telt 931.298 inwoners.'); // outcome
    });
  });
});

describe('replayParts — ⟨A7⟩ redacted rows (pin 4)', () => {
  it('a redacted row emits ONE placeholder, never a user+assistant sentinel pair', () => {
    const rows = [
      mkRow({ id: 1, kind: 'answer', question: 'levend', response: answerEnvelopeWithView({ question: 'levend', finalText: 'a' }) }),
      mkRow({ id: 2, kind: 'answer', question: REDACTED_QUESTION_TEXT, response: REDACTED_ENVELOPE }),
    ];
    const parts = replayParts(rows);
    // Live row → user + assistant (2 parts); redacted row → 1 placeholder.
    expect(parts.map((p) => p.role)).toEqual(['user', 'assistant', 'redacted']);
    expect(parts[2]).toEqual({ role: 'redacted', auditId: 2 });
  });
});

// ---------------------------------------------------------------------------
// rebuildContext
// ---------------------------------------------------------------------------

describe('rebuildContext — determinism + ⟨A7⟩ (pin 3)', () => {
  it('equals buildConversationContext over the last eligible (newest non-null) envelope', async () => {
    await withDb(async (db) => {
      const older = mkRow({ id: 1, kind: 'answer', question: 'q1', response: answerEnvelopeWithContext('topic_a', 2023) });
      const newer = mkRow({ id: 2, kind: 'answer', question: 'q2', response: answerEnvelopeWithContext('topic_b', 2024) });

      const rebuilt = await rebuildContext(db, [older, newer]);
      const direct = await buildConversationContext(db, newer.response);
      expect(rebuilt).not.toBeNull();
      expect(rebuilt).toEqual(direct);
      // It picked the NEWEST envelope's context, not the older one's.
      expect(rebuilt).toMatchObject({ topicKey: 'topic_b', period: { kind: 'year', year: 2024 } });
    });
  });

  it('walks back past a null-yielding turn (clarification) to the last answerable one', async () => {
    await withDb(async (db) => {
      const answer = mkRow({ id: 1, kind: 'answer', question: 'q1', response: answerEnvelopeWithContext('topic_a', 2022) });
      const clarify = mkRow({
        id: 2,
        kind: 'clarification',
        question: 'q2',
        response: { schemaVersion: 1, kind: 'clarification', question: 'q2', text: 'welke?', pending: { questionNl: 'welke?' } },
      });

      const rebuilt = await rebuildContext(db, [answer, clarify]);
      // The clarification yields null; the effective referent stays the answer's.
      expect(rebuilt).toEqual(await buildConversationContext(db, answer.response));
      expect(rebuilt).toMatchObject({ topicKey: 'topic_a' });
    });
  });

  it('a thread with no context-yielding turn ⇒ null', async () => {
    await withDb(async (db) => {
      const refusal = mkRow({
        id: 1,
        kind: 'refusal',
        question: 'q',
        response: { schemaVersion: 1, kind: 'refusal', question: 'q', text: 'weigering', reason: 'smalltalk' },
      });
      expect(await rebuildContext(db, [refusal])).toBeNull();
    });
  });

  it('⟨A7⟩ a redacted \'answer\' row does NOT crash the rebuild — it is skipped', async () => {
    await withDb(async (db) => {
      // Proof the guard is load-bearing: buildConversationContext THROWS on a
      // redacted 'answer' envelope (kind kept, `result` gone → resolvedIntent).
      await expect(
        buildConversationContext(db, REDACTED_ENVELOPE as unknown as ComposedResponse),
      ).rejects.toThrow();

      const answer = mkRow({ id: 1, kind: 'answer', question: 'q1', response: answerEnvelopeWithContext('topic_a', 2021) });
      const redacted = mkRow({ id: 2, kind: 'answer', question: REDACTED_QUESTION_TEXT, response: REDACTED_ENVELOPE });

      // The redacted row is the NEWEST (encountered first walking back); it must
      // be skipped BEFORE the call, and the older answer's context returned.
      const rebuilt = await rebuildContext(db, [answer, redacted]);
      expect(rebuilt).toMatchObject({ topicKey: 'topic_a' });
    });
  });

  it('a thread of ONLY a redacted answer row ⇒ null, never a crash', async () => {
    await withDb(async (db) => {
      const redacted = mkRow({ id: 1, kind: 'answer', question: REDACTED_QUESTION_TEXT, response: REDACTED_ENVELOPE });
      expect(await rebuildContext(db, [redacted])).toBeNull();
    });
  });
});

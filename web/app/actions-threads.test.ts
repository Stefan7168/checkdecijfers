// WP135 (ADR 033 ⟨A1⟩/⟨A6⟩): the request-path thread orchestration, hermetic.
// The Stage-A thread module is stubbed at its boundary so THIS file exercises
// actions.ts's own gating: a thread is created lazily (only on a gated-ok
// outcome with an audit id), never on insufficient/duplicate/audit-fail; a
// forged/foreign id validates to null → a fresh thread, never a cross-attach;
// an absent rawThreadId does NO thread work (byte-identical to today); and a
// reply attaches to the CAPTURED thread it was given. The billing gate, the
// audited pipeline, and the auth/db seams are all stubbed.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../backend/db/types.ts';
import type { GatedResponse } from '../backend/billing/index.ts';
import type { AuditedResponse } from '../backend/answer/audit/index.ts';
import type { ComposedResponse, PendingClarification } from '../backend/answer/respond/types.ts';

const { currentUserId, getDb } = vi.hoisted(() => ({
  currentUserId: vi.fn<() => Promise<string | null>>(),
  getDb: vi.fn<() => Db>(),
}));
vi.mock('../lib/current-user.ts', () => ({ currentUserId }));
vi.mock('../lib/db.ts', () => ({ getDb }));

const billing = vi.hoisted(() => ({
  chargeAndRun: vi.fn(),
  compensate: vi.fn(),
  getActionClassPrice: vi.fn(),
  getBalance: vi.fn(),
  reserveWebSearchDebit: vi.fn(),
}));
vi.mock('../backend/billing/index.ts', () => billing);

const audit = vi.hoisted(() => ({
  answerQuestionAudited: vi.fn(),
  answerClarificationReplyAudited: vi.fn(),
  deleteUserQuestionHistory: vi.fn(),
  FEEDBACK_TEXT_MAX_LENGTH: 2000,
  upsertAnswerFeedback: vi.fn(),
}));
vi.mock('../backend/answer/audit/index.ts', () => audit);

vi.mock('../backend/answer/context/index.ts', () => ({
  validateConversationContext: vi.fn().mockResolvedValue(null),
  buildConversationContext: vi.fn().mockResolvedValue(null),
}));

vi.mock('../backend/answer/llm/client.ts', () => ({ AnthropicLlmClient: vi.fn() }));
vi.mock('../backend/websearch/index.ts', () => ({ AnthropicWebSearchClient: vi.fn() }));

// The Stage-A thread module — the ONLY thread writer from the request path.
const threads = vi.hoisted(() => ({
  validateThreadOwnership: vi.fn(),
  attachOrCreateThread: vi.fn(),
  listThreads: vi.fn(),
  getThreadRows: vi.fn(),
}));
vi.mock('../backend/threads/index.ts', () => threads);

import { askQuestion, replyToClarification } from './actions.ts';

const fakeDb = {} as Db;

beforeEach(() => {
  currentUserId.mockResolvedValue('user-1');
  getDb.mockReturnValue(fakeDb);
  billing.getActionClassPrice.mockResolvedValue(20);
  billing.getBalance.mockResolvedValue(100);
  threads.validateThreadOwnership.mockResolvedValue(null);
  threads.attachOrCreateThread.mockResolvedValue(7);
  // Web off ⇒ no ⟨W4⟩ upfront path; the gate is the only refusal source here.
  vi.stubEnv('WEBSEARCH_ENABLED', '0');
  vi.stubEnv('ONBOARDING_ENABLED', '0');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

function fakeAnswer(): ComposedResponse {
  return {
    kind: 'answer',
    question: 'q',
    text: 'Het antwoord.',
    answer: { body: 'Het antwoord.' },
  } as unknown as ComposedResponse;
}

/** Gate that runs the pipeline and returns a gated-ok at `netCost`. */
function driveOk(response: ComposedResponse, auditId: number | null, netCost = 20): void {
  audit.answerQuestionAudited.mockResolvedValue({ response, auditId } as AuditedResponse);
  audit.answerClarificationReplyAudited.mockResolvedValue({ response, auditId } as AuditedResponse);
  billing.chargeAndRun.mockImplementation(
    async (_db: Db, _uid: string, _rid: string, run: () => Promise<AuditedResponse>) => {
      const audited = await run();
      return { kind: 'ok', ...audited, netCost } as GatedResponse;
    },
  );
}

describe('askQuestion — WP135 lazy thread creation ⟨A1⟩', () => {
  it('attaches (lazily creates) a thread on a gated-ok answer and returns its id', async () => {
    driveOk(fakeAnswer(), 5);
    const outcome = await askQuestion('q', 'rid', null, undefined, null);
    expect(threads.attachOrCreateThread).toHaveBeenCalledWith(fakeDb, 'user-1', null, 5);
    expect(outcome.threadId).toBe(7);
  });

  it('does NOT create a thread on insufficient_credits (gate refuses)', async () => {
    billing.chargeAndRun.mockResolvedValue({ kind: 'insufficient_credits', balance: 5, required: 20 });
    const outcome = await askQuestion('q', 'rid', null, undefined, null);
    expect(threads.attachOrCreateThread).not.toHaveBeenCalled();
    expect(outcome.threadId).toBeNull();
  });

  it('does NOT create a thread on duplicate_request', async () => {
    billing.chargeAndRun.mockResolvedValue({ kind: 'duplicate_request' });
    const outcome = await askQuestion('q', 'rid', null, undefined, null);
    expect(threads.attachOrCreateThread).not.toHaveBeenCalled();
    expect(outcome.threadId).toBeNull();
  });

  it('does NOT create a thread when the audit write failed (auditId null)', async () => {
    driveOk(fakeAnswer(), null);
    const outcome = await askQuestion('q', 'rid', null, undefined, null);
    expect(threads.attachOrCreateThread).not.toHaveBeenCalled();
    expect(outcome.threadId).toBeNull();
  });

  it('degrades to a threadless answer when the attach throws (never blocks the answer)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    driveOk(fakeAnswer(), 5);
    threads.attachOrCreateThread.mockRejectedValue(new Error('not attachable'));
    const outcome = await askQuestion('q', 'rid', null, undefined, null);
    expect(outcome.gated.kind).toBe('ok');
    expect(outcome.threadId).toBeNull();
    spy.mockRestore();
  });

  it('is byte-identical (NO thread work) when rawThreadId is ABSENT (Dashboard/benchmark path)', async () => {
    driveOk(fakeAnswer(), 5);
    const outcome = await askQuestion('q', 'rid', null); // 3-arg call, no rawThreadId
    expect(threads.validateThreadOwnership).not.toHaveBeenCalled();
    expect(threads.attachOrCreateThread).not.toHaveBeenCalled();
    expect(outcome.threadId).toBeNull();
  });
});

describe('askQuestion — WP135 cross-user isolation ⟨A1⟩', () => {
  it('a forged/foreign thread id validates to null → a FRESH thread, never a cross-attach', async () => {
    threads.validateThreadOwnership.mockResolvedValue(null); // not owned by this user
    driveOk(fakeAnswer(), 5);
    await askQuestion('q', 'rid', null, undefined, 999);
    expect(threads.validateThreadOwnership).toHaveBeenCalledWith(fakeDb, 'user-1', 999);
    // attach receives validatedThreadId null ⇒ a NEW thread, never 999.
    expect(threads.attachOrCreateThread).toHaveBeenCalledWith(fakeDb, 'user-1', null, 5);
  });

  it('an OWNED thread id is passed through to the attach', async () => {
    threads.validateThreadOwnership.mockResolvedValue(3);
    driveOk(fakeAnswer(), 5);
    await askQuestion('q', 'rid', null, undefined, 3);
    expect(threads.attachOrCreateThread).toHaveBeenCalledWith(fakeDb, 'user-1', 3, 5);
  });
});

describe('replyToClarification — WP135 ⟨A6⟩ captured-thread binding', () => {
  const pending = {
    question: 'oorspronkelijk',
    questionNl: 'Welke periode?',
  } as unknown as PendingClarification;

  it('validates the CAPTURED thread id and attaches the reply to it', async () => {
    threads.validateThreadOwnership.mockResolvedValue(3);
    driveOk(fakeAnswer(), 8);
    const outcome = await replyToClarification(pending, '2024', 'rid', undefined, 3);
    expect(threads.validateThreadOwnership).toHaveBeenCalledWith(fakeDb, 'user-1', 3);
    expect(threads.attachOrCreateThread).toHaveBeenCalledWith(fakeDb, 'user-1', 3, 8);
    expect(outcome.threadId).toBe(7);
  });

  it('does NO thread work when rawThreadId is absent (byte-identical)', async () => {
    driveOk(fakeAnswer(), 8);
    await replyToClarification(pending, '2024', 'rid');
    expect(threads.attachOrCreateThread).not.toHaveBeenCalled();
  });
});

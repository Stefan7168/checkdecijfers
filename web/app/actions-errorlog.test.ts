// #65 / WP25: the durable-error-log instrumentation at the Server Actions'
// outermost catch sites, driven through the REAL web/lib/error-report.ts with
// the backend logError stubbed at its module.
//
// THE pin this file exists for (the WP25 brief names it): a THROWING logger
// must not change the action's outcome. Error logging is fail-open — the
// reverse of the audit store's fail-closed rule, deliberately — so the
// original pipeline error must always be what the caller sees, whether the
// durable write worked, failed, or the whole logging module exploded.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../backend/db/types.ts';
import type { PendingClarification } from '../backend/answer/respond/types.ts';

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

// The one module stubbed DIFFERENTLY from actions.test.ts: logError itself.
// web/lib/error-report.ts stays REAL — its fail-open belt is under test.
const errorLog = vi.hoisted(() => ({
  logError: vi.fn<() => Promise<void>>(),
}));
vi.mock('../backend/db/error-log.ts', () => errorLog);

import { askQuestion, replyToClarification } from './actions.ts';

const fakeDb = {} as Db;
const USER = '11111111-1111-4111-8111-111111111111';
const REQ = '00000000-0000-4000-8000-000000000001';

const validPending: PendingClarification = {
  version: 1,
  question: 'oorspronkelijk',
  referenceDate: '2026-07-16',
  axes: ['period'],
  questionNl: 'Welke periode?',
  options: ['2023', '2024'],
} as unknown as PendingClarification;

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  currentUserId.mockResolvedValue(USER);
  getDb.mockReturnValue(fakeDb);
  errorLog.logError.mockResolvedValue(undefined);
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  consoleError.mockRestore();
  vi.clearAllMocks();
});

describe('#65 askQuestion catch-site instrumentation', () => {
  it('writes the durable copy (source/requestId/userId, never question text) and rethrows the ORIGINAL error', async () => {
    const original = new Error('pipeline exploded');
    billing.chargeAndRun.mockRejectedValue(original);

    await expect(askQuestion('Wat was de inflatie in 2023?', REQ)).rejects.toThrow(
      'pipeline exploded',
    );

    expect(errorLog.logError).toHaveBeenCalledTimes(1);
    const [dbArg, entry] = errorLog.logError.mock.calls[0] as unknown as [
      Db,
      { source: string; error: unknown; requestId: string | null; userId: string | null; context: unknown },
    ];
    expect(dbArg).toBe(fakeDb);
    expect(entry.source).toBe('askQuestion');
    expect(entry.error).toBe(original);
    expect(entry.requestId).toBe(REQ);
    expect(entry.userId).toBe(USER);
    // The GDPR invariant (migration 024): the entry references the request by
    // id, NEVER by content — the question text appears nowhere in it.
    expect(JSON.stringify(entry.context ?? null)).not.toContain('inflatie');
  });

  it('THE WP25 PIN: a throwing logger does not change the action outcome (original error, not the logger error)', async () => {
    const original = new Error('the real failure');
    billing.chargeAndRun.mockRejectedValue(original);
    errorLog.logError.mockRejectedValue(new Error('error_log is down'));

    const seen = await askQuestion('vraag', REQ).then(
      () => null,
      (e: unknown) => e,
    );
    // The ORIGINAL error, byte-for-byte — never replaced by the logging failure.
    expect(seen).toBe(original);
  });

  it('a SUCCESSFUL turn writes nothing to the error log', async () => {
    billing.chargeAndRun.mockResolvedValue({ kind: 'unauthenticated' });
    currentUserId.mockResolvedValue(null); // cheapest clean non-throw path
    await askQuestion('vraag', REQ);
    expect(errorLog.logError).not.toHaveBeenCalled();
  });
});

describe('#65 replyToClarification catch-site instrumentation', () => {
  it('writes the durable copy and rethrows the original error', async () => {
    const original = new Error('reply merge exploded');
    billing.chargeAndRun.mockRejectedValue(original);

    await expect(replyToClarification(validPending, '2023', REQ)).rejects.toThrow(
      'reply merge exploded',
    );
    expect(errorLog.logError).toHaveBeenCalledTimes(1);
    const [, entry] = errorLog.logError.mock.calls[0] as unknown as [Db, { source: string }];
    expect(entry.source).toBe('replyToClarification');
  });

  it('the throwing-logger pin holds on the reply turn too', async () => {
    const original = new Error('the real failure');
    billing.chargeAndRun.mockRejectedValue(original);
    errorLog.logError.mockRejectedValue(new Error('error_log is down'));

    const seen = await replyToClarification(validPending, '2023', REQ).then(
      () => null,
      (e: unknown) => e,
    );
    expect(seen).toBe(original);
  });
});

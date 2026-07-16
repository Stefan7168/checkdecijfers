// WP129+130 (#129/#130, ADR 032): the REAL askQuestion / replyToClarification
// orchestration, hermetic. Unlike the source-scan wiring pins
// (websearch-wiring.test.ts), these EXERCISE the web-layer behavior the jsdom
// chat suite cannot reach: the untrusted-selection validation, the ⟨W4⟩ upfront
// affordability check (30 in both web modes), and the ⟨W3⟩/⟨W1⟩ web add-on
// settlement (keep +10 iff a cited section shipped on an audited 'ok' turn;
// refund on every other shape; compensate on the exception path). The billing
// gate, the audited pipeline, the LLM/web clients and the auth/db seams are all
// stubbed at their modules — so the actions.ts money orchestration is what runs.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../backend/db/types.ts';
import type { GatedResponse, LedgerEntry } from '../backend/billing/index.ts';
import type { AuditedResponse } from '../backend/answer/audit/index.ts';
import type { ComposedResponse } from '../backend/answer/respond/types.ts';
import type { PendingClarification } from '../backend/answer/respond/types.ts';
import type { WebSection } from '../backend/websearch/types.ts';

const { currentUserId, getDb } = vi.hoisted(() => ({
  currentUserId: vi.fn<() => Promise<string | null>>(),
  getDb: vi.fn<() => Db>(),
}));
vi.mock('../lib/current-user.ts', () => ({ currentUserId }));
vi.mock('../lib/db.ts', () => ({ getDb }));

// The billing seam — every function actions.ts calls, stubbed so the gate never
// really runs and the ledger is never touched. chargeAndRun is driven per test.
const billing = vi.hoisted(() => ({
  chargeAndRun: vi.fn(),
  compensate: vi.fn(),
  getActionClassPrice: vi.fn(),
  getBalance: vi.fn(),
  reserveWebSearchDebit: vi.fn(),
}));
vi.mock('../backend/billing/index.ts', () => billing);

// The audited pipeline — answerQuestionAudited is where the injected web
// billing closure is exercised (it calls options.webBilling.reserve() to
// simulate the in-pipeline debit) and where we capture the passed options.
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

// The SDK-constructing clients: `new AnthropicLlmClient()` / `new
// AnthropicWebSearchClient()` would otherwise throw (no API key) — stubbed to
// bare constructors. SOURCES (sources/registry.ts) stays REAL: validateSelection
// filters against the real registry keys.
vi.mock('../backend/answer/llm/client.ts', () => ({ AnthropicLlmClient: vi.fn() }));
vi.mock('../backend/websearch/index.ts', () => ({ AnthropicWebSearchClient: vi.fn() }));

import { askQuestion, replyToClarification } from './actions.ts';

const fakeDb = {} as Db;

beforeEach(() => {
  currentUserId.mockResolvedValue('user-1');
  getDb.mockReturnValue(fakeDb);
  // Prices: web_addon = 10, simple = 20 (the end-state table's numbers).
  billing.getActionClassPrice.mockImplementation(async (_db: Db, cls: string) =>
    cls === 'web_addon' ? 10 : cls === 'simple' ? 20 : 10,
  );
  billing.getBalance.mockResolvedValue(100);
  billing.reserveWebSearchDebit.mockResolvedValue({ kind: 'debited', entry: { id: 99 } });
  billing.compensate.mockResolvedValue({ id: 1 });
  vi.stubEnv('WEBSEARCH_ENABLED', '1');
  vi.stubEnv('ONBOARDING_ENABLED', '0');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

function fakeAnswer(webSection: WebSection | null = null): ComposedResponse {
  return {
    kind: 'answer',
    question: 'q',
    text: 'Het antwoord.',
    answer: { body: 'Het antwoord.' },
    webSection,
  } as unknown as ComposedResponse;
}

/** Drive chargeAndRun to invoke run() (so the injected web billing closure
 * fires) and return an 'ok' gated wrapping the audited result at `netCost`. */
function driveGate(response: ComposedResponse, auditId: number | null, netCost: number): void {
  audit.answerQuestionAudited.mockImplementation(
    async (_db: Db, _q: string, options: { webBilling?: { reserve(): Promise<boolean> } }) => {
      if (options.webBilling) await options.webBilling.reserve();
      return { response, auditId } as AuditedResponse;
    },
  );
  audit.answerClarificationReplyAudited.mockImplementation(
    async (_db: Db, _p: unknown, _r: string, options: { webBilling?: { reserve(): Promise<boolean> } }) => {
      if (options.webBilling) await options.webBilling.reserve();
      return { response, auditId } as AuditedResponse;
    },
  );
  billing.chargeAndRun.mockImplementation(
    async (_db: Db, _uid: string, _rid: string, run: () => Promise<AuditedResponse>) => {
      const audited = await run();
      return { kind: 'ok', ...audited, netCost } as GatedResponse;
    },
  );
}

const okSection: WebSection = {
  status: 'ok',
  findings: [{ text: 'Een bevinding.', citations: [{ url: 'https://example.nl/a', title: null }] }],
  model: 'claude-sonnet-5',
  searches: 1,
  usage: { inputTokens: 10, outputTokens: 5 },
  promptVersion: 1,
};

function lastAskOptions(): Record<string, unknown> {
  return audit.answerQuestionAudited.mock.calls[0]![2] as Record<string, unknown>;
}

describe('askQuestion — selection validation (untrusted client payload)', () => {
  it('filters sources to KNOWN registry keys, dropping unknowns', async () => {
    driveGate(fakeAnswer(), 1, 20);
    await askQuestion('q', 'rid', null, { sources: ['cbs', 'nope', 'wikipedia'], web: false });
    expect(lastAskOptions().sourceSelection).toEqual({ sources: ['cbs'], web: false });
  });

  it('coerces web to a strict boolean', async () => {
    driveGate(fakeAnswer(), 1, 20);
    // web: 'yes' (a truthy non-boolean) must coerce to false, not true.
    await askQuestion('q', 'rid', null, { sources: ['cbs'], web: 'yes' });
    expect(lastAskOptions().sourceSelection).toEqual({ sources: ['cbs'], web: false });
  });

  it('degrades a malformed payload to undefined (never throws)', async () => {
    driveGate(fakeAnswer(), 1, 20);
    await askQuestion('q', 'rid', null, 'garbage-not-an-object');
    expect(lastAskOptions().sourceSelection).toBeUndefined();
    // No web machinery for a malformed selection.
    expect(lastAskOptions().webClient).toBeUndefined();
    expect(lastAskOptions().webBilling).toBeUndefined();
  });

  it('FORCES the selection undefined when the flag is off (server belt)', async () => {
    vi.stubEnv('WEBSEARCH_ENABLED', '0');
    driveGate(fakeAnswer(), 1, 20);
    // Even a well-formed web:true payload is ignored while dormant.
    await askQuestion('q', 'rid', null, { sources: ['cbs'], web: true });
    expect(lastAskOptions().sourceSelection).toBeUndefined();
    expect(lastAskOptions().webClient).toBeUndefined();
    expect(lastAskOptions().webBilling).toBeUndefined();
    expect(billing.getBalance).not.toHaveBeenCalled(); // no affordability check
  });

  it('wires the web client + billing closure only when the Internet chip is on', async () => {
    driveGate(fakeAnswer(okSection), 5, 20);
    await askQuestion('q', 'rid', null, { sources: ['cbs'], web: true });
    expect(lastAskOptions().webClient).toBeDefined();
    expect(lastAskOptions().webBilling).toBeDefined();
    expect(lastAskOptions().sourceSelection).toEqual({ sources: ['cbs'], web: true });
  });
});

describe('askQuestion — ⟨W4⟩ upfront affordability (30 in BOTH web modes)', () => {
  for (const [label, selection] of [
    ['CBS + internet', { sources: ['cbs'], web: true }],
    ['web-only', { sources: [], web: true }],
  ] as const) {
    it(`refuses BEFORE the gate at balance < 30 (${label})`, async () => {
      billing.getBalance.mockResolvedValue(25);
      const { gated } = await askQuestion('q', 'rid', null, selection);
      expect(gated).toEqual({ kind: 'insufficient_credits', balance: 25, required: 30 });
      expect(billing.chargeAndRun).not.toHaveBeenCalled();
      expect(billing.reserveWebSearchDebit).not.toHaveBeenCalled();
    });
  }

  it('proceeds when the balance covers the transient 30-credit hold', async () => {
    billing.getBalance.mockResolvedValue(30);
    driveGate(fakeAnswer(okSection), 5, 20);
    const { gated } = await askQuestion('q', 'rid', null, { sources: ['cbs'], web: true });
    expect(gated.kind).toBe('ok');
    expect(billing.chargeAndRun).toHaveBeenCalledTimes(1);
  });

  it('does NOT run the affordability check when the Internet chip is off', async () => {
    driveGate(fakeAnswer(), 1, 20);
    await askQuestion('q', 'rid', null, { sources: ['cbs'], web: false });
    expect(billing.getBalance).not.toHaveBeenCalled();
  });
});

describe('askQuestion — ⟨W3⟩/⟨W1⟩ web add-on settlement (final gated object)', () => {
  it('KEEPS the +10 (netCost 20 → 30) when a cited section ships on an audited ok turn', async () => {
    driveGate(fakeAnswer(okSection), 5, 20);
    const { gated } = await askQuestion('q', 'rid', null, { sources: ['cbs'], web: true });
    expect(gated).toMatchObject({ kind: 'ok', netCost: 30, auditId: 5 });
    expect(billing.compensate).not.toHaveBeenCalled();
  });

  it('REFUNDS (compensates) when the web section failed — netCost stays 20', async () => {
    driveGate(fakeAnswer({ status: 'failed', code: 'api_error' }), 5, 20);
    const { gated } = await askQuestion('q', 'rid', null, { sources: ['cbs'], web: true });
    expect(gated).toMatchObject({ kind: 'ok', netCost: 20 });
    // compensate(db, userId, debitId=99, price=10, auditId=5)
    expect(billing.compensate).toHaveBeenCalledWith(fakeDb, 'user-1', 99, 10, 5);
  });

  it('REFUNDS when auditId is null DESPITE an ok section (the ⟨W1⟩ belt)', async () => {
    driveGate(fakeAnswer(okSection), null, 20);
    const { gated } = await askQuestion('q', 'rid', null, { sources: ['cbs'], web: true });
    expect((gated as { netCost: number }).netCost).toBe(20);
    expect(billing.compensate).toHaveBeenCalledWith(fakeDb, 'user-1', 99, 10, null);
  });

  it('does not settle anything when no web debit was taken (web chip off)', async () => {
    driveGate(fakeAnswer(), 1, 20);
    const { gated } = await askQuestion('q', 'rid', null, { sources: ['cbs'], web: false });
    expect((gated as { netCost: number }).netCost).toBe(20);
    expect(billing.compensate).not.toHaveBeenCalled();
  });

  it('compensates a taken web debit on the exception path, then rethrows', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    audit.answerQuestionAudited.mockImplementation(
      async (_db: Db, _q: string, options: { webBilling?: { reserve(): Promise<boolean> } }) => {
        if (options.webBilling) await options.webBilling.reserve();
        return { response: fakeAnswer(okSection), auditId: 5 } as AuditedResponse;
      },
    );
    billing.chargeAndRun.mockImplementation(
      async (_db: Db, _uid: string, _rid: string, run: () => Promise<AuditedResponse>) => {
        await run(); // takes the web debit
        throw new Error('pipeline boom');
      },
    );
    try {
      await expect(askQuestion('q', 'rid', null, { sources: ['cbs'], web: true })).rejects.toThrow(
        'pipeline boom',
      );
      expect(billing.compensate).toHaveBeenCalledWith(fakeDb, 'user-1', 99, 10, null);
    } finally {
      spy.mockRestore();
    }
  });
});

// A complete, legitimate pending (the shape respond-audited.ts actually
// produces) — every field within the guardPending bound.
const validPending: PendingClarification = {
  version: 1,
  question: 'oorspronkelijk',
  referenceDate: '2026-07-16',
  axes: ['period'],
  questionNl: 'Welke periode?',
  options: ['2023', '2024'],
} as unknown as PendingClarification;

describe('replyToClarification — the reply turn carries the same selection + settlement', () => {
  const pending = validPending;

  it('validates the selection and keeps the +10 on a cited answered reply', async () => {
    driveGate(fakeAnswer(okSection), 7, 20);
    const { gated } = await replyToClarification(pending, '2024', 'rid', {
      sources: ['cbs', 'bogus'],
      web: true,
    });
    const options = audit.answerClarificationReplyAudited.mock.calls[0]![3] as Record<string, unknown>;
    expect(options.sourceSelection).toEqual({ sources: ['cbs'], web: true });
    expect(gated).toMatchObject({ kind: 'ok', netCost: 30 });
  });

  it('enforces the ⟨W4⟩ 30-credit upfront hold on the reply turn too', async () => {
    billing.getBalance.mockResolvedValue(10);
    const { gated } = await replyToClarification(pending, '2024', 'rid', { sources: [], web: true });
    expect(gated).toEqual({ kind: 'insufficient_credits', balance: 10, required: 30 });
    expect(billing.chargeAndRun).not.toHaveBeenCalled();
  });
});

describe('replyToClarification — pending input bound (untrusted client payload)', () => {
  // Mirror actions.ts's guardPending bounds — a 'use server' module can only
  // export async functions, so the constants can't be imported here.
  const MAX_INPUT_LENGTH = 2000;
  const MAX_PENDING_OPTIONS = 20;
  const huge = 'x'.repeat(MAX_INPUT_LENGTH + 1);

  // Each oversized/malformed field must be rejected BEFORE the gate — no debit,
  // no LLM call, no audit row for a rejected payload.
  const rejected: Array<[string, PendingClarification]> = [
    ['oversized question', { ...validPending, question: huge }],
    ['oversized questionNl', { ...validPending, questionNl: huge }],
    ['oversized options entry', { ...validPending, options: ['2023', huge] }],
    ['over-long options array', { ...validPending, options: Array(MAX_PENDING_OPTIONS + 1).fill('x') }],
    ['over-long axes array', { ...validPending, axes: Array(MAX_PENDING_OPTIONS + 1).fill('period') as unknown as PendingClarification['axes'] }],
    ['non-string question', { ...validPending, question: { toString: () => huge } as unknown as string }],
    ['non-array options', { ...validPending, options: 'not-an-array' as unknown as string[] }],
  ];

  for (const [label, pending] of rejected) {
    it(`rejects ${label} before charging or calling the pipeline`, async () => {
      driveGate(fakeAnswer(), 7, 20);
      await expect(replyToClarification(pending, '2024', 'rid')).rejects.toThrow(/pending\./);
      expect(billing.chargeAndRun).not.toHaveBeenCalled();
      expect(audit.answerClarificationReplyAudited).not.toHaveBeenCalled();
    });
  }

  it('lets a normal-size pending through to the gate unchanged', async () => {
    driveGate(fakeAnswer(), 7, 20);
    const { gated } = await replyToClarification(validPending, '2024', 'rid');
    expect(gated.kind).toBe('ok');
    expect(billing.chargeAndRun).toHaveBeenCalledTimes(1);
  });

  it('allows a field exactly at the MAX_INPUT_LENGTH boundary', async () => {
    driveGate(fakeAnswer(), 7, 20);
    const atLimit = 'x'.repeat(MAX_INPUT_LENGTH);
    const { gated } = await replyToClarification({ ...validPending, questionNl: atLimit }, '2024', 'rid');
    expect(gated.kind).toBe('ok');
    expect(billing.chargeAndRun).toHaveBeenCalledTimes(1);
  });
});

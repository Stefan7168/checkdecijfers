// The trial action's money-path contract (ADR 036): check-BEFORE-serve
// mapping, the R8 options (userId null + sourceTag 'anonymous_trial'), all
// LLM clients on the TRIAL key, refund only on a throw, cookie minted on
// first use. Module boundaries mocked per web convention.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { cookieSet } = vi.hoisted(() => ({ cookieSet: vi.fn() }));
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ set: cookieSet, get: vi.fn() })),
  headers: vi.fn(async () => ({ get: vi.fn(() => null) })),
}));

const { answerQuestionAudited } = vi.hoisted(() => ({ answerQuestionAudited: vi.fn() }));
vi.mock('../backend/answer/audit/index.ts', () => ({ answerQuestionAudited }));

const sdkInstances = vi.hoisted(() => [] as { apiKey?: string }[]);
vi.mock('@anthropic-ai/sdk', () => ({
  default: class FakeAnthropic {
    constructor(opts?: { apiKey?: string }) {
      sdkInstances.push({ apiKey: opts?.apiKey });
    }
  },
}));
const llmClients = vi.hoisted(() => [] as unknown[]);
vi.mock('../backend/answer/llm/client.ts', () => ({
  AnthropicLlmClient: class FakeClient {
    constructor(sdk?: unknown) {
      llmClients.push(sdk);
    }
  },
}));

const { takeTrialQuestion, refundTrialQuestion, attachTrialAudit, dbQuery } = vi.hoisted(() => ({
  takeTrialQuestion: vi.fn(),
  refundTrialQuestion: vi.fn(),
  attachTrialAudit: vi.fn(),
  dbQuery: vi.fn(),
}));
vi.mock('../backend/billing/index.ts', () => ({
  takeTrialQuestion,
  refundTrialQuestion,
  attachTrialAudit,
  TRIAL_QUESTIONS_PER_VISITOR: 2,
}));
vi.mock('../lib/db.ts', () => ({ getDb: vi.fn(() => ({ query: dbQuery })) }));

const { readTrialVisitorId, hashedRequestIp } = vi.hoisted(() => ({
  readTrialVisitorId: vi.fn(),
  hashedRequestIp: vi.fn(),
}));
vi.mock('../lib/trial.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/trial.ts')>()),
  readTrialVisitorId,
  hashedRequestIp,
}));

import { askTrialQuestion } from './trial-actions.ts';

const VISITOR = '9b2f1c2e-6a1d-4f3a-9c0d-0a1b2c3d4e5f';
const RESPONSE = { kind: 'answer', text: 'Het antwoord.', chart: null };

function configure() {
  vi.stubEnv('TRIAL_ENABLED', '1');
  vi.stubEnv('ANTHROPIC_TRIAL_API_KEY', 'sk-trial-test');
  vi.stubEnv('TRIAL_IP_HASH_SECRET', 'secret');
}

beforeEach(() => {
  configure();
  readTrialVisitorId.mockResolvedValue(VISITOR);
  hashedRequestIp.mockResolvedValue('ip-hash');
  takeTrialQuestion.mockResolvedValue({ kind: 'taken', trialQuestionId: 7, questionsLeft: 1 });
  answerQuestionAudited.mockResolvedValue({ response: RESPONSE, auditId: 42 });
  dbQuery.mockResolvedValue({ rows: [{ n: 1 }] });
  sdkInstances.length = 0;
  llmClients.length = 0;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('askTrialQuestion', () => {
  it('is closed(dormant) when the trial envs are not fully set — before any DB work', async () => {
    vi.stubEnv('TRIAL_ENABLED', '0');
    await expect(askTrialQuestion('vraag', 'r1')).resolves.toEqual({
      kind: 'closed',
      reason: 'dormant',
    });
    expect(takeTrialQuestion).not.toHaveBeenCalled();
  });

  it('serves the pipeline response and links the audit row to the pot bookkeeping', async () => {
    const outcome = await askTrialQuestion('Wat is de inflatie?', 'r1');
    // questionsLeft comes from the take itself (in-transaction), never a
    // post-serve read.
    expect(outcome).toEqual({ kind: 'ok', response: RESPONSE, questionsLeft: 1 });
    // Check-before-serve ordering: the take precedes the pipeline call.
    expect(takeTrialQuestion.mock.invocationCallOrder[0]).toBeLessThan(
      answerQuestionAudited.mock.invocationCallOrder[0],
    );
    expect(attachTrialAudit).toHaveBeenCalledWith(expect.anything(), 7, 42);
    expect(refundTrialQuestion).not.toHaveBeenCalled();
  });

  it('writes the R8 row as anonymous: userId null + sourceTag anonymous_trial', async () => {
    await askTrialQuestion('Wat is de inflatie?', 'r1');
    const options = answerQuestionAudited.mock.calls[0]![2] as Record<string, unknown>;
    expect(options.userId).toBeNull();
    expect(options.sourceTag).toBe('anonymous_trial');
    expect(options.requestId).toBe('r1');
    expect(options.conversationContext).toBeNull();
    // Trial scope (ADR 036 D5): none of the account-bound machinery rides along.
    expect(options).not.toHaveProperty('tableFinder');
    expect(options).not.toHaveProperty('webClient');
    expect(options).not.toHaveProperty('sourceSelection');
    expect(options).not.toHaveProperty('extraCanonicalMeasures');
  });

  it('constructs EVERY LLM client on the trial key (the outer belt)', async () => {
    await askTrialQuestion('Wat is de inflatie?', 'r1');
    expect(sdkInstances.length).toBeGreaterThanOrEqual(2);
    for (const instance of sdkInstances) {
      expect(instance.apiKey).toBe('sk-trial-test');
    }
    // Every constructed client received an injected (trial-key) SDK — never
    // the default constructor that reads the MAIN key.
    for (const sdk of llmClients) {
      expect(sdk).toBeDefined();
    }
  });

  it('maps the take rejections to their UI states', async () => {
    takeTrialQuestion.mockResolvedValue({ kind: 'pot_empty' });
    await expect(askTrialQuestion('v', 'r1')).resolves.toEqual({ kind: 'closed', reason: 'pot_empty' });
    takeTrialQuestion.mockResolvedValue({ kind: 'ip_limit' });
    await expect(askTrialQuestion('v', 'r2')).resolves.toEqual({ kind: 'closed', reason: 'ip_limit' });
    takeTrialQuestion.mockResolvedValue({ kind: 'visitor_limit' });
    await expect(askTrialQuestion('v', 'r3')).resolves.toEqual({ kind: 'used_up' });
    takeTrialQuestion.mockResolvedValue({ kind: 'duplicate_request' });
    await expect(askTrialQuestion('v', 'r4')).resolves.toEqual({ kind: 'duplicate_request' });
    expect(answerQuestionAudited).not.toHaveBeenCalled();
  });

  it('refunds the pot when the pipeline throws (and only then)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    answerQuestionAudited.mockRejectedValue(new Error('LLM down'));
    await expect(askTrialQuestion('v', 'r1')).rejects.toThrow('LLM down');
    expect(refundTrialQuestion).toHaveBeenCalledWith(expect.anything(), 7);
  });

  it('mints and sets the visitor cookie on first use only', async () => {
    readTrialVisitorId.mockResolvedValue(null);
    await askTrialQuestion('v', 'r1');
    expect(cookieSet).toHaveBeenCalledTimes(1);
    const [name, value, opts] = cookieSet.mock.calls[0]!;
    expect(name).toBe('cdc_trial');
    expect(String(value)).toMatch(/^[0-9a-f-]{36}$/);
    expect(opts).toMatchObject({ httpOnly: true, secure: true, sameSite: 'lax' });

    cookieSet.mockClear();
    readTrialVisitorId.mockResolvedValue(VISITOR);
    await askTrialQuestion('v', 'r2');
    expect(cookieSet).not.toHaveBeenCalled();
  });

  it('rejects oversized input before touching anything', async () => {
    await expect(askTrialQuestion('x'.repeat(2001), 'r1')).rejects.toThrow('exceeds');
    expect(takeTrialQuestion).not.toHaveBeenCalled();
  });

  it('still serves the answer when the post-hoc audit link fails (fail-soft, no refund)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    attachTrialAudit.mockRejectedValue(new Error('update lost'));
    const outcome = await askTrialQuestion('Wat is de inflatie?', 'r1');
    expect(outcome).toEqual({ kind: 'ok', response: RESPONSE, questionsLeft: 1 });
    expect(refundTrialQuestion).not.toHaveBeenCalled();
  });

  it('runs the #144 semantic checker on the TRIAL key too when the flag is live', async () => {
    vi.stubEnv('SEMANTIC_CHECK_ENABLED', '1');
    await askTrialQuestion('Wat is de inflatie?', 'r1');
    const options = answerQuestionAudited.mock.calls[0]![2] as {
      semanticCheck?: { client: unknown; mode: string };
    };
    expect(options.semanticCheck).toBeDefined();
    expect(options.semanticCheck!.mode).toBe('fail_open');
    // Three constructed SDK instances (intent, answer, checker) — every one
    // on the trial key: ALL trial spend stays inside the trial belt.
    expect(sdkInstances).toHaveLength(3);
    for (const instance of sdkInstances) {
      expect(instance.apiKey).toBe('sk-trial-test');
    }
  });
});

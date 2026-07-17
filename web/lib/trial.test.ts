// The trial gate's dormancy + fail-safe contract (ADR 036): unset envs mean
// DORMANT (the landing renders as if the feature does not exist), an
// unreadable/empty pot means CLOSED (the honest login degrade), and a forged
// cookie never reaches SQL.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { cookieGet, headerGet } = vi.hoisted(() => ({ cookieGet: vi.fn(), headerGet: vi.fn() }));
vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: cookieGet })),
  headers: vi.fn(async () => ({ get: headerGet })),
}));

const { getTrialPotStatus, dbQuery } = vi.hoisted(() => ({
  getTrialPotStatus: vi.fn(),
  dbQuery: vi.fn(),
}));
vi.mock('../backend/billing/index.ts', () => ({
  getTrialPotStatus,
  TRIAL_QUESTIONS_PER_VISITOR: 2,
}));
vi.mock('./db.ts', () => ({ getDb: vi.fn(() => ({ query: dbQuery })) }));

import { getTrialGateState, hashedRequestIp, readTrialVisitorId } from './trial.ts';

const VISITOR = '9b2f1c2e-6a1d-4f3a-9c0d-0a1b2c3d4e5f';

function configure() {
  vi.stubEnv('TRIAL_ENABLED', '1');
  vi.stubEnv('ANTHROPIC_TRIAL_API_KEY', 'sk-trial-test');
  vi.stubEnv('TRIAL_IP_HASH_SECRET', 'secret');
}

beforeEach(() => {
  cookieGet.mockReturnValue(undefined);
  headerGet.mockReturnValue(null);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('getTrialGateState', () => {
  it('is dormant unless flag AND key AND secret are all set', async () => {
    expect(await getTrialGateState()).toEqual({ kind: 'dormant' });
    vi.stubEnv('TRIAL_ENABLED', '1');
    expect(await getTrialGateState()).toEqual({ kind: 'dormant' });
    vi.stubEnv('ANTHROPIC_TRIAL_API_KEY', 'sk-trial-test');
    expect(await getTrialGateState()).toEqual({ kind: 'dormant' });
  });

  it('reads closed when the pot is empty, absent, or unreadable (fail-safe)', async () => {
    configure();
    getTrialPotStatus.mockResolvedValue({ remaining: 0, cap: 25 });
    expect(await getTrialGateState()).toEqual({ kind: 'closed' });
    getTrialPotStatus.mockResolvedValue(null);
    expect(await getTrialGateState()).toEqual({ kind: 'closed' });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    getTrialPotStatus.mockRejectedValue(new Error('pool down'));
    expect(await getTrialGateState()).toEqual({ kind: 'closed' });
  });

  it('is open with the full budget for a cookie-less visitor', async () => {
    configure();
    getTrialPotStatus.mockResolvedValue({ remaining: 10, cap: 25 });
    expect(await getTrialGateState()).toEqual({ kind: 'open', questionsLeft: 2 });
  });

  it('subtracts the returning visitor\'s used questions; exhausted reads used_up', async () => {
    configure();
    getTrialPotStatus.mockResolvedValue({ remaining: 10, cap: 25 });
    cookieGet.mockReturnValue({ value: VISITOR });
    dbQuery.mockResolvedValue({ rows: [{ n: 1 }] });
    expect(await getTrialGateState()).toEqual({ kind: 'open', questionsLeft: 1 });
    dbQuery.mockResolvedValue({ rows: [{ n: 2 }] });
    expect(await getTrialGateState()).toEqual({ kind: 'used_up' });
  });
});

describe('readTrialVisitorId', () => {
  it('accepts only UUID-shaped cookie values (forged values coerce to null)', async () => {
    cookieGet.mockReturnValue({ value: VISITOR });
    expect(await readTrialVisitorId()).toBe(VISITOR);
    cookieGet.mockReturnValue({ value: "'; drop table trial_questions; --" });
    expect(await readTrialVisitorId()).toBeNull();
    cookieGet.mockReturnValue(undefined);
    expect(await readTrialVisitorId()).toBeNull();
  });
});

describe('hashedRequestIp', () => {
  it('HMACs the first forwarded address — never the raw IP', async () => {
    vi.stubEnv('TRIAL_IP_HASH_SECRET', 'secret');
    headerGet.mockImplementation((name: string) =>
      name === 'x-forwarded-for' ? '203.0.113.7, 10.0.0.1' : null,
    );
    const hash = await hashedRequestIp();
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain('203.0.113.7');
    // Deterministic for the same ip+secret; different for another ip.
    expect(await hashedRequestIp()).toBe(hash);
    headerGet.mockImplementation((name: string) =>
      name === 'x-forwarded-for' ? '198.51.100.9' : null,
    );
    expect(await hashedRequestIp()).not.toBe(hash);
  });
});

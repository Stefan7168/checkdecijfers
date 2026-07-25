// The trial gate's dormancy + fail-safe contract (ADR 036): unset envs mean
// DORMANT (the landing renders as if the feature does not exist), a pot READ
// as empty means CLOSED while a pot we could not read means UNAVAILABLE (both
// degrade to the login prompt; only the first may say why), and a forged
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

import { getTrialGateState, hashedRequestIp, ipBucketKey, readTrialVisitorId } from './trial.ts';

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

  // The degrade is the same either way; only the CLAIM differs. 'closed' means
  // we read the pot and it was empty — the copy may say so. 'unavailable' means
  // we could not tell, and the copy must not name a cause it does not have.
  it('says closed ONLY for a pot it actually read as empty', async () => {
    configure();
    getTrialPotStatus.mockResolvedValue({ remaining: 0, cap: 25 });
    expect(await getTrialGateState()).toEqual({ kind: 'closed' });
  });

  it('says unavailable — not closed — when the pot is absent or unreadable', async () => {
    configure();
    getTrialPotStatus.mockResolvedValue(null);
    expect(await getTrialGateState()).toEqual({ kind: 'unavailable' });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    getTrialPotStatus.mockRejectedValue(new Error('pool down'));
    expect(await getTrialGateState()).toEqual({ kind: 'unavailable' });
    // A failing per-visitor count is the same class: the pot was fine, our
    // knowledge of the visitor is not.
    getTrialPotStatus.mockResolvedValue({ remaining: 10, cap: 25 });
    cookieGet.mockReturnValue({ value: VISITOR });
    dbQuery.mockRejectedValue(new Error('pool down'));
    expect(await getTrialGateState()).toEqual({ kind: 'unavailable' });
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

  // A PRESENT-but-EMPTY x-forwarded-for splits to '', which is not nullish, so
  // `??` short-circuited on it and never consulted x-real-ip — bucketing every
  // such request under one hash distinct from both a real address and
  // 'unknown'. Not reachable on Vercel; reachable behind any other proxy.
  it('falls through an empty OR whitespace x-forwarded-for to x-real-ip', async () => {
    vi.stubEnv('TRIAL_IP_HASH_SECRET', 'secret');
    headerGet.mockImplementation((name: string) => (name === 'x-real-ip' ? '203.0.113.7' : null));
    const viaRealIp = await hashedRequestIp();
    // Empty string: not nullish, so `??` used to short-circuit here.
    for (const forwarded of ['', '   ', ' , 10.0.0.1']) {
      headerGet.mockImplementation((name: string) =>
        name === 'x-forwarded-for' ? forwarded : name === 'x-real-ip' ? '203.0.113.7' : null,
      );
      expect(await hashedRequestIp(), `forwarded=${JSON.stringify(forwarded)}`).toBe(viaRealIp);
    }
  });

  // An unkeyed SHA-256 of an IPv4 address is brute-forceable over the whole
  // 2^32 space, i.e. exactly the defeat of D2's "raw IPs never persist". The
  // caller guarantees the secret is set; this makes the guarantee loud.
  it('refuses to hash at all when the secret is unset, rather than keying on ""', async () => {
    vi.stubEnv('TRIAL_IP_HASH_SECRET', '');
    await expect(hashedRequestIp()).rejects.toThrow('TRIAL_IP_HASH_SECRET');
  });
});

// #182: the per-IP backstop must bucket an IPv6 HOUSEHOLD, not an address. A
// residential delegation is a /64 at minimum, so keying on the full address
// hands one visitor 2^64 fresh 5/day budgets — i.e. the limit bounds nothing.
// Tested on the key directly: through the HMAC every wrong answer looks like
// the same opaque hex.
describe('ipBucketKey (#182)', () => {
  it('leaves IPv4 alone — one address is already the household', () => {
    expect(ipBucketKey('203.0.113.7')).toBe('203.0.113.7');
    expect(ipBucketKey('unknown')).toBe('unknown');
  });

  it('collapses a whole /64 to ONE key', () => {
    const keys = [
      '2001:db8:abcd:1234:0000:0000:0000:0001',
      '2001:db8:abcd:1234::1',
      '2001:db8:abcd:1234:ffff:ffff:ffff:ffff',
      '2001:0db8:abcd:1234::dead:beef',
      '[2001:db8:abcd:1234::1]:443',
      '2001:db8:abcd:1234::1%eth0',
      '2001:DB8:ABCD:1234::1',
    ].map(ipBucketKey);
    expect(new Set(keys).size, keys.join(' | ')).toBe(1);
  });

  // THE sub-rule the whole fix turns on, and the one an earlier version of this
  // file failed to pin: every case above carries its four /64 groups BEFORE the
  // `::`, so naive split(':').slice(0,4) happens to be right for all of them.
  // Deleting the expansion branch left them all green. These do not.
  it('expands `::` BEFORE slicing — the case naive slicing gets wrong', () => {
    expect(ipBucketKey('2001:db8::1')).toBe('2001:db8:0:0::/64');
    // Same household written two ways; naive slicing gives 2001:db8::1::/64 vs
    // 2001:db8:0:0::/64 — one /64 split across two buckets, i.e. #182 again.
    expect(ipBucketKey('2001:db8::1')).toBe(ipBucketKey('2001:db8:0:0:ffff::1'));
    expect(ipBucketKey('2a02::5')).toBe('2a02:0:0:0::/64');
  });

  it('keeps DIFFERENT /64s apart — including a neighbouring one', () => {
    const a = ipBucketKey('2001:db8:abcd:1234::1');
    expect(ipBucketKey('2001:db8:abcd:1235::1')).not.toBe(a); // next /64
    expect(ipBucketKey('2001:db8:abcd::1')).not.toBe(a); // shorter prefix
    expect(ipBucketKey('2a02:a45f:1:2::9')).not.toBe(a);
  });

  it('buckets an IPv4-mapped address as the IPv4 it is — dotted AND hex form', () => {
    // Otherwise one visitor lands in two buckets depending on which form the
    // platform handed us — and worse, every hex-form client would collapse into
    // one shared 0:0:0:0::/64 bucket and lock unrelated visitors out.
    expect(ipBucketKey('::ffff:203.0.113.7')).toBe('203.0.113.7');
    expect(ipBucketKey('::FFFF:203.0.113.7')).toBe('203.0.113.7');
    expect(ipBucketKey('::ffff:cb00:7107')).toBe('203.0.113.7');
    expect(ipBucketKey('::ffff:c000:0207')).toBe('192.0.2.7');
    // Two different hex-mapped clients must NOT share a bucket.
    expect(ipBucketKey('::ffff:cb00:7107')).not.toBe(ipBucketKey('::ffff:c000:0207'));
  });

  it('does not give an IPv4 address a fresh bucket per ephemeral port', () => {
    expect(ipBucketKey('203.0.113.7:443')).toBe('203.0.113.7');
    expect(ipBucketKey('203.0.113.7:51234')).toBe(ipBucketKey('203.0.113.7'));
  });

  // #187: identical to x-forwarded-for today, but the documented one that
  // survives a proxy in front of Vercel — which the launch plan contemplates.
  it('prefers x-vercel-forwarded-for when both are present', async () => {
    vi.stubEnv('TRIAL_IP_HASH_SECRET', 'secret');
    headerGet.mockImplementation((name: string) =>
      name === 'x-vercel-forwarded-for' ? '203.0.113.7' : null,
    );
    const real = await hashedRequestIp();
    headerGet.mockImplementation((name: string) =>
      name === 'x-vercel-forwarded-for'
        ? '203.0.113.7'
        : name === 'x-forwarded-for'
          ? '198.51.100.9'
          : null,
    );
    expect(await hashedRequestIp()).toBe(real);
  });

  it('the hash follows the bucket: two addresses in one /64 share a hash', async () => {
    vi.stubEnv('TRIAL_IP_HASH_SECRET', 'secret');
    headerGet.mockImplementation((name: string) =>
      name === 'x-forwarded-for' ? '2001:db8:abcd:1234::1' : null,
    );
    const first = await hashedRequestIp();
    headerGet.mockImplementation((name: string) =>
      name === 'x-forwarded-for' ? '2001:db8:abcd:1234::99ff' : null,
    );
    expect(await hashedRequestIp()).toBe(first);
    headerGet.mockImplementation((name: string) =>
      name === 'x-forwarded-for' ? '2001:db8:abcd:9999::1' : null,
    );
    expect(await hashedRequestIp()).not.toBe(first);
  });
});

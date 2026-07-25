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
  TRIAL_QUESTIONS_PER_IP_PER_DAY: 5,
}));
vi.mock('./db.ts', () => ({ getDb: vi.fn(() => ({ query: dbQuery })) }));

import {
  getTrialGateState,
  hashedRequestIp,
  ipBucketKey,
  readTrialVisitorId,
  resetTrialPotCache,
  TRIAL_POT_TTL_MS,
} from './trial.ts';

const VISITOR = '9b2f1c2e-6a1d-4f3a-9c0d-0a1b2c3d4e5f';
const OTHER_VISITOR = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';

function configure() {
  vi.stubEnv('TRIAL_ENABLED', '1');
  vi.stubEnv('ANTHROPIC_TRIAL_API_KEY', 'sk-trial-test');
  vi.stubEnv('TRIAL_IP_HASH_SECRET', 'secret');
}

beforeEach(() => {
  // #186: the pot read is cached at module scope, so without this every case
  // would inherit the previous case's pot — the resetOntdekCache /
  // resetLlmsTxtCache idiom, for the same reason.
  resetTrialPotCache();
  cookieGet.mockReturnValue(undefined);
  headerGet.mockReturnValue(null);
  // #184: the gate now always reads both counts in one row. Default to an
  // untouched visitor on an untouched network; cases that care override it.
  dbQuery.mockResolvedValue({ rows: [{ visitor_n: 0, ip_n: 0 }] });
});

afterEach(() => {
  vi.useRealTimers();
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
    dbQuery.mockResolvedValue({ rows: [{ visitor_n: 1, ip_n: 1 }] });
    expect(await getTrialGateState()).toEqual({ kind: 'open', questionsLeft: 1 });
    dbQuery.mockResolvedValue({ rows: [{ visitor_n: 2, ip_n: 2 }] });
    expect(await getTrialGateState()).toEqual({ kind: 'used_up' });
  });
});

// #184: a visitor behind a NAT whose 5/day is already spent used to be invited
// to type a question and only told one round-trip later. The gate now knows.
describe('the per-network limit at the gate (#184)', () => {
  it('reports ip_limit for a FIRST-time visitor on an exhausted network', async () => {
    configure();
    getTrialPotStatus.mockResolvedValue({ remaining: 10, cap: 25 });
    // No cookie: the visitor personally asked nothing. This is the case the row
    // is about — CGNAT and office NAT put strangers behind one address — and the
    // old gate short-circuited on the null cookie before it could ever notice.
    dbQuery.mockResolvedValue({ rows: [{ visitor_n: 0, ip_n: 5 }] });
    expect(await getTrialGateState()).toEqual({ kind: 'ip_limit' });
  });

  it('lets the visitor through while the network is one under the cap', async () => {
    configure();
    getTrialPotStatus.mockResolvedValue({ remaining: 10, cap: 25 });
    dbQuery.mockResolvedValue({ rows: [{ visitor_n: 0, ip_n: 4 }] });
    expect(await getTrialGateState()).toEqual({ kind: 'open', questionsLeft: 2 });
  });

  // Their own budget is the more specific, more actionable truth, and it is the
  // order takeTrialQuestion checks in — so where both apply, the gate names the
  // same cause the action would.
  it('prefers used_up over ip_limit when both apply', async () => {
    configure();
    getTrialPotStatus.mockResolvedValue({ remaining: 10, cap: 25 });
    cookieGet.mockReturnValue({ value: VISITOR });
    dbQuery.mockResolvedValue({ rows: [{ visitor_n: 2, ip_n: 9 }] });
    expect(await getTrialGateState()).toEqual({ kind: 'used_up' });
  });

  // Showing "1 van 2 over" because a STRANGER on the same NAT spent one would
  // tell this visitor they had used a question they never asked — the exact
  // class of unverified claim principle (c) forbids.
  it('never clamps the visitor budget by the network headroom', async () => {
    configure();
    getTrialPotStatus.mockResolvedValue({ remaining: 10, cap: 25 });
    dbQuery.mockResolvedValue({ rows: [{ visitor_n: 0, ip_n: 4 }] });
    expect(await getTrialGateState()).toEqual({ kind: 'open', questionsLeft: 2 });
  });

  // The sequencing promise #186 made: adding this check must not ADD a query.
  it('costs ONE query per render — both limits in a single round trip', async () => {
    configure();
    getTrialPotStatus.mockResolvedValue({ remaining: 10, cap: 25 });
    cookieGet.mockReturnValue({ value: VISITOR });
    await getTrialGateState();
    expect(dbQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = dbQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/visitor_n/);
    expect(sql).toMatch(/ip_n/);
    // Both partial indexes from migration 020 are `… where not refunded`, so a
    // read that dropped that predicate would silently seq-scan the table on
    // every anonymous page view.
    expect(sql.match(/not refunded/g)).toHaveLength(2);
    expect(params).toHaveLength(2);
  });

  // The gate must not be able to CAUSE the thing it reports. Nothing here is
  // written, and the raw address never leaves memory (ADR 036 D2).
  it('reads the network count without writing anything', async () => {
    configure();
    headerGet.mockImplementation((name: string) =>
      name === 'x-forwarded-for' ? '203.0.113.7' : null,
    );
    getTrialPotStatus.mockResolvedValue({ remaining: 10, cap: 25 });
    await getTrialGateState();
    const [sql, params] = dbQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).not.toMatch(/insert|update|delete/i);
    expect(params[1]).toMatch(/^[0-9a-f]{64}$/);
    expect(params[1]).not.toContain('203.0.113.7');
  });
});

// #186. The measured cost of the landing is not the 0.44 ms pot query but the
// pooler SESSION it forces an instance to open — sampled 2026-07-25, one
// anonymous GET left a Supavisor backend idle for 174 s, because node-pg's 10 s
// idle timeout does not fire while a Fluid Compute instance is frozen. Within
// the TTL the pot must therefore be read at most once per instance, however
// many drive-bys arrive.
describe('the pot-read cache (#186)', () => {
  // The TTL's MAGNITUDE needs its own pin. The expiry test below advances the
  // clock BY this constant, so it crosses the boundary whatever the constant
  // says and would sit there green if someone made the cache six hours long.
  // The band is the one the owner-approved brief named: long enough to cover a
  // drive-by storm, short enough that "a refill re-opens the trial without a
  // deploy" still reads as true to an operator who reloads to check.
  it('keeps the TTL inside the 15-30 s band the refill decision allows', () => {
    expect(TRIAL_POT_TTL_MS).toBeGreaterThanOrEqual(15_000);
    expect(TRIAL_POT_TTL_MS).toBeLessThanOrEqual(30_000);
  });

  it('reads the pot ONCE for repeated gate renders inside the TTL', async () => {
    configure();
    getTrialPotStatus.mockResolvedValue({ remaining: 10, cap: 25 });
    expect(await getTrialGateState()).toEqual({ kind: 'open', questionsLeft: 2 });
    expect(await getTrialGateState()).toEqual({ kind: 'open', questionsLeft: 2 });
    expect(getTrialPotStatus).toHaveBeenCalledTimes(1);
    // Two renders, ONE pot read, and the only remaining per-render query is the
    // single combined limits read #184 added. Before both changes this pair of
    // renders cost 2-4 queries.
    expect(dbQuery).toHaveBeenCalledTimes(2);
  });

  it('re-reads once the TTL has expired', async () => {
    configure();
    vi.useFakeTimers();
    getTrialPotStatus.mockResolvedValue({ remaining: 10, cap: 25 });
    expect(await getTrialGateState()).toEqual({ kind: 'open', questionsLeft: 2 });
    vi.advanceTimersByTime(TRIAL_POT_TTL_MS + 1);
    getTrialPotStatus.mockResolvedValue({ remaining: 0, cap: 25 });
    expect(await getTrialGateState()).toEqual({ kind: 'closed' });
    expect(getTrialPotStatus).toHaveBeenCalledTimes(2);
  });

  // The asymmetry that decides this: a stale 'open' costs nothing (the atomic
  // take is the real gate and refuses honestly), while a stale 'unavailable'
  // costs a visitor the whole trial. So failures are never remembered, and a
  // recovered database is visible on the very next request.
  it('never caches a failed read — recovery is visible immediately', async () => {
    configure();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    getTrialPotStatus.mockResolvedValue(null);
    expect(await getTrialGateState()).toEqual({ kind: 'unavailable' });
    getTrialPotStatus.mockRejectedValue(new Error('pool down'));
    expect(await getTrialGateState()).toEqual({ kind: 'unavailable' });
    getTrialPotStatus.mockResolvedValue({ remaining: 10, cap: 25 });
    expect(await getTrialGateState()).toEqual({ kind: 'open', questionsLeft: 2 });
    expect(getTrialPotStatus).toHaveBeenCalledTimes(3);
  });

  // Deliberately NOT ontdek.ts's stale-over-nothing: an EXPIRED 'open' from
  // before an outage would invite a visitor to type into a backend we have just
  // observed to be down.
  it('does not resurrect an EXPIRED entry when the refresh fails', async () => {
    configure();
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    getTrialPotStatus.mockResolvedValue({ remaining: 10, cap: 25 });
    expect(await getTrialGateState()).toEqual({ kind: 'open', questionsLeft: 2 });
    vi.advanceTimersByTime(TRIAL_POT_TTL_MS + 1);
    getTrialPotStatus.mockRejectedValue(new Error('pool down'));
    expect(await getTrialGateState()).toEqual({ kind: 'unavailable' });
  });

  // The #173 shape this is aimed at: a deploy burst landing N concurrent
  // requests on ONE cold instance must cost one read, not N.
  it('coalesces concurrent cold reads into a single query', async () => {
    configure();
    let release: (v: { remaining: number; cap: number }) => void = () => {};
    getTrialPotStatus.mockReturnValue(
      new Promise<{ remaining: number; cap: number }>((r) => {
        release = r;
      }),
    );
    const inflight = [getTrialGateState(), getTrialGateState(), getTrialGateState()];
    release({ remaining: 10, cap: 25 });
    expect(await Promise.all(inflight)).toEqual([
      { kind: 'open', questionsLeft: 2 },
      { kind: 'open', questionsLeft: 2 },
      { kind: 'open', questionsLeft: 2 },
    ]);
    expect(getTrialPotStatus).toHaveBeenCalledTimes(1);
  });

  // The line the cache must never cross. The pot is global and may be shared;
  // the per-visitor count is not, and serving one visitor's budget to another
  // on a reused instance would be a cross-visitor leak.
  it('never caches the PER-VISITOR count — two visitors get their own budgets', async () => {
    configure();
    getTrialPotStatus.mockResolvedValue({ remaining: 10, cap: 25 });
    cookieGet.mockReturnValue({ value: VISITOR });
    dbQuery.mockResolvedValue({ rows: [{ visitor_n: 1, ip_n: 1 }] });
    expect(await getTrialGateState()).toEqual({ kind: 'open', questionsLeft: 1 });
    cookieGet.mockReturnValue({ value: OTHER_VISITOR });
    dbQuery.mockResolvedValue({ rows: [{ visitor_n: 0, ip_n: 0 }] });
    expect(await getTrialGateState()).toEqual({ kind: 'open', questionsLeft: 2 });
    // One pot read shared, but a live count for each visitor.
    expect(getTrialPotStatus).toHaveBeenCalledTimes(1);
    expect(dbQuery).toHaveBeenCalledTimes(2);
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

  // One canonical form, one decision: every spelling of an embedded IPv4 must
  // reach the SAME bucket. Three review findings were three spellings of this
  // one case, each previously collapsing into the shared 0:0:0:0::/64 bucket.
  it('buckets EVERY embedded-IPv4 spelling as the same IPv4', () => {
    const spellings = [
      '::ffff:203.0.113.7',
      '::FFFF:203.0.113.7',
      '::ffff:cb00:7107',
      '0:0:0:0:0:ffff:203.0.113.7',
      '0::ffff:203.0.113.7',
      '::203.0.113.7',
      '203.0.113.7',
      '203.0.113.7:443',
    ].map(ipBucketKey);
    expect(new Set(spellings), spellings.join(' | ')).toEqual(new Set(['203.0.113.7']));
  });

  it('keeps :: and ::1 apart instead of merging them into one bucket', () => {
    expect(ipBucketKey('::')).not.toBe(ipBucketKey('::1'));
  });

  it('returns a unique key for malformed input rather than guessing a bucket', () => {
    // A wrong guess merges unrelated visitors into one 5/day budget; a verbatim
    // key can only ever be over-permissive to the single sender that produced it.
    const a = ipBucketKey('::ffff:203.0.113.7:443');
    expect(a).not.toBe('203.0.113.7');
    expect(a).not.toBe(ipBucketKey('::ffff:1.2.3.4:443'));
  });

  it('legacy: dotted AND hex form', () => {
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
  // The regression this file exists to prevent, one header higher: `??` treats
  // '' as a value, so an empty platform header masked a populated XFF.
  it('falls through an EMPTY x-vercel-forwarded-for to x-forwarded-for', async () => {
    vi.stubEnv('TRIAL_IP_HASH_SECRET', 'secret');
    headerGet.mockImplementation((name: string) =>
      name === 'x-forwarded-for' ? '203.0.113.7' : null,
    );
    const viaXff = await hashedRequestIp();
    for (const empty of ['', '   ']) {
      headerGet.mockImplementation((name: string) =>
        name === 'x-vercel-forwarded-for' ? empty : name === 'x-forwarded-for' ? '203.0.113.7' : null,
      );
      expect(await hashedRequestIp(), `empty=${JSON.stringify(empty)}`).toBe(viaXff);
    }
  });

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

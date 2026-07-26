// #190(b): the anonymous read paths must DEGRADE under a stalled pool, not wait.
// The fail-safe they already have engages on errors and never on waits, which is
// why a saturated pooler produced a page that never finished instead of the
// login nudge designed for exactly that.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ANONYMOUS_READ_DEADLINE_MS, withDeadline } from './deadline.ts';

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('withDeadline', () => {
  it('returns the real value when the work finishes in time', async () => {
    await expect(withDeadline(Promise.resolve('real'), 'fallback', 'test')).resolves.toBe('real');
  });

  it('returns the fallback when the work never settles', async () => {
    const never = new Promise<string>(() => {});
    const raced = withDeadline(never, 'fallback', 'test');
    await vi.advanceTimersByTimeAsync(ANONYMOUS_READ_DEADLINE_MS + 1);
    await expect(raced).resolves.toBe('fallback');
  });

  // The bound is only useful if it is actually a bound: a work promise that
  // settles one tick before the deadline must still win.
  it('does not fire early — work settling just inside the deadline still wins', async () => {
    let resolve: (v: string) => void = () => {};
    const work = new Promise<string>((r) => {
      resolve = r;
    });
    const raced = withDeadline(work, 'fallback', 'test');
    await vi.advanceTimersByTimeAsync(ANONYMOUS_READ_DEADLINE_MS - 1);
    resolve('real');
    await expect(raced).resolves.toBe('real');
  });

  // A rejection BEFORE the deadline is the caller's existing honest degrade and
  // must still reach their catch — the deadline must not swallow real failures
  // into a silent fallback.
  it('propagates a rejection that arrives before the deadline', async () => {
    const boom = Promise.reject(new Error('pool down'));
    await expect(withDeadline(boom, 'fallback', 'test')).rejects.toThrow('pool down');
  });

  // And a rejection AFTER it must not become an unhandled rejection — the race
  // has already attached a handler, which is the only reason this is safe.
  it('a rejection arriving AFTER the deadline is handled, not unhandled', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      let reject: (e: Error) => void = () => {};
      const late = new Promise<string>((_, r) => {
        reject = r;
      });
      const raced = withDeadline(late, 'fallback', 'test');
      await vi.advanceTimersByTimeAsync(ANONYMOUS_READ_DEADLINE_MS + 1);
      await expect(raced).resolves.toBe('fallback');
      reject(new Error('arrived too late'));
      await vi.advanceTimersByTimeAsync(10);
      await Promise.resolve();
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });

  // An outstanding setTimeout keeps a serverless instance's event loop alive,
  // which is billed wall clock for nothing on every fast request.
  it('clears its timer on the fast path', async () => {
    const clear = vi.spyOn(globalThis, 'clearTimeout');
    await withDeadline(Promise.resolve('real'), 'fallback', 'test');
    expect(clear).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  // Measured, not guessed: every landing-path query's worst observed execution
  // in production is under ~17 ms, and the route's own ceiling is 90 s. The bound
  // has to sit far above the first and far below the second, or it either denies
  // a merely-slow database or never fires before the platform gives up.
  it('keeps the bound between a slow query and the route ceiling', () => {
    expect(ANONYMOUS_READ_DEADLINE_MS).toBeGreaterThanOrEqual(2_000);
    expect(ANONYMOUS_READ_DEADLINE_MS).toBeLessThanOrEqual(15_000);
  });
});

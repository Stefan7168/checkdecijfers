// Fix round 1 of breadth step 5 Task 4 (M5): the ONE shared referenceDate()
// and semantic-check options used by askQuestion (web/app/actions.ts), the
// onboarding-cron delivery re-run and the table-lane job — behaviour identical
// to the copies they replace.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LlmClient } from '../backend/answer/llm/client.ts';
import { referenceDate, semanticCheckOptions } from './turn-options.ts';

describe('referenceDate', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("is 'today' in Europe/Amsterdam as YYYY-MM-DD (not the UTC date)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-28T22:30:00Z')); // 00:30 on the 29th in Amsterdam
    expect(referenceDate()).toBe('2026-09-29');
  });
});

describe('semanticCheckOptions', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const fakeClient = {} as LlmClient;

  it('is empty and constructs no client while SEMANTIC_CHECK_ENABLED is not exactly 1', () => {
    vi.stubEnv('SEMANTIC_CHECK_ENABLED', '');
    const make = vi.fn(() => fakeClient);
    expect(semanticCheckOptions(make)).toEqual({});
    expect(make).not.toHaveBeenCalled();
  });

  it("fails open by default and closed only on SEMANTIC_CHECK_FAILMODE='closed'", () => {
    vi.stubEnv('SEMANTIC_CHECK_ENABLED', '1');
    expect(semanticCheckOptions(() => fakeClient)).toEqual({ semanticCheck: { client: fakeClient, mode: 'fail_open' } });
    vi.stubEnv('SEMANTIC_CHECK_FAILMODE', 'closed');
    expect(semanticCheckOptions(() => fakeClient)).toEqual({ semanticCheck: { client: fakeClient, mode: 'fail_closed' } });
  });
});

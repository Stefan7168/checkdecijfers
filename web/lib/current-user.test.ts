// WP218 phase 3, Task 3: `currentUserEmail` sits next to `currentUserId`
// (WP13, ADR 020) and shares its exact contract — a JWT-verified claims
// read that degrades to null for an unauthenticated caller or a missing/
// non-string claim, never throws. Hermetic: the Supabase client is stubbed
// at the module seam (lib/supabase-server.ts), the same
// web/app/login/actions.test.ts convention.
import { afterEach, describe, expect, it, vi } from 'vitest';

// Structural stand-in for the one auth call both functions make — typed so
// a field-name drift in the mocked claims shape fails typecheck here
// instead of silently passing.
const { getClaims } = vi.hoisted(() => ({
  getClaims: vi.fn<() => Promise<{ data: { claims: Record<string, unknown> } | null }>>(),
}));

vi.mock('./supabase-server.ts', () => ({
  createClient: async () => ({ auth: { getClaims } }),
}));

import { currentUserEmail, currentUserId } from './current-user.ts';

afterEach(() => {
  vi.clearAllMocks();
});

describe('currentUserId', () => {
  it('returns the sub claim when present', async () => {
    getClaims.mockResolvedValue({ data: { claims: { sub: 'user-1', email: 'a@b.com' } } });

    await expect(currentUserId()).resolves.toBe('user-1');
  });

  it('null when there is no session', async () => {
    getClaims.mockResolvedValue({ data: null });

    await expect(currentUserId()).resolves.toBeNull();
  });

  it('null when sub is missing or not a string', async () => {
    getClaims.mockResolvedValue({ data: { claims: { sub: 42 } } });

    await expect(currentUserId()).resolves.toBeNull();
  });
});

describe('currentUserEmail', () => {
  it('returns the email claim when present', async () => {
    getClaims.mockResolvedValue({ data: { claims: { sub: 'user-1', email: 'a@example.com' } } });

    await expect(currentUserEmail()).resolves.toBe('a@example.com');
  });

  it('null when there is no session', async () => {
    getClaims.mockResolvedValue({ data: null });

    await expect(currentUserEmail()).resolves.toBeNull();
  });

  it('null when the email claim is missing or not a string', async () => {
    getClaims.mockResolvedValue({ data: { claims: { sub: 'user-1' } } });

    await expect(currentUserEmail()).resolves.toBeNull();

    getClaims.mockResolvedValue({ data: { claims: { sub: 'user-1', email: 12345 } } });

    await expect(currentUserEmail()).resolves.toBeNull();
  });
});

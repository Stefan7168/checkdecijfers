// WP218 phase 4 (#219): createCheckoutSession reads getLang() itself (a
// Server Action cannot see the client's LangProvider) and returns the
// already-translated error string. jsdom has no Next.js request context, so
// next/headers and lib/i18n/server.ts are both mocked.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { currentUserId } = vi.hoisted(() => ({ currentUserId: vi.fn() }));
vi.mock('../../lib/current-user.ts', () => ({ currentUserId }));
vi.mock('../../lib/db.ts', () => ({ getDb: vi.fn(() => ({})) }));

const { getPack } = vi.hoisted(() => ({ getPack: vi.fn() }));
vi.mock('../../backend/billing/index.ts', () => ({
  getPack,
  buildCheckoutSessionParams: vi.fn(() => ({})),
}));

vi.mock('next/headers', () => ({ headers: vi.fn(async () => ({ get: () => null })) }));

const { getLang } = vi.hoisted(() => ({ getLang: vi.fn() }));
vi.mock('../../lib/i18n/server.ts', () => ({ getLang }));

import { createCheckoutSession } from './actions.ts';

beforeEach(() => {
  getLang.mockResolvedValue('nl');
});

afterEach(() => {
  currentUserId.mockReset();
  getPack.mockReset();
  getLang.mockReset();
  vi.unstubAllEnvs();
});

describe('createCheckoutSession — nl (default)', () => {
  it('rejects an invalid packId', async () => {
    const result = await createCheckoutSession('');
    expect(result).toEqual({ error: 'Onbekend of niet meer beschikbaar pakket.' });
  });

  it('rejects when the visitor is not logged in', async () => {
    currentUserId.mockResolvedValue(null);
    const result = await createCheckoutSession('pack-1');
    expect(result).toEqual({ error: 'Je bent niet ingelogd.' });
  });

  it('rejects an unknown pack', async () => {
    currentUserId.mockResolvedValue('user-1');
    getPack.mockResolvedValue(null);
    const result = await createCheckoutSession('pack-1');
    expect(result).toEqual({ error: 'Onbekend of niet meer beschikbaar pakket.' });
  });

  it('fails soft when STRIPE_SECRET_KEY is not set', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    currentUserId.mockResolvedValue('user-1');
    getPack.mockResolvedValue({ id: 'pack-1', label: '100 credits' });
    delete process.env.STRIPE_SECRET_KEY;
    const result = await createCheckoutSession('pack-1');
    expect(result).toEqual({ error: 'Betalen is momenteel niet beschikbaar.' });
  });
});

describe('createCheckoutSession — en', () => {
  it('translates the invalid-pack error', async () => {
    getLang.mockResolvedValue('en');
    const result = await createCheckoutSession('');
    expect(result).toEqual({ error: 'Unknown or no longer available pack.' });
  });

  it('translates the not-logged-in error', async () => {
    getLang.mockResolvedValue('en');
    currentUserId.mockResolvedValue(null);
    const result = await createCheckoutSession('pack-1');
    expect(result).toEqual({ error: 'You are not logged in.' });
  });
});

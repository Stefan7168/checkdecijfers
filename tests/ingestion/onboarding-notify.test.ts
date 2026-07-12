// Onboarding notifications (WP16 sub-part 2, ADR 026, design §3): deterministic
// Dutch templates + an injected sender (the Stripe-signature test pattern) +
// best-effort skip when no recipient / no sender.
import { describe, expect, it, vi } from 'vitest';
import {
  buildEmail,
  buildOnboardingNotifier,
  resolveRecipientEmail,
  type OnboardingEmail,
  type OnboardingNotifyEvent,
} from '../../src/ingestion/onboarding-notify.ts';
import type { Db } from '../../src/db/types.ts';
import { createTestDb } from '../helpers/pglite-db.ts';

function event(overrides: Partial<OnboardingNotifyEvent> = {}): OnboardingNotifyEvent {
  return {
    userId: 'u1',
    questionText: 'hoeveel woningen waren er in 2024',
    topicTerm: 'woningvoorraad',
    outcome: 'delivered',
    failureSummary: null,
    refundedCredits: null,
    ...overrides,
  };
}

describe('buildEmail — deterministic Dutch templates', () => {
  it('delivered: names the topic and points back to the chat, no refund line', () => {
    const email = buildEmail('a@b.nl', event({ outcome: 'delivered' }));
    expect(email.to).toBe('a@b.nl');
    expect(email.subject).toContain('woningvoorraad');
    expect(email.text).toContain('opgehaald');
    expect(email.text.toLowerCase()).not.toContain('teruggestort');
  });

  it('unanswerable: states the refund with the real credit amount', () => {
    const email = buildEmail('a@b.nl', event({ outcome: 'unanswerable', refundedCredits: 100, failureSummary: 'geen maat' }));
    expect(email.text).toContain('100 credits');
    expect(email.text).toContain('teruggestort');
    expect(email.text).toContain('geen maat');
  });

  it('failed: refund line + failure summary', () => {
    const email = buildEmail('a@b.nl', event({ outcome: 'failed', refundedCredits: 100, failureSummary: 'CBS gaf een 500' }));
    expect(email.subject).toContain('niet gelukt');
    expect(email.text).toContain('100 credits');
    expect(email.text).toContain('CBS gaf een 500');
  });

  it('omits a hardcoded amount when refundedCredits is null (never fabricates a number)', () => {
    const email = buildEmail('a@b.nl', event({ outcome: 'failed', refundedCredits: null }));
    expect(email.text).toContain('De credits zijn');
    expect(email.text).not.toMatch(/\d+ credits/);
  });
});

describe('buildEmail — #116 dashboard deep link', () => {
  const origin = 'https://checkdecijfers.nl';

  it('delivered: appends the answer deep link when appOrigin is set', () => {
    const email = buildEmail('a@b.nl', event({ outcome: 'delivered' }), origin);
    expect(email.text).toContain('\n\nBekijk je antwoord: https://checkdecijfers.nl/');
  });

  it('unanswerable: appends the dashboard-status deep link when appOrigin is set', () => {
    const email = buildEmail(
      'a@b.nl',
      event({ outcome: 'unanswerable', refundedCredits: 100, failureSummary: 'geen maat' }),
      origin,
    );
    expect(email.text).toContain('\n\nBekijk de status in je dashboard: https://checkdecijfers.nl/');
  });

  it('failed: appends the dashboard-status deep link when appOrigin is set', () => {
    const email = buildEmail(
      'a@b.nl',
      event({ outcome: 'failed', refundedCredits: 100, failureSummary: 'CBS gaf een 500' }),
      origin,
    );
    expect(email.text).toContain('\n\nBekijk de status in je dashboard: https://checkdecijfers.nl/');
  });

  it('normalizes trailing slashes: with or without a trailing slash, the same link is produced', () => {
    const withSlash = buildEmail('a@b.nl', event({ outcome: 'delivered' }), 'https://x.nl/');
    const withoutSlash = buildEmail('a@b.nl', event({ outcome: 'delivered' }), 'https://x.nl');
    expect(withSlash.text).toContain('Bekijk je antwoord: https://x.nl/');
    expect(withSlash.text).toBe(withoutSlash.text);
  });

  it('default (appOrigin omitted) is byte-identical to appOrigin explicitly null — no link, no stray whitespace', () => {
    for (const outcomeEvent of [
      event({ outcome: 'delivered' }),
      event({ outcome: 'unanswerable', refundedCredits: 100, failureSummary: 'geen maat' }),
      event({ outcome: 'failed', refundedCredits: 100, failureSummary: 'CBS gaf een 500' }),
    ]) {
      const withDefault = buildEmail('a@b.nl', outcomeEvent);
      const withExplicitNull = buildEmail('a@b.nl', outcomeEvent, null);
      expect(withDefault.text).toBe(withExplicitNull.text);
      expect(withDefault.text).not.toContain('Bekijk');
      expect(withDefault.text.endsWith('\n')).toBe(false);
    }
  });
});

describe('buildOnboardingNotifier — best-effort', () => {
  async function withDb(fn: (db: Db) => Promise<void>): Promise<void> {
    const { db, close } = await createTestDb();
    try {
      await fn(db);
    } finally {
      await close();
    }
  }

  it('skips silently when there is no recipient (auth.users absent in the hermetic schema)', async () => {
    await withDb(async (db) => {
      const sent: OnboardingEmail[] = [];
      const notify = buildOnboardingNotifier({ db, sendEmail: async (e) => void sent.push(e), appOrigin: null });
      await notify(event());
      // No auth.users table → resolveRecipientEmail returns null → no send.
      expect(sent).toHaveLength(0);
    });
  });

  it('never throws even when the sender throws (the dashboard is the record)', async () => {
    await withDb(async (db) => {
      // Force a recipient so the sender is actually reached: stub resolve via a
      // sender that throws; use a db that HAS an email lookup by creating the
      // table so resolveRecipientEmail finds it.
      await db.query('create schema if not exists auth');
      await db.query('create table auth.users (id uuid primary key, email text)');
      await db.query("insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000001', 'x@y.nl')");
      const notify = buildOnboardingNotifier({
        db,
        sendEmail: async () => {
          throw new Error('resend down');
        },
        appOrigin: null,
      });
      await expect(
        notify(event({ userId: '00000000-0000-0000-0000-000000000001' })),
      ).resolves.toBeUndefined();
    });
  });

  it('sends to the resolved recipient with the built template', async () => {
    await withDb(async (db) => {
      await db.query('create schema if not exists auth');
      await db.query('create table auth.users (id uuid primary key, email text)');
      await db.query("insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000002', 'user@example.nl')");
      const sent: OnboardingEmail[] = [];
      const notify = buildOnboardingNotifier({ db, sendEmail: async (e) => void sent.push(e), appOrigin: null });
      await notify(event({ userId: '00000000-0000-0000-0000-000000000002', outcome: 'delivered' }));
      expect(sent).toHaveLength(1);
      expect(sent[0]!.to).toBe('user@example.nl');
      expect(sent[0]!.subject).toContain('woningvoorraad');
    });
  });

  it('threads appOrigin through to buildEmail (#116): the deep-link line reaches the stub sender', async () => {
    await withDb(async (db) => {
      await db.query('create schema if not exists auth');
      await db.query('create table auth.users (id uuid primary key, email text)');
      await db.query("insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000003', 'origin@example.nl')");
      const sent: OnboardingEmail[] = [];
      const notify = buildOnboardingNotifier({
        db,
        sendEmail: async (e) => void sent.push(e),
        appOrigin: 'https://checkdecijfers.nl',
      });
      await notify(event({ userId: '00000000-0000-0000-0000-000000000003', outcome: 'delivered' }));
      expect(sent).toHaveLength(1);
      expect(sent[0]!.text).toContain('Bekijk je antwoord: https://checkdecijfers.nl/');
    });
  });
});

describe('resolveRecipientEmail', () => {
  it('returns null (not throw) when auth.users does not exist', async () => {
    const { db, close } = await createTestDb();
    try {
      expect(await resolveRecipientEmail(db, 'anyone')).toBeNull();
    } finally {
      await close();
    }
  });
});

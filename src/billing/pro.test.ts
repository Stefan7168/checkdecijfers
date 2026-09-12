import { afterEach, describe, expect, it } from 'vitest';
import { hasProPlan } from './pro.ts';

afterEach(() => {
  delete process.env.PRO_ACCOUNT_EMAILS;
});

describe('hasProPlan', () => {
  it('is false for everyone when PRO_ACCOUNT_EMAILS is unset (fail closed)', () => {
    expect(hasProPlan({ id: 'u1', email: 'owner@example.com' })).toBe(false);
  });

  it('is true for an email listed in PRO_ACCOUNT_EMAILS', () => {
    process.env.PRO_ACCOUNT_EMAILS = 'owner@example.com, demo@example.com';
    expect(hasProPlan({ id: 'u1', email: 'owner@example.com' })).toBe(true);
    expect(hasProPlan({ id: 'u2', email: 'demo@example.com' })).toBe(true);
  });

  it('is case-insensitive on the email', () => {
    process.env.PRO_ACCOUNT_EMAILS = 'Owner@Example.com';
    expect(hasProPlan({ id: 'u1', email: 'owner@example.com' })).toBe(true);
  });

  it('is false for an email not in the list', () => {
    process.env.PRO_ACCOUNT_EMAILS = 'owner@example.com';
    expect(hasProPlan({ id: 'u1', email: 'someone-else@example.com' })).toBe(false);
  });

  it('is false when the user has no email', () => {
    process.env.PRO_ACCOUNT_EMAILS = 'owner@example.com';
    expect(hasProPlan({ id: 'u1', email: null })).toBe(false);
  });
});

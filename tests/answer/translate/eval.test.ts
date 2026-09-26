// Final-review wave (#325, I1): pins scripts/translate-eval.ts's
// isMissingFixtureMessage against the C12 meaning-check shape, not just the
// plain translate-request shape. A translate-request fixture miss surfaces
// ReplayLlmClient's fixed message (client.ts) as-is; a meaning-check fixture
// miss arrives wrapped by translate.ts (`meaning check: ${record.error}`)
// around meaning-check.ts's own `errorMessage` format (`${name}: ${message}`)
// — so the check must match the message anywhere in the string, not only at
// its start, or a missing C12 fixture silently reads as an ordinary fallback
// instead of failing the eval loudly.
import { describe, expect, it } from 'vitest';
import { isMissingFixtureMessage } from '../../../scripts/translate-eval.ts';

describe('isMissingFixtureMessage', () => {
  it('matches a plain translate-request fixture miss (the raw ReplayLlmClient message)', () => {
    expect(isMissingFixtureMessage('no recorded LLM fixture for this request (hash abc123).')).toBe(true);
  });

  it('matches a C12 meaning-check fixture miss wrapped by translate.ts + meaning-check.ts formatting', () => {
    const wrapped = 'meaning check: Error: no recorded LLM fixture for this request (hash abc123).';
    expect(isMissingFixtureMessage(wrapped)).toBe(true);
  });

  it('does not match an unrelated error', () => {
    expect(isMissingFixtureMessage('meaning check: MeaningCheckValidationError: meaning-check output is not valid JSON')).toBe(false);
    expect(isMissingFixtureMessage('ECONNRESET')).toBe(false);
  });
});

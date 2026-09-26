// ADR 058 (English answers, Task 8): the truth table for the web-layer gate —
// dormant unless BOTH the flag is on AND the reader is on English. The
// AnthropicLlmClient constructor is stubbed (no API key in tests, same
// discipline as web/app/actions.test.ts) so this suite exercises only the
// gate's own logic, never a real SDK construction.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../backend/answer/llm/client.ts', () => ({ AnthropicLlmClient: vi.fn() }));
// Final-review fix wave (ruling 19): the translate client is built on its own
// SDK instance (retries off, request timeout at the step cap) — stubbed here
// so no real SDK is constructed (no API key in tests).
vi.mock('@anthropic-ai/sdk', () => ({ default: vi.fn() }));

import Anthropic from '@anthropic-ai/sdk';
import { AnthropicLlmClient } from '../backend/answer/llm/client.ts';
import { englishAnswerOptions } from './english-answers.ts';

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('englishAnswerOptions — truth table (flag off/on × nl/en)', () => {
  it('flag unset, nl reader ⇒ {}', () => {
    vi.stubEnv('ENGLISH_ANSWERS_ENABLED', undefined);
    expect(englishAnswerOptions('nl')).toEqual({});
    expect(AnthropicLlmClient).not.toHaveBeenCalled();
  });

  it('flag unset, en reader ⇒ {} (the flag gates it, not the language alone)', () => {
    vi.stubEnv('ENGLISH_ANSWERS_ENABLED', undefined);
    expect(englishAnswerOptions('en')).toEqual({});
    expect(AnthropicLlmClient).not.toHaveBeenCalled();
  });

  it('flag on, nl reader ⇒ {} (Dutch stays byte-identical regardless of the flag)', () => {
    vi.stubEnv('ENGLISH_ANSWERS_ENABLED', '1');
    expect(englishAnswerOptions('nl')).toEqual({});
    expect(AnthropicLlmClient).not.toHaveBeenCalled();
  });

  it('flag on, en reader ⇒ { lang: \'en\', translateClient: <AnthropicLlmClient> }', () => {
    vi.stubEnv('ENGLISH_ANSWERS_ENABLED', '1');
    const result = englishAnswerOptions('en');
    expect(result.lang).toBe('en');
    expect(result.translateClient).toBeInstanceOf(AnthropicLlmClient);
    expect(AnthropicLlmClient).toHaveBeenCalledTimes(1);
  });

  it('a non-\'1\' flag value (e.g. "true") stays dormant — only the literal \'1\' arms it', () => {
    vi.stubEnv('ENGLISH_ANSWERS_ENABLED', 'true');
    expect(englishAnswerOptions('en')).toEqual({});
  });
});

describe('englishAnswerOptions — the translate client never outlives the step cap (ruling 19)', () => {
  it('flag on, en reader ⇒ the SDK is built with retries off and a request timeout at the 20 s cap', () => {
    vi.stubEnv('ENGLISH_ANSWERS_ENABLED', '1');
    englishAnswerOptions('en');
    expect(Anthropic).toHaveBeenCalledTimes(1);
    expect(Anthropic).toHaveBeenCalledWith({ maxRetries: 0, timeout: 20_000 });
    const sdk = vi.mocked(Anthropic).mock.instances[0];
    expect(AnthropicLlmClient).toHaveBeenCalledWith(sdk);
  });

  it('flag off ⇒ no SDK is constructed at all', () => {
    vi.stubEnv('ENGLISH_ANSWERS_ENABLED', undefined);
    englishAnswerOptions('en');
    expect(Anthropic).not.toHaveBeenCalled();
  });
});

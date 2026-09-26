// ADR 058 (English answers, Task 8): the truth table for the web-layer gate —
// dormant unless BOTH the flag is on AND the reader is on English. The
// AnthropicLlmClient constructor is stubbed (no API key in tests, same
// discipline as web/app/actions.test.ts) so this suite exercises only the
// gate's own logic, never a real SDK construction.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../backend/answer/llm/client.ts', () => ({ AnthropicLlmClient: vi.fn() }));

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

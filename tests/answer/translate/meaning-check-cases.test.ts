import { describe, expect, it } from 'vitest';
import { checkTranslation } from '../../../src/answer/translate/check.ts';
import { MEANING_CHECK_CASES } from '../../helpers/meaning-check-cases.ts';

describe('meaning-check labelled set: structural guards', () => {
  it('has both labels and unique ids', () => {
    const ids = MEANING_CHECK_CASES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(MEANING_CHECK_CASES.some((c) => c.expected === 'same')).toBe(true);
    expect(MEANING_CHECK_CASES.some((c) => c.expected === 'different')).toBe(true);
  });

  it.each(MEANING_CHECK_CASES.map((c) => [c.id, c] as const))('%s passes C1–C11 (otherwise it measures nothing about C12)', (_id, c) => {
    expect(checkTranslation({ maskedDutch: c.maskedDutch, english: c.english, glossary: c.glossary, maskTable: c.maskTable })).toEqual([]);
  });
});

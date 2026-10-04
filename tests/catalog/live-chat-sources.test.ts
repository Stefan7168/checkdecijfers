// Owner decision 2026-10-04 (the Eurostat chip): liveChatSourceKeys() is the ONE gate for which sources the
// chat offers and the server accepts — registry `chatSelectable` AND, for Eurostat, EUROSTAT_FINDER_ENABLED.
import { afterEach, describe, expect, it } from 'vitest';
import { liveChatSourceKeys } from '../../src/catalog/live-chat-sources.ts';

describe('liveChatSourceKeys', () => {
  const saved = process.env.EUROSTAT_FINDER_ENABLED;
  afterEach(() => {
    if (saved === undefined) delete process.env.EUROSTAT_FINDER_ENABLED;
    else process.env.EUROSTAT_FINDER_ENABLED = saved;
  });

  it('flag unset: CBS only — the chip row and the validation are what they were before the Eurostat chip', () => {
    delete process.env.EUROSTAT_FINDER_ENABLED;
    expect(liveChatSourceKeys()).toEqual(['cbs']);
  });

  it('only the exact value 1 adds Eurostat (CBS first, then Eurostat — chip order)', () => {
    for (const value of ['0', 'true', 'yes', ' 1', '']) {
      process.env.EUROSTAT_FINDER_ENABLED = value;
      expect(liveChatSourceKeys(), JSON.stringify(value)).toEqual(['cbs']);
    }
    process.env.EUROSTAT_FINDER_ENABLED = '1';
    expect(liveChatSourceKeys()).toEqual(['cbs', 'eurostat']);
  });

  it('is read at call time (the flag can flip between two calls)', () => {
    process.env.EUROSTAT_FINDER_ENABLED = '1';
    expect(liveChatSourceKeys()).toContain('eurostat');
    delete process.env.EUROSTAT_FINDER_ENABLED;
    expect(liveChatSourceKeys()).not.toContain('eurostat');
  });
});

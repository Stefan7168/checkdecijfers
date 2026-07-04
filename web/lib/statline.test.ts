// statLineUrl (WP23, open-questions #86): pinned against real StatLine URLs
// for tables actually in the Phase 0 set — hardcoded literals, so a portal
// URL-shape change is a deliberate edit here, never silent drift.
import { describe, expect, it } from 'vitest';
import { statLineUrl } from './statline.ts';

describe('statLineUrl', () => {
  it('builds the real CPI table URL (86141NED)', () => {
    expect(statLineUrl('86141NED')).toBe(
      'https://opendata.cbs.nl/statline/#/CBS/nl/dataset/86141NED/table',
    );
  });

  it('keeps a lowercase CBS id verbatim — casing is load-bearing (03759ned)', () => {
    expect(statLineUrl('03759ned')).toBe(
      'https://opendata.cbs.nl/statline/#/CBS/nl/dataset/03759ned/table',
    );
  });
});

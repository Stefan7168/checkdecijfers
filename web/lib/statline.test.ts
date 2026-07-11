// Source deep-links (WP23 #86, consolidated onto the source registry in
// WP30a/ADR 030 D3): pinned against real StatLine URLs for tables actually
// in the Phase 0 set — hardcoded literals, so a portal URL-shape change is a
// deliberate edit here, never silent drift. The absent-source cases pin A1:
// historical answers (no source key) resolve to 'cbs' byte-identically.
import { describe, expect, it } from 'vitest';
import { sourceLinkLabel, sourceTableUrl } from './statline.ts';

describe('sourceTableUrl', () => {
  it('builds the real CPI table URL (86141NED) for the cbs key', () => {
    expect(sourceTableUrl('cbs', '86141NED')).toBe(
      'https://opendata.cbs.nl/statline/#/CBS/nl/dataset/86141NED/table',
    );
  });

  it('keeps a lowercase CBS id verbatim — casing is load-bearing (03759ned)', () => {
    expect(sourceTableUrl('cbs', '03759ned')).toBe(
      'https://opendata.cbs.nl/statline/#/CBS/nl/dataset/03759ned/table',
    );
  });

  it('A1: an absent source (pre-WP30a answers) resolves to the cbs URL byte-identically', () => {
    expect(sourceTableUrl(undefined, '86141NED')).toBe(
      'https://opendata.cbs.nl/statline/#/CBS/nl/dataset/86141NED/table',
    );
  });
});

describe('sourceLinkLabel', () => {
  it('renders the exact pre-WP30a label for cbs and for absent source', () => {
    expect(sourceLinkLabel('cbs')).toBe('Bekijk bij CBS StatLine');
    expect(sourceLinkLabel(undefined)).toBe('Bekijk bij CBS StatLine');
  });
});

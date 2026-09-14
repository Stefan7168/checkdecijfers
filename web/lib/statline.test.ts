// Source deep-links (WP23 #86, consolidated onto the source registry in
// WP30a/ADR 030 D3): pinned against real StatLine URLs for tables actually
// in the Phase 0 set — hardcoded literals, so a portal URL-shape change is a
// deliberate edit here, never silent drift. The absent-source cases pin A1:
// historical answers (no source key) resolve to 'cbs' byte-identically.
import { describe, expect, it } from 'vitest';
import { cbsHighlightUrl, sourceLinkLabel, sourceTableUrl } from './statline.ts';

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

describe('cbsHighlightUrl', () => {
  it('appends a prefix-disambiguated text-fragment directive after the table URL', () => {
    expect(cbsHighlightUrl('cbs', '86141NED', '2026 juni', 102.39, 2)).toBe(
      'https://opendata.cbs.nl/statline/#/CBS/nl/dataset/86141NED/table:~:text=2026%20juni-,102%2C39',
    );
  });

  it('converts formatValueNl\'s period thousands grouping to StatLine\'s own space grouping', () => {
    expect(cbsHighlightUrl('cbs', '03759ned', '2026', 742783, 0)).toBe(
      'https://opendata.cbs.nl/statline/#/CBS/nl/dataset/03759ned/table:~:text=2026-,742%20783',
    );
  });

  it('returns null for a null-valued cell — nothing to highlight', () => {
    expect(cbsHighlightUrl('cbs', '86141NED', '2026 juni', null, 2)).toBeNull();
  });
});

// @vitest-environment node
// WP-LOOK part (a2) (session 143): the Open Graph image route returns a real
// 1200×630 PNG for a valid share token, and the neutral brand PNG (never an
// error, never a number) when the token resolves to nothing.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { verifyEmbedToken } = vi.hoisted(() => ({ verifyEmbedToken: vi.fn() }));
vi.mock('../../../backend/chart/embed-token.ts', () => ({ verifyEmbedToken }));
const { loadAuditRecord } = vi.hoisted(() => ({ loadAuditRecord: vi.fn() }));
vi.mock('../../../backend/answer/audit/index.ts', () => ({
  loadAuditRecord,
  isRedacted: (response: unknown) =>
    typeof response === 'object' && response !== null && (response as { redacted?: unknown }).redacted === true,
}));
vi.mock('../../../lib/db.ts', () => ({ getDb: () => ({}) }));
const { getChartHeadlinePublic } = vi.hoisted(() => ({ getChartHeadlinePublic: vi.fn(async () => null as string | null) }));
vi.mock('../../../backend/chart/headline-store.ts', () => ({ getChartHeadlinePublic }));

import Image, { contentType, size } from './opengraph-image.tsx';

function chartSpec() {
  return {
    schemaVersion: 1,
    kind: 'line',
    title: 'Testreeks',
    dims: { Kenmerk: '000000' },
    dimLabels: { Kenmerk: 'Alle kenmerken' },
    unit: '%',
    series: [
      {
        label: 'Nederland',
        regionCode: 'NL01',
        points: [
          { resultId: 'r1', periodCode: '2023JJ00', periodLabel: '2023', value: 4.1, formattedValue: '4,1', decimals: 1, status: 'final', provisional: false, valueAttribute: 'Value' },
          { resultId: 'r2', periodCode: '2024JJ00', periodLabel: '2024', value: 3.3, formattedValue: '3,3', decimals: 1, status: 'final', provisional: false, valueAttribute: 'Value' },
        ],
      },
    ],
    provisionalNote: null,
    nullNotes: [],
    definitionLine: null,
    // The em dash and the non-ASCII word are deliberate: a real CBS attribution
    // line carries both, and the first visual run threw on them (see svgDataUri).
    attributionLine: 'Bron: CBS StatLine, tabel 83693NED — Consumentenprijzen; officiële cijfers.',
    attribution: { tableId: '83693NED', tableTitle: 'Test', tableVersion: 1, syncedAt: '2026-08-26', coveredPeriods: { from: '2023', to: '2024' }, license: 'CC BY 4.0' },
  };
}

function pngSize(bytes: Uint8Array): { width: number; height: number } {
  // PNG signature (8 bytes) + IHDR length/type (8 bytes) + width/height (4+4, big-endian).
  expect(Array.from(bytes.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

async function renderFor(token: string): Promise<Uint8Array> {
  const res = await Image({ params: Promise.resolve({ token }) });
  expect(res.headers.get('content-type')).toContain('image/png');
  return new Uint8Array(await res.arrayBuffer());
}

describe('embed opengraph-image', () => {
  beforeEach(() => {
    process.env.EMBED_TOKEN_SECRET = 'test-secret';
    verifyEmbedToken.mockReset();
    loadAuditRecord.mockReset();
  });

  it('declares the platform size and PNG type', () => {
    expect(size).toEqual({ width: 1200, height: 630 });
    expect(contentType).toBe('image/png');
  });

  it('a valid token renders a 1200×630 PNG of the stored chart', async () => {
    verifyEmbedToken.mockReturnValue(7);
    loadAuditRecord.mockResolvedValue({ id: 7, response: { kind: 'answer', chart: chartSpec() } });
    const bytes = await renderFor('7.sig');
    expect(pngSize(bytes)).toEqual({ width: 1200, height: 630 });
    expect(bytes.length).toBeGreaterThan(5000);
  }, 60_000);

  it('an invalid token, a missing record or a redacted answer still returns the neutral PNG', async () => {
    verifyEmbedToken.mockReturnValue(null);
    const invalid = await renderFor('nope');
    expect(pngSize(invalid)).toEqual({ width: 1200, height: 630 });

    verifyEmbedToken.mockReturnValue(8);
    loadAuditRecord.mockResolvedValue(null);
    expect(pngSize(await renderFor('8.sig'))).toEqual({ width: 1200, height: 630 });

    loadAuditRecord.mockResolvedValue({ id: 8, response: { kind: 'answer', chart: chartSpec(), redacted: true } });
    const redacted = await renderFor('8.sig');
    expect(pngSize(redacted)).toEqual({ width: 1200, height: 630 });
    // The neutral card is byte-identical whatever the reason.
    expect(Buffer.from(redacted).equals(Buffer.from(invalid))).toBe(true);
  }, 60_000);
});

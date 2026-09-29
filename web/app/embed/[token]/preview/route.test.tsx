// @vitest-environment node
// WP-LOOK part (a2) round 2 (session 144): the share-preview picture as a
// route handler — real rasterisation through Next's image tool with the
// bundled Inter files, the reader's form from the query, the download flag.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { verifyEmbedToken } = vi.hoisted(() => ({ verifyEmbedToken: vi.fn() }));
vi.mock('../../../../backend/chart/embed-token.ts', () => ({ verifyEmbedToken }));
const { loadAuditRecord } = vi.hoisted(() => ({ loadAuditRecord: vi.fn() }));
vi.mock('../../../../backend/answer/audit/index.ts', () => ({
  loadAuditRecord,
  isRedacted: (r: { redacted?: boolean }) => r.redacted === true,
}));
vi.mock('../../../../lib/db.ts', () => ({ getDb: () => ({}) }));
const { getChartHeadlinePublic } = vi.hoisted(() => ({ getChartHeadlinePublic: vi.fn(async () => null as string | null) }));
vi.mock('../../../../backend/chart/headline-store.ts', () => ({ getChartHeadlinePublic }));

import { GET } from './route.tsx';
import { loadPreviewFonts } from '../../../../lib/share-preview-fonts.ts';

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
  expect(Array.from(bytes.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

async function get(token: string, query = ''): Promise<Response> {
  const req = new NextRequest(`http://localhost/embed/${token}/preview${query}`);
  return GET(req, { params: Promise.resolve({ token }) });
}

async function bytesOf(res: Response): Promise<Uint8Array> {
  expect(res.headers.get('content-type')).toContain('image/png');
  return new Uint8Array(await res.arrayBuffer());
}

describe('embed preview route', () => {
  beforeEach(() => {
    process.env.EMBED_TOKEN_SECRET = 'test-secret';
    verifyEmbedToken.mockReset();
    loadAuditRecord.mockReset();
  });

  it('ships Inter in three weights from the repo', async () => {
    const fonts = await loadPreviewFonts();
    expect(fonts.map((f) => f.weight)).toEqual([400, 600, 700]);
    for (const f of fonts) {
      expect(f.name).toBe('Inter');
      expect(f.data.byteLength).toBeGreaterThan(100_000);
    }
  });

  it('a valid token renders a 1200×630 PNG of the stored chart, cacheable, inline', async () => {
    verifyEmbedToken.mockReturnValue(7);
    loadAuditRecord.mockResolvedValue({ id: 7, response: { kind: 'answer', chart: chartSpec() } });
    const res = await get('7.sig');
    expect(res.headers.get('cache-control')).toContain('s-maxage=3600');
    expect(res.headers.get('content-disposition')).toBeNull();
    const bytes = await bytesOf(res);
    expect(pngSize(bytes)).toEqual({ width: 1200, height: 630 });
    expect(bytes.length).toBeGreaterThan(5000);
  }, 60_000);

  it('follows the reader\'s form (bars differ from the line) and offers the file with ?download=1', async () => {
    verifyEmbedToken.mockReturnValue(7);
    loadAuditRecord.mockResolvedValue({ id: 7, response: { kind: 'answer', chart: chartSpec() } });
    const line = await bytesOf(await get('7.sig'));
    const bars = await bytesOf(await get('7.sig', '?form=bar'));
    expect(Buffer.from(bars).equals(Buffer.from(line))).toBe(false);
    const download = await get('7.sig', '?form=bar&download=1');
    expect(download.headers.get('content-disposition')).toBe('attachment; filename="graphmaker-83693NED-deelafbeelding.png"');
    expect(Buffer.from(await bytesOf(download)).equals(Buffer.from(bars))).toBe(true);
  }, 90_000);

  it('an invalid token, a missing record or a redacted answer still returns the neutral PNG', async () => {
    verifyEmbedToken.mockReturnValue(null);
    const invalid = await bytesOf(await get('nope'));
    expect(pngSize(invalid)).toEqual({ width: 1200, height: 630 });

    verifyEmbedToken.mockReturnValue(8);
    loadAuditRecord.mockResolvedValue(null);
    expect(pngSize(await bytesOf(await get('8.sig')))).toEqual({ width: 1200, height: 630 });

    loadAuditRecord.mockResolvedValue({ id: 8, response: { kind: 'answer', chart: chartSpec(), redacted: true } });
    const redacted = await bytesOf(await get('8.sig'));
    // The neutral card is byte-identical whatever the reason.
    expect(Buffer.from(redacted).equals(Buffer.from(invalid))).toBe(true);
  }, 60_000);
});

// #355: the shared read-only scan behind both `npm run ingest:freshness` and the daily cron's
// new-CBS-data alert. Fake Db + stub source — no network, no real database.
import { describe, expect, it, vi } from 'vitest';
import type { Db } from '../../src/db/types.ts';
import type { SourceAdapter } from '../../src/sources/adapters.ts';
import { scanFreshness } from '../../src/ingestion/freshness-check.ts';
import type { CbsCatalogEntry } from '../../src/cbs-adapter/types.ts';
import { assessEurostatFreshness, assessFreshness } from '../../src/ingestion/freshness.ts';

function fakeDb(rows: Record<string, unknown>[]): { db: Db; sql: string[] } {
  const sql: string[] = [];
  const db = {
    query: async (text: string) => {
      sql.push(text);
      return { rows };
    },
    withTransaction: async () => {
      throw new Error('scanFreshness must never open a transaction');
    },
  } as unknown as Db;
  return { db, sql };
}

function fakeSource(modifiedByTable: Record<string, string | null | Error>): SourceAdapter {
  return {
    fetchTableSchema: vi.fn(async (tableId: string) => {
      const m = modifiedByTable[tableId];
      if (m instanceof Error) throw m;
      return { tableId, title: tableId, dimensions: [], measures: [], modified: m ?? null };
    }),
  } as unknown as SourceAdapter;
}

describe('scanFreshness', () => {
  it('reads CBS\'s date per served CBS table, skips other sources, and only ever runs one SELECT', async () => {
    const { db, sql } = fakeDb([
      { id: '84584NED', last_sync_at: new Date('2026-09-29T10:00:00.000Z'), slice: null, schema_fingerprint: 'fp-a' },
      { id: '85615NED', last_sync_at: '2026-08-26T10:00:00.000Z', slice: '{"Perioden":["2026KW02"]}', schema_fingerprint: null },
      { id: 'eurostat:tipsbd30', last_sync_at: '2026-09-29T10:00:00.000Z', slice: null, schema_fingerprint: 'fp-e' },
    ]);
    const source = fakeSource({ '84584NED': '2026-09-23T06:30:00+02:00', '85615NED': '2026-09-23T06:30:00+02:00' });
    const scan = await scanFreshness(db, source);

    expect(sql).toHaveLength(1);
    expect(sql[0]).toMatch(/^\s*select /i);
    expect(scan.notChecked).toEqual(['eurostat:tipsbd30']);
    // Without a catalogue supplier the scan is exactly what the cron alert has always seen.
    expect('eurostatInputs' in scan).toBe(false);
    expect('eurostatError' in scan).toBe(false);
    expect(scan.registered.get('85615NED')).toEqual({ slice: { Perioden: ['2026KW02'] }, fingerprint: null });
    expect(scan.registered.get('84584NED')).toEqual({ slice: null, fingerprint: 'fp-a' });
    const findings = assessFreshness(scan.inputs);
    expect(findings.map((f) => [f.tableId, f.status])).toEqual([
      ['85615NED', 'behind'],
      ['84584NED', 'current'],
    ]);
  });

  it('a table whose CBS date cannot be read is reported to the callback and lands as unknown, never current', async () => {
    const { db } = fakeDb([
      { id: '84584NED', last_sync_at: '2026-09-29T10:00:00.000Z', slice: null, schema_fingerprint: null },
    ]);
    const onReadError = vi.fn();
    const scan = await scanFreshness(db, fakeSource({ '84584NED': new Error('CBS down') }), onReadError);
    expect(onReadError).toHaveBeenCalledOnce();
    expect(onReadError.mock.calls[0]![0]).toBe('84584NED');
    expect(scan.inputs).toEqual([{ tableId: '84584NED', lastSyncAt: '2026-09-29T10:00:00.000Z', cbsModifiedAt: null }]);
    expect(assessFreshness(scan.inputs)[0]!.status).toBe('unknown');
  });

  it('a table that was never synced keeps lastSyncAt null (unknown, not behind)', async () => {
    const { db } = fakeDb([{ id: '84584NED', last_sync_at: null, slice: null, schema_fingerprint: null }]);
    const scan = await scanFreshness(db, fakeSource({ '84584NED': '2026-09-23T00:00:00.000Z' }));
    expect(scan.inputs[0]!.lastSyncAt).toBeNull();
    expect(assessFreshness(scan.inputs)[0]!.status).toBe('unknown');
  });
});

describe('scanFreshness with a Eurostat catalogue supplier (#357)', () => {
  const eu = (code: string, dataEnd: string): CbsCatalogEntry => ({
    tableId: `eurostat:${code}`,
    title: code,
    summary: '',
    status: null,
    datasetType: 'dataset',
    language: 'en',
    modified: '2026-09-17',
    dataStart: '2000',
    dataEnd,
    valueCount: 1,
  });
  const rows = () => [
    { id: '84584NED', last_sync_at: '2026-09-29T10:00:00.000Z', slice: null, schema_fingerprint: null },
    { id: 'eurostat:prc_hicp_manr', last_sync_at: '2026-09-29T10:00:00.000Z', slice: null, schema_fingerprint: null },
    { id: 'eurostat:une_rt_q', last_sync_at: '2026-09-29T10:00:00.000Z', slice: null, schema_fingerprint: null },
    { id: 'eurostat:gone_dataset', last_sync_at: '2026-09-29T10:00:00.000Z', slice: null, schema_fingerprint: null },
  ];

  it('fetches the catalogue ONCE for all Eurostat tables, hands each its own row (null when absent), and leaves CBS alone', async () => {
    const fetchCatalog = vi.fn(async () => [eu('prc_hicp_manr', '2025-12'), eu('une_rt_q', '2026-Q2'), eu('prc_hicp_manr', '1999')]);
    const scan = await scanFreshness(fakeDb(rows()).db, fakeSource({ '84584NED': '2026-09-23T00:00:00.000Z' }), () => {}, fetchCatalog);
    expect(fetchCatalog).toHaveBeenCalledOnce();
    expect(scan.notChecked).toEqual([]);
    expect(scan.inputs.map((i) => i.tableId)).toEqual(['84584NED']);
    expect(scan.eurostatInputs!.map((i) => [i.tableId, i.entry?.dataEnd ?? null])).toEqual([
      ['eurostat:prc_hicp_manr', '2025-12'], // the first catalogue row wins if a code is listed twice
      ['eurostat:une_rt_q', '2026-Q2'],
      ['eurostat:gone_dataset', null],
    ]);
    const now = new Date('2026-09-30T12:00:00.000Z');
    expect(scan.eurostatInputs!.map((i) => assessEurostatFreshness(i, now).status)).toEqual(['possibly_frozen', 'current', 'unknown']);
  });

  it('does not download the catalogue when no Eurostat table is served', async () => {
    const fetchCatalog = vi.fn(async () => []);
    const scan = await scanFreshness(fakeDb([rows()[0]!]).db, fakeSource({ '84584NED': null }), () => {}, fetchCatalog);
    expect(fetchCatalog).not.toHaveBeenCalled();
    expect(scan.eurostatInputs).toEqual([]);
  });

  it('a failed catalogue download leaves the CBS part intact, keeps the tables in notChecked and says why', async () => {
    const scan = await scanFreshness(
      fakeDb(rows()).db,
      fakeSource({ '84584NED': '2026-09-23T00:00:00.000Z' }),
      () => {},
      async () => {
        throw new Error('HTTP 503');
      },
    );
    expect(scan.inputs).toHaveLength(1);
    expect(scan.notChecked).toEqual(['eurostat:prc_hicp_manr', 'eurostat:une_rt_q', 'eurostat:gone_dataset']);
    expect(scan.eurostatError).toMatch(/503/);
    expect(scan.eurostatInputs).toBeUndefined();
  });
});

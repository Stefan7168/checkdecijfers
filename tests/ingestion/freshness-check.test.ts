// #355: the shared read-only scan behind both `npm run ingest:freshness` and the daily cron's
// new-CBS-data alert. Fake Db + stub source — no network, no real database.
import { describe, expect, it, vi } from 'vitest';
import type { Db } from '../../src/db/types.ts';
import type { SourceAdapter } from '../../src/sources/adapters.ts';
import { scanFreshness } from '../../src/ingestion/freshness-check.ts';
import { assessFreshness } from '../../src/ingestion/freshness.ts';

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

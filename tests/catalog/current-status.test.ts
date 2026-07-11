// WP30b (A6): the registry-driven catalog-current predicate. Two load-bearing
// claims: (1) the SQL's per-row source derivation agrees EXACTLY with
// sourceKeyForTableId (the D4 rule must have one meaning in two languages),
// and (2) for the real SOURCES map the predicate is byte-identical in effect
// to the pre-WP30b literal `coalesce(status,'') = 'Regulier'` — the finder's
// shortlist (and thus every recorded rerank request hash) must not move.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildIsCurrentPredicate } from '../../src/catalog/current-status.ts';
import { SOURCES, sourceKeyForTableId, type SourceInfo } from '../../src/sources/registry.ts';
import { fakeSourceInfo } from '../helpers/fake-source-info.ts';
import { createTestDb } from '../helpers/pglite-db.ts';
import type { Db } from '../../src/db/types.ts';

let db: Db;
let close: () => Promise<void>;

beforeAll(async () => {
  const t = await createTestDb();
  db = t.db;
  close = t.close;
  await db.query(`create table _pred_probe (table_id text not null, status text)`, []);
});

afterAll(async () => {
  await close();
});

async function evaluate(
  sources: Readonly<Record<string, SourceInfo>>,
  rows: Array<[string, string | null]>,
): Promise<Array<{ tableId: string; status: string | null; isCurrent: boolean }>> {
  await db.query('delete from _pred_probe', []);
  for (const [tableId, status] of rows) {
    await db.query('insert into _pred_probe (table_id, status) values ($1, $2)', [tableId, status]);
  }
  const pred = buildIsCurrentPredicate(sources, 1);
  const { rows: out } = await db.query(
    `select table_id, status, (${pred.sql}) as is_current from _pred_probe order by table_id, coalesce(status, '')`,
    [...pred.params],
  );
  return out.map((r) => ({
    tableId: r.table_id as string,
    status: (r.status as string | null) ?? null,
    isCurrent: r.is_current === true,
  }));
}

describe('buildIsCurrentPredicate', () => {
  it('byte-identity: with the real SOURCES map it behaves exactly like the old Regulier literal', async () => {
    const rows: Array<[string, string | null]> = [
      ['03759ned', 'Regulier'],
      ['82235NED', 'Gediscontinueerd'],
      ['85615NED', 'Vervallen'],
      ['85224NED', null],
    ];
    const out = await evaluate(SOURCES, rows);
    for (const r of out) {
      expect(r.isCurrent).toBe(r.status === 'Regulier');
    }
  });

  it('per-row source consultation: each source\'s OWN current set decides (A6)', async () => {
    const sources = {
      cbs: SOURCES['cbs']!,
      fake: fakeSourceInfo({ currentCatalogStatuses: ['Actueel'] }),
    };
    const out = await evaluate(sources, [
      ['12345NED', 'Regulier'],
      ['12345NED', 'Actueel'],
      ['fake:t1', 'Actueel'],
      ['fake:t2', 'Regulier'],
    ]);
    const byKey = new Map(out.map((r) => [`${r.tableId}|${r.status}`, r.isCurrent]));
    expect(byKey.get('12345NED|Regulier')).toBe(true);
    expect(byKey.get('12345NED|Actueel')).toBe(false); // cbs does not declare Actueel current
    expect(byKey.get('fake:t1|Actueel')).toBe(true);
    expect(byKey.get('fake:t2|Regulier')).toBe(false); // fake does not declare Regulier current
  });

  it('fail-safe: an unregistered or malformed prefix is never current', async () => {
    const out = await evaluate(SOURCES, [
      ['unknown:x', 'Regulier'],
      [':oops', 'Regulier'],
    ]);
    for (const r of out) expect(r.isCurrent).toBe(false);
  });

  it('the SQL source derivation agrees with sourceKeyForTableId on every edge shape', async () => {
    const ids = ['37789ksz', '85773NED', 'politie:47022NED', 'a:b:c', ':oops', 'cbs:sneaky'];
    const { rows } = await db.query(
      `select t.id,
              (case when position(':' in t.id) > 0 then split_part(t.id, ':', 1) else 'cbs' end) as sql_key
         from unnest($1::text[]) as t(id)`,
      [ids],
    );
    for (const row of rows) {
      expect(row.sql_key as string).toBe(sourceKeyForTableId(row.id as string));
    }
  });

  it('parameter indexes start where the caller says and params match the sorted source order', () => {
    const sources = { cbs: SOURCES['cbs']!, fake: fakeSourceInfo() };
    const pred = buildIsCurrentPredicate(sources, 7);
    expect(pred.sql).toContain("when 'cbs' then coalesce(status, '') = any($7::text[])");
    expect(pred.sql).toContain("when 'fake' then coalesce(status, '') = any($8::text[])");
    expect(pred.sql).toContain('else false');
    expect(pred.params).toEqual([['Regulier'], ['Actueel']]);
  });
});

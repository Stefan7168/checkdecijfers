// Session 110 UX audit pass 3, row 5: the Eurostat explorer's only
// registered table (demo_pjan) has a geo dimension, and the explorer's
// intent-building glue (buildIntent, this module) sent no region for it —
// every query landed on resolve.ts's region-missing gate and refused to
// "Kun je aangeven voor welke regio?", a clarification the form had no
// field to answer. Pins `geoDimensionForTable`, the new function that reads
// a table's real expected_dimensions + dimension_labels (never invents a
// geography) so the form can render a real region picker.
import { describe, expect, it, vi } from 'vitest';
import type { Db } from '../backend/db/types.ts';
import { geoDimensionForTable } from './eurostat-explorer.ts';

/** A minimal query-recording fake: each call is answered by the next entry
 * in `responses`, in order — enough to exercise geoDimensionForTable's two
 * sequential queries (expected_dimensions, then dimension_labels) without a
 * real database. */
function fakeDb(responses: unknown[][]): Db {
  let call = 0;
  const query = vi.fn(async () => ({ rows: responses[call++] ?? [] }));
  return { query } as unknown as Db;
}

describe('geoDimensionForTable', () => {
  it('returns null for a table with no GeoDimension in expected_dimensions — the untouched pre-fix shape', async () => {
    const db = fakeDb([[{ expected_dimensions: JSON.stringify([{ name: 'time', kind: 'TimeDimension' }]) }]]);
    const geo = await geoDimensionForTable(db, 'eurostat:some_national_only_table');
    expect(geo).toBeNull();
  });

  it('returns null when the table row itself is absent (never registered)', async () => {
    const db = fakeDb([[]]);
    const geo = await geoDimensionForTable(db, 'eurostat:unregistered');
    expect(geo).toBeNull();
  });

  it('reads the geo dimension name and its own roster, sorted by sort_index then code', async () => {
    const db = fakeDb([
      [{ expected_dimensions: JSON.stringify([{ name: 'geo', kind: 'GeoDimension' }]) }],
      [
        { code: 'NL', label: 'Netherlands' },
        { code: 'BE', label: 'Belgium' },
      ],
    ]);
    const geo = await geoDimensionForTable(db, 'eurostat:demo_pjan');
    expect(geo).toEqual({
      dimension: 'geo',
      options: [
        { code: 'NL', label: 'Netherlands' },
        { code: 'BE', label: 'Belgium' },
      ],
      defaultCode: null,
    });
  });

  it('accepts expected_dimensions as an already-parsed array (PGlite/driver may not stringify jsonb)', async () => {
    const db = fakeDb([
      [{ expected_dimensions: [{ name: 'geo', kind: 'GeoDimension' }] }],
      [{ code: 'NL', label: 'Netherlands' }],
    ]);
    const geo = await geoDimensionForTable(db, 'eurostat:demo_pjan');
    expect(geo?.dimension).toBe('geo');
  });

  it('defaults to EU27_2020 only when the table\'s own roster actually contains it — never invented', async () => {
    const db = fakeDb([
      [{ expected_dimensions: JSON.stringify([{ name: 'geo', kind: 'GeoDimension' }]) }],
      [
        { code: 'NL', label: 'Netherlands' },
        { code: 'EU27_2020', label: 'European Union - 27 countries (from 2020)' },
      ],
    ]);
    const geo = await geoDimensionForTable(db, 'eurostat:demo_pjan');
    expect(geo?.defaultCode).toBe('EU27_2020');
  });

  it('queries dimension_labels scoped to THIS table and THIS dimension, capped at 200 rows', async () => {
    const db = fakeDb([
      [{ expected_dimensions: JSON.stringify([{ name: 'geo', kind: 'GeoDimension' }]) }],
      [],
    ]);
    await geoDimensionForTable(db, 'eurostat:demo_pjan');
    const calls = (db.query as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[1]![0]).toMatch(/dimension_labels/);
    expect(calls[1]![1]).toEqual(['eurostat:demo_pjan', 'geo', 200]);
  });
});

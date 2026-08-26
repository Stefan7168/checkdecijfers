// #155 (session-47 ingestion hunt): freshestForCanonical is a freshness-METADATA
// helper called OUTSIDE resolveIntent's quarantine gate (the forecast/causal
// refusal offers in src/answer/respond/refusals.ts and the echoServability
// dry-run). The value path already refuses a needs_review table
// (resolve.ts, 'table_quarantined'); this pins that the metadata helper does too
// — a quarantined table must offer NO freshest-period label either.
//
// Own isolated ingested db: the test mutates cbs_tables.status, which must never
// leak into the shared query suite.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { freshestForCanonical } from '../../src/query/index.ts';
import type { Db } from '../../src/db/types.ts';
import { createIngestedDb } from '../helpers/ingested-db.ts';

let db: Db;
let close: () => Promise<void>;
let canonicalKey: string;
let tableId: string;

beforeAll(async () => {
  ({ db, close } = await createIngestedDb());
  // Use whatever canonical measure the seed provides — no hardcoded key.
  const { rows } = await db.query('select key, table_id from canonical_measures limit 1');
  canonicalKey = rows[0]!.key as string;
  tableId = rows[0]!.table_id as string;
});

afterAll(async () => {
  await close();
});

describe('#178 freshestForCanonical honors an explicit region/grain override', () => {
  // population_on_1_january, not the arbitrary beforeAll key: these tests
  // need to know the table's real shape (single grain 'JJ', real region rows
  // keyed 'NL01'/'GMnnnn') to construct a deterministic "does not match"
  // case, which an arbitrary first-row canonical can't promise.
  const KEY = 'population_on_1_january';

  it('an explicit grain matching the data returns the same result as the default call', async () => {
    const byDefault = await freshestForCanonical(db, KEY);
    expect(byDefault).not.toBeNull();
    const explicit = await freshestForCanonical(db, KEY, { grain: 'JJ' });
    expect(explicit).toEqual(byDefault);
  });

  it('a grain the table does not carry returns null, not some other grain\'s freshest', async () => {
    // Ground-truthed against the fixture: population_on_1_january's table
    // only ingests 'JJ' rows.
    expect(await freshestForCanonical(db, KEY, { grain: 'MM' })).toBeNull();
  });

  it('an explicit region matching the default returns the same result', async () => {
    const byDefault = await freshestForCanonical(db, KEY);
    expect(byDefault).not.toBeNull();
    const explicit = await freshestForCanonical(db, KEY, { regionCode: 'NL01' });
    expect(explicit).toEqual(byDefault);
  });

  it('a region the table has no rows for returns null, not the national default', async () => {
    // #178: this is exactly what makes clickOptionStillCurrent's region
    // check meaningful — without the override actually restricting the
    // query, a nonexistent region would silently read back the national row.
    expect(await freshestForCanonical(db, KEY, { regionCode: 'GM9999' })).toBeNull();
  });
});

describe('#155 freshestForCanonical respects the needs_review quarantine gate', () => {
  it('returns a freshest period for an ACTIVE table', async () => {
    // Baseline: the seed leaves tables active.
    const freshest = await freshestForCanonical(db, canonicalKey);
    expect(freshest).not.toBeNull();
    expect(typeof freshest!.periodCode).toBe('string');
  });

  it('returns null once the backing table is quarantined (needs_review) — no metadata leak', async () => {
    await db.query(
      "update cbs_tables set status = 'needs_review', needs_review_reason = 'test quarantine' where id = $1",
      [tableId],
    );
    try {
      expect(await freshestForCanonical(db, canonicalKey)).toBeNull();
    } finally {
      await db.query("update cbs_tables set status = 'active', needs_review_reason = null where id = $1", [tableId]);
    }
  });
});

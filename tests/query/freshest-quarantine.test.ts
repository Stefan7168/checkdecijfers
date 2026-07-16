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

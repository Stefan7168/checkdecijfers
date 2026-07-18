// #170(2): the coverage enumerator behind llms.txt, proven against the fully
// ingested hermetic database (ADR 009) — the same registry state production
// reads, so "the list is generated from reality" is a tested claim, not a
// slogan. Invariant at stake: the public coverage list must never over-claim
// (a quarantined table is excluded by the renderer via its status).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildCoverageReport, type CoverageReport } from '../../src/registry/coverage.ts';
import { SEED_TABLES } from '../../src/ingestion/registry-seed.ts';
import { CANONICAL_MEASURES } from '../../src/registry/defaults.ts';
import type { Db } from '../../src/db/types.ts';
import { createIngestedDb } from '../helpers/ingested-db.ts';

let db: Db;
let close: () => Promise<void>;
let report: CoverageReport;

beforeAll(async () => {
  ({ db, close } = await createIngestedDb());
  report = await buildCoverageReport(db);
});

afterAll(async () => {
  await close();
});

describe('buildCoverageReport', () => {
  it('lists every registered seed table exactly once, with its CBS title', () => {
    const ids = report.tables.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const seed of SEED_TABLES) {
      const table = report.tables.find((t) => t.id === seed.id);
      expect(table, `seed table ${seed.id} missing from coverage`).toBeDefined();
      expect(table!.title.length).toBeGreaterThan(0);
    }
  });

  it('carries the MEASURED last_sync_at of the fixture sync as an ISO timestamp', () => {
    for (const table of report.tables) {
      // createIngestedDb syncs every seed table, so a null here would mean
      // the report reads the wrong column or drops the value.
      expect(table.lastSyncAt, `table ${table.id} lastSyncAt`).not.toBeNull();
      expect(new Date(table.lastSyncAt!).getTime()).not.toBeNaN();
    }
  });

  it('attaches every canonical measure to its own table, labeled human-readably', () => {
    const flattened = report.tables.flatMap((t) => t.measures.map((m) => ({ tableId: t.id, ...m })));
    expect(flattened.length).toBe(CANONICAL_MEASURES.length);
    for (const measure of CANONICAL_MEASURES) {
      const found = flattened.find((m) => m.key === measure.key);
      expect(found, `canonical key ${measure.key} missing`).toBeDefined();
      expect(found!.tableId).toBe(measure.tableId);
      expect(found!.label.length).toBeGreaterThan(0);
    }
  });

  it('reports a quarantined table with status needs_review (the renderer excludes it)', async () => {
    const victim = report.tables[0]!.id;
    await db.query(`update cbs_tables set status = 'needs_review' where id = $1`, [victim]);
    try {
      const after = await buildCoverageReport(db);
      expect(after.tables.find((t) => t.id === victim)!.status).toBe('needs_review');
    } finally {
      await db.query(`update cbs_tables set status = 'active' where id = $1`, [victim]);
    }
  });

  it('is stable: two renders of unchanged state are deep-equal (ordered by id/key)', async () => {
    expect(await buildCoverageReport(db)).toEqual(report);
  });
});

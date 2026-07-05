// Onboarding vocabulary registration (WP16 sub-part 2, ADR 026, design §3.6):
// derives canonical_measures rows from an ingested table's measure metadata so
// the delivery re-run can resolve a question against it. Hermetic: registers +
// syncs a fixture table, then registers vocab and checks the rows.
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FixtureSource, loadFixtureDocs } from '../../src/cbs-adapter/fixture-source.ts';
import { registerTables, syncTable } from '../../src/ingestion/pipeline.ts';
import type { Phase0Table } from '../../src/ingestion/registry-seed.ts';
import {
  onboardedKey,
  registerOnboardingVocabulary,
} from '../../src/ingestion/onboarding-vocab.ts';
import type { Db } from '../../src/db/types.ts';
import { createTestDb } from '../helpers/pglite-db.ts';

const FIXTURES = fileURLToPath(new URL('../fixtures/cbs', import.meta.url));
const TABLE = '82235NED'; // Perioden-only, national — dims = {} shape.

async function ingest(db: Db): Promise<void> {
  const source = new FixtureSource(loadFixtureDocs(`${FIXTURES}/${TABLE}`));
  const seed: Phase0Table = { id: TABLE, updateCadence: 'on-demand', servesTasks: [] };
  await registerTables(db, source, [seed]);
  const result = await syncTable(db, source, TABLE);
  if (result.outcome !== 'succeeded') throw new Error(`sync failed: ${result.failureSummary}`);
}

async function withIngested(fn: (db: Db) => Promise<void>): Promise<void> {
  const { db, close } = await createTestDb();
  try {
    await ingest(db);
    await fn(db);
  } finally {
    await close();
  }
}

describe('registerOnboardingVocabulary', () => {
  it('registers a canonical_measures row per empty-coordinate measure, keyed + labelled from CBS metadata', async () => {
    await withIngested(async (db) => {
      const result = await registerOnboardingVocabulary(db, {
        tableId: TABLE,
        topicTerm: 'woningvoorraad',
      });
      expect(result.onboarded.length).toBeGreaterThan(0);

      // Every onboarded measure has a namespaced key, the CBS title as its
      // definition label (R10 spirit), and the topic term in its everyday terms.
      for (const m of result.onboarded) {
        expect(m.measure.key).toMatch(new RegExp(`^onboarded:${TABLE}:`));
        expect(m.measure.definitionLabel.length).toBeGreaterThan(0);
        expect(m.measure.everydayTerms).toContain('woningvoorraad');
        expect(m.grains.length).toBeGreaterThan(0);
      }

      // The rows are actually in canonical_measures (resolve.ts reads them).
      const key = onboardedKey(TABLE, 'D002936');
      const row = await db.query('select key, table_id, measure, definition_label from canonical_measures where key = $1', [key]);
      expect(row.rows).toHaveLength(1);
      expect(row.rows[0]!.table_id).toBe(TABLE);
      expect(row.rows[0]!.measure).toBe('D002936');
    });
  });

  it('is idempotent — re-running upserts the same rows without error', async () => {
    await withIngested(async (db) => {
      const first = await registerOnboardingVocabulary(db, { tableId: TABLE, topicTerm: 'x' });
      const second = await registerOnboardingVocabulary(db, { tableId: TABLE, topicTerm: 'x' });
      expect(second.onboarded.length).toBe(first.onboarded.length);
      const count = await db.query(
        'select count(*)::int as n from canonical_measures where key like $1',
        [`onboarded:${TABLE}:%`],
      );
      // Same number of rows after the second run (upsert, not duplicate insert).
      expect(Number(count.rows[0]!.n)).toBe(first.onboarded.length);
    });
  });

  it('pins default_coordinates to an explicit {} (the answerable empty-coordinate shape)', async () => {
    await withIngested(async (db) => {
      await registerOnboardingVocabulary(db, { tableId: TABLE, topicTerm: 'x' });
      const row = await db.query('select default_coordinates from cbs_tables where id = $1', [TABLE]);
      const dc = row.rows[0]!.default_coordinates;
      const parsed = typeof dc === 'string' ? JSON.parse(dc) : dc;
      expect(parsed).toEqual({});
    });
  });
});

// End-to-end table-finder replay test (WP16 sub-part 1) — the hermetic,
// gate-protected counterpart of scripts/tablefinder-eval.ts. Runs the FULL
// finder (Stage-1 FTS recall over the ingested catalog fixture → Stage-2 rerank
// via ReplayLlmClient over the committed fixtures → confidence routing) against
// benchmark/tablefinder-labelled-set.json, and asserts every labelled case.
//
// Zero LLM spend: rerank replays the fixtures recorded live in the supervised
// session-25 calibration. Recall runs over the SAME fixture catalog the record
// used, so each shortlist — and thus each request hash — replays byte-identically.
// If a future change alters recall (aliases/catalog) or the rerank prompt, the
// shortlist/hash shifts, replay misses, and this test fails — forcing a
// re-record (`npm run tablefinder:record`), exactly like the intent fixtures.
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ReplayLlmClient } from '../../src/answer/llm/client.ts';
import { FixtureSource, loadCatalogFixture } from '../../src/cbs-adapter/fixture-source.ts';
import { ingestCatalog, findTable, rerankShortlist } from '../../src/catalog/index.ts';
import { createTestDb } from '../helpers/pglite-db.ts';
import type { Db } from '../../src/db/types.ts';

const FIXTURES_DIR = fileURLToPath(new URL('../fixtures/llm/tablefinder', import.meta.url));
const CATALOG_DIR = fileURLToPath(new URL('../fixtures/cbs', import.meta.url));
const SET_PATH = fileURLToPath(new URL('../../benchmark/tablefinder-labelled-set.json', import.meta.url));

interface LabelledCase {
  id: string;
  topic: string;
  expect: { kind: 'confident' | 'disclose' | 'none'; tableId?: string };
}

const set = JSON.parse(readFileSync(SET_PATH, 'utf8')) as { cases: LabelledCase[] };

describe('table finder — end-to-end replay against the labelled set', () => {
  let db: Db;
  let close: () => Promise<void>;

  beforeEach(async () => {
    ({ db, close } = await createTestDb());
    await ingestCatalog(db, new FixtureSource({}, loadCatalogFixture(CATALOG_DIR)));
  });
  afterEach(async () => {
    await close();
  });

  // One test per labelled case, so a single miss names the exact case.
  for (const c of set.cases) {
    it(`${c.id}: "${c.topic}" → ${c.expect.kind}${c.expect.tableId ? ` ${c.expect.tableId}` : ''}`, async () => {
      const client = new ReplayLlmClient(FIXTURES_DIR);
      const outcome = await findTable(db, c.topic, {
        rerank: (topic, shortlist) => rerankShortlist(topic, shortlist, { client }),
      });

      expect(outcome.kind).toBe(c.expect.kind);
      if (c.expect.kind === 'confident' && outcome.kind === 'confident' && c.expect.tableId) {
        expect(outcome.pick.tableId).toBe(c.expect.tableId);
        // Calibrated floor: every labelled confident pick clears the threshold.
        expect(outcome.confidence).toBeGreaterThanOrEqual(0.8);
      }
      if (c.expect.kind === 'disclose' && outcome.kind === 'disclose' && c.expect.tableId) {
        expect(outcome.candidates.some((cand) => cand.tableId === c.expect.tableId)).toBe(true);
      }
    });
  }
});

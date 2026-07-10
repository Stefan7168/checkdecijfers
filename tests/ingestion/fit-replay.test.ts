// End-to-end measure-fit replay test (WP27 stage D) — the hermetic,
// gate-protected counterpart of scripts/measurefit-eval.ts. Runs the REAL
// measureFit() (prompt build → ReplayLlmClient over the committed fixtures →
// allowlist validation) against benchmark/measurefit-labelled-set.json, and
// asserts every labelled case.
//
// Zero LLM spend: the fixtures were recorded live in the supervised stage-D
// calibration session. Schemas load from the SAME tests/fixtures/cbs captures
// the record used, so each request hash replays byte-identically. If a future
// change alters the fit prompt bytes or a schema fixture, the hash shifts,
// replay misses, and this test fails — forcing a re-record
// (`npm run measurefit:record`), exactly like the tablefinder fixtures.
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ReplayLlmClient } from '../../src/answer/llm/client.ts';
import { FixtureSource, loadFixtureDocsTree } from '../../src/cbs-adapter/fixture-source.ts';
import {
  DEFAULT_MEASURE_FIT_CONFIG,
  MEASURE_FIT_NONE,
  measureFit,
} from '../../src/ingestion/onboarding-fit.ts';

const FIXTURES_DIR = fileURLToPath(new URL('../fixtures/llm/measurefit', import.meta.url));
const CBS_DIR = fileURLToPath(new URL('../fixtures/cbs', import.meta.url));
const SET_PATH = fileURLToPath(new URL('../../benchmark/measurefit-labelled-set.json', import.meta.url));

interface LabelledCase {
  id: string;
  question: string;
  tableId: string;
  /** A measure code copied verbatim from the table's list, or 'geen'. */
  expect: { measure: string };
}

const set = JSON.parse(readFileSync(SET_PATH, 'utf8')) as { cases: LabelledCase[] };

describe('measure-fit gate — end-to-end replay against the labelled set', () => {
  const source = new FixtureSource(loadFixtureDocsTree(CBS_DIR));

  // One test per labelled case, so a single miss names the exact case.
  for (const c of set.cases) {
    it(`${c.id}: ${c.tableId} → ${c.expect.measure}`, async () => {
      const client = new ReplayLlmClient(FIXTURES_DIR);
      const schema = await source.fetchTableSchema(c.tableId);
      const fit = await measureFit(c.question, schema, { client });

      expect(fit.measureCode ?? MEASURE_FIT_NONE).toBe(c.expect.measure);
      if (c.expect.measure !== MEASURE_FIT_NONE) {
        // Calibrated floor: every labelled accept clears the job's accept
        // threshold. Referencing the config constant (not a hardcoded number)
        // keeps this assertion and the job's routing in lockstep if the
        // threshold is ever recalibrated (the find-replay PR-#17 pattern).
        expect(fit.confidence).toBeGreaterThanOrEqual(DEFAULT_MEASURE_FIT_CONFIG.acceptThreshold);
      }
    });
  }
});

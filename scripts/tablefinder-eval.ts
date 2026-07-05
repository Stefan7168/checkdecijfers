// Live eval + fixture recorder for the WP16 table finder's Stage-2 rerank.
//
// The LIVE half of the strategy — spends Anthropic tokens, NOT on the CI gate.
// It runs the FULL finder (Stage-1 FTS recall over the hermetic catalog fixture
// → Stage-2 rerank via the live/recording client → confidence routing) against
// benchmark/tablefinder-labelled-set.json, and in --record mode writes replay
// fixtures keyed by the request hash (tests/fixtures/llm/tablefinder). Recall
// runs over the SAME fixture catalog CI ingests, so a recorded shortlist replays
// byte-identically.
//
//   npm run tablefinder:eval      live eval (no fixtures written)
//   npm run tablefinder:record    live eval + (re)write replay fixtures
//   node scripts/tablefinder-eval.ts --replay   re-check committed fixtures, no key
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  AnthropicLlmClient,
  RecordingLlmClient,
  ReplayLlmClient,
  type LlmClient,
} from '../src/answer/llm/client.ts';
import { FixtureSource, loadCatalogFixture } from '../src/cbs-adapter/fixture-source.ts';
import { ingestCatalog, findTable, rerankShortlist, DEFAULT_FIND_TABLE_CONFIG } from '../src/catalog/index.ts';
import type { FindTableOutcome } from '../src/catalog/index.ts';
import { createTestDb } from '../tests/helpers/pglite-db.ts';

const FIXTURES_DIR = fileURLToPath(new URL('../tests/fixtures/llm/tablefinder', import.meta.url));
const CATALOG_DIR = fileURLToPath(new URL('../tests/fixtures/cbs', import.meta.url));
const SET_PATH = fileURLToPath(new URL('../benchmark/tablefinder-labelled-set.json', import.meta.url));
const REPORT_PATH = fileURLToPath(new URL('../benchmark/tablefinder-calibration-report.json', import.meta.url));

interface LabelledCase {
  id: string;
  topic: string;
  expect: { kind: 'confident' | 'disclose' | 'none'; tableId?: string };
}

function buildClient(mode: string): LlmClient {
  if (mode === 'replay') return new ReplayLlmClient(FIXTURES_DIR);
  const live = new AnthropicLlmClient();
  if (mode === 'record') return new RecordingLlmClient(live, FIXTURES_DIR);
  return live;
}

/** Did the finder's outcome satisfy the labelled expectation? */
function checkExpectation(outcome: FindTableOutcome, expect: LabelledCase['expect']): string[] {
  const problems: string[] = [];
  if (outcome.kind !== expect.kind) {
    problems.push(`expected kind ${expect.kind}, got ${outcome.kind}`);
    return problems;
  }
  if (expect.kind === 'confident' && outcome.kind === 'confident' && expect.tableId) {
    if (outcome.pick.tableId !== expect.tableId) {
      problems.push(`expected pick ${expect.tableId}, got ${outcome.pick.tableId} (conf ${outcome.confidence})`);
    }
  }
  if (expect.kind === 'disclose' && outcome.kind === 'disclose' && expect.tableId) {
    if (!outcome.candidates.some((c) => c.tableId === expect.tableId)) {
      problems.push(`expected ${expect.tableId} among disclosed candidates`);
    }
  }
  return problems;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const mode = args.includes('--record') ? 'record' : args.includes('--replay') ? 'replay' : 'live';

  const set = JSON.parse(readFileSync(SET_PATH, 'utf8')) as { cases: LabelledCase[] };
  console.log(`mode=${mode} cases=${set.cases.length} threshold=${DEFAULT_FIND_TABLE_CONFIG.highConfidence}`);

  const { db, close } = await createTestDb();
  await ingestCatalog(db, new FixtureSource({}, loadCatalogFixture(CATALOG_DIR)));

  const client = buildClient(mode);
  const results: Array<{ id: string; kind: string; pick: string | null; confidence: number | null; pass: boolean; problems: string[] }> = [];

  for (const c of set.cases) {
    const outcome = await findTable(db, c.topic, {
      rerank: (topic, shortlist) => rerankShortlist(topic, shortlist, { client }),
    });
    const problems = checkExpectation(outcome, c.expect);
    const pick = outcome.kind === 'confident' ? outcome.pick.tableId : null;
    const confidence = outcome.kind === 'confident' ? outcome.confidence : null;
    results.push({ id: c.id, kind: outcome.kind, pick, confidence, pass: problems.length === 0, problems });
    const mark = problems.length === 0 ? 'ok  ' : 'FAIL';
    console.log(`${mark} ${c.id.padEnd(18)} -> ${outcome.kind}${pick ? ` ${pick} (${confidence})` : ''}`);
    for (const p of problems) console.log(`       ${p}`);
  }
  await close();

  const summary = {
    generatedAt: new Date().toISOString(),
    mode,
    totals: { pass: results.filter((r) => r.pass).length, total: results.length },
    results,
  };
  if (mode !== 'replay') {
    const prior: unknown[] = existsSync(REPORT_PATH)
      ? ((JSON.parse(readFileSync(REPORT_PATH, 'utf8')) as { history?: unknown[] }).history ?? [])
      : [];
    writeFileSync(REPORT_PATH, `${JSON.stringify({ ...summary, history: [...prior, summary].slice(-20) }, null, 2)}\n`);
    console.log(`report written to ${REPORT_PATH}`);
  }
  console.log(`\n${summary.totals.pass}/${summary.totals.total} passed`);
  if (summary.totals.pass < summary.totals.total) process.exitCode = 1;
}

await main();

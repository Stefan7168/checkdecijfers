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
import { candidateWalk, ingestCatalog, findTable, rerankShortlist, DEFAULT_FIND_TABLE_CONFIG } from '../src/catalog/index.ts';
import type { FindTableOutcome } from '../src/catalog/index.ts';
import { createTestDb } from '../tests/helpers/pglite-db.ts';

const FIXTURES_DIR = fileURLToPath(new URL('../tests/fixtures/llm/tablefinder', import.meta.url));
const CATALOG_DIR = fileURLToPath(new URL('../tests/fixtures/cbs', import.meta.url));
const SET_PATH = fileURLToPath(new URL('../benchmark/tablefinder-labelled-set.json', import.meta.url));
const REPORT_PATH = fileURLToPath(new URL('../benchmark/tablefinder-calibration-report.json', import.meta.url));

interface LabelledCase {
  id: string;
  topic: string;
  /** The user's full question (WP27 stage A) — threaded into the rerank
   *  prompt. Absent on the older cases: the eval falls back to the topic. */
  question?: string;
  /** confident expectations: `tableId` pins the exact pick; `chainContains`
   *  pins the MODEL chain — pick + alternativeIds under Stage B's cap;
   *  `walkContains` (#172 step 0, ADR-027 A4) pins the SYSTEM-level
   *  deliverability walk instead — pick + alternates + the current-shortlist
   *  extension via candidateWalk, the exact list the fit gate receives, so
   *  the assertion survives any one model's alt-list whims; `notPick` pins a
   *  known mis-pick class out of the top spot. */
  expect: {
    kind: 'confident' | 'disclose' | 'none';
    tableId?: string;
    chainContains?: string;
    walkContains?: string;
    notPick?: string;
  };
}

/** Stage B's candidate cap (ADR 027: pick first, then alternatives, cap 3).
 *  The chainContains check applies the SAME cap so a table at position 4
 *  can never satisfy a labelled expectation the job would not act on. */
const CANDIDATE_CAP = 3;

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
  if (expect.kind === 'confident' && outcome.kind === 'confident') {
    if (expect.tableId && outcome.pick.tableId !== expect.tableId) {
      problems.push(`expected pick ${expect.tableId}, got ${outcome.pick.tableId} (conf ${outcome.confidence})`);
    }
    if (expect.notPick && outcome.pick.tableId === expect.notPick) {
      problems.push(`pick must NOT be ${expect.notPick} (the pinned mis-pick class)`);
    }
    if (expect.chainContains) {
      const chain = [outcome.pick.tableId, ...outcome.alternativeIds].slice(0, CANDIDATE_CAP);
      if (!chain.includes(expect.chainContains)) {
        problems.push(
          `expected ${expect.chainContains} in the candidate chain (cap ${CANDIDATE_CAP}), got [${chain.join(', ')}]`,
        );
      }
    }
    if (expect.walkContains) {
      const walk = candidateWalk(outcome);
      if (!walk.includes(expect.walkContains)) {
        problems.push(
          `expected ${expect.walkContains} in the deliverability walk (${walk.length} entries), got [${walk.join(', ')}]`,
        );
      }
    }
  }
  if (expect.kind === 'disclose' && outcome.kind === 'disclose') {
    // #172 step-1 eval fix (the s54 masking trap): a fail-safe disclose after
    // a rerank ERROR is a RED result in a calibration run, never a pass — the
    // first Sonnet attempt looked like 9/11 model-disclose while every call
    // had API-errored behind the fail-safe.
    if (outcome.reason === 'rerank_error') {
      problems.push('fail-safe disclose (rerank_error) — the model never judged; RED in calibration');
    }
    if (expect.tableId && !outcome.candidates.some((c) => c.tableId === expect.tableId)) {
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
  const results: Array<{ id: string; kind: string; reason: string | null; pick: string | null; confidence: number | null; pass: boolean; problems: string[] }> = [];

  for (const c of set.cases) {
    const outcome = await findTable(db, { topic: c.topic, question: c.question ?? c.topic }, {
      rerank: (query, shortlist) => rerankShortlist(query, shortlist, { client }),
    });
    const problems = checkExpectation(outcome, c.expect);
    const pick = outcome.kind === 'confident' ? outcome.pick.tableId : null;
    const confidence = outcome.kind === 'confident' ? outcome.confidence : null;
    // #172 step-1 eval fix: report the disclose REASON so a fail-safe
    // (rerank_error) disclose is distinguishable from a model judgment in
    // the calibration history.
    const reason = outcome.kind === 'disclose' ? outcome.reason : outcome.kind === 'none' ? outcome.reason : null;
    results.push({ id: c.id, kind: outcome.kind, reason, pick, confidence, pass: problems.length === 0, problems });
    const mark = problems.length === 0 ? 'ok  ' : 'FAIL';
    console.log(`${mark} ${c.id.padEnd(18)} -> ${outcome.kind}${reason ? ` (${reason})` : ''}${pick ? ` ${pick} (${confidence})` : ''}`);
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

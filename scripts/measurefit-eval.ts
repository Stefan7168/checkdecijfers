// Live eval + fixture recorder for the WP27 stage-C measure-fit gate.
//
// The LIVE half of the strategy — spends Anthropic tokens, NOT on the CI gate
// (the hermetic counterpart is tests/ingestion/fit-replay.test.ts). It runs
// measureFit() — question + a table's OWN measure list → verdict — against
// benchmark/measurefit-labelled-set.json, and in --record mode writes replay
// fixtures keyed by the request hash (tests/fixtures/llm/measurefit). Schemas
// come from the SAME tests/fixtures/cbs captures CI uses, so a recorded
// request replays byte-identically.
//
// The A3 deterministic pre-checks are deliberately BYPASSED here: this eval
// measures the MODEL's stock/flow/kind judgment as defense-in-depth behind
// them (see the labelled set's note).
//
//   npm run measurefit:eval      live eval (no fixtures written)
//   npm run measurefit:record    live eval + (re)write replay fixtures
//   node scripts/measurefit-eval.ts --replay   re-check committed fixtures, no key
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  AnthropicLlmClient,
  RecordingLlmClient,
  ReplayLlmClient,
  type LlmClient,
} from '../src/answer/llm/client.ts';
import { FixtureSource, loadFixtureDocsTree } from '../src/cbs-adapter/fixture-source.ts';
import {
  DEFAULT_MEASURE_FIT_CONFIG,
  MEASURE_FIT_NONE,
  MeasureFitValidationError,
  measureFit,
} from '../src/ingestion/onboarding-fit.ts';

const FIXTURES_DIR = fileURLToPath(new URL('../tests/fixtures/llm/measurefit', import.meta.url));
const CBS_DIR = fileURLToPath(new URL('../tests/fixtures/cbs', import.meta.url));
const SET_PATH = fileURLToPath(new URL('../benchmark/measurefit-labelled-set.json', import.meta.url));
const REPORT_PATH = fileURLToPath(new URL('../benchmark/measurefit-calibration-report.json', import.meta.url));

interface LabelledCase {
  id: string;
  question: string;
  tableId: string;
  /** A measure code copied verbatim from the table's list, or 'geen'. */
  expect: { measure: string };
}

function buildClient(mode: string): LlmClient {
  if (mode === 'replay') return new ReplayLlmClient(FIXTURES_DIR);
  const live = new AnthropicLlmClient();
  if (mode === 'record') return new RecordingLlmClient(live, FIXTURES_DIR);
  return live;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const mode = args.includes('--record') ? 'record' : args.includes('--replay') ? 'replay' : 'live';
  const threshold = DEFAULT_MEASURE_FIT_CONFIG.acceptThreshold;

  const set = JSON.parse(readFileSync(SET_PATH, 'utf8')) as { cases: LabelledCase[] };
  console.log(`mode=${mode} cases=${set.cases.length} acceptThreshold=${threshold}`);

  const source = new FixtureSource(loadFixtureDocsTree(CBS_DIR));
  const client = buildClient(mode);
  const results: Array<{
    id: string;
    expected: string;
    verdict: string | null;
    confidence: number | null;
    reading: string | null;
    /** Would the job accept this verdict at the CURRENT threshold? */
    jobAccepts: boolean;
    pass: boolean;
    problems: string[];
  }> = [];

  for (const c of set.cases) {
    const schema = await source.fetchTableSchema(c.tableId);
    const problems: string[] = [];
    let verdict: string | null = null;
    let confidence: number | null = null;
    let reading: string | null = null;
    let jobAccepts = false;
    try {
      const fit = await measureFit(c.question, schema, { client });
      verdict = fit.measureCode ?? MEASURE_FIT_NONE;
      confidence = fit.confidence;
      reading = fit.reading;
      jobAccepts = fit.measureCode !== null && fit.confidence >= threshold;
      if (verdict !== c.expect.measure) {
        problems.push(`expected ${c.expect.measure}, got ${verdict} (conf ${fit.confidence})`);
      }
    } catch (error) {
      if (!(error instanceof MeasureFitValidationError)) throw error;
      problems.push(`validation error (the job would record 'errored'): ${error.message}`);
    }
    results.push({
      id: c.id,
      expected: c.expect.measure,
      verdict,
      confidence,
      reading,
      jobAccepts,
      pass: problems.length === 0,
      problems,
    });
    const mark = problems.length === 0 ? 'ok  ' : 'FAIL';
    console.log(
      `${mark} ${c.id.padEnd(28)} -> ${verdict ?? 'ERRORED'}${confidence !== null ? ` (conf ${confidence})` : ''}${jobAccepts ? ' [job accepts]' : ''}`,
    );
    for (const p of problems) console.log(`       ${p}`);
    if (reading) console.log(`       reading: ${reading}`);
  }

  // Calibration signal: the accept floor (lowest confidence among CORRECT
  // accepts — the threshold must sit at or below it) and the danger ceiling
  // (highest confidence among WRONG code verdicts — the threshold must sit
  // above it for the job to reject what the model got wrong).
  const correctAccepts = results.filter((r) => r.pass && r.expected !== MEASURE_FIT_NONE && r.confidence !== null);
  const wrongCodes = results.filter(
    (r) => !r.pass && r.verdict !== null && r.verdict !== MEASURE_FIT_NONE && r.confidence !== null,
  );
  const calibration = {
    acceptThreshold: threshold,
    correctAcceptFloor: correctAccepts.length > 0 ? Math.min(...correctAccepts.map((r) => r.confidence as number)) : null,
    wrongCodeCeiling: wrongCodes.length > 0 ? Math.max(...wrongCodes.map((r) => r.confidence as number)) : null,
  };

  const summary = {
    generatedAt: new Date().toISOString(),
    mode,
    totals: { pass: results.filter((r) => r.pass).length, total: results.length },
    calibration,
    results,
  };
  if (mode !== 'replay') {
    const prior: unknown[] = existsSync(REPORT_PATH)
      ? ((JSON.parse(readFileSync(REPORT_PATH, 'utf8')) as { history?: unknown[] }).history ?? [])
      : [];
    writeFileSync(REPORT_PATH, `${JSON.stringify({ ...summary, history: [...prior, summary].slice(-20) }, null, 2)}\n`);
    console.log(`report written to ${REPORT_PATH}`);
  }
  console.log(
    `\n${summary.totals.pass}/${summary.totals.total} passed — correct-accept floor ${calibration.correctAcceptFloor ?? 'n/a'}, wrong-code ceiling ${calibration.wrongCodeCeiling ?? 'n/a'}`,
  );
  if (summary.totals.pass < summary.totals.total) process.exitCode = 1;
}

await main();

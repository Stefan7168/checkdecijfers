// Live eval + fixture recorder for the WP6 intent parser (ADR 012).
//
// This is the LIVE half of the testing strategy — it spends Anthropic API
// tokens and is deliberately NOT on the CI gate. CI replays the fixtures this
// script records (tests/answer/*.test.ts, ReplayIntentClient).
//
//   npm run intent:eval               live eval against the labelled set
//   npm run intent:record             live eval + (re)write replay fixtures
//   node scripts/intent-eval.ts --replay   re-check committed fixtures, no key
//
// Flags: --repeat=N (live/record) runs every case N times to measure
// run-to-run stability at temperature 0. The database is the same hermetic
// PGlite fixture build the tests use, so resolution behavior is identical.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  AnthropicIntentClient,
  RecordingIntentClient,
  ReplayIntentClient,
  parseQuestion,
  AVAILABLE_GRAINS,
} from '../src/answer/intent/index.ts';
import type { IntentLlmClient, ParseOutcome } from '../src/answer/intent/index.ts';
import { CANONICAL_MEASURES } from '../src/registry/defaults.ts';
import { createIngestedDb } from '../tests/helpers/ingested-db.ts';
import {
  allCases,
  checkExpectation,
  loadLabelledSet,
} from '../tests/helpers/intent-expectations.ts';
import type { LabelledCase } from '../tests/helpers/intent-expectations.ts';
import type { Db } from '../src/db/types.ts';

const FIXTURES_DIR = fileURLToPath(new URL('../tests/fixtures/llm/intent', import.meta.url));
const REPORT_PATH = fileURLToPath(
  new URL('../benchmark/intent-calibration-report.json', import.meta.url),
);

interface CaseResult {
  id: string;
  category: string;
  question: string;
  outcomeKind: string;
  /** The model's own top raw confidence — the calibration signal. */
  topRawConfidence: number | null;
  pass: boolean;
  problems: string[];
}

function buildClient(mode: string, labelFor: (question: string) => string | null): IntentLlmClient {
  if (mode === 'replay') return new ReplayIntentClient(FIXTURES_DIR);
  const live = new AnthropicIntentClient();
  if (mode === 'record') return new RecordingIntentClient(live, FIXTURES_DIR, labelFor);
  return live;
}

/** The prompt's curated grain claims may not contradict the database: a grain
 * present in observations but missing from AVAILABLE_GRAINS means the prompt
 * under-promises reality — fail loudly. (The fixture DB can legitimately hold
 * FEWER grains than claimed; that direction is reported, not fatal.)
 * Checked AT THE CANONICAL COORDINATE (table defaults ⊕ measure dims), same
 * as the resolver: a grain that exists only at a different coordinate — the
 * un-corrected yearly unemployment cells — is not a grain the canonical
 * reading can serve (WP14). */
async function crossCheckGrains(db: Db): Promise<string[]> {
  const problems: string[] = [];
  for (const measure of CANONICAL_MEASURES) {
    const table = await db.query('select default_coordinates from cbs_tables where id = $1', [
      measure.tableId,
    ]);
    const parseJson = (v: unknown): Record<string, string> =>
      v == null ? {} : ((typeof v === 'string' ? JSON.parse(v) : v) as Record<string, string>);
    const mergedDims = { ...parseJson(table.rows[0]?.default_coordinates), ...(measure.dims ?? {}) };
    const result = await db.query(
      'select distinct period_grain from observations where table_id = $1 and measure = $2 and dims = $3::jsonb',
      [measure.tableId, measure.measure, JSON.stringify(mergedDims)],
    );
    const inDb = new Set(result.rows.map((r) => r.period_grain as string));
    const claimed = new Set<string>(AVAILABLE_GRAINS[measure.key] ?? []);
    for (const grain of inDb) {
      if (!claimed.has(grain)) {
        problems.push(`${measure.key}: grain ${grain} exists in observations but is missing from AVAILABLE_GRAINS`);
      }
    }
    for (const grain of claimed) {
      if (!inDb.has(grain)) {
        console.warn(`note: ${measure.key} claims grain ${grain} which the fixture DB does not contain (verify against the live DB)`);
      }
    }
  }
  return problems;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const mode = args.includes('--record') ? 'record' : args.includes('--replay') ? 'replay' : 'live';
  const repeat = mode === 'replay' ? 1 : Number(args.find((a) => a.startsWith('--repeat='))?.split('=')[1] ?? '1');
  // --only=<id-prefix>: run a subset (cheap targeted recording/stability for a
  // new case — a base-prompt change still needs the FULL re-record, ADR 012).
  // A filtered run never writes the report: its totals/history describe the
  // whole set, and a subset run would silently overwrite them.
  const only = args.find((a) => a.startsWith('--only='))?.split('=')[1] ?? null;

  const set = loadLabelledSet();
  const cases = allCases(set).filter((c) => only === null || c.id.startsWith(only));
  if (cases.length === 0) throw new Error(`--only=${only} matches no case id`);
  const questionToId = new Map(cases.map((c) => [c.question, c.id]));

  console.log(`mode=${mode} repeat=${repeat} cases=${cases.length}${only ? ` (--only=${only})` : ''} referenceDate=${set.referenceDate}`);
  const { db, close } = await createIngestedDb();
  const grainProblems = await crossCheckGrains(db);
  if (grainProblems.length > 0) {
    for (const problem of grainProblems) console.error(`GRAIN CLAIM ERROR: ${problem}`);
    await close();
    process.exit(1);
  }

  const client = buildClient(mode, (question) => questionToId.get(question) ?? null);
  const results: CaseResult[] = [];
  const unstable: string[] = [];
  let inputTokens = 0;
  let outputTokens = 0;

  for (const labelled of cases) {
    const outcomes: ParseOutcome[] = [];
    for (let run = 0; run < repeat; run++) {
      const outcome = await parseQuestion(db, labelled.question, {
        client,
        referenceDate: set.referenceDate,
      });
      outcomes.push(outcome);
      inputTokens += outcome.usage.inputTokens;
      outputTokens += outcome.usage.outputTokens;
    }
    const outcome = outcomes[0]!;
    const kinds = new Set(outcomes.map((o) => o.kind));
    if (kinds.size > 1) unstable.push(`${labelled.id}: outcome kinds across runs: ${[...kinds].join(', ')}`);

    const problems = checkExpectation(outcome, labelled.expect);
    results.push({
      id: labelled.id,
      category: labelled.category,
      question: labelled.question,
      outcomeKind: outcome.kind,
      topRawConfidence: outcome.raw.candidates[0]?.confidence ?? null,
      pass: problems.length === 0,
      problems,
    });
    const mark = problems.length === 0 ? 'ok  ' : 'FAIL';
    console.log(`${mark} ${labelled.id.padEnd(24)} -> ${outcome.kind}`);
    for (const problem of problems) console.log(`       ${problem.replaceAll('\n', '\n       ')}`);
  }
  await close();

  // ---- report ---------------------------------------------------------------
  const categories = [...new Set(results.map((r) => r.category))];
  const perCategory = categories.map((category) => {
    const inCategory = results.filter((r) => r.category === category);
    return { category, pass: inCategory.filter((r) => r.pass).length, total: inCategory.length };
  });

  // Calibration signals for the R7 thresholds (ADR 012): the thresholds must
  // separate confident-and-right from everything else.
  const correctIntent = results.filter((r) => r.pass && r.outcomeKind === 'intent' && r.topRawConfidence !== null);
  const wrongIntent = results.filter((r) => !r.pass && r.outcomeKind === 'intent' && r.topRawConfidence !== null);
  const ambiguousAnswered = results.filter(
    (r) => !r.pass && (r.category === 'ambiguous' || r.category === 'benchmark_clarify') && r.outcomeKind === 'intent',
  );

  const calibration = {
    correctIntentConfidence: {
      count: correctIntent.length,
      min: correctIntent.length > 0 ? Math.min(...correctIntent.map((r) => r.topRawConfidence!)) : null,
      median: median(correctIntent.map((r) => r.topRawConfidence!)),
    },
    wrongIntentConfidence: {
      count: wrongIntent.length,
      values: wrongIntent.map((r) => ({ id: r.id, confidence: r.topRawConfidence })),
    },
    ambiguousAnsweredInsteadOfClarified: ambiguousAnswered.map((r) => ({
      id: r.id,
      confidence: r.topRawConfidence,
    })),
  };

  const summary = {
    generatedAt: new Date().toISOString(),
    mode,
    repeat,
    referenceDate: set.referenceDate,
    totals: { pass: results.filter((r) => r.pass).length, total: results.length },
    perCategory,
    calibration,
    usage: { inputTokens, outputTokens },
  };
  // Per-run history so calibration claims stay auditable: a run must never
  // silently overwrite the evidence of the run before it (review finding,
  // 2026-07-03 — the first three calibration runs of WP6 left no artifact).
  const priorHistory: unknown[] = existsSync(REPORT_PATH)
    ? ((JSON.parse(readFileSync(REPORT_PATH, 'utf8')) as { history?: unknown[] }).history ?? [])
    : [];
  const report = {
    ...summary,
    unstable,
    failures: results.filter((r) => !r.pass),
    history: [...priorHistory, summary].slice(-20),
  };

  console.log('\n=== per category ===');
  for (const row of perCategory) console.log(`${row.category.padEnd(22)} ${row.pass}/${row.total}`);
  console.log('\n=== calibration ===');
  console.log(JSON.stringify(calibration, null, 2));
  if (unstable.length > 0) {
    console.log('\n=== unstable across repeats ===');
    for (const line of unstable) console.log(line);
  }
  console.log(`\nusage: ${inputTokens} input / ${outputTokens} output tokens`);

  if (mode !== 'replay' && only === null) {
    writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`report written to ${REPORT_PATH}`);
  } else if (only !== null) {
    console.log('(--only run: report NOT written — its totals describe the whole set)');
  }
  if (report.totals.pass < report.totals.total) process.exitCode = 1;
}

await main();

// Live eval + fixture recorder for the WP7 answer composer (ADR 012 harness,
// second fixture set).
//
// This is the LIVE half of the testing strategy — it spends Anthropic API
// tokens and is deliberately NOT on the CI gate. CI replays the fixtures this
// script records (tests/answer/compose-pipeline.test.ts, ReplayLlmClient).
//
//   npm run answer:eval               live eval over B1–B14
//   npm run answer:record             live eval + (re)write replay fixtures
//   node scripts/answer-eval.ts --replay   re-check committed fixtures, no key
//
// Flags: --repeat=N (live/record) runs every case N times — with no
// temperature pin on the phrasing model (Sonnet 5 rejects non-default
// sampling), repeat measures how stable the validator verdict is across
// samples, which is the stability that actually matters.
//
// Pass criterion per task = the SAME checks CI applies (tests/helpers/
// answer-expectations.ts): validator ok + frozen-key values verbatim in the
// text + attribution. A template fallback is a PASS with source='template' —
// reported, never gate-failing (docs/02 scoring).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { composeAnswer, PHRASING_MODEL } from '../src/answer/compose/index.ts';
import type { AnswerSource } from '../src/answer/compose/index.ts';
import {
  AnthropicLlmClient,
  RecordingLlmClient,
  ReplayLlmClient,
} from '../src/answer/llm/client.ts';
import type { LlmClient } from '../src/answer/llm/client.ts';
import { runQuery } from '../src/query/index.ts';
import type { ValidatedResult } from '../src/query/index.ts';
import { createIngestedDb } from '../tests/helpers/ingested-db.ts';
import { ANSWERABLE_TASKS } from '../tests/helpers/benchmark-intents.ts';
import { checkComposedAnswer, loadAnswerKey } from '../tests/helpers/answer-expectations.ts';

const FIXTURES_DIR = fileURLToPath(new URL('../tests/fixtures/llm/answer', import.meta.url));
const REPORT_PATH = fileURLToPath(new URL('../benchmark/answer-eval-report.json', import.meta.url));

interface CaseResult {
  id: string;
  source: AnswerSource;
  pass: boolean;
  problems: string[];
  attemptProblems: string[][];
  text: string;
}

function buildClient(mode: string, labelFor: (question: string) => string | null): LlmClient {
  if (mode === 'replay') return new ReplayLlmClient(FIXTURES_DIR);
  const live = new AnthropicLlmClient();
  if (mode === 'record') return new RecordingLlmClient(live, FIXTURES_DIR, labelFor);
  return live;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const mode = args.includes('--record') ? 'record' : args.includes('--replay') ? 'replay' : 'live';
  const repeat = mode === 'replay' ? 1 : Number(args.find((a) => a.startsWith('--repeat='))?.split('=')[1] ?? '1');

  const answerKey = loadAnswerKey();
  const taskIds = Object.keys(ANSWERABLE_TASKS);
  console.log(`mode=${mode} repeat=${repeat} model=${PHRASING_MODEL} tasks=${taskIds.length}`);

  const { db, close } = await createIngestedDb();

  // The recorder labels fixtures with the task being composed; the label is
  // orientation only (the hash is the key), so a mutable variable suffices.
  let currentTask: string | null = null;
  const client = buildClient(mode, () => currentTask);

  // Query results are produced once through the hand-authored intents — the
  // parser's fixtures already prove docs/02 phrasings reach these intents.
  const results = new Map<string, ValidatedResult>();
  for (const taskId of taskIds) {
    const outcome = await runQuery(db, ANSWERABLE_TASKS[taskId]!.intent);
    if (!outcome.ok) throw new Error(`${taskId}: query refused: ${outcome.refusal.message}`);
    results.set(taskId, outcome);
  }

  const caseResults: CaseResult[] = [];
  const unstable: string[] = [];
  let inputTokens = 0;
  let outputTokens = 0;

  for (const taskId of taskIds) {
    currentTask = taskId;
    const verdicts: CaseResult[] = [];
    for (let run = 0; run < repeat; run++) {
      const answer = await composeAnswer(results.get(taskId)!, { client });
      inputTokens += answer.usage.inputTokens;
      outputTokens += answer.usage.outputTokens;
      const problems = checkComposedAnswer(taskId, answerKey.tasks[taskId as keyof typeof answerKey.tasks]!, answer);
      verdicts.push({
        id: taskId,
        source: answer.source,
        pass: problems.length === 0,
        problems,
        attemptProblems: answer.attempts.map((a) => (a.error ? [`error: ${a.error}`] : a.problems)),
        text: answer.text,
      });
    }
    const first = verdicts[0]!;
    if (new Set(verdicts.map((v) => v.pass)).size > 1) {
      unstable.push(`${taskId}: pass verdict flips across runs`);
    }
    caseResults.push(first);
    console.log(`${first.pass ? 'ok  ' : 'FAIL'} ${taskId.padEnd(4)} source=${first.source}`);
    for (const problem of first.problems) console.log(`       ${problem}`);
  }
  await close();

  const summary = {
    generatedAt: new Date().toISOString(),
    mode,
    repeat,
    model: PHRASING_MODEL,
    totals: { pass: caseResults.filter((r) => r.pass).length, total: caseResults.length },
    sources: {
      llm: caseResults.filter((r) => r.source === 'llm').length,
      llm_retry: caseResults.filter((r) => r.source === 'llm_retry').length,
      template: caseResults.filter((r) => r.source === 'template').length,
    },
    usage: { inputTokens, outputTokens },
  };

  // Per-run history so claims stay auditable (WP6 review lesson: a run must
  // never silently overwrite the evidence of the run before it).
  const priorHistory: unknown[] = existsSync(REPORT_PATH)
    ? ((JSON.parse(readFileSync(REPORT_PATH, 'utf8')) as { history?: unknown[] }).history ?? [])
    : [];
  const report = {
    ...summary,
    unstable,
    cases: caseResults.map(({ text, ...rest }) => ({ ...rest, text })),
    history: [...priorHistory, summary].slice(-20),
  };

  console.log('\n=== summary ===');
  console.log(JSON.stringify({ totals: summary.totals, sources: summary.sources, usage: summary.usage }, null, 2));
  if (unstable.length > 0) {
    console.log('\n=== unstable across repeats ===');
    for (const line of unstable) console.log(line);
  }

  if (mode !== 'replay') {
    writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`report written to ${REPORT_PATH}`);
  }
  if (summary.totals.pass < summary.totals.total) process.exitCode = 1;
}

await main();

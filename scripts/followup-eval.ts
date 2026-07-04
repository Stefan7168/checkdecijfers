// Live eval + fixture recorder for the WP15 follow-up parser
// (parseFollowUpQuestion — the structured-context merge, ADR 021, open-
// questions #57). Mirrors scripts/clarify-eval.ts.
//
// This is the LIVE half of the testing strategy — it spends Anthropic API
// tokens and is deliberately NOT on the CI gate. CI replays the fixtures this
// script records (tests/answer/followup-parse.test.ts, ReplayLlmClient).
//
//   npm run followup:eval               live eval against benchmark/followup-cases.json
//   npm run followup:record             live eval + (re)write replay fixtures
//   node scripts/followup-eval.ts --replay   re-check committed fixtures, no key
//
// Flags: --repeat=N (live/record) runs every case N times to measure
// run-to-run stability at temperature 0 (same rationale as intent-eval).
//
// Each case's ConversationContext is inline in benchmark/followup-cases.json
// (control over the merge candidate; buildConversationContext has its own
// unit tests elsewhere) — there is no prior-turn parse to resolve first,
// unlike the clarify-reply harness.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseFollowUpQuestion } from '../src/answer/intent/followup.ts';
import type { ConversationContext } from '../src/answer/context/types.ts';
import {
  AnthropicLlmClient,
  RecordingLlmClient,
  ReplayLlmClient,
} from '../src/answer/llm/client.ts';
import type { LlmClient } from '../src/answer/llm/client.ts';
import { createIngestedDb } from '../tests/helpers/ingested-db.ts';
import { checkExpectation } from '../tests/helpers/intent-expectations.ts';
import type { Expectation } from '../tests/helpers/intent-expectations.ts';

const FOLLOWUP_FIXTURES_DIR = fileURLToPath(new URL('../tests/fixtures/llm/followup', import.meta.url));
const REPORT_PATH = fileURLToPath(new URL('../benchmark/followup-calibration-report.json', import.meta.url));

interface FollowUpCase {
  id: string;
  context: ConversationContext;
  question: string;
  expect: Expectation;
}

interface FollowUpCaseSet {
  version: number;
  referenceDate: string;
  note: string;
  cases: FollowUpCase[];
}

function loadCaseSet(): FollowUpCaseSet {
  return JSON.parse(
    readFileSync(new URL('../benchmark/followup-cases.json', import.meta.url), 'utf8'),
  ) as FollowUpCaseSet;
}

interface CaseResult {
  id: string;
  question: string;
  outcomeKind: string;
  pass: boolean;
  problems: string[];
}

function buildClient(mode: string, fixturesDir: string, labelFor: (question: string) => string | null): LlmClient {
  if (mode === 'replay') return new ReplayLlmClient(fixturesDir);
  const live = new AnthropicLlmClient();
  if (mode === 'record') return new RecordingLlmClient(live, fixturesDir, labelFor);
  return live;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const mode = args.includes('--record') ? 'record' : args.includes('--replay') ? 'replay' : 'live';
  const repeat = mode === 'replay' ? 1 : Number(args.find((a) => a.startsWith('--repeat='))?.split('=')[1] ?? '1');

  const set = loadCaseSet();
  console.log(`mode=${mode} repeat=${repeat} cases=${set.cases.length} referenceDate=${set.referenceDate}`);

  const { db, close } = await createIngestedDb();
  const idByQuestion = new Map(set.cases.map((c) => [c.question, c.id]));
  const client = buildClient(mode, FOLLOWUP_FIXTURES_DIR, (question) => {
    // The follow-up user payload is a JSON blob containing the new question;
    // label by whichever case's question text appears in it (orientation only).
    for (const [question_, id] of idByQuestion) {
      if (question.includes(JSON.stringify(question_).slice(1, -1))) return id;
    }
    return null;
  });

  const results: CaseResult[] = [];
  const unstable: string[] = [];
  let inputTokens = 0;
  let outputTokens = 0;

  for (const c of set.cases) {
    const outcomes = [];
    for (let run = 0; run < repeat; run++) {
      const outcome = await parseFollowUpQuestion(db, c.context, c.question, {
        client,
        referenceDate: set.referenceDate,
      });
      outcomes.push(outcome);
      inputTokens += outcome.usage.inputTokens;
      outputTokens += outcome.usage.outputTokens;
    }
    const outcome = outcomes[0]!;
    const kinds = new Set(outcomes.map((o) => o.kind));
    if (kinds.size > 1) unstable.push(`${c.id}: outcome kinds across runs: ${[...kinds].join(', ')}`);

    const problems = checkExpectation(outcome, c.expect);
    results.push({
      id: c.id,
      question: c.question,
      outcomeKind: outcome.kind,
      pass: problems.length === 0,
      problems,
    });
    const mark = problems.length === 0 ? 'ok  ' : 'FAIL';
    console.log(`${mark} ${c.id.padEnd(32)} -> ${outcome.kind}`);
    for (const problem of problems) console.log(`       ${problem.replaceAll('\n', '\n       ')}`);
  }
  await close();

  const summary = {
    generatedAt: new Date().toISOString(),
    mode,
    repeat,
    referenceDate: set.referenceDate,
    totals: { pass: results.filter((r) => r.pass).length, total: results.length },
    usage: { inputTokens, outputTokens },
  };

  console.log('\n=== summary ===');
  console.log(JSON.stringify(summary.totals, null, 2));
  if (unstable.length > 0) {
    console.log('\n=== unstable across repeats ===');
    for (const line of unstable) console.log(line);
  }
  console.log(`\nusage: ${inputTokens} input / ${outputTokens} output tokens`);

  // Report honesty (WP9 brief, mirrored here): a run scoped with --only would
  // be partial — this script has no --only flag, so every run here covers
  // the full committed case set and may write the report.
  if (mode !== 'replay') {
    const priorHistory: unknown[] = existsSync(REPORT_PATH)
      ? ((JSON.parse(readFileSync(REPORT_PATH, 'utf8')) as { history?: unknown[] }).history ?? [])
      : [];
    const report = {
      ...summary,
      unstable,
      failures: results.filter((r) => !r.pass),
      history: [...priorHistory, summary].slice(-20),
    };
    writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`report written to ${REPORT_PATH}`);
  }
  if (summary.totals.pass < summary.totals.total) process.exitCode = 1;
}

await main();

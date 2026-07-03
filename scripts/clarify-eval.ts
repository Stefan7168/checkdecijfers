// Live eval + fixture recorder for the WP9 clarification-reply parser
// (parseClarificationReply — the second half of the ONE clarification round,
// docs/05 failure table; docs/02 S3). Mirrors scripts/intent-eval.ts.
//
// This is the LIVE half of the testing strategy — it spends Anthropic API
// tokens and is deliberately NOT on the CI gate. CI replays the fixtures this
// script records (a future tests/answer/clarify-*.test.ts, ReplayLlmClient).
//
//   npm run clarify:eval               live eval against benchmark/clarification-cases.json
//   npm run clarify:record             live eval + (re)write replay fixtures
//   node scripts/clarify-eval.ts --replay   re-check committed fixtures, no key
//
// Flags: --repeat=N (live/record) runs every case N times to measure
// run-to-run stability at temperature 0 (same rationale as intent-eval).
//
// Each case's ORIGINAL question is parsed first through the intent fixtures
// (tests/fixtures/llm/intent, ReplayLlmClient) — a missing original fixture
// FAILS LOUDLY naming the case id, since without it there is no pending
// clarification to reply to. The resulting outcome MUST be a clarification;
// the reply is then parsed merged with a PendingClarification built inline
// from that outcome, via the mode's client over tests/fixtures/llm/clarify.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  parseQuestion,
  parseClarificationReply,
  ReplayIntentClient,
} from '../src/answer/intent/index.ts';
import type { ParseOutcome } from '../src/answer/intent/index.ts';
import type { PendingClarification } from '../src/answer/respond/types.ts';
import { RESPONSE_SCHEMA_VERSION } from '../src/answer/respond/types.ts';
import {
  AnthropicLlmClient,
  RecordingLlmClient,
  ReplayLlmClient,
} from '../src/answer/llm/client.ts';
import type { LlmClient } from '../src/answer/llm/client.ts';
import { createIngestedDb } from '../tests/helpers/ingested-db.ts';
import { checkExpectation } from '../tests/helpers/intent-expectations.ts';
import type { Expectation } from '../tests/helpers/intent-expectations.ts';
import type { Db } from '../src/db/types.ts';

const INTENT_FIXTURES_DIR = fileURLToPath(new URL('../tests/fixtures/llm/intent', import.meta.url));
const CLARIFY_FIXTURES_DIR = fileURLToPath(new URL('../tests/fixtures/llm/clarify', import.meta.url));
const REPORT_PATH = fileURLToPath(new URL('../benchmark/clarify-calibration-report.json', import.meta.url));

interface ClarifyCase {
  id: string;
  originalQuestion: string;
  reply: string;
  expect: Expectation;
}

interface ClarifyCaseSet {
  version: number;
  referenceDate: string;
  note: string;
  cases: ClarifyCase[];
}

function loadCaseSet(): ClarifyCaseSet {
  return JSON.parse(
    readFileSync(new URL('../benchmark/clarification-cases.json', import.meta.url), 'utf8'),
  ) as ClarifyCaseSet;
}

interface CaseResult {
  id: string;
  originalQuestion: string;
  reply: string;
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

/** Build the PendingClarification a real respond-layer would have persisted
 * after the FIRST round, from the original question's parse outcome. Fails
 * loudly (rather than skipping) when the original does not clarify — a
 * clarify-reply case is only meaningful against a real pending round. */
function buildPending(caseId: string, referenceDate: string, outcome: ParseOutcome): PendingClarification {
  if (outcome.kind !== 'clarification') {
    throw new Error(
      `case ${caseId}: original question did not produce a clarification (got "${outcome.kind}") — ` +
        `cannot build a PendingClarification to reply to. Check the original question and its intent fixture.`,
    );
  }
  return {
    version: RESPONSE_SCHEMA_VERSION,
    question: outcome.question,
    referenceDate,
    axes: outcome.axes,
    questionNl: outcome.question_nl,
    options: outcome.options,
  };
}

async function resolveOriginal(db: Db, caseId: string, question: string, referenceDate: string): Promise<ParseOutcome> {
  const client = new ReplayIntentClient(INTENT_FIXTURES_DIR);
  try {
    return await parseQuestion(db, question, { client, referenceDate });
  } catch (error) {
    throw new Error(
      `case ${caseId}: no recorded intent fixture for original question "${question}" — ` +
        `record it first (npm run intent:record) before recording clarify fixtures.\n${(error as Error).message}`,
    );
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const mode = args.includes('--record') ? 'record' : args.includes('--replay') ? 'replay' : 'live';
  const repeat = mode === 'replay' ? 1 : Number(args.find((a) => a.startsWith('--repeat='))?.split('=')[1] ?? '1');

  const set = loadCaseSet();
  console.log(`mode=${mode} repeat=${repeat} cases=${set.cases.length} referenceDate=${set.referenceDate}`);

  const { db, close } = await createIngestedDb();
  const idByReply = new Map(set.cases.map((c) => [c.reply, c.id]));
  const client = buildClient(mode, CLARIFY_FIXTURES_DIR, (question) => {
    // The clarify user payload is a JSON blob containing the reply; label by
    // whichever case's reply text appears in it (orientation only).
    for (const [reply, id] of idByReply) {
      if (question.includes(JSON.stringify(reply).slice(1, -1))) return id;
    }
    return null;
  });

  const results: CaseResult[] = [];
  const unstable: string[] = [];
  let inputTokens = 0;
  let outputTokens = 0;

  for (const c of set.cases) {
    const originalOutcome = await resolveOriginal(db, c.id, c.originalQuestion, set.referenceDate);
    const pending = buildPending(c.id, set.referenceDate, originalOutcome);

    const outcomes: ParseOutcome[] = [];
    for (let run = 0; run < repeat; run++) {
      const outcome = await parseClarificationReply(db, pending, c.reply, { client });
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
      originalQuestion: c.originalQuestion,
      reply: c.reply,
      outcomeKind: outcome.kind,
      pass: problems.length === 0,
      problems,
    });
    const mark = problems.length === 0 ? 'ok  ' : 'FAIL';
    console.log(`${mark} ${c.id.padEnd(24)} -> ${outcome.kind}`);
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

  // Report honesty (WP9 brief): a run scoped with --only would be partial —
  // this script has no --only flag (unlike intent-eval), so every run here
  // covers the full committed case set and may write the report.
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

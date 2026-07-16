// Live eval + fixture recorder for the #144 semantic checker (ADR 034 —
// same ADR 012 harness pattern as intent/answer: one seam, its own fixture
// set, live half deliberately NOT on the CI gate).
//
//   npm run semantic-check:eval               live eval over the labelled set
//   npm run semantic-check:record             live eval + (re)write replay fixtures
//   node scripts/semantic-check-eval.ts --replay   re-check committed fixtures, no key
//
// Flags: --repeat=N runs every case N times (temperature 0 on the cheap-tier
// model; the house-standard stability check is --repeat=3).
//
// Pass criteria (both are FLAG-FLIP BLOCKERS, ADR 034):
//   expected 'clear'      → reject=false with status 'ok' (a rejection is a
//                           measured FALSE POSITIVE on a legit body)
//   expected 'fabricated' → reject=true (a clearance is a FALSE NEGATIVE on
//                           the exact residual the checker exists to close)
//
// Structural guards: every case must PASS the deterministic validator and
// carry >=1 suspect — otherwise the case measures nothing and the script
// exits loudly (a labelled-set bug, not a checker result).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  findSuspectTokens,
  runSemanticCheck,
  validateAnswerBody,
  SEMANTIC_CHECK_MODEL,
  SEMANTIC_CHECK_PROMPT_VERSION,
} from '../src/answer/compose/index.ts';
import {
  AnthropicLlmClient,
  RecordingLlmClient,
  ReplayLlmClient,
} from '../src/answer/llm/client.ts';
import type { LlmClient } from '../src/answer/llm/client.ts';
import { SEMANTIC_CHECK_CASES } from '../tests/helpers/semantic-check-cases.ts';

const FIXTURES_DIR = fileURLToPath(new URL('../tests/fixtures/llm/semantic-check', import.meta.url));
const REPORT_PATH = fileURLToPath(new URL('../benchmark/semantic-check-eval-report.json', import.meta.url));

interface CaseResult {
  id: string;
  expected: 'clear' | 'fabricated';
  reject: boolean;
  status: string;
  pass: boolean;
  suspects: string[];
  verdicts: unknown;
  error: string | null;
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

  console.log(
    `mode=${mode} repeat=${repeat} model=${SEMANTIC_CHECK_MODEL} promptVersion=${SEMANTIC_CHECK_PROMPT_VERSION} cases=${SEMANTIC_CHECK_CASES.length}`,
  );

  // Structural guards BEFORE any spend.
  for (const c of SEMANTIC_CHECK_CASES) {
    const result = c.result();
    const validation = validateAnswerBody(c.body, result);
    if (!validation.ok) {
      console.error(`LABELLED-SET BUG: case ${c.id} fails the deterministic validator — it measures nothing:`);
      for (const p of validation.problems) console.error(`  ${p}`);
      process.exit(2);
    }
    if (findSuspectTokens(c.body, result).length === 0) {
      console.error(`LABELLED-SET BUG: case ${c.id} has no residual-prone suspects — the checker would never run.`);
      process.exit(2);
    }
  }

  let currentCase: string | null = null;
  const client = buildClient(mode, () => currentCase);

  const results: CaseResult[] = [];
  let falsePositives = 0;
  let falseNegatives = 0;
  let flips = 0;

  for (const c of SEMANTIC_CHECK_CASES) {
    currentCase = c.id;
    const result = c.result();
    const outcomes: CaseResult[] = [];
    for (let i = 0; i < repeat; i += 1) {
      const outcome = await runSemanticCheck(c.body, result, { client, mode: 'fail_closed' });
      // status must be 'ok' on BOTH sides: a checker ERROR is never a
      // judgment (otherwise a missing fixture / API outage under fail_closed
      // would spuriously "pass" every fabricated case via its reject=true).
      const pass =
        outcome.record.status === 'ok' && (c.expected === 'fabricated' ? outcome.reject : !outcome.reject);
      outcomes.push({
        id: c.id,
        expected: c.expected,
        reject: outcome.reject,
        status: outcome.record.status,
        pass,
        suspects: outcome.record.suspects.map((s) => `${s.token}:${s.kind}`),
        verdicts: outcome.record.verdicts,
        error: outcome.record.error,
      });
    }
    const first = outcomes[0]!;
    if (outcomes.some((o) => o.pass !== first.pass)) flips += 1;
    if (!first.pass && c.expected === 'clear') falsePositives += 1;
    if (!first.pass && c.expected === 'fabricated') falseNegatives += 1;
    results.push(first);
    console.log(
      `${first.pass ? 'PASS' : 'FAIL'}  ${c.id.padEnd(28)} expected=${c.expected} reject=${first.reject} status=${first.status}` +
        (first.error ? ` error=${first.error.slice(0, 120)}` : ''),
    );
  }

  const summary = {
    ranAt: new Date().toISOString(),
    mode,
    repeat,
    model: SEMANTIC_CHECK_MODEL,
    promptVersion: SEMANTIC_CHECK_PROMPT_VERSION,
    cases: SEMANTIC_CHECK_CASES.length,
    passed: results.filter((r) => r.pass).length,
    falsePositives,
    falseNegatives,
    verdictFlips: flips,
    results,
  };

  // Append-only history (the ADR 012 provenance lesson: overwritten reports
  // leave threshold decisions un-auditable).
  const report = existsSync(REPORT_PATH)
    ? (JSON.parse(readFileSync(REPORT_PATH, 'utf8')) as { history: unknown[] })
    : { history: [] as unknown[] };
  report.history.unshift(summary);
  writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    `\n${summary.passed}/${summary.cases} pass — FP=${falsePositives} FN=${falseNegatives} flips=${flips}. Report: benchmark/semantic-check-eval-report.json`,
  );

  // FP and FN are both flag-flip blockers (ADR 034); flips fail the stability
  // standard when --repeat>1.
  if (falsePositives > 0 || falseNegatives > 0 || flips > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

// #325 check C12: the labelled-set eval + fixture recorder (spec §4–§5).
// The LIVE half — deliberately NOT on the CI gate.
//
//   npm run meaning-check:eval     replay committed fixtures (no key, no
//                                  network, writes no report file); defaults
//                                  to the shipped model only (MEANING_CHECK_MODEL,
//                                  Sonnet 5 since session 134) — CI replay has
//                                  nothing to gain from also exercising the
//                                  model that was measured and not shipped
//   npm run meaning-check:record   real calls (owner-supervised, real spend);
//                                  appends to
//                                  benchmark/meaning-check-eval-report.json
//   flags: --model=haiku|sonnet|both (default: the shipped model in replay,
//          both in record/live; an explicit --model= always wins in every mode)
//          --repeat=N (record/live; house standard 3)
//
// Scores MISSED REVERSALS (expected 'different', verdict 'same') and FALSE
// ALARMS (expected 'same', verdict 'different'); both are flag-flip blockers,
// as are verdict flips across repeats. A checker ERROR is never a judgment:
// it is counted separately and fails the run (a missing fixture must not
// look like a verdict).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AnthropicLlmClient, RecordingLlmClient, ReplayLlmClient } from '../src/answer/llm/client.ts';
import type { LlmClient } from '../src/answer/llm/client.ts';
import { checkTranslation } from '../src/answer/translate/check.ts';
import { MEANING_CHECK_MODEL, MEANING_CHECK_PROMPT_VERSION, runMeaningCheck } from '../src/answer/translate/meaning-check.ts';
import { MEANING_CHECK_CASES } from '../tests/helpers/meaning-check-cases.ts';

const FIXTURES_DIR = fileURLToPath(new URL('../tests/fixtures/llm/meaning-check', import.meta.url));
const REPORT_PATH = fileURLToPath(new URL('../benchmark/meaning-check-eval-report.json', import.meta.url));
const MODELS: Record<string, string> = { haiku: 'claude-haiku-4-5', sonnet: 'claude-sonnet-5' };

function buildClient(mode: string, labelFor: () => string | null): LlmClient {
  if (mode === 'replay') return new ReplayLlmClient(FIXTURES_DIR);
  const live = new AnthropicLlmClient();
  if (mode === 'record') return new RecordingLlmClient(live, FIXTURES_DIR, labelFor);
  return live;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length === 0 ? 0 : sorted[Math.floor(sorted.length / 2)]!;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const mode = args.includes('--record') ? 'record' : args.includes('--live') ? 'live' : 'replay';
  const repeat = mode === 'replay' ? 1 : Number(args.find((a) => a.startsWith('--repeat='))?.split('=')[1] ?? '1');
  const explicitModel = args.find((a) => a.startsWith('--model='))?.split('=')[1];
  const which = explicitModel ?? (mode === 'replay' ? 'shipped' : 'both');
  const models = which === 'both' ? Object.values(MODELS) : which === 'shipped' ? [MEANING_CHECK_MODEL] : [MODELS[which] ?? which];

  // Structural guard BEFORE any spend (the same rule the CI test pins).
  for (const c of MEANING_CHECK_CASES) {
    const problems = checkTranslation({ maskedDutch: c.maskedDutch, english: c.english, glossary: c.glossary, maskTable: c.maskTable });
    if (problems.length > 0) {
      console.error(`LABELLED-SET BUG: case ${c.id} fails C1–C11 — it measures nothing: ${problems.join('; ')}`);
      process.exit(2);
    }
  }

  let currentCase: string | null = null;
  const client = buildClient(mode, () => currentCase);
  const report = existsSync(REPORT_PATH)
    ? (JSON.parse(readFileSync(REPORT_PATH, 'utf8')) as { history: unknown[] })
    : { history: [] as unknown[] };
  let failed = false;

  for (const model of models) {
    let missed = 0;
    let falseAlarms = 0;
    let errors = 0;
    let flips = 0;
    const latencies: number[] = [];
    const results: unknown[] = [];
    console.log(`\nmode=${mode} model=${model} repeat=${repeat} promptVersion=${MEANING_CHECK_PROMPT_VERSION} cases=${MEANING_CHECK_CASES.length}`);
    for (const c of MEANING_CHECK_CASES) {
      currentCase = `${c.id}@${model}`;
      const statuses: string[] = [];
      for (let i = 0; i < repeat; i += 1) {
        const out = await runMeaningCheck(c.maskedDutch, c.english, client, { model });
        statuses.push(out.record.status);
        latencies.push(out.record.latencyMs);
        if (i === 0) results.push({ id: c.id, expected: c.expected, status: out.record.status, verdicts: out.record.verdicts, error: out.record.error });
      }
      const first = statuses[0]!;
      if (statuses.some((s) => s !== first)) flips += 1;
      if (first === 'error') errors += 1;
      else if (c.expected === 'different' && first === 'same') missed += 1;
      else if (c.expected === 'same' && first === 'different') falseAlarms += 1;
      const pass = first !== 'error' && (c.expected === 'same') === (first === 'same');
      console.log(`${pass ? 'PASS' : 'FAIL'}  ${c.id.padEnd(24)} expected=${c.expected} got=${first}`);
    }
    const summary = {
      ranAt: new Date().toISOString(), mode, model, repeat, promptVersion: MEANING_CHECK_PROMPT_VERSION,
      cases: MEANING_CHECK_CASES.length, missedReversals: missed, falseAlarms, errors, verdictFlips: flips,
      latencyMsMedian: median(latencies), latencyMsMax: Math.max(0, ...latencies), results,
    };
    report.history.unshift(summary); // append-only history (ADR 012 provenance lesson)
    console.log(`${model}: missed=${missed} falseAlarms=${falseAlarms} errors=${errors} flips=${flips} latency median ${summary.latencyMsMedian} ms, max ${summary.latencyMsMax} ms`);
    if (missed > 0 || falseAlarms > 0 || errors > 0 || flips > 0) failed = true;
  }

  if (mode !== 'replay') {
    writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
    console.log('\nReport: benchmark/meaning-check-eval-report.json');
  }
  if (failed) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

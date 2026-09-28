// Breadth step 4, Task 4 — eval + fixture recorder for the table-scoped
// parser (Task 3) over benchmark/tableparse-labelled-set.json.
//
// Three modes, DRY-RUN IS THE DEFAULT for this step (unlike measurefit-eval
// / tablefinder-eval, which default to a live spend): the task brief is
// explicit that this step is "zero-spend dry-run now; replay/record later" —
// no committed tests/fixtures/llm/tableparse/ fixtures exist yet, so replay
// would just fail loudly, and record must never run by accident.
//
//   --dry-run (default): builds every request from the fixtures via
//     buildTableParseRequest — a PURE function, no LlmClient constructed at
//     all — and prints the request hash, the serialized prompt size in
//     characters and a rough token estimate (chars / 3.5) per case, plus the
//     totals. Zero spend, no network, no API key needed.
//   --replay: ReplayLlmClient over tests/fixtures/llm/tableparse/ — scores
//     each case (measure, each breakdown dimension, period kind, regions)
//     against benchmark/tableparse-labelled-set.json's expectations and
//     writes benchmark/tableparse-calibration-report.json. No fixtures are
//     recorded yet, so this will fail loudly until a record run exists —
//     expected, not a bug in this script.
//   --record: RecordingLlmClient — spends real Anthropic tokens and writes
//     replay fixtures. NEVER run in this step (task-4-brief.md): refused
//     unless TABLEPARSE_RECORD_OK=1 is set, so it cannot run by accident.
//     Recording is an owner-supervised step (CLAUDE.md git-workflow rule:
//     live LLM spend stays owner-supervised) — an autonomous/session-driven
//     run must never flip that env var itself.
//
//   npm run tableparse:eval             dry-run (no client, no spend)
//   npm run tableparse:eval -- --replay re-check committed fixtures, no key
//   npm run tableparse:eval -- --record live eval + (re)write fixtures — OWNER-SUPERVISED ONLY
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { CbsCode, CbsTableSchema } from '../src/cbs-adapter/types.ts';
import { buildTableParseSchema } from '../src/answer/table-parse/input.ts';
import {
  buildTableParseRequest,
  tableParse,
  TableParseValidationError,
  TableParseRegionUnavailableError,
} from '../src/answer/table-parse/parse.ts';
import {
  AnthropicLlmClient,
  RecordingLlmClient,
  ReplayLlmClient,
  requestHash,
  type LlmClient,
} from '../src/answer/llm/client.ts';

const SCHEMAS_DIR = fileURLToPath(new URL('../tests/fixtures/tableparse/schemas', import.meta.url));
const FIXTURES_DIR = fileURLToPath(new URL('../tests/fixtures/llm/tableparse', import.meta.url));
const SET_PATH = fileURLToPath(new URL('../benchmark/tableparse-labelled-set.json', import.meta.url));
const REPORT_PATH = fileURLToPath(new URL('../benchmark/tableparse-calibration-report.json', import.meta.url));

export interface LabelledCase {
  id: string;
  table: string;
  question: string;
  note?: string;
  expect: {
    measureCode: string;
    breakdowns: Record<string, string>;
    periodKind: string;
    regions: string[];
  };
}

export interface LabelledSet {
  note?: string;
  cases: LabelledCase[];
}

export function loadLabelledSet(): LabelledSet {
  return JSON.parse(readFileSync(SET_PATH, 'utf8')) as LabelledSet;
}

/** Reads Task 1's raw CBS metadata capture for one table — the SAME fixture
 * shape buildTableParseSchema takes everywhere else in this feature (Task
 * 2/3's own tests, the labelled-set integrity test). */
export function loadTableFixture(tableId: string): { schema: CbsTableSchema; codeLists: Record<string, CbsCode[]> } {
  const path = `${SCHEMAS_DIR}/${tableId}.json`;
  return JSON.parse(readFileSync(path, 'utf8')) as { schema: CbsTableSchema; codeLists: Record<string, CbsCode[]> };
}

export interface DryRunRow {
  id: string;
  table: string;
  requestHash: string;
  promptChars: number;
  estimatedTokens: number;
}

export interface DryRunSummary {
  rows: DryRunRow[];
  totalEstimatedTokens: number;
  largestPromptChars: number;
  largestPromptCaseId: string;
}

/** Builds every case's request PURELY from the fixtures — buildTableParseRequest
 * never calls a model, so this never constructs (and never needs) an
 * LlmClient. The "prompt size" is the full text the model actually receives:
 * the static system prompt plus this case's serialized user turn. */
export function buildDryRunRows(cases: LabelledCase[]): DryRunRow[] {
  return cases.map((c) => {
    const { schema, codeLists } = loadTableFixture(c.table);
    const input = buildTableParseSchema(schema, codeLists, c.question);
    const request = buildTableParseRequest(c.question, input);
    const promptChars = request.system.length + request.question.length;
    return {
      id: c.id,
      table: c.table,
      requestHash: requestHash(request),
      promptChars,
      estimatedTokens: Math.round(promptChars / 3.5),
    };
  });
}

export function summarizeDryRun(rows: DryRunRow[]): DryRunSummary {
  let largest = rows[0] ?? { id: '<none>', promptChars: 0 };
  let totalEstimatedTokens = 0;
  for (const row of rows) {
    totalEstimatedTokens += row.estimatedTokens;
    if (row.promptChars > largest.promptChars) largest = row;
  }
  return {
    rows,
    totalEstimatedTokens,
    largestPromptChars: largest.promptChars,
    largestPromptCaseId: largest.id,
  };
}

function runDryRun(): void {
  const set = loadLabelledSet();
  const summary = summarizeDryRun(buildDryRunRows(set.cases));
  console.log(`mode=dry-run cases=${set.cases.length} (zero spend, no client constructed)\n`);
  for (const row of summary.rows) {
    console.log(
      `${row.id.padEnd(40)} table=${row.table.padEnd(10)} hash=${row.requestHash.slice(0, 12)} ` +
        `chars=${String(row.promptChars).padStart(5)} estTokens=${row.estimatedTokens}`,
    );
  }
  console.log(
    `\nlargest prompt: ${summary.largestPromptCaseId} (${summary.largestPromptChars} chars, ` +
      `~${Math.round(summary.largestPromptChars / 3.5)} tokens)`,
  );
  console.log(`total estimated tokens across ${summary.rows.length} cases: ${summary.totalEstimatedTokens}`);
}

// ---------------------------------------------------------------------------
// --replay / --record — score each case's ACTUAL model output against the
// labelled expectation. Not run in this step (no fixtures recorded yet), but
// implemented now so the file matches the brief's full spec.
// ---------------------------------------------------------------------------

interface ScoredCase {
  id: string;
  pass: boolean;
  problems: string[];
}

function choiceLabel(choice: { kind: 'member' | 'not_named' | 'other'; code?: string } | undefined): string {
  if (!choice) return '<missing>';
  if (choice.kind === 'member') return choice.code ?? '<no code>';
  if (choice.kind === 'not_named') return 'niet_genoemd';
  return 'anders';
}

async function scoreCase(client: LlmClient, c: LabelledCase): Promise<ScoredCase> {
  const { schema, codeLists } = loadTableFixture(c.table);
  const input = buildTableParseSchema(schema, codeLists, c.question);
  const problems: string[] = [];
  try {
    const result = await tableParse(c.question, input, { client });
    const gotMeasure = result.measureCode ?? 'geen';
    if (gotMeasure !== c.expect.measureCode) {
      problems.push(`measure: expected ${c.expect.measureCode}, got ${gotMeasure}`);
    }
    for (const [dim, expected] of Object.entries(c.expect.breakdowns)) {
      const got = choiceLabel(result.breakdowns[dim]);
      if (got !== expected) {
        problems.push(`breakdown ${dim}: expected ${expected}, got ${got}`);
      }
    }
    if (result.period.kind !== c.expect.periodKind) {
      problems.push(`period kind: expected ${c.expect.periodKind}, got ${result.period.kind}`);
    }
    const gotRegions = [...result.regions.map((r) => r.name)].sort();
    const expRegions = [...c.expect.regions].sort();
    if (JSON.stringify(gotRegions) !== JSON.stringify(expRegions)) {
      problems.push(`regions: expected [${expRegions.join(', ')}], got [${gotRegions.join(', ')}]`);
    }
  } catch (error) {
    if (error instanceof TableParseRegionUnavailableError) {
      problems.push(`region-unavailable error: ${error.message}`);
    } else if (error instanceof TableParseValidationError) {
      problems.push(`validation error (the job would refuse): ${error.message}`);
    } else {
      throw error;
    }
  }
  return { id: c.id, pass: problems.length === 0, problems };
}

function buildClient(mode: 'replay' | 'record'): LlmClient {
  if (mode === 'replay') return new ReplayLlmClient(FIXTURES_DIR);
  const live = new AnthropicLlmClient();
  return new RecordingLlmClient(live, FIXTURES_DIR, (question) =>
    (loadLabelledSet().cases.find((c) => c.question === question) ?? { id: null }).id,
  );
}

async function runReplayOrRecord(mode: 'replay' | 'record'): Promise<void> {
  const set = loadLabelledSet();
  console.log(`mode=${mode} cases=${set.cases.length}`);
  const client = buildClient(mode);
  const results: ScoredCase[] = [];
  for (const c of set.cases) {
    const scored = await scoreCase(client, c);
    results.push(scored);
    const mark = scored.pass ? 'ok  ' : 'FAIL';
    console.log(`${mark} ${scored.id}`);
    for (const p of scored.problems) console.log(`       ${p}`);
  }
  const summary = {
    generatedAt: new Date().toISOString(),
    mode,
    totals: { pass: results.filter((r) => r.pass).length, total: results.length },
    results,
  };
  const prior: unknown[] = existsSync(REPORT_PATH)
    ? ((JSON.parse(readFileSync(REPORT_PATH, 'utf8')) as { history?: unknown[] }).history ?? [])
    : [];
  writeFileSync(REPORT_PATH, `${JSON.stringify({ ...summary, history: [...prior, summary].slice(-20) }, null, 2)}\n`);
  console.log(`report written to ${REPORT_PATH}`);
  console.log(`\n${summary.totals.pass}/${summary.totals.total} passed`);
  if (summary.totals.pass < summary.totals.total) process.exitCode = 1;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--record')) {
    // Global Constraints / CLAUDE.md git-workflow rule: live LLM spend stays
    // owner-supervised. This guard is what makes that true in practice
    // rather than just in policy — an autonomous session must never set
    // this env var itself, only the owner, in an owner-supervised session.
    if (process.env.TABLEPARSE_RECORD_OK !== '1') {
      console.error(
        'Refusing --record: recording table-parse fixtures spends real Anthropic tokens and is an ' +
          "OWNER-SUPERVISED step, never run automatically. Set TABLEPARSE_RECORD_OK=1 to proceed " +
          '(the owner sets this themselves; an autonomous or task-chip session must never set it).',
      );
      process.exitCode = 1;
      return;
    }
    await runReplayOrRecord('record');
    return;
  }
  if (args.includes('--replay')) {
    await runReplayOrRecord('replay');
    return;
  }
  runDryRun();
}

// Only run the CLI when this file is executed directly (`node .../tableparse-eval.ts`),
// never when imported — the dry-run test imports buildDryRunRows/summarizeDryRun
// directly and must not trigger argv parsing or (in --record's case) a real
// LlmClient construction as a side effect of import.
const isMain = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  await main();
}

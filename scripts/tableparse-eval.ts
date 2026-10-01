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
//     each case (measure, each breakdown dimension, period kind, regions,
//     region class) against benchmark/tableparse-labelled-set.json's
//     expectations — an expected refusal ('ambiguous' measure, or outcome
//     'region_unavailable') scores correct only when the validator throws
//     that exact error class — and writes
//     benchmark/tableparse-calibration-report.json with, per case, the
//     confidence, periodGrainUnavailable and the error class thrown (if any).
//     No fixtures are recorded yet, so this will fail loudly until a record
//     run exists — expected, not a bug in this script.
//   --record: RecordingLlmClient — spends real Anthropic tokens and writes
//     replay fixtures, each labelled with its case id (matched by the exact
//     serialized user turn, see buildLabelIndex). NEVER run in step 4
//     (plan: docs/superpowers/plans/2026-09-28-breadth-step-4-table-parser.md):
//     refused unless TABLEPARSE_RECORD_OK=1 is set, so it cannot run by accident.
//     Recording is an owner-supervised step (CLAUDE.md git-workflow rule:
//     live LLM spend stays owner-supervised) — an autonomous/session-driven
//     run must never flip that env var itself.
//
// ADR 062 step 6: every mode ALSO covers the table-lane benchmark's parse
// requests (benchmark/tablelane-tasks.json, one per task, labelled
// `bench:<id>`): dry-run lists them and their token estimate, --record records
// them in the same run, --replay checks their fixtures exist. They are not
// scored here (the table-lane benchmark scores the audited outcomes).
//
//   npm run tableparse:eval             dry-run (no client, no spend)
//   npm run tableparse:eval -- --replay re-check committed fixtures, no key
//   npm run tableparse:eval -- --record live eval + (re)write fixtures — OWNER-SUPERVISED ONLY
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { CbsCode, CbsTableSchema } from '../src/cbs-adapter/types.ts';
import { buildTableParseSchema } from '../src/answer/table-parse/input.ts';
import { isTotalPick } from '../src/answer/table-parse/bridge.ts';
import type { TableParseSchema } from '../src/answer/table-parse/input.ts';
import {
  buildTableParseRequest,
  tableParse,
  tableParsePrefilterText,
  TableParseValidationError,
  TableParseRegionUnavailableError,
  TableParseAmbiguousMeasureError,
} from '../src/answer/table-parse/parse.ts';
import {
  AnthropicLlmClient,
  RecordingLlmClient,
  ReplayLlmClient,
  requestHash,
  type LlmClient,
  type LlmRequest,
} from '../src/answer/llm/client.ts';
import { loadTableLaneTasks, taskParseRequest } from './tablelane-bench-lib.ts';

const SCHEMAS_DIR = fileURLToPath(new URL('../tests/fixtures/tableparse/schemas', import.meta.url));
const FIXTURES_DIR = fileURLToPath(new URL('../tests/fixtures/llm/tableparse', import.meta.url));
const SET_PATH = fileURLToPath(new URL('../benchmark/tableparse-labelled-set.json', import.meta.url));
const REPORT_PATH = fileURLToPath(new URL('../benchmark/tableparse-calibration-report.json', import.meta.url));

/** measureCode value for "the fitting measures are indistinguishable" —
 * the validator must throw TableParseAmbiguousMeasureError. */
export const LABEL_AMBIGUOUS_MEASURE = 'ambiguous';

export interface LabelledCase {
  id: string;
  table: string;
  question: string;
  /** Breadth step 5, Task 7: a follow-up case — the previous table-lane
   * question in the same conversation, sent as the parser's "Vorige vraag"
   * line (prompt version 3) and read by the member pre-filter, exactly as
   * planTableLane does. Absent on every standalone case. */
  previousQuestion?: string;
  note?: string;
  expect: {
    /** A real measure code, 'geen', or LABEL_AMBIGUOUS_MEASURE. Exactly one
     * of `measureCode`/`acceptableMeasureCodes` is present on any given
     * case (breadth step 4b, Task 2) — never both, never neither. */
    measureCode?: string;
    /** Present INSTEAD OF `measureCode` when several measures are equally
     * faithful reads of the question and the answer just needs to name
     * which one it used (breadth step 4b, Task 2 — e.g. 80590ned's
     * seasonally-adjusted and non-adjusted unemployed measures of the same
     * CBS measure group, when the question doesn't say which it wants). The
     * eval scores a pick anywhere in this set as correct. Every listed code
     * must be a real, offered measure on the table (checked by the
     * integrity test). */
    acceptableMeasureCodes?: string[];
    /** Required with LABEL_AMBIGUOUS_MEASURE: the offered measures the
     * model cannot tell apart (any pick among them must throw). */
    ambiguousMeasures?: string[];
    /** 'region_unavailable': a named place the table cannot serve — the
     * validator must throw TableParseRegionUnavailableError. */
    outcome?: 'region_unavailable';
    breakdowns: Record<string, string>;
    periodKind: string;
    regions: string[];
    /** Absent = null (no region class asked). */
    regionScope?: string | null;
  };
}

/** The error class a case expects the validator to throw, or null when the
 * case expects an ordinary parse. */
export function expectedErrorClass(c: LabelledCase): string | null {
  if (c.expect.measureCode === LABEL_AMBIGUOUS_MEASURE) return 'TableParseAmbiguousMeasureError';
  if (c.expect.outcome === 'region_unavailable') return 'TableParseRegionUnavailableError';
  return null;
}

/** The single measure code to use when building CANNED "the model chose
 * this" output for a non-ambiguous case: the case's own `measureCode`, or
 * the first of `acceptableMeasureCodes` when the case uses that form instead
 * — either representative is equally correct per the label, so validating
 * with one of them is enough to prove the label matches the real
 * validator/breakdowns/period rules (breadth step 4b, Task 2). */
export function representativeMeasureCode(c: LabelledCase): string {
  if (c.expect.acceptableMeasureCodes !== undefined) {
    return c.expect.acceptableMeasureCodes[0]!;
  }
  return c.expect.measureCode!;
}

/** Whether a scored case's ACTUAL measure pick matches its label: exact
 * equality against `measureCode`, or membership in `acceptableMeasureCodes`
 * when the case uses that form instead (breadth step 4b, Task 2). */
export function measureMatchesLabel(c: LabelledCase, gotMeasure: string): boolean {
  if (c.expect.acceptableMeasureCodes !== undefined) {
    return c.expect.acceptableMeasureCodes.includes(gotMeasure);
  }
  return gotMeasure === c.expect.measureCode;
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

/** One case's parser input and request, built exactly as planTableLane
 * builds them (src/answer/table-lane/plan.ts): the member pre-filter reads
 * tableParsePrefilterText(question, previousQuestion), and the request
 * carries the previous question. The one builder every mode and the
 * integrity test use, so a case's offered menu and request hash can never
 * drift from production's. */
export function caseParseInput(c: LabelledCase): { input: TableParseSchema; request: LlmRequest } {
  const { schema, codeLists } = loadTableFixture(c.table);
  const previousQuestion = c.previousQuestion ?? null;
  const input = buildTableParseSchema(schema, codeLists, tableParsePrefilterText(c.question, previousQuestion));
  return { input, request: buildTableParseRequest(c.question, input, { previousQuestion }) };
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
    const { request } = caseParseInput(c);
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

/** Final-review F7: RecordingLlmClient's label callback only receives the
 * serialized user turn (request.question), not the reader's question — so
 * the index maps each case's EXACT serialized user turn to its id. Two cases
 * with the same table + question would collide (the last one would win); the
 * integrity test pins that the index has one entry per case and that every
 * case maps back to itself, so a collision fails CI instead of mislabelling
 * a fixture. */
export function buildLabelIndex(cases: LabelledCase[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const c of cases) {
    index.set(caseParseInput(c).request.question, c.id);
  }
  return index;
}

// ---------------------------------------------------------------------------
// ADR 062 step 6 — the table-lane benchmark's parse requests ride the SAME
// supervised recording run: one request per benchmark task
// (benchmark/tablelane-tasks.json), built by the benchmark's own builder
// (scripts/tablelane-bench-lib.ts taskParseRequest — exactly what the lane
// sends for that task; a button-click reply re-sends the same request). They
// are recorded next to the labelled cases, labelled `bench:<task id>`, and are
// NOT scored here: the table-lane benchmark (npm run tablelane:bench:run)
// scores the audited outcomes. The labelled cases' requests are untouched.
// ---------------------------------------------------------------------------

export const BENCH_LABEL_PREFIX = 'bench:';

export interface BenchRequest {
  id: string;
  table: string;
  request: LlmRequest;
}

export function benchmarkRequests(): BenchRequest[] {
  return loadTableLaneTasks().tasks.map((t) => ({ id: `${BENCH_LABEL_PREFIX}${t.id}`, table: t.table, request: taskParseRequest(t) }));
}

/** Dry-run rows for the benchmark requests — the same size estimate as the
 * labelled cases' rows (buildDryRunRows). */
export function buildBenchmarkDryRunRows(): DryRunRow[] {
  return benchmarkRequests().map(({ id, table, request }) => {
    const promptChars = request.system.length + request.question.length;
    return { id, table, requestHash: requestHash(request), promptChars, estimatedTokens: Math.round(promptChars / 3.5) };
  });
}

function printRows(rows: DryRunRow[]): void {
  for (const row of rows) {
    console.log(
      `${row.id.padEnd(40)} table=${row.table.padEnd(10)} hash=${row.requestHash.slice(0, 12)} ` +
        `chars=${String(row.promptChars).padStart(5)} estTokens=${row.estimatedTokens}`,
    );
  }
}

function runDryRun(): void {
  const set = loadLabelledSet();
  const summary = summarizeDryRun(buildDryRunRows(set.cases));
  console.log(`mode=dry-run cases=${set.cases.length} (zero spend, no client constructed)\n`);
  printRows(summary.rows);
  console.log(
    `\nlargest prompt: ${summary.largestPromptCaseId} (${summary.largestPromptChars} chars, ` +
      `~${Math.round(summary.largestPromptChars / 3.5)} tokens)`,
  );
  console.log(`total estimated tokens across ${summary.rows.length} cases: ${summary.totalEstimatedTokens}`);

  const bench = summarizeDryRun(buildBenchmarkDryRunRows());
  console.log(`\ntable-lane benchmark requests (ADR 062 step 6, recorded in the same run, not scored here):\n`);
  printRows(bench.rows);
  console.log(
    `\nlargest benchmark prompt: ${bench.largestPromptCaseId} (${bench.largestPromptChars} chars, ` +
      `~${Math.round(bench.largestPromptChars / 3.5)} tokens)`,
  );
  console.log(`total estimated tokens across ${bench.rows.length} benchmark requests: ${bench.totalEstimatedTokens}`);
  console.log(
    `\nrecording run total (labelled cases + benchmark requests): ${summary.rows.length + bench.rows.length} calls, ` +
      `~${summary.totalEstimatedTokens + bench.totalEstimatedTokens} estimated input tokens`,
  );
  // Session 153: the chars/3.5 estimate leaves out the structured-output
  // JSON schema the API adds to every call. Measured on the real recordings:
  // billed input was 1.9x this estimate on claude-haiku-4-5 and 2.5x on
  // claude-sonnet-5. Quote spend from the measured factor, never the raw estimate.
  console.log(
    `budget with the measured factor: ~${Math.round((summary.totalEstimatedTokens + bench.totalEstimatedTokens) * 2.5)} ` +
      `billed input tokens on the mid tier (2.5x, measured 2026-10-01)`,
  );
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
  /** The model's stated confidence, null when the validator threw. */
  confidence: number | null;
  /** The validator's grain signal, null when the validator threw. */
  periodGrainUnavailable: boolean | null;
  /** The TableParseValidationError subclass name thrown, if any. */
  errorClass: string | null;
  /** The replay-fixture key for this case's request. */
  requestHash: string;
}

/** Session 153: a pick the bridge treats as "not restricted"
 * (src/answer/table-parse/bridge.ts isTotalPick — the unique CBS grand total,
 * or any total-like member when the dimension has no unique total) is the
 * same reading as 'niet_genoemd': the bridge leaves it to the resolver,
 * which lands on the same total or asks. Scored as equal for that reason
 * only, through the bridge's own function so the two cannot drift. */
export function isExplicitGrandTotalPick(table: string, dim: string, expected: string, got: string): boolean {
  if (expected !== 'niet_genoemd') return false;
  const codes = loadTableFixture(table).codeLists[dim] ?? [];
  return isTotalPick(codes.map((m) => ({ code: m.code, title: m.title })), got);
}

function choiceLabel(choice: { kind: 'member' | 'not_named' | 'other'; code?: string } | undefined): string {
  if (!choice) return '<missing>';
  if (choice.kind === 'member') return choice.code ?? '<no code>';
  if (choice.kind === 'not_named') return 'niet_genoemd';
  return 'anders';
}

export async function scoreCase(client: LlmClient, c: LabelledCase): Promise<ScoredCase> {
  const { input, request } = caseParseInput(c);
  const problems: string[] = [];
  const expectedError = expectedErrorClass(c);
  const scored: Omit<ScoredCase, 'pass' | 'problems'> = {
    id: c.id,
    confidence: null,
    periodGrainUnavailable: null,
    errorClass: null,
    requestHash: requestHash(request),
  };
  try {
    const { result } = await tableParse(c.question, input, { client, previousQuestion: c.previousQuestion ?? null });
    scored.confidence = result.confidence;
    scored.periodGrainUnavailable = result.periodGrainUnavailable;
    if (expectedError !== null) {
      problems.push(
        `expected ${expectedError}, got a parse (measure ${result.measureCode ?? 'geen'}) — the job would not refuse`,
      );
      return { ...scored, pass: false, problems };
    }
    const gotMeasure = result.measureCode ?? 'geen';
    if (!measureMatchesLabel(c, gotMeasure)) {
      const expected = c.expect.acceptableMeasureCodes
        ? `one of [${c.expect.acceptableMeasureCodes.join(', ')}]`
        : c.expect.measureCode;
      problems.push(`measure: expected ${expected}, got ${gotMeasure}`);
    }
    for (const [dim, expected] of Object.entries(c.expect.breakdowns)) {
      const got = choiceLabel(result.breakdowns[dim]);
      if (got !== expected && !isExplicitGrandTotalPick(c.table, dim, expected, got)) {
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
    const expScope = c.expect.regionScope ?? null;
    if (result.regionScope !== expScope) {
      problems.push(`regionScope: expected ${expScope}, got ${result.regionScope}`);
    }
  } catch (error) {
    if (!(error instanceof TableParseValidationError)) throw error;
    scored.errorClass = error.name;
    const matchesExpected =
      (expectedError === 'TableParseAmbiguousMeasureError' && error instanceof TableParseAmbiguousMeasureError) ||
      (expectedError === 'TableParseRegionUnavailableError' && error instanceof TableParseRegionUnavailableError);
    if (!matchesExpected) {
      const expectation = expectedError === null ? 'a parse' : expectedError;
      problems.push(`expected ${expectation}, got ${error.name} (the job would refuse): ${error.message}`);
    }
  }
  return { ...scored, pass: problems.length === 0, problems };
}

function buildClient(mode: 'replay' | 'record'): LlmClient {
  if (mode === 'replay') return new ReplayLlmClient(FIXTURES_DIR);
  const live = new AnthropicLlmClient();
  const labels = buildLabelIndex(loadLabelledSet().cases);
  const benchLabels = new Map(benchmarkRequests().map((b) => [b.request.question, b.id]));
  return new RecordingLlmClient(
    live,
    FIXTURES_DIR,
    (serializedTurn) => labels.get(serializedTurn) ?? benchLabels.get(serializedTurn) ?? null,
  );
}

/** Record (or, in replay, check) every benchmark request's fixture. Returns
 * the ids whose call failed — in replay: a missing fixture. */
async function runBenchmarkRequests(client: LlmClient, mode: 'replay' | 'record'): Promise<{ total: number; failed: { id: string; error: string }[] }> {
  const requests = benchmarkRequests();
  const failed: { id: string; error: string }[] = [];
  for (const { id, request } of requests) {
    try {
      await client.complete(request);
      console.log(`${mode === 'record' ? 'rec ' : 'ok  '} ${id}`);
    } catch (error) {
      const message = error instanceof Error ? error.message.split('\n')[0]! : String(error);
      failed.push({ id, error: message });
      console.log(`FAIL ${id}\n       ${message}`);
    }
  }
  return { total: requests.length, failed };
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
  console.log(`\ntable-lane benchmark requests (${mode === 'record' ? 'recording' : 'checking fixtures'}):`);
  const bench = await runBenchmarkRequests(client, mode);
  const summary = {
    generatedAt: new Date().toISOString(),
    mode,
    totals: { pass: results.filter((r) => r.pass).length, total: results.length },
    results,
    // ADR 062 step 6: fixture coverage of the table-lane benchmark (scored by
    // npm run tablelane:bench:run / :score, not here).
    benchmarkFixtures: { ok: bench.total - bench.failed.length, total: bench.total, failed: bench.failed },
  };
  const prior: unknown[] = existsSync(REPORT_PATH)
    ? ((JSON.parse(readFileSync(REPORT_PATH, 'utf8')) as { history?: unknown[] }).history ?? [])
    : [];
  writeFileSync(REPORT_PATH, `${JSON.stringify({ ...summary, history: [...prior, summary].slice(-20) }, null, 2)}\n`);
  console.log(`report written to ${REPORT_PATH}`);
  console.log(`\n${summary.totals.pass}/${summary.totals.total} passed`);
  console.log(
    `table-lane benchmark fixtures: ${summary.benchmarkFixtures.ok}/${summary.benchmarkFixtures.total} ` +
      `${mode === 'record' ? 'recorded' : 'present'}`,
  );
  if (summary.totals.pass < summary.totals.total || bench.failed.length > 0) process.exitCode = 1;
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

// ADR 062 step 6 — the table-lane benchmark scorer. Scores the AUDIT RECORDS
// a run dumped (scripts/run-tablelane-benchmark.ts) against the frozen task
// file and answer key, mechanically — every check reads the dump, the key and
// deterministic src helpers, never a live pipeline object (R8).
//
// Per task:
//   answer  → an answer whose stored result holds every key cell verbatim
//             (table, measure, period, region, breakdown coordinates, value,
//             CBS status) — the number traceable to the cell (principle a);
//   refuse  → a refusal whose typed reason is one of the task's reasons, and
//             no data number in the text (principle c);
//   ask     → a button question about the expected dimension with options and
//             exactly one '?', AND after the one click an answer that matches
//             the key (the curated clarify-task rule, docs/02);
//   all     → the audit record reconstructs (R8) and no fetch fell outside
//             the snapshot (the parse chose a slice nobody expected).
// Invented numbers: answers — the R1 body scan (scanBody 'unbacked'), run from
// the stored record; non-answers — every numeric token not backed by a
// structured source (the table's own title and id, its latest period per
// grain, the button question's own options/count/title).
//
// Gate (benchmark/tablelane-tasks.json `gate`): answer tasks >= answerableMin,
// refuse+ask tasks all pass, invented numbers 0.
//
//   npm run tablelane:bench:score [-- <dump>] [-- --report <path>]
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AuditRecord } from '../src/answer/audit/index.ts';
import { reconstructionReport } from '../src/answer/audit/reconstruct.ts';
import { findNumericTokens, normalizeForScan, numbersInText, periodCodeNumbers } from '../src/answer/compose/format.ts';
import { scanBody } from '../src/answer/compose/validate.ts';
import type { TableLaneEnvelope } from '../src/answer/table-lane/types.ts';
import { parsePeriodCode } from '../src/ingestion/periods.ts';
import { SEED_TABLES } from '../src/ingestion/registry-seed.ts';
import type { ResultCell } from '../src/query/types.ts';
import { loadSchemaFixture } from '../tests/helpers/tablelane-bench-source.ts';
import { DEFAULT_DUMP_PATH, type TableLaneDump } from './run-tablelane-benchmark.ts';
import {
  loadTableLaneKey,
  loadTableLaneTasks,
  type KeyCell,
  type TableLaneKeyEntry,
  type TableLaneKeyFile,
  type TableLaneTask,
  type TableLaneTaskFile,
} from './tablelane-bench-lib.ts';

export interface TaskScore {
  id: string;
  type: TableLaneTask['type'];
  pass: boolean;
  outcome: string;
  problems: string[];
}

export interface TableLaneScore {
  mode: string;
  answer: { pass: number; total: number; min: number };
  refuseAsk: { pass: number; total: number };
  inventedNumbers: number;
  gatePass: boolean;
  tasks: TaskScore[];
}

/** Structural checks of the frozen definition itself (no run needed). */
export function definitionProblems(file: TableLaneTaskFile, key: TableLaneKeyFile): string[] {
  const problems: string[] = [];
  const curated = new Set(SEED_TABLES.map((t) => t.id.toLowerCase()));
  const ids = new Set<string>();
  for (const t of file.tasks) {
    if (ids.has(t.id)) problems.push(`duplicate task id ${t.id}`);
    ids.add(t.id);
    if (!t.question.trim()) problems.push(`${t.id}: empty question`);
    if (curated.has(t.table.toLowerCase())) problems.push(`${t.id}: table ${t.table} is in the curated set — the curated lane would answer it`);
    if (t.type === 'refuse' && t.expectReasons.length === 0) problems.push(`${t.id}: refuse task without expectReasons`);
    if (t.type === 'answer' || t.type === 'ask') {
      const entry = key.tasks[t.id];
      if (!entry) problems.push(`${t.id}: no answer-key entry`);
      else if (entry.table !== t.table) problems.push(`${t.id}: key table ${entry.table} != task table ${t.table}`);
      else if (entry.cells.length === 0) problems.push(`${t.id}: key entry has no cells`);
    }
  }
  for (const id of Object.keys(key.tasks)) {
    const t = file.tasks.find((x) => x.id === id);
    if (!t || t.type === 'refuse') problems.push(`key entry ${id} has no answer/ask task`);
  }
  const answers = file.tasks.filter((t) => t.type === 'answer').length;
  if (file.gate.answerableMin > answers) problems.push(`gate answerableMin ${file.gate.answerableMin} > ${answers} answer tasks`);
  if (file.tasks.filter((t) => t.type !== 'answer').length < 6) problems.push('fewer than 6 refuse/ask tasks');
  return problems;
}

function laneOf(record: AuditRecord): TableLaneEnvelope | null {
  return (record.response as { tableLane?: TableLaneEnvelope }).tableLane ?? null;
}

/** Numbers a non-answer text may contain: structured sources only. */
function nonAnswerWhitelist(record: AuditRecord, tableId: string): Set<number> {
  const allowed = new Set<number>();
  const { schema, codeLists } = loadSchemaFixture(tableId);
  for (const n of numbersInText(schema.title)) allowed.add(n);
  for (const n of numbersInText(tableId)) allowed.add(n);
  const time = schema.dimensions.find((d) => d.kind === 'TimeDimension');
  if (time) {
    // The period-missing template cites the table's latest period (a code,
    // never a value): the latest code at each grain.
    const latest = new Map<string, string>();
    for (const c of codeLists[time.name] ?? []) {
      const p = parsePeriodCode(c.code);
      if (!p) continue;
      const prev = latest.get(p.grain);
      if (prev === undefined || c.code > prev) latest.set(p.grain, c.code);
    }
    for (const code of latest.values()) for (const n of periodCodeNumbers(code)) allowed.add(n);
  }
  const question = laneOf(record)?.question ?? null;
  if (question) {
    allowed.add(question.totalOptions);
    for (const n of numbersInText(question.dimensionTitle)) allowed.add(n);
    for (const o of question.options) for (const n of numbersInText(o.title)) allowed.add(n);
  }
  return allowed;
}

function inventedTokens(record: AuditRecord, tableId: string): string[] {
  const response = record.response;
  if (response.kind === 'answer') {
    return scanBody(normalizeForScan(response.answer.body), response.result)
      .filter((t) => t.kind === 'unbacked')
      .map((t) => t.token);
  }
  const allowed = nonAnswerWhitelist(record, tableId);
  return findNumericTokens(normalizeForScan(record.finalText))
    .filter((t) => !allowed.has(t.value))
    .map((t) => t.token);
}

function cellMatches(cell: ResultCell, want: KeyCell, table: string): boolean {
  if (cell.tableId !== table || cell.measure !== want.measure || cell.periodCode !== want.period) return false;
  if ((cell.regionCode ?? null) !== want.region) return false;
  for (const [dim, code] of Object.entries(want.dims)) if (cell.dims[dim] !== code) return false;
  return true;
}

function answerProblems(record: AuditRecord, entry: TableLaneKeyEntry): string[] {
  if (record.response.kind !== 'answer') {
    return [`expected an answer, got ${record.kind}${record.refusalReason ? ` (${record.refusalReason})` : ''}`];
  }
  const problems: string[] = [];
  const cells = record.response.result.cells;
  for (const want of entry.cells) {
    const at = cells.find((c) => cellMatches(c, want, entry.table));
    const where = `${want.measure} @ ${want.period}${want.region ? ` ${want.region}` : ''} ${JSON.stringify(want.dims)}`;
    if (!at) {
      problems.push(`key cell ${where} is not among the stored result cells`);
      continue;
    }
    if (at.value !== want.value) problems.push(`key cell ${where}: stored value ${at.value} != key ${want.value}`);
    if (at.status !== want.status) problems.push(`key cell ${where}: status ${at.status} != key ${want.status}`);
    if (at.provisional !== (want.status !== 'Definitief')) problems.push(`key cell ${where}: provisional flag ${at.provisional} is wrong`);
  }
  if (cells.length !== entry.cells.length) {
    problems.push(`the answer holds ${cells.length} cell(s), the key ${entry.cells.length} — it answered about more or other cells`);
  }
  return problems;
}

export function scoreTableLaneDump(dump: TableLaneDump, file: TableLaneTaskFile, key: TableLaneKeyFile): TableLaneScore {
  const recordById = new Map(dump.records.map((r) => [r.id, r]));
  const runById = new Map(dump.tasks.map((t) => [t.id, t]));
  if (runById.size !== dump.tasks.length) throw new Error('duplicate task id in the dump');
  const scores: TaskScore[] = [];
  let invented = 0;

  const common = (record: AuditRecord, tableId: string, problems: string[]) => {
    const report = reconstructionReport(record);
    if (!report.ok) problems.push(...report.problems.map((p) => `R8: ${p}`));
    const tokens = inventedTokens(record, tableId);
    if (tokens.length > 0) {
      invented += tokens.length;
      problems.push(`invented number(s): ${tokens.join(', ')}`);
    }
    const lane = laneOf(record);
    if (lane === null) problems.push('the audit row carries no tableLane envelope — not a table-lane response');
    else if (lane.tableId !== tableId) problems.push(`answered from table ${lane.tableId}, task table ${tableId}`);
  };

  for (const task of file.tasks) {
    const run = runById.get(task.id);
    if (!run) throw new Error(`${task.id}: not in the dump — the run is incomplete`);
    const record = recordById.get(run.auditId);
    if (!record) throw new Error(`${task.id}: audit record ${run.auditId} not in the dump`);
    const problems: string[] = [];
    common(record, task.table, problems);
    for (const u of run.uncovered) {
      problems.push(`the lane fetched a slice the snapshot does not hold (a reading nobody expected): ${JSON.stringify(u.slice)}`);
    }
    let outcome: string = record.kind + (record.refusalReason ? ` (${record.refusalReason})` : '');

    if (task.type === 'answer') {
      problems.push(...answerProblems(record, key.tasks[task.id]!));
    } else if (task.type === 'refuse') {
      if (record.kind !== 'refusal') problems.push(`expected a refusal, got ${record.kind}`);
      else if (!task.expectReasons.includes(record.refusalReason ?? '')) {
        problems.push(`refusal reason '${record.refusalReason}' is not one of [${task.expectReasons.join(', ')}]`);
      }
    } else {
      const lane = laneOf(record);
      if (record.kind !== 'clarification') {
        problems.push(`expected a button question, got ${record.kind}`);
      } else {
        if (lane?.question?.dimension !== task.expectDimension) {
          problems.push(`asked about '${lane?.question?.dimension ?? '(none)'}', expected '${task.expectDimension}'`);
        }
        if ((lane?.question?.options.length ?? 0) === 0) problems.push('the button question offers no options');
        const marks = (record.finalText.match(/\?/g) ?? []).length;
        if (marks !== 1) problems.push(`exactly one question required, found ${marks} '?'`);
      }
      if (run.replyAuditId === undefined) {
        problems.push('no reply round (the first turn did not ask about the expected dimension)');
      } else {
        const reply = recordById.get(run.replyAuditId);
        if (!reply) throw new Error(`${task.id}: reply audit record ${run.replyAuditId} not in the dump`);
        common(reply, task.table, problems);
        problems.push(...answerProblems(reply, key.tasks[task.id]!).map((p) => `after the click: ${p}`));
        outcome += ` -> ${reply.kind}${reply.refusalReason ? ` (${reply.refusalReason})` : ''}`;
      }
    }
    scores.push({ id: task.id, type: task.type, pass: problems.length === 0, outcome, problems });
  }

  const answer = scores.filter((s) => s.type === 'answer');
  const refuseAsk = scores.filter((s) => s.type !== 'answer');
  const answerPass = answer.filter((s) => s.pass).length;
  const refuseAskPass = refuseAsk.filter((s) => s.pass).length;
  return {
    mode: dump.mode,
    answer: { pass: answerPass, total: answer.length, min: file.gate.answerableMin },
    refuseAsk: { pass: refuseAskPass, total: refuseAsk.length },
    inventedNumbers: invented,
    gatePass: answerPass >= file.gate.answerableMin && refuseAskPass === refuseAsk.length && invented === 0,
    tasks: scores,
  };
}

export function formatScore(score: TableLaneScore): string {
  const lines = score.tasks.map(
    (t) =>
      `  ${t.pass ? 'PASS' : 'FAIL'}  ${t.id} (${t.type}) ${t.outcome}` +
      (t.problems.length > 0 ? `\n        - ${t.problems.join('\n        - ')}` : ''),
  );
  return [
    `table-lane benchmark (${score.mode}):`,
    ...lines,
    '',
    `  answer tasks: ${score.answer.pass}/${score.answer.total} (gate: >= ${score.answer.min})`,
    `  refuse/ask tasks: ${score.refuseAsk.pass}/${score.refuseAsk.total} (gate: all)`,
    `  invented numbers: ${score.inventedNumbers} (gate: 0)`,
    `  GATE VERDICT: ${score.gatePass ? 'PASS' : 'FAIL'}`,
  ].join('\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  let dumpPath = DEFAULT_DUMP_PATH;
  let reportPath: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--report') reportPath = argv[++i] ?? null;
    else dumpPath = resolve(argv[i]!);
  }
  const file = loadTableLaneTasks();
  const key = loadTableLaneKey();
  const structural = definitionProblems(file, key);
  if (structural.length > 0) {
    console.error(`table-lane benchmark definition is broken:\n  ${structural.join('\n  ')}`);
    process.exit(1);
  }
  if (!existsSync(dumpPath)) {
    console.error(`no dump at ${dumpPath} — run: npm run tablelane:bench:run (replay) or -- --canned`);
    process.exit(1);
  }
  const dump = JSON.parse(readFileSync(dumpPath, 'utf8')) as TableLaneDump;
  const score = scoreTableLaneDump(dump, file, key);
  console.log(formatScore(score));
  if (reportPath) {
    writeFileSync(resolve(reportPath), `${JSON.stringify({ scoredAt: new Date().toISOString(), runGeneratedAt: dump.generatedAt, ...score }, null, 2)}\n`);
    console.log(`  report written to ${reportPath}`);
  }
  if (!score.gatePass) process.exitCode = 1;
}

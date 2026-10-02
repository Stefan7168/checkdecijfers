// ADR 062 step 6 — the table-lane benchmark runner. Drives every frozen task
// (benchmark/tablelane-tasks.json) through the REAL table-lane path: a queued
// table_lane_requests row (createTableLaneRequest, the money reservation
// included) → runTableLaneJob (registerSchemaOnly, planTableLane with the
// table-scoped parse, ensureSlice, respondTableLane, the audit row, the
// settlement) — the same code the /api/table-lane-job route runs. An `ask`
// task plays its one button click exactly like replyToTableLane does (a reply
// child row: the parent's question and previous question, the choices plus
// the clicked member) and runs the job again.
//
// Hermetic: a fresh PGlite database (all migrations), the committed CBS
// snapshot (tests/helpers/tablelane-bench-source.ts), no network, no API key.
// The table parse comes from one of two model stand-ins:
//
//   --replay (default)  ReplayLlmClient over tests/fixtures/llm/tableparse/ —
//                       the recorded Haiku outputs from the supervised
//                       `tableparse:record` run. EVERY fixture the run needs is
//                       checked BEFORE anything runs: one missing fixture
//                       stops the run with the full list (never a silent pass,
//                       never a refusal that only looks like one).
//   --canned            each task's expected parse fed to the real planner as
//                       the model's output. Proves the harness, the snapshot
//                       and the answer key agree with each other; says nothing
//                       about the model. What CI runs until fixtures exist.
//
// Answer wording: no compose model is recorded for the lane, so the answer
// text is the deterministic template (the compose client is a stand-in that
// always fails, which is the product's own fallback). The lane's numbers,
// refusals and questions are what this benchmark measures; model-written
// prose is the curated benchmark's job.
//
// Like the curated runner, this DUMPS audit records and does not score:
// scripts/score-tablelane-benchmark.ts scores the dump (R8 — scoring reads
// the audit records).
//
//   npm run tablelane:bench:run              replay (after the recording run)
//   npm run tablelane:bench:run -- --canned  canned (any time)
//   npm run tablelane:bench:score            score benchmark/tablelane-audit-run.json
import { randomUUID } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAuditRecord, type AuditRecord } from '../src/answer/audit/index.ts';
import type { AuditedRespondOptions } from '../src/answer/audit/respond-audited.ts';
import { ReplayLlmClient, requestHash, type LlmClient, type LlmRequest, type LlmResponse } from '../src/answer/llm/client.ts';
import type { TableLaneEnvelope } from '../src/answer/table-lane/types.ts';
import { TABLE_PARSE_PROMPT_VERSION, TABLE_PARSE_SCHEMA_VERSION } from '../src/answer/table-parse/parse.ts';
import { applyPricingDefaults } from '../src/billing/pricing-apply.ts';
import type { Db } from '../src/db/types.ts';
import { runTableLaneJob, type TableLaneJobSummary } from '../src/ingestion/table-lane-job.ts';
import { createTableLaneRequest, readTableLaneRequest, type TableLaneRow } from '../src/ingestion/table-lane-store.ts';
import { createTestDb } from '../tests/helpers/pglite-db.ts';
import { TableLaneBenchSource } from '../tests/helpers/tablelane-bench-source.ts';
import {
  CannedParseClient,
  loadTableLaneTasks,
  setFromArgv,
  taskParseRequest,
  type TableLaneSet,
  type TableLaneTask,
} from './tablelane-bench-lib.ts';

export const TABLEPARSE_FIXTURES_DIR = fileURLToPath(new URL('../tests/fixtures/llm/tableparse', import.meta.url));
export const DEFAULT_DUMP_PATH = fileURLToPath(new URL('../benchmark/tablelane-audit-run.json', import.meta.url));
/** The Eurostat set (session 153): its parser fixtures sit with the Eurostat
 * calibration recordings, its dump beside the CBS one. */
export const EUROSTAT_TABLEPARSE_FIXTURES_DIR = fileURLToPath(new URL('../tests/fixtures/llm/tableparse-eurostat', import.meta.url));
export const EUROSTAT_DUMP_PATH = fileURLToPath(new URL('../benchmark/tablelane-eurostat-audit-run.json', import.meta.url));

export function fixturesDirFor(set: TableLaneSet): string {
  return set === 'eurostat' ? EUROSTAT_TABLEPARSE_FIXTURES_DIR : TABLEPARSE_FIXTURES_DIR;
}

export function dumpPathFor(set: TableLaneSet): string {
  return set === 'eurostat' ? EUROSTAT_DUMP_PATH : DEFAULT_DUMP_PATH;
}

export type TableLaneBenchMode = 'replay' | 'canned';

export class MissingFixturesError extends Error {
  override name = 'MissingFixturesError';
  readonly missing: { taskId: string; requestHash: string }[];
  constructor(missing: { taskId: string; requestHash: string }[], dir: string) {
    super(
      `${missing.length} table-parse fixture(s) missing in ${dir} — the benchmark cannot run ` +
        `(record them in the supervised run: TABLEPARSE_RECORD_OK=1 npm run tableparse:record):\n` +
        missing.map((m) => `  ${m.taskId}: ${m.requestHash}.json`).join('\n'),
    );
    this.missing = missing;
  }
}

/** Fixtures the replay run needs and does not have (one per task). */
export function missingBenchFixtures(tasks: TableLaneTask[], dir = TABLEPARSE_FIXTURES_DIR): { taskId: string; requestHash: string }[] {
  return tasks
    .map((t) => ({ taskId: t.id, requestHash: requestHash(taskParseRequest(t)) }))
    .filter((m) => !existsSync(`${dir}/${m.requestHash}.json`));
}

/** Wraps the model stand-in so ANY failing call is on record even though the
 * job would turn it into a refusal (a thrown parse is a retryable failure,
 * then `table_lane_failed`). The runner fails the whole run on any entry. */
class LoudClient implements LlmClient {
  readonly failures: { question: string; error: string }[] = [];
  readonly hashes: string[] = [];
  private readonly inner: LlmClient;
  constructor(inner: LlmClient) {
    this.inner = inner;
  }
  async complete(request: LlmRequest): Promise<LlmResponse> {
    this.hashes.push(requestHash(request));
    try {
      return await this.inner.complete(request);
    } catch (error) {
      this.failures.push({ question: request.question.split('\n')[0]!, error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }
}

/** The compose/semantic-check stand-in: always fails, so the answer text is
 * the deterministic template (the product's own fallback path). */
class TemplateOnlyClient implements LlmClient {
  async complete(): Promise<LlmResponse> {
    throw new Error('table-lane benchmark: no compose model — deterministic template');
  }
}

export interface TaskRun {
  id: string;
  type: TableLaneTask['type'];
  table: string;
  question: string;
  previousQuestion: string | null;
  rowId: number;
  rowStatus: string;
  auditId: number;
  /** ask tasks: the reply round, when the first turn asked about the expected dimension. */
  replyRowId?: number;
  replyAuditId?: number;
  /** Fetches the snapshot could not serve (the parse chose another slice). */
  uncovered: { tableId: string; slice: unknown }[];
  jobs: TableLaneJobSummary[];
}

export interface TableLaneDump {
  mode: TableLaneBenchMode;
  generatedAt: string;
  referenceDate: string;
  parsePromptVersion: number;
  parseSchemaVersion: number;
  /** Parse calls, in order, by request hash — the recorded-fixture keys. */
  parseRequestHashes: string[];
  tasks: TaskRun[];
  records: AuditRecord[];
}

async function seedUser(db: Db): Promise<string> {
  const userId = randomUUID();
  await db.query(
    `insert into credit_transactions (user_id, delta, reason, note) values ($1, $2, 'signup_grant', 'table-lane benchmark seed')`,
    [userId, 100_000],
  );
  return userId;
}

async function runJob(db: Db, source: TableLaneBenchSource, client: LlmClient, referenceDate: string): Promise<TableLaneJobSummary> {
  const templateOnly = new TemplateOnlyClient();
  const respondOptions = (): AuditedRespondOptions => ({
    intentClient: templateOnly,
    answerClient: templateOnly,
    referenceDate,
    sourceTag: 'benchmark',
  });
  return runTableLaneJob({ db, source, parseClient: client, respondOptions, referenceDate, sleep: async () => {} });
}

async function finishedRow(db: Db, rowId: number, userId: string, taskId: string): Promise<TableLaneRow & { auditId: number }> {
  const row = await readTableLaneRequest(db, rowId, userId);
  if (row === null) throw new Error(`${taskId}: lane row ${rowId} vanished`);
  if (row.status !== 'done' && row.status !== 'failed') throw new Error(`${taskId}: lane row ${rowId} is still '${row.status}'`);
  if (row.auditId === null) throw new Error(`${taskId}: lane row ${rowId} finished without an audit row`);
  return row as TableLaneRow & { auditId: number };
}

export async function runTableLaneBenchmark(options: {
  mode: TableLaneBenchMode;
  /** null = do not write a dump file (tests). */
  dumpPath?: string | null;
  fixturesDir?: string;
  /** Which frozen set; default CBS. */
  set?: TableLaneSet;
}): Promise<TableLaneDump> {
  const set = options.set ?? 'cbs';
  const file = loadTableLaneTasks(set);
  const fixturesDir = options.fixturesDir ?? fixturesDirFor(set);
  let inner: LlmClient;
  if (options.mode === 'replay') {
    const missing = missingBenchFixtures(file.tasks, fixturesDir);
    if (missing.length > 0) throw new MissingFixturesError(missing, fixturesDir);
    inner = new ReplayLlmClient(fixturesDir);
  } else {
    inner = new CannedParseClient(file.tasks);
  }
  const client = new LoudClient(inner);
  const source = new TableLaneBenchSource();
  const { db, close } = await createTestDb();
  const runs: TaskRun[] = [];
  const records: AuditRecord[] = [];
  try {
    await applyPricingDefaults(db);
    const userId = await seedUser(db);
    for (const task of file.tasks) {
      const uncoveredBefore = source.uncovered.length;
      const created = await createTableLaneRequest(db, {
        userId,
        requestId: randomUUID(),
        threadId: null,
        lang: 'nl',
        question: task.question,
        tableId: task.table,
        finderConfidence: 0.9,
        previousQuestion: task.previousQuestion ?? null,
      });
      if (created.kind !== 'created') throw new Error(`${task.id}: could not queue the lane row (${created.kind})`);
      const jobs = [await runJob(db, source, client, file.referenceDate)];
      const row = await finishedRow(db, created.row.id, userId, task.id);
      const record = await loadAuditRecord(db, row.auditId);
      if (record === null) throw new Error(`${task.id}: audit row ${row.auditId} not found`);
      records.push(record);
      const run: TaskRun = {
        id: task.id,
        type: task.type,
        table: task.table,
        question: task.question,
        previousQuestion: task.previousQuestion ?? null,
        rowId: row.id,
        rowStatus: row.status,
        auditId: row.auditId,
        uncovered: [],
        jobs,
      };

      // The one button click (replyToTableLane): only when the lane asked about
      // the dimension the task expects — otherwise the scorer fails the task on
      // the first turn and there is nothing honest to click.
      const lane = (record.response as { tableLane?: TableLaneEnvelope }).tableLane;
      if (task.type === 'ask' && record.kind === 'clarification' && lane?.question?.dimension === task.expectDimension) {
        const reply = await createTableLaneRequest(db, {
          userId,
          requestId: randomUUID(),
          threadId: row.threadId,
          lang: 'nl',
          question: row.question,
          tableId: row.tableId,
          finderConfidence: row.finderConfidence,
          parentId: row.id,
          previousQuestion: row.previousQuestion,
          choices: [...row.choices, { dimension: task.expectDimension, code: task.reply.code }],
          isReply: true,
        });
        if (reply.kind !== 'created') throw new Error(`${task.id}: could not queue the reply row (${reply.kind})`);
        jobs.push(await runJob(db, source, client, file.referenceDate));
        const replyRow = await finishedRow(db, reply.row.id, userId, `${task.id} reply`);
        const replyRecord = await loadAuditRecord(db, replyRow.auditId);
        if (replyRecord === null) throw new Error(`${task.id}: reply audit row ${replyRow.auditId} not found`);
        records.push(replyRecord);
        run.replyRowId = replyRow.id;
        run.replyAuditId = replyRow.auditId;
      }
      run.uncovered = source.uncovered.slice(uncoveredBefore).map((u) => ({ tableId: u.tableId, slice: u.slice ?? null }));
      runs.push(run);
    }
  } finally {
    await close();
  }

  if (client.failures.length > 0) {
    // A parse call that failed (a missing fixture found late, a canned lookup
    // miss): the job has already turned it into a refusal — never let that
    // pass as one.
    throw new Error(
      `table-parse call(s) failed during the run — the benchmark is invalid:\n` +
        client.failures.map((f) => `  ${f.question}\n    ${f.error.split('\n')[0]}`).join('\n'),
    );
  }

  const dump: TableLaneDump = {
    mode: options.mode,
    generatedAt: new Date().toISOString(),
    referenceDate: file.referenceDate,
    parsePromptVersion: TABLE_PARSE_PROMPT_VERSION,
    parseSchemaVersion: TABLE_PARSE_SCHEMA_VERSION,
    parseRequestHashes: client.hashes,
    tasks: runs,
    records,
  };
  const dumpPath = options.dumpPath === undefined ? dumpPathFor(set) : options.dumpPath;
  if (dumpPath !== null) writeFileSync(dumpPath, `${JSON.stringify(dump, null, 1)}\n`);
  return dump;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mode: TableLaneBenchMode = process.argv.includes('--canned') ? 'canned' : 'replay';
  const set = setFromArgv();
  try {
    const dump = await runTableLaneBenchmark({ mode, set });
    console.log(
      `table-lane benchmark run (${set}, ${mode}): ${dump.tasks.length} tasks -> ${dump.records.length} audit records, ` +
        `${dump.parseRequestHashes.length} parse calls. Dump: ${dumpPathFor(set)} — score with: npm run tablelane:bench:score` +
        (set === 'eurostat' ? ' -- --eurostat' : ''),
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

// ADR 062 step 6 — shared pieces of the table-lane benchmark: the frozen task
// file's types and loader, the "canned" model output built from a task's
// expected parse, the planner run the snapshot capture and the canned mode
// share, and the exact table-parse requests the benchmark will make (so the
// ONE supervised recording run — scripts/tableparse-eval.ts --record — records
// them next to the calibration set).
//
// No network, no database, no LLM: pure over committed fixtures.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { CbsSlice } from '../src/cbs-adapter/types.ts';
import type { PeriodSpec, RegionScopeKind, RegionTerm } from '../src/answer/intent/types.ts';
import type { LlmClient, LlmRequest, LlmResponse } from '../src/answer/llm/client.ts';
import { planTableLane, type TableLanePlan } from '../src/answer/table-lane/plan.ts';
import type { TableLaneChoice, TableLaneTable } from '../src/answer/table-lane/types.ts';
import { buildTableParseSchema } from '../src/answer/table-parse/input.ts';
import {
  buildTableParseRequest,
  TABLE_PARSE_SCHEMA_VERSION,
  tableParsePrefilterText,
} from '../src/answer/table-parse/parse.ts';
import { loadSchemaFixture } from '../tests/helpers/tablelane-bench-source.ts';

export const TABLELANE_TASKS_PATH = fileURLToPath(new URL('../benchmark/tablelane-tasks.json', import.meta.url));
export const TABLELANE_KEY_PATH = fileURLToPath(new URL('../benchmark/tablelane-answer-key.json', import.meta.url));

/** Session 153 (#357 step 5): the benchmark has two frozen sets — CBS (the
 * original) and Eurostat (its own tasks, key, snapshot and parser fixtures,
 * its own gate), run by the same harness. Every loader takes the set; the
 * default is CBS, so every existing caller is unchanged. */
export type TableLaneSet = 'cbs' | 'eurostat';

const SET_PATHS: Record<TableLaneSet, { tasks: string; key: string }> = {
  cbs: { tasks: TABLELANE_TASKS_PATH, key: TABLELANE_KEY_PATH },
  eurostat: {
    tasks: fileURLToPath(new URL('../benchmark/tablelane-eurostat-tasks.json', import.meta.url)),
    key: fileURLToPath(new URL('../benchmark/tablelane-eurostat-answer-key.json', import.meta.url)),
  },
};

/** `--eurostat` on a benchmark script's command line selects the Eurostat set. */
export function setFromArgv(argv: string[] = process.argv): TableLaneSet {
  return argv.includes('--eurostat') ? 'eurostat' : 'cbs';
}

/** The task's expected parse — what a correct reading of the question is. The
 * canned mode feeds it to the real planner as the model's output; the snapshot
 * capture uses the slice it plans. Never used to score a recorded parse (the
 * scorer reads the audited outcome, not the parse). */
export interface CannedParse {
  /** A measure code of the table, or 'geen'. */
  measureCode: string;
  /** Offered breakdown dimension → member code, 'niet_genoemd' or 'anders';
   * an offered dimension left out means 'niet_genoemd'. */
  breakdowns?: Record<string, string>;
  period: PeriodSpec;
  regions?: RegionTerm[];
  regionScope?: RegionScopeKind | null;
  derivation?: 'none' | 'difference' | 'max' | 'series';
  confidence?: number;
}

interface TaskBase {
  id: string;
  table: string;
  question: string;
  /** A follow-up: the previous question in the same conversation. */
  previousQuestion?: string;
  /** Why this task is in the set / what shape it covers. */
  covers: string;
  canned: CannedParse;
}

export interface AnswerTask extends TaskBase {
  type: 'answer';
}

export interface RefuseTask extends TaskBase {
  type: 'refuse';
  /** The refusal reasons that count as correct (typed field, never prose). */
  expectReasons: string[];
}

export interface AskTask extends TaskBase {
  type: 'ask';
  /** The dimension the button question must be about. */
  expectDimension: string;
  /** The reader's button click (a member code of that dimension); the reply
   * round is scored against the answer key like an answer task. */
  reply: { code: string };
}

export type TableLaneTask = AnswerTask | RefuseTask | AskTask;

export interface TableLaneTaskFile {
  schemaVersion: 1;
  source: string;
  frozen: boolean;
  /** YYYY-MM-DD — the clock every run uses (the lane never reads it for
   * periods; the audit rows and the curated respond path do). */
  referenceDate: string;
  gate: {
    /** Minimum answerable tasks (answer + ask-after-reply) that must pass. */
    answerableMin: number;
    /** Why that number — stated, never silent. */
    answerableMinReason: string;
    /** Whether the CI replay test fails on the full gate. Missing fixtures,
     * invented numbers and broken audit reconstruction ALWAYS fail it. */
    enforcedInCi: boolean;
  };
  tasks: TableLaneTask[];
}

export interface KeyCell {
  measure: string;
  period: string;
  /** GeoDimension code, or null on a table without one. */
  region: string | null;
  /** Every plain (non-time, non-geo) coordinate of the cell. */
  dims: Record<string, string>;
  value: number | null;
  status: string;
}

export interface TableLaneKeyEntry {
  table: string;
  cells: KeyCell[];
  /** The OData URL that returns the key cell(s) — the independent check
   * (Eurostat: the statistics API JSON-stat URL with every dimension pinned). */
  verifyUrl: string;
}

export interface TableLaneKeyFile {
  schemaVersion: 1;
  source: string;
  frozenAt: string;
  tasks: Record<string, TableLaneKeyEntry>;
}

export function loadTableLaneTasks(set: TableLaneSet = 'cbs'): TableLaneTaskFile {
  return JSON.parse(readFileSync(SET_PATHS[set].tasks, 'utf8')) as TableLaneTaskFile;
}

export function loadTableLaneKey(set: TableLaneSet = 'cbs'): TableLaneKeyFile {
  return JSON.parse(readFileSync(SET_PATHS[set].key, 'utf8')) as TableLaneKeyFile;
}

/** Tasks scored against the answer key (answer tasks + ask tasks' reply). */
export function answerableTasks(file: TableLaneTaskFile): (AnswerTask | AskTask)[] {
  return file.tasks.filter((t): t is AnswerTask | AskTask => t.type === 'answer' || t.type === 'ask');
}

export function tableOf(tableId: string): TableLaneTable {
  const { schema, codeLists } = loadSchemaFixture(tableId);
  return { schema, codeLists };
}

/** The parse request the table lane makes for this task — built exactly as
 * planTableLane builds it (pre-filter over question + previous question, the
 * previous question in the user turn). The reply round re-sends the same
 * request (same question, same previous question), so one per task. */
export function taskParseRequest(task: TableLaneTask): LlmRequest {
  const { schema, codeLists } = loadSchemaFixture(task.table);
  const previousQuestion = task.previousQuestion ?? null;
  const offered = buildTableParseSchema(schema, codeLists, tableParsePrefilterText(task.question, previousQuestion));
  return buildTableParseRequest(task.question, offered, { previousQuestion });
}

/** The canned model output for a task: the expected parse in the parser's
 * own output contract, one entry per OFFERED breakdown dimension. */
export function cannedOutput(task: TableLaneTask): string {
  const { schema, codeLists } = loadSchemaFixture(task.table);
  const offered = buildTableParseSchema(
    schema,
    codeLists,
    tableParsePrefilterText(task.question, task.previousQuestion ?? null),
  );
  const c = task.canned;
  for (const dim of Object.keys(c.breakdowns ?? {})) {
    if (!offered.breakdowns.some((b) => b.name === dim)) {
      throw new Error(`${task.id}: canned breakdown '${dim}' is not an offered dimension of ${task.table}`);
    }
  }
  return JSON.stringify({
    version: TABLE_PARSE_SCHEMA_VERSION,
    measureCode: c.measureCode,
    breakdowns: offered.breakdowns.map((b) => ({ dimension: b.name, choice: c.breakdowns?.[b.name] ?? 'niet_genoemd' })),
    period: c.period,
    regions: c.regions ?? [],
    regionScope: c.regionScope ?? null,
    derivation: c.derivation ?? 'none',
    confidence: c.confidence ?? 0.95,
    reading: 'canned (benchmark expected parse)',
  });
}

/** A model stand-in answering every table-parse request with the canned output
 * of the task whose request it is (matched by the exact serialized user turn).
 * An unknown request throws — the canned mode is as loud as replay. */
export class CannedParseClient implements LlmClient {
  readonly requests: LlmRequest[] = [];
  private readonly byTurn = new Map<string, string>();

  constructor(tasks: TableLaneTask[]) {
    for (const task of tasks) this.byTurn.set(taskParseRequest(task).question, cannedOutput(task));
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    this.requests.push(request);
    const outputText = this.byTurn.get(request.question);
    if (outputText === undefined) throw new Error('CannedParseClient: no canned output for this request');
    return { outputText, model: 'canned-table-parse', stopReason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0 } };
  }
}

/** The CbsSlice fetchSlice sends for a planned SliceRequest. */
export function toCbsSlice(plan: Extract<TableLanePlan, { kind: 'fetch' }>, timeDim: string): CbsSlice {
  return {
    measures: plan.slice.measures,
    dimensionIn: plan.slice.members,
    periodIn: { dimension: timeDim, codes: plan.slice.periods },
  };
}

export interface CannedPlan {
  taskId: string;
  round: 'first' | 'reply';
  tableId: string;
  kind: TableLanePlan['kind'];
  refusalReason: string | null;
  askDimension: string | null;
  slice: CbsSlice | null;
}

/** Runs the REAL planner for every task (and every ask task's reply round)
 * with the canned output as the model's answer. */
export async function cannedPlans(file: TableLaneTaskFile): Promise<CannedPlan[]> {
  const client = new CannedParseClient(file.tasks);
  const out: CannedPlan[] = [];
  for (const task of file.tasks) {
    const table = tableOf(task.table);
    const timeDim = table.schema.dimensions.find((d) => d.kind === 'TimeDimension')!.name;
    const rounds: { round: 'first' | 'reply'; choices: TableLaneChoice[] }[] = [{ round: 'first', choices: [] }];
    if (task.type === 'ask') rounds.push({ round: 'reply', choices: [{ dimension: task.expectDimension, code: task.reply.code }] });
    for (const { round, choices } of rounds) {
      const plan = await planTableLane({
        question: task.question,
        previousQuestion: task.previousQuestion ?? null,
        table,
        choices,
        referenceDate: file.referenceDate,
        client,
      });
      out.push({
        taskId: task.id,
        round,
        tableId: task.table,
        kind: plan.kind,
        refusalReason: plan.kind === 'refuse' ? plan.reason : null,
        askDimension: plan.kind === 'ask' ? plan.question.dimension : null,
        slice: plan.kind === 'fetch' ? toCbsSlice(plan, timeDim) : null,
      });
    }
  }
  return out;
}

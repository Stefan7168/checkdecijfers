// Benchmark runner — drives all 20 docs/02 tasks end-to-end through the
// AUDITED pipeline (answerQuestionAudited / answerClarificationReplyAudited)
// in one of two modes sharing the SAME flow code (one code path, so the live
// run can never silently drift from what CI proves on every push):
//
//   npm run benchmark:run          hermetic (WP10): fixture-ingested PGlite +
//                                  replayed LLM fixtures. No API key, no
//                                  network, no Supabase. What CI runs.
//   npm run benchmark:run:live     live (WP11): the live Supabase database
//                                  (DATABASE_URL, pinned-CA TLS) + real
//                                  Anthropic calls (ANTHROPIC_API_KEY).
//                                  Spends tokens; writes REAL audit_answers
//                                  rows (kept — they are the R8 trail of the
//                                  run). Reference dates stay pinned to the
//                                  labelled set's clock so the frozen answer
//                                  key still applies (ADR 017).
//
// This script produces the audit records and DUMPS them; it deliberately does
// NOT score. Scoring is scripts/score-benchmark.mjs's job, reading the dump —
// so "benchmark scoring reads the audit records" (R8, docs/05) is literally
// the data flow, not a claim. Both dumps (benchmark/audit-run.json,
// benchmark/audit-run-live.json) are generated artifacts, gitignored: the
// committed provenance of a benchmark run is STATUS.md + the scorer's
// --report file (live runs), never these files.
//
// What runs, mirroring docs/02 Scoring:
//  - B1–B14 answerable questions (docs/02 phrasing).
//  - B15/B16 clarifications PLUS their one reply round (the labelled reply
//    cases that resolve: c-b15-full → the B5 intent, c-b16-national → B7) —
//    docs/02 scores clarify tasks on the post-clarification answer. If a
//    clarify task does NOT clarify (possible live), the reply round is
//    skipped and the SCORER fails the task — a wrong outcome must reach the
//    scoreboard as a scored failure, never crash the run unrecorded.
//  - B17–B20 refusals.
//  - The docs/02 informational checks: B3/B5 un-disambiguated variants.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  answerClarificationReplyAudited,
  answerQuestionAudited,
  currentPromptVersions,
  loadAllAuditRecords,
  loadAuditRecord,
} from '../src/answer/audit/index.ts';
import type { AuditRecord } from '../src/answer/audit/index.ts';
import { AnthropicLlmClient, ReplayLlmClient, type LlmClient } from '../src/answer/llm/client.ts';
import { connectFromEnv } from '../src/db/client.ts';
import type { Db } from '../src/db/types.ts';
import { freshestForCanonical } from '../src/query/index.ts';
import { CANONICAL_MEASURES } from '../src/registry/defaults.ts';
import { createIngestedDb } from '../tests/helpers/ingested-db.ts';
import { ANSWERABLE_TASKS, REFUSAL_TASK_QUESTIONS, UNDISAMBIGUATED_VARIANTS } from '../tests/helpers/benchmark-intents.ts';
import { loadLabelledSet } from '../tests/helpers/intent-expectations.ts';

const INTENT_FIXTURES = fileURLToPath(new URL('../tests/fixtures/llm/intent', import.meta.url));
const ANSWER_FIXTURES = fileURLToPath(new URL('../tests/fixtures/llm/answer', import.meta.url));
const CLARIFY_FIXTURES = fileURLToPath(new URL('../tests/fixtures/llm/clarify', import.meta.url));

export interface RunBenchmarkOptions {
  /** Real Anthropic calls + the live database. Default: hermetic replay. */
  live?: boolean;
  /** Dump destination override (tests). Default: the mode's benchmark/ path. */
  dumpPath?: string;
}

function defaultDumpPath(live: boolean): string {
  return fileURLToPath(
    new URL(live ? '../benchmark/audit-run-live.json' : '../benchmark/audit-run.json', import.meta.url),
  );
}

/** The labelled reply case that completes each clarify task's round
 * (benchmark/clarification-cases.json; docs/02 S3 "completes as S1"). The
 * post-clarification answer is scored against the named frozen-key task. */
const CLARIFY_TASK_REPLY: Record<string, { caseId: string; scoreAgainst: string }> = {
  B15: { caseId: 'c-b15-full', scoreAgainst: 'B5' },
  B16: { caseId: 'c-b16-national', scoreAgainst: 'B7' },
};

interface ClarifyCaseFile {
  referenceDate: string;
  cases: { id: string; originalQuestion: string; reply: string }[];
}

interface TaskRun {
  id: string;
  type: 'answerable' | 'clarify' | 'refuse' | 'undisambiguated';
  question: string;
  /** For refuse tasks: docs/02's expected reason (tasks.json). */
  expectedReason?: string;
  /** For clarify tasks: which frozen-key task scores the reply-round answer. */
  scoreAgainst?: string;
  auditId: number;
  /** The reply round's audit row (clarify tasks only). */
  replyAuditId?: number;
  replyCaseId?: string;
}

interface ModeClients {
  intent: LlmClient;
  clarify: LlmClient;
  answer: LlmClient;
}

function buildClients(live: boolean): ModeClients {
  if (live) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error(
        'ANTHROPIC_API_KEY is not set — the live run makes real API calls. Run via: npm run benchmark:run:live',
      );
    }
    // One real client serves all three roles; the audit tracker records each
    // call's role/model/tokens on the row regardless.
    const real = new AnthropicLlmClient();
    return { intent: real, clarify: real, answer: real };
  }
  return {
    intent: new ReplayLlmClient(INTENT_FIXTURES),
    clarify: new ReplayLlmClient(CLARIFY_FIXTURES),
    answer: new ReplayLlmClient(ANSWER_FIXTURES),
  };
}

async function buildDb(live: boolean): Promise<{ db: Db; close: () => Promise<void> }> {
  if (live) {
    if (!process.env.DATABASE_URL) {
      throw new Error(
        'DATABASE_URL is not set — the live run scores against the live database. Run via: npm run benchmark:run:live',
      );
    }
    const { db, pool } = connectFromEnv();
    return {
      db,
      close: async () => {
        await pool.end();
      },
    };
  }
  const { db, close } = await createIngestedDb();
  return { db, close };
}

/** Per-model token totals across the run's records — the spend-accounting
 * source (live: real usage; hermetic: usage replayed from fixtures, useful
 * only as a shape check, never as spend). */
function aggregateUsage(records: AuditRecord[]) {
  const byModel: Record<string, { calls: number; inputTokens: number; outputTokens: number }> = {};
  let inputTokens = 0;
  let outputTokens = 0;
  for (const record of records) {
    for (const call of record.llmCalls) {
      const entry = (byModel[call.model] ??= { calls: 0, inputTokens: 0, outputTokens: 0 });
      entry.calls += 1;
      entry.inputTokens += call.inputTokens;
      entry.outputTokens += call.outputTokens;
      inputTokens += call.inputTokens;
      outputTokens += call.outputTokens;
    }
  }
  return { byModel, inputTokens, outputTokens };
}

export async function runBenchmark(options: RunBenchmarkOptions = {}): Promise<void> {
  const live = options.live ?? false;
  const dumpPath = options.dumpPath ?? defaultDumpPath(live);
  const tasksFile = JSON.parse(
    readFileSync(new URL('../benchmark/tasks.json', import.meta.url), 'utf8'),
  ) as { tasks: { id: string; type: string; reason?: string; question: string }[] };
  const clarifySet = JSON.parse(
    readFileSync(new URL('../benchmark/clarification-cases.json', import.meta.url), 'utf8'),
  ) as ClarifyCaseFile;
  const referenceDate = loadLabelledSet().referenceDate;

  const clients = buildClients(live);
  const respondOptions = {
    intentClient: clients.intent,
    answerClient: clients.answer,
    referenceDate,
    // WP13, open-questions #44: every row this runner writes is a scripted
    // benchmark run, never real user traffic.
    sourceTag: 'benchmark' as const,
  };

  const { db, close } = await buildDb(live);
  const runs: TaskRun[] = [];

  try {
    for (const task of tasksFile.tasks) {
      // The docs/02 task phrasings and the helper's phrasings must be the
      // same strings — a drifted copy would silently run a different benchmark.
      const question =
        task.type === 'answerable' ? ANSWERABLE_TASKS[task.id]?.question : REFUSAL_TASK_QUESTIONS[task.id];
      if (!question) throw new Error(`no question source for ${task.id}`);
      if (question !== task.question) {
        throw new Error(`${task.id}: helper question differs from benchmark/tasks.json — fix the drift first`);
      }

      const first = await answerQuestionAudited(db, question, respondOptions);
      if (first.auditId === null) throw new Error(`${task.id}: audit write failed`);
      const run: TaskRun = {
        id: task.id,
        type: task.type as TaskRun['type'],
        question,
        auditId: first.auditId,
      };
      if (task.type === 'refuse') run.expectedReason = task.reason;

      // Clarify tasks: play the one reply round (docs/02: scored on the
      // post-clarification answer, at most one round). A non-clarification
      // first response (possible live) records no reply round; the scorer
      // fails the task on both the kind and the missing round.
      const replySpec = CLARIFY_TASK_REPLY[task.id];
      if (task.type === 'clarify' && replySpec && first.response.kind === 'clarification') {
        const replyCase = clarifySet.cases.find((c) => c.id === replySpec.caseId);
        if (!replyCase) throw new Error(`missing clarify case ${replySpec.caseId}`);
        if (replyCase.originalQuestion !== question) {
          throw new Error(`${replySpec.caseId} originalQuestion differs from ${task.id}'s question`);
        }
        const reply = await answerClarificationReplyAudited(db, first.response.pending, replyCase.reply, {
          intentClient: clients.clarify,
          answerClient: clients.answer,
          referenceDate: clarifySet.referenceDate,
          sourceTag: 'benchmark',
        });
        if (reply.auditId === null) throw new Error(`${task.id} reply: audit write failed`);
        run.replyAuditId = reply.auditId;
        run.replyCaseId = replySpec.caseId;
        run.scoreAgainst = replySpec.scoreAgainst;
      }
      runs.push(run);
      if (live) console.log(`  ${run.id}: audit row ${run.auditId}${run.replyAuditId ? ` + reply row ${run.replyAuditId}` : ''}`);
    }

    // Informational (docs/02): the un-disambiguated B3/B5 variants must
    // resolve to the canonical default without clarifying.
    for (const [variantId, variant] of Object.entries(UNDISAMBIGUATED_VARIANTS)) {
      const outcome = await answerQuestionAudited(db, variant.question, respondOptions);
      if (outcome.auditId === null) throw new Error(`${variantId}: audit write failed`);
      runs.push({ id: variantId, type: 'undisambiguated', question: variant.question, auditId: outcome.auditId });
      if (live) console.log(`  ${variantId}: audit row ${outcome.auditId}`);
    }

    // Scoring reads THE RECORDS: everything the scorer sees comes from the
    // audit table, not from in-memory pipeline objects. Loaded by the ids
    // THIS run created — the live table accumulates rows across runs (and
    // later real traffic), so "all rows" is only correct on a fresh PGlite.
    const auditIds = runs
      .flatMap((run) => [run.auditId, run.replyAuditId])
      .filter((id): id is number => id !== undefined)
      .sort((a, b) => a - b);
    const records: AuditRecord[] = [];
    for (const id of auditIds) {
      const record = await loadAuditRecord(db, id);
      if (record === null) throw new Error(`audit row ${id} not found after writing it`);
      records.push(record);
    }
    if (!live) {
      // Fresh-database sanity: hermetically, this run's rows must be ALL rows.
      const allCount = (await loadAllAuditRecords(db)).length;
      if (allCount !== records.length) {
        throw new Error(`hermetic run created ${records.length} rows but the database holds ${allCount}`);
      }
    }

    // Structured whitelist aid for the scorer's no-unbacked-numbers scan on
    // refusal texts: the freshest period per canonical measure — the same
    // structured source the WP9 templates cite (offers, example questions).
    const canonicalFreshestPeriods: Record<string, string> = {};
    for (const measure of CANONICAL_MEASURES) {
      const freshest = await freshestForCanonical(db, measure.key);
      if (freshest) canonicalFreshestPeriods[measure.key] = freshest.periodCode;
    }

    const dump = {
      mode: live ? 'live' : 'hermetic-replay',
      generatedAt: new Date().toISOString(),
      referenceDate,
      clarifyReferenceDate: clarifySet.referenceDate,
      promptVersions: currentPromptVersions(),
      canonicalFreshestPeriods,
      usage: aggregateUsage(records),
      tasks: runs,
      records,
    };
    writeFileSync(dumpPath, `${JSON.stringify(dump, null, 1)}\n`);
    const modeLabel = live ? 'LIVE — real LLM calls, live database' : 'hermetic, replayed fixtures';
    console.log(`benchmark run (${modeLabel}): ${runs.length} flows -> ${records.length} audit records.`);
    if (live) {
      for (const [model, u] of Object.entries(dump.usage.byModel)) {
        console.log(`  ${model}: ${u.calls} calls, ${u.inputTokens} in / ${u.outputTokens} out`);
      }
      console.log(`Dump written to benchmark/audit-run-live.json — score with: npm run benchmark:score:live`);
    } else {
      console.log(`Dump written to benchmark/audit-run.json — score with: npm run benchmark:score`);
    }
  } finally {
    try {
      await close();
    } catch (closeError) {
      // Never let cleanup mask the real outcome: an earlier throw keeps
      // propagating, a successful run stays successful.
      console.error('warning: closing the database connection failed:', closeError);
    }
  }
}

// CLI entry point — skipped when the module is imported (tests drive
// runBenchmark directly with a scratch dumpPath).
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runBenchmark({ live: process.argv.includes('--live') });
}

// Hermetic benchmark runner (WP10) — drives all 20 docs/02 tasks end-to-end
// through the AUDITED pipeline (answerQuestionAudited /
// answerClarificationReplyAudited) over the fixture-ingested PGlite database
// with replayed LLM fixtures: no API key, no network, no Supabase. Exactly
// what CI runs before the scorer.
//
// This script produces the audit records and DUMPS them; it deliberately does
// NOT score. Scoring is scripts/score-benchmark.mjs's job, reading the dump —
// so "benchmark scoring reads the audit records" (R8, docs/05) is literally
// the data flow, not a claim. The dump (benchmark/audit-run.json) is a
// generated artifact, gitignored: CI regenerates it on every push, and the
// committed provenance of a benchmark run is STATUS.md + (from WP11 on) the
// recorded scoreboard, never this file.
//
//   npm run benchmark:run
//
// What runs, mirroring docs/02 Scoring:
//  - B1–B14 answerable questions (docs/02 phrasing, replayed parser).
//  - B15/B16 clarifications PLUS their one reply round (the labelled reply
//    cases that resolve: c-b15-full → the B5 intent, c-b16-national → B7) —
//    docs/02 scores clarify tasks on the post-clarification answer.
//  - B17–B20 refusals.
//  - The docs/02 informational checks: B3/B5 un-disambiguated variants.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  answerClarificationReplyAudited,
  answerQuestionAudited,
  currentPromptVersions,
  loadAllAuditRecords,
} from '../src/answer/audit/index.ts';
import { ReplayLlmClient } from '../src/answer/llm/client.ts';
import { freshestForCanonical } from '../src/query/index.ts';
import { CANONICAL_MEASURES } from '../src/registry/defaults.ts';
import { createIngestedDb } from '../tests/helpers/ingested-db.ts';
import { ANSWERABLE_TASKS, REFUSAL_TASK_QUESTIONS, UNDISAMBIGUATED_VARIANTS } from '../tests/helpers/benchmark-intents.ts';
import { loadLabelledSet } from '../tests/helpers/intent-expectations.ts';

const INTENT_FIXTURES = fileURLToPath(new URL('../tests/fixtures/llm/intent', import.meta.url));
const ANSWER_FIXTURES = fileURLToPath(new URL('../tests/fixtures/llm/answer', import.meta.url));
const CLARIFY_FIXTURES = fileURLToPath(new URL('../tests/fixtures/llm/clarify', import.meta.url));
const DUMP_PATH = fileURLToPath(new URL('../benchmark/audit-run.json', import.meta.url));

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

function respondOptions(referenceDate: string) {
  return {
    intentClient: new ReplayLlmClient(INTENT_FIXTURES),
    answerClient: new ReplayLlmClient(ANSWER_FIXTURES),
    referenceDate,
  };
}

async function main(): Promise<void> {
  const tasksFile = JSON.parse(
    readFileSync(new URL('../benchmark/tasks.json', import.meta.url), 'utf8'),
  ) as { tasks: { id: string; type: string; reason?: string; question: string }[] };
  const clarifySet = JSON.parse(
    readFileSync(new URL('../benchmark/clarification-cases.json', import.meta.url), 'utf8'),
  ) as ClarifyCaseFile;
  const referenceDate = loadLabelledSet().referenceDate;

  const { db, close } = await createIngestedDb();
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

      const first = await answerQuestionAudited(db, question, respondOptions(referenceDate));
      if (first.auditId === null) throw new Error(`${task.id}: audit write failed`);
      const run: TaskRun = {
        id: task.id,
        type: task.type as TaskRun['type'],
        question,
        auditId: first.auditId,
      };
      if (task.type === 'refuse') run.expectedReason = task.reason;

      // Clarify tasks: play the one reply round (docs/02: scored on the
      // post-clarification answer, at most one round).
      const replySpec = CLARIFY_TASK_REPLY[task.id];
      if (task.type === 'clarify' && replySpec) {
        if (first.response.kind !== 'clarification') {
          throw new Error(`${task.id}: expected a clarification, got ${first.response.kind}`);
        }
        const replyCase = clarifySet.cases.find((c) => c.id === replySpec.caseId);
        if (!replyCase) throw new Error(`missing clarify case ${replySpec.caseId}`);
        if (replyCase.originalQuestion !== question) {
          throw new Error(`${replySpec.caseId} originalQuestion differs from ${task.id}'s question`);
        }
        const reply = await answerClarificationReplyAudited(db, first.response.pending, replyCase.reply, {
          intentClient: new ReplayLlmClient(CLARIFY_FIXTURES),
          answerClient: new ReplayLlmClient(ANSWER_FIXTURES),
          referenceDate: clarifySet.referenceDate,
        });
        if (reply.auditId === null) throw new Error(`${task.id} reply: audit write failed`);
        run.replyAuditId = reply.auditId;
        run.replyCaseId = replySpec.caseId;
        run.scoreAgainst = replySpec.scoreAgainst;
      }
      runs.push(run);
    }

    // Informational (docs/02): the un-disambiguated B3/B5 variants must
    // resolve to the canonical default without clarifying.
    for (const [variantId, variant] of Object.entries(UNDISAMBIGUATED_VARIANTS)) {
      const outcome = await answerQuestionAudited(db, variant.question, respondOptions(referenceDate));
      if (outcome.auditId === null) throw new Error(`${variantId}: audit write failed`);
      runs.push({ id: variantId, type: 'undisambiguated', question: variant.question, auditId: outcome.auditId });
    }

    // Scoring reads THE RECORDS: everything the scorer sees comes from the
    // audit table, not from in-memory pipeline objects.
    const records = await loadAllAuditRecords(db);

    // Structured whitelist aid for the scorer's no-unbacked-numbers scan on
    // refusal texts: the freshest period per canonical measure — the same
    // structured source the WP9 templates cite (offers, example questions).
    const canonicalFreshestPeriods: Record<string, string> = {};
    for (const measure of CANONICAL_MEASURES) {
      const freshest = await freshestForCanonical(db, measure.key);
      if (freshest) canonicalFreshestPeriods[measure.key] = freshest.periodCode;
    }

    const dump = {
      mode: 'hermetic-replay',
      generatedAt: new Date().toISOString(),
      referenceDate,
      clarifyReferenceDate: clarifySet.referenceDate,
      promptVersions: currentPromptVersions(),
      canonicalFreshestPeriods,
      tasks: runs,
      records,
    };
    writeFileSync(DUMP_PATH, `${JSON.stringify(dump, null, 1)}\n`);
    console.log(
      `benchmark run (hermetic, replayed fixtures): ${runs.length} flows -> ${records.length} audit records.`,
    );
    console.log(`Dump written to benchmark/audit-run.json — score with: npm run benchmark:score`);
  } finally {
    await close();
  }
}

await main();

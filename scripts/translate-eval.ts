// Live eval + fixture recorder for the ADR 058 (English answers, Task 6/7)
// translate step — the same two-mode discipline as scripts/answer-eval.ts,
// applied to the SECOND, smaller LLM call the English path adds.
//
// This is the LIVE half of the testing strategy — it spends Anthropic API
// tokens (record mode) and is deliberately NOT on the CI gate. CI replays
// the fixtures this script records, through the SAME `ReplayLlmClient`
// mechanism as every other role (see tests/audit/english-reconstruct.test.ts
// for the hermetic, stub-client coverage that stands in for these fixtures
// until they exist).
//
//   npm run translate:eval     replay the committed fixtures, no key, no
//                              network — fails loudly if none are recorded
//                              yet (see below).
//   npm run translate:record   real Anthropic calls that (re)write the
//                              replay fixtures: one translate request per
//                              answerable benchmark task (14), a second one
//                              per task that needs a retry, and one C12
//                              meaning-check request per translation that
//                              passes C1–C11, all recorded into
//                              tests/fixtures/llm/translate/.
//
// BLOCKED until the Anthropic workspace usage cap lifts (2026-10-01, see
// docs/open-questions.md #288/#271) — `translate:record` is an owner-
// supervised step, never run from CI or a subagent (same posture as
// `attachments:record`/`chart-copilot:record`).
//
// Harness: the SAME hermetic pipeline scripts/answer-eval.ts and
// tests/audit/english-reconstruct.test.ts use — `createIngestedDb()` (WP10
// fixture-ingested PGlite) + `answerQuestionAudited` over the 14 `B1`-`B14`
// `ANSWERABLE_TASKS`, with the Dutch intent/answer legs replayed from their
// own committed fixtures (never live — only the translate leg is live/
// recorded here) and `lang: 'en'` + a translate client wired in. Loading
// each row back through `loadAuditRecord`/`reconstructionReport` re-runs the
// exact R8 checks CI's own audit tests apply (checkEnglishReconstruction),
// so a fixture that "translates" but doesn't RECONSTRUCT is caught here,
// before it is ever committed.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  answerQuestionAudited,
  loadAuditRecord,
  reconstructionReport,
} from '../src/answer/audit/index.ts';
import type { AuditRecord } from '../src/answer/audit/index.ts';
import {
  AnthropicLlmClient,
  RecordingLlmClient,
  ReplayLlmClient,
} from '../src/answer/llm/client.ts';
import type { LlmClient } from '../src/answer/llm/client.ts';
import type { AnswerResponse } from '../src/answer/respond/types.ts';
import { createIngestedDb } from '../tests/helpers/ingested-db.ts';
import { ANSWERABLE_TASKS } from '../tests/helpers/benchmark-intents.ts';
import { loadLabelledSet } from '../tests/helpers/intent-expectations.ts';

const INTENT_FIXTURES = fileURLToPath(new URL('../tests/fixtures/llm/intent', import.meta.url));
const ANSWER_FIXTURES = fileURLToPath(new URL('../tests/fixtures/llm/answer', import.meta.url));
const TRANSLATE_FIXTURES = fileURLToPath(new URL('../tests/fixtures/llm/translate', import.meta.url));
const REPORT_PATH = fileURLToPath(new URL('../benchmark/translate-eval-report.json', import.meta.url));
const REFERENCE_DATE = loadLabelledSet().referenceDate;

interface CaseResult {
  id: string;
  status: 'verified' | 'fallback';
  attempts: { ok: boolean; problems: string[]; error: string | null }[];
  untranslatedNames: string[];
  reconstructionOk: boolean;
  reconstructionProblems: string[];
  c1OrC2OnVerified: string[];
}

function buildTranslateClient(mode: 'record' | 'replay', labelFor: () => string | null): LlmClient {
  if (mode === 'replay') return new ReplayLlmClient(TRANSLATE_FIXTURES);
  return new RecordingLlmClient(new AnthropicLlmClient(), TRANSLATE_FIXTURES, labelFor);
}

/** `translateAnswer`'s own retry ladder (ruling 11, src/answer/translate/
 * translate.ts) treats ANY client error — a real transient failure or
 * `ReplayLlmClient`'s own "no recorded fixture" throw — as just another
 * failed attempt, and falls back to Dutch. That is the right behaviour for
 * `attachEnglish` in production (principle c: never guess, never crash the
 * whole answer over a translate hiccup), but it means the missing-fixture
 * condition this eval script must fail LOUDLY on never reaches this script
 * as a thrown error — it arrives as an ordinary `fallback` rendering whose
 * `attempts[].error` strings happen to CONTAIN `ReplayLlmClient`'s own fixed
 * message (client.ts) somewhere in the string: as the whole message when the
 * translate request itself is missing its fixture, or wrapped behind a
 * `"meaning check: "` prefix (translate.ts) around `errorMessage`'s own
 * `"<ErrorName>: <message>"` shape (meaning-check.ts) when it is the C12
 * meaning-check request that is missing its fixture. Detected here by a
 * substring test, never a broader "any error" rule (a real transient error
 * must still just count as one fallback case, not abort the whole run). */
function missingFixtureError(attempts: { error: string | null }[]): string | null {
  return attempts.find((a) => a.error !== null && isMissingFixtureMessage(a.error))?.error ?? null;
}

/** ReplayLlmClient's own fixed "no recorded fixture" message (client.ts),
 * matched as a substring rather than a prefix because a C12 meaning-check
 * attempt's error arrives wrapped as `"meaning check: Error: no recorded
 * LLM fixture…"` (translate.ts + meaning-check.ts's error formatting), not
 * as the raw message itself. Exported for tests/answer/translate/eval.test.ts.
 * Final-review fold-in 3: ONLY this condition earns the "run translate:record"
 * hint — any other failure is reported as itself. */
export function isMissingFixtureMessage(message: string): boolean {
  return message.includes('no recorded LLM fixture');
}

/** Ruling 6/the check kinds (src/answer/translate/check.ts): C1 (placeholder
 * identity — dropped/duplicated/invented) and C2 (a digit leaked outside a
 * placeholder) are the two STRUCTURAL checks — a placeholder or a digit
 * escaping the mask is exactly the class of bug principle (a) exists to
 * catch. A verified rendering that only got there via a retry which had
 * shown a C1/C2 problem on an earlier attempt is worth failing this eval
 * loudly on, even though the SERVED text is fine (the retry ladder already
 * fixed it) — it means the base prompt is provoking the one class of mistake
 * this pipeline can least afford, and that is worth re-tuning the prompt
 * over, not shrugging off as "the retry caught it". */
function c1OrC2Problems(attempts: { problems: string[] }[]): string[] {
  return attempts.flatMap((a) => a.problems.filter((p) => p.startsWith('C1:') || p.startsWith('C2:')));
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const mode: 'record' | 'replay' = args.includes('--record') ? 'record' : 'replay';
  console.log(`mode=${mode} tasks=${Object.keys(ANSWERABLE_TASKS).length}`);

  const { db, close } = await createIngestedDb();
  let currentTask: string | null = null;
  const translateClient = buildTranslateClient(mode, () => currentTask);

  const results: CaseResult[] = [];
  let loudFailure: string | null = null;
  let loudFailureIsMissingFixture = false;

  try {
    for (const taskId of Object.keys(ANSWERABLE_TASKS)) {
      currentTask = taskId;
      const question = ANSWERABLE_TASKS[taskId]!.question;

      let audited;
      try {
        audited = await answerQuestionAudited(db, question, {
          intentClient: new ReplayLlmClient(INTENT_FIXTURES),
          answerClient: new ReplayLlmClient(ANSWER_FIXTURES),
          referenceDate: REFERENCE_DATE,
          sourceTag: 'validation',
          lang: 'en',
          translateClient,
        });
      } catch (error) {
        // The one no-fixture-yet failure mode: ReplayLlmClient.complete()
        // throws its own clear, loud message (client.ts) — surfaced as-is,
        // not swallowed into a generic script crash, and this run stops
        // rather than reporting 14 misleading "fallback" rows.
        // Final-review fold-in 3: only the missing-fixture throw gets the
        // record hint below; any other pipeline throw is reported as itself
        // (and still exits non-zero).
        loudFailure = error instanceof Error ? error.message : String(error);
        loudFailureIsMissingFixture = isMissingFixtureMessage(loudFailure);
        break;
      }

      if (audited.auditId === null) throw new Error(`${taskId}: audit write failed`);
      if (audited.response.kind !== 'answer') throw new Error(`${taskId}: expected an answer, got '${audited.response.kind}'`);

      const record = (await loadAuditRecord(db, audited.auditId)) as AuditRecord;
      const response = record.response as AnswerResponse;
      const english = response.english;
      if (english === undefined) throw new Error(`${taskId}: no english rendering attached (lang/client wiring bug)`);

      if (mode === 'replay') {
        const missing = missingFixtureError(english.attempts);
        if (missing !== null) {
          loudFailure = missing;
          loudFailureIsMissingFixture = true;
          break;
        }
      }

      const report = reconstructionReport(record);
      const c1c2 = english.status === 'verified' ? c1OrC2Problems(english.attempts) : [];

      results.push({
        id: taskId,
        status: english.status,
        attempts: english.attempts,
        untranslatedNames: english.untranslatedNames,
        reconstructionOk: report.ok,
        reconstructionProblems: report.problems,
        c1OrC2OnVerified: c1c2,
      });

      const flag = report.ok && c1c2.length === 0 ? 'ok  ' : 'FAIL';
      console.log(`${flag} ${taskId.padEnd(4)} status=${english.status} attempts=${english.attempts.length}`);
      for (const attempt of english.attempts) {
        for (const problem of attempt.problems) console.log(`       attempt problem: ${problem}`);
        if (attempt.error) console.log(`       attempt error: ${attempt.error}`);
      }
      if (english.untranslatedNames.length > 0) {
        console.log(`       untranslated names: ${english.untranslatedNames.join(', ')}`);
      }
      for (const problem of report.problems) console.log(`       reconstruction: ${problem}`);
      for (const problem of c1c2) console.log(`       C1/C2 on a verified rendering: ${problem}`);
    }
  } finally {
    await close();
  }

  if (loudFailure !== null) {
    console.error('\n' + loudFailure);
    if (mode === 'replay' && loudFailureIsMissingFixture) {
      console.error(
        '\nNo recorded translate fixtures yet — run `npm run translate:record` after the API cap ' +
          'lifts (2026-10-01, docs/open-questions.md #271/#288), owner-supervised, real spend.',
      );
    }
    process.exitCode = 1;
    return;
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    mode,
    totals: {
      verified: results.filter((r) => r.status === 'verified').length,
      fallback: results.filter((r) => r.status === 'fallback').length,
      total: results.length,
    },
    cases: results,
  };
  console.log('\n=== summary ===');
  console.log(JSON.stringify(summary.totals, null, 2));

  if (mode === 'record') {
    writeFileSync(REPORT_PATH, `${JSON.stringify(summary, null, 2)}\n`);
    console.log(`report written to ${REPORT_PATH}`);
  }

  const anyReconstructionFailed = results.some((r) => !r.reconstructionOk);
  const anyC1C2OnVerified = results.some((r) => r.c1OrC2OnVerified.length > 0);
  if (anyReconstructionFailed || anyC1C2OnVerified) {
    console.error(
      '\nFAIL: at least one task failed reconstruction or hit a C1/C2 problem on a verified rendering.',
    );
    process.exitCode = 1;
  }
}

await main();

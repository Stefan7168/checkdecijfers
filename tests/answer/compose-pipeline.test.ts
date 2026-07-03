// WP7 done-criterion, hermetic (ADR 012 harness, extended to phrasing):
// B1–B14 travel the FULL pipeline — docs/02 phrasing → intent parser (LLM
// replayed from committed fixtures) → deterministic query → answer
// composition (LLM replayed from committed fixtures) — and every rendered
// answer must carry the frozen key's values verbatim, pass the R3/R9/R10/R11
// validator, and show attribution. No API key, no network: exactly what CI
// runs. Zero fabricated numbers is not asserted as a separate line — it is
// what validation.ok MEANS (every numeric token traces to a cell or
// registered derivation).
//
// Known limitation (accepted, adversarial review 2026-07-03): the committed
// fixtures are first-attempt passes, so the retry and template paths are not
// replay-covered here — a live model cannot be made to fail on demand. Those
// paths are proven hermetically by the seeded-fault unit tests in
// compose-template.test.ts and tests/invariants (FabricatingClient).
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseQuestion } from '../../src/answer/intent/index.ts';
import { composeAnswer } from '../../src/answer/compose/index.ts';
import type { ComposedAnswer } from '../../src/answer/compose/index.ts';
import { ReplayLlmClient } from '../../src/answer/llm/client.ts';
import { runQuery, DERIVED_DATA_MARKING } from '../../src/query/index.ts';
import type { Db } from '../../src/db/types.ts';
import { createIngestedDb } from '../helpers/ingested-db.ts';
import { ANSWERABLE_TASKS } from '../helpers/benchmark-intents.ts';
import { checkComposedAnswer, loadAnswerKey } from '../helpers/answer-expectations.ts';
import { loadLabelledSet } from '../helpers/intent-expectations.ts';

const INTENT_FIXTURES = fileURLToPath(new URL('../fixtures/llm/intent', import.meta.url));
const ANSWER_FIXTURES = fileURLToPath(new URL('../fixtures/llm/answer', import.meta.url));
// The labelled set's reference date — the one the intent fixtures were
// recorded against (a different date would change relative-period resolution
// and thus the fixture hashes).
const REFERENCE_DATE = loadLabelledSet().referenceDate;

const answerKey = loadAnswerKey();
const taskIds = Object.keys(ANSWERABLE_TASKS);

let db: Db;
let close: () => Promise<void>;
const answers = new Map<string, ComposedAnswer>();

beforeAll(async () => {
  ({ db, close } = await createIngestedDb());
  const intentClient = new ReplayLlmClient(INTENT_FIXTURES);
  const answerClient = new ReplayLlmClient(ANSWER_FIXTURES);
  for (const taskId of taskIds) {
    const outcome = await parseQuestion(db, ANSWERABLE_TASKS[taskId]!.question, {
      client: intentClient,
      referenceDate: REFERENCE_DATE,
    });
    if (outcome.kind !== 'intent') throw new Error(`${taskId}: expected intent, got ${outcome.kind}`);
    const result = await runQuery(db, outcome.intent);
    if (!result.ok) throw new Error(`${taskId}: query refused: ${result.refusal.message}`);
    answers.set(taskId, await composeAnswer(result, { client: answerClient }));
  }
}, 300_000);

afterAll(async () => {
  await close();
});

describe('end-to-end: question → parse → query → composed answer (replayed fixtures)', () => {
  for (const taskId of taskIds) {
    it(`${taskId}: answers with the frozen key values, validated and attributed`, () => {
      const answer = answers.get(taskId)!;
      const problems = checkComposedAnswer(taskId, answerKey.tasks[taskId]!, answer);
      expect(problems, `${answer.text}\n\n${problems.join('\n')}`).toEqual([]);
    });
  }

  it('the CC BY derived-data marking renders on every answer that carries derivations (R5)', () => {
    for (const taskId of ['B4', 'B8', 'B10', 'B13', 'B14']) {
      expect(answers.get(taskId)!.text, taskId).toContain(DERIVED_DATA_MARKING);
    }
  });

  it('B11 (NaderVoorlopig) carries the voorlopig marking end-to-end (R11)', () => {
    expect(answers.get('B11')!.text).toMatch(/voorlopig/i);
  });

  it('canonical defaults are stated transparently (B5 names the seasonally-adjusted definition)', () => {
    expect(answers.get('B5')!.text).toContain('seizoengecorrigeerd');
  });

  it('reports the template-fallback count (informational, docs/02 scoring)', () => {
    const sources = [...answers.entries()].map(([id, a]) => [id, a.source]);
    const fallbacks = sources.filter(([, s]) => s === 'template');
    // Informational, never gate-failing: a template answer is a correct
    // answer. This test only guarantees the metric stays visible.
    console.info(`template fallbacks: ${fallbacks.length}/${sources.length}`, Object.fromEntries(sources));
    expect(fallbacks.length).toBeLessThanOrEqual(sources.length);
  });
});

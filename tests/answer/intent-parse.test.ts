// WP6 done-criterion, hermetic (ADR 012): every benchmark phrasing and every
// labelled calibration case parses to its expected outcome, replayed from the
// committed LLM fixtures — no API key, no network, exactly what CI runs.
//
// The answerable tasks must produce the SAME hand-authored intents the WP5
// suite proves against the frozen answer key (tests/helpers/benchmark-intents
// .ts) — so a green run here plus a green query suite means parse→query
// reproduces the key end-to-end. B1 and B20 are additionally driven through
// runQuery below to pin that composition directly.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseQuestion, ReplayIntentClient } from '../../src/answer/intent/index.ts';
import type { ParseOutcome } from '../../src/answer/intent/index.ts';
import { runQuery } from '../../src/query/index.ts';
import type { Db } from '../../src/db/types.ts';
import { createIngestedDb } from '../helpers/ingested-db.ts';
import {
  allCases,
  checkExpectation,
  loadLabelledSet,
} from '../helpers/intent-expectations.ts';

const FIXTURES_DIR = fileURLToPath(new URL('../fixtures/llm/intent', import.meta.url));

const answerKey = JSON.parse(
  readFileSync(new URL('../../benchmark/answer-key.json', import.meta.url), 'utf8'),
) as { tasks: Record<string, any> };

const set = loadLabelledSet();
const cases = allCases(set);

let db: Db;
let close: () => Promise<void>;
const outcomes = new Map<string, ParseOutcome>();

beforeAll(async () => {
  ({ db, close } = await createIngestedDb());
  const client = new ReplayIntentClient(FIXTURES_DIR);
  for (const labelled of cases) {
    outcomes.set(
      labelled.id,
      await parseQuestion(db, labelled.question, { client, referenceDate: set.referenceDate }),
    );
  }
}, 300_000);

afterAll(async () => {
  await close();
});

describe('intent parsing over recorded fixtures (benchmark + labelled set)', () => {
  for (const labelled of cases) {
    it(`${labelled.id} [${labelled.category}]: ${labelled.question}`, () => {
      const outcome = outcomes.get(labelled.id)!;
      const problems = checkExpectation(outcome, labelled.expect);
      expect(problems, problems.join('\n')).toEqual([]);
    });
  }

  it('clarification questions for B15/B16 carry no number for the unanswerable quantity', () => {
    // Structural guarantee: the question builder never sees cell values. This
    // belt-check scans for multi-digit tokens (years, counts, amounts) — a
    // single digit is allowed because definition labels offered as options
    // legitimately contain one ("bevolking op 1 januari").
    for (const taskId of ['B15', 'B16']) {
      const outcome = outcomes.get(taskId)!;
      expect(outcome.kind).toBe('clarification');
      if (outcome.kind !== 'clarification') throw new Error('unreachable');
      expect(outcome.question_nl).not.toMatch(/\d\d/);
    }
  });
});

describe('parse → query composition (the pipeline halves meet)', () => {
  it('B1 parses and answers with the frozen key value end-to-end', async () => {
    const outcome = outcomes.get('B1')!;
    expect(outcome.kind).toBe('intent');
    if (outcome.kind !== 'intent') throw new Error('unreachable');
    const result = await runQuery(db, outcome.intent);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.cells[0]!.value).toBe(answerKey.tasks.B1!.value);
  });

  it('B20 ("vorige maand", beyond the loaded CPI months) refuses on freshness with the key reference — and no value', async () => {
    const outcome = outcomes.get('B20')!;
    expect(outcome.kind).toBe('intent');
    if (outcome.kind !== 'intent') throw new Error('unreachable');
    expect(outcome.impliedRecency).toBe(true);
    const result = await runQuery(db, outcome.intent);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.refusal.kind).toBe('freshness');
    const key = answerKey.tasks.B20!;
    expect(result.refusal.freshness?.freshestAvailable).toEqual({
      periodCode: key.freshestAvailable.period,
      status: key.freshestAvailable.status,
    });
    // Principle c: the refusal payload carries no data values.
    expect(JSON.stringify(result)).not.toContain(String(key.freshestAvailable.value));
  });
});

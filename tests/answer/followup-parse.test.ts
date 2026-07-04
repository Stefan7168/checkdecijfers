// WP15 follow-up parser, hermetic (ADR 021, open-questions #57): every
// labelled follow-up case replayed from committed LLM fixtures — no API key,
// no network, exactly what CI runs.
//
// Fixtures are recorded by `npm run followup:record` (supervised, spends API
// tokens). Until they exist this suite FAILS LOUDLY with the re-record
// instruction — that is fixture honesty working as designed (ADR 012); the
// WP15 session records them before push.
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  parseFollowUpQuestion,
  buildFollowUpSystemPrompt,
  buildFollowUpUserPayload,
  buildFollowUpRequest,
  FOLLOWUP_MODE_SECTION,
} from '../../src/answer/intent/followup.ts';
import { buildIntentRequest, buildSystemPrompt } from '../../src/answer/intent/index.ts';
import { ReplayLlmClient } from '../../src/answer/llm/client.ts';
import type { ConversationContext } from '../../src/answer/context/types.ts';
import type { ParseOutcome } from '../../src/answer/intent/types.ts';
import type { Db } from '../../src/db/types.ts';
import { createIngestedDb } from '../helpers/ingested-db.ts';
import { checkExpectation } from '../helpers/intent-expectations.ts';
import type { Expectation } from '../helpers/intent-expectations.ts';

const FIXTURES_DIR = fileURLToPath(new URL('../fixtures/llm/followup', import.meta.url));

interface FollowUpCase {
  id: string;
  context: ConversationContext;
  question: string;
  expect: Expectation;
}

interface FollowUpCaseSet {
  version: number;
  referenceDate: string;
  note: string;
  cases: FollowUpCase[];
}

const set = JSON.parse(
  readFileSync(new URL('../../benchmark/followup-cases.json', import.meta.url), 'utf8'),
) as FollowUpCaseSet;

describe('buildFollowUpRequest: hash-stability of the 54 intent + 7 clarify fixtures (ADR 021 Decision 2)', () => {
  it('the follow-up system prompt is buildSystemPrompt() + FOLLOWUP_MODE_SECTION, byte-identically', () => {
    expect(buildFollowUpSystemPrompt()).toBe(buildSystemPrompt() + FOLLOWUP_MODE_SECTION);
  });

  it('the follow-up user payload serializes exactly {previous_intent:{topicKey,regions,period,derivation}, question}', () => {
    const context: ConversationContext = {
      version: 1,
      topicKey: 'population_on_1_january',
      regions: [{ name: 'Amsterdam', kind: 'gemeente' }],
      period: { kind: 'year', year: 2024 },
      derivation: 'none',
    };
    const payload = JSON.parse(buildFollowUpUserPayload(context, 'En in Rotterdam?')) as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(['previous_intent', 'question']);
    const previousIntent = payload.previous_intent as Record<string, unknown>;
    expect(Object.keys(previousIntent).sort()).toEqual(['derivation', 'period', 'regions', 'topicKey']);
    expect(payload.question).toBe('En in Rotterdam?');
    expect(previousIntent).toEqual({
      topicKey: context.topicKey,
      regions: context.regions,
      period: context.period,
      derivation: context.derivation,
    });
  });

  it('buildFollowUpRequest emits the byte-identical system prompt via the request shape', () => {
    const context: ConversationContext = {
      version: 1,
      topicKey: 'cpi_yearly_inflation',
      regions: null,
      period: null,
      derivation: 'none',
    };
    const request = buildFollowUpRequest(context, 'En in 2020?');
    expect(request.system).toBe(buildSystemPrompt() + FOLLOWUP_MODE_SECTION);
  });

  it("buildIntentRequest's (normal-mode) system prompt contains NO trace of the follow-up section", () => {
    const normalRequest = buildIntentRequest('Wat was de inflatie in 2024?');
    expect(normalRequest.system).not.toContain(FOLLOWUP_MODE_SECTION);
    expect(normalRequest.system).not.toContain('Follow-up mode');
    expect(normalRequest.system).not.toContain('previous_intent');
    expect(normalRequest.system).toBe(buildSystemPrompt());
  });
});

describe('follow-up parsing over recorded fixtures (benchmark/followup-cases.json)', () => {
  let db: Db;
  let close: () => Promise<void>;
  const outcomes = new Map<string, ParseOutcome>();

  beforeAll(async () => {
    ({ db, close } = await createIngestedDb());
    const client = new ReplayLlmClient(FIXTURES_DIR);
    for (const c of set.cases) {
      outcomes.set(
        c.id,
        await parseFollowUpQuestion(db, c.context, c.question, { client, referenceDate: set.referenceDate }),
      );
    }
  }, 300_000);

  afterAll(async () => {
    await close();
  });

  for (const c of set.cases) {
    it(`${c.id}: ${c.question}`, () => {
      const outcome = outcomes.get(c.id)!;
      const problems = checkExpectation(outcome, c.expect);
      expect(problems, problems.join('\n')).toEqual([]);
    });
  }
});

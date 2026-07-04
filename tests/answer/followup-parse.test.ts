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
import {
  parseClarificationReply,
  buildClarifySystemPrompt,
  buildClarifyUserPayload,
  CLARIFY_CONTEXT_ADDENDUM,
  CLARIFY_MODE_SECTION,
} from '../../src/answer/intent/clarify.ts';
import { buildIntentRequest, buildSystemPrompt } from '../../src/answer/intent/index.ts';
import { respondToQuestion } from '../../src/answer/respond/respond.ts';
import { ReplayLlmClient } from '../../src/answer/llm/client.ts';
import type { ConversationContext } from '../../src/answer/context/types.ts';
import type { ParseOutcome } from '../../src/answer/intent/types.ts';
import type { PendingClarification } from '../../src/answer/respond/types.ts';
import { RESPONSE_SCHEMA_VERSION } from '../../src/answer/respond/types.ts';
import type { Db } from '../../src/db/types.ts';
import { createIngestedDb } from '../helpers/ingested-db.ts';
import { checkExpectation } from '../helpers/intent-expectations.ts';
import type { Expectation } from '../helpers/intent-expectations.ts';

const FIXTURES_DIR = fileURLToPath(new URL('../fixtures/llm/followup', import.meta.url));
const ANSWER_FIXTURES = fileURLToPath(new URL('../fixtures/llm/answer', import.meta.url));

interface FollowUpCase {
  id: string;
  context: ConversationContext;
  question: string;
  expect: Expectation;
  reply?: string;
  expectAfterReply?: Expectation;
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

  it('a contextless clarify request keeps the exact v1 bytes — the 7 committed clarify fixtures stay valid (CLARIFY_PROMPT_VERSION v2)', () => {
    const pending: PendingClarification = {
      version: RESPONSE_SCHEMA_VERSION,
      question: 'Hoeveel mensen zitten in de bijstand?',
      referenceDate: '2026-08-15',
      axes: ['measure'],
      questionNl: 'Welk onderwerp bedoel je?',
      options: [],
    };
    expect(buildClarifySystemPrompt()).toBe(buildSystemPrompt() + CLARIFY_MODE_SECTION);
    expect(buildClarifySystemPrompt(null)).toBe(buildSystemPrompt() + CLARIFY_MODE_SECTION);
    expect(buildClarifySystemPrompt(undefined)).toBe(buildSystemPrompt() + CLARIFY_MODE_SECTION);
    const payload = JSON.parse(buildClarifyUserPayload(pending, 'werkloosheid')) as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(['clarification_question', 'options', 'original_question', 'reply']);
  });

  it('a context-carrying clarify request appends the addendum and the previous_intent field — new bytes, new fixtures', () => {
    const context: ConversationContext = {
      version: 1,
      topicKey: 'unemployment_rate_seasonally_adjusted',
      regions: null,
      period: null,
      derivation: 'none',
    };
    const pending: PendingClarification = {
      version: RESPONSE_SCHEMA_VERSION,
      question: 'En in Nederland?',
      referenceDate: '2026-08-15',
      axes: ['period'],
      questionNl: 'Voor welke periode wil je dit weten?',
      options: [],
      conversationContext: context,
    };
    expect(buildClarifySystemPrompt(context)).toBe(
      buildSystemPrompt() + CLARIFY_MODE_SECTION + CLARIFY_CONTEXT_ADDENDUM,
    );
    const payload = JSON.parse(buildClarifyUserPayload(pending, '2025')) as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual([
      'clarification_question',
      'options',
      'original_question',
      'previous_intent',
      'reply',
    ]);
    expect(payload.previous_intent).toEqual({
      topicKey: context.topicKey,
      regions: context.regions,
      period: context.period,
      derivation: context.derivation,
    });
  });
});

describe('follow-up parsing over recorded fixtures (benchmark/followup-cases.json)', () => {
  let db: Db;
  let close: () => Promise<void>;
  const outcomes = new Map<string, ParseOutcome>();
  const replyOutcomes = new Map<string, ParseOutcome>();

  beforeAll(async () => {
    ({ db, close } = await createIngestedDb());
    const client = new ReplayLlmClient(FIXTURES_DIR);
    for (const c of set.cases) {
      const outcome = await parseFollowUpQuestion(db, c.context, c.question, {
        client,
        referenceDate: set.referenceDate,
      });
      outcomes.set(c.id, outcome);
      // Reply leg (review finding 2026-07-04): the follow-up→clarify→reply
      // chain, driven exactly as the respond layer drives it — the pending
      // carries the referent, the clarify prompt gains the context addendum.
      if (c.reply !== undefined && outcome.kind === 'clarification') {
        const pending: PendingClarification = {
          version: RESPONSE_SCHEMA_VERSION,
          question: c.question,
          referenceDate: set.referenceDate,
          axes: outcome.axes,
          questionNl: outcome.question_nl,
          options: outcome.options,
          conversationContext: c.context,
        };
        replyOutcomes.set(c.id, await parseClarificationReply(db, pending, c.reply, { client }));
      }
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
    if (c.reply !== undefined && c.expectAfterReply !== undefined) {
      it(`${c.id} (reply): ${c.reply}`, () => {
        const outcome = replyOutcomes.get(c.id);
        expect(outcome, 'reply leg needs a clarification first turn').toBeDefined();
        const problems = checkExpectation(outcome!, c.expectAfterReply!);
        expect(problems, problems.join('\n')).toEqual([]);
      });
    }
  }

  it('the respond layer threads the offered context into pending.conversationContext (review finding 2026-07-04)', async () => {
    const c = set.cases.find((x) => x.id === 'f-v30-randstad')!;
    const response = await respondToQuestion(db, c.question, {
      intentClient: new ReplayLlmClient(FIXTURES_DIR),
      // Unused on the clarification path — present to satisfy the contract.
      answerClient: new ReplayLlmClient(ANSWER_FIXTURES),
      referenceDate: set.referenceDate,
      conversationContext: c.context,
    });
    expect(response.kind).toBe('clarification');
    if (response.kind !== 'clarification') throw new Error('unreachable');
    expect(response.pending.conversationContext).toEqual(c.context);
    // And WITHOUT a context, the pending stays context-free (byte-stable
    // legacy shape — no key materialized).
    const standalone = await respondToQuestion(db, 'Wat was de inflatie in 2023?', {
      intentClient: new ReplayLlmClient(fileURLToPath(new URL('../fixtures/llm/intent', import.meta.url))),
      answerClient: new ReplayLlmClient(ANSWER_FIXTURES),
      referenceDate: set.referenceDate,
    });
    if (standalone.kind === 'clarification') {
      expect('conversationContext' in standalone.pending).toBe(false);
    }
  });
});

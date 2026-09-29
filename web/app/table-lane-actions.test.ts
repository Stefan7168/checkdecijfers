// Breadth step 5, Task 5: the table lane on the request path, hermetic.
//   - askQuestion: behind TABLE_LANE_ENABLED, a thread-aware curated miss the
//     finder routed (the onboarding_pending refusal) queues a table-lane
//     request instead of minting the 100-credit onboarding offer; flag off ⇒
//     today's outcome exactly (plus the new `tableLane: null` field).
//   - pollTableLane / replyToTableLane: session + row ownership, the audited
//     response of a finished row, and the typed/clicked reply matched against
//     the dimension's FULL member list.
// The store (tests/ingestion/table-lane-store.test.ts proves the 20-credit
// debit, settlement and owner scoping on PGlite), the billing gate, the
// audited pipeline, threads and auth are stubbed at their boundaries — this
// file pins actions.ts's own orchestration. No CBS, no LLM, no db.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../backend/db/types.ts';
import type { GatedResponse } from '../backend/billing/index.ts';
import type { AuditedResponse } from '../backend/answer/audit/index.ts';
import type { ComposedResponse } from '../backend/answer/respond/types.ts';
import type { TableLaneRow } from '../backend/ingestion/table-lane-store.ts';
import { ONBOARDING_OFFER_TEXT, ONBOARDING_PENDING_TEXT } from '../backend/answer/respond/refusals.ts';

const { currentUserId, getDb } = vi.hoisted(() => ({
  currentUserId: vi.fn<() => Promise<string | null>>(),
  getDb: vi.fn<() => Db>(),
}));
vi.mock('../lib/current-user.ts', () => ({ currentUserId }));
vi.mock('../lib/db.ts', () => ({ getDb }));
const { reportError } = vi.hoisted(() => ({ reportError: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../lib/error-report.ts', () => ({ reportError }));
const { getLang } = vi.hoisted(() => ({ getLang: vi.fn<() => Promise<'nl' | 'en'>>() }));
vi.mock('../lib/i18n/server.ts', () => ({ getLang }));
const { after } = vi.hoisted(() => ({ after: vi.fn() }));
vi.mock('next/server', () => ({ after }));
const { kickTableLaneJob } = vi.hoisted(() => ({ kickTableLaneJob: vi.fn() }));
vi.mock('../lib/table-lane-kick.ts', () => ({ kickTableLaneJob }));

const billing = vi.hoisted(() => ({
  chargeAndRun: vi.fn(),
  compensate: vi.fn(),
  compensateSplit: vi.fn(),
  getActionClassPrice: vi.fn(),
  getBalance: vi.fn(),
  reserveWebSearchDebit: vi.fn(),
}));
vi.mock('../backend/billing/index.ts', () => billing);

const audit = vi.hoisted(() => ({
  answerQuestionAudited: vi.fn(),
  answerClarificationReplyAudited: vi.fn(),
  deleteUserQuestionHistory: vi.fn(),
  deleteThreadQuestionHistory: vi.fn(),
  FEEDBACK_TEXT_MAX_LENGTH: 2000,
  upsertAnswerFeedback: vi.fn(),
}));
vi.mock('../backend/answer/audit/index.ts', () => audit);
vi.mock('../backend/answer/context/index.ts', () => ({
  validateConversationContext: vi.fn().mockResolvedValue(null),
  buildConversationContext: vi.fn().mockResolvedValue(null),
}));
vi.mock('../backend/answer/llm/client.ts', () => ({ AnthropicLlmClient: vi.fn() }));
vi.mock('../backend/websearch/index.ts', () => ({ AnthropicWebSearchClient: vi.fn() }));

const threads = vi.hoisted(() => ({
  validateThreadOwnership: vi.fn(),
  attachOrCreateThread: vi.fn(),
  listThreads: vi.fn(),
  getThreadRows: vi.fn(),
  getThreadDatasetId: vi.fn(),
}));
vi.mock('../backend/threads/index.ts', () => threads);

const onboarding = vi.hoisted(() => ({ onboardingPrice: vi.fn(), triggerOnboarding: vi.fn() }));
vi.mock('../backend/ingestion/onboarding-trigger.ts', () => onboarding);
const offerToken = vi.hoisted(() => ({ signOnboardingOffer: vi.fn(), verifyOnboardingOffer: vi.fn() }));
vi.mock('../backend/ingestion/onboarding-offer-token.ts', () => offerToken);

const store = vi.hoisted(() => ({
  createTableLaneRequest: vi.fn(),
  readTableLaneRequest: vi.fn(),
  readTableLaneNetCost: vi.fn(),
  readTableLaneAuditResult: vi.fn(),
  readTableLaneDimensionMembers: vi.fn(),
}));
vi.mock('../backend/ingestion/table-lane-store.ts', () => store);

import { askQuestion, pollTableLane, replyToTableLane } from './actions.ts';

const fakeDb = {} as Db;
const RID = '00000000-0000-4000-8000-000000000001';
const RID2 = '00000000-0000-4000-8000-000000000002';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

beforeEach(() => {
  currentUserId.mockResolvedValue('user-1');
  getDb.mockReturnValue(fakeDb);
  getLang.mockResolvedValue('nl');
  billing.getActionClassPrice.mockResolvedValue(20);
  billing.getBalance.mockResolvedValue(100);
  threads.validateThreadOwnership.mockResolvedValue(null);
  threads.attachOrCreateThread.mockResolvedValue(7);
  onboarding.onboardingPrice.mockResolvedValue(100);
  offerToken.signOnboardingOffer.mockReturnValue('signed-offer');
  vi.stubEnv('WEBSEARCH_ENABLED', '0');
  vi.stubEnv('ONBOARDING_ENABLED', '0');
  vi.stubEnv('ONBOARDING_OFFER_SECRET', 'offer-secret');
  vi.stubEnv('TABLE_LANE_ENABLED', '');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

const ONBOARDING = { tableId: '85000NED', topicTerm: 'woningen', confidence: 0.91, candidateIds: ['85000NED'] };

function routingRefusal(): ComposedResponse {
  return {
    kind: 'refusal',
    reason: 'onboarding_pending',
    question: 'Hoeveel woningen?',
    text: ONBOARDING_PENDING_TEXT,
    onboarding: ONBOARDING,
  } as unknown as ComposedResponse;
}

/** Gate that runs the pipeline and returns gated-ok (a refusal nets 0). */
function drive(response: ComposedResponse, auditId: number | null, netCost = 0): void {
  audit.answerQuestionAudited.mockResolvedValue({ response, auditId } as AuditedResponse);
  billing.chargeAndRun.mockImplementation(
    async (_db: Db, _uid: string, _rid: string, run: () => Promise<AuditedResponse>) => {
      const audited = await run();
      return { kind: 'ok', ...audited, netCost } as GatedResponse;
    },
  );
}

function laneRow(overrides: Partial<TableLaneRow> = {}): TableLaneRow {
  return {
    id: 42,
    userId: 'user-1',
    requestId: RID,
    threadId: null,
    lang: 'nl',
    question: 'Hoeveel woningen?',
    tableId: '85000NED',
    finderConfidence: 0.91,
    parentId: null,
    previousQuestion: null,
    choices: [],
    status: 'pending',
    attempts: 0,
    debitTransactionId: 1,
    auditId: null,
    outcomeKind: null,
    createdAt: new Date(),
    startedAt: null,
    finishedAt: null,
    failureSummary: null,
    ...overrides,
  };
}

// What askQuestion returns TODAY (before the table lane) for a thread-aware
// onboarding-routed question: the offer is minted, the text rewritten, the
// ack row attached to a thread. Verified against the pre-change code in the
// RED run (the only diff there was the missing `tableLane: null`).
const TODAY_OUTCOME = {
  gated: {
    kind: 'ok',
    netCost: 0,
    auditId: 11,
    response: { ...routingRefusal(), text: ONBOARDING_OFFER_TEXT },
  },
  context: null,
  threadId: 7,
  onboardingOffer: { token: 'signed-offer', priceCredits: 100 },
  proofRequestUrls: null,
};

describe('askQuestion — flag off: byte-identical to today', () => {
  it('an onboarding-routed question mints the offer exactly as before; nothing is queued', async () => {
    drive(routingRefusal(), 11);
    const outcome = await askQuestion('Hoeveel woningen?', RID, null, undefined, null);
    expect(outcome).toEqual({ ...TODAY_OUTCOME, tableLane: null });
    expect(store.createTableLaneRequest).not.toHaveBeenCalled();
    expect(after).not.toHaveBeenCalled();
    expect(threads.attachOrCreateThread).toHaveBeenCalledWith(fakeDb, 'user-1', null, 11);
  });

  it("any value but exactly '1' is off", async () => {
    vi.stubEnv('TABLE_LANE_ENABLED', 'true');
    drive(routingRefusal(), 11);
    const outcome = await askQuestion('Hoeveel woningen?', RID, null, undefined, null);
    expect(outcome).toEqual({ ...TODAY_OUTCOME, tableLane: null });
    expect(store.createTableLaneRequest).not.toHaveBeenCalled();
  });
});

describe('askQuestion — flag on: routed to the table lane', () => {
  beforeEach(() => vi.stubEnv('TABLE_LANE_ENABLED', '1'));

  it('queues a table-lane request, kicks the job, mints NO offer and does NOT attach the routing row', async () => {
    drive(routingRefusal(), 11);
    store.createTableLaneRequest.mockResolvedValue({ kind: 'created', row: laneRow() });
    const outcome = await askQuestion('Hoeveel woningen?', RID, null, undefined, null);

    expect(store.createTableLaneRequest).toHaveBeenCalledWith(fakeDb, {
      userId: 'user-1',
      requestId: RID,
      threadId: null,
      lang: 'nl',
      question: 'Hoeveel woningen?',
      tableId: '85000NED',
      finderConfidence: 0.91,
    });
    expect(outcome.tableLane).toEqual({ rowId: 42 });
    expect(outcome.onboardingOffer).toBeNull();
    expect(offerToken.signOnboardingOffer).not.toHaveBeenCalled();
    expect(onboarding.onboardingPrice).not.toHaveBeenCalled();
    expect(threads.attachOrCreateThread).not.toHaveBeenCalled();
    // the routing turn itself stays free and unaltered (the audited refusal)
    expect(outcome.gated).toEqual({ kind: 'ok', netCost: 0, auditId: 11, response: routingRefusal() });
    expect(outcome.context).toBeNull();
    expect(outcome.threadId).toBeNull();
    expect(outcome.proofRequestUrls).toBeNull();
    // the kick runs post-response
    expect(after).toHaveBeenCalledTimes(1);
    expect(kickTableLaneJob).not.toHaveBeenCalled();
    (after.mock.calls[0]![0] as () => void)();
    expect(kickTableLaneJob).toHaveBeenCalledTimes(1);
  });

  it('carries the validated (owned) thread and the reader language onto the row', async () => {
    threads.validateThreadOwnership.mockResolvedValue(3);
    getLang.mockResolvedValue('en');
    drive(routingRefusal(), 11);
    store.createTableLaneRequest.mockResolvedValue({ kind: 'created', row: laneRow({ threadId: 3, lang: 'en' }) });
    const outcome = await askQuestion('Hoeveel woningen?', RID, null, undefined, 3);
    expect(store.createTableLaneRequest).toHaveBeenCalledWith(
      fakeDb,
      expect.objectContaining({ threadId: 3, lang: 'en' }),
    );
    expect(outcome.threadId).toBe(3);
    expect(threads.attachOrCreateThread).not.toHaveBeenCalled();
  });

  it('a duplicate (client retry) returns the existing row and kicks again, no second charge', async () => {
    drive(routingRefusal(), 11);
    store.createTableLaneRequest.mockResolvedValue({ kind: 'duplicate', row: laneRow({ id: 40 }) });
    const outcome = await askQuestion('Hoeveel woningen?', RID, null, undefined, null);
    expect(outcome.tableLane).toEqual({ rowId: 40 });
    expect(after).toHaveBeenCalledTimes(1);
  });

  it('insufficient credits returns the existing insufficient_credits shape and queues nothing', async () => {
    drive(routingRefusal(), 11);
    store.createTableLaneRequest.mockResolvedValue({ kind: 'insufficient', balance: 5, required: 20 });
    const outcome = await askQuestion('Hoeveel woningen?', RID, null, undefined, null);
    expect(outcome).toEqual({
      gated: { kind: 'insufficient_credits', balance: 5, required: 20 },
      context: null,
      threadId: null,
      onboardingOffer: null,
      proofRequestUrls: null,
      tableLane: null,
    });
    expect(after).not.toHaveBeenCalled();
    expect(threads.attachOrCreateThread).not.toHaveBeenCalled();
  });

  it('a non-thread-aware caller (Dashboard, 3-arg call) is never routed: today\'s offer path', async () => {
    drive(routingRefusal(), 11);
    const outcome = await askQuestion('Hoeveel woningen?', RID, null);
    expect(store.createTableLaneRequest).not.toHaveBeenCalled();
    expect(outcome.onboardingOffer).toEqual({ token: 'signed-offer', priceCredits: 100 });
    expect(outcome.tableLane).toBeNull();
  });

  it('every other outcome passes through untouched with tableLane null', async () => {
    const answer = { kind: 'answer', question: 'q', text: 'Het antwoord.', answer: { body: 'x' } } as unknown as ComposedResponse;
    drive(answer, 5, 20);
    const outcome = await askQuestion('q', RID, null, undefined, null);
    expect(store.createTableLaneRequest).not.toHaveBeenCalled();
    expect(outcome.tableLane).toBeNull();
    expect(outcome.threadId).toBe(7);
  });

  it('an onboarding refusal without a table (already pending: onboarding null) is not routed', async () => {
    const already = {
      kind: 'refusal',
      reason: 'onboarding_already_pending',
      question: 'q',
      text: 'al bezig',
      onboarding: null,
    } as unknown as ComposedResponse;
    drive(already, 12);
    const outcome = await askQuestion('q', RID, null, undefined, null);
    expect(store.createTableLaneRequest).not.toHaveBeenCalled();
    expect(outcome.tableLane).toBeNull();
    expect(outcome.gated).toEqual({ kind: 'ok', netCost: 0, auditId: 12, response: already });
  });

  it('a failing queue insert falls back to today\'s offer path and is reported (nothing charged: one transaction)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    drive(routingRefusal(), 11);
    store.createTableLaneRequest.mockRejectedValue(new Error('relation "table_lane_requests" does not exist'));
    const outcome = await askQuestion('Hoeveel woningen?', RID, null, undefined, null);
    expect(outcome).toEqual({ ...TODAY_OUTCOME, tableLane: null });
    expect(reportError).toHaveBeenCalledWith('askQuestion.tableLane', expect.any(Error), expect.objectContaining({ requestId: RID }));
    spy.mockRestore();
  });
});

// Breadth step 5, Task 7: a follow-up in the same conversation reuses the
// previous table-lane ANSWER's table. The link (6th argument, the previous
// row id) is validated before the pipeline runs — owned, done, an answer, in
// this same thread — and then stands in for the table finder: it is consulted
// only on a curated miss (the pipeline's unmatched exit), so a curated hit
// always wins. Anything else about the link ⇒ ignored, today's path.
describe('askQuestion — follow-ups reuse the previous table (Task 7)', () => {
  beforeEach(() => {
    vi.stubEnv('TABLE_LANE_ENABLED', '1');
    threads.validateThreadOwnership.mockResolvedValue(3);
  });

  const PARENT = laneRow({
    id: 50,
    threadId: 3,
    question: 'Hoeveel ziekenhuisopnamen waren er in 2019?',
    tableId: '84521NED',
    finderConfidence: 0.88,
    status: 'done',
    auditId: 90,
    outcomeKind: 'answer',
  });

  type Finder = (term: string, question: string) => Promise<{ tableId: string; confidence: number; topicTerm: string; alreadyPending: boolean; candidateIds: string[] } | null>;
  function pipelineOptions(): { tableFinder?: Finder } {
    return audit.answerQuestionAudited.mock.calls[0]![2] as { tableFinder?: Finder };
  }

  /** The pipeline's curated miss: the unmatched exit consults the injected
   * finder (as src/answer/intent/policy.ts resolveUnmatched does) and a
   * routing becomes the onboarding_pending refusal. */
  function driveMiss(term: string): void {
    audit.answerQuestionAudited.mockImplementation(async (_db: Db, question: string, options: { tableFinder?: Finder }) => {
      const routing = options.tableFinder ? await options.tableFinder(term, question) : null;
      const response = routing
        ? ({
            kind: 'refusal',
            reason: 'onboarding_pending',
            question,
            text: ONBOARDING_PENDING_TEXT,
            onboarding: { tableId: routing.tableId, topicTerm: routing.topicTerm, confidence: routing.confidence, candidateIds: routing.candidateIds },
          } as unknown as ComposedResponse)
        : ({ kind: 'clarification', question, text: 'Welk onderwerp bedoel je?' } as unknown as ComposedResponse);
      return { response, auditId: 11 } as AuditedResponse;
    });
    billing.chargeAndRun.mockImplementation(
      async (_db: Db, _uid: string, _rid: string, run: () => Promise<AuditedResponse>) => ({ kind: 'ok', ...(await run()), netCost: 0 }) as GatedResponse,
    );
  }

  it('a curated miss with a valid link queues a row for the SAME table with the previous question, skipping the finder', async () => {
    vi.stubEnv('ONBOARDING_ENABLED', '1'); // the real finder would exist — the link replaces it
    store.readTableLaneRequest.mockResolvedValue(PARENT);
    driveMiss('vrouwen');
    store.createTableLaneRequest.mockResolvedValue({ kind: 'created', row: laneRow({ id: 51, parentId: 50 }) });
    const outcome = await askQuestion('En voor vrouwen?', RID, null, undefined, 3, 50);

    expect(store.readTableLaneRequest).toHaveBeenCalledWith(fakeDb, 50, 'user-1');
    // The finder slot answers with the parent's table — no catalog search.
    expect(await pipelineOptions().tableFinder!('vrouwen', 'En voor vrouwen?')).toEqual({
      tableId: '84521NED',
      topicTerm: 'vrouwen',
      confidence: 0.88,
      alreadyPending: false,
      candidateIds: ['84521NED'],
    });
    expect(store.createTableLaneRequest).toHaveBeenCalledWith(fakeDb, {
      userId: 'user-1',
      requestId: RID,
      threadId: 3,
      lang: 'nl',
      question: 'En voor vrouwen?',
      tableId: '84521NED',
      finderConfidence: 0.88,
      parentId: 50,
      previousQuestion: 'Hoeveel ziekenhuisopnamen waren er in 2019?',
    });
    // Same money path and shape as a finder-routed question (Task 5).
    expect(outcome.tableLane).toEqual({ rowId: 51 });
    expect(outcome.threadId).toBe(3);
    expect(outcome.onboardingOffer).toBeNull();
    expect(offerToken.signOnboardingOffer).not.toHaveBeenCalled();
    expect(threads.attachOrCreateThread).not.toHaveBeenCalled();
    expect(after).toHaveBeenCalledTimes(1);
    (after.mock.calls[0]![0] as () => void)();
    expect(kickTableLaneJob).toHaveBeenCalledTimes(1);
  });

  it('a curated HIT still wins: the link is never used, the answer passes through', async () => {
    store.readTableLaneRequest.mockResolvedValue(PARENT);
    const answer = { kind: 'answer', question: 'q', text: 'Het antwoord.', answer: { body: 'x' } } as unknown as ComposedResponse;
    drive(answer, 5, 20);
    const outcome = await askQuestion('Hoeveel inwoners heeft Utrecht?', RID, null, undefined, 3, 50);
    expect(store.createTableLaneRequest).not.toHaveBeenCalled();
    expect(outcome.tableLane).toBeNull();
    expect(outcome.gated).toEqual({ kind: 'ok', netCost: 20, auditId: 5, response: answer });
    expect(outcome.threadId).toBe(7);
  });

  it("another user's row id is ignored (the owner-scoped read returns null): today's path, no follow-up fields", async () => {
    store.readTableLaneRequest.mockResolvedValue(null);
    driveMiss('vrouwen');
    const outcome = await askQuestion('En voor vrouwen?', RID, null, undefined, 3, 99);
    expect(store.readTableLaneRequest).toHaveBeenCalledWith(fakeDb, 99, 'user-1');
    expect(pipelineOptions().tableFinder).toBeUndefined(); // ONBOARDING_ENABLED off: no finder at all, as today
    expect(store.createTableLaneRequest).not.toHaveBeenCalled();
    expect(outcome.tableLane).toBeNull();
  });

  it.each([
    ['a refusal', { outcomeKind: 'refusal' as const }],
    ['a clarification (button question)', { outcomeKind: 'clarification' as const }],
    ['a pending row', { status: 'pending' as const, outcomeKind: null, auditId: null }],
    ['a running row', { status: 'running' as const, outcomeKind: null, auditId: null }],
    ['a failed row', { status: 'failed' as const, outcomeKind: 'refusal' as const }],
    ['a row in another thread', { threadId: 4 }],
    ['a row with no thread', { threadId: null }],
  ])('a link to %s is ignored', async (_label, overrides) => {
    store.readTableLaneRequest.mockResolvedValue({ ...PARENT, ...overrides });
    driveMiss('vrouwen');
    const outcome = await askQuestion('En voor vrouwen?', RID, null, undefined, 3, 50);
    expect(pipelineOptions().tableFinder).toBeUndefined();
    expect(store.createTableLaneRequest).not.toHaveBeenCalled();
    expect(outcome.tableLane).toBeNull();
  });

  it('a link while the chat has no thread yet (fresh chat) is ignored', async () => {
    threads.validateThreadOwnership.mockResolvedValue(null);
    store.readTableLaneRequest.mockResolvedValue(PARENT);
    driveMiss('vrouwen');
    await askQuestion('En voor vrouwen?', RID, null, undefined, null, 50);
    expect(pipelineOptions().tableFinder).toBeUndefined();
    expect(store.createTableLaneRequest).not.toHaveBeenCalled();
  });

  it('a malformed link is ignored without a read', async () => {
    driveMiss('vrouwen');
    for (const bad of [0, -1, 1.5, Number.NaN, '50', null, { id: 50 }]) {
      await askQuestion('En voor vrouwen?', RID, null, undefined, 3, bad);
    }
    expect(store.readTableLaneRequest).not.toHaveBeenCalled();
    expect(store.createTableLaneRequest).not.toHaveBeenCalled();
  });

  it('a failing link read is ignored (reported), never fails the turn', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    store.readTableLaneRequest.mockRejectedValue(new Error('connection reset'));
    driveMiss('vrouwen');
    const outcome = await askQuestion('En voor vrouwen?', RID, null, undefined, 3, 50);
    expect(pipelineOptions().tableFinder).toBeUndefined();
    expect(outcome.tableLane).toBeNull();
    expect(reportError).toHaveBeenCalledWith('askQuestion.tableLaneFollowUp', expect.any(Error), expect.objectContaining({ requestId: RID }));
    spy.mockRestore();
  });

  it('flag off: the link is never read and the outcome is exactly today\'s', async () => {
    vi.stubEnv('TABLE_LANE_ENABLED', '');
    threads.validateThreadOwnership.mockResolvedValue(null);
    drive(routingRefusal(), 11);
    const outcome = await askQuestion('Hoeveel woningen?', RID, null, undefined, null, 50);
    expect(store.readTableLaneRequest).not.toHaveBeenCalled();
    expect(outcome).toEqual({ ...TODAY_OUTCOME, tableLane: null });
  });

  it('a non-thread-aware caller never uses a link', async () => {
    drive(routingRefusal(), 11);
    await askQuestion('Hoeveel woningen?', RID, null, undefined, undefined, 50);
    expect(store.readTableLaneRequest).not.toHaveBeenCalled();
    expect(store.createTableLaneRequest).not.toHaveBeenCalled();
  });
});

describe('pollTableLane', () => {
  it('unauthenticated → gone, nothing read', async () => {
    currentUserId.mockResolvedValue(null);
    expect(await pollTableLane(42)).toEqual({ status: 'gone' });
    expect(store.readTableLaneRequest).not.toHaveBeenCalled();
  });

  it('a malformed row id → gone, nothing read', async () => {
    for (const bad of [0, -1, 1.5, Number.NaN, '42' as unknown as number]) {
      expect(await pollTableLane(bad)).toEqual({ status: 'gone' });
    }
    expect(store.readTableLaneRequest).not.toHaveBeenCalled();
  });

  it("an unknown or another user's row → gone (the owner-scoped read returns null)", async () => {
    store.readTableLaneRequest.mockResolvedValue(null);
    expect(await pollTableLane(42)).toEqual({ status: 'gone' });
    expect(store.readTableLaneRequest).toHaveBeenCalledWith(fakeDb, 42, 'user-1');
  });

  it('pending and running pass through', async () => {
    store.readTableLaneRequest.mockResolvedValue(laneRow({ status: 'pending' }));
    expect(await pollTableLane(42)).toEqual({ status: 'pending' });
    store.readTableLaneRequest.mockResolvedValue(laneRow({ status: 'running' }));
    expect(await pollTableLane(42)).toEqual({ status: 'running' });
  });

  it('done → the audited response as gated-ok, netCost from the settlement, thread from the audit row', async () => {
    const answer = { kind: 'answer', question: 'q', text: 'Antwoord', tableLane: { rowId: 42 } };
    store.readTableLaneRequest.mockResolvedValue(
      laneRow({ status: 'done', outcomeKind: 'answer', auditId: 11, finishedAt: new Date() }),
    );
    store.readTableLaneAuditResult.mockResolvedValue({ response: answer, threadId: 9 });
    store.readTableLaneNetCost.mockResolvedValue(20);
    expect(await pollTableLane(42)).toEqual({
      status: 'done',
      gated: { kind: 'ok', netCost: 20, response: answer, auditId: 11 },
      threadId: 9,
    });
    expect(store.readTableLaneAuditResult).toHaveBeenCalledWith(fakeDb, 11, 'user-1');
    expect(store.readTableLaneNetCost).toHaveBeenCalledWith(fakeDb, 42, 'user-1');
  });

  it("done → falls back to the row's own thread when the audit row carries none yet", async () => {
    store.readTableLaneRequest.mockResolvedValue(
      laneRow({ status: 'done', outcomeKind: 'clarification', auditId: 11, threadId: 5, finishedAt: new Date() }),
    );
    store.readTableLaneAuditResult.mockResolvedValue({ response: { kind: 'clarification' }, threadId: null });
    store.readTableLaneNetCost.mockResolvedValue(10);
    const outcome = await pollTableLane(42);
    expect(outcome).toMatchObject({ status: 'done', threadId: 5 });
  });

  it('done but no thread read yet, just finished → still running (the job attaches after settling)', async () => {
    store.readTableLaneRequest.mockResolvedValue(
      laneRow({ status: 'done', outcomeKind: 'answer', auditId: 11, finishedAt: new Date() }),
    );
    store.readTableLaneAuditResult.mockResolvedValue({ response: { kind: 'answer' }, threadId: null });
    store.readTableLaneNetCost.mockResolvedValue(20);
    expect(await pollTableLane(42)).toEqual({ status: 'running' });
  });

  it('done, no thread and finished long ago (a failed attach) → done with threadId null, never an invented id', async () => {
    store.readTableLaneRequest.mockResolvedValue(
      laneRow({ status: 'done', outcomeKind: 'answer', auditId: 11, finishedAt: new Date(Date.now() - 60_000) }),
    );
    store.readTableLaneAuditResult.mockResolvedValue({ response: { kind: 'answer' }, threadId: null });
    store.readTableLaneNetCost.mockResolvedValue(20);
    expect(await pollTableLane(42)).toMatchObject({ status: 'done', threadId: null });
  });

  it('a failed row returns its audited failure refusal the same way', async () => {
    const refusal = { kind: 'refusal', reason: 'table_lane_failed', question: 'q', text: 'Mislukt' };
    store.readTableLaneRequest.mockResolvedValue(
      laneRow({ status: 'failed', auditId: 13, threadId: 5, finishedAt: new Date() }),
    );
    store.readTableLaneAuditResult.mockResolvedValue({ response: refusal, threadId: 5 });
    store.readTableLaneNetCost.mockResolvedValue(0);
    expect(await pollTableLane(42)).toEqual({
      status: 'done',
      gated: { kind: 'ok', netCost: 0, response: refusal, auditId: 13 },
      threadId: 5,
    });
  });

  it('a finished row whose audit write failed (auditId null) → the fail-closed internal refusal, unaudited', async () => {
    store.readTableLaneRequest.mockResolvedValue(
      laneRow({ status: 'done', outcomeKind: 'refusal', auditId: null, finishedAt: new Date(Date.now() - 60_000) }),
    );
    store.readTableLaneNetCost.mockResolvedValue(0);
    const outcome = await pollTableLane(42);
    expect(outcome.status).toBe('done');
    if (outcome.status !== 'done' || outcome.gated.kind !== 'ok') throw new Error('expected done/ok');
    expect(outcome.gated.auditId).toBeNull();
    expect(outcome.gated.netCost).toBe(0);
    expect(outcome.gated.response.kind).toBe('refusal');
    expect(outcome.gated.response.kind === 'refusal' && outcome.gated.response.reason).toBe('internal');
    expect(outcome.threadId).toBeNull();
    expect(store.readTableLaneAuditResult).not.toHaveBeenCalled();
  });

  it('an audit row that cannot be read for this user → gone', async () => {
    store.readTableLaneRequest.mockResolvedValue(
      laneRow({ status: 'done', outcomeKind: 'answer', auditId: 11, finishedAt: new Date() }),
    );
    store.readTableLaneAuditResult.mockResolvedValue(null);
    expect(await pollTableLane(42)).toEqual({ status: 'gone' });
  });
});

describe('replyToTableLane', () => {
  // 14 members; a question shows the first 12 (BREAKDOWN_OPTION_CAP).
  const members = [
    { code: 'T001038', title: 'Totaal' },
    ...Array.from({ length: 11 }, (_, i) => ({ code: `L${i + 1}`, title: `Leeftijd ${i + 1}` })),
    { code: 'L90', title: '90 jaar of ouder' },
    { code: 'L99', title: 'Onbekend' },
    { code: 'D1', title: 'Dubbel' },
    { code: 'D2', title: 'dubbel' },
  ];
  const question = {
    dimension: 'Leeftijd',
    dimensionTitle: 'Leeftijd',
    options: members.slice(0, 12),
    totalOptions: members.length,
  };
  const clarificationEnvelope = { kind: 'clarification', question: 'q', text: 'Welke leeftijd?', tableLane: { rowId: 42, question } };
  const parent = laneRow({
    status: 'done',
    outcomeKind: 'clarification',
    auditId: 11,
    threadId: 5,
    previousQuestion: 'en vorig jaar?',
    choices: [{ dimension: 'Geslacht', code: '3000' }],
    finishedAt: new Date(),
  });

  beforeEach(() => {
    store.readTableLaneRequest.mockResolvedValue(parent);
    store.readTableLaneAuditResult.mockResolvedValue({ response: clarificationEnvelope, threadId: 5 });
    store.readTableLaneDimensionMembers.mockResolvedValue(members);
    store.createTableLaneRequest.mockResolvedValue({ kind: 'created', row: laneRow({ id: 43, parentId: 42 }) });
  });

  const expectChild = (code: string) =>
    expect(store.createTableLaneRequest).toHaveBeenCalledWith(fakeDb, {
      userId: 'user-1',
      requestId: RID2,
      threadId: 5,
      lang: 'nl',
      question: 'Hoeveel woningen?',
      tableId: '85000NED',
      finderConfidence: 0.91,
      parentId: 42,
      previousQuestion: 'en vorig jaar?',
      choices: [
        { dimension: 'Geslacht', code: '3000' },
        { dimension: 'Leeftijd', code },
      ],
    });

  it('a clicked code beyond the first 12 shown is accepted (ALL members count)', async () => {
    expect(await replyToTableLane(42, { code: 'L90' }, RID2)).toEqual({ kind: 'started', rowId: 43 });
    expectChild('L90');
    expect(store.readTableLaneDimensionMembers).toHaveBeenCalledWith(fakeDb, '85000NED', 'Leeftijd');
    expect(after).toHaveBeenCalledTimes(1);
    (after.mock.calls[0]![0] as () => void)();
    expect(kickTableLaneJob).toHaveBeenCalledTimes(1);
  });

  it('an exact typed title (any case/diacritics/whitespace) is matched', async () => {
    expect(await replyToTableLane(42, { text: '  90 JAAR of   ouder ' }, RID2)).toEqual({ kind: 'started', rowId: 43 });
    expectChild('L90');
  });

  it('a typed title shared by several members → no_match, free, nothing created', async () => {
    expect(await replyToTableLane(42, { text: 'Dubbel' }, RID2)).toEqual({ kind: 'no_match' });
    expect(store.createTableLaneRequest).not.toHaveBeenCalled();
    expect(after).not.toHaveBeenCalled();
  });

  it('unknown text → no_match, no debit (never a nearest match)', async () => {
    expect(await replyToTableLane(42, { text: '90 jaar' }, RID2)).toEqual({ kind: 'no_match' });
    expect(await replyToTableLane(42, { text: 'iets heel anders' }, RID2)).toEqual({ kind: 'no_match' });
    expect(store.createTableLaneRequest).not.toHaveBeenCalled();
  });

  it('a clicked code that is not a member → no_match', async () => {
    expect(await replyToTableLane(42, { code: 'NOPE' }, RID2)).toEqual({ kind: 'no_match' });
    expect(store.createTableLaneRequest).not.toHaveBeenCalled();
  });

  it('a malformed choice → no_match, nothing created', async () => {
    for (const bad of [null, {}, { code: 7 }, { text: ['x'] }, 'L90']) {
      expect(await replyToTableLane(42, bad as never, RID2)).toEqual({ kind: 'no_match' });
    }
    expect(store.createTableLaneRequest).not.toHaveBeenCalled();
  });

  it('an over-long typed reply is rejected before anything runs', async () => {
    await expect(replyToTableLane(42, { text: 'x'.repeat(2001) }, RID2)).rejects.toThrow(/input rejected/);
    expect(store.readTableLaneRequest).not.toHaveBeenCalled();
  });

  it("the audit row's thread wins over the row's own (the job wrote it)", async () => {
    store.readTableLaneAuditResult.mockResolvedValue({ response: clarificationEnvelope, threadId: 8 });
    await replyToTableLane(42, { code: 'L90' }, RID2);
    expect(store.createTableLaneRequest).toHaveBeenCalledWith(fakeDb, expect.objectContaining({ threadId: 8 }));
  });

  it('a missing/malformed request id gets a fresh server-side UUID', async () => {
    await replyToTableLane(42, { code: 'L90' }, 'not-a-uuid');
    const input = store.createTableLaneRequest.mock.calls[0]![1] as { requestId: string };
    expect(input.requestId).toMatch(UUID_RE);
    expect(input.requestId).not.toBe('not-a-uuid');
  });

  it('insufficient credits → insufficient_credits, no kick', async () => {
    store.createTableLaneRequest.mockResolvedValue({ kind: 'insufficient', balance: 3, required: 20 });
    expect(await replyToTableLane(42, { code: 'L90' }, RID2)).toEqual({
      kind: 'insufficient_credits',
      balance: 3,
      required: 20,
    });
    expect(after).not.toHaveBeenCalled();
  });

  it('a duplicate of this same reply (client retry) → started with the existing row', async () => {
    store.createTableLaneRequest.mockResolvedValue({ kind: 'duplicate', row: laneRow({ id: 43, parentId: 42 }) });
    expect(await replyToTableLane(42, { code: 'L90' }, RID2)).toEqual({ kind: 'started', rowId: 43 });
  });

  it('a request id already used for a DIFFERENT row → gone (no reuse across rows)', async () => {
    store.createTableLaneRequest.mockResolvedValue({ kind: 'duplicate', row: laneRow({ id: 50, parentId: 7 }) });
    expect(await replyToTableLane(42, { code: 'L90' }, RID2)).toEqual({ kind: 'gone' });
  });

  it('a row that is not an open clarification → gone, nothing created', async () => {
    const cases: Partial<TableLaneRow>[] = [
      { status: 'pending', outcomeKind: null },
      { status: 'running', outcomeKind: null },
      { status: 'done', outcomeKind: 'answer' },
      { status: 'done', outcomeKind: 'refusal' },
      { status: 'failed', outcomeKind: null },
      { status: 'done', outcomeKind: 'clarification', auditId: null },
    ];
    for (const c of cases) {
      store.readTableLaneRequest.mockResolvedValue({ ...parent, ...c });
      expect(await replyToTableLane(42, { code: 'L90' }, RID2)).toEqual({ kind: 'gone' });
    }
    expect(store.createTableLaneRequest).not.toHaveBeenCalled();
  });

  it('a clarification whose envelope carries no table-lane question → gone', async () => {
    store.readTableLaneAuditResult.mockResolvedValue({ response: { kind: 'clarification', tableLane: { rowId: 42, question: null } }, threadId: 5 });
    expect(await replyToTableLane(42, { code: 'L90' }, RID2)).toEqual({ kind: 'gone' });
    store.readTableLaneAuditResult.mockResolvedValue({ response: { kind: 'clarification' }, threadId: 5 });
    expect(await replyToTableLane(42, { code: 'L90' }, RID2)).toEqual({ kind: 'gone' });
    store.readTableLaneAuditResult.mockResolvedValue(null);
    expect(await replyToTableLane(42, { code: 'L90' }, RID2)).toEqual({ kind: 'gone' });
    expect(store.createTableLaneRequest).not.toHaveBeenCalled();
  });

  it("an unknown or another user's row → gone; unauthenticated → gone", async () => {
    store.readTableLaneRequest.mockResolvedValue(null);
    expect(await replyToTableLane(42, { code: 'L90' }, RID2)).toEqual({ kind: 'gone' });
    expect(store.readTableLaneRequest).toHaveBeenCalledWith(fakeDb, 42, 'user-1');
    currentUserId.mockResolvedValue(null);
    expect(await replyToTableLane(42, { code: 'L90' }, RID2)).toEqual({ kind: 'gone' });
    expect(await replyToTableLane(-3, { code: 'L90' }, RID2)).toEqual({ kind: 'gone' });
    expect(store.createTableLaneRequest).not.toHaveBeenCalled();
  });
});

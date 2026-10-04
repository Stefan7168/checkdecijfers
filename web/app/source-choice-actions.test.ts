// Owner decision 2026-10-04 (the Eurostat chip), at the server-action seam, hermetic:
//   - validateSelection accepts 'eurostat' ONLY while EUROSTAT_FINDER_ENABLED='1' (one gate with the chat
//     page's chip row: liveChatSourceKeys()).
//   - The table search follows the choice: every finder askQuestion builds (the term finder, the follow-up
//     wrapper's inner finder, the question finder) carries the reader's source set as its recall
//     restriction; the English search-word bridge exists only when Eurostat is selected (and its flag on).
//   - No selection (benchmark, tests, websearch off) leaves the finders exactly what they were.
//   - A table-lane follow-up link to a table of a deselected source is ignored.
// The store, billing gate, audited pipeline, threads and auth are stubbed at their boundaries (same preamble
// as table-lane-actions.test.ts). No CBS, no LLM, no db.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../backend/db/types.ts';
import type { GatedResponse } from '../backend/billing/index.ts';
import type { AuditedResponse } from '../backend/answer/audit/index.ts';
import type { ComposedResponse } from '../backend/answer/respond/types.ts';
import type { TableLaneRow } from '../backend/ingestion/table-lane-store.ts';

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

const onboarding = vi.hoisted(() => ({
  onboardingPrice: vi.fn(),
  triggerOnboarding: vi.fn(),
  sliceCacheTableIds: vi.fn(),
}));
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

const finderMod = vi.hoisted(() => ({ buildOnboardingFinder: vi.fn() }));
vi.mock('../backend/ingestion/onboarding-finder.ts', () => finderMod);

import { askQuestion } from './actions.ts';

const fakeDb = {} as Db;
const RID = '00000000-0000-4000-8000-000000000001';

type FinderDeps = {
  recall?: { mode?: string; sources?: Set<string> };
  englishSearchTermsClient?: unknown;
  searchTermsClient?: unknown;
};

beforeEach(() => {
  currentUserId.mockResolvedValue('user-1');
  getDb.mockReturnValue(fakeDb);
  getLang.mockResolvedValue('nl');
  billing.getActionClassPrice.mockResolvedValue(20);
  billing.getBalance.mockResolvedValue(100);
  threads.validateThreadOwnership.mockResolvedValue(3);
  threads.attachOrCreateThread.mockResolvedValue(3);
  onboarding.onboardingPrice.mockResolvedValue(100);
  onboarding.sliceCacheTableIds.mockResolvedValue(new Set());
  vi.stubEnv('WEBSEARCH_ENABLED', '1');
  vi.stubEnv('ONBOARDING_ENABLED', '1');
  vi.stubEnv('ONBOARDING_OFFER_SECRET', 'offer-secret');
  vi.stubEnv('TABLE_LANE_ENABLED', '1');
  vi.stubEnv('EUROSTAT_FINDER_ENABLED', '');
  // One distinct object per finder built, so the tests can tell which finder sits in which slot.
  finderMod.buildOnboardingFinder.mockImplementation(() => vi.fn());
  audit.answerQuestionAudited.mockImplementation(async (_db: Db, question: string) => {
    return { response: { kind: 'clarification', question, text: 'x' } as unknown as ComposedResponse, auditId: 11 } as AuditedResponse;
  });
  billing.chargeAndRun.mockImplementation(
    async (_db: Db, _uid: string, _rid: string, run: () => Promise<AuditedResponse>) =>
      ({ kind: 'ok', ...(await run()), netCost: 0 }) as GatedResponse,
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

function pipelineOptions(): { sourceSelection?: { sources: string[]; web: boolean }; tableFinder?: unknown; questionFinder?: unknown } {
  return audit.answerQuestionAudited.mock.calls[0]![2];
}

/** The deps each buildOnboardingFinder call received, in call order (term finder first, question finder second). */
function finderDeps(): FinderDeps[] {
  return finderMod.buildOnboardingFinder.mock.calls.map((call) => call[0] as FinderDeps);
}

const sel = (...sources: string[]) => ({ sources, web: false });

describe('validateSelection — one gate with the chip row (liveChatSourceKeys)', () => {
  it('flag off: eurostat is dropped, cbs stays', async () => {
    await askQuestion('q', RID, null, sel('cbs', 'eurostat'), 3);
    expect(pipelineOptions().sourceSelection).toEqual({ sources: ['cbs'], web: false });
  });

  it('flag on: eurostat is accepted, alone or with cbs', async () => {
    vi.stubEnv('EUROSTAT_FINDER_ENABLED', '1');
    await askQuestion('q', RID, null, sel('cbs', 'eurostat'), 3);
    expect(pipelineOptions().sourceSelection).toEqual({ sources: ['cbs', 'eurostat'], web: false });
    vi.clearAllMocks();
    await askQuestion('q', RID, null, sel('eurostat'), 3);
    expect(pipelineOptions().sourceSelection).toEqual({ sources: ['eurostat'], web: false });
  });

  it('flag on: unknown keys are still dropped', async () => {
    vi.stubEnv('EUROSTAT_FINDER_ENABLED', '1');
    await askQuestion('q', RID, null, sel('eurostat', 'wikipedia'), 3);
    expect(pipelineOptions().sourceSelection).toEqual({ sources: ['eurostat'], web: false });
  });

  it('websearch off: the whole selection is forced undefined, whatever it names', async () => {
    vi.stubEnv('WEBSEARCH_ENABLED', '0');
    vi.stubEnv('EUROSTAT_FINDER_ENABLED', '1');
    await askQuestion('q', RID, null, sel('eurostat'), 3);
    expect(pipelineOptions().sourceSelection).toBeUndefined();
  });
});

describe('the table search follows the reader\'s source choice', () => {
  it('no selection: the finders are exactly what they were (no source restriction anywhere)', async () => {
    vi.stubEnv('WEBSEARCH_ENABLED', '0');
    await askQuestion('q', RID, null, undefined, 3);
    const [termFinder, questionFinder] = finderDeps();
    expect(termFinder).not.toHaveProperty('recall');
    expect(questionFinder!.recall).toEqual({ mode: 'any' });
    expect(questionFinder!.englishSearchTermsClient).toBeUndefined(); // flag off
  });

  it('no selection + flag on: the bridge exists, still no source restriction', async () => {
    vi.stubEnv('WEBSEARCH_ENABLED', '0');
    vi.stubEnv('EUROSTAT_FINDER_ENABLED', '1');
    await askQuestion('q', RID, null, undefined, 3);
    const [termFinder, questionFinder] = finderDeps();
    expect(termFinder).not.toHaveProperty('recall');
    expect(questionFinder!.recall).toEqual({ mode: 'any' });
    expect(questionFinder!.englishSearchTermsClient).toBeDefined();
  });

  it('CBS only (flag on): both finders search CBS rows only; no English bridge', async () => {
    vi.stubEnv('EUROSTAT_FINDER_ENABLED', '1');
    await askQuestion('q', RID, null, sel('cbs'), 3);
    const [termFinder, questionFinder] = finderDeps();
    expect(termFinder!.recall).toEqual({ sources: new Set(['cbs']) });
    expect(questionFinder!.recall).toEqual({ mode: 'any', sources: new Set(['cbs']) });
    expect(questionFinder!.englishSearchTermsClient).toBeUndefined();
    expect(questionFinder!.searchTermsClient).toBeDefined(); // the Dutch retry is untouched
  });

  it('Eurostat only (flag on): both finders search Eurostat rows only; the English bridge stays on', async () => {
    vi.stubEnv('EUROSTAT_FINDER_ENABLED', '1');
    await askQuestion('q', RID, null, sel('eurostat'), 3);
    const [termFinder, questionFinder] = finderDeps();
    expect(termFinder!.recall).toEqual({ sources: new Set(['eurostat']) });
    expect(questionFinder!.recall).toEqual({ mode: 'any', sources: new Set(['eurostat']) });
    expect(questionFinder!.englishSearchTermsClient).toBeDefined();
  });

  it('both (flag on): both sources, bridge on', async () => {
    vi.stubEnv('EUROSTAT_FINDER_ENABLED', '1');
    await askQuestion('q', RID, null, sel('cbs', 'eurostat'), 3);
    const [termFinder, questionFinder] = finderDeps();
    expect(termFinder!.recall).toEqual({ sources: new Set(['cbs', 'eurostat']) });
    expect(questionFinder!.recall).toEqual({ mode: 'any', sources: new Set(['cbs', 'eurostat']) });
    expect(questionFinder!.englishSearchTermsClient).toBeDefined();
  });

  it('flag off + a (CBS-only) selection: CBS rows, no bridge — what the reader had before the chip', async () => {
    await askQuestion('q', RID, null, sel('cbs'), 3);
    const [, questionFinder] = finderDeps();
    expect(questionFinder!.recall).toEqual({ mode: 'any', sources: new Set(['cbs']) });
    expect(questionFinder!.englishSearchTermsClient).toBeUndefined();
  });
});

describe('the table-lane follow-up link and the source choice', () => {
  const PARENT = (tableId: string): TableLaneRow =>
    ({
      id: 50,
      userId: 'user-1',
      requestId: RID,
      threadId: 3,
      lang: 'nl',
      question: 'Wat was de werkloosheid in Frankrijk?',
      tableId,
      finderConfidence: 0.9,
      parentId: null,
      previousQuestion: null,
      isReply: false,
      routingAuditId: null,
      choices: [],
      status: 'done',
      attempts: 0,
      debitTransactionId: 1,
      auditId: 90,
      outcomeKind: 'answer',
      createdAt: new Date(),
      startedAt: null,
      finishedAt: null,
      failureSummary: null,
    }) as TableLaneRow;

  it('a link to a Eurostat table is ignored when Eurostat is deselected: the real finder sits in the slot, unwrapped', async () => {
    vi.stubEnv('EUROSTAT_FINDER_ENABLED', '1');
    store.readTableLaneRequest.mockResolvedValue(PARENT('eurostat:une_rt_m'));
    await askQuestion('En in Duitsland?', RID, null, sel('cbs'), 3, 50);
    expect(store.readTableLaneRequest).toHaveBeenCalled();
    const realFinder = finderMod.buildOnboardingFinder.mock.results[0]!.value;
    expect(pipelineOptions().tableFinder).toBe(realFinder);
  });

  it('a link to a CBS table is ignored when CBS is deselected', async () => {
    vi.stubEnv('EUROSTAT_FINDER_ENABLED', '1');
    store.readTableLaneRequest.mockResolvedValue(PARENT('84521NED'));
    await askQuestion('En in Duitsland?', RID, null, sel('eurostat'), 3, 50);
    const realFinder = finderMod.buildOnboardingFinder.mock.results[0]!.value;
    expect(pipelineOptions().tableFinder).toBe(realFinder);
  });

  it('a link to a selected source still wraps the finder as the fallback', async () => {
    vi.stubEnv('EUROSTAT_FINDER_ENABLED', '1');
    store.readTableLaneRequest.mockResolvedValue(PARENT('eurostat:une_rt_m'));
    await askQuestion('En in Duitsland?', RID, null, sel('cbs', 'eurostat'), 3, 50);
    const realFinder = finderMod.buildOnboardingFinder.mock.results[0]!.value;
    expect(pipelineOptions().tableFinder).toBeTypeOf('function');
    expect(pipelineOptions().tableFinder).not.toBe(realFinder);
    // The wrapper's inner finder carries the same source restriction.
    expect(finderDeps()[0]!.recall).toEqual({ sources: new Set(['cbs', 'eurostat']) });
  });

  it('no selection: the link is honoured exactly as before (a CBS parent wraps the finder)', async () => {
    vi.stubEnv('WEBSEARCH_ENABLED', '0');
    store.readTableLaneRequest.mockResolvedValue(PARENT('84521NED'));
    await askQuestion('En in Duitsland?', RID, null, undefined, 3, 50);
    const realFinder = finderMod.buildOnboardingFinder.mock.results[0]!.value;
    expect(pipelineOptions().tableFinder).not.toBe(realFinder);
    expect(finderDeps()[0]).not.toHaveProperty('recall');
  });
});

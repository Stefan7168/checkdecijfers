// WP16 sub-part 2 (ADR 026, design §2): the production TableFinder closure.
// Its only logic beyond the already-tested findTable is: a CONFIDENT pick →
// routing (with the per-user already-pending flag from findActiveRequest);
// anything else (disclose/none/throw) → null so the pipeline falls back to the
// byte-identical B15 clarification. Exercised with a stub rerank (the same
// injection findTable's own tests use) + the real FTS over the ingested
// catalog fixture. Hermetic PGlite.
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FixtureSource, loadCatalogFixture } from '../../src/cbs-adapter/fixture-source.ts';
import { ingestCatalog } from '../../src/catalog/ingest.ts';
import type { CatalogCandidate, RerankFn, RerankResult } from '../../src/catalog/types.ts';
import type { Db } from '../../src/db/types.ts';
import { reserveOnboardingDebit } from '../../src/billing/ledger.ts';
import { buildOnboardingFinder } from '../../src/ingestion/onboarding-finder.ts';
import { createPendingRequest } from '../../src/ingestion/onboarding-store.ts';
import { createTestDb } from '../helpers/pglite-db.ts';

const FIXTURES_DIR = fileURLToPath(new URL('../fixtures/cbs', import.meta.url));

/** Picks shortlist[0] with a given confidence (findTable's own test stub). */
function stubPickFirst(confidence: number): RerankFn {
  return (_topic: string, shortlist: CatalogCandidate[]): Promise<RerankResult> =>
    Promise.resolve({
      tableId: shortlist[0]!.tableId,
      confidence,
      reading: 'stub',
      alternativeIds: [],
    });
}

const CONFIDENT_TOPIC = 'huizenprijzen';

async function fundedUser(db: Db): Promise<string> {
  const userId = randomUUID();
  await db.query('update signup_grant_config set credits = 500');
  await db.query('select public.grant_signup_credits($1)', [userId]);
  return userId;
}

describe('buildOnboardingFinder — the production TableFinder closure (WP16 sub-part 2)', () => {
  let db: Db;
  let close: () => Promise<void>;

  beforeEach(async () => {
    ({ db, close } = await createTestDb());
    await ingestCatalog(db, new FixtureSource({}, loadCatalogFixture(FIXTURES_DIR)));
  });
  afterEach(async () => {
    await close();
  });

  it('confident pick → routing carrying the picked table + confidence, alreadyPending false', async () => {
    const finder = buildOnboardingFinder({ db, userId: randomUUID(), rerank: stubPickFirst(0.95) });
    const routing = await finder(CONFIDENT_TOPIC);
    expect(routing).not.toBeNull();
    expect(routing!.confidence).toBe(0.95);
    expect(routing!.tableId).toBeTruthy();
    expect(routing!.topicTerm).toBe(CONFIDENT_TOPIC);
    expect(routing!.alreadyPending).toBe(false);
  });

  it('below the confident floor → null (discloses in real UX, never onboards)', async () => {
    const finder = buildOnboardingFinder({ db, userId: randomUUID(), rerank: stubPickFirst(0.4) });
    expect(await finder(CONFIDENT_TOPIC)).toBeNull();
  });

  it('recall miss → null', async () => {
    const finder = buildOnboardingFinder({ db, userId: randomUUID(), rerank: stubPickFirst(0.95) });
    expect(await finder('volstrekt onbekend kwark xyzzy')).toBeNull();
  });

  it('a rerank throw → null (degrades to B15, never blocks the turn)', async () => {
    const finder = buildOnboardingFinder({
      db,
      userId: randomUUID(),
      rerank: () => Promise.reject(new Error('model exploded')),
    });
    // findTable itself catches the rerank throw and DISCLOSES → the finder maps
    // disclose to null. (Belt: even if findTable ever rethrew, the finder's own
    // try/catch returns null.)
    expect(await finder(CONFIDENT_TOPIC)).toBeNull();
  });

  it('an already-pending lookup throw → null (session-27 review: the catch covers the WHOLE finder)', async () => {
    // The exact pre-migration production shape: findTable succeeds against the
    // catalog, then findActiveRequest hits a missing pending_table_requests
    // relation. The finder's contract says ANY failure degrades to the plain
    // B15 clarification — money-safe because duplicate protection is
    // structural (unique index + debit dedup), never a double charge.
    const brokenDb: typeof db = {
      query: (text: string, params?: unknown[]) =>
        text.includes('pending_table_requests')
          ? Promise.reject(new Error('relation "pending_table_requests" does not exist'))
          : db.query(text, params),
      withTransaction: (fn) => db.withTransaction(fn),
    };
    const finder = buildOnboardingFinder({
      db: brokenDb,
      userId: randomUUID(),
      rerank: stubPickFirst(0.95),
    });
    expect(await finder(CONFIDENT_TOPIC)).toBeNull();
  });

  it('an active job for this (user, table) → alreadyPending true (no second fetch)', async () => {
    const userId = await fundedUser(db);
    // First, resolve the confident pick so we know the table id to pre-queue.
    const probe = await buildOnboardingFinder({ db, userId, rerank: stubPickFirst(0.95) })(CONFIDENT_TOPIC);
    expect(probe).not.toBeNull();
    const requestId = randomUUID();
    const debit = await reserveOnboardingDebit(db, userId, requestId, 100);
    if (debit.kind !== 'debited') throw new Error('setup debit failed');
    await createPendingRequest(db, {
      userId,
      requestId,
      questionText: 'q',
      topicTerm: CONFIDENT_TOPIC,
      tableId: probe!.tableId,
      finderConfidence: 0.95,
      debitTransactionId: debit.entry.id,
    });
    // Now the SAME user asking again sees alreadyPending.
    const finder = buildOnboardingFinder({ db, userId, rerank: stubPickFirst(0.95) });
    const routing = await finder(CONFIDENT_TOPIC);
    expect(routing).not.toBeNull();
    expect(routing!.alreadyPending).toBe(true);
  });

  it('a DIFFERENT user with no active job → alreadyPending false (per-user, not global)', async () => {
    const userA = await fundedUser(db);
    const probe = await buildOnboardingFinder({ db, userId: userA, rerank: stubPickFirst(0.95) })(CONFIDENT_TOPIC);
    const requestId = randomUUID();
    const debit = await reserveOnboardingDebit(db, userA, requestId, 100);
    if (debit.kind !== 'debited') throw new Error('setup debit failed');
    await createPendingRequest(db, {
      userId: userA,
      requestId,
      questionText: 'q',
      topicTerm: CONFIDENT_TOPIC,
      tableId: probe!.tableId,
      finderConfidence: 0.95,
      debitTransactionId: debit.entry.id,
    });
    const userB = randomUUID();
    const routing = await buildOnboardingFinder({ db, userId: userB, rerank: stubPickFirst(0.95) })(CONFIDENT_TOPIC);
    expect(routing!.alreadyPending).toBe(false);
  });
});

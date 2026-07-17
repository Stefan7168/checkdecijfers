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
import type { CatalogCandidate, FindTableQuery, RerankFn, RerankResult } from '../../src/catalog/types.ts';
import type { Db } from '../../src/db/types.ts';
import { reserveOnboardingDebit } from '../../src/billing/ledger.ts';
import { buildOnboardingFinder } from '../../src/ingestion/onboarding-finder.ts';
import { createPendingRequest } from '../../src/ingestion/onboarding-store.ts';
import { createTestDb } from '../helpers/pglite-db.ts';

const FIXTURES_DIR = fileURLToPath(new URL('../fixtures/cbs', import.meta.url));

/** Picks shortlist[0] with a given confidence (findTable's own test stub). */
function stubPickFirst(confidence: number): RerankFn {
  return (_query: FindTableQuery, shortlist: CatalogCandidate[]): Promise<RerankResult> =>
    Promise.resolve({
      tableId: shortlist[0]!.tableId,
      confidence,
      reading: 'stub',
      alternativeIds: [],
    });
}

const CONFIDENT_TOPIC = 'huizenprijzen';
const QUESTION = 'Hoe duur zijn koopwoningen op dit moment?';

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
    const routing = await finder(CONFIDENT_TOPIC, QUESTION);
    expect(routing).not.toBeNull();
    expect(routing!.confidence).toBe(0.95);
    expect(routing!.tableId).toBeTruthy();
    expect(routing!.topicTerm).toBe(CONFIDENT_TOPIC);
    expect(routing!.alreadyPending).toBe(false);
    // WP27 stage B: no alternatives from the rerank → the chain is exactly
    // the pick (never empty on a confident routing).
    expect(routing!.candidateIds).toEqual([routing!.tableId]);
  });

  it('WP27 stage B: constructs the candidate chain — pick first, then sanitized alternatives, cap 3', async () => {
    // THE constructing link (PR-#17 review): candidateIds is BUILT here, not
    // carried — [pick, ...alternativeIds].slice(0, 3). The stub hands back
    // every other shortlist id as an alternative so the cap must bind.
    let seenShortlist: CatalogCandidate[] = [];
    const stubWithAlternatives: RerankFn = (_query, shortlist) => {
      seenShortlist = shortlist;
      return Promise.resolve({
        tableId: shortlist[0]!.tableId,
        confidence: 0.95,
        reading: 'stub',
        alternativeIds: shortlist.slice(1).map((c) => c.tableId),
      });
    };
    const finder = buildOnboardingFinder({ db, userId: randomUUID(), rerank: stubWithAlternatives });
    const routing = await finder(CONFIDENT_TOPIC, QUESTION);
    expect(routing).not.toBeNull();
    // Guard: the fixture must offer enough candidates for the cap to bind —
    // if this fails the catalog fixture shrank, not the finder.
    expect(seenShortlist.length).toBeGreaterThanOrEqual(4);
    expect(routing!.candidateIds).toEqual(seenShortlist.slice(0, 3).map((c) => c.tableId));
    expect(routing!.candidateIds[0]).toBe(routing!.tableId);
    expect(routing!.candidateIds).toHaveLength(3);
  });

  it('threads the FULL question into the rerank query (WP27 stage A, ADR 027 D3a)', async () => {
    let seen: FindTableQuery | null = null;
    const capturing: RerankFn = (query, shortlist) => {
      seen = query;
      return stubPickFirst(0.95)(query, shortlist);
    };
    await buildOnboardingFinder({ db, userId: randomUUID(), rerank: capturing })(CONFIDENT_TOPIC, QUESTION);
    expect(seen).toEqual({ topic: CONFIDENT_TOPIC, question: QUESTION });
  });

  it('below the confident floor → null (discloses in real UX, never onboards)', async () => {
    const finder = buildOnboardingFinder({ db, userId: randomUUID(), rerank: stubPickFirst(0.4) });
    expect(await finder(CONFIDENT_TOPIC, QUESTION)).toBeNull();
  });

  it('recall miss → null', async () => {
    const finder = buildOnboardingFinder({ db, userId: randomUUID(), rerank: stubPickFirst(0.95) });
    expect(await finder('volstrekt onbekend kwark xyzzy', 'Wat is kwark xyzzy?')).toBeNull();
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
    expect(await finder(CONFIDENT_TOPIC, QUESTION)).toBeNull();
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
    expect(await finder(CONFIDENT_TOPIC, QUESTION)).toBeNull();
  });

  it('an active job for this (user, table) → alreadyPending true (no second fetch)', async () => {
    const userId = await fundedUser(db);
    // First, resolve the confident pick so we know the table id to pre-queue.
    const probe = await buildOnboardingFinder({ db, userId, rerank: stubPickFirst(0.95) })(CONFIDENT_TOPIC, QUESTION);
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
      candidateIds: [],
      debitTransactionId: debit.entry.id,
    });
    // Now the SAME user asking again sees alreadyPending.
    const finder = buildOnboardingFinder({ db, userId, rerank: stubPickFirst(0.95) });
    const routing = await finder(CONFIDENT_TOPIC, QUESTION);
    expect(routing).not.toBeNull();
    expect(routing!.alreadyPending).toBe(true);
  });

  it('a DIFFERENT user with no active job → alreadyPending false (per-user, not global)', async () => {
    const userA = await fundedUser(db);
    const probe = await buildOnboardingFinder({ db, userId: userA, rerank: stubPickFirst(0.95) })(CONFIDENT_TOPIC, QUESTION);
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
      candidateIds: [],
      debitTransactionId: debit.entry.id,
    });
    const userB = randomUUID();
    const routing = await buildOnboardingFinder({ db, userId: userB, rerank: stubPickFirst(0.95) })(CONFIDENT_TOPIC, QUESTION);
    expect(routing!.alreadyPending).toBe(false);
  });
});

describe('#166 — the pre-charge already-ingested guard', () => {
  let db: Db;
  let close: () => Promise<void>;

  beforeEach(async () => {
    ({ db, close } = await createTestDb());
    await ingestCatalog(db, new FixtureSource({}, loadCatalogFixture(FIXTURES_DIR)));
  });
  afterEach(async () => {
    await close();
  });

  async function fakeTableRow(tableId: string, synced: boolean): Promise<void> {
    await db.query(
      `insert into cbs_tables (id, title, expected_dimensions, units, update_cadence, last_sync_at)
       values ($1, $2, '[]'::jsonb, '{}'::jsonb, 'test', $3)`,
      [tableId, `fake row for #166 test (${tableId})`, synced ? new Date().toISOString() : null],
    );
  }

  it('a confident pick on an already-ingested table → null (falls back to B15, no charge path)', async () => {
    const finder = buildOnboardingFinder({ db, userId: randomUUID(), rerank: stubPickFirst(0.95) });
    // Learn which table this catalog+stub combination picks, then make that
    // exact table "already held" (registered active + synced — the job's own
    // alreadyIngested predicate, shared since #166).
    const routing = await finder(CONFIDENT_TOPIC, QUESTION);
    expect(routing).not.toBeNull();
    await fakeTableRow(routing!.tableId, true);

    expect(await finder(CONFIDENT_TOPIC, QUESTION)).toBeNull();
  });

  it('registered but never synced (last_sync_at null) → still routes: the guard keys on held DATA, not registration', async () => {
    const finder = buildOnboardingFinder({ db, userId: randomUUID(), rerank: stubPickFirst(0.95) });
    const routing = await finder(CONFIDENT_TOPIC, QUESTION);
    expect(routing).not.toBeNull();
    await fakeTableRow(routing!.tableId, false);

    const again = await finder(CONFIDENT_TOPIC, QUESTION);
    expect(again).not.toBeNull();
    expect(again!.tableId).toBe(routing!.tableId);
  });

  it("post-sync window: the user's OWN active fetch outranks the held-table guard — alreadyPending, never a misleading B15 (session-50 follow-up)", async () => {
    const userId = await fundedUser(db);
    const probe = await buildOnboardingFinder({ db, userId, rerank: stubPickFirst(0.95) })(CONFIDENT_TOPIC, QUESTION);
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
      candidateIds: [],
      debitTransactionId: debit.entry.id,
    });
    // The job's Step 5 committed the sync (last_sync_at set) but the row has
    // not finalized yet — the exact window the active-check-first order covers.
    await fakeTableRow(probe!.tableId, true);

    const routing = await buildOnboardingFinder({ db, userId, rerank: stubPickFirst(0.95) })(CONFIDENT_TOPIC, QUESTION);
    expect(routing).not.toBeNull();
    expect(routing!.alreadyPending).toBe(true);

    // A DIFFERENT user (no active fetch) still hits the guard → null (B15).
    expect(
      await buildOnboardingFinder({ db, userId: randomUUID(), rerank: stubPickFirst(0.95) })(CONFIDENT_TOPIC, QUESTION),
    ).toBeNull();
  });

  it('an already-ingested ALTERNATE is screened out of the candidate chain (second leg, session-50 review: the fit gate resolves over the whole chain, so a held alternate would let a charged job deliver from data we already hold)', async () => {
    const stubWithAlternatives: RerankFn = (_query, shortlist) =>
      Promise.resolve({
        tableId: shortlist[0]!.tableId,
        confidence: 0.95,
        reading: 'stub',
        alternativeIds: shortlist.slice(1).map((c) => c.tableId),
      });
    const finder = buildOnboardingFinder({ db, userId: randomUUID(), rerank: stubWithAlternatives });
    const before = await finder(CONFIDENT_TOPIC, QUESTION);
    expect(before).not.toBeNull();
    expect(before!.candidateIds).toHaveLength(3);
    const heldAlternate = before!.candidateIds[1]!;
    await fakeTableRow(heldAlternate, true);

    const after = await finder(CONFIDENT_TOPIC, QUESTION);
    expect(after).not.toBeNull();
    expect(after!.candidateIds).not.toContain(heldAlternate);
    // Pick unchanged in front, and the chain RE-FILLS from the remaining
    // alternates — the screen runs before the cap, so a held alternate costs
    // no chain depth (a filter-after-cap implementation would yield 2 here;
    // the >=4-candidate shortlist is guarded by the WP27 stage-B test above).
    expect(after!.candidateIds[0]).toBe(before!.candidateIds[0]);
    expect(after!.candidateIds).toHaveLength(3);
  });
});

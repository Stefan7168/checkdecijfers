// On-demand table eviction (#110 b/c, migration 025) — hermetic (PGlite).
//
// What must hold (src/ingestion/eviction.ts has the design):
//  - the ⟨F2⟩ discipline: the dry run lists EXACTLY what --apply would evict
//    (same fragment), and a dry run writes nothing;
//  - scope: pinned tables, fresh tables and tables with an ACTIVE onboarding
//    job are exempt; staleness anchors on coalesce(last_queried_at, created_at);
//  - eviction removes ALL five artifact classes (cells, labels, vocabulary,
//    batches, registration row) and is idempotent;
//  - eviction NEVER touches audit_answers / credit_transactions /
//    pending_table_requests — a delivered answer from an evicted table still
//    reconstructs from its stored record alone (R8), byte-for-byte;
//  - an evicted table is indistinguishable from never-onboarded: the
//    `alreadyIngestedSet` predicate no longer matches and registerTables
//    performs a FULL fresh registration again (the re-onboarding trace);
//  - migration 025's hardcoded pinned-id snapshot cannot drift from
//    SEED_TABLES, and its UPDATEs behave on a pre-025 database.
//
// The end-to-end half onboards 82235NED through the REAL job (FixtureSource +
// stub LLMs — the onboarding-job.test.ts harness, replicated minimally) so the
// evicted state is a genuinely delivered on-demand table, not a hand-mock.
import { readFileSync, cpSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { FixtureSource, loadFixtureDocs } from '../../src/cbs-adapter/fixture-source.ts';
import type { CbsSource } from '../../src/cbs-adapter/types.ts';
import { getBalance, reserveOnboardingDebit } from '../../src/billing/ledger.ts';
import { applyPricingDefaults } from '../../src/billing/pricing-apply.ts';
import type { LlmClient, LlmResponse } from '../../src/answer/llm/client.ts';
import type { RawParse } from '../../src/answer/intent/types.ts';
import { loadAuditRecord, reconstructionReport } from '../../src/answer/audit/index.ts';
import { createPendingRequest, getPendingRequest } from '../../src/ingestion/onboarding-store.ts';
import { onboardedKey } from '../../src/ingestion/onboarding-vocab.ts';
import { registerTables } from '../../src/ingestion/pipeline.ts';
import { alreadyIngested, runOnboardingJob, type OnboardingJobDeps } from '../../src/ingestion/onboarding.ts';
import { SEED_TABLES } from '../../src/ingestion/registry-seed.ts';
import {
  ON_DEMAND_TTL_DAYS,
  evictionCutoff,
  listEvictableTables,
  runTableEviction,
} from '../../src/ingestion/eviction.ts';
import { MIGRATIONS_DIR, applyMigrations } from '../../src/db/migrate.ts';
import type { Db } from '../../src/db/types.ts';
import { createTestDb, wrapPGlite } from '../helpers/pglite-db.ts';
import { createIngestedDb } from '../helpers/ingested-db.ts';

const FIXTURES = fileURLToPath(new URL('../fixtures/cbs', import.meta.url));

// Same fixture family as onboarding-job.test.ts: 82235NED (housing stock),
// measure D002936, 2024JJ00 = 8204 in the committed fixture.
const TABLE = '82235NED';
const MEASURE = 'D002936';

const DAY_MS = 24 * 60 * 60 * 1000;
function daysAgo(days: number): string {
  return new Date(Date.now() - days * DAY_MS).toISOString();
}
function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * DAY_MS);
}

/** Inserts a synthetic registered table with one row in each artifact class —
 * enough shape for the eviction mechanics; the end-to-end suite below uses the
 * real pipeline instead. */
async function insertOnboardedTable(
  db: Db,
  id: string,
  opts: { pinned?: boolean; lastQueriedAt?: string | null; createdAt?: string } = {},
): Promise<void> {
  await db.query(
    `insert into cbs_tables (id, title, expected_dimensions, pinned, last_queried_at, created_at)
     values ($1, $2, '[]'::jsonb, $3, $4, coalesce($5::timestamptz, now()))`,
    [id, `Testtabel ${id}`, opts.pinned ?? false, opts.lastQueriedAt ?? null, opts.createdAt ?? null],
  );
  const batch = await db.query(
    `insert into ingestion_batches (table_id, outcome) values ($1, 'succeeded') returning id`,
    [id],
  );
  await db.query(
    `insert into observations (table_id, measure, period_code, period_grain, period_year, value, unit, status, batch_id)
     values ($1, 'M1', '2024JJ00', 'JJ', 2024, 42, 'aantal', 'Definitief', $2)`,
    [id, batch.rows[0]!.id],
  );
  await db.query(
    `insert into dimension_labels (table_id, dimension, code, label)
     values ($1, 'Perioden', '2024JJ00', '2024')`,
    [id],
  );
  await db.query(
    `insert into canonical_measures (key, table_id, measure, measure_title, definition_label, everyday_terms)
     values ($1, $2, 'M1', 'Testmaat', 'testmaat', '{}')`,
    [onboardedKey(id, 'M1'), id],
  );
}

async function artifactCounts(db: Db, id: string) {
  const one = async (sql: string) => Number((await db.query(sql, [id])).rows[0]!.n);
  return {
    tables: await one('select count(*)::int as n from cbs_tables where id = $1'),
    observations: await one('select count(*)::int as n from observations where table_id = $1'),
    labels: await one('select count(*)::int as n from dimension_labels where table_id = $1'),
    vocab: await one('select count(*)::int as n from canonical_measures where table_id = $1'),
    batches: await one('select count(*)::int as n from ingestion_batches where table_id = $1'),
  };
}

const FULL = { tables: 1, observations: 1, labels: 1, vocab: 1, batches: 1 };
const GONE = { tables: 0, observations: 0, labels: 0, vocab: 0, batches: 0 };

describe('table eviction — scope and mechanics (synthetic tables)', () => {
  it('dry run lists exactly the stale unpinned tables and writes nothing', async () => {
    const { db, close } = await createTestDb();
    try {
      await insertOnboardedTable(db, 'STALE01', { lastQueriedAt: daysAgo(ON_DEMAND_TTL_DAYS + 5) });
      await insertOnboardedTable(db, 'FRESH01', { lastQueriedAt: daysAgo(2) });
      await insertOnboardedTable(db, 'PINNED1', {
        pinned: true,
        lastQueriedAt: daysAgo(ON_DEMAND_TTL_DAYS + 5),
      });

      const summary = await runTableEviction({ db, now: new Date(), apply: false });
      expect(summary.mode).toBe('dry-run');
      expect(summary.tables.map((t) => t.id)).toEqual(['STALE01']);
      expect(summary.tables[0]).toMatchObject({
        observations: 1,
        dimensionLabels: 1,
        canonicalMeasures: 1,
        ingestionBatches: 1,
      });

      // A dry run changes NOTHING — every artifact of every table survives.
      for (const id of ['STALE01', 'FRESH01', 'PINNED1']) {
        expect(await artifactCounts(db, id)).toEqual(FULL);
      }
    } finally {
      await close();
    }
  });

  it('a never-queried table anchors on created_at (failed-onboarding debris ages out)', async () => {
    const { db, close } = await createTestDb();
    try {
      await insertOnboardedTable(db, 'OLDNULL1', {
        lastQueriedAt: null,
        createdAt: daysAgo(ON_DEMAND_TTL_DAYS + 10),
      });
      await insertOnboardedTable(db, 'NEWNULL1', { lastQueriedAt: null, createdAt: daysAgo(3) });

      const reports = await listEvictableTables(db, evictionCutoff(new Date()));
      expect(reports.map((t) => t.id)).toEqual(['OLDNULL1']);
    } finally {
      await close();
    }
  });

  it('an ACTIVE onboarding job blocks eviction of its table', async () => {
    const { db, close } = await createTestDb();
    try {
      await applyPricingDefaults(db);
      await insertOnboardedTable(db, 'BUSY0001', { lastQueriedAt: daysAgo(ON_DEMAND_TTL_DAYS + 5) });

      // A real pending row through the store (status 'pending' = active).
      const userId = randomUUID();
      await db.query('update signup_grant_config set credits = 150');
      await db.query('select public.grant_signup_credits($1)', [userId]);
      const debit = await reserveOnboardingDebit(db, userId, randomUUID(), 100);
      if (debit.kind !== 'debited') throw new Error(`setup: ${debit.kind}`);
      await createPendingRequest(db, {
        userId,
        requestId: randomUUID(),
        questionText: 'vraag',
        topicTerm: 'onderwerp',
        tableId: 'BUSY0001',
        finderConfidence: 0.9,
        candidateIds: [],
        debitTransactionId: debit.entry.id,
      });

      const summary = await runTableEviction({ db, now: new Date(), apply: true });
      expect(summary.tables).toEqual([]);
      expect(await artifactCounts(db, 'BUSY0001')).toEqual(FULL);
    } finally {
      await close();
    }
  });

  it('apply evicts exactly the dry-run set (⟨F2⟩), removes all artifact classes, and is idempotent', async () => {
    const { db, close } = await createTestDb();
    try {
      await insertOnboardedTable(db, 'STALE01', { lastQueriedAt: daysAgo(ON_DEMAND_TTL_DAYS + 5) });
      await insertOnboardedTable(db, 'STALE02', { lastQueriedAt: daysAgo(ON_DEMAND_TTL_DAYS + 90) });
      await insertOnboardedTable(db, 'FRESH01', { lastQueriedAt: daysAgo(1) });

      const now = new Date();
      const preview = await runTableEviction({ db, now, apply: false });
      const applied = await runTableEviction({ db, now, apply: true });

      // Preview and apply agree — same ids, same per-table artifact counts.
      expect(applied.tables).toEqual(preview.tables);
      expect(applied.tables.map((t) => t.id)).toEqual(['STALE01', 'STALE02']);

      expect(await artifactCounts(db, 'STALE01')).toEqual(GONE);
      expect(await artifactCounts(db, 'STALE02')).toEqual(GONE);
      expect(await artifactCounts(db, 'FRESH01')).toEqual(FULL);

      // Idempotent: a second run against the same state finds nothing new.
      const again = await runTableEviction({ db, now, apply: true });
      expect(again.tables).toEqual([]);
    } finally {
      await close();
    }
  });

  it("migration 025's pinned-id snapshot matches SEED_TABLES exactly", () => {
    const sql = readFileSync(join(MIGRATIONS_DIR, '025_table_eviction_lifecycle.sql'), 'utf8');
    const block = sql.match(/set pinned = true where id in \(([\s\S]*?)\)/)?.[1] ?? '';
    const ids = [...block.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    // Exact set AND exact count (a duplicate id would pass a set-only check).
    expect([...ids].sort()).toEqual(SEED_TABLES.map((t) => t.id).sort());
  });

  it('migration 025 pins pre-existing seed rows and starts every pre-existing TTL clock at migration time', async () => {
    // A database as it existed BEFORE 025: apply migrations 001–021 from a
    // filtered copy, register rows the pre-025 way (no lifecycle columns),
    // then let the real migrations directory apply just 025.
    const partial = mkdtempSync(join(tmpdir(), 'evict-migration-'));
    const client = new PGlite();
    try {
      for (const file of readdirSync(MIGRATIONS_DIR)) {
        if (/^\d{3}_.+\.sql$/.test(file) && Number(file.slice(0, 3)) <= 21) {
          cpSync(join(MIGRATIONS_DIR, file), join(partial, file));
        }
      }
      const db = wrapPGlite(client);
      await applyMigrations(db, partial);
      await db.query(
        `insert into cbs_tables (id, title, expected_dimensions) values
           ('82235NED', 'Woningvoorraad', '[]'::jsonb),
           ('99999XXX', 'On-demand tabel', '[]'::jsonb)`,
      );

      await applyMigrations(db); // applies exactly 025

      const { rows } = await db.query(
        'select id, pinned, last_queried_at from cbs_tables order by id',
      );
      const byId = new Map(rows.map((r) => [r.id as string, r]));
      expect(byId.get('82235NED')!.pinned).toBe(true); // seed id → pinned
      expect(byId.get('99999XXX')!.pinned).toBe(false); // on-demand → not
      // Both clocks start at migration time — never evict on unknowable
      // pre-migration query history (principle c applied to lifecycle).
      expect(byId.get('82235NED')!.last_queried_at).not.toBeNull();
      expect(byId.get('99999XXX')!.last_queried_at).not.toBeNull();
    } finally {
      await client.close();
      rmSync(partial, { recursive: true, force: true });
    }
  });
});

describe('table eviction — the full seed set is exempt', () => {
  it('finds zero candidates on the fully-ingested seed database, even far in the future', async () => {
    const { db, close } = await createIngestedDb();
    try {
      const { rows } = await db.query(
        'select count(*)::int as n from cbs_tables where pinned = false',
      );
      expect(Number(rows[0]!.n)).toBe(0); // every seed registration is pinned

      const summary = await runTableEviction({
        db,
        now: daysFromNow(3650),
        apply: false,
      });
      expect(summary.tables).toEqual([]);
    } finally {
      await close();
    }
  });
});

// ---------------------------------------------------------------------------
// End-to-end: a REAL delivered on-demand table, evicted, still auditable,
// re-onboardable. Harness replicated minimally from onboarding-job.test.ts.
// ---------------------------------------------------------------------------

function fixtureSource(): CbsSource {
  return new FixtureSource(loadFixtureDocs(`${FIXTURES}/${TABLE}`));
}

function intentStub(year: number): LlmClient {
  const raw: RawParse = {
    version: 3,
    kind: 'data_query',
    candidates: [
      {
        canonicalKey: onboardedKey(TABLE, MEASURE),
        regions: null,
        period: { kind: 'year', year },
        derivation: 'none',
        confidence: 0.97,
        reading: `onboarded measure for ${year}`,
      } as never,
    ],
    unmatchedMeasureTerm: null,
    nearestCanonicalKeys: [],
    note: null,
  };
  return {
    async complete(): Promise<LlmResponse> {
      return {
        outputText: JSON.stringify(raw),
        model: 'stub-intent',
        stopReason: 'end_turn',
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    },
  };
}

function throwingAnswerClient(): LlmClient {
  return {
    async complete(): Promise<LlmResponse> {
      throw new Error('stub answer client: force template fallback');
    },
  };
}

describe('table eviction — end-to-end over a delivered on-demand table', () => {
  it('evicts a delivered table without touching audit/ledger/pending; R8 reconstructs; re-onboarding is a fresh registration', async () => {
    const { db, close } = await createTestDb();
    try {
      await applyPricingDefaults(db);
      const userId = randomUUID();
      await db.query('update signup_grant_config set credits = 150');
      await db.query('select public.grant_signup_credits($1)', [userId]);
      const debit = await reserveOnboardingDebit(db, userId, randomUUID(), 100);
      if (debit.kind !== 'debited') throw new Error(`setup: ${debit.kind}`);
      const pending = await createPendingRequest(db, {
        userId,
        requestId: randomUUID(),
        questionText: 'hoeveel woningen waren er in 2024',
        topicTerm: 'woningvoorraad',
        tableId: TABLE,
        finderConfidence: 0.9,
        candidateIds: [],
        debitTransactionId: debit.entry.id,
      });

      const deps: OnboardingJobDeps = {
        db,
        source: fixtureSource(),
        intentClient: intentStub(2024),
        answerClient: throwingAnswerClient(),
        notify: async () => {},
        referenceDate: '2026-07-06',
      };
      const jobSummary = await runOnboardingJob(deps);
      expect(jobSummary.processed).toMatchObject({ outcome: 'delivered' });

      const row = await getPendingRequest(db, pending.id);
      const auditId = row!.deliveryAuditAnswerId!;
      expect(auditId).not.toBeNull();

      // The delivery itself queried the table — the runQuery bump (#110 b)
      // recorded it, which is exactly what anchors this table's TTL clock.
      const bumped = await db.query('select last_queried_at from cbs_tables where id = $1', [
        TABLE,
      ]);
      expect(bumped.rows[0]!.last_queried_at).not.toBeNull();

      // The stored delivered answer reconstructs BEFORE eviction…
      const recordBefore = await loadAuditRecord(db, auditId);
      expect(reconstructionReport(recordBefore!).ok).toBe(true);

      // Snapshot everything eviction must never write.
      const auditBefore = (await db.query('select * from audit_answers order by id')).rows;
      const ledgerBefore = (await db.query('select * from credit_transactions order by id')).rows;
      const pendingBefore = (await db.query('select * from pending_table_requests order by id')).rows;

      // 40 days later, nobody asked again → evict.
      const summary = await runTableEviction({ db, now: daysFromNow(40), apply: true });
      expect(summary.tables.map((t) => t.id)).toEqual([TABLE]);
      expect(summary.tables[0]!.observations).toBeGreaterThan(0);
      expect(await artifactCounts(db, TABLE)).toEqual(GONE);

      // audit / ledger / pending rows byte-identical — eviction wrote nowhere
      // near them (the GDPR-purge non-interference discipline, applied here).
      expect((await db.query('select * from audit_answers order by id')).rows).toEqual(auditBefore);
      expect((await db.query('select * from credit_transactions order by id')).rows).toEqual(
        ledgerBefore,
      );
      expect((await db.query('select * from pending_table_requests order by id')).rows).toEqual(
        pendingBefore,
      );
      expect(await getBalance(db, userId)).toBe(50); // net −100 kept, no refund invented

      // …and AFTER eviction the same stored row still reconstructs, from the
      // record alone (R8: "no database" — the eviction guarantee in one line).
      const recordAfter = await loadAuditRecord(db, auditId);
      expect(reconstructionReport(recordAfter!).ok).toBe(true);

      // Re-onboarding trace: the shared "we already hold this data" predicate
      // says NO (→ a new question re-triggers the normal 100-credit flow), and
      // registration is a FULL fresh insert again — labels included, unpinned.
      expect(await alreadyIngested(db, TABLE)).toBe(false);
      const registered = await registerTables(db, fixtureSource(), [
        { id: TABLE, updateCadence: 'on-demand', servesTasks: [] },
      ]);
      expect(registered).toEqual([TABLE]);
      const fresh = await db.query(
        'select pinned, last_queried_at from cbs_tables where id = $1',
        [TABLE],
      );
      expect(fresh.rows[0]!.pinned).toBe(false);
      expect(fresh.rows[0]!.last_queried_at).toBeNull(); // a brand-new clock
      const labels = await db.query(
        'select count(*)::int as n from dimension_labels where table_id = $1',
        [TABLE],
      );
      expect(Number(labels.rows[0]!.n)).toBeGreaterThan(0);
    } finally {
      await close();
    }
  }, 30_000);
});

// Breadth step 5, Task 4 — runTableLaneJob (src/ingestion/table-lane-job.ts):
// the background job behind the table lane. Per claimed row: register the
// table's layout, plan, ensure the slice (outside any shared lock), respond +
// audit, attach to the thread, settle the money — plus the give-up, stale
// reclaim, exhausted-row and budget paths.
//
// Hermetic: PGlite, committed CBS fixtures served through FixtureSource (and
// a small in-memory source over a step-4 schema fixture), scripted stub LLM
// clients — no real LLM, no real CBS, no live DB.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuditedRespondOptions } from '../../src/answer/audit/respond-audited.ts';
import type { LlmClient, LlmRequest, LlmResponse } from '../../src/answer/llm/client.ts';
import type { TableLaneTable } from '../../src/answer/table-lane/types.ts';
import { applyPricingDefaults } from '../../src/billing/pricing-apply.ts';
import { getBalance } from '../../src/billing/ledger.ts';
import type {
  CbsCatalogEntry,
  CbsCode,
  CbsObservationRow,
  CbsSlice,
  CbsSource,
  CbsTableSchema,
} from '../../src/cbs-adapter/types.ts';
import type { Db, QueryResultRow } from '../../src/db/types.ts';
import { runTableLaneJob, type TableLaneJobDeps } from '../../src/ingestion/table-lane-job.ts';
import {
  createTableLaneRequest,
  readTableLaneRequest,
  TABLE_LANE_MAX_ATTEMPTS,
  TABLE_LANE_STALE_MS,
  type TableLaneRow,
} from '../../src/ingestion/table-lane-store.ts';
import { createTestDb } from '../helpers/pglite-db.ts';
import { resetTestDb } from '../helpers/reset-db.ts';
import {
  LANE_MEASURE,
  LANE_QUESTION,
  LANE_TABLE,
  ThrowingAnswerClient,
  laneSource,
  laneTable,
  parseOutput,
} from '../helpers/table-lane-fixture.ts';

// One shared event log: the spied db's statements (+ transaction brackets),
// the spied source's calls, and ensureSlice's start/end (module spy below).
type Event =
  | { type: 'sql'; sql: string; inTx: boolean }
  | { type: 'tx'; edge: 'begin' | 'end' }
  | { type: 'ensureSlice'; edge: 'start' | 'end' }
  | { type: 'source'; call: string; tableId: string };
const events = vi.hoisted(() => ({ log: [] as unknown[] }));
const log = (): Event[] => events.log as Event[];

vi.mock('../../src/ingestion/slice-cache.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/ingestion/slice-cache.ts')>();
  return {
    ...actual,
    ensureSlice: async (...args: Parameters<typeof actual.ensureSlice>) => {
      events.log.push({ type: 'ensureSlice', edge: 'start' });
      try {
        return await actual.ensureSlice(...args);
      } finally {
        events.log.push({ type: 'ensureSlice', edge: 'end' });
      }
    },
  };
});

const REF = '2026-09-29';
const WATER_TABLE = '82883NED';
const WATER_Q = 'Hoeveel leidingwater werd in 2020 gebruikt?';

let rawDb: Db;
let db: Db;
let close: () => Promise<void>;
let lane: TableLaneTable;
let water: TableLaneTable;

function spyDb(inner: Db, inTx = false): Db {
  return {
    async query(text: string, params?: unknown[]): Promise<{ rows: QueryResultRow[] }> {
      events.log.push({ type: 'sql', sql: text, inTx });
      return inner.query(text, params);
    },
    async withTransaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
      return inner.withTransaction(async (tx) => {
        events.log.push({ type: 'tx', edge: 'begin' });
        try {
          return await fn(spyDb(tx, true));
        } finally {
          events.log.push({ type: 'tx', edge: 'end' });
        }
      });
    },
  };
}

/** A CbsSource over a step-4 schema fixture (schema + code lists, no cells). */
class TableOnlySource implements CbsSource {
  private readonly table: TableLaneTable;
  constructor(table: TableLaneTable) {
    this.table = table;
  }
  async fetchTableSchema(): Promise<CbsTableSchema> {
    return structuredClone(this.table.schema);
  }
  async fetchCodeList(_tableId: string, dimension: string): Promise<CbsCode[]> {
    return structuredClone(this.table.codeLists[dimension] ?? []);
  }
  // eslint-disable-next-line require-yield
  async *fetchObservations(): AsyncIterable<CbsObservationRow[]> {
    throw new Error('TableOnlySource has no observations');
  }
  async fetchObservationCount(): Promise<number | null> {
    return null;
  }
  async fetchCatalog(): Promise<CbsCatalogEntry[]> {
    return [];
  }
}

/** Routes by table id, logs every call, and can fail schema fetches on
 * chosen call numbers (1-based, per source) — a CBS outage on demand. */
class SpySource implements CbsSource {
  schemaCalls = 0;
  codeListCalls = 0;
  failCodeListCall: (n: number) => boolean = () => false;
  failSchemaCall: (n: number) => boolean = () => false;
  observationCalls = 0;
  observedSlices: (CbsSlice | undefined)[] = [];
  failObservationCall: (n: number) => boolean = () => false;
  mutateSchema: (schema: CbsTableSchema, n: number) => CbsTableSchema = (s) => s;
  private readonly byTable: Record<string, CbsSource>;
  constructor(byTable: Record<string, CbsSource>) {
    this.byTable = byTable;
  }
  private src(tableId: string): CbsSource {
    const s = this.byTable[tableId];
    if (!s) throw new Error(`SpySource: unknown table ${tableId}`);
    return s;
  }
  async fetchTableSchema(tableId: string, slice?: CbsSlice): Promise<CbsTableSchema> {
    this.schemaCalls += 1;
    const n = this.schemaCalls;
    events.log.push({ type: 'source', call: 'fetchTableSchema', tableId });
    if (this.failSchemaCall(n)) throw new Error('CBS is down (test)');
    return this.mutateSchema(await this.src(tableId).fetchTableSchema(tableId, slice), n);
  }
  async fetchCodeList(tableId: string, dimension: string, slice?: CbsSlice): Promise<CbsCode[]> {
    this.codeListCalls += 1;
    events.log.push({ type: 'source', call: `fetchCodeList:${dimension}`, tableId });
    if (this.failCodeListCall(this.codeListCalls)) throw new Error('CBS is down (test)');
    return this.src(tableId).fetchCodeList(tableId, dimension, slice);
  }
  fetchObservations(tableId: string, slice?: CbsSlice, dimensionNames?: string[]): AsyncIterable<CbsObservationRow[]> {
    events.log.push({ type: 'source', call: 'fetchObservations', tableId });
    this.observationCalls += 1;
    if (this.failObservationCall(this.observationCalls)) throw new Error('CBS is down (test)');
    this.observedSlices.push(slice);
    return this.src(tableId).fetchObservations(tableId, slice, dimensionNames);
  }
  async fetchObservationCount(tableId: string): Promise<number | null> {
    return this.src(tableId).fetchObservationCount(tableId);
  }
  async fetchCatalog(): Promise<CbsCatalogEntry[]> {
    return [];
  }
}

/** Scripted table-parse client: each call takes the next step (an output
 * string, or an Error to throw). `onCall` runs first (e.g. to move a clock). */
class ScriptedParseClient implements LlmClient {
  calls: LlmRequest[] = [];
  onCall: () => void = () => {};
  private readonly steps: (string | Error)[];
  constructor(steps: (string | Error)[]) {
    this.steps = steps;
  }
  async complete(request: LlmRequest): Promise<LlmResponse> {
    this.calls.push(request);
    order.push('parse');
    this.onCall();
    const step = this.steps.shift();
    if (step === undefined) throw new Error('ScriptedParseClient: no step left');
    if (step instanceof Error) throw step;
    return { outputText: step, model: 'stub-table-parse', stopReason: 'end_turn', usage: { inputTokens: 7, outputTokens: 3 } };
  }
}

function amsterdam(year = 2024, confidence = 0.95): string {
  return parseOutput(lane, LANE_QUESTION, {
    measureCode: LANE_MEASURE,
    period: { kind: 'year', year },
    regions: [{ name: 'Amsterdam', kind: 'gemeente' }],
    confidence,
  });
}

function waterOutput(): string {
  return parseOutput(water, WATER_Q, { measureCode: 'M005248_2', period: { kind: 'year', year: 2020 } });
}

async function makeSource(): Promise<SpySource> {
  return new SpySource({ [LANE_TABLE]: await laneSource(), [WATER_TABLE]: new TableOnlySource(water) });
}

function respondOptions(): (lang: 'nl' | 'en') => AuditedRespondOptions {
  return () => ({ intentClient: new ThrowingAnswerClient(), answerClient: new ThrowingAnswerClient(), referenceDate: REF });
}

const sleeps: number[] = [];
/** Parse calls and sleeps, in the order they happened. */
const order: string[] = [];
function deps(source: CbsSource, parseClient: LlmClient, extra: Partial<TableLaneJobDeps> = {}): TableLaneJobDeps {
  return {
    db,
    source,
    parseClient,
    respondOptions: respondOptions(),
    referenceDate: REF,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      order.push(`sleep:${ms}`);
    },
    ...extra,
  };
}

async function seedUser(credits = 100): Promise<string> {
  const userId = randomUUID();
  await rawDb.query(
    `insert into credit_transactions (user_id, delta, reason, note) values ($1, $2, 'signup_grant', 'test seed')`,
    [userId, credits],
  );
  return userId;
}

async function queue(
  userId: string,
  overrides: { question?: string; tableId?: string; threadId?: number | null; previousQuestion?: string | null } = {},
): Promise<TableLaneRow> {
  const result = await createTableLaneRequest(rawDb, {
    userId,
    requestId: randomUUID(),
    threadId: overrides.threadId ?? null,
    lang: 'nl',
    question: overrides.question ?? LANE_QUESTION,
    tableId: overrides.tableId ?? LANE_TABLE,
    finderConfidence: 0.9,
    ...(overrides.previousQuestion !== undefined ? { previousQuestion: overrides.previousQuestion } : {}),
  });
  if (result.kind !== 'created') throw new Error(`expected created, got ${result.kind}`);
  return result.row;
}

async function row(id: number, userId: string): Promise<TableLaneRow> {
  const r = await readTableLaneRequest(rawDb, id, userId);
  if (!r) throw new Error(`row ${id} not found`);
  return r;
}

interface AuditRow {
  id: number;
  kind: string;
  refusalReason: string | null;
  threadId: number | null;
  requestId: string;
  response: Record<string, unknown>;
  llmCalls: { role: string }[];
}

async function audits(userId: string): Promise<AuditRow[]> {
  const { rows } = await rawDb.query(
    `select id, kind, refusal_reason, thread_id, request_id::text as request_id, response, llm_calls
       from audit_answers where user_id = $1 order by id`,
    [userId],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    kind: String(r.kind),
    refusalReason: (r.refusal_reason as string | null) ?? null,
    threadId: r.thread_id === null ? null : Number(r.thread_id),
    requestId: String(r.request_id),
    response: (typeof r.response === 'string' ? JSON.parse(r.response) : r.response) as Record<string, unknown>,
    llmCalls: (typeof r.llm_calls === 'string' ? JSON.parse(r.llm_calls) : r.llm_calls) as { role: string }[],
  }));
}

function lanePart(a: AuditRow): Record<string, unknown> {
  return a.response.tableLane as Record<string, unknown>;
}

async function count(sql: string, params: unknown[] = []): Promise<number> {
  const { rows } = await rawDb.query(sql, params);
  return Number(rows[0]!.n);
}

beforeAll(async () => {
  ({ db: rawDb, close } = await createTestDb());
  db = spyDb(rawDb);
  lane = await laneTable(await laneSource());
  water = JSON.parse(
    readFileSync(fileURLToPath(new URL(`../fixtures/tableparse/schemas/${WATER_TABLE}.json`, import.meta.url)), 'utf8'),
  ) as TableLaneTable;
});

afterAll(async () => {
  await close();
});

beforeEach(async () => {
  await resetTestDb(rawDb);
  await applyPricingDefaults(rawDb); // simple = 20, clarification = 10
  events.log.length = 0;
  sleeps.length = 0;
  order.length = 0;
});

// ---------------------------------------------------------------------------

describe('runTableLaneJob — answer path', () => {
  it('registers a new table, stores the slice, answers, audits, attaches a new thread, keeps the price', async () => {
    const userId = await seedUser();
    const queued = await queue(userId);
    const source = await makeSource();

    const summary = await runTableLaneJob(deps(source, new ScriptedParseClient([amsterdam()])));

    expect(summary).toEqual({ processed: 1, answered: 1, asked: 0, refused: 0, failed: 0 });
    // registered schema-only, one slice stored
    const reg = await rawDb.query('select ingest_mode from cbs_tables where id = $1', [LANE_TABLE]);
    expect(reg.rows[0]!.ingest_mode).toBe('slice_cache');
    expect(await count('select count(*)::int as n from slice_fetches where table_id = $1', [LANE_TABLE])).toBe(1);
    // the row: done, answer, audit id, thread written back (Ruling R3)
    const done = await row(queued.id, userId);
    expect(done.status).toBe('done');
    expect(done.outcomeKind).toBe('answer');
    expect(done.threadId).not.toBeNull();
    const rows = await audits(userId);
    expect(rows).toHaveLength(1);
    expect(done.auditId).toBe(rows[0]!.id);
    expect(rows[0]!.kind).toBe('answer');
    expect(rows[0]!.requestId).toBe(queued.requestId);
    expect(rows[0]!.threadId).toBe(done.threadId);
    expect(lanePart(rows[0]!).rowId).toBe(queued.id);
    expect(lanePart(rows[0]!).fromCachedSlice).toBe(false);
    expect(lanePart(rows[0]!).sliceFilterKey).not.toBeNull();
    expect(rows[0]!.llmCalls.filter((c) => c.role === 'table_parse')).toHaveLength(1);
    // money: net 20
    expect(await getBalance(rawDb, userId)).toBe(80);
    // the schema was fetched ONCE before the slice (registration reused it)
    const firstEnsure = log().findIndex((e) => e.type === 'ensureSlice');
    const schemaFetchesBefore = log()
      .slice(0, firstEnsure)
      .filter((e) => e.type === 'source' && e.call === 'fetchTableSchema');
    expect(schemaFetchesBefore).toHaveLength(1);
    const codeListFetchesBefore = log()
      .slice(0, firstEnsure)
      .filter((e) => e.type === 'source' && e.call.startsWith('fetchCodeList:'));
    expect(codeListFetchesBefore).toHaveLength(lane.schema.dimensions.length);
  });

  it('a second question on the same slice reuses the stored slice (ensureSlice cached) and still answers', async () => {
    const userId = await seedUser();
    await queue(userId);
    const source = await makeSource();
    await runTableLaneJob(deps(source, new ScriptedParseClient([amsterdam()])));
    const observationFetches = () => log().filter((e) => e.type === 'source' && e.call === 'fetchObservations').length;
    const before = observationFetches();

    const second = await queue(userId);
    const summary = await runTableLaneJob(deps(source, new ScriptedParseClient([amsterdam()])));

    expect(summary.answered).toBe(1);
    expect(observationFetches()).toBe(before); // no new cell fetch
    expect(await count('select count(*)::int as n from slice_fetches where table_id = $1', [LANE_TABLE])).toBe(1);
    const done = await row(second.id, userId);
    expect(done.outcomeKind).toBe('answer');
    const last = (await audits(userId)).at(-1)!;
    expect(lanePart(last).fromCachedSlice).toBe(false);
    expect(await getBalance(rawDb, userId)).toBe(60);
  });

  // Task 7: a follow-up row's previous question reaches the table parser
  // (prompt version 3's "Vorige vraag" line); a plain row's parse request has
  // no such line (the version-2 user turn).
  it('a follow-up row sends its previous question to the parser and answers', async () => {
    const userId = await seedUser();
    const previous = 'Hoeveel inwoners had Amsterdam in 2023?';
    const queued = await queue(userId, { previousQuestion: previous });
    const client = new ScriptedParseClient([amsterdam()]);

    await runTableLaneJob(deps(await makeSource(), client));

    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]!.question.split('\n')[0]).toBe(`Vorige vraag in dit gesprek: ${JSON.stringify(previous)}`);
    expect(client.calls[0]!.question.split('\n')[1]).toBe(`Volledige vraag van de gebruiker: ${JSON.stringify(LANE_QUESTION)}`);
    expect((await row(queued.id, userId)).outcomeKind).toBe('answer');
  });

  it('a plain row sends no previous-question line', async () => {
    const userId = await seedUser();
    await queue(userId);
    const client = new ScriptedParseClient([amsterdam()]);
    await runTableLaneJob(deps(await makeSource(), client));
    expect(client.calls[0]!.question.startsWith('Volledige vraag van de gebruiker: ')).toBe(true);
  });

  it('attaches the answer to the row’s own thread when it has one', async () => {
    const userId = await seedUser();
    const { rows: t } = await rawDb.query('insert into chat_threads (user_id) values ($1::uuid) returning id', [userId]);
    const threadId = Number(t[0]!.id);
    const queued = await queue(userId, { threadId });

    await runTableLaneJob(deps(await makeSource(), new ScriptedParseClient([amsterdam()])));

    expect((await row(queued.id, userId)).threadId).toBe(threadId);
    expect((await audits(userId))[0]!.threadId).toBe(threadId);
    expect(await count('select count(*)::int as n from chat_threads where user_id = $1', [userId])).toBe(1);
  });

  it('never calls ensureSlice inside a transaction holding the shared per-table lock (#336 (1))', async () => {
    const userId = await seedUser();
    await queue(userId);
    await runTableLaneJob(deps(await makeSource(), new ScriptedParseClient([amsterdam()])));

    const isShared = (e: Event) => e.type === 'sql' && e.sql.includes('pg_advisory_xact_lock_shared');
    let openTx = 0;
    let sharedHeld = false;
    let insideEnsure = false;
    let ensureCalls = 0;
    let sharedAfterEnsure = 0;
    for (const e of log()) {
      if (e.type === 'tx') {
        if (e.edge === 'begin') openTx += 1;
        else {
          openTx -= 1;
          if (openTx === 0) sharedHeld = false;
        }
      } else if (e.type === 'ensureSlice') {
        if (e.edge === 'start') {
          ensureCalls += 1;
          expect(sharedHeld).toBe(false);
          insideEnsure = true;
        } else insideEnsure = false;
      } else if (isShared(e)) {
        expect(insideEnsure).toBe(false);
        if (openTx > 0) sharedHeld = true;
        if (ensureCalls > 0) sharedAfterEnsure += 1;
      }
    }
    expect(ensureCalls).toBe(1);
    // The spy does see the shared lock — runQuery takes it, AFTER ensureSlice.
    expect(sharedAfterEnsure).toBeGreaterThan(0);
  });
});

/** Names of `n` gemeenten that resolve unambiguously (no bracket, no repeat). */
function gemeenteNames(n: number): string[] {
  const titles = lane.codeLists['RegioS']!.filter((c) => c.code.startsWith('GM')).map((c) => c.title);
  const counts = new Map<string, number>();
  for (const t of titles) counts.set(t, (counts.get(t) ?? 0) + 1);
  return titles.filter((t) => !t.includes('(') && counts.get(t) === 1).slice(0, n);
}

describe('runTableLaneJob — a slice over CBS’s filter limit is split (#358 (11))', () => {
  function manyRegions(n: number): string {
    return parseOutput(lane, LANE_QUESTION, {
      measureCode: LANE_MEASURE,
      period: { kind: 'year', year: 2024 },
      regions: gemeenteNames(n).map((name) => ({ name, kind: 'gemeente' as const })),
    });
  }

  it('a question naming 200 gemeenten fetches in several requests of at most 150 codes, stores them all and answers', async () => {
    const userId = await seedUser();
    await queue(userId);
    const source = await makeSource();

    const summary = await runTableLaneJob(deps(source, new ScriptedParseClient([manyRegions(200)])));

    expect(summary).toEqual({ processed: 1, answered: 1, asked: 0, refused: 0, failed: 0 });
    expect(source.observedSlices.length).toBeGreaterThanOrEqual(2);
    let regionsSeen = 0;
    for (const s of source.observedSlices) {
      const regions = s!.dimensionIn!['RegioS']!;
      expect(regions.length + s!.periodIn!.codes.length + s!.measures!.length).toBeLessThanOrEqual(150);
      regionsSeen += regions.length;
    }
    expect(regionsSeen).toBe(200);
    // one stored slice per piece; the audit carries the whole request's key, not a piece's
    expect(await count('select count(*)::int as n from slice_fetches where table_id = $1', [LANE_TABLE])).toBe(
      source.observedSlices.length,
    );
    const rows = await audits(userId);
    expect(rows[0]!.kind).toBe('answer');
    expect(lanePart(rows[0]!).fromCachedSlice).toBe(false);
    const key = JSON.parse(lanePart(rows[0]!).sliceFilterKey as string) as { members: { RegioS: string[] } };
    expect(key.members.RegioS).toHaveLength(200);
  });

  it('a small question still makes exactly one request (nothing below 150 changes)', async () => {
    const userId = await seedUser();
    await queue(userId);
    const source = await makeSource();
    await runTableLaneJob(deps(source, new ScriptedParseClient([amsterdam()])));
    expect(source.observedSlices).toHaveLength(1);
    expect(await count('select count(*)::int as n from slice_fetches where table_id = $1', [LANE_TABLE])).toBe(1);
  });

  it('if one split request fails, the whole question refuses (cbs_unreachable) — never an answer from a subset', async () => {
    const userId = await seedUser();
    const queued = await queue(userId);
    const source = await makeSource();
    source.failObservationCall = (n) => n >= 2; // the first piece succeeds, every later one fails
    const summary = await runTableLaneJob(deps(source, new ScriptedParseClient([manyRegions(200)])));

    expect(summary.answered).toBe(0);
    expect(summary.refused).toBe(1);
    const rows = await audits(userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.kind).toBe('refusal');
    expect(rows[0]!.refusalReason).toBe('cbs_unreachable');
    expect((await row(queued.id, userId)).outcomeKind).toBe('refusal');
    expect(await getBalance(rawDb, userId)).toBe(100); // net 0
  });
});

describe('runTableLaneJob — question and refusals', () => {
  it('ask path → an audited clarification, net cost 10', async () => {
    const userId = await seedUser();
    const queued = await queue(userId, { question: WATER_Q, tableId: WATER_TABLE });

    const summary = await runTableLaneJob(deps(await makeSource(), new ScriptedParseClient([waterOutput()])));

    expect(summary).toEqual({ processed: 1, answered: 0, asked: 1, refused: 0, failed: 0 });
    const done = await row(queued.id, userId);
    expect(done.status).toBe('done');
    expect(done.outcomeKind).toBe('clarification');
    const [a] = await audits(userId);
    expect(a!.kind).toBe('clarification');
    expect(lanePart(a!).question).not.toBeNull();
    expect(await getBalance(rawDb, userId)).toBe(90);
  });

  it('a parse below the confidence threshold → audited refusal, net 0', async () => {
    const userId = await seedUser();
    const queued = await queue(userId);

    const summary = await runTableLaneJob(deps(await makeSource(), new ScriptedParseClient([amsterdam(2024, 0.1)])));

    expect(summary).toEqual({ processed: 1, answered: 0, asked: 0, refused: 1, failed: 0 });
    const done = await row(queued.id, userId);
    expect(done.outcomeKind).toBe('refusal');
    const [a] = await audits(userId);
    expect(a!.refusalReason).toBe('table_lane_unsure');
    expect(await getBalance(rawDb, userId)).toBe(100);
  });

  it('registerSchemaOnly refuses the table → table_lane_ineligible without a parse, net 0', async () => {
    const userId = await seedUser();
    const queued = await queue(userId);
    const source = await makeSource();
    source.mutateSchema = (s) => ({ ...s, modified: null });
    const parse = new ScriptedParseClient([amsterdam()]);

    await runTableLaneJob(deps(source, parse));

    expect(parse.calls).toHaveLength(0);
    // M4: a schema-only refusal happens before any code-list fetch
    expect(source.codeListCalls).toBe(0);
    expect((await row(queued.id, userId)).outcomeKind).toBe('refusal');
    const [a] = await audits(userId);
    expect(a!.refusalReason).toBe('table_lane_ineligible');
    expect(lanePart(a!).parseAudit).toBeNull();
    expect(await getBalance(rawDb, userId)).toBe(100);
  });

  it('ensureSlice refuses for a non-fetch reason (table quarantined) → table_lane_ineligible, net 0', async () => {
    const userId = await seedUser();
    await queue(userId);
    const source = await makeSource();
    await runTableLaneJob(deps(source, new ScriptedParseClient([amsterdam()])));
    await rawDb.query(`update cbs_tables set status = 'needs_review', needs_review_reason = 'test' where id = $1`, [LANE_TABLE]);

    const second = await queue(userId);
    const summary = await runTableLaneJob(deps(source, new ScriptedParseClient([amsterdam(2023)])));

    expect(summary.refused).toBe(1);
    expect(sleeps).toEqual([]); // no CBS retry for a non-fetch failure
    const last = (await audits(userId)).at(-1)!;
    expect(last.refusalReason).toBe('table_lane_ineligible');
    expect((await row(second.id, userId)).outcomeKind).toBe('refusal');
    expect(await getBalance(rawDb, userId)).toBe(80); // first answered (20), second refunded
  });
});

describe('runTableLaneJob — CBS unreachable (settled choices 1 + 2)', () => {
  it('a fetch failure twice with a fresh (< 24 h) cached slice answers from it (fromCachedSlice)', async () => {
    const userId = await seedUser();
    await queue(userId);
    const source = await makeSource();
    await runTableLaneJob(deps(source, new ScriptedParseClient([amsterdam()])));

    // From now on only the job's own schema load succeeds; both ensureSlice
    // schema checks fail.
    const base = source.schemaCalls;
    source.failSchemaCall = (n) => n > base + 1;
    const second = await queue(userId);
    const summary = await runTableLaneJob(deps(source, new ScriptedParseClient([amsterdam()])));

    expect(summary.answered).toBe(1);
    expect(sleeps).toEqual([2000]);
    expect(log().filter((e) => e.type === 'ensureSlice' && e.edge === 'start')).toHaveLength(3);
    const last = (await audits(userId)).at(-1)!;
    expect(last.kind).toBe('answer');
    expect(lanePart(last).fromCachedSlice).toBe(true);
    expect((await row(second.id, userId)).outcomeKind).toBe('answer');
    expect(await getBalance(rawDb, userId)).toBe(60);
  });

  it('a lagging CBS Modified (older than stored) twice with no cached slice → cbs_unreachable, net 0', async () => {
    const userId = await seedUser();
    await queue(userId);
    const source = await makeSource();
    await runTableLaneJob(deps(source, new ScriptedParseClient([amsterdam()])));

    source.mutateSchema = (s) => ({ ...s, modified: '2001-01-01T00:00:00Z' });
    const second = await queue(userId);
    // 2023: a different slice → no cached row for this filter key
    const summary = await runTableLaneJob(deps(source, new ScriptedParseClient([amsterdam(2023)])));

    expect(summary.refused).toBe(1);
    expect(sleeps).toEqual([2000]);
    const last = (await audits(userId)).at(-1)!;
    expect(last.refusalReason).toBe('cbs_unreachable');
    expect((await row(second.id, userId)).outcomeKind).toBe('refusal');
    expect(await getBalance(rawDb, userId)).toBe(80);
  });

  it('R9: the job\'s own CBS schema load fails twice → cbs_unreachable after one 2 s retry, audited, net 0, no retry attempt', async () => {
    const userId = await seedUser();
    const queued = await queue(userId);
    const source = await makeSource();
    source.failSchemaCall = () => true;
    const parse = new ScriptedParseClient([amsterdam()]);

    const summary = await runTableLaneJob(deps(source, parse));

    expect(summary).toEqual({ processed: 1, answered: 0, asked: 0, refused: 1, failed: 0 });
    expect(sleeps).toEqual([2000]);
    expect(source.schemaCalls).toBe(2);
    expect(parse.calls).toHaveLength(0);
    const done = await row(queued.id, userId);
    expect(done.status).toBe('done');
    expect(done.attempts).toBe(1);
    expect(done.outcomeKind).toBe('refusal');
    const [a] = await audits(userId);
    expect(a!.refusalReason).toBe('cbs_unreachable');
    expect(done.threadId).toBe(a!.threadId);
    expect(await getBalance(rawDb, userId)).toBe(100);
  });

  it('R9: a schema load that fails once succeeds on the 2 s retry and answers', async () => {
    const userId = await seedUser();
    await queue(userId);
    const source = await makeSource();
    source.failSchemaCall = (n) => n === 1;

    const summary = await runTableLaneJob(deps(source, new ScriptedParseClient([amsterdam()])));

    expect(summary.answered).toBe(1);
    expect(sleeps).toEqual([2000]);
  });

  it('R9: a code-list load that keeps failing → cbs_unreachable', async () => {
    const userId = await seedUser();
    await queue(userId);
    const source = await makeSource();
    source.failCodeListCall = () => true;

    const summary = await runTableLaneJob(deps(source, new ScriptedParseClient([amsterdam()])));

    expect(summary.refused).toBe(1);
    expect(sleeps).toEqual([2000]);
    expect((await audits(userId))[0]!.refusalReason).toBe('cbs_unreachable');
    expect(await getBalance(rawDb, userId)).toBe(100);
  });

  it('M1: a < 24 h cached slice that CBS has since superseded is not used → cbs_unreachable', async () => {
    const userId = await seedUser();
    await queue(userId);
    const source = await makeSource();
    await runTableLaneJob(deps(source, new ScriptedParseClient([amsterdam()])));
    // Another slice already saw a newer CBS version of this table.
    await rawDb.query(`update cbs_tables set schema_cbs_modified = schema_cbs_modified + interval '1 day' where id = $1`, [
      LANE_TABLE,
    ]);

    const base = source.schemaCalls;
    source.failSchemaCall = (n) => n > base + 1;
    await queue(userId);
    await runTableLaneJob(deps(source, new ScriptedParseClient([amsterdam()])));

    expect((await audits(userId)).at(-1)!.refusalReason).toBe('cbs_unreachable');
    expect(await getBalance(rawDb, userId)).toBe(80);
  });

  it('a cached slice older than 24 h is not used → cbs_unreachable', async () => {
    const userId = await seedUser();
    await queue(userId);
    const source = await makeSource();
    await runTableLaneJob(deps(source, new ScriptedParseClient([amsterdam()])));
    await rawDb.query(`update slice_fetches set checked_at = now() - interval '25 hours'`);

    const base = source.schemaCalls;
    source.failSchemaCall = (n) => n > base + 1;
    await queue(userId);
    await runTableLaneJob(deps(source, new ScriptedParseClient([amsterdam()])));

    expect((await audits(userId)).at(-1)!.refusalReason).toBe('cbs_unreachable');
    expect(await getBalance(rawDb, userId)).toBe(80);
  });
});

describe('runTableLaneJob — failures, retries and give-up', () => {
  it('a parse client that throws twice → table_lane_failed: row failed, refunded, audited once; logs carry no question', async () => {
    const userId = await seedUser();
    const queued = await queue(userId);
    const parse = new ScriptedParseClient([new Error('model overloaded'), new Error('model overloaded')]);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const summary = await runTableLaneJob(deps(await makeSource(), parse));

      expect(summary).toEqual({ processed: 2, answered: 0, asked: 0, refused: 0, failed: 1 });
      expect(parse.calls).toHaveLength(2);
      const failed = await row(queued.id, userId);
      expect(failed.status).toBe('failed');
      expect(failed.attempts).toBe(TABLE_LANE_MAX_ATTEMPTS);
      expect(failed.failureSummary).toContain('model overloaded');
      const rows = await audits(userId);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.refusalReason).toBe('table_lane_failed');
      expect(failed.auditId).toBe(rows[0]!.id);
      expect(rows[0]!.threadId).toBe(failed.threadId);
      expect(failed.threadId).not.toBeNull();
      expect(await getBalance(rawDb, userId)).toBe(100);
      const logged = errors.mock.calls.map((c) => c.map(String).join(' ')).join('\n');
      expect(logged).toContain('table-lane-job:');
      expect(logged).toContain(String(queued.id));
      expect(logged).not.toContain(LANE_QUESTION);
      expect(logged).not.toContain('Amsterdam');
    } finally {
      errors.mockRestore();
    }
  });

  it('one transient failure is retried and then answers', async () => {
    const userId = await seedUser();
    const queued = await queue(userId);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const summary = await runTableLaneJob(
        deps(await makeSource(), new ScriptedParseClient([new Error('timeout'), amsterdam()])),
      );
      expect(summary.answered).toBe(1);
      const done = await row(queued.id, userId);
      expect(done.outcomeKind).toBe('answer');
      expect(done.attempts).toBe(2);
      expect(await audits(userId)).toHaveLength(1);
      expect(await getBalance(rawDb, userId)).toBe(80);
      // M2: the released row is re-claimed only after a 2 s backoff
      expect(order).toEqual(['parse', 'sleep:2000', 'parse']);
    } finally {
      errors.mockRestore();
    }
  });

  it('stops claiming new rows once the time budget is spent', async () => {
    const userId = await seedUser();
    const first = await queue(userId);
    const second = await queue(userId);
    let clock = Date.now();
    const parse = new ScriptedParseClient([amsterdam(), amsterdam()]);
    parse.onCall = () => {
      clock += 5 * 60 * 1000; // a slow turn: 5 minutes
    };

    const summary = await runTableLaneJob(
      deps(await makeSource(), parse, { now: () => new Date(clock), budgetMs: 240_000 }),
    );

    expect(summary.processed).toBe(1);
    expect((await row(first.id, userId)).status).toBe('done');
    expect((await row(second.id, userId)).status).toBe('pending');
  });

  it('does not claim a new row when less than 120 s of the budget remains (M3)', async () => {
    const userId = await seedUser();
    const first = await queue(userId);
    const second = await queue(userId);
    let clock = Date.now();
    const parse = new ScriptedParseClient([amsterdam(), amsterdam()]);
    parse.onCall = () => {
      clock += 130_000; // 110 s of a 240 s budget left afterwards
    };

    const summary = await runTableLaneJob(deps(await makeSource(), parse, { now: () => new Date(clock), budgetMs: 240_000 }));

    expect(summary.processed).toBe(1);
    expect((await row(first.id, userId)).status).toBe('done');
    expect((await row(second.id, userId)).status).toBe('pending');
  });

  it('a budget under 120 s claims nothing (M3)', async () => {
    const userId = await seedUser();
    const queued = await queue(userId);
    const summary = await runTableLaneJob(deps(await makeSource(), new ScriptedParseClient([amsterdam()]), { budgetMs: 100_000 }));
    expect(summary.processed).toBe(0);
    expect((await row(queued.id, userId)).status).toBe('pending');
  });

  it('two concurrent invocations over one exhausted row write exactly one audit and settle once (Important 1)', async () => {
    const userId = await seedUser();
    const queued = await queue(userId);
    await rawDb.query(
      `update table_lane_requests set status = 'running', attempts = $2,
              started_at = now() - ($3::int * interval '1 millisecond') - interval '1 minute'
        where id = $1`,
      [queued.id, TABLE_LANE_MAX_ATTEMPTS, TABLE_LANE_STALE_MS],
    );
    const source = await makeSource();

    const [a, b] = await Promise.all([
      runTableLaneJob(deps(source, new ScriptedParseClient([]))),
      runTableLaneJob(deps(source, new ScriptedParseClient([]))),
    ]);

    expect(a.failed + b.failed).toBe(1);
    const rows = await audits(userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.refusalReason).toBe('table_lane_failed');
    const failed = await row(queued.id, userId);
    expect(failed.status).toBe('failed');
    expect(failed.auditId).toBe(rows[0]!.id);
    expect(failed.threadId).toBe(rows[0]!.threadId);
    expect(await count(`select count(*)::int as n from chat_threads where user_id = $1`, [userId])).toBe(1);
    expect(
      await count(`select count(*)::int as n from credit_transactions where user_id = $1 and reason = 'compensation'`, [userId]),
    ).toBe(1);
    expect(await getBalance(rawDb, userId)).toBe(100);
  });

  it('reclaims a stale running row and answers it', async () => {
    const userId = await seedUser();
    const queued = await queue(userId);
    await rawDb.query(
      `update table_lane_requests set status = 'running', attempts = 1, started_at = now() - interval '10 minutes' where id = $1`,
      [queued.id],
    );

    const summary = await runTableLaneJob(deps(await makeSource(), new ScriptedParseClient([amsterdam()])));

    expect(summary.answered).toBe(1);
    const done = await row(queued.id, userId);
    expect(done.status).toBe('done');
    expect(done.attempts).toBe(2);
  });

  it('a stale running row that used every attempt is failed: audited table_lane_failed + full refund', async () => {
    const userId = await seedUser();
    const queued = await queue(userId);
    await rawDb.query(
      `update table_lane_requests set status = 'running', attempts = $2,
              started_at = now() - ($3::int * interval '1 millisecond') - interval '1 minute'
        where id = $1`,
      [queued.id, TABLE_LANE_MAX_ATTEMPTS, TABLE_LANE_STALE_MS],
    );
    const parse = new ScriptedParseClient([]);

    const summary = await runTableLaneJob(deps(await makeSource(), parse));

    expect(summary).toEqual({ processed: 1, answered: 0, asked: 0, refused: 0, failed: 1 });
    expect(parse.calls).toHaveLength(0);
    const failed = await row(queued.id, userId);
    expect(failed.status).toBe('failed');
    const rows = await audits(userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.refusalReason).toBe('table_lane_failed');
    expect(failed.auditId).toBe(rows[0]!.id);
    expect(await getBalance(rawDb, userId)).toBe(100);
  });

  it('a reclaimed row whose earlier attempt already audited its answer is finished from that audit (no second answer)', async () => {
    const userId = await seedUser();
    const queued = await queue(userId);
    const source = await makeSource();
    // First attempt answers; then simulate a crash between audit and finish.
    await runTableLaneJob(deps(source, new ScriptedParseClient([amsterdam()])));
    const answered = await row(queued.id, userId);
    await rawDb.query(
      `update table_lane_requests set status = 'running', outcome_kind = null, audit_id = null, finished_at = null,
              started_at = now() - interval '10 minutes'
        where id = $1`,
      [queued.id],
    );
    // The kept charge needs no change: an answer keeps the price.
    const parse = new ScriptedParseClient([]);

    const summary = await runTableLaneJob(deps(source, parse));

    expect(summary.answered).toBe(1);
    expect(parse.calls).toHaveLength(0);
    const done = await row(queued.id, userId);
    expect(done.status).toBe('done');
    expect(done.outcomeKind).toBe('answer');
    expect(done.auditId).toBe(answered.auditId);
    expect(await audits(userId)).toHaveLength(1);
    expect(await getBalance(rawDb, userId)).toBe(80);
  });
});

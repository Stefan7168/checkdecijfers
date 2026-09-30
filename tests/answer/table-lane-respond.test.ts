// Breadth step 5, Task 3 — respondTableLane: a TableLanePlan becomes ONE
// audited ComposedResponse (src/answer/table-lane/respond.ts):
//  - fetch  → an answer through the EXISTING respondToIntent + audited wrap
//             (same checks, same audit write), carrying `tableLane`;
//  - ask    → a clarification ("Welke <dim> bedoel je?") with the first 12
//             members, a STRIPPED rescue carrier as `pending` (a typed reply
//             on a stale client is a fresh question, never a curated merge);
//  - refuse → a typed refusal from deterministic nl + en templates.
// Every outcome writes exactly one audit_answers row; the table parse is
// recorded in llm_calls as role 'table_parse'. Hermetic: PGlite, committed
// CBS fixtures, stub LLM clients — no real LLM call, no live DB.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../../src/db/types.ts';
import { ensureSlice, registerSchemaOnly } from '../../src/ingestion/slice-cache.ts';
import { loadAuditRecord } from '../../src/answer/audit/read.ts';
import type { AuditedRespondOptions } from '../../src/answer/audit/respond-audited.ts';
import { isStrippedCarrier, respondToIntent } from '../../src/answer/respond/respond.ts';
import { toInternalRefusal } from '../../src/answer/respond/refusals.ts';
import { planTableLane, type TableLanePlan, type TableLaneRefusalReason } from '../../src/answer/table-lane/plan.ts';
import { offeredMenuHash, respondTableLane } from '../../src/answer/table-lane/respond.ts';
import type { TableLaneTable } from '../../src/answer/table-lane/types.ts';
import {
  TABLE_PARSE_PROMPT_VERSION,
  TABLE_PARSE_SCHEMA_VERSION,
  type TableParseAudit,
  type TableParseResult,
} from '../../src/answer/table-parse/parse.ts';
import { createTestDb } from '../helpers/pglite-db.ts';
import {
  LANE_MEASURE,
  LANE_QUESTION,
  LANE_TABLE,
  StubParseClient,
  ThrowingAnswerClient,
  laneRow,
  laneSource,
  laneTable,
  parseOutput,
} from '../helpers/table-lane-fixture.ts';

const REF = '2026-09-29';

let db: Db;
let close: () => Promise<void>;
let table: TableLaneTable;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  table = await laneTable(await laneSource());
});

afterAll(async () => {
  await close();
});

beforeEach(async () => {
  await db.query(
    'truncate table audit_answers, slice_fetches, observations, dimension_labels, ingestion_batches, cbs_tables restart identity cascade',
  );
});

function options(lang: 'nl' | 'en' = 'nl'): AuditedRespondOptions {
  return {
    intentClient: new ThrowingAnswerClient(),
    answerClient: new ThrowingAnswerClient(),
    referenceDate: REF,
    ...(lang === 'en' ? { lang } : {}),
  };
}

async function fetchPlan(question = LANE_QUESTION, year = 2024): Promise<Extract<TableLanePlan, { kind: 'fetch' }>> {
  const client = new StubParseClient(
    parseOutput(table, question, {
      measureCode: LANE_MEASURE,
      period: { kind: 'year', year },
      regions: [{ name: 'Amsterdam', kind: 'gemeente' }],
    }),
  );
  const plan = await planTableLane({ question, previousQuestion: null, table, choices: [], referenceDate: REF, client });
  if (plan.kind !== 'fetch') throw new Error(`expected a fetch plan, got ${plan.kind}: ${JSON.stringify(plan)}`);
  return plan;
}

async function storeSlice(plan: Extract<TableLanePlan, { kind: 'fetch' }>): Promise<string> {
  const source = await laneSource();
  const reg = await registerSchemaOnly(db, source, LANE_TABLE);
  if (!reg.ok) throw new Error(`registration failed: ${reg.summary}`);
  const fetched = await ensureSlice(db, source, LANE_TABLE, plan.slice);
  if (!fetched.ok) throw new Error(`slice fetch failed: ${fetched.summary}`);
  return fetched.filterKey;
}

const PARSE_AUDIT: TableParseAudit = {
  requestHash: 'a'.repeat(64),
  model: 'stub-table-parse',
  usage: { inputTokens: 11, outputTokens: 5 },
  outputText: '{"stub":true}',
};

const PARSE: TableParseResult = {
  measureCode: LANE_MEASURE,
  breakdowns: {},
  period: { kind: 'year', year: 2024 },
  periodGrainUnavailable: false,
  regions: [],
  regionScope: null,
  derivation: 'none',
  confidence: 0.95,
  reading: 'test',
};

function refusePlan(
  reason: TableLaneRefusalReason,
  extra: { latestPeriodCode?: string; noParse?: boolean } = {},
): TableLanePlan {
  return {
    kind: 'refuse',
    reason,
    detail: `detail for ${reason}`,
    ...(extra.latestPeriodCode !== undefined ? { latestPeriodCode: extra.latestPeriodCode } : {}),
    parse: extra.noParse ? null : PARSE,
    parseAudit: extra.noParse ? null : PARSE_AUDIT,
  };
}

// ---------------------------------------------------------------------------
// fetch → answer
// ---------------------------------------------------------------------------

describe('respondTableLane — fetch plan → audited answer', () => {
  // Task 7 fix round 1 (review Minor 2): a follow-up row's previous question
  // rides the envelope, so the parse request's user turn is on record in
  // audit_answers itself (the row can be deleted by retention).
  it('a follow-up row stores its previous question in the envelope', async () => {
    const plan = await fetchPlan();
    const filterKey = await storeSlice(plan);
    const audited = await respondTableLane(db, {
      row: laneRow({ previousQuestion: 'Hoeveel inwoners had Amsterdam in 2023?', parentId: 40 }),
      plan,
      fetch: { ok: true, filterKey, fromCache: false },
      referenceDate: REF,
      tableTitle: table.schema.title,
      respondOptions: options(),
    });
    expect(audited.response.tableLane?.previousQuestion).toBe('Hoeveel inwoners had Amsterdam in 2023?');
  });

  it('answers through the existing pipeline, carries tableLane, and writes one audit row with the table parse', async () => {
    const plan = await fetchPlan();
    const filterKey = await storeSlice(plan);
    const row = laneRow();

    const audited = await respondTableLane(db, {
      row,
      plan,
      fetch: { ok: true, filterKey, fromCache: false },
      referenceDate: REF,
      tableTitle: table.schema.title,
      respondOptions: options(),
    });

    const response = audited.response;
    if (response.kind !== 'answer') throw new Error(`expected an answer, got ${JSON.stringify(response)}`);
    expect(response.result.attribution.tableId).toBe(LANE_TABLE);
    expect(response.result.cells.length).toBeGreaterThan(0);
    expect(response.parse.model).toBe('stub-table-parse');
    expect(response.parse.usage).toEqual({ inputTokens: 7, outputTokens: 3 });
    expect(response.parse.raw.note).toBe('table-lane: intent built from a validated table-scoped parse (breadth step 5)');
    expect(response.tableLane).toEqual({
      version: 1,
      rowId: row.id,
      tableId: LANE_TABLE,
      finderConfidence: 0.91,
      parse: plan.parse,
      parseAudit: plan.parseAudit,
      offeredMenuHash: offeredMenuHash(plan.offered),
      parsePromptVersion: TABLE_PARSE_PROMPT_VERSION,
      parseSchemaVersion: TABLE_PARSE_SCHEMA_VERSION,
      lang: 'nl',
      selection: plan.selection,
      selectionNote: "Selectie: Regio's: Amsterdam",
      sliceFilterKey: filterKey,
      question: null,
      fromCachedSlice: false,
      previousQuestion: null,
    });
    // The selection note is NOT part of the answer text (digits in member
    // titles must never meet the verbatim-number check).
    expect(response.text).not.toContain('Selectie:');

    expect(audited.auditId).not.toBeNull();
    const record = await loadAuditRecord(db, audited.auditId!);
    expect(record!.kind).toBe('answer');
    expect(record!.tableIds).toEqual([LANE_TABLE]);
    expect(record!.userId).toBe(row.userId);
    expect(record!.requestId).toBe(row.requestId);
    expect(record!.sourceTag).toBe('user');
    expect(record!.llmCalls).toContainEqual({ role: 'table_parse', model: 'stub-table-parse', inputTokens: 7, outputTokens: 3 });
    expect(record!.llmCalls.filter((c) => c.role === 'table_parse')).toHaveLength(1);
    expect(record!.response).toEqual(JSON.parse(JSON.stringify(response)));
    const count = await db.query('select count(*)::int as n from audit_answers');
    expect(count.rows[0]!.n).toBe(1);
  });

  it('offeredMenuHash is a reproducible sha256 of the menu only (question line excluded)', async () => {
    const a = await fetchPlan(LANE_QUESTION);
    const b = await fetchPlan('Wat kostte een koopwoning in Amsterdam in 2024?');
    expect(offeredMenuHash(a.offered)).toMatch(/^[0-9a-f]{64}$/);
    expect(offeredMenuHash(a.offered)).toBe(offeredMenuHash(b.offered));
  });

  it('an English reader gets the selection note in English (CBS titles verbatim)', async () => {
    const plan = await fetchPlan();
    const filterKey = await storeSlice(plan);
    const audited = await respondTableLane(db, {
      row: laneRow({ lang: 'en' }),
      plan,
      fetch: { ok: true, filterKey, fromCache: false },
      referenceDate: REF,
      respondOptions: options('en'),
    });
    expect(audited.response.kind).toBe('answer');
    expect(audited.response.tableLane?.selectionNote).toBe("Selection: Regio's: Amsterdam");
  });

  it('latencyMs covers the table parse when the job passes its start time (M1)', async () => {
    const audited = await respondTableLane(db, {
      row: laneRow(),
      plan: refusePlan('table_lane_no_measure'),
      fetch: null,
      referenceDate: REF,
      startedAt: performance.now() - 5_000,
      respondOptions: options(),
    });
    const record = await loadAuditRecord(db, audited.auditId!);
    expect(record!.latencyMs).toBeGreaterThanOrEqual(5_000);
  });

  it('a cached slice answer is marked fromCachedSlice', async () => {
    const plan = await fetchPlan();
    const filterKey = await storeSlice(plan);
    const audited = await respondTableLane(db, {
      row: laneRow(),
      plan,
      fetch: { ok: true, filterKey, fromCache: true },
      referenceDate: REF,
      respondOptions: options(),
    });
    expect(audited.response.kind).toBe('answer');
    expect(audited.response.tableLane?.fromCachedSlice).toBe(true);
  });

  it("a query-layer refusal on the fetch path still carries tableLane (whatever respondToIntent returns)", async () => {
    // Nothing stored: the query layer refuses honestly; the lane attaches its
    // envelope to that refusal and audits it once.
    const plan = await fetchPlan();
    const source = await laneSource();
    const reg = await registerSchemaOnly(db, source, LANE_TABLE);
    if (!reg.ok) throw new Error(reg.summary);
    // The query layer's never-serve-an-unaccounted-cell rule makes this an
    // 'internal' refusal, which pages the owner — asserted, not printed.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    let audited;
    try {
      audited = await respondTableLane(db, {
        row: laneRow(),
        plan,
        fetch: { ok: true, filterKey: 'not-stored', fromCache: false },
        referenceDate: REF,
        respondOptions: options(),
      });
      expect(consoleError.mock.calls.some((c) => String(c[0]).startsWith('ADMIN ALERT: INTERNAL refusal'))).toBe(true);
    } finally {
      consoleError.mockRestore();
    }
    expect(audited.response.kind).toBe('refusal');
    expect(audited.response.tableLane?.sliceFilterKey).toBe('not-stored');
    expect(audited.response.tableLane?.selectionNote).toBe("Selectie: Regio's: Amsterdam");
    const record = await loadAuditRecord(db, audited.auditId!);
    expect(record!.llmCalls).toContainEqual({ role: 'table_parse', model: 'stub-table-parse', inputTokens: 7, outputTokens: 3 });
  });

  it('fail-closed: an audit-write failure withholds the answer (the existing persistOrFailClosed rule)', async () => {
    const plan = await fetchPlan();
    const filterKey = await storeSlice(plan);
    const failing: Db = {
      async query(text, params) {
        if (text.includes('insert into audit_answers')) throw new Error('audit insert refused');
        return db.query(text, params);
      },
      withTransaction: (fn) => db.withTransaction(fn),
    };
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    let audited;
    try {
      audited = await respondTableLane(failing, {
        row: laneRow(),
        plan,
        fetch: { ok: true, filterKey, fromCache: false },
        referenceDate: REF,
        respondOptions: options(),
      });
      expect(consoleError.mock.calls.some((c) => String(c[0]).startsWith('ADMIN ALERT: INTERNAL refusal'))).toBe(true);
    } finally {
      consoleError.mockRestore();
    }
    expect(audited.auditId).toBeNull();
    expect(audited.response.kind).toBe('refusal');
    if (audited.response.kind !== 'refusal') return;
    expect(audited.response.reason).toBe('internal');
  });
});

// ---------------------------------------------------------------------------
// ask → clarification
// ---------------------------------------------------------------------------

function loadTableparseFixture(tableId: string): TableLaneTable {
  const path = fileURLToPath(new URL(`../fixtures/tableparse/schemas/${tableId}.json`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8')) as TableLaneTable;
}

describe('respondTableLane — ask plan → audited clarification', () => {
  const water = loadTableparseFixture('82883NED');
  const waterQ = 'Hoeveel leidingwater werd in 2020 gebruikt?';

  async function askPlan(): Promise<Extract<TableLanePlan, { kind: 'ask' }>> {
    const client = new StubParseClient(parseOutput(water, waterQ, { measureCode: 'M005248_2', period: { kind: 'year', year: 2020 } }));
    const plan = await planTableLane({ question: waterQ, previousQuestion: null, table: water, choices: [], referenceDate: REF, client });
    if (plan.kind !== 'ask') throw new Error(`expected ask, got ${plan.kind}`);
    return plan;
  }

  it('asks "Welke <dimension> bedoel je?" with the first 12 members and the full count', async () => {
    const plan = await askPlan();
    const row = laneRow({ question: waterQ, tableId: '82883NED' });
    const audited = await respondTableLane(db, { row, plan, fetch: null, referenceDate: REF, respondOptions: options() });
    const response = audited.response;
    if (response.kind !== 'clarification') throw new Error(`expected a clarification, got ${response.kind}`);
    expect(response.text).toBe('Welke Watergebruikers bedoel je? (of typ een andere naam uit de lijst van 52)');
    const titles = plan.question.options.map((o) => o.title);
    expect(titles).toHaveLength(12);
    expect(response.options).toEqual(titles);
    expect(response.suggestions).toEqual(titles);
    expect(response.tableLane?.question).toEqual(plan.question);
    expect(response.tableLane?.question?.totalOptions).toBe(52);
    expect(response.tableLane?.selectionNote).toBeNull();
    expect(response.tableLane?.sliceFilterKey).toBeNull();
    expect(response.tableLane?.offeredMenuHash).toBe(offeredMenuHash(plan.offered));
    // The pending is a rescue-only carrier with nothing to take: any typed
    // reply on it is a FRESH question, never merged through the curated LLM.
    expect(response.pending.rescueOnly).toBe(true);
    expect(isStrippedCarrier(response.pending)).toBe(true);
    expect('english' in response).toBe(false);

    const record = await loadAuditRecord(db, audited.auditId!);
    expect(record!.kind).toBe('clarification');
    expect(record!.tableIds).toEqual([]);
    expect(record!.llmCalls).toEqual([{ role: 'table_parse', model: 'stub-table-parse', inputTokens: 7, outputTokens: 3 }]);
  });

  it('an English reader gets the English question (CBS titles verbatim)', async () => {
    const plan = await askPlan();
    const row = laneRow({ question: waterQ, tableId: '82883NED', lang: 'en' });
    const audited = await respondTableLane(db, { row, plan, fetch: null, referenceDate: REF, respondOptions: options('en') });
    const response = audited.response;
    if (response.kind !== 'clarification') throw new Error('expected a clarification');
    expect(response.text).toBe('Welke Watergebruikers bedoel je? (of typ een andere naam uit de lijst van 52)');
    expect(response.english?.text).toBe('Which Watergebruikers do you mean? (or type another name from the list of 52)');
    expect(response.english?.chips).toEqual(response.options.map((o) => ({ label: o, submit: o })));
  });

  it('twelve or fewer members → no "type another name" hint', async () => {
    const plan = await askPlan();
    const small: TableLanePlan = {
      ...plan,
      question: { ...plan.question, options: plan.question.options.slice(0, 3), totalOptions: 3 },
    };
    const audited = await respondTableLane(db, {
      row: laneRow({ lang: 'en' }),
      plan: small,
      fetch: null,
      referenceDate: REF,
      respondOptions: options('en'),
    });
    expect(audited.response.text).toBe('Welke Watergebruikers bedoel je?');
    if (audited.response.kind !== 'clarification') throw new Error('expected a clarification');
    expect(audited.response.english?.text).toBe('Which Watergebruikers do you mean?');
  });
});

// ---------------------------------------------------------------------------
// refuse / refusalOverride → typed refusals
// ---------------------------------------------------------------------------

const TITLE = 'Bestaande koopwoningen; gemiddelde verkoopprijzen, regio';

const EXPECTED: Record<TableLaneRefusalReason, { nl: string; en: string }> = {
  table_lane_ineligible: {
    nl: `Ik kan CBS-tabel "${TITLE}" niet gebruiken om deze vraag te beantwoorden.`,
    en: `I can't use CBS table "${TITLE}" to answer this question.`,
  },
  table_lane_no_measure: {
    nl: `In CBS-tabel "${TITLE}" staat geen cijfer dat precies bij deze vraag past.`,
    en: `CBS table "${TITLE}" has no figure that matches this question exactly.`,
  },
  table_lane_unsure: {
    nl: `Ik weet niet zeker welk cijfer uit CBS-tabel "${TITLE}" je bedoelt. Stel de vraag iets specifieker, bijvoorbeeld met het onderwerp, de groep of de periode.`,
    en: `I'm not sure which figure from CBS table "${TITLE}" you mean. Please ask a more specific question, for example naming the topic, the group or the period.`,
  },
  table_lane_period_unsupported: {
    nl: `Dit soort periode kan ik in CBS-tabel "${TITLE}" nog niet opzoeken. Noem een jaar, kwartaal of maand, of een reeks jaren.`,
    en: `I can't look up this kind of period in CBS table "${TITLE}" yet. Name a year, quarter or month, or a range of years.`,
  },
  table_lane_period_grain: {
    nl: `CBS-tabel "${TITLE}" heeft geen cijfers per jaar, kwartaal of maand zoals je vraagt. Probeer een andere periode-indeling.`,
    en: `CBS table "${TITLE}" has no figures per year, quarter or month the way you ask. Try a different kind of period.`,
  },
  table_lane_period_missing: {
    nl: `CBS-tabel "${TITLE}" heeft geen cijfer voor de gevraagde periode. De meest recente periode in deze tabel is 2025.`,
    en: `CBS table "${TITLE}" has no figure for the period you asked about. The most recent period in this table is 2025.`,
  },
  table_lane_region_class: {
    nl: `Deze vraag over een hele groep regio's (zoals alle provincies of gemeenten) kan ik niet uit CBS-tabel "${TITLE}" beantwoorden. Dat lukt alleen voor één periode tegelijk, en alleen als de tabel die groep zelf indeelt. Noem één jaar, kwartaal of maand, of de plaats die je bedoelt.`,
    en: `I can't answer this question about a whole group of regions (such as all provinces or municipalities) from CBS table "${TITLE}". That only works for one period at a time, and only when the table groups those regions itself. Name one year, quarter or month, or the place you mean.`,
  },
  table_lane_single_period: {
    nl: `Voor een verloop of een verandering zijn minstens twee perioden nodig, maar CBS-tabel "${TITLE}" heeft voor deze vraag maar één periode (2025). Vraag naar die ene periode, of noem een langere periode.`,
    en: `A trend or a change needs at least two periods, but CBS table "${TITLE}" has only one period for this question (2025). Ask about that one period, or name a longer period.`,
  },
  region_unknown: {
    nl: `De plaats of regio die je noemt, staat niet in CBS-tabel "${TITLE}". Controleer de naam of noem een andere plaats.`,
    en: `The place or region you name is not in CBS table "${TITLE}". Check the name or name another place.`,
  },
  region_unavailable: {
    nl: `CBS-tabel "${TITLE}" heeft geen cijfers voor de plaats of regio die je noemt.`,
    en: `CBS table "${TITLE}" has no figures for the place or region you name.`,
  },
  table_lane_too_large: {
    nl: `Deze vraag vraagt te veel cijfers tegelijk uit CBS-tabel "${TITLE}". Maak de vraag kleiner, bijvoorbeeld met één groep, één regio of minder jaren.`,
    en: `This question asks for too many figures at once from CBS table "${TITLE}". Make the question smaller, for example one group, one region or fewer years.`,
  },
  cbs_unreachable: {
    nl: 'CBS is op dit moment niet bereikbaar, dus ik kan dit cijfer nu niet ophalen. Probeer het later opnieuw.',
    en: "CBS can't be reached right now, so I can't fetch this figure. Please try again later.",
  },
  table_lane_failed: {
    nl: 'Het ophalen van deze CBS-tabel is niet gelukt. Je betaalt hier niets voor.',
    en: "Fetching this CBS table didn't work. You won't be charged for this.",
  },
};

describe('respondTableLane — refusals', () => {
  for (const reason of Object.keys(EXPECTED) as TableLaneRefusalReason[]) {
    it(`${reason} → its template (nl + en), audited once as a refusal`, async () => {
      const plan = refusePlan(
        reason,
        reason === 'table_lane_period_missing' || reason === 'table_lane_single_period' ? { latestPeriodCode: '2025JJ00' } : {},
      );
      for (const lang of ['nl', 'en'] as const) {
        const audited = await respondTableLane(db, {
          row: laneRow({ lang }),
          plan,
          fetch: null,
          referenceDate: REF,
          tableTitle: TITLE,
          respondOptions: options(lang),
        });
        const response = audited.response;
        if (response.kind !== 'refusal') throw new Error(`expected a refusal, got ${response.kind}`);
        expect(response.reason).toBe(reason);
        expect(response.text).toBe(EXPECTED[reason].nl);
        expect(response.text.trimEnd().endsWith('?')).toBe(false);
        expect(response.internalNote).toBe(`detail for ${reason}`);
        expect(response.tableLane?.parse).toEqual(PARSE);
        expect(response.tableLane?.parseAudit).toEqual(PARSE_AUDIT);
        expect(response.tableLane?.question).toBeNull();
        if (lang === 'en') expect(response.english?.text).toBe(EXPECTED[reason].en);
        else expect('english' in response).toBe(false);

        const record = await loadAuditRecord(db, audited.auditId!);
        expect(record!.kind).toBe('refusal');
        expect(record!.refusalReason).toBe(reason);
        expect(record!.tableIds).toEqual([]);
        expect(record!.llmCalls).toEqual([{ role: 'table_parse', model: 'stub-table-parse', inputTokens: 11, outputTokens: 5 }]);
      }
    });
  }

  it('without a title the template names the table id', async () => {
    const audited = await respondTableLane(db, {
      row: laneRow(),
      plan: refusePlan('table_lane_no_measure'),
      fetch: null,
      referenceDate: REF,
      respondOptions: options(),
    });
    expect(audited.response.text).toBe(`In CBS-tabel ${LANE_TABLE} staat geen cijfer dat precies bij deze vraag past.`);
  });

  it('period_missing without a latest code omits the latest-period sentence', async () => {
    const audited = await respondTableLane(db, {
      row: laneRow(),
      plan: refusePlan('table_lane_period_missing'),
      fetch: null,
      referenceDate: REF,
      tableTitle: TITLE,
      respondOptions: options(),
    });
    expect(audited.response.text).toBe(`CBS-tabel "${TITLE}" heeft geen cijfer voor de gevraagde periode.`);
  });

  it('a refusal with no model call (step 1) records NO table_parse call', async () => {
    const audited = await respondTableLane(db, {
      row: laneRow(),
      plan: refusePlan('table_lane_ineligible', { noParse: true }),
      fetch: null,
      referenceDate: REF,
      respondOptions: options(),
    });
    expect(audited.response.tableLane?.parseAudit).toBeNull();
    expect(audited.response.tableLane?.offeredMenuHash).toBeNull();
    const record = await loadAuditRecord(db, audited.auditId!);
    expect(record!.llmCalls).toEqual([]);
  });

  it('refusalOverride over a fetch plan → the override reason, the plan parse kept, no slice claimed', async () => {
    const plan = await fetchPlan();
    const audited = await respondTableLane(db, {
      row: laneRow(),
      plan,
      fetch: null,
      refusalOverride: { reason: 'cbs_unreachable', detail: 'ensureSlice failed twice at stage fetch' },
      referenceDate: REF,
      respondOptions: options(),
    });
    const response = audited.response;
    if (response.kind !== 'refusal') throw new Error('expected a refusal');
    expect(response.reason).toBe('cbs_unreachable');
    expect(response.internalNote).toBe('ensureSlice failed twice at stage fetch');
    expect(response.tableLane?.parse).toEqual(plan.parse);
    expect(response.tableLane?.sliceFilterKey).toBeNull();
    expect(response.tableLane?.selectionNote).toBeNull();
    expect(response.tableLane?.offeredMenuHash).toBe(offeredMenuHash(plan.offered));
    const record = await loadAuditRecord(db, audited.auditId!);
    expect(record!.refusalReason).toBe('cbs_unreachable');
    expect(record!.llmCalls.map((c) => c.role)).toEqual(['table_parse']);
  });
});

// ---------------------------------------------------------------------------
// present-only: nothing outside the lane carries the key
// ---------------------------------------------------------------------------

describe('tableLane is present-only', () => {
  it('a curated (non-lane) answer and the internal refusal carry NO tableLane key', async () => {
    const plan = await fetchPlan();
    await storeSlice(plan);
    const curated = await respondToIntent(
      db,
      LANE_QUESTION,
      {
        kind: 'intent',
        question: LANE_QUESTION,
        raw: { version: 4, kind: 'data_query', candidates: [], unmatchedMeasureTerm: null, nearestCanonicalKeys: [], note: null },
        model: 'stub',
        usage: { inputTokens: 0, outputTokens: 0 },
        intent: plan.intent,
        confidence: 0.97,
        impliedRecency: false,
        ranked: [],
      },
      { answerClient: new ThrowingAnswerClient(), referenceDate: REF },
    );
    expect(curated.kind).toBe('answer');
    expect('tableLane' in curated).toBe(false);
    expect('tableLane' in toInternalRefusal(LANE_QUESTION, 'x')).toBe(false);
  });
});

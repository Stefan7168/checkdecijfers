// Eurostat E2a final-review fix wave (C1, ruling R7): the chip must be
// clickable END TO END — offer → client-held pending → the click trust
// boundary → the take-path → a validated, Eurostat-attributed answer whose
// audit row reconstructs. The final review found the trust boundary
// (validate-pending.ts) stripped every Eurostat chip (2-letter geo codes, a
// key outside CANONICAL_KEYS) and no test walked the whole path; this one
// does, hermetically (PGlite, the real CBS fixtures + the hand-inserted
// Eurostat table), with THROWING LLM clients: a click is the deterministic
// rung, so any LLM call here is a failure by construction.
//
// Every step uses the production function the web action uses:
//   - offer: resolveCandidate → decide (the same pair parseQuestion runs),
//     then toClarificationResponse (what respondToParseOutcome returns);
//   - the client round trip: a JSON copy of the pending;
//   - the trust boundary: withValidatedClickOptions (web/app/actions.ts);
//   - the click: answerClarificationReplyAudited (the backend function the
//     web action's reply turn calls) with the chip's label as the reply;
//   - R8: loadAuditRecord + reconstructionReport — what `npm run
//     audit:verify` runs per row.
// The sibling pair is INJECTED (the production map ships empty) into all
// three places that read it: the resolver, the policy's offer gate, and the
// trust boundary.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../../src/db/types.ts';
import { createIngestedDb } from '../helpers/ingested-db.ts';
import {
  EUROSTAT_TEST_CANONICAL_KEY,
  EUROSTAT_TEST_TABLE_ID,
  insertEurostatTestTable,
} from '../helpers/eurostat-test-table.ts';
import { decide, isResolutionFailure, resolveCandidate } from '../../src/answer/intent/index.ts';
import type { OutcomeContext, ParserConfig, RawCandidate, RawParse } from '../../src/answer/intent/index.ts';
import { toClarificationResponse } from '../../src/answer/respond/refusals.ts';
import { validateClickOptions, withValidatedClickOptions } from '../../src/answer/respond/validate-pending.ts';
import type { PendingClarification } from '../../src/answer/respond/index.ts';
import {
  answerClarificationReplyAudited,
  loadAuditRecord,
  reconstructionReport,
} from '../../src/answer/audit/index.ts';
import type { LlmClient, LlmResponse } from '../../src/answer/llm/client.ts';
import { echoServability } from '../../src/query/index.ts';
import { SOURCES } from '../../src/sources/registry.ts';

const UNEMPLOYMENT_KEY = 'unemployment_rate_seasonally_adjusted';
const SIBLINGS = { [UNEMPLOYMENT_KEY]: EUROSTAT_TEST_CANONICAL_KEY };
const CHIP_LABEL = 'Toon de Eurostat-cijfers';
const QUESTION = 'Hoe hoog was de werkloosheid in Duitsland in 2021?';
const REFERENCE_DATE = '2021-06-15';

/** Any call to this is a test failure by construction. */
class ThrowingClient implements LlmClient {
  async complete(): Promise<LlmResponse> {
    throw new Error('LLM call attempted on the deterministic click path');
  }
}

let db: Db;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createIngestedDb());
  // DE 2021 flagged 'e' (schatting): the answer must carry Eurostat's OWN
  // marking and still pass R11 (fix wave I2) on the very path a click takes.
  await insertEurostatTestTable(db, { statusOverrides: { 'DE|2021': 'e' } });
}, 300_000);

afterAll(async () => {
  await close();
});

const candidate: RawCandidate = {
  canonicalKey: UNEMPLOYMENT_KEY,
  regions: [{ name: 'Duitsland', kind: 'onbekend' }],
  period: { kind: 'year', year: 2021 },
  derivation: 'none',
  confidence: 0.95,
  reading: 'werkloosheid in Duitsland in 2021',
};

function context(): OutcomeContext {
  const raw: RawParse = {
    version: 3,
    kind: 'data_query',
    candidates: [candidate],
    unmatchedMeasureTerm: null,
    nearestCanonicalKeys: [],
    note: null,
  };
  return { question: QUESTION, raw, model: 'test', usage: { inputTokens: 0, outputTokens: 0 } };
}

const config: ParserConfig = { answerThreshold: 0.9, runnerUpThreshold: 0.35 };

/** The offer, exactly as the first turn builds it, as the CLIENT holds it. */
async function offeredPending(): Promise<PendingClarification> {
  const resolution = await resolveCandidate(db, candidate, REFERENCE_DATE, {
    clickOptionsEnabled: true,
    eurostatSiblings: SIBLINGS,
  });
  expect(isResolutionFailure(resolution) && resolution.reason).toBe('other_source_available');
  const outcome = await decide(
    context(),
    [resolution],
    config,
    (intent) => echoServability(db, intent),
    undefined,
    true,
    { eurostatSiblings: SIBLINGS },
  );
  if (outcome.kind !== 'clarification') throw new Error(`expected a clarification, got ${outcome.kind}`);
  const response = toClarificationResponse({
    question: QUESTION,
    referenceDate: REFERENCE_DATE,
    axes: outcome.axes,
    questionNl: outcome.question_nl,
    options: outcome.options,
    parse: outcome,
    conversationContext: null,
    ...(outcome.clickOptions ? { clickOptions: outcome.clickOptions } : {}),
  });
  expect(response.suggestions).toEqual([CHIP_LABEL]);
  // Client-held between the turns: only what survives JSON comes back.
  return JSON.parse(JSON.stringify(response.pending)) as PendingClarification;
}

describe('Eurostat chip: offer → trust boundary → click → validated Eurostat answer (C1)', () => {
  it('the offered chip carries a 2-letter Eurostat geo code and a sibling key outside CANONICAL_KEYS', async () => {
    const pending = await offeredPending();
    expect(pending.clickOptions).toHaveLength(1);
    const intent = pending.clickOptions![0]!.intent;
    expect(intent.target).toEqual({ kind: 'canonical', key: EUROSTAT_TEST_CANONICAL_KEY });
    expect(intent.regions).toEqual(['DE']);
  });

  it('the trust boundary keeps the chip with the sibling map, and still drops it with the production (empty) map', async () => {
    const pending = await offeredPending();
    expect(withValidatedClickOptions(pending, { eurostatSiblings: SIBLINGS })).toEqual(pending);
    // Production today: activeEurostatSiblings() is empty (EUROSTAT_SIBLINGS_ENABLED
    // unset), so the boundary is as closed as before this fix — the chip never
    // reaches the take-path.
    expect(withValidatedClickOptions(pending).clickOptions).toBeUndefined();
  });

  it('a forged sibling option is still dropped: a CBS region code, an unknown geo code, or a key outside the sibling map', async () => {
    const pending = await offeredPending();
    const option = pending.clickOptions![0]!;
    const forged = [
      { ...option, intent: { ...option.intent, regions: ['GM0363'] } },
      { ...option, intent: { ...option.intent, regions: ['US'] } },
      { ...option, intent: { ...option.intent, target: { kind: 'canonical', key: 'eu_not_a_sibling' } } },
      { ...option, intent: { ...option.intent, regions: undefined } },
    ];
    expect(validateClickOptions(forged, { eurostatSiblings: SIBLINGS })).toEqual([]);
  });

  it('the click answers from the Eurostat table: validation.ok, Eurostat attribution, zero LLM calls, and the audit row reconstructs', async () => {
    const pending = await offeredPending();
    const safePending = withValidatedClickOptions(pending, { eurostatSiblings: SIBLINGS });
    const outcome = await answerClarificationReplyAudited(db, safePending, CHIP_LABEL, {
      intentClient: new ThrowingClient(),
      answerClient: new ThrowingClient(),
      referenceDate: REFERENCE_DATE,
      clickOptionsEnabled: true,
      sourceTag: 'validation',
    });

    const response = outcome.response;
    if (response.kind !== 'answer') throw new Error(`expected an answer, got ${response.kind}: ${response.text}`);
    // Every number from the Eurostat table (R1): the one DE 2021 cell.
    expect(response.result.cells).toHaveLength(1);
    const cell = response.result.cells[0]!;
    expect(cell.tableId).toBe(EUROSTAT_TEST_TABLE_ID);
    expect(cell.regionCode).toBe('DE');
    expect(cell.periodCode).toBe('2021JJ00');
    expect(cell.value).toBeCloseTo(5.2, 10); // helper: DE base 5.1 + 0.1 for the 2nd year
    expect(response.answer.body).toContain('5,2');
    expect(response.answer.body).toContain('Duitsland');
    // Attributed to Eurostat, not CBS StatLine (R4).
    expect(response.result.attribution.source).toBe('eurostat');
    expect(response.answer.attributionLine).toMatch(/^Bron: Eurostat, dataset /);
    // The flagged cell carries Eurostat's own marking AND passes R11 (I2).
    expect(response.answer.body).toContain(SOURCES.eurostat!.provisionalDisplay.e!);
    expect(response.answer.validation.ok).toBe(true);
    expect(response.answer.validation.problems).toEqual([]);
    // The deterministic rung: template answer, no model, no LLM call.
    expect(response.answer.source).toBe('template');
    expect(response.answer.model).toBeNull();

    expect(outcome.auditId).not.toBeNull();
    const record = await loadAuditRecord(db, outcome.auditId!);
    if (record === null) throw new Error('audit row missing');
    expect(record.kind).toBe('answer');
    expect(record.replyText).toBe(CHIP_LABEL);
    expect(record.llmCalls).toEqual([]);
    expect(reconstructionReport(record).problems).toEqual([]);
    expect(reconstructionReport(record).ok).toBe(true);
  });
});

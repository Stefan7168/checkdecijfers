// WP9 staleness tests — docs/05 staleness row, both branches (warn-and-serve
// for covered historical periods, refuse when the question implies recency),
// clock-injected (never the wall clock). Cadence mapping + comparator
// boundary pins per the mutation-test lesson (ADR 012's discipline: an
// off-by-one at the boundary is exactly the kind of bug a naive `>=` hides).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../../src/db/types.ts';
import { checkStaleness, maxAgeDaysForCadence, respondToIntent } from '../../src/answer/respond/index.ts';
import type { LlmClient, LlmResponse } from '../../src/answer/llm/client.ts';
import type { ParseOutcome } from '../../src/answer/intent/types.ts';
import { makeCell, makeResult } from '../helpers/synthetic-results.ts';
import { createIngestedDb } from '../helpers/ingested-db.ts';

/** Errors so composeAnswer falls through to the deterministic template path
 * (same pattern as compose-template.test.ts's ThrowingClient) — the
 * recency-refusal branch must never even reach the LLM, but when it DOES
 * fall through to compose (the warn-and-serve branch), this keeps that half
 * hermetic too. */
class ThrowingAnswerClient implements LlmClient {
  calls = 0;
  async complete(): Promise<LlmResponse> {
    this.calls += 1;
    throw new Error('should not be called in this test');
  }
}

/** Minimal 'intent' ParseOutcome stub — respondToIntent only reads
 * .intent/.impliedRecency/.question off it; the rest is audit-trail
 * plumbing this test does not exercise. */
function stubIntentOutcome(overrides: Partial<Extract<ParseOutcome, { kind: 'intent' }>> = {}): Extract<
  ParseOutcome,
  { kind: 'intent' }
> {
  return {
    kind: 'intent',
    question: 'Wat is de inflatie nu?',
    raw: {
      version: 2,
      kind: 'data_query',
      candidates: [],
      unmatchedMeasureTerm: null,
      nearestCanonicalKeys: [],
      note: null,
    },
    model: 'stub',
    usage: { inputTokens: 0, outputTokens: 0 },
    intent: {
      schemaVersion: 1,
      target: { kind: 'canonical', key: 'cpi_yearly_inflation' },
      period: { kind: 'codes', codes: ['2024JJ00'] },
      derivation: 'none',
    },
    confidence: 0.97,
    impliedRecency: true,
    ranked: [],
    ...overrides,
  };
}

describe('maxAgeDaysForCadence (pure)', () => {
  it('maps monthly/quarterly/yearly prefixes to their thresholds', () => {
    expect(maxAgeDaysForCadence('monthly')).toBe(47);
    expect(maxAgeDaysForCadence('monthly (~22 days after each month)')).toBe(47);
    expect(maxAgeDaysForCadence('quarterly')).toBe(138);
    expect(maxAgeDaysForCadence('yearly')).toBe(549);
    expect(maxAgeDaysForCadence('yearly (next CBS update Q2 2027)')).toBe(549);
  });

  it('is case-insensitive on the cadence prefix', () => {
    expect(maxAgeDaysForCadence('Monthly')).toBe(47);
    expect(maxAgeDaysForCadence('YEARLY')).toBe(549);
  });

  it('an unknown or absent cadence never triggers staleness (null = no expectation)', () => {
    expect(maxAgeDaysForCadence(null)).toBeNull();
    expect(maxAgeDaysForCadence('')).toBeNull();
    expect(maxAgeDaysForCadence('irregular')).toBeNull();
    expect(maxAgeDaysForCadence('weekly')).toBeNull();
  });
});

describe('checkStaleness — comparator boundary (db-backed, real registry cadence)', () => {
  let db: Db;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createIngestedDb());
  }, 300_000);

  afterAll(async () => {
    await close();
  });

  // 86141NED (CPI) is registered 'monthly' -> maxAgeDays 47.
  function cpiResultSyncedAt(syncedAt: string) {
    const result = makeResult({
      shape: 'single',
      cells: [
        makeCell({
          table: '86141NED', measure: 'M000238', measureTitle: 'Jaarmutatie CPI',
          periodCode: '2024JJ00', periodLabel: '2024', value: 3.3, unit: '%', decimals: 1,
        }),
      ],
    });
    result.attribution.syncedAt = syncedAt;
    return result;
  }

  it('age == maxAgeDays is NOT stale (boundary pin)', async () => {
    // 47 days exactly, synced at start of day, reference at end of same
    // 47th day: floor(days) === 47, must NOT exceed.
    const synced = '2026-01-01T00:00:00.000Z';
    const referenceDate = '2026-02-17'; // 2026-01-01 -> 2026-02-17 is 47 days
    const result = cpiResultSyncedAt(synced);
    const check = await checkStaleness(db, result, referenceDate);
    expect(check.stale).toBe(false);
    expect(check.warning).toBeNull();
  });

  it('age == maxAgeDays + 1 IS stale (boundary pin)', async () => {
    const synced = '2026-01-01T00:00:00.000Z';
    const referenceDate = '2026-02-18'; // 48 days
    const result = cpiResultSyncedAt(synced);
    const check = await checkStaleness(db, result, referenceDate);
    expect(check.stale).toBe(true);
    expect(check.warning).not.toBeNull();
  });

  it('fresh result: warning is null', async () => {
    const result = cpiResultSyncedAt('2026-06-01T00:00:00.000Z');
    const check = await checkStaleness(db, result, '2026-07-03');
    expect(check.stale).toBe(false);
    expect(check.warning).toBeNull();
  });

  it('stale result: warning names the sync date and the expected cadence in Dutch words', async () => {
    const result = cpiResultSyncedAt('2025-01-01T00:00:00.000Z');
    const check = await checkStaleness(db, result, '2026-07-03');
    expect(check.stale).toBe(true);
    expect(check.warning).toContain('2025-01-01');
    expect(check.warning).toContain('maandelijks');
  });

  it('yearly-cadence table (housing stock, 82235NED): boundary at 549/550 days', async () => {
    const cell = makeCell({
      table: '82235NED', measure: 'D002936', measureTitle: 'Beginstand voorraad',
      periodCode: '2024JJ00', periodLabel: '2024', value: 8204, unit: 'x 1 000',
    });
    const notStale = makeResult({ shape: 'single', cells: [cell] });
    notStale.attribution.syncedAt = '2025-01-01T00:00:00.000Z';
    const checkNotStale = await checkStaleness(db, notStale, '2026-07-03'); // 548 days
    expect(checkNotStale.stale).toBe(false);

    const stale = makeResult({ shape: 'single', cells: [cell] });
    stale.attribution.syncedAt = '2024-12-01T00:00:00.000Z';
    const checkStale = await checkStaleness(db, stale, '2026-07-03'); // > 549 days
    expect(checkStale.stale).toBe(true);
    expect(checkStale.warning).toContain('jaarlijks');
  });

  it('quarterly-cadence table (unemployment, 85224NED) names "per kwartaal"', async () => {
    const cell = makeCell({
      table: '85224NED', measure: 'M001906', measureTitle: 'Werkloosheidspercentage',
      periodCode: '2025KW04', periodLabel: '2025 4e kwartaal', value: 4.0, unit: '%', decimals: 1,
    });
    const result = makeResult({ shape: 'single', cells: [cell] });
    result.attribution.syncedAt = '2025-01-01T00:00:00.000Z';
    const check = await checkStaleness(db, result, '2026-07-03');
    expect(check.stale).toBe(true);
    expect(check.warning).toContain('per kwartaal');
  });
});

describe('respondToIntent — recency-refusal branch (respond-level unit)', () => {
  let db: Db;
  let close: () => Promise<void>;

  beforeAll(async () => {
    ({ db, close } = await createIngestedDb());
  }, 300_000);

  afterAll(async () => {
    await close();
  });

  // respondToIntent calls runQuery ITSELF from the intent (it does not reuse
  // a pre-fetched ValidatedResult), so staleness must be forced at its
  // source: the registered table's last_sync_at. Mutating an outcome object
  // built by a throwaway runQuery call would be invisible to it.
  async function setLastSyncAt(tableId: string, iso: string): Promise<void> {
    await db.query('update cbs_tables set last_sync_at = $2 where id = $1', [tableId, iso]);
  }

  it('stale + impliedRecency=true refuses (never serves an answer or a warning-only answer)', async () => {
    await setLastSyncAt('86141NED', '2020-01-01T00:00:00.000Z');

    const parse = stubIntentOutcome();
    const answerClient = new ThrowingAnswerClient();
    const response = await respondToIntent(db, 'Wat is de inflatie nu?', parse, {
      answerClient,
      referenceDate: '2026-07-03',
    });

    expect(response.kind).toBe('refusal');
    if (response.kind !== 'refusal') throw new Error('unreachable');
    expect(response.reason).toBe('staleness');
    expect(answerClient.calls).toBe(0); // never even reaches compose/the LLM
  });

  it('stale + impliedRecency=false warns and serves: warning is APPENDED, ComposedAnswer.text unchanged (R4 attribution intact)', async () => {
    await setLastSyncAt('86141NED', '2020-01-01T00:00:00.000Z');

    const parse = stubIntentOutcome({ impliedRecency: false });
    // ThrowingAnswerClient drives composeAnswer down to the template path —
    // deterministic, and proves the warning-append logic independent of any
    // particular LLM body.
    const answerClient = new ThrowingAnswerClient();
    const response = await respondToIntent(db, 'Wat was de inflatie in 2024?', parse, {
      answerClient,
      referenceDate: '2026-07-03',
    });

    expect(response.kind).toBe('answer');
    if (response.kind !== 'answer') throw new Error('unreachable');
    expect(response.stalenessWarning).not.toBeNull();
    // The warning is appended AFTER the full composed answer text, never
    // spliced into or replacing it.
    expect(response.text.startsWith(response.answer.text)).toBe(true);
    expect(response.text).toContain(response.stalenessWarning!);
    // R4: attribution line is still exactly what compose produced — the
    // staleness warning is a structural addition, not a rewrite.
    expect(response.answer.text).toContain(response.answer.attributionLine);
  });

  it('the recency-refusal offer carries the R11 status marker when the offered period is provisional', async () => {
    await setLastSyncAt('86141NED', '2020-01-01T00:00:00.000Z');

    // 2026MM06 is the CPI slice's freshest month and carries status
    // Voorlopig (the same cell the B20 frozen-key reference pins) — the
    // refusal's "vraag naar {periode}" offer must mark it (adversarial-review
    // fix, 2026-07-03: the marker was omitted on this one offer path).
    const parse = stubIntentOutcome({
      intent: {
        schemaVersion: 1,
        target: { kind: 'canonical', key: 'cpi_yearly_inflation' },
        period: { kind: 'codes', codes: ['2026MM06'] },
        derivation: 'none',
      },
    });
    const response = await respondToIntent(db, 'Wat is de inflatie nu?', parse, {
      answerClient: new ThrowingAnswerClient(),
      referenceDate: '2026-08-15',
    });

    expect(response.kind).toBe('refusal');
    if (response.kind !== 'refusal') throw new Error('unreachable');
    expect(response.reason).toBe('staleness');
    expect(response.text).toMatch(/voorlopig cijfer/);
  });

  it('finalRound: a query-level needs_clarification becomes the still-ambiguous refusal, never a second question (R7)', async () => {
    // A geo canonical measure with NO regions: the intent layer's documented
    // pass-through leaves the missing-region check to the query layer, whose
    // needs_clarification would become a ClarificationResponse — legitimate
    // on the first turn, an R7 violation on a reply turn (adversarial-review
    // HIGH finding, 2026-07-03).
    const parse = stubIntentOutcome({
      impliedRecency: false,
      intent: {
        schemaVersion: 1,
        target: { kind: 'canonical', key: 'population_on_1_january' },
        period: { kind: 'codes', codes: ['2024JJ00'] },
        derivation: 'none',
      },
    });

    const replyTurn = await respondToIntent(db, 'Hoeveel inwoners waren er in 2024?', parse, {
      answerClient: new ThrowingAnswerClient(),
      referenceDate: '2026-08-15',
      finalRound: true,
    });
    expect(replyTurn.kind).toBe('refusal');
    if (replyTurn.kind !== 'refusal') throw new Error('unreachable');
    expect(replyTurn.reason).toBe('still_ambiguous');

    const firstTurn = await respondToIntent(db, 'Hoeveel inwoners waren er in 2024?', parse, {
      answerClient: new ThrowingAnswerClient(),
      referenceDate: '2026-08-15',
    });
    expect(firstTurn.kind).toBe('clarification'); // the first turn MAY ask
    if (firstTurn.kind !== 'clarification') throw new Error('unreachable');
    // docs/05: the offered options resolve in the loaded data.
    expect(firstTurn.options.length).toBeGreaterThan(0);
    expect(firstTurn.options[0]).toMatch(/Nederland/);
  });
});

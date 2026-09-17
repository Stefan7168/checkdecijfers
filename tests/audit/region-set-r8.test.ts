// #253 Task 7 — R8 for the region-class shape: does a stored region-set row
// reconstruct from the stored row ALONE?
//
// Three things are new about this shape, and each needed its own reconstruction
// check rather than riding along on the existing ones:
//
//  1. `ComposedAnswer.regionSetLine` — a structural disclosure line, like
//     `assumptionLine`, so it must RE-DERIVE byte-identically through the same
//     builder (`buildRegionSetLine`) and must take part in the text
//     re-assembly. Before Task 7 it did neither: reconstruct re-assembled the
//     answer text without it, so every region-set row would have failed R8 on
//     a line the composer really did write.
//  2. `ValidatedResult.regionSet` — the coverage record. It is not merely
//     stored trivia: it is what the disclosure sentence is computed from and
//     what RS1 (no ranking over an incomplete class) keys on. A tampered
//     coverage record must therefore fail loudly, which it does because the
//     re-derived line no longer matches the stored one.
//  3. The BODY of a region-set answer is deterministic — composeAnswer is
//     template-only BY SHAPE for `region_set` (zero LLM calls, Task 6) — so
//     unlike every other answer body this one has a deterministic ground truth
//     and is re-derived byte-identically, not merely re-validated. The pin
//     below proves that catches a body edit the R1/R3/R9 validator alone would
//     accept.
//
// Plus the refusal side: `QueryRefusal.refusal.subReason` is a new present-only
// key, and it is the ONLY thing that distinguishes the honest
// 'region_scope_on_national_measure' refusal from the generic internal one that
// PAGES THE OWNER. So the stored pairing (reason ⟺ sub-reason) is checked in
// both directions, exactly like the WP16 onboarding pairing it is modelled on.
//
// Session 110 (row 13, ADR 054 addendum) added a SECOND honest sub-reason,
// 'multi_region_multi_period' ("several regions AND several periods in one
// question" — ADR 011's one-varying-axis rule), reusing the same field and
// the same both-directions pairing check in reconstruct.ts — now generalized
// to a subReason→reason map so a sub-reason bolted onto its SIBLING (the
// other honest reason) is caught too, not only onto an unrelated refusal.
//

// Everything is driven from REAL results of the hermetic ingest (ADR 009)
// through a hand-authored intent — the parser cannot reach this shape until
// Task 9 (owner-supervised, real LLM spend). Test ORDER is load-bearing from
// "an incomplete class" onwards: that block mutates this suite's own private
// PGlite (tests/helpers/fixture-snapshot.ts gives every createIngestedDb
// caller its own).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { respondToIntent } from '../../src/answer/respond/respond.ts';
import { buildAuditRow, type AuditContext } from '../../src/answer/audit/write.ts';
import { reconstructionReport } from '../../src/answer/audit/reconstruct.ts';
import type { AuditRecord } from '../../src/answer/audit/types.ts';
import type { AnswerResponse, ComposedResponse, RefusalResponse } from '../../src/answer/respond/types.ts';
import type { ParseOutcome } from '../../src/answer/intent/types.ts';
import type { StructuredIntent } from '../../src/query/index.ts';
import type { LlmClient, LlmResponse } from '../../src/answer/llm/client.ts';
import type { Db } from '../../src/db/types.ts';
import { createIngestedDb } from '../helpers/ingested-db.ts';

let db: Db;
let close: () => Promise<void>;

const REFERENCE_DATE = '2026-07-15';
const POPULATION_MEASURE = 'M000352';

/** Fails the test if the phrasing model is ever reached — `region_set` is
 * template-only by shape, which is also what makes its body re-derivable. */
class UnreachableLlmClient implements LlmClient {
  async complete(): Promise<LlmResponse> {
    throw new Error('a region_set turn must never reach the LLM');
  }
}

const CONTEXT: AuditContext = {
  referenceDate: REFERENCE_DATE,
  userId: null,
  sourceTag: 'validation',
  requestId: null,
  replyText: null,
  pendingClarification: null,
  conversationContext: null,
  llmCalls: [],
  latencyMs: 7,
};

/** A hand-built 'intent' ParseOutcome — never an LLM parse (the region-class
 * intent is unreachable through the parser until Task 9). Mirrors
 * tests/benchmark/scorer-teeth.test.ts's stub. */
function stubIntent(question: string, intent: StructuredIntent): Extract<ParseOutcome, { kind: 'intent' }> {
  return {
    kind: 'intent',
    question,
    raw: {
      version: 3,
      kind: 'data_query',
      candidates: [],
      unmatchedMeasureTerm: null,
      nearestCanonicalKeys: [],
      note: null,
    },
    model: 'stub',
    usage: { inputTokens: 0, outputTokens: 0 },
    intent,
    confidence: 0.97,
    impliedRecency: false,
    ranked: [],
  };
}

async function respond(question: string, intent: StructuredIntent): Promise<ComposedResponse> {
  return respondToIntent(db, question, stubIntent(question, intent), {
    answerClient: new UnreachableLlmClient(),
    referenceDate: REFERENCE_DATE,
  });
}

/** The stored row, as a reader in 2027 meets it: through JSON, so a
 * present-only key that was never serialized really is absent (the exact
 * shape the `?? null` discipline exists for — docs/13). */
function recordFor(response: ComposedResponse): AuditRecord {
  const row = buildAuditRow(response, CONTEXT);
  return JSON.parse(JSON.stringify({ ...row, id: 1, createdAt: '2026-07-15T00:00:00.000Z' })) as AuditRecord;
}

/** Re-assembles the three text copies of a tampered ANSWER record from its
 * (tampered) parts, in composeAnswer's own order. Used so a tamper test can
 * isolate ONE reconstruction check: without it every body/line edit would also
 * trip the text-reassembly check, and the assertion would prove nothing about
 * the check under test. */
function reassemble(record: AuditRecord): void {
  const response = record.response as AnswerResponse;
  const a = response.answer;
  const text = [
    a.body,
    '',
    ...(a.assumptionLine ? [a.assumptionLine] : []),
    ...(a.regionSetLine ? [a.regionSetLine] : []),
    ...(a.definitionLine ? [a.definitionLine] : []),
    ...(a.alternatesLine ? [a.alternatesLine] : []),
    ...(a.markingLine ? [a.markingLine] : []),
    a.attributionLine,
  ].join('\n');
  a.text = text;
  response.text =
    response.stalenessWarning === null ? text : `${text}\n\n${response.stalenessWarning}`;
  record.finalText = response.text;
}

function clone(record: AuditRecord): AuditRecord {
  return JSON.parse(JSON.stringify(record)) as AuditRecord;
}

function population(extra: Partial<StructuredIntent>): StructuredIntent {
  return {
    schemaVersion: 1,
    target: { kind: 'canonical', key: 'population_on_1_january' },
    period: { kind: 'codes', codes: ['2025JJ00'] },
    derivation: 'none',
    ...extra,
  };
}

async function answerRecord(question: string, intent: StructuredIntent): Promise<AuditRecord> {
  const response = await respond(question, intent);
  if (response.kind !== 'answer') {
    throw new Error(`expected an answer, got ${response.kind}`);
  }
  return recordFor(response);
}

function answerOf(record: AuditRecord): AnswerResponse {
  if (record.response.kind !== 'answer') throw new Error('not an answer record');
  return record.response;
}

beforeAll(async () => {
  ({ db, close } = await createIngestedDb());
}, 300_000);

afterAll(async () => {
  await close();
});

describe('R8: a COMPLETE region-set answer row', () => {
  let record: AuditRecord;

  beforeAll(async () => {
    record = await answerRecord('bevolking per provincie in 2025', population({ regionSet: { kind: 'all_provincies' } }));
  }, 300_000);

  it('reconstructs: body, coverage line and chart spec all re-derive from the stored result', () => {
    const response = answerOf(record);
    // Confirms this row really exercises the boundary under test rather than
    // silently testing an ordinary answer.
    expect(response.result.shape).toBe('region_set');
    expect(response.result.regionSet?.complete).toBe(true);
    expect(response.answer.source).toBe('template');
    expect(response.answer.regionSetLine).toEqual(expect.any(String));
    expect(response.chart).not.toBeNull();

    expect(reconstructionReport(record).problems).toEqual([]);
  });

  it('a tampered coverage record fails loudly — `complete` flipped', () => {
    const tampered = clone(record);
    const response = answerOf(tampered);
    response.result.regionSet!.complete = false;
    const report = reconstructionReport(tampered);
    // The flip changes what the disclosure sentence must say (RS1's "daarom
    // noemt dit antwoord geen rangorde"), so the stored line no longer
    // re-derives — the coverage record is checked THROUGH the line it
    // determines, which is the only thing the user ever saw of it.
    expect(report.problems.some((p) => p.includes('region-set coverage line does not re-derive'))).toBe(true);
    expect(report.ok).toBe(false);
  });

  it('a tampered coverage record fails loudly — a member invented in `missing`', () => {
    const tampered = clone(record);
    answerOf(tampered).result.regionSet!.missing = ['PV20'];
    const report = reconstructionReport(tampered);
    expect(report.problems.some((p) => p.includes('region-set coverage line does not re-derive'))).toBe(true);
  });

  it('a tampered regionSetLine fails loudly', () => {
    const tampered = clone(record);
    answerOf(tampered).answer.regionSetLine = 'Dekking: alle gemeenten van Nederland hebben een cijfer.';
    reassemble(tampered);
    const report = reconstructionReport(tampered);
    expect(report.problems.some((p) => p.includes('region-set coverage line does not re-derive'))).toBe(true);
  });

  it('a STRIPPED regionSetLine fails too — `?? null` must not be an escape hatch', () => {
    const tampered = clone(record);
    delete answerOf(tampered).answer.regionSetLine;
    reassemble(tampered);
    expect(
      reconstructionReport(tampered).problems.some((p) => p.includes('region-set coverage line does not re-derive')),
    ).toBe(true);
  });

  it('a body edit the numeric validator would accept STILL fails — this shape has a deterministic ground truth', () => {
    const tampered = clone(record);
    const response = answerOf(tampered);
    // Drop the "lowest value" sentence. Every remaining digit is still backed
    // by a stored cell, so validateAnswerBody is perfectly happy — only the
    // byte-identical re-derivation of the deterministic template body catches
    // it. That is the whole point of treating this body as `rederived`.
    const sentences = response.answer.body.split('. ');
    expect(sentences.length).toBeGreaterThan(1);
    response.answer.body = `${sentences.slice(0, -1).join('. ')}.`;
    reassemble(tampered);
    const report = reconstructionReport(tampered);
    expect(report.problems.some((p) => p.includes('region-set body does not re-derive'))).toBe(true);
    expect(report.problems.some((p) => p.includes('fails re-validation'))).toBe(false);
  });
});

describe('R8: an INCOMPLETE region-set answer row', () => {
  let record: AuditRecord;

  beforeAll(async () => {
    // No loaded table produces a withheld cell naturally, so seed one: PV20's
    // population becomes Confidential — a value that EXISTS but is not
    // disclosed. RS1 then suppresses the ranking derivation, the body becomes
    // the per-member list, and the disclosure line names the withheld member.
    await db.query(
      `update observations set value = null, value_attribute = 'Confidential'
        where table_id = '03759ned' and measure = $1 and region_code = 'PV20' and period_code = '2025JJ00'`,
      [POPULATION_MEASURE],
    );
    record = await answerRecord('bevolking per provincie in 2025', population({ regionSet: { kind: 'all_provincies' } }));
  }, 300_000);

  it('reconstructs — no ranking record, list body, coverage line naming the withheld member', () => {
    const response = answerOf(record);
    expect(response.result.regionSet).toMatchObject({ withheld: ['PV20'], complete: false });
    expect(response.result.derivations.some((d) => d.kind === 'max')).toBe(false);
    expect(response.answer.regionSetLine).toContain('geen rangorde');

    expect(reconstructionReport(record).problems).toEqual([]);
  });

  it('a member moved from `withheld` to `missing` fails loudly', () => {
    const tampered = clone(record);
    const coverage = answerOf(tampered).result.regionSet!;
    coverage.withheld = [];
    coverage.missing = ['PV20'];
    const report = reconstructionReport(tampered);
    expect(report.problems.some((p) => p.includes('region-set coverage line does not re-derive'))).toBe(true);
  });
});

describe('R8: rows that predate #253 are untouched', () => {
  it('an ordinary answer row carries NEITHER new key, and still reconstructs', async () => {
    const record = await answerRecord(
      'hoeveel inwoners had Utrecht in 2025',
      population({ regions: ['PV26'] }),
    );
    const response = answerOf(record);
    // The present-only contract, checked on the SERIALIZED row: an answer that
    // is not a region-class answer serializes neither key at all, so a reader
    // must reach them through `?? null` — `undefined !== null` is the WP16
    // bug docs/13 was written about.
    expect('regionSet' in response.result).toBe(false);
    expect('regionSetLine' in response.answer).toBe(false);

    expect(reconstructionReport(record).problems).toEqual([]);
  });
});

describe('R8: the region-class refusal and its sub-reason', () => {
  let record: AuditRecord;

  beforeAll(async () => {
    const response = await respond('wat is de werkloosheid per provincie', {
      schemaVersion: 1,
      target: { kind: 'canonical', key: 'unemployment_rate_seasonally_adjusted' },
      period: { kind: 'codes', codes: ['2024KW04'] },
      derivation: 'none',
      regionSet: { kind: 'all_provincies' },
    });
    if (response.kind !== 'refusal') throw new Error(`expected a refusal, got ${response.kind}`);
    record = recordFor(response);
  }, 300_000);

  it('reconstructs — the stored sub-reason matches the served reason', () => {
    const refusal = record.response as RefusalResponse;
    expect(refusal.reason).toBe('region_scope_on_national_measure');
    expect(refusal.queryRefusal?.refusal.subReason).toBe('region_scope_on_national_measure');

    expect(reconstructionReport(record).problems).toEqual([]);
  });

  it('a stripped sub-reason fails loudly — the row would claim a wording its own refusal cannot produce', () => {
    const tampered = clone(record);
    delete (tampered.response as RefusalResponse).queryRefusal!.refusal.subReason;
    const report = reconstructionReport(tampered);
    expect(report.problems.some((p) => p.includes('subReason'))).toBe(true);
    expect(report.ok).toBe(false);
  });

  it('a sub-reason bolted onto an unrelated refusal fails loudly too — the pairing is checked both ways', async () => {
    const response = await respond('bevolking van een onbekende regio', population({ regions: ['PV99'] }));
    if (response.kind !== 'refusal') throw new Error(`expected a refusal, got ${response.kind}`);
    const tampered = recordFor(response);
    const refusal = tampered.response as RefusalResponse;
    // A sibling case: the SAME query-refusal kind (invalid_intent) and the
    // same axis, but an honest internal fault — it must keep the generic
    // wording, so it must NOT carry the sub-reason.
    expect(refusal.queryRefusal?.refusal.kind).toBe('invalid_intent');
    expect(refusal.reason).not.toBe('region_scope_on_national_measure');
    expect(reconstructionReport(tampered).problems).toEqual([]);

    refusal.queryRefusal!.refusal.subReason = 'region_scope_on_national_measure';
    expect(reconstructionReport(tampered).problems.some((p) => p.includes('subReason'))).toBe(true);
  });

  it('a pre-#253 refusal row (no subReason key at all) still reconstructs', async () => {
    const response = await respond('bevolking van een onbekende regio', population({ regions: ['PV99'] }));
    if (response.kind !== 'refusal') throw new Error(`expected a refusal, got ${response.kind}`);
    const old = recordFor(response);
    expect('subReason' in (old.response as RefusalResponse).queryRefusal!.refusal).toBe(false);
    expect(reconstructionReport(old).problems).toEqual([]);
  });
});

describe('R8: row 13 — the multi-region-multi-period refusal and its sub-reason', () => {
  let record: AuditRecord;

  // ADR 055 re-point: two NAMED regions over a range now ANSWERS (the
  // `region_series` shape), so the refusal this block audits is reached by the
  // case that is still outside that shape — more named regions than
  // REGION_SERIES_MAX_REGIONS allows. Same refusal, same sub-reason, same
  // reconstruction and tamper pins.
  const OVER_CAP_REGIONS = ['PV20', 'PV21', 'PV22', 'PV23', 'PV24', 'PV25', 'PV26'];

  beforeAll(async () => {
    const response = await respond(
      'hoe ontwikkelde de bevolking van zeven provincies zich van 2020 tot 2024',
      population({
        regions: OVER_CAP_REGIONS,
        period: { kind: 'range', from: '2020JJ00', to: '2024JJ00' },
      }),
    );
    if (response.kind !== 'refusal') throw new Error(`expected a refusal, got ${response.kind}`);
    record = recordFor(response);
  }, 300_000);

  it('reconstructs — the stored sub-reason matches the served reason', () => {
    const refusal = record.response as RefusalResponse;
    expect(refusal.reason).toBe('multi_region_multi_period');
    expect(refusal.queryRefusal?.refusal.subReason).toBe('multi_region_multi_period');

    expect(reconstructionReport(record).problems).toEqual([]);
  });

  it('a stripped sub-reason fails loudly — the row would claim a wording its own refusal cannot produce', () => {
    const tampered = clone(record);
    delete (tampered.response as RefusalResponse).queryRefusal!.refusal.subReason;
    const report = reconstructionReport(tampered);
    expect(report.problems.some((p) => p.includes('subReason'))).toBe(true);
    expect(report.ok).toBe(false);
  });

  it('the sub-reason bolted onto its SIBLING refusal (region_scope_on_national_measure) fails loudly — the generalized pairing check catches cross-wiring, not only an unrelated refusal', async () => {
    const response = await respond('wat is de werkloosheid per provincie', {
      schemaVersion: 1,
      target: { kind: 'canonical', key: 'unemployment_rate_seasonally_adjusted' },
      period: { kind: 'codes', codes: ['2024KW04'] },
      derivation: 'none',
      regionSet: { kind: 'all_provincies' },
    });
    if (response.kind !== 'refusal') throw new Error(`expected a refusal, got ${response.kind}`);
    const tampered = recordFor(response);
    const refusal = tampered.response as RefusalResponse;
    expect(refusal.reason).toBe('region_scope_on_national_measure');
    expect(reconstructionReport(tampered).problems).toEqual([]);

    refusal.queryRefusal!.refusal.subReason = 'multi_region_multi_period';
    expect(reconstructionReport(tampered).problems.some((p) => p.includes('subReason'))).toBe(true);
  });

  it('a sub-reason bolted onto an unrelated refusal fails loudly too — the pairing is checked both ways', async () => {
    const response = await respond('bevolking van een onbekende regio', population({ regions: ['PV99'] }));
    if (response.kind !== 'refusal') throw new Error(`expected a refusal, got ${response.kind}`);
    const tampered = recordFor(response);
    const refusal = tampered.response as RefusalResponse;
    expect(refusal.queryRefusal?.refusal.kind).toBe('invalid_intent');
    expect(refusal.reason).not.toBe('multi_region_multi_period');
    expect(reconstructionReport(tampered).problems).toEqual([]);

    refusal.queryRefusal!.refusal.subReason = 'multi_region_multi_period';
    expect(reconstructionReport(tampered).problems.some((p) => p.includes('subReason'))).toBe(true);
  });

  it('a pre-row-13 refusal row (no subReason key at all) still reconstructs', async () => {
    const response = await respond('bevolking van een onbekende regio', population({ regions: ['PV99'] }));
    if (response.kind !== 'refusal') throw new Error(`expected a refusal, got ${response.kind}`);
    const old = recordFor(response);
    expect('subReason' in (old.response as RefusalResponse).queryRefusal!.refusal).toBe(false);
    expect(reconstructionReport(old).problems).toEqual([]);
  });
});

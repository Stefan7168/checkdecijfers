// ADR 055 Task 6 — R8 for the multi-region series: does a stored
// `region_series` row reconstruct from the stored row ALONE?
//
// The shape adds two stored keys, and each needs its own reconstruction check
// rather than riding along on the existing ones (the same argument
// tests/audit/region-set-r8.test.ts makes for its own pair):
//
//  1. `ComposedAnswer.regionSeriesLine` — a structural disclosure line, like
//     `assumptionLine` and `regionSetLine`, so it must RE-DERIVE
//     byte-identically through the same builder (`buildRegionSeriesLine`) and
//     must take part in the text re-assembly. Without that, every INCOMPLETE
//     multi-region row would fail R8 on a line the composer really did write.
//     It is present-only in a second way the region-set line is not: a
//     COMPLETE series has nothing to disclose, so the key is absent there too
//     (docs/13) — and `?? null` must not become an escape hatch for a line
//     that was stripped after the fact.
//  2. `ValidatedResult.regionSeries` — the per-region coverage record. It is
//     what the disclosure sentence is computed from, and what decides which
//     regions the BODY is allowed to make a claim about at all (MS1: a
//     `partial`/`excluded` region gets no clause, because run.ts registered no
//     derivation for it). A tampered coverage record must therefore fail
//     loudly, which it does because the re-derived line no longer matches the
//     stored one.
//
// And, as on the region-class shape, the BODY of a `region_series` answer is
// deterministic — composeAnswer is template-only BY SHAPE (zero LLM calls,
// Task 4) — so it has a ground truth and is re-derived byte-identically rather
// than only re-validated. The per-region direction pin below proves that
// catches an edit made on the DERIVATION side, where the body and the record
// must agree region by region.
//
// Everything is driven from REAL results of the hermetic ingest (ADR 009)
// through a hand-authored intent, exactly like the region-set suite. Test
// ORDER is load-bearing from "a PARTIAL region" onwards: that block mutates
// this suite's own private PGlite (tests/helpers/fixture-snapshot.ts gives
// every createIngestedDb caller its own).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { respondToIntent } from '../../src/answer/respond/respond.ts';
import { buildAuditRow, type AuditContext } from '../../src/answer/audit/write.ts';
import { reconstructionReport } from '../../src/answer/audit/reconstruct.ts';
import { applyUnitExpansions, renderRegionSeriesLegacyPreLineFormat } from '../../src/answer/compose/index.ts';
import type { AuditRecord } from '../../src/answer/audit/types.ts';
import type { AnswerResponse, ComposedResponse } from '../../src/answer/respond/types.ts';
import type { ParseOutcome } from '../../src/answer/intent/types.ts';
import type { StructuredIntent } from '../../src/query/index.ts';
import type { LlmClient, LlmResponse } from '../../src/answer/llm/client.ts';
import type { Db } from '../../src/db/types.ts';
import { createIngestedDb } from '../helpers/ingested-db.ts';

let db: Db;
let close: () => Promise<void>;

const REFERENCE_DATE = '2026-07-15';
const POPULATION_MEASURE = 'M000352';
const AMSTERDAM = 'GM0363';
const ROTTERDAM = 'GM0599';
const UTRECHT = 'GM0344';

/** Fails the test if the phrasing model is ever reached — `region_series` is
 * template-only by shape, which is also what makes its body re-derivable. */
class UnreachableLlmClient implements LlmClient {
  async complete(): Promise<LlmResponse> {
    throw new Error('a region_series turn must never reach the LLM');
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

/** A hand-built 'intent' ParseOutcome — the parser CAN reach this shape (the
 * intent contract is unchanged, ADR 055), but a hermetic suite must not spend
 * a real LLM call to get there. Mirrors the region-set suite's stub. */
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
 * shape the `?? null` discipline exists for — docs/13).
 *
 * `createdAt` is deliberately AFTER ADR 055 pass-4 rows 12+13's
 * `REGION_SERIES_LINE_FORMAT_CUTOFF` (reconstruct.ts): every body in this
 * file is generated by TODAY's `respondToIntent`/`composeAnswer` (the NEW
 * per-line format), so it must reconstruct against TODAY's renderer, not the
 * legacy one — see the "R8: pre-cutoff region_series rows" describe block
 * below for the legacy-format pin itself. */
function recordFor(response: ComposedResponse): AuditRecord {
  const row = buildAuditRow(response, CONTEXT);
  return JSON.parse(JSON.stringify({ ...row, id: 1, createdAt: '2026-09-17T16:00:00.000Z' })) as AuditRecord;
}

/** A row as it would have been stored BEFORE ADR 055 pass-4 rows 12+13
 * (reconstruct.ts's `REGION_SERIES_LINE_FORMAT_CUTOFF`): same result, same
 * derivations — only `answer.body`/`text`/`finalText` are overwritten with
 * the OLD (`renderRegionSeriesLegacyPreLineFormat`) rendering and
 * `createdAt` is set explicitly, so a test can place it on either side of
 * the cutoff. */
function legacyRecordFor(response: ComposedResponse, createdAt: string): AuditRecord {
  const record = recordFor(response);
  record.createdAt = createdAt;
  const result = answerOf(record).result;
  answerOf(record).answer.body = applyUnitExpansions(renderRegionSeriesLegacyPreLineFormat(result), result);
  reassemble(record);
  return record;
}

/** Re-assembles the three text copies of a tampered ANSWER record from its
 * (tampered) parts, in composeAnswer's own order — `regionSeriesLine`
 * immediately after `regionSetLine`. Used so a tamper test can isolate ONE
 * reconstruction check: without it every body/line edit would also trip the
 * text-reassembly check, and the assertion would prove nothing about the check
 * under test. */
function reassemble(record: AuditRecord): void {
  const response = record.response as AnswerResponse;
  const a = response.answer;
  const text = [
    a.body,
    '',
    ...(a.assumptionLine ? [a.assumptionLine] : []),
    ...(a.regionSetLine ? [a.regionSetLine] : []),
    ...(a.regionSeriesLine ? [a.regionSeriesLine] : []),
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
    period: { kind: 'range', from: '2020JJ00', to: '2024JJ00' },
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

describe('R8: a COMPLETE region_series answer row', () => {
  let record: AuditRecord;

  beforeAll(async () => {
    record = await answerRecord(
      'hoe ontwikkelde de bevolking van Amsterdam en Rotterdam zich van 2020 tot 2024',
      population({ regions: [AMSTERDAM, ROTTERDAM] }),
    );
  }, 300_000);

  it('reconstructs: body and chart spec re-derive from the stored result, and a complete series carries NO coverage key', () => {
    const response = answerOf(record);
    // Confirms this row really exercises the boundary under test rather than
    // silently testing an ordinary answer.
    expect(response.result.shape).toBe('region_series');
    expect(response.result.regionSeries?.complete).toBe(true);
    expect(response.answer.source).toBe('template');
    // The present-only contract at its strictest: a COMPLETE series has
    // nothing to disclose, so the key is absent even on a row of the very
    // shape that introduced it (docs/13).
    expect('regionSeriesLine' in response.answer).toBe(false);
    // Task 3: this shape charts as a multi-series line — the spec is
    // re-derived through buildChartSpec like every other answer's.
    expect(response.chart).not.toBeNull();
    expect(response.chart!.kind).toBe('line');
    expect(response.chart!.series).toHaveLength(2);

    expect(reconstructionReport(record).problems).toEqual([]);
  });

  it('a tampered coverage record fails loudly — a region invented in `excluded`', () => {
    const tampered = clone(record);
    const coverage = answerOf(tampered).result.regionSeries!;
    coverage.excluded = [UTRECHT];
    coverage.complete = false;
    // The invented exclusion makes the builder produce a disclosure sentence
    // ("Over GM0344 zegt dit antwoord niets…") where the stored row has no
    // line at all — the coverage record is checked THROUGH the line it
    // determines, which is the only thing the user ever saw of it.
    const report = reconstructionReport(tampered);
    expect(report.problems.some((p) => p.includes('region-series coverage line does not re-derive'))).toBe(true);
    expect(report.ok).toBe(false);
  });

  it('a tampered per-region direction record fails loudly — the body is re-derived, not merely re-validated', () => {
    const tampered = clone(record);
    const response = answerOf(tampered);
    const direction = response.result.derivations.find((d) => d.kind === 'direction');
    if (direction === undefined || direction.kind !== 'direction') throw new Error('expected a direction record');
    expect(direction.direction).toBe('up');
    // One region's own direction is flipped. The stored body says "gestegen"
    // for that region; re-rendering the template over the tampered record says
    // "gedaald" — so the byte-identical body re-derivation catches it, and R9
    // catches the now-unbacked word from the other side.
    direction.direction = 'down';
    const report = reconstructionReport(tampered);
    expect(report.problems.some((p) => p.includes('region-series body does not re-derive'))).toBe(true);
    expect(report.ok).toBe(false);
  });

  it('a body edit the numeric validator would accept STILL fails — this shape has a deterministic ground truth', () => {
    const tampered = clone(record);
    const response = answerOf(tampered);
    // Drop the LAST region's clause. Every remaining digit is still backed by
    // a stored cell, so validateAnswerBody is perfectly happy — only the
    // byte-identical re-derivation of the deterministic template body catches
    // it. That is the whole point of treating this body as `rederived`, and on
    // this shape it is also MS1's ledger: which regions the answer spoke about
    // is exactly the honesty question.
    const lines = response.answer.body.split('\n');
    expect(lines.length).toBeGreaterThan(2); // header + >= 2 region lines
    const kept = lines.slice(0, -1);
    const last = kept[kept.length - 1]!;
    kept[kept.length - 1] = last.endsWith('.') ? last : `${last}.`;
    response.answer.body = kept.join('\n');
    reassemble(tampered);
    const report = reconstructionReport(tampered);
    expect(report.problems.some((p) => p.includes('region-series body does not re-derive'))).toBe(true);
    expect(report.problems.some((p) => p.includes('fails re-validation'))).toBe(false);
  });
});

describe('R8: rows that predate ADR 055 are untouched', () => {
  it('an ordinary single-region answer carries NEITHER new key, and still reconstructs', async () => {
    const record = await answerRecord(
      'hoe ontwikkelde de bevolking van Amsterdam zich van 2020 tot 2024',
      population({ regions: [AMSTERDAM] }),
    );
    const response = answerOf(record);
    expect(response.result.shape).toBe('series');
    // The present-only contract, checked on the SERIALIZED row: an answer that
    // is not a multi-region series serializes neither key at all, so a reader
    // must reach them through `?? null` — `undefined !== null` is the WP16
    // bug docs/13 was written about.
    expect('regionSeries' in response.result).toBe(false);
    expect('regionSeriesLine' in response.answer).toBe(false);

    expect(reconstructionReport(record).problems).toEqual([]);
  });
});

describe('R8: an INCOMPLETE region_series answer row', () => {
  let record: AuditRecord;

  beforeAll(async () => {
    // No loaded table produces a withheld cell naturally, so seed one:
    // Rotterdam's 2022 population becomes Confidential — a value that EXISTS
    // but is not disclosed, so no honest trend spans that window and Rotterdam
    // lands in `partial` with no direction record (MS1). Utrecht loses a ROW
    // entirely at 2023, so it is `excluded` and contributes no cell at all.
    await db.query(
      `update observations set value = null, value_attribute = 'Confidential'
        where table_id = '03759ned' and measure = $1 and region_code = $2 and period_code = '2022JJ00'`,
      [POPULATION_MEASURE, ROTTERDAM],
    );
    await db.query(
      `delete from observations
        where table_id = '03759ned' and measure = $1 and region_code = $2 and period_code = '2023JJ00'`,
      [POPULATION_MEASURE, UTRECHT],
    );
    record = await answerRecord(
      'hoe ontwikkelde de bevolking van Amsterdam, Rotterdam en Utrecht zich van 2020 tot 2024',
      population({ regions: [AMSTERDAM, ROTTERDAM, UTRECHT] }),
    );
  }, 300_000);

  it('reconstructs — the coverage line naming the partial and the excluded region re-derives', () => {
    const response = answerOf(record);
    expect(response.result.regionSeries).toMatchObject({
      partial: [ROTTERDAM],
      excluded: [UTRECHT],
      complete: false,
    });
    expect(response.answer.regionSeriesLine).toEqual(expect.any(String));
    // The disclosure really is part of what the user read.
    expect(response.answer.text).toContain(response.answer.regionSeriesLine!);

    expect(reconstructionReport(record).problems).toEqual([]);
  });

  it('a tampered coverage record fails loudly — `complete` flipped', () => {
    const tampered = clone(record);
    answerOf(tampered).result.regionSeries!.complete = true;
    // `complete` is what suppresses the whole disclosure, so the flip makes
    // the builder return null where the stored row has a sentence.
    const report = reconstructionReport(tampered);
    expect(report.problems.some((p) => p.includes('region-series coverage line does not re-derive'))).toBe(true);
    expect(report.ok).toBe(false);
  });

  it('a tampered coverage record fails loudly — a region moved from `partial` to `excluded`', () => {
    const tampered = clone(record);
    const coverage = answerOf(tampered).result.regionSeries!;
    coverage.partial = [];
    coverage.excluded = [ROTTERDAM, UTRECHT];
    // The move changes both WHICH sentence names the region and HOW it is
    // named (a partial region has cells, so a verbatim CBS label; an excluded
    // one has none, so a bare CBS code).
    const report = reconstructionReport(tampered);
    expect(report.problems.some((p) => p.includes('region-series coverage line does not re-derive'))).toBe(true);
  });

  it('a tampered regionSeriesLine fails loudly', () => {
    const tampered = clone(record);
    answerOf(tampered).answer.regionSeriesLine =
      'Dekking: alle gevraagde regio’s hebben een cijfer voor elk gevraagd jaar.';
    reassemble(tampered);
    const report = reconstructionReport(tampered);
    expect(report.problems.some((p) => p.includes('region-series coverage line does not re-derive'))).toBe(true);
  });

  it('a STRIPPED regionSeriesLine fails too — `?? null` must not be an escape hatch', () => {
    const tampered = clone(record);
    delete answerOf(tampered).answer.regionSeriesLine;
    reassemble(tampered);
    expect(
      reconstructionReport(tampered).problems.some((p) =>
        p.includes('region-series coverage line does not re-derive'),
      ),
    ).toBe(true);
  });
});

describe('R8: pre-cutoff region_series rows reconstruct against the LEGACY body shape (ADR 055 pass-4 rows 12+13, 2026-09-17)', () => {
  // Why this describe block exists at all: `renderRegionSeries` (template.ts)
  // changed `body`'s bytes (full CBS-qualified labels, one "– " line per
  // region) a few hours after this SHAPE's own go-live (commit f923f31). A
  // row stored in that window has the OLD shape verbatim in its stored body
  // — exactly what the user saw — while `renderTemplateBody` today produces
  // the NEW shape. reconstruct.ts's `REGION_SERIES_LINE_FORMAT_CUTOFF`
  // re-derives a `region_series` row against
  // `renderRegionSeriesLegacyPreLineFormat` instead of today's renderer when
  // `createdAt` predates that cutoff — see that file's own comment for why
  // this is a date-scoped tolerance rather than a known-divergences.ts
  // per-row-id entry (no real audit_answers id can be named from this
  // hermetic, DB-less worktree).
  // Its OWN fixture db (tests/helpers/fixture-snapshot.ts gives every
  // createIngestedDb caller its own) — deliberately NOT the outer file's
  // shared `db`, which earlier describe blocks in this file mutate
  // (Rotterdam loses its 2022 value, Utrecht loses its 2023 row), and this
  // block's own assertions depend on BOTH named regions being COMPLETE.
  //
  // Amsterdam + Utrecht, not Amsterdam + Rotterdam: Utrecht (GM0344) is one
  // of the handful of CBS names that collide with a province of the same
  // name, so its OWN raw CBS Title is already qualified,
  // "Utrecht (gemeente)" (tests/fixtures/cbs/03759ned/codes-RegioS.json) —
  // exactly the row-12 case ("Utrecht" is genuinely ambiguous) this pin
  // needs. Amsterdam and Rotterdam carry no such qualifier at all (their raw
  // CBS Titles are bare "Amsterdam"/"Rotterdam"), so they cannot exercise
  // the qualified-vs-base-label distinction this block pins.
  let localDb: Db;
  let localClose: () => Promise<void>;
  let response: ComposedResponse;

  beforeAll(async () => {
    ({ db: localDb, close: localClose } = await createIngestedDb());
    response = await respondToIntent(
      localDb,
      'hoe ontwikkelde de bevolking van Amsterdam en Utrecht zich van 2020 tot 2024',
      stubIntent(
        'hoe ontwikkelde de bevolking van Amsterdam en Utrecht zich van 2020 tot 2024',
        population({ regions: [AMSTERDAM, UTRECHT] }),
      ),
      { answerClient: new UnreachableLlmClient(), referenceDate: REFERENCE_DATE },
    );
  }, 300_000);

  afterAll(async () => {
    await localClose();
  });

  it('a row created BEFORE the cutoff, carrying the OLD (semicolon-joined, base-label) body, reconstructs true', () => {
    // Comfortably after f923f31's own go-live (~13:56 UTC) and before the
    // cutoff reconstruct.ts records for this change.
    const record = legacyRecordFor(response, '2026-09-17T14:00:00.000Z');
    const result = answerOf(record).result;
    expect(result.regionSeries!.complete).toBe(true);
    const legacyBody = applyUnitExpansions(renderRegionSeriesLegacyPreLineFormat(result), result);
    // Sanity: this really IS the old shape, not today's — no line breaks, no
    // "– " bullets, and (unlike today's body) the qualifier is stripped:
    // Utrecht's own full CBS label ("Utrecht (gemeente)") is absent even
    // though its base name is present.
    expect(legacyBody).not.toContain('\n');
    expect(legacyBody).not.toContain('– ');
    const utrechtLabel = result.cells.find((c) => c.regionCode === UTRECHT)?.regionLabel ?? '';
    expect(utrechtLabel).toContain('(gemeente)'); // confirms the fixture really is the colliding name
    expect(legacyBody).not.toContain(utrechtLabel);
    expect(legacyBody).toContain('Utrecht');
    expect(answerOf(record).answer.body).toBe(legacyBody);

    expect(reconstructionReport(record).problems).toEqual([]);
  });

  it('the SAME old-shape body, timestamped AFTER the cutoff, fails — the tolerance is date-scoped, not a blanket pass', () => {
    const record = legacyRecordFor(response, '2026-09-18T00:00:00.000Z');
    const report = reconstructionReport(record);
    expect(report.ok).toBe(false);
    expect(report.problems.some((p) => p.includes('region-series body does not re-derive'))).toBe(true);
  });

  it("a row created after the cutoff, carrying TODAY's body shape, still reconstructs true (the ordinary, unaffected path)", () => {
    const record = recordFor(response);
    expect(reconstructionReport(record).problems).toEqual([]);
  });
});

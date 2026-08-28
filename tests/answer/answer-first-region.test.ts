// WP26 mechanism B-region (ADR 024, safelist entry 1) — "no place named, and
// the measure has a national figure ⇒ answer nationally, say so, and show how
// to correct it" instead of a clarification round the user pays for.
//
// The line this must not cross (ADR 024 decision 2): a default may replace a
// clarification ONLY when it is a canonical, structurally-determined reading —
// servability-checked through the real query layer, disclosed in-sentence by
// deterministic code, with a working correction path. So the pins here are:
//
//  1. FLAG OFF ⇒ the pre-WP26 clarification, and no extra envelope keys.
//  2. FLAG ON ⇒ the national row answers, the intent RECORDS the resolved
//     region (R8 shows what ran, not the under-specified ask), and the
//     disclosure sentence is present, number-free, and outside the body the
//     answer validator scans.
//  3. NO NL ROW ⇒ still clarifies. This is the no-default pin: the measure
//     that lacks a national aggregate must never receive an invented one.
//  4. The period axis is untouched: a defaulted region with an unpublished
//     period still refuses honestly, exactly as a named region would.
//  5. R8: the disclosure re-derives byte-identically from the stored result,
//     and the answer text re-assembles from its parts.
//
// Hermetic: fixture-ingested PGlite, canned parse, template composition.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../../src/db/types.ts';
import { createIngestedDb } from '../helpers/ingested-db.ts';
import { runQuery, NATIONAL_REGION_CODE } from '../../src/query/index.ts';
import type { StructuredIntent } from '../../src/query/index.ts';
import { composeAnswer } from '../../src/answer/compose/index.ts';
import { buildAssumptionLine } from '../../src/answer/compose/format.ts';
import { validateAnswerBody } from '../../src/answer/compose/validate.ts';
import type { LlmClient, LlmResponse } from '../../src/answer/llm/client.ts';

let db: Db;
let close: () => Promise<void>;

beforeAll(async () => {
  ({ db, close } = await createIngestedDb());
}, 300_000);

afterAll(async () => {
  await close();
});

/** Composition never needs the LLM here: the template rung is enough to prove
 * the structural lines, and a throwing client makes an accidental call loud. */
class ThrowingClient implements LlmClient {
  async complete(): Promise<LlmResponse> {
    throw new Error('LLM call attempted in a deterministic test');
  }
}

/** A geo measure asked with NO region — the shape that dead-ends today. */
function regionlessIntent(key: string, periodCode: string): StructuredIntent {
  return {
    schemaVersion: 1,
    target: { kind: 'canonical', key },
    period: { kind: 'codes', codes: [periodCode] },
    derivation: 'none',
  };
}

describe('flag off: an under-specified region still clarifies', () => {
  it('refuses with needs_clarification and defaults nothing', async () => {
    const outcome = await runQuery(db, regionlessIntent('population_on_1_january', '2024JJ00'));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('unreachable');
    expect(outcome.refusal.kind).toBe('needs_clarification');
    expect(outcome.refusal.axes).toContain('region');
  });

  it('an explicitly named region is unaffected by the flag either way', async () => {
    const withRegion: StructuredIntent = {
      ...regionlessIntent('population_on_1_january', '2024JJ00'),
      regions: ['GM0363'],
    };
    for (const answerFirstEnabled of [false, true]) {
      const outcome = await runQuery(db, withRegion, { answerFirstEnabled });
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) throw new Error('unreachable');
      expect(outcome.intent.regions).toEqual(['GM0363']);
      // No default fired ⇒ no key at all (byte-neutrality of the envelope).
      expect(Object.hasOwn(outcome, 'regionDefaulted')).toBe(false);
      expect(buildAssumptionLine(outcome)).toBeNull();
    }
  });
});

describe('flag on: the national total answers, and says so', () => {
  it('resolves to the NL row and records the region it actually ran', async () => {
    const outcome = await runQuery(db, regionlessIntent('population_on_1_january', '2024JJ00'), {
      answerFirstEnabled: true,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error('unreachable');
    expect(outcome.regionDefaulted).toBe(true);
    // R8: the stored intent is the RESOLVED one — the audit row must show the
    // query that ran, not the question that was asked.
    expect(outcome.intent.regions).toEqual([NATIONAL_REGION_CODE]);
    expect(outcome.cells).toHaveLength(1);
    expect(outcome.cells[0]!.regionCode).toBe(NATIONAL_REGION_CODE);
    expect(outcome.cells[0]!.value).not.toBeNull();
  });

  it('discloses the assumption and the correction path, with no number in it', async () => {
    const outcome = await runQuery(db, regionlessIntent('population_on_1_january', '2024JJ00'), {
      answerFirstEnabled: true,
    });
    if (!outcome.ok) throw new Error('unreachable');
    const line = buildAssumptionLine(outcome);
    expect(line).toBe(
      'Dit is het landelijke cijfer voor heel Nederland. ' +
        'Noem een gemeente of provincie in je vraag als je een specifieke regio wilt.',
    );
    // A disclosure is not a claim: it names the assumption, never a value.
    expect(line).not.toMatch(/\d/);
  });

  it('the disclosure rides OUTSIDE the validated body, and the answer still validates', async () => {
    const outcome = await runQuery(db, regionlessIntent('population_on_1_january', '2024JJ00'), {
      answerFirstEnabled: true,
    });
    if (!outcome.ok) throw new Error('unreachable');
    const answer = await composeAnswer(outcome, {
      client: new ThrowingClient(),
      templateOnly: true,
    });
    expect(answer.assumptionLine).toBe(buildAssumptionLine(outcome));
    // R1's structural exemption: the line is NOT part of the scanned body...
    expect(answer.body).not.toContain('landelijke cijfer voor heel Nederland');
    expect(validateAnswerBody(answer.body, outcome).ok).toBe(true);
    // ...but it IS in what the user reads, above the definition/source lines.
    expect(answer.text).toContain('Dit is het landelijke cijfer voor heel Nederland.');
    expect(answer.text.indexOf(answer.assumptionLine!)).toBeLessThan(
      answer.text.indexOf(answer.attributionLine),
    );
  });

  it('re-assembles byte-identically from its stored parts (the R8 pattern)', async () => {
    const outcome = await runQuery(db, regionlessIntent('population_on_1_january', '2024JJ00'), {
      answerFirstEnabled: true,
    });
    if (!outcome.ok) throw new Error('unreachable');
    const answer = await composeAnswer(outcome, {
      client: new ThrowingClient(),
      templateOnly: true,
    });
    // Exactly what audit/reconstruct.ts recomputes from the row alone.
    const rederived = [
      answer.body,
      '',
      ...(buildAssumptionLine(outcome) ? [buildAssumptionLine(outcome)!] : []),
      ...(answer.definitionLine ? [answer.definitionLine] : []),
      // #39: the alternate-reading disclosure sits between definition and
      // marking — same order as compose.ts/reconstruct.ts.
      ...(answer.alternatesLine ? [answer.alternatesLine] : []),
      ...(answer.markingLine ? [answer.markingLine] : []),
      answer.attributionLine,
    ].join('\n');
    expect(answer.text).toBe(rederived);
  });
});

describe('the no-default pins (the honesty half)', () => {
  it('a geo measure WITHOUT a national row keeps clarifying', async () => {
    // 83625NED's home-sale-price measure does have an NL row, so the absence
    // case is constructed by deleting it — the ADR 024 revisit trigger ("a geo
    // measure entering scope with no NL-level row") made mechanical. Nothing
    // may be invented in its place.
    const probe = await db.query(
      `select table_id, measure, dims from canonical_measures where key = $1`,
      ['average_home_sale_price_by_gemeente'],
    );
    const row = probe.rows[0] as { table_id: string; measure: string } | undefined;
    if (row === undefined) throw new Error('fixture is missing the geo canonical measure');
    const saved = await db.query(
      `select * from observations where table_id = $1 and measure = $2 and region_code = $3`,
      [row.table_id, row.measure, NATIONAL_REGION_CODE],
    );
    expect(saved.rows.length).toBeGreaterThan(0);
    await db.query(
      `delete from observations where table_id = $1 and measure = $2 and region_code = $3`,
      [row.table_id, row.measure, NATIONAL_REGION_CODE],
    );
    try {
      const outcome = await runQuery(
        db,
        regionlessIntent('average_home_sale_price_by_gemeente', '2024JJ00'),
        { answerFirstEnabled: true },
      );
      expect(outcome.ok).toBe(false);
      if (outcome.ok) throw new Error('a national figure was served without a national row');
      expect(outcome.refusal.kind).toBe('needs_clarification');
      expect(outcome.refusal.axes).toContain('region');
    } finally {
      // Restore the fixture DB for the rest of the file.
      for (const cell of saved.rows as Record<string, unknown>[]) {
        const columns = Object.keys(cell).filter((c) => c !== 'id');
        await db.query(
          `insert into observations (${columns.join(', ')}) values (${columns
            .map((_, i) => `$${i + 1}`)
            .join(', ')})`,
          columns.map((c) => cell[c]),
        );
      }
    }
  });

  it('defaulting the region does NOT paper over an unpublished period', async () => {
    // The default concerns one axis. A period we do not hold still refuses
    // honestly — the same answer a named region would have received.
    const outcome = await runQuery(db, regionlessIntent('population_on_1_january', '1850JJ00'), {
      answerFirstEnabled: true,
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('unreachable');
    expect(['not_published', 'outside_loaded_slice', 'freshness', 'no_data']).toContain(
      outcome.refusal.kind,
    );
  });

  it('a "max" comparison is never given a default region', async () => {
    // A comparison needs at least two places by construction, so a defaulted
    // single region would be nonsense. It cannot happen: the derivation-arity
    // check refuses BEFORE the region axis is resolved at all. Pinned here so
    // the ordering stays load-bearing — moving the default earlier would let a
    // one-region "max" through.
    const outcome = await runQuery(
      db,
      { ...regionlessIntent('population_on_1_january', '2024JJ00'), derivation: 'max' },
      { answerFirstEnabled: true },
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('unreachable');
    expect(outcome.refusal.kind).toBe('invalid_intent');
    expect(outcome.refusal.message).toMatch(/max/i);
  });

  it('a national-only measure is untouched (it has no geo dimension to default)', async () => {
    const outcome = await runQuery(db, regionlessIntent('cpi_yearly_inflation', '2024JJ00'), {
      answerFirstEnabled: true,
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error('unreachable');
    expect(Object.hasOwn(outcome, 'regionDefaulted')).toBe(false);
    expect(buildAssumptionLine(outcome)).toBeNull();
  });
});

// Breadth step 4, Task 4 — the bridge from a validated TableParseResult into
// step 3's breakdown resolver input (src/answer/table-parse/bridge.ts).
//
// Hermetic: no LLM call anywhere. TableParseResult values are built by hand
// (the exact shape validateTableParseOutput would have produced) against
// TableParseSchema built from Task 1's real CBS metadata fixtures, same
// discipline as parse.test.ts/input.test.ts.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { CbsCode, CbsTableSchema } from '../../../src/cbs-adapter/types.ts';
import { buildTableParseSchema } from '../../../src/answer/table-parse/input.ts';
import type { TableParseSchema } from '../../../src/answer/table-parse/input.ts';
import type { BreakdownDimension } from '../../../src/query/breakdowns.ts';
import type { TableParseResult } from '../../../src/answer/table-parse/parse.ts';
import { namedFromParse } from '../../../src/answer/table-parse/bridge.ts';

function loadFixture(tableId: string): { schema: CbsTableSchema; codeLists: Record<string, CbsCode[]> } {
  const path = fileURLToPath(new URL(`../../fixtures/tableparse/schemas/${tableId}.json`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf8')) as {
    schema: CbsTableSchema;
    codeLists: Record<string, CbsCode[]>;
  };
}

/** Mirrors input.ts's own construction of the full (never pre-filtered)
 * BreakdownDimension list — the shape step 3's resolveBreakdowns and this
 * bridge's re-check both expect. */
function fullDimsFor(schema: CbsTableSchema, codeLists: Record<string, CbsCode[]>): BreakdownDimension[] {
  return schema.dimensions.map((d) => ({
    name: d.name,
    title: d.title,
    kind: d.kind,
    members: (codeLists[d.name] ?? []).map((c) => ({ code: c.code, title: c.title })),
  }));
}

/** A minimal, otherwise-valid TableParseResult — only `breakdowns` varies
 * per test. */
function baseResult(breakdowns: TableParseResult['breakdowns']): TableParseResult {
  return {
    measureCode: 'D003040',
    breakdowns,
    period: { kind: 'year', year: 2020 },
    periodGrainUnavailable: false,
    regions: [],
    derivation: 'none',
    confidence: 0.9,
    reading: 'test',
  };
}

// 85669NED: 2 breakdown dimensions, EmissiesNaarLucht then Klimaatsectoren
// (table order) — both real CBS dimensions, Klimaatsectoren truncated (52
// members > MEMBER_PROMPT_CAP).
function emissiesInput(question: string): { input: TableParseSchema; fullDims: BreakdownDimension[] } {
  const { schema, codeLists } = loadFixture('85669NED');
  return { input: buildTableParseSchema(schema, codeLists, question), fullDims: fullDimsFor(schema, codeLists) };
}

// 84521NED: 4 breakdown dimensions in table order — Diagnose, Geslacht,
// Leeftijd, SoortOpname — used to pin 'other' ordering (the FIRST offered
// dimension with an 'other' choice wins, principle c: one question at a
// time).
function ziekenhuisInput(question: string): { input: TableParseSchema; fullDims: BreakdownDimension[] } {
  const { schema, codeLists } = loadFixture('84521NED');
  return { input: buildTableParseSchema(schema, codeLists, question), fullDims: fullDimsFor(schema, codeLists) };
}

describe('namedFromParse', () => {
  it('maps a member choice to a named code, re-checked against the full code list', () => {
    const { input, fullDims } = emissiesInput('Wat was de uitstoot van CO2?');
    const result = baseResult({
      EmissiesNaarLucht: { kind: 'member', code: 'A044109' }, // Kooldioxide (CO2)
      Klimaatsectoren: { kind: 'not_named' },
    });
    const outcome = namedFromParse(result, input, fullDims);
    expect(outcome).toEqual({ ok: true, named: { EmissiesNaarLucht: 'A044109' } });
  });

  it('omits a not_named dimension from `named` entirely — never a silent default here', () => {
    const { input, fullDims } = emissiesInput('Wat was de uitstoot in 2019?');
    const result = baseResult({
      EmissiesNaarLucht: { kind: 'not_named' },
      Klimaatsectoren: { kind: 'not_named' },
    });
    const outcome = namedFromParse(result, input, fullDims);
    expect(outcome).toEqual({ ok: true, named: {} });
  });

  it("turns an 'other' choice into an ask for THAT dimension — never the total", () => {
    const { input, fullDims } = emissiesInput('Wat was de uitstoot van de landbouw?');
    const result = baseResult({
      EmissiesNaarLucht: { kind: 'not_named' },
      Klimaatsectoren: { kind: 'other' },
    });
    const outcome = namedFromParse(result, input, fullDims);
    expect(outcome).toEqual({ ok: false, askDimension: 'Klimaatsectoren' });
  });

  it("asks the FIRST 'other' dimension in table order when more than one is 'other'", () => {
    const { input, fullDims } = ziekenhuisInput('Hoeveel ziekenhuisopnamen waren er?');
    // Diagnose comes before Leeftijd in table (dimensions array) order.
    const result = baseResult({
      Diagnose: { kind: 'other' },
      Geslacht: { kind: 'not_named' },
      Leeftijd: { kind: 'other' },
      SoortOpname: { kind: 'not_named' },
    });
    const outcome = namedFromParse(result, input, fullDims);
    expect(outcome).toEqual({ ok: false, askDimension: 'Diagnose' });
  });

  it('maps every offered dimension together (member + not_named mixed)', () => {
    const { input, fullDims } = ziekenhuisInput('Hoeveel dagopnamen waren er bij vrouwen?');
    const result = baseResult({
      Diagnose: { kind: 'not_named' },
      Geslacht: { kind: 'member', code: '4000' }, // Vrouwen
      Leeftijd: { kind: 'not_named' },
      SoortOpname: { kind: 'member', code: 'A044921' }, // Dagopnamen
    });
    const outcome = namedFromParse(result, input, fullDims);
    expect(outcome).toEqual({ ok: true, named: { Geslacht: '4000', SoortOpname: 'A044921' } });
  });

  it('throws when a member code is not found in the full code list (caller/fullDims mismatch)', () => {
    const { input } = emissiesInput('Wat was de uitstoot van CO2?');
    const result = baseResult({
      EmissiesNaarLucht: { kind: 'member', code: 'A044109' },
      Klimaatsectoren: { kind: 'not_named' },
    });
    // fullDims for a DIFFERENT table — EmissiesNaarLucht does not exist there
    // at all, so the re-check cannot find the chosen code.
    const { schema: otherSchema, codeLists: otherCodeLists } = loadFixture('85245NED');
    const wrongFullDims = fullDimsFor(otherSchema, otherCodeLists);
    expect(() => namedFromParse(result, input, wrongFullDims)).toThrow(
      /not found in that dimension's full code list/,
    );
  });

  it('throws when the result is missing a choice for an offered dimension (internal consistency)', () => {
    const { input, fullDims } = emissiesInput('Wat was de uitstoot van CO2?');
    const result = baseResult({
      EmissiesNaarLucht: { kind: 'member', code: 'A044109' },
      // Klimaatsectoren deliberately missing.
    });
    expect(() => namedFromParse(result, input, fullDims)).toThrow(
      /missing a choice for offered dimension 'Klimaatsectoren'/,
    );
  });
});

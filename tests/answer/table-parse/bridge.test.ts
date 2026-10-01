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
import { findGrandTotal, resolveBreakdowns, type BreakdownDimension } from '../../../src/query/breakdowns.ts';
import {
  validateTableParseOutput,
  TABLE_PARSE_NOT_NAMED,
  TABLE_PARSE_SCHEMA_VERSION,
  type TableParseResult,
} from '../../../src/answer/table-parse/parse.ts';
import { isTotalPick, namedFromParse } from '../../../src/answer/table-parse/bridge.ts';

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
    regionScope: null,
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

  // Final-review F5: a member pick that IS the dimension's CBS grand total is
  // left out of `named`, so the resolver picks that same total itself and
  // records it as a StatedDefault — the reader then sees "Uitgangspunt: …"
  // instead of an undisclosed total.
  it("omits an explicit pick of the dimension's own grand total from `named` (the resolver then discloses it)", () => {
    const { input, fullDims } = emissiesInput('Hoeveel broeikasgassen in totaal in 2019?');
    const emissies = fullDims.find((d) => d.name === 'EmissiesNaarLucht')!;
    expect(findGrandTotal(emissies.members)?.code).toBe('T001372');
    const result = baseResult({
      EmissiesNaarLucht: { kind: 'member', code: 'T001372' }, // Totaal broeikasgassen
      Klimaatsectoren: { kind: 'not_named' },
    });
    expect(namedFromParse(result, input, fullDims)).toEqual({ ok: true, named: {} });
  });

  it('keeps a non-total member pick on a dimension that has a grand total', () => {
    const { input, fullDims } = emissiesInput('Hoeveel methaan in 2019?');
    const result = baseResult({
      EmissiesNaarLucht: { kind: 'member', code: 'A044107' }, // Methaan (CH4)
      Klimaatsectoren: { kind: 'not_named' },
    });
    expect(namedFromParse(result, input, fullDims)).toEqual({ ok: true, named: { EmissiesNaarLucht: 'A044107' } });
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

  it("throws on a 'geen' parse (measureCode null) — the caller must refuse BEFORE any breakdown handling", () => {
    const { input, fullDims } = emissiesInput('Hoeveel mensen werkten er in de klimaatsector?');
    const result: TableParseResult = {
      ...baseResult({
        EmissiesNaarLucht: { kind: 'not_named' },
        Klimaatsectoren: { kind: 'not_named' },
      }),
      measureCode: null,
    };
    expect(() => namedFromParse(result, input, fullDims)).toThrow(
      /measureCode is null \('geen'\)/,
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

// ---------------------------------------------------------------------------
// Final-review F11 — the full chain over real fixtures: builder → (canned
// model JSON) → validator → bridge → step 3's resolveBreakdowns. No LLM.
// ---------------------------------------------------------------------------

function cannedJson(input: TableParseSchema, measureCode: string, choices: Record<string, string> = {}): string {
  return JSON.stringify({
    version: TABLE_PARSE_SCHEMA_VERSION,
    measureCode,
    breakdowns: input.breakdowns.map((b) => ({ dimension: b.name, choice: choices[b.name] ?? TABLE_PARSE_NOT_NAMED })),
    period: { kind: 'year', year: 2019 },
    regions: [],
    regionScope: null,
    derivation: 'none',
    confidence: 0.9,
    reading: 'test',
  });
}

function fullChain(tableId: string, question: string, measureCode: string, choices: Record<string, string> = {}) {
  const { schema, codeLists } = loadFixture(tableId);
  const input = buildTableParseSchema(schema, codeLists, question);
  const fullDims = fullDimsFor(schema, codeLists);
  const parse = validateTableParseOutput(cannedJson(input, measureCode, choices), input);
  const bridged = namedFromParse(parse, input, fullDims);
  if (!bridged.ok) throw new Error(`unexpected ask for ${bridged.askDimension}`);
  return resolveBreakdowns(fullDims, bridged.named);
}

describe('full chain: builder → validator → bridge → resolveBreakdowns (real fixtures)', () => {
  it("84521NED: Leeftijd 'niet_genoemd' (two totals, none resolvable) becomes a question for Leeftijd — never a guessed total", () => {
    const resolution = fullChain('84521NED', 'Hoeveel ziekenhuisopnamen waren er in 2019?', 'M006162_1');
    expect(resolution.ok).toBe(false);
    if (resolution.ok) return;
    expect(resolution.question.dimension).toBe('Leeftijd');
    expect(resolution.question.options.map((o) => o.code)).toEqual(expect.arrayContaining(['10000', 'T001249']));
  });

  it("85669NED: every dimension 'niet_genoemd' falls to each dimension's own CBS total, recorded as stated defaults", () => {
    const resolution = fullChain('85669NED', 'Hoeveel broeikasgas kwam er vrij in 2019?', 'D003040');
    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    expect(resolution.coordinates).toEqual({ EmissiesNaarLucht: 'T001372', Klimaatsectoren: 'T001616' });
    expect(resolution.defaults.map((d) => [d.dimension, d.code])).toEqual([
      ['EmissiesNaarLucht', 'T001372'],
      ['Klimaatsectoren', 'T001616'],
    ]);
    expect(resolution.callerDimensions).toEqual(['Perioden']);
  });

  it('85669NED: an explicit pick of the grand total (F5) still ends up as a disclosed stated default', () => {
    const resolution = fullChain('85669NED', 'Hoeveel broeikasgassen in totaal in 2019?', 'D003040', {
      EmissiesNaarLucht: 'T001372',
    });
    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    expect(resolution.coordinates['EmissiesNaarLucht']).toBe('T001372');
    expect(resolution.defaults.find((d) => d.dimension === 'EmissiesNaarLucht')).toEqual({
      dimension: 'EmissiesNaarLucht',
      dimensionTitle: expect.any(String),
      code: 'T001372',
      memberTitle: 'Totaal broeikasgassen',
    });
  });

  it('85669NED: a non-total member pick is a coordinate, not a stated default', () => {
    const resolution = fullChain('85669NED', 'Hoeveel methaan kwam er vrij in 2019?', 'D003040', {
      EmissiesNaarLucht: 'A044107',
    });
    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    expect(resolution.coordinates['EmissiesNaarLucht']).toBe('A044107');
    expect(resolution.defaults.map((d) => d.dimension)).toEqual(['Klimaatsectoren']);
  });
});

describe('isTotalPick (session 153)', () => {
  function members(tableId: string, dim: string) {
    return loadFixture(tableId).codeLists[dim]!.map((c) => ({ code: c.code, title: c.title }));
  }

  it('the unique grand total counts; any other member does not', () => {
    const m = members('85669NED', 'EmissiesNaarLucht');
    expect(isTotalPick(m, 'T001372')).toBe(true);
    expect(isTotalPick(m, 'A044109')).toBe(false);
  });

  it('without a unique total, only the FIRST "Totaal …" member counts', () => {
    const age = members('84521NED', 'Leeftijd'); // Totaal leeftijd, Totaal gestandaardiseerd, …
    expect(findGrandTotal(age)).toBeNull();
    expect(isTotalPick(age, '10000')).toBe(true);
    expect(isTotalPick(age, 'T001249')).toBe(false);
    const vehicles = members('85245NED', 'VoertuigType'); // Totaal motorvoertuigen, …, Totaal bedrijfsmotorvoertuigen
    expect(isTotalPick(vehicles, 'A018928')).toBe(true);
    expect(isTotalPick(vehicles, 'A018930')).toBe(false); // a sub-total a reader names on purpose
  });

  it('a dimension whose first member is not total-like has no total pick at all', () => {
    const age = members('80590ned', 'Leeftijd'); // 15 tot 75 jaar, 15 tot 25 jaar, …
    expect(isTotalPick(age, '52052')).toBe(false);
  });
});


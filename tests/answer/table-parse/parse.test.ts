// Breadth step 4, Task 3 — the table-scoped parser's prompt, output schema,
// hard-allowlist validator and request builder
// (docs/superpowers/plans/2026-09-28-breadth-step-4-table-parser.md, Task 3).
//
// Every test here is hermetic: no real LLM call anywhere. A stub LlmClient
// hands back canned JSON; validateTableParseOutput/tableParse are exercised
// directly against TableParseSchema inputs built from Task 1's real CBS
// metadata fixtures via Task 2's buildTableParseSchema, so the allowlist
// checks are pinned against actual CBS tables, not hand-crafted
// approximations (same discipline as tests/answer/table-parse/input.test.ts).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { CbsCode, CbsTableSchema } from '../../../src/cbs-adapter/types.ts';
import { buildTableParseSchema } from '../../../src/answer/table-parse/input.ts';
import type { TableParseSchema } from '../../../src/answer/table-parse/input.ts';
import {
  buildTableParseRequest,
  buildTableParseSystemPrompt,
  serializeTableParseInput,
  tableParse,
  tableParseJsonSchema,
  validateTableParseOutput,
  TableParseValidationError,
  TableParseRegionUnavailableError,
  TableParseAmbiguousMeasureError,
  TABLE_PARSE_MEASURE_NONE,
  TABLE_PARSE_NOT_NAMED,
  TABLE_PARSE_OTHER,
  TABLE_PARSE_SCHEMA_VERSION,
  TABLE_PARSE_PROMPT_VERSION,
  TABLE_PARSE_PREVIOUS_QUESTION_RULE,
  tableParsePrefilterText,
} from '../../../src/answer/table-parse/parse.ts';
import { requestHash } from '../../../src/answer/llm/client.ts';
import type { LlmClient, LlmRequest, LlmResponse } from '../../../src/answer/llm/client.ts';

function loadFixture(tableId: string): { schema: CbsTableSchema; codeLists: Record<string, CbsCode[]> } {
  const path = fileURLToPath(new URL(`../../fixtures/tableparse/schemas/${tableId}.json`, import.meta.url));
  const raw = JSON.parse(readFileSync(path, 'utf8')) as {
    schema: CbsTableSchema;
    codeLists: Record<string, CbsCode[]>;
  };
  return raw;
}

// 85669NED: one numeric measure (D003040), a `Klimaatsectoren` breakdown with
// 52 members pre-filtered down to 3 (grand total T001616 + the two
// "landbouw" matches) for this exact question, yearly-only, no regions.
const LANDBOUW_QUESTION = 'Wat was de uitstoot van de landbouw?';
function landbouwInput(): TableParseSchema {
  const { schema, codeLists } = loadFixture('85669NED');
  return buildTableParseSchema(schema, codeLists, LANDBOUW_QUESTION);
}

// 82291NED: two breakdown dimensions BOTH offered in full (≤ 40 members):
// `CaribischNederland` (4) and `Persoonskenmerken` (10); `Marges` is
// excluded (margins); no regions.
const CARIBISCH_QUESTION = 'Hoe gezond voelen mensen zich?';
function caribischInput(): TableParseSchema {
  const { schema, codeLists } = loadFixture('82291NED');
  return buildTableParseSchema(schema, codeLists, CARIBISCH_QUESTION);
}

// 85004NED: `RegioS` (86 members) classifies as an ordinary `breakdown`
// dimension (measured against the committed fixture — only 16% of its
// members carry a region-style code, under classifyDimension's 0.8
// geo-like threshold; pinned in input.test.ts) rather than geo/geo_like — so
// this table's hasRegions is FALSE even though the dimension is literally
// called "Regio's". A neutral question matches nothing in RegioS and there
// is no grand total, so the offered member list is genuinely empty.
const NEUTRAL_QUESTION = 'Hoeveel vermogen stond er opgesteld?';
function regionlessZeroMembersInput(): TableParseSchema {
  const { schema, codeLists } = loadFixture('85004NED');
  return buildTableParseSchema(schema, codeLists, NEUTRAL_QUESTION);
}

function validJson(input: TableParseSchema, overrides: Record<string, unknown> = {}): string {
  const base = {
    version: TABLE_PARSE_SCHEMA_VERSION,
    measureCode: input.measures[0]!.code,
    breakdowns: input.breakdowns.map((b) => ({ dimension: b.name, choice: TABLE_PARSE_NOT_NAMED })),
    period: { kind: 'year', year: 2023 },
    regions: [],
    regionScope: null,
    derivation: 'none',
    confidence: 0.9,
    reading: 'testantwoord',
  };
  return JSON.stringify({ ...base, ...overrides });
}

class StubClient implements LlmClient {
  calls: LlmRequest[] = [];
  private readonly outputText: string;
  constructor(outputText: string) {
    this.outputText = outputText;
  }
  async complete(request: LlmRequest): Promise<LlmResponse> {
    this.calls.push(request);
    return { outputText: this.outputText, model: 'stub', stopReason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0 } };
  }
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

describe('buildTableParseSystemPrompt', () => {
  it('is static (byte-identical across calls) and date-free', () => {
    const a = buildTableParseSystemPrompt();
    const b = buildTableParseSystemPrompt();
    expect(a).toBe(b);
    expect(a).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it('contains the three closed-choice literals', () => {
    const prompt = buildTableParseSystemPrompt();
    expect(prompt).toContain(TABLE_PARSE_MEASURE_NONE);
    expect(prompt).toContain(TABLE_PARSE_NOT_NAMED);
    expect(prompt).toContain(TABLE_PARSE_OTHER);
  });

  // Breadth step 4b, Task 2 (controller ruling): the prompt must tell the
  // model that measures are grouped, what the group means, and that two
  // measures sharing a title in different groups measure different things —
  // exactly what lets it use the new "groep:" line to break a tie it
  // otherwise couldn't (e.g. 80590ned's four "Niet-seizoengecorrigeerd"
  // measures).
  it('explains that measures are grouped and that a shared title in a different group means a different thing', () => {
    const prompt = buildTableParseSystemPrompt();
    expect(prompt).toContain('gegroepeerd');
    expect(prompt).toContain('groep');
    expect(prompt).toMatch(/dezelfde titel.*verschillende groep.*iets anders/);
  });

  // Final-review I3 (breadth step 4b fix wave, controller ruling): the
  // seasonal-adjustment default is settled in the prompt BEFORE the
  // recording run — a month/quarter question that does not say takes the
  // group's "Seizoengecorrigeerd" measure (the curated pipeline's default for
  // werkloosheid, CBS's own headline practice); a yearly question never takes
  // an adjusted measure unless it asks for one (seasonal adjustment only
  // exists below a year; a yearly question that EXPLICITLY asks for adjusted
  // figures — labelled case 'total-arbeidsdeelname-generiek' — keeps its
  // adjusted measure, and step 5's per-cell check refuses the missing
  // yearly cell rather than the parser silently swapping in the unadjusted
  // figure).
  it('states the seasonal-adjustment default: month/quarter without a stated preference → "Seizoengecorrigeerd"; an unstated year never', () => {
    const prompt = buildTableParseSystemPrompt();
    const maat = prompt.slice(prompt.indexOf('MAAT\n'), prompt.indexOf('UITSPLITSINGEN\n'));
    expect(maat).toMatch(/maand of kwartaal[^\n]*niet of ze seizoengecorrigeerde cijfers wil[^\n]*"Seizoengecorrigeerd"/);
    expect(maat).toMatch(/heel jaar niet dat ze seizoengecorrigeerde cijfers wil[^\n]*nooit een seizoengecorrigeerde maat/);
  });

  // Fix round 1 (task review, CRITICAL): the prompt must tell the model to
  // ALWAYS list every place the reader names, as written, with its kind,
  // even when the table has no regions — never silently drop it (which
  // would read as a national-total answer to a question about one place).
  it('instructs the model to always name every place the reader mentions, even on a region-less table', () => {
    const prompt = buildTableParseSystemPrompt();
    expect(prompt).toContain('Noem ALTIJD elke plaats die de vraag noemt');
    expect(prompt).toContain("OOK wanneer deze tabel helemaal geen regio's kent");
    expect(prompt).toContain('Verzin nooit een plaats die de vraag niet noemt');
    expect(prompt).toContain('gebruik nooit een CBS-code');
  });

  // Fix round 1 (task review, IMPORTANT): the prompt must tell the model to
  // report the period exactly as the question names it, regardless of the
  // table's own available precisions — never round a quarter up to a year
  // just because only years are offered.
  it('instructs the model to always report the period exactly as asked, regardless of the available precisions', () => {
    const prompt = buildTableParseSystemPrompt();
    expect(prompt).toContain('Geef de periode ALTIJD exact met de precisie die de vraag zelf noemt');
    expect(prompt).toContain('OOK wanneer die precisie niet voorkomt in de lijst');
    expect(prompt).toContain('Pas de gevraagde periode nooit aan naar een precisie die wel beschikbaar is');
  });

  // Fix round 1 (task review, MINOR): concise Dutch guidance/examples for
  // every period kind, equivalent to (not copied from) the curated intent
  // prompt's own period rules (src/answer/intent/prompt.ts).
  it('spells out concrete examples for every period kind (relative offset sign, last_n vs relative, date_range toInclusive, since/year_range boundaries)', () => {
    const prompt = buildTableParseSystemPrompt();
    expect(prompt).toContain('"kind":"relative"');
    expect(prompt).toContain('offset is een negatief getal, -1 is de vorige periode');
    expect(prompt).toContain('"kind":"last_n"');
    expect(prompt).toContain('het enkelvoud');
    expect(prompt).toContain('"kind":"date_range"');
    expect(prompt).toContain('toInclusive');
    expect(prompt).toContain('"kind":"since"');
    expect(prompt).toContain('"kind":"year_range"');
  });
});

// ---------------------------------------------------------------------------
// serializeTableParseInput
// ---------------------------------------------------------------------------

describe('serializeTableParseInput', () => {
  it('includes the table id/title, the measure, the truncation note, and "no regions"', () => {
    const input = landbouwInput();
    const text = serializeTableParseInput(LANDBOUW_QUESTION, input);
    expect(text).toContain('85669NED');
    expect(text).toContain('measureCode=D003040');
    expect(text).toContain('(ingekort: 3 van 52)');
    expect(text).toContain('T001616');
    expect(text).toContain('301100');
    expect(text).toContain('A025430');
    expect(text).toContain("geen regio's");
    expect(text).toContain(LANDBOUW_QUESTION);
  });

  it('states "(geen leden aangeboden)" for a breakdown pre-filtered to zero members', () => {
    const input = regionlessZeroMembersInput();
    const regioS = input.breakdowns.find((b) => b.name === 'RegioS');
    expect(regioS?.members).toEqual([]);
    const text = serializeTableParseInput(NEUTRAL_QUESTION, input);
    expect(text).toContain('dimensie=RegioS');
    expect(text).toContain('(geen leden aangeboden)');
  });

  it('states the table has regions when hasRegions is true', () => {
    const { schema, codeLists } = loadFixture('03759ned');
    const input = buildTableParseSchema(schema, codeLists, 'Hoeveel inwoners heeft Nederland?');
    expect(input.hasRegions).toBe(true);
    const text = serializeTableParseInput('Hoeveel inwoners heeft Nederland?', input);
    expect(text).toContain("kent regio's");
  });

  // Fix round 1 (task review, MINOR): a legend for the bare grain codes.
  it('adds a Dutch legend for the grain codes (JJ = jaar, KW = kwartaal, MM = maand)', () => {
    const input = landbouwInput();
    const text = serializeTableParseInput(LANDBOUW_QUESTION, input);
    expect(text).toContain('JJ (jaar)');

    const { schema, codeLists } = loadFixture('80590ned');
    const mixed = buildTableParseSchema(schema, codeLists, 'Hoeveel personen waren er?');
    const mixedText = serializeTableParseInput('Hoeveel personen waren er?', mixed);
    expect(mixedText).toContain('JJ (jaar)');
    expect(mixedText).toContain('KW (kwartaal)');
    expect(mixedText).toContain('MM (maand)');
  });

  // Breadth step 4b, Task 2: the "groep:" line shows CBS's own measure group
  // (root › … › leaf), and is OMITTED entirely for a measure with no group —
  // never a "groep: " line with nothing after it.
  it('shows "groep: <root>" for a grouped measure, and omits the line for an ungrouped one', () => {
    const { schema, codeLists } = loadFixture('80590ned');
    const input = buildTableParseSchema(schema, codeLists, 'Hoeveel werklozen waren er?');
    const text = serializeTableParseInput('Hoeveel werklozen waren er?', input);
    expect(text).toContain('measureCode=D002308');
    expect(text).toContain('groep: Beroepsbevolking');
    expect(text).toContain('groep: Werkloze beroepsbevolking');

    const ungrouped = landbouwInput();
    expect(ungrouped.measures.every((m) => m.groupPath.length === 0)).toBe(true);
    const ungroupedText = serializeTableParseInput(LANDBOUW_QUESTION, ungrouped);
    expect(ungroupedText).not.toContain('groep:');
  });
});

// ---------------------------------------------------------------------------
// buildTableParseRequest — determinism, no date, anyOf not oneOf
// ---------------------------------------------------------------------------

describe('buildTableParseRequest', () => {
  it('is deterministic: same input twice → same requestHash', () => {
    const input = landbouwInput();
    const r1 = buildTableParseRequest(LANDBOUW_QUESTION, input);
    const r2 = buildTableParseRequest(LANDBOUW_QUESTION, input);
    expect(requestHash(r1)).toBe(requestHash(r2));
  });

  it('mid-tier default: no sampling params, thinking disabled; a Haiku override keeps temperature 0 (session 153)', () => {
    const input = landbouwInput();
    const request = buildTableParseRequest(LANDBOUW_QUESTION, input);
    expect(request.model).toBe('claude-sonnet-5');
    expect(request.temperature).toBeUndefined();
    expect(request.thinking).toBe('disabled');
    const haiku = buildTableParseRequest(LANDBOUW_QUESTION, input, { model: 'claude-haiku-4-5' });
    expect(haiku.temperature).toBe(0);
    expect(haiku.thinking).toBeUndefined();
  });

  it('a JSON schema with no bare Date/timestamp in the system prompt', () => {
    const input = landbouwInput();
    const request = buildTableParseRequest(LANDBOUW_QUESTION, input);
    expect(request.system).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(request.jsonSchema).toBeDefined();
  });

  it("the generated JSON schema is rewritten to anyOf (never oneOf) — structured-outputs requirement", () => {
    const schema = tableParseJsonSchema();
    expect(JSON.stringify(schema)).not.toContain('"oneOf"');
    expect(JSON.stringify(schema)).toContain('"anyOf"');
  });
});

// ---------------------------------------------------------------------------
// validateTableParseOutput — the hard allowlist
// ---------------------------------------------------------------------------

describe('validateTableParseOutput — measure allowlist', () => {
  it("'geen' maps to measureCode: null", () => {
    const input = landbouwInput();
    const result = validateTableParseOutput(validJson(input, { measureCode: TABLE_PARSE_MEASURE_NONE }), input);
    expect(result.measureCode).toBeNull();
  });

  it('a real measure code is accepted verbatim', () => {
    const input = landbouwInput();
    const result = validateTableParseOutput(validJson(input), input);
    expect(result.measureCode).toBe('D003040');
  });

  it('an invented measure code throws', () => {
    const input = landbouwInput();
    expect(() => validateTableParseOutput(validJson(input, { measureCode: 'NOPE999' }), input)).toThrow(
      TableParseValidationError,
    );
  });
});

describe('validateTableParseOutput — breakdown allowlist', () => {
  it('a real, OFFERED member code is accepted', () => {
    const input = landbouwInput();
    const json = validJson(input, {
      breakdowns: [
        { dimension: 'EmissiesNaarLucht', choice: TABLE_PARSE_NOT_NAMED },
        { dimension: 'Klimaatsectoren', choice: '301100' },
      ],
    });
    const result = validateTableParseOutput(json, input);
    expect(result.breakdowns['Klimaatsectoren']).toEqual({ kind: 'member', code: '301100' });
  });

  it("'niet_genoemd' maps to kind 'not_named'", () => {
    const input = landbouwInput();
    const json = validJson(input, {
      breakdowns: [
        { dimension: 'EmissiesNaarLucht', choice: TABLE_PARSE_NOT_NAMED },
        { dimension: 'Klimaatsectoren', choice: TABLE_PARSE_NOT_NAMED },
      ],
    });
    const result = validateTableParseOutput(json, input);
    expect(result.breakdowns['Klimaatsectoren']).toEqual({ kind: 'not_named' });
  });

  it("'anders' maps to kind 'other'", () => {
    const input = landbouwInput();
    const json = validJson(input, {
      breakdowns: [
        { dimension: 'EmissiesNaarLucht', choice: TABLE_PARSE_NOT_NAMED },
        { dimension: 'Klimaatsectoren', choice: TABLE_PARSE_OTHER },
      ],
    });
    const result = validateTableParseOutput(json, input);
    expect(result.breakdowns['Klimaatsectoren']).toEqual({ kind: 'other' });
  });

  it('a real member that the pre-filter cut (not in the offered list) throws — never silently accepted', () => {
    const input = landbouwInput();
    // A025447 ("Stationaire bronnen; totaal") is a REAL Klimaatsectoren code
    // that did not match "landbouw" and was not the grand total, so it is
    // NOT among the 3 offered members — the model must answer 'anders', not
    // this code.
    const offeredCodes = input.breakdowns.find((b) => b.name === 'Klimaatsectoren')!.members.map((m) => m.code);
    expect(offeredCodes).not.toContain('A050124');
    const json = validJson(input, {
      breakdowns: [{ dimension: 'Klimaatsectoren', choice: 'A050124' }],
    });
    expect(() => validateTableParseOutput(json, input)).toThrow(TableParseValidationError);
  });

  it('an unknown dimension name throws', () => {
    const input = landbouwInput();
    const json = validJson(input, {
      breakdowns: [{ dimension: 'NotADimension', choice: TABLE_PARSE_NOT_NAMED }],
    });
    expect(() => validateTableParseOutput(json, input)).toThrow(TableParseValidationError);
  });

  it('a missing dimension (not every offered dimension answered) throws', () => {
    const input = caribischInput();
    expect(input.breakdowns.map((b) => b.name)).toEqual(['CaribischNederland', 'Persoonskenmerken']);
    const json = validJson(input, {
      breakdowns: [{ dimension: 'CaribischNederland', choice: TABLE_PARSE_NOT_NAMED }],
      // Persoonskenmerken omitted entirely.
    });
    expect(() => validateTableParseOutput(json, input)).toThrow(TableParseValidationError);
  });

  it('a duplicated dimension throws', () => {
    const input = caribischInput();
    const json = validJson(input, {
      breakdowns: [
        { dimension: 'CaribischNederland', choice: TABLE_PARSE_NOT_NAMED },
        { dimension: 'CaribischNederland', choice: TABLE_PARSE_OTHER },
        { dimension: 'Persoonskenmerken', choice: TABLE_PARSE_NOT_NAMED },
      ],
    });
    expect(() => validateTableParseOutput(json, input)).toThrow(TableParseValidationError);
  });

  it('a breakdown pre-filtered to zero offered members only ever validates as not_named/other, never a member', () => {
    const input = regionlessZeroMembersInput();
    const regioS = input.breakdowns.find((b) => b.name === 'RegioS')!;
    expect(regioS.members).toEqual([]);
    const notNamed = validJson(input, {
      breakdowns: input.breakdowns.map((b) => ({
        dimension: b.name,
        choice: b.name === 'RegioS' ? TABLE_PARSE_NOT_NAMED : TABLE_PARSE_NOT_NAMED,
      })),
    });
    expect(validateTableParseOutput(notNamed, input).breakdowns['RegioS']).toEqual({ kind: 'not_named' });

    const anyCode = validJson(input, {
      breakdowns: input.breakdowns.map((b) => ({
        dimension: b.name,
        choice: b.name === 'RegioS' ? 'NL01' : TABLE_PARSE_NOT_NAMED,
      })),
    });
    expect(() => validateTableParseOutput(anyCode, input)).toThrow(TableParseValidationError);
  });

  it('a breakdown dimension offered in full (≤ 40 members) accepts any of its own real member codes', () => {
    const input = caribischInput();
    const json = validJson(input, {
      breakdowns: [
        { dimension: 'CaribischNederland', choice: TABLE_PARSE_NOT_NAMED },
        { dimension: 'Persoonskenmerken', choice: TABLE_PARSE_NOT_NAMED },
      ],
    });
    expect(() => validateTableParseOutput(json, input)).not.toThrow();
  });

  // Fix round 1 (task review, MINOR regression): a real member code that
  // belongs to a DIFFERENT offered dimension on the same table must still
  // throw — the allowlist is per-dimension, not table-wide.
  it('a real member code that belongs to a DIFFERENT dimension throws', () => {
    const input = caribischInput();
    const persoonskenmerkenCodes = input.breakdowns.find((b) => b.name === 'Persoonskenmerken')!.members.map(
      (m) => m.code,
    );
    const caribischCodes = input.breakdowns.find((b) => b.name === 'CaribischNederland')!.members.map(
      (m) => m.code,
    );
    const borrowed = persoonskenmerkenCodes.find((c) => !caribischCodes.includes(c));
    expect(borrowed).toBeDefined();
    const json = validJson(input, {
      breakdowns: [
        { dimension: 'CaribischNederland', choice: borrowed! },
        { dimension: 'Persoonskenmerken', choice: TABLE_PARSE_NOT_NAMED },
      ],
    });
    expect(() => validateTableParseOutput(json, input)).toThrow(TableParseValidationError);
  });

  // Fix round 1 (task review, MINOR regression): the allowlist compares
  // LITERAL strings — a case-variant of a valid literal/code is not the same
  // string and must throw, never be normalized/repaired.
  it('case-variant literals/codes throw rather than being normalized', () => {
    const input = caribischInput();
    const jsonCapitalOther = validJson(input, {
      breakdowns: [
        { dimension: 'CaribischNederland', choice: 'Anders' },
        { dimension: 'Persoonskenmerken', choice: TABLE_PARSE_NOT_NAMED },
      ],
    });
    expect(() => validateTableParseOutput(jsonCapitalOther, input)).toThrow(TableParseValidationError);

    const jsonCapitalMeasure = validJson(input, { measureCode: 'Geen' });
    expect(() => validateTableParseOutput(jsonCapitalMeasure, input)).toThrow(TableParseValidationError);

    const lowerMeasureCode = validJson(landbouwInput(), { measureCode: 'd003040' });
    expect(() => validateTableParseOutput(lowerMeasureCode, landbouwInput())).toThrow(TableParseValidationError);
  });
});

describe('validateTableParseOutput — regions', () => {
  it('region terms on a table with no region/geo-like dimension throw the distinct TableParseRegionUnavailableError subclass', () => {
    const input = landbouwInput();
    expect(input.hasRegions).toBe(false);
    const json = validJson(input, { regions: [{ name: 'Utrecht', kind: 'onbekend' }] });
    expect(() => validateTableParseOutput(json, input)).toThrow(TableParseRegionUnavailableError);
    // The subclass IS a TableParseValidationError (never a partial result
    // either way), but step 5 must be able to tell the two apart.
    expect(() => validateTableParseOutput(json, input)).toThrow(TableParseValidationError);
    try {
      validateTableParseOutput(json, input);
      throw new Error('unreachable');
    } catch (error) {
      expect(error).toBeInstanceOf(TableParseRegionUnavailableError);
      expect((error as Error).name).toBe('TableParseRegionUnavailableError');
    }
  });

  it('an ordinary malformed-output error is NOT the region-unavailable subclass', () => {
    const input = landbouwInput();
    try {
      validateTableParseOutput(validJson(input, { measureCode: 'INVENTED' }), input);
      throw new Error('unreachable');
    } catch (error) {
      expect(error).toBeInstanceOf(TableParseValidationError);
      expect(error).not.toBeInstanceOf(TableParseRegionUnavailableError);
    }
  });

  it('an empty regions array is always fine, even on a region-less table', () => {
    const input = landbouwInput();
    expect(() => validateTableParseOutput(validJson(input, { regions: [] }), input)).not.toThrow();
  });

  it('region terms are accepted on a table that DOES have regions', () => {
    const { schema, codeLists } = loadFixture('03759ned');
    const input = buildTableParseSchema(schema, codeLists, 'Hoeveel inwoners heeft Utrecht?');
    expect(input.hasRegions).toBe(true);
    const json = validJson(input, { regions: [{ name: 'Utrecht', kind: 'onbekend' }] });
    const result = validateTableParseOutput(json, input);
    expect(result.regions).toEqual([{ name: 'Utrecht', kind: 'onbekend' }]);
  });
});

describe('validateTableParseOutput — confidence, JSON, schema', () => {
  it('confidence above 1 throws', () => {
    const input = landbouwInput();
    expect(() => validateTableParseOutput(validJson(input, { confidence: 1.5 }), input)).toThrow(
      TableParseValidationError,
    );
  });

  it('confidence below 0 throws', () => {
    const input = landbouwInput();
    expect(() => validateTableParseOutput(validJson(input, { confidence: -0.1 }), input)).toThrow(
      TableParseValidationError,
    );
  });

  it('invalid JSON throws', () => {
    const input = landbouwInput();
    expect(() => validateTableParseOutput('{not json', input)).toThrow(TableParseValidationError);
  });

  it('a schema violation (missing required field) throws', () => {
    const input = landbouwInput();
    const parsed = JSON.parse(validJson(input)) as Record<string, unknown>;
    delete parsed.reading;
    expect(() => validateTableParseOutput(JSON.stringify(parsed), input)).toThrow(TableParseValidationError);
  });

  it('an extra, unrecognized field throws (strictObject)', () => {
    const input = landbouwInput();
    expect(() => validateTableParseOutput(validJson(input, { extra: 'nope' }), input)).toThrow(
      TableParseValidationError,
    );
  });

  // Breadth step 4b, Task 2: version bumped to 2 (the prompt now shows
  // measure groups) — a fixture recorded against the OLD (ungrouped) prompt
  // must never be silently accepted as if it answered the new one.
  it(`accepts the current version literal (${TABLE_PARSE_SCHEMA_VERSION})`, () => {
    const input = landbouwInput();
    expect(() => validateTableParseOutput(validJson(input, { version: TABLE_PARSE_SCHEMA_VERSION }), input)).not.toThrow();
  });

  it('rejects the previous version literal (1)', () => {
    const input = landbouwInput();
    expect(() => validateTableParseOutput(validJson(input, { version: 1 }), input)).toThrow(
      TableParseValidationError,
    );
  });
});

// ---------------------------------------------------------------------------
// Grain mapping — periodGrainUnavailable, both ways
// ---------------------------------------------------------------------------

describe('validateTableParseOutput — period grain availability', () => {
  it('85669NED publishes only JJ: a year period is available', () => {
    const input = landbouwInput();
    expect(input.periodGrains).toEqual(['JJ']);
    const result = validateTableParseOutput(validJson(input, { period: { kind: 'year', year: 2023 } }), input);
    expect(result.periodGrainUnavailable).toBe(false);
  });

  it('85669NED publishes only JJ: a quarter period is UNAVAILABLE', () => {
    const input = landbouwInput();
    const result = validateTableParseOutput(
      validJson(input, { period: { kind: 'quarter', year: 2023, quarter: 2 } }),
      input,
    );
    expect(result.periodGrainUnavailable).toBe(true);
  });

  it('a month period requires MM (unavailable on a yearly-only table)', () => {
    const input = landbouwInput();
    const result = validateTableParseOutput(
      validJson(input, { period: { kind: 'month', year: 2023, month: 5 } }),
      input,
    );
    expect(result.periodGrainUnavailable).toBe(true);
  });

  it('year_range and change_over_year require JJ (available)', () => {
    const input = landbouwInput();
    expect(
      validateTableParseOutput(
        validJson(input, { period: { kind: 'year_range', fromYear: 2020, toYear: 2023 } }),
        input,
      ).periodGrainUnavailable,
    ).toBe(false);
    expect(
      validateTableParseOutput(validJson(input, { period: { kind: 'change_over_year', year: 2023 } }), input)
        .periodGrainUnavailable,
    ).toBe(false);
  });

  // 2026-10-01 (#342 (b)): a date range is flagged only when NO published
  // grain expresses its whole-month boundaries (the curated rule, ADR 023) —
  // "januari t/m december 2022" is exactly the year 2022 on a yearly table.
  it('date_range over whole calendar years is expressible at JJ (available here)', () => {
    const input = landbouwInput();
    const result = validateTableParseOutput(
      validJson(input, {
        period: {
          kind: 'date_range',
          from: { year: 2022, month: 1, day: null },
          to: { year: 2022, month: 12, day: null },
          toInclusive: true,
        },
      }),
      input,
    );
    expect(result.periodGrainUnavailable).toBe(false);
  });

  it('date_range whose boundaries only months express (March..August) is flagged on a yearly-only table', () => {
    const input = landbouwInput();
    const result = validateTableParseOutput(
      validJson(input, {
        period: {
          kind: 'date_range',
          from: { year: 2022, month: 3, day: null },
          to: { year: 2022, month: 8, day: null },
          toInclusive: true,
        },
      }),
      input,
    );
    expect(result.periodGrainUnavailable).toBe(true);
  });

  it('a date_range that cuts into a month is not flagged here (the lane resolver refuses it with its own reason)', () => {
    const input = landbouwInput();
    const result = validateTableParseOutput(
      validJson(input, {
        period: {
          kind: 'date_range',
          from: { year: 2022, month: 1, day: 15 },
          to: { year: 2022, month: 12, day: 31 },
          toInclusive: true,
        },
      }),
      input,
    );
    expect(result.periodGrainUnavailable).toBe(false);
  });

  it("'since' with a month set requires MM (unavailable)", () => {
    const input = landbouwInput();
    const result = validateTableParseOutput(
      validJson(input, { period: { kind: 'since', year: 2020, quarter: null, month: 3 } }),
      input,
    );
    expect(result.periodGrainUnavailable).toBe(true);
  });

  it("'since' with a quarter set requires KW (unavailable)", () => {
    const input = landbouwInput();
    const result = validateTableParseOutput(
      validJson(input, { period: { kind: 'since', year: 2020, quarter: 2, month: null } }),
      input,
    );
    expect(result.periodGrainUnavailable).toBe(true);
  });

  it("'since' with neither set requires JJ (available)", () => {
    const input = landbouwInput();
    const result = validateTableParseOutput(
      validJson(input, { period: { kind: 'since', year: 2020, quarter: null, month: null } }),
      input,
    );
    expect(result.periodGrainUnavailable).toBe(false);
  });

  it("'last_n'/'now_vs_ago'/'relative' map by unit — year available, quarter/month unavailable", () => {
    const input = landbouwInput();
    expect(
      validateTableParseOutput(validJson(input, { period: { kind: 'last_n', unit: 'year', n: 3 } }), input)
        .periodGrainUnavailable,
    ).toBe(false);
    expect(
      validateTableParseOutput(validJson(input, { period: { kind: 'last_n', unit: 'quarter', n: 3 } }), input)
        .periodGrainUnavailable,
    ).toBe(true);
    expect(
      validateTableParseOutput(validJson(input, { period: { kind: 'now_vs_ago', unit: 'month', amount: 6 } }), input)
        .periodGrainUnavailable,
    ).toBe(true);
    expect(
      validateTableParseOutput(validJson(input, { period: { kind: 'relative', unit: 'year', offset: -1 } }), input)
        .periodGrainUnavailable,
    ).toBe(false);
  });

  it("'latest' and 'none' are never unavailable, even on a yearly-only table", () => {
    const input = landbouwInput();
    expect(
      validateTableParseOutput(validJson(input, { period: { kind: 'latest' } }), input).periodGrainUnavailable,
    ).toBe(false);
    expect(
      validateTableParseOutput(validJson(input, { period: { kind: 'none' } }), input).periodGrainUnavailable,
    ).toBe(false);
  });

  it('a mixed-grain table (80590ned: JJ, KW, MM all present) has every grain available', () => {
    const { schema, codeLists } = loadFixture('80590ned');
    const input = buildTableParseSchema(schema, codeLists, 'Hoeveel personen waren er?');
    expect(input.periodGrains).toEqual(['JJ', 'KW', 'MM']);
    // M006335: a measure the model can tell apart (its first measure,
    // 3000790_2, has indistinguishable twins — see the F4 tests below).
    const measureCode = 'M006335';
    expect(
      validateTableParseOutput(validJson(input, { measureCode, period: { kind: 'quarter', year: 2023, quarter: 1 } }), input)
        .periodGrainUnavailable,
    ).toBe(false);
    expect(
      validateTableParseOutput(validJson(input, { measureCode, period: { kind: 'month', year: 2023, month: 4 } }), input)
        .periodGrainUnavailable,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// tableParse — end-to-end over a stub client
// ---------------------------------------------------------------------------

describe('tableParse (stub client, no real LLM)', () => {
  it('calls the client with the built request and returns the validated result', async () => {
    const input = landbouwInput();
    const client = new StubClient(validJson(input, { measureCode: 'D003040', confidence: 0.93, reading: 'ok' }));
    const { result } = await tableParse(LANDBOUW_QUESTION, input, { client });
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]!.system).toBe(buildTableParseSystemPrompt());
    expect(result.measureCode).toBe('D003040');
    expect(result.confidence).toBe(0.93);
    expect(result.reading).toBe('ok');
  });

  // Final-review F9: the call's audit metadata travels with the result
  // (mirrors parseQuestion keeping model + usage), so step 5 can log the
  // exact request/response that produced a parse.
  it('returns audit metadata: request hash, model, usage and the raw output text', async () => {
    const input = landbouwInput();
    const outputText = validJson(input);
    const client = new StubClient(outputText);
    const { audit } = await tableParse(LANDBOUW_QUESTION, input, { client });
    expect(audit.requestHash).toBe(requestHash(client.calls[0]!));
    expect(audit.requestHash).toBe(requestHash(buildTableParseRequest(LANDBOUW_QUESTION, input)));
    expect(audit.model).toBe('stub');
    expect(audit.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
    expect(audit.outputText).toBe(outputText);
  });

  it('propagates TableParseValidationError from an off-allowlist stub response', async () => {
    const input = landbouwInput();
    const client = new StubClient(validJson(input, { measureCode: 'INVENTED' }));
    await expect(tableParse(LANDBOUW_QUESTION, input, { client })).rejects.toThrow(TableParseValidationError);
  });
});

// ---------------------------------------------------------------------------
// Final-review fix wave — F1 (places on region-coded breakdown dimensions),
// F3 (regionScope), F4 (indistinguishable measures), F9 (question quoting),
// F10 (geen short-circuits the region checks)
// ---------------------------------------------------------------------------

function jsonWith(input: TableParseSchema, choices: Record<string, string>, overrides: Record<string, unknown> = {}): string {
  return validJson(input, {
    breakdowns: input.breakdowns.map((b) => ({ dimension: b.name, choice: choices[b.name] ?? TABLE_PARSE_NOT_NAMED })),
    ...overrides,
  });
}

// 85004NED: "Groningen" matches THREE offered RegioS members — PV20
// "Groningen (PV)", ES01 "Groningen (ES)", ET0101 "Groningen (ET)" — and the
// table's hasRegions is false (RegioS is an ordinary breakdown dimension).
const GRONINGEN_QUESTION = 'Hoeveel megawatt aan opgesteld vermogen was er in Groningen in 2021?';
function groningenInput(question = GRONINGEN_QUESTION): TableParseSchema {
  const { schema, codeLists } = loadFixture('85004NED');
  return buildTableParseSchema(schema, codeLists, question);
}
const GRONINGEN = [{ name: 'Groningen', kind: 'onbekend' }];

describe('validateTableParseOutput — places on a region-coded breakdown dimension (F1)', () => {
  it('fixture facts: hasRegions is false and all three Groningen members are offered', () => {
    const input = groningenInput();
    expect(input.hasRegions).toBe(false);
    const offered = input.breakdowns.find((b) => b.name === 'RegioS')!.members.map((m) => m.code);
    expect(offered).toEqual(expect.arrayContaining(['PV20', 'ES01', 'ET0101']));
  });

  it("accepts 'anders' on the dimension that lists the named place", () => {
    const input = groningenInput();
    const result = validateTableParseOutput(jsonWith(input, { RegioS: TABLE_PARSE_OTHER }, { regions: GRONINGEN }), input);
    expect(result.breakdowns['RegioS']).toEqual({ kind: 'other' });
    expect(result.regions).toEqual(GRONINGEN);
  });

  // Follow-up ruling: look-alike places must ask. When MORE THAN ONE offered
  // member of the dimension matches the place, only 'anders' passes — even a
  // matching member pick (PV20/ES01/ET0101 all match "Groningen") throws.
  it.each(['PV20', 'ES01', 'ET0101'])(
    "rejects a member pick (%s) when several offered members match the named place — only 'anders' passes",
    (code) => {
      const input = groningenInput();
      const json = jsonWith(input, { RegioS: code }, { regions: GRONINGEN });
      expect(() => validateTableParseOutput(json, input)).toThrow(TableParseValidationError);
      expect(() => validateTableParseOutput(json, input)).not.toThrow(TableParseRegionUnavailableError);
    },
  );

  it('accepts the matching member pick when exactly ONE offered member matches the named place (85004NED "Nederland" → NL01)', () => {
    const input = groningenInput('Hoeveel megawatt aan opgesteld vermogen was er in Nederland in 2021?');
    const regioS = input.breakdowns.find((b) => b.name === 'RegioS')!;
    expect(regioS.members.filter((m) => m.title === 'Nederland').map((m) => m.code)).toEqual(['NL01']);
    const json = jsonWith(input, { RegioS: 'NL01' }, { regions: [{ name: 'Nederland', kind: 'land' }] });
    expect(validateTableParseOutput(json, input).breakdowns['RegioS']).toEqual({ kind: 'member', code: 'NL01' });
  });

  it("rejects 'niet_genoemd' on the dimension that lists the named place — the place would silently fall to the total", () => {
    const input = groningenInput();
    const json = jsonWith(input, { RegioS: TABLE_PARSE_NOT_NAMED }, { regions: GRONINGEN });
    expect(() => validateTableParseOutput(json, input)).toThrow(TableParseValidationError);
    expect(() => validateTableParseOutput(json, input)).not.toThrow(TableParseRegionUnavailableError);
  });

  it('rejects a member pick whose title does NOT match the named place', () => {
    const question = 'Hoeveel megawatt aan opgesteld vermogen was er in Groningen en Drenthe in 2021?';
    const input = groningenInput(question);
    const offered = input.breakdowns.find((b) => b.name === 'RegioS')!.members.map((m) => m.code);
    expect(offered).toContain('PV22'); // Drenthe (PV)
    const json = jsonWith(input, { RegioS: 'PV22' }, { regions: GRONINGEN });
    expect(() => validateTableParseOutput(json, input)).toThrow(TableParseValidationError);
    expect(() => validateTableParseOutput(json, input)).not.toThrow(TableParseRegionUnavailableError);
  });

  it('throws TableParseRegionUnavailableError when a named place matches no offered member of any breakdown dimension', () => {
    // "Maastricht" is not a member title on its own ("Maastricht Heuvelland
    // (ET)" is a different, larger area) — whole-name matching, never a
    // substring guess.
    const question = 'Hoeveel megawatt aan opgesteld vermogen was er in Maastricht in 2021?';
    const input = groningenInput(question);
    const json = jsonWith(input, { RegioS: TABLE_PARSE_OTHER }, { regions: [{ name: 'Maastricht', kind: 'gemeente' }] });
    expect(() => validateTableParseOutput(json, input)).toThrow(TableParseRegionUnavailableError);
  });

  it('82291NED: "Caribisch Nederland" matches exactly one CaribischNederland member (CN01), matched case-insensitively', () => {
    const { schema, codeLists } = loadFixture('82291NED');
    const question = 'Wat is het percentage volwassenen met hoge bloeddruk in Caribisch Nederland in 2021?';
    const input = buildTableParseSchema(schema, codeLists, question);
    const ok = jsonWith(input, { CaribischNederland: 'CN01' }, { regions: [{ name: 'caribisch nederland', kind: 'onbekend' }] });
    expect(validateTableParseOutput(ok, input).breakdowns['CaribischNederland']).toEqual({ kind: 'member', code: 'CN01' });
    const bonaire = jsonWith(input, { CaribischNederland: 'GM9001' }, { regions: [{ name: 'Caribisch Nederland', kind: 'onbekend' }] });
    expect(() => validateTableParseOutput(bonaire, input)).toThrow(TableParseValidationError);
  });

  // Final-review C1 ruling consequence: a stated kind maps to ONE CBS code
  // family (landsdeel → LD, land → NL). CN01 is neither, so the model
  // tagging "Caribisch Nederland" as a landsdeel or a land now refuses
  // (region unavailable) rather than answering — the ruling's accepted cost
  // ("extra refusals when a kind word is loose"), never a wrong population.
  it.each(['landsdeel', 'land'])(
    '82291NED: "Caribisch Nederland" stated as a %s refuses — CN01 is not an LD/NL code (C1 ruling)',
    (kind) => {
      const { schema, codeLists } = loadFixture('82291NED');
      const question = 'Wat is het percentage volwassenen met hoge bloeddruk in Caribisch Nederland in 2021?';
      const input = buildTableParseSchema(schema, codeLists, question);
      const json = jsonWith(input, { CaribischNederland: 'CN01' }, { regions: [{ name: 'Caribisch Nederland', kind }] });
      expect(() => validateTableParseOutput(json, input)).toThrow(TableParseRegionUnavailableError);
    },
  );

  it('a table that DOES have regions is not subject to this check (regions are resolved against its geo dimension later)', () => {
    const { schema, codeLists } = loadFixture('03759ned');
    const input = buildTableParseSchema(schema, codeLists, 'Hoeveel inwoners had Amsterdam in 2022?');
    const json = jsonWith(input, {}, { regions: [{ name: 'Amsterdam', kind: 'gemeente' }] });
    expect(() => validateTableParseOutput(json, input)).not.toThrow();
  });
});

describe('validateTableParseOutput — regionScope (F3)', () => {
  it('passes regionScope through (null by default)', () => {
    const input = landbouwInput();
    expect(validateTableParseOutput(validJson(input), input).regionScope).toBeNull();
  });

  it('a non-null regionScope on a table without regions throws TableParseRegionUnavailableError', () => {
    const input = groningenInput('Welke provincie had in 2021 het meeste opgestelde vermogen?');
    expect(input.hasRegions).toBe(false);
    const json = jsonWith(input, { RegioS: TABLE_PARSE_OTHER }, { regionScope: 'all_provincies', derivation: 'max' });
    expect(() => validateTableParseOutput(json, input)).toThrow(TableParseRegionUnavailableError);
  });

  it('a non-null regionScope is accepted on a table that has regions', () => {
    const { schema, codeLists } = loadFixture('03759ned');
    const input = buildTableParseSchema(schema, codeLists, 'Hoeveel inwoners had elke provincie in 2022?');
    const result = validateTableParseOutput(validJson(input, { regionScope: 'all_provincies' }), input);
    expect(result.regionScope).toBe('all_provincies');
  });

  it('an unknown regionScope value is a schema violation', () => {
    const input = landbouwInput();
    expect(() => validateTableParseOutput(validJson(input, { regionScope: 'alle_wijken' }), input)).toThrow(
      TableParseValidationError,
    );
  });

  it('the JSON schema carries regionScope as a required, nullable enum', () => {
    const schema = tableParseJsonSchema() as { required?: string[]; properties?: Record<string, unknown> };
    expect(schema.required).toContain('regionScope');
    expect(JSON.stringify(schema.properties?.regionScope)).toContain('all_provincies');
  });
});

describe("validateTableParseOutput — 'geen' short-circuits the region checks (F10)", () => {
  it("a 'geen' measure with a named place on a region-less table returns the result with regions as given", () => {
    const input = landbouwInput();
    const regions = [{ name: 'Utrecht', kind: 'onbekend' }];
    const result = validateTableParseOutput(
      validJson(input, { measureCode: TABLE_PARSE_MEASURE_NONE, regions }),
      input,
    );
    expect(result.measureCode).toBeNull();
    expect(result.regions).toEqual(regions);
  });

  it("a 'geen' measure with a regionScope on a region-less table does not throw either", () => {
    const input = landbouwInput();
    const result = validateTableParseOutput(
      validJson(input, { measureCode: TABLE_PARSE_MEASURE_NONE, regionScope: 'all_gemeenten' }),
      input,
    );
    expect(result.regionScope).toBe('all_gemeenten');
  });

  it("a 'geen' measure with niet_genoemd on the dimension listing the named place does not throw", () => {
    const input = groningenInput();
    const json = jsonWith(input, { RegioS: TABLE_PARSE_NOT_NAMED }, { measureCode: TABLE_PARSE_MEASURE_NONE, regions: GRONINGEN });
    expect(() => validateTableParseOutput(json, input)).not.toThrow();
  });

  it("'geen' does NOT skip the structural breakdown allowlist", () => {
    const input = landbouwInput();
    const json = validJson(input, {
      measureCode: TABLE_PARSE_MEASURE_NONE,
      breakdowns: [{ dimension: 'NotADimension', choice: TABLE_PARSE_NOT_NAMED }],
    });
    expect(() => validateTableParseOutput(json, input)).toThrow(TableParseValidationError);
  });
});

describe('validateTableParseOutput — indistinguishable measures (F4)', () => {
  // 80590ned: four measures share title "Niet-seizoengecorrigeerd", unit
  // "x 1000" and an empty description (3000790_2, 3000795_2, 3000800_2,
  // 3000810_2). Before groupPath existed, NOTHING the model saw told them
  // apart. Breadth step 4b, Task 2, measured against the live-refreshed
  // fixture: CBS itself files each of the four under a DIFFERENT measure
  // group ("Beroepsbevolking", "Werkzame beroepsbevolking", "Werkloze
  // beroepsbevolking", "Niet-beroepsbevolking") — so the group, now part of
  // the fingerprint, resolves what used to be a real ambiguity. Checked
  // across all 10 fixture tables (extract-tableparse-schemas re-run): this
  // was the ONLY set of same-(title, unit, description) measures anywhere in
  // the fixtures, and it is fully resolved by group — none of the 8 eligible
  // tables has a real ambiguous-measure case left (see
  // benchmark/tableparse-labelled-set.json's own note on
  // 'ambiguous-arbeid-werklozen').
  function arbeidInput(): TableParseSchema {
    const { schema, codeLists } = loadFixture('80590ned');
    return buildTableParseSchema(schema, codeLists, 'Hoeveel werklozen waren er in 2021 (niet seizoengecorrigeerd)?');
  }

  it('fixture fact: the four x 1000 non-adjusted measures share title/unit/description but now carry DISTINCT groups', () => {
    const input = arbeidInput();
    const group = input.measures.filter((m) => ['3000790_2', '3000795_2', '3000800_2', '3000810_2'].includes(m.code));
    expect(group).toHaveLength(4);
    expect(new Set(group.map((m) => `${m.title}|${m.unit}|${m.description}`)).size).toBe(1);
    expect(new Set(group.map((m) => JSON.stringify(m.groupPath))).size).toBe(4);
  });

  it('groupPath now distinguishes them: choosing any one of the four no longer throws', () => {
    const input = arbeidInput();
    for (const code of ['3000790_2', '3000795_2', '3000800_2', '3000810_2']) {
      const json = jsonWith(input, {}, { measureCode: code });
      expect(validateTableParseOutput(json, input).measureCode).toBe(code);
    }
  });

  it('a measure whose description sets it apart is accepted (M006335)', () => {
    const input = arbeidInput();
    const json = jsonWith(input, {}, { measureCode: 'M006335' });
    expect(validateTableParseOutput(json, input).measureCode).toBe('M006335');
  });

  it("'geen' is never an ambiguous-measure error", () => {
    const input = arbeidInput();
    const json = jsonWith(input, {}, { measureCode: TABLE_PARSE_MEASURE_NONE });
    expect(validateTableParseOutput(json, input).measureCode).toBeNull();
  });

  // Synthetic: the guard must still fire when two offered measures are
  // TRULY identical — same group, title, unit AND description — since no
  // real fixture table currently has that shape (see the fixture-fact test
  // above). This is what proves the guard itself was widened to include
  // groupPath, not silently disabled.
  it('two measures with the SAME group, title, unit and description still throw (synthetic)', () => {
    const schema: CbsTableSchema = {
      tableId: 'SYN03',
      title: 'Synthetische tabel met twee identieke maten',
      dimensions: [{ name: 'Perioden', kind: 'TimeDimension', title: 'Perioden' }],
      measures: [
        {
          code: 'M1',
          title: 'Aantal',
          unit: 'x 1',
          decimals: 0,
          description: 'een telling',
          dataType: 'Double',
          groupPath: ['Groep A'],
        },
        {
          code: 'M2',
          title: 'Aantal',
          unit: 'x 1',
          decimals: 0,
          description: 'een telling',
          dataType: 'Double',
          groupPath: ['Groep A'],
        },
      ],
      modified: null,
    };
    const codeLists: Record<string, CbsCode[]> = {
      Perioden: [{ code: '2020JJ00', title: '2020', dimensionGroup: null, status: 'Definitief', index: 1 }],
    };
    const input = buildTableParseSchema(schema, codeLists, 'irrelevante vraag');
    const json = jsonWith(input, {}, { measureCode: 'M1' });
    expect(() => validateTableParseOutput(json, input)).toThrow(TableParseAmbiguousMeasureError);
  });

  // Synthetic counterpart, isolated from any real-fixture drift: same
  // title/unit/description but a DIFFERENT group does not throw.
  it('two measures with the SAME title/unit/description but a DIFFERENT group do not throw', () => {
    const schema: CbsTableSchema = {
      tableId: 'SYN04',
      title: 'Synthetische tabel met twee gelijke maten in verschillende groepen',
      dimensions: [{ name: 'Perioden', kind: 'TimeDimension', title: 'Perioden' }],
      measures: [
        {
          code: 'M1',
          title: 'Aantal',
          unit: 'x 1',
          decimals: 0,
          description: 'een telling',
          dataType: 'Double',
          groupPath: ['Groep A'],
        },
        {
          code: 'M2',
          title: 'Aantal',
          unit: 'x 1',
          decimals: 0,
          description: 'een telling',
          dataType: 'Double',
          groupPath: ['Groep B'],
        },
      ],
      modified: null,
    };
    const codeLists: Record<string, CbsCode[]> = {
      Perioden: [{ code: '2020JJ00', title: '2020', dimensionGroup: null, status: 'Definitief', index: 1 }],
    };
    const input = buildTableParseSchema(schema, codeLists, 'irrelevante vraag');
    const json = jsonWith(input, {}, { measureCode: 'M1' });
    expect(validateTableParseOutput(json, input).measureCode).toBe('M1');
  });
});

describe('serializeTableParseInput — the question is JSON-quoted (F9)', () => {
  it('embeds the question with JSON.stringify, so an inner quote cannot break out of the quoted text', () => {
    const input = landbouwInput();
    const question = 'Wat was de "echte" uitstoot van de landbouw?';
    const text = serializeTableParseInput(question, input);
    expect(text).toContain(`Volledige vraag van de gebruiker: ${JSON.stringify(question)}`);
    expect(text).toContain('\\"echte\\"');
  });
});

describe('buildTableParseSystemPrompt — final-review rules (F1, F3)', () => {
  it("widens 'anders' to several fitting members and questions across members", () => {
    const prompt = buildTableParseSystemPrompt();
    expect(prompt).toContain('MEERDERE leden');
    expect(prompt).toContain('"ouderen"');
    expect(prompt).toContain('welke leeftijdsgroep had de meeste');
  });

  it('tells the model to pick the place member on a breakdown dimension, or anders when several fit', () => {
    const prompt = buildTableParseSystemPrompt();
    expect(prompt).toContain('Groningen (PV)');
    expect(prompt).toContain('Groningen (ES)');
    expect(prompt).toContain('Groningen (ET)');
  });

  it('explains regionScope with the curated class values', () => {
    const prompt = buildTableParseSystemPrompt();
    for (const v of ['all_provincies', 'all_landsdelen', 'all_gemeenten', 'gemeenten_in_provincie']) {
      expect(prompt).toContain(v);
    }
    expect(prompt).toContain('regionScope');
  });
});

// ---------------------------------------------------------------------------
// Follow-up ruling: only REGION-CODED members count as places. A birth-
// country-like breakdown whose member is titled "Nederland" but coded
// 1012600 is a population characteristic, not a place — a question naming
// Nederland on such a table is region-unavailable, and that dimension's
// 'niet_genoemd' is not rejected by the place rule. Synthetic table: no
// fixture has this shape.
// ---------------------------------------------------------------------------

describe('validateTableParseOutput — only region-coded members count as places (follow-up)', () => {
  function geboortelandInput(question: string): TableParseSchema {
    const schema: CbsTableSchema = {
      tableId: 'SYN02',
      title: 'Synthetische tabel naar geboorteland',
      dimensions: [
        { name: 'Geboorteland', kind: 'Dimension', title: 'Geboorteland' },
        { name: 'Perioden', kind: 'TimeDimension', title: 'Perioden' },
      ],
      measures: [{ code: 'M1', title: 'Personen', unit: 'aantal', decimals: 0, description: 'aantal personen', dataType: 'Long', groupPath: [] }],
      modified: null,
    };
    const codeLists: Record<string, CbsCode[]> = {
      Geboorteland: [
        { code: 'T001040', title: 'Totaal', dimensionGroup: null, status: null, index: 1 },
        { code: '1012600', title: 'Nederland', dimensionGroup: null, status: null, index: 2 },
        { code: '1012700', title: 'Marokko', dimensionGroup: null, status: null, index: 3 },
      ],
      Perioden: [{ code: '2020JJ00', title: '2020', dimensionGroup: null, status: 'Definitief', index: 1 }],
    };
    return buildTableParseSchema(schema, codeLists, question);
  }
  const NEDERLAND = [{ name: 'Nederland', kind: 'land' }];

  it('fixture shape: Geboorteland is an ordinary breakdown on a region-less table, offering 1012600 "Nederland"', () => {
    const input = geboortelandInput('Hoeveel mensen woonden er in 2020 in Nederland?');
    expect(input.hasRegions).toBe(false);
    expect(input.breakdowns.map((b) => b.name)).toEqual(['Geboorteland']);
    expect(input.breakdowns[0]!.members.map((m) => m.code)).toContain('1012600');
  });

  it("a place matching only a non-region-coded member is region-unavailable; 'niet_genoemd' is not rejected by the place rule", () => {
    const input = geboortelandInput('Hoeveel mensen woonden er in 2020 in Nederland?');
    const json = jsonWith(input, { Geboorteland: TABLE_PARSE_NOT_NAMED }, { measureCode: 'M1', regions: NEDERLAND });
    expect(() => validateTableParseOutput(json, input)).toThrow(TableParseRegionUnavailableError);
    expect(() => validateTableParseOutput(json, input)).toThrow(/no offered region-coded breakdown member/);
  });

  it('picking the non-region-coded "Nederland" member does not make the place servable either', () => {
    const input = geboortelandInput('Hoeveel in Nederland geboren mensen waren er in 2020 in Nederland?');
    const json = jsonWith(input, { Geboorteland: '1012600' }, { measureCode: 'M1', regions: NEDERLAND });
    expect(() => validateTableParseOutput(json, input)).toThrow(TableParseRegionUnavailableError);
  });

  it('without a named place, the birth-country member is an ordinary pick', () => {
    const input = geboortelandInput('Hoeveel in Nederland geboren mensen waren er in 2020?');
    const json = jsonWith(input, { Geboorteland: '1012600' }, { measureCode: 'M1' });
    expect(validateTableParseOutput(json, input).breakdowns['Geboorteland']).toEqual({ kind: 'member', code: '1012600' });
  });
});

// ---------------------------------------------------------------------------
// Breadth step 4b, Task 3 — reader-side place normalization (readerPlaceKey):
// a reader typing a CBS-style title verbatim ("Groningen (PV)") or prefixing
// a bare name with a Dutch kind word ("provincie Groningen") must key the
// same as the matching member(s) — before this task, the validator keyed the
// NAMED region with plain normalizeRegionName(region.name), so a trailing
// parenthetical or a leading kind word left in the region.name made it key
// DIFFERENTLY from every offered member and threw the (wrong)
// TableParseRegionUnavailableError even though 85004NED plainly offers
// matching members.
// ---------------------------------------------------------------------------

describe('validateTableParseOutput — reader-side place normalization (readerPlaceKey, Task 3)', () => {
  it('"Groningen (PV)" (CBS-style title, parenthetical included) matches the same three offered members as bare "Groningen" — several match, so only \'anders\' passes', () => {
    const input = groningenInput();
    const named = [{ name: 'Groningen (PV)', kind: 'onbekend' }];
    const anders = jsonWith(input, { RegioS: TABLE_PARSE_OTHER }, { regions: named });
    expect(validateTableParseOutput(anders, input).breakdowns['RegioS']).toEqual({ kind: 'other' });

    // Before this task: readerPlaceKey did not exist, the validator keyed on
    // normalizeRegionName('Groningen (PV)') = "groningen (pv)", which matches
    // NO offered member's memberPlaceKey ("groningen") — a
    // TableParseRegionUnavailableError, even though the table plainly offers
    // three matching members. That must no longer happen.
    const niVsRegionUnavailable = jsonWith(input, { RegioS: TABLE_PARSE_NOT_NAMED }, { regions: named });
    expect(() => validateTableParseOutput(niVsRegionUnavailable, input)).toThrow(TableParseValidationError);
    expect(() => validateTableParseOutput(niVsRegionUnavailable, input)).not.toThrow(TableParseRegionUnavailableError);
  });

  it('"provincie Groningen" (leading Dutch kind word) matches the same three offered members as bare "Groningen"', () => {
    const input = groningenInput();
    const named = [{ name: 'provincie Groningen', kind: 'provincie' }];
    const anders = jsonWith(input, { RegioS: TABLE_PARSE_OTHER }, { regions: named });
    expect(validateTableParseOutput(anders, input).breakdowns['RegioS']).toEqual({ kind: 'other' });

    const niVsRegionUnavailable = jsonWith(input, { RegioS: TABLE_PARSE_NOT_NAMED }, { regions: named });
    expect(() => validateTableParseOutput(niVsRegionUnavailable, input)).toThrow(TableParseValidationError);
    expect(() => validateTableParseOutput(niVsRegionUnavailable, input)).not.toThrow(TableParseRegionUnavailableError);
  });

  // 85004NED has no 's-Gravenhage member (its RegioS is PV/ES/ET-coded, not
  // municipalities) — a small synthetic breakdown dimension, mirroring the
  // 'geboorteland' synthetic table above, pins the "Den Haag" alias case
  // against a single, unambiguous GM-coded match.
  function denHaagInput(question: string): TableParseSchema {
    const schema: CbsTableSchema = {
      tableId: 'SYN06',
      title: 'Synthetische tabel naar woonplaats',
      dimensions: [
        { name: 'Woonplaats', kind: 'Dimension', title: 'Woonplaats' },
        { name: 'Perioden', kind: 'TimeDimension', title: 'Perioden' },
      ],
      measures: [{ code: 'M1', title: 'Personen', unit: 'aantal', decimals: 0, description: 'aantal personen', dataType: 'Long', groupPath: [] }],
      modified: null,
    };
    const codeLists: Record<string, CbsCode[]> = {
      // Only 1 of 8 members is region-coded (12.5%, under the 0.8 geo-like
      // threshold — mirrors 85004NED's own measured ratio), so this stays an
      // ordinary 'breakdown' dimension, not 'geo_like'.
      Woonplaats: [
        { code: 'F0001', title: 'Fictieve plek A', dimensionGroup: null, status: null, index: 1 },
        { code: 'F0002', title: 'Fictieve plek B', dimensionGroup: null, status: null, index: 2 },
        { code: 'F0003', title: 'Fictieve plek C', dimensionGroup: null, status: null, index: 3 },
        { code: 'F0004', title: 'Fictieve plek D', dimensionGroup: null, status: null, index: 4 },
        { code: 'GM0518', title: "'s-Gravenhage (GM)", dimensionGroup: null, status: null, index: 5 },
        { code: 'F0006', title: 'Fictieve plek E', dimensionGroup: null, status: null, index: 6 },
        { code: 'F0007', title: 'Fictieve plek F', dimensionGroup: null, status: null, index: 7 },
        { code: 'F0008', title: 'Fictieve plek G', dimensionGroup: null, status: null, index: 8 },
      ],
      Perioden: [{ code: '2020JJ00', title: '2020', dimensionGroup: null, status: 'Definitief', index: 1 }],
    };
    return buildTableParseSchema(schema, codeLists, question);
  }

  it('"Den Haag" matches the single offered \'s-Gravenhage (GM) member (alias substitution)', () => {
    const input = denHaagInput('Hoeveel personen woonden er in Den Haag in 2020?');
    expect(input.hasRegions).toBe(false);
    const json = jsonWith(input, { Woonplaats: 'GM0518' }, { measureCode: 'M1', regions: [{ name: 'Den Haag', kind: 'gemeente' }] });
    expect(validateTableParseOutput(json, input).breakdowns['Woonplaats']).toEqual({ kind: 'member', code: 'GM0518' });
  });

  it('"Den Haag" with \'niet_genoemd\' on the matching dimension throws (would silently fall to the total)', () => {
    const input = denHaagInput('Hoeveel personen woonden er in Den Haag in 2020?');
    const json = jsonWith(input, { Woonplaats: TABLE_PARSE_NOT_NAMED }, { measureCode: 'M1', regions: [{ name: 'Den Haag', kind: 'gemeente' }] });
    expect(() => validateTableParseOutput(json, input)).toThrow(TableParseValidationError);
    expect(() => validateTableParseOutput(json, input)).not.toThrow(TableParseRegionUnavailableError);
  });
});

// ---------------------------------------------------------------------------
// Final-review C1 (breadth step 4b fix wave): the reader's place KIND must
// constrain, never be discarded. On 85004NED "Utrecht" matches exactly ONE
// region-coded member — PV26 "Utrecht (PV)", the PROVINCE (there is no
// Utrecht ES/ET look-alike; ET0902 "Foodvalley Utrecht (ET)" keys
// differently). Before this fix readerPlaceKey dropped the kind word, so a
// municipality question was silently answered with the province figure.
// ---------------------------------------------------------------------------

describe('validateTableParseOutput — the reader\'s place kind constrains the match (C1)', () => {
  const UTRECHT_QUESTION = 'Hoeveel megawatt aan opgesteld vermogen was er in Utrecht in 2021?';

  it('fixture facts: exactly one offered region-coded member keys as Utrecht, and it is the province PV26', () => {
    const input = groningenInput(UTRECHT_QUESTION);
    const regioS = input.breakdowns.find((b) => b.name === 'RegioS')!;
    const utrecht = regioS.members.filter((m) => /^(NL|PV|GM|LD|CR|WK|BU|CN|ES|ET)\d/.test(m.code) && /^utrecht( \(|$)/i.test(m.title));
    expect(utrecht.map((m) => m.code)).toEqual(['PV26']);
  });

  it.each([
    [{ name: 'gemeente Utrecht', kind: 'gemeente' }],
    [{ name: 'Utrecht (gemeente)', kind: 'gemeente' }],
    [{ name: 'regio Utrecht', kind: 'onbekend' }],
    [{ name: 'Utrecht', kind: 'gemeente' }],
  ])('rejects the province PV26 for %o — TableParseRegionUnavailableError, never the province figure', (region) => {
    const input = groningenInput(UTRECHT_QUESTION);
    for (const choice of ['PV26', TABLE_PARSE_OTHER, TABLE_PARSE_NOT_NAMED]) {
      const json = jsonWith(input, { RegioS: choice }, { regions: [region] });
      expect(() => validateTableParseOutput(json, input)).toThrow(TableParseRegionUnavailableError);
    }
  });

  it("accepts PV26 for {name:'provincie Utrecht', kind:'provincie'} — the only match, and it is a province", () => {
    const input = groningenInput(UTRECHT_QUESTION);
    const json = jsonWith(input, { RegioS: 'PV26' }, { regions: [{ name: 'provincie Utrecht', kind: 'provincie' }] });
    expect(validateTableParseOutput(json, input).breakdowns['RegioS']).toEqual({ kind: 'member', code: 'PV26' });
  });

  it('accepts PV26 for a bare "Utrecht" with kind onbekend (no kind known → the kind-agnostic rule, as before)', () => {
    const input = groningenInput(UTRECHT_QUESTION);
    const json = jsonWith(input, { RegioS: 'PV26' }, { regions: [{ name: 'Utrecht', kind: 'onbekend' }] });
    expect(validateTableParseOutput(json, input).breakdowns['RegioS']).toEqual({ kind: 'member', code: 'PV26' });
  });

  it("look-alike Groningen stays 'anders' even with kind 'provincie' — a kind never narrows several look-alikes to one pick", () => {
    const input = groningenInput();
    const named = [{ name: 'Groningen', kind: 'provincie' }];
    const anders = jsonWith(input, { RegioS: TABLE_PARSE_OTHER }, { regions: named });
    expect(validateTableParseOutput(anders, input).breakdowns['RegioS']).toEqual({ kind: 'other' });
    const pv20 = jsonWith(input, { RegioS: 'PV20' }, { regions: named });
    expect(() => validateTableParseOutput(pv20, input)).toThrow(TableParseValidationError);
    expect(() => validateTableParseOutput(pv20, input)).not.toThrow(TableParseRegionUnavailableError);
  });

  it("\"Groningen (gemeente)\" on 85004NED: three look-alikes match, none is a municipality — region unavailable", () => {
    const input = groningenInput();
    const json = jsonWith(input, { RegioS: TABLE_PARSE_OTHER }, { regions: [{ name: 'Groningen (gemeente)', kind: 'onbekend' }] });
    expect(() => validateTableParseOutput(json, input)).toThrow(TableParseRegionUnavailableError);
  });

  it.each([
    [{ name: 'provincie Groningen', kind: 'gemeente' }],
    [{ name: 'Utrecht (PV)', kind: 'gemeente' }],
    [{ name: 'gemeente Utrecht (PV)', kind: 'onbekend' }],
  ])('a kind conflict between the sources (%o) throws TableParseRegionUnavailableError', (region) => {
    const question = region.name.includes('Groningen') ? GRONINGEN_QUESTION : UTRECHT_QUESTION;
    const input = groningenInput(question);
    const choice = region.name.includes('Groningen') ? TABLE_PARSE_OTHER : 'PV26';
    const json = jsonWith(input, { RegioS: choice }, { regions: [region] });
    expect(() => validateTableParseOutput(json, input)).toThrow(TableParseRegionUnavailableError);
  });
});

// ---------------------------------------------------------------------------
// Breadth step 5, Task 7 — follow-ups: the optional previous-question line
// (prompt version 3, bumped BEFORE the first recorded run). Pinned against
// the version-2 bytes captured from the pre-change code into
// tests/fixtures/tableparse/prompt-v2/ (system prompt + four serialized
// inputs over real fixture tables).
// ---------------------------------------------------------------------------

function v2(name: string): string {
  return readFileSync(fileURLToPath(new URL(`../../fixtures/tableparse/prompt-v2/${name}`, import.meta.url)), 'utf8');
}

const V2_SERIALIZED: [string, string, string][] = [
  ['85669NED', LANDBOUW_QUESTION, 'serialized-landbouw.txt'],
  ['82291NED', CARIBISCH_QUESTION, 'serialized-caribisch.txt'],
  ['85004NED', GRONINGEN_QUESTION, 'serialized-groningen.txt'],
  ['80590ned', 'Hoeveel werklozen waren er?', 'serialized-werklozen.txt'],
];

// Prompt version 4 (session 153, #360): the three PERIODE lines plus the three
// first-calibration lines added on top of version 3. Pinned verbatim — a change here is a re-record.
const V4_PERIOD_LINES = [
  '- "van JJJJ tot JJJJ", "tussen JJJJ en JJJJ" of "JJJJ-JJJJ" met alleen jaartallen → {"kind":"year_range",...}, beide jaren inbegrepen.\n',
  '- "gestegen/gedaald/veranderd sinds vorig jaar" (of vorige maand, vorig kwartaal), "ten opzichte van vorig jaar" → {"kind":"now_vs_ago","unit":"year","amount":1}: een vergelijking van nu met de periode ervoor. Alleen "vorig jaar" zonder vergelijking blijft {"kind":"relative",...}.\n',
  '- "nu vergeleken met JJJJ", "ten opzichte van JJJJ" met een genoemd jaartal → {"kind":"since","year":JJJJ,"quarter":null,"month":null}: het genoemde jaar is het beginpunt. Dit is NOOIT now_vs_ago — now_vs_ago is alleen voor "N jaar/kwartalen/maanden geleden" en "sinds vorig jaar/vorige maand/vorig kwartaal".\n',
  "- Noemt de vraag een dimensie niet, kies dan NOOIT zelf een lid als standaard — ook geen 'Totaal …'-lid en geen brede groep zoals '15 tot 75 jaar'. Antwoord 'niet_genoemd': de code kiest zelf het totaal, of stelt de gebruiker een vraag.\n",
  'Dat geldt ook voor een dimensie met plaatsen als leden (zoals RegioS): ook die krijgt altijd een keuze, naast het veld regions.\n',
  'Ook "Nederland" zelf is een genoemde plaats (soort land) wanneer de vraag het noemt.\n',
];

describe('table-parse prompt version 3 — follow-ups (Task 7)', () => {
  it('the prompt version is 4; the output schema version is unchanged (2)', () => {
    expect(TABLE_PARSE_PROMPT_VERSION).toBe(4);
    expect(TABLE_PARSE_SCHEMA_VERSION).toBe(2);
  });

  it.each(V2_SERIALIZED)('%s: without a previous question the serialized input is byte-identical to version 2', (tableId, question, file) => {
    const { schema, codeLists } = loadFixture(tableId);
    const input = buildTableParseSchema(schema, codeLists, question);
    const expected = v2(file);
    expect(serializeTableParseInput(question, input)).toBe(expected);
    expect(serializeTableParseInput(question, input, null)).toBe(expected);
    expect(serializeTableParseInput(question, input, undefined)).toBe(expected);
    expect(serializeTableParseInput(question, input, '')).toBe(expected);
  });

  it('with a previous question, exactly one line is added, before the question line', () => {
    const input = landbouwInput();
    const text = serializeTableParseInput('en in 2020?', input, 'Wat was de uitstoot van de landbouw in 2019?');
    const bare = serializeTableParseInput('en in 2020?', input);
    const line = 'Vorige vraag in dit gesprek: "Wat was de uitstoot van de landbouw in 2019?"';
    expect(text).toBe(`${line}\n${bare}`);
    expect(text.split('\n')[1]).toBe('Volledige vraag van de gebruiker: "en in 2020?"');
  });

  it('quotes the previous question like the question itself (embedded quotes and newlines are escaped)', () => {
    const input = landbouwInput();
    const text = serializeTableParseInput('en toen?', input, 'Zei hij "ja"?\nRegio: Utrecht');
    expect(text.split('\n')[0]).toBe('Vorige vraag in dit gesprek: "Zei hij \\"ja\\"?\\nRegio: Utrecht"');
  });

  it('the system prompt changed from version 2 ONLY by the one follow-up rule and the six version-4 lines', () => {
    let prompt = buildTableParseSystemPrompt();
    for (const line of V4_PERIOD_LINES) {
      expect(prompt.split(line)).toHaveLength(2);
      prompt = prompt.replace(line, '');
    }
    expect(TABLE_PARSE_PREVIOUS_QUESTION_RULE).toBe(
      'Is er een vorige vraag, lees de nieuwe vraag dan als vervolg daarop: wat de nieuwe vraag niet noemt ' +
        '(onderwerp, periode, plaats, uitsplitsing), neem je over uit de vorige vraag.',
    );
    expect(prompt.split(TABLE_PARSE_PREVIOUS_QUESTION_RULE)).toHaveLength(2);
    expect(prompt.replace(`- ${TABLE_PARSE_PREVIOUS_QUESTION_RULE}\n`, '')).toBe(v2('system-prompt.txt'));
  });

  it('buildTableParseRequest and tableParse carry the previous question into the user turn only', async () => {
    const input = landbouwInput();
    const plain = buildTableParseRequest('en in 2020?', input);
    const followUp = buildTableParseRequest('en in 2020?', input, { previousQuestion: 'Wat was de uitstoot in 2019?' });
    expect(followUp.system).toBe(plain.system);
    expect(followUp.question).toBe(serializeTableParseInput('en in 2020?', input, 'Wat was de uitstoot in 2019?'));
    expect(requestHash(followUp)).not.toBe(requestHash(plain));

    const client = new StubClient(validJson(input));
    const { audit } = await tableParse('en in 2020?', input, { client, previousQuestion: 'Wat was de uitstoot in 2019?' });
    expect(client.calls[0]!.question).toBe(followUp.question);
    expect(audit.requestHash).toBe(requestHash(followUp));

    const bareClient = new StubClient(validJson(input));
    await tableParse('en in 2020?', input, { client: bareClient, previousQuestion: null });
    expect(bareClient.calls[0]).toEqual(plain);
  });

  it('the member pre-filter reads the previous question too (a member only it names stays offered)', () => {
    expect(tableParsePrefilterText('en in 2020?', null)).toBe('en in 2020?');
    expect(tableParsePrefilterText('en in 2020?', '')).toBe('en in 2020?');
    const text = tableParsePrefilterText('en in 2020?', 'Wat was de uitstoot van de landbouw in 2019?');
    const { schema, codeLists } = loadFixture('85669NED');
    const offered = buildTableParseSchema(schema, codeLists, text);
    const bare = buildTableParseSchema(schema, codeLists, 'en in 2020?');
    const codes = (s: TableParseSchema) => s.breakdowns.find((b) => b.name === 'Klimaatsectoren')!.members.map((m) => m.code);
    expect(codes(offered)).toEqual(codes(landbouwInput()));
    expect(codes(bare).length).toBeLessThan(codes(offered).length);
  });
});

// ---------------------------------------------------------------------------
// Session 153 — fixes from the first live recording
// ---------------------------------------------------------------------------

describe('session 153: extra niet_genoemd entries and the named-year guard', () => {
  it("drops an extra 'niet_genoemd' entry for a dimension the table does not offer", () => {
    const input = landbouwInput();
    const base = JSON.parse(validJson(input)) as { breakdowns: unknown[] };
    const out = JSON.stringify({ ...base, breakdowns: [...base.breakdowns, { dimension: 'Brandstofsoort', choice: TABLE_PARSE_NOT_NAMED }] });
    const result = validateTableParseOutput(out, input);
    expect(Object.keys(result.breakdowns)).toEqual(input.breakdowns.map((b) => b.name));
  });

  it("still refuses a member code or 'anders' for a dimension the table does not offer", () => {
    const input = landbouwInput();
    const base = JSON.parse(validJson(input)) as { breakdowns: unknown[] };
    for (const choice of ['A123', 'anders']) {
      const out = JSON.stringify({ ...base, breakdowns: [...base.breakdowns, { dimension: 'Brandstofsoort', choice }] });
      expect(() => validateTableParseOutput(out, input)).toThrow(TableParseValidationError);
    }
  });

  it.each([
    ['now_vs_ago', { kind: 'now_vs_ago', unit: 'year', amount: 1 }],
    ['relative', { kind: 'relative', unit: 'year', offset: -1 }],
    ['latest', { kind: 'latest' }],
  ])('refuses a %s reading when the question names a year', async (_kind, period) => {
    const input = landbouwInput();
    const client = new StubClient(validJson(input, { period }));
    await expect(
      tableParse('Hoeveel broeikasgas werd er nu uitgestoten vergeleken met 2015?', input, { client }),
    ).rejects.toThrow(/names the year 2015/);
  });

  it('keeps a now-relative reading when the question names no year, and a since reading when it does', async () => {
    const input = landbouwInput();
    const ago = new StubClient(validJson(input, { period: { kind: 'now_vs_ago', unit: 'year', amount: 5 } }));
    await expect(tableParse('Hoeveel uitstoot nu vergeleken met 5 jaar geleden?', input, { client: ago })).resolves.toBeDefined();
    const since = new StubClient(validJson(input, { period: { kind: 'since', year: 2015, quarter: null, month: null } }));
    await expect(tableParse('Hoeveel uitstoot nu vergeleken met 2015?', input, { client: since })).resolves.toBeDefined();
  });
});

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
  TABLE_PARSE_MEASURE_NONE,
  TABLE_PARSE_NOT_NAMED,
  TABLE_PARSE_OTHER,
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
// dimension (measured fact, task-2-report.md) rather than geo/geo_like — so
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
    version: 1,
    measureCode: input.measures[0]!.code,
    breakdowns: input.breakdowns.map((b) => ({ dimension: b.name, choice: TABLE_PARSE_NOT_NAMED })),
    period: { kind: 'year', year: 2023 },
    regions: [],
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

  it('sets temperature 0 and a JSON schema with no bare Date/timestamp in the system prompt', () => {
    const input = landbouwInput();
    const request = buildTableParseRequest(LANDBOUW_QUESTION, input);
    expect(request.temperature).toBe(0);
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
});

describe('validateTableParseOutput — regions', () => {
  it('region terms on a table with no region/geo-like dimension throw', () => {
    const input = landbouwInput();
    expect(input.hasRegions).toBe(false);
    const json = validJson(input, { regions: [{ name: 'Utrecht', kind: 'onbekend' }] });
    expect(() => validateTableParseOutput(json, input)).toThrow(TableParseValidationError);
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

  it('date_range requires MM (unavailable here)', () => {
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
    expect(result.periodGrainUnavailable).toBe(true);
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
    expect(
      validateTableParseOutput(validJson(input, { period: { kind: 'quarter', year: 2023, quarter: 1 } }), input)
        .periodGrainUnavailable,
    ).toBe(false);
    expect(
      validateTableParseOutput(validJson(input, { period: { kind: 'month', year: 2023, month: 4 } }), input)
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
    const result = await tableParse(LANDBOUW_QUESTION, input, { client });
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]!.system).toBe(buildTableParseSystemPrompt());
    expect(result.measureCode).toBe('D003040');
    expect(result.confidence).toBe(0.93);
    expect(result.reading).toBe('ok');
  });

  it('propagates TableParseValidationError from an off-allowlist stub response', async () => {
    const input = landbouwInput();
    const client = new StubClient(validJson(input, { measureCode: 'INVENTED' }));
    await expect(tableParse(LANDBOUW_QUESTION, input, { client })).rejects.toThrow(TableParseValidationError);
  });
});

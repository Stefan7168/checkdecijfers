// Breadth step 4, Task 2 — pure input builder for the table-scoped parser.
// Tests run over the REAL CBS metadata fixtures from Task 1
// (tests/fixtures/tableparse/schemas/<tableId>.json) so the pre-filter and
// classification behaviour is pinned against actual CBS tables, not
// hand-crafted approximations. Two cases need a synthetic schema because no
// fixture table happens to have the shape (a String-typed measure alongside
// a numeric one; a table with no numeric measure at all).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { classifyDimension } from '../../../src/query/breakdowns.ts';
import type { CbsCode, CbsTableSchema } from '../../../src/cbs-adapter/types.ts';
import {
  buildTableParseSchema,
  questionWords,
  MEMBER_PROMPT_CAP,
  TableParseIneligibleTableError,
} from '../../../src/answer/table-parse/input.ts';

function loadFixture(tableId: string): { schema: CbsTableSchema; codeLists: Record<string, CbsCode[]> } {
  const path = fileURLToPath(new URL(`../../fixtures/tableparse/schemas/${tableId}.json`, import.meta.url));
  const raw = JSON.parse(readFileSync(path, 'utf8')) as {
    schema: CbsTableSchema;
    codeLists: Record<string, CbsCode[]>;
  };
  return raw;
}

// ---------------------------------------------------------------------------
// Measure filtering — numeric only (dataType !== 'String')
// ---------------------------------------------------------------------------

describe('buildTableParseSchema — measure filtering', () => {
  // No Task 1 fixture happens to carry a String-typed measure alongside a
  // numeric one (breadth step 2 already excludes text measures from
  // ingestion) — synthetic schema, as the brief allows.
  const syntheticTimeCodes: CbsCode[] = [
    { code: '2019JJ00', title: '2019', dimensionGroup: null, status: 'Definitief', index: 1 },
    { code: '2020JJ00', title: '2020', dimensionGroup: null, status: 'Definitief', index: 2 },
  ];

  function syntheticSchema(measures: CbsTableSchema['measures']): {
    schema: CbsTableSchema;
    codeLists: Record<string, CbsCode[]>;
  } {
    return {
      schema: {
        tableId: 'SYN01',
        title: 'Synthetische testtabel',
        dimensions: [{ name: 'Perioden', kind: 'TimeDimension', title: 'Perioden' }],
        measures,
        modified: null,
      },
      codeLists: { Perioden: syntheticTimeCodes },
    };
  }

  it('excludes a String-typed measure, keeps the numeric one', () => {
    const { schema, codeLists } = syntheticSchema([
      { code: 'M1', title: 'Aantal', unit: 'x 1', decimals: 0, description: 'een telling', dataType: 'Double', groupPath: [] },
      { code: 'S1', title: 'Naam', unit: '', decimals: 0, description: '', dataType: 'String', groupPath: [] },
    ]);
    const result = buildTableParseSchema(schema, codeLists, 'irrelevante vraag');
    expect(result.measures).toEqual([
      { code: 'M1', title: 'Aantal', unit: 'x 1', description: 'een telling' },
    ]);
  });

  it('throws when a table has no numeric measure at all (never offered)', () => {
    const { schema, codeLists } = syntheticSchema([
      { code: 'S1', title: 'Naam', unit: '', decimals: 0, description: '', dataType: 'String', groupPath: [] },
    ]);
    expect(() => buildTableParseSchema(schema, codeLists, 'irrelevante vraag')).toThrow(
      TableParseIneligibleTableError,
    );
  });

  // Final-review F6/F9: a dimension with no code-list entry at all must never
  // become a zero-member breakdown (or, for the time dimension, empty
  // periodGrains) — the table is refused with a typed error instead.
  it('throws TableParseIneligibleTableError when a breakdown dimension has no code list', () => {
    const { schema, codeLists } = loadFixture('82291NED');
    const { Persoonskenmerken: _dropped, ...withoutOne } = codeLists;
    expect(() => buildTableParseSchema(schema, withoutOne, 'irrelevante vraag')).toThrow(
      TableParseIneligibleTableError,
    );
  });

  it('throws TableParseIneligibleTableError when the time dimension has no code list', () => {
    const { schema, codeLists } = loadFixture('82291NED');
    const { Perioden: _dropped, ...withoutTime } = codeLists;
    expect(() => buildTableParseSchema(schema, withoutTime, 'irrelevante vraag')).toThrow(
      TableParseIneligibleTableError,
    );
  });
});

// ---------------------------------------------------------------------------
// No time dimension -> refuse (measured: 83052NED and 86116NED)
// ---------------------------------------------------------------------------

describe('buildTableParseSchema — no time dimension refuses', () => {
  it('83052NED: Perioden is kind Dimension, not TimeDimension -> throws', () => {
    const { schema, codeLists } = loadFixture('83052NED');
    expect(schema.dimensions.some((d) => d.kind === 'TimeDimension')).toBe(false);
    expect(() => buildTableParseSchema(schema, codeLists, 'irrelevante vraag')).toThrow(
      TableParseIneligibleTableError,
    );
  });

  it('86116NED: no Perioden dimension at all -> throws', () => {
    const { schema, codeLists } = loadFixture('86116NED');
    expect(schema.dimensions.some((d) => d.kind === 'TimeDimension')).toBe(false);
    expect(() => buildTableParseSchema(schema, codeLists, 'irrelevante vraag')).toThrow(
      TableParseIneligibleTableError,
    );
  });
});

// ---------------------------------------------------------------------------
// Member pre-filter — the >40-member truncation rule
// ---------------------------------------------------------------------------

describe('buildTableParseSchema — member pre-filter', () => {
  it('85669NED: "uitstoot van de landbouw" truncates Klimaatsectoren, total first, contains the landbouw member(s)', () => {
    const { schema, codeLists } = loadFixture('85669NED');
    const result = buildTableParseSchema(schema, codeLists, 'Hoeveel bedraagt de uitstoot van de landbouw?');
    const dim = result.breakdowns.find((b) => b.name === 'Klimaatsectoren');
    expect(dim).toBeDefined();
    expect(dim!.truncated).toBe(true);
    expect(dim!.totalMembers).toBe(52);
    expect(dim!.members.length).toBeLessThanOrEqual(MEMBER_PROMPT_CAP);
    // CBS's own grand total (T001616) comes first.
    expect(dim!.members[0]).toEqual({ code: 'T001616', title: 'Totaal klimaatsectoren' });
    const codes = dim!.members.map((m) => m.code);
    expect(codes).toContain('301100'); // '01 Landbouw (stationaire bronnen)'
    expect(codes).toContain('A025430'); // 'Mobiele werktuigen; landbouw'
  });

  it('a dimension with <= 40 members is offered in full, not truncated', () => {
    const { schema, codeLists } = loadFixture('82291NED');
    const result = buildTableParseSchema(schema, codeLists, 'irrelevante vraag zonder match');
    const dim = result.breakdowns.find((b) => b.name === 'Persoonskenmerken');
    expect(dim).toBeDefined();
    expect(codeLists.Persoonskenmerken.length).toBeLessThanOrEqual(MEMBER_PROMPT_CAP);
    expect(dim!.truncated).toBe(false);
    expect(dim!.totalMembers).toBe(codeLists.Persoonskenmerken.length);
    expect(dim!.members).toEqual(
      codeLists.Persoonskenmerken.map((m) => ({ code: m.code, title: m.title })),
    );
  });

  it('85004NED: RegioS (86 members, no grand total) is truncated with no total prepended when nothing matches', () => {
    const { schema, codeLists } = loadFixture('85004NED');
    expect(codeLists.RegioS.length).toBe(86);
    const result = buildTableParseSchema(schema, codeLists, 'irrelevante vraag zonder enige match');
    const dim = result.breakdowns.find((b) => b.name === 'RegioS');
    expect(dim).toBeDefined();
    expect(dim!.truncated).toBe(true);
    expect(dim!.totalMembers).toBe(86);
    // 'Nederland' (NL01) is not a Totaal-titled / T00-coded member -> findGrandTotal is null here.
    expect(dim!.members.length).toBe(0);
  });

  it('85004NED: RegioS offers a matching member when the question names it, still capped and truncated', () => {
    const { schema, codeLists } = loadFixture('85004NED');
    const result = buildTableParseSchema(schema, codeLists, 'Hoeveel zonnestroom wordt opgewekt in Groningen?');
    const dim = result.breakdowns.find((b) => b.name === 'RegioS')!;
    expect(dim.truncated).toBe(true);
    expect(dim.totalMembers).toBe(86);
    expect(dim.members.length).toBeGreaterThan(0);
    expect(dim.members.length).toBeLessThanOrEqual(MEMBER_PROMPT_CAP);
    expect(dim.members.some((m) => m.title.toLowerCase().includes('groningen'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Margins never offered as a breakdown
// ---------------------------------------------------------------------------

describe('buildTableParseSchema — margins are never offered', () => {
  it('82291NED: Marges is a margins dimension and never appears in breakdowns', () => {
    const { schema, codeLists } = loadFixture('82291NED');
    const margesDim = schema.dimensions.find((d) => d.name === 'Marges')!;
    const margesClass = classifyDimension({
      name: margesDim.name,
      title: margesDim.title,
      kind: margesDim.kind,
      members: codeLists.Marges.map((c) => ({ code: c.code, title: c.title })),
    });
    expect(margesClass).toBe('margins');

    const result = buildTableParseSchema(schema, codeLists, 'irrelevante vraag');
    expect(result.breakdowns.some((b) => b.name === 'Marges')).toBe(false);
    expect(result.breakdowns.map((b) => b.name)).toEqual(['CaribischNederland', 'Persoonskenmerken']);
  });
});

// ---------------------------------------------------------------------------
// classifyDimension routing — measured, not assumed (85004NED RegioS,
// 82291NED CaribischNederland: both are region-coded but classify as
// 'breakdown' under the measured 0.8 geo-like threshold, not 'geo_like').
// ---------------------------------------------------------------------------

describe('buildTableParseSchema — classifyDimension routing is measured, then pinned', () => {
  it('85004NED: RegioS classifies as breakdown (not geo_like) -> offered as a breakdown, hasRegions stays false', () => {
    const { schema, codeLists } = loadFixture('85004NED');
    const dim = schema.dimensions.find((d) => d.name === 'RegioS')!;
    const measuredClass = classifyDimension({
      name: dim.name,
      title: dim.title,
      kind: dim.kind,
      members: codeLists.RegioS.map((c) => ({ code: c.code, title: c.title })),
    });
    expect(measuredClass).toBe('breakdown');

    const result = buildTableParseSchema(schema, codeLists, 'irrelevante vraag');
    expect(result.hasRegions).toBe(false);
    expect(result.breakdowns.some((b) => b.name === 'RegioS')).toBe(true);
  });

  it('82291NED: CaribischNederland classifies as breakdown (not geo_like) -> offered as a breakdown, hasRegions stays false', () => {
    const { schema, codeLists } = loadFixture('82291NED');
    const dim = schema.dimensions.find((d) => d.name === 'CaribischNederland')!;
    const measuredClass = classifyDimension({
      name: dim.name,
      title: dim.title,
      kind: dim.kind,
      members: codeLists.CaribischNederland.map((c) => ({ code: c.code, title: c.title })),
    });
    expect(measuredClass).toBe('breakdown');

    const result = buildTableParseSchema(schema, codeLists, 'irrelevante vraag');
    expect(result.hasRegions).toBe(false);
    const dimResult = result.breakdowns.find((b) => b.name === 'CaribischNederland');
    expect(dimResult).toBeDefined();
    expect(dimResult!.truncated).toBe(false);
    expect(dimResult!.totalMembers).toBe(4);
  });

  it('03759ned: RegioS is a real GeoDimension -> sets hasRegions, excluded from breakdowns', () => {
    const { schema, codeLists } = loadFixture('03759ned');
    const dim = schema.dimensions.find((d) => d.name === 'RegioS')!;
    expect(dim.kind).toBe('GeoDimension');
    const result = buildTableParseSchema(schema, codeLists, 'irrelevante vraag');
    expect(result.hasRegions).toBe(true);
    expect(result.breakdowns.some((b) => b.name === 'RegioS')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// periodGrains
// ---------------------------------------------------------------------------

describe('buildTableParseSchema — periodGrains', () => {
  it.each([
    ['85669NED', ['JJ']],
    ['85004NED', ['JJ']],
    ['82291NED', ['JJ']],
    ['03759ned', ['JJ']],
  ] as const)('%s: periodGrains = %j', (tableId, expected) => {
    const { schema, codeLists } = loadFixture(tableId);
    const result = buildTableParseSchema(schema, codeLists, 'irrelevante vraag');
    expect(result.periodGrains).toEqual([...expected]);
  });

  it('85669NED: yearly-only table -> periodGrains = [JJ] (explicit, non-parameterized check)', () => {
    const { schema, codeLists } = loadFixture('85669NED');
    const result = buildTableParseSchema(schema, codeLists, 'irrelevante vraag');
    expect(result.periodGrains).toEqual(['JJ']);
  });

  it('80590ned: mixed grains (JJ, KW, MM present) -> sorted JJ, KW, MM', () => {
    const { schema, codeLists } = loadFixture('80590ned');
    const grainsPresent = new Set(codeLists.Perioden.map((c) => c.code.slice(4, 6)));
    expect(grainsPresent).toEqual(new Set(['JJ', 'KW', 'MM']));
    const result = buildTableParseSchema(schema, codeLists, 'irrelevante vraag');
    expect(result.periodGrains).toEqual(['JJ', 'KW', 'MM']);
  });
});

// ---------------------------------------------------------------------------
// questionWords — the pre-filter's normalization
// ---------------------------------------------------------------------------

describe('questionWords', () => {
  it('lowercases, strips diacritics, and drops words under 4 letters', () => {
    const words = questionWords('Wat is de UITSTOOT van de cafés in Den Haag?');
    expect(words.has('uitstoot')).toBe(true);
    expect(words.has('cafes')).toBe(true); // diacritic stripped from 'cafés'
    expect(words.has('haag')).toBe(true);
    expect(words.has('wat')).toBe(false); // 3 letters
    expect(words.has('is')).toBe(false);
    expect(words.has('de')).toBe(false);
    expect(words.has('van')).toBe(false);
    expect(words.has('den')).toBe(false); // 3 letters
  });

  it('splits on punctuation (non-letters/digits), not just whitespace', () => {
    const words = questionWords('landbouw, mobiliteit; industrie!');
    expect(words).toEqual(new Set(['landbouw', 'mobiliteit', 'industrie']));
  });

  // Final-review F8 (controller ruling): digit runs of length >= 2 are match
  // words too, so an age band like "65 tot 80 jaar" can be matched by a
  // question naming "65" or "80". A single digit stays dropped.
  it('keeps digit runs of length >= 2 as match words, drops single digits', () => {
    const words = questionWords('Hoeveel 65-plussers tussen 65 en 80 jaar, groep 3?');
    expect(words.has('65')).toBe(true);
    expect(words.has('80')).toBe(true);
    expect(words.has('plussers')).toBe(true);
    expect(words.has('jaar')).toBe(true);
    expect(words.has('3')).toBe(false);
    expect(words.has('en')).toBe(false);
  });

  it('a mixed letter+digit token under 4 characters is still dropped (only pure digit runs are kept short)', () => {
    const words = questionWords('uitstoot van co2');
    expect(words.has('co2')).toBe(false);
  });

  it('is case-insensitive: same word regardless of case yields one entry', () => {
    const words = questionWords('Landbouw LANDBOUW landbouw');
    expect(words).toEqual(new Set(['landbouw']));
  });
});

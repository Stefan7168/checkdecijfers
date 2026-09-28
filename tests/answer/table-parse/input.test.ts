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
      { code: 'M1', title: 'Aantal', unit: 'x 1', description: 'een telling', groupPath: [] },
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

  // Final-review I2 (breadth step 4b fix wave): the adapter degrades a
  // MeasureGroups failure to every groupPath [] + measureGroupsUnavailable
  // (so an ingestion sync never fails over data it never stores). The
  // table-scoped parser must NOT then offer the table as if it had no groups
  // — the group is what tells same-titled measures apart — so a flagged
  // schema is ineligible until CBS recovers.
  it('throws TableParseIneligibleTableError for a schema flagged measureGroupsUnavailable', () => {
    const { schema, codeLists } = loadFixture('80590ned');
    const flagged = { ...schema, measures: schema.measures.map((m) => ({ ...m, groupPath: [] })), measureGroupsUnavailable: true };
    expect(() => buildTableParseSchema(flagged, codeLists, 'Hoeveel werklozen waren er in maart 2024?')).toThrow(
      TableParseIneligibleTableError,
    );
    expect(() => buildTableParseSchema(flagged, codeLists, 'Hoeveel werklozen waren er in maart 2024?')).toThrow(
      /measure groups/,
    );
  });

  it('a schema with measureGroupsUnavailable false (or absent) is built as usual', () => {
    const { schema, codeLists } = loadFixture('80590ned');
    expect(() => buildTableParseSchema({ ...schema, measureGroupsUnavailable: false }, codeLists, 'Hoeveel werklozen?')).not.toThrow();
    expect(() => buildTableParseSchema(schema, codeLists, 'Hoeveel werklozen?')).not.toThrow();
  });

  // Breadth step 4b, Task 2 — groupPath is carried straight from CbsMeasure
  // through to TableParseMeasure. 80590ned's own measures are grouped
  // (measured against the live-refreshed fixture): D002308
  // "Seizoengecorrigeerd" sits in group "Beroepsbevolking", its sibling
  // D006409 (same title, same unit, same description) sits in
  // "Werkzame beroepsbevolking" — a DIFFERENT group.
  it('carries a real CBS measure group path through from the fixture', () => {
    const { schema, codeLists } = loadFixture('80590ned');
    const result = buildTableParseSchema(schema, codeLists, 'irrelevante vraag');
    const d002308 = result.measures.find((m) => m.code === 'D002308');
    const d006409 = result.measures.find((m) => m.code === 'D006409');
    expect(d002308?.groupPath).toEqual(['Beroepsbevolking']);
    expect(d006409?.groupPath).toEqual(['Werkzame beroepsbevolking']);
    expect(d002308?.title).toBe(d006409?.title);
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
// Breadth step 4b, Task 3 — the pre-filter's place-aware addition rule: a
// truncated dimension also offers every REGION-CODED member whose place key
// occurs in the (normalized) question as a whole word/sequence, merged with
// the generic word-rule selection, CBS order, total first, deduped, capped at
// MEMBER_PROMPT_CAP.
// ---------------------------------------------------------------------------

describe('buildTableParseSchema — place-aware pre-filter addition (Task 3)', () => {
  it('85004NED: "Groningen (PV)" (CBS-style title) offers all three look-alike Groningen members', () => {
    const { schema, codeLists } = loadFixture('85004NED');
    const result = buildTableParseSchema(schema, codeLists, 'Hoeveel megawatt stond er opgesteld in Groningen (PV) in 2021?');
    const dim = result.breakdowns.find((b) => b.name === 'RegioS')!;
    expect(dim.truncated).toBe(true);
    const codes = dim.members.map((m) => m.code);
    expect(codes).toEqual(expect.arrayContaining(['PV20', 'ES01', 'ET0101']));
  });

  it('85004NED: "provincie Groningen" (leading Dutch kind word) offers all three look-alike Groningen members', () => {
    const { schema, codeLists } = loadFixture('85004NED');
    const result = buildTableParseSchema(schema, codeLists, 'Hoeveel megawatt stond er opgesteld in provincie Groningen in 2021?');
    const dim = result.breakdowns.find((b) => b.name === 'RegioS')!;
    expect(dim.truncated).toBe(true);
    const codes = dim.members.map((m) => m.code);
    expect(codes).toEqual(expect.arrayContaining(['PV20', 'ES01', 'ET0101']));
  });

  it('85004NED: a bare "Groningen" offers all three look-alike Groningen members, in CBS (index) order', () => {
    const { schema, codeLists } = loadFixture('85004NED');
    const result = buildTableParseSchema(schema, codeLists, 'Hoeveel megawatt stond er opgesteld in Groningen in 2021?');
    const dim = result.breakdowns.find((b) => b.name === 'RegioS')!;
    const codes = dim.members.map((m) => m.code);
    expect(codes).toEqual(expect.arrayContaining(['PV20', 'ES01', 'ET0101']));
    // CBS order: PV20 (index 2) before ES01 (index 15) before ET0101 (index 46).
    expect(codes.indexOf('PV20')).toBeLessThan(codes.indexOf('ES01'));
    expect(codes.indexOf('ES01')).toBeLessThan(codes.indexOf('ET0101'));
  });

  // Synthetic dimension (>40 members, so the pre-filter truncates it), mirroring
  // 85004NED's own low region-coded ratio (12.5%, under the 0.8 geo_like
  // threshold) so it stays classified as an ordinary 'breakdown' dimension.
  // Isolates the case the generic word rule alone cannot reach: "Den Haag"
  // shares no word with "'s-Gravenhage" ("haag" vs "gravenhage"), so only the
  // alias-aware place rule adds the member.
  function denHaagPreFilterSchema(): { schema: CbsTableSchema; codeLists: Record<string, CbsCode[]> } {
    const filler: CbsCode[] = Array.from({ length: 44 }, (_, i) => ({
      code: `F${String(i + 1).padStart(4, '0')}`,
      title: `Fictieve plek ${i + 1}`,
      dimensionGroup: null,
      status: null,
      index: i + 1,
    }));
    const codeLists: Record<string, CbsCode[]> = {
      Woonplaats: [
        ...filler,
        { code: 'GM0518', title: "'s-Gravenhage (GM)", dimensionGroup: null, status: null, index: 45 },
        // Same place name, but a NON-region code — must never be added by
        // the place-aware rule (it is also not a word-rule match: nothing in
        // the question shares a word with "'s-Gravenhage").
        { code: 'F0045', title: "'s-Gravenhage", dimensionGroup: null, status: null, index: 46 },
      ],
      Perioden: [{ code: '2020JJ00', title: '2020', dimensionGroup: null, status: 'Definitief', index: 1 }],
    };
    const schema: CbsTableSchema = {
      tableId: 'SYN07',
      title: 'Synthetische tabel naar woonplaats',
      dimensions: [
        { name: 'Woonplaats', kind: 'Dimension', title: 'Woonplaats' },
        { name: 'Perioden', kind: 'TimeDimension', title: 'Perioden' },
      ],
      measures: [{ code: 'M1', title: 'Personen', unit: 'aantal', decimals: 0, description: 'aantal personen', dataType: 'Long', groupPath: [] }],
      modified: null,
    };
    return { schema, codeLists };
  }

  it('a truncated dimension offers a region-coded member the generic word rule alone would miss ("Den Haag" -> \'s-Gravenhage via alias)', () => {
    const { schema, codeLists } = denHaagPreFilterSchema();
    expect(codeLists.Woonplaats!.length).toBeGreaterThan(MEMBER_PROMPT_CAP);
    const result = buildTableParseSchema(schema, codeLists, 'Hoeveel personen woonden er in Den Haag in 2020?');
    const dim = result.breakdowns.find((b) => b.name === 'Woonplaats')!;
    expect(dim.truncated).toBe(true);
    // The generic word rule alone matches nothing here — "haag" (4 letters,
    // kept) shares no word with any offered title, including "'s-Gravenhage"
    // ("gravenhage").
    expect(questionWords('Hoeveel personen woonden er in Den Haag in 2020?').has('gravenhage')).toBe(false);
    expect(dim.members).toEqual([{ code: 'GM0518', title: "'s-Gravenhage (GM)" }]);
  });

  // Final-review minor: a look-alike place must never be cut by the cap.
  // Synthetic: a grand total first, then 45 members that all share the word
  // "inkomen" with the question, then the one place member — CBS order would
  // fill the cap with word matches before ever reaching the place. Place
  // matches now claim cap slots BEFORE word matches; the final list is still
  // CBS order with the total first.
  it('a place match is never cut by the cap: place matches fill it before word matches (final list still CBS order, total first)', () => {
    const wordMatches: CbsCode[] = Array.from({ length: 45 }, (_, i) => ({
      code: `K${String(i + 1).padStart(4, '0')}`,
      title: `Inkomen klasse ${i + 1}`,
      dimensionGroup: null,
      status: null,
      index: i + 2,
    }));
    const codeLists: Record<string, CbsCode[]> = {
      Regio: [
        { code: 'T001019', title: 'Totaal', dimensionGroup: null, status: null, index: 1 },
        ...wordMatches,
        { code: 'PV26', title: 'Utrecht (PV)', dimensionGroup: null, status: null, index: 47 },
      ],
      Perioden: [{ code: '2020JJ00', title: '2020', dimensionGroup: null, status: 'Definitief', index: 1 }],
    };
    const schema: CbsTableSchema = {
      tableId: 'SYN08',
      title: 'Synthetische tabel naar regio en inkomen',
      dimensions: [
        { name: 'Regio', kind: 'Dimension', title: 'Regio' },
        { name: 'Perioden', kind: 'TimeDimension', title: 'Perioden' },
      ],
      measures: [{ code: 'M1', title: 'Personen', unit: 'aantal', decimals: 0, description: 'aantal personen', dataType: 'Long', groupPath: [] }],
      modified: null,
    };
    const result = buildTableParseSchema(schema, codeLists, 'Hoeveel personen met inkomen woonden er in Utrecht in 2020?');
    const dim = result.breakdowns.find((b) => b.name === 'Regio')!;
    expect(dim.truncated).toBe(true);
    const codes = dim.members.map((m) => m.code);
    expect(codes).toHaveLength(MEMBER_PROMPT_CAP);
    expect(codes[0]).toBe('T001019');
    expect(codes).toContain('PV26');
    // CBS order after the total: the place (index 47) comes last, after the
    // 38 word matches that still fit (K0001..K0038).
    expect(codes[codes.length - 1]).toBe('PV26');
    expect(codes.slice(1, -1)).toEqual(wordMatches.slice(0, MEMBER_PROMPT_CAP - 2).map((c) => c.code));
  });

  it('non-region-coded members are never added by the place-aware rule, even sharing the exact place name', () => {
    const { schema, codeLists } = denHaagPreFilterSchema();
    const result = buildTableParseSchema(schema, codeLists, 'Hoeveel personen woonden er in Den Haag in 2020?');
    const dim = result.breakdowns.find((b) => b.name === 'Woonplaats')!;
    expect(dim.members.some((m) => m.code === 'F0045')).toBe(false);
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

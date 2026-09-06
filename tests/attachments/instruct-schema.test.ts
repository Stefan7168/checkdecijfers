// validateInstruction — the H1 boundary itself (the closed-vocabulary
// allowlist, D6/D7). No LLM: exercised with crafted model-output strings,
// exactly what it must defend against. Mirrors tests/catalog/rerank.test.ts's
// shape for the sibling allowlist validator.
import { describe, expect, it } from 'vitest';
import {
  CHART_INSTRUCTION_SCHEMA_VERSION,
  InstructionValidationError,
  chartInstructionJsonSchema,
  validateInstruction,
} from '../../src/attachments/instruct/schema.ts';
import type { DatasetProfile } from '../../src/attachments/types.ts';
import { MAX_SERIES } from '../../src/attachments/limits.ts';

const PROFILE: DatasetProfile = {
  rowCount: 27,
  columns: [
    {
      id: 'c0',
      header: 'Jaar',
      type: 'year',
      min: 2015,
      max: 2023,
      distinct: ['2015', '2016', '2017', '2018', '2019', '2020', '2021', '2022', '2023'],
      distinctTruncated: false,
      nulls: 0,
    },
    {
      id: 'c1',
      header: 'Gemeente',
      type: 'text',
      distinct: ['Amsterdam', 'Rotterdam', 'Utrecht'],
      distinctTruncated: false,
      nulls: 0,
    },
    { id: 'c2', header: 'Omzet', type: 'number', numberFormat: 'nl', min: 120.5, max: 9800, nulls: 0 },
  ],
};

function out(fields: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: CHART_INSTRUCTION_SCHEMA_VERSION,
    kind: 'line',
    x: 'c0',
    y: ['c2'],
    seriesBy: null,
    filters: [],
    sort: null,
    limit: null,
    confidence: 0.9,
    reading: 'Omzet per jaar.',
    unsupported: null,
    ...fields,
  });
}

describe('validateInstruction — accepts a well-formed instruction', () => {
  it('returns the validated instruction unchanged', () => {
    const result = validateInstruction(out(), PROFILE);
    expect(result.x).toBe('c0');
    expect(result.y).toEqual(['c2']);
  });

  it('accepts a bar chart with seriesBy and an in-list filter', () => {
    const result = validateInstruction(
      out({
        kind: 'bar',
        x: 'c1',
        seriesBy: 'c1',
        filters: [{ column: 'c0', op: 'in', values: ['2020', '2021'] }],
      }),
      PROFILE,
    );
    expect(result.kind).toBe('bar');
  });

  it('accepts sort.by = "x" as the sentinel, not a real column ref', () => {
    const result = validateInstruction(
      out({ kind: 'bar', sort: { by: 'x', direction: 'asc' } }),
      PROFILE,
    );
    expect(result.sort).toEqual({ by: 'x', direction: 'asc' });
  });
});

describe('validateInstruction — JSON/schema violations', () => {
  it('throws on invalid JSON', () => {
    expect(() => validateInstruction('{not json', PROFILE)).toThrow(InstructionValidationError);
    expect(() => validateInstruction('{not json', PROFILE)).toThrow(/not valid JSON/);
  });

  it('throws on a missing required field', () => {
    const broken = JSON.stringify({ version: 1, kind: 'line', x: 'c0' });
    expect(() => validateInstruction(broken, PROFILE)).toThrow(/violates the schema/);
  });

  it('throws on an extra unknown field (strictObject)', () => {
    const broken = out({ extraField: 'sneaky' });
    expect(() => validateInstruction(broken, PROFILE)).toThrow(/violates the schema/);
  });
});

describe('validateInstruction — the hard allowlist (collectColumnRefs), one shared pass', () => {
  it('throws when x references an unknown column id', () => {
    expect(() => validateInstruction(out({ x: 'c99' }), PROFILE)).toThrow(/'c99'.*NOT in the dataset/);
  });

  it('throws when a y entry references an unknown column id', () => {
    expect(() => validateInstruction(out({ y: ['c2', 'c99'] }), PROFILE)).toThrow(/'c99'/);
  });

  it('throws when seriesBy references an unknown column id', () => {
    expect(() => validateInstruction(out({ seriesBy: 'c99' }), PROFILE)).toThrow(/'c99'/);
  });

  it('throws when a filter column references an unknown column id', () => {
    expect(() =>
      validateInstruction(out({ filters: [{ column: 'c99', op: 'in', values: ['x'] }] }), PROFILE),
    ).toThrow(/'c99'/);
  });

  it('throws when sort.by references an unknown column id', () => {
    expect(() =>
      validateInstruction(out({ kind: 'bar', sort: { by: 'c99', direction: 'asc' } }), PROFILE),
    ).toThrow(/'c99'/);
  });
});

describe('validateInstruction — y column rules', () => {
  it('throws when y is empty', () => {
    expect(() => validateInstruction(out({ y: [] }), PROFILE)).toThrow(/1\.\.4/);
  });

  it('throws when y has more than 4 columns', () => {
    expect(() => validateInstruction(out({ y: ['c2', 'c2', 'c2', 'c2', 'c2'] }), PROFILE)).toThrow(/1\.\.4/);
  });

  it('throws when a y column is not numeric (a text column)', () => {
    expect(() => validateInstruction(out({ y: ['c1'] }), PROFILE)).toThrow(/not 'number' or 'year'/);
  });

  it('accepts a year column as a y value', () => {
    expect(() => validateInstruction(out({ y: ['c0'] }), PROFILE)).not.toThrow();
  });
});

describe('validateInstruction — line chart requires an ordered x', () => {
  it('throws on a line chart with a text x column', () => {
    expect(() => validateInstruction(out({ kind: 'line', x: 'c1' }), PROFILE)).toThrow(/no natural order/);
  });

  it('accepts a bar chart with a text x column (no ordering required)', () => {
    expect(() => validateInstruction(out({ kind: 'bar', x: 'c1' }), PROFILE)).not.toThrow();
  });
});

describe('validateInstruction — seriesBy (fixed in review: cap is a throw, never silent truncation)', () => {
  it('throws when seriesBy has no distinct list (a high-cardinality number column)', () => {
    expect(() => validateInstruction(out({ kind: 'bar', seriesBy: 'c2' }), PROFILE)).toThrow(
      /no distinct value list/,
    );
  });

  it('throws when seriesBy would produce more series than the cap, rather than silently truncating', () => {
    const wideColumn = {
      id: 'c3',
      header: 'Wijk',
      type: 'text' as const,
      distinct: Array.from({ length: MAX_SERIES + 1 }, (_, i) => `wijk-${i}`),
      distinctTruncated: false,
      nulls: 0,
    };
    const profile: DatasetProfile = { ...PROFILE, columns: [...PROFILE.columns, wideColumn] };
    expect(() => validateInstruction(out({ kind: 'bar', seriesBy: 'c3' }), profile)).toThrow(
      /more than the 8 series cap/,
    );
  });

  it('accepts seriesBy exactly at the cap', () => {
    const atCapColumn = {
      id: 'c3',
      header: 'Wijk',
      type: 'text' as const,
      distinct: Array.from({ length: MAX_SERIES }, (_, i) => `wijk-${i}`),
      distinctTruncated: false,
      nulls: 0,
    };
    const profile: DatasetProfile = { ...PROFILE, columns: [...PROFILE.columns, atCapColumn] };
    expect(() => validateInstruction(out({ kind: 'bar', seriesBy: 'c3' }), profile)).not.toThrow();
  });
});

describe('validateInstruction — filter operator/column-type pairing (fixed in review)', () => {
  it('throws "in" on a column with no distinct list', () => {
    expect(() =>
      validateInstruction(out({ filters: [{ column: 'c2', op: 'in', values: ['120,5'] }] }), PROFILE),
    ).toThrow(/no distinct value list/);
  });

  it('throws "in" with a value not in the real distinct list', () => {
    expect(() =>
      validateInstruction(out({ filters: [{ column: 'c1', op: 'in', values: ['Den Haag'] }] }), PROFILE),
    ).toThrow(/NOT one of its real values/);
  });

  it('accepts "in" with values drawn from the real distinct list', () => {
    expect(() =>
      validateInstruction(
        out({ filters: [{ column: 'c1', op: 'in', values: ['Amsterdam', 'Utrecht'] }] }),
        PROFILE,
      ),
    ).not.toThrow();
  });

  it('throws "between" on a column with no min/max (a text column)', () => {
    expect(() =>
      validateInstruction(out({ filters: [{ column: 'c1', op: 'between', from: 0, to: 1 }] }), PROFILE),
    ).toThrow(/no min\/max range/);
  });

  it('throws "between" with from > to', () => {
    expect(() =>
      validateInstruction(out({ filters: [{ column: 'c0', op: 'between', from: 2023, to: 2015 }] }), PROFILE),
    ).toThrow(/greater than to/);
  });

  it('throws "between" with a range outside the column\'s real range', () => {
    expect(() =>
      validateInstruction(out({ filters: [{ column: 'c0', op: 'between', from: 2000, to: 2023 }] }), PROFILE),
    ).toThrow(/outside the column's real range/);
  });

  it('accepts "between" fully inside the column\'s real range', () => {
    expect(() =>
      validateInstruction(out({ filters: [{ column: 'c0', op: 'between', from: 2020, to: 2023 }] }), PROFILE),
    ).not.toThrow();
  });
});

describe('validateInstruction — ambiguous number format is rejected everywhere it could be used (fixed in review)', () => {
  const ambiguousProfile: DatasetProfile = {
    rowCount: 2,
    columns: [
      ...PROFILE.columns,
      { id: 'c3', header: 'Omzet2', type: 'number', numberFormat: 'ambiguous', nulls: 0 },
    ],
  };

  it('throws when a y column has an unresolved ambiguous format', () => {
    expect(() => validateInstruction(out({ y: ['c3'] }), ambiguousProfile)).toThrow(
      /unresolved ambiguous number format/,
    );
  });

  it('throws when a line chart x column has an unresolved ambiguous format', () => {
    expect(() => validateInstruction(out({ kind: 'line', x: 'c3', y: ['c2'] }), ambiguousProfile)).toThrow(
      /unresolved ambiguous number format/,
    );
  });

  it('throws on a "between" filter against an unresolved ambiguous column, even without an explicit min/max check firing first', () => {
    expect(() =>
      validateInstruction(
        out({ filters: [{ column: 'c3', op: 'between', from: 0, to: 100 }] }),
        ambiguousProfile,
      ),
    ).toThrow(/unresolved ambiguous number format/);
  });
});

describe('validateInstruction — limit and confidence ranges', () => {
  it('throws on limit 0', () => {
    expect(() => validateInstruction(out({ limit: 0 }), PROFILE)).toThrow(/outside the allowed 1\.\.50/);
  });

  it('throws on a negative limit', () => {
    expect(() => validateInstruction(out({ limit: -5 }), PROFILE)).toThrow(/outside the allowed 1\.\.50/);
  });

  it('throws on a non-integer limit', () => {
    expect(() => validateInstruction(out({ limit: 3.5 }), PROFILE)).toThrow(/outside the allowed 1\.\.50/);
  });

  it('throws on a limit over 50', () => {
    expect(() => validateInstruction(out({ limit: 51 }), PROFILE)).toThrow(/outside the allowed 1\.\.50/);
  });

  it('accepts limit at the boundaries', () => {
    expect(() => validateInstruction(out({ limit: 1 }), PROFILE)).not.toThrow();
    expect(() => validateInstruction(out({ limit: 50 }), PROFILE)).not.toThrow();
  });

  it('throws on confidence outside 0..1', () => {
    expect(() => validateInstruction(out({ confidence: 1.5 }), PROFILE)).toThrow(/outside 0\.\.1/);
    expect(() => validateInstruction(out({ confidence: -0.1 }), PROFILE)).toThrow(/outside 0\.\.1/);
  });
});

describe('chartInstructionJsonSchema', () => {
  it('renders a JSON schema object', () => {
    const schema = chartInstructionJsonSchema();
    expect(schema).toHaveProperty('properties');
  });
});

// Co-pilot phase 2 (session 113, Task 6) — the Data panel's pure half: the
// digit-free summary a `setInstruction` command carries into the history
// menu, the client-side run of the SERVER's own allowlist, and the patch
// normaliser that keeps a control change from producing a shape the schema
// would reject for a reason the reader never asked about.
import { describe, expect, it } from 'vitest';
import { CHART_INSTRUCTION_SUMMARY_MAX_LENGTH, validateCommand, type CommandContext } from './chart-commands.ts';
import {
  summarizeInstruction,
  translateValidationReason,
  validateClientInstruction,
  withPatch,
} from './chart-data-instruction.ts';
import type { ValidationReason, ValidationReasonCode } from '../backend/attachments/instruct/schema.ts';
import type { ClientChartInstruction, DatasetProfile } from '../backend/attachments/types.ts';

const PROFILE: DatasetProfile = {
  columns: [
    { id: 'c0', header: 'Gemeente', type: 'text', distinct: ['Amsterdam', 'Rotterdam'], nulls: 0 },
    { id: 'c1', header: 'Omzet', type: 'number', numberFormat: 'nl', min: 0, max: 100, nulls: 0 },
    { id: 'c2', header: 'Kosten', type: 'number', numberFormat: 'nl', min: 0, max: 80, nulls: 0 },
    { id: 'c3', header: 'Jaar', type: 'year', distinct: ['2023', '2024'], min: 2023, max: 2024, nulls: 0 },
  ],
  rowCount: 4,
};

function base(overrides: Partial<ClientChartInstruction> = {}): ClientChartInstruction {
  return {
    version: 2,
    kind: 'bar',
    x: 'c0',
    y: ['c1'],
    seriesBy: null,
    filters: [],
    sort: null,
    limit: null,
    aggregate: null,
    derived: null,
    unsupported: null,
    ...overrides,
  };
}

function isClean(summary: string): void {
  expect(summary).not.toMatch(/\d/);
  expect(summary.length).toBeLessThanOrEqual(CHART_INSTRUCTION_SUMMARY_MAX_LENGTH);
  expect(summary.trim().length).toBeGreaterThan(0);
}

describe('summarizeInstruction', () => {
  it('describes a plain instruction in nl and en', () => {
    const nl = summarizeInstruction(base(), PROFILE, 'nl');
    const en = summarizeInstruction(base(), PROFILE, 'en');
    expect(nl).toBe('Omzet per Gemeente');
    expect(en).toBe('Omzet by Gemeente');
    isClean(nl);
    isClean(en);
  });

  it('describes an aggregated, sorted, limited instruction the way the brief spells it', () => {
    const i = base({ aggregate: { fn: 'sum' }, sort: { by: 'value', direction: 'desc' }, limit: 5 });
    const nl = summarizeInstruction(i, PROFILE, 'nl');
    expect(nl).toBe('Som van Omzet per Gemeente, hoogste eerst, top vijf');
    expect(summarizeInstruction(i, PROFILE, 'en')).toBe('Sum of Omzet by Gemeente, highest first, top five');
    isClean(nl);
  });

  it('spells a limit over ten as "beperkt"/"limited" rather than a figure', () => {
    const i = base({ limit: 25 });
    expect(summarizeInstruction(i, PROFILE, 'nl')).toContain('beperkt');
    expect(summarizeInstruction(i, PROFILE, 'en')).toContain('limited');
    isClean(summarizeInstruction(i, PROFILE, 'nl'));
  });

  it('describes a derived reading, a split and a filter', () => {
    const i = base({
      derived: { op: 'difference', b: 'c2' },
      seriesBy: 'c3',
      filters: [{ column: 'c0', op: 'in', values: ['Amsterdam'] }],
    });
    const nl = summarizeInstruction(i, PROFILE, 'nl');
    expect(nl).toBe('Omzet min Kosten per Gemeente, uitgesplitst naar Jaar, gefilterd op Gemeente');
    expect(summarizeInstruction(i, PROFILE, 'en')).toBe(
      'Omzet minus Kosten by Gemeente, split by Jaar, filtered on Gemeente',
    );
    isClean(nl);
  });

  it('names the count aggregate without naming a column', () => {
    const i = base({ aggregate: { fn: 'count' } });
    expect(summarizeInstruction(i, PROFILE, 'nl')).toBe('Aantal rijen per Gemeente');
    expect(summarizeInstruction(i, PROFILE, 'en')).toBe('Count of rows by Gemeente');
  });

  // A header the reader's own file supplied can carry a digit ("Omzet 2024"),
  // and a summary carrying it would be REFUSED by validateCommand's digit
  // rule — so the digits come out of the header, never out of the summary.
  it('strips a digit a column header carries, and still produces a usable label', () => {
    const profile: DatasetProfile = {
      columns: [
        { id: 'c0', header: 'Jaar', type: 'year', distinct: ['2024'], min: 2024, max: 2024, nulls: 0 },
        { id: 'c1', header: 'Omzet 2024', type: 'number', numberFormat: 'nl', min: 0, max: 9, nulls: 0 },
        { id: 'c2', header: '2024', type: 'number', numberFormat: 'nl', min: 0, max: 9, nulls: 0 },
      ],
      rowCount: 1,
    };
    expect(summarizeInstruction(base({ x: 'c0', y: ['c1'] }), profile, 'nl')).toBe('Omzet per Jaar');
    expect(summarizeInstruction(base({ x: 'c0', y: ['c2'] }), profile, 'nl')).toBe('kolom per Jaar');
  });

  it('truncates a very long summary to the command cap', () => {
    const long = 'Omzet in euro per gemeente en per jaar en per sector en per regio en per maand';
    const profile: DatasetProfile = {
      columns: [
        { id: 'c0', header: long, type: 'text', distinct: ['a'], nulls: 0 },
        { id: 'c1', header: long, type: 'number', numberFormat: 'nl', min: 0, max: 1, nulls: 0 },
      ],
      rowCount: 1,
    };
    const summary = summarizeInstruction(base({ x: 'c0', y: ['c1'] }), profile, 'nl');
    expect(summary.endsWith('…')).toBe(true);
    isClean(summary);
  });

  // The summary's real contract: it is the `summary` field of a command
  // validateCommand must accept.
  it('produces a summary validateCommand accepts', () => {
    const i = base({ aggregate: { fn: 'mean' }, sort: { by: 'value', direction: 'asc' }, limit: 50 });
    const ctx: CommandContext = { spec: { kind: 'bar', series: [] }, alternatesCount: 0, profile: PROFILE };
    for (const lang of ['nl', 'en'] as const) {
      expect(validateCommand({ kind: 'setInstruction', instruction: i, summary: summarizeInstruction(i, PROFILE, lang) }, ctx)).toBe(true);
    }
  });
});

describe('validateClientInstruction', () => {
  it('returns null for a valid instruction', () => {
    expect(validateClientInstruction(base(), PROFILE)).toBeNull();
  });

  it('returns a structured reason (code + params) for a derived op missing its b, not a pre-built string', () => {
    const problem = validateClientInstruction(base({ derived: { op: 'difference', b: null } }), PROFILE);
    expect(problem).toEqual({ code: 'derived_needs_b', params: { op: 'difference' } });
  });

  it('returns a reason code for a y column that is not a number column', () => {
    expect(validateClientInstruction(base({ y: ['c0'] }), PROFILE)).toEqual({
      code: 'y_column_wrong_type',
      params: { column: 'c0', type: 'text' },
    });
  });

  it('returns a reason code for an empty y selection, with the cap as a param (never a literal)', () => {
    expect(validateClientInstruction(base({ y: [] }), PROFILE)).toEqual({
      code: 'y_count_out_of_range',
      params: { count: 0, max: 4 },
    });
  });
});

describe('translateValidationReason', () => {
  it('translates a reason code into nl and en text, with the params filled in', () => {
    const reason = validateClientInstruction(base({ y: [] }), PROFILE)!;
    const nl = translateValidationReason('nl', reason);
    const en = translateValidationReason('en', reason);
    expect(nl).toBe('0 waarde-kolommen is te veel of te weinig — kies er 1 tot 4.');
    expect(en).toBe('0 value columns is too many or too few — pick 1 to 4.');
  });

  it('translates a derived op param through its own label, not the raw op id', () => {
    const reason = validateClientInstruction(base({ derived: { op: 'difference', b: null } }), PROFILE)!;
    expect(translateValidationReason('nl', reason)).toBe('Verschil heeft een tweede kolom nodig.');
    expect(translateValidationReason('en', reason)).toBe('Difference needs a second column.');
  });

  it('renders the limit cap from the same constant the validator checked, not a hardcoded literal', () => {
    const reason = validateClientInstruction(base({ limit: 500 }), PROFILE)!;
    expect(reason).toEqual({ code: 'limit_out_of_range', params: { limit: 500, max: 50 } });
    expect(translateValidationReason('nl', reason)).toContain('1..50');
  });
});

describe('withPatch', () => {
  it('shallow-merges the patch', () => {
    expect(withPatch(base(), { kind: 'line', x: 'c3' })).toMatchObject({ kind: 'line', x: 'c3', y: ['c1'] });
  });

  it('nulls derived.b when the chosen op takes none', () => {
    const next = withPatch(base({ derived: { op: 'difference', b: 'c2' } }), { derived: { op: 'share_of_total', b: 'c2' } });
    expect(next.derived).toEqual({ op: 'share_of_total', b: null });
  });

  it('keeps derived.b for an op that needs one', () => {
    const next = withPatch(base(), { derived: { op: 'ratio', b: 'c2' } });
    expect(next.derived).toEqual({ op: 'ratio', b: 'c2' });
  });

  it('drops a column sort once aggregate is set', () => {
    const next = withPatch(base({ sort: { by: 'c1', direction: 'asc' } }), { aggregate: { fn: 'sum' } });
    expect(next.sort).toBeNull();
  });

  it('drops a column sort once derived is set', () => {
    const next = withPatch(base({ sort: { by: 'c1', direction: 'asc' } }), { derived: { op: 'share_of_total', b: null } });
    expect(next.sort).toBeNull();
  });

  it('keeps an x/value sort alongside an aggregate', () => {
    const next = withPatch(base({ sort: { by: 'value', direction: 'desc' } }), { aggregate: { fn: 'sum' } });
    expect(next.sort).toEqual({ by: 'value', direction: 'desc' });
  });

  it('trims y to one column once derived is set', () => {
    const next = withPatch(base({ y: ['c1', 'c2'] }), { derived: { op: 'share_of_total', b: null } });
    expect(next.y).toEqual(['c1']);
  });

  it('leaves y alone with no derived reading', () => {
    expect(withPatch(base(), { y: ['c1', 'c2'] }).y).toEqual(['c1', 'c2']);
  });

  it('never mutates the instruction it was given', () => {
    const before = base({ y: ['c1', 'c2'], sort: { by: 'c1', direction: 'asc' } });
    const snapshot = JSON.stringify(before);
    withPatch(before, { derived: { op: 'share_of_total', b: null } });
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});

describe('translateValidationReason — every ValidationReasonCode has nl/en text', () => {
  // Exhaustive by construction: TypeScript requires exactly one sample per
  // `ValidationReasonCode` here (excess-property + missing-property
  // checking on a directly-typed object literal — the same trick
  // messages.ts's own `en: Messages` uses to pin nl/en parity) — a new
  // reason code with no sample here is a COMPILE error, never a silently
  // untested case.
  const SAMPLES: Record<ValidationReasonCode, ValidationReason> = {
    invalid_json: { code: 'invalid_json', params: { detail: 'x' } },
    schema_violation: { code: 'schema_violation', params: { detail: 'x' } },
    unknown_column: { code: 'unknown_column', params: { column: 'c9' } },
    y_count_out_of_range: { code: 'y_count_out_of_range', params: { count: 5, max: 4 } },
    y_column_wrong_type: { code: 'y_column_wrong_type', params: { column: 'c0', type: 'text' } },
    y_column_ambiguous: { code: 'y_column_ambiguous', params: { column: 'c1' } },
    line_x_wrong_type: { code: 'line_x_wrong_type', params: { column: 'c1', type: 'text' } },
    line_x_ambiguous: { code: 'line_x_ambiguous', params: { column: 'c1' } },
    series_no_distinct: { code: 'series_no_distinct', params: { column: 'c1' } },
    series_too_many: { code: 'series_too_many', params: { column: 'c0', count: 12, max: 8 } },
    filter_in_no_distinct: { code: 'filter_in_no_distinct', params: { column: 'c1' } },
    filter_value_invalid: { code: 'filter_value_invalid', params: { value: 'Nergenshuizen', column: 'c0' } },
    filter_between_ambiguous: { code: 'filter_between_ambiguous', params: { column: 'c1' } },
    filter_between_no_range: { code: 'filter_between_no_range', params: { column: 'c0' } },
    filter_range_reversed: { code: 'filter_range_reversed', params: { column: 'c1', from: 10, to: 5 } },
    filter_range_outside: {
      code: 'filter_range_outside',
      params: { column: 'c1', from: -5, to: 500, min: 0, max: 100 },
    },
    limit_out_of_range: { code: 'limit_out_of_range', params: { limit: 500, max: 50 } },
    derived_needs_one_y: { code: 'derived_needs_one_y', params: { op: 'percent_change' } },
    derived_needs_b: { code: 'derived_needs_b', params: { op: 'difference' } },
    derived_no_b: { code: 'derived_no_b', params: { op: 'share_of_total' } },
    derived_b_wrong_type: { code: 'derived_b_wrong_type', params: { column: 'c0', type: 'text' } },
    derived_b_ambiguous: { code: 'derived_b_ambiguous', params: { column: 'c1' } },
    derived_with_count: { code: 'derived_with_count', params: { op: 'ratio' } },
    percent_change_x_wrong_type: { code: 'percent_change_x_wrong_type', params: { column: 'c0', type: 'text' } },
    sort_illegal_with_aggregate: { code: 'sort_illegal_with_aggregate', params: { by: 'c1' } },
    confidence_out_of_range: { code: 'confidence_out_of_range', params: { confidence: 1.5 } },
    copilot_invalid_json: { code: 'copilot_invalid_json', params: { detail: 'x' } },
    copilot_schema_violation: { code: 'copilot_schema_violation', params: { detail: 'x' } },
    copilot_confidence_out_of_range: { code: 'copilot_confidence_out_of_range', params: { confidence: -0.2 } },
  };

  for (const [code, reason] of Object.entries(SAMPLES) as [ValidationReasonCode, ValidationReason][]) {
    it(`renders "${code}" in both nl and en with every param filled in`, () => {
      for (const lang of ['nl', 'en'] as const) {
        const text = translateValidationReason(lang, reason);
        expect(text.length).toBeGreaterThan(0);
        // No leftover `{name}` placeholder — every param the reason carries
        // has a home in the template (t()'s own miss-fallback would leave
        // the brace in place, which is how a mismatched param name would show up).
        expect(text).not.toMatch(/\{\w+\}/);
      }
    });
  }

  it('carries a number param through literally, never a hardcoded digit baked into the template', () => {
    const reason: ValidationReason = { code: 'limit_out_of_range', params: { limit: 500, max: 50 } };
    expect(translateValidationReason('nl', reason)).toContain('500');
    expect(translateValidationReason('nl', reason)).toContain('50');
    expect(translateValidationReason('en', reason)).toContain('500');
    expect(translateValidationReason('en', reason)).toContain('50');
  });
});

// Co-pilot phase 2 (session 113, Task 6) — the Data panel's pure half: the
// digit-free summary a `setInstruction` command carries into the history
// menu, the client-side run of the SERVER's own allowlist, and the patch
// normaliser that keeps a control change from producing a shape the schema
// would reject for a reason the reader never asked about.
import { describe, expect, it } from 'vitest';
import { CHART_INSTRUCTION_SUMMARY_MAX_LENGTH, validateCommand, type CommandContext } from './chart-commands.ts';
import { summarizeInstruction, validateClientInstruction, withPatch } from './chart-data-instruction.ts';
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

  it('returns the schema\'s own message for a derived op missing its b', () => {
    const problem = validateClientInstruction(base({ derived: { op: 'difference', b: null } }), PROFILE);
    expect(problem).toBe("derived 'difference' needs a second column b");
  });

  it('returns a message for a y column that is not a number column', () => {
    expect(validateClientInstruction(base({ y: ['c0'] }), PROFILE)).toContain("not 'number' or 'year'");
  });

  it('returns a message for an empty y selection', () => {
    expect(validateClientInstruction(base({ y: [] }), PROFILE)).toContain('outside the allowed');
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

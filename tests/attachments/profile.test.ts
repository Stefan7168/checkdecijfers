// DatasetProfile construction (D6, the R2 analog) — the ONLY dataset
// content that ever reaches an LLM prompt. Every case here proves the
// profile is built strictly from the file's own cells, never guessed.
import { describe, expect, it } from 'vitest';
import { buildDatasetProfile } from '../../src/attachments/ingest/profile.ts';

const CELLS = [
  ['Jaar', 'Gemeente', 'Omzet'],
  ['2020', 'Amsterdam', '120,5'],
  ['2021', 'Rotterdam', '9.800'],
  ['2022', 'Amsterdam', 'n.v.t.'],
];

describe('buildDatasetProfile — column ids and rowCount', () => {
  it('assigns positional column ids and counts DATA rows only', () => {
    const profile = buildDatasetProfile(CELLS);
    expect(profile.columns.map((c) => c.id)).toEqual(['c0', 'c1', 'c2']);
    expect(profile.rowCount).toBe(3);
  });

  it('carries the header text verbatim (U9 — never reworded)', () => {
    const profile = buildDatasetProfile(CELLS);
    expect(profile.columns.map((c) => c.header)).toEqual(['Jaar', 'Gemeente', 'Omzet']);
  });
});

describe('buildDatasetProfile — type classification', () => {
  it('classifies a 4-digit in-range column as year', () => {
    const profile = buildDatasetProfile(CELLS);
    expect(profile.columns[0]!.type).toBe('year');
  });

  it('classifies a plain-word column as text', () => {
    const profile = buildDatasetProfile(CELLS);
    expect(profile.columns[1]!.type).toBe('text');
  });

  it('classifies a column with a valid n.v.t. marker as number, not text', () => {
    const profile = buildDatasetProfile(CELLS);
    expect(profile.columns[2]!.type).toBe('number');
  });

  it('classifies an ISO date column as date', () => {
    const profile = buildDatasetProfile([['Datum'], ['2020-01-15'], ['2020-06-01']]);
    expect(profile.columns[0]!.type).toBe('date');
  });

  it('does NOT classify a 4-digit column outside 1900-2100 as year — falls through to number, not text (it IS still numeric)', () => {
    const profile = buildDatasetProfile([['Code'], ['1899'], ['2101']]);
    expect(profile.columns[0]!.type).toBe('number');
  });

  it('one non-numeric value among numbers makes the whole column text (never guess)', () => {
    const profile = buildDatasetProfile([['Waarde'], ['100'], ['een beetje']]);
    expect(profile.columns[0]!.type).toBe('text');
  });

  it('an all-missing column classifies as text (nothing real to classify)', () => {
    const profile = buildDatasetProfile([['Leeg'], [''], ['n.v.t.']]);
    expect(profile.columns[0]!.type).toBe('text');
  });
});

describe('buildDatasetProfile — distinct lists (fixed in review: year/date columns get one too)', () => {
  it('gives a text column a sorted, deduplicated distinct list', () => {
    const profile = buildDatasetProfile(CELLS);
    expect(profile.columns[1]!.distinct).toEqual(['Amsterdam', 'Rotterdam']);
    expect(profile.columns[1]!.distinctTruncated).toBe(false);
  });

  it('gives a year column a distinct list too — closes the original in-filter gap', () => {
    const profile = buildDatasetProfile(CELLS);
    expect(profile.columns[0]!.distinct).toEqual(['2020', '2021', '2022']);
  });

  it('gives a high-cardinality number column NO distinct list — "in" is illegal on it by construction', () => {
    const profile = buildDatasetProfile(CELLS);
    expect(profile.columns[2]!.distinct).toBeUndefined();
  });

  it('caps the distinct list and marks it truncated beyond the cap', () => {
    const values = Array.from({ length: 60 }, (_, i) => `stad-${i}`);
    const profile = buildDatasetProfile([['Plaats'], ...values.map((v) => [v])]);
    expect(profile.columns[0]!.distinct).toHaveLength(50);
    expect(profile.columns[0]!.distinctTruncated).toBe(true);
  });
});

describe('buildDatasetProfile — numeric range and format', () => {
  it('computes min/max over parseable numeric cells, skipping missing markers', () => {
    const profile = buildDatasetProfile(CELLS);
    // 120,5 (nl) and 9.800 (resolved to nl by column-wide consistency with
    // the ambiguous-alone 120,5 cell providing the nl signal) -> 9800.
    const omzet = profile.columns[2]!;
    expect(omzet.numberFormat).toBe('nl');
    expect(omzet.min).toBeCloseTo(120.5);
    expect(omzet.max).toBe(9800);
  });

  it('computes a year column range as plain integers', () => {
    const profile = buildDatasetProfile(CELLS);
    expect(profile.columns[0]!.min).toBe(2020);
    expect(profile.columns[0]!.max).toBe(2022);
  });

  it('propagates an ambiguous numberFormat rather than guessing', () => {
    const profile = buildDatasetProfile([['Omzet'], ['9.800'], ['1.500']]);
    expect(profile.columns[0]!.numberFormat).toBe('ambiguous');
  });

  it('fixed in review — an ambiguous column gets NO min/max, never a guessed range', () => {
    // Before this fix, a crude format-blind parseFloat(cell.replace(',','.'))
    // manufactured a plausible-looking range for an ambiguous column, which
    // let instruct/schema.ts's 'between' filter check (min/max defined?)
    // validate successfully on a column the design says must block
    // charting until the user disambiguates.
    const profile = buildDatasetProfile([['Omzet'], ['9.800'], ['1.500']]);
    expect(profile.columns[0]!.min).toBeUndefined();
    expect(profile.columns[0]!.max).toBeUndefined();
  });
});

describe('buildDatasetProfile — nulls and sample', () => {
  it('counts missing-marker cells as nulls', () => {
    const profile = buildDatasetProfile(CELLS);
    expect(profile.columns[2]!.nulls).toBe(1);
  });

  it('carries a few raw, non-missing samples', () => {
    const profile = buildDatasetProfile(CELLS);
    expect(profile.columns[1]!.sample).toEqual(['Amsterdam', 'Rotterdam', 'Amsterdam']);
  });
});

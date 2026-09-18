// Co-pilot phase 2 (session 113, Task 8) — the chat doorway's two pure
// inputs: what THIS chart can currently do (the advisory capability list the
// prompt is narrowed by) and the three example chips shown under the input.
// Both are deterministic; the chips are also digit-free, which is what keeps
// the whole-card digit scan clean while they are on screen.
import { describe, expect, it } from 'vitest';
import { exampleChips, ownDataCapabilities } from './chart-capabilities.ts';
import { PRESENTATION_KEYS, TEMPLATE_IDS } from '../backend/attachments/copilot/types.ts';
import { initialDocState, type ChartDocState } from './chart-commands.ts';
import type { PresentationKey } from './chart-presentation.ts';
import type { ClientChartInstruction, DatasetProfile, UserChartSpec } from '../backend/attachments/types.ts';
import type { PlottableSpec } from '../components/chart.tsx';

const ALL_APPLICABLE: ReadonlySet<PresentationKey> = new Set(PRESENTATION_KEYS as readonly PresentationKey[]);

function plottable(kind: 'line' | 'bar', seriesCount: number): PlottableSpec {
  return {
    kind,
    series: Array.from({ length: seriesCount }, (_, i) => ({
      label: `Series ${i}`,
      points: [{ periodCode: 'p', periodLabel: 'p', value: 1, formattedValue: '1', provisional: false, resultId: `r${i}` }],
    })),
  };
}

describe('ownDataCapabilities', () => {
  it('offers only the forms this spec actually allows (lineFormAllowed et al.)', () => {
    // A bar-kind spec with more than one series: a line would connect
    // unrelated categories, so lineFormAllowed says no — and area/hbar
    // follow their own rules (area is single-series line only; hbar is
    // bar-kind only).
    const caps = ownDataCapabilities({ spec: plottable('bar', 2), form: 'bar', seriesCount: 2, applicable: ALL_APPLICABLE, lang: 'nl' });
    expect(caps.forms).not.toContain('line');
    expect(caps.forms).not.toContain('area');
    expect(caps.forms).toEqual(expect.arrayContaining(['bar', 'hbar', 'table']));
  });

  it('offers line + area for a single-series line spec, and never hbar', () => {
    const caps = ownDataCapabilities({ spec: plottable('line', 1), form: 'line', seriesCount: 1, applicable: ALL_APPLICABLE, lang: 'nl' });
    expect(caps.forms).toEqual(expect.arrayContaining(['line', 'area', 'bar', 'table']));
    expect(caps.forms).not.toContain('hbar');
  });

  it('reports exactly the applicable presentation keys the chat may patch', () => {
    const applicable: ReadonlySet<PresentationKey> = new Set<PresentationKey>(['grid', 'markers', 'valueLabels']);
    const caps = ownDataCapabilities({ spec: plottable('line', 1), form: 'line', seriesCount: 1, applicable, lang: 'nl' });
    // `valueLabels` is not in the chat's own vocabulary (PRESENTATION_KEYS),
    // so an applicable key the chat cannot patch is still left out.
    expect(caps.presentationKeys.sort()).toEqual(['grid', 'markers']);
  });

  it('offers the template gallery on a chart form and nothing in table form', () => {
    expect(ownDataCapabilities({ spec: plottable('line', 1), form: 'line', seriesCount: 1, applicable: ALL_APPLICABLE, lang: 'en' }).templates).toEqual([
      ...TEMPLATE_IDS,
    ]);
    const table = ownDataCapabilities({ spec: plottable('line', 1), form: 'table', seriesCount: 1, applicable: new Set(), lang: 'en' });
    expect(table.templates).toEqual([]);
    expect(table.presentationKeys).toEqual([]);
  });

  it("carries the chart's own language", () => {
    expect(ownDataCapabilities({ spec: plottable('line', 1), form: 'line', seriesCount: 1, applicable: ALL_APPLICABLE, lang: 'en' }).lang).toBe('en');
  });
});

const PROFILE: DatasetProfile = {
  columns: [
    { id: 'c0', header: 'Gemeente 2024', type: 'text', distinct: ['Amsterdam', 'Rotterdam'], nulls: 0 },
    { id: 'c1', header: 'Omzet', type: 'number', numberFormat: 'nl', nulls: 0 },
  ],
  rowCount: 2,
};

const INSTRUCTION: ClientChartInstruction = {
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
};

function point(label: string, value: number | null) {
  return { rowRef: `r-${label}-${value}`, xKey: label, xLabel: label, value, formattedValue: String(value), sourceText: String(value) };
}

function spec(kind: 'line' | 'bar', series: { label: string; points: ReturnType<typeof point>[] }[]): UserChartSpec {
  return {
    schemaVersion: 1,
    origin: 'user_dataset',
    trust: 'unverified',
    kind,
    xHeader: 'Gemeente',
    yHeaders: ['Omzet'],
    series,
    provenance: {
      datasetId: 1,
      sourceKind: 'file_csv',
      displayName: 'x.csv',
      sourceUrlHost: null,
      capturedAt: '2026-09-18T00:00:00.000Z',
      contentSha256: 'x',
    },
    disclaimerLine: 'User-uploaded data — not verified by checkdecijfers.',
  };
}

const ONE_SERIES = spec('bar', [{ label: 'Omzet', points: [point('Amsterdam', 3)] }]);
const TWO_SERIES = spec('line', [
  { label: 'Amsterdam', points: [point('a', 1), point('b', 9)] },
  { label: 'Rotterdam', points: [point('a', 4), point('b', 2)] },
]);

function state(overrides: Partial<ChartDocState> = {}): ChartDocState {
  return { ...initialDocState('bar', {}, INSTRUCTION), ...overrides };
}

describe('exampleChips', () => {
  it('leads with the aggregate chip, naming the grouping column digit-free', () => {
    const chips = exampleChips({ instruction: INSTRUCTION, profile: PROFILE, spec: ONE_SERIES, state: state(), lang: 'nl' });
    expect(chips).toHaveLength(3);
    // The header is "Gemeente 2024" in the file; the label strips the digits.
    expect(chips[0]).toEqual({ label: 'Totaal per Gemeente', message: 'Totaal per Gemeente' });
  });

  it('offers the spotlight chip for a multi-series chart, naming the highest last value', () => {
    const chips = exampleChips({ instruction: INSTRUCTION, profile: PROFILE, spec: TWO_SERIES, state: state(), lang: 'nl' });
    // Amsterdam's last non-null value (9) beats Rotterdam's (2).
    expect(chips.map((c) => c.label)).toContain('Zet Amsterdam in de schijnwerper');
  });

  it('falls back to "Hoogste eerst" on a single-series bar chart', () => {
    const chips = exampleChips({ instruction: INSTRUCTION, profile: PROFILE, spec: ONE_SERIES, state: state(), lang: 'nl' });
    expect(chips.map((c) => c.label)).toContain('Hoogste eerst');
  });

  it('asks for a title when there is none and for a shorter one when there is', () => {
    const none = exampleChips({ instruction: INSTRUCTION, profile: PROFILE, spec: ONE_SERIES, state: state(), lang: 'nl' });
    expect(none.map((c) => c.label)).toContain('Geef de grafiek een kop');
    const titled = exampleChips({ instruction: INSTRUCTION, profile: PROFILE, spec: ONE_SERIES, state: state({ title: 'Een hele lange kop' }), lang: 'nl' });
    expect(titled.map((c) => c.label)).toContain('Maak de kop korter');
  });

  it('fills to exactly three from the fallback list when the rules cannot', () => {
    // No distinct column, already aggregated, one series, line kind: only
    // the title rule fires.
    const aggregated: ClientChartInstruction = { ...INSTRUCTION, aggregate: { fn: 'sum' } };
    const bare: DatasetProfile = { columns: [{ id: 'c1', header: 'Omzet', type: 'number', numberFormat: 'nl', nulls: 0 }], rowCount: 1 };
    const chips = exampleChips({
      instruction: aggregated,
      profile: bare,
      spec: spec('line', [{ label: 'Omzet', points: [point('a', 1)] }]),
      state: state(),
      lang: 'en',
    });
    expect(chips).toHaveLength(3);
    expect(chips.map((c) => c.label)).toEqual(['Give the chart a title', 'Make it a bar chart', 'Hide the grid']);
  });

  it('every chip label is digit-free, in both languages, and is its own message', () => {
    for (const lang of ['nl', 'en'] as const) {
      for (const input of [ONE_SERIES, TWO_SERIES]) {
        const chips = exampleChips({ instruction: INSTRUCTION, profile: PROFILE, spec: input, state: state({ title: 'x' }), lang });
        expect(chips).toHaveLength(3);
        for (const chip of chips) {
          expect(chip.label).not.toMatch(/\d/);
          expect(chip.message).toBe(chip.label);
        }
      }
    }
  });
});

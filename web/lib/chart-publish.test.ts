import { describe, expect, it } from 'vitest';
import type { ChartPoint, ChartSpec } from '../backend/chart/types.ts';
import { replayLog } from './chart-history.ts';
import { initialDocState } from './chart-commands.ts';
import {
  PUBLISHED_LABEL_PLACEHOLDER,
  passesNumbersRule,
  prunePublishedLog,
  publishableText,
  publishedStyle,
} from './chart-publish.ts';

function point(periodCode: string, periodLabel: string, value: number, formattedValue: string): ChartPoint {
  return {
    resultId: `03759ned:M000352:NL01:${periodCode}`,
    periodCode,
    periodLabel,
    value,
    formattedValue,
    decimals: 0,
    status: 'definitive',
    provisional: false,
    valueAttribute: 'None',
  };
}

function spec(): ChartSpec {
  return {
    schemaVersion: 1,
    kind: 'line',
    title: 'Bevolking op 1 januari',
    dims: {},
    dimLabels: {},
    unit: 'aantal',
    series: [
      {
        label: 'Nederland',
        regionCode: 'NL01',
        points: [point('2023JJ00', '2023', 17811291, '17.811.291'), point('2024JJ00', '2024', 17942942, '17.942.942')],
      },
    ],
    provisionalNote: null,
    nullNotes: [],
    definitionLine: null,
    attributionLine: 'Bron: CBS StatLine, tabel 03759ned — Bevolking. Gegevens gesynchroniseerd op 2026-07-02. Periode: 2023–2024. Licentie: CC BY 4.0.',
    attribution: {
      tableId: '03759ned',
      tableTitle: 'Bevolking',
      tableVersion: 1,
      syncedAt: '2026-07-02T00:00:00Z',
      coveredPeriods: { from: '2023JJ00', to: '2024JJ00' },
      license: 'CC BY 4.0',
    },
  } as ChartSpec;
}

const env = { at: '2026-09-27T00:00:00Z', source: 'panel' as const };

describe('the numbers rule', () => {
  it('passes text with no digits, or only digits the chart shows (either spelling)', () => {
    expect(passesNumbersRule('Groei van de bevolking', spec())).toBe(true);
    expect(passesNumbersRule('Bevolking 2024: 17.942.942', spec())).toBe(true);
    expect(passesNumbersRule('Population 2024: 17,942,942', spec())).toBe(true);
  });

  it('fails text quoting a number the chart does not show', () => {
    expect(passesNumbersRule('Bijna 18 miljoen in 2024', spec())).toBe(false);
    expect(passesNumbersRule('Groei van 50%', spec())).toBe(false);
  });

  it('publishableText returns the text or null', () => {
    expect(publishableText('Heel Nederland', spec())).toBe('Heel Nederland');
    expect(publishableText('Groei van 50%', spec())).toBeNull();
    expect(publishableText('   ', spec())).toBeNull();
    expect(publishableText(null, spec())).toBeNull();
  });
});

describe('prunePublishedLog', () => {
  it('returns null for an absent or unparseable log', () => {
    expect(prunePublishedLog(null, spec())).toBeNull();
    expect(prunePublishedLog([{ kind: 'nope' }], spec())).toBeNull();
    expect(prunePublishedLog([], spec())).toBeNull();
  });

  it('drops notes and the reading choice, keeps view and style commands', () => {
    const log = [
      { ...env, id: 'a', kind: 'setForm', form: 'bar' },
      { ...env, id: 'b', kind: 'applyTemplate', templateId: 'brutalist' },
      {
        ...env,
        id: 'c',
        kind: 'addNote',
        note: { id: 'n1', text: 'Privé: nog checken', resultId: '03759ned:M000352:NL01:2024JJ00', periodLabel: '2024', seriesLabel: 'Nederland' },
      },
      { ...env, id: 'd', kind: 'setReading', index: 0 },
    ];
    const out = prunePublishedLog(log, spec())!;
    expect(out.map((c) => c.kind)).toEqual(['setForm', 'applyTemplate']);
    expect(JSON.stringify(out)).not.toContain('Privé');
  });

  it('replaces typed goal-line and period labels with a digit-free placeholder', () => {
    const log = [
      { ...env, id: 'a', kind: 'addGoalLine', goalLine: { id: 'g1', value: 18000000, label: 'Doel 18 mln' } },
      { ...env, id: 'b', kind: 'addEraShading', era: { id: 'e1', fromPeriodCode: '2024JJ00', toPeriodCode: '2024JJ00', label: 'Storm' } },
    ];
    const out = prunePublishedLog(log, spec())!;
    expect(out).toHaveLength(2);
    expect(JSON.stringify(out)).not.toContain('Doel');
    expect(JSON.stringify(out)).not.toContain('Storm');
    const [goal, era] = out;
    expect(goal.kind === 'addGoalLine' && goal.goalLine.label).toBe(PUBLISHED_LABEL_PLACEHOLDER);
    expect(era.kind === 'addEraShading' && era.era.label).toBe(PUBLISHED_LABEL_PLACEHOLDER);
    // Still valid commands: they survive a replay against the chart.
    const replayed = replayLog(initialDocState('line'), out, { spec: spec(), alternatesCount: 0 });
    expect(replayed.dropped).toBe(0);
    expect(replayed.state.eraShadings).toHaveLength(1);
  });

  it('keeps a title and caption that pass the numbers rule and blanks those that do not', () => {
    const ok = prunePublishedLog(
      [
        { ...env, id: 'a', kind: 'setTitle', title: 'Nederland groeit door in 2024' },
        { ...env, id: 'b', kind: 'setCaption', caption: 'Stand op 1 januari' },
      ],
      spec(),
    )!;
    expect(ok).toMatchObject([{ title: 'Nederland groeit door in 2024' }, { caption: 'Stand op 1 januari' }]);

    const bad = prunePublishedLog(
      [
        { ...env, id: 'a', kind: 'setTitle', title: 'Bijna 18 miljoen' },
        { ...env, id: 'b', kind: 'setCaption', caption: 'Plus 131.651 in een jaar' },
      ],
      spec(),
    )!;
    expect(bad).toMatchObject([{ kind: 'setTitle', title: null }, { kind: 'setCaption', caption: null }]);
  });

  it('strips a stored per-chart language so the embed URL decides', () => {
    const out = prunePublishedLog(
      [{ ...env, id: 'a', kind: 'setPresentation', patch: { language: 'nl', grid: 'none' } }],
      spec(),
    )!;
    expect(out[0]).toMatchObject({ kind: 'setPresentation', patch: { grid: 'none' } });
    expect(out[0].kind === 'setPresentation' && 'language' in out[0].patch).toBe(false);
  });
});

describe('publishedStyle', () => {
  it('sanitises and drops the language', () => {
    expect(publishedStyle({ grid: 'none', language: 'en', bogus: 1 })).toEqual({ grid: 'none' });
    expect(publishedStyle({ language: 'en' })).toBeNull();
    expect(publishedStyle(null)).toBeNull();
  });
});

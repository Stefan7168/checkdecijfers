import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  CHART_COMMAND_KINDS,
  initialDocState,
  invertCommand,
  makeCommand,
  parseCommandLog,
  validateCommand,
  type ChartCommandParams,
  type ChartDocState,
} from './chart-commands.ts';
import type { ChartPoint, ChartSeries, ChartSpec } from '../backend/chart/types.ts';

function point(periodCode: string, value: number): ChartPoint {
  return { resultId: `r-${periodCode}`, periodCode, periodLabel: periodCode, value, formattedValue: String(value), provisional: false, note: null } as unknown as ChartPoint;
}
function series(label: string, codes: string[]): ChartSeries {
  return { label, regionCode: null, points: codes.map((c, i) => point(c, i + 1)) };
}
function spec(): ChartSpec {
  return {
    kind: 'line',
    title: 'Werkloosheid',
    unit: '%',
    dimLabels: {},
    series: [series('Nederland', ['2020', '2021', '2022']), series('Utrecht', ['2020', '2021', '2022'])],
    attribution: { tableId: '80590ned', tableTitle: 't', retrievedAt: '2026-01-01', period: '2020-2022' },
    provisionalNote: null,
    nullNotes: [],
    definitionLine: null,
  } as unknown as ChartSpec;
}
// If ChartPoint/ChartSeries/ChartSpec have other required fields, copy the
// exact helper shapes from web/lib/chart-view-state.test.ts instead of guessing.

const ctx = { spec: spec(), alternatesCount: 1 };

/** Deterministic PRNG so a failing run can be replayed by seed. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}
function pick<T>(r: () => number, xs: readonly T[]): T {
  return xs[Math.floor(r() * xs.length)]!;
}
function randomCommand(r: () => number, state: ChartDocState, n: number): ChartCommandParams {
  const kind = pick(r, CHART_COMMAND_KINDS);
  switch (kind) {
    case 'setForm': return { kind, form: pick(r, ['line', 'bar', 'table'] as const) };
    case 'toggleSeries': return { kind, key: pick(r, ['s0', 's1']) };
    case 'setHighlight': return { kind, key: pick(r, ['s0', 's1', null]) };
    case 'setSeriesView': return { kind, hiddenKeys: r() < 0.5 ? ['s0'] : [], highlightedKey: pick(r, ['s0', 's1', null]) };
    case 'setPeriodRange': return { kind, range: r() < 0.3 ? null : ['2020', pick(r, ['2021', '2022'])] };
    case 'setPresentation': return { kind, patch: r() < 0.5 ? { lineWidth: pick(r, ['thin', 'thick'] as const) } : { seriesColors: { 0: '#112233' } } };
    case 'replacePresentation': return { kind, overrides: { grid: 'none' } };
    case 'resetPresentation': return { kind };
    case 'applyTemplate': return { kind, templateId: pick(r, ['classic', 'newsroom'] as const) };
    case 'setReading': return { kind, index: pick(r, [null, 0]) };
    case 'addNote': return { kind, note: { id: `n${n}`, resultId: 'r-2021', periodLabel: '2021', seriesLabel: 'Nederland', text: `noot ${n}` } };
    case 'removeNote': return state.notes.length > 0 ? { kind, noteId: pick(r, state.notes).id } : { kind: 'setCaption', caption: null };
    case 'setTitle': return { kind, title: r() < 0.3 ? null : `titel ${n}` };
    case 'setCaption': return { kind, caption: r() < 0.3 ? null : `bijschrift ${n}` };
  }
}
/** Sets are compared as sorted arrays so deep equality is meaningful. */
function plain(s: ChartDocState): unknown {
  return { ...s, hiddenKeys: [...s.hiddenKeys].sort() };
}

describe('applyCommand / invertCommand', () => {
  it('property: for 200 random command lists, applying inverses in reverse restores the original state', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const r = rng(seed);
      const start = initialDocState('line', {});
      let state = start;
      const inverses: ChartCommandParams[] = [];
      const len = 1 + Math.floor(r() * 12);
      for (let i = 0; i < len; i++) {
        const cmd = randomCommand(r, state, i);
        expect(validateCommand(cmd, ctx), `seed ${seed} step ${i} ${JSON.stringify(cmd)}`).toBe(true);
        inverses.push(invertCommand(state, cmd));
        state = applyCommand(state, cmd);
      }
      for (const inv of inverses.reverse()) state = applyCommand(state, inv);
      expect(plain(state), `seed ${seed}`).toEqual(plain(start));
    }
  });

  it('undoing a note removal puts the note back at its original position', () => {
    let s = initialDocState('line');
    const a = { id: 'a', resultId: 'r-2020', periodLabel: '2020', seriesLabel: 'Nederland', text: 'a' };
    const b = { id: 'b', resultId: 'r-2021', periodLabel: '2021', seriesLabel: 'Nederland', text: 'b' };
    s = applyCommand(s, { kind: 'addNote', note: a });
    s = applyCommand(s, { kind: 'addNote', note: b });
    const remove: ChartCommandParams = { kind: 'removeNote', noteId: 'a' };
    const inv = invertCommand(s, remove);
    s = applyCommand(applyCommand(s, remove), inv);
    expect(s.notes.map((n) => n.id)).toEqual(['a', 'b']);
  });

  it('toggleSeries hiding the highlighted series clears the highlight (the reducer coupling survives)', () => {
    let s = initialDocState('line');
    s = applyCommand(s, { kind: 'setHighlight', key: 's1' });
    s = applyCommand(s, { kind: 'toggleSeries', key: 's1' });
    expect(s.highlightedKey).toBeNull();
    expect([...s.hiddenKeys]).toEqual(['s1']);
  });

  it('applyTemplate replaces the presentation with the template overrides', () => {
    let s = initialDocState('line', { lineWidth: 'thick' });
    s = applyCommand(s, { kind: 'applyTemplate', templateId: 'classic' });
    expect(s.presentation.lineWidth).toBe('normal');
  });
});

describe('validateCommand', () => {
  it('rejects a series key, period code, reading index or form the chart does not have', () => {
    expect(validateCommand({ kind: 'toggleSeries', key: 's9' }, ctx)).toBe(false);
    expect(validateCommand({ kind: 'setHighlight', key: 's9' }, ctx)).toBe(false);
    expect(validateCommand({ kind: 'setPeriodRange', range: ['2019', '2021'] }, ctx)).toBe(false);
    expect(validateCommand({ kind: 'setPeriodRange', range: ['2022', '2020'] }, ctx)).toBe(false);
    expect(validateCommand({ kind: 'setReading', index: 1 }, ctx)).toBe(false);
    expect(validateCommand({ kind: 'setForm', form: 'hbar' }, ctx)).toBe(false); // line-kind spec: no hbar
    expect(validateCommand({ kind: 'setForm', form: 'area' }, ctx)).toBe(false); // two series: no area
    expect(validateCommand({ kind: 'addNote', note: { id: 'x', resultId: 'nope', periodLabel: '', seriesLabel: '', text: 't' } }, ctx)).toBe(false);
    expect(validateCommand({ kind: 'setTitle', title: 'x'.repeat(121) }, ctx)).toBe(false);
    expect(validateCommand({ kind: 'setCaption', caption: 'x'.repeat(281) }, ctx)).toBe(false);
    expect(validateCommand({ kind: 'setPresentation', patch: { lineWidth: 'huge' as never } }, ctx)).toBe(false);
    expect(validateCommand({ kind: 'applyTemplate', templateId: 'nope' as never }, ctx)).toBe(false);
  });
  it('accepts a line-kind two-series spec switching to bar or table', () => {
    expect(validateCommand({ kind: 'setForm', form: 'bar' }, ctx)).toBe(true);
    expect(validateCommand({ kind: 'setForm', form: 'table' }, ctx)).toBe(true);
  });
});

describe('parseCommandLog', () => {
  it('round-trips a serialised log and rejects garbage', () => {
    const log = [makeCommand({ kind: 'setForm', form: 'bar' }, 'panel'), makeCommand({ kind: 'setTitle', title: 'Kop' }, 'canvas')];
    const parsed = parseCommandLog(JSON.parse(JSON.stringify(log)));
    expect(parsed).toEqual(log);
    expect(parseCommandLog(null)).toBeNull();
    expect(parseCommandLog([{ kind: 'setForm' }])).toBeNull();
    expect(parseCommandLog([{ ...log[0], kind: 'launchMissiles' }])).toBeNull();
    expect(parseCommandLog([{ ...log[0], source: 'robot' }])).toBeNull();
  });
  it('a command carries only keys, codes, enum values and typed text — never a data value', () => {
    const log = [makeCommand({ kind: 'toggleSeries', key: 's0' }, 'canvas')];
    expect(JSON.stringify(log)).not.toMatch(/"value"|formattedValue/);
  });
});

import { describe, expect, it } from 'vitest';
import {
  applyCommand,
  CHART_COMMAND_KINDS,
  CHART_INSTRUCTION_SUMMARY_MAX_LENGTH,
  initialDocState,
  invertCommand,
  makeCommand,
  parseCommandLog,
  validateCommand,
  type ChartCommandParams,
  type ChartDocState,
} from './chart-commands.ts';
import type { ChartPoint, ChartSeries, ChartSpec } from '../backend/chart/types.ts';
import { buildDatasetProfile } from '../backend/attachments/ingest/profile.ts';
import type { ClientChartInstruction } from '../backend/attachments/types.ts';

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

// Co-pilot phase 2 (session 113), Task 4. The own-data card's context carries
// a DatasetProfile; the CBS card's (`ctx` above) never does — which is the
// whole point of the setInstruction type guard below (ADR 037 D11).
const profile = buildDatasetProfile([
  ['jaar', 'omzet'],
  ['2020', '10'],
  ['2021', '12'],
]);
const dataCtx = { ...ctx, profile };
function instruction(overrides: Partial<ClientChartInstruction> = {}): ClientChartInstruction {
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
/** `allowInstruction` is false for the inverse-round-trip property below: a
 * setInstruction inverse deliberately restores only the previous INSTRUCTION,
 * never the hidden/highlight/zoom view it reset (see chart-commands.ts —
 * those keys belong to the old data), so it is not a state-restoring
 * inverse and has its own targeted tests instead. */
function randomCommand(r: () => number, state: ChartDocState, n: number, allowInstruction = false): ChartCommandParams {
  const kind = pick(r, CHART_COMMAND_KINDS);
  switch (kind) {
    case 'setInstruction':
      return allowInstruction
        ? { kind, instruction: instruction({ kind: r() < 0.5 ? 'bar' : 'line', x: 'c0' }), summary: `staaf per jaar ${'x'.repeat(n)}` }
        : { kind: 'setCaption', caption: null };
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

  it('undoing a no-op addNote (duplicate id) is itself a no-op — it must not delete the pre-existing note', () => {
    let s = initialDocState('line');
    const a = { id: 'a', resultId: 'r-2020', periodLabel: '2020', seriesLabel: 'Nederland', text: 'a' };
    s = applyCommand(s, { kind: 'addNote', note: a });
    const afterFirst = s;
    // Second addNote with the same id is a no-op (applyCommand dedupes on note.id).
    s = applyCommand(s, { kind: 'addNote', note: a });
    expect(s).toEqual(afterFirst);
    const inv = invertCommand(s, { kind: 'addNote', note: a });
    s = applyCommand(s, inv);
    expect(s.notes.map((n) => n.id)).toEqual(['a']);
    expect(plain(s)).toEqual(plain(afterFirst));
  });

  it('applyTemplate replaces the presentation with the template overrides', () => {
    let s = initialDocState('line', { lineWidth: 'thick' });
    s = applyCommand(s, { kind: 'applyTemplate', templateId: 'classic' });
    expect(s.presentation.lineWidth).toBe('normal');
  });
});

// Co-pilot phase 2 (session 113), Task 4: the own-data card's one data
// command. It carries the reader's INSTRUCTION (column ids, enum values), a
// digit-free summary for the history menu — and never a data value.
describe('setInstruction', () => {
  it('is part of the command vocabulary', () => {
    expect(CHART_COMMAND_KINDS).toContain('setInstruction');
  });

  it('validates only when the context carries a dataset profile (ADR 037 D11)', () => {
    const cmd: ChartCommandParams = { kind: 'setInstruction', instruction: instruction(), summary: 'omzet per jaar' };
    expect(validateCommand(cmd, ctx)).toBe(false);
    expect(validateCommand(cmd, dataCtx)).toBe(true);
  });

  it('rejects an instruction whose columns are not in the profile', () => {
    expect(
      validateCommand({ kind: 'setInstruction', instruction: instruction({ x: 'c9' }), summary: 'onbekend' }, dataCtx),
    ).toBe(false);
    expect(
      validateCommand({ kind: 'setInstruction', instruction: instruction({ y: ['c0', 'nope'] }), summary: 'onbekend' }, dataCtx),
    ).toBe(false);
  });

  it('rejects a summary that is empty, too long, or carries a digit', () => {
    const bad = (summary: string) => validateCommand({ kind: 'setInstruction', instruction: instruction(), summary }, dataCtx);
    expect(bad('')).toBe(false);
    expect(bad('   ')).toBe(false);
    expect(bad('x'.repeat(CHART_INSTRUCTION_SUMMARY_MAX_LENGTH + 1))).toBe(false);
    expect(bad('omzet per jaar, top 5')).toBe(false);
    expect(bad('x'.repeat(CHART_INSTRUCTION_SUMMARY_MAX_LENGTH))).toBe(true);
  });

  it('apply resets the hidden set, the highlight and the zoom window but keeps the notes', () => {
    let s = initialDocState('line');
    const note = { id: 'a', resultId: 'r-2020', periodLabel: '2020', seriesLabel: 'Nederland', text: 'a' };
    s = applyCommand(s, { kind: 'addNote', note });
    s = applyCommand(s, { kind: 'setSeriesView', hiddenKeys: ['s0'], highlightedKey: 's1' });
    s = applyCommand(s, { kind: 'setPeriodRange', range: ['2020', '2021'] });
    const next = applyCommand(s, { kind: 'setInstruction', instruction: instruction(), summary: 'omzet per jaar' });
    expect([...next.hiddenKeys]).toEqual([]);
    expect(next.highlightedKey).toBeNull();
    expect(next.periodRange).toBeNull();
    expect(next.notes.map((n) => n.id)).toEqual(['a']);
    expect(next.instruction).toEqual(instruction());
  });

  it('invert restores the previous instruction, and is a no-op when there was none', () => {
    const first = instruction({ kind: 'bar' });
    const second = instruction({ kind: 'line', x: 'c0' });
    let s = initialDocState('line');
    expect(s.instruction).toBeNull();
    // Nothing to go back to: the inverse re-sets the unchanged title (the
    // no-op idiom addNote already uses).
    expect(invertCommand(s, { kind: 'setInstruction', instruction: first, summary: 'eerste' })).toEqual({
      kind: 'setTitle',
      title: null,
    });
    s = applyCommand(s, { kind: 'setInstruction', instruction: first, summary: 'eerste' });
    const inv = invertCommand(s, { kind: 'setInstruction', instruction: second, summary: 'tweede' });
    s = applyCommand(applyCommand(s, { kind: 'setInstruction', instruction: second, summary: 'tweede' }), inv);
    expect(s.instruction).toEqual(first);
  });

  it('parseCommandLog accepts it and rejects an over-long summary', () => {
    const ok = makeCommand({ kind: 'setInstruction', instruction: instruction(), summary: 'omzet per jaar' }, 'chat');
    expect(parseCommandLog(JSON.parse(JSON.stringify([ok])))).toEqual([ok]);
    const tooLong = makeCommand(
      { kind: 'setInstruction', instruction: instruction(), summary: 'x'.repeat(CHART_INSTRUCTION_SUMMARY_MAX_LENGTH + 1) },
      'chat',
    );
    expect(parseCommandLog(JSON.parse(JSON.stringify([tooLong])))).toBeNull();
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
  // Final-review finding M9: the old version of this test proved the point
  // for ONE hand-written command. It now runs over every command list the
  // 200-seed property generator above produces — the same corpus that proves
  // undo, so a new kind that leaked a data value would fail here too.
  it('a command carries only keys, codes, enum values and typed text — never a data value', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const r = rng(seed);
      let state = initialDocState('line', {});
      const commands: ChartCommandParams[] = [];
      const len = 1 + Math.floor(r() * 12);
      for (let i = 0; i < len; i++) {
        const cmd = randomCommand(r, state, i, true);
        commands.push(cmd);
        state = applyCommand(state, cmd);
      }
      const log = commands.map((c) => makeCommand(c, 'canvas'));
      expect(JSON.stringify(log), `seed ${seed}`).not.toMatch(/"value"|formattedValue/);
    }
  });
});

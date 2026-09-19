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
  type CommandContext,
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
    // Only the forms the shared `ctx` spec (2 series × 3 periods, line kind)
    // honestly offers — the property asserts `validateCommand` on every draw.
    // Phase 5 (chart-fit scorer, Task 5): heatmap joins (≥2 series, ≥2
    // shared periods, all values real); dumbbell/slope need EXACTLY two
    // periods, which this ctx does not have — see the targeted two-point
    // round-trip further down. Not `allowedForms(...)`: a literal fails
    // loudly if a guard change ever stops offering one of these here.
    case 'setForm': return { kind, form: pick(r, ['line', 'bar', 'table', 'heatmap'] as const) };
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
    // Phase 4 commands (Task 8, session 115): real round-trippable values,
    // mirroring the addNote/removeNote pattern above — a remove kind picks
    // an existing entry from `state` when one exists, else falls back to a
    // harmless no-op (setCaption null) the same way removeNote does.
    case 'addGoalLine': return { kind, goalLine: { id: `g${n}`, value: n, label: `doel ${n}` } };
    case 'removeGoalLine': return state.goalLines.length > 0 ? { kind, goalLineId: pick(r, state.goalLines).id } : { kind: 'setCaption', caption: null };
    case 'addEraShading': return { kind, era: { id: `e${n}`, fromPeriodCode: '2020', toPeriodCode: pick(r, ['2021', '2022']), label: `era ${n}` } };
    case 'removeEraShading': return state.eraShadings.length > 0 ? { kind, eraShadingId: pick(r, state.eraShadings).id } : { kind: 'setCaption', caption: null };
    case 'setDimmed': return { kind, hiddenKeys: [], dimmedKeys: r() < 0.5 ? ['s0'] : [] };
    case 'setHeadlineOverride': return { kind, resultId: pick(r, ['r-2020', 'r-2021', null]) };
    case 'addDerivedOverlay': return { kind, overlay: { id: `d${n}`, calcKind: pick(r, ['difference', 'mean'] as const), resultIds: ['r-2020', 'r-2021'] } };
    case 'removeDerivedOverlay': return state.derivedOverlayRequests.length > 0 ? { kind, overlayId: pick(r, state.derivedOverlayRequests).id } : { kind: 'setCaption', caption: null };
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

  // Phase 5 (chart-fit scorer, Task 5): dumbbell and slope need EXACTLY two
  // periods per series (`dumbbellFormAllowed`), which the shared 3-period
  // `ctx` above never has — so the property cannot draw them without failing
  // its own validateCommand check. The same apply-then-invert round-trip,
  // on a context that qualifies (2 series × 2 periods), plus the negative:
  // the shared ctx refuses both, and the qualifying one still offers heatmap.
  it('dumbbell and slope validate on a two-point context, and apply+invert restores the previous form', () => {
    const twoPoint: CommandContext = {
      spec: { ...spec(), series: [series('Nederland', ['2020', '2021']), series('Utrecht', ['2020', '2021'])] },
      alternatesCount: 0,
    };
    for (const form of ['dumbbell', 'slope', 'heatmap'] as const) {
      expect(validateCommand({ kind: 'setForm', form }, twoPoint), form).toBe(true);
      const start = initialDocState('line', {});
      const cmd = { kind: 'setForm', form } as const;
      const inverse = invertCommand(start, cmd);
      const after = applyCommand(start, cmd);
      expect(after.form).toBe(form);
      expect(plain(applyCommand(after, inverse)), form).toEqual(plain(start));
    }
    // Three periods: exactly-two forms are refused, heatmap is not.
    expect(validateCommand({ kind: 'setForm', form: 'dumbbell' }, ctx)).toBe(false);
    expect(validateCommand({ kind: 'setForm', form: 'slope' }, ctx)).toBe(false);
    expect(validateCommand({ kind: 'setForm', form: 'heatmap' }, ctx)).toBe(true);
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

describe('new command kinds (phase 4)', () => {
  const ctx: CommandContext = { spec: { kind: 'line', series: [{ points: [{ resultId: 'r1', periodCode: '2020', value: 1 }, { resultId: 'r2', periodCode: '2021', value: 2 }] }] as any }, alternatesCount: 0 };

  it('addGoalLine/removeGoalLine round-trip through apply+invert', () => {
    let state = initialDocState('line');
    const goalLine = { id: 'g1', value: 100, label: 'Doel' };
    const stateBefore = state;
    state = applyCommand(state, { kind: 'addGoalLine', goalLine });
    expect(state.goalLines).toEqual([goalLine]);
    const inverse = invertCommand(stateBefore, { kind: 'addGoalLine', goalLine });
    state = applyCommand(state, inverse);
    expect(state.goalLines).toEqual([]);
  });

  it('validateCommand refuses an era shading whose range is not on the chart', () => {
    const era = { id: 'e1', fromPeriodCode: '1999', toPeriodCode: '2000', label: 'x' };
    expect(validateCommand({ kind: 'addEraShading', era }, ctx)).toBe(false);
  });

  it('validateCommand accepts an era shading whose range is on the chart', () => {
    const era = { id: 'e1', fromPeriodCode: '2020', toPeriodCode: '2021', label: 'x' };
    expect(validateCommand({ kind: 'addEraShading', era }, ctx)).toBe(true);
  });

  it('validateCommand refuses setHeadlineOverride pointing at an unknown resultId', () => {
    expect(validateCommand({ kind: 'setHeadlineOverride', resultId: 'nope' }, ctx)).toBe(false);
    expect(validateCommand({ kind: 'setHeadlineOverride', resultId: 'r1' }, ctx)).toBe(true);
    expect(validateCommand({ kind: 'setHeadlineOverride', resultId: null }, ctx)).toBe(true);
  });

  it('addDerivedOverlay/removeDerivedOverlay round-trip; validateCommand checks resultIds are on the chart', () => {
    const overlay = { id: 'd1', calcKind: 'difference' as const, resultIds: ['r1', 'r2'] };
    expect(validateCommand({ kind: 'addDerivedOverlay', overlay }, ctx)).toBe(true);
    expect(validateCommand({ kind: 'addDerivedOverlay', overlay: { ...overlay, resultIds: ['r1', 'nope'] } }, ctx)).toBe(false);
    let state = initialDocState('line');
    state = applyCommand(state, { kind: 'addDerivedOverlay', overlay });
    expect(state.derivedOverlayRequests).toEqual([overlay]);
  });

  it('parseCommandLog accepts a log containing every new kind', () => {
    const raw = [
      { kind: 'addGoalLine', goalLine: { id: 'g1', value: 1, label: 'x' }, id: 'c1', at: new Date().toISOString(), source: 'panel' },
      { kind: 'setDimmed', hiddenKeys: [], dimmedKeys: ['s0'], id: 'c2', at: new Date().toISOString(), source: 'panel' },
    ];
    expect(parseCommandLog(raw)).not.toBeNull();
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
      // GoalLine.value is a reader-TYPED number, explicitly allowed by the
      // phase-4 spec's Global Constraints ("reader-typed values... are fine
      // as command payloads — they are the reader's own words, not a data
      // claim") — unlike a ChartPoint's data `value`/`formattedValue`, which
      // this scan exists to catch. Stripped before the blunt scan below so
      // the one approved exception doesn't mask a real future leak.
      const scanTarget = JSON.stringify(log).replace(/"goalLine":\{[^}]*\}/g, '"goalLine":{}');
      expect(scanTarget, `seed ${seed}`).not.toMatch(/"value"|formattedValue/);
    }
  });
});

import { describe, expect, it } from 'vitest';
import { initialDocState, makeCommand, type CommandContext } from './chart-commands.ts';
import { emptyHistory, HISTORY_CAP, pushCommand, redo, replayLog, seal, serializeHistory, undo } from './chart-history.ts';

const ctx: CommandContext = {
  spec: { kind: 'line' as const, series: [{ label: 'a', regionCode: null, points: [{ resultId: 'r1', periodCode: '2020', periodLabel: '2020', value: 1, formattedValue: '1', provisional: false, note: null }] }] },
  alternatesCount: 0,
} as unknown as CommandContext;
// (Mirror the exact point/series shapes from chart-commands.test.ts if the type has more fields.)

describe('chart history', () => {
  it('push, undo, redo, and a new push after undo drops the redo stack', () => {
    let s = initialDocState('line');
    let h = emptyHistory();
    ({ history: h, state: s } = pushCommand(h, s, makeCommand({ kind: 'setForm', form: 'bar' }, 'panel')));
    ({ history: h, state: s } = pushCommand(h, s, makeCommand({ kind: 'setTitle', title: 'Kop' }, 'canvas')));
    expect(h.past).toHaveLength(2);
    const u = undo(h, s)!;
    expect(u.state.title).toBeNull();
    expect(u.history.future).toHaveLength(1);
    const r = redo(u.history, u.state)!;
    expect(r.state.title).toBe('Kop');
    const u2 = undo(r.history, r.state)!;
    const p = pushCommand(u2.history, u2.state, makeCommand({ kind: 'setCaption', caption: 'x' }, 'canvas'));
    expect(p.history.future).toHaveLength(0);
    expect(p.history.past.map((e) => e.command.kind)).toEqual(['setForm', 'setCaption']);
  });

  it('undo on an empty past and redo on an empty future return null', () => {
    const s = initialDocState('line');
    expect(undo(emptyHistory(), s)).toBeNull();
    expect(redo(emptyHistory(), s)).toBeNull();
  });

  it('transient pushes of the same target merge into ONE entry that undoes to the pre-drag state', () => {
    let s = initialDocState('line');
    let h = emptyHistory();
    for (const hex of ['#111111', '#222222', '#333333']) {
      ({ history: h, state: s } = pushCommand(h, s, makeCommand({ kind: 'setPresentation', patch: { seriesColors: { 0: hex } } }, 'panel'), { transient: true }));
    }
    expect(h.past).toHaveLength(1);
    expect(s.presentation.seriesColors).toEqual({ 0: '#333333' });
    h = seal(h);
    expect(h.past[0]!.transient).toBe(false);
    const u = undo(h, s)!;
    expect(u.state.presentation.seriesColors).toBeUndefined();
    // A transient push on a DIFFERENT target starts a new entry.
    let s2 = s;
    let h2 = h;
    ({ history: h2, state: s2 } = pushCommand(h2, s2, makeCommand({ kind: 'setPresentation', patch: { seriesColors: { 1: '#444444' } } }, 'panel'), { transient: true }));
    expect(h2.past).toHaveLength(2);
  });

  it('a non-transient push seals whatever was transient before it', () => {
    let s = initialDocState('line');
    let h = emptyHistory();
    ({ history: h, state: s } = pushCommand(h, s, makeCommand({ kind: 'setPresentation', patch: { seriesColors: { 0: '#111111' } } }, 'panel'), { transient: true }));
    ({ history: h, state: s } = pushCommand(h, s, makeCommand({ kind: 'setForm', form: 'bar' }, 'panel')));
    expect(h.past.map((e) => e.transient)).toEqual([false, false]);
  });

  it('caps the past at HISTORY_CAP, dropping the oldest', () => {
    let s = initialDocState('line');
    let h = emptyHistory();
    for (let i = 0; i < HISTORY_CAP + 5; i++) {
      ({ history: h, state: s } = pushCommand(h, s, makeCommand({ kind: 'setTitle', title: `t${i}` }, 'canvas')));
    }
    expect(h.past).toHaveLength(HISTORY_CAP);
    expect(h.past[0]!.command).toMatchObject({ kind: 'setTitle', title: 't5' });
  });

  it('serializeHistory returns the sealed past commands oldest-first and replayLog rebuilds the same state, dropping invalid ones', () => {
    let s = initialDocState('line');
    let h = emptyHistory();
    ({ history: h, state: s } = pushCommand(h, s, makeCommand({ kind: 'setForm', form: 'bar' }, 'panel')));
    ({ history: h, state: s } = pushCommand(h, s, makeCommand({ kind: 'setTitle', title: 'Kop' }, 'canvas')));
    const log = serializeHistory(h);
    expect(log.map((c) => c.kind)).toEqual(['setForm', 'setTitle']);
    const bad = makeCommand({ kind: 'toggleSeries', key: 's7' }, 'panel');
    const r = replayLog(initialDocState('line'), [...log, bad], ctx);
    expect(r.dropped).toBe(1);
    expect(r.state.form).toBe('bar');
    expect(r.state.title).toBe('Kop');
    expect(r.history.past).toHaveLength(2);
    // Undo works across a reopen: the replayed entries carry real inverses.
    expect(undo(r.history, r.state)!.state.title).toBeNull();
  });

  it('a transient top entry is NOT serialised until sealed', () => {
    let s = initialDocState('line');
    let h = emptyHistory();
    ({ history: h, state: s } = pushCommand(h, s, makeCommand({ kind: 'setPresentation', patch: { seriesColors: { 0: '#111111' } } }, 'panel'), { transient: true }));
    expect(serializeHistory(h)).toHaveLength(0);
    expect(serializeHistory(seal(h))).toHaveLength(1);
  });
});

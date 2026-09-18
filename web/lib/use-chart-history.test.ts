import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { initialDocState } from './chart-commands.ts';
import { useChartHistory } from './use-chart-history.ts';

describe('useChartHistory', () => {
  it('dispatch records an entry; undo/redo move through it; canUndo/canRedo follow', () => {
    const { result } = renderHook(() => useChartHistory(initialDocState('line')));
    expect(result.current.canUndo).toBe(false);
    act(() => result.current.dispatch({ kind: 'setForm', form: 'bar' }, 'panel'));
    expect(result.current.state.form).toBe('bar');
    expect(result.current.canUndo).toBe(true);
    expect(result.current.history.past[0]!.command.source).toBe('panel');
    act(() => result.current.undo());
    expect(result.current.state.form).toBe('line');
    expect(result.current.canRedo).toBe(true);
    act(() => result.current.redo());
    expect(result.current.state.form).toBe('bar');
  });

  it('dispatchRaw applies a view action WITHOUT a history entry, and reset clears notes, title, caption and the history', () => {
    const { result } = renderHook(() => useChartHistory(initialDocState('line')));
    act(() => result.current.dispatch({ kind: 'setTitle', title: 'Kop' }, 'canvas'));
    act(() => result.current.dispatchRaw({ type: 'setView', view: { hiddenKeys: new Set(['s1']), highlightedKey: null, periodRange: null } }));
    expect([...result.current.state.hiddenKeys]).toEqual(['s1']);
    expect(result.current.history.past).toHaveLength(1);
    act(() => result.current.dispatchRaw({ type: 'reset', initialForm: 'bar' }));
    expect(result.current.state).toMatchObject({ form: 'bar', title: null, caption: null, notes: [] });
    expect(result.current.history.past).toHaveLength(0);
    expect(result.current.canUndo).toBe(false);
  });

  it('every command in one render gets a distinct id and ISO timestamp', () => {
    const { result } = renderHook(() => useChartHistory(initialDocState('line')));
    act(() => {
      result.current.dispatch({ kind: 'setTitle', title: 'a' }, 'canvas');
      result.current.dispatch({ kind: 'setTitle', title: 'b' }, 'canvas');
    });
    const [x, y] = result.current.history.past.map((e) => e.command);
    expect(x!.id).not.toBe(y!.id);
    expect(() => new Date(x!.at).toISOString()).not.toThrow();
  });

  it('replace swaps in a hydrated state + history', () => {
    const { result } = renderHook(() => useChartHistory(initialDocState('line')));
    act(() => result.current.replace({ state: { ...initialDocState('bar'), title: 'Hersteld' }, history: { past: [], future: [] } }));
    expect(result.current.state.title).toBe('Hersteld');
  });
});

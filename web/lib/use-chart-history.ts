'use client';
// Chart co-pilot phase 1 (session 112): the one reducer chart.tsx drives.
// Commands go through the history; `dispatchRaw` is for the app moving the
// view itself (story steps, stage, the spec-swap reset, the embed page's
// `?form=` seed) — those are never a reader's edit and never undoable.
import { useCallback, useMemo, useReducer } from 'react';
import { chartViewReducer, type ChartViewAction } from './chart-view-state.ts';
import { initialDocState, makeCommand, type ChartCommandParams, type ChartCommandSource, type ChartDocState, type ChartCommand } from './chart-commands.ts';
import { emptyHistory, pushCommand, redo as redoPure, seal as sealPure, undo as undoPure, type ChartHistory } from './chart-history.ts';

interface Snapshot {
  state: ChartDocState;
  history: ChartHistory;
}
type Action =
  | { type: 'command'; command: ChartCommand; transient: boolean }
  | { type: 'raw'; action: ChartViewAction }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'seal' }
  | { type: 'replace'; next: Snapshot };

function reducer(snap: Snapshot, action: Action): Snapshot {
  switch (action.type) {
    case 'command':
      return pushCommand(snap.history, snap.state, action.command, { transient: action.transient });
    case 'raw': {
      if (action.action.type === 'reset') {
        return { state: initialDocState(action.action.initialForm, action.action.initialPresentation), history: emptyHistory() };
      }
      return { ...snap, state: { ...snap.state, ...chartViewReducer(snap.state, action.action) } };
    }
    case 'undo':
      return undoPure(snap.history, snap.state) ?? snap;
    case 'redo':
      return redoPure(snap.history, snap.state) ?? snap;
    case 'seal': {
      const history = sealPure(snap.history);
      return history === snap.history ? snap : { ...snap, history };
    }
    case 'replace':
      return action.next;
  }
}

export interface UseChartHistory {
  state: ChartDocState;
  history: ChartHistory;
  canUndo: boolean;
  canRedo: boolean;
  dispatch: (params: ChartCommandParams, source: ChartCommandSource, opts?: { transient?: boolean }) => void;
  dispatchRaw: (action: ChartViewAction) => void;
  undo: () => void;
  redo: () => void;
  seal: () => void;
  replace: (next: Snapshot) => void;
}

export function useChartHistory(initial: ChartDocState): UseChartHistory {
  const [snap, send] = useReducer(reducer, initial, (s: ChartDocState): Snapshot => ({ state: s, history: emptyHistory() }));
  // id/at are minted HERE (impure), never inside the reducer — React may
  // run a reducer twice in StrictMode and the two runs must agree.
  const dispatch = useCallback<UseChartHistory['dispatch']>((params, source, opts) => {
    send({ type: 'command', command: makeCommand(params, source), transient: opts?.transient === true });
  }, []);
  const dispatchRaw = useCallback((action: ChartViewAction) => send({ type: 'raw', action }), []);
  const undo = useCallback(() => send({ type: 'undo' }), []);
  const redo = useCallback(() => send({ type: 'redo' }), []);
  const seal = useCallback(() => send({ type: 'seal' }), []);
  const replace = useCallback((next: Snapshot) => send({ type: 'replace', next }), []);
  return useMemo(
    () => ({
      state: snap.state,
      history: snap.history,
      canUndo: snap.history.past.length > 0,
      canRedo: snap.history.future.length > 0,
      dispatch,
      dispatchRaw,
      undo,
      redo,
      seal,
      replace,
    }),
    [snap, dispatch, dispatchRaw, undo, redo, seal, replace],
  );
}

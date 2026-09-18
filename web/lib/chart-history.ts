// Chart co-pilot phase 1 (session 112, ADR 056): one undo/redo history per
// chart instance. One gesture = one entry; a `transient` push (a colour
// picker mid-drag) merges into the previous transient entry of the same
// target until sealed. Pure — the hook in use-chart-history.ts owns React.
import {
  applyCommand,
  invertCommand,
  validateCommand,
  type ChartCommand,
  type ChartCommandParams,
  type ChartDocState,
  type CommandContext,
} from './chart-commands.ts';

export interface HistoryEntry {
  command: ChartCommand;
  inverse: ChartCommandParams;
  transient: boolean;
}
export interface ChartHistory {
  past: HistoryEntry[];
  future: HistoryEntry[];
}
export const HISTORY_CAP = 200;

export function emptyHistory(): ChartHistory {
  return { past: [], future: [] };
}

/** What a transient command "targets": consecutive transient pushes with the
 * same target merge. A presentation patch targets its key set (and for
 * seriesColors the series index), so dragging series 0's colour and then
 * series 1's colour are two entries. */
function transientTarget(cmd: ChartCommandParams): string {
  if (cmd.kind === 'setPresentation') {
    const keys = Object.keys(cmd.patch).sort();
    const colourIdx = cmd.patch.seriesColors ? Object.keys(cmd.patch.seriesColors).sort().join(',') : '';
    return `${cmd.kind}:${keys.join(',')}:${colourIdx}`;
  }
  return cmd.kind;
}

export function pushCommand(
  h: ChartHistory,
  state: ChartDocState,
  command: ChartCommand,
  opts: { transient?: boolean } = {},
): { history: ChartHistory; state: ChartDocState } {
  const top = h.past[h.past.length - 1];
  const next = applyCommand(state, command);
  if (opts.transient && top && top.transient && transientTarget(top.command) === transientTarget(command)) {
    // Merge: keep the first inverse (pre-drag state) and the original id/at.
    const merged: HistoryEntry = { ...top, command: { ...command, id: top.command.id, at: top.command.at } };
    return { history: { past: [...h.past.slice(0, -1), merged], future: [] }, state: next };
  }
  const sealedPast = top && top.transient ? [...h.past.slice(0, -1), { ...top, transient: false }] : h.past;
  const entry: HistoryEntry = { command, inverse: invertCommand(state, command), transient: opts.transient === true };
  const past = [...sealedPast, entry];
  return { history: { past: past.length > HISTORY_CAP ? past.slice(past.length - HISTORY_CAP) : past, future: [] }, state: next };
}

export function seal(h: ChartHistory): ChartHistory {
  const top = h.past[h.past.length - 1];
  if (!top || !top.transient) return h;
  return { ...h, past: [...h.past.slice(0, -1), { ...top, transient: false }] };
}

export function undo(h: ChartHistory, state: ChartDocState): { history: ChartHistory; state: ChartDocState } | null {
  const sealed = seal(h);
  const top = sealed.past[sealed.past.length - 1];
  if (!top) return null;
  return {
    history: { past: sealed.past.slice(0, -1), future: [top, ...sealed.future] },
    state: applyCommand(state, top.inverse),
  };
}

export function redo(h: ChartHistory, state: ChartDocState): { history: ChartHistory; state: ChartDocState } | null {
  const [head, ...rest] = h.future;
  if (!head) return null;
  // Recompute the inverse against the CURRENT state so a redo after any
  // intervening raw view change still undoes to what the reader sees now.
  const entry: HistoryEntry = { ...head, inverse: invertCommand(state, head.command), transient: false };
  return { history: { past: [...h.past, entry], future: rest }, state: applyCommand(state, head.command) };
}

/** A replay context, or a function that derives one from the state a command
 * is about to be applied to. Co-pilot phase 2 (session 113, Task 5 review
 * finding): a stored log can contain `setInstruction`, and every command
 * AFTER it names series keys / rowRefs / a form belonging to THAT
 * instruction's spec — validating them against the one spec the card
 * happened to be showing dropped them all, and the next save then wrote the
 * loss to the row. So the caller may hand a function, which is asked once
 * per command with the state BEFORE that command. */
export type ReplayContext = CommandContext | ((state: ChartDocState) => CommandContext);

export function resolveReplayContext(ctx: ReplayContext, state: ChartDocState): CommandContext {
  return typeof ctx === 'function' ? ctx(state) : ctx;
}

export function replayLog(
  initial: ChartDocState,
  log: ChartCommand[],
  ctx: ReplayContext,
): { history: ChartHistory; state: ChartDocState; dropped: number } {
  let state = initial;
  let history = emptyHistory();
  let dropped = 0;
  for (const command of log) {
    if (!validateCommand(command, resolveReplayContext(ctx, state))) {
      dropped++;
      continue;
    }
    ({ history, state } = pushCommand(history, state, command));
  }
  return { history, state, dropped };
}

export function serializeHistory(h: ChartHistory): ChartCommand[] {
  return h.past.filter((e) => !e.transient).map((e) => e.command);
}

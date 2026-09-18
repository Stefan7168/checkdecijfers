'use client';
// Chart co-pilot (phase 1 session 112 Task 7, ADR 056, #274 — lifted out of
// web/components/chart.tsx in phase 2 session 113 Task 4): the reader's
// command log, saved per account against the chart's own row and replayed
// when they come back to it.
//
// Generalised over Task 3's ChartEditsKey, so the SAME hook serves the CBS
// card (keyed by an audit answer) and the own-data card (keyed by a dataset
// turn). Every rule below is a phase-1 review finding; the comments name
// which, because each one is a bug that was actually shipped and caught.
//
// ONE key decides whether this is live at all for a card, and every effect
// starts by checking it: `null` means "no row to key on" (signed out, embed
// mode, the story stage, a gallery/preview chart) and the hook then does
// nothing at all.
import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchChartEdits, saveChartEdits } from '../app/chart-edits-actions.ts';
import { parseCommandLog, validateCommand, type ChartDocState, type CommandContext } from './chart-commands.ts';
import { editsKeyToString, type ChartEditsKey } from './chart-edits-key.ts';
import { pushCommand, replayLog, seal, serializeHistory, type ChartHistory } from './chart-history.ts';

export const CHART_EDITS_SAVE_DEBOUNCE_MS = 800;

export interface UseChartEditsInput {
  editsKey: ChartEditsKey | null;
  history: ChartHistory;
  replaceHistory: (next: { state: ChartDocState; history: ChartHistory }) => void;
  /** Built by the caller from the CURRENT spec; read at hydrate time through
   * a ref, never a dependency — it is a fresh object on every render, and
   * listing it would re-fetch continuously. */
  ctx: CommandContext;
  initial: ChartDocState;
}

export function useChartEdits(input: UseChartEditsInput): void {
  const { editsKey, history, replaceHistory, ctx, initial } = input;
  /** The key's stable string identity — the object literal is fresh on every
   * render, so this is what the effects below depend on. */
  const keyId = editsKey === null ? null : editsKeyToString(editsKey);

  /** The last log we know the server has, as JSON. Starts at `'[]'` so an
   * untouched chart — whose serialised history is exactly `[]` — never
   * writes an empty row just for being looked at. */
  const lastSavedEditsRef = useRef('[]');
  /** Read by the hydrate effect's own async continuation, so "has the reader
   * started editing?" is answered at the moment the fetch RESOLVES rather
   * than at the moment it was fired — without putting `history` in that
   * effect's dependency list (which would re-fetch on every edit). */
  const historyRef = useRef(history);
  historyRef.current = history;
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;
  const initialRef = useRef(initial);
  initialRef.current = initial;
  const editsKeyRef = useRef(editsKey);
  editsKeyRef.current = editsKey;
  /** A save that is debounced but not yet sent, with the key it belongs to.
   * Carrying the key HERE (not in a closure) is what lets the flush below
   * write it to the right row even when the card has meanwhile been handed a
   * different chart. */
  const pendingSaveRef = useRef<{ key: ChartEditsKey; json: string } | null>(null);

  // Fix round 1, finding 1 (CRITICAL). The same mounted card is handed a
  // DIFFERENT chart by the visual dock and the Ontdek toggle (no `key` at
  // either call site — the card resets the history to empty for exactly that
  // reason). Without this reset, `lastSavedEditsRef` still held the PREVIOUS
  // chart's JSON, so the save effect compared the new chart's empty `[]`
  // against it, saw a difference, and armed a write of `[]` against the NEW
  // row — wiping that chart's stored log purely because the reader tabbed
  // onto it. React's own "adjusting state when a prop changes" shape:
  // compare against the last-seen key and fix up during render, so the reset
  // is already in place before the effects below run in the same commit.
  const lastEditsKeyRef = useRef(keyId);
  /** Final-review finding I2. False until this chart's hydrate fetch has
   * SETTLED (or there is nothing to fetch). While it is false no save may go
   * out: a write before the stored log has come back is a write that does not
   * know what it is replacing. Read synchronously by the save effect;
   * `hydrateSettled` below is the state that makes that effect re-run once it
   * flips, so an edit made DURING the fetch is still saved without waiting
   * for the reader's next click. */
  const hydrateSettledRef = useRef(false);
  const [hydrateSettled, setHydrateSettled] = useState(0);
  if (lastEditsKeyRef.current !== keyId) {
    lastEditsKeyRef.current = keyId;
    lastSavedEditsRef.current = '[]';
    hydrateSettledRef.current = false;
  }

  /** Fix round 1, finding 2. Sends whatever the debounce is still holding,
   * against the key it was queued for. Dependency-free (everything it needs
   * is in `pendingSaveRef`), so the unmount/key-change effect below can hold
   * it for the life of the card. */
  const flushPendingSave = useCallback(() => {
    const pending = pendingSaveRef.current;
    if (pending === null) return;
    pendingSaveRef.current = null;
    void saveChartEdits(pending.key, JSON.parse(pending.json) as unknown).then((result) => {
      // Final-review finding M1: by the time this resolves the card may have
      // been handed a DIFFERENT chart, whose own "last saved" marker was just
      // reset to `[]`. Writing the old chart's JSON into it would make the
      // save effect believe the new chart's row already holds that log.
      if (result.ok && lastEditsKeyRef.current === editsKeyToString(pending.key)) lastSavedEditsRef.current = pending.json;
    });
  }, []);

  // Hydrate. Final-review finding I2: the old version SKIPPED hydration
  // outright when the reader had already started editing
  // (`history.past.length > 0`) — which protected the click but destroyed the
  // stored log, because the save effect then wrote the reader's one command
  // over a row that held ten. The stored log is the base and the reader's own
  // commands are replayed ON TOP of it (validated like any other replayed
  // command, oldest first), so both survive and the next save carries both.
  useEffect(() => {
    const key = editsKeyRef.current;
    if (key === null) {
      hydrateSettledRef.current = true;
      return;
    }
    let cancelled = false;
    void fetchChartEdits(key).then((result) => {
      if (cancelled) return;
      const parsed = result.ok && result.log ? parseCommandLog(result.log) : null;
      if (parsed !== null && parsed.length > 0) {
        const ctxNow = ctxRef.current;
        const replayed = replayLog(initialRef.current, parsed, ctxNow);
        let history = replayed.history;
        let state = replayed.state;
        // Whatever the reader did while the fetch was in flight. Empty in the
        // ordinary case, so this is exactly the old plain-restore path.
        for (const entry of historyRef.current.past) {
          if (!validateCommand(entry.command, ctxNow)) continue;
          ({ history, state } = pushCommand(history, state, entry.command, { transient: entry.transient }));
        }
        replaceHistory({ state, history });
        // The STORED log's serialisation, deliberately — not the merged one.
        // What the server holds is the stored log, so recording that both
        // stops an immediate no-op write of an untouched chart AND leaves the
        // merged log looking "changed", so it is saved on the next tick.
        lastSavedEditsRef.current = JSON.stringify(serializeHistory(replayed.history));
      }
      // Settled: ok, empty, unparseable or refused — every path ends here,
      // because "we asked and got an answer" is what unblocks the save.
      hydrateSettledRef.current = true;
      setHydrateSettled((n) => n + 1);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `keyId` is the row this card belongs to, and every real chart swap that has a row at all also changes it; the spec/initial/ctx this effect needs are read through refs at RESOLVE time (they are fresh objects every render, so listing them would re-fetch continuously). `replaceHistory` is a stable useCallback from useChartHistory.
  }, [keyId]);

  // Save, debounced.
  //
  // Final-review finding I1: this used to serialise `history` as-is, and
  // `serializeHistory` DROPS a transient (unsealed) top entry — so a colour
  // drag that was the reader's last action was never saved at all (the only
  // seal the picker fires is its own blur, which the browser skips when the
  // modal unmounts). It serialises a SEALED VIEW instead: `seal` is pure and
  // does not touch the live history, so the entry can still merge with the
  // rest of the drag while the picker is open — only what gets WRITTEN
  // changes. (The panel closing also seals for real, at the card.)
  useEffect(() => {
    const key = editsKeyRef.current;
    if (key === null) return;
    // Finding I2: never write before the stored log has come back.
    if (!hydrateSettledRef.current) return;
    const json = JSON.stringify(serializeHistory(seal(history)));
    if (json === lastSavedEditsRef.current) {
      pendingSaveRef.current = null;
      return;
    }
    pendingSaveRef.current = { key, json };
    const timer = setTimeout(flushPendingSave, CHART_EDITS_SAVE_DEBOUNCE_MS);
    // Only the TIMER is cancelled here, never the queued save: this cleanup
    // runs on every single edit (the effect is keyed on `history`), so
    // flushing here would send one write per click and defeat the debounce.
    // The flush belongs to the effect below, which only tears down when the
    // card unmounts or changes chart.
    return () => clearTimeout(timer);
    // `hydrateSettled` is not read in the body (the REF is, synchronously) —
    // it is listed so this effect re-runs the moment hydration settles, which
    // is what saves an edit made while the fetch was still in flight.
  }, [history, keyId, flushPendingSave, hydrateSettled]);

  // Fix round 1, finding 2 (IMPORTANT): a reader who edits and immediately
  // closes the chat, switches chart, or navigates away used to lose the last
  // 800 ms of work — the cleanup above only cleared the timer. React runs
  // cleanups in effect-definition order, so this one fires AFTER the
  // clearTimeout above, on the same unmount/key change, and sends the queued
  // log against the key it was queued for.
  useEffect(() => {
    return () => flushPendingSave();
  }, [keyId, flushPendingSave]);
}

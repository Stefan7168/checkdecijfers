// Own-data publish (ADR 057), final-review fixes A4 + A5 (rulings R14, R13):
// the ONE place the own-data card turns its undo/redo history into the log
// it hands the publish action. Pure — no React, no server import — so the
// client card can call it and a unit test can drive it directly.
//
// A4: the log is `serializeHistory(seal(history))`, never the bare
// `serializeHistory(history)`. `serializeHistory` skips a transient top entry
// (a colour-picker drag the reader has not "finished" yet), so an unsealed
// history would publish a chart without the colour the author is looking at.
//
// A5: before the log is sent, it is replayed from the SAME initial document
// the card itself started from, with the card's own replay context, and the
// result is compared with what the author sees right now. The history is
// capped (HISTORY_CAP): once a long session trims its oldest entries, the
// log no longer starts from the chart as first made, and replaying it can
// land somewhere else — e.g. a `toggleSeries` that hid a private series was
// the trimmed entry, so the published chart would SHOW that series. A
// mismatch means "cannot publish exactly as shown": the caller gets `null`
// and refuses client-side instead of sending a log that means something else.
import { replayLog, seal, serializeHistory, type ChartHistory, type ReplayContext } from './chart-history.ts';
import type { ChartCommand, ChartDocState } from './chart-commands.ts';
import { instructionKey } from './user-chart-command-spec.ts';

function sameKeys(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const key of a) if (!b.has(key)) return false;
  return true;
}

/** The fields that decide WHAT a visitor sees (which series, which data,
 * which form) — the three a truncated log can silently change. */
export function publishStateMatches(replayed: ChartDocState, current: ChartDocState): boolean {
  return (
    sameKeys(replayed.hiddenKeys, current.hiddenKeys) &&
    instructionKey(replayed.instruction) === instructionKey(current.instruction) &&
    replayed.form === current.form
  );
}

/** The sealed, serialized log to publish, or `null` when replaying it from
 * `initial` does not reproduce `current` (see the file header). */
export function buildPublishLog(
  history: ChartHistory,
  initial: ChartDocState,
  ctx: ReplayContext,
  current: ChartDocState,
): ChartCommand[] | null {
  const log = serializeHistory(seal(history));
  const { state } = replayLog(initial, log, ctx);
  return publishStateMatches(state, current) ? log : null;
}

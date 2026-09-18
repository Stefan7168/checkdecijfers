// Chart co-pilot phase 2 (session 113, ADR 056 decision 4, migration 035).
// A chart_edits row is keyed by EITHER an audit answer (a CBS chart, phase
// 1) OR a dataset turn (a reader's own-data chart, phase 2) — never both.
// Shared by the card (web/components/chart.tsx) and the server actions
// (web/app/chart-edits-actions.ts). The store (src/chart/edits-store.ts)
// reproduces this type locally rather than importing it: src/threads/
// replay.ts's own header comment states the mandatory layering rule — "web/
// backend -> ../src means src code cannot import web/lib/*" — so both sides
// of that boundary carry the same, structurally identical, shape.
export type ChartEditsKey = { kind: 'answer'; id: number } | { kind: 'turn'; id: number };

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

export function isChartEditsKey(raw: unknown): raw is ChartEditsKey {
  if (typeof raw !== 'object' || raw === null) return false;
  const { kind, id } = raw as { kind?: unknown; id?: unknown };
  return (kind === 'answer' || kind === 'turn') && isPositiveSafeInteger(id);
}

/** A stable string identity for the key — usable as a React key/ref
 * dependency where the object literal itself isn't referentially stable. */
export function editsKeyToString(key: ChartEditsKey): string {
  return `${key.kind}:${key.id}`;
}

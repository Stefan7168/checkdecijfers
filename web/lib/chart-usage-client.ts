// Injectable client-side sink for the anonymous chart-style usage counter
// (WP218 phase 6, Task 3). chart.tsx calls trackChartStyleEvent() directly;
// it must NOT import the 'use server' action (web/app/usage-actions.ts) or
// web/app/actions.ts at all — only this module. chart-usage-tracker.tsx
// wires the real sink to the server action once, at mount, inside
// app/layout.tsx; every other render path (server renders, and every
// existing test that mounts chart.tsx without touching this module) keeps
// the default `null` sink, so nothing here ever reaches the database
// unless the tracker is actually mounted.
import type { ChartStyleEvent } from '../backend/chart/user-styles.ts';

type Sink = (event: ChartStyleEvent) => void | Promise<void>;

let sink: Sink | null = null;

export function setChartUsageSink(next: Sink | null): void {
  sink = next;
}

/** Fire-and-forget: never throws, never awaited by the caller. A rejecting
 * or synchronously-throwing sink is swallowed here — this counter is pure
 * telemetry and must never affect the chart it's attached to. */
export function trackChartStyleEvent(event: ChartStyleEvent): void {
  if (!sink) return;
  try {
    void Promise.resolve(sink(event)).catch(() => {});
  } catch {
    // sink threw synchronously — swallow, same contract as an async reject.
  }
}

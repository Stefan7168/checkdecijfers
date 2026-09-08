// The anonymous chart-style usage counter's Server Action (WP218 phase 6,
// Task 3, ADR 039 / #220). Deliberately the ONLY thing this file does — its
// import graph is kept to exactly the db client + the store + the error
// reporter, nothing from app/actions.ts's much larger graph, so that
// web/lib/chart-usage-client.ts (imported by chart.tsx, a client component)
// referencing this action via chart-usage-tracker.tsx never drags the chat
// pipeline's dependencies toward the client bundle.
//
// No auth check by design: anonymous homepage/trial visitors count too (this
// is pure telemetry — event x day x count, no user id, no IP — see the
// store's own header comment). `raw` is untrusted input from the browser, so
// it is validated against CHART_STYLE_EVENTS before ever reaching the store;
// anything else is silently ignored rather than reported, since a stray
// value here is not a real failure worth a durable error-log row.
'use server';

import { CHART_STYLE_EVENTS, recordChartStyleEvent } from '../backend/chart/user-styles.ts';
import type { ChartStyleEvent } from '../backend/chart/user-styles.ts';
import { reportError } from '../lib/error-report.ts';
import { getDb } from '../lib/db.ts';

function isChartStyleEvent(raw: unknown): raw is ChartStyleEvent {
  return (CHART_STYLE_EVENTS as readonly unknown[]).includes(raw);
}

export async function countChartStyleEvent(raw: unknown): Promise<void> {
  if (!isChartStyleEvent(raw)) return;
  try {
    await recordChartStyleEvent(getDb(), raw, new Date());
  } catch (e) {
    await reportError('countChartStyleEvent', e);
  }
}

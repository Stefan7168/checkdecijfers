// Mounted once in app/layout.tsx (WP218 phase 6, Task 3): wires the client
// side's injectable chart-usage sink (lib/chart-usage-client.ts) to the real
// server action (app/usage-actions.ts) for the lifetime of the app shell, so
// chart.tsx itself never imports the server action — only the sink. Renders
// nothing; this component is pure wiring.
'use client';

import { useEffect } from 'react';
import type { ChartStyleEvent } from '../backend/chart/user-styles.ts';
import { setChartUsageSink } from '../lib/chart-usage-client.ts';
import { countChartStyleEvent } from '../app/usage-actions.ts';

export function ChartUsageTracker(): null {
  useEffect(() => {
    setChartUsageSink((event: ChartStyleEvent) => countChartStyleEvent(event));
    return () => setChartUsageSink(null);
  }, []);
  return null;
}

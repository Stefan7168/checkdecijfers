// Shared fixtures for the co-pilot suites (session 113, co-pilot phase 2).
// Not a *.test.ts file, so vitest never collects it as a suite — it only
// exists so copilot-map.test.ts and copilot-text-guard.test.ts judge the
// SAME two-series chart, the way a mapping rule and its digit guard are
// judged against one chart in production.
import { USER_DATA_DISCLAIMER, type ClientChartInstruction, type UserChartSpec } from '../../src/attachments/types.ts';

export const CHART_FIXTURE: UserChartSpec = {
  schemaVersion: 1,
  origin: 'user_dataset',
  trust: 'unverified',
  kind: 'line',
  xHeader: 'Year',
  yHeaders: ['Revenue (x 1.000 euro)'],
  series: [
    {
      label: 'Amsterdam',
      points: [
        { rowRef: 'r1:c2', xKey: '2020', xLabel: '2020', value: 120, formattedValue: '120', sourceText: '120' },
        { rowRef: 'r2:c2', xKey: '2021', xLabel: '2021', value: 150, formattedValue: '150', sourceText: '150' },
      ],
    },
    {
      label: 'Rotterdam',
      points: [
        { rowRef: 'r3:c2', xKey: '2020', xLabel: '2020', value: 1234.5, formattedValue: '1.234,5', sourceText: '1234,5' },
        { rowRef: 'r4:c2', xKey: '2021', xLabel: '2021', value: null, formattedValue: null, sourceText: '', reason: 'leeg in bron' },
        // A negative value and a source cell carrying a currency symbol —
        // the digit guard must recognise the NUMBER inside both.
        { rowRef: 'r5:c2', xKey: '2022', xLabel: '2022', value: -24, formattedValue: '-24', sourceText: '€ -24,00' },
      ],
    },
  ],
  provenance: {
    datasetId: 7,
    sourceKind: 'file_csv',
    displayName: 'omzet.csv',
    sourceUrlHost: null,
    capturedAt: '2026-09-18T00:00:00.000Z',
    contentSha256: 'deadbeef',
  },
  disclaimerLine: USER_DATA_DISCLAIMER,
};

/** What is on screen when the fixture chart was drawn. */
export const CURRENT_FIXTURE: ClientChartInstruction = {
  version: 2,
  kind: 'line',
  x: 'c0',
  y: ['c2'],
  seriesBy: 'c1',
  filters: [],
  sort: null,
  limit: null,
  aggregate: null,
  derived: null,
  unsupported: null,
};

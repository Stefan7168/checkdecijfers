// Shared fixtures for the CBS chart co-pilot suites (session 114, co-pilot
// phase 3). Not a *.test.ts file, so vitest never collects it as a suite —
// it only exists so copilot-map.test.ts and copilot-text-guard.test.ts judge
// the SAME two-series chart, mirroring
// tests/attachments/copilot-fixtures.ts's role for the own-data tier.
import type { CbsCopilotCapabilities } from '../../src/chart/copilot/types.ts';
import type { ChartSpec } from '../../src/chart/types.ts';

export const CHART_SPEC_FIXTURE: ChartSpec = {
  schemaVersion: 1,
  kind: 'line',
  title: 'Bevolking',
  dims: {},
  dimLabels: {},
  unit: 'aantal',
  series: [
    {
      label: 'Amsterdam',
      regionCode: 'GM0363',
      points: [
        {
          resultId: 'TESTCBS:M1:GM0363:2020JJ00',
          periodCode: '2020JJ00',
          periodLabel: '2020',
          value: 120,
          formattedValue: '120',
          decimals: 0,
          status: 'Definitief',
          provisional: false,
          valueAttribute: 'None',
        },
        {
          resultId: 'TESTCBS:M1:GM0363:2021JJ00',
          periodCode: '2021JJ00',
          periodLabel: '2021',
          value: 150,
          formattedValue: '150',
          decimals: 0,
          status: 'Definitief',
          provisional: false,
          valueAttribute: 'None',
        },
        {
          resultId: 'TESTCBS:M1:GM0363:2022JJ00',
          periodCode: '2022JJ00',
          periodLabel: '2022',
          value: 160,
          formattedValue: '160',
          decimals: 0,
          status: 'Definitief',
          provisional: false,
          valueAttribute: 'None',
        },
      ],
    },
    {
      label: 'Rotterdam',
      regionCode: 'GM0599',
      points: [
        {
          resultId: 'TESTCBS:M1:GM0599:2020JJ00',
          periodCode: '2020JJ00',
          periodLabel: '2020',
          value: 1234.5,
          formattedValue: '1.234,5',
          decimals: 1,
          status: 'Definitief',
          provisional: false,
          valueAttribute: 'None',
        },
        {
          resultId: 'TESTCBS:M1:GM0599:2021JJ00',
          periodCode: '2021JJ00',
          periodLabel: '2021',
          value: null,
          formattedValue: null,
          decimals: 0,
          status: 'Definitief',
          provisional: false,
          valueAttribute: 'GeheimVanwegePrivacyOfConcurrentie',
        },
        {
          resultId: 'TESTCBS:M1:GM0599:2022JJ00',
          periodCode: '2022JJ00',
          periodLabel: '2022',
          value: -24,
          formattedValue: '-24',
          decimals: 0,
          status: 'VoorLopig',
          provisional: true,
          valueAttribute: 'None',
        },
      ],
    },
  ],
  provisionalNote: 'Het cijfer over 2022 is voorlopig.',
  nullNotes: ['2021: geheim vanwege privacy of concurrentie'],
  definitionLine: null,
  attributionLine: 'Bron: CBS.',
  attribution: {
    tableId: 'TESTCBS',
    tableTitle: 'Testtabel voor grafieken',
    tableVersion: 1,
    syncedAt: '2026-09-18T00:00:00.000Z',
    coveredPeriods: { from: '2020JJ00', to: '2022JJ00' },
    license: 'CC BY 4.0',
  },
};

/** Capabilities the fixture chart offers — mirrors what
 * web/lib/chart-capabilities.ts's `cbsCapabilities` would compute for a
 * two-series line chart. */
export const CBS_CAPABILITIES_FIXTURE: CbsCopilotCapabilities = {
  forms: ['line', 'bar', 'table'],
  presentationKeys: ['lineWidth', 'grid', 'markers'],
  templates: ['standard', 'newsroom'],
  zoom: true,
  overlays: true,
  lang: 'nl',
};

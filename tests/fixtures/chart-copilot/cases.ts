// Hand-authored CBS chart co-pilot fixture cases (session 114, co-pilot
// phase 3, Task 4) — the selection-only sibling of
// tests/fixtures/attachments/cases.ts.
//
// REGION_SERIES_SPEC below is NOT hand-built: it is the exact ChartSpec the
// dev-harness draws for the `!!intent` question in
// web/e2e/chart-copilot.spec.ts (population_on_1_january, GM0363 + GM0599,
// 2020JJ00-2024JJ00), captured by running the real pipeline
// (runQuery(db, intent) -> buildChartSpec(result), src/query/index.ts +
// src/chart/index.ts) against the SAME hermetic fixture snapshot the harness
// preloads (tests/helpers/fixture-snapshot.ts, ADR 009) -- the same mechanism
// scripts/dev-harness/pglite-preload.mjs uses. The values (Amsterdam's and
// Rotterdam's 2020-2024 population_on_1_january cells) come straight from the
// committed CBS seed fixtures and do not change unless those fixtures do; the
// literal below is pasted verbatim from that run so this file needs no
// database at test time. copilot-fixtures.test.ts pins this spec against
// buildCbsCopilotRequest, so any drift (a fixture bump, a chart.ts change)
// fails loudly here, not silently in the browser proof.
import type { ChartSpec } from '../../../src/chart/types.ts';
import type { CbsCopilotCapabilities, CbsCopilotOutput } from '../../../src/chart/copilot/types.ts';

export interface CbsCopilotCase {
  label: string;
  spec: ChartSpec;
  capabilities: CbsCopilotCapabilities;
  message: string;
  output: CbsCopilotOutput;
}

/** Captured verbatim (see header) — a real ChartSpec, not a hand-built one. */
export const REGION_SERIES_SPEC: ChartSpec = {
  "schemaVersion": 1,
  "kind": "line",
  "title": "Bevolking op 1 januari",
  "dims": {
    "Geslacht": "T001038",
    "Leeftijd": "10000",
    "BurgerlijkeStaat": "T001019"
  },
  "dimLabels": {
    "Geslacht": "Totaal mannen en vrouwen",
    "Leeftijd": "Totaal",
    "BurgerlijkeStaat": "Totaal burgerlijke staat"
  },
  "unit": "aantal",
  "series": [
    {
      "label": "Amsterdam",
      "regionCode": "GM0363",
      "points": [
        {
          "resultId": "03759ned:M000352:GM0363:2020JJ00:BurgerlijkeStaat=T001019;Geslacht=T001038;Leeftijd=10000",
          "periodCode": "2020JJ00",
          "periodLabel": "2020",
          "value": 872757,
          "formattedValue": "872.757",
          "decimals": 0,
          "status": "Definitief",
          "provisional": false,
          "valueAttribute": "None"
        },
        {
          "resultId": "03759ned:M000352:GM0363:2021JJ00:BurgerlijkeStaat=T001019;Geslacht=T001038;Leeftijd=10000",
          "periodCode": "2021JJ00",
          "periodLabel": "2021",
          "value": 873338,
          "formattedValue": "873.338",
          "decimals": 0,
          "status": "Definitief",
          "provisional": false,
          "valueAttribute": "None"
        },
        {
          "resultId": "03759ned:M000352:GM0363:2022JJ00:BurgerlijkeStaat=T001019;Geslacht=T001038;Leeftijd=10000",
          "periodCode": "2022JJ00",
          "periodLabel": "2022",
          "value": 882633,
          "formattedValue": "882.633",
          "decimals": 0,
          "status": "Definitief",
          "provisional": false,
          "valueAttribute": "None"
        },
        {
          "resultId": "03759ned:M000352:GM0363:2023JJ00:BurgerlijkeStaat=T001019;Geslacht=T001038;Leeftijd=10000",
          "periodCode": "2023JJ00",
          "periodLabel": "2023",
          "value": 918117,
          "formattedValue": "918.117",
          "decimals": 0,
          "status": "Definitief",
          "provisional": false,
          "valueAttribute": "None"
        },
        {
          "resultId": "03759ned:M000352:GM0363:2024JJ00:BurgerlijkeStaat=T001019;Geslacht=T001038;Leeftijd=10000",
          "periodCode": "2024JJ00",
          "periodLabel": "2024",
          "value": 931298,
          "formattedValue": "931.298",
          "decimals": 0,
          "status": "Definitief",
          "provisional": false,
          "valueAttribute": "None"
        }
      ]
    },
    {
      "label": "Rotterdam",
      "regionCode": "GM0599",
      "points": [
        {
          "resultId": "03759ned:M000352:GM0599:2020JJ00:BurgerlijkeStaat=T001019;Geslacht=T001038;Leeftijd=10000",
          "periodCode": "2020JJ00",
          "periodLabel": "2020",
          "value": 651157,
          "formattedValue": "651.157",
          "decimals": 0,
          "status": "Definitief",
          "provisional": false,
          "valueAttribute": "None"
        },
        {
          "resultId": "03759ned:M000352:GM0599:2021JJ00:BurgerlijkeStaat=T001019;Geslacht=T001038;Leeftijd=10000",
          "periodCode": "2021JJ00",
          "periodLabel": "2021",
          "value": 651631,
          "formattedValue": "651.631",
          "decimals": 0,
          "status": "Definitief",
          "provisional": false,
          "valueAttribute": "None"
        },
        {
          "resultId": "03759ned:M000352:GM0599:2022JJ00:BurgerlijkeStaat=T001019;Geslacht=T001038;Leeftijd=10000",
          "periodCode": "2022JJ00",
          "periodLabel": "2022",
          "value": 655468,
          "formattedValue": "655.468",
          "decimals": 0,
          "status": "Definitief",
          "provisional": false,
          "valueAttribute": "None"
        },
        {
          "resultId": "03759ned:M000352:GM0599:2023JJ00:BurgerlijkeStaat=T001019;Geslacht=T001038;Leeftijd=10000",
          "periodCode": "2023JJ00",
          "periodLabel": "2023",
          "value": 663900,
          "formattedValue": "663.900",
          "decimals": 0,
          "status": "Definitief",
          "provisional": false,
          "valueAttribute": "None"
        },
        {
          "resultId": "03759ned:M000352:GM0599:2024JJ00:BurgerlijkeStaat=T001019;Geslacht=T001038;Leeftijd=10000",
          "periodCode": "2024JJ00",
          "periodLabel": "2024",
          "value": 670610,
          "formattedValue": "670.610",
          "decimals": 0,
          "status": "Definitief",
          "provisional": false,
          "valueAttribute": "None"
        }
      ]
    }
  ],
  "provisionalNote": null,
  "nullNotes": [],
  "definitionLine": "Definitie: bevolking op 1 januari.",
  "attributionLine": "Bron: CBS StatLine, tabel 03759ned \u2014 Bevolking op 1 januari en gemiddeld; geslacht, leeftijd en regio. Gegevens gesynchroniseerd op 2026-09-18. Periode: 2020 t/m 2024. Licentie: CC BY 4.0.",
  "attribution": {
    "tableId": "03759ned",
    "tableTitle": "Bevolking op 1 januari en gemiddeld; geslacht, leeftijd en regio",
    "tableVersion": 1,
    "syncedAt": "2026-09-18T14:20:44.099Z",
    "coveredPeriods": {
      "from": "2020JJ00",
      "to": "2024JJ00"
    },
    "license": "CC BY 4.0"
  }
};

/** What the browser tells the co-pilot this chart can do — a `line` kind
 * with 2 series and 5 period codes (so `zoom: true`), written out by hand
 * the way LINE_CAPABILITIES is in the own-data cases: forms line/bar/table,
 * presentation = everything but areaFill, all templates, lang nl. */
export const REGION_SERIES_CAPABILITIES: CbsCopilotCapabilities = {
  forms: ['line', 'bar', 'table'],
  presentationKeys: [
    'lineWidth',
    'markers',
    'grid',
    'xLabels',
    'axisLines',
    'zeroBaseline',
    'seriesColors',
    'fontFamily',
    'framePadding',
    'frameCorners',
    'frameShadow',
  ],
  templates: ['standard', 'classic', 'newsroom', 'presentation', 'social', 'minimal', 'warm', 'earth'],
  zoom: true,
  lang: 'nl',
};

export const CASES: CbsCopilotCase[] = [
  {
    label: 'cbs-copilot/hide-rotterdam',
    spec: REGION_SERIES_SPEC,
    capabilities: REGION_SERIES_CAPABILITIES,
    message: 'verberg Rotterdam',
    output: {
      version: 1,
      view: [{ kind: 'setSeriesView', hiddenLabels: ['Rotterdam'], highlightedLabel: null }],
      dataRequest: false,
      refused: [],
      confidence: 0.95,
      reading: 'Rotterdam hidden, Amsterdam stays.',
    },
  },
  {
    label: 'cbs-copilot/bars-and-title',
    spec: REGION_SERIES_SPEC,
    capabilities: REGION_SERIES_CAPABILITIES,
    message: 'maak er staven van en geef het de kop Bevolking in twee steden',
    output: {
      version: 1,
      view: [
        { kind: 'setForm', form: 'bar' },
        { kind: 'setTitle', title: 'Bevolking in twee steden' },
      ],
      dataRequest: false,
      refused: [],
      confidence: 0.93,
      reading: 'Switched to bars and set a new title.',
    },
  },
  {
    label: 'cbs-copilot/add-utrecht',
    spec: REGION_SERIES_SPEC,
    capabilities: REGION_SERIES_CAPABILITIES,
    message: 'en Utrecht erbij',
    output: {
      version: 1,
      view: [],
      dataRequest: true,
      refused: [],
      confidence: 0.9,
      reading: 'Utrecht is not on this chart -- a data request, not a view change.',
    },
  },
];

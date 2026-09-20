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
 * the way LINE_CAPABILITIES is in the own-data cases: forms line/bar/table
 * — plus heatmap since phase 5 (chart-fit scorer, session 116): the tab
 * strip and `cbsCapabilities` both read chart-fit.ts's `allowedForms`, and
 * two series over the same five real-valued periods IS a heat-map grid, so
 * the browser now sends `forms=[line, bar, table, heatmap]` for this chart.
 * This list must stay byte-equal to what chart.tsx sends, or the llm-stub's
 * exact match misses and its 60-character PREFIX fallback silently replays
 * whichever fixture with this title/unit sorts first (Task 5 finding) —
 * presentation = everything but areaFill, all templates, lang nl. */
export const REGION_SERIES_CAPABILITIES: CbsCopilotCapabilities = {
  forms: ['line', 'bar', 'table', 'heatmap'],
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

/** Phase 5 (chart-fit scorer, session 116, Task 5): the SAME captured cells
 * narrowed to a two-period range — what the harness draws for `!!intent`
 * with period 2023JJ00–2024JJ00 over the same two regions (the shape that
 * qualifies for dumbbell, slope AND heatmap: every series exactly two real
 * points). Derived from REGION_SERIES_SPEC rather than re-captured: the
 * request bytes carry only title/unit/kind/series labels/period labels
 * (parse.ts `chartLabels`), all of which narrowing leaves exactly as the
 * pipeline produces them — and the browser proof (chart-copilot.spec.ts)
 * only passes on an `exact` llm-stub hit, which is the check that this
 * derivation matches the real request. */
function narrowedTo(spec: ChartSpec, periodCodes: readonly string[]): ChartSpec {
  const series = spec.series.map((s) => ({
    ...s,
    points: s.points.filter((point) => periodCodes.includes(point.periodCode)),
  }));
  const kept = series[0]!.points;
  const [fromLabel, toLabel] = [kept[0]!.periodLabel, kept[kept.length - 1]!.periodLabel];
  return {
    ...spec,
    series,
    attributionLine: spec.attributionLine.replace(/Periode: \S+ t\/m \S+\./, `Periode: ${fromLabel} t/m ${toLabel}.`),
    attribution: { ...spec.attribution, coveredPeriods: { from: periodCodes[0]!, to: periodCodes[periodCodes.length - 1]! } },
  };
}

export const TWO_PERIOD_SPEC: ChartSpec = narrowedTo(REGION_SERIES_SPEC, ['2023JJ00', '2024JJ00']);

/** The same chart with Amsterdam alone (`!!intent` with one region, five
 * periods): a single series qualifies for none of the three phase-5 forms
 * (each needs at least two series), and — one series — area IS offered. */
export const SINGLE_SERIES_SPEC: ChartSpec = { ...REGION_SERIES_SPEC, series: [REGION_SERIES_SPEC.series[0]!] };

/** `allowedForms` (web/lib/chart-fit.ts) for the two shapes above, in the
 * scorer's own fixed order — the browser sends exactly this list. */
export const TWO_PERIOD_CAPABILITIES: CbsCopilotCapabilities = {
  ...REGION_SERIES_CAPABILITIES,
  forms: ['line', 'bar', 'table', 'dumbbell', 'slope', 'heatmap'],
};
export const SINGLE_SERIES_CAPABILITIES: CbsCopilotCapabilities = {
  ...REGION_SERIES_CAPABILITIES,
  forms: ['line', 'area', 'bar', 'table'],
};

/** The phase-5 e2e message, verbatim (chart-copilot.spec.ts). */
export const DUMBBELL_MESSAGE = 'toon dit als een dumbbell';

/** Phase 5b (verified-whole, session 117, Task 5): the ONE region-set chart
 * the harness can draw — `!!regionset provincies` (src/answer/respond/
 * harness-intent.ts: population on 1 January, ALL 12 provinces, 2025), the
 * same question web/e2e/answer.spec.ts (d) asks. Captured the same way
 * REGION_SERIES_SPEC was (runQuery → buildChartSpec against the hermetic
 * fixture snapshot, pasted verbatim) — NOT derived from that capture: a
 * region-set answer is its own shape (twelve value-SORTED series of one
 * point each, `kind: 'bar'`, and — the whole point of phase 5b — a real
 * `regionScope`, which only `resolveRegionSet` ever stamps). `syncedAt` is
 * whatever the capture's snapshot carried; it is not part of the request
 * bytes (parse.ts `chartLabels`: title/unit/kind/series labels/period
 * labels only). */
export const PROVINCIES_SPEC: ChartSpec = {
  "schemaVersion": 1,
  "kind": "bar",
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
      "label": "Zuid-Holland (PV)",
      "regionCode": "PV28",
      "points": [
        {
          "resultId": "03759ned:M000352:PV28:2025JJ00:BurgerlijkeStaat=T001019;Geslacht=T001038;Leeftijd=10000",
          "periodCode": "2025JJ00",
          "periodLabel": "2025",
          "value": 3863397,
          "formattedValue": "3.863.397",
          "decimals": 0,
          "status": "Definitief",
          "provisional": false,
          "valueAttribute": "None"
        }
      ]
    },
    {
      "label": "Noord-Holland (PV)",
      "regionCode": "PV27",
      "points": [
        {
          "resultId": "03759ned:M000352:PV27:2025JJ00:BurgerlijkeStaat=T001019;Geslacht=T001038;Leeftijd=10000",
          "periodCode": "2025JJ00",
          "periodLabel": "2025",
          "value": 2992016,
          "formattedValue": "2.992.016",
          "decimals": 0,
          "status": "Definitief",
          "provisional": false,
          "valueAttribute": "None"
        }
      ]
    },
    {
      "label": "Noord-Brabant (PV)",
      "regionCode": "PV30",
      "points": [
        {
          "resultId": "03759ned:M000352:PV30:2025JJ00:BurgerlijkeStaat=T001019;Geslacht=T001038;Leeftijd=10000",
          "periodCode": "2025JJ00",
          "periodLabel": "2025",
          "value": 2664047,
          "formattedValue": "2.664.047",
          "decimals": 0,
          "status": "Definitief",
          "provisional": false,
          "valueAttribute": "None"
        }
      ]
    },
    {
      "label": "Gelderland (PV)",
      "regionCode": "PV25",
      "points": [
        {
          "resultId": "03759ned:M000352:PV25:2025JJ00:BurgerlijkeStaat=T001019;Geslacht=T001038;Leeftijd=10000",
          "periodCode": "2025JJ00",
          "periodLabel": "2025",
          "value": 2161358,
          "formattedValue": "2.161.358",
          "decimals": 0,
          "status": "Definitief",
          "provisional": false,
          "valueAttribute": "None"
        }
      ]
    },
    {
      "label": "Utrecht (PV)",
      "regionCode": "PV26",
      "points": [
        {
          "resultId": "03759ned:M000352:PV26:2025JJ00:BurgerlijkeStaat=T001019;Geslacht=T001038;Leeftijd=10000",
          "periodCode": "2025JJ00",
          "periodLabel": "2025",
          "value": 1409144,
          "formattedValue": "1.409.144",
          "decimals": 0,
          "status": "Definitief",
          "provisional": false,
          "valueAttribute": "None"
        }
      ]
    },
    {
      "label": "Overijssel (PV)",
      "regionCode": "PV23",
      "points": [
        {
          "resultId": "03759ned:M000352:PV23:2025JJ00:BurgerlijkeStaat=T001019;Geslacht=T001038;Leeftijd=10000",
          "periodCode": "2025JJ00",
          "periodLabel": "2025",
          "value": 1195789,
          "formattedValue": "1.195.789",
          "decimals": 0,
          "status": "Definitief",
          "provisional": false,
          "valueAttribute": "None"
        }
      ]
    },
    {
      "label": "Limburg (PV)",
      "regionCode": "PV31",
      "points": [
        {
          "resultId": "03759ned:M000352:PV31:2025JJ00:BurgerlijkeStaat=T001019;Geslacht=T001038;Leeftijd=10000",
          "periodCode": "2025JJ00",
          "periodLabel": "2025",
          "value": 1135328,
          "formattedValue": "1.135.328",
          "decimals": 0,
          "status": "Definitief",
          "provisional": false,
          "valueAttribute": "None"
        }
      ]
    },
    {
      "label": "Fryslân (PV)",
      "regionCode": "PV21",
      "points": [
        {
          "resultId": "03759ned:M000352:PV21:2025JJ00:BurgerlijkeStaat=T001019;Geslacht=T001038;Leeftijd=10000",
          "periodCode": "2025JJ00",
          "periodLabel": "2025",
          "value": 664222,
          "formattedValue": "664.222",
          "decimals": 0,
          "status": "Definitief",
          "provisional": false,
          "valueAttribute": "None"
        }
      ]
    },
    {
      "label": "Groningen (PV)",
      "regionCode": "PV20",
      "points": [
        {
          "resultId": "03759ned:M000352:PV20:2025JJ00:BurgerlijkeStaat=T001019;Geslacht=T001038;Leeftijd=10000",
          "periodCode": "2025JJ00",
          "periodLabel": "2025",
          "value": 602833,
          "formattedValue": "602.833",
          "decimals": 0,
          "status": "Definitief",
          "provisional": false,
          "valueAttribute": "None"
        }
      ]
    },
    {
      "label": "Drenthe (PV)",
      "regionCode": "PV22",
      "points": [
        {
          "resultId": "03759ned:M000352:PV22:2025JJ00:BurgerlijkeStaat=T001019;Geslacht=T001038;Leeftijd=10000",
          "periodCode": "2025JJ00",
          "periodLabel": "2025",
          "value": 506529,
          "formattedValue": "506.529",
          "decimals": 0,
          "status": "Definitief",
          "provisional": false,
          "valueAttribute": "None"
        }
      ]
    },
    {
      "label": "Flevoland (PV)",
      "regionCode": "PV24",
      "points": [
        {
          "resultId": "03759ned:M000352:PV24:2025JJ00:BurgerlijkeStaat=T001019;Geslacht=T001038;Leeftijd=10000",
          "periodCode": "2025JJ00",
          "periodLabel": "2025",
          "value": 456395,
          "formattedValue": "456.395",
          "decimals": 0,
          "status": "Definitief",
          "provisional": false,
          "valueAttribute": "None"
        }
      ]
    },
    {
      "label": "Zeeland (PV)",
      "regionCode": "PV29",
      "points": [
        {
          "resultId": "03759ned:M000352:PV29:2025JJ00:BurgerlijkeStaat=T001019;Geslacht=T001038;Leeftijd=10000",
          "periodCode": "2025JJ00",
          "periodLabel": "2025",
          "value": 392969,
          "formattedValue": "392.969",
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
  "attributionLine": "Bron: CBS StatLine, tabel 03759ned — Bevolking op 1 januari en gemiddeld; geslacht, leeftijd en regio. Gegevens gesynchroniseerd op 2026-09-19. Periode: 2025. Licentie: CC BY 4.0.",
  "attribution": {
    "tableId": "03759ned",
    "tableTitle": "Bevolking op 1 januari en gemiddeld; geslacht, leeftijd en regio",
    "tableVersion": 1,
    "syncedAt": "2026-09-19T17:07:35.189Z",
    "coveredPeriods": {
      "from": "2025JJ00",
      "to": "2025JJ00"
    },
    "license": "CC BY 4.0"
  },
  "regionScope": {
    "kind": "all_provincies"
  }
};

/** What the browser tells the co-pilot the provinces chart can do, in the
 * form it OPENS in — a comparison-shaped spec opens on horizontal bars
 * (chart.tsx `defaultFormFor`; answer.spec.ts (d) pins the twelve bars), so
 * the request is built with `form: 'hbar'` and must stay byte-equal to what
 * chart.tsx sends from that form (the llm-stub's 60-character prefix
 * fallback would otherwise silently replay another fixture with this same
 * title/unit/kind — the Task 5 finding phase 5 recorded above):
 *  - forms: chart-fit.ts `allowedForms` over a bar-kind, 12 × 1-point spec
 *    WITH a real regionScope — no line/area (bar kind, many series), no
 *    dumbbell/slope/heatmap (one period), and the three phase-5b forms;
 *  - style keys: PRESENTATION_KEYS ∩ resolvePresentation('hbar').applicable
 *    — the bar branch drops lineWidth/markers/zeroBaseline, hbar also drops
 *    xLabels, areaFill is area-only, pieHole is pie-only and not in
 *    PRESENTATION_KEYS at all;
 *  - all templates (hbar is not a tabular form), zoom false (bar kind). */
export const PROVINCIES_CAPABILITIES: CbsCopilotCapabilities = {
  forms: ['bar', 'hbar', 'table', 'pie', 'stacked', 'stacked100'],
  presentationKeys: ['grid', 'axisLines', 'seriesColors', 'fontFamily', 'framePadding', 'frameCorners', 'frameShadow'],
  templates: ['standard', 'classic', 'newsroom', 'presentation', 'social', 'minimal', 'warm', 'earth'],
  zoom: false,
  lang: 'nl',
};

/** The phase-5b e2e message, verbatim (chart-copilot.spec.ts). */
export const PIE_MESSAGE = 'toon dit als een taartdiagram';

export const CASES: CbsCopilotCase[] = [
  // Phase 5b (Task 5): a pie over the one chart that can honestly draw one
  // — a complete region class with a CBS-published total to check against...
  {
    label: 'cbs-copilot/pie-provincies',
    spec: PROVINCIES_SPEC,
    capabilities: PROVINCIES_CAPABILITIES,
    message: PIE_MESSAGE,
    output: {
      version: 1,
      view: [{ kind: 'setForm', form: 'pie' }],
      dataRequest: false,
      refused: [],
      confidence: 0.95,
      reading: 'All twelve provinces at one moment and pie is among the forms on offer: switched.',
    },
  },
  // ...and the same request over a hand-picked pair of cities, which is no
  // whole at all — the prompt's own rule: a form not under CAPABILITIES
  // goes in `refused` with reason not_available, control form.
  {
    label: 'cbs-copilot/pie-two-cities',
    spec: REGION_SERIES_SPEC,
    capabilities: REGION_SERIES_CAPABILITIES,
    message: PIE_MESSAGE,
    output: {
      version: 1,
      view: [],
      dataRequest: false,
      refused: [{ request: 'taartdiagram', reason: 'not_available', control: 'form' }],
      confidence: 0.9,
      reading: 'Two cities over five years: pie is not among the forms this chart offers.',
    },
  },
  // Phase 5 (Task 5): the same message over a chart that offers the form...
  {
    label: 'cbs-copilot/dumbbell-two-periods',
    spec: TWO_PERIOD_SPEC,
    capabilities: TWO_PERIOD_CAPABILITIES,
    message: DUMBBELL_MESSAGE,
    output: {
      version: 1,
      view: [{ kind: 'setForm', form: 'dumbbell' }],
      dataRequest: false,
      refused: [],
      confidence: 0.95,
      reading: 'Two moments per city and dumbbell is among the forms on offer: switched.',
    },
  },
  // ...and over one that does not — the prompt's own rule: a form not under
  // CAPABILITIES goes in `refused` with reason not_available, control form.
  {
    label: 'cbs-copilot/dumbbell-single-series',
    spec: SINGLE_SERIES_SPEC,
    capabilities: SINGLE_SERIES_CAPABILITIES,
    message: DUMBBELL_MESSAGE,
    output: {
      version: 1,
      view: [],
      dataRequest: false,
      refused: [{ request: 'dumbbell', reason: 'not_available', control: 'form' }],
      confidence: 0.9,
      reading: 'One series over five years: dumbbell is not among the forms this chart offers.',
    },
  },
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

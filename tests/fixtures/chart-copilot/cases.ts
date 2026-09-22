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

/** `capabilities.templates` as the browser sends it for every non-tabular
 * form: all of TEMPLATE_IDS, in TEMPLATE_IDS order (chart-capabilities.ts
 * `cbsCapabilities` spreads the list as is) — thirteen since the five house
 * styles (#275) became chat-nameable in co-pilot phase 6 Task 1. Written
 * out by hand, not imported: a fixture may not import from src/ or web/. */
const ALL_TEMPLATES: string[] = [
  'standard',
  'classic',
  'newsroom',
  'presentation',
  'social',
  'minimal',
  'warm',
  'earth',
  'salmon',
  'studio',
  'broadsheet',
  'autumn',
  'brutalist',
];

/** Every style key the patch schema demands, all null — the model must send
 * the whole shape, so a case that changes one key spells out the rest (the
 * own-data cases' own NO_PATCH). */
const NO_PATCH: Extract<CbsCopilotOutput['view'][number], { kind: 'setPresentation' }>['patch'] = {
  lineWidth: null,
  markers: null,
  grid: null,
  xLabels: null,
  axisLines: null,
  zeroBaseline: null,
  areaFill: null,
  pieHole: null,
  fontFamily: null,
  seriesColors: [],
  framePadding: null,
  frameCorners: null,
  frameShadow: null,
};

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
 * presentation = everything but areaFill (area only) and pieHole (pie
 * only), all templates, lang nl. */
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
  templates: ALL_TEMPLATES,
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
 *    xLabels, areaFill is area-only and pieHole is pie-only (in
 *    PRESENTATION_KEYS since phase 6 Task 1, offered in pie form alone);
 *  - all templates (hbar is not a tabular form), zoom false (bar kind). */
export const PROVINCIES_CAPABILITIES: CbsCopilotCapabilities = {
  forms: ['bar', 'hbar', 'table', 'pie', 'stacked', 'stacked100'],
  presentationKeys: ['grid', 'axisLines', 'seriesColors', 'fontFamily', 'framePadding', 'frameCorners', 'frameShadow'],
  templates: ALL_TEMPLATES,
  zoom: false,
  lang: 'nl',
};

/** The same provinces chart in the PIE form the phase-5b tab switches it to
 * — the one form in which `pieHole` is on offer at all. What chart.tsx sends
 * from there (co-pilot phase 6, Task 1; byte-equal for the same reason as
 * above):
 *  - forms: unchanged — `allowedForms` reads the spec, not the current form,
 *    and once the whole has verified all three roster forms are live-allowed
 *    (`canUsePie`/`canUseStacked`/`canUseStacked100`, #300);
 *  - style keys: PRESENTATION_KEYS ∩ resolvePresentation('pie').applicable —
 *    the pie branch drops every axis/line key (AXIS_KEYS: lineWidth, markers,
 *    grid, xLabels, axisLines, zeroBaseline), areaFill stays area-only, and
 *    pieHole, seriesColors, fontFamily and the frame keys remain, in
 *    PRESENTATION_KEYS order;
 *  - all templates (pie is not tabular), zoom false (bar kind). */
export const PROVINCIES_PIE_CAPABILITIES: CbsCopilotCapabilities = {
  ...PROVINCIES_CAPABILITIES,
  presentationKeys: ['pieHole', 'seriesColors', 'fontFamily', 'framePadding', 'frameCorners', 'frameShadow'],
};

/** The phase-5b e2e message, verbatim (chart-copilot.spec.ts). */
export const PIE_MESSAGE = 'toon dit als een taartdiagram';

/** The phase-6 Task 1 e2e messages, verbatim (chart-copilot.spec.ts): the
 * donut (#301) and one of the five house styles by name (#275). */
export const DONUT_MESSAGE = 'maak er een donut van';
export const BROADSHEET_MESSAGE = 'gebruik de Broadsheet-stijl';

/** The phase-6 Task 6 e2e message, verbatim (chart-copilot.spec.ts): the one
 * of the five panel-only commands (Tasks 2–5) the browser proof replays. */
export const ERA_SHADING_MESSAGE = 'Arceer 2021 tot 2023 als herstelperiode';

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
  // Co-pilot phase 6, Task 1 (#301): the donut is a PIE presentation toggle
  // (`pieHole`, spec §11) — on the Style panel since phase 5b, and now that
  // PRESENTATION_KEYS carries it, on the chat too: over the one chart that
  // can draw a pie, in the pie form (the only form that offers the key).
  {
    label: 'cbs-copilot/donut-provincies',
    spec: PROVINCIES_SPEC,
    capabilities: PROVINCIES_PIE_CAPABILITIES,
    message: DONUT_MESSAGE,
    output: {
      version: 1,
      view: [{ kind: 'setPresentation', patch: { ...NO_PATCH, pieHole: 'donut' } }],
      dataRequest: false,
      refused: [],
      confidence: 0.95,
      reading: 'A donut is the pie with a hole in the middle; pieHole is among the style keys on offer, so applied.',
    },
  },
  // ...and one of the five house styles (#275) by name over the two-city
  // line chart: an applyTemplate whose id is copied from
  // CAPABILITIES.templates, which lists all thirteen looks since
  // TEMPLATE_IDS was widened.
  {
    label: 'cbs-copilot/broadsheet-two-cities',
    spec: REGION_SERIES_SPEC,
    capabilities: REGION_SERIES_CAPABILITIES,
    message: BROADSHEET_MESSAGE,
    output: {
      version: 1,
      view: [{ kind: 'applyTemplate', templateId: 'broadsheet' }],
      dataRequest: false,
      refused: [],
      confidence: 0.95,
      reading: 'Broadsheet is among the templates on offer: applied.',
    },
  },
  // Co-pilot phase 6, Tasks 2–5: the five commands the panel could do and
  // the chat could not name — one case per kind, all over the two-city line
  // chart (its capabilities unchanged: none of these commands is gated by
  // the CAPABILITIES bag, only by the labels resolving against the spec).
  // The prompt's VIEW COMMANDS list grew by these five under ONE version
  // bump (prompt.ts, 3 → 4), which is why every case above moved to a new
  // hash in the same regeneration as these were added.
  //
  // Dim (Task 2, setDimmed): the legend's own "Dim" button by name — the
  // series stays visible at reduced emphasis, hidden stays empty.
  {
    label: 'cbs-copilot/chat-dim-series',
    spec: REGION_SERIES_SPEC,
    capabilities: REGION_SERIES_CAPABILITIES,
    message: 'Dim Rotterdam in plaats van hem te verbergen',
    output: {
      version: 1,
      view: [{ kind: 'setDimmed', hiddenLabels: [], dimmedLabels: ['Rotterdam'] }],
      dataRequest: false,
      refused: [],
      confidence: 0.95,
      reading: 'Rotterdam dimmed rather than hidden; Amsterdam untouched.',
    },
  },
  // Headline (Task 2, setHeadlineOverride): one real point of the chart,
  // named by series label + period label, becomes the headline figure.
  {
    label: 'cbs-copilot/chat-headline-override',
    spec: REGION_SERIES_SPEC,
    capabilities: REGION_SERIES_CAPABILITIES,
    message: 'Maak van Amsterdam in 2022 het hoofdcijfer',
    output: {
      version: 1,
      view: [{ kind: 'setHeadlineOverride', seriesLabel: 'Amsterdam', periodLabel: '2022' }],
      dataRequest: false,
      refused: [],
      confidence: 0.95,
      reading: 'Amsterdam at 2022 is a real point of this chart: made the headline.',
    },
  },
  // Era shading (Task 3, addEraShading): two period labels copied from the
  // chart, plus a typed, digit-free label — the e2e case.
  {
    label: 'cbs-copilot/chat-era-shading',
    spec: REGION_SERIES_SPEC,
    capabilities: REGION_SERIES_CAPABILITIES,
    message: ERA_SHADING_MESSAGE,
    output: {
      version: 1,
      view: [{ kind: 'addEraShading', fromLabel: '2021', toLabel: '2023', label: 'Herstelperiode' }],
      dataRequest: false,
      refused: [],
      confidence: 0.95,
      reading: 'Both periods are on the chart; shaded 2021 to 2023 with the typed label.',
    },
  },
  // Derived difference (Task 4, addDerivedOverlay): a calculation over two
  // points that ARE on the chart is a view command, never dataRequest —
  // the number itself is derived server-side from those two cells.
  {
    label: 'cbs-copilot/chat-derived-difference',
    spec: REGION_SERIES_SPEC,
    capabilities: REGION_SERIES_CAPABILITIES,
    message: 'Laat het verschil zien tussen Amsterdam in 2020 en 2024',
    output: {
      version: 1,
      view: [{ kind: 'addDerivedOverlay', calcKind: 'difference', seriesLabel: 'Amsterdam', fromLabel: '2020', toLabel: '2024' }],
      dataRequest: false,
      refused: [],
      confidence: 0.95,
      reading: 'Both points are on this chart: a difference overlay, not a data request.',
    },
  },
  // Goal line (Task 5, addGoalLine): the ONE bare number this tier stores —
  // copied from the reader's own message, which map.ts checks it against
  // (goalLineValueInMessage); the label kept free of numbers, as the
  // prompt asks.
  {
    label: 'cbs-copilot/chat-goal-line',
    spec: REGION_SERIES_SPEC,
    capabilities: REGION_SERIES_CAPABILITIES,
    message: 'Voeg een doellijn toe op 900000',
    output: {
      version: 1,
      view: [{ kind: 'addGoalLine', value: 900000, label: 'Doel' }],
      dataRequest: false,
      refused: [],
      confidence: 0.95,
      reading: 'The value is the one the message contains; the label carries no number.',
    },
  },
];

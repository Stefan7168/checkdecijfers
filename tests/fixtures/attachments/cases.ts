// The hermetic own-data cases (session 113, co-pilot phase 2, Task 9): one
// instruct turn and three co-pilot turns over ONE small CSV, with the exact
// model output each one is replayed with.
//
// These four cases are the ONLY reason the real-browser proof
// (web/e2e/own-data-copilot.spec.ts) needs no model at all: the generator
// (scripts/attachments-fixtures.ts) builds each turn's request with the REAL
// request builders and writes it under its own `requestHash`, so the
// llm-stub's (model, system, question) match is exact. The outputs below are
// HAND-AUTHORED, not recorded — `npm run attachments:record` exists to check
// them against a real call, and is owner-supervised because it spends.
//
// verkoop.csv is Task 2's own SALES set, minus its Utrecht row and with the
// one empty Omzet cell filled. That is deliberate and it is the only
// deviation: the browser proof counts `.recharts-line-curve` elements, so
// every series must have at least two plotted points for the count to mean
// "two lines" rather than "two lines and whatever Recharts draws for a
// single-point series". The edge cases those two rows exist for (a one-point
// series, a null in an aggregate group) are covered by
// tests/attachments/execute.test.ts, which keeps the full set.
import type { ChartInstruction, ClientChartInstruction } from '../../../src/attachments/types.ts';
import type { CopilotCapabilities, CopilotOutput } from '../../../src/attachments/copilot/types.ts';

export interface InstructCase {
  label: string;
  kind: 'instruct';
  csv: 'verkoop.csv';
  previous: ClientChartInstruction | null;
  question: string;
  output: ChartInstruction;
}

export interface CopilotCase {
  label: string;
  kind: 'copilot';
  csv: 'verkoop.csv';
  current: ClientChartInstruction;
  capabilities: CopilotCapabilities;
  message: string;
  output: CopilotOutput;
}

export type AttachmentCase = InstructCase | CopilotCase;

/** Case 1's instruction, as the browser holds it — the `current` every
 * co-pilot case below is asked against. */
const LINE_PER_GEMEENTE: ClientChartInstruction = {
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

/**
 * What the browser tells the co-pilot the case-1 chart can do — the SAME
 * values `ownDataCapabilities` (web/lib/chart-capabilities.ts) computes for
 * it, written out by hand because a fixture may not import from web/:
 *   forms — a `kind: 'line'` spec with 2 series: line yes, area no
 *     (single-series only), bar always, hbar no (bar-kind only), table always.
 *   presentationKeys — PRESENTATION_KEYS ∩ `resolvePresentation(...).applicable`
 *     for the line form, i.e. everything but `areaFill` (area only) and
 *     `pieHole` (pie only — a form this card cannot draw at all), in
 *     PRESENTATION_KEYS order.
 *   templates — all of TEMPLATE_IDS (the gallery is mounted in every
 *     non-table form), thirteen since the five house styles (#275) became
 *     chat-nameable in co-pilot phase 6 Task 1 — in TEMPLATE_IDS order, the
 *     order the browser sends.
 *   lang — the harness pins the UI to Dutch via the `lang` cookie.
 */
const LINE_CAPABILITIES: CopilotCapabilities = {
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
  templates: [
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
  ],
  // A `kind: 'line'` chart drawn in line form: the same `form === 'line' ||
  // form === 'area'` test `ownDataCapabilities` (web/lib/chart-capabilities.ts)
  // uses for its own `overlays` field.
  overlays: true,
  lang: 'nl',
};

/** Every style key the patch schema demands, all null — the model must send
 * the whole shape, so a case that changes one key spells out the rest. */
const NO_PATCH: Extract<CopilotOutput['view'][number], { kind: 'setPresentation' }>['patch'] = {
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

export const CASES: AttachmentCase[] = [
  {
    label: 'instruct/line-per-gemeente',
    kind: 'instruct',
    csv: 'verkoop.csv',
    previous: null,
    question: 'Omzet per jaar per gemeente',
    output: {
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
      confidence: 0.95,
      reading: 'Omzet per jaar, one line per gemeente.',
      unsupported: null,
    },
  },
  {
    label: 'copilot/total-per-gemeente-as-bars',
    kind: 'copilot',
    csv: 'verkoop.csv',
    current: LINE_PER_GEMEENTE,
    capabilities: LINE_CAPABILITIES,
    message: 'totaal per gemeente, hoogste eerst, en maak er staven van',
    output: {
      version: 1,
      instruction: {
        version: 2,
        kind: 'bar',
        x: 'c1',
        y: ['c2'],
        seriesBy: null,
        filters: [],
        sort: { by: 'value', direction: 'desc' },
        limit: null,
        aggregate: { fn: 'sum' },
        derived: null,
        confidence: 0.95,
        reading: 'Summed Omzet per gemeente, highest first.',
        unsupported: null,
      },
      view: [{ kind: 'setForm', form: 'bar' }],
      refused: [],
      confidence: 0.95,
      reading: 'Totals per gemeente, ordered, drawn as bars.',
    },
  },
  {
    label: 'copilot/thicker-line-spotlight-amsterdam',
    kind: 'copilot',
    csv: 'verkoop.csv',
    current: LINE_PER_GEMEENTE,
    capabilities: LINE_CAPABILITIES,
    message: 'dikkere lijn en zet Amsterdam in de schijnwerper',
    output: {
      version: 1,
      instruction: null,
      view: [
        { kind: 'setPresentation', patch: { ...NO_PATCH, lineWidth: 'thick' } },
        { kind: 'setSeriesView', hiddenLabels: [], highlightedLabel: 'Amsterdam' },
      ],
      refused: [],
      confidence: 0.95,
      reading: 'A style change and a spotlight — the data stays as it is.',
    },
  },
  {
    label: 'copilot/refuse-new-column',
    kind: 'copilot',
    csv: 'verkoop.csv',
    current: LINE_PER_GEMEENTE,
    capabilities: LINE_CAPABILITIES,
    message: 'voeg een kolom winst toe',
    output: {
      version: 1,
      instruction: null,
      view: [],
      refused: [{ request: 'add a profit column', reason: 'not_available', control: 'data' }],
      confidence: 0.9,
      reading: 'A new column is not something this tier can add.',
    },
  },
  // Co-pilot phase 6, Task 1 (#275): one of the five house styles by name —
  // an applyTemplate whose id is copied from CAPABILITIES.templates, which
  // lists all thirteen looks since TEMPLATE_IDS was widened.
  {
    label: 'copilot/broadsheet-look',
    kind: 'copilot',
    csv: 'verkoop.csv',
    current: LINE_PER_GEMEENTE,
    capabilities: LINE_CAPABILITIES,
    message: 'gebruik de Broadsheet-stijl',
    output: {
      version: 1,
      instruction: null,
      view: [{ kind: 'applyTemplate', templateId: 'broadsheet' }],
      refused: [],
      confidence: 0.95,
      reading: 'Broadsheet is among the templates on offer: applied, the data stays as it is.',
    },
  },
  // Co-pilot phase 6, Task 1 (#301): the own-data card has NO pie form
  // (COPILOT_FORMS; user-chart.tsx draws none), so `pieHole` — pie-only in
  // resolvePresentation — is never among the style keys it offers, and the
  // same "donut" a CBS pie takes (tests/fixtures/chart-copilot/cases.ts) is
  // refused here by the prompt's own rule: not under CAPABILITIES →
  // not_available. control: form — a donut is a chart shape to the reader,
  // and the form tabs are the control that decides shapes. The capabilities
  // are the real ones the browser sends for this chart, not a hand-built
  // list with pieHole in it, so a later `attachments:record` checks the
  // model against an input the product actually produces.
  {
    label: 'copilot/refuse-donut',
    kind: 'copilot',
    csv: 'verkoop.csv',
    current: LINE_PER_GEMEENTE,
    capabilities: LINE_CAPABILITIES,
    message: 'maak er een donut van',
    output: {
      version: 1,
      instruction: null,
      view: [],
      refused: [{ request: 'donut', reason: 'not_available', control: 'form' }],
      confidence: 0.9,
      reading: 'No pie form and no pieHole on this chart: a donut is not something this card offers.',
    },
  },
  // Own-data wiring of the CBS tier's co-pilot phase 6 primitives (mirrors
  // tests/fixtures/chart-copilot/cases.ts's own era-shading/derived-overlay/
  // goal-line cases, adapted to this dataset's two years and two cities).
  //
  // Dim and headline-override (session 122, further continuation,
  // open-questions #311): added later than the other three below — the
  // original own-data-parity pass skipped them on the wrong assumption that
  // the panel already dispatching both generically meant the chat could
  // name them too. Mirrors tests/fixtures/chart-copilot/cases.ts's own
  // chat-dim-series/chat-headline-override cases, adapted to this dataset
  // (2021 stands in for that fixture's 2022 — this CSV has only two years).
  {
    label: 'copilot/chat-dim-series',
    kind: 'copilot',
    csv: 'verkoop.csv',
    current: LINE_PER_GEMEENTE,
    capabilities: LINE_CAPABILITIES,
    message: 'Dim Rotterdam in plaats van hem te verbergen',
    output: {
      version: 1,
      instruction: null,
      view: [{ kind: 'setDimmed', hiddenLabels: [], dimmedLabels: ['Rotterdam'] }],
      refused: [],
      confidence: 0.95,
      reading: 'Rotterdam dimmed rather than hidden; Amsterdam untouched.',
    },
  },
  {
    label: 'copilot/chat-headline-override',
    kind: 'copilot',
    csv: 'verkoop.csv',
    current: LINE_PER_GEMEENTE,
    capabilities: LINE_CAPABILITIES,
    message: 'Maak van Amsterdam in 2021 het hoofdcijfer',
    output: {
      version: 1,
      instruction: null,
      view: [{ kind: 'setHeadlineOverride', seriesLabel: 'Amsterdam', xLabel: '2021' }],
      refused: [],
      confidence: 0.95,
      reading: 'Amsterdam at 2021 is a real point of this chart: made the headline.',
    },
  },
  // Era shading: both x labels copied from the chart, plus a typed,
  // digit-free label.
  {
    label: 'copilot/era-shading-both-years',
    kind: 'copilot',
    csv: 'verkoop.csv',
    current: LINE_PER_GEMEENTE,
    capabilities: LINE_CAPABILITIES,
    message: 'Arceer 2020 tot 2021 als groeiperiode',
    output: {
      version: 1,
      instruction: null,
      view: [{ kind: 'addEraShading', fromLabel: '2020', toLabel: '2021', label: 'Groeiperiode' }],
      refused: [],
      confidence: 0.95,
      reading: 'Both years are on the chart; shaded 2020 to 2021 with the typed label.',
    },
  },
  // Derived difference: a calculation over two points that ARE on this
  // chart is a view command, never a new instruction — the number itself
  // is derived by the client's own renderer from those two cells.
  {
    label: 'copilot/derived-difference-amsterdam',
    kind: 'copilot',
    csv: 'verkoop.csv',
    current: LINE_PER_GEMEENTE,
    capabilities: LINE_CAPABILITIES,
    message: 'Laat het verschil zien tussen Amsterdam in 2020 en 2021',
    output: {
      version: 1,
      instruction: null,
      view: [{ kind: 'addDerivedOverlay', calcKind: 'difference', seriesLabel: 'Amsterdam', fromLabel: '2020', toLabel: '2021' }],
      refused: [],
      confidence: 0.95,
      reading: 'Both points are on this chart: a difference overlay, not a new instruction.',
    },
  },
  // Goal line: the ONE bare number this tier stores — copied from the
  // reader's own message, which map.ts checks it against
  // (goalLineValueInMessage); the label kept free of numbers.
  {
    label: 'copilot/goal-line-on-omzet',
    kind: 'copilot',
    csv: 'verkoop.csv',
    current: LINE_PER_GEMEENTE,
    capabilities: LINE_CAPABILITIES,
    message: 'Voeg een doellijn toe op 120',
    output: {
      version: 1,
      instruction: null,
      view: [{ kind: 'addGoalLine', value: 120, label: 'Doel' }],
      refused: [],
      confidence: 0.95,
      reading: 'The value is the one the message contains; the label carries no number.',
    },
  },
];

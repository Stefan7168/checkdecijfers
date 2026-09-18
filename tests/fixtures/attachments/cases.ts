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
 *     for the line form, i.e. everything but `areaFill`, in PRESENTATION_KEYS
 *     order.
 *   templates — all of TEMPLATE_IDS (the gallery is mounted in every
 *     non-table form).
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
  templates: ['standard', 'classic', 'newsroom', 'presentation', 'social', 'minimal', 'warm', 'earth'],
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
];

// Shared web-layer test fixture: a minimal-but-real AnswerResponse carrying
// the full surface the web layer reads. WP20 established the discipline
// (everything the code under test reads is real and typed-shaped; everything
// it never reads is absent behind one isolated, documented cast); WP21's CSV
// export widened the web read-surface to the whole ValidatedResult (cells
// with codes/dims/status, full attribution), so the fixture now carries
// fully-typed ResultCell and Attribution objects — the compiler, not the
// cast, guarantees their shape.
import type { AnswerResponse } from '../backend/answer/respond/types.ts';
import type { ChartSpec } from '../backend/chart/types.ts';
import type { ScatterAxis, ScatterPoint, ScatterSpec } from '../backend/chart/scatter.ts';
import { scatterBodyNl, scatterLineNl } from '../backend/chart/scatter-text.ts';
import type { Attribution, ResultCell } from '../backend/query/types.ts';
// ADR 058 (English answers, Task 8): the optional English rendering a caller
// can attach to a fixture (verified/fallback rendering tests) — absent by
// default, exactly like every pre-Task-6 fixture (the flag-off, Dutch-only
// posture stays the default here too).
import type { EnglishRendering } from '../backend/answer/translate/types.ts';

export function fakeCell(overrides: Partial<ResultCell> = {}): ResultCell {
  return {
    resultId: '86141NED:CPI000000:NL01:2024JJ00',
    tableId: '86141NED',
    measure: 'CPI000000',
    measureTitle: 'Inflatie (CPI)',
    regionCode: null,
    regionLabel: null,
    periodCode: '2024JJ00',
    periodLabel: '2024',
    grain: 'JJ',
    dims: {},
    dimLabels: {},
    value: 3.3,
    decimals: 1,
    unit: '%',
    status: 'Definitief',
    provisional: false,
    valueAttribute: 'None',
    batchId: 1,
    ...overrides,
  };
}

export function fakeAttribution(overrides: Partial<Attribution> = {}): Attribution {
  return {
    tableId: '86141NED',
    tableTitle: 'Consumentenprijzen; prijsindex 2015=100',
    tableVersion: 1,
    syncedAt: '2026-07-03T12:00:00.000Z',
    coveredPeriods: { from: '2024JJ00', to: '2024JJ00' },
    license: 'CC BY 4.0',
    definitionLabel: null,
    definitionText: null,
    periodSemantics: null,
    ...overrides,
  };
}

export function fakeAnswerResponse(opts: {
  body?: string;
  text?: string;
  /** ADR 055: 'region_series' added (task 3's proof-panel region-naming
   * pin) — 'region_set' stays out until a caller needs it, per the
   * minimal-widening discipline this fixture already follows. */
  shape?: 'single' | 'series' | 'comparison' | 'derived' | 'region_series';
  cells?: ResultCell[];
  /** Loosely typed on purpose: consumers that only count derivations may
   * pass stubs; CSV tests pass full DerivationRecord objects. */
  derivations?: unknown[];
  tableId?: string;
  syncedAt?: string;
  attribution?: Partial<Attribution>;
  stalenessWarning?: string | null;
  /** WP23 (#90): the structural answer lines the chat now renders. */
  /** WP26 mechanism B (ADR 024): the defaulted-axis disclosure. */
  assumptionLine?: string | null;
  /** #253: the region-class coverage disclosure line. */
  regionSetLine?: string | null;
  /** ADR 055 / MS1: the multi-region-series coverage disclosure line. */
  regionSeriesLine?: string | null;
  definitionLine?: string | null;
  /** #39: the alternate-reading disclosure line. */
  alternatesLine?: string | null;
  markingLine?: string | null;
  attributionLine?: string;
  /** WP29 (#73): servability-gated follow-up chip texts the chat renders. */
  suggestions?: string[];
  /** #254: every registered alternate reading of the answered measure
   * (Task 2). Defaults to [] like `suggestions` above — callers that need a
   * non-empty fixture pass it explicitly. */
  chartAlternates?: { label: string; spec: ChartSpec }[];
  /** ADR 058 (English answers, Task 8): absent by default (every pre-Task-6
   * fixture, and every Dutch-only turn) — callers exercising the
   * verified/fallback rendering pass it explicitly. */
  english?: EnglishRendering;
} = {}): AnswerResponse {
  const body = opts.body ?? 'Nederland telt 18.044.027 inwoners.';
  const attribution = fakeAttribution({
    ...(opts.tableId !== undefined ? { tableId: opts.tableId } : {}),
    ...(opts.syncedAt !== undefined ? { syncedAt: opts.syncedAt } : {}),
    ...opts.attribution,
  });
  return {
    kind: 'answer',
    text: opts.text ?? body,
    chart: null,
    chartAlternates: opts.chartAlternates ?? [],
    stalenessWarning: opts.stalenessWarning ?? null,
    suggestions: opts.suggestions ?? [],
    ...(opts.english !== undefined ? { english: opts.english } : {}),
    answer: {
      body,
      assumptionLine: opts.assumptionLine ?? null,
      regionSetLine: opts.regionSetLine ?? null,
      regionSeriesLine: opts.regionSeriesLine ?? null,
      definitionLine: opts.definitionLine ?? null,
      alternatesLine: opts.alternatesLine ?? null,
      markingLine: opts.markingLine ?? null,
      attributionLine:
        opts.attributionLine ??
        `Bron: CBS StatLine, tabel ${attribution.tableId} — ${attribution.tableTitle}. Gegevens gesynchroniseerd op ${attribution.syncedAt.slice(0, 10)}. Licentie: CC BY 4.0.`,
    },
    result: {
      ok: true,
      schemaVersion: 1,
      shape: opts.shape ?? 'series',
      cells: opts.cells ?? [],
      derivations: opts.derivations ?? [],
      attribution,
    },
  } as unknown as AnswerResponse;
}

/** ADR 058 (English answers, Task 8): a minimal-but-real EnglishRendering —
 * same discipline as `fakeAnswerResponse` above (every field the web layer
 * reads is present and correctly typed; the deeper Tasks-1–7 machinery
 * fields the web layer never inspects are filled with inert defaults). */
export function fakeEnglishRendering(overrides: Partial<EnglishRendering> = {}): EnglishRendering {
  return {
    schemaVersion: 1,
    status: 'verified',
    promptVersion: 1,
    model: 'claude-sonnet-5',
    maskedDutch: { body: '', chips: [], definition: null, alternates: [] },
    maskTable: [],
    rawTranslation: null,
    attempts: [],
    body: 'The Netherlands has [[N0]] inhabitants.',
    lines: null,
    stalenessWarning: null,
    text: 'The Netherlands has 18,044,027 inhabitants.',
    chips: [],
    untranslatedNames: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// #296 part 2 Task 7: a minimal-but-real SCATTER answer — the envelope
// respond.ts's buildScatterAnswerResponse produces (`chart: null`, `scatter`,
// `pairedResult`, `answer.scatterLine`/`pairedDefinitionLine`, no `english`).
// The Dutch body and coverage line come from the REAL builders over the
// fixture spec, so a test that compares them compares production text.
// ---------------------------------------------------------------------------
export const SCATTER_Y_TABLE = '84639NED';
export const SCATTER_X_TABLE = '03759ned';

export function fakeScatterAxis(overrides: Partial<ScatterAxis> = {}): ScatterAxis {
  return {
    measureTitle: 'Gemiddeld inkomen',
    unit: '1 000 euro',
    decimals: 1,
    periodLabel: '2024',
    tableId: SCATTER_Y_TABLE,
    defaultScale: 'linear',
    attributionLine:
      'Bron: CBS StatLine, tabel 84639NED — Inkomen van huishoudens. Gegevens gesynchroniseerd op 2026-09-20. Periode: 2024. Licentie: CC BY 4.0.',
    canonicalKey: null,
    syncedAt: '2026-09-20T04:00:00.000Z',
    ...overrides,
  };
}

function scatterPoint(code: string, label: string, y: number, yF: string, x: number, xF: string, provisional = false): ScatterPoint {
  return {
    regionCode: code,
    label,
    x,
    y,
    xFormatted: xF,
    yFormatted: yF,
    xResultId: `${SCATTER_X_TABLE}:M2:${code}:2024JJ00`,
    yResultId: `${SCATTER_Y_TABLE}:M1:${code}:2024JJ00`,
    provisional,
  };
}

export function fakeScatterSpec(overrides: Partial<ScatterSpec> = {}): ScatterSpec {
  return {
    schemaVersion: 1,
    kind: 'scatter',
    title: 'Gemiddeld inkomen tegenover bevolking op 1 januari, 2024',
    y: fakeScatterAxis(),
    x: fakeScatterAxis({
      measureTitle: 'Bevolking op 1 januari',
      unit: 'aantal',
      decimals: 0,
      tableId: SCATTER_X_TABLE,
      attributionLine:
        'Bron: CBS StatLine, tabel 03759ned — Bevolking op 1 januari. Gegevens gesynchroniseerd op 2026-09-21. Periode: 2024. Licentie: CC BY 4.0.',
      canonicalKey: 'population_on_1_january',
      syncedAt: '2026-09-21T04:00:00.000Z',
    }),
    points: [
      scatterPoint('PV20', 'Groningen (PV)', 38.2, '38,2', 596075, '596.075'),
      scatterPoint('PV21', 'Fryslân', 36.9, '36,9', 659551, '659.551'),
      scatterPoint('PV27', 'Noord-Holland', 47.5, '47,5', 2952622, '2.952.622'),
    ],
    scope: { kind: 'all_provincies' },
    leftOut: [
      {
        regionCode: 'PV29',
        label: 'Zeeland',
        y: { state: 'withheld', valueAttribute: 'Secret' },
        x: { state: 'value', valueAttribute: null },
      },
    ],
    notApplicableCount: 0,
    labelled: [],
    provisionalNote: null,
    license: 'CC BY 4.0',
    ...overrides,
  };
}

/** One leg's ValidatedResult, cells straight from the spec's own points (so
 * the proof panel, citation and provisional flag read the SAME values the
 * chart plots). */
function scatterLeg(spec: ScatterSpec, side: 'y' | 'x', provisional: boolean): Record<string, unknown> {
  const axis = spec[side];
  return {
    ok: true,
    schemaVersion: 1,
    shape: 'region_set',
    cells: spec.points.map((p) =>
      fakeCell({
        resultId: side === 'y' ? p.yResultId : p.xResultId,
        tableId: axis.tableId,
        measure: side === 'y' ? 'M1' : 'M2',
        measureTitle: axis.measureTitle,
        regionCode: p.regionCode,
        regionLabel: p.label,
        value: p[side],
        decimals: axis.decimals,
        unit: axis.unit,
        provisional,
      }),
    ),
    derivations: [],
    attribution: fakeAttribution({
      tableId: axis.tableId,
      tableTitle: side === 'y' ? 'Inkomen van huishoudens' : 'Bevolking op 1 januari',
      syncedAt: axis.syncedAt,
    }),
  };
}

export function fakeScatterAnswerResponse(opts: {
  spec?: ScatterSpec;
  stalenessWarning?: string | null;
  definitionLine?: string | null;
  pairedDefinitionLine?: string | null;
  /** Marks every cell of ONE leg provisional (the other stays definitive). */
  provisionalLeg?: 'y' | 'x';
} = {}): AnswerResponse {
  const spec = opts.spec ?? fakeScatterSpec();
  const body = scatterBodyNl(spec);
  const scatterLine = scatterLineNl(spec);
  const definitionLine = opts.definitionLine === undefined ? 'Definitie: gemiddeld besteedbaar inkomen per huishouden.' : opts.definitionLine;
  const pairedDefinitionLine =
    opts.pairedDefinitionLine === undefined ? 'Definitie: inwoners op 1 januari.' : opts.pairedDefinitionLine;
  const stalenessWarning = opts.stalenessWarning ?? null;
  const text = [body, '', scatterLine, definitionLine, pairedDefinitionLine, spec.y.attributionLine, spec.x.attributionLine]
    .filter((line): line is string => line !== null)
    .join('\n');
  return {
    kind: 'answer',
    text: stalenessWarning === null ? text : `${text}\n\n${stalenessWarning}`,
    chart: null,
    chartAlternates: [],
    stalenessWarning,
    suggestions: [],
    answer: {
      body,
      scatterLine,
      definitionLine,
      pairedDefinitionLine,
      markingLine: null,
      attributionLine: spec.y.attributionLine,
      text,
    },
    result: scatterLeg(spec, 'y', opts.provisionalLeg === 'y'),
    pairedResult: scatterLeg(spec, 'x', opts.provisionalLeg === 'x'),
    scatter: spec,
  } as unknown as AnswerResponse;
}

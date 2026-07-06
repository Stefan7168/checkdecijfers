// Shared web-layer test fixture: a minimal-but-real AnswerResponse carrying
// the full surface the web layer reads. WP20 established the discipline
// (everything the code under test reads is real and typed-shaped; everything
// it never reads is absent behind one isolated, documented cast); WP21's CSV
// export widened the web read-surface to the whole ValidatedResult (cells
// with codes/dims/status, full attribution), so the fixture now carries
// fully-typed ResultCell and Attribution objects — the compiler, not the
// cast, guarantees their shape.
import type { AnswerResponse } from '../backend/answer/respond/types.ts';
import type { Attribution, ResultCell } from '../backend/query/types.ts';

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
  shape?: 'single' | 'series' | 'comparison' | 'derived';
  cells?: ResultCell[];
  /** Loosely typed on purpose: consumers that only count derivations may
   * pass stubs; CSV tests pass full DerivationRecord objects. */
  derivations?: unknown[];
  tableId?: string;
  syncedAt?: string;
  attribution?: Partial<Attribution>;
  stalenessWarning?: string | null;
  /** WP23 (#90): the structural answer lines the chat now renders. */
  definitionLine?: string | null;
  markingLine?: string | null;
  attributionLine?: string;
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
    stalenessWarning: opts.stalenessWarning ?? null,
    answer: {
      body,
      definitionLine: opts.definitionLine ?? null,
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

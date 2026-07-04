// Shared WP20 test fixture: a minimal AnswerResponse carrying exactly the
// narrow read-surface the web layer touches (answer.body, result.shape/
// cells/derivations/attribution, text, chart) — the same documented
// narrow-cast discipline chat.test.tsx established in WP13: everything the
// code under test reads is real and typed-shaped; everything it never reads
// is absent behind one isolated, documented cast.
import type { AnswerResponse } from '../backend/answer/respond/types.ts';

export interface FakeCell {
  value: number | null;
  decimals: number;
  unit: string;
  measureTitle: string;
  regionLabel: string | null;
  periodLabel: string;
  provisional: boolean;
}

export function fakeCell(overrides: Partial<FakeCell> = {}): FakeCell {
  return {
    value: 3.3,
    decimals: 1,
    unit: '%',
    measureTitle: 'Inflatie (CPI)',
    regionLabel: null,
    periodLabel: '2024',
    provisional: false,
    ...overrides,
  };
}

export function fakeAnswerResponse(opts: {
  body?: string;
  text?: string;
  shape?: 'single' | 'series' | 'comparison' | 'derived';
  cells?: FakeCell[];
  derivations?: unknown[];
  tableId?: string;
  syncedAt?: string;
} = {}): AnswerResponse {
  const body = opts.body ?? 'Nederland telt 18.044.027 inwoners.';
  return {
    kind: 'answer',
    text: opts.text ?? body,
    chart: null,
    answer: { body },
    result: {
      shape: opts.shape ?? 'series',
      cells: opts.cells ?? [],
      derivations: opts.derivations ?? [],
      attribution: {
        tableId: opts.tableId ?? '86141NED',
        syncedAt: opts.syncedAt ?? '2026-07-03T12:00:00.000Z',
      },
    },
  } as unknown as AnswerResponse;
}

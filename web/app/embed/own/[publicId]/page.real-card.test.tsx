// Final-review fix D (ADR 057): the end-to-end P1 proof for the public
// own-data page. Unlike page.test.tsx (which stubs UserChartView to record
// its props), this file renders the REAL card from the REAL server pipeline:
// OwnEmbedPage → buildPublishedChart → firstRenderMatchesEnvelope →
// pruneForPublic → <UserChartView publicView>. Only the DB readers (and
// next/navigation's notFound) are mocked — so every assertion below is about
// what an anonymous visitor's browser would actually receive as text.
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildDatasetProfile } from '../../../../backend/attachments/ingest/profile.ts';
import { renderInstructionForDataset } from '../../../../backend/attachments/render.ts';
import type { ChartInstruction, DatasetTurnRecord, UserDataset } from '../../../../backend/attachments/types.ts';
import type { PublicationRow } from '../../../../backend/attachments/publications.ts';
import { makeCommand, type ChartCommandParams } from '../../../../lib/chart-commands.ts';

const { notFound } = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));
vi.mock('next/navigation', () => ({ notFound }));

const { getPublicationByPublicId } = vi.hoisted(() => ({ getPublicationByPublicId: vi.fn() }));
vi.mock('../../../../backend/attachments/publications.ts', async () => {
  const actual = await vi.importActual<typeof import('../../../../backend/attachments/publications.ts')>(
    '../../../../backend/attachments/publications.ts',
  );
  return { getPublicationByPublicId, isPublicIdShape: actual.isPublicIdShape };
});

const { getDatasetTurnById } = vi.hoisted(() => ({ getDatasetTurnById: vi.fn() }));
vi.mock('../../../../backend/attachments/read.ts', () => ({ getDatasetTurnById }));

const { getDataset } = vi.hoisted(() => ({ getDataset: vi.fn() }));
vi.mock('../../../../backend/attachments/store.ts', () => ({ getDataset }));

vi.mock('../../../../backend/chart/user-styles.ts', () => ({
  chartStylesTablePresent: vi.fn(async () => false),
  getUserChartStyle: vi.fn(async () => null),
}));

vi.mock('../../../../lib/db.ts', () => ({ getDb: vi.fn(() => ({})) }));

import OwnEmbedPage from './page.tsx';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  delete process.env.OWN_DATA_PUBLISH_ENABLED;
});

function datasetOf(id: number, cells: string[][]): UserDataset {
  return {
    id,
    userId: 'author-1',
    sourceKind: 'file_csv',
    displayName: 'klanten_vertrouwelijk.csv',
    sourceUrl: 'https://intranet.example.com/x.csv',
    cells,
    profile: buildDatasetProfile(cells),
    status: 'ready',
    contentSha256: 'deadbeefcafe',
    createdAt: '2026-09-06T00:00:00Z',
  };
}

function instructionOf(kind: 'bar' | 'line'): Record<string, unknown> {
  return {
    version: 2,
    kind,
    x: 'c1',
    y: ['c2'],
    seriesBy: 'c0',
    filters: [],
    sort: null,
    limit: null,
    aggregate: null,
    derived: null,
    unsupported: null,
    reading: '',
    confidence: 1,
  };
}

/** Wires the three DB readers for one publication, with the turn's envelope
 * carrying the chart as first made (so the A3 drift guard runs for real). */
function publish(dataset: UserDataset, instruction: Record<string, unknown>, log: ChartCommandParams[]): void {
  const first = renderInstructionForDataset(dataset, instruction as unknown as ChartInstruction);
  if (first.kind !== 'ok') throw new Error('fixture instruction must render');
  const turn = {
    id: 7,
    userId: 'author-1',
    datasetId: dataset.id,
    threadId: 1,
    requestId: 'req-1',
    kind: 'chart',
    question: 'q',
    envelope: { schemaVersion: 1, kind: 'chart', question: 'q', text: 't', instruction, chart: first.chart },
    finalText: 't',
    instruction,
    chartEmitted: true,
    promptVersions: {},
    llmCalls: [],
    inputTokens: 0,
    outputTokens: 0,
    latencyMs: 0,
    createdAt: '2026-09-10T12:00:00.000Z',
  } as unknown as DatasetTurnRecord;
  const row: PublicationRow = {
    id: 1,
    publicId: 'A'.repeat(22),
    userId: 'author-1',
    datasetId: dataset.id,
    datasetTurnId: 7,
    log: log.map((params) => makeCommand(params, 'panel')),
    sourceLine: 'eigen administratie',
    createdAt: '2026-09-10T12:00:00.000Z',
    updatedAt: '2026-09-10T12:00:00.000Z',
  };
  getPublicationByPublicId.mockResolvedValue(row);
  getDatasetTurnById.mockResolvedValue(turn);
  getDataset.mockResolvedValue(dataset);
}

async function renderPage(): Promise<HTMLElement> {
  process.env.OWN_DATA_PUBLISH_ENABLED = '1';
  const { container } = render(await OwnEmbedPage({ params: Promise.resolve({ publicId: 'A'.repeat(22) }), searchParams: Promise.resolve({ lang: 'en' }) }));
  return container;
}

// x = customer, series = segment. 'Minister X' is a customer ONLY the VIP
// segment has (A1); VIP's two values (777, 555) are distinctive.
const SEGMENT_CELLS = [
  ['Segment', 'Klant', 'Omzet'],
  ['VIP', 'Minister X', '777'],
  ['VIP', 'Bakker', '555'],
  ['Normaal', 'Bakker', '50'],
  ['Normaal', 'Jansen', '60'],
];

function expectNoVipTrace(text: string): void {
  expect(text).not.toContain('VIP');
  expect(text).not.toContain('Minister X');
  expect(text).not.toContain('777');
  expect(text).not.toContain('555');
  // The file's own name, the source host and the hash never reach a visitor either.
  expect(text).not.toContain('klanten_vertrouwelijk');
  expect(text).not.toContain('intranet.example.com');
  expect(text).not.toContain('deadbeefcafe');
}

describe('/embed/own/[publicId] — the REAL card from the REAL pipeline never shows a hidden series (P1)', () => {
  it('a category only the hidden series has (A1) is not on the page — the chart form', async () => {
    publish(datasetOf(51, SEGMENT_CELLS), instructionOf('bar'), [{ kind: 'toggleSeries', key: 's0' }]);
    const container = await renderPage();
    expect(container.textContent).not.toMatch(/no longer available/i);
    expectNoVipTrace(container.textContent ?? '');
    // The visible series is really rendered (the page is not simply empty).
    expect(container.textContent).toContain('Normaal');
  });

  it('form = table: no hidden column, no hidden-only row, no hidden value', async () => {
    publish(datasetOf(52, SEGMENT_CELLS), instructionOf('bar'), [
      { kind: 'setForm', form: 'table' },
      { kind: 'toggleSeries', key: 's0' },
    ]);
    const container = await renderPage();
    const table = container.querySelector('table');
    expect(table).not.toBeNull();
    expectNoVipTrace(container.textContent ?? '');
    expect([...table!.querySelectorAll('thead th')].map((th) => th.textContent)).toEqual(['Klant', 'Normaal']);
    expect([...table!.querySelectorAll('tbody th')].map((th) => th.textContent)).toEqual(['Bakker', 'Jansen']);
    expect(table!.textContent).toContain('50');
    expect(table!.textContent).toContain('60');
  });

  it('form = heatmap: the grid draws the visible series only; the hidden one leaves no trace', async () => {
    // A complete segment × region grid (the heatmap needs every cell), with
    // the hidden segment's values distinctive.
    const cells = [
      ['Segment', 'Regio', 'Omzet'],
      ['Geheim segment', 'Noord', '901'],
      ['Geheim segment', 'Zuid', '902'],
      ['Retail', 'Noord', '11'],
      ['Retail', 'Zuid', '12'],
      ['Horeca', 'Noord', '21'],
      ['Horeca', 'Zuid', '22'],
    ];
    publish(datasetOf(53, cells), instructionOf('bar'), [
      { kind: 'setForm', form: 'heatmap' },
      { kind: 'toggleSeries', key: 's0' },
    ]);
    const container = await renderPage();
    const grid = container.querySelector('[data-testid="user-heatmap-grid"]');
    expect(grid).not.toBeNull();
    const text = container.textContent ?? '';
    expect(text).not.toContain('Geheim segment');
    expect(text).not.toContain('901');
    expect(text).not.toContain('902');
    expect([...grid!.querySelectorAll('[role="columnheader"]')].map((h) => h.textContent)).toEqual(['Regio', 'Retail', 'Horeca']);
    expect(grid!.textContent).toContain('11');
    expect(grid!.textContent).toContain('22');
  });
});

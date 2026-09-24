// Task 5 (ADR 057, spec §3.3): the public, no-auth /embed/own/[publicId]
// route — the own-data twin of /embed/[token] (that route's own page.test.tsx
// is this file's structural model: mock every dependency via vi.mock, call
// OwnEmbedPage({ params, searchParams }) directly and render(await ...) the
// result — no real Next.js server context exists in jsdom, so next/
// navigation's `notFound` is mocked to throw (matching its real behaviour: it
// aborts rendering via a thrown, digest-tagged error).
//
// Unlike the CBS route, this file mocks ONLY the DB readers
// (getPublicationByPublicId, getDatasetTurnById, getDataset,
// chartStylesTablePresent, getUserChartStyle) plus the client chart card
// itself (UserChartView, stubbed to record its props). `buildPublishedChart`
// and `pruneForPublic` (web/lib/own-chart-publication.ts) are the REAL,
// pure implementations — reused verbatim from that module's own test fixture
// (web/lib/own-chart-publication.test.ts) — so the digit/leak assertions
// below prove something about the REAL prune, not a stubbed one.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Metadata } from 'next';
import { buildDatasetProfile } from '../../../../backend/attachments/ingest/profile.ts';
import type { DatasetTurnRecord, UserDataset } from '../../../../backend/attachments/types.ts';
import type { PublicationRow } from '../../../../backend/attachments/publications.ts';
import { makeCommand } from '../../../../lib/chart-commands.ts';

const { notFound } = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));
vi.mock('next/navigation', () => ({ notFound }));

const { getPublicationByPublicId } = vi.hoisted(() => ({ getPublicationByPublicId: vi.fn() }));
// isPublicIdShape is real, pure logic (a 22-char base64url regex, publications.ts's
// own PUBLIC_ID_PATTERN) — reimplemented inline rather than imported, same
// "keep the pure guard real, mock only the DB call" precedent the CBS route's
// own test sets for isRedacted.
vi.mock('../../../../backend/attachments/publications.ts', () => ({
  getPublicationByPublicId,
  isPublicIdShape: (s: unknown) => typeof s === 'string' && /^[A-Za-z0-9_-]{22}$/.test(s),
}));

const { getDatasetTurnById } = vi.hoisted(() => ({ getDatasetTurnById: vi.fn() }));
vi.mock('../../../../backend/attachments/read.ts', () => ({ getDatasetTurnById }));

const { getDataset } = vi.hoisted(() => ({ getDataset: vi.fn() }));
vi.mock('../../../../backend/attachments/store.ts', () => ({ getDataset }));

const { chartStylesTablePresent, getUserChartStyle } = vi.hoisted(() => ({
  chartStylesTablePresent: vi.fn(async () => false),
  getUserChartStyle: vi.fn(async () => null as { style: Record<string, unknown>; brand: unknown; updatedAt: string } | null),
}));
vi.mock('../../../../backend/chart/user-styles.ts', () => ({ chartStylesTablePresent, getUserChartStyle }));

const { getDb } = vi.hoisted(() => ({ getDb: vi.fn(() => ({})) }));
vi.mock('../../../../lib/db.ts', () => ({ getDb }));

// Stub records the props UserChartView was actually called with — the real
// card (web/components/user-chart.tsx) has its own render tests; this route
// only needs to prove it WIRES the pruned spec/state/overlays/sourceLine/
// accountStyle through correctly.
const { userChartViewProps } = vi.hoisted(() => ({ userChartViewProps: { current: null as unknown } }));
vi.mock('../../../../components/user-chart.tsx', () => ({
  UserChartView: (props: unknown) => {
    userChartViewProps.current = props;
    return null;
  },
}));

import OwnEmbedPage, { metadata } from './page.tsx';

// Verbatim from web/lib/own-chart-publication.test.ts's own fixture: a
// dataset with a "secret" series (Geheim BV) and a confidential file name,
// so the digit/leak assertions below prove real pruning, not a fixture that
// happens to have nothing to leak.
const CELLS = [
  ['Jaar', 'Klant', 'Omzet'],
  ['2020', 'Geheim BV', '120,5'],
  ['2020', 'Open NV', '80,0'],
  ['2021', 'Geheim BV', '150,0'],
  ['2021', 'Open NV', '90,0'],
];
const DATASET: UserDataset = {
  id: 42,
  userId: 'author-1',
  sourceKind: 'file_csv',
  displayName: 'klanten_vertrouwelijk.csv',
  sourceUrl: 'https://intranet.example.com/x.csv',
  cells: CELLS,
  profile: buildDatasetProfile(CELLS),
  status: 'ready',
  contentSha256: 'deadbeefcafe',
  createdAt: '2026-09-06T00:00:00Z',
};
const INSTRUCTION = {
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
  reading: '',
  confidence: 1,
};
function turn(overrides: Partial<DatasetTurnRecord> = {}): DatasetTurnRecord {
  return {
    id: 7,
    userId: 'author-1',
    datasetId: 42,
    threadId: 1,
    requestId: 'req-1',
    kind: 'chart',
    question: 'q',
    envelope: { schemaVersion: 1, kind: 'chart', question: 'q', text: 't', instruction: INSTRUCTION } as unknown as DatasetTurnRecord['envelope'],
    finalText: 't',
    instruction: INSTRUCTION as unknown as DatasetTurnRecord['instruction'],
    chartEmitted: true,
    promptVersions: {},
    llmCalls: [],
    inputTokens: 0,
    outputTokens: 0,
    latencyMs: 0,
    createdAt: '2026-09-10T12:00:00.000Z',
    ...overrides,
  };
}
function row(overrides: Partial<PublicationRow> = {}): PublicationRow {
  return {
    id: 1,
    publicId: 'A'.repeat(22),
    userId: 'author-1',
    datasetId: 42,
    datasetTurnId: 7,
    log: [makeCommand({ kind: 'toggleSeries', key: 's0' }, 'panel')],
    sourceLine: 'Bron: eigen administratie',
    createdAt: '2026-09-10T12:00:00.000Z',
    updatedAt: '2026-09-10T12:00:00.000Z',
    ...overrides,
  };
}

function params(publicId: string) {
  return Promise.resolve({ publicId });
}
function search(query: { lang?: string } = {}) {
  return Promise.resolve(query);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  chartStylesTablePresent.mockResolvedValue(false);
  getUserChartStyle.mockResolvedValue(null);
  userChartViewProps.current = null;
  delete process.env.OWN_DATA_PUBLISH_ENABLED;
});

describe('/embed/own/[publicId] — flag + shape gates', () => {
  it('calls notFound when OWN_DATA_PUBLISH_ENABLED is not "1", without touching the DB', async () => {
    await expect(OwnEmbedPage({ params: params('A'.repeat(22)), searchParams: search() })).rejects.toThrow();
    expect(notFound).toHaveBeenCalled();
    expect(getPublicationByPublicId).not.toHaveBeenCalled();
  });

  it('calls notFound on a malformed publicId, without touching the DB', async () => {
    process.env.OWN_DATA_PUBLISH_ENABLED = '1';
    await expect(OwnEmbedPage({ params: params('not-shaped'), searchParams: search() })).rejects.toThrow();
    expect(notFound).toHaveBeenCalled();
    expect(getPublicationByPublicId).not.toHaveBeenCalled();
  });
});

describe('/embed/own/[publicId] — not-available branches (never a 404)', () => {
  it('shows the not-available page when the publication row is missing, with no chart rendered', async () => {
    process.env.OWN_DATA_PUBLISH_ENABLED = '1';
    getPublicationByPublicId.mockResolvedValue(null);
    render(await OwnEmbedPage({ params: params('A'.repeat(22)), searchParams: search({ lang: 'en' }) }));
    expect(screen.getByText(/no longer available/i)).toBeInTheDocument();
    expect(notFound).not.toHaveBeenCalled();
    expect(userChartViewProps.current).toBeNull();
  });

  it('shows the not-available page when the dataset is redacted', async () => {
    process.env.OWN_DATA_PUBLISH_ENABLED = '1';
    getPublicationByPublicId.mockResolvedValue(row());
    getDatasetTurnById.mockResolvedValue(turn());
    getDataset.mockResolvedValue({ ...DATASET, status: 'redacted' });
    render(await OwnEmbedPage({ params: params('A'.repeat(22)), searchParams: search({ lang: 'en' }) }));
    expect(screen.getByText(/no longer available/i)).toBeInTheDocument();
    expect(userChartViewProps.current).toBeNull();
  });

  it('shows the not-available page when the turn belongs to a different user than the publication row', async () => {
    process.env.OWN_DATA_PUBLISH_ENABLED = '1';
    getPublicationByPublicId.mockResolvedValue(row());
    getDatasetTurnById.mockResolvedValue(turn({ userId: 'someone-else' }));
    render(await OwnEmbedPage({ params: params('A'.repeat(22)), searchParams: search({ lang: 'en' }) }));
    expect(screen.getByText(/no longer available/i)).toBeInTheDocument();
    expect(getDataset).not.toHaveBeenCalled();
    expect(userChartViewProps.current).toBeNull();
  });

  // R2 ruling: besides turn.userId !== row.userId, a turn whose OWN
  // datasetId disagrees with the row's must also refuse — defence in depth
  // against the two ever silently drifting apart (mirrors
  // own-chart-publish-actions.ts's own `dataset.id !== turn.datasetId` check).
  it('shows the not-available page when the turn\'s datasetId disagrees with the publication row\'s', async () => {
    process.env.OWN_DATA_PUBLISH_ENABLED = '1';
    getPublicationByPublicId.mockResolvedValue(row());
    getDatasetTurnById.mockResolvedValue(turn({ datasetId: 999 }));
    render(await OwnEmbedPage({ params: params('A'.repeat(22)), searchParams: search({ lang: 'en' }) }));
    expect(screen.getByText(/no longer available/i)).toBeInTheDocument();
    expect(userChartViewProps.current).toBeNull();
  });

  it('shows the not-available page when the turn is missing', async () => {
    process.env.OWN_DATA_PUBLISH_ENABLED = '1';
    getPublicationByPublicId.mockResolvedValue(row());
    getDatasetTurnById.mockResolvedValue(null);
    render(await OwnEmbedPage({ params: params('A'.repeat(22)), searchParams: search({ lang: 'en' }) }));
    expect(screen.getByText(/no longer available/i)).toBeInTheDocument();
  });

  it('shows the not-available page when the dataset is missing', async () => {
    process.env.OWN_DATA_PUBLISH_ENABLED = '1';
    getPublicationByPublicId.mockResolvedValue(row());
    getDatasetTurnById.mockResolvedValue(turn());
    getDataset.mockResolvedValue(null);
    render(await OwnEmbedPage({ params: params('A'.repeat(22)), searchParams: search({ lang: 'en' }) }));
    expect(screen.getByText(/no longer available/i)).toBeInTheDocument();
  });

  it('shows the not-available page when buildPublishedChart is not ok (e.g. a redacted/instruction-less turn)', async () => {
    process.env.OWN_DATA_PUBLISH_ENABLED = '1';
    getPublicationByPublicId.mockResolvedValue(row());
    getDatasetTurnById.mockResolvedValue(turn({ instruction: null }));
    getDataset.mockResolvedValue(DATASET);
    render(await OwnEmbedPage({ params: params('A'.repeat(22)), searchParams: search({ lang: 'en' }) }));
    expect(screen.getByText(/no longer available/i)).toBeInTheDocument();
  });

  it('defaults the not-available text to Dutch when ?lang is absent', async () => {
    process.env.OWN_DATA_PUBLISH_ENABLED = '1';
    getPublicationByPublicId.mockResolvedValue(null);
    render(await OwnEmbedPage({ params: params('A'.repeat(22)), searchParams: search() }));
    expect(screen.getByText(/niet meer beschikbaar/i)).toBeInTheDocument();
  });

  it('the not-available page is digit-free', async () => {
    process.env.OWN_DATA_PUBLISH_ENABLED = '1';
    getPublicationByPublicId.mockResolvedValue(null);
    const { container } = render(await OwnEmbedPage({ params: params('A'.repeat(22)), searchParams: search({ lang: 'en' }) }));
    expect(container.textContent).not.toMatch(/\d/);
  });
});

describe('/embed/own/[publicId] — happy path', () => {
  it('renders the pruned chart via UserChartView, with the hidden series and file name scrubbed', async () => {
    process.env.OWN_DATA_PUBLISH_ENABLED = '1';
    getPublicationByPublicId.mockResolvedValue(row());
    getDatasetTurnById.mockResolvedValue(turn());
    getDataset.mockResolvedValue(DATASET);
    render(await OwnEmbedPage({ params: params('A'.repeat(22)), searchParams: search() }));

    expect(userChartViewProps.current).not.toBeNull();
    const json = JSON.stringify(userChartViewProps.current);
    // Hidden series (s0 = Geheim BV, toggled off by row().log above).
    expect(json).not.toContain('Geheim BV');
    expect(json).not.toContain('120,5');
    expect(json).not.toContain('150,0');
    // The dataset's own file name — never shown publicly (spec §3.5).
    expect(json).not.toContain('klanten_vertrouwelijk');
    expect(json).not.toContain('intranet.example.com');
    expect(json).not.toContain('deadbeefcafe');
    // The still-visible series survives.
    expect(json).toContain('Open NV');
  });

  it('passes the row\'s sourceLine straight through publicView.sourceLine', async () => {
    process.env.OWN_DATA_PUBLISH_ENABLED = '1';
    getPublicationByPublicId.mockResolvedValue(row({ sourceLine: 'Bron: mijn eigen administratie' }));
    getDatasetTurnById.mockResolvedValue(turn());
    getDataset.mockResolvedValue(DATASET);
    render(await OwnEmbedPage({ params: params('A'.repeat(22)), searchParams: search() }));
    const props = userChartViewProps.current as { publicView: { sourceLine: string | null } };
    expect(props.publicView.sourceLine).toBe('Bron: mijn eigen administratie');
  });

  it('resolves the author\'s account style via getUserChartStyle when the table is present, and hands it through as publicView.accountStyle', async () => {
    process.env.OWN_DATA_PUBLISH_ENABLED = '1';
    chartStylesTablePresent.mockResolvedValue(true);
    getUserChartStyle.mockResolvedValue({ style: { fontFamily: 'Georgia' }, brand: null, updatedAt: '2026-09-01T00:00:00Z' });
    getPublicationByPublicId.mockResolvedValue(row());
    getDatasetTurnById.mockResolvedValue(turn());
    getDataset.mockResolvedValue(DATASET);
    render(await OwnEmbedPage({ params: params('A'.repeat(22)), searchParams: search() }));
    expect(getUserChartStyle).toHaveBeenCalledWith(expect.anything(), 'author-1');
    const props = userChartViewProps.current as { publicView: { accountStyle: unknown } };
    expect(props.publicView.accountStyle).toEqual({ fontFamily: 'Georgia' });
  });

  it('never calls getUserChartStyle when the style table is absent, and renders with a null accountStyle', async () => {
    process.env.OWN_DATA_PUBLISH_ENABLED = '1';
    chartStylesTablePresent.mockResolvedValue(false);
    getPublicationByPublicId.mockResolvedValue(row());
    getDatasetTurnById.mockResolvedValue(turn());
    getDataset.mockResolvedValue(DATASET);
    render(await OwnEmbedPage({ params: params('A'.repeat(22)), searchParams: search() }));
    expect(getUserChartStyle).not.toHaveBeenCalled();
    const props = userChartViewProps.current as { publicView: { accountStyle: unknown } };
    expect(props.publicView.accountStyle).toBeNull();
  });

  // Carried from Task 4's review: a style-load failure must not break the
  // page — render without it rather than falling through to not-available or
  // throwing.
  it('still renders the chart with a null accountStyle when loading the style throws', async () => {
    process.env.OWN_DATA_PUBLISH_ENABLED = '1';
    chartStylesTablePresent.mockResolvedValue(true);
    getUserChartStyle.mockRejectedValue(new Error('pool exhausted'));
    getPublicationByPublicId.mockResolvedValue(row());
    getDatasetTurnById.mockResolvedValue(turn());
    getDataset.mockResolvedValue(DATASET);
    render(await OwnEmbedPage({ params: params('A'.repeat(22)), searchParams: search() }));
    expect(userChartViewProps.current).not.toBeNull();
    const props = userChartViewProps.current as { publicView: { accountStyle: unknown } };
    expect(props.publicView.accountStyle).toBeNull();
  });

  // Spec §3.2 / this task's own ruling: an old log that no longer fully
  // replays (dropped > 0) still renders what DOES replay — never an error —
  // since the chart is still valid and pruned; only the publish ACTION
  // (own-chart-publish-actions.ts) refuses a nonzero drop count at write time.
  it('still renders when the stored log no longer fully replays (dropped > 0), rather than showing an error', async () => {
    process.env.OWN_DATA_PUBLISH_ENABLED = '1';
    getPublicationByPublicId.mockResolvedValue(
      row({ log: [makeCommand({ kind: 'toggleSeries', key: 's0' }, 'panel'), { kind: 'toggleSeries', key: 's9' }] }),
    );
    getDatasetTurnById.mockResolvedValue(turn());
    getDataset.mockResolvedValue(DATASET);
    render(await OwnEmbedPage({ params: params('A'.repeat(22)), searchParams: search() }));
    expect(screen.queryByText(/no longer available/i)).not.toBeInTheDocument();
    expect(userChartViewProps.current).not.toBeNull();
  });

  it('sets noindex via the exported metadata', () => {
    expect((metadata as Metadata).robots).toEqual({ index: false, follow: false });
  });

  it('renders a footer link to APP_URL', async () => {
    process.env.OWN_DATA_PUBLISH_ENABLED = '1';
    getPublicationByPublicId.mockResolvedValue(row());
    getDatasetTurnById.mockResolvedValue(turn());
    getDataset.mockResolvedValue(DATASET);
    const { container } = render(await OwnEmbedPage({ params: params('A'.repeat(22)), searchParams: search() }));
    const link = container.querySelector('a[href]');
    expect(link).not.toBeNull();
    expect(link!.getAttribute('href')).toBe(process.env.NEXT_PUBLIC_APP_URL ?? 'https://checkdecijfers.nl');
    expect(link!.getAttribute('target')).toBe('_blank');
    expect(link!.getAttribute('rel')).toBe('noopener');
  });

  it('shows the Dutch footer copy by default, and the English one for ?lang=en', async () => {
    process.env.OWN_DATA_PUBLISH_ENABLED = '1';
    getPublicationByPublicId.mockResolvedValue(row());
    getDatasetTurnById.mockResolvedValue(turn());
    getDataset.mockResolvedValue(DATASET);
    render(await OwnEmbedPage({ params: params('A'.repeat(22)), searchParams: search() }));
    expect(screen.getByText(/gemaakt met checkdecijfers/i)).toBeInTheDocument();
    cleanup();
    render(await OwnEmbedPage({ params: params('A'.repeat(22)), searchParams: search({ lang: 'en' }) }));
    expect(screen.getByText(/made with checkdecijfers/i)).toBeInTheDocument();
  });
});

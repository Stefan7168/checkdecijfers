// Task 5 (ADR 041 / spec Part B3): the public, no-auth /embed/[token] route —
// FROZEN render only (the `?live=1` branch is Task 6's job; this file never
// reads that param). Follows web/app/login/page.test.tsx's idiom: mock every
// dependency via vi.mock, call `EmbedPage({ params, searchParams })` directly
// and `render(await ...)` the result — no real Next.js server context exists
// in jsdom, so next/navigation's `notFound` is mocked to throw (matching its
// real behaviour: it aborts rendering via a thrown, digest-tagged error).
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuditRecord } from '../../../backend/answer/audit/types.ts';

const { notFound } = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));
vi.mock('next/navigation', () => ({ notFound }));

const { verifyEmbedToken } = vi.hoisted(() => ({ verifyEmbedToken: vi.fn() }));
vi.mock('../../../backend/chart/embed-token.ts', () => ({ verifyEmbedToken }));

const { loadAuditRecord } = vi.hoisted(() => ({ loadAuditRecord: vi.fn() }));
vi.mock('../../../backend/answer/audit/index.ts', () => ({ loadAuditRecord }));

const { getDb } = vi.hoisted(() => ({ getDb: vi.fn(() => ({})) }));
vi.mock('../../../lib/db.ts', () => ({ getDb }));

import EmbedPage, { metadata } from './page.tsx';

// A full, valid ChartSpec — not the sparse shape a naive fixture would
// reach for. ChartView's `spec.schemaVersion !== 1` guard (and its direct
// reads of dims/dimLabels/unit/attributionLine etc.) bail into a "made in a
// newer version" fallback render on anything less complete, which silently
// swallowed the embedFooter assertions below until this was discovered
// RED — mirrors chart.test.tsx's own `spec()`/`point()` fixture builders.
function point(overrides: Record<string, unknown> = {}) {
  return {
    resultId: 'r1',
    periodCode: '2024JJ00',
    periodLabel: '2024',
    value: 42,
    formattedValue: '42,0',
    decimals: 1,
    status: 'Definitief',
    provisional: false,
    valueAttribute: 'None',
    ...overrides,
  };
}

function chartSpec(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    kind: 'line',
    title: 'Testreeks',
    dims: { Kenmerk: '000000' },
    dimLabels: { Kenmerk: 'Alle kenmerken' },
    unit: '%',
    series: [{ label: 'Nederland', regionCode: 'NL01', points: [point()] }],
    provisionalNote: null,
    nullNotes: [],
    definitionLine: null,
    attributionLine: 'Bron: CBS StatLine, tabel 83693NED.',
    attribution: {
      tableId: '83693NED',
      tableTitle: 'Test',
      tableVersion: 1,
      syncedAt: '2026-08-26',
      coveredPeriods: { from: '2024', to: '2024' },
      license: 'CC BY 4.0',
    },
    ...overrides,
  };
}

// Loosely typed and cast, same rationale as embed-actions.test.ts's own
// baseRecord: every fixture supplies only the handful of keys the route's
// guard actually reads (kind, chart, redacted, createdAt) — tightening this
// to the full ComposedResponse discriminated union would only fight the
// fixtures, never catch a real bug.
function answerRecord(overrides: Record<string, unknown> = {}): AuditRecord {
  return {
    id: 42,
    createdAt: '2026-09-10T12:00:00.000Z',
    response: {
      kind: 'answer',
      chart: chartSpec(),
    },
    ...overrides,
  } as unknown as AuditRecord;
}

function params(token: string) {
  return Promise.resolve({ token });
}

// Fix round (Task 5 review, Piece 3): widened from `{ lang?: string }` to the
// route's real full searchParams shape so ?theme=/?form= tests below don't
// need a cast at every call site — every EXISTING call site that only ever
// passed `{ lang }` stays valid unchanged (a narrower object literal is
// still assignable to this wider optional-fields type).
function search(query: { lang?: string; theme?: string; form?: string; live?: string } = {}) {
  return Promise.resolve(query);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  delete process.env.EMBED_TOKEN_SECRET;
});

describe('/embed/[token] — frozen render', () => {
  it('calls notFound when EMBED_TOKEN_SECRET is unset', async () => {
    await expect(EmbedPage({ params: params('x'), searchParams: search() })).rejects.toThrow();
    expect(notFound).toHaveBeenCalled();
    expect(verifyEmbedToken).not.toHaveBeenCalled();
  });

  it('calls notFound on an invalid/tampered token', async () => {
    process.env.EMBED_TOKEN_SECRET = 's3cr3t';
    verifyEmbedToken.mockReturnValue(null);
    await expect(EmbedPage({ params: params('bad'), searchParams: search() })).rejects.toThrow();
    expect(notFound).toHaveBeenCalled();
    expect(verifyEmbedToken).toHaveBeenCalledWith('bad', 's3cr3t');
    expect(loadAuditRecord).not.toHaveBeenCalled();
  });

  it('calls notFound when the audit row does not exist', async () => {
    process.env.EMBED_TOKEN_SECRET = 's3cr3t';
    verifyEmbedToken.mockReturnValue(42);
    loadAuditRecord.mockResolvedValue(null);
    await expect(EmbedPage({ params: params('42.sig'), searchParams: search() })).rejects.toThrow();
    expect(notFound).toHaveBeenCalled();
  });

  it('shows a digit-free "no longer available" page for a redacted row, without 404ing', async () => {
    process.env.EMBED_TOKEN_SECRET = 's3cr3t';
    verifyEmbedToken.mockReturnValue(42);
    loadAuditRecord.mockResolvedValue(answerRecord({ response: { kind: 'answer', chart: null, redacted: true } }));
    const { container } = render(await EmbedPage({ params: params('42.sig'), searchParams: search({ lang: 'en' }) }));
    expect(screen.getByText(/no longer available/i)).toBeInTheDocument();
    expect(notFound).not.toHaveBeenCalled();
    expect(container.textContent).not.toMatch(/\d/);
  });

  it('shows the not-available page for a non-answer row (clarification/refusal), without 404ing', async () => {
    process.env.EMBED_TOKEN_SECRET = 's3cr3t';
    verifyEmbedToken.mockReturnValue(42);
    loadAuditRecord.mockResolvedValue(answerRecord({ response: { kind: 'clarification' } }));
    render(await EmbedPage({ params: params('42.sig'), searchParams: search() }));
    expect(screen.getByText(/niet meer beschikbaar/i)).toBeInTheDocument();
    expect(notFound).not.toHaveBeenCalled();
  });

  it('shows the not-available page for a chart-less answer row (no redacted flag needed)', async () => {
    process.env.EMBED_TOKEN_SECRET = 's3cr3t';
    verifyEmbedToken.mockReturnValue(42);
    loadAuditRecord.mockResolvedValue(answerRecord({ response: { kind: 'answer', chart: null } }));
    render(await EmbedPage({ params: params('42.sig'), searchParams: search({ lang: 'en' }) }));
    expect(screen.getByText(/no longer available/i)).toBeInTheDocument();
  });

  it('defaults the not-available text to Dutch when ?lang is absent', async () => {
    process.env.EMBED_TOKEN_SECRET = 's3cr3t';
    verifyEmbedToken.mockReturnValue(42);
    loadAuditRecord.mockResolvedValue(answerRecord({ response: { kind: 'answer', chart: null, redacted: true } }));
    render(await EmbedPage({ params: params('42.sig'), searchParams: search() }));
    expect(screen.getByText(/deze grafiek is niet meer beschikbaar/i)).toBeInTheDocument();
  });

  it('renders the frozen chart with an embedMode ChartView and a Frozen-on footer', async () => {
    process.env.EMBED_TOKEN_SECRET = 's3cr3t';
    verifyEmbedToken.mockReturnValue(42);
    loadAuditRecord.mockResolvedValue(answerRecord());
    render(await EmbedPage({ params: params('42.sig'), searchParams: search({ lang: 'en' }) }));
    expect(screen.getByText(/frozen on/i)).toBeInTheDocument();
    expect(screen.getByText(/2026-09-10/)).toBeInTheDocument();
    // The attribution line AND the SourceBadge each independently render the
    // table id (chart.test.tsx's own embedMode coverage hits this same
    // "two occurrences" shape) — getAllByText, not getByText.
    expect(screen.getAllByText(/83693NED/).length).toBeGreaterThanOrEqual(2);
    expect(notFound).not.toHaveBeenCalled();
  });

  it('defaults the frozen footer to Dutch ("Bevroren op") when ?lang is absent', async () => {
    process.env.EMBED_TOKEN_SECRET = 's3cr3t';
    verifyEmbedToken.mockReturnValue(42);
    loadAuditRecord.mockResolvedValue(answerRecord());
    render(await EmbedPage({ params: params('42.sig'), searchParams: search() }));
    expect(screen.getByText(/bevroren op/i)).toBeInTheDocument();
  });

  it('falls back to Dutch on an unrecognised ?lang value (e.g. "fr")', async () => {
    process.env.EMBED_TOKEN_SECRET = 's3cr3t';
    verifyEmbedToken.mockReturnValue(42);
    loadAuditRecord.mockResolvedValue(answerRecord());
    render(await EmbedPage({ params: params('42.sig'), searchParams: search({ lang: 'fr' }) }));
    expect(screen.getByText(/bevroren op/i)).toBeInTheDocument();
  });

  it('sets noindex via the exported metadata', () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
});

// ---------------------------------------------------------------------------
// Fix round (Task 5 review, Piece 3): `?theme=` and `?form=`, both already
// emitted by Task 4's embed dialog (chart-embed-dialog.tsx) but previously
// never read by this route at all.
// ---------------------------------------------------------------------------
describe('/embed/[token] — ?theme= and ?form= (fix round, Piece 3)', () => {
  it('?form=bar results in the bar (Staaf) form actually rendering, for a spec that allows it', async () => {
    process.env.EMBED_TOKEN_SECRET = 's3cr3t';
    verifyEmbedToken.mockReturnValue(42);
    loadAuditRecord.mockResolvedValue(answerRecord());
    const { container } = render(
      await EmbedPage({ params: params('42.sig'), searchParams: search({ form: 'bar' }) }),
    );
    expect(container.querySelector('.recharts-bar')).not.toBeNull();
    expect(container.querySelector('.recharts-line')).toBeNull();
  });

  it('an invalid ?form= value is ignored — the spec\'s own default form still renders', async () => {
    process.env.EMBED_TOKEN_SECRET = 's3cr3t';
    verifyEmbedToken.mockReturnValue(42);
    loadAuditRecord.mockResolvedValue(answerRecord()); // kind: 'line' -> defaults to Lijn
    const { container } = render(
      await EmbedPage({ params: params('42.sig'), searchParams: search({ form: 'pie' }) }),
    );
    expect(container.querySelector('.recharts-line')).not.toBeNull();
  });

  it('?theme=dark wraps the chart in a "dark" class, forcing Tailwind\'s dark-mode variant', async () => {
    process.env.EMBED_TOKEN_SECRET = 's3cr3t';
    verifyEmbedToken.mockReturnValue(42);
    loadAuditRecord.mockResolvedValue(answerRecord());
    const { container } = render(
      await EmbedPage({ params: params('42.sig'), searchParams: search({ theme: 'dark' }) }),
    );
    expect(container.querySelector('main > div.dark')).not.toBeNull();
  });

  it.each(['light', 'auto', undefined])('?theme=%s renders with no "dark" wrapper', async (theme) => {
    process.env.EMBED_TOKEN_SECRET = 's3cr3t';
    verifyEmbedToken.mockReturnValue(42);
    loadAuditRecord.mockResolvedValue(answerRecord());
    const { container } = render(
      await EmbedPage({ params: params('42.sig'), searchParams: search(theme ? { theme } : {}) }),
    );
    expect(container.querySelector('main > div.dark')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Fix round (Task 5 review, Piece 4): the existing digit-honesty check above
// ("shows a digit-free 'no longer available' page...") only ever scanned the
// English not-available branch, and only with a blanket "no digit at all"
// assertion — which only works because that page is genuinely digit-free.
// The FROZEN chart render legitimately has digits (dates, table ids,
// formatted values), so it needs the real membership scan, not a blanket
// ban — reusing the exact same house helpers chart.test.tsx already built
// for this (scanForUnboundDigits/harvestSpecStrings), copied here rather
// than imported since chart.test.tsx doesn't export them (same "duplicated,
// not imported" precedent as this file's own isRedacted/chartSpec/point
// fixtures already set against chart.test.tsx's near-identical versions).
// ---------------------------------------------------------------------------

/** Identical walker to chart.test.tsx's own scanForUnboundDigits. */
function scanForUnboundDigits(container: HTMLElement, specStrings: string[]): void {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const tokens: string[] = [];
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    tokens.push(...((node.textContent ?? '').match(/\d[\d.,]*/g) ?? []));
  }
  expect(tokens.length).toBeGreaterThan(0);
  for (const tok of tokens) {
    expect(
      specStrings.some((str) => str.includes(tok)),
      `numeric token "${tok}" in the rendered DOM has no source in the spec's own strings`,
    ).toBe(true);
  }
}

/** Same shape chart.test.tsx's own harvestSpecStrings reads — `spec: unknown`
 * plus one internal cast (rather than typing this against the real
 * ChartSpec) because this file's own chartSpec() fixture is deliberately
 * loosely typed (see answerRecord's own comment above on why this file casts
 * rather than tightens its fixtures). */
function harvestSpecStrings(spec: unknown): string[] {
  const s = spec as {
    title: string;
    unit: string;
    attributionLine: string;
    attribution: { tableId: string; syncedAt: string };
    definitionLine: string | null;
    provisionalNote: string | null;
    nullNotes: string[];
    dimLabels: Record<string, string>;
    series: { label: string; points: { formattedValue: string | null; periodLabel: string }[] }[];
  };
  return [
    s.title,
    s.unit,
    s.attributionLine,
    s.attribution.tableId,
    s.attribution.syncedAt,
    s.definitionLine ?? '',
    s.provisionalNote ?? '',
    ...s.nullNotes,
    ...Object.keys(s.dimLabels),
    ...Object.values(s.dimLabels),
    ...s.series.flatMap((se) => [se.label, ...se.points.flatMap((p) => [p.formattedValue ?? '', p.periodLabel])]),
  ].filter(Boolean);
}

describe('/embed/[token] — digit-honesty scan on the FROZEN chart render (fix round, Piece 4)', () => {
  it('nl: every digit in the frozen render traces to a spec string or the footer\'s own date', async () => {
    process.env.EMBED_TOKEN_SECRET = 's3cr3t';
    verifyEmbedToken.mockReturnValue(42);
    const s = chartSpec();
    const record = answerRecord({ response: { kind: 'answer', chart: s } });
    loadAuditRecord.mockResolvedValue(record);
    const { container } = render(await EmbedPage({ params: params('42.sig'), searchParams: search() }));
    const footer = `Bevroren op ${record.createdAt.slice(0, 10)} ·`;
    scanForUnboundDigits(container, [...harvestSpecStrings(s), footer]);
  });

  it('en: every digit in the frozen render traces to a spec string or the footer\'s own date', async () => {
    process.env.EMBED_TOKEN_SECRET = 's3cr3t';
    verifyEmbedToken.mockReturnValue(42);
    const s = chartSpec();
    const record = answerRecord({ response: { kind: 'answer', chart: s } });
    loadAuditRecord.mockResolvedValue(record);
    const { container } = render(
      await EmbedPage({ params: params('42.sig'), searchParams: search({ lang: 'en' }) }),
    );
    const footer = `Frozen on ${record.createdAt.slice(0, 10)} ·`;
    scanForUnboundDigits(container, [...harvestSpecStrings(s), footer]);
  });
});

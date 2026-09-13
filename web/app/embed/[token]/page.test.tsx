// Task 5 (ADR 041 / spec Part B3): the public, no-auth /embed/[token] route —
// FROZEN render. Follows web/app/login/page.test.tsx's idiom: mock every
// dependency via vi.mock, call `EmbedPage({ params, searchParams })` directly
// and `render(await ...)` the result — no real Next.js server context exists
// in jsdom, so next/navigation's `notFound` is mocked to throw (matching its
// real behaviour: it aborts rendering via a thrown, digest-tagged error).
//
// Task 6 adds the `?live=1` branch's own describe block at the bottom of
// this file — `hasProPlan` and `rerunLive` are both mocked (their own real
// behavior is covered by src/billing/pro.test.ts and
// src/chart/embed-live.test.ts respectively); this file only proves the
// ROUTE wires them together correctly.
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

const { hasProPlan, lookupUserEmail } = vi.hoisted(() => ({
  hasProPlan: vi.fn(() => false),
  lookupUserEmail: vi.fn(async () => null as string | null),
}));
vi.mock('../../../backend/billing/index.ts', () => ({ hasProPlan, lookupUserEmail }));

const { rerunLive } = vi.hoisted(() => ({ rerunLive: vi.fn() }));
vi.mock('../../../backend/chart/embed-live.ts', () => ({ rerunLive }));

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
// route's real full searchParams shape so `?form=` tests below don't need a
// cast at every call site — every EXISTING call site that only ever passed
// `{ lang }` stays valid unchanged (a narrower object literal is still
// assignable to this wider optional-fields type).
//
// Final review (Fix 2): `theme` dropped from this shape — EmbedPage's own
// searchParams type no longer declares it either (the route has no use for
// it any more; see page.tsx's file header comment), so keeping it here would
// silently drift from what the route itself actually accepts.
function search(query: { lang?: string; form?: string; live?: string } = {}) {
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

  // Final review (Important #3): the test above (and "defaults the
  // not-available text to Dutch..." below) both set BOTH `chart: null` AND
  // `redacted: true` at once, so the route's guard
  // (`response.chart === null || isRedacted(response)`) passes on EITHER
  // half alone — neither half is actually pinned in isolation by those two
  // fixtures. The chart-less half IS already isolated elsewhere ("shows the
  // not-available page for a chart-less answer row (no redacted flag
  // needed)" below), but the isRedacted half never was, until now. Worse:
  // the REAL production redaction path
  // (src/answer/audit/retention.ts's `redactedResponse()`) returns an
  // envelope with the `chart` key OMITTED ENTIRELY (`undefined`, never
  // `null`) — so `response.chart === null` never actually fires on a genuine
  // redacted row in production; `isRedacted` alone is what protects this
  // PUBLIC, no-auth route from ever serving redacted content. This fixture
  // matches that real shape exactly (no `chart` key at all, not `chart:
  // null`), proving `isRedacted` alone does real, necessary work.
  it('shows the not-available page for a REAL-shaped redacted envelope (chart key absent, not null) — isRedacted alone must catch this', async () => {
    process.env.EMBED_TOKEN_SECRET = 's3cr3t';
    verifyEmbedToken.mockReturnValue(42);
    loadAuditRecord.mockResolvedValue(answerRecord({ response: { kind: 'answer', redacted: true } }));
    const { container } = render(
      await EmbedPage({ params: params('42.sig'), searchParams: search({ lang: 'en' }) }),
    );
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

  // Session 101 (open-questions #237(b)/#205): the Pro pitch on the frozen
  // page, deliberately digit-free (the digit-honesty scan below covers why).
  it('shows a digit-free "go Pro" pitch in both languages on the frozen render', async () => {
    process.env.EMBED_TOKEN_SECRET = 's3cr3t';
    verifyEmbedToken.mockReturnValue(42);
    loadAuditRecord.mockResolvedValue(answerRecord());
    render(await EmbedPage({ params: params('42.sig'), searchParams: search({ lang: 'en' }) }));
    expect(screen.getByText(/go pro/i)).toBeInTheDocument();
    cleanup();
    render(await EmbedPage({ params: params('42.sig'), searchParams: search() }));
    expect(screen.getByText(/ga pro/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Fix round (Task 5 review, Piece 3): `?form=` — already emitted by Task 4's
// embed dialog (chart-embed-dialog.tsx) — is read and applied here.
//
// Final review (Fix 2): the `?theme=` coverage that used to live in this
// block is gone — `?theme=` moved entirely to web/proxy.ts
// (embedRequestHeaders/applyEmbedRequestHeaders, see proxy.test.ts) and
// web/app/layout.tsx (resolveEmbedForcedTheme + the <ThemeProvider
// forcedTheme={...}> wiring, see layout.test.ts); this route no longer reads
// `?theme=` at all (page.tsx's own file header comment explains why), so
// there is nothing left to test about it here.
// ---------------------------------------------------------------------------
describe('/embed/[token] — ?form= (fix round, Piece 3)', () => {
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

  // Bundle B (final review): 'table' IS a real ChartForm (isChartForm
  // accepts it) and ChartView's own initialFormOverride effect never gates
  // it either ('bar'/'table' are "never gated", by that effect's own
  // design) — so before this guard, a hand-crafted `?form=table` URL could
  // reach the Tabel view even though the embed dialog itself can never
  // generate one (its Embed button is hidden whenever state.form ===
  // 'table'). This plan's own spec says table form is never embeddable.
  it('?form=table is ignored — table form is never embeddable, even via a hand-crafted URL', async () => {
    process.env.EMBED_TOKEN_SECRET = 's3cr3t';
    verifyEmbedToken.mockReturnValue(42);
    loadAuditRecord.mockResolvedValue(answerRecord()); // kind: 'line' -> defaults to Lijn, never Tabel
    const { container } = render(
      await EmbedPage({ params: params('42.sig'), searchParams: search({ form: 'table' }) }),
    );
    expect(container.querySelector('.recharts-line')).not.toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
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

// ---------------------------------------------------------------------------
// Task 6 (spec Part B3 "Live" branch): `?live=1`, Pro-gated on the row's
// OWNER (record.userId), never the anonymous visitor loading this public
// page. hasProPlan and rerunLive are mocked (see the file-header note);
// these tests only pin the ROUTE's own wiring — the Pro gate's arguments,
// which branch runs on success/failure/absence, and which footer/spec each
// branch renders.
// ---------------------------------------------------------------------------
describe('/embed/[token] — ?live=1 (Task 6)', () => {
  it('ignores ?live=1 entirely when absent — no hasProPlan/rerunLive call, frozen render unaffected', async () => {
    process.env.EMBED_TOKEN_SECRET = 's3cr3t';
    verifyEmbedToken.mockReturnValue(42);
    loadAuditRecord.mockResolvedValue(answerRecord({ userId: 'user-1' }));
    render(await EmbedPage({ params: params('42.sig'), searchParams: search() }));
    expect(hasProPlan).not.toHaveBeenCalled();
    expect(rerunLive).not.toHaveBeenCalled();
  });

  it('a non-Pro owner silently falls back to the frozen render (no live footer, rerunLive never called)', async () => {
    process.env.EMBED_TOKEN_SECRET = 's3cr3t';
    verifyEmbedToken.mockReturnValue(42);
    hasProPlan.mockReturnValue(false);
    loadAuditRecord.mockResolvedValue(answerRecord({ userId: 'user-1' }));
    render(await EmbedPage({ params: params('42.sig'), searchParams: search({ live: '1' }) }));
    expect(screen.getByText(/bevroren op/i)).toBeInTheDocument();
    expect(screen.queryByText(/live/i)).not.toBeInTheDocument();
    expect(rerunLive).not.toHaveBeenCalled();
  });

  it('passes the row\'s real userId and the looked-up email to hasProPlan (never the anonymous visitor)', async () => {
    process.env.EMBED_TOKEN_SECRET = 's3cr3t';
    verifyEmbedToken.mockReturnValue(42);
    hasProPlan.mockReturnValue(false);
    lookupUserEmail.mockResolvedValue('owner@example.com');
    loadAuditRecord.mockResolvedValue(answerRecord({ userId: 'owner-42' }));
    render(await EmbedPage({ params: params('42.sig'), searchParams: search({ live: '1' }) }));
    expect(lookupUserEmail).toHaveBeenCalledWith(expect.anything(), 'owner-42');
    expect(hasProPlan).toHaveBeenCalledWith({ id: 'owner-42', email: 'owner@example.com' });
  });

  it('falls back to an empty-string id and skips the lookup entirely when the row has no owner (anonymous/benchmark row)', async () => {
    process.env.EMBED_TOKEN_SECRET = 's3cr3t';
    verifyEmbedToken.mockReturnValue(42);
    hasProPlan.mockReturnValue(false);
    loadAuditRecord.mockResolvedValue(answerRecord({ userId: null }));
    render(await EmbedPage({ params: params('42.sig'), searchParams: search({ live: '1' }) }));
    expect(lookupUserEmail).not.toHaveBeenCalled();
    expect(hasProPlan).toHaveBeenCalledWith({ id: '', email: null });
  });

  it('a lookup failure (null email) falls back to the frozen render exactly like a non-Pro owner', async () => {
    process.env.EMBED_TOKEN_SECRET = 's3cr3t';
    verifyEmbedToken.mockReturnValue(42);
    hasProPlan.mockReturnValue(false);
    lookupUserEmail.mockResolvedValue(null);
    loadAuditRecord.mockResolvedValue(answerRecord({ userId: 'owner-42' }));
    render(await EmbedPage({ params: params('42.sig'), searchParams: search({ live: '1' }) }));
    expect(hasProPlan).toHaveBeenCalledWith({ id: 'owner-42', email: null });
    expect(screen.queryByText(/live/i)).not.toBeInTheDocument();
    expect(rerunLive).not.toHaveBeenCalled();
  });

  it('a Pro owner whose live re-run succeeds renders the FRESH spec with a "Live · data as of" footer', async () => {
    process.env.EMBED_TOKEN_SECRET = 's3cr3t';
    verifyEmbedToken.mockReturnValue(42);
    hasProPlan.mockReturnValue(true);
    const liveSpec = chartSpec();
    liveSpec.attribution.syncedAt = '2026-09-09'; // deliberately different from record.createdAt (2026-09-10)
    rerunLive.mockResolvedValue(liveSpec);
    // The frozen chart rendered here is answerRecord()'s default chartSpec(),
    // whose own attribution.syncedAt is '2026-08-26' — the fix-round
    // assertion below leans on that literal.
    loadAuditRecord.mockResolvedValue(answerRecord({ userId: 'user-1' }));
    render(await EmbedPage({ params: params('42.sig'), searchParams: search({ live: '1', lang: 'en' }) }));
    expect(screen.getByText(/live · data as of/i)).toBeInTheDocument();
    // The LIVE spec's own syncedAt, not the frozen row's createdAt — proves
    // finalFooter was built from the fresh spec, not a mislabeled frozen one.
    // (SourceBadge's own "gesynchroniseerd {date}" text independently renders
    // the same attribution.syncedAt, so this legitimately matches twice —
    // same "two occurrences" shape as this file's own frozen-render test.)
    expect(screen.getAllByText(/2026-09-09/).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText(/2026-09-10/)).not.toBeInTheDocument();
    // Fix round (Important #1, Task 6 review): the two assertions above only
    // ever prove something about the FOOTER's own text, which page.tsx builds
    // from liveSpec.attribution.syncedAt regardless of which spec is actually
    // handed to <ChartView spec={...} /> — they would still both pass even if
    // `spec={finalSpec}` were silently reverted to `spec={spec}` (the frozen
    // one), since the frozen fixture's own date ('2026-08-26', chartSpec()'s
    // default) never collides with '2026-09-10' either. This assertion closes
    // that gap: it reads SourceBadge's own rendered text
    // (web/components/source-badge.tsx's syncDateLabel, sourced straight from
    // spec.attribution.syncedAt of whichever spec is actually passed to
    // ChartView, independent of the footer string above) and proves the
    // FROZEN spec's own syncedAt is genuinely absent from the render — the
    // one signal that only changes when the wrong spec is actually rendered
    // in the chart body, not just mislabeled in the footer sentence. Verified
    // by temporarily reverting `spec={finalSpec}` to `spec={spec}` in
    // page.tsx: this assertion (and only this one of the three) then fails.
    expect(screen.queryByText(/2026-08-26/)).not.toBeInTheDocument();
    // Session 101: pitching Pro to an owner who already has it (and whose
    // chart IS live) would be nonsensical — the frozen-only pitch must not
    // survive a successful live re-run.
    expect(screen.queryByText(/go pro/i)).not.toBeInTheDocument();
  });

  it('defaults the live-success footer to Dutch ("Live · gegevens van") when ?lang is absent', async () => {
    process.env.EMBED_TOKEN_SECRET = 's3cr3t';
    verifyEmbedToken.mockReturnValue(42);
    hasProPlan.mockReturnValue(true);
    rerunLive.mockResolvedValue(chartSpec());
    loadAuditRecord.mockResolvedValue(answerRecord({ userId: 'user-1' }));
    render(await EmbedPage({ params: params('42.sig'), searchParams: search({ live: '1' }) }));
    expect(screen.getByText(/live · gegevens van/i)).toBeInTheDocument();
  });

  it('a Pro owner whose live re-run fails (rerunLive returns null) falls back to the frozen spec with a distinguishing footer', async () => {
    process.env.EMBED_TOKEN_SECRET = 's3cr3t';
    verifyEmbedToken.mockReturnValue(42);
    hasProPlan.mockReturnValue(true);
    rerunLive.mockResolvedValue(null);
    loadAuditRecord.mockResolvedValue(answerRecord({ userId: 'user-1' }));
    render(await EmbedPage({ params: params('42.sig'), searchParams: search({ live: '1', lang: 'en' }) }));
    expect(screen.getByText(/live update not available, showing the chart of/i)).toBeInTheDocument();
    // record.createdAt (the frozen row's own date), never a live date — there is no live spec to read one from.
    expect(screen.getByText(/2026-09-10/)).toBeInTheDocument();
    // Spec B3: this message is "digit-free apart from the date string" — same
    // discipline as the Task 5 Piece 4 digit-honesty scan, applied directly
    // to this new footer sentence rather than folded into that scan's own
    // spec-string harvest (this string never comes from the ChartSpec).
    const liveFailureFooter = screen.getByText(/live update not available, showing the chart of/i);
    expect(liveFailureFooter.textContent!.replace('2026-09-10', '')).not.toMatch(/\d/);
  });

  it('defaults the live-failure footer to Dutch ("Live-update niet beschikbaar") when ?lang is absent', async () => {
    process.env.EMBED_TOKEN_SECRET = 's3cr3t';
    verifyEmbedToken.mockReturnValue(42);
    hasProPlan.mockReturnValue(true);
    rerunLive.mockResolvedValue(null);
    loadAuditRecord.mockResolvedValue(answerRecord({ userId: 'user-1' }));
    render(await EmbedPage({ params: params('42.sig'), searchParams: search({ live: '1' }) }));
    expect(screen.getByText(/live-update niet beschikbaar/i)).toBeInTheDocument();
  });

  it('calls rerunLive with (db, record, { lang }) — the resolved lang, not a hardcoded one', async () => {
    process.env.EMBED_TOKEN_SECRET = 's3cr3t';
    verifyEmbedToken.mockReturnValue(42);
    hasProPlan.mockReturnValue(true);
    rerunLive.mockResolvedValue(chartSpec());
    loadAuditRecord.mockResolvedValue(answerRecord({ userId: 'user-1' }));
    await EmbedPage({ params: params('42.sig'), searchParams: search({ live: '1', lang: 'en' }) });
    expect(rerunLive).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ userId: 'user-1' }), {
      lang: 'en',
    });
  });
});

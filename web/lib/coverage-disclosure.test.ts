// WP-E (journey programme, 2026-09-12): the coverage-disclosure loader —
// active-only, measured-date-only, one example per table built from the same
// blocks refusals.ts uses, own 30-min cache with stale-over-nothing (the
// llms-txt.test.ts sibling pattern, deliberately not sharing its cache).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CoverageReport } from '../backend/registry/coverage.ts';

const { buildCoverageReport } = vi.hoisted(() => ({
  buildCoverageReport: vi.fn(),
}));
vi.mock('../backend/registry/coverage.ts', () => ({ buildCoverageReport }));

const { freshestForCanonical } = vi.hoisted(() => ({
  freshestForCanonical: vi.fn(),
}));
vi.mock('../backend/query/run.ts', () => ({ freshestForCanonical }));

vi.mock('../backend/registry/defaults.ts', () => ({
  CANONICAL_MEASURES: [
    {
      key: 'cpi_yearly_inflation',
      tableId: '86141NED',
      definitionLabel: 'inflatie (jaarmutatie CPI, alle bestedingen)',
      everydayTerms: ['inflatie', 'cpi'],
    },
    {
      key: 'unemployment_rate_seasonally_adjusted',
      tableId: '85224NED',
      definitionLabel: 'werkloosheidspercentage, seizoengecorrigeerd',
      everydayTerms: ['werkloosheid'],
    },
  ],
}));

vi.mock('./db.ts', () => ({ getDb: () => ({}) }));

import {
  loadCoverageDisclosure,
  resetCoverageDisclosureCache,
} from './coverage-disclosure.ts';

function report(): CoverageReport {
  return {
    tables: [
      {
        id: '86141NED',
        title: 'Consumentenprijzen; prijsindex 2015=100',
        status: 'active',
        lastSyncAt: '2026-07-03T12:00:00.000Z',
        measures: [
          { key: 'cpi_yearly_inflation', label: 'inflatie (CPI)' },
          { key: 'cpi_index', label: 'consumentenprijsindex' },
        ],
      },
      {
        id: '85224NED',
        title: 'Arbeidsdeelname; kerncijfers',
        status: 'needs_review',
        lastSyncAt: '2026-07-01T08:00:00.000Z',
        measures: [{ key: 'unemployment_rate_seasonally_adjusted', label: 'werkloosheidspercentage' }],
      },
    ],
  };
}

describe('loadCoverageDisclosure', () => {
  beforeEach(() => {
    resetCoverageDisclosureCache();
    buildCoverageReport.mockReset();
    freshestForCanonical.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('excludes needs_review tables — only active tables are served', async () => {
    buildCoverageReport.mockResolvedValue(report());
    freshestForCanonical.mockResolvedValue({ periodCode: '2025JJ00', status: 'Definitief' });
    const disclosure = await loadCoverageDisclosure();
    expect(disclosure!.tables).toHaveLength(1);
    expect(disclosure!.tables[0]!.id).toBe('86141NED');
  });

  it('formats syncedOn as a plain YYYY-MM-DD date, and null when never synced', async () => {
    const r = report();
    r.tables[0]!.lastSyncAt = null;
    buildCoverageReport.mockResolvedValue(r);
    freshestForCanonical.mockResolvedValue(null);
    const disclosure = await loadCoverageDisclosure();
    expect(disclosure!.tables[0]!.syncedOn).toBeNull();
  });

  it('builds one answerable example question from the same building blocks refusals.ts uses, never invented', async () => {
    buildCoverageReport.mockResolvedValue(report());
    freshestForCanonical.mockResolvedValue({ periodCode: '2025JJ00', status: 'Definitief' });
    const disclosure = await loadCoverageDisclosure();
    expect(disclosure!.tables[0]!.example).toBe('Wat was de inflatie in 2025?');
  });

  it('omits the example when the freshest period is unknown — never a guessed example', async () => {
    buildCoverageReport.mockResolvedValue(report());
    freshestForCanonical.mockResolvedValue(null);
    const disclosure = await loadCoverageDisclosure();
    expect(disclosure!.tables[0]!.example).toBeNull();
  });

  it('carries the table concepts through as the measure labels', async () => {
    buildCoverageReport.mockResolvedValue(report());
    freshestForCanonical.mockResolvedValue(null);
    const disclosure = await loadCoverageDisclosure();
    expect(disclosure!.tables[0]!.concepts).toEqual(['inflatie (CPI)', 'consumentenprijsindex']);
  });

  it('builds once and serves from cache within the TTL', async () => {
    buildCoverageReport.mockResolvedValue(report());
    freshestForCanonical.mockResolvedValue(null);
    const first = await loadCoverageDisclosure();
    const second = await loadCoverageDisclosure();
    expect(second).toBe(first);
    expect(buildCoverageReport).toHaveBeenCalledTimes(1);
  });

  it('returns null when no build has ever succeeded', async () => {
    buildCoverageReport.mockRejectedValue(new Error('db down'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await loadCoverageDisclosure()).toBeNull();
    warn.mockRestore();
  });

  it('serves the STALE disclosure when a refresh after TTL expiry fails (stale-over-nothing)', async () => {
    vi.useFakeTimers();
    buildCoverageReport.mockResolvedValueOnce(report());
    freshestForCanonical.mockResolvedValue(null);
    const first = await loadCoverageDisclosure();
    vi.advanceTimersByTime(31 * 60 * 1000);
    buildCoverageReport.mockRejectedValueOnce(new Error('db down'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await loadCoverageDisclosure()).toBe(first);
    warn.mockRestore();
    expect(buildCoverageReport).toHaveBeenCalledTimes(2);
  });
});

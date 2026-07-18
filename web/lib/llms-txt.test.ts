// #170(2): the llms.txt renderer (pure) + the cached feed (fail-safe posture
// mirrored from ontdek.ts — stale-over-nothing, never a silently empty
// coverage list).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CoverageReport } from '../backend/registry/coverage.ts';

const { buildCoverageReport } = vi.hoisted(() => ({
  buildCoverageReport: vi.fn(),
}));
vi.mock('../backend/registry/coverage.ts', () => ({ buildCoverageReport }));
vi.mock('./db.ts', () => ({ getDb: () => ({}) }));

import { loadLlmsTxtBody, renderLlmsTxt, resetLlmsTxtCache } from './llms-txt.ts';

function report(): CoverageReport {
  return {
    tables: [
      {
        id: '86141NED',
        title: 'Consumentenprijzen; prijsindex 2015=100',
        status: 'active',
        lastSyncAt: '2026-07-03T12:00:00.000Z',
        measures: [
          { key: 'inflation_cpi', label: 'inflatie (CPI)' },
          { key: 'cpi_index', label: 'consumentenprijsindex' },
        ],
      },
      {
        id: '85224NED',
        title: 'Arbeidsdeelname; kerncijfers',
        status: 'needs_review',
        lastSyncAt: '2026-07-01T08:00:00.000Z',
        measures: [{ key: 'unemployment_rate', label: 'werkloosheidspercentage' }],
      },
    ],
  };
}

describe('renderLlmsTxt', () => {
  it('carries the public claim, the generated coverage with MEASURED sync dates, and the CC BY source block', () => {
    const text = renderLlmsTxt(report(), '2026-07-18T09:00:00.000Z');
    expect(text).toContain('herleidbaar naar een officiële CBS-cel, met bron en datum getoond');
    expect(text).toContain('Gegenereerd op 2026-07-18');
    expect(text).toContain(
      '- CBS 86141NED — Consumentenprijzen; prijsindex 2015=100 (gesynchroniseerd 2026-07-03)',
    );
    expect(text).toContain('begrippen: inflatie (CPI); consumentenprijsindex');
    expect(text).toContain('CC BY 4.0');
    expect(text).toContain('https://opendata.cbs.nl');
  });

  it('EXCLUDES a quarantined table from the served coverage and says so honestly', () => {
    const text = renderLlmsTxt(report(), '2026-07-18T09:00:00.000Z');
    expect(text).not.toContain('- CBS 85224NED');
    expect(text).toContain('1 tabel(len) staan tijdelijk in revisie');
  });

  it('omits the sync suffix when a table was never synced — never an invented date', () => {
    const r = report();
    r.tables[0]!.lastSyncAt = null;
    const text = renderLlmsTxt(r, '2026-07-18T09:00:00.000Z');
    expect(text).toContain('- CBS 86141NED — Consumentenprijzen; prijsindex 2015=100\n');
    expect(text).not.toContain('86141NED — Consumentenprijzen; prijsindex 2015=100 (gesynchroniseerd');
  });

  it('is deterministic for unchanged input', () => {
    expect(renderLlmsTxt(report(), '2026-07-18T09:00:00.000Z')).toBe(
      renderLlmsTxt(report(), '2026-07-18T09:00:00.000Z'),
    );
  });
});

describe('loadLlmsTxtBody', () => {
  beforeEach(() => {
    resetLlmsTxtCache();
    buildCoverageReport.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('builds once and serves from cache within the TTL', async () => {
    buildCoverageReport.mockResolvedValue(report());
    const first = await loadLlmsTxtBody();
    const second = await loadLlmsTxtBody();
    expect(first).toContain('86141NED');
    expect(second).toBe(first);
    expect(buildCoverageReport).toHaveBeenCalledTimes(1);
  });

  it('returns null when no build has ever succeeded (route answers 503)', async () => {
    buildCoverageReport.mockRejectedValue(new Error('db down'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await loadLlmsTxtBody()).toBeNull();
    warn.mockRestore();
  });

  it('serves the STALE body when a refresh after TTL expiry fails (stale-over-nothing)', async () => {
    vi.useFakeTimers();
    buildCoverageReport.mockResolvedValueOnce(report());
    const first = await loadLlmsTxtBody();
    vi.advanceTimersByTime(31 * 60 * 1000);
    buildCoverageReport.mockRejectedValueOnce(new Error('db down'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await loadLlmsTxtBody()).toBe(first);
    warn.mockRestore();
    expect(buildCoverageReport).toHaveBeenCalledTimes(2);
  });
});

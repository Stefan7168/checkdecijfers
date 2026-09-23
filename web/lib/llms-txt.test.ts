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
        sourceDisplayName: 'CBS',
        nativeId: '86141NED',
      },
      {
        id: '85224NED',
        title: 'Arbeidsdeelname; kerncijfers',
        status: 'needs_review',
        lastSyncAt: '2026-07-01T08:00:00.000Z',
        measures: [{ key: 'unemployment_rate', label: 'werkloosheidspercentage' }],
        sourceDisplayName: 'CBS',
        nativeId: '85224NED',
      },
    ],
  };
}

// E2a step-5 fix round 2: a REAL live bug (confirmed on the deployed
// `/llms.txt`, line 73) — a non-CBS table used to render as "CBS
// eurostat:tipsbd30" because the renderer hardcoded "CBS" for every row.
// `sourceDisplayName`/`nativeId` are now resolved by the coverage report
// itself (src/registry/coverage.ts, from the source registry) — this fixture
// mirrors exactly what that resolution produces for a real Eurostat table.
function eurostatTable(): CoverageReport['tables'][number] {
  return {
    id: 'eurostat:tipsbd30',
    title: 'Tier-1 capital ratio banking sector',
    status: 'active',
    lastSyncAt: '2026-09-16T00:00:00.000Z',
    measures: [],
    sourceDisplayName: 'Eurostat',
    nativeId: 'tipsbd30',
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

  // Fix round 2: reproduces the LIVE bug (checkdecijfers.vercel.app/llms.txt,
  // line 73: "- CBS eurostat:tipsbd30 — Tier-1 capital ratio banking sector
  // (gesynchroniseerd 2026-09-16)") and proves it is fixed — the table's
  // REAL source name, and its bare native id with no redundant
  // '<sourceKey>:' prefix, never a hardcoded "CBS".
  it('labels a non-CBS table by its REAL source and native id, never "CBS" (the live #llms.txt bug)', () => {
    const r = report();
    r.tables.push(eurostatTable());
    const text = renderLlmsTxt(r, '2026-09-23T09:00:00.000Z');
    expect(text).toContain(
      '- Eurostat tipsbd30 — Tier-1 capital ratio banking sector (gesynchroniseerd 2026-09-16)',
    );
    expect(text).not.toContain('CBS eurostat:tipsbd30');
    expect(text).not.toContain('CBS tipsbd30');
  });

  it('every CBS line stays byte-identical after the fix (no source/id regression)', () => {
    const text = renderLlmsTxt(report(), '2026-07-18T09:00:00.000Z');
    expect(text).toContain(
      '- CBS 86141NED — Consumentenprijzen; prijsindex 2015=100 (gesynchroniseerd 2026-07-03)',
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

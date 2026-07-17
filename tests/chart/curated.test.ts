// Gate for the curated "Ontdek Nederland in grafieken" set (ADR 035): every
// curated series must build a chart through the real deterministic pipeline
// (freshest anchor → hand-authored intent → runQuery → buildChartSpec)
// against the committed fixtures — hermetically (PGlite, ADR 009). A skip in
// production is therefore a data regression, never an accepted steady state.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../../src/db/types.ts';
import { buildCuratedCharts, ONTDEK_CHARTS, periodStepsBack } from '../../src/chart/index.ts';
import type { CuratedChartsOutcome } from '../../src/chart/index.ts';
import { parsePeriodCode } from '../../src/ingestion/periods.ts';
import { createIngestedDb } from '../helpers/ingested-db.ts';

// The table each canonical key must resolve to — pinned so a registry
// re-point (the CC8-CC10 precedent) is a conscious edit here, not a silent
// swap of what the homepage shows.
const EXPECTED_TABLES: Record<string, string> = {
  consumentenvertrouwen: '83693NED',
  'economische-groei': '85880NED',
  inflatie: '86141NED',
  huizenprijzen: '85773NED',
};

let db: Db;
let close: () => Promise<void>;
let outcome: CuratedChartsOutcome;

beforeAll(async () => {
  ({ db, close } = await createIngestedDb());
  outcome = await buildCuratedCharts(db);
}, 120_000);

afterAll(async () => {
  await close();
});

describe('periodStepsBack', () => {
  it('steps months across year boundaries', () => {
    expect(periodStepsBack({ grain: 'MM', year: 2026, index: 6 }, 23)).toEqual({
      grain: 'MM',
      year: 2024,
      index: 7,
    });
  });

  it('steps quarters across year boundaries', () => {
    expect(periodStepsBack({ grain: 'KW', year: 2026, index: 1 }, 11)).toEqual({
      grain: 'KW',
      year: 2023,
      index: 2,
    });
  });

  it('steps years', () => {
    expect(periodStepsBack({ grain: 'JJ', year: 2025, index: null }, 9)).toEqual({
      grain: 'JJ',
      year: 2016,
      index: null,
    });
  });

  it('zero steps is the identity', () => {
    expect(periodStepsBack({ grain: 'MM', year: 2026, index: 6 }, 0)).toEqual({
      grain: 'MM',
      year: 2026,
      index: 6,
    });
  });

  it('keeps the index in range when the total goes negative (no JS-modulo sign bug)', () => {
    // Adversarial-review finding (session 52): JS `%` keeps the dividend's
    // sign, so a naive `(total % perYear) + 1` emits index -4 here. The
    // decomposition must stay a true floor/remainder pair at any input.
    expect(periodStepsBack({ grain: 'MM', year: 0, index: 1 }, 5)).toEqual({
      grain: 'MM',
      year: -1,
      index: 8,
    });
    expect(periodStepsBack({ grain: 'KW', year: 0, index: 1 }, 2)).toEqual({
      grain: 'KW',
      year: -1,
      index: 3,
    });
  });
});

describe('buildCuratedCharts failure classes (ADR 035 D3)', () => {
  it('propagates transient I/O throws instead of folding them into skips', async () => {
    // A DB-layer throw must reject the WHOLE build so the web layer's
    // stale-over-nothing fallback engages — a one-off blip may never be
    // cached as a smaller chart set (adversarial-review finding, session 52).
    const brokenDb = {
      query: () => Promise.reject(new Error('connection reset')),
      withTransaction: () => Promise.reject(new Error('connection reset')),
    } as unknown as Db;
    await expect(buildCuratedCharts(brokenDb)).rejects.toThrow('connection reset');
  });
});

describe('buildCuratedCharts (hermetic, fixture DB)', () => {
  it('builds every curated series — zero skips', () => {
    expect(outcome.skipped).toEqual([]);
    expect(outcome.charts.map((c) => c.slug)).toEqual(ONTDEK_CHARTS.map((d) => d.slug));
  });

  it('every chart is a line over exactly the designed window at the designed grain', () => {
    for (const def of ONTDEK_CHARTS) {
      const chart = outcome.charts.find((c) => c.slug === def.slug);
      expect(chart, def.slug).toBeDefined();
      const spec = chart!.spec;
      expect(spec.kind, def.slug).toBe('line');
      expect(spec.series, def.slug).toHaveLength(1);
      const points = spec.series[0]!.points;
      expect(points, def.slug).toHaveLength(def.windowLength);
      for (const point of points) {
        expect(parsePeriodCode(point.periodCode)?.grain, `${def.slug} ${point.periodCode}`).toBe(
          def.grain,
        );
      }
    }
  });

  it('every chart resolves to its pinned table and carries full R4 attribution', () => {
    for (const chart of outcome.charts) {
      expect(chart.spec.attribution.tableId, chart.slug).toBe(EXPECTED_TABLES[chart.slug]);
      // R4: table id + title, sync date and license must be in the rendered line.
      expect(chart.spec.attributionLine, chart.slug).toContain(chart.spec.attribution.tableId);
      expect(chart.spec.attributionLine, chart.slug).toContain('CC BY 4.0');
      expect(chart.spec.attributionLine, chart.slug).toContain('gesynchroniseerd');
    }
  });

  it('provisional points are R11-marked in the spec', () => {
    // The BBP flash series always carries recent Voorlopig quarters in the
    // committed fixture; the note must therefore be present — proving the
    // marking path is live on the homepage set, not accidentally absent.
    const gdp = outcome.charts.find((c) => c.slug === 'economische-groei')!;
    expect(gdp.spec.series[0]!.points.some((p) => p.provisional)).toBe(true);
    expect(gdp.spec.provisionalNote).not.toBeNull();
    for (const chart of outcome.charts) {
      const anyProvisional = chart.spec.series[0]!.points.some((p) => p.provisional);
      expect(chart.spec.provisionalNote !== null, chart.slug).toBe(anyProvisional);
    }
  });

  it('every point value is a real DB cell projection (no invented numbers)', () => {
    // R6 discipline: formattedValue is the only display string and must be a
    // formatting of the cell's own value — spot-check by re-parsing the Dutch
    // formatting back to the numeric value for every non-null point.
    for (const chart of outcome.charts) {
      for (const point of chart.spec.series[0]!.points) {
        if (point.value === null) {
          expect(point.formattedValue, `${chart.slug} ${point.periodCode}`).toBeNull();
          continue;
        }
        const reparsed = Number(
          (point.formattedValue ?? '').replace(/\./g, '').replace(',', '.').replace('−', '-'),
        );
        expect(reparsed, `${chart.slug} ${point.periodCode}`).toBeCloseTo(
          point.value,
          point.decimals,
        );
      }
    }
  });
});

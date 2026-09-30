// E2a step 5: the three reviewed sibling slices, parsed from the REAL Statistics
// API responses captured with `node scripts/capture-eurostat-fixtures.ts --siblings`
// (tests/fixtures/eurostat-siblings/). Every other Eurostat parser test builds a
// synthetic dataset by hand, and that is how two defects reached the first live
// registration (2026-09-30): the monthly grain was never seen in real wire form
// ('YYYY-MM', not the assumed 'YYYY-Mnn'), and the reviewed inflation dataset
// (prc_hicp_manr) had been frozen at 2025-12 by Eurostat. This suite makes the
// reviewed pair list answer to real data: if a measure key, a coordinate pin or a
// period spelling stops matching what Eurostat actually sends, it fails here —
// hermetically, before a live registration does.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseJsonStatDataset } from '../../src/eurostat-adapter/jsonstat.ts';
import { parsePeriodCode } from '../../src/ingestion/periods.ts';
import {
  EUROSTAT_SIBLING_MEASURES_REVIEWED,
  EUROSTAT_SIBLING_REGISTRATIONS,
} from '../../src/sources/eurostat-siblings.ts';

function loadCapture(tableId: string): unknown {
  const code = tableId.slice(tableId.indexOf(':') + 1);
  const path = new URL(`../fixtures/eurostat-siblings/${code}.json`, import.meta.url);
  return JSON.parse(readFileSync(path, 'utf8'));
}

describe('reviewed Eurostat siblings vs the real API responses (captured fixtures)', () => {
  for (const reg of EUROSTAT_SIBLING_REGISTRATIONS) {
    const measure = EUROSTAT_SIBLING_MEASURES_REVIEWED.find((m) => m.tableId === reg.tableId);

    describe(reg.tableId, () => {
      it('has exactly one reviewed measure', () => {
        expect(measure, `no reviewed sibling measure for ${reg.tableId}`).toBeDefined();
      });

      const parsed = parseJsonStatDataset(loadCapture(reg.tableId), reg.tableId, reg.slice);

      it('parses (every period spelling in the real response maps into the internal grammar)', () => {
        expect(parsed.rows.length).toBeGreaterThan(0);
        for (const row of parsed.rows) {
          const period = Object.values(row.coordinates).find((c) => /^\d{4}(JJ|KW|MM)\d{2}$/.test(c));
          expect(period, JSON.stringify(row.coordinates)).toBeDefined();
          expect(parsePeriodCode(period!), period).not.toBeNull();
        }
      });

      it('carries the reviewed measure code, and only that one (slice pins the unit)', () => {
        expect(parsed.schema.measures.map((m) => m.code)).toEqual([measure!.measure]);
      });

      it('offers every coordinate the reviewed measure pins, as a real dimension with a real code', () => {
        const dimensionNames = new Set(parsed.schema.dimensions.map((d) => d.name));
        for (const [dimension, code] of Object.entries(measure!.dims)) {
          expect(dimensionNames.has(dimension), `${measure!.key}: no dimension '${dimension}' in the real response`).toBe(
            true,
          );
          const codes = (parsed.codeLists[dimension] ?? []).map((c) => c.code);
          expect(codes, `${measure!.key}: code '${code}' for dimension '${dimension}'`).toContain(code);
        }
      });

      it('holds the countries the slice is for (NL, DE) and the EU aggregate', () => {
        const geoDimension = parsed.schema.dimensions.find((d) => d.kind === 'GeoDimension')!.name;
        const geos = new Set((parsed.codeLists[geoDimension] ?? []).map((c) => c.code));
        for (const geo of ['NL', 'DE', 'EU27_2020']) expect(geos.has(geo), geo).toBe(true);
      });
    });
  }
});

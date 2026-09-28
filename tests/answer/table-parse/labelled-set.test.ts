// Breadth step 4, Task 4 — integrity checks for
// benchmark/tableparse-labelled-set.json against the REAL CBS metadata
// fixtures the eval script reads (tests/fixtures/tableparse/schemas/), and a
// hermetic run of the eval script's dry-run mode over the whole set (no
// LlmClient constructed, zero spend).
//
// This file does NOT judge whether a labelled expectation is the "right"
// answer for a careful reader (that's a human editorial judgment, made when
// the set was written) — it only proves the set is internally CONSISTENT
// with the fixtures: every table has a fixture, every measure code is a real
// measure on that table (or 'geen'), every breakdown entry names exactly the
// dimensions buildTableParseSchema actually offers for that table (no
// missing/extra dimension), every member code is a real code on that
// dimension AND — since the pre-filter can cut a real member from what's
// OFFERED for a given question — is actually IN the offered list
// buildTableParseSchema returns for that exact question text. A mismatch
// here means the labelled set and the fixtures/builder have drifted apart,
// which would silently invalidate every future replay/record score.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { CbsCode, CbsTableSchema } from '../../../src/cbs-adapter/types.ts';
import { buildTableParseSchema } from '../../../src/answer/table-parse/input.ts';
import { findGrandTotal } from '../../../src/query/breakdowns.ts';
import {
  buildDryRunRows,
  loadLabelledSet,
  loadTableFixture,
  summarizeDryRun,
  type LabelledCase,
} from '../../../scripts/tableparse-eval.ts';

const PERIOD_KINDS = new Set([
  'year',
  'quarter',
  'month',
  'year_range',
  'since',
  'last_n',
  'now_vs_ago',
  'change_over_year',
  'date_range',
  'relative',
  'latest',
  'none',
]);

const set = loadLabelledSet();

function schemaFixtureExists(tableId: string): boolean {
  const path = fileURLToPath(new URL(`../../fixtures/tableparse/schemas/${tableId}.json`, import.meta.url));
  try {
    readFileSync(path, 'utf8');
    return true;
  } catch {
    return false;
  }
}

describe('tableparse-labelled-set.json — integrity', () => {
  it('has at least 25 cases covering every eligible fixture table used', () => {
    expect(set.cases.length).toBeGreaterThanOrEqual(25);
  });

  it('has unique case ids', () => {
    const ids = set.cases.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(set.cases.map((c): [string, LabelledCase] => [c.id, c]))(
    "case '%s': table has a fixture, measure code is real (or 'geen'), breakdowns match the offered dimensions exactly, member codes are real AND offered, periodKind is valid",
    (_id, c) => {
      expect(schemaFixtureExists(c.table)).toBe(true);

      const { schema, codeLists } = loadTableFixture(c.table);
      const input = buildTableParseSchema(schema, codeLists, c.question);

      // --- measure -------------------------------------------------------
      if (c.expect.measureCode !== 'geen') {
        const measureCodes = schema.measures.map((m) => m.code);
        expect(measureCodes).toContain(c.expect.measureCode);
      }

      // --- breakdowns: exactly the offered dimensions, once each ---------
      const offeredNames = input.breakdowns.map((b) => b.name).sort();
      const expectedNames = Object.keys(c.expect.breakdowns).sort();
      expect(expectedNames).toEqual(offeredNames);

      for (const breakdown of input.breakdowns) {
        const expected = c.expect.breakdowns[breakdown.name];
        expect(expected).toBeDefined();
        if (expected === 'niet_genoemd' || expected === 'anders') continue;
        // A member expectation: must be a REAL code in the dimension's full
        // code list...
        const fullCodes = (codeLists[breakdown.name] ?? []).map((code) => code.code);
        expect(fullCodes).toContain(expected);
        // ...AND must be in the list buildTableParseSchema actually offers
        // for THIS question (the pre-filter can cut a real member — a
        // labelled 'member' expectation for a cut member would be a
        // self-contradiction with the 'anders' cases' own reasoning).
        const offeredCodes = breakdown.members.map((m) => m.code);
        expect(offeredCodes).toContain(expected);
      }

      // --- period / regions ------------------------------------------------
      expect(PERIOD_KINDS.has(c.expect.periodKind)).toBe(true);
      expect(Array.isArray(c.expect.regions)).toBe(true);
      if (c.expect.regions.length > 0) {
        // A named region only means something on a table that actually has
        // one (Global Constraints: region terms on a region-less table
        // throw at the parser layer) — a labelled case naming a region on a
        // region-less table would itself be internally inconsistent.
        expect(input.hasRegions).toBe(true);
      }
    },
  );

  it('covers every category the brief requires at its stated minimum', () => {
    const geenCount = set.cases.filter((c) => c.expect.measureCode === 'geen').length;
    const andersCount = set.cases.filter((c) => Object.values(c.expect.breakdowns).includes('anders')).length;
    const regionCount = set.cases.filter((c) => c.expect.regions.length > 0).length;
    const grainCases = set.cases.filter((c) => c.id.startsWith('grain-'));
    const totalCases = set.cases.filter((c) => c.id.startsWith('total-'));
    const nototalCases = set.cases.filter((c) => c.id.startsWith('nototal-'));

    expect(geenCount).toBeGreaterThanOrEqual(4);
    expect(andersCount).toBeGreaterThanOrEqual(3);
    expect(regionCount).toBeGreaterThanOrEqual(2);
    expect(grainCases.length).toBeGreaterThanOrEqual(2);
    expect(totalCases.length).toBeGreaterThanOrEqual(4);
    expect(nototalCases.length).toBeGreaterThanOrEqual(3);

    // period-grain-unavailable: the case's asked grain must genuinely be
    // ABSENT from that table's own periodGrains, or the case doesn't
    // actually test what its id claims.
    const grainOf: Record<string, 'JJ' | 'KW' | 'MM'> = { year: 'JJ', quarter: 'KW', month: 'MM' };
    for (const c of grainCases) {
      const { schema, codeLists } = loadTableFixture(c.table);
      const input = buildTableParseSchema(schema, codeLists, c.question);
      const grain = grainOf[c.expect.periodKind];
      expect(grain).toBeDefined();
      expect(input.periodGrains).not.toContain(grain);
    }

    // niet_genoemd → falls to a real total: at least one of the case's
    // niet_genoemd dimensions must have a GENUINE grand total
    // (findGrandTotal non-null over the dimension's FULL code list), or the
    // case doesn't actually test the "falls to total" path its id claims.
    for (const c of totalCases) {
      const { codeLists } = loadTableFixture(c.table);
      const niet_genoemdDims = Object.entries(c.expect.breakdowns)
        .filter(([, choice]) => choice === 'niet_genoemd')
        .map(([dim]) => dim);
      const hasRealTotal = niet_genoemdDims.some((dim) => {
        const members = (codeLists[dim] ?? []).map((code) => ({ code: code.code, title: code.title }));
        return findGrandTotal(members) !== null;
      });
      expect(hasRealTotal).toBe(true);
    }

    // two-totals / no-total dimension: at least one of the case's
    // niet_genoemd dimensions must have NO resolvable grand total
    // (findGrandTotal null over the dimension's FULL code list), or the case
    // doesn't actually test the no-total path its id claims.
    for (const c of nototalCases) {
      const { codeLists } = loadTableFixture(c.table);
      const niet_genoemdDims = Object.entries(c.expect.breakdowns)
        .filter(([, choice]) => choice === 'niet_genoemd')
        .map(([dim]) => dim);
      const hasNoTotal = niet_genoemdDims.some((dim) => {
        const members = (codeLists[dim] ?? []).map((code) => ({ code: code.code, title: code.title }));
        return findGrandTotal(members) === null;
      });
      expect(hasNoTotal).toBe(true);
    }
  });
});

describe('tableparse-eval.ts --dry-run', () => {
  it('builds a request for every case from the fixtures alone, with no LlmClient', () => {
    const rows = buildDryRunRows(set.cases);
    expect(rows).toHaveLength(set.cases.length);
    for (const row of rows) {
      expect(row.requestHash).toMatch(/^[0-9a-f]{32}$/);
      expect(row.promptChars).toBeGreaterThan(0);
      expect(row.estimatedTokens).toBeGreaterThan(0);
      expect(row.estimatedTokens).toBe(Math.round(row.promptChars / 3.5));
    }
  });

  it('summarizes totals (largest prompt, total estimated tokens) over the whole set', () => {
    const summary = summarizeDryRun(buildDryRunRows(set.cases));
    expect(summary.rows).toHaveLength(set.cases.length);
    expect(summary.totalEstimatedTokens).toBe(summary.rows.reduce((sum, r) => sum + r.estimatedTokens, 0));
    const actualLargest = Math.max(...summary.rows.map((r) => r.promptChars));
    expect(summary.largestPromptChars).toBe(actualLargest);
  });
});

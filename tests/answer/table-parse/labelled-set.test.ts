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
// buildTableParseSchema returns for that exact question text. Final-review
// fix wave: every case's expectation is ALSO run through the real validator
// as canned model output — an ordinary case must validate, an expected
// refusal ('ambiguous' measure, outcome 'region_unavailable') must throw
// exactly its error class — so a label can never contradict the validator's
// own rules (e.g. a named place with 'niet_genoemd' on the dimension that
// lists it). A mismatch here means the labelled set and the
// fixtures/builder/validator have drifted apart, which would silently
// invalidate every future replay/record score.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { CbsCode, CbsTableSchema } from '../../../src/cbs-adapter/types.ts';
import { buildTableParseSchema } from '../../../src/answer/table-parse/input.ts';
import type { TableParseSchema } from '../../../src/answer/table-parse/input.ts';
import { findGrandTotal } from '../../../src/query/breakdowns.ts';
import {
  buildTableParseRequest,
  validateTableParseOutput,
  TableParseAmbiguousMeasureError,
  TableParseRegionUnavailableError,
  TABLE_PARSE_SCHEMA_VERSION,
} from '../../../src/answer/table-parse/parse.ts';
import {
  buildDryRunRows,
  buildLabelIndex,
  expectedErrorClass,
  loadLabelledSet,
  loadTableFixture,
  representativeMeasureCode,
  summarizeDryRun,
  LABEL_AMBIGUOUS_MEASURE,
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

const REGION_SCOPES = new Set(['all_provincies', 'all_landsdelen', 'all_gemeenten', 'gemeenten_in_provincie']);

/** A valid period spec of the labelled kind — the label only records the
 * discriminant, the validator needs a whole spec. */
function samplePeriod(kind: string): Record<string, unknown> {
  switch (kind) {
    case 'year':
      return { kind, year: 2020 };
    case 'quarter':
      return { kind, year: 2020, quarter: 2 };
    case 'month':
      return { kind, year: 2020, month: 3 };
    case 'year_range':
      return { kind, fromYear: 2018, toYear: 2020 };
    case 'since':
      return { kind, year: 2018, quarter: null, month: null };
    case 'last_n':
      return { kind, unit: 'year', n: 3 };
    case 'now_vs_ago':
      return { kind, unit: 'year', amount: 5 };
    case 'change_over_year':
      return { kind, year: 2020 };
    case 'date_range':
      return { kind, from: { year: 2020, month: 1, day: null }, to: { year: 2020, month: 12, day: null }, toInclusive: true };
    case 'relative':
      return { kind, unit: 'year', offset: -1 };
    default:
      return { kind };
  }
}

/** The label, written as the model output it expects. */
function cannedFromLabel(c: LabelledCase, input: TableParseSchema, measureCode: string): string {
  return JSON.stringify({
    version: TABLE_PARSE_SCHEMA_VERSION,
    measureCode,
    breakdowns: input.breakdowns.map((b) => ({ dimension: b.name, choice: c.expect.breakdowns[b.name] })),
    period: samplePeriod(c.expect.periodKind),
    regions: c.expect.regions.map((name) => ({ name, kind: 'onbekend' })),
    regionScope: c.expect.regionScope ?? null,
    derivation: 'none',
    confidence: 0.9,
    reading: 'label',
  });
}

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
      const measureCodes = schema.measures.map((m) => m.code);
      if (c.expect.measureCode === LABEL_AMBIGUOUS_MEASURE) {
        // Every listed measure is real, and picking ANY of them must throw
        // the ambiguous-measure error (the real F4 guard, not a re-derived
        // comparison).
        const ambiguous = c.expect.ambiguousMeasures ?? [];
        expect(ambiguous.length).toBeGreaterThanOrEqual(2);
        for (const code of ambiguous) {
          expect(measureCodes).toContain(code);
          expect(() => validateTableParseOutput(cannedFromLabel(c, input, code), input)).toThrow(
            TableParseAmbiguousMeasureError,
          );
        }
      } else {
        expect(c.expect.ambiguousMeasures).toBeUndefined();
        if (c.expect.acceptableMeasureCodes !== undefined) {
          // acceptableMeasureCodes REPLACES measureCode — a case has exactly
          // one of the two (breadth step 4b, Task 2).
          expect(c.expect.measureCode).toBeUndefined();
          expect(c.expect.acceptableMeasureCodes.length).toBeGreaterThanOrEqual(2);
          for (const code of c.expect.acceptableMeasureCodes) {
            expect(measureCodes).toContain(code);
          }
        } else {
          expect(c.expect.measureCode).toBeDefined();
          if (c.expect.measureCode !== 'geen') expect(measureCodes).toContain(c.expect.measureCode);
        }
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
      const scope = c.expect.regionScope ?? null;
      expect(scope === null || REGION_SCOPES.has(scope)).toBe(true);
      if (c.expect.outcome !== undefined) expect(c.expect.outcome).toBe('region_unavailable');

      // --- the label, run through the real validator --------------------
      // (An 'ambiguous' label is checked above, measure by measure.)
      if (c.expect.measureCode !== LABEL_AMBIGUOUS_MEASURE) {
        const canned = cannedFromLabel(c, input, representativeMeasureCode(c));
        if (c.expect.outcome === 'region_unavailable') {
          expect(() => validateTableParseOutput(canned, input)).toThrow(TableParseRegionUnavailableError);
        } else {
          expect(() => validateTableParseOutput(canned, input)).not.toThrow();
        }
      }
    },
  );

  it('expectedErrorClass maps the two refusal label forms, and nothing else', () => {
    for (const c of set.cases) {
      const expected =
        c.expect.measureCode === LABEL_AMBIGUOUS_MEASURE
          ? 'TableParseAmbiguousMeasureError'
          : c.expect.outcome === 'region_unavailable'
            ? 'TableParseRegionUnavailableError'
            : null;
      expect(expectedErrorClass(c)).toBe(expected);
    }
  });

  it('covers every category the brief requires at its stated minimum', () => {
    const geenCount = set.cases.filter((c) => c.expect.measureCode === 'geen').length;
    const andersCount = set.cases.filter((c) => Object.values(c.expect.breakdowns).includes('anders')).length;
    const regionCount = set.cases.filter((c) => c.expect.regions.length > 0).length;
    const grainCases = set.cases.filter((c) => c.id.startsWith('grain-'));
    const totalCases = set.cases.filter((c) => c.id.startsWith('total-'));
    const nototalCases = set.cases.filter((c) => c.id.startsWith('nototal-'));

    const ambiguousCount = set.cases.filter((c) => c.expect.measureCode === LABEL_AMBIGUOUS_MEASURE).length;
    const acceptableMeasuresCount = set.cases.filter((c) => c.expect.acceptableMeasureCodes !== undefined).length;
    const regionUnavailableCount = set.cases.filter((c) => c.expect.outcome === 'region_unavailable').length;
    // Breadth step 4b, Task 2: the ambiguous-measure category's real-world
    // minimum was RELAXED from >=1 to >=0, on measured evidence, not a
    // relaxed rule — adding CBS's own measure group to the guard's
    // fingerprint (parse.ts's measureFingerprint) resolved the only
    // same-(title,unit,description) measure set that existed anywhere across
    // the 10 re-fetched fixture tables (80590ned's four
    // "Niet-seizoengecorrigeerd"/"x 1000"/empty-description measures — see
    // 'ambiguous-arbeid-werklozen's own note). None of the 8 eligible tables
    // has a real ambiguous-measure case left. The F4 guard itself is still
    // exercised directly (and still throws on a truly identical pair) by a
    // synthetic case in tests/answer/table-parse/parse.test.ts — this
    // minimum is about the REAL-WORLD labelled set, not about whether the
    // guard still works.
    expect(ambiguousCount).toBeGreaterThanOrEqual(0);
    // The acceptableMeasureCodes form (new in breadth step 4b) needs at
    // least one real exercise too, or the mechanism itself is untested here.
    expect(acceptableMeasuresCount).toBeGreaterThanOrEqual(1);
    expect(regionUnavailableCount).toBeGreaterThanOrEqual(1);
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

describe('tableparse-eval.ts — recorded-fixture labels (F7)', () => {
  it('maps every case\'s exact serialized user turn back to its own case id', () => {
    const index = buildLabelIndex(set.cases);
    expect(index.size).toBe(set.cases.length);
    for (const c of set.cases) {
      const { schema, codeLists } = loadTableFixture(c.table);
      const input = buildTableParseSchema(schema, codeLists, c.question);
      expect(index.get(buildTableParseRequest(c.question, input).question)).toBe(c.id);
    }
  });

  it('does not label the bare question (the recorder only ever sees the serialized turn)', () => {
    const index = buildLabelIndex(set.cases);
    expect(index.get(set.cases[0]!.question)).toBeUndefined();
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

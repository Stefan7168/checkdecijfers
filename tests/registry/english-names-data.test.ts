// ADR 058 (English answers, Task 3; Fix round 1): the literal tables in
// english-names.data.ts are filled from CBS's own English (ENG) sibling
// tables where one exists (scripts/english-names-fetch.ts writes
// english-names.cbs.generated.ts), and by hand — reading the Dutch table's
// own definition text — where CBS publishes no English sibling. This test is
// the bar Task 3 was built against.
//
// Fix round 1 corrected the coverage test's own bug: it used to check the
// registry's `measureTitle` FIELD (src/registry/defaults.ts), which can be a
// session-assembled "TopicGroup / Topic" breadcrumb no ResultCell ever
// actually carries. It now checks the RUNTIME title — exactly what
// src/query/resolve.ts's `normalizeLabel(measureMeta.title)` puts on a
// ResultCell, read from the SAME fixture (tests/fixtures/cbs/<table>/
// measure-codes.json) ingestion itself reads — for a canonical measure's own
// `measure` code AND every alternate that carries its own `measure` code (an
// alternate that only varies `dims` keeps the primary's code, already
// covered).
//
// Restricted to CBS tables only (sourceKeyForTableId/resolveSourceForTable,
// src/sources/registry.ts): a future Eurostat canonical measure's
// `measureTitle` is Eurostat's own English label already (ADR 048), not a
// Dutch string this list translates, so it is out of scope for this table —
// same reasoning as this task's binding context from Task 2.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CANONICAL_MEASURES } from '../../src/registry/defaults.ts';
import type { CanonicalMeasure } from '../../src/registry/types.ts';
import { sourceKeyForTableId, CBS_SOURCE_KEY } from '../../src/sources/registry.ts';
import {
  CONFLICTED,
  CURATED,
  DIM_LABELS,
  HAND_DIM_LABELS,
  HAND_MEASURE_TITLES,
  HAND_REGIONS,
  HAND_TABLE_TITLES,
  MEASURE_TITLES,
  OVERRIDDEN_BY_HAND,
  REGIONS,
  TABLE_TITLES,
} from '../../src/registry/english-names.data.ts';
import {
  CBS_DIM_LABELS,
  CBS_MEASURE_TITLES,
  CBS_REGIONS,
  CBS_TABLE_TITLES,
} from '../../src/registry/english-names.cbs.generated.ts';

const FIXTURES_DIR = fileURLToPath(new URL('../fixtures/cbs', import.meta.url));

function normalizeLabel(label: string): string {
  return label.replace(/\s+/g, ' ').trim();
}

/** The Dutch title actually stored at runtime for a measure code
 * (src/query/resolve.ts's `normalizeLabel(measureMeta.title)`, sourced from
 * src/ingestion/pipeline.ts / src/cbs-adapter/parse-v4.ts's raw
 * measure-codes Title) — reads the SAME fixture the ingestion tests use, so
 * this proves the SAME thing a live ResultCell would show. */
function runtimeTitle(tableId: string, measureCode: string): string {
  const raw = JSON.parse(readFileSync(`${FIXTURES_DIR}/${tableId}/measure-codes.json`, 'utf8'));
  const row = raw.value.find((r: { Identifier: string }) => r.Identifier === measureCode);
  if (!row) throw new Error(`fixture ${tableId}/measure-codes.json has no measure "${measureCode}"`);
  return normalizeLabel(row.Title);
}

/** Every measure code a canonical measure can put in a ResultCell: its own
 * `measure`, plus every alternate that carries its own `measure` code.
 * Mirrors scripts/english-names-fetch.ts's own reachable-set logic — keep
 * both in sync. */
function reachableMeasureCodes(m: CanonicalMeasure): string[] {
  const codes = [m.measure];
  for (const alt of m.alternates ?? []) if (alt.measure) codes.push(alt.measure);
  return codes;
}

const cbsMeasures = CANONICAL_MEASURES.filter((m) => sourceKeyForTableId(m.tableId) === CBS_SOURCE_KEY);

/** Every {table, code, runtime title} a registered CBS canonical measure can
 * actually show, computed once for both tests below. */
const reachable = cbsMeasures.flatMap((m) =>
  reachableMeasureCodes(m).map((code) => ({ tableId: m.tableId, code, title: runtimeTitle(m.tableId, code) })),
);

describe('english-names data', () => {
  it('has an English title for every runtime measure title a registered CBS canonical measure can show', () => {
    const missing = reachable
      .filter((r) => !(r.title in MEASURE_TITLES) && !CONFLICTED.has(r.title))
      .map((r) => `${r.tableId}/${r.code}: "${r.title}"`);
    expect(missing).toEqual([]);
  });

  it('never actually resolves a CONFLICTED Dutch string — a conflict is either genuinely unresolved (no entry) or the set is stale', () => {
    for (const nl of CONFLICTED) {
      expect(nl in MEASURE_TITLES).toBe(false);
      expect(nl in TABLE_TITLES).toBe(false);
    }
  });

  it('never maps to an empty string or a digit-changed string', () => {
    for (const [nl, en] of Object.entries({ ...MEASURE_TITLES, ...TABLE_TITLES })) {
      expect(en.trim().length).toBeGreaterThan(0);
      expect((en.match(/\d+/g) ?? []).join()).toBe((nl.match(/\d+/g) ?? []).join());
    }
  });

  it('marks curated entries only for labels that exist in the maps', () => {
    for (const nl of CURATED) expect(nl in MEASURE_TITLES || nl in TABLE_TITLES).toBe(true);
  });

  it('never lets a hand-written entry silently diverge from a CBS-sourced one for the same key', () => {
    const checkPair = (cbs: Record<string, string>, hand: Record<string, string>, label: string) => {
      const conflicts: string[] = [];
      for (const [key, cbsValue] of Object.entries(cbs)) {
        if (!(key in hand)) continue;
        const handValue = hand[key]!;
        if (handValue === cbsValue) continue;
        if (OVERRIDDEN_BY_HAND.has(key)) continue;
        conflicts.push(`${label} "${key}": CBS="${cbsValue}" HAND="${handValue}"`);
      }
      expect(conflicts).toEqual([]);
    };
    checkPair(CBS_MEASURE_TITLES, HAND_MEASURE_TITLES, 'measure title');
    checkPair(CBS_TABLE_TITLES, HAND_TABLE_TITLES, 'table title');
    checkPair(CBS_DIM_LABELS, HAND_DIM_LABELS, 'dim label');
    checkPair(CBS_REGIONS, HAND_REGIONS, 'region');
  });

  it('every OVERRIDDEN_BY_HAND key really is overridden (both sides exist and genuinely differ) — otherwise the exception is stale', () => {
    const composed: Array<[Record<string, string>, Record<string, string>]> = [
      [CBS_MEASURE_TITLES, HAND_MEASURE_TITLES],
      [CBS_TABLE_TITLES, HAND_TABLE_TITLES],
      [CBS_DIM_LABELS, HAND_DIM_LABELS],
      [CBS_REGIONS, HAND_REGIONS],
    ];
    for (const key of OVERRIDDEN_BY_HAND) {
      const found = composed.some(([cbs, hand]) => key in cbs && key in hand && cbs[key] !== hand[key]);
      expect(found, `"${key}" is listed in OVERRIDDEN_BY_HAND but no CBS/HAND pair for it actually differs`).toBe(true);
    }
  });

  it('composes REGIONS from CBS_REGIONS and HAND_REGIONS (hand wins)', () => {
    expect(REGIONS.Nederland).toBe(HAND_REGIONS.Nederland);
    expect(REGIONS.Nederland).not.toBe(CBS_REGIONS.Nederland);
  });
});

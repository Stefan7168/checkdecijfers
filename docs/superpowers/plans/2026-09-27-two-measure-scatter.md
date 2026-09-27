# Two-measure scatter ("Plot against…") Implementation Plan — Part 1 of 2

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the backend building blocks for a scatter chart that pairs two CBS regional measures per region: a paired
query (two ordinary region-set legs + a pure region join) and a deterministic, zod-validated `ScatterSpec`.

**Architecture:** a pair intent is an ordinary `StructuredIntent` plus one present-only field `pairWith`. It never
goes through `runQuery` directly (that refuses it); `runPairQuery` strips `pairWith`, runs the asked-about measure
(vertical axis, "y") and the added measure (horizontal axis, "x") as two normal `region_set` queries, and joins them
with the pure `pairRegions`. `buildScatterSpec` turns the two results into the chart spec. Nothing user-visible
changes in Part 1 — no chip offers a pair intent yet (Part 2).

**Tech Stack:** TypeScript (strict), zod, vitest, PGlite hermetic DB (`tests/helpers/ingested-db.ts`, ADR 009).

**Spec:** [docs/superpowers/specs/2026-09-27-two-measure-scatter-design.md](../specs/2026-09-27-two-measure-scatter-design.md)

## Global Constraints

- `INTENT_SCHEMA_VERSION` stays `1`; `pairWith` is ADDITIVE and PRESENT-ONLY (docs/13): readers use `?? undefined`.
- A pair intent is valid only with: `regionSet` set, no explicit `regions`, `period: {kind:'codes', codes:[one]}`,
  `derivation: 'none'`, `target` and `pairWith` both `kind: 'canonical'`, different keys.
- `runQuery`/`resolveIntent` REFUSE any intent carrying `pairWith` (`invalid_intent`) — no path may silently ignore
  the second measure.
- A region gets a dot only when BOTH legs have a cell with a non-null value; never impute (principle (c)).
- `SCATTER_MIN_PAIRS = 3`; fewer pairs refuses `no_data`.
- Log scale default: an axis is `'log'` exactly when every plotted value on it is `> 0` and `max / min >= 100`.
- Labelled extremes: only when `pairing.complete` AND both legs' `regionSet.complete`; highest and lowest on y, then
  on x, de-duplicated, at most 4, in that order. Otherwise `labelled: []`.
- Display strings come from `formatValueNl` (`src/answer/compose/format.ts`) — renderers never format numbers (R6).
- No LLM-facing change anywhere (no prompt, no fixture). No DB migration. No new dependency.
- One vitest process at a time, in the foreground (8 GB machine). Never `git add -A`.

---

### Task 1: Paired query — `pairWith`, `runPairQuery`, `pairRegions`

**Files:**
- Modify: `src/query/types.ts` (add `pairWith?` to `StructuredIntent`, after `regionSet?`, ~line 75)
- Modify: `src/query/resolve.ts:240-248` (refuse `pairWith` at the top of `resolveIntent`)
- Create: `src/query/pair.ts`
- Modify: `src/query/index.ts` (export the new module)
- Test: `tests/query/pair.test.ts` (pure, synthetic results)
- Test: `tests/query/pair-run.test.ts` (hermetic DB)

**Interfaces:**
- Produces (all from `src/query/index.ts`):
  - `SCATTER_MIN_PAIRS: 3`
  - `pairIntentProblem(intent: StructuredIntent): string | null`
  - `legIntents(intent: StructuredIntent): { y: StructuredIntent; x: StructuredIntent }`
  - `type SideState = 'value' | 'withheld' | 'not_applicable' | 'missing'`
  - `interface PairSide { state: SideState; cell: ResultCell | null }`
  - `interface RegionPair { regionCode: string; regionLabel: string; y: ResultCell; x: ResultCell }`
  - `interface LeftOutRegion { regionCode: string; regionLabel: string | null; y: PairSide; x: PairSide }`
  - `interface RegionPairing { pairs: RegionPair[]; leftOut: LeftOutRegion[]; notApplicable: string[]; complete: boolean }`
  - `pairRegions(y: ValidatedResult, x: ValidatedResult): RegionPairing`
  - `interface PairedResults { ok: true; result: ValidatedResult; pairedResult: ValidatedResult; pairing: RegionPairing }`
  - `type PairOutcome = PairedResults | QueryRefusal`
  - `runPairQuery(db: Db, intent: StructuredIntent, options?: QueryOptions): Promise<PairOutcome>`

- [ ] **Step 1: Write the failing pure test** — `tests/query/pair.test.ts`:

```ts
// Two-measure scatter (spec 2026-09-27), Task 1: the pure pair-intent rule and
// the region join. Synthetic results — only the fields pair.ts reads are real.
import { describe, expect, it } from 'vitest';
import { legIntents, pairIntentProblem, pairRegions } from '../../src/query/index.ts';
import type { ResultCell, StructuredIntent, ValidatedResult } from '../../src/query/index.ts';

const base: StructuredIntent = {
  schemaVersion: 1,
  target: { kind: 'canonical', key: 'average_home_sale_price_by_gemeente' },
  regionSet: { kind: 'all_provincies' },
  period: { kind: 'codes', codes: ['2024JJ00'] },
  derivation: 'none',
  pairWith: { kind: 'canonical', key: 'population_on_1_january' },
};

function cell(tableId: string, regionCode: string, value: number | null, attr = 'None'): ResultCell {
  return {
    resultId: `${tableId}:M:${regionCode}:2024JJ00:-`,
    tableId,
    measure: 'M',
    measureTitle: 'm',
    regionCode,
    regionLabel: `Label ${regionCode}`,
    periodCode: '2024JJ00',
    periodLabel: '2024',
    grain: 'JJ',
    dims: {},
    dimLabels: {},
    value,
    unit: 'x',
    decimals: 0,
    status: 'Definitief',
    provisional: false,
    valueAttribute: attr,
    batchId: 1,
  };
}

function result(
  tableId: string,
  cells: ResultCell[],
  buckets: { notApplicable?: string[]; withheld?: string[]; missing?: string[] } = {},
): ValidatedResult {
  const withheld = buckets.withheld ?? [];
  const missing = buckets.missing ?? [];
  return {
    shape: 'region_set',
    cells,
    regionSet: {
      scope: { kind: 'all_provincies' },
      rosterSize: cells.length + (buckets.notApplicable ?? []).length + missing.length,
      notApplicable: buckets.notApplicable ?? [],
      withheld,
      missing,
      complete: withheld.length === 0 && missing.length === 0,
    },
  } as unknown as ValidatedResult;
}

describe('pairIntentProblem', () => {
  it('accepts the one supported shape', () => {
    expect(pairIntentProblem(base)).toBeNull();
  });
  it.each([
    ['no pairWith', { ...base, pairWith: undefined }],
    ['no region class', { ...base, regionSet: undefined }],
    ['explicit regions', { ...base, regions: ['PV20'] }],
    ['two periods', { ...base, period: { kind: 'codes', codes: ['2023JJ00', '2024JJ00'] } }],
    ['a range', { ...base, period: { kind: 'range', from: '2023JJ00', to: '2024JJ00' } }],
    ['a derivation', { ...base, derivation: 'max' }],
    ['an explicit target', { ...base, target: { kind: 'explicit', tableId: '83625NED', measure: 'M001534' } }],
    ['the same measure twice', { ...base, pairWith: { kind: 'canonical', key: 'average_home_sale_price_by_gemeente' } }],
  ] as [string, StructuredIntent][])('refuses %s', (_name, intent) => {
    expect(pairIntentProblem(intent)).not.toBeNull();
  });
});

describe('legIntents', () => {
  it('y is the asked-about measure, x the added one; neither leg carries pairWith', () => {
    const { y, x } = legIntents(base);
    expect(y.target).toEqual(base.target);
    expect(x.target).toEqual(base.pairWith);
    expect('pairWith' in y).toBe(false);
    expect('pairWith' in x).toBe(false);
    expect(x.regionSet).toEqual(base.regionSet);
    expect(x.period).toEqual(base.period);
  });
});

describe('pairRegions', () => {
  it('pairs a region only when both legs carry a value, in y cell order', () => {
    const y = result('Y', [cell('Y', 'B', 2), cell('Y', 'A', 1)]);
    const x = result('X', [cell('X', 'A', 10), cell('X', 'B', 20)]);
    const p = pairRegions(y, x);
    expect(p.pairs.map((r) => r.regionCode)).toEqual(['B', 'A']);
    expect(p.pairs[0].y.value).toBe(2);
    expect(p.pairs[0].x.value).toBe(20);
    expect(p.pairs[0].regionLabel).toBe('Label B');
    expect(p.leftOut).toEqual([]);
    expect(p.complete).toBe(true);
  });

  it('a withheld cell on one side leaves the region out, with the side state and its cell', () => {
    const y = result('Y', [cell('Y', 'A', 1), cell('Y', 'B', null, 'Secret')], { withheld: ['B'] });
    const x = result('X', [cell('X', 'A', 10), cell('X', 'B', 20)]);
    const p = pairRegions(y, x);
    expect(p.pairs.map((r) => r.regionCode)).toEqual(['A']);
    expect(p.leftOut).toHaveLength(1);
    expect(p.leftOut[0].regionCode).toBe('B');
    expect(p.leftOut[0].y.state).toBe('withheld');
    expect(p.leftOut[0].y.cell?.valueAttribute).toBe('Secret');
    expect(p.leftOut[0].x.state).toBe('value');
    expect(p.complete).toBe(false);
  });

  it('a region absent from the other leg entirely is left out as missing on that side', () => {
    const y = result('Y', [cell('Y', 'A', 1), cell('Y', 'C', 3)]);
    const x = result('X', [cell('X', 'A', 10)]);
    const p = pairRegions(y, x);
    expect(p.leftOut.map((r) => [r.regionCode, r.y.state, r.x.state])).toEqual([['C', 'value', 'missing']]);
    expect(p.leftOut[0].regionLabel).toBe('Label C');
  });

  it('not applicable on one side and no value on the other is not a member: skipped, not left out', () => {
    const y = result('Y', [cell('Y', 'A', 1)], { notApplicable: ['D'] });
    const x = result('X', [cell('X', 'A', 10)]);
    const p = pairRegions(y, x);
    expect(p.notApplicable).toEqual(['D']);
    expect(p.leftOut).toEqual([]);
    expect(p.complete).toBe(true);
  });

  it('not applicable on one side but a value on the other is disclosed, never dropped silently', () => {
    const y = result('Y', [cell('Y', 'A', 1)], { notApplicable: ['E'] });
    const x = result('X', [cell('X', 'A', 10), cell('X', 'E', 50)]);
    const p = pairRegions(y, x);
    expect(p.notApplicable).toEqual([]);
    expect(p.leftOut.map((r) => [r.regionCode, r.y.state, r.x.state])).toEqual([['E', 'not_applicable', 'value']]);
    expect(p.leftOut[0].regionLabel).toBe('Label E');
  });

  it('accounts for every region of both legs exactly once', () => {
    const y = result('Y', [cell('Y', 'A', 1), cell('Y', 'B', null, 'Secret')], { withheld: ['B'], missing: ['F'], notApplicable: ['D'] });
    const x = result('X', [cell('X', 'A', 10), cell('X', 'G', 7)]);
    const p = pairRegions(y, x);
    const all = [...p.pairs.map((r) => r.regionCode), ...p.leftOut.map((r) => r.regionCode), ...p.notApplicable];
    expect([...all].sort()).toEqual(['A', 'B', 'D', 'F', 'G']);
    expect(new Set(all).size).toBe(all.length);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/query/pair.test.ts`
Expected: FAIL — `legIntents`/`pairIntentProblem`/`pairRegions` are not exported from `src/query/index.ts`.

- [ ] **Step 3: Add `pairWith` to the intent** — in `src/query/types.ts`, directly after the `regionSet?: RegionScope;`
  member of `StructuredIntent`:

```ts
  /** Two-measure scatter (spec 2026-09-27, #296): the ADDED measure a scatter
   * plots against `target`, over the same region class and period. Valid only
   * with a `regionSet`, one period code, derivation 'none' and two different
   * canonical keys (src/query/pair.ts pairIntentProblem). A paired intent runs
   * ONLY through runPairQuery — resolveIntent refuses it, so no path can
   * silently answer one of the two measures.
   *
   * ADDITIVE and PRESENT-ONLY (docs/13), exactly like `regionSet`: every stored
   * intent lacks the key, INTENT_SCHEMA_VERSION is not bumped, readers use
   * `?? undefined`. */
  pairWith?: IntentTarget;
```

- [ ] **Step 4: Refuse `pairWith` in `resolveIntent`** — in `src/query/resolve.ts`, directly after the
  `schemaVersion` check at the top of `resolveIntent`:

```ts
  // Two-measure scatter (spec 2026-09-27): a paired intent is two queries, run
  // by src/query/pair.ts runPairQuery. Reaching the single-measure resolver
  // with one would answer `target` alone and drop the second measure silently.
  if (intent.pairWith !== undefined) {
    return refuse(intent, 'invalid_intent', 'a paired (two-measure) intent runs through runPairQuery, never runQuery');
  }
```

- [ ] **Step 5: Create `src/query/pair.ts`**

```ts
// Two-measure scatter (spec docs/superpowers/specs/2026-09-27-two-measure-scatter-design.md,
// open-questions #296): the paired query. A pair intent is TWO ordinary
// region-set queries — the asked-about measure (y, vertical axis) and the added
// measure (x, horizontal axis) — over the same region class and period, joined
// on region code by the pure pairRegions below. Each leg stays a normal
// single-lineage ValidatedResult, so every per-result rule (R1, R9, R10, R11,
// attribution) applies to each unchanged (spec D3). The join is recomputed from
// the two stored results wherever it is needed (compose, chart, audit) and is
// never stored itself (spec D4).
import type { Db } from '../db/types.ts';
import { runQuery } from './run.ts';
import type { QueryOptions } from './resolve.ts';
import type { QueryRefusal, ResultCell, StructuredIntent, ValidatedResult } from './types.ts';

/** Fewer paired regions than this is not a scatter worth drawing; refused `no_data`. */
export const SCATTER_MIN_PAIRS = 3;

/** Null when `intent` is a supported pair intent, else the owner-readable reason. */
export function pairIntentProblem(intent: StructuredIntent): string | null {
  const pair = intent.pairWith;
  if (pair === undefined) return 'the intent has no pairWith';
  if (intent.regionSet === undefined) return 'a paired intent needs a region class (regionSet)';
  if ((intent.regions ?? []).length > 0) return 'a paired intent cannot also name explicit regions';
  if (intent.period.kind !== 'codes' || intent.period.codes.length !== 1) {
    return 'a paired intent needs exactly one period code';
  }
  if (intent.derivation !== 'none') return `a paired intent needs derivation "none", got "${intent.derivation}"`;
  if (intent.target.kind !== 'canonical' || pair.kind !== 'canonical') {
    return 'a paired intent needs two canonical measures';
  }
  if (intent.target.key === pair.key) return 'a paired intent names the same measure twice';
  return null;
}

/** The two single-measure legs: y = the asked-about `target`, x = `pairWith`. */
export function legIntents(intent: StructuredIntent): { y: StructuredIntent; x: StructuredIntent } {
  const { pairWith, ...y } = intent;
  if (pairWith === undefined) throw new Error('legIntents: the intent has no pairWith');
  return { y, x: { ...y, target: pairWith } };
}

export type SideState = 'value' | 'withheld' | 'not_applicable' | 'missing';

export interface PairSide {
  state: SideState;
  /** The leg's cell for this region: set for 'value' and 'withheld', null otherwise. */
  cell: ResultCell | null;
}

export interface RegionPair {
  regionCode: string;
  regionLabel: string;
  y: ResultCell;
  x: ResultCell;
}

export interface LeftOutRegion {
  regionCode: string;
  /** From whichever leg has a cell; null when neither has one (missing on both). */
  regionLabel: string | null;
  y: PairSide;
  x: PairSide;
}

export interface RegionPairing {
  /** Regions with a value on both legs, in the y leg's cell order. */
  pairs: RegionPair[];
  /** Every other region of either leg that has a value or a withheld cell on at
   * least one side, or is missing — disclosed with each side's state (R11). */
  leftOut: LeftOutRegion[];
  /** Not a member of the class at this period per CBS (`Impossible`) on at
   * least one leg, with no value and no withheld cell on the other. */
  notApplicable: string[];
  /** True exactly when nothing is left out. */
  complete: boolean;
}

function sideOf(leg: ValidatedResult, regionCode: string): PairSide {
  const cell = leg.cells.find((c) => c.regionCode === regionCode) ?? null;
  if (cell !== null) return { state: cell.value !== null ? 'value' : 'withheld', cell };
  if ((leg.regionSet?.notApplicable ?? []).includes(regionCode)) return { state: 'not_applicable', cell: null };
  return { state: 'missing', cell: null };
}

/** Join two region-set results on region code. Pure; deterministic order. */
export function pairRegions(y: ValidatedResult, x: ValidatedResult): RegionPairing {
  const codes: string[] = [];
  const add = (code: string | null): void => {
    if (code !== null && !codes.includes(code)) codes.push(code);
  };
  for (const leg of [y, x]) for (const c of leg.cells) add(c.regionCode);
  for (const leg of [y, x]) {
    const cov = leg.regionSet;
    for (const code of [...(cov?.withheld ?? []), ...(cov?.missing ?? []), ...(cov?.notApplicable ?? [])]) add(code);
  }

  const pairs: RegionPair[] = [];
  const leftOut: LeftOutRegion[] = [];
  const notApplicable: string[] = [];
  for (const code of codes) {
    const ys = sideOf(y, code);
    const xs = sideOf(x, code);
    if (ys.state === 'value' && xs.state === 'value') {
      pairs.push({ regionCode: code, regionLabel: ys.cell!.regionLabel ?? xs.cell!.regionLabel ?? code, y: ys.cell!, x: xs.cell! });
      continue;
    }
    const anyCell = ys.cell !== null || xs.cell !== null;
    if (!anyCell && (ys.state === 'not_applicable' || xs.state === 'not_applicable')) {
      notApplicable.push(code);
      continue;
    }
    leftOut.push({ regionCode: code, regionLabel: ys.cell?.regionLabel ?? xs.cell?.regionLabel ?? null, y: ys, x: xs });
  }
  return { pairs, leftOut, notApplicable, complete: leftOut.length === 0 };
}

export interface PairedResults {
  ok: true;
  /** The asked-about measure (vertical axis). */
  result: ValidatedResult;
  /** The added measure (horizontal axis). */
  pairedResult: ValidatedResult;
  pairing: RegionPairing;
}

export type PairOutcome = PairedResults | QueryRefusal;

function refusePair(intent: StructuredIntent, kind: QueryRefusal['refusal']['kind'], message: string): QueryRefusal {
  return { ok: false, refusal: { kind, message }, intent };
}

/** Run a paired intent: both legs through the ordinary runQuery, then the join.
 * A refused leg refuses the pair (with the leg's own refusal, re-pinned to the
 * full pair intent); too few pairs refuses `no_data` — never a partial scatter
 * of one measure. */
export async function runPairQuery(db: Db, intent: StructuredIntent, options: QueryOptions = {}): Promise<PairOutcome> {
  const problem = pairIntentProblem(intent);
  if (problem !== null) return refusePair(intent, 'invalid_intent', problem);
  const legs = legIntents(intent);

  const y = await runQuery(db, legs.y, options);
  if (!y.ok) return { ...y, intent };
  const x = await runQuery(db, legs.x, options);
  if (!x.ok) return { ...x, intent };

  if (y.shape !== 'region_set' || x.shape !== 'region_set') {
    return refusePair(intent, 'internal_inconsistency', `a paired leg did not answer as a region set (y=${y.shape}, x=${x.shape})`);
  }
  const period = intent.period.kind === 'codes' ? intent.period.codes[0] : null;
  const offPeriod = [...y.cells, ...x.cells].find((c) => c.periodCode !== period);
  if (offPeriod !== undefined) {
    return refusePair(intent, 'internal_inconsistency', `a paired leg returned period ${offPeriod.periodCode}, expected ${period}`);
  }

  const pairing = pairRegions(y, x);
  if (pairing.pairs.length < SCATTER_MIN_PAIRS) {
    return refusePair(intent, 'no_data', `only ${pairing.pairs.length} region(s) carry both measures; a scatter needs ${SCATTER_MIN_PAIRS}`);
  }
  return { ok: true, result: y, pairedResult: x, pairing };
}
```

- [ ] **Step 6: Export it** — in `src/query/index.ts`, add after the region-set exports:

```ts
export { SCATTER_MIN_PAIRS, pairIntentProblem, legIntents, pairRegions, runPairQuery } from './pair.ts';
export type { SideState, PairSide, RegionPair, LeftOutRegion, RegionPairing, PairedResults, PairOutcome } from './pair.ts';
```

- [ ] **Step 7: Run the pure test — expect PASS**

Run: `npx vitest run tests/query/pair.test.ts`
Expected: PASS (all cases).

- [ ] **Step 8: Write the hermetic run test** — `tests/query/pair-run.test.ts`:

```ts
// Two-measure scatter (spec 2026-09-27), Task 1: runPairQuery against the real
// hermetic ingest (ADR 009). Both fixtures carry 2024JJ00 for all 12 provinces
// and for the gemeenten of PV26, and the two tables disagree on which gemeenten
// exist (region-set.ts header: PV26 has 54 in 03759ned, 42 in 83625NED).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runPairQuery, runQuery, SCATTER_MIN_PAIRS } from '../../src/query/index.ts';
import type { RegionScope, StructuredIntent } from '../../src/query/index.ts';
import type { Db } from '../../src/db/types.ts';
import { createIngestedDb } from '../helpers/ingested-db.ts';

let db: Db;
let close: () => Promise<void>;

function pair(regionSet: RegionScope, period = '2024JJ00'): StructuredIntent {
  return {
    schemaVersion: 1,
    target: { kind: 'canonical', key: 'average_home_sale_price_by_gemeente' },
    regionSet,
    period: { kind: 'codes', codes: [period] },
    derivation: 'none',
    pairWith: { kind: 'canonical', key: 'population_on_1_january' },
  };
}

beforeAll(async () => {
  ({ db, close } = await createIngestedDb());
}, 300_000);

afterAll(async () => {
  await close();
});

describe('runPairQuery', () => {
  it('pairs all 12 provinces: y = home price (83625NED), x = population (03759ned)', async () => {
    const outcome = await runPairQuery(db, pair({ kind: 'all_provincies' }));
    if (!outcome.ok) throw new Error(`${outcome.refusal.kind}: ${outcome.refusal.message}`);
    expect(outcome.result.attribution.tableId).toBe('83625NED');
    expect(outcome.pairedResult.attribution.tableId).toBe('03759ned');
    expect(outcome.pairing.pairs).toHaveLength(12);
    expect(outcome.pairing.complete).toBe(true);
    for (const p of outcome.pairing.pairs) {
      expect(p.y.regionCode).toBe(p.regionCode);
      expect(p.x.regionCode).toBe(p.regionCode);
      expect(p.y.value).not.toBeNull();
      expect(p.x.value).not.toBeNull();
    }
    expect('pairWith' in outcome.result.intent).toBe(false);
  });

  it('gemeenten in PV26: every member of either roster is accounted for exactly once', async () => {
    const outcome = await runPairQuery(db, pair({ kind: 'gemeenten_in_provincie', parent: 'PV26' }));
    if (!outcome.ok) throw new Error(`${outcome.refusal.kind}: ${outcome.refusal.message}`);
    const { pairs, leftOut, notApplicable } = outcome.pairing;
    expect(pairs.length).toBeGreaterThanOrEqual(SCATTER_MIN_PAIRS);
    const accounted = [...pairs.map((p) => p.regionCode), ...leftOut.map((r) => r.regionCode), ...notApplicable];
    expect(new Set(accounted).size).toBe(accounted.length);
    const rosterCodes = new Set<string>();
    for (const leg of [outcome.result, outcome.pairedResult]) {
      for (const c of leg.cells) rosterCodes.add(c.regionCode!);
      for (const code of [...leg.regionSet!.notApplicable, ...leg.regionSet!.withheld, ...leg.regionSet!.missing]) rosterCodes.add(code);
    }
    expect(new Set(accounted)).toEqual(rosterCodes);
    for (const r of leftOut) expect(r.y.state === 'value' && r.x.state === 'value').toBe(false);
  });

  it('refuses when a leg refuses — a period only one table has', async () => {
    // 03759ned carries 2026JJ00, 83625NED stops at 2025JJ00.
    const outcome = await runPairQuery(db, pair({ kind: 'all_provincies' }, '2026JJ00'));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.intent.pairWith).toEqual({ kind: 'canonical', key: 'population_on_1_january' });
  });

  it('refuses a structurally invalid pair intent without querying', async () => {
    const outcome = await runPairQuery(db, { ...pair({ kind: 'all_provincies' }), derivation: 'max' });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.refusal.kind).toBe('invalid_intent');
  });
});

describe('runQuery never answers a paired intent', () => {
  it('refuses invalid_intent instead of silently answering one measure', async () => {
    const outcome = await runQuery(db, pair({ kind: 'all_provincies' }));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.refusal.kind).toBe('invalid_intent');
  });
});
```

- [ ] **Step 9: Run it — expect PASS**

Run: `npx vitest run tests/query/pair-run.test.ts`
Expected: PASS. If the 2026JJ00 case unexpectedly serves (fixture changed), replace the period with one the
`83625NED` fixture lacks (`tests/fixtures/cbs/83625NED/observations-page-1.json`) — the assertion is "a refused leg
refuses the pair", not the specific year.

- [ ] **Step 10: Run the whole query suite + typecheck — no regressions**

Run: `npx vitest run tests/query` then `npx tsc --noEmit -p .`
Expected: all PASS, no type errors.

- [ ] **Step 11: Commit**

```bash
git add src/query/types.ts src/query/resolve.ts src/query/pair.ts src/query/index.ts tests/query/pair.test.ts tests/query/pair-run.test.ts
git commit -m "feat(query): paired two-measure region-set query (#296, scatter Task 1)"
```

---

### Task 2: `ScatterSpec` — type, schema, deterministic builder

**Files:**
- Create: `src/chart/scatter.ts` (type + zod schema + builder in one focused file)
- Modify: `src/chart/index.ts` (export)
- Test: `tests/chart/scatter.test.ts`

**Interfaces:**
- Consumes: `RegionPairing`, `pairRegions` (Task 1); `formatValueNl`, `buildAttributionLine`, `baseRegionLabel`
  (`src/answer/compose/format.ts`); `PROVISIONAL_NOTE` (`src/chart/build.ts`).
- Produces (from `src/chart/index.ts`):
  - `SCATTER_SPEC_VERSION: 1`, `SCATTER_MAX_LABELS: 4`, `LOG_SCALE_MIN_SPREAD: 100`
  - `type AxisScale = 'linear' | 'log'`
  - `interface ScatterAxis { measureTitle: string; unit: string; decimals: number; periodLabel: string; tableId: string; defaultScale: AxisScale; attributionLine: string }`
  - `interface ScatterPoint { regionCode: string; label: string; x: number; y: number; xFormatted: string; yFormatted: string; xResultId: string; yResultId: string; provisional: boolean }`
  - `interface ScatterSpec { schemaVersion: 1; kind: 'scatter'; title: string; y: ScatterAxis; x: ScatterAxis; points: ScatterPoint[]; labelled: string[]; provisionalNote: string | null; license: 'CC BY 4.0' }`
  - `scatterSpecSchema` (zod strictObject matching `ScatterSpec`)
  - `defaultScale(values: number[]): AxisScale`
  - `buildScatterSpec(y: ValidatedResult, x: ValidatedResult): ScatterSpec`

- [ ] **Step 1: Write the failing test** — `tests/chart/scatter.test.ts`:

```ts
// Two-measure scatter (spec 2026-09-27), Task 2: the deterministic ScatterSpec.
import { describe, expect, it } from 'vitest';
import { buildScatterSpec, defaultScale, scatterSpecSchema, SCATTER_MAX_LABELS } from '../../src/chart/index.ts';
import type { ResultCell, ValidatedResult } from '../../src/query/index.ts';

function cell(tableId: string, measureTitle: string, regionCode: string, value: number | null, extra: Partial<ResultCell> = {}): ResultCell {
  return {
    resultId: `${tableId}:M:${regionCode}:2024JJ00:-`,
    tableId,
    measure: 'M',
    measureTitle,
    regionCode,
    regionLabel: `${regionCode} (PV)`,
    periodCode: '2024JJ00',
    periodLabel: '2024',
    grain: 'JJ',
    dims: {},
    dimLabels: {},
    value,
    unit: tableId === 'Y' ? 'euro' : 'aantal',
    decimals: 0,
    status: 'Definitief',
    provisional: false,
    valueAttribute: 'None',
    batchId: 1,
    ...extra,
  };
}

function leg(tableId: string, measureTitle: string, values: Record<string, number | null>, complete = true): ValidatedResult {
  const cells = Object.entries(values).map(([code, v]) => cell(tableId, measureTitle, code, v));
  const withheld = cells.filter((c) => c.value === null).map((c) => c.regionCode!);
  return {
    ok: true,
    schemaVersion: 1,
    shape: 'region_set',
    cells,
    derivations: [],
    attribution: {
      tableId,
      tableTitle: `Tabel ${tableId}`,
      tableVersion: 1,
      syncedAt: '2026-09-01T00:00:00.000Z',
      coveredPeriods: { from: '2024JJ00', to: '2024JJ00' },
      license: 'CC BY 4.0',
      definitionLabel: null,
      definitionText: null,
    },
    intent: {} as never,
    regionSet: {
      scope: { kind: 'all_provincies' },
      rosterSize: cells.length,
      notApplicable: [],
      withheld,
      missing: [],
      complete: complete && withheld.length === 0,
    },
  } as unknown as ValidatedResult;
}

describe('defaultScale', () => {
  it('log when every value is positive and max/min >= 100', () => {
    expect(defaultScale([1_000, 50_000, 900_000])).toBe('log');
  });
  it('linear below a 100x spread', () => {
    expect(defaultScale([200_000, 450_000, 1_200_000])).toBe('linear');
  });
  it('linear when any value is zero or negative', () => {
    expect(defaultScale([0, 10, 100_000])).toBe('linear');
    expect(defaultScale([-5, 10, 100_000])).toBe('linear');
  });
});

describe('buildScatterSpec', () => {
  const y = leg('Y', 'Gemiddelde verkoopprijs', { A: 300_000, B: 500_000, C: 400_000, D: 350_000 });
  const x = leg('X', 'Bevolking op 1 januari', { A: 1_000, B: 900_000, C: 50_000, D: 20_000 });

  it('builds one point per paired region with formatted strings and both result ids', () => {
    const spec = buildScatterSpec(y, x);
    expect(spec.kind).toBe('scatter');
    expect(spec.points.map((p) => p.regionCode)).toEqual(['A', 'B', 'C', 'D']);
    const b = spec.points[1];
    expect(b).toMatchObject({ y: 500_000, x: 900_000, xResultId: 'X:M:B:2024JJ00:-', yResultId: 'Y:M:B:2024JJ00:-' });
    expect(b.label).toBe('B');
    expect(b.yFormatted).toBe('500.000');
    expect(b.xFormatted).toBe('900.000');
    expect(spec.title).toBe('Gemiddelde verkoopprijs tegenover bevolking op 1 januari, 2024');
    expect(spec.y.tableId).toBe('Y');
    expect(spec.x.tableId).toBe('X');
  });

  it('opens the wide-spread axis on a log scale, the narrow one linear', () => {
    const spec = buildScatterSpec(y, x);
    expect(spec.x.defaultScale).toBe('log');
    expect(spec.y.defaultScale).toBe('linear');
  });

  it('labels the extremes (highest y, lowest y, highest x, lowest x), de-duplicated, at most 4', () => {
    const spec = buildScatterSpec(y, x);
    // y: max B, min A; x: max B (dup), min A (dup) → [B, A]
    expect(spec.labelled).toEqual(['B', 'A']);
    expect(spec.labelled.length).toBeLessThanOrEqual(SCATTER_MAX_LABELS);
  });

  it('labels nothing when either leg is incomplete (a withheld value could be the extreme)', () => {
    const yGap = leg('Y', 'Gemiddelde verkoopprijs', { A: 300_000, B: 500_000, C: 400_000, D: null });
    const spec = buildScatterSpec(yGap, x);
    expect(spec.points).toHaveLength(3);
    expect(spec.labelled).toEqual([]);
  });

  it('flags provisional points and sets the provisional note', () => {
    const yProv = leg('Y', 'Gemiddelde verkoopprijs', { A: 300_000, B: 500_000, C: 400_000, D: 350_000 });
    yProv.cells[2] = { ...yProv.cells[2], provisional: true, status: 'Voorlopig' };
    const spec = buildScatterSpec(yProv, x);
    expect(spec.points[2].provisional).toBe(true);
    expect(spec.provisionalNote).not.toBeNull();
  });

  it('validates against its own strict schema', () => {
    expect(scatterSpecSchema.safeParse(buildScatterSpec(y, x)).success).toBe(true);
    expect(scatterSpecSchema.safeParse({ ...buildScatterSpec(y, x), extra: 1 }).success).toBe(false);
  });

  it('is deterministic', () => {
    expect(JSON.stringify(buildScatterSpec(y, x))).toBe(JSON.stringify(buildScatterSpec(y, x)));
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/chart/scatter.test.ts`
Expected: FAIL — `buildScatterSpec` not exported.

- [ ] **Step 3: Create `src/chart/scatter.ts`**

```ts
// Two-measure scatter (spec docs/superpowers/specs/2026-09-27-two-measure-scatter-design.md, D8):
// a chart spec of its own, NOT a new ChartForm. The one-measure ChartSpec and
// its form switcher stay untouched, so ADR 039's "scatter never offered" still
// holds for one-measure charts — a scatter needs two measures.
//
// Built deterministically from the two stored region-set results (R6): every
// plotted number is a projection of one ResultCell per axis (R1, via the two
// result ids), every display string comes from the shared answer formatter
// (R3/R10), and the default scale and the labelled extremes are pure
// functions of the plotted values — so every surface opens the same view and
// audit reconstruction rebuilds the spec byte-identically (R8).
import { z } from 'zod';
import { baseRegionLabel, buildAttributionLine, formatValueNl } from '../answer/compose/format.ts';
import { pairRegions } from '../query/index.ts';
import type { ResultCell, ValidatedResult } from '../query/index.ts';
import { PROVISIONAL_NOTE } from './build.ts';

export const SCATTER_SPEC_VERSION = 1 as const;
/** Highest + lowest on each axis, de-duplicated. */
export const SCATTER_MAX_LABELS = 4;
/** An axis opens on a log scale when max/min reaches this (all values > 0). */
export const LOG_SCALE_MIN_SPREAD = 100;

export type AxisScale = 'linear' | 'log';

export interface ScatterAxis {
  measureTitle: string;
  unit: string;
  decimals: number;
  periodLabel: string;
  tableId: string;
  defaultScale: AxisScale;
  /** The exact R4 attribution sentence of this axis's table. */
  attributionLine: string;
}

export interface ScatterPoint {
  regionCode: string;
  label: string;
  x: number;
  y: number;
  xFormatted: string;
  yFormatted: string;
  /** R1 traceability handles — one CBS cell per axis. */
  xResultId: string;
  yResultId: string;
  provisional: boolean;
}

export interface ScatterSpec {
  schemaVersion: typeof SCATTER_SPEC_VERSION;
  kind: 'scatter';
  title: string;
  /** Vertical axis: the asked-about measure. */
  y: ScatterAxis;
  /** Horizontal axis: the added measure. */
  x: ScatterAxis;
  /** In the y leg's cell order. */
  points: ScatterPoint[];
  /** Region codes to label on the chart (≤ SCATTER_MAX_LABELS); [] unless both
   * legs and the pairing are complete (spec D7: an incomplete side means the
   * true extreme might be a withheld region). */
  labelled: string[];
  provisionalNote: string | null;
  license: 'CC BY 4.0';
}

const axisSchema = z.strictObject({
  measureTitle: z.string(),
  unit: z.string(),
  decimals: z.number().int(),
  periodLabel: z.string(),
  tableId: z.string(),
  defaultScale: z.enum(['linear', 'log']),
  attributionLine: z.string(),
});

export const scatterSpecSchema = z.strictObject({
  schemaVersion: z.literal(SCATTER_SPEC_VERSION),
  kind: z.literal('scatter'),
  title: z.string(),
  y: axisSchema,
  x: axisSchema,
  points: z.array(
    z.strictObject({
      regionCode: z.string(),
      label: z.string(),
      x: z.number(),
      y: z.number(),
      xFormatted: z.string(),
      yFormatted: z.string(),
      xResultId: z.string(),
      yResultId: z.string(),
      provisional: z.boolean(),
    }),
  ),
  labelled: z.array(z.string()).max(SCATTER_MAX_LABELS),
  provisionalNote: z.string().nullable(),
  license: z.literal('CC BY 4.0'),
});

export function defaultScale(values: number[]): AxisScale {
  if (values.length === 0 || values.some((v) => v <= 0)) return 'linear';
  return Math.max(...values) / Math.min(...values) >= LOG_SCALE_MIN_SPREAD ? 'log' : 'linear';
}

function axisOf(result: ValidatedResult, cells: ResultCell[]): ScatterAxis {
  const first = cells[0] ?? result.cells[0];
  return {
    measureTitle: first.measureTitle,
    unit: first.unit,
    decimals: first.decimals,
    periodLabel: first.periodLabel,
    tableId: result.attribution.tableId,
    defaultScale: defaultScale(cells.map((c) => c.value as number)),
    attributionLine: buildAttributionLine(result),
  };
}

function lowerFirst(s: string): string {
  return s.length === 0 ? s : s[0].toLowerCase() + s.slice(1);
}

export function buildScatterSpec(y: ValidatedResult, x: ValidatedResult): ScatterSpec {
  const pairing = pairRegions(y, x);
  const yAxis = axisOf(y, pairing.pairs.map((p) => p.y));
  const xAxis = axisOf(x, pairing.pairs.map((p) => p.x));

  const points: ScatterPoint[] = pairing.pairs.map((p) => ({
    regionCode: p.regionCode,
    label: baseRegionLabel(p.regionLabel),
    x: p.x.value as number,
    y: p.y.value as number,
    xFormatted: formatValueNl(p.x.value as number, p.x.decimals),
    yFormatted: formatValueNl(p.y.value as number, p.y.decimals),
    xResultId: p.x.resultId,
    yResultId: p.y.resultId,
    provisional: p.x.provisional || p.y.provisional,
  }));

  const complete = pairing.complete && (y.regionSet?.complete ?? false) && (x.regionSet?.complete ?? false);
  const labelled: string[] = [];
  if (complete && points.length > 0) {
    const extreme = (key: 'x' | 'y', pick: 'max' | 'min'): string =>
      points.reduce((best, p) => ((pick === 'max' ? p[key] > best[key] : p[key] < best[key]) ? p : best)).regionCode;
    for (const code of [extreme('y', 'max'), extreme('y', 'min'), extreme('x', 'max'), extreme('x', 'min')]) {
      if (!labelled.includes(code) && labelled.length < SCATTER_MAX_LABELS) labelled.push(code);
    }
  }

  return {
    schemaVersion: SCATTER_SPEC_VERSION,
    kind: 'scatter',
    title: `${yAxis.measureTitle} tegenover ${lowerFirst(xAxis.measureTitle)}, ${yAxis.periodLabel}`,
    y: yAxis,
    x: xAxis,
    points,
    labelled,
    provisionalNote: points.some((p) => p.provisional) ? PROVISIONAL_NOTE : null,
    license: 'CC BY 4.0',
  };
}
```

Note: `reduce` keeps the FIRST point on ties (strict `>`/`<`), so ties resolve to the earlier region in y cell order —
deterministic. `baseRegionLabel` strips CBS's "(PV)"/"(gemeente)" suffixes the same way answers do; if the test's
`'B (PV)'` → `'B'` expectation fails, read `baseRegionLabel` (`src/answer/compose/format.ts:18`) and set the test's
`regionLabel` to a form it strips — do NOT change `baseRegionLabel`.

- [ ] **Step 4: Export it** — in `src/chart/index.ts` add:

```ts
export {
  SCATTER_SPEC_VERSION,
  SCATTER_MAX_LABELS,
  LOG_SCALE_MIN_SPREAD,
  scatterSpecSchema,
  defaultScale,
  buildScatterSpec,
} from './scatter.ts';
export type { AxisScale, ScatterAxis, ScatterPoint, ScatterSpec } from './scatter.ts';
```

- [ ] **Step 5: Run the test — expect PASS**

Run: `npx vitest run tests/chart/scatter.test.ts`
Expected: PASS. If `buildAttributionLine` throws on the synthetic attribution (a field it reads that the fixture
lacks), add that field to the test's `attribution` object with a realistic value — do not weaken the builder.

- [ ] **Step 6: Add a hermetic end-to-end check to `tests/query/pair-run.test.ts`** (Task 1's file), inside
  `describe('runPairQuery', …)`:

```ts
  it('the provinces pair builds a valid ScatterSpec with 12 points, x on a log scale', async () => {
    const { buildScatterSpec, scatterSpecSchema } = await import('../../src/chart/index.ts');
    const outcome = await runPairQuery(db, pair({ kind: 'all_provincies' }));
    if (!outcome.ok) throw new Error(outcome.refusal.message);
    const spec = buildScatterSpec(outcome.result, outcome.pairedResult);
    expect(scatterSpecSchema.safeParse(spec).success).toBe(true);
    expect(spec.points).toHaveLength(12);
    expect(spec.labelled.length).toBeGreaterThan(0);
    // Province populations run from ~400k (Zeeland/Flevoland) to ~3.8M (Zuid-Holland): < 100x → linear.
    expect(spec.x.defaultScale).toBe('linear');
  });
```

Run: `npx vitest run tests/query/pair-run.test.ts` — Expected: PASS. (If the fixture's province spread is ≥ 100×,
the builder is right and the comment is wrong — fix the comment and the expectation to match the computed spread.)

- [ ] **Step 7: Run the chart + query suites + typecheck**

Run: `npx vitest run tests/chart` then `npx vitest run tests/query` then `npx tsc --noEmit -p .`
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add src/chart/scatter.ts src/chart/index.ts tests/chart/scatter.test.ts tests/query/pair-run.test.ts
git commit -m "feat(chart): deterministic ScatterSpec for two-measure charts (#296, scatter Task 2)"
```

---

## Part 2 (written as its own plan after Part 1 lands — the seams below are mapped, not yet specified to step level)

Part 2 is user-visible and threads through the answer pipeline, audit and the web app; it gets its own step-level
plan (`docs/superpowers/plans/<date>-two-measure-scatter-part-2.md`) once Part 1's interfaces are real. Mapped seams:

- **Task 3 — answer + audit.** Take-path: `src/answer/respond/respond.ts:422` (`runQuery` → branch to `runPairQuery`
  when `intent.pairWith` is set). Envelope: `AnswerResponse` (`src/answer/respond/types.ts:246`) gains present-only
  `pairedResult?` and `scatter?`; `chart: null`. Template-only compose (`respond.ts:628`, `compose.ts:279`), nl + en
  templates, a structural left-out line alongside `regionSetLine` (`compose.ts:117`, `format.ts:350`, English mirror
  `src/answer/translate/lines.ts:268`). Reconstruction `src/answer/audit/reconstruct.ts:385-464`; envelope-key
  manifest `tests/audit/envelope-key-manifest.test.ts`; `npm run audit:verify`.
- **Task 4 — chip.** Generator `plotAgainst` first in `buildAnswerChips` (`src/answer/respond/suggestions.ts:~630`),
  only on `result.shape === 'region_set'`, iterating `REGIONAL_KEYS` (`src/answer/intent/prompt.ts:120`); pair-aware
  dry-run in `src/query/dry-run.ts:102`; `isClickTakeableIntent` + `validate-pending.ts` (`clickIntentSchema`)
  accept `pairWith` under `pairIntentProblem`.
- **Task 5 — web.** `ScatterView` (Recharts `ScatterChart`): hover, labelled extremes, search, log toggle, swap
  axes, table view; wired where `response.chart` is read — chat card (`web/components/chat.tsx:~999,1261`), embed
  (`web/app/embed/[token]/page.tsx:201`), thread replay (`src/threads/replay.ts`, `web/lib/replay-assemble.ts`),
  copy-answer (`web/lib/copy-answer.ts`), downloads (`web/components/chart-download.tsx`), CSV; i18n in
  `web/lib/i18n/messages.ts`. Real browser check on the dev server.
- **Task 6 — docs.** ADR 060; notes on ADR 039/054/056; `docs/04-architecture.md`; STATUS; open-questions #296.

### Carry-overs from Part 1's final review (session 137) — Part 2 must handle these

- **Audit intent:** write `PairedResults.intent` (the full pair intent) as the audited intent — `resolvedIntent()`
  (`src/answer/audit/write.ts:41`) reads `response.result.intent`, which is only the y leg's one-measure intent.
- **Click validation:** `clickIntentSchema` (`validate-pending.ts`) is a strictObject with NO `regionSet` field today —
  Part 2 adds a strict `RegionScope` schema plus `pairWith`, gated by `pairIntentProblem` AND `REGIONAL_KEYS` membership
  (the membership check lives here, not in `src/query`, which must not import the answer layer — ADR 001); mirror it in
  `isClickTakeableIntent`.
- **Refusal wording:** a malformed pair refuses generic `invalid_intent` (pages the owner) — decide on a
  `pair_not_supported` sub-reason (needs its `RefusalReason` pairing in `reconstruct.ts`) or accept it (only a forged click
  can reach it).
- **Every intent entry point branches on `pairWith`:** respond take-path, `dry-run.ts`, embed-live (already fails closed),
  `resolvedIntent`. Skip chart alternates / alternate readings / chips on a scatter answer (they read the y leg's intent).
- **Left-out line:** build from `LeftOutRegion.y.cell`/`x.cell` `valueAttribute` (CBS's own reason). A region missing on
  one leg and not applicable on the other lands in `notApplicable` yet suppresses labels — don't claim completeness from
  `leftOut` alone.
- **Ties:** a tied extreme labels only the first point — the text must not imply a unique "highest".
- **Provisional:** `ScatterView`, table view and CSV must mark provisional points with `*` (the spec's note promises it).
- **English:** the stored spec stays Dutch; derive the English title at render time.
- **Test gap:** the PV26 hermetic test branches on `pairing.complete` only, not the full three-way label gate — tighten.

# Chart alternate-reading toggle — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** let a chat/dock chart reader switch to any registered alternate reading of the answered
measure (e.g. unemployment's raw vs. seasonally-adjusted, household income's four sibling
definitions) without a new question, a new LLM call, or leaving the chart card.

**Architecture:** `respond.ts` builds every registered alternate `ChartSpec` alongside the primary,
server-side, using the SAME deterministic `runQuery` → `buildChartSpec` pipeline `src/chart/
curated.ts` already proves out — generalized into a new shared, pure function that merges the
alternate's `measure`/`dims` over the PRIMARY's own resolved coordinates (curated's existing
literal-replace is only safe for its one single-key case). The result ships as a new additive
`chartAlternates` field on `AnswerResponse`, sibling to `chart`, never inside it. `ChartView` gets a
new reducer field (`selectedReading`) and a dropdown control; selecting a reading swaps which
spec's DATA is rendered without touching the `spec` PROP's identity — critical, because `ChartView`
already has a "spec identity changed → reset the whole per-chart view state" effect
(`chart.tsx:1587-1599`) that must never fire from a reading switch (that would wipe the reader's
current form/zoom/presentation on every toggle, contradicting the whole point of the feature).

**Tech Stack:** TypeScript, Next.js/React (`web/`), Vitest, Postgres (hermetic test DB, ADR 009).
No new dependency, no migration, no LLM call, no schema bump to `ChartSpec`.

**Spec:** [docs/superpowers/specs/2026-09-16-chart-alternate-reading-toggle-design.md](../specs/2026-09-16-chart-alternate-reading-toggle-design.md)
— read it before Task 1; this plan argues from it and does not repeat its rationale.

## Global Constraints

- **No new derivation, no schema bump to `ChartSpec`** — the alternates array is a sibling field on
  `AnswerResponse`, never inside `ChartSpec`/`ChartAttribution` (spec §Mechanism).
- **Merge, never replace, dims:** `dims: { ...primary.cells[0]!.dims, ...(alt.dims ?? {}) }`,
  `measure: alt.measure ?? primary.cells[0]!.measure` — curated.ts's own literal `dims: alt.dims`
  is NOT safe to copy verbatim (spec §Mechanism).
- **Every alternate builds and degrades INDEPENDENTLY**, capped at 4, never blocking the primary
  answer or a sibling alternate (spec §Mechanism, mirrors `CuratedChartsOutcome.toggleSkipped`).
- **Nothing here is written to `audit_answers`** — R8 is unaffected (spec §Audit / R8).
- **Zero LLM, zero credit cost** — `target.kind: 'explicit'` bypasses intent parsing entirely.
- **Reading selection must NOT trigger `chart.tsx`'s spec-identity reset effect** (`specIdentity !==
  lastSpecIdentity`, `chart.tsx:1587`) — form, zoom window and presentation overrides must survive
  a reading switch untouched (spec §UI).
- **Every new interface string** has an `nl` and an `en` entry in `web/lib/i18n/messages.ts`
  (digit-free) — this project's standing convention (CLAUDE.md).
- **Both themes, tokens only** (`var(--border)`, `text-muted-foreground`, …) for any new UI.
- **Scope is chat + dock only** — do not touch `trial-chat.tsx`/`app/trial-actions.ts`, `/galerij`
  or the embed route in this plan (spec §Surfaces; each is a logged follow-up).

---

### Task 1: Shared alternate-reading builder — `src/chart/alternate-reading.ts`

**Files:**
- Create: `src/chart/alternate-reading.ts` (source lives under `src/`, matching every other chart
  module file)
- Test: `tests/chart/alternate-reading.test.ts` — **this repo keeps ALL backend tests in a separate
  top-level `tests/` tree that mirrors `src/`, never co-located** (confirmed:
  `tests/chart/curated.test.ts` tests `src/chart/curated.ts`, `tests/answer/respond-pipeline.test.ts`
  tests `src/answer/respond/`, etc. — this differs from `web/`'s convention, where tests ARE
  co-located; do not mix the two).
- Modify: `src/chart/curated.ts:43-71, 323-351` (replace `buildAlternateSpec`'s body with a call
  into the new shared function; keep `CuratedChartAlternateReading`/`CuratedChartToggle` types as
  they are — curated's own call site and types are untouched, only the internal implementation is
  now shared)

**Interfaces:**
- Produces:
  ```ts
  export interface AlternateReadingResult {
    label: string;
    spec: ChartSpec;
  }
  export type AlternateReadingOutcome = { ok: true; result: AlternateReadingResult } | { ok: false; reason: string };

  export async function buildAlternateReading(
    db: Db,
    primary: ValidatedResult,
    primaryIntent: StructuredIntent,
    alt: { measure?: string; dims?: Record<string, string>; label: string },
  ): Promise<AlternateReadingOutcome>;
  ```
- Consumes: `runQuery`, `buildChartSpec` (already exported from `src/query/index.ts` /
  `src/chart/build.ts`, exactly as `curated.ts` already imports them).

- [ ] **Step 1: Write the failing tests**

Fixtures below are REAL, verified entries — `unemployment_rate_seasonally_adjusted`'s primary dims
key is `SeizoenEnWerkdagcorrectie` (grain KW, quarterly — B5's own period code `2025KW04` proves
`2025KW04` is a real, ingested period), and `cpi_yearly_inflation` is grain JJ (yearly — B3/B4's own
codes `2024JJ00`/`2020JJ00`..`2024JJ00` prove the range). `StructuredIntent.period` is a discriminated
union (`{ kind: 'codes', codes: string[] }` or `{ kind: 'range', from, to }`), never a bare
`{ grain, from, to }` — copy the exact shape `tests/helpers/benchmark-intents.ts` already uses for
these same two canonical keys.

```ts
// tests/chart/alternate-reading.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../../src/db/types.ts';
import { buildAlternateReading } from '../../src/chart/alternate-reading.ts';
import { runQuery } from '../../src/query/index.ts';
import type { StructuredIntent, ValidatedResult } from '../../src/query/index.ts';
import { createIngestedDb } from '../helpers/ingested-db.ts';

describe('buildAlternateReading', () => {
  let db: Db;
  let close: () => Promise<void>;
  beforeAll(async () => ({ db, close } = await createIngestedDb()));
  afterAll(async () => close());

  it('merges the alternate dims over the PRIMARY cell\'s own resolved dims, not a bare replace', async () => {
    // unemployment_rate_seasonally_adjusted's own real alternate (defaults.ts): swaps the SAME
    // dims key (SeizoenEnWerkdagcorrectie) to the raw reading — a same-key case where merge and
    // replace happen to agree, kept here because it is the ONE case curated.ts's existing test
    // already pins, so this proves the refactor in Step 3 preserves it byte-for-byte.
    const primaryIntent: StructuredIntent = {
      schemaVersion: 1,
      target: { kind: 'canonical', key: 'unemployment_rate_seasonally_adjusted' },
      period: { kind: 'codes', codes: ['2025KW04'] },
      derivation: 'series',
    };
    const primaryOutcome = await runQuery(db, primaryIntent);
    if (!primaryOutcome.ok) throw new Error(`fixture setup refused: ${primaryOutcome.refusal.kind}`);
    const primary: ValidatedResult = primaryOutcome;

    const outcome = await buildAlternateReading(db, primary, primaryIntent, {
      dims: { SeizoenEnWerkdagcorrectie: 'A042501' },
      label: 'oorspronkelijke, ongecorrigeerde cijfers',
    });

    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.result.label).toBe('oorspronkelijke, ongecorrigeerde cijfers');
      expect(outcome.result.spec.attribution.tableId).toBe(primary.attribution.tableId);
      // A real different reading, not an accidental copy of the primary's own value.
      expect(outcome.result.spec).not.toEqual(primary);
    }
  });

  it('a measure-only alternate keeps the primary\'s own dims untouched (the real bug a literal replace would hit)', async () => {
    // cpi_yearly_inflation's real alternate (defaults.ts): { measure: 'M000215', label: '...' } —
    // no `dims` key at all. Its primary's own dims is `{}` here, so this test alone would pass
    // even with the OLD literal-replace behavior; it exists to pin the merged-dims CONTRACT
    // (verified correct against the richer retail-turnover/faillissementen entries by inspection
    // during design — not re-fixtured here to keep this task's DB setup to the two canonical keys
    // already used elsewhere in this test file).
    const primaryIntent: StructuredIntent = {
      schemaVersion: 1,
      target: { kind: 'canonical', key: 'cpi_yearly_inflation' },
      period: { kind: 'range', from: '2020JJ00', to: '2024JJ00' },
      derivation: 'series',
    };
    const primaryOutcome = await runQuery(db, primaryIntent);
    if (!primaryOutcome.ok) throw new Error(`fixture setup refused: ${primaryOutcome.refusal.kind}`);
    const primary: ValidatedResult = primaryOutcome;

    const outcome = await buildAlternateReading(db, primary, primaryIntent, {
      measure: 'M000215',
      label: 'CPI indexniveau (2025=100), geen mutatiepercentage',
    });

    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.result.spec.attribution.tableId).toBe(primary.attribution.tableId);
  });

  it('degrades to { ok: false } on a refusal, never throws, and names the refusal kind', async () => {
    const primaryIntent: StructuredIntent = {
      schemaVersion: 1,
      target: { kind: 'canonical', key: 'unemployment_rate_seasonally_adjusted' },
      period: { kind: 'codes', codes: ['2025KW04'] },
      derivation: 'series',
    };
    const primaryOutcome = await runQuery(db, primaryIntent);
    if (!primaryOutcome.ok) throw new Error(`fixture setup refused: ${primaryOutcome.refusal.kind}`);
    const primary: ValidatedResult = primaryOutcome;

    const outcome = await buildAlternateReading(db, primary, primaryIntent, {
      measure: 'M999999_does_not_exist',
      label: 'onbestaande maat',
    });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toContain('refused');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (repo root): `npx vitest run tests/chart/alternate-reading.test.ts`
Expected: FAIL — `src/chart/alternate-reading.ts` does not exist yet.

- [ ] **Step 3: Write the implementation**

```ts
// src/chart/alternate-reading.ts
// A general, registry-driven alternate reading of a canonical measure: swaps
// `measure` and/or `dims` over the PRIMARY's own resolved coordinates and
// rebuilds through the SAME deterministic runQuery -> buildChartSpec pipeline
// (R6) — never a fabricated coordinate, never an LLM call.
//
// Unlike src/chart/curated.ts's original narrow `buildAlternateSpec` (kept
// there only historically; both now call this), this function MERGES the
// alternate's dims over the primary's OWN resolved dims
// (`primary.cells[0].dims`) rather than replacing them wholesale. Checked
// against the real registry (src/registry/defaults.ts): most alternates swap
// `measure` with no `dims` key at all, and several primaries carry non-empty
// dims of their own (e.g. a branch code) that a bare `dims: alt.dims` would
// silently drop, breaking the toggle for no honesty reason. Do not
// "simplify" this back to a literal replace.
import type { Db } from '../db/types.ts';
import type { StructuredIntent, ValidatedResult } from '../query/index.ts';
import { runQuery } from '../query/index.ts';
import { buildChartSpec } from './build.ts';
import type { ChartSpec } from './types.ts';

export interface AlternateReadingResult {
  label: string;
  spec: ChartSpec;
}

export type AlternateReadingOutcome = { ok: true; result: AlternateReadingResult } | { ok: false; reason: string };

export interface AlternateReadingCoordinate {
  /** Present when the alternate differs by measure code. */
  measure?: string;
  /** Present when the alternate differs by dimension coordinate(s) — MERGED
   * over the primary's own resolved dims, never a full replace. */
  dims?: Record<string, string>;
  label: string;
}

export async function buildAlternateReading(
  db: Db,
  primary: ValidatedResult,
  primaryIntent: StructuredIntent,
  alt: AlternateReadingCoordinate,
): Promise<AlternateReadingOutcome> {
  const primaryCell = primary.cells[0];
  if (!primaryCell) return { ok: false, reason: 'primary result has no cells to derive a coordinate from' };

  const altIntent: StructuredIntent = {
    schemaVersion: 1,
    target: {
      kind: 'explicit',
      tableId: primary.attribution.tableId,
      measure: alt.measure ?? primaryCell.measure,
      dims: { ...primaryCell.dims, ...(alt.dims ?? {}) },
    },
    period: primaryIntent.period,
    derivation: 'series',
  };

  const altOutcome = await runQuery(db, altIntent);
  if (!altOutcome.ok) {
    return { ok: false, reason: `alternate reading refused (${altOutcome.refusal.kind}): ${altOutcome.refusal.message}` };
  }
  try {
    const spec = buildChartSpec(altOutcome);
    if (spec === null) return { ok: false, reason: `alternate reading shape '${altOutcome.shape}' yields no chart` };
    return { ok: true, result: { label: alt.label, spec } };
  } catch (err) {
    return { ok: false, reason: `alternate reading chart build failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}
```

Then update `src/chart/curated.ts`: delete the inline `buildAlternateSpec` function body
(lines 323-351) and replace its ONE call site (inside `buildOne`, where it is invoked to build
`CuratedChartDefinition.alternateReading`) with a call to `buildAlternateReading(db, primary,
primaryIntent, { dims: def.alternateReading.dims, label: def.alternateReading.label })`, mapping
its `{ ok: true, result }` / `{ ok: false, reason }` shape onto whatever local variable names
`buildOne` already uses for `{ spec }` / `{ reason }` (read `buildOne`'s existing branch around the
old call site — do not guess its exact local variable names from this plan; copy the real ones).
Keep every existing `curated.ts` export (`CuratedChartAlternateReading`, `CuratedChartToggle`,
`CuratedChartDefinition`, `CuratedChart`, `buildCuratedCharts`, etc.) untouched — only the internal
implementation of the one alternate-build call changes.

- [ ] **Step 4: Run the new tests, then the existing curated + registry suites**

Run (repo root): `npx vitest run tests/chart/alternate-reading.test.ts tests/chart/curated.test.ts
tests/registry/registry.test.ts`
Expected: PASS, including every pre-existing `curated.test.ts` assertion about the `werkloosheid`
chart's toggle — unchanged behavior, now routed through the shared function.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit` (repo root)
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/chart/alternate-reading.ts tests/chart/alternate-reading.test.ts src/chart/curated.ts
git commit -m "refactor(chart): generalize the alternate-reading builder (merge dims, not replace)" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Wire alternates into the chat answer pipeline — `AnswerResponse.chartAlternates`

**Files:**
- Modify: `src/answer/respond/types.ts` (add the field to `AnswerResponse`)
- Modify: `src/answer/respond/respond.ts` (build the array right after `buildChartSpec`)
- Modify: `src/chart/index.ts` if it is a real barrel re-exporting `curated.ts`'s public surface
  (check first — `respond.ts` already imports `buildChartSpec` from `'../../chart/index.ts'`; add
  `buildAlternateReading` there too if so, otherwise import it directly from
  `'../../chart/alternate-reading.ts'`)
- Test: `tests/answer/respond-pipeline.test.ts` — this is the real file that drives
  `respondToQuestion` end-to-end over replayed fixtures (confirmed: it already has describe blocks
  for B15-B20, the clarification round, compound/smalltalk and staleness, all through this exact
  function; add a new `describe('chartAlternates (#254)', ...)` block in the same style)

**Interfaces:**
- Consumes: `buildAlternateReading` (Task 1), `AttributionAlternate` (`src/query/types.ts:180-186`,
  already on `result.attribution.alternates`).
- Produces: `AnswerResponse.chartAlternates: { label: string; spec: ChartSpec }[]` — always an
  array (never undefined), `[]` when there is nothing to offer, mirroring the `suggestions:
  string[]` precedent (`respond/types.ts:237`) rather than the `sourceSelection?: | null` one, since
  every existing call site that constructs an `AnswerResponse` object literal must be updated to
  include it (TypeScript will point at every one via the Step-2 compile failure).

- [ ] **Step 1: Add the field to the type, then run typecheck to find every call site that must set it**

In `src/answer/respond/types.ts`, immediately after the `chart: ChartSpec | null;` field inside
`AnswerResponse` (around line 221):

```ts
  /** #254 alternate-reading toggle: every registered alternate of the answered
   * measure, independently built through the same deterministic pipeline as
   * `chart` (R6) — capped at 4. [] when the measure has no registered
   * alternates or none could be built. NEVER stored in audit_answers (see
   * the design doc's §Audit / R8) — rebuildable on demand from `result` +
   * the registry's CURRENT alternates, so it is intentionally not part of
   * what a stored row claims. */
  chartAlternates: { label: string; spec: ChartSpec }[];
```

Run: `npx tsc --noEmit` (repo root)
Expected: FAIL — every object literal that builds an `AnswerResponse` (in `respond.ts` and any
test fixture that constructs one directly rather than through `respond()`) is now missing the
required field. List every reported file before continuing.

- [ ] **Step 2: Write the failing behavioral tests**

Add a new `describe` block to `tests/answer/respond-pipeline.test.ts`, in the same style its
existing `describe('B15-B20 end-to-end ...')` block already uses (top-of-file `db` from this
file's own `beforeAll`, its own `respondOptions()` helper). Use `ANSWERABLE_TASKS` (imported from
`../helpers/benchmark-intents.ts`, alongside this file's existing `REFUSAL_TASK_QUESTIONS` import)
for real, already-fixtured question text:

- **B4** (`'Hoe ontwikkelde de inflatie zich per jaar van 2020 t/m 2024?'`) resolves to
  `cpi_yearly_inflation`, `derivation: 'series'` — a real chart, and its registry entry's own
  alternate is `{ measure: 'M000215', label: 'CPI indexniveau (2025=100), geen mutatiepercentage' }`
  — the right fixture for "has alternates."
- **B11** (`'Hoeveel elektriciteit uit zonnestroom werd er in 2024 opgewekt?'`) resolves to
  `solar_electricity_production`, `derivation: 'none'` (no chart at all — `shape: 'single'`) AND
  that key has no `alternates` entry either. This is the right fixture for "empty array," but note
  precisely WHY: it proves the no-chart, no-alternates degenerate case, not "a chart exists but its
  measure has no alternates" — no frozen B1-B14 task is both series-shaped and alternate-free (every
  `derivation: 'series'` task among B1-B14 is B4 or B8, and both their canonical keys carry
  alternates), so that narrower case is not independently provable from the frozen benchmark set.
  Do not invent a new fixture to cover it; it is already covered at the unit level by the `chart:
  null` short-circuit in Step 4's own implementation (no alternates loop runs when `chart` is null).

```ts
describe('chartAlternates (#254)', () => {
  it('B4 (inflation, a real chart) returns its registered alternate, built and labelled', async () => {
    const response = await respondToQuestion(db, ANSWERABLE_TASKS.B4!.question, respondOptions());
    expect(response.kind).toBe('answer');
    if (response.kind !== 'answer') throw new Error('unreachable');
    expect(response.chart).not.toBeNull();
    expect(response.chartAlternates.length).toBeGreaterThan(0);
    expect(response.chartAlternates[0]!.label).toBe('CPI indexniveau (2025=100), geen mutatiepercentage');
    expect(response.chartAlternates[0]!.spec.attribution.tableId).toBe(response.chart?.attribution.tableId);
  });

  it('B11 (a single-value answer, no chart) returns an empty array, not undefined', async () => {
    const response = await respondToQuestion(db, ANSWERABLE_TASKS.B11!.question, respondOptions());
    expect(response.kind).toBe('answer');
    if (response.kind !== 'answer') throw new Error('unreachable');
    expect(response.chart).toBeNull();
    expect(response.chartAlternates).toEqual([]);
  });
});
```

- [ ] **Step 3: Run to verify the new tests fail**

Run (repo root): `npx vitest run tests/answer/respond-pipeline.test.ts -t "chartAlternates"`
Expected: FAIL — `chartAlternates` does not exist on the returned object yet.

- [ ] **Step 4: Implement in `respond.ts`**

Immediately after the existing `const chart = buildChartSpec(result);` line (found earlier in this
session's research at `respond.ts` around line 496 — confirm the exact current line before editing):

```ts
// #254: every registered alternate of the answered measure, built
// independently and best-effort (never blocks the primary answer). Capped
// at 4 — the highest count any registry entry carries today, a defensive
// bound rather than a real limit hit in practice.
const chartAlternates: { label: string; spec: ChartSpec }[] = [];
if (chart !== null) {
  for (const alt of (result.attribution.alternates ?? []).slice(0, 4)) {
    const outcome = await buildAlternateReading(db, result, parse.intent, alt);
    if (outcome.ok) chartAlternates.push(outcome.result);
  }
}
```

Confirm `db` is already in scope at this point in `respond.ts` (it is — `runQuery`/`buildChartSpec`
above it already use the same connection) and that `parse.intent` is the right variable name for
the primary `StructuredIntent` at this point (check the function's own earlier variable names
rather than assuming `parse.intent` — `buildOne` in `curated.ts` calls its equivalent parameter
`primaryIntent`, sourced from wherever ITS caller resolved the intent; `respond.ts`'s own naming
may differ). Add `import { buildAlternateReading } from '../../chart/alternate-reading.ts';` (or
via `../../chart/index.ts` if that barrel re-exports it — check whether `chart/index.ts` is a real
barrel file first and add the new export there too if so, matching how `buildChartSpec` is already
exposed).

Then add `chartAlternates,` to the `AnswerResponse` object literal `respond.ts` returns (find every
`return { kind: 'answer', ... }` site — there should be exactly one on the success path; the
staleness-refusal branch earlier in the file returns a `RefusalResponse`, not an `AnswerResponse`,
so it does not need this field).

- [ ] **Step 5: Run the tests, then typecheck**

Run (repo root): `npx vitest run tests/answer/respond-pipeline.test.ts` then `npx tsc --noEmit`
Expected: PASS, clean.

- [ ] **Step 6: Run the FULL backend suite** (this touches a widely-shared type; confirm nothing
  else broke)

Run: `npm run test -- --run` (repo root)
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/answer/respond/types.ts src/answer/respond/respond.ts src/chart/index.ts tests/answer/respond-pipeline.test.ts
git commit -m "feat(answer): build every registered alternate reading alongside the primary chart" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Thread `chartAlternates` through `askQuestion` to the chat client

**Files:**
- Modify: `web/app/actions.ts` (wherever it shapes/returns the `AskOutcome` object from an
  `AnswerResponse`)
- Modify: `web/components/chat.tsx` (wherever it reads the answer's `chart` field into local
  message state, e.g. a `Message`/`ChatTurn` type)
- Test: `web/app/actions.test.ts` and/or `web/components/chat.test.tsx` — add to whichever already
  asserts `chart` is carried through today (grep both for `.chart` to find the exact assertions to
  extend)

**Interfaces:**
- Consumes: `AnswerResponse.chartAlternates` (Task 2).
- Produces: the per-message chat state now carries `chartAlternates: { label: string; spec:
  ChartSpec }[]` alongside `chart`, available to `visual-dock.tsx` for free (it renders the same
  message object).

- [ ] **Step 1: Find every place `AskOutcome`/the chat message type carries `chart` today**

Run: `grep -n '\.chart\b\|chart:' web/app/actions.ts web/components/chat.tsx | grep -v chartAlternates`
Read each hit before editing — this task's whole job is "wherever `chart` is threaded, thread
`chartAlternates` the same way," and the exact type names (`AskOutcome`, whatever the per-message
chat state interface is called) must come from the real file, not be guessed here.

- [ ] **Step 2: Write the failing test**

In whichever test file already has an assertion like `expect(result.chart).toEqual(...)` for a
successful `askQuestion` call, add a sibling assertion:

```ts
expect(result.chartAlternates).toEqual(response.chartAlternates);
```

using this file's own existing fixture/mock `AnswerResponse` — set that fixture's
`chartAlternates` to a small non-empty array first so the assertion is meaningful, not
vacuously `[] === []`.

- [ ] **Step 3: Run to verify it fails**

Run: `cd web && npx vitest run <the test file>`
Expected: FAIL — property does not exist / is undefined on the result.

- [ ] **Step 4: Implement** — add `chartAlternates` to every type and object literal Step 1 found,
  by direct analogy with how `chart` is already threaded at each of those exact points. Do not
  invent new plumbing; mirror the existing `chart` field's path field-for-field.

- [ ] **Step 5: Run the tests, then the whole web suite**

Run: `cd web && npx vitest run <the test file>` then `cd web && npx vitest run --run`
Expected: PASS.

- [ ] **Step 6: Typecheck**

Run: `cd web && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add web/app/actions.ts web/components/chat.tsx web/app/actions.test.ts web/components/chat.test.tsx
git commit -m "feat(chat): thread chartAlternates from the answer through to the chat client" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: `ChartViewState` gains `selectedReading` — reducer + pure spec-selection helper

**Files:**
- Modify: `web/lib/chart-view-state.ts`
- Test: `web/lib/chart-view-state.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface ChartViewState {
    // ...existing fields...
    /** #254: index into the ChartView's `alternates` prop, or null for the
     * primary reading. Deliberately NOT derived from the `spec` prop's
     * identity — switching it must never trigger the spec-identity reset
     * effect (chart.tsx ~line 1587), unlike a genuinely new chart. */
    selectedReading: number | null;
  }
  export type ChartViewAction =
    | /* ...existing... */
    | { type: 'setReading'; index: number | null };

  /** Pure: given the fetched primary spec, the alternates array and the
   * current selectedReading, which ChartSpec should the chart actually
   * RENDER data from. Out-of-range index (e.g. the alternates array shrank
   * on a re-render) falls back to the primary — never throws, never shows a
   * blank chart. */
  export function activeReadingSpec(
    primary: ChartSpec,
    alternates: { label: string; spec: ChartSpec }[],
    selectedReading: number | null,
  ): ChartSpec;
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// additions to web/lib/chart-view-state.test.ts
import { activeReadingSpec, chartViewReducer, initialViewState } from './chart-view-state.ts';

describe('selectedReading', () => {
  it('initialViewState starts on the primary reading (null)', () => {
    expect(initialViewState('line').selectedReading).toBeNull();
  });

  it('setReading updates only selectedReading, leaving form/zoom/presentation untouched', () => {
    const before = { ...initialViewState('line'), form: 'bar' as const, periodRange: ['2025-01', '2025-06'] as [string, string] };
    const after = chartViewReducer(before, { type: 'setReading', index: 0 });
    expect(after.selectedReading).toBe(0);
    expect(after.form).toBe('bar');
    expect(after.periodRange).toEqual(['2025-01', '2025-06']);
  });

  it('reset clears selectedReading back to null, like every other per-chart-instance field', () => {
    const withReading = chartViewReducer(initialViewState('line'), { type: 'setReading', index: 1 });
    const after = chartViewReducer(withReading, { type: 'reset', initialForm: 'line' });
    expect(after.selectedReading).toBeNull();
  });
});

describe('activeReadingSpec', () => {
  const primary = { kind: 'line', /* ...minimal valid ChartSpec fixture — copy an existing one from
    this test file's own top-of-file fixtures, do not hand-build a new one */ } as ChartSpec;
  const altA = { kind: 'line', /* a DIFFERENT minimal valid fixture, distinguishable from primary
    e.g. by a different series value or attribution.definitionLabel */ } as ChartSpec;

  it('null selectedReading returns the primary', () => {
    expect(activeReadingSpec(primary, [{ label: 'alt', spec: altA }], null)).toBe(primary);
  });
  it('a valid index returns that alternate\'s spec', () => {
    expect(activeReadingSpec(primary, [{ label: 'alt', spec: altA }], 0)).toBe(altA);
  });
  it('an out-of-range index falls back to the primary, never throws', () => {
    expect(activeReadingSpec(primary, [{ label: 'alt', spec: altA }], 5)).toBe(primary);
  });
  it('an empty alternates array with a non-null index falls back to the primary', () => {
    expect(activeReadingSpec(primary, [], 0)).toBe(primary);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd web && npx vitest run lib/chart-view-state.test.ts`
Expected: FAIL — `selectedReading`/`activeReadingSpec` do not exist yet.

- [ ] **Step 3: Implement**

In `ChartViewState`, add `selectedReading: number | null;`. In `initialViewState`'s return object,
add `selectedReading: null,`. In `chartViewReducer`'s switch, add:

```ts
case 'setReading':
  return { ...state, selectedReading: action.index };
```

In the `'reset'` case (find its existing body first — it likely spreads `initialViewState(...)`
already, in which case `selectedReading: null` comes along for free from Step 3's `initialViewState`
change; only add an explicit `selectedReading: null,` if the reset case builds its return object by
hand rather than delegating to `initialViewState`). Add the new action variant to the
`ChartViewAction` union. Add `activeReadingSpec` as a plain exported function at the bottom of the
file, by the union type given above — out-of-range or empty-array cases both return `primary`.

- [ ] **Step 4: Run the tests, then typecheck**

Run: `cd web && npx vitest run lib/chart-view-state.test.ts` then `cd web && npx tsc --noEmit`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add web/lib/chart-view-state.ts web/lib/chart-view-state.test.ts
git commit -m "feat(chart): selectedReading view state + activeReadingSpec helper" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: `ChartView` renders data from the selected reading, control row gets the dropdown

**Files:**
- Modify: `web/components/chart.tsx`
- Modify: `web/lib/i18n/messages.ts` (new `nl`/`en` keys)
- Test: `web/components/chart.test.tsx`

**Interfaces:**
- Consumes: `activeReadingSpec` (Task 4), `ChartViewState.selectedReading`.
- Produces: `ChartView` accepts a new prop `alternates?: { label: string; spec: ChartSpec }[]`
  (default `[]` when omitted, so every existing caller that does not pass it is unaffected).

**This is the task most likely to need real exploration of a 3580-line file — read
`chart-view-state.ts`'s full reducer (Task 4) and `chart.tsx`'s spec-identity-reset effect
(`~line 1587-1600`, quoted in this plan's Architecture section) before writing any code, so the
distinction below is concrete, not guessed.**

- [ ] **Step 1: Write the failing tests**

```ts
// additions to web/components/chart.test.tsx — copy this file's own existing render-harness
// pattern (whatever wraps ChartView with the props a normal test already needs) rather than
// inventing a new one.
it('shows no reading control when alternates is empty or omitted', () => {
  render(<ChartView spec={lineSpec} /* ...this file's usual required props... */ />);
  expect(screen.queryByRole('combobox', { name: /lezing|reading/i })).not.toBeInTheDocument();
});

it('shows a reading control when alternates is non-empty, and switching it renders the alternate\'s own data', () => {
  const altSpec = /* a second minimal valid ChartSpec fixture, distinguishable from lineSpec by
    a real plotted value this test can assert on afterward */;
  render(
    <ChartView
      spec={lineSpec}
      alternates={[{ label: 'Ongecorrigeerd', spec: altSpec }]}
      /* ...this file's usual required props... */
    />,
  );
  const control = screen.getByRole('combobox', { name: /lezing|reading/i });
  fireEvent.change(control, { target: { value: '0' } });
  // Assert something only altSpec's data would produce — e.g. a value label or
  // tooltip text unique to altSpec, using whatever query this file's other
  // "switching chart form re-renders the data" tests already use as their model.
});

it('switching reading does NOT reset the current form/zoom — the spec-identity effect must not fire', () => {
  const altSpec = /* same fixture as above */;
  render(
    <ChartView
      spec={lineSpec}
      alternates={[{ label: 'Ongecorrigeerd', spec: altSpec }]}
      /* ...this file's usual required props... */
    />,
  );
  // Switch to Staaf (bar) form first, using this file's existing pattern for
  // that (grep this file for an existing "switches to bar form" test and
  // copy its exact interaction).
  // Then switch reading via the new control.
  // Assert the form tab still shows "Staaf" as selected (aria-selected) —
  // proof the spec-identity reset effect did not fire.
});

it('the reading control label uses the registry alternate\'s own label string, never invented copy', () => {
  render(
    <ChartView
      spec={lineSpec}
      alternates={[{ label: 'oorspronkelijke, ongecorrigeerde cijfers', spec: altSpec }]}
      /* ... */
    />,
  );
  expect(screen.getByText('oorspronkelijke, ongecorrigeerde cijfers')).toBeInTheDocument();
});

it('the alternate view passes the SAME whole-card digit-honesty scan the primary chart already does', () => {
  // R1/R6: switching reading must never put an unbound digit on screen. Reuse
  // this file's own `scanForUnboundDigits` helper (chart.test.tsx ~line 2149)
  // exactly as its existing per-form/per-language tests already do — render
  // with a non-empty `alternates` prop, switch the reading control, then run
  // the same scan over the rendered card. Copy the surrounding harvestSpecStrings
  // setup from a neighboring existing scan test rather than reinventing it.
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd web && npx vitest run components/chart.test.tsx -t "reading"`
Expected: FAIL — no such prop/control exists yet.

- [ ] **Step 3: Implement**

1. Add `alternates?: { label: string; spec: ChartSpec }[]` to `ChartView`'s props interface,
   defaulted to `[]` in the destructure (`alternates = []`).
2. Immediately after the component resolves its own `spec` prop and `state` (reducer) — but
   BEFORE any derivation that reads series/cell VALUES — compute:
   ```ts
   const activeSpec = activeReadingSpec(spec, alternates, state.selectedReading);
   ```
   Then replace every subsequent usage of the bare `spec` variable that reads plotted DATA
   (series arrays, cells, value labels, the headline figure selection, table-form rows, tooltip
   content, the honesty-scan-relevant text) with `activeSpec` instead. **Do NOT touch:** the
   `specIdentity`/`lastSpecIdentity` effect (`~line 1587`) — it must keep comparing the ORIGINAL
   `spec` prop's identity, never `activeSpec`'s; `allPeriodCodes`/zoom-window bounds/the Vanaf-Tot
   `<select>` options — these stay derived from the PRIMARY `spec`, because every alternate is
   built over the identical period window (Task 1/2's own guarantee), so switching reading must
   never change what periods are selectable; anything reading `spec.attribution` for the
   CARD-LEVEL chrome that should stay describing "what chart is this" rather than "which reading is
   showing" — use judgement per call site and prefer `activeSpec.attribution` wherever the
   attribution text is meant to describe the DATA currently on screen (source table id, sync date,
   period covered — these are per-reading facts that should update) versus the primary spec's own
   identity (there isn't a clear case for the latter in practice; if genuinely unsure for a specific
   line, prefer `activeSpec` — it carries a full, valid `ChartAttribution` itself, R1/R6 safe either
   way).
3. Add the control to the existing control row (`chart.tsx:2974-3120`ish, the same row the
   Vanaf/Tot `<select>` elements live in), gated on `alternates.length > 0 && !embedMode &&
   !inStage` (same gating the rest of the row already uses), styled identically to the Vanaf/Tot
   `<select>` (copy its exact className):
   ```tsx
   {alternates.length > 0 ? (
     <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
       <label htmlFor={`${domId}-reading`}>{t(chartLang, 'chart.reading.label')}</label>
       <select
         id={`${domId}-reading`}
         aria-label={t(chartLang, 'chart.reading.label')}
         value={state.selectedReading ?? 'primary'}
         onChange={(e) =>
           dispatch({ type: 'setReading', index: e.target.value === 'primary' ? null : Number(e.target.value) })
         }
         className="rounded-md border border-border bg-background px-1.5 py-0.5 text-foreground"
       >
         <option value="primary">{spec.attribution.definitionLabel ?? t(chartLang, 'chart.reading.primary')}</option>
         {alternates.map((alt, i) => (
           <option key={i} value={i}>{alt.label}</option>
         ))}
       </select>
     </div>
   ) : null}
   ```
   Place it in the SAME flex row as the Vanaf/Tot block (inside the existing `ml-auto` wrapper, or
   as its own adjacent item — match whatever keeps the row's existing wrap behavior sane at narrow
   widths; check this file's own responsive test, if one exists, after implementing).
4. Add two new i18n keys to `web/lib/i18n/messages.ts` (both `nl` and `en` tables — the file's
   `Messages` type is derived from the `nl` table, so a missing `en` entry is a compile error):
   `'chart.reading.label'` → nl `'Lezing'`, en `'Reading'`; `'chart.reading.primary'` → nl
   `'Standaard'`, en `'Default'` (fallback text only used when `spec.attribution.definitionLabel`
   is null — an explicit-target chart, which per the design never has alternates anyway, so this
   fallback should be unreachable in practice; still required for type-safety, not dead code to
   delete).

- [ ] **Step 4: Run the tests**

Run: `cd web && npx vitest run components/chart.test.tsx`
Expected: PASS — including every PRE-EXISTING assertion in this file (the honesty digit-scan tests
in particular; if any fails, the `activeSpec` substitution touched a place it should not have —
revert that one call site back to `spec` and re-check against Step 3's guidance).

- [ ] **Step 5: Run the FULL web suite, then typecheck**

Run: `cd web && npx vitest run --run` then `cd web && npx tsc --noEmit`
Expected: PASS, clean. Pay special attention to `chart-config-panel.test.tsx`,
`chart-story.test.tsx`, `chart-small-multiples.test.tsx`, `gallery.test.tsx` and the embed page
test — anything that imports `ChartView` and could be sensitive to a new optional prop with a
default.

- [ ] **Step 6: Commit**

```bash
git add web/components/chart.tsx web/lib/i18n/messages.ts web/components/chart.test.tsx
git commit -m "feat(chart): reading-toggle control, renders the selected alternate's data" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: Wire `chartAlternates` from chat/dock message state into `ChartView`'s new prop

**Files:**
- Modify: `web/components/chat.tsx` (every place it renders `<ChartView spec={...} .../>` from a
  message)
- Modify: `web/components/visual-dock.tsx` (if it renders `<ChartView>` directly, rather than only
  a `DockVisual` summary — check `dock-visuals.ts`'s `DockVisual` type first; if the dock renders
  its OWN chart independent of `ChartView`, this task instead confirms `DockVisual` already carries
  `chartAlternates` through from Task 3's message-state change and adjusts only if it does not)
- Test: `web/components/chat.test.tsx`, `web/components/visual-dock.test.tsx`

- [ ] **Step 1: Write the failing test**

```ts
// addition to chat.test.tsx
it('passes the message\'s chartAlternates through to ChartView as the alternates prop', () => {
  // Render a chat turn whose fixture AskOutcome/message has a non-empty
  // chartAlternates (reuse Task 3's fixture shape), then assert the
  // reading-select control this task's own Task-5 work rendered is present
  // — same query the Task 5 tests use (`getByRole('combobox', { name: /lezing|reading/i })`).
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd web && npx vitest run components/chat.test.tsx -t "chartAlternates"`
Expected: FAIL.

- [ ] **Step 3: Implement** — find every `<ChartView spec={message.chart} .../>` (or equivalent)
  call in `chat.tsx` and add `alternates={message.chartAlternates}` (matching whatever field name
  Task 3 actually landed on the message-state type). Check `visual-dock.tsx`/`dock-visuals.ts` per
  the Files note above and thread it through there too if the dock renders `ChartView` directly.

- [ ] **Step 4: Run the tests, full web suite, typecheck**

Run: `cd web && npx vitest run components/chat.test.tsx components/visual-dock.test.tsx` then
`cd web && npx vitest run --run` then `cd web && npx tsc --noEmit`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add web/components/chat.tsx web/components/visual-dock.tsx web/components/chat.test.tsx web/components/visual-dock.test.tsx
git commit -m "feat(chat): wire chartAlternates into ChartView on chat and dock" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: Whole-branch review + docs

**Not a subagent-implementer task** — the main session does this itself, after Tasks 1-6 all show
green individually.

- [ ] **Step 1: Full diff read.** `git diff main...HEAD` (or the equivalent against whatever base
  this branch started from) — read every hunk, not just the summaries the per-task commits carried.
  Specifically re-check, against the design spec: the dims-merge in Task 1 is used everywhere (no
  stray literal-replace survived from curated.ts's old code); Task 5's `activeSpec` substitution
  did not touch the `specIdentity` effect or the zoom-bound derivations; every new i18n key has
  both `nl` and `en`; no digit was added to any card outside a spec-bound value. **Manually verify
  the export claim the spec makes** ("whichever spec is currently shown is what gets exported," no
  special-casing needed) — this was reasoned from `chart-download.tsx` reading the live rendered
  `<svg>`, never re-verified against the real file in this plan: open the dev harness, switch a
  chart with a real alternate to its alternate reading, download the PNG, and confirm the alternate
  reading's own values (not the primary's) are what the file shows. If this claim turns out wrong,
  it is a real gap to fix here, not a footnote to defer.

- [ ] **Step 2: Run the full verification block**

```bash
cd web && npx tsc --noEmit && npx vitest run --run
cd .. && npx tsc --noEmit && npm run test -- --run
npm run benchmark:run && npm run benchmark:score
cd web && npm run build
```

Expected: typecheck ×2 clean; web + backend suites green; benchmark 14/14 + 6/6 + 0 fabricated;
real production build succeeds.

- [ ] **Step 3: `/code-review` at LOW effort** over the full diff — fix or consciously dispatch
  every confirmed finding before proceeding (this project's standing pre-push rule).

- [ ] **Step 4: Docs, same change** (CLAUDE.md definition of done):
  - `docs/open-questions.md` — update #254's row: the "context controls" genuine gap is now
    ✅ BUILT + LIVE for the alternate-reading half (link this feature); the level-vs-%-change half
    stays open, unchanged.
  - `docs/decisions/` — a new ADR only if this session judges the mechanism load-bearing enough to
    warrant one (CLAUDE.md: "every load-bearing technical choice gets an ADR... small choices
    don't" — the dims-merge correction and the "sibling field, not inside ChartSpec" choice are
    arguably load-bearing; use judgement, lean toward writing one given this touches the answer
    envelope's shape).
  - `docs/08-build-plan.md` — mark this work package done, note what's next.
  - `docs/STATUS.md` — the lean top block, measured results only (test counts, benchmark line,
    build status — pulled from Step 2's REAL output, never from memory).
  - `docs/superpowers/plans/2026-09-16-chart-alternate-reading-toggle.md` (this file) — check off
    every remaining box, note any as-built deviation from what a task predicted.

- [ ] **Step 5: Commit and push** — owner-present session, standing authorization (#118(a)): commit
  the docs, then `git push origin main`. Confirm CI green (`gh run watch <run-id> --exit-status`)
  before declaring done.

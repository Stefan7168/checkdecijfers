# Chart Trend Headline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A deterministic Dutch headline sentence ("Bevolking steeg gestaag sinds 2015.") on any chart backed by a `direction` derivation — #197 idea 4.

**Architecture:** A new template-only formatter (`renderTrendHeadline`, same file/style as `template.ts`'s existing `renderDifference`/`renderMax`) computes the sentence from the registered `direction` derivation — no LLM, no new arithmetic (R1/R3). `buildChartSpec` calls it once and stores the result as one new optional field on `ChartAttribution`. `chart.tsx` renders it as plain text between the chart's drawn area and the legend/small-multiples controls. No info-icon/`AnswerProof` reuse in this v1 (owner decision, session 80 — the chart already shows its own definition line and source badge separately; adding a second explainer for one sentence was judged likely redundant, and wiring it would need a `proof` prop threaded through `dock-visuals.ts` → `visual-dock.tsx`/`chart-toggle.tsx` → `chart.tsx`, none of which currently carry one).

**Tech Stack:** TypeScript, Zod (chart-spec schema), React (Recharts wrapper), Vitest, `@testing-library/react`.

## Global Constraints

- ADR 014's optional-v1-field rule (design doc §3): (a) `buildChartSpec` never sets `trendHeadline` for a result with no `direction` derivation — old code paths byte-identical; (b) every existing stored spec has no `trendHeadline` key and still validates against `src/chart/schema.ts` unchanged; (c) a renderer that ignores the field still draws an honest chart. All three checked below.
- R1/R3 (docs/05-data-rules.md): `renderTrendHeadline` prints only the derivation's own stored `direction`/`monotonic`/`netChange` and a cell's own `periodLabel` — no arithmetic performed in this formatter.
- Design source: [docs/session-briefs/2026-09-05-chart-ideas-4-6-8-design.md](../../session-briefs/2026-09-05-chart-ideas-4-6-8-design.md) §3. One refinement decided during planning: no info-icon/`AnswerProof` panel in v1 (see Architecture above) — everything else in §3 is unchanged.

---

### Task 1: `renderTrendHeadline` formatter

**Files:**
- Modify: `src/answer/compose/template.ts`
- Test: `tests/answer/compose-template.test.ts`

**Interfaces:**
- Consumes: `ValidatedResult`, `DerivationRecord` (`src/query/index.ts`, already imported in this file); `subjectSentenceStart(result)` (private helper already in this file, `template.ts:75`).
- Produces: `export function renderTrendHeadline(result: ValidatedResult, derivation: Extract<DerivationRecord, { kind: 'direction' }>): string` — consumed by Task 2.

- [ ] **Step 1: Write the failing tests**

Add to `tests/answer/compose-template.test.ts`, in its own new `describe` block near the end of the file:

```typescript
import { renderTrendHeadline } from '../../src/answer/compose/template.ts';

describe('renderTrendHeadline (#197 idea 4)', () => {
  function series(direction: 'up' | 'down' | 'flat', monotonic: boolean): {
    result: ValidatedResult;
    derivation: Extract<DerivationRecord, { kind: 'direction' }>;
  } {
    const first = makeCell({ periodCode: '2015JJ00', periodLabel: '2015', value: 100, unit: 'aantal' });
    const last = makeCell({ periodCode: '2024JJ00', periodLabel: '2024', value: 120, unit: 'aantal' });
    const result = makeResult({
      shape: 'series',
      definitionLabel: 'bevolking',
      cells: [first, last],
    });
    const derivation: Extract<DerivationRecord, { kind: 'direction' }> = {
      kind: 'direction',
      explicit: false,
      sourceResultIds: [first.resultId, last.resultId],
      unit: 'aantal',
      marking: DERIVED_DATA_MARKING,
      direction,
      monotonic,
      netChange: 20,
      firstResultId: first.resultId,
      lastResultId: last.resultId,
    };
    return { result, derivation };
  }

  it('renders an upward, monotonic trend with "gestaag" and the first period', () => {
    const { result, derivation } = series('up', true);
    expect(renderTrendHeadline(result, derivation)).toBe('Bevolking steeg gestaag sinds 2015.');
  });

  it('renders a downward, monotonic trend', () => {
    const { result, derivation } = series('down', true);
    expect(renderTrendHeadline(result, derivation)).toBe('Bevolking daalde gestaag sinds 2015.');
  });

  it('renders a flat trend without "gestaag" (steadiness does not apply to no change)', () => {
    const { result, derivation } = series('flat', true);
    expect(renderTrendHeadline(result, derivation)).toBe('Bevolking bleef stabiel sinds 2015.');
  });

  it('omits "gestaag" for a non-monotonic up/down trend (the net direction, not a straight line)', () => {
    const { result, derivation } = series('up', false);
    expect(renderTrendHeadline(result, derivation)).toBe('Bevolking steeg sinds 2015.');
  });

  it('returns undefined when the first source cell cannot be found (defensive, should not happen)', () => {
    const { result, derivation } = series('up', true);
    const broken = { ...derivation, firstResultId: 'does-not-exist' };
    expect(renderTrendHeadline(result, broken)).toBeUndefined();
  });
});
```

`tests/answer/compose-template.test.ts` already imports `makeCell`/`makeResult` from `'../helpers/synthetic-results.ts'` (lines 17-31) and `DERIVED_DATA_MARKING`/`type ValidatedResult` from `'../../src/query/index.ts'` (lines 6-7) — add `type DerivationRecord` to that same `'../../src/query/index.ts'` import line (it's not there yet). `displayValueUnit` is already imported directly from `'../../src/answer/compose/template.ts'` (line 12) rather than through the barrel — add `renderTrendHeadline` to that same line, matching the file's own existing precedent (not the standalone `import` shown above, which was written separately only for clarity):

```typescript
import { displayValueUnit, renderTrendHeadline } from '../../src/answer/compose/template.ts';
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/answer/compose-template.test.ts -t "renderTrendHeadline"`
Expected: FAIL — `renderTrendHeadline` is not exported.

- [ ] **Step 3: Implement the formatter**

In `src/answer/compose/template.ts`, add this constant near the top of the file, after the existing `subject`/`subjectSentenceStart` functions (around line 78):

```typescript
/** Verb-form direction words for a chart headline sentence ("Bevolking
 * steeg... ") — distinct from prompt.ts's TREND_WORD_BY_DIRECTION, which is
 * the NOUN form ("stijging") used as an LLM phrasing hint, not a formatter
 * output. */
const TREND_VERB_BY_DIRECTION: Record<'up' | 'down' | 'flat', string> = {
  up: 'steeg',
  down: 'daalde',
  flat: 'bleef stabiel',
};
```

Then add the function itself, after `renderMax` (after line 149, before the `renderTemplateBody` export):

```typescript
/** #197 idea 4: a short, deterministic Dutch headline for a chart backed by
 * a `direction` derivation ("Bevolking steeg gestaag sinds 2015."). Template
 * only, no LLM — mirrors renderDifference/renderMax's own discipline.
 * `undefined` (not thrown) when the derivation's own firstResultId cannot be
 * resolved against the result's cells — a defensive guard for a shape that
 * should not occur (a registered derivation's source ids are always drawn
 * from the same result's own cells), matched by buildChartSpec choosing not
 * to set ChartAttribution.trendHeadline in that case (Task 2). */
export function renderTrendHeadline(
  result: ValidatedResult,
  derivation: Extract<DerivationRecord, { kind: 'direction' }>,
): string | undefined {
  const byId = new Map(result.cells.map((c) => [c.resultId, c]));
  const first = byId.get(derivation.firstResultId);
  if (!first) return undefined;
  const verb = TREND_VERB_BY_DIRECTION[derivation.direction];
  const steadily = derivation.monotonic && derivation.direction !== 'flat' ? ' gestaag' : '';
  return `${subjectSentenceStart(result)} ${verb}${steadily} sinds ${first.periodLabel}.`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/answer/compose-template.test.ts`
Expected: PASS — the full file (confirm nothing else in `template.ts` broke).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/answer/compose/template.ts tests/answer/compose-template.test.ts
git commit -m "feat(#197): add renderTrendHeadline, a deterministic chart-headline formatter"
```

---

### Task 2: `ChartAttribution.trendHeadline` + schema + `buildChartSpec` wiring

**Files:**
- Modify: `src/chart/types.ts`, `src/chart/schema.ts`, `src/chart/build.ts`, `tests/chart/helpers.ts`
- Test: `tests/chart/build-spec.test.ts`

**Interfaces:**
- Consumes: `renderTrendHeadline` (Task 1, `src/answer/compose/template.ts` — `src/chart/build.ts` already imports sibling functions from `src/answer/compose/format.ts`, so this crosses no new module boundary, ADR 001).
- Produces: `ChartAttribution.trendHeadline?: string` and the matching `chartAttributionSchema` field — consumed by Task 3.

- [ ] **Step 1: Extend the chart test helper to accept derivations**

`tests/chart/helpers.ts`'s `makeResult` hardcodes `derivations: []` with no way to override, because (per its own header comment) `buildChartSpec` "only ever reads cells + attribution + shape" — no longer true after this task. Modify `tests/chart/helpers.ts`:

Change the header comment (line 1-3) to:

```typescript
// Handcrafted ValidatedResult factories for chart unit tests. The builder
// reads cells + attribution + shape (and, for a direction derivation, the
// headline formatter's own inputs), but the objects are complete and
// type-checked so the tests exercise the real contract, not a lookalike.
```

Change the `makeResult` signature and body (lines 32-63) to accept an optional 4th parameter, defaulting to today's exact behavior:

```typescript
export function makeResult(
  shape: ValidatedResult['shape'],
  cells: ResultCell[],
  attribution: Partial<Attribution> = {},
  derivations: ValidatedResult['derivations'] = [],
): ValidatedResult {
  const from = cells[0]!.periodCode;
  const to = cells[cells.length - 1]!.periodCode;
  return {
    ok: true,
    schemaVersion: 1,
    shape,
    cells,
    derivations,
    attribution: {
      tableId: 'TESTNED',
      tableTitle: 'Testtabel voor grafieken',
      tableVersion: 1,
      syncedAt: '2026-07-03T00:00:00.000Z',
      coveredPeriods: { from, to },
      license: 'CC BY 4.0',
      definitionLabel: null,
      definitionText: null,
      periodSemantics: null,
      ...attribution,
    },
    intent: {
      schemaVersion: 1,
      target: { kind: 'explicit', tableId: 'TESTNED', measure: 'M1' },
      period: from === to ? { kind: 'codes', codes: [from] } : { kind: 'range', from, to },
      derivation: shape === 'series' ? 'series' : 'none',
    },
  };
}
```

Run: `npx vitest run tests/chart/`
Expected: PASS (unchanged) — confirms the new optional parameter didn't affect any existing caller (all pass 3 args today, default `[]` matches the old hardcoded value exactly).

- [ ] **Step 2: Write the failing tests**

Add to `tests/chart/build-spec.test.ts`, in its own new `describe` block:

```typescript
import { DERIVED_DATA_MARKING } from '../../src/query/index.ts';
import type { DerivationRecord } from '../../src/query/index.ts';

describe('trendHeadline (#197 idea 4)', () => {
  function seriesWithDirection() {
    const first = makeCell({ periodCode: '2015JJ00', value: 100 });
    const last = makeCell({ periodCode: '2024JJ00', value: 120 });
    const direction: DerivationRecord = {
      kind: 'direction',
      explicit: false,
      sourceResultIds: [first.resultId, last.resultId],
      unit: '%',
      marking: DERIVED_DATA_MARKING,
      direction: 'up',
      monotonic: true,
      netChange: 20,
      firstResultId: first.resultId,
      lastResultId: last.resultId,
    };
    return makeResult('series', [first, last], { definitionLabel: 'bevolking' }, [direction]);
  }

  it('sets attribution.trendHeadline when a direction derivation is registered', () => {
    const spec = buildChartSpec(seriesWithDirection())!;
    expect(spec.attribution.trendHeadline).toBe('Bevolking steeg gestaag sinds 2015.');
  });

  it('omits trendHeadline (no key at all, not undefined-valued) when there is no direction derivation', () => {
    const spec = buildChartSpec(makeResult('series', [makeCell({ periodCode: '2015JJ00' }), makeCell({ periodCode: '2024JJ00' })]))!;
    expect('trendHeadline' in spec.attribution).toBe(false);
  });

  it('a spec with trendHeadline still validates against chartSpecSchema', () => {
    const spec = buildChartSpec(seriesWithDirection())!;
    expect(() => chartSpecSchema.parse(spec)).not.toThrow();
  });

  it('a spec without trendHeadline (every pre-existing stored spec) still validates unchanged', () => {
    const spec = buildChartSpec(makeResult('series', [makeCell({ periodCode: '2015JJ00' }), makeCell({ periodCode: '2024JJ00' })]))!;
    expect(() => chartSpecSchema.parse(spec)).not.toThrow();
  });
});
```

Check `tests/chart/build-spec.test.ts`'s existing top-of-file imports before adding these — `buildChartSpec`, `chartSpecSchema`, `makeCell`, `makeResult` are already imported there (`build-spec.test.ts:5-7`); add `DERIVED_DATA_MARKING` and the `DerivationRecord` type to the same import statements rather than duplicating them.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/chart/build-spec.test.ts -t "trendHeadline"`
Expected: FAIL — `spec.attribution.trendHeadline` is `undefined` where a value is expected (first test).

- [ ] **Step 4: Add the optional field to `ChartAttribution`**

In `src/chart/types.ts`, in the `ChartAttribution` interface, add after `license: 'CC BY 4.0';`:

```typescript
  /** #197 idea 4: a short, deterministic Dutch trend sentence ("Bevolking
   * steeg gestaag sinds 2015."), set only when the result carries a
   * `direction` derivation (buildChartSpec, src/chart/build.ts) — absent
   * (not null) on every other spec, including every spec stored before this
   * field existed (R8: those rows live forever, ADR 014's optional-v1-field
   * rule). Built by renderTrendHeadline (src/answer/compose/template.ts),
   * the same deterministic-template discipline the rest of this file's
   * display strings already follow. */
  trendHeadline?: string;
```

- [ ] **Step 5: Add the matching optional field to the Zod schema**

In `src/chart/schema.ts`, in `chartAttributionSchema` (currently ending `license: z.literal('CC BY 4.0'),`), add:

```typescript
  trendHeadline: z.string().min(1).optional(),
```

(Mirrors the existing `annotations: z.array(chartAnnotationSchema).optional()` pattern on the top-level `chartSpecSchema` a few lines below — same `strictObject` file, same reason: an unrecognized field would otherwise fail validation.)

- [ ] **Step 6: Wire it into `buildChartSpec`**

In `src/chart/build.ts`, add the import (alongside the existing `import { buildAttributionLine, formatValueNl } from '../answer/compose/format.ts';` line):

```typescript
import { renderTrendHeadline } from '../answer/compose/template.ts';
```

Before the function's `return { ... }` statement (after the existing `const anyProvisional = ...` line), add:

```typescript
  const direction = result.derivations.find(
    (d): d is Extract<DerivationRecord, { kind: 'direction' }> => d.kind === 'direction',
  );
  const trendHeadline = direction ? renderTrendHeadline(result, direction) : undefined;
```

This needs `DerivationRecord` imported as a type — `src/chart/build.ts` does not import it yet (confirmed: its only import from `'../query/index.ts'` today is `import type { ResultCell, ValidatedResult } from '../query/index.ts';`, line 19). Change that line to:

```typescript
import type { DerivationRecord, ResultCell, ValidatedResult } from '../query/index.ts';
```

Then change the `attribution: { ... }` object in the return statement from:

```typescript
    attribution: {
      tableId: result.attribution.tableId,
      tableTitle: result.attribution.tableTitle,
      tableVersion: result.attribution.tableVersion,
      syncedAt: result.attribution.syncedAt,
      coveredPeriods: { ...result.attribution.coveredPeriods },
      license: result.attribution.license,
    },
```

to:

```typescript
    attribution: {
      tableId: result.attribution.tableId,
      tableTitle: result.attribution.tableTitle,
      tableVersion: result.attribution.tableVersion,
      syncedAt: result.attribution.syncedAt,
      coveredPeriods: { ...result.attribution.coveredPeriods },
      license: result.attribution.license,
      ...(trendHeadline !== undefined ? { trendHeadline } : {}),
    },
```

(The `...(x !== undefined ? {...} : {})` spread is this codebase's own established idiom for an optional envelope field — `web/lib/answer-proof.ts` already does the identical thing for `attribution.source`.)

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run tests/chart/`
Expected: PASS — the full directory (confirm the `makeResult` signature change from Step 1 didn't break any other chart test).

- [ ] **Step 8: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/chart/types.ts src/chart/schema.ts src/chart/build.ts tests/chart/helpers.ts tests/chart/build-spec.test.ts
git commit -m "feat(#197): buildChartSpec computes an optional trendHeadline"
```

---

### Task 3: Render the headline in `ChartView`

**Files:**
- Modify: `web/components/chart.tsx:866-867` (insertion point — right after the chart's `ResponsiveContainer`/drawn-area closes, before the series legend from idea 6)
- Test: `web/components/chart.test.tsx`

**Interfaces:**
- Consumes: `spec.attribution.trendHeadline` (Task 2).
- Produces: nothing new for later tasks — this is the last task in this plan.

- [ ] **Step 1: Write the failing tests**

Add to `web/components/chart.test.tsx`, in its own new `describe` block:

```typescript
describe('trend headline (#197 idea 4)', () => {
  it('renders the headline when attribution.trendHeadline is set', () => {
    render(
      <ChartView
        spec={spec({ attribution: { ...spec().attribution, trendHeadline: 'Bevolking steeg gestaag sinds 2015.' } })}
      />,
    );
    expect(screen.getByText('Bevolking steeg gestaag sinds 2015.')).toBeInTheDocument();
  });

  it('renders nothing extra when trendHeadline is absent (old specs unaffected)', () => {
    const { container } = render(<ChartView spec={spec()} />);
    expect(container.querySelector('[data-testid="trend-headline"]')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run web/components/chart.test.tsx -t "trend headline"`
Expected: FAIL — the text is not in the document.

- [ ] **Step 3: Render it**

In `web/components/chart.tsx`, find this exact existing block (the chart body's closing tags, immediately before the idea-6 legend):

```tsx
        </ResponsiveContainer>
        )}
      </div>
      )}
      {view === 'chart' && seriesMeta.length > 1 ? (
```

Insert a new line between `</div>` (chart body close) and the idea-6 legend block:

```tsx
        </ResponsiveContainer>
        )}
      </div>
      )}
      {view === 'chart' && spec.attribution.trendHeadline !== undefined ? (
        <p data-testid="trend-headline" className="mt-1 text-sm text-ink">
          {spec.attribution.trendHeadline}
        </p>
      ) : null}
      {view === 'chart' && seriesMeta.length > 1 ? (
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run web/components/chart.test.tsx`
Expected: PASS — the full file (this component has ~27 existing tests per the idea-6/8 design doc; confirm none broke).

- [ ] **Step 5: Typecheck**

Run: `npm run web:typecheck`
Expected: PASS.

- [ ] **Step 6: Full verification block**

```bash
npm run typecheck && npm run web:typecheck && npm test && npm run benchmark:run && npm run benchmark:score && npm run web:test && npm run web:build
```

Expected: every step passes; benchmark GATE VERDICT: PASS.

- [ ] **Step 7: `/code-review` low effort on the diff**

Per CLAUDE.md's session-49 addition: run `/code-review` at LOW effort over the combined diff from all three tasks before pushing. Fix any confirmed finding.

- [ ] **Step 8: Commit**

```bash
git add web/components/chart.tsx web/components/chart.test.tsx
git commit -m "feat(#197): render the trend headline on the chart"
```

- [ ] **Step 9: Update docs**

- `docs/open-questions.md` row #197: record idea 4 as BUILT + verified, with final commit SHAs and measured test counts (rows #46/#197 already record ideas 6/8 this same way from earlier today — match that format).
- `docs/STATUS.md`: add to the current session's block.
- `docs/decisions/014-chart-spec-v1-and-renderer.md`: add an as-built note for the new optional `ChartAttribution.trendHeadline` field, matching how the `annotations` field's own addition was presumably recorded there (check the ADR for that precedent before writing the new entry).
- Push directly to `main` (owner-present session, #118 standing authorization) once CI gate is green.

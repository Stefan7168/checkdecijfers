# Chart co-pilot phase 2 — the own-data co-pilot

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On a chart drawn from the reader's own uploaded data, the reader can change the data (columns, filters, series, sort, limit, **aggregate, the fixed derived set**), the form, the style, notes and title/caption — by clicking controls OR by typing under the chart — with every edit on the one undo history phase 1 built, saved per account, and the chat only ever emitting what the controls already offer.

**Architecture:** (1) The instruction the model selects for own data widens to schema v2 (`aggregate`, `derived`, `sort.by: 'value'`); the executor computes, the model only selects (ADR 037 addendum, ADR 056 decision 3). (2) A *shared card shell* — not a JSX extraction from the 3,300-line `ChartView`, but the tier-independent pieces lifted into shared hooks/components (`useChartEdits` persistence, `ChartHistoryActions`, `ChartEditableText`, `ChartCopilotInput`) that BOTH cards compose; the ADR 037 D11 trust guard stays at the type level (`UserChartSpec` never parses as `ChartSpec`; the own-data command context carries the dataset profile and `setInstruction` validates only against it). (3) A data change on own data is a command (`setInstruction`) on the same history; the card asks a zero-LLM, zero-credit server action to render the spec for an instruction, cached per instruction so undo/redo never re-fetch. (4) The chat doorway is a new server action through the same credit gate as a question; the model's reply is a full instruction (or null) plus view commands referencing series by label; deterministic code maps, validates (`validateInstruction`, `validateCommand`, a digit guard on title/caption) and dispatches survivors with `source: 'chat'`. Persistence key for own-data charts = the chart turn's `dataset_turns.id` (migration 035, file-only).

**Tech Stack:** TypeScript, React 19, Next.js server actions, Recharts, zod 4, vitest (+ RTL/jsdom in `web/`, PGlite in the root), Playwright hermetic harness (`web/e2e`, `scripts/dev-harness`), Anthropic structured outputs via the existing `LlmRequest.jsonSchema` seam.

**Spec:** [docs/superpowers/specs/2026-09-17-chart-copilot-design.md](../specs/2026-09-17-chart-copilot-design.md) §3.2, §3.3, §4, §5 phase 2, §6, §7 decisions 1 + 3. ADR [056](../../decisions/056-chart-copilot.md) decisions 2, 3, 6, 7. ADR [037](../../decisions/037-user-data-attachments.md) D2/D4 + the 2026-09-17 addendum. Kickoff: [session-briefs/2026-09-18-session-113-kickoff.md](../../session-briefs/2026-09-18-session-113-kickoff.md).

## Global Constraints

- **Own data = full freedom; the executor computes, the model only selects.** No field of any model-facing schema can carry a display value; every plotted value is a stored cell or a deterministic function of stored cells with a traceable `rowRef`. CBS/Eurostat charts are NOT touched by this plan (phase 3).
- **One cheap-tier call per chat edit; zero for every panel/canvas edit** — `renderDatasetInstruction` is deterministic and free (no credit reserve, the D12 CSV-ingest precedent).
- **No chat-only capability**: every command kind the chat can emit has an on-screen control on the own-data card; the contract test extends to `UserChartView`.
- **The D11 guard stays at the type level**: `UserChartSpec` still cannot parse as `ChartSpec`; `ChartView` never receives one; `setInstruction` validates only when the command context carries a `profile`.
- **Migrations are FILE-ONLY** (`migrations/035_chart_edits_dataset_turns.sql`); every reader/writer degrades gracefully when the column is absent (catch `42703 undefined_column` + the `to_regclass` guard). Never run `npm run db:migrate` against a real database.
- **Prompt bytes:** `DATASET_INSTRUCT_PROMPT_VERSION` becomes 2, `CHART_INSTRUCTION_SCHEMA_VERSION` becomes 2, a new `COPILOT_PROMPT_VERSION = 1`. No recorded fixtures exist for this tier today (every test uses a fake client), so CI needs no re-recording; Task 9 adds the hand-authored fixture generator + an `attachments:record` script for the owner's supervised live run.
- **Copy:** every new interface string gets an `nl` AND an `en` entry in `web/lib/i18n/messages.ts`; Dutch first; no `chart.*`/`userChart.*` string contains a digit. Backend-built text for this tier stays English (#206, `templates.ts` precedent). Input label exactly "Pas deze grafiek aan" / "Adjust this chart" (owner decision).
- **Repo is public. Never name the competitor** ("Competitor G", docs only).
- **Commits:** one commit per task on `main` (owner-present session; the session pushes after the full verification block, never a subagent). Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- **Run tests from the right folder and in the FOREGROUND, reading the exit code:** web `cd web && npx vitest run <file>`; root `npx vitest run <file>`; typecheck `cd web && npm run typecheck` and root `npm run typecheck`. No summary printed = a killed run = a failure.
- Follow each file's existing comment style (why-comments, session tag "session 113"); keep new comments short.

---

## File structure

| File | Responsibility |
|---|---|
| `src/attachments/types.ts` (modify) | Instruction v2 types (`AggregateFn`, `DerivedOp`, `aggregate`, `derived`, `sort.by 'value'`), `upgradeInstruction`, `LegacyUnsupportedReason`, `MissingValueReason` + `'geen vorige waarde'`, the chart envelope's optional `copilot` field, `CopilotCommand`/`CopilotRefusal` types. |
| `src/attachments/instruct/schema.ts` (modify) | Schema v2 + validation of aggregate/derived/sort; `validateInstructionObject` (parsed-object entry, reused by the co-pilot). |
| `src/attachments/instruct/prompt.ts` (modify) | Prompt v2 rules; version 2. |
| `src/attachments/execute.ts` (modify) | `aggregate` → `derived` → sort (incl. `'value'`) → limit → cap; `RawPoint.computed`. |
| `src/attachments/labels.ts` (new) | Deterministic English labels for aggregated/derived series. |
| `src/attachments/chart.ts` (modify) | Uses `computed` values + labels. |
| `src/attachments/respond.ts`, `templates.ts`, `replay.ts`, `store.ts`, `retention.ts` (modify) | Prompt-version constant; legacy refusal reasons kept for stored rows; `turnId` on chart messages + the `edit` replay message; feedback update; `chart_edits` hard-delete leg. |
| `migrations/035_chart_edits_dataset_turns.sql` (new) | Second key column on `chart_edits`. File only. |
| `src/chart/edits-store.ts` (modify) | `ChartEditsKey` (`answer` \| `turn`), both legs, column-absent guard. |
| `src/attachments/copilot/{types,schema,prompt,parse,map,text-guard,respond}.ts` (new) | The chat doorway's backend: schema, prompt, parse, label→key mapping, digit guard, the turn orchestration. |
| `web/lib/chart-commands.ts` (modify) | `setInstruction` kind; `ChartDocState.instruction`; `CommandContext.profile`. |
| `web/lib/chart-edits-key.ts` (new), `web/lib/use-chart-edits.ts` (new) | Key type; the hydrate/save hook lifted out of `chart.tsx`. |
| `web/components/chart-history-actions.tsx` (new), `web/components/chart-editable-text.tsx` (new) | Undo/Redo/History group; the caption/title in-place editor. Both lifted out of `chart.tsx`. |
| `web/components/chart.tsx` (modify) | Composes the three lifted pieces; behaviour unchanged (phase-1 tests + e2e pin it). |
| `web/app/chart-edits-actions.ts` (modify) | Key-based fetch/save. |
| `web/lib/chart-data-instruction.ts` (new), `web/components/chart-data-panel.tsx` (new) | `summarizeInstruction`, `validateClientInstruction`; the Data panel (doorway A for data commands). |
| `web/lib/chart-capabilities.ts` (new), `web/lib/chart-copilot-reply.ts` (new) | Capabilities from live state; three example chips; client-side validation of a reply. |
| `web/components/chart-copilot-input.tsx` (new) | Input + example chips + recipe reply (chips, refused lines, Undo/Retry/👍👎). |
| `web/components/user-chart.tsx` (rewrite) | The own-data card: history, form switch, legend, style panel, notes, title/caption, Data panel, co-pilot input, persistence, H2 chrome intact. |
| `web/app/dataset-actions.ts` (modify) | `renderDatasetInstruction`, `adjustDatasetChart`, `submitCopilotFeedback`. |
| `web/components/dataset-chat.tsx`, `web/lib/dock-visuals.ts`, `web/components/visual-dock.tsx` (modify) | Thread the edit context to the card (inline + dock); render replayed `edit` messages. |
| `web/lib/i18n/messages.ts` (modify) | `userChart.*`, `chart.data.*`, `chart.copilot.*` keys, nl + en. |
| `scripts/attachments-fixtures.ts` (new), `tests/fixtures/attachments/{cases.ts,verkoop.csv}` (new), `package.json` (modify) | Hand-authored LLM fixtures built with the real request builders; `attachments:fixtures` (offline) and `attachments:record` (live, owner). |
| `scripts/dev-harness/env.sh`, `run-next-dev.mjs` (modify), `web/e2e/own-data-copilot.spec.ts` (new) | `ATTACHMENTS_ENABLED=1` in the harness; the real-browser proof. |
| Tests | `tests/attachments/{instruct-schema,instruct-prompt,execute,chart,respond,replay,retention,store,envelope-key-manifest}.test.ts` (extend), `tests/attachments/copilot-{schema,map,text-guard,respond}.test.ts` (new), `tests/chart/edits-store.test.ts` (extend), `web/lib/{chart-commands,use-chart-edits,chart-capabilities,chart-data-instruction,chart-copilot-reply}.test.ts`, `web/components/{chart-history-actions,chart-editable-text,chart-data-panel,chart-copilot-input,user-chart,user-chart-copilot,chart-commands-contract}.test.tsx`. |

**Execution order and parallelism** (max two implementers at once on this 8 GB machine; each wave's two tasks touch disjoint files, so they run in two worktrees and merge in order): wave A = Task 1 ∥ Task 3; wave B = Task 2 ∥ Task 4; wave C = Task 5 ∥ Task 7; wave D = Task 6; wave E = Task 8; wave F = Task 9. Reviewers and the docs pass run alongside.

---

### Task 1: Instruction schema v2 — aggregate, derived, sort by value (types, schema, prompt)

**Files:**
- Modify: `src/attachments/types.ts` (the `ChartInstruction`, `ClientChartInstruction`, `toClientInstruction`, `reviveClientInstruction`, `UnsupportedReason`, `MissingValueReason`, the refusal envelope's `reason` union)
- Modify: `src/attachments/instruct/schema.ts`, `src/attachments/instruct/prompt.ts`, `src/attachments/respond.ts` (the two `promptVersion: 1` literals → `DATASET_INSTRUCT_PROMPT_VERSION`), `src/attachments/templates.ts` (keep the `aggregation`/`computation` texts for stored rows; add nothing else), `src/attachments/reconstruct.ts` (only if it pins `version`), `src/attachments/replay.ts` (upgrade the referent)
- Test: `tests/attachments/instruct-schema.test.ts`, `tests/attachments/instruct-prompt.test.ts`, `tests/attachments/instruct-parse.test.ts`, `tests/attachments/respond.test.ts`, `tests/attachments/reconstruct.test.ts`, `tests/attachments/replay.test.ts` (every `version: 1` fixture literal → 2 with `aggregate: null, derived: null`)

**Interfaces:**
- Consumes: today's `ChartInstruction` (types.ts:128), `validateInstruction(outputText, profile)` (schema.ts:88), `serializeDatasetInstructRequest` (prompt.ts:73).
- Produces (used by Tasks 2, 5, 6, 7):

```ts
// src/attachments/types.ts
export type AggregateFn = 'sum' | 'mean' | 'min' | 'max' | 'count';
export type DerivedOp = 'difference' | 'share_of_total' | 'percent_change' | 'ratio';
export const AGGREGATE_FNS: readonly AggregateFn[] = ['sum', 'mean', 'min', 'max', 'count'];
export const DERIVED_OPS: readonly DerivedOp[] = ['difference', 'share_of_total', 'percent_change', 'ratio'];
/** Ops that need a second column `b` (a is always y[0]). */
export const DERIVED_OPS_WITH_B: readonly DerivedOp[] = ['difference', 'ratio'];
export type UnsupportedReason = 'compare_with_cbs' | 'not_chartable' | 'other';
/** Only ever read back from rows stored before schema v2 — never produced again. */
export type LegacyUnsupportedReason = 'aggregation' | 'computation';
export interface ChartInstruction {
  version: 2;
  kind: ChartKind;
  x: ColumnId;
  y: ColumnId[];
  seriesBy: ColumnId | null;
  filters: FilterClause[];
  /** 'value' = the plotted (possibly computed) value — the only way to order
   * aggregated/derived points; a column id is legal only without aggregate/derived. */
  sort: { by: 'x' | 'value' | ColumnId; direction: 'asc' | 'desc' } | null;
  limit: number | null;
  /** Group by (x[, seriesBy]); fn over y[0] (count: rows in the group). */
  aggregate: { fn: AggregateFn } | null;
  /** a = y[0]; b required for difference/ratio, null otherwise. */
  derived: { op: DerivedOp; b: ColumnId | null } | null;
  confidence: number;
  reading: string;
  unsupported: null | { reason: UnsupportedReason; detail: string };
}
export type MissingValueReason = 'leeg in bron' | 'geen getal' | 'geen vorige waarde';
/** A stored/held v1 instruction object gains the v2 fields; anything else is returned as-is. */
export function upgradeInstruction(raw: unknown): unknown;
```

`ClientChartInstruction`/`toClientInstruction`/`reviveClientInstruction` carry `aggregate` and `derived` through unchanged. The refusal envelope's `reason` union keeps `'aggregation' | 'computation'` (typed via `LegacyUnsupportedReason`) so stored rows still type-check; `templates.ts`'s `REFUSAL_TEXT` keeps those two entries (needed by `reconstruct.ts` for old rows).

```ts
// src/attachments/instruct/schema.ts
export const CHART_INSTRUCTION_SCHEMA_VERSION = 2;
export const chartInstructionSchema: z.ZodType<...>;   // exported now (the co-pilot schema embeds it)
export function chartInstructionJsonSchema(): Record<string, unknown>;
export function validateInstruction(outputText: string, profile: DatasetProfile): ChartInstruction; // unchanged signature
/** The same allowlist/range checks over an already-parsed object — the entry the
 * co-pilot (Task 7) and the client-side Data panel (Task 6, via web/backend) use. */
export function validateInstructionObject(data: unknown, profile: DatasetProfile, outputText?: string): ChartInstruction;
```

- [ ] **Step 1: Write the failing schema tests** — append to `tests/attachments/instruct-schema.test.ts` (reuse its existing `PROFILE`/`validOutput` helpers; if `validOutput` builds a `version: 1` object, change it to `version: 2, aggregate: null, derived: null`):

```ts
describe('schema v2 — aggregate, derived, sort by value', () => {
  it('accepts an aggregate over a text x with a numeric y', () => {
    const out = validateInstruction(validOutput({ kind: 'bar', x: 'c1', y: ['c2'], aggregate: { fn: 'sum' }, sort: { by: 'value', direction: 'desc' } }), PROFILE);
    expect(out.aggregate).toEqual({ fn: 'sum' });
    expect(out.sort).toEqual({ by: 'value', direction: 'desc' });
  });
  it('rejects derived difference without b, and with a non-numeric b', () => {
    expect(() => validateInstruction(validOutput({ derived: { op: 'difference', b: null } }), PROFILE)).toThrow(/needs a second column/);
    expect(() => validateInstruction(validOutput({ derived: { op: 'difference', b: 'c1' } }), PROFILE)).toThrow(/not 'number' or 'year'/);
  });
  it('rejects a b column for share_of_total and percent_change', () => {
    expect(() => validateInstruction(validOutput({ derived: { op: 'share_of_total', b: 'c2' } }), PROFILE)).toThrow(/takes no second column/);
  });
  it('rejects derived with more than one y column', () => {
    expect(() => validateInstruction(validOutput({ y: ['c2', 'c3'], derived: { op: 'percent_change', b: null } }), PROFILE)).toThrow(/exactly one y column/);
  });
  it('rejects sort by a column id when aggregate or derived is set', () => {
    expect(() => validateInstruction(validOutput({ kind: 'bar', x: 'c1', aggregate: { fn: 'count' }, sort: { by: 'c2', direction: 'asc' } }), PROFILE)).toThrow(/sort by 'x' or 'value'/);
  });
  it('rejects the old unsupported reasons and version 1', () => {
    expect(() => validateInstruction(validOutput({ unsupported: { reason: 'aggregation', detail: 'x' } }), PROFILE)).toThrow(/schema/);
    expect(() => validateInstruction(validOutput({ version: 1 }), PROFILE)).toThrow(/schema/);
  });
  it('upgradeInstruction adds the v2 fields to a v1 object and leaves v2 alone', () => {
    expect(upgradeInstruction({ version: 1, kind: 'line', x: 'c0', y: ['c2'], seriesBy: null, filters: [], sort: null, limit: null })).toEqual({ version: 2, kind: 'line', x: 'c0', y: ['c2'], seriesBy: null, filters: [], sort: null, limit: null, aggregate: null, derived: null });
    const v2 = { version: 2, aggregate: { fn: 'sum' } };
    expect(upgradeInstruction(v2)).toBe(v2);
    expect(upgradeInstruction('nope')).toBe('nope');
  });
});
```
`PROFILE` in that file must have a text column `c1` with a `distinct` list and two numeric columns `c2`, `c3` — extend the fixture if it does not (keep every existing test's ids valid).

- [ ] **Step 2: Run to verify it fails** — `npx vitest run tests/attachments/instruct-schema.test.ts` → FAIL (`aggregate` unknown key under `strictObject`).

- [ ] **Step 3: Implement types + schema + upgrade**

`types.ts`: the types above; `upgradeInstruction`:
```ts
export function upgradeInstruction(raw: unknown): unknown {
  if (raw === null || typeof raw !== 'object') return raw;
  const o = raw as Record<string, unknown>;
  if (o.version !== 1) return raw;
  return { ...o, version: 2, aggregate: o.aggregate ?? null, derived: o.derived ?? null };
}
```
`schema.ts`:
```ts
const aggregateSchema = z.strictObject({ fn: z.enum(['sum', 'mean', 'min', 'max', 'count']) }).nullable();
const derivedSchema = z.strictObject({ op: z.enum(['difference', 'share_of_total', 'percent_change', 'ratio']), b: z.string().nullable() }).nullable();
export const chartInstructionSchema = z.strictObject({
  version: z.literal(CHART_INSTRUCTION_SCHEMA_VERSION),
  kind: z.enum(['line', 'bar']),
  x: z.string(), y: z.array(z.string()), seriesBy: z.string().nullable(),
  filters: z.array(filterClauseSchema),
  sort: z.strictObject({ by: z.string(), direction: z.enum(['asc', 'desc']) }).nullable(),
  limit: z.number().nullable(),
  aggregate: aggregateSchema,
  derived: derivedSchema,
  confidence: z.number(), reading: z.string(),
  unsupported: z.strictObject({ reason: z.enum(['compare_with_cbs', 'not_chartable', 'other']), detail: z.string() }).nullable(),
});
```
`collectColumnRefs` adds `derived.b` when non-null and skips `sort.by === 'value'`. New checks in `validateInstructionObject` (after the existing y-type loop):
```ts
if (data.derived !== null) {
  if (data.y.length !== 1) fail(`derived '${data.derived.op}' needs exactly one y column`, outputText);
  const needsB = DERIVED_OPS_WITH_B.includes(data.derived.op);
  if (needsB && data.derived.b === null) fail(`derived '${data.derived.op}' needs a second column b`, outputText);
  if (!needsB && data.derived.b !== null) fail(`derived '${data.derived.op}' takes no second column`, outputText);
  if (data.derived.b !== null) {
    const b = columnsById.get(data.derived.b)!;
    if (b.type !== 'number' && b.type !== 'year') fail(`derived column b '${data.derived.b}' has type '${b.type}', not 'number' or 'year'`, outputText);
    if (b.numberFormat === 'ambiguous') fail(`derived column b '${data.derived.b}' has an unresolved ambiguous number format`, outputText);
  }
}
if (data.sort !== null && data.sort.by !== 'x' && data.sort.by !== 'value' && (data.aggregate !== null || data.derived !== null)) {
  fail(`with aggregate/derived, sort by 'x' or 'value' only (got '${data.sort.by}')`, outputText);
}
```
`validateInstruction(outputText, profile)` = JSON.parse + `validateInstructionObject(parsed, profile, outputText)`.

`prompt.ts`: `DATASET_INSTRUCT_PROMPT_VERSION = 2`; replace the `unsupported` rule and add, verbatim:
```
- aggregate: when the user asks for a total, average, minimum, maximum or a count PER category ("totaal per regio", "gemiddelde per jaar"), set aggregate to {"fn": "sum"|"mean"|"min"|"max"|"count"}; the system groups rows by x (and by seriesBy when set) and computes fn over y[0] — you never compute anything yourself. Leave it null otherwise.
- derived: when the user asks for the difference between two columns ("omzet min kosten"), a ratio of two columns ("omzet per medewerker"), each value's share of the series total ("aandeel van het totaal", "percentage van"), or the change versus the previous point ("groei per jaar", "procentuele verandering"), set derived to {"op": "difference"|"ratio", "b": "<the second column's id>"} or {"op": "share_of_total"|"percent_change", "b": null}. y must then be exactly one column (the first operand, a). Leave it null otherwise.
- sort.by may also be "value" — the plotted value — which is the ONLY sort allowed together with aggregate or derived ("hoogste eerst" = {"by": "value", "direction": "desc"}).
- Set unsupported ONLY for a comparison against official CBS data ("compare_with_cbs") or something that isn't chartable at all ("not_chartable"/"other") — totals, averages, percentages and differences ARE supported now, via aggregate/derived.
- version is always 2.
```
`respond.ts`: import `DATASET_INSTRUCT_PROMPT_VERSION` and use it for both `promptVersion:` literals. `replay.ts` `lastChartState`: return `{ ...envelope.state, lastInstruction: upgradeInstruction(envelope.state.lastInstruction) as ClientChartInstruction }` and do the same for the chart message's `lastInstruction`. `respond.ts` `revalidatePrevious`: run `upgradeInstruction` on `rawState.lastInstruction` before `reviveClientInstruction` (a v1 referent held by an open tab keeps working instead of falling back to a standalone parse).

- [ ] **Step 4: Fix every fixture literal** — `grep -rn "version: 1" tests/attachments src/attachments` and update every `ChartInstruction` literal to `version: 2, aggregate: null, derived: null`. Run `npx vitest run tests/attachments` → all green; `npm run typecheck` → clean.

- [ ] **Step 5: Commit** — `git add src/attachments tests/attachments && git commit -m "feat(attachments): instruction schema v2 — aggregate, fixed derived set, sort by value; prompt v2 (co-pilot phase 2)"`.

---

### Task 2: The executor computes — aggregate, derived, sort by value; deterministic labels

**Files:**
- Modify: `src/attachments/execute.ts`, `src/attachments/chart.ts`
- Create: `src/attachments/labels.ts`
- Test: `tests/attachments/execute.test.ts`, `tests/attachments/chart.test.ts`

**Interfaces:**
- Consumes: Task 1's `ChartInstruction` v2; `parseNumber`/`decimalsOf` (`ingest/numbers.ts`), `formatValueNl` (`src/answer/compose/format.ts`), `columnById`/`columnIndex` (`columns.ts`).
- Produces:

```ts
// execute.ts
export interface ComputedValue { value: number | null; decimals: number; rowRef: string; reason?: MissingValueReason }
interface RawPoint { rowIndex; xRaw; xSortKey; yRaw; seriesKey; seriesLabel; computed?: ComputedValue }
export function executeInstruction(dataset: UserDataset, instruction: ChartInstruction): RawPoint[]; // unchanged signature
// labels.ts
export function aggregateLabel(fn: AggregateFn, yHeader: string): string;      // 'Sum of Omzet', 'Average of Omzet', 'Lowest Omzet', 'Highest Omzet', 'Count of rows'
export function derivedLabel(op: DerivedOp, aHeader: string, bHeader: string | null): string; // 'Omzet − Kosten', 'Omzet ÷ Kosten', 'Omzet, share of total (%)', 'Omzet, change vs previous (%)'
```

**Semantics (fixed set, owner decision):**
- Pipeline: filter → select (as today) → **aggregate** → **derive** → sort → limit → cap. `instruction.aggregate ?? null` / `instruction.derived ?? null` read defensively so a stored v1 row still reconstructs byte-identically.
- Aggregate: group by `(seriesKey, xRaw.trim())`; values = `numericCellValue` of y[0] per row, nulls skipped; `sum`/`min`/`max` → null when no numeric value in the group, decimals = max `decimalsOf` of the inputs; `mean` = sum/n, decimals 2; `count` = rows in the group (y ignored), decimals 0. `rowRef = \`agg:${fn}:${refs.join('+')}\`` with each ref `r{row}:c{ycol}`. When `seriesBy` is null and several y columns are given, each y column is aggregated as its own series (as the multi-y branch does today).
- Derived (after aggregation, per series, in x order): `difference` = a − b; `ratio` = a / b (b null or 0 → null, reason `'geen getal'`); `share_of_total` = a / Σ(non-null a in the series) × 100 (decimals 1); `percent_change` = (a − prev) / |prev| × 100 (first point null, reason `'geen vorige waarde'`; prev 0 → null `'geen getal'`; decimals 1). The b operand is selected+aggregated exactly like a (same filters, same group key, same fn) and joined on `(seriesKey, xKey)`; a missing b → null `'geen getal'`. `rowRef = \`der:${op}:${refA}|${refB}\`` (or `|prev:${refPrev}` / `|total:${n}`). Decimals for difference = max of the operands', ratio = 2.
- Sort: line → x ascending (unchanged). Bar → `by: 'x'` as today; `by: 'value'` → the plotted value (`computed.value` when present, else parsed y; nulls last); `by: <column id>` → as today (validation already forbids it with aggregate/derived).

- [ ] **Step 1: Write the failing executor tests** — append to `tests/attachments/execute.test.ts` (its `dataset()`/`instruction()` helpers; `instruction()` already has `version: 2, aggregate: null, derived: null` after Task 1):

```ts
const SALES = [
  ['Jaar', 'Gemeente', 'Omzet', 'Kosten'],
  ['2020', 'Amsterdam', '100', '60'],
  ['2020', 'Rotterdam', '50', '20'],
  ['2021', 'Amsterdam', '150', '90'],
  ['2021', 'Rotterdam', '', '10'],
  ['2021', 'Utrecht', '30', '0'],
];
describe('aggregate (fixed set)', () => {
  it('sum per x groups rows and traces every source cell', () => {
    const points = executeInstruction(dataset(SALES), instruction({ kind: 'bar', x: 'c0', y: ['c2'], aggregate: { fn: 'sum' } }));
    expect(points.map((p) => [p.xRaw, p.computed?.value])).toEqual([['2020', 150], ['2021', 180]]);
    expect(points[0]!.computed!.rowRef).toBe('agg:sum:r1:c2+r2:c2');
    expect(points[1]!.computed!.rowRef).toBe('agg:sum:r3:c2+r4:c2+r5:c2'); // the empty cell is listed, not counted
  });
  it('mean uses 2 decimals, count counts rows, min/max pick', () => {
    const mean = executeInstruction(dataset(SALES), instruction({ kind: 'bar', x: 'c0', y: ['c2'], aggregate: { fn: 'mean' } }));
    expect(mean.map((p) => [p.computed?.value, p.computed?.decimals])).toEqual([[75, 2], [90, 2]]);
    const count = executeInstruction(dataset(SALES), instruction({ kind: 'bar', x: 'c0', y: ['c2'], aggregate: { fn: 'count' } }));
    expect(count.map((p) => p.computed?.value)).toEqual([2, 3]);
    const max = executeInstruction(dataset(SALES), instruction({ kind: 'bar', x: 'c1', y: ['c2'], aggregate: { fn: 'max' } }));
    expect(max.map((p) => [p.xRaw, p.computed?.value])).toEqual([['Amsterdam', 150], ['Rotterdam', 50], ['Utrecht', 30]]);
  });
  it('aggregate with seriesBy groups per (series, x)', () => {
    const points = executeInstruction(dataset(SALES), instruction({ kind: 'line', x: 'c0', y: ['c2'], seriesBy: 'c1', aggregate: { fn: 'sum' } }));
    expect(points.map((p) => [p.seriesKey, p.xRaw, p.computed?.value])).toEqual([
      ['Amsterdam', '2020', 100], ['Rotterdam', '2020', 50], ['Amsterdam', '2021', 150], ['Rotterdam', '2021', null], ['Utrecht', '2021', 30],
    ]);
  });
  it('sort by value desc + limit orders aggregated bars', () => {
    const points = executeInstruction(dataset(SALES), instruction({ kind: 'bar', x: 'c1', y: ['c2'], aggregate: { fn: 'sum' }, sort: { by: 'value', direction: 'desc' }, limit: 2 }));
    expect(points.map((p) => [p.xRaw, p.computed?.value])).toEqual([['Amsterdam', 250], ['Rotterdam', 50]]);
  });
});
describe('derived (fixed set)', () => {
  it('difference a − b per row with a joined rowRef', () => {
    const points = executeInstruction(dataset(SALES), instruction({ kind: 'bar', x: 'c1', y: ['c2'], filters: [{ column: 'c0', op: 'in', values: ['2020'] }], derived: { op: 'difference', b: 'c3' } }));
    expect(points.map((p) => [p.xRaw, p.computed?.value, p.computed?.rowRef])).toEqual([['Amsterdam', 40, 'der:difference:r1:c2|r1:c3'], ['Rotterdam', 30, 'der:difference:r2:c2|r2:c3']]);
  });
  it('ratio: b = 0 gives a null with reason geen getal', () => {
    const points = executeInstruction(dataset(SALES), instruction({ kind: 'bar', x: 'c1', y: ['c2'], filters: [{ column: 'c0', op: 'in', values: ['2021'] }], derived: { op: 'ratio', b: 'c3' } }));
    expect(points.map((p) => [p.xRaw, p.computed?.value, p.computed?.reason])).toEqual([['Amsterdam', 150 / 90, undefined], ['Rotterdam', null, 'geen getal'], ['Utrecht', null, 'geen getal']]);
  });
  it('share_of_total sums non-null values of the series', () => {
    const points = executeInstruction(dataset(SALES), instruction({ kind: 'bar', x: 'c1', y: ['c2'], filters: [{ column: 'c0', op: 'in', values: ['2020'] }], derived: { op: 'share_of_total', b: null } }));
    expect(points.map((p) => p.computed?.value)).toEqual([100 / 150 * 100, 50 / 150 * 100]);
    expect(points[0]!.computed!.decimals).toBe(1);
  });
  it('percent_change: first point null with reason geen vorige waarde, then (a−prev)/|prev|×100', () => {
    const points = executeInstruction(dataset(SALES), instruction({ kind: 'line', x: 'c0', y: ['c2'], filters: [{ column: 'c1', op: 'in', values: ['Amsterdam'] }], derived: { op: 'percent_change', b: null } }));
    expect(points.map((p) => [p.computed?.value, p.computed?.reason])).toEqual([[null, 'geen vorige waarde'], [50, undefined]]);
  });
  it('aggregate then derive: share of total over yearly sums', () => {
    const points = executeInstruction(dataset(SALES), instruction({ kind: 'bar', x: 'c0', y: ['c2'], aggregate: { fn: 'sum' }, derived: { op: 'share_of_total', b: null } }));
    expect(points.map((p) => p.computed?.value)).toEqual([150 / 330 * 100, 180 / 330 * 100]);
  });
});
```
And in `tests/attachments/chart.test.ts`:
```ts
it('an aggregated spec formats the computed value and labels the series deterministically', () => {
  const spec = buildUserChartSpec(dataset(SALES), instruction({ kind: 'bar', x: 'c0', y: ['c2'], aggregate: { fn: 'mean' } }));
  expect(spec.yHeaders).toEqual(['Average of Omzet']);
  expect(spec.series[0]!.label).toBe('Average of Omzet');
  expect(spec.series[0]!.points.map((p) => [p.formattedValue, p.rowRef])).toEqual([['75,00', 'agg:mean:r1:c2+r2:c2'], ['90,00', 'agg:mean:r3:c2+r4:c2+r5:c2']]);
});
it('a derived spec labels a − b and keeps sourceText as the a cell', () => {
  const spec = buildUserChartSpec(dataset(SALES), instruction({ kind: 'bar', x: 'c1', y: ['c2'], filters: [{ column: 'c0', op: 'in', values: ['2020'] }], derived: { op: 'difference', b: 'c3' } }));
  expect(spec.yHeaders).toEqual(['Omzet − Kosten']);
  expect(spec.series[0]!.points[0]).toMatchObject({ formattedValue: '40', sourceText: '100', rowRef: 'der:difference:r1:c2|r1:c3' });
});
```
(Formatting expectations follow `formatValueNl(value, decimals)`; if `'75,00'` differs from the formatter's real output, use the formatter's output — the test pins the formatter, not the other way round.)

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/attachments/execute.test.ts tests/attachments/chart.test.ts` → FAIL (`computed` undefined).

- [ ] **Step 3: Implement** — in `execute.ts`: extract today's selection into `selectPoints(dataset, instruction, yId)` returning `RawPoint[]` for one y column (or the seriesBy branch); add `aggregatePoints(points, fn, yColumn)`, `derivePoints(aPoints, bPoints | null, op)`, `sortPoints(points, instruction)`; wire the pipeline; `compareSortKey` unchanged; `valueOf(point)` = `point.computed ? point.computed.value : numericCellValue(point.yRaw, yColumn)` for `'value'` sorts (nulls last). In `chart.ts`: `buildPoint` uses `raw.computed` when present (`value`, `formatValueNl(value, decimals)`, `reason`, `rowRef`; `sourceText` = the a cell's raw text; for an aggregate `sourceText` = `''`); series label/`yHeaders` via `labels.ts` when aggregate/derived is set. Update the header comments of `execute.ts`/`chart.ts` ("No arithmetic in v1 (D7)" → "phase 2: the fixed aggregate/derived set is computed HERE, never by the model").

- [ ] **Step 4: Run** — `npx vitest run tests/attachments` → green; `npm run typecheck` → clean.

- [ ] **Step 5: Commit** — `git commit -m "feat(attachments): the executor computes the fixed aggregate/derived set with traceable rowRefs; sort by value (co-pilot phase 2)"`.

---

### Task 3: Persistence for own-data charts — migration 035, key-based store + actions, retention leg, `turnId` on replay

**Files:**
- Create: `migrations/035_chart_edits_dataset_turns.sql`
- Modify: `src/chart/edits-store.ts`, `web/app/chart-edits-actions.ts`, `src/attachments/retention.ts`, `web/components/chart.tsx` (ONLY the two call-site argument shapes), `web/components/chart-edits-persistence.test.tsx` (mock expectations)
- Create: `web/lib/chart-edits-key.ts`
- Test: `tests/chart/edits-store.test.ts`, `tests/attachments/retention.test.ts`
- **Do NOT touch** `src/attachments/types.ts`, `replay.ts`, `store.ts` (Task 1 and Task 5/7 own those; parallel worktrees must not collide).

**Interfaces:**
- Consumes: migration 034's table; `upsertChartEdits`/`getOwnChartEdits` (edits-store.ts:34/51); `redactTurnsForDatasets` (retention.ts:61); `DatasetChatMessage` (replay.ts:19).
- Produces:

```ts
// web/lib/chart-edits-key.ts (shared by the card, the actions and — via web/backend — the store)
export type ChartEditsKey = { kind: 'answer'; id: number } | { kind: 'turn'; id: number };
export function isChartEditsKey(raw: unknown): raw is ChartEditsKey;   // kind ∈ {answer,turn}, id a positive safe integer
export function editsKeyToString(key: ChartEditsKey): string;          // 'answer:12' / 'turn:7' — a stable React/ref identity
// src/chart/edits-store.ts
export interface UpsertChartEditsInput { key: ChartEditsKey; userId: string; log: unknown[] }
export async function upsertChartEdits(db: Db, input: UpsertChartEditsInput): Promise<boolean>;
export async function getOwnChartEdits(db: Db, key: ChartEditsKey, userId: string): Promise<unknown[] | null>;
export async function deleteChartEditsForTurns(db: Db, turnIds: number[]): Promise<number>;   // hard delete; 0 when the column/table is absent
// web/app/chart-edits-actions.ts
export async function fetchChartEdits(rawKey: unknown): Promise<FetchChartEditsResponse>;
export async function saveChartEdits(rawKey: unknown, rawLog: unknown): Promise<SaveChartEditsResponse>;
```
(The replay-side `turnId` lands in Task 5; the co-pilot envelope field, `CopilotCommand`/`CopilotRefusal` and the feedback update land in Task 7 — see those tasks.)

- [ ] **Step 1: The migration**

```sql
-- 035 — chart_edits for own-data charts (session 113, chart co-pilot phase 2,
-- ADR 056 decision 4 + ADR 037 addendum). A reader's own-data chart lives on a
-- dataset_turns row, not an audit_answers row, so chart_edits gains a second,
-- mutually exclusive key. ⚠ FILE-ONLY until the owner-supervised apply (034
-- precedent — apply 034 and 035 in one `npm run db:migrate`). Deploy-order-
-- safe: src/chart/edits-store.ts treats an absent column as "no edits yet".
-- Plain Postgres only — identical on Supabase and PGlite (ADR 009).
alter table chart_edits alter column audit_answer_id drop not null;
alter table chart_edits add column dataset_turn_id bigint references dataset_turns(id);
alter table chart_edits add constraint chart_edits_one_key
  check ((audit_answer_id is null) <> (dataset_turn_id is null));
alter table chart_edits drop constraint chart_edits_pkey;
alter table chart_edits add column id bigint generated always as identity primary key;
create unique index chart_edits_answer_user on chart_edits (audit_answer_id, user_id) where audit_answer_id is not null;
create unique index chart_edits_turn_user on chart_edits (dataset_turn_id, user_id) where dataset_turn_id is not null;
```
Run `npx vitest run tests/db` (or whatever suite applies migrations to PGlite — find it with `grep -rln "migrations" tests/helpers`) to prove the file applies cleanly after 034.

- [ ] **Step 2: Failing store tests** — extend `tests/chart/edits-store.test.ts` with an `insertDatasetTurnRow(db, userId)` helper (insert a `user_datasets` row, a `chat_threads` row and a `dataset_turns` row the way `tests/attachments/store.test.ts` does — copy its helper) and:

```ts
it('saves and reads a log keyed by a dataset turn the user owns', async () => withDb(async (db) => {
  const turnId = await insertDatasetTurnRow(db, USER);
  expect(await upsertChartEdits(db, { key: { kind: 'turn', id: turnId }, userId: USER, log: [{ kind: 'setTitle', title: 'x' }] })).toBe(true);
  expect(await getOwnChartEdits(db, { kind: 'turn', id: turnId }, USER)).toEqual([{ kind: 'setTitle', title: 'x' }]);
  expect(await getOwnChartEdits(db, { kind: 'turn', id: turnId }, 'someone-else')).toBeNull();
}));
it('refuses a turn key for a turn owned by another user', async () => withDb(async (db) => {
  const turnId = await insertDatasetTurnRow(db, 'other');
  expect(await upsertChartEdits(db, { key: { kind: 'turn', id: turnId }, userId: USER, log: [] })).toBe(false);
}));
it('answer keys still work exactly as in phase 1', ...)   // rewrite the existing tests to the { kind: 'answer', id } shape
it('deleteChartEditsForTurns removes the rows and returns the count', ...)
```
The ownership SQL for the turn leg: `insert into chart_edits (dataset_turn_id, user_id, log) select t.id, $2, $3::jsonb from dataset_turns t where t.id = $1 and t.user_id = $2::uuid and t.kind = 'chart' and t.chart_emitted on conflict (dataset_turn_id, user_id) where dataset_turn_id is not null do update set log = excluded.log, updated_at = now()`. Column-absent guard: wrap each turn-leg query; on a Postgres error with `code === '42703'` return `false`/`null`/`0` (the `to_regclass` check stays for the table).

- [ ] **Step 3: Implement store, key module, actions** — `fetchChartEdits(rawKey)`/`saveChartEdits(rawKey, rawLog)` validate with `isChartEditsKey` (replace `validAuditId`). Update the existing web callers in `chart.tsx` (lines ~2215/2237) to pass `{ kind: 'answer', id: editsKey }` for now (Task 4 lifts the whole block). Update `web/components/chart-edits-persistence.test.tsx`'s mock expectations to the new argument shape.

- [ ] **Step 4: Retention leg** — `redactTurnsForDatasets` calls `deleteChartEditsForTurns(tx, rowIds)` before redacting (test in `retention.test.ts`: a chart_edits row keyed by a turn of a deleted dataset is gone afterwards; a row keyed by an unrelated turn stays).

- [ ] **Step 5: Run** — `npx vitest run tests/chart tests/attachments` and `cd web && npx vitest run components/chart-edits-persistence.test.tsx` → green; both typechecks clean.

- [ ] **Step 6: Commit** — `git commit -m "feat(chart): chart_edits keyed by answer OR dataset turn (migration 035, file-only); retention leg (co-pilot phase 2)"`.

---

### Task 4: The shared card shell — `setInstruction` command; lift persistence, history actions and editable text out of `chart.tsx`

**Files:**
- Modify: `web/lib/chart-commands.ts`, `web/components/chart.tsx`, `web/components/chart-history-menu.tsx` (`describeCommand` for `setInstruction`)
- Create: `web/lib/use-chart-edits.ts`, `web/components/chart-history-actions.tsx`, `web/components/chart-editable-text.tsx`
- Test: `web/lib/chart-commands.test.ts` (extend), `web/lib/use-chart-edits.test.ts` (new), `web/components/chart-history-actions.test.tsx` (new), `web/components/chart-editable-text.test.tsx` (new); every phase-1 suite (`chart-history-ui`, `chart-title-caption`, `chart-edits-persistence`, `chart-commands-contract`, `chart.test.tsx`) must stay green UNCHANGED except for the Task-3 argument shape.

**Interfaces:**
- Consumes: Task 3's `ChartEditsKey`, `fetchChartEdits`/`saveChartEdits`; phase 1's `useChartHistory`, `replayLog`, `pushCommand`, `seal`, `serializeHistory`, `parseCommandLog`, `validateCommand`.
- Produces:

```ts
// chart-commands.ts additions
| { kind: 'setInstruction'; instruction: ClientChartInstruction; summary: string }   // summary: deterministic, digit-free label built by the doorway (Task 6's summarizeInstruction)
export interface ChartDocState extends ChartViewState { notes; title; caption; instruction: ClientChartInstruction | null }
export function initialDocState(initialForm, initialPresentation = {}, instruction: ClientChartInstruction | null = null): ChartDocState;
export interface CommandContext { spec: Pick<ChartSpec, 'kind' | 'series'>; alternatesCount: number; profile?: DatasetProfile }
// validateCommand('setInstruction'): false without ctx.profile; otherwise validateInstructionObject(reviveClientInstruction(cmd.instruction), ctx.profile) must not throw, and summary must be non-empty, ≤ 120 chars, digit-free.
// invertCommand('setInstruction'): before.instruction === null ? { kind: 'setTitle', title: before.title } (the no-op idiom) : { kind: 'setInstruction', instruction: before.instruction, summary: <before summary is unknown → use cmd.summary> }
```
`applyCommand('setInstruction')` = `{ ...state, instruction: cmd.instruction, hiddenKeys: new Set(), highlightedKey: null, periodRange: null, notes: [] }` — a data change invalidates series keys, the zoom window and note anchors (their `resultId`s are rowRefs of the OLD chart); the inverse restores the whole previous instruction, and undo re-renders that spec, so the reader loses nothing they can't get back with one more undo... **except notes**: to keep notes recoverable, `invertCommand` returns a `setInstruction` inverse AND the history entry's `inverse` cannot carry two commands — so instead `applyCommand` keeps `notes` untouched and the CARD (Task 5) filters notes to those whose `resultId` exists in the current spec at render time. Zod: `z.object({ kind: z.literal('setInstruction'), instruction: z.record(z.string(), z.unknown()), summary: z.string().max(120), ...envelope })`; `parseCommandLog` leaves the instruction object as-is (validation happens at replay via `validateCommand`, which needs the profile the card has).

```ts
// web/lib/use-chart-edits.ts — the hydrate/save block of chart.tsx (lines ~2152–2310) moved verbatim, generalised over the key
export interface UseChartEditsInput {
  editsKey: ChartEditsKey | null;
  history: ChartHistory;
  replaceHistory: (next: { state: ChartDocState; history: ChartHistory }) => void;
  /** Built by the caller from the CURRENT spec; read at hydrate time through a ref, never a dependency. */
  ctx: CommandContext;
  initial: ChartDocState;
}
export function useChartEdits(input: UseChartEditsInput): void;
export const CHART_EDITS_SAVE_DEBOUNCE_MS = 800;
```
Behaviour to preserve byte-for-byte (every rule below is a phase-1 review finding): `lastSavedEditsRef` starts at `'[]'` and resets on key change; hydrate replays the stored log then the reader's in-flight commands on top; no save before hydrate settled; save serialises `seal(history)`; a pending save is flushed on unmount/key change; the flush only updates the "last saved" marker when the key is unchanged. Key identity for effects: `editsKeyToString(editsKey)`.

```tsx
// web/components/chart-history-actions.tsx
export function ChartHistoryActions(props: {
  undo: () => void; redo: () => void; canUndo: boolean; canRedo: boolean;
  history: ChartHistory; lang: Lang;
  /** Story lock (chart.tsx): disables both buttons, hides the menu, adds title + aria-describedby. */
  locked?: { title: string; describedBy: string };
}): ReactNode;   // renders the exact `data-slot="chart-history-actions"` group from chart.tsx (Undo2/Redo2 buttons + ChartHistoryMenu with the same onUndoTo/onRedoTo loops)
// web/components/chart-editable-text.tsx
export function ChartEditableText(props: {
  value: string | null;            // the reader's text; null = none yet
  commandKind: 'setTitle' | 'setCaption';   // → data-command-kind on the edit/add buttons
  placeholder: string; editLabel: string; addLabel: string; saveLabel: string; cancelLabel: string;
  maxLength: number;
  onCommit: (next: string | null) => void;   // trimmed; '' → null
  locked?: { title: string; describedBy: string };
  testId: string;                  // 'chart-caption' / 'user-chart-title'
  as?: 'p' | 'h3';                 // display element when not editing (caption: p, own-data title: h3)
  className?: string;
}): ReactNode;   // the caption block of chart.tsx (lines ~3697–3765) generalised: input + Save/Cancel while editing; text + pencil, or the "add" link
```

- [ ] **Step 1: Failing tests** —
  - `chart-commands.test.ts`: `setInstruction` is in `CHART_COMMAND_KINDS`; validates only with a profile (build a two-column `DatasetProfile` via `buildDatasetProfile` from `../backend/attachments/ingest/profile.ts`); apply resets hidden/highlight/range but keeps notes; invert restores the previous instruction; the seeded-generator round-trip test (phase 1) includes `setInstruction` in its generator when a profile is present; `parseCommandLog` accepts and rejects (`summary` > 120) it.
  - `use-chart-edits.test.ts`: a `renderHook` around `useChartHistory` + `useChartEdits` with `vi.mock('../app/chart-edits-actions.ts')`: (a) hydrates a stored log (fetch called with the key object, state reflects the log); (b) saves after 800 ms with the sealed serialisation, not before hydrate settles; (c) a key change resets the marker and flushes the pending save against the OLD key. Use fake timers.
  - `chart-history-actions.test.tsx`: renders two buttons with `aria-label`s `chart.history.undo`/`redo` (Dutch text via `t('nl', …)`), disabled per `canUndo`/`canRedo`, hidden menu when `locked`.
  - `chart-editable-text.test.tsx`: add → input → Enter commits trimmed text; Escape cancels; empty commit → `onCommit(null)`; `data-command-kind` present on the add and the edit buttons.

- [ ] **Step 2: Run to verify failure** — `cd web && npx vitest run lib/chart-commands.test.ts lib/use-chart-edits.test.ts components/chart-history-actions.test.tsx components/chart-editable-text.test.tsx` → FAIL (modules missing).

- [ ] **Step 3: Implement the three new modules and the command kind** exactly as specified; then rewire `chart.tsx`: delete its inline hydrate/save block and call `useChartEdits({ editsKey: editsKey === null ? null : { kind: 'answer', id: editsKey }, history, replaceHistory, ctx: { spec, alternatesCount: alternates.length }, initial: initialDocState(initialForm, initialPresentation) })`; replace the `data-slot="chart-history-actions"` JSX with `<ChartHistoryActions … locked={storyOpen ? { title: storyLockedTitle!, describedBy: storyLockId } : undefined} />`; replace the caption block with `<ChartEditableText value={state.caption} commandKind="setCaption" … onCommit={(next) => dispatchCommand({ kind: 'setCaption', caption: next }, 'panel')} testId="chart-caption" as="p" />` (keep `captionNode`'s gating and placement). Leave the CBS title editing (heading-embedded, double-click) in place — it is not lifted. `describeCommand('setInstruction')` → `t(lang, 'chart.command.setInstruction', { summary: cmd.summary })` (new key, nl "Data: {summary}", en "Data: {summary}").

- [ ] **Step 4: Run the whole web suite** — `cd web && npx vitest run` → every phase-1 test green; `npm run typecheck` clean; `cd web && npx playwright test e2e/chart-copilot.spec.ts` green (the harness must be installed; if Playwright is unavailable locally, say so explicitly in the report and the session runs it).

- [ ] **Step 5: Commit** — `git commit -m "refactor(chart): shared card shell — useChartEdits, ChartHistoryActions, ChartEditableText lifted out of chart.tsx; setInstruction command kind (co-pilot phase 2)"`.

---

### Task 5: The own-data card v2 — history, form switch, legend, style panel, notes, title/caption, persistence; the zero-LLM render action

**Files:**
- Rewrite: `web/components/user-chart.tsx`
- Modify: `web/app/dataset-actions.ts` (add `renderDatasetInstruction`), `web/components/dataset-chat.tsx`, `web/lib/dock-visuals.ts`, `web/components/visual-dock.tsx`, `web/lib/i18n/messages.ts`, `src/attachments/replay.ts` (`turnId` on the chart message and on `lastChartState`)
- Create: `src/attachments/render.ts`
- Test: `web/components/user-chart.test.tsx` (extend; every existing H2 assertion stays), `web/components/dataset-chat.test.tsx` (extend), `web/lib/dock-visuals.test.ts` (extend), `tests/attachments/render.test.ts` (new, root — the pure part of the action), `tests/attachments/replay.test.ts` (extend: `turnId === record.id`)

**Interfaces:**
- Consumes: Task 4's shell modules + `setInstruction`; Task 3's key/actions/`turnId`; Task 2's spec (unchanged shape); `resolvePresentation`, `seriesColor`, `LINE_WIDTH_PX`, `dotGeometry`, `fontStack`, `withAccountDefault` (`chart-presentation.ts`); `ChartConfigPanel` + `ChartConfigTrigger`; `ChartNotes`; `ChartFrame`; `fallbackForm`/`lineFormAllowed`/`areaFormAllowed`/`hbarFormAllowed` (`chart-view-state.ts`); `useChartStyle`.
- Produces:

```ts
// user-chart.tsx
export interface UserChartEditContext {
  datasetId: number; threadId: number; turnId: number;
  profile: DatasetProfile;
  lastInstruction: ClientChartInstruction;
}
export function UserChartView(props: { spec: UserChartSpec; edit?: UserChartEditContext }): ReactNode;
// dataset-actions.ts
export type RenderDatasetInstructionOutcome =
  | { kind: 'ok'; chart: UserChartSpec }
  | { kind: 'unauthenticated' } | { kind: 'not_found' }
  | { kind: 'invalid'; reason: 'validation' | 'zero_rows' | 'too_many_points' };
export async function renderDatasetInstruction(datasetId: number, rawInstruction: unknown): Promise<RenderDatasetInstructionOutcome>;
// src/attachments/render.ts (pure orchestration the action calls; root-tested)
export function renderInstructionForDataset(dataset: UserDataset, rawInstruction: unknown): RenderDatasetInstructionOutcome-without-auth-variants;
// dock-visuals.ts
DockVisual gains `userChartEdit: UserChartEditContext | null` (null for chart/card visuals and for hand-built ones)
// src/attachments/replay.ts
| { role: 'assistant'; kind: 'chart'; text: string; chart: UserChartSpec; lastInstruction: ClientChartInstruction; turnId: number }
export function lastChartState(rows): { datasetId: number; lastInstruction: ClientChartInstruction; turnId: number } | null;
```
Without `edit` (a hand-built spec in tests, or a chart whose message has no turn id) the card renders exactly as today plus the client-only controls (form switch, legend, style panel, notes, title/caption, history) with no persistence and no Data panel/co-pilot input.

**Card composition (top to bottom, `!embedMode` semantics: this card has no embed/story/stage modes — nothing is gated):**
1. H2 chrome: dashed frame (`border-2 border-dashed`), `USER_DATA_BADGE` chip — unchanged, first.
2. Header row: `ChartEditableText` as the title (`as="h3"`, `testId="user-chart-title"`, value `state.title`, the derived `heading` shown when null — the `role="heading"` element keeps `aria-level={3}`), then `ChartHistoryActions`, then `ChartConfigTrigger` (style) and — with `edit` — the Data trigger (Task 6) on the right.
3. Form tablist (`data-command-kind="setForm"` per tab, `role="tab"`, the same `quietTab`/aria pattern as chart.tsx lines 4120–4180, keys `chart.tabLine`/`chart.form.area`/`chart.tabBar`/`chart.form.hbar`/`chart.tabTable`): line/area allowed per `lineFormAllowed`/`areaFormAllowed` on the plottable spec; hbar per `hbarFormAllowed`; `setForm` dispatched with source `'panel'`.
4. The plot inside `ChartFrame` (frame keys from `resolved.values`), honouring: `lineWidth` (stroke), `markers` (`Line dot` on/off per mode — `all` → dots, `ends` → first/last only, `provisionalOnly` → none), `grid` (`both`/`horizontal`/`none` → `CartesianGrid` props), `xLabels` (`tilted` → `XAxis angle={-35} textAnchor="end"` + height), `axisLines` (`baselineAxisLine`), `zeroBaseline` (`yAxisDomain` vs `['auto','auto']`), `areaFill` (Area with gradient/flat fill), `seriesColors` (`seriesColor(values, i)`), `fontFamily` (`fontStack` on the wrapper). `hiddenKeys`/`highlightedKey` from state: hidden series are not drawn; a highlighted series draws at full opacity, others at 0.35 (the ChartView convention). Table form: a plain `<table>` of `xLabel` × series `formattedValue` strings (spec strings only, no CSV export). Legend: a `SeriesLegend`-shaped component (copy its markup: a button per series, `aria-pressed` for hidden, `data-command-kind="toggleSeries setHighlight"`, click → `toggleSeries`, shift/double-click → `setHighlight`) — lift `SeriesLegend` out of chart.tsx into `web/components/chart-series-legend.tsx` and use it in BOTH cards (a second shell piece; chart.tsx keeps identical behaviour).
5. Click a point → `pendingPoint` → `ChartNotes` (`addNote`/`removeNote` commands; note `resultId` = `rowRef`, `periodLabel` = `xLabel`, `seriesLabel`). Notes whose `resultId` is not in the current spec are filtered at render (see Task 4's rationale).
6. Caption via `ChartEditableText` (`testId="chart-caption"`).
7. `ChartConfigPanel` region (controlled `open`, `onChange` → `setPresentation` with `transient` pass-through, `onReset` → `resetPresentation`, `onSeal` → `seal`, `onTemplate` → `applyTemplate`; `account`/`brand` passed when signed in exactly as chart.tsx does).
8. Provenance + disclaimer footer + `ChartDownloadMenu` — unchanged.

**Data commands:** `initialDocState(defaultForm, {}, edit?.lastInstruction ?? null)`. A `Map<string, UserChartSpec>` ref keyed by `JSON.stringify(instruction)` seeds with `{ [key(edit.lastInstruction)]: spec }`. An effect on `state.instruction`: cache hit → set `activeSpec`; miss → `renderDatasetInstruction(edit.datasetId, state.instruction)` → on `ok` cache + set; on `invalid` show an inline line `userChart.renderFailed.<reason>` and leave the previous spec (the reader can undo). `CommandContext` = `{ spec: toPlottableSpec(activeSpec), alternatesCount: 0, profile: edit.profile }`. Persistence: `useChartEdits({ editsKey: edit && signedIn ? { kind: 'turn', id: edit.turnId } : null, … })`.

**DatasetChat/dock:** chart messages carry `turnId` (fresh turns: `result.auditId`, which is the inserted `dataset_turns` id — `AuditedDatasetTurn.auditId`); `DatasetChat` builds `edit = { datasetId, threadId, turnId, profile, lastInstruction: message.lastInstruction }` for inline cards and `deriveDatasetVisuals(messages, { datasetId, threadId, profile })` puts the same object on `DockVisual.userChartEdit`; `visual-dock.tsx` passes `edit={active.userChartEdit ?? undefined}`. `edit` replay messages (Task 3) render in `DatasetChat` as one muted line `text` plus the recipe chips (Task 8's `RecipeChips` component; until Task 8 lands render the plain `text`).

- [ ] **Step 1: Failing tests** — `user-chart.test.tsx` (mock `../app/dataset-actions.ts` and `../app/chart-edits-actions.ts` with `vi.hoisted` like `chart-edits-persistence.test.tsx`): (a) the H2 badge, dashed frame, disclaimer and the absence of "Bron: CBS"/"CC BY" — existing tests untouched; (b) form tabs render, clicking "Staaf" switches to a BarChart (`.recharts-bar-rectangle` count) and Undo restores the line; (c) the legend hides a series (one fewer `.recharts-line-curve`) and ⌘Z brings it back; (d) title edit: add → type → Enter shows the reader's title in the heading and `data-testid="user-chart-title"`; (e) with `edit` + signed-in provider, `fetchChartEdits` is called with `{ kind: 'turn', id: 7 }` and, after a stored `setTitle` log, the title shows; (f) with `edit`, dispatching a `setInstruction` (through the Data panel is Task 6 — here call the exported test hook: render, then `fireEvent` on a hidden-in-test `data-testid="user-chart-dispatch"`? NO — instead export a tiny `UserChartViewHarness` from the test file that renders `UserChartView` and asserts `renderDatasetInstruction` is called once with the instruction and the returned chart replaces the plot; keep it minimal). (g) Every displayed number is a spec `formattedValue`/`xLabel` string (the existing digit-scan pattern).
  - `tests/attachments/render.test.ts`: `renderInstructionForDataset` returns `ok` for a valid v2 instruction, `invalid/validation` for a bad column id, `invalid/zero_rows` for a filter matching nothing, `invalid/too_many_points` over the cap — pure, no LLM.
  - `dataset-chat.test.tsx`: a fresh chart turn's card receives `edit.turnId === result.auditId`; a replayed `edit` message renders its text.
  - `dock-visuals.test.ts`: `userChartEdit` populated for a chart message with a turn id.

- [ ] **Step 2: Run to verify failure** — `cd web && npx vitest run components/user-chart.test.tsx components/dataset-chat.test.tsx lib/dock-visuals.test.ts` and `npx vitest run tests/attachments/render.test.ts` → FAIL.

- [ ] **Step 3: Implement** — `src/attachments/render.ts`: `upgradeInstruction` → `validateInstructionObject` (catch `InstructionValidationError` → `validation`) → `buildUserChartSpec` (catch `NoRowsError`/`TooManyPointsError`). `renderDatasetInstruction` action: `currentUserId`, `getDataset(db, userId, datasetId)` (`not_found` unless `status === 'ready'`), then the pure function; NO credit reserve; `reportError` on unexpected throws. Then the card, DatasetChat, dock. New i18n keys: `userChart.title.placeholder/edit/add/save/cancel`, `userChart.caption.*` (reuse `chart.caption.*` keys instead — they are tier-neutral), `userChart.renderFailed.validation` ("Deze combinatie kan niet worden getekend."), `.zero_rows` ("Geen rijen voldoen aan dit filter."), `.too_many_points` ("Te veel punten — filter eerst."), `userChart.table.value` etc. English variants alongside.

- [ ] **Step 4: Run** — `cd web && npx vitest run` green (incl. the phase-1 contract test, which still targets `ChartView`); `npx vitest run tests/attachments` green; both typechecks clean.

- [ ] **Step 5: Commit** — `git commit -m "feat(chart): the own-data card gets the shared shell — history, form switch, legend, style panel, notes, title/caption, per-turn persistence; zero-LLM renderDatasetInstruction (co-pilot phase 2)"`.

---

### Task 6: The Data panel — doorway A for data commands; the contract test covers the own-data card

**Files:**
- Create: `web/lib/chart-data-instruction.ts`, `web/components/chart-data-panel.tsx`
- Modify: `web/components/user-chart.tsx` (mount the panel + its trigger), `web/components/chart-commands-contract.test.tsx` (extend), `web/lib/i18n/messages.ts`
- Test: `web/lib/chart-data-instruction.test.ts`, `web/components/chart-data-panel.test.tsx`

**Interfaces:**
- Consumes: Task 5's card and `edit` context; Task 1's `validateInstructionObject`, `reviveClientInstruction`, `AGGREGATE_FNS`, `DERIVED_OPS`, `DERIVED_OPS_WITH_B`; `MAX_Y_COLUMNS`, `MAX_SERIES`, `MAX_LIMIT` (`limits.ts`).
- Produces:

```ts
// chart-data-instruction.ts (pure)
export function summarizeInstruction(i: ClientChartInstruction, profile: DatasetProfile, lang: Lang): string;
// e.g. nl: "Som van Omzet per Gemeente, hoogste eerst, top vijf" — NO digits: limits are spelled ("top vijf"/"top five" for ≤ 10, otherwise "beperkt"/"limited"); filters as "gefilterd op Jaar" ; derived as "Omzet min Kosten" etc. ≤ 120 chars (truncate with …).
export type ClientInstructionProblem = string; // the InstructionValidationError message
export function validateClientInstruction(i: ClientChartInstruction, profile: DatasetProfile): ClientInstructionProblem | null;
export function withPatch(i: ClientChartInstruction, patch: Partial<ClientChartInstruction>): ClientChartInstruction; // shallow merge that ALSO nulls `derived.b` when the op takes none, drops `sort` when it names a column and aggregate/derived is now set, and trims y to 1 when derived is set
// chart-data-panel.tsx
export function ChartDataPanel(props: {
  instruction: ClientChartInstruction; profile: DatasetProfile; lang: Lang;
  open: boolean; onOpenChange: (open: boolean) => void; triggerId: string; idPrefix: string;
  onChange: (next: ClientChartInstruction, summary: string) => void;   // only called with a VALID instruction
}): ReactNode;
export function ChartDataTrigger(props: { open: boolean; onToggle: () => void; controlsId: string; triggerId: string; lang: Lang }): ReactNode;
```
Controls (each carries `data-command-kind="setInstruction"`): chart kind (line/bar radio — the DATA orientation; the form tabs stay the view), x column `<select>` (all columns), y columns (checkboxes over number/year columns, 1..`MAX_Y_COLUMNS`), series-by `<select>` (none + columns with a `distinct` list ≤ `MAX_SERIES`), filters (for each column with `distinct`: a multi-select of its values; for each numeric column: from/to inputs bounded by min/max; "clear filter" per column), sort (`none` / `x` / `value` / column, direction), limit (`<input type=number>` 1..`MAX_LIMIT`, empty = none), aggregate (`none` + the five), derived (`none` + the four; a `b` select shown for difference/ratio). A control change → `withPatch` → `validateClientInstruction`; a problem renders as a muted line under the control group (`chart.data.problem` with the message) and `onChange` is NOT called; a valid one → `onChange(next, summarizeInstruction(next, profile, lang))`. The card's `onChange` → `dispatchCommand({ kind: 'setInstruction', instruction, summary }, 'panel')`.

- [ ] **Step 1: Failing tests** — `chart-data-instruction.test.ts`: summaries for a plain, an aggregated, a derived and a limited instruction in nl and en, all digit-free and ≤ 120; `withPatch` rules; `validateClientInstruction` returns null for valid and the schema's message for a bad `b`. `chart-data-panel.test.tsx`: renders with a two-column profile; picking aggregate "Som" calls `onChange` with `aggregate: { fn: 'sum' }` and a summary containing "Som"; picking derived "verschil" without a `b` shows the problem line and does not call `onChange`; every control has `data-command-kind="setInstruction"`. Contract test: add a second `describe('own-data card')` that renders `<UserChartView spec={userSpec} edit={…} />` (mock the two action modules), opens the Style and Data panels, and asserts `CHART_COMMAND_KINDS.filter(k => !found.has(k) && !['setPeriodRange','setReading','addNote','removeNote'].includes(k))` is empty — `setPeriodRange`/`setReading` are CBS-only kinds (no period codes / alternate readings on own data) and `validateCommand` rejects them on the own-data ctx (assert that too: `validateCommand({ kind: 'setPeriodRange', range: null }, ownCtx)` is `true` for null only… no: assert `setReading` with index 0 is false since `alternatesCount: 0`, and `setPeriodRange` with any non-null range is false since user specs have no CBS period codes in the range set — actually `periodCodes()` reads `point.periodCode` = `xKey`, so a range of real x keys WOULD validate; therefore `validateCommand` gets an explicit rule: `setPeriodRange` with a non-null range is `false` when `ctx.profile` is present, and the contract test asserts that).

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement** the two modules, mount the panel in `user-chart.tsx` (trigger in the header row next to the Style trigger, region under the plot above the Style region, `data-slot="chart-data-panel"`), add the `setPeriodRange` rule to `validateCommand`, i18n keys `chart.data.*` (trigger "Data", labels for every control, the five aggregate names, the four derived names, `problem`).

- [ ] **Step 4: Run** — `cd web && npx vitest run` green; typecheck clean.

- [ ] **Step 5: Commit** — `git commit -m "feat(chart): Data panel — columns, filters, series, sort, limit, aggregate, derived as setInstruction commands; contract test covers the own-data card (co-pilot phase 2)"`.

---

### Task 7: The chat doorway, backend — co-pilot schema, prompt, parse, label→key mapping, digit guard, the credited turn

**Files:**
- Create: `src/attachments/copilot/types.ts`, `schema.ts`, `prompt.ts`, `parse.ts`, `map.ts`, `text-guard.ts`, `respond.ts`
- Modify: `src/attachments/templates.ts` (`copilotReplyText(applied: number, refused: number)`), `src/attachments/types.ts` (`CopilotCommand`, `CopilotRefusal`, the chart envelope's optional `copilot` field), `src/attachments/store.ts` (`setDatasetTurnCopilotFeedback`), `tests/attachments/envelope-key-manifest.test.ts`
- Test: `tests/attachments/copilot-schema.test.ts`, `copilot-map.test.ts`, `copilot-text-guard.test.ts`, `copilot-respond.test.ts`, `copilot-prompt.test.ts`, `tests/attachments/store.test.ts` (feedback)
- **Backend only — no `web/` files.** The two server actions are Task 8's first step (they need Task 6's `summarizeInstruction`). Do NOT touch `replay.ts` (Task 8 adds the `edit` replay message).

**Interfaces:**
- Consumes: Task 1 (`chartInstructionSchema`, `validateInstructionObject`, `upgradeInstruction`), Task 2 (`buildUserChartSpec`), Task 3 (`copilot` envelope field, `setDatasetTurnCopilotFeedback`), `chargeAndRunDataset`, `writeTurn`, `LlmRequest`.
- Produces:

```ts
// copilot/types.ts
export interface CopilotCapabilities {              // sent by the client, enum-checked here before it touches the prompt
  forms: ('line' | 'area' | 'bar' | 'hbar' | 'table')[];
  presentationKeys: string[];                        // ⊆ PRESENTATION_KEYS below
  templates: string[];                               // ⊆ TEMPLATE_IDS below
  lang: 'nl' | 'en';
}
export const PRESENTATION_KEYS = ['lineWidth','markers','grid','xLabels','axisLines','zeroBaseline','areaFill','seriesColors','fontFamily','framePadding','frameCorners','frameShadow'] as const;
export const TEMPLATE_IDS = ['standard','classic','newsroom','presentation','social','minimal','warm','earth'] as const;
export type CopilotViewCommand = z.infer<typeof viewCommandSchema>;      // the model's shape (labels)
export interface CopilotOutput { version: 1; instruction: ChartInstruction | null; view: CopilotViewCommand[]; refused: { request: string; reason: 'not_available'|'not_on_this_chart'|'needs_click'; control: 'notes'|'style'|'data'|'form'|'none' }[]; confidence: number; reading: string }
// copilot/schema.ts
export const COPILOT_SCHEMA_VERSION = 1;
export function copilotOutputJsonSchema(): Record<string, unknown>;
export function validateCopilotOutput(outputText: string, profile: DatasetProfile): CopilotOutput;   // schema + validateInstructionObject on `instruction` when non-null; throws InstructionValidationError
// copilot/prompt.ts
export const COPILOT_PROMPT_VERSION = 1;
export function buildCopilotSystemPrompt(): string;
export function serializeCopilotRequest(profile: DatasetProfile, current: ClientChartInstruction, chart: { seriesLabels: string[]; xLabels: string[] }, capabilities: CopilotCapabilities, message: string): string;
// copilot/parse.ts
export const COPILOT_MODEL = 'claude-haiku-4-5';
export function buildCopilotRequest(...same args..., options?: { model?: string; maxTokens?: number }): LlmRequest;   // temperature 0, maxTokens 1536, jsonSchema: copilotOutputJsonSchema()
export async function parseCopilotReply(...same args..., options: DatasetInstructOptions): Promise<{ output: CopilotOutput; usage: LlmUsage; model: string }>;  // throws DatasetInstructFailure like parse.ts
// copilot/map.ts (pure)
export function mapCopilotOutput(output: CopilotOutput, chart: UserChartSpec, current: ClientChartInstruction, summary: string): { commands: CopilotCommand[]; refused: CopilotRefusal[] };
// copilot/text-guard.ts (pure)
export function unplottedDigits(text: string, chart: UserChartSpec): string[];  // every maximal run of [0-9][0-9.,]* in text that is not (after trimming trailing punctuation) one of: any point's formattedValue, sourceText, xLabel; any header token; '' when clean
// copilot/respond.ts
export interface RespondToChartEditInput { dataset: UserDataset; threadId: number; targetTurnId: number; message: string; requestId: string; current: unknown; capabilities: unknown; llmOptions: DatasetInstructOptions; summarize: (i: ClientChartInstruction) => string }
export async function respondToChartEdit(db: Db, input: RespondToChartEditInput): Promise<AuditedDatasetTurn>;
// src/attachments/types.ts
/** A validated, label-mapped command as the co-pilot stored it — structurally the
 * web ChartCommandParams subset the chat may emit; web/lib re-validates on dispatch. */
export type CopilotCommand = { kind: string } & Record<string, unknown>;
export interface CopilotRefusal { request: string; reason: 'not_available' | 'not_on_this_chart' | 'needs_click' | 'unplotted_number' | 'invalid'; control: 'notes' | 'style' | 'data' | 'form' | 'none' }
// the chart envelope gains (optional — rows written before phase 2 have no such key):
copilot?: { message: string; commands: CopilotCommand[]; refused: CopilotRefusal[]; targetTurnId: number; feedback: 'up' | 'down' | null }
// tests/attachments/envelope-key-manifest.test.ts lists it as `ignored`: "the chart it produced is reconstructed from `instruction` like every chart envelope; the recipe is the reader's own edit record, never re-derived".
// src/attachments/store.ts
export async function setDatasetTurnCopilotFeedback(db: Db, userId: string, turnId: number, vote: 'up' | 'down'): Promise<boolean>;
// update dataset_turns set envelope = jsonb_set(envelope, '{copilot,feedback}', to_jsonb($3::text)) where id = $1 and user_id = $2::uuid and envelope ? 'copilot'  → rowCount === 1
```

**The model's schema** (all fields present, nullable — the file's own note: structured outputs allow no per-request enums, no optionals in practice; code enforces every allowlist):
```ts
const patchSchema = z.strictObject({
  lineWidth: z.enum(['thin','normal','thick','extraThick']).nullable(),
  markers: z.enum(['all','ends','provisionalOnly']).nullable(),
  grid: z.enum(['both','horizontal','none']).nullable(),
  xLabels: z.enum(['flat','tilted']).nullable(),
  axisLines: z.enum(['shown','hidden']).nullable(),
  zeroBaseline: z.enum(['auto','zero']).nullable(),
  areaFill: z.enum(['gradient','flat']).nullable(),
  fontFamily: z.string().nullable(),
  seriesColors: z.array(z.strictObject({ seriesLabel: z.string(), hex: z.string() })),
  framePadding: z.enum(['none','small','medium','large']).nullable(),
  frameCorners: z.enum(['square','rounded','veryRounded']).nullable(),
  frameShadow: z.enum(['none','soft','strong']).nullable(),
});
const viewCommandSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('setForm'), form: z.enum(['line','area','bar','hbar','table']) }),
  z.strictObject({ kind: z.literal('setSeriesView'), hiddenLabels: z.array(z.string()), highlightedLabel: z.string().nullable() }),
  z.strictObject({ kind: z.literal('setPresentation'), patch: patchSchema }),
  z.strictObject({ kind: z.literal('applyTemplate'), templateId: z.string() }),
  z.strictObject({ kind: z.literal('resetPresentation') }),
  z.strictObject({ kind: z.literal('setTitle'), title: z.string().nullable() }),
  z.strictObject({ kind: z.literal('setCaption'), caption: z.string().nullable() }),
  z.strictObject({ kind: z.literal('addNote'), seriesLabel: z.string(), xLabel: z.string(), text: z.string() }),
]);
```
A root test (`copilot-schema.test.ts`) imports `sanitizeOverrides` from `../../web/lib/chart-presentation.ts` and `CHART_TEMPLATES` from `../../web/lib/chart-templates.ts` and asserts every enum value in `patchSchema` survives `sanitizeOverrides` and `TEMPLATE_IDS` equals the template id list — the backend vocabulary can never drift from the panel's ("no chat-only capability", the other half of the contract test).

**Mapping rules (`map.ts`)** — the output → stored, validated commands:
1. `output.instruction !== null` and it differs (deep-equal on the client fields) from `current` → `{ kind: 'setInstruction', instruction: toClientInstruction(output.instruction), summary }` FIRST. The `chart` passed in is the chart AFTER that instruction (respond.ts executes it before mapping).
2. `setForm` → kept as-is (the client validates form vs spec kind).
3. `setSeriesView` → labels mapped to `s${index}` over `chart.series` order; an unknown label → the whole command becomes a refusal `{ request: 'series: <label>', reason: 'not_on_this_chart', control: 'form' }`.
4. `setPresentation` → strip null keys; `seriesColors` → `{ [index]: hex }` for known labels, hex must match `/^#[0-9a-f]{6}$/i` (lower-cased), else dropped; an empty resulting patch → dropped silently.
5. `applyTemplate` → kept when in `TEMPLATE_IDS`, else refused (`not_available`, control `style`).
6. `setTitle`/`setCaption` → trimmed, length caps 120/280, then `unplottedDigits(text, chart)`; any → refused `{ request: text.slice(0, 80), reason: 'unplotted_number', control: 'none' }`.
7. `addNote` → `(seriesLabel, xLabel)` → the point → `{ kind: 'addNote', note: { id: <deterministic: 'chat-' + rowRef>, resultId: rowRef, periodLabel: xLabel, seriesLabel, text } }` (text trimmed, ≤ 280, digit-guarded like a title); unknown point → refused (`not_on_this_chart`, control `notes`).
8. `output.refused` items pass through (request capped at 80 chars).

**`respondToChartEdit` flow** (mirrors `respondToDatasetQuestion`; one `writeTurn`, one return):
1. `current` → `upgradeInstruction` → `validateInstructionObject` against `dataset.profile`; failure → a `refusal` envelope (`reason: 'internal'`, text `validationClarificationText()`), no LLM call (the client's held state is stale: the reader re-opens the thread).
2. `capabilities` → enum-check (`forms`, `presentationKeys`, `templates`, `lang`); anything off-list is dropped, never echoed.
3. Empty message → `refusal('empty_question')`, no call.
4. `buildUserChartSpec(dataset, current)` (for series/x labels in the prompt; catches → refusal `internal`).
5. `parseCopilotReply(...)`; `DatasetInstructFailure` → a `clarification` envelope (`reason: 'validation'`, `text: validationClarificationText()`, options `[]`) — the turn is still charged (the same rule as questions).
6. `output.confidence < MIN_INSTRUCTION_CONFIDENCE` → `clarification` (`low_confidence`).
7. `next = output.instruction ?? reviveClientInstruction(current)`; `buildUserChartSpec(dataset, next)` — `NoRowsError` → clarification `zero_rows`; `TooManyPointsError` → refusal `too_many_points`.
8. `mapCopilotOutput(output, chart, current, summarize(toClientInstruction(next)))`.
9. Envelope: `{ schemaVersion, kind: 'chart', question: message, text: copilotReplyText(commands.length, refused.length), instruction: next, chart, state: { datasetId, lastInstruction: toClientInstruction(next) }, copilot: { message, commands, refused, targetTurnId, feedback: null } }`; `writeTurn` with `chartEmitted: true`, `promptVersions: { copilot: COPILOT_PROMPT_VERSION, instruct_schema: CHART_INSTRUCTION_SCHEMA_VERSION }`.

`copilotReplyText(applied, refused)` (English, digit-free): `applied === 0 && refused === 0` → "Nothing to change." ; `applied > 0 && refused === 0` → "Done — see the chips below." ; refused > 0 → "Done in part — some requests need a click, see below." (applied 0 → "Nothing applied — see below.").

(The server actions that call this live in Task 8's new file `web/app/dataset-copilot-actions.ts`.)

- [ ] **Step 1: Failing tests** — `copilot-schema.test.ts` (accepts a full valid output; rejects an unknown view kind, an extra key, a bad instruction column; the vocabulary cross-check against web/lib), `copilot-text-guard.test.ts` ("Omzet steeg naar 150 in 2021" clean when 150 and 2021 are plotted; "ongeveer 12 procent" flagged `['12']`; "1.234,5" matched against a formattedValue), `copilot-map.test.ts` (each rule above with a two-series chart fixture), `copilot-prompt.test.ts` (the serialized request contains the series labels, the capabilities and the message; the system prompt names every command kind and says "never compute"), `copilot-respond.test.ts` (PGlite via `createTestDb` + a fake `LlmClient`, the `respond.test.ts` pattern: (a) a reply with a new aggregate instruction + a `setForm` writes ONE `dataset_turns` row of kind `chart` whose envelope has `copilot.commands` = `[setInstruction, setForm]` and `chart_emitted` true; (b) a stale `current` (bad column) → refusal without a client call (`complete` never invoked); (c) a title with an unplotted number → the command is refused with `unplotted_number` and the envelope's `copilot.refused` says so; (d) low confidence → clarification; (e) feedback: `setDatasetTurnCopilotFeedback` flips `envelope.copilot.feedback` to `'down'` for the owner only).

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement** the seven modules, the templates text, the types/envelope field, the store feedback update, the manifest entry. System prompt (English, verbatim start): "You are the chart co-pilot for a chart drawn from the user's OWN uploaded data. You receive the dataset PROFILE, the CURRENT INSTRUCTION (what is on screen), the CURRENT CHART's series labels and x labels, the CAPABILITIES this chart offers right now, and the user's MESSAGE. You answer with ONE JSON object: `instruction` (the FULL new instruction when the DATA should change — columns, filters, series, sort, limit, aggregate, derived — carrying over everything the user did not ask to change; or null when the data stays as is), `view` (a list of view commands: form, hidden/highlighted series BY LABEL, style patch, template, title, caption, a note at a point given by series label + x label), `refused` (each request you cannot honour with a reason and the control that can), `confidence`, `reading`. You never compute or invent a number: deterministic code computes every value. A title or caption may only contain numbers that are visible on the chart. Use only the forms, style keys and templates listed under CAPABILITIES; anything else goes in `refused` with reason not_available. Requests that need a click on the chart (placing a note on a point you cannot identify) go in `refused` with reason needs_click and control notes. Write title/caption text in the language given by CAPABILITIES.lang." + the instruction rules from Task 1's prompt (copied, not referenced).

- [ ] **Step 4: Run** — `npx vitest run tests/attachments` green; `npm run typecheck` + `cd web && npm run typecheck` clean.

- [ ] **Step 5: Commit** — `git commit -m "feat(attachments): the own-data co-pilot turn — schema, prompt, label→key mapping, digit guard, respondToChartEdit + feedback store (co-pilot phase 2)"`.

---

### Task 8: The chat doorway, UI — input under the card, example chips, recipe reply, Undo/Retry/👍👎

**Files:**
- Create: `web/app/dataset-copilot-actions.ts` (the two server actions — a separate file so `dataset-actions.ts`'s import graph stays small, the `chart-edits-actions.ts` precedent), `web/lib/chart-capabilities.ts`, `web/lib/chart-copilot-reply.ts`, `web/components/chart-copilot-input.tsx`
- Modify: `web/components/user-chart.tsx`, `web/components/dataset-chat.tsx` (render replayed `edit` messages with `RecipeChips`), `web/lib/dock-visuals.ts` (`datasetMessageHasVisual` false for `edit`), `src/attachments/replay.ts` (the `edit` replay message), `web/lib/i18n/messages.ts`
- Test: `web/lib/chart-capabilities.test.ts`, `web/lib/chart-copilot-reply.test.ts`, `web/components/chart-copilot-input.test.tsx`, `web/components/user-chart-copilot.test.tsx`, `tests/attachments/replay.test.ts` (an envelope with `copilot` replays as an `edit` message, never a chart message), `web/app/dataset-copilot-actions.test.ts` (guards + ownership, mocking the db the way `dataset-actions.test.ts` does if such a test exists; else cover the guards via a root PGlite test)

**Interfaces:**
- Consumes: Task 7's `respondToChartEdit`, `setDatasetTurnCopilotFeedback`, `CopilotCommand`/`CopilotRefusal`, `CopilotCapabilities`; Task 6's `summarizeInstruction`; Task 5's card; `describeCommand` (chart-history-menu.tsx); `validateCommand`; `resolvePresentation().applicable`; `CHART_TEMPLATES`.
- Produces:

```ts
// web/app/dataset-copilot-actions.ts ('use server')
export type AdjustDatasetChartOutcome = GatedDatasetResponse | { kind: 'not_found' } | { kind: 'needs_decision'; profile: DatasetProfile };
export async function adjustDatasetChart(datasetId: number, rawThreadId: unknown, rawTargetTurnId: unknown, message: string, requestId: string, rawCurrent: unknown, rawCapabilities: unknown): Promise<AdjustDatasetChartOutcome>;
// same guards as askDataset (guardPositiveInteger on ids, guardQuestion(message) — 500 chars, guardRequestId; export those guards from dataset-actions.ts or copy them), ownership via validateDatasetThreadOwnership, getDataset, needs_decision/ready gates, then chargeAndRunDataset(db, userId, requestId, () => respondToChartEdit(db, { …, llmOptions: { client: new AnthropicLlmClient() }, summarize: (i) => summarizeInstruction(i, dataset.profile, lang) })); lang from the validated capabilities.
export async function submitCopilotFeedback(rawTurnId: unknown, vote: 'up' | 'down'): Promise<{ ok: boolean }>;   // → setDatasetTurnCopilotFeedback
// src/attachments/replay.ts
| { role: 'assistant'; kind: 'edit'; text: string; commands: CopilotCommand[]; refused: CopilotRefusal[]; targetTurnId: number; turnId: number }
// an envelope with `copilot` set replays as this message (text: envelope.text; commands/refused/targetTurnId from envelope.copilot) — NOT as a chart message
// chart-capabilities.ts (pure)
export function ownDataCapabilities(input: { spec: PlottableSpec; form: ChartForm; seriesCount: number; applicable: ReadonlySet<PresentationKey>; lang: Lang }): CopilotCapabilities;
export interface ExampleChip { label: string; message: string }
export function exampleChips(input: { instruction: ClientChartInstruction; profile: DatasetProfile; spec: UserChartSpec; state: ChartDocState; lang: Lang }): ExampleChip[];  // exactly three, deterministic; see rules
// chart-copilot-reply.ts (pure)
export interface AppliedChip { command: ChartCommandParams; label: string; icon: 'data' | 'form' | 'series' | 'style' | 'template' | 'title' | 'caption' | 'note'; opens: 'data' | 'style' | 'form' | 'notes' | 'none' }
export function acceptReply(commands: CopilotCommand[], ctx: CommandContext, lang: Lang): { applied: AppliedChip[]; dropped: number };   // parseCommandLog-style shape check + validateCommand; label via describeCommand(makeCommand(cmd,'chat'), lang)
export function refusalLine(item: CopilotRefusal, lang: Lang): string;   // "<request>: <reason sentence> <control hint>" — every piece from messages.ts, request echoed as plain text
// chart-copilot-input.tsx
export function ChartCopilotInput(props: {
  lang: Lang; busy: boolean; examples: ExampleChip[];
  reply: { applied: AppliedChip[]; refused: CopilotRefusal[]; turnId: number | null; netCost: number | null; commandIds: string[]; message: string } | null;
  error: string | null;
  onSend: (message: string) => void; onUndoReply: (commandIds: string[]) => void; onRetry: (message: string) => void;
  onFeedback: (turnId: number, vote: 'up' | 'down') => void; onOpen: (target: AppliedChip['opens']) => void;
}): ReactNode;
export function RecipeChips(props: { applied: { label: string; icon: AppliedChip['icon'] }[]; refused: CopilotRefusal[]; lang: Lang; onOpen?: (target: AppliedChip['opens']) => void }): ReactNode;  // also used by DatasetChat for replayed edit messages (labels there come from describeCommand over the stored commands)
```
**Example-chip rules** (three, in this priority, deterministic, digit-free labels): (1) if `aggregate === null` and some column has a `distinct` list and y[0] is numeric → "Totaal per <that column's header>" / "Total per <header>" (message = the same words); (2) if `spec.series.length > 1` → "Zet <label of the series with the highest last non-null value> in de schijnwerper" / "Spotlight <label>"; else if `kind === 'bar'` → "Hoogste eerst" / "Highest first"; (3) "Maak de kop korter" / "Make the title shorter" when `state.title !== null`, else "Geef de grafiek een kop" / "Give the chart a title". Fill from a fixed fallback list (`"Maak er een staafdiagram van"` / `"Make it a bar chart"`, `"Verberg het raster"` / `"Hide the grid"`) until three.

**Icons** (lucide, same as the panel rows / history menu): data `Table2`, form `LayoutGrid`, series `Eye`, style `SlidersHorizontal`, template `LayoutTemplate`, title `Heading`, caption `Text`, note `MessageSquare`. A chip click calls `onOpen(opens)`; the card maps `data` → open the Data panel, `style` → open the Style panel, `form` → focus the form tablist, `notes` → focus the notes strip, `none` → nothing.

**Card wiring** (`user-chart.tsx`, only with `edit`): `onSend(message)` → `busy`, `requestId = crypto.randomUUID()`, `capabilities = ownDataCapabilities(...)`, `adjustDatasetChart(edit.datasetId, edit.threadId, edit.turnId, message, requestId, state.instruction, capabilities)`; on `ok`: cache `envelope.chart` under its instruction key BEFORE dispatching (so the `setInstruction` effect hits the cache — no second render fetch), `acceptReply(envelope.copilot.commands, ctx, lang)` where `ctx.spec` is the NEW chart's plottable spec, dispatch each applied command with source `'chat'` (record the minted ids via a `dispatchCommandWithId` variant that returns the id — add `dispatch` returning `string` in `use-chart-history.ts`; existing callers ignore the return), set `reply` (netCost from the gate result); on `insufficient_credits`/`unauthenticated`/`not_found`/`duplicate_request`/clarification/refusal envelopes → `error` line (i18n) or, for clarification/refusal envelopes, show `envelope.text` as the reply's message with no chips. `onUndoReply(ids)`: `let n = 0; for (let i = history.past.length - 1; i >= 0 && ids.includes(history.past[i]!.command.id); i--) n++; for (; n > 0; n--) undo();`. `onRetry` = `onSend(reply.message)`. `onFeedback` → `submitCopilotFeedback`. Placement: directly under the caption, above the notes strip; on `< sm` the input collapses to a chip "Pas deze grafiek aan" that expands it.

- [ ] **Step 1: Failing tests** — `chart-capabilities.test.ts` (forms exclude line for a bar spec with one series per `lineFormAllowed`; presentationKeys = applicable; the three chips for four state shapes; every label digit-free); `chart-copilot-reply.test.ts` (an invalid command is dropped and counted; a `setInstruction` without profile in ctx is dropped; labels come from `describeCommand`; `refusalLine` composes request + reason + hint in nl and en); `chart-copilot-input.test.tsx` (placeholder "Pas deze grafiek aan"; three example chips send their message; the send button disabled while busy/empty; a reply renders applied chips with icons + one line per refused item; Undo calls `onUndoReply` with the ids; 👍 calls `onFeedback(turnId,'up')` once and then disables both; Retry re-sends); `user-chart-copilot.test.tsx` (mock `adjustDatasetChart` to resolve a chart + `copilot.commands: [setInstruction(sum), setForm(bar)]`: after sending, the plot is a BarChart, the Data panel's aggregate select shows "Som", the history menu lists two chat-sourced entries, "Ongedaan maken (dit antwoord)" reverts both; `renderDatasetInstruction` was NOT called; the whole-card digit scan still passes).

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement**; i18n `chart.copilot.*`: `placeholder` ("Pas deze grafiek aan" / "Adjust this chart"), `send`, `busy`, `undoReply` ("Dit antwoord ongedaan maken" / "Undo this reply"), `retry`, `thumbsUp`/`thumbsDown`, `cost` ("Kostte {n} credits" — the ONE digit-bearing string, rendered outside the export container like notes), `reason.not_available` ("kan deze grafiek niet" / "is not something this chart offers"), `reason.not_on_this_chart` ("staat niet op deze grafiek" / "is not on this chart"), `reason.needs_click` ("vraagt een klik" / "needs a click"), `reason.unplotted_number` ("bevat een getal dat niet in de grafiek staat" / "contains a number that is not on the chart"), `reason.invalid` ("kon niet worden toegepast" / "could not be applied"), `hint.notes` ("Notities: klik op een punt in de grafiek." / "Notes: click a point on the chart."), `hint.style` ("Opmaak: open het paneel Opmaak." / "Style: open the Style panel."), `hint.data` ("Data: open het paneel Data." / "Data: open the Data panel."), `hint.form` ("Weergave: kies een vorm boven de grafiek." / "View: pick a form above the chart."), `hint.none` (""), `dropped` ("Eén onderdeel kon niet worden toegepast." / "One item could not be applied." — plural variant `droppedMany`), `error.insufficient` etc. (reuse `datasetChat.*` keys where the text is identical).

- [ ] **Step 4: Run** — `cd web && npx vitest run` green; typecheck clean.

- [ ] **Step 5: Commit** — `git commit -m "feat(chart): 'Pas deze grafiek aan' under the own-data card — example chips, recipe reply with panel icons, per-reply Undo/Retry/feedback (co-pilot phase 2)"`.

---

### Task 9: Hermetic fixtures, the record script, the harness flag, and the real-browser proof

**Files:**
- Create: `tests/fixtures/attachments/verkoop.csv`, `tests/fixtures/attachments/cases.ts`, `scripts/attachments-fixtures.ts`, `tests/fixtures/llm/attachments/*.json` (generated), `web/e2e/own-data-copilot.spec.ts`
- Modify: `package.json` (`"attachments:fixtures": "node scripts/attachments-fixtures.ts"`, `"attachments:record": "node --env-file-if-exists=.env scripts/attachments-fixtures.ts --record"`), `scripts/dev-harness/env.sh` + `run-next-dev.mjs` (`ATTACHMENTS_ENABLED=1`), `scripts/dev-harness/README.md` (one paragraph), `tests/attachments/fixtures.test.ts` (new: every case's fixture exists and its `requestHash` matches a freshly built request — the drift guard)

**Interfaces:**
- Consumes: `buildDatasetInstructRequest` (parse.ts), `buildCopilotRequest` (Task 7), `requestHash`, `RecordingLlmClient`/`AnthropicLlmClient` (client.ts), `buildDatasetProfile` (`ingest/profile.ts`), the CSV parser used by ingest (`ingest/csv.ts` — find its export).
- Produces:

```ts
// tests/fixtures/attachments/cases.ts
export interface InstructCase { label: string; kind: 'instruct'; csv: 'verkoop.csv'; previous: ClientChartInstruction | null; question: string; output: ChartInstruction }
export interface CopilotCase { label: string; kind: 'copilot'; csv: 'verkoop.csv'; current: ClientChartInstruction; capabilities: CopilotCapabilities; message: string; output: CopilotOutput }
export const CASES: (InstructCase | CopilotCase)[];
```
`verkoop.csv` = the `SALES` rows of Task 2 as a semicolon CSV (`Jaar;Gemeente;Omzet;Kosten` …). Cases: (1) instruct "Omzet per jaar per gemeente" → line, x c0, y [c2], seriesBy c1; (2) copilot on that chart, message "totaal per gemeente, hoogste eerst, en maak er staven van" → `instruction` = bar, x c1, y [c2], seriesBy null, aggregate sum, sort value desc; `view: [{ kind: 'setForm', form: 'bar' }]`, refused `[]`, confidence 0.95; (3) copilot "dikkere lijn en zet Amsterdam in de schijnwerper" → `instruction: null`, view `[setPresentation{lineWidth:'thick', …nulls}, setSeriesView{hiddenLabels:[], highlightedLabel:'Amsterdam'}]`; (4) copilot "voeg een kolom winst toe" → `instruction: null`, view `[]`, refused `[{ request: 'add a profit column', reason: 'not_available', control: 'data' }]`, confidence 0.9.

The script: for each case, parse the CSV with the real ingest parser → `buildDatasetProfile` → build the request with the real builder (for copilot cases build the chart via `buildUserChartSpec` to get the labels) → `requestHash` → write `tests/fixtures/llm/attachments/<hash>.json` in the `RecordedFixture` shape `{ requestHash, question: <case.label>, label, recordedAt, request, response: { outputText: JSON.stringify(case.output), model, stopReason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0 } } }`; with `--record`, wrap `new AnthropicLlmClient()` in `RecordingLlmClient` and call it instead (real spend — owner-supervised; the script prints the diff between the hand-authored and the recorded output). `fixtures.test.ts` rebuilds every request and asserts the file for its hash exists — a prompt edit without regenerating fixtures fails CI loudly.

**The Playwright spec** (`own-data-copilot.spec.ts`, serial, signed in as the harness user, Dutch): 1. go to `/`, click "Nieuwe chat", upload `tests/fixtures/attachments/verkoop.csv` through the upload control (`page.setInputFiles` on the file input `Chat` renders when `attachments.enabled`) → a dataset thread appears; 2. ask "Omzet per jaar per gemeente" → a dashed-frame card with two `.recharts-line-curve`s (the stub replays case 1); 3. fill the input with placeholder "Pas deze grafiek aan" with case 2's message, send → the card shows `.recharts-bar-rectangle`s, two recipe chips ("Data: …", "Weergave: Staaf"), the Data trigger opens a panel whose aggregate select reads "Som"; 4. press ⌘Z twice → line curves are back and the aggregate select reads "Geen"; 5. reload, reopen the thread → the card still shows the bar/sum state (persistence through `chart_edits` keyed by the turn — the PGlite harness applies every migration file, so 035 is live there). The llm-stub matches on `(model, system, question)`; the serialized request text must be byte-identical to the fixture's, which the generator guarantees.

- [ ] **Step 1:** CSV + cases + script + `fixtures.test.ts`; run `npm run attachments:fixtures` (offline) → four files; `npx vitest run tests/attachments/fixtures.test.ts` green.
- [ ] **Step 2:** the harness flag; `cd web && npx playwright test e2e/own-data-copilot.spec.ts` → green (say explicitly if Playwright/Chromium is missing locally; the session runs it in that case).
- [ ] **Step 3:** Commit — `git commit -m "test(attachments): hand-authored LLM fixtures + attachments:fixtures/record scripts; own-data co-pilot real-browser proof (co-pilot phase 2)"`.

---

### Task 10: Docs (the session does this itself, after the review gates)

- [ ] `docs/RUNBOOK.md`: extend the migration-034 supervised step to "034 + 035 in one `npm run db:migrate`"; a "WP202 go-live" addendum: `npm run attachments:record` (real spend, four calls, diff printed) before the `ATTACHMENTS_ENABLED` flip; the harness now sets the flag.
- [ ] `docs/decisions/056-chart-copilot.md`: "As built — phase 2 (session 113)": the shared-shell shape (hooks/components, not a JSX extraction), `setInstruction` + the free render action, the two-key `chart_edits`, the label→key mapping, the digit guard, what the chat may emit, the reply living in the card (thread shows the edit on replay).
- [ ] `docs/decisions/037-user-data-attachments.md`: addendum "built": D7's "v1 computes nothing" superseded by the fixed set; the exact semantics (Task 2); `LegacyUnsupportedReason`.
- [ ] `docs/open-questions.md`: #212 phase 2 built; new rows: chip click opens the panel but does not select the row (spec §4 asks for the row); streaming chips not built (one call, one reply); `count` ignores y; own-data table form has no CSV export (D11's CSV-injection note); recipe reply lives in the card, not the thread.
- [ ] `docs/08-build-plan.md`, `docs/04-architecture.md`, `docs/03-mvp-scope.md` (own-data row), `docs/05-data-rules.md` only if a rule's wording ("v1 computes nothing") is now false.
- [ ] `docs/STATUS.md` + `status-archive.md`, `lessons-learned.md`, session-114 kickoff, memory — at wrap-up per CLAUDE.md.

---

## Self-review (done while writing)

- **Spec coverage:** §3.2 own-data column (Tasks 1, 2, 6, 7, 8: everything incl. aggregate/derive, all forms, style, notes, title/caption); "new data = the instruction path re-runs" (Task 7: a full instruction from the same call); §3.3 request/response shape (Task 7 — `capabilities` + `{ commands, refused, text }` where `text` is the two narrate kinds' title/caption, digit-guarded); §4 input placement, recipe chips with panel icons, three deterministic prompts, Undo/Retry/👍👎, language follows the switch (Task 8); mobile collapse (Task 8); §5 phase 2's "seed the log from the refinement referent" (Task 5: `initialDocState(..., edit.lastInstruction)` — the card's doc state starts at the turn's own instruction); §6 contract test on the own-data card (Task 6), executor fixture (Task 2), Playwright type→chips→panel→⌘Z (Task 9); "chat edits never write audit rows" — they write `dataset_turns`, this tier's own record, never `audit_answers`; benchmark untouched. NOT in this plan (documented as open rows in Task 10): streaming chips; chip click selecting the exact panel row; the chart-fit scorer (phase 5); CBS tier (phase 3).
- **Type consistency:** `ChartEditsKey` `{ kind: 'answer' | 'turn'; id }` everywhere; `setInstruction { instruction, summary }`; `CommandContext.profile`; `UserChartEditContext { datasetId, threadId, turnId, profile, lastInstruction }`; `CopilotCommand`/`CopilotRefusal` declared in `types.ts` (Task 3) and reused by Task 7/8; `adjustDatasetChart(datasetId, rawThreadId, rawTargetTurnId, message, requestId, rawCurrent, rawCapabilities)`; `renderDatasetInstruction(datasetId, rawInstruction)`; `MIN_INSTRUCTION_CONFIDENCE` reused.
- **Placeholders:** none; every UI task names the exact keys, attributes and test ids the tests assert.
- **Owner steers honoured:** cheapest mechanism first (the Data panel is deterministic; one cheap-tier call only for the typed doorway; free render action); own data = full freedom; CBS untouched; "Competitor G" only; plain-language docs in Task 10.

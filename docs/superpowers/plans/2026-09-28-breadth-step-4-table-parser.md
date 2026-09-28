# Breadth step 4 — table-scoped parser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** For ONE CBS table, turn a reader's question into a validated closed choice: which of the table's measures,
which member per breakdown (or "not named", or "named but not in the list"), which period, which region names, which
registered derivation. The model can only pick from the table's own lists; everything it returns is checked in code.
Not wired to chat (step 5). No live LLM call in this step — the recording + calibration run happens after 2026-10-01,
owner-supervised.

**Architecture:** New module `src/answer/table-parse/` (parallel to `src/answer/intent/`, same LLM harness, same
fixture mechanism). Three parts: (1) a pure **input builder** from the adapter's `CbsTableSchema` + code lists → a
`TableParseSchema` (numeric measures, classified dimensions, breakdown member lists pre-filtered deterministically when
long, period grains, region presence); (2) **prompt + output schema + allowlist validator + request builder** modelled
on `src/ingestion/onboarding-fit.ts` (the closest template: a closed choice against one table's own codes); (3) a
**bridge** to step 3's `resolveBreakdowns` and a **labelled eval set + eval script** with a zero-spend `--dry-run`.

**Tech Stack:** TypeScript, zod, vitest.

**Spec:** [docs/superpowers/specs/2026-09-28-breadth-any-cbs-table-design.md](../specs/2026-09-28-breadth-any-cbs-table-design.md)
(D2, D3, D7; step 4). ADR [062](../../decisions/062-breadth-table-lane-slice-cache.md).

## Global Constraints

- Branch `breadth-step-4` from `main`. Implementers never push, merge, touch `.env`, use `git stash`, call a real LLM
  (no `AnthropicLlmClient`, no `--record`, no `ANTHROPIC_API_KEY`), or touch a live DB. Live **CBS metadata** fetches
  (free, no LLM) are allowed only in Task 1's extraction script.
- **Closed choice, hard allowlist (principle a, R7):** the output may only contain a measure code from the table's
  NUMERIC measures or `geen`; for each offered breakdown dimension exactly one of: a member code from the list offered
  for that dimension, `niet_genoemd`, or `anders`; dimension names exactly the offered breakdown dimensions, each once.
  Anything else throws `TableParseValidationError` — never a partial result, never a repaired guess.
- **`anders` exists because of the pre-filter:** when a long member list is cut down by text match, the member the
  reader named may be missing. The model must then answer `anders` (the question names something in this dimension that
  is not in the list), and the bridge turns `anders` into a question for that dimension — NEVER into the CBS total. A
  silent total where the reader named a subgroup would be a wrong answer about a different population (principle c).
- **Regions are names, never codes:** the output carries region terms in the curated parser's existing shape
  (`regionTermSchema` from `src/answer/intent/schema.ts`: `{name, kind}`); resolution to CBS codes stays in the existing
  deterministic resolver (step 5). Region terms on a table with no geo / geo-like dimension → throw.
- **Periods and derivations reuse the curated vocabulary:** `periodSpecSchema` and the derivation enum
  (`none | difference | max | series`) from `src/answer/intent/schema.ts` — imported, not copied. Today
  `periodSpecSchema` and `regionTermSchema` are module-private there: Task 3 adds `export` to both (nothing else in that
  file changes; the curated parser's generated JSON schema and its recorded fixtures must stay byte-identical — the
  existing intent replay tests prove it). Types: `PeriodSpec`, `RegionTerm` from `src/answer/intent/types.ts`. The
  output JSON schema goes through `oneOfToAnyOf` (`src/answer/llm/json-schema.ts`) exactly like `rawParseJsonSchema`. Grain check in the
  validator: a period spec whose grain the table does not publish (e.g. a quarter on a yearly-only table) → the result
  carries `periodGrainUnavailable: true` (a refusal/clarification signal for step 5), not a throw.
- **Margins and time/geo dimensions are never offered to the model:** margins resolve by step 3's convention; time via
  the period spec; geo/geo-like via region names.
- **Prompt is static and date-free** (hash stability, ADR 012), Dutch, like the measure-fit prompt. Cheap tier: module
  constant `TABLE_PARSE_MODEL = 'claude-haiku-4-5'` (repo convention: one constant per caller), `temperature: 0`,
  `maxTokens` 1024. `TABLE_PARSE_PROMPT_VERSION = 1`, `TABLE_PARSE_SCHEMA_VERSION = 1`.
- **Confidence:** a number 0..1, range-checked in code. `DEFAULT_TABLE_PARSE_CONFIG.acceptThreshold = 0.8`, marked
  `**Assumption:**` (uncalibrated until the recording run) and mirrored in `docs/open-questions.md`.
- **Pre-filter (deterministic):** a breakdown dimension with more than `MEMBER_PROMPT_CAP = 40` members is offered as:
  its grand total (step 3's `findGrandTotal`, when one exists) + every member whose normalized title shares a
  normalized word of ≥ 4 letters with the question (lowercase, diacritics stripped, split on non-letters/digits), in
  CBS order, capped at 40; the dimension is marked `truncated` with its true member count. Dimensions with ≤ 40 members
  are offered in full.
- Existing behaviour byte-identical: no existing prompt, schema, fixture or registry byte changes (the curated intent
  parser's recorded fixtures must still replay). Only additive imports from `src/answer/intent/schema.ts`.
- 8 GB machine: one foreground vitest at a time.

---

### Task 1: Table schema fixtures (metadata only)

**Files:** Create `scripts/research/extract-tableparse-schemas.ts`; create `tests/fixtures/tableparse/schemas/<tableId>.json`.

The script fetches, live from `https://datasets.cbs.nl/odata/v1/CBS/<table>` (use the repo's CBS v4 adapter functions
if they fit — `src/cbs-adapter/` — else plain `fetch`, like `scripts/research/extract-breakdown-samples.ts`), each
table's title, dimensions (identifier, kind, title), measures (code, title, unit, decimals, description, dataType) and
every dimension's full code list (code, title; for the time dimension also Status), and writes one JSON file per table
in the adapter's own shapes (`CbsTableSchema` + `Record<dimension, CbsCode[]>`), so Task 2 can build input from them
without a network.

Tables (chosen for shape variety; each is a current table in the 2026-09-28 crawl):
`03759ned` (population: sex, age, marital status, regions), `85669NED` (emissions: `Klimaatsectoren`, 52 members → pre-filter),
`84521NED` (`Leeftijd` with two totals → ask), `85245NED` (`VoertuigType`, several totals), `83052NED` (a `Marges`
dimension), `85004NED` (renewables: `BronEnTechniek` without a grand total; a RES-region `RegioS` typed as a plain
dimension), `82883NED` (`Watergebruikers`, `T00` not first), `86116NED` (`Bedrijfsgrootte`, no total). If a table is no
longer reachable or its shape no longer matches the note, STOP and report — never edit data to fit.

Large code lists: store the full list (the pre-filter needs it); if one file exceeds 1 MB, report its size in the
report and keep it anyway unless > 5 MB (then STOP and report).

- [ ] Run the script; commit the script + fixtures: `test(table-parse): CBS schema fixtures for the table parser (breadth step 4)`.

---

### Task 2: Input builder — `src/answer/table-parse/input.ts`

**Interfaces — produces:**

```ts
export const MEMBER_PROMPT_CAP = 40;
export interface TableParseMeasure { code: string; title: string; unit: string; description: string }
export interface TableParseBreakdown {
  name: string; title: string;            // title: CBS title, or the name when CBS has none
  members: { code: string; title: string }[];   // what the model may pick (CBS order)
  truncated: boolean; totalMembers: number;
}
export interface TableParseSchema {
  tableId: string; title: string;
  measures: TableParseMeasure[];          // numeric only (dataType !== 'String')
  breakdowns: TableParseBreakdown[];      // classifyDimension === 'breakdown' only, table order
  periodGrains: PeriodGrain[];            // grains present in the time dimension's codes (parsePeriodCode), sorted JJ,KW,MM
  hasRegions: boolean;                    // any 'geo' or 'geo_like' dimension
}
export function buildTableParseSchema(schema: CbsTableSchema, codeLists: Record<string, CbsCode[]>, question: string): TableParseSchema;
export function questionWords(question: string): Set<string>;   // the pre-filter's normalization, exported for tests
```

Unknown grains in the time dimension (codes `parsePeriodCode` cannot read) are ignored for `periodGrains` (step 5's
period resolver refuses them). A table with no numeric measures or no time dimension → throw (never offered).

- [ ] Tests over the Task 1 fixtures: measure filtering (a `String` measure excluded — synthetic if no fixture has one);
  `85669NED` question "uitstoot van de landbouw" → `Klimaatsectoren` truncated, total first, contains the landbouw
  member(s), ≤ 40 members, `totalMembers` 52; a ≤ 40-member dimension offered in full; `83052NED` margins not offered;
  `85004NED` RES `RegioS` — whatever `classifyDimension` says, the builder follows it (assert the real class);
  `periodGrains` per fixture; `questionWords` diacritics/case/short-word cases.
- [ ] Run `npx vitest run tests/answer/table-parse/input.test.ts`, `npx tsc --noEmit`. Commit
  `feat(table-parse): input builder with deterministic member pre-filter (breadth step 4)`.

---

### Task 3: Prompt, output schema, validator, request — `src/answer/table-parse/parse.ts`

Model on `src/ingestion/onboarding-fit.ts` (read it first): constants, `TableParseValidationError`, zod output schema
(`z.strictObject`), `tableParseJsonSchema()`, `validateTableParseOutput(outputText, input: TableParseSchema)`,
`buildTableParseSystemPrompt()`, `serializeTableParseInput(question, input)`, `buildTableParseRequest(question, input, opts)`,
`tableParse(question, input, { client, model?, maxTokens? })`.

Output schema (version literal 1): `measureCode: string`, `breakdowns: { dimension: string; choice: string }[]`,
`period: periodSpecSchema`, `regions: regionTermSchema[]`, `derivation: <the curated enum>`, `confidence: number`,
`reading: string` (one short Dutch sentence, diagnostics only).

Validated result:

```ts
export interface TableParseResult {
  measureCode: string | null;                       // null = 'geen'
  breakdowns: Record<string, { kind: 'member'; code: string } | { kind: 'not_named' } | { kind: 'other' }>;
  period: PeriodSpec; periodGrainUnavailable: boolean;
  regions: RegionTerm[]; derivation: IntentDerivation;
  confidence: number; reading: string;
}
```

Prompt content (Dutch, static): the job (pick from the lists only, copy codes verbatim); per breakdown: a member only
when the question names it or clearly means it, `niet_genoemd` when the question says nothing about that dimension,
`anders` when the question names something in that dimension that is not in the list (mention that long lists are
shortened); `geen` when no measure measures what the question asks (stock vs flow vs price vs index vs percentage, as in
the measure-fit prompt); regions as names with kind, only when the table has regions; period in the given period
format; honest confidence. Serialization: question, table id + title, numbered measures (code, unit, title, condensed
description ≤ 240 chars — reuse the measure-fit condense approach), each breakdown (name, title, members as
`code — title`, and "(ingekort: N van M)" when truncated), available grains, whether regions exist.

- [ ] Tests (stub `LlmClient` returning canned JSON — no real LLM): every allowlist rule throws (unknown measure code,
  unknown dimension, missing dimension, duplicate dimension, member not in the OFFERED list — including a real member
  that the pre-filter cut, confidence outside 0..1, invalid JSON, schema violation, regions on a region-less table);
  `geen` → null; `niet_genoemd` / `anders` mapping; grain check both ways; request is deterministic (same input → same
  `requestHash`) and contains no date; system prompt snapshot-free but asserted to contain the three choice literals.
- [ ] Run `npx vitest run tests/answer/table-parse/parse.test.ts`, `npx tsc --noEmit`. Commit
  `feat(table-parse): closed-choice prompt + allowlist validator (breadth step 4)`.

---

### Task 4: Bridge + labelled set + eval script

**Files:** `src/answer/table-parse/bridge.ts`, `benchmark/tableparse-labelled-set.json`, `scripts/tableparse-eval.ts`,
`package.json` scripts `tableparse:eval` / `tableparse:record`, tests.

Bridge:

```ts
/** Turns a parse into step 3's `named` input. `other` on any dimension → ask that dimension with its FULL member list
 *  (never the total). Member codes are re-checked against the table's full code list. */
export function namedFromParse(parse: TableParseResult, input: TableParseSchema, fullDims: BreakdownDimension[]):
  | { ok: true; named: Record<string, string> }
  | { ok: false; askDimension: string };
```

Labelled set: ~30 cases over the Task 1 tables, each `{ id, table, question, expect: { measureCode | 'geen', breakdowns:
{dim: code | 'niet_genoemd' | 'anders'}, periodKind, regions: [names] } }`: at least 4 `geen` cases (a measure the
table does not have), 4 `niet_genoemd` cases that must fall to the total, 3 `anders` cases (a subgroup the pre-filter
cuts), 3 cases on the two-totals / no-total dimensions, 2 region cases, 2 period-grain-unavailable cases. Every expected
code must exist in the fixture (a test asserts this).

Eval script: modes `--dry-run` (default for this step: builds every request from the fixtures, prints per case the
request hash, the serialized prompt size in characters and a rough token estimate (chars / 3.5), and the total — zero
spend, no client), `--replay` (ReplayLlmClient over `tests/fixtures/llm/tableparse/`), `--record` (RecordingLlmClient —
**never run in this step**; the script refuses `--record` unless `TABLEPARSE_RECORD_OK=1` is set, so it cannot run by
accident). Replay/record score each case (measure, each dimension, period kind, regions) and write
`benchmark/tableparse-calibration-report.json` (only in record/replay).

- [ ] Tests: bridge (`other` → ask with full list; member re-check; `not_named` omitted from `named`); labelled-set
  integrity (codes exist; each case's table has a fixture); `--dry-run` runs in a test over the set without a client.
- [ ] Run the three test files, `npx tsc --noEmit`, `npm run tableparse:eval -- --dry-run` (report its totals). Commit
  `feat(table-parse): bridge to the breakdown resolver + labelled set + eval script (breadth step 4)`.

---

### Task 5: Controller — measure, verify, merge

Dry-run over the labelled set (zero spend): record the largest prompt and the total estimated tokens for the eventual
recording run (to size the post-2026-10-01 spend for the owner). Full verification block, `/code-review` LOW, final
opus review, merge (owner present), docs (ADR 062 as-built step 4, STATUS, build plan, open-questions: the threshold
assumption + the recording run as an owner-supervised step after 2026-10-01).

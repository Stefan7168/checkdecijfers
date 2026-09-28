# Breadth step 4b — settle the table parser before its recording run

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the four "settle before recording" items of [#339](../../open-questions.md) so the owner-supervised
recording run (after 2026-10-01) records the final prompt once: (1) CBS **measure groups** reach the prompt, so measures
titled only "Seizoengecorrigeerd" become distinguishable; (2) version constants bumped; (3) place names the reader types
with a suffix/prefix ("Groningen (PV)", "provincie Groningen") match; (4) region-coded members the reader names are
always offered by the pre-filter. Zero AI spend; nothing wired to chat.

**Architecture:** The CBS adapter gains `CbsMeasure.groupPath` (CBS `MeasureGroups` titles, root → leaf, via
`MeasureGroupId` / `ParentId`). The table parser shows it and uses it in the duplicate-measure guard. Place matching gets
one shared normalizer for the reader's side.

**Spec:** [docs/superpowers/specs/2026-09-28-breadth-any-cbs-table-design.md](../specs/2026-09-28-breadth-any-cbs-table-design.md);
ADR [062](../../decisions/062-breadth-table-lane-slice-cache.md) (as built — step 4); [#339](../../open-questions.md).

## Global Constraints

- Branch `breadth-step-4b` from `main`. Implementers never push, merge, touch `.env`, use `git stash`, call an LLM, run
  `--record`, or touch a live DB. Live **CBS metadata** fetches (free) only where a task says so.
- **Byte-identical existing behaviour:** the schema fingerprint (name + kind + measure codes), `cbs_tables.units`
  (built by `unitsFromMeasures`, which copies named fields only), stored registry rows, and every curated prompt/fixture
  stay unchanged. `groupPath` is carried in memory only; it is never persisted by this plan.
- `groupPath` is CBS's own titles verbatim, `[]` when CBS has no group for the measure or publishes no `MeasureGroups`
  (never invented — principle c). A `MeasureGroupId` that points at a missing group → the path stops there (no throw).
  A `ParentId` cycle → stop at the first repeat (no infinite loop).
- Measure groups in the prompt: `groep: <root> › … › <leaf>` on the measure's line; the measure's own title unchanged.
- The duplicate-measure guard's fingerprint becomes (groupPath, title, unit as displayed, condensed description).
- Version constants: `TABLE_PARSE_PROMPT_VERSION = 2`, `TABLE_PARSE_SCHEMA_VERSION = 2` (the output's version literal
  and the prompt's "version is altijd …" line move together).
- Reader-side place normalization: `baseLabel` (strip a trailing parenthetical), then strip one leading kind word
  (`provincie`, `gemeente`, `regio`, `landsdeel`, case-insensitive), then `normalizeRegionName` (which already applies
  `REGION_NAME_ALIASES`). Used by the validator's place matching and the pre-filter's place matching.
- 8 GB machine: one foreground vitest at a time.

---

### Task 1: Adapter — measure groups

**Files:** `src/cbs-adapter/types.ts` (`CbsMeasure.groupPath: string[]`), `src/cbs-adapter/parse-v4.ts` (parse
`MeasureCodes.MeasureGroupId` + a new `parseMeasureGroups` for `MeasureGroups` rows `{Id, Title, ParentId}`),
`src/cbs-adapter/odata-v4.ts` (fetch `${BASE}/${tableId}/MeasureGroups` alongside `MeasureCodes`; an HTTP 404 or an
empty list → no groups; any other failure behaves like the existing metadata fetches), the Eurostat adapter
(`groupPath: []`), every `CbsMeasure` construction the type checker flags (tests included).

Hermetic tests: follow how `tests/ingestion/adapter.test.ts` (or the adapter's own tests) feed recorded CBS JSON; add
a small committed `MeasureGroups` fixture for one table (80590ned's real rows, fetched once live and trimmed to what the
test needs — record the fetch date in the fixture) and assert: `D002308` → `['Beroepsbevolking']`; a two-level group
resolves root → leaf (use a real nested case from 80590ned's list if present, else a synthetic parse test); missing
group id → `[]`; cycle → terminates; no `MeasureGroups` → every measure `[]`; `computeFingerprint` for an existing
fixture unchanged (pin one value); `unitsFromMeasures` output unchanged for a measure with a group path.

- [ ] TDD; run the adapter tests, `tests/ingestion`, `tests/eurostat-adapter`, `npx tsc --noEmit`. Commit
  `feat(adapter): carry CBS measure groups (breadth step 4b)`.

---

### Task 2: Parser — groups in the prompt + guard; fixtures refreshed; versions

**Files:** `scripts/research/extract-tableparse-schemas.ts` (re-run live; it reuses the adapter, so fixtures gain
`groupPath`), `tests/fixtures/tableparse/schemas/*.json`, `src/answer/table-parse/{input,parse}.ts`,
`benchmark/tableparse-labelled-set.json`, tests.

- `TableParseMeasure.groupPath: string[]`; serialization adds the `groep:` line when non-empty; the guard fingerprint
  includes it; versions → 2 (constants + output literal + prompt line).
- Re-run the extraction script (same 10 tables). STOP and report if any table's dimensions/measure codes changed.
- Labelled set: allow `acceptableMeasureCodes: string[]` on a case (the eval scores a pick in that set as correct) for
  questions where several measures are equally faithful and the answer names the measure it used — e.g. 80590ned
  "werkloosheid in maart 2024" → the seasonally adjusted and non-adjusted unemployed measures of the same group. Update
  `ambiguous-arbeid-werklozen` accordingly if the guard no longer fires (report which way it went, with the fixture
  facts). Keep at least one case where the guard still fires, or state with evidence that none of the 8 tables has one.
- Tests: serialization shows groups; guard passes for same-title measures in different groups, still throws for truly
  identical ones (synthetic); version literal 2 accepted, 1 rejected; labelled-set integrity accepts the new field.

- [ ] Run `tests/answer/table-parse/`, `npx tsc --noEmit`, `npm run tableparse:eval -- --dry-run` (report totals).
  Commit `feat(table-parse): measure groups in the prompt + guard, versions 2 (breadth step 4b)`.

---

### Task 3: Reader-side place normalization + pre-filter place matching

**Files:** `src/answer/table-parse/{parse,input}.ts` (or a small shared helper module inside `table-parse/`), tests.

- One exported helper `readerPlaceKey(name: string): string` per the Global Constraints normalization; the validator
  compares `readerPlaceKey(regionName)` with the member side's existing key.
- Pre-filter: for a truncated dimension, also include every REGION-CODED member (the parser's existing
  `REGION_MEMBER_CODE` rule) whose place key occurs in the question as a whole word / word sequence after the same
  normalization (so "Den Haag" offers "'s-Gravenhage", "provincie Groningen" offers all Groningen members), in CBS order,
  within the 40 cap, total first.
- Tests (real fixture 85004NED + synthetic): "Groningen (PV)" and "provincie Groningen" match; "Den Haag" matches an
  "'s-Gravenhage" member; a question naming "Groningen" on 85004NED offers all three Groningen members even when the
  generic word rule would miss one; non-region-coded members are never added by this rule.

- [ ] Run `tests/answer/table-parse/`, `npx tsc --noEmit`, the dry-run. Commit
  `feat(table-parse): reader-side place normalization + place-aware pre-filter (breadth step 4b)`.

---

### Task 4: Controller — verify, review, merge, docs

Full verification block, `/code-review` LOW, final review, merge (owner present), docs (ADR 062 as-built step 4b,
#339 items 1–4 closed, STATUS, build plan). The recording run itself stays an owner-supervised step after 2026-10-01.

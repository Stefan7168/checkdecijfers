# Eurostat E2a (country-level answers), steps 1–4 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Build, dark, the code half of E2a: a question naming a European country CBS doesn't cover gets a
dry-run-verified clarification chip offering a reviewed Eurostat "sibling" measure; clicking it answers
entirely from Eurostat, with Dutch country names, the right source wording, and a refusal for trends across a
Eurostat break-in-series (`b`) flag.

**Architecture:** Pure code, no migration, no prompt change, no live spend. A code-level sibling map
(`src/sources/eurostat-siblings.ts`) ships EMPTY in production — the three owner-approved pairs (unemployment,
inflation, GDP growth) are added in step 5 together with registering their tables, so nothing a reader can
reach changes in this PR. Tests inject a sibling map and hand-insert a synthetic Eurostat table (the
`tests/answer/eurostat-explorer-wiring.test.ts` precedent).

**Tech Stack:** TypeScript (Node 24, `--experimental-strip-types` style `.ts` imports), vitest, PGlite
hermetic test DB (ADR 009).

**Spec:** [docs/superpowers/specs/2026-09-23-eurostat-e2a-country-answers-design.md](../specs/2026-09-23-eurostat-e2a-country-answers-design.md)
(approved by the owner 2026-09-23, session 125 — read §2–§5 before starting any task).

## Global Constraints

- **Never run more than one vitest process on this machine at a time** (8 GB machine; RUNBOOK). Run only the
  test files your task touches (`npx vitest run <files>`); the full suite is the parent session's job.
- Principle (c): the source switch is ALWAYS a reader-clicked chip, never automatic. A question that CBS can't
  resolve and Eurostat can must produce a clarification, never an answer.
- One source per answer: a region list is resolved against ONE table. Never answer part of a list from CBS
  and the rest from Eurostat.
- R7: the chip goes through the existing `buildClickOptions` dry-run (`src/answer/intent/policy.ts`) — never
  offered unless its intent is proven servable.
- No change to any LLM prompt, prompt-embedded list, or recorded fixture (a prompt-byte change shifts the
  request hash — `feedback_llm_prompt_embedded_lists_hash_risk`). If you find you need one, STOP and report.
- No DB migration. No edit to `src/registry/defaults.ts` in this plan.
- Backend-built reader text is Dutch (CLAUDE.md conventions). Exact copy, owner-approved:
  - Clarification question: `Voor dit antwoord gebruiken we Eurostat: {definitionLabel}. Eurostat hanteert één definitie voor alle landen; die kan afwijken van de CBS-definitie.`
  - Chip label: `Toon de Eurostat-cijfers`
- Do NOT push, open PRs, merge, or touch `main`. Commit on the task branch only.
- English for code/comments. Mark assumptions inline as `**Assumption:**`.

---

### Task 1: Dutch country names + source-aware region resolution

**Files:**
- Create: `src/sources/eurostat-geo-names.ts`
- Modify: `src/answer/intent/resolve.ts` (`KIND_CODE_PREFIX` ~l.40, `resolveRegions` ~l.159–248)
- Modify: the place where a result cell's region LABEL is attached for display (find it: `grep -rn "regionLabel" src/query`) — for `eurostat:` tables, display the Dutch name.
- Test: `tests/sources/eurostat-geo-names.test.ts`, `tests/answer/eurostat-region-resolve.test.ts`

**Interfaces:**
- Produces:
  - `export const EUROSTAT_GEO_NAMES_NL: Readonly<Record<string, { display: string; aliases: readonly string[] }>>`
  - `export function eurostatGeoCodeForDutchName(name: string): string | null` — normalises with the same
    `normalizeRegionName` resolve.ts uses (import it; if it is not exported, export it).
  - `export function dutchDisplayNameForGeo(code: string): string | null`
  - `export function isEurostatCountryOrAggregateCode(code: string): boolean` (membership of `EU_EFTA_STAND_IN_GEO_CODES`).

- [ ] **Step 1: Failing test for the list's completeness and lookups**

```ts
import { describe, expect, it } from 'vitest';
import { EU_EFTA_STAND_IN_GEO_CODES } from '../../src/eurostat-adapter/jsonstat.ts';
import { EUROSTAT_GEO_NAMES_NL, eurostatGeoCodeForDutchName, dutchDisplayNameForGeo } from '../../src/sources/eurostat-geo-names.ts';

describe('Dutch Eurostat geo names', () => {
  it('names every code the adapter can emit, and nothing else', () => {
    expect(new Set(Object.keys(EUROSTAT_GEO_NAMES_NL))).toEqual(new Set(EU_EFTA_STAND_IN_GEO_CODES));
  });
  it.each([
    ['Duitsland', 'DE'], ['belgie', 'BE'], ['België', 'BE'], ['Griekenland', 'EL'],
    ['de EU', 'EU27_2020'], ['Europese Unie', 'EU27_2020'], ['de eurozone', 'EA20'], ['Nederland', 'NL'],
  ])('%s -> %s', (name, code) => expect(eurostatGeoCodeForDutchName(name)).toBe(code));
  it('refuses a country outside the list', () => {
    expect(eurostatGeoCodeForDutchName('Japan')).toBeNull();
    expect(eurostatGeoCodeForDutchName('de VS')).toBeNull();
  });
  it('display name is Dutch', () => expect(dutchDisplayNameForGeo('DE')).toBe('Duitsland'));
  it('no alias maps to two codes', () => {
    const seen = new Map<string, string>();
    for (const [code, e] of Object.entries(EUROSTAT_GEO_NAMES_NL))
      for (const a of [e.display, ...e.aliases]) {
        const k = a.toLowerCase();
        expect(seen.get(k) ?? code, `alias ${a}`).toBe(code);
        seen.set(k, code);
      }
  });
});
```

- [ ] **Step 2:** `npx vitest run tests/sources/eurostat-geo-names.test.ts` → FAIL (module missing).
- [ ] **Step 3: Implement the list.** Every code in `EU_EFTA_STAND_IN_GEO_CODES` (27 EU + IS/LI/NO/CH +
  `EU27_2020`, `EA`, `EA19`, `EA20`, `EFTA`). Display names are the standard Dutch names (België, Bulgarije,
  Tsjechië, Denemarken, Duitsland, Estland, Ierland, Griekenland, Spanje, Frankrijk, Kroatië, Italië, Cyprus,
  Letland, Litouwen, Luxemburg, Hongarije, Malta, Nederland, Oostenrijk, Polen, Portugal, Roemenië, Slovenië,
  Slowakije, Finland, Zweden, IJsland, Liechtenstein, Noorwegen, Zwitserland; `EU27_2020` "de EU (27 landen)"
  with aliases EU, de EU, Europese Unie, EU-27, EU27; `EA20` "de eurozone (20 landen)" with aliases eurozone, de
  eurozone, eurogebied, het eurogebied; `EA`/`EA19` distinct displays ("het eurogebied (wisselende
  samenstelling)", "de eurozone (19 landen)") with NO bare "eurozone" alias so aliases stay unique; `EFTA`
  "de EFTA-landen" alias EFTA). Add accent-free variants (Belgie, Tsjechie, Kroatie, Italie, Roemenie, Slovenie,
  IJsland→Ijsland) and English-in-Dutch-use variants only where unambiguous (Tsjechische Republiek,
  Czechië). Match via `normalizeRegionName` on both sides.
- [ ] **Step 4:** re-run → PASS.
- [ ] **Step 5: Failing resolver test.** In `tests/answer/eurostat-region-resolve.test.ts`, use
  `createTestDb()` (`tests/helpers/pglite-db.ts`) and hand-insert, mirroring
  `tests/answer/eurostat-explorer-wiring.test.ts`: a `cbs_tables` row `eurostat:e2a_test_unemp` (source
  `eurostat`), its `dimension_labels` for the region dimension with ENGLISH labels (`DE`→"Germany",
  `NL`→"Netherlands", `BE`→"Belgium", `EU27_2020`→"European Union - 27 countries (from 2020)"), a
  `canonical_measures` row `eu_test_unemployment` pointing at it, and 2 years of observations for DE/NL/BE.
  Then assert via `resolveCandidate(db, raw(...), REF)`:
  - regions `[{ name: 'Duitsland', kind: 'land' }]` → resolves to `['DE']` (proves the kind filter no longer
    demands the `NL` prefix on a Eurostat table);
  - `[{ name: 'Duitsland', kind: 'onbekend' }, { name: 'Nederland', kind: 'land' }]` → `['DE','NL']`;
  - `[{ name: 'Germany', kind: 'onbekend' }]` → `['DE']` (English table label still works);
  - `[{ name: 'Japan', kind: 'land' }]` → failure `region_unknown`.
  Read the exact region dimension name / column set the resolver queries (resolve.ts ~l.184) and the
  observations columns from migrations before writing the inserts.
- [ ] **Step 6:** run → FAIL.
- [ ] **Step 7: Implement in `resolveRegions`:** when `sourceKeyForTableId(tableId) !== CBS_SOURCE_KEY`,
  (a) `kind: 'land'` filters by `isEurostatCountryOrAggregateCode` instead of the `NL` prefix; any other
  non-`onbekend` kind (gemeente/provincie/landsdeel) matches nothing on a Eurostat table; (b) before label
  matching, try `eurostatGeoCodeForDutchName(term.name)` — if it returns a code present in the table's labels,
  that's the match. CBS tables: behaviour byte-identical (existing `tests/answer/intent-resolve.test.ts` must
  stay green unchanged).
- [ ] **Step 8: Display.** Where the region label is attached to result cells / answer text for display, use
  `dutchDisplayNameForGeo(code) ?? label` for `eurostat:` tables. Add one assertion to the Step-5 test file (or
  the nearest query test) that a Eurostat result for `DE` carries "Duitsland".
- [ ] **Step 9:** run both new test files + `tests/answer/intent-resolve.test.ts` → PASS.
- [ ] **Step 10: Commit** `feat(e2a): Dutch Eurostat country names + source-aware region resolution`.

---

### Task 2: Sibling map + `other_source_available` clarification chip

**Files:**
- Create: `src/sources/eurostat-siblings.ts`
- Modify: `src/answer/intent/types.ts` (reason union), `src/answer/intent/resolve.ts` (`resolveCandidate`
  ~l.958 and the `region_unknown` path), `src/answer/intent/policy.ts` (`failureQuestion` ~l.48,
  `clarificationFromFailure` ~l.130)
- Test: `tests/answer/eurostat-sibling-clarification.test.ts`

**Interfaces:**
- Consumes: Task 1's resolver behaviour.
- Produces:
  - `export const EUROSTAT_SIBLINGS: Readonly<Record<string, string>> = {}` — CBS canonical key → Eurostat
    canonical key. Ships EMPTY, with a comment: the three owner-approved pairs (unemployment → harmonised rate,
    inflation → HICP annual rate, GDP growth) are added in step 5 alongside registering their tables; each
    pair is reviewed by a person (same rule as `PERIOD_CHANGE_ELIGIBLE_KEYS`).
  - `resolveCandidate` options gain `eurostatSiblings?: Readonly<Record<string, string>>` (default
    `EUROSTAT_SIBLINGS`) so tests can inject a pair.
  - New `ResolutionFailure.reason` member `'other_source_available'`; the failure carries
    `options: ['Toon de Eurostat-cijfers']` and `optionIntents: [<the full StructuredIntent against the sibling
    measure with the resolved Eurostat codes>]`, plus a `siblingDefinitionLabel: string` field (add it to
    `ResolutionFailure` as optional).

- [ ] **Step 1: Failing tests** (same hand-inserted Eurostat table as Task 1 — extract Task 1's insert helper
  to `tests/helpers/eurostat-test-table.ts` if not already shared, and reuse it). Use the hermetic ingested DB
  (`createIngestedDb()`, which has the real CBS fixture tables) PLUS the Eurostat insert, and inject
  `eurostatSiblings: { unemployment_rate_seasonally_adjusted: 'eu_test_unemployment' }` (check the exact CBS
  key in `src/registry/defaults.ts`). Assert:
  1. `werkloosheid` + `[Duitsland]` → failure `other_source_available`, `optionIntents[0]` targets the
     Eurostat table with regions `['DE']`; **never** a resolved answer (principle c).
  2. `[Nederland, Duitsland]` → `other_source_available` with Eurostat regions `['NL','DE']` (one source
     per answer — NL comes from Eurostat too).
  3. `[Duitsland, Japan]` → `region_unknown` unchanged (a partially-resolvable list never answers half).
  4. `[Duitsland]` with `eurostatSiblings: {}` → `region_unknown` unchanged (dark in production).
  5. `[Amsterdam]` (CBS-resolvable) → normal CBS resolution, sibling never consulted.
  6. A measure with no sibling + `[Duitsland]` → `region_unknown`.
  7. Sibling key present in the map but missing from `canonical_measures` → `region_unknown` (no crash).
  8. Through the policy layer (`clarificationFromFailure` with click options enabled and a servability stub
     that returns servable): question text equals the exact owner-approved sentence with
     `{definitionLabel}` filled from the Eurostat canonical measure's `definitionLabel`; one chip labelled
     `Toon de Eurostat-cijfers`. With a servability stub returning NOT servable: no chip is offered.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement.** In `resolveCandidate`, when region resolution fails with `region_unknown` on a
  CBS table and `eurostatSiblings[candidate.canonicalKey]` names a key that exists in `canonical_measures`:
  resolve ALL region terms against the sibling's table (Task 1 logic). Only if every term resolves, build the
  sibling `StructuredIntent` (same period/derivation/everything else as the original, measure/table swapped;
  reuse the code path that builds a StructuredIntent for a normal resolution — do not hand-assemble a
  divergent shape) and return the `other_source_available` failure. Anything else → the original
  `region_unknown` failure, byte-identical. In `failureQuestion`, add the case returning the exact Dutch
  sentence. In `clarificationFromFailure`, the existing `optionIntents` → `buildClickOptions` path must carry
  the chip (dry-run gated); confirm it needs no new branch, add one only if it does.
- [ ] **Step 4:** run new tests + `tests/answer/intent-resolve.test.ts` + any `tests/answer/*policy*` tests →
  PASS. Also `npx vitest run tests/invariants` (solo).
- [ ] **Step 5: Commit** `feat(e2a): other_source_available clarification with a dry-run-verified Eurostat chip (dark: empty sibling map)`.

---

### Task 3: Real source on the answer path + CBS-constant guards

**Files:**
- Modify: `src/answer/compose/template.ts` (`nullReasonText` ~l.17), `src/answer/respond/refusals.ts`
  (`statusSuffixNl` ~l.108) and their callers; `src/query/resolve.ts` (`NATIONAL_REGION_CODE` default
  ~l.675–688); `src/answer/respond/suggestions.ts` (`isNationalCode` ~l.185 and its uses ~l.354/441/455)
- Test: `tests/answer/eurostat-answer-wording.test.ts`

**Interfaces:**
- Produces: `nullReasonText(valueAttribute: string, sourceKey?: string)`,
  `statusSuffixNl(status: string, sourceKey?: string)` — `sourceKey` defaults to CBS (existing callers
  unchanged in behaviour); every caller that has a cell/table id in scope passes
  `sourceKeyForTableId(cell.tableId)`.

- [ ] **Step 1: Failing tests:** (a) `statusSuffixNl('p', 'eurostat')` returns Eurostat's provisional wording
  from `SOURCES.eurostat.provisionalDisplay`, `statusSuffixNl('Voorlopig')` still returns CBS's; (b)
  `nullReasonText(':', 'eurostat')` returns Eurostat's null-reason label; (c) an end-to-end answer over the
  hand-inserted Eurostat table (reuse `tests/helpers/eurostat-test-table.ts`, one observation flagged `p`)
  renders Eurostat's provisional wording, not CBS's and not none — drive it the way
  `tests/answer/eurostat-explorer-wiring.test.ts` drives `respondToIntent`; (d) a Eurostat intent with NO region
  does not get `NL01` injected (assert the query layer refuses/clarifies rather than querying `NL01`); (e) a
  Eurostat answer for `DE` does not offer a "compare with Nederland (`NL01`)" suggestion chip built against
  the CBS national code.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement.** Thread the source key through every caller (`grep -rn "statusSuffixNl\|nullReasonText" src`).
  In `src/query/resolve.ts`, apply the `NATIONAL_REGION_CODE` default only when
  `sourceKeyForTableId(tableId) === CBS_SOURCE_KEY`. In `suggestions.ts`, national-comparison suggestions are
  CBS-only (skip them for non-CBS tables). Leave `NATIONAL_TOTAL_GROUP` (whole-verification) and
  `onboarding-slice.ts` untouched but add a one-line `// E2a: CBS-only by design (spec §4.5)` comment at each.
- [ ] **Step 4:** run new test + `tests/answer` + `tests/query` (one command at a time) → PASS.
- [ ] **Step 5: Commit** `feat(e2a): answer path uses the result's real source; CBS-only national defaults guarded`.

---

### Task 4: Refuse a trend across a Eurostat break in series (`b` flag)

**Files:**
- Modify: `src/query/derivations.ts` (`deriveDirection` ~l.193, `deriveFirstLast` ~l.296)
- Test: `src/query/derivations.test.ts` (existing in-file `cell(...)` builder pattern)

Eurostat cells carry their flag verbatim in both `status` and `valueAttribute`
(`src/eurostat-adapter/jsonstat.ts` ~l.470–495). A `b` on an observation means the series breaks between that
period and the previous one.

- [ ] **Step 1: Failing tests** (build cells with `tableId: 'eurostat:t'`, sorted periods 2019..2022):
  - direction and first_last REFUSE when any cell other than the earliest has `status: 'b'`; the reason string
    names the break (`break in series`) and the cell's resultId;
  - both SUCCEED when only the earliest cell has `b` (the break lies outside the compared range);
  - a CBS cell whose status string happens to be `'b'` is unaffected (check keys on the source, via
    `sourceKeyForTableId`).
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement** a `checkNoSeriesBreak(cells)` helper next to `checkComputable`, called by both
  derivations after their existing checks, returning `refuse(...)` on a hit. Order cells by period the same way
  each derivation already does.
- [ ] **Step 4:** `npx vitest run src/query/derivations.test.ts` → PASS.
- [ ] **Step 5: Commit** `feat(e2a): refuse a trend across a Eurostat break-in-series flag (ADR 048 D5b)`.

---

## Not in this plan (spec §6)

Step 0 (live parse recording, after 2026-10-01), step 5 (register sibling tables + fill `EUROSTAT_SIBLINGS`,
owner step), step 6 (the owner-signed flip + public wording + benchmark tasks). The ≥5 new Eurostat benchmark
tasks need step 0's recorded parses and are added then.

# Breadth step 3 — breakdown resolver Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A pure, deterministic library that — for any CBS table's breakdown dimensions a question did not name — picks CBS's own grand total when it is provably there, or returns a button question built from CBS's own members. Never a guessed default.

**Architecture:** Adapter carries each dimension's CBS title. A new module `src/query/breakdowns.ts` classifies dimensions (time / geo / geo-like / margins / breakdown), detects the grand total with a measured conservative rule, and resolves a table's unnamed breakdowns into either coordinates (+ a "stated default" list for the answer text) or one `BreakdownQuestion`. Not wired to chat (step 5).

**Tech Stack:** TypeScript, vitest.

**Spec:** [docs/superpowers/specs/2026-09-28-breadth-any-cbs-table-design.md](../specs/2026-09-28-breadth-any-cbs-table-design.md) (D3; step 3).

## Global Constraints

- Branch `breadth-step-3` from `main`. Implementers never push, merge, touch `.env`, use `git stash`, call an LLM or a live DB.
- **The total rule (measured 2026-09-28 over all 2,330 breakdown dimensions of the 1,271 current tables — do not loosen):**
  a member is a *total-like candidate* when its title starts with `Totaal` (case-insensitive, leading space allowed), OR
  its code starts with `T00`, OR its title ends with `; totaal` / `, totaal` (case-insensitive). The dimension's grand
  total is **the FIRST member**, and only when (a) the first member is a candidate AND (b) it is the ONLY candidate, or it
  is the ONLY member whose code starts with `T00`. Anything else → no total (ask). Measured traps this rule must keep
  refusing (each a test): "Type: Paar, totaal" not first (a sub-total, 26 such dims); a `T00` code that is not first
  (e.g. "A-U Alle economische activiteiten" under "Nederlandse economie totaal"); "Totaal leeftijd" + "Totaal,
  gestandaardiseerd" (two different statistics, first not `T00`); "Nederlands (totaal)" (not a candidate — a subgroup).
- **Margins convention:** a dimension named `Marges` or containing a member titled exactly `Waarde` (trimmed,
  case-insensitive) resolves to that `Waarde` member (measured code `MW00000` in 115 of 122) — never a margin member.
- **Geo-like dimension:** a non-time, non-`GeoDimension` dimension where ≥ 80% of member codes match
  `^(NL|PV|GM|LD|CR|WK|BU)\d` is handled as a region dimension (regions come from the region resolver, never the total
  rule).
- Stated defaults and button text use CBS's own titles only (`<dimension title>: <member title>`), never invented words.
- Existing behaviour byte-identical (fingerprints hash name + kind only; adding a field must not change them).
- 8 GB machine: one foreground vitest at a time.

---

### Task 1: Adapter — dimension titles

**Files:** `src/cbs-adapter/types.ts` (`CbsDimension.title: string`), `src/cbs-adapter/parse-v4.ts` (fill from `Title`,
`''` when absent), the Eurostat adapter (its own label if it has one, else `''`), every `CbsDimension` construction the
type checker flags (tests included). Tests in `tests/ingestion/adapter.test.ts`: 03759ned `BurgerlijkeStaat` →
`'Burgerlijke staat'`; `computeFingerprint` output for a fixture is unchanged (pin one existing fingerprint value).

- [ ] TDD; run `npx vitest run tests/ingestion/adapter.test.ts`, `tests/ingestion`, `tests/eurostat-adapter`, `npx tsc --noEmit`. Commit `feat(adapter): carry CBS dimension titles (breadth step 3)`.

---

### Task 2: `src/query/breakdowns.ts` — classification + total rule + resolver

**Files:** Create `src/query/breakdowns.ts`; create `tests/fixtures/cbs-breakdowns/sample.json` (see below); test
`tests/query/breakdowns.test.ts`.

**Interfaces — produces:**

```ts
export interface BreakdownMember { code: string; title: string }
export interface BreakdownDimension { name: string; title: string; kind: 'TimeDimension' | 'GeoDimension' | 'Dimension' | string; members: BreakdownMember[] }
export type DimensionClass = 'time' | 'geo' | 'geo_like' | 'margins' | 'breakdown';
export function classifyDimension(d: BreakdownDimension): DimensionClass;
export function findGrandTotal(members: BreakdownMember[]): BreakdownMember | null;   // the rule in Global Constraints
export function marginsValueMember(members: BreakdownMember[]): BreakdownMember | null;
export interface StatedDefault { dimension: string; dimensionTitle: string; code: string; memberTitle: string }
export interface BreakdownQuestion {
  dimension: string; dimensionTitle: string;
  options: BreakdownMember[];   // CBS order; at most BREAKDOWN_OPTION_CAP (12)
  totalOptions: number;         // how many members the dimension has
}
export const BREAKDOWN_OPTION_CAP = 12;
export type BreakdownResolution =
  | { ok: true; coordinates: Record<string, string>; defaults: StatedDefault[] }
  | { ok: false; question: BreakdownQuestion };
/** named: codes the question already fixed (validated upstream against the table's lists).
 *  Resolves every 'breakdown' and 'margins' dimension not in `named`; 'time', 'geo', 'geo_like' are the caller's.
 *  The FIRST unresolvable breakdown (in table order) becomes the question. */
export function resolveBreakdowns(dimensions: BreakdownDimension[], named: Record<string, string>): BreakdownResolution;
export function statedDefaultsText(defaults: StatedDefault[], lang: 'nl' | 'en'): string | null;
```

`statedDefaultsText`: null when no defaults; otherwise one line joining `<dimensionTitle>: <memberTitle>` with `; `,
prefixed `Uitgangspunt: ` (nl) / `Assumed: ` (en) — CBS titles verbatim in both languages (no translation of CBS text).

**Sample fixture** — `tests/fixtures/cbs-breakdowns/sample.json`: real member lists (code + title, CBS order, truncated
to the first 30 members with the true total count recorded) extracted from the measurement crawl for these cases,
fetched live with `node --import ./scripts/force-ipv4.mjs` or `curl` from `https://datasets.cbs.nl/odata/v1/CBS/<table>/<Dim>Codes`
(write a tiny committed script `scripts/research/extract-breakdown-samples.ts` that fetches them and writes the file):
`03759ned/Geslacht` (single first T00), `85669NED/Klimaatsectoren` (several, first only T00), `83842NED/KenmerkenVanHuishoudens`
(Type: Paar trap), `82883NED/Watergebruikers` (T00 not first), `84521NED/Leeftijd` (two totals), `83191NED/Nationaliteit`
(Nederlands (totaal)), `86116NED/Bedrijfsgrootte` (no total), `85245NED/VoertuigType` (several, first not T00 → ask), a
`Marges` dimension (find one: `grep`-free — pick any table the crawl listed with `Marges`, e.g. search the catalog via
the script's own fetch of `83052NED/Marges`), a geo-like dimension (`71476ned/Waterkwaliteitsbeheerders` or
`86211NED/AlleRegioIndelingen` truncated). If a live fetch returns a list that no longer matches the expected case, STOP
and report — never edit data to fit a test.

- [ ] Tests (each case above, asserting the exact pick or `null`); `resolveBreakdowns` over a synthetic 3-dimension
  table: all totals → ok + defaults in table order; one named + one total → only the total in defaults; a no-total
  dimension → question with ≤ 12 options + `totalOptions`; margins → the `Waarde` member, included in `defaults` (the reader sees "Marges: Waarde"); geo/geo_like/time dimensions never resolved here.
  `statedDefaultsText` nl/en exact strings.
- [ ] Run `npx vitest run tests/query/breakdowns.test.ts`, `npx tsc --noEmit`. Commit
  `feat(query): breakdown resolver — CBS grand total by a measured rule, else a button question (breadth step 3)`.

---

### Task 3: Reach check against the crawl (controller)

Re-run `scripts/research/cbs-catalog-analyze.py`-style counting with the TypeScript `findGrandTotal` over the crawl data
(a small committed script `scripts/research/breakdown-reach.ts` reading a crawl JSONL path argument) and confirm the
measured numbers (1,363 of 1,785 eligible breakdowns resolved; 576 tables no-ask / 347 ask of the eligible ones). A
mismatch → reconcile before merge. Then full verification block, `/code-review` LOW, final opus review, merge (owner
present), docs (ADR 062 as-built step 3, STATUS, build plan).

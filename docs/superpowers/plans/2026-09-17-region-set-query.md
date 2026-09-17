# Region-set query — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** answer "one measure, one period, a SET of regions" — a set given either as named regions
(already possible) or as a region CLASS (all provincies, all gemeenten, gemeenten in a provincie) —
with one validated cell per region, a ranking that is only claimed when the set is complete, and a
sorted horizontal bar chart. This is the capability [#253](../../open-questions.md) names as the
precondition for any map work.

**Architecture:** the roster comes from `dimension_labels.dimension_group` (CBS's own
`DimensionGroupId`, already ingested); `resolve.ts` puts it into the existing `regionCodes` array so
`run.ts`'s existing `region_code = any($4::text[])` fetch is reused unchanged; a new result shape
`'region_set'` carries a coverage record; a new registered derivation refuses to produce a ranking
record unless coverage is complete, which makes R9 enforce the honesty rule mechanically; the chart
builder sorts by that derivation's own `rankingResultIds`; the answer body is the deterministic
template (`templateOnly`), so no phrasing model ever sees 342 numbers.

**Tech stack:** TypeScript, Vitest, Postgres (hermetic test DB, ADR 009), Next.js/React (`web/`).
No new dependency, no migration, no new SQL primitive.

**Spec:** [docs/superpowers/specs/2026-09-17-region-set-query-design.md](../specs/2026-09-17-region-set-query-design.md)
— read it fully before Task 1; this plan argues from it and does not repeat its rationale.

## Global constraints

- **Tasks 1–8 are hermetic and autonomously buildable. Task 9 is owner-supervised** (real LLM spend:
  103 fixtures re-recorded). Nothing in Tasks 1–8 may touch `src/answer/intent/prompt.ts` or
  `src/answer/intent/schema.ts` — a single byte there invalidates 103 recorded fixtures
  (`src/answer/llm/client.ts:92`; spec §Intent shape). Tasks 1–8 drive everything with
  hand-authored `StructuredIntent`s.
- **`INTENT_SCHEMA_VERSION` stays `1`.** A bump breaks live embed tokens (`src/chart/embed-live.ts:92`)
  and in-flight pending clarifications (`src/answer/respond/validate-pending.ts:47`).
- **Never guess a roster.** `GM<pv>` group composition is verified, never assumed: an empty group
  refuses rather than falling back to a code-prefix scan (spec §Membership source).
- **Ranking honesty (RS1) is enforced by the absence of a derivation record**, never by filtering
  words out of prose.
- **Present-only discipline** (`?? …`, never `hasOwnProperty`) on every new envelope field, per
  [docs/13](../../13-envelope-presence-grammar.md), plus a manifest row (Task 7).
- **Backend tests live in the top-level `tests/` tree** mirroring `src/` (never co-located);
  `web/` tests ARE co-located. Do not mix the two.
- **Every new interface string** gets an `nl` and an `en` entry in `web/lib/i18n/messages.ts`.
- Run `npm run audit:verify` on any change touching validators or reconstruction (Task 7).

---

### Task 1 — Roster resolution from `dimension_labels.dimension_group` (hermetic)

**Files:** create `src/query/region-set.ts`; test `tests/query/region-set.test.ts`.

**Tests first:**
- `03759ned` / `RegioS` / `all_provincies` → exactly the 12 `PV` codes (verified: `PV20`…`PV31`).
- `all_landsdelen` → the 4 `LD` codes from the label table, but **empty after the slice filter**,
  because `src/ingestion/registry-seed.ts:41` loads prefixes `['NL','PV','GM']` only.
- `gemeenten_in_provincie` with parent `PV26` on `83625NED` → 42 codes; on `03759ned` → 54 codes
  (the per-table difference is the point — a global list would be wrong).
- `all_gemeenten` on `03759ned` → 835 codes, and `GM0997` ("Centraal persoonsregister",
  `dimension_group = 'OVERIG'`) is **not** among them.
- An unknown parent, or a `GM<pv>` group that comes back empty → `{ ok: false }`, never a
  prefix-scan fallback.

**Interface:** `resolveRegionSet(db, tableId, geoDimension, scope, slicePrefixes): Promise<{ ok: true;
codes: string[] } | { ok: false; reason: 'empty_roster' | 'outside_slice'; detail: string }>`.

**Invariants:** principle (c) (no guessed roster), R5 (membership is a CBS fact, not a computation).
**Done when:** the six tests pass and the function is exported from `src/query/index.ts`.

---

### Task 2 — `StructuredIntent.regionSet` + the resolver branch (hermetic)

**Files:** `src/query/types.ts` (add `RegionScope`, the present-only `regionSet` field, and the
`'region_set'` member of `ResultShape`); `src/query/resolve.ts` (region block, ~lines 535-598);
test `tests/query/region-set-resolve.test.ts`.

**Tests first:** `regionSet` + `regions` both set → `invalid_intent`; `regionSet` on a table with no
`GeoDimension` (e.g. `85224NED`) → `invalid_intent` axis `region`; `regionSet` with >1 period →
the existing one-varying-axis refusal (`resolve.ts:289-290`) still fires; a landsdeel scope →
`outside_loaded_slice`; a resolved provincie scope → `regionCodes.length === 12` and
`regionLabels` populated for all 12.

**Invariants:** ADR 011 contract (additive only, version unbumped); the one-varying-axis rule is
**not** relaxed. **Done when:** the tests pass and no existing `tests/query/*` test changes.

---

### Task 3 — The `region_set` fetch branch and the coverage record (hermetic)

**Files:** `src/query/run.ts` (the completeness loop ~line 433 and the shape assignment ~line 573);
test `tests/query/region-set-run.test.ts`.

**Tests first (all against the real hermetic ingest):**
- `all_provincies` / `population_on_1_january` / `2025JJ00` → 12 cells, `shape === 'region_set'`,
  `regionSet.complete === true` (verified: 12/12 non-null).
- `gemeenten_in_provincie(PV26)` / `average_home_sale_price_by_gemeente` / `2024JJ00` → **26** cells,
  `regionSet.notApplicable.length === 16` (the abolished gemeenten, CBS reason `Impossible`),
  `complete === true` (verified against the committed fixture).
- A seeded `Confidential` null on one member → that member IS in `cells`, appears in
  `regionSet.withheld`, and `complete === false`.
- A deleted row for one member → that member is in `regionSet.missing`, `complete === false`, and the
  query does **not** refuse (the deliberate, shape-scoped deviation from the all-or-nothing rule —
  it must not change behaviour for any other shape, so add a pin proving a `series` intent with a
  missing period still refuses).
- Fewer than 2 applicable members → `no_data`.
- A roster over `REGION_SET_MAX_MEMBERS` (500) → `invalid_intent`.

**Invariants:** R11 (withheld cells stay present with their reason), principle (c), ADR 011
alternative 3 as revised by the spec. **Done when:** all six pass and the full `tests/query` suite
is unchanged-green.

---

### Task 4 — `deriveRegionRanking` and the RS1 invariant (hermetic)

**Files:** `src/query/derivations.ts`; `tests/query/query.test.ts` (extend — this repo has no
separate `derivations.test.ts`); `tests/invariants/invariants.test.ts` (a new RS1 block beside the
existing R5/R9 blocks).

**Tests first:** complete set → a `max`-kind record whose `rankingResultIds` covers every applicable
cell in descending value order; **one withheld member → no record at all**; one missing member → no
record; a tie at the top → no record (the existing `deriveMax` tie refusal); `checkComputable`'s
null guard is not bypassed.

**Interface:** `deriveRegionRanking(cells: ResultCell[], coverage: RegionSetCoverage): DerivationResult`
— reuses the existing `max` `DerivationRecord` kind (no new kind, no `IntentDerivation` change).

**Invariants:** **R5** (registered function, source cells listed), **R9** (a ranking word with no
derivation behind it fails closed — this task is what makes that fire). **Done when:** the RS1 block
proves that a partial set produces zero ranking-capable derivations.

---

### Task 5 — Chart: `region_set` → sorted bar (hermetic)

**Files:** `src/chart/build.ts` (the shape gate at line 56 and the kind choice at line 66);
`tests/chart/region-set.test.ts`; a pin in `web/components/chart.test.tsx`.

**Tests first:** a `region_set` result charts (today `'derived'` returns `null` — that is the bug this
fixes); series order equals the ranking derivation's `rankingResultIds` order; with **no** ranking
record the order is the result's own cell order (never a builder-invented sort); a withheld member
keeps its `nullNotes` line naming region + reason; every point carries its `resultId` (R1/R6).
In `web/`: a 26-series spec renders bars with labels, a 342-series spec opens on the **table** form
— the existing `BAR_LABEL_MAX = 15` rules at `chart.tsx:1356` and `chart.tsx:2077`, asserted not
re-implemented; and `scanForUnboundDigits` finds no unbound digit in either.

**Invariants:** **R6** (verbatim projection, renderer computes nothing, order is spec order), R1, R11.
**Done when:** both suites pass with no change to `BAR_LABEL_MAX` or the existing bar rules.

---

### Task 6 — Answer: deterministic body, coverage disclosure, refusal (hermetic)

**Files:** `src/answer/compose/template.ts` (a `renderRegionSet` branch in `renderTemplateBody`),
`src/answer/compose/compose.ts` (assemble `regionSetLine` beside `assumptionLine`, ~line 107-125),
`src/answer/compose/types.ts`, `src/answer/respond/respond.ts` (pass `templateOnly: true` for the shape —
the option already exists, `ComposeOptions` at `src/answer/compose/compose.ts:53`, honoured at
`compose.ts:236`), `src/answer/intent/types.ts` + the refusal templates (new
`region_scope_on_national_measure`); tests in `tests/answer/`.

**Tests first:** a complete region-set result renders a superlative and passes
`validateAnswerBody`; an **incomplete** one renders **no** superlative and still passes; the
coverage sentence lands in `regionSetLine` and **not** in `body` (so its digits are structural, not
R1-scanned — mirror the existing `assumptionLine` pins); `composeAnswer` makes **zero** LLM calls for
this shape (assert on a client stub that throws if called); a class ask on
`unemployment_rate_seasonally_adjusted` produces `region_scope_on_national_measure` with its own
wording, never `max_needs_regions`'s "name some regions" template.

**Invariants:** **R1** (structural exemption only), R3, **R9**, R10, principle (a).
**Done when:** `tests/answer` is green and no `tests/fixtures/llm/answer` fixture is touched.

---

### Task 7 — Audit / R8 (hermetic)

**Files:** `src/answer/audit/reconstruct.ts` (+ `known-divergences.ts` if a policy note is needed),
`tests/audit/envelope-key-manifest.test.ts`, `docs/13-envelope-presence-grammar.md`.

**Tests first:** a stored region-set row reconstructs — body, `regionSetLine` and chart spec all
re-derive byte-identically through the same builders; a tampered coverage record fails the check;
a pre-feature row (no `regionSet`, no `regionSetLine`) still reconstructs via `?? null`/`?? false`.
Add the manifest rows for `ValidatedResult.regionSet` and `ComposedAnswer.regionSetLine`.

**Invariants:** **R8**. **Done when:** `npm run audit:verify` passes and the manifest test enumerates
both new keys. Also add the ingestion conformance check from the spec (every `PV` code has a
non-empty `GM<pv>` group, per registered geo table) to `tests/ingestion/`.

---

### Task 8 — Docs (hermetic)

**Files:** new `docs/decisions/053-region-set-query.md` (context, decision, the ≥2 rejected
alternatives from the spec, trade-offs, revisit triggers); an addendum to
`docs/decisions/011-query-contract.md` (the new shape, the additive `regionSet` field, why
`INTENT_SCHEMA_VERSION` is NOT bumped, and the scoped deviation from alternative 3); `docs/05-data-rules.md`
(R5 + R9 notes naming RS1); `docs/04-architecture.md` capability row; `docs/08-build-plan.md`
(new WP); `docs/open-questions.md` (#253 → in progress, plus a row for the `GM<pv>` assumption and
one per unanswered owner question); `docs/STATUS.md`.

**Stale-doc sweep:** `grep -rn "region-set\|region set\|regionScope" docs/` and fix every place that
still says the capability does not exist — at minimum the #253 and #254 rows and
`docs/session-briefs/2026-09-02-session-69-chart-ux-research.md`'s parking note.

**Done when:** the sweep returns no contradicting hit.

---

### Task 9 — Expose it through the parser ⚠️ **OWNER-SUPERVISED — real LLM spend**

**Do not start this task autonomously.** It re-records 103 fixtures against the live API.

**Files:** `src/answer/intent/schema.ts` (add nullable `regionScope` to `rawCandidateSchema` **and**
to `rawParseSchemaWith`'s duplicated candidate shape — both, or the delivery re-run diverges;
bump the `version` literal 3→4), `src/answer/intent/types.ts` (`RAW_PARSE_VERSION`),
`src/answer/intent/prompt.ts` (`PROMPT_VERSION` 6→7 + a Regions rule and one worked example),
`src/answer/intent/resolve.ts` (map `regionScope` + the named parent onto `StructuredIntent.regionSet`),
`benchmark/intent-labelled-set.json` (new `region_set` cases: the five spec questions).

**Prompt-rule discipline:** scope the new rule to class phrasings ("per provincie", "alle gemeenten",
"welke gemeente in X", "gemeenten in X") and **never** re-generalise it — `PROMPT_VERSION` v6's own
comment records a generic period rule bleeding into unrelated benchmark case B2 (4/4 flip).

**Procedure (owner present):** 1) code + labelled cases; 2) `npm run intent:record`; 3)
`npm run clarify:record`, `npm run followup:record`, `npm run onboarding-delivery:record`;
4) `npm run intent:eval --repeat=3` and check the ADR 012 thresholds still separate (0.9 / 0.35);
5) the full verification block — typechecks, all suites, benchmark **14/14 + 6/6 + 0 fabricated**,
real build; 6) `/code-review` at LOW effort over the diff; 7) push.

**Invariants:** ADR 012 (vocabulary only, never codes), R7 (thresholds re-checked, not re-tuned to
green a run), principle (a). **Done when:** 103 fixtures re-recorded and committed, the calibration
report's history has the new run, and the benchmark is at or above the gate.

---

## Sequencing

Tasks 1 → 2 → 3 → 4 are a chain (each needs its predecessor's output). Task 5 needs 3+4. Task 6
needs 3+4. Task 7 needs 6. Task 8 can be written any time after 6. Task 9 last, owner-supervised.
After Tasks 1–8 the capability is fully built and test-proven but reachable only through a
hand-authored intent — which is also the safe shipping point if the owner wants to defer the
fixture spend.

---

## As-built notes (tasks 1–4)

Built on branch `s110/253-region-set-query` (session 110). **Tasks 1, 2, 3 and 4 are DONE**;
tasks 5–9 are untouched. Deviations from the plan as written, and why:

1. **`RegionScope` landed in Task 1, not Task 2.** Task 1's `resolveRegionSet` takes a
   `RegionScope`, so the type had to exist before Task 2. It is declared in `src/query/types.ts`
   (the query-contract file, where the plan always meant it to live); Task 2 then added only the
   `StructuredIntent.regionSet` field and the `'region_set'` member of `ResultShape`.

2. **"Alle gemeenten" on `03759ned` is 834 codes, not 835.** Measured from the committed fixture:
   the twelve `GMPV<nn>` groups sum to 834. The 835th `GM`-prefixed code is `GM0997` ("Centraal
   persoonsregister", group `OVERIG`), which the group-based roster correctly excludes — the plan's
   835 counted it. The test asserts 834.

3. **`resolveRegionSet` returns `excludedBySlice` alongside `codes`.** The plan's interface covered
   only "empty roster" and "entirely outside the slice". A roster only PARTLY inside the slice (no
   such case exists in today's fixtures, but nothing prevents one) would otherwise have been
   silently shortened — and a ranking over a silently shortened class is exactly the claim RS1
   forbids. Those members are carried into the coverage record's `missing` bucket, so they break
   `complete` and suppress the ranking like any other unknown member.

4. **`derivation: 'max'` is accepted alongside a `regionSet`**, with only the "exactly 1 period"
   half of the arity rule checked structurally — the member count is a data question `run.ts`
   answers after the fetch (`no_data` below two members with a value). The explicit `max` never
   reaches `deriveMax`: `run.ts` routes the whole shape through `deriveRegionRanking`, so an
   explicit "welke … de hoogste" over an incomplete set answers the set and simply carries no
   ranking record (the owner's decision 1 — answer without ranking words, never refuse outright).

5. **`deriveRegionRanking` takes an optional third argument, `explicit`** (default `false`) — a
   superset of the plan's two-argument signature. Without it a region set could never mark the
   ranking as the intent-requested computation, which is the flag the visible derived-data marking
   keys on.

6. **`REGION_SET_MAX_MEMBERS` caps SERVED CELLS (applicable + withheld), per spec §6 — not roster
   size.** The plan's Task 3 wording ("a roster over …") reads as roster size, which would refuse
   "alle gemeenten" (834 members) outright even though its ~342 applicable cells sit well under the
   cap the spec measured for exactly that case. The constant lives in `src/query/region-set.ts`
   beside `NOT_APPLICABLE_ATTRIBUTE`.

7. **Interim `renderRegionSet` in `src/answer/compose/template.ts`** (Task 6's file). Adding the
   `'region_set'` shape made `renderTemplateBody`'s switch non-exhaustive — a compile error — so the
   shape needed *some* renderer now. It delegates to `renderComparison`, which is already RS1-safe
   by construction (its superlative sentence exists only when a `max` record does), and the shape is
   checked BEFORE the explicit-max branch so a 342-member class never reaches `renderMax`'s
   spell-out-every-runner-up rendering. **Task 6 still owns the real renderer, the coverage
   disclosure line (`regionSetLine`) and the `templateOnly` wiring.**

8. **The one-varying-axis rule was NOT relaxed** (pinned by test), and `INTENT_SCHEMA_VERSION` is
   still `1`. Nothing under `src/answer/intent/` or `tests/fixtures/llm/` was touched.

Measured at the end of task 4: `tests/query` 183 passed (13 files), `tests/invariants` 26 passed,
`tests/answer/compose-template.test.ts` 42 passed, root `npm run typecheck` clean.

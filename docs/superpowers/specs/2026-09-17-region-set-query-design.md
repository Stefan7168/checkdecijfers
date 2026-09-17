# Region-set query — Design

**Status:** draft for owner review (session 110, 2026-09-17). Tracks [open-questions #253](../../open-questions.md).
**Scope:** the deterministic capability "one measure, one period, a SET of regions" — the
prerequisite #253 names for any map/geo chart. The map itself is NOT in this spec.

## Problem

`StructuredIntent.regions` is always an explicit, non-empty list of CBS region codes the parser
echoed from the question (`src/query/types.ts:47-51`). Nothing resolves "every gemeente": the only
multi-region mechanism, `derivation: 'max'`, needs "exactly 1 period and at least 2 regions"
(`src/query/resolve.ts:302-303`) and every test tops out at two explicit codes. A journalist's most
natural regional question ("welke gemeente had de hoogste...") therefore exits as the
`max_needs_regions` clarification (`src/answer/intent/types.ts:213`), not an answer.

The SQL primitive already exists — `region_code = any($4::text[])` in one round trip
(`src/query/run.ts:389`). The gap is entirely upstream: a roster source, a set-aware result shape, an
honest-about-partial-coverage ranking derivation, and a chart form.

## The five questions (verified against the real fixtures)

| # | Dutch question | Expected behaviour |
|---|---|---|
| 1 | *"Hoeveel inwoners had elke provincie op 1 januari 2025?"* | Answers. Roster = the 12 `PV` codes of `03759ned`; all 12 carry a value at `2025JJ00` (verified in `tests/fixtures/cbs/03759ned/observations-page-1.json`). Complete ⇒ ranking words allowed. Horizontal bar, sorted descending. |
| 2 | *"Welke gemeente in Utrecht had de hoogste huizenprijs in 2024?"* | Answers. Roster = the 42 codes in `83625NED`'s `GMPV26` group; at `2024JJ00` 26 carry a value and 16 are null with CBS reason `Impossible` (verified). The 16 are abolished gemeenten — CBS itself says the coordinate does not exist, so they are not members of the class at that period. Complete over the applicable set ⇒ ranking allowed ("De Bilt", 701.163 euro). The excluded names are disclosed structurally. |
| 3 | *"Wat is de werkloosheid per provincie in 2025?"* | **Refuses.** `unemployment_rate_seasonally_adjusted` is national-only — it is not in `REGIONAL_KEYS` (`src/answer/intent/prompt.ts:109`, which lists exactly two regional keys) and `85224NED` has no `GeoDimension`. New reason `region_scope_on_national_measure`, wording: the measure has no regional breakdown, offer the national figure. Never a national number relabelled "per provincie". |
| 4 | *"Wat was de gemiddelde huizenprijs per gemeente in Groningen in 2016?"* (partial-coverage case) | Answers **without ranking words**. If any roster member's cell is missing entirely, or null for a reason other than `Impossible` (`Confidential` / `NotAvailable` — a value that exists but is withheld, and could be the maximum), the answer names the affected regions, draws the bars it has, and the template uses no superlative. No loaded table produces such a cell today; this branch is proven with a seeded hermetic fixture, not a live one. |
| 5 | *"Vergelijk de bevolkingsgroei van de vier grote steden"* | **Still refuses** — `growth` is two periods and the G4 is four regions, and ADR 011's one-varying-axis rule refuses "several regions AND several periods" (`src/query/resolve.ts:289-290`). This spec does NOT lift that rule. The G4 *level* question ("hoeveel inwoners hebben de vier grote steden?") already works today: the prompt teaches the G4 as four named gemeenten (`src/answer/intent/prompt.ts`, Regions rule 3). |

## Intent shape — additive, and only the last build task costs fixtures

**Query contract (`StructuredIntent`, not LLM-facing).** One new present-only field:

```ts
export type RegionScope =
  | { kind: 'all_provincies' }
  | { kind: 'all_landsdelen' }
  | { kind: 'all_gemeenten' }
  | { kind: 'gemeenten_in_provincie'; parent: string }; // parent = a PV code
export interface StructuredIntent { /* … */ regionSet?: RegionScope; }
```

`regions` and `regionSet` are mutually exclusive; both absent on a geo table keeps today's
clarification. Present-only per [docs/13](../../13-envelope-presence-grammar.md).

**`INTENT_SCHEMA_VERSION` is NOT bumped.** `src/query/resolve.ts:236` refuses any intent whose
version differs, `src/answer/respond/validate-pending.ts:47` pins it as a zod literal, and
`src/chart/embed-live.ts:92` returns `null` on a mismatch — a bump would break every live embed
token and every in-flight pending clarification. The field is additive-optional, exactly like
`regionDefaulted`, so old intents stay valid. This deviates from ADR 011's revisit trigger (which
anticipated a bump for a *cross-product* shape); recorded in the ADR 011 addendum.

**Parser vocabulary (`RawParse`, LLM-facing).** One new nullable field on `rawCandidateSchema`:
`regionScope: z.enum(['all_provincies','all_landsdelen','all_gemeenten','gemeenten_in_provincie','none'])`
(nullable-not-optional, per the structured-outputs constraint the schema file already documents).
When it is `gemeenten_in_provincie` the parent province comes from the existing `regions` array as a
plain name — which also resolves "gemeenten in Utrecht" deterministically to the *province*, because
the class itself disambiguates. The LLM classifies; it never enumerates codes (principle (a),
#253's own constraint 2).

**Exactly which recorded fixtures this invalidates — and why it is the LAST task.** A fixture is
keyed on a SHA-256 of the whole request including the JSON schema and system prompt
(`src/answer/llm/client.ts:92`). `parse.ts:47-49`, `clarify.ts:91,129` and `followup.ts:90,118` all
build from the same `buildSystemPrompt` + `rawParseJsonSchema`, so a change to either invalidates
**all three suites plus the delivery re-run**:

| Suite | Files | Re-record command | Invalidated? |
|---|---|---|---|
| `tests/fixtures/llm/intent` | 72 | `npm run intent:record` | **yes** |
| `tests/fixtures/llm/followup` | 23 | `npm run followup:record` | **yes** |
| `tests/fixtures/llm/clarify` | 7 | `npm run clarify:record` | **yes** |
| `tests/fixtures/llm/onboarding-delivery` | 1 | `npm run onboarding-delivery:record` | **yes** |
| `answer` (45), `semantic-check` (9), `tablefinder` (10), `measurefit` (6) | 71 | — | no (own prompts/schemas) |

**103 fixtures, real spend, owner-supervised**, plus an ADR 012 re-calibration and a benchmark
re-run (a prompt edit has twice destabilised unrelated benchmark cases — `PROMPT_VERSION` v6's own
comment records B2 flipping 4/4 on a generic rule). Everything else here is reachable with
hand-authored `StructuredIntent`s at zero fixture cost — hence the task split in the plan.

## Query contract change

1. **Roster resolution** — new `resolveRegionSet(db, tableId, geoDimension, scope)` reads
   `dimension_labels` filtered on `dimension_group` (see *Membership source*), intersected with the
   table's geo `slice.dimensionPrefixes` (the prefixes `resolve.ts:629-635` already enforces). An
   empty roster refuses; a roster entirely outside the slice refuses `outside_loaded_slice`.
2. **Fetch** — unchanged. `resolve.ts` puts the roster into `regionCodes` and `run.ts:389`'s existing
   `region_code = any($4::text[])` fetches them in one statement. No new SQL primitive (#253 item 3).
3. **Result ids** — unchanged: `table:measure:region:period:dims` per cell (ADR 011 decision 2). A
   region-set result is N ordinary cells, not a new id scheme.
4. **New shape `'region_set'`** on `ResultShape`. Needed because `derivation: 'max'` yields shape `'derived'`,
   and `buildChartSpec` returns `null` for it (`src/chart/build.ts:56`) — a ranked region set must
   chart. Forward-only: no stored row carries the value.
5. **Partition, and the one deliberate deviation from all-or-nothing.** Today a single missing
   coordinate refuses the whole query (`run.ts:433`, ADR 011 alternative 3). For `region_set` only,
   the roster is partitioned into **applicable** (row present, value non-null), **withheld** (row
   present, null for a reason other than `Impossible`), **not-applicable** (null with `Impossible` —
   CBS's own statement that the coordinate does not exist) and **missing** (no row at all).
   `cells` carries applicable + withheld (present-only, R11 honest gaps); not-applicable members are
   recorded in a structural coverage summary, never as cells, because they carry no number. Fewer
   than 2 applicable members ⇒ refuse `no_data`. The all-or-nothing rule exists so a partial *trend*
   is never silently served; here partiality is neither silent nor a trend — it is disclosed and it
   suppresses the ranking claim.
6. **Cap.** `REGION_SET_MAX_MEMBERS = 500` applicable+withheld cells; above it, refuse
   `invalid_intent`. Measured basis: the largest real roster is 835 `GM` codes in `03759ned`, of
   which **342 are applicable at 2024JJ00** (verified) — the cap sits above every real case and
   below the point where the stored envelope (R8 keeps the result AND the chart spec forever) and
   the bar chart both degrade.

## The honesty rule, as a testable invariant

> **RS1.** A region-set answer may use ranking or superlative language ("hoogste", "de meeste",
> "laagste") only when the region set is **complete for the class**: zero missing members and zero
> withheld members. Not-applicable members (`Impossible`) do not break completeness — CBS states
> they are not members at that coordinate.

Mechanised as: `deriveRegionRanking(cells, coverage)` (a new registered R5 function) returns
`{ ok: false }` unless coverage is complete, so no `max`-family `DerivationRecord` exists to bind a
superlative to — and R9's post-generation check already fails closed when a ranking word has no
registered derivation behind it. The rule is enforced by the *absence* of a derivation, not by a new
string filter. Ties keep `deriveMax`'s existing refusal ("no single maximum").

Tests: complete set ⇒ record present with `rankingResultIds` covering every applicable cell; one
seeded `Confidential` cell ⇒ no record; one deleted row ⇒ no record; all-`Impossible` roster ⇒
`no_data` refusal.

## Chart spec

- `kind: 'bar'`, one series per region, one point each — the existing bar contract
  (`src/chart/build.ts:95`). The horizontal-bar form (WP218 phase 5) is the intended reading.
- **Sort order is derivation-bound, not a renderer decision.** R6 forbids a renderer reordering; the
  builder emits series in the order of the ranking derivation's `rankingResultIds` (already part of
  the `max` record, `src/query/types.ts:141`), falling back to the result's own cell order when no
  ranking record exists (the incomplete case). The order is always traceable to a derivation.
- **>15 series:** no new rule. `chart.tsx:1356` already opens a >`BAR_LABEL_MAX` (15) chart on the
  **table** form, and `chart.tsx:2077` suppresses per-bar labels above the same threshold. A
  342-gemeente answer opens as a table and the reader switches to the bar form — the existing,
  test-pinned behaviour, which is exactly the >15-categories rule the idea bank set. Do not special-
  case it here; the map (later) is the real answer for large sets.
- `nullNotes` already names region + reason for withheld cells (`build.ts:47-53`) — reused as is.

## Region-class membership source

**`dimension_labels.dimension_group`, already ingested.** CBS's own `{Dim}Codes` carries
`DimensionGroupId`; `src/cbs-adapter/parse-v4.ts:87-98` parses it, `src/ingestion/pipeline.ts:307,341`
writes it to the column in `migrations/001_ingestion_schema.sql:83`. Verified against both geo
fixtures: group `PV` = the 12 provinces, `LD` = the 4 landsdelen, `NL` = 1,
`GMPV20`…`GMPV31` = the gemeenten **grouped by their province**, `CRPV##` = COROP regions, `OVERIG`
= `GM0997` "Centraal persoonsregister" (correctly excluded from "alle gemeenten" by selecting on the
`GM`-groups rather than the `GM` prefix).

This beats every alternative: no new CBS table (85385NED / gebiedsindelingen), no new migration, no
hardcoded list, no extra fetch — and it is **per-table correct**, which a global list would not be
(`03759ned` has 892 region codes, `83625NED` 745; the Utrecht gemeente roster is 54 vs 42).

Two honesty guards, because `GMPV26 ↔ PV26` is read off the data, not off a CBS contract:
- The mapping is composed as `'GM' + parentProvinceCode` and **verified, never assumed**: if that
  group yields zero codes for the table, refuse (`no_data`) instead of falling back to a prefix
  guess. Marked `**Assumption:**` inline and mirrored in open-questions.
- An ingestion conformance check asserts, per registered geo table, that every `PV` code has a
  non-empty `GM<pv>` group — so a CBS rename fails loudly at sync, not silently at answer time.

`landsdeel` is supported by the roster but **not servable today**: `03759ned`'s slice loads
`RegioS` prefixes `['NL','PV','GM']` only (`src/ingestion/registry-seed.ts:41`), so "alle landsdelen"
refuses `outside_loaded_slice` — correct, honest, and a one-line slice change if the owner wants it.

The **G4** stays what it is today: four named gemeenten taught in the prompt, not a class. It needs
no roster and no source note.

## Refusal taxonomy

Reused unchanged: `outside_loaded_slice` (roster outside the slice), `no_data` (<2 applicable
members, or an empty/unverifiable roster), `invalid_intent` (over the cap; both `regions` and
`regionSet` set), `freshness`/`not_published` (period axis), `table_quarantined`.
**One new `ResolutionFailure.reason`** on the answer side: `region_scope_on_national_measure` —
a class ask on a measure with no geo dimension (question 3). It must not reuse
`region_on_national_measure` (whose template argues about a *named place*) nor `max_needs_regions`
(whose template asks the user to name regions, which is precisely what a class ask avoids). No new
`RefusalKind` in the query layer.

## Audit / R8

- `ValidatedResult` gains present-only `regionSet?: { scope: RegionScope; rosterSize: number;
  notApplicable: string[]; withheld: string[]; missing: string[]; complete: boolean }` — the
  coverage record R8 re-derives the disclosure from, so the sentence is never re-decided at audit
  time (the `regionDefaulted` pattern, `src/query/types.ts:268-278`).
- `ComposedAnswer` gains present-only `regionSetLine?: string`, assembled in `compose.ts` beside
  `assumptionLine` — a **structural** line outside the LLM-scanned `body`, which is what makes its
  unavoidable digits (counts of excluded regions) legal under R1 (whose exemptions are structural,
  never pattern-based; `validateAnswerBody` validates `body` only, `compose.ts:137`).
- Both fields get a row in `tests/audit/envelope-key-manifest.test.ts` (present-only shape, `?? null`
  reader) and in [docs/13](../../13-envelope-presence-grammar.md).
- `audit/reconstruct.ts` must re-derive `regionSetLine` byte-identically through the same builder.

## Billing

**`simple` (20 credits)** — unchanged, no new action class. A region-set turn makes exactly one
LLM call (the intent parse) and **zero** phrasing calls: `composeAnswer` already takes
`options.templateOnly` (`src/answer/compose/compose.ts:237`), and region-set answers pass it. This
is the cheapest-mechanism-first default (CLAUDE.md) applied where it also buys safety: handing a
phrasing model 342 numbers is both the most expensive and the highest-fabrication-surface option in
the whole design, for a sentence ("X had de hoogste …, Y de laagste") that the ranking derivation
already determines. It also means **zero new `answer` fixtures**. The DB cost is one extra
`dimension_labels` read plus a wider `any($4)` array — no extra round trip.

## Risks

1. **Prompt edit destabilises the benchmark.** Real, twice-observed precedent (`PROMPT_VERSION` v6's
   own comment). Mitigation: the parser task is last, isolated, owner-supervised, and gated on
   14/14 + 6/6 + 0 fabricated before merge.
2. **`Impossible` carrying a meaning other than "not a member".** Verified on both geo tables
   (abolished gemeenten) and consistent with `80590ned`'s use (seasonal adjustment does not exist
   yearly). Guard: the rule keys on the verbatim CBS attribute and the excluded names are always
   disclosed, so a wrong reading is visible, not silent.
3. **Envelope size.** 342 cells + 342 chart points stored per answer (R8, forever) — bounded by the
   cap; worth one measured check of a real stored row. **And the map is still not unblocked by this
   alone**: it also needs year-versioned geometry and server-built class breaks (the session-69
   parking note). This spec deliberately delivers the bar-chart form only.

## Alternatives rejected

1. **Let the LLM enumerate the codes.** The prompt already teaches the G4 as four names, so
   extending that to "de 12 provincies" is tempting and costs no query work. Rejected: it is code
   enumeration by the model, which principle (a) and #253's constraint 2 both forbid; it is
   structurally impossible at 342 gemeenten; and it would make the roster a model output rather than
   a CBS fact — the exact hallucination surface ADR 012 decision 1 was built to remove.
2. **A new `region_set` derivation kind in `IntentDerivation`.** Rejected for the reason ADR 052
   already recorded for `period_change`: `IntentDerivation` is the four-value INPUT vocabulary, and
   widening it changes what the parser may select — more prompt surface, more calibration, no gain.
   The set lives on its own axis (`regionSet`) and reuses `derivation: 'max' | 'none'`.
3. **A new `region_hierarchy` table populated from CBS 85385NED / gebiedsindelingen.** Rejected:
   a migration, an ingest job, a second source of truth to sync, and a national list that would be
   *wrong* per table (the two geo tables disagree on 147 region codes). `dimension_group` is already
   ingested, already per-table, already CBS's own answer.
4. **Serve the ranking anyway on a partial set, with a caveat sentence.** Rejected: a withheld cell
   could be the maximum, so "de hoogste" would be a claim the data cannot support — R9, and
   principle (c). Suppressing the derivation is stronger than caveating the prose, because R9 then
   enforces it mechanically.

## Open questions for the owner

1. **Partial coverage: answer without ranking, or refuse outright?** This design answers (chart +
   named gaps, no superlative). The alternative is a flat refusal naming the missing regions.
2. **Should "alle landsdelen" be made servable** by widening `03759ned`'s ingest slice to include
   `LD` (a one-line change plus a re-sync), or stay an honest `outside_loaded_slice` refusal?
3. **Only two measures can answer a regional class question today** (`population_on_1_january`,
   `average_home_sale_price_by_gemeente`). Is that enough to ship, or should a regional table land
   first so the feature has more than two questions to answer?
4. **Is a deterministic (no phrasing model) answer acceptable** for these turns, given every other
   answer in the product is LLM-phrased?
5. **Ship the bar-chart form first and treat the map as a separate, later decision** — confirmed?

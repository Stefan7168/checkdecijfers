# ADR 054 — Region-set query: answering over a region CLASS

**Status:** Tasks 1–7 built + merged session 110 (2026-09-17), on top of `main`, each on its own
worktree branch (`s110/253-region-set-query`, `s110/rs5`, `s110/rs6`, `s110/rs7`). Task 8 (this doc
+ the other docs it lists) is this change. **Task 9 (exposing the capability through the intent
parser) is NOT built** — it is real-LLM-spend, owner-supervised work, deliberately deferred (see
"Revisit triggers"). Until Task 9 runs, nothing a real user can type reaches this code: the shape is
fully built and hermetically tested, but reachable only through a hand-authored `StructuredIntent`.

**Design:** [docs/superpowers/specs/2026-09-17-region-set-query-design.md](../superpowers/specs/2026-09-17-region-set-query-design.md).
**Plan + as-built notes for every task:** [docs/superpowers/plans/2026-09-17-region-set-query.md](../superpowers/plans/2026-09-17-region-set-query.md).

## Owner-delegated decisions (2026-09-17)

The design's five open questions were put to the product owner (Stefan) in the same shape ADR 052
used: **the owner delegated the decision on all five to the parent session** rather than answering
each himself. The five, and how each was resolved — **session decision (owner delegated,
2026-09-17), open to veto**:

1. **Partial coverage: answer without ranking, or refuse outright?** → **Answer.** A region-set
   result with any withheld or missing member still answers — the chart draws the bars it has, the
   body states the data (with each withheld member's own CBS reason, R11), and the structural
   coverage line names the gaps — but carries no superlative ("de hoogste", "de meeste"). A flat
   refusal would have thrown away real, honestly-labelled data over an honesty concern that a
   suppressed ranking already, mechanically, addresses (RS1 below).
2. **Should "alle landsdelen" be made servable** by widening `03759ned`'s ingest slice to include
   the `LD` dimension group? → **Not now.** It stays an honest `outside_loaded_slice` refusal. No
   ingest-slice change was made; this is a one-line change plus a re-sync if the owner wants it
   later, not a design decision.
3. **Only two canonical measures answer a regional class question today**
   (`population_on_1_january`, `average_home_sale_price_by_gemeente`) — enough to ship? →
   **Yes.** The mechanism is general (any registered geo table's roster resolves the same way); a
   third regional table would extend the *questions this answers*, not the mechanism itself.
4. **Is a deterministic, phrasing-model-free answer acceptable**, given every other answer in the
   product is LLM-phrased? → **Yes.** `composeAnswer` runs `templateOnly` for this shape by
   construction (D6 below) — the cheapest-mechanism-first default (CLAUDE.md) applied where it also
   buys safety: a phrasing model never sees up to 500 numbers for one sentence a registered
   derivation already computes.
5. **Ship the bar-chart form first and treat the map as a separate, later decision?** →
   **Confirmed.** This ADR delivers the region-set query and a sorted bar chart only. The map
   itself needs year-versioned geometry and server-built class breaks — the prerequisite this ADR
   removes, not the map itself (see Context).

## Context

[Open-questions #253](../open-questions.md) asked, in session 103 (2026-09-15), whether a different
charting/mapping library would serve this product's map/geo needs better than what it uses today.
Investigating that surfaced the real blocker, confirmed by code inspection in session 109
(2026-09-17): `StructuredIntent.regions` was always an explicit, non-empty list of CBS region codes
the intent parser echoed from the question. Nothing resolved "every gemeente" or "every provincie" —
the one multi-region mechanism, `derivation: 'max'`, needed "exactly 1 period and at least 2
regions" and every test topped out at two explicit codes. A journalist's most natural regional
question ("welke gemeente had de hoogste huizenprijs?") exited as the `max_needs_regions`
clarification, not an answer. This is the prerequisite
[docs/session-briefs/2026-09-02-session-69-chart-ux-research.md](../session-briefs/2026-09-02-session-69-chart-ux-research.md)
had already parked a map view behind ("region-set intents, bulk-ingested year-versioned geometry,
server-built class breaks").

The SQL primitive already existed — `region_code = any($4::text[])` in one round trip
(`src/query/run.ts`). The gap was entirely upstream: a roster source, a set-aware result shape, an
honest-about-partial-coverage ranking derivation, and a chart form. This ADR is that upstream work.
The map itself is explicitly NOT this ADR's scope (owner-delegated decision 5).

## Decision

### D1 — Intent shape: additive, and `INTENT_SCHEMA_VERSION` stays `1`

One new present-only field on the query contract (`src/query/types.ts`), not an LLM-facing change:

```ts
export type RegionScope =
  | { kind: 'all_provincies' }
  | { kind: 'all_landsdelen' }
  | { kind: 'all_gemeenten' }
  | { kind: 'gemeenten_in_provincie'; parent: string }; // parent = a PV code
export interface StructuredIntent { /* … */ regionSet?: RegionScope; }
```

`regions` and `regionSet` are mutually exclusive; both absent on a geo table keeps today's
clarification. `INTENT_SCHEMA_VERSION` is **not bumped**: `src/query/resolve.ts` refuses any intent
whose version differs, `src/answer/respond/validate-pending.ts` pins it as a zod literal, and
`src/chart/embed-live.ts` returns `null` on a mismatch — a bump would break every live embed token
and every in-flight pending clarification. The field is additive-optional, exactly like
`regionDefaulted`/`periodDefaulted`, so every intent stored before this feature stays valid and every
reader uses `?? undefined`, never a bare presence check.

This deviates from [ADR 011](011-query-contract.md)'s own revisit trigger, which anticipated a
version bump for a *cross-product* shape (several regions **and** several periods). A region CLASS
at one period is not that shape — the one-varying-axis rule is untouched (D2) — so no bump is
needed. See the ADR 011 addendum below.

**Not built here** (Task 9, owner-supervised): the LLM-facing vocabulary. `rawCandidateSchema` has
no `regionScope` field yet, so no real question can select this path today. The parser continues to
classify only what it is taught; when Task 9 runs, it adds one nullable enum field and teaches
`gemeenten_in_provincie`'s parent as a plain province NAME already present in the existing `regions`
array — the LLM still never enumerates region codes (principle a, [ADR 012](012-...) decision 1,
unchanged).

### D2 — Roster resolution: `dimension_labels.dimension_group`, never a hardcoded list

`resolveRegionSet` (`src/query/region-set.ts`) reads CBS's own `DimensionGroupId` — already ingested
since migration 001, parsed by `src/cbs-adapter/parse-v4.ts`, written by
`src/ingestion/pipeline.ts` — filtered to the table's own dimension groups: `PV` = provinces, `LD` =
landsdelen, `GM<pv-code>` = the gemeenten of one province (e.g. `GMPV26`), `OVERIG` = `GM0997`
("Centraal persoonsregister", correctly excluded from "alle gemeenten" by selecting on the `GM`
**groups**, never the `GM` code prefix). Verified against both real geo fixtures: `03759ned` and
`83625NED` disagree on 147 region codes and on the Utrecht gemeente roster (54 vs. 42) — a global
hardcoded list would be wrong for one of them by construction, per table.

**Never guessed, always verified.** The `'GM' + <province code>` group-name composition is read off
the data, not asserted as a CBS-documented contract (**Assumption**, mirrored in
[open-questions](../open-questions.md) — see the new rows this change adds). Two guards make this
safe rather than merely convenient:
- A group that comes back empty for a given province **refuses** (`empty_roster`) — there is no
  prefix-scan fallback anywhere in `region-set.ts`. "Alle gemeenten" verifies **every** province's
  group individually before unioning them, so a union that silently lost one whole province can
  never happen.
- A new ingestion conformance test, `tests/ingestion/region-set-groups.test.ts`, asserts — for every
  *registered* geo table, read from `cbs_tables`, never a hardcoded table list — that each of its
  `PV` codes has a non-empty `GM<pv>` group. A future CBS rename now fails loudly in the ingestion
  suite instead of silently at answer time. Measured: 2 geo tables, 12 provinces each, 24/24 groups
  non-empty.

**As-built correction to the design's own numbers:** "alle gemeenten" on `03759ned` is **834** codes,
not 835 as the design estimated — the twelve `GMPV<nn>` groups sum to 834; the 835th `GM`-prefixed
code is `GM0997` itself (group `OVERIG`), correctly excluded by the group-based roster. The test
asserts 834.

A roster only partly inside the table's registered geo slice — no such case exists in today's
fixtures — is carried forward as `excludedBySlice` rather than silently dropped: those codes flow
into the coverage record's `missing` bucket, so they break `complete` and suppress the ranking (D4)
like any other unknown member, instead of the roster being quietly shortened.

### D3 — A new result shape, `'region_set'`, with a coverage record

`ResultShape` gains `'region_set'` (`src/query/types.ts`) because `derivation: 'max'` yields shape
`'derived'`, which `buildChartSpec` refuses to chart at all — a ranked region set must chart. It is
forward-only: no stored row from before this feature carries it.

The roster is partitioned into four mutually exclusive buckets, recorded on
`ValidatedResult.regionSet: RegionSetCoverage` (present-only, `?? null`, per
[docs/13](../13-envelope-presence-grammar.md)):
- **applicable** — a row with a value; carried in `cells`.
- **withheld** — a row present but null for a reason *other than* `Impossible` (`Confidential`,
  `NotAvailable`, …) — a value that exists but is not disclosed, and could be the maximum; also
  carried in `cells` (R11 keeps it, with its reason).
- **notApplicable** — null with CBS's own `Impossible` attribute (`NOT_APPLICABLE_ATTRIBUTE` in
  `region-set.ts`) — CBS's own statement that the coordinate does not exist at that period (an
  abolished gemeente). Recorded in the coverage record, never as a cell — it carries no number.
- **missing** — no row at all, or a slice-excluded member (D2). Recorded in the coverage record.

This is one deliberate, shape-scoped deviation from [ADR 011](011-query-contract.md) alternative
3's all-or-nothing rule: today a single missing coordinate refuses the whole query. For `region_set`
only, partiality is disclosed (the coverage record, the structural `regionSetLine`, D6) and it
suppresses the ranking claim (D4) rather than being silently served or refusing outright — the
all-or-nothing rule exists so a partial *trend* is never silently served; here partiality is neither
silent nor a trend.

**Cap: `REGION_SET_MAX_MEMBERS = 500`, on SERVED CELLS (applicable + withheld), not roster size** —
a resolution the plan's own wording left ambiguous and the as-built code settled explicitly
(`src/query/region-set.ts`). Measured basis, from the shipped code's own comment: the largest real
roster is 834 gemeenten (`03759ned`), of which at most 355 carry a value in any ingested year — the
cap sits comfortably above every real case (reading roster size as the gate would have refused
"alle gemeenten" outright, at 834 members, even though its served cells sit well under 500) and below
the point where the stored envelope (R8 keeps the result **and** the chart spec forever) and a bar
chart both stop being usable. Over the cap, the query refuses `invalid_intent` rather than storing an
envelope nobody can read back.

### D4 — RS1: ranking honesty enforced by the ABSENCE of a derivation, never a word filter

> **RS1.** A region-set answer may use ranking or superlative language ("hoogste", "de meeste",
> "laagste") only when the region set is **complete for the class**: zero missing members and zero
> withheld members. Not-applicable members (`Impossible`) do not break completeness — CBS states
> they are not members at that coordinate.

Mechanised as `deriveRegionRanking(cells, coverage, explicit?)` (`src/query/derivations.ts`), a new
registered R5 function that returns `{ ok: false }` whenever `coverage.complete` is false — so no
`max`-family `DerivationRecord` exists for a ranking word to bind to, and R9's existing
post-generation check already fails closed on a ranking word with no registered derivation behind
it. This is strictly stronger than a caveat sentence: a withheld value *could be* the maximum, so
"de hoogste" would be a claim the data cannot support (principle c) — suppressing the derivation
makes R9 enforce that mechanically rather than editorially. On a complete set it reuses the existing
`deriveMax` (its tie refusal included) — no new `DerivationRecord` kind, no `IntentDerivation`
change (the same reasoning [ADR 052](052-period-over-period-percent-change.md) already recorded for
`period_change`: the OUTPUT vocabulary grows, the LLM-facing INPUT vocabulary does not).

**As-built widening beyond the plan's two-argument signature:** the function takes an optional third
argument, `explicit` (default `false`) — the same `explicit: true/false` flag every other derivation
already carries, needed so an intent that literally asked for the ranking ("welke … de hoogste") over
an *incomplete* set is distinguishable from the automatic pre-registration, without changing RS1's
outcome (the record still does not exist either way).

### D5 — Chart: reuse `'bar'`, sort by the ranking derivation's own order, never a builder-invented sort

`buildChartSpec`'s shape gate now admits `'region_set'` alongside `'series'`/`'comparison'`
(`src/chart/build.ts`), emitting the existing `kind: 'bar'` — no new "horizontal" chart kind was
added; widening a stored, versioned envelope's kind enum for one shape is exactly the class of
change [ADR 007](007-chart-spec-rendering.md)/[014](014-chart-spec-v1-and-renderer.md) reserve for a
schema bump, not needed here. The web layer already treats any `kind: 'bar'` spec as
horizontal-bar-eligible (`hbarFormAllowed`, `web/lib/chart-view-state.ts`), so a region-set spec is
offered the Liggend (hbar) view with zero web-side changes.

**Sort order is derivation-bound (R6), not a renderer decision.** When a `kind: 'max'`
`DerivationRecord` exists (D4), series are reordered to match its `rankingResultIds`; with no ranking
record (RS1 refused it) the sort step is skipped entirely and series stay in the query layer's own
cell order. There is no third, ad-hoc fallback (alphabetical, re-sorted-by-value-here) anywhere in
the new code — the only two orders this code can ever produce are "the ranking derivation's order"
or "the query layer's own order," both traceable to a source.

**A related, separately-tracked improvement now applies here too.** A later same-session task
(branch `s110/rsform`, [ADR 042](042-designed-default-chart.md)'s addendum) generalised the chart
form default so a comparison-shaped spec (one point per series — exactly what a region-set answer
is) of up to `COMPARISON_HBAR_MAX` (40) series now opens on `hbar` by default rather than the plain
`>15 → Tabel` rule; a region-set answer inherits that improvement unchanged, no code in this ADR's
own diff needed to change for it.

### D6 — Answer: deterministic body, structural coverage disclosure, a new refusal for a real gap

`composeAnswer` runs `templateOnly: true` for the `'region_set'` shape **by construction** — enforced
both in `compose.ts` itself (a guard on the shape, so the claim "zero LLM calls for this shape" is
true of `composeAnswer` for every caller, not only the one call site that also passes the option
explicitly) and at the call site in `respond.ts`. This is the cheapest-mechanism-first default
(CLAUDE.md) applied where it also buys safety: handing a phrasing model up to 500 numbers for one
sentence a registered derivation already determines is both the most expensive and the
highest-fabrication-surface option available, for a fact the derivation already states. It also
means **zero new `answer` LLM fixtures** for this feature.

`renderRegionSet` (`src/answer/compose/template.ts`) is deliberately asymmetric:
- **Complete** (a ranking record exists): a one-sentence summary (top + bottom member, in the
  derivation's own order, never re-sorted) — readable at 500 members, leaving the full set to the
  chart.
- **Incomplete** (no ranking record): the full per-member list, claim-free, each withheld member
  stating its own CBS reason (R11) — there is no honest summary to give, so the answer states the
  data itself.

The coverage disclosure — how many of the roster's members the answer actually covers, and which it
could not — is a **structural** line, `ComposedAnswer.regionSetLine`
(`buildRegionSetLine`, `src/answer/compose/format.ts`), assembled beside `assumptionLine` and kept
**outside** the R1-scanned `body`. This is what makes its unavoidable digits (roster counts, excluded
member counts) legal under R1, whose exemptions are structural, never pattern-based
(`validateAnswerBody` validates `body` only). **Excluded (not-applicable/missing) members are named
by their bare CBS region CODE, not a label** — they have no cell anywhere in the stored result, and
`buildRegionSetLine` must stay a pure function of the stored result for R8 to re-derive it byte-
identically; a withheld member (which does have a cell) is named by its verbatim region label as
usual. **Assumption**, mirrored in open-questions: a code is an acceptable display name here; a
follow-up could carry roster labels on the coverage record to remove it. Names are listed at ≤ 5
excluded members; counts only above that.

**A new refusal for a real gap, and a real bug fix along the way.** Question 3 of the design ("wat is
de werkloosheid per provincie?" — a class ask on a measure CBS publishes only nationally) needed its
own honest wording, distinct from `max_needs_regions` (which asks the user to *name* regions — the
opposite of what a class ask does). As built, this landed as a new `RefusalReason`,
`'region_scope_on_national_measure'` (`src/answer/respond/types.ts`, wording in `refusals.ts`) —
**not** a `ResolutionFailure.reason` on the intent layer as the design first sketched, because this
case never reaches that layer: the query resolver already refuses it as `invalid_intent` with axis
`region` before the answer layer's intent-side refusal machinery runs, so an intent-layer reason
would have been dead code. Distinguishing it from the *other* `invalid_intent`/axis-`region` case
(over-the-cap, D3) needed one new present-only field, `QueryRefusal.refusal.subReason` — not a new
`RefusalKind` in the query layer, exactly as the design required. **This is a real bug fix, not only
a wording nicety:** before this change, the question would have been served as the generic
`internal` refusal, and every served `internal` refusal pages the owner
(`src/answer/audit/alerts.ts`) — an honest scope limit would have generated a false alert on every
such question once Task 9 exposes the shape through the parser. Neither the new reason nor
`subReason` touches `src/answer/intent/` or feeds an LLM request, so no fixture hash moves.

### D7 — Audit / R8: reconstruction, a real bug found, and a strengthened check

`ValidatedResult.regionSet` and `ComposedAnswer.regionSetLine` both got manifest rows
(`tests/audit/envelope-key-manifest.test.ts`) and a re-derivation path in
`src/answer/audit/reconstruct.ts`. **The first test written for this task found a real, pre-existing
bug**: before it, `reconstruct.ts`'s text re-assembly had no `regionSetLine` entry at all, so every
stored region-set answer row would have failed R8 the moment one existed. The fix places it in the
same position `compose.ts` does (after `assumptionLine`).

The coverage record is checked **through the line it determines**, not by re-resolving the class
against today's `dimension_labels` — re-resolving would ask today's roster about a row written
months ago. A tampered coverage record (a `complete` flip, a member moved between buckets, an
invented `missing` entry) stops re-deriving and fails loudly; all three are pinned.

**Region-set bodies are `rederived`, not merely `revalidated`** — a deliberate strengthening beyond
what the plan's test list literally asked for. Because `composeAnswer` is template-only *by shape*
for `region_set` (D6), this is the one body in the product with a fully deterministic ground truth:
`applyUnitExpansions(renderTemplateBody(result), result)` must reproduce the stored body
byte-for-byte. The pin that justifies the stronger check drops a sentence from a stored body whose
every remaining digit is still individually backed by a stored cell (so the ordinary
`validateAnswerBody` scan alone would accept it); only the byte comparison catches it. Scoped to this
one shape — an LLM-written body has nothing deterministic to re-derive against, so every other shape
stays `revalidated`.

`QueryRefusal.refusal.subReason` (D6) is checked in **both directions**: `reason ===
'region_scope_on_national_measure'` must imply, and be implied by, `subReason ===
'region_scope_on_national_measure'` — pinned on the real row, a stripped sub-reason, and a
sub-reason wrongly attached to the sibling (over-cap) refusal.

**Not carried yet, flagged for whoever finishes the feature (out of Task 7's own scope, audit/R8
only):** `regionSetLine` is assembled into `answer.text` but is not yet read by the per-line answer
VIEW that `src/threads/replay.ts`, `web/lib/copy-answer.ts` and `web/components/chat.tsx` render
field-by-field (each lists `assumptionLine`/`definitionLine`/… explicitly). Invisible today because
the shape is unreachable until Task 9; a replayed or copied region-set answer would silently drop its
coverage disclosure the day it becomes reachable.

## Alternatives rejected

1. **Let the LLM enumerate the region codes** — extending the existing G4 (four named gemeenten in
   the prompt) to "de 12 provincies." Rejected: this is code enumeration by the model, which
   principle (a) and #253's own constraint 2 both forbid; it is structurally impossible at 834
   gemeenten; and it would make the roster a model output rather than a CBS fact — the exact
   hallucination surface [ADR 012](012-intent-parsing-llm-harness.md) decision 1 was built to
   remove.
2. **A new `region_set` value in `IntentDerivation`.** Rejected for the same reason ADR 052 recorded
   for `period_change`: `IntentDerivation` is the four-value INPUT vocabulary the parser selects
   from, and widening it is prompt surface and calibration risk with no gain — the set lives on its
   own additive axis (`regionSet`) and reuses `derivation: 'max' | 'none'`.
3. **A new `region_hierarchy` table populated from CBS 85385NED (gebiedsindelingen).** Rejected: a
   migration, an ingest job, and a second source of truth to sync — and a national list that would be
   *wrong* per table, since the two real geo tables already disagree on 147 region codes.
   `dimension_group` is already ingested, already per-table, already CBS's own answer.
4. **Serve the ranking anyway on a partial set, with a caveat sentence.** Rejected: a withheld cell
   could be the maximum, so "de hoogste" would be a claim the data cannot support (R9, principle c).
   Suppressing the derivation (D4) is strictly stronger than caveating the prose, because R9 then
   enforces it mechanically instead of relying on the caveat being noticed.

## Trade-offs

- **Prompt-edit risk, deferred, not avoided.** Task 9 will touch the intent prompt/schema, which has
  twice destabilised the benchmark on unrelated cases before (`PROMPT_VERSION` v6's own comment).
  Tasks 1–8 deliberately touch none of `src/answer/intent/prompt.ts`/`schema.ts` and invalidate zero
  of the 103 recorded LLM fixtures, so this ADR's own scope carries none of that risk — it is fully
  isolated to Task 9, which is why Task 9 stays a separate, owner-supervised step rather than being
  folded into this change.
- **`Impossible` must keep meaning "not a member of the class," not merely "no value."** Verified on
  both real geo tables (abolished gemeenten) and consistent with `80590ned`'s existing use
  (seasonal adjustment that cannot exist yearly). The guard keys on the verbatim CBS attribute string,
  and excluded names are always disclosed (D6), so a wrong reading would be visible in the coverage
  line, not silent.
- **Envelope size.** Up to 500 cells and 500 chart points now sit inside one stored audit row,
  forever (R8) — bounded by the cap (D3), not unlimited, but a real increase over every other answer
  shape in the product today. Not separately load-tested in this change.
- **The map is still not unblocked by this ADR alone.** It also needs year-versioned geometry and
  server-built class breaks (the session-69 parking note) — this ADR deliberately delivers the
  bar-chart form only (owner-delegated decision 5).

## Consequences

- The query, chart, answer and audit layers can all now answer "one measure, one period, a region
  CLASS" end to end, hermetically tested at every layer (see the plan's per-task "Measured at the
  end of task N" notes for exact suite counts).
- Nothing a real user can type reaches this code yet — see "Revisit triggers."
- Two canonical measures (`population_on_1_january`, `average_home_sale_price_by_gemeente`) have a
  real geo dimension and a registered geo table today, so they are the only measures this capability
  can currently answer a class question about (owner-delegated decision 3: enough to ship).
- The `region_scope_on_national_measure` refusal (D6) removes a real, previously-undetected
  false-alert source once Task 9 ships: any regional class question about a national-only measure
  would otherwise have paged the owner as an `internal` failure.

## Revisit triggers

- **Task 9 — expose `regionScope` through the intent parser.** Owner-supervised, real LLM spend: 103
  fixtures re-recorded (`intent`, `followup`, `clarify`, `onboarding-delivery`), `PROMPT_VERSION`
  6→7, `RAW_PARSE_VERSION` 3→4 (the LLM-facing raw-parse schema version — distinct from, and
  unaffected by, `INTENT_SCHEMA_VERSION` staying `1`, D1), 5 new labelled benchmark cases, and the
  full verification block (typechecks, all suites, benchmark 14/14 + 6/6 + 0 fabricated, real build,
  `/code-review` LOW) before push. This is the trigger that makes the capability reachable at all.
- **A third regional table registers**, giving this capability a third question to answer — extends
  what it can answer, not the mechanism.
- **The map itself** — needs year-versioned geometry and server-built class breaks, its own design
  round per the session-69 parking note; this ADR is its named prerequisite, now met on the
  query/chart/answer side, not yet on the parser side.
- **"Alle landsdelen" made servable** — widen `03759ned`'s ingest slice to include the `LD`
  dimension group and re-sync (owner-delegated decision 2: not done now).

## Addendum: a second honest sub-reason (row 13, session 110, 2026-09-17)

The session-110 UX audit pass 3
([docs/session-briefs/2026-09-17-session-110-ux-audit-pass3.md](../session-briefs/2026-09-17-session-110-ux-audit-pass3.md)
row 13) found the SAME class of bug D6 fixed, on the sibling structural refusal: "Hoe ontwikkelde de
bevolking van Amsterdam en Rotterdam zich van 2020 tot 2024?" — several regions AND several periods
in one question — hits `src/query/resolve.ts`'s pre-existing one-varying-axis refusal (ADR 011,
unchanged by D2 above) and was served as the generic `internal` wording, which PAGES THE OWNER
(`src/answer/audit/alerts.ts`) for what is an ordinary, honest scope limit exactly like D6's own case.

**Mechanised identically to D6, reusing the same field:** `QueryRefusal.refusal.subReason` (D6) gained
a second present-only value, `'multi_region_multi_period'`, set at the SAME `resolve.ts` refusal site
that already existed (no new refusal site, no new `RefusalKind`) — the guard already distinguishes
"several regions" (an explicit list *or* a region CLASS, D2's own reasoning: a `regionSet` counts as
"several regions" for this rule too) crossed with "several periods." A new `RefusalReason`,
`'multi_region_multi_period'`, gets its own honest wording in `refusals.ts`
(`buildMultiRegionMultiPeriodRefusal`), routed in `buildQueryRefusal` exactly like D6's branch — an
`if` beside the existing one, never a rewrite of it. `INTENT_SCHEMA_VERSION` is untouched (nothing
about the intent SHAPE changed, only which value a pre-existing field can carry) and nothing under
`src/answer/intent/prompt.ts`/`schema.ts`/`tests/fixtures/llm/` moved — this shape is already
reachable through the parser today (an explicit `regions` list + a period range is existing
vocabulary, unlike D1's `regionScope`, which needs Task 9).

**The offer, and its own #134(c) chip (row 15).** The refusal's wording offers the natural fallback:
one region over the whole period, or several regions at one period — never both. Session 110 also
turned this offer, and D6's own "Ik kan je wel het landelijke cijfer geven" offer, into ONE takeable
chip each, via the existing #134(c) mechanism (ADR 029's addendum below) rather than prose alone. The
row-13 chip takes the FIRST explicitly named region, the full asked period range unchanged, and forces
`derivation: 'series'` (the label promises a trend, mirroring `suggestions.ts`'s own `trend()`
generator, which does the same override for the same reason) — a region CLASS ask (`regionSet`, no
explicit `regions`) has no single region to fall back to and gets no chip at all, the same
drop-never-guess rule every other chip in the product follows. **Assumption** (mirrored in
[docs/open-questions.md](../open-questions.md)): the chip names the region by its bare CBS code, not a
registry label — `refusals.ts` stays a pure, DB-free template layer for these `invalid_intent`
builders (unlike `suggestions.ts`'s `buildRefusalSuggestions`, which has an injected registry-label
lookup for its own region-carrying chips), and this is the same accepted display convention D6 already
uses for the region-set coverage line's excluded-member codes. A labelled follow-up is a later
enhancement.

**R8 (audit):** `src/answer/audit/reconstruct.ts`'s subReason⟺reason pairing check (D7) is generalized
from a single hardcoded value to a `subReason → RefusalReason` map, checked in both directions —
so a sub-reason bolted onto its SIBLING (the other honest reason) is caught too, not only one bolted
onto an unrelated refusal. Pinned in `tests/audit/region-set-r8.test.ts`.

**Verified:** `tests/query/query.test.ts`, `tests/query/region-set-resolve.test.ts`,
`tests/answer/region-set-answer.test.ts`, `tests/answer/query-refusal-chips.test.ts` (new, 9 cases:
both refusals' wording, both offer chips, both no-chip cases, both flag-off byte-identical envelopes),
`tests/audit/region-set-r8.test.ts` (18, was 10). Root `npm run typecheck` clean. Zero
prompt/fixture bytes changed.

**Superseded for named regions (session 110, 2026-09-17, see ADR [055](055-multi-region-series.md)).**
The row-13 example question above — "Hoe ontwikkelde de bevolking van Amsterdam en Rotterdam zich van
2020 tot 2024?" — is **no longer refused**. ADR 055 relaxes the one-varying-axis rule for exactly this
case (2 to 6 explicitly named regions crossed with a period range) and answers it as a new
`'region_series'` result shape. The `multi_region_multi_period` sub-reason, its refusal builder and its
row-13/row-15 offer chip described above are **still live and still used**, but now only for what ADR
055 does NOT relax: a region CLASS (`regionSet`) crossed with a range, more than 6 named regions, or a
cross-product over 500 cells. The refusal's wording was updated accordingly (ADR 055's own doc); this
ADR's text above is left as the historical record of the bug this addendum fixed, not a current
description of what refuses today.

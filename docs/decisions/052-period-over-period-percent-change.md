# ADR 052 — Period-over-period percent-change alternate reading

**Status: ACCEPTED (2026-09-17).** Built end to end in an isolated worktree
(branch `period-over-period-percent-change`), then reviewed via the four
open questions below. **The product owner (Stefan) reviewed those four
questions and explicitly delegated the decision on all of them to the
parent session, rather than answering each himself** — the decisions below
are the parent session's judgment calls, made with his authorization, not
his own direct answers. Merged to `main` the same day.

## Owner-delegated decisions (2026-09-17)

1. **Eligible-measure list (D3 below): ship the 7 measures exactly as
   scoped and verified — do not add household income's alternate income
   concepts now.** Reasoning: doing so without independently checking those
   three alternate coordinates' own data (period regularity, always-positive
   history) against the real registry would be exactly the kind of guess
   this project's "never guess" rule exists to prevent. Logged as a
   `**Future scope**` note under D3 instead of decided here.
2. **Dropdown reuse (D5 below): keep it as built — reuse the existing
   `chartAlternates` mechanism, no new UI control.** This is already the
   cheapest viable mechanism (CLAUDE.md's standing rule), and the design's
   own Alternatives section already gave the reasoning; no code change was
   needed, only this confirmation.
3. **Label wording: made cadence-specific instead of generic.** The reading
   now states which previous period it compares against — "t.o.v. vorig
   jaar" / "t.o.v. vorig kwartaal" / "t.o.v. vorige maand" — derived from the
   series' own `PeriodGrain` (`src/query/types.ts`, the same field every
   `ResultCell` already carries; no new grain vocabulary invented). Applied
   consistently to the reading's dropdown label, its synthetic measure
   title, and its definition line (`src/chart/period-change.ts`,
   `periodChangeReadingLabel`/`periodChangePhraseLower`) — the three shared
   one phrase-builder so they cannot drift apart. Tested for all three
   cadences (`tests/chart/period-change.test.ts`).
4. **The producer-price-index (`producer_price_index_level`) alternate:
   investigated, a real companion measure code was found, but NOT wired —
   see "PPI alternate: investigated and consciously NOT added" below.**

## PPI alternate: investigated and consciously NOT added

A real, already-proven companion mutation measure DOES exist:
`producer_price_index_level`'s own coordinate (`M003367`, dims
`{ Afzetgebieden: 'A044074', AlleProdComCoderingen: 'A052584' }`, table
`85770NED`) sits on the exact same table and exact same dims as the
already-registered `producer_prices_yoy` canonical measure's own primary
(`M003288`, same dims) — not a guess, a coordinate this project's own
registry already uses and tests elsewhere. Wiring it as
`producer_price_index_level`'s ADR 051 alternate would have been a one-line,
otherwise-safe registry addition.

**It was not added, because doing so has a real, empirically-confirmed
side effect this session cannot safely take:** `src/answer/intent/prompt.ts`
renders EVERY canonical measure's `alternates` array into the LLM intent
parser's system prompt (the "NIET te verwarren met" line,
`renderVocabularyEntry`), and that whole vocabulary block is part of the
SHA-256-hashed request every recorded intent fixture is keyed on (ADR 012:
*"any registry change loudly invalidates the recorded fixtures"*). This was
verified empirically, not just read from the doc comment: adding the
alternate and running `tests/answer/respond-pipeline.test.ts` immediately
broke 17 of its 27 tests (fixture-hash misses degrading to `internal`
refusals) — confirming the change would invalidate intent-parsing fixtures
project-wide, not just for PPI questions. Fixing that requires
`npm run intent:record` against the real Anthropic API — **real API spend,
owner-supervised only** (CLAUDE.md; docs/08-build-plan.md guardrail 4), which
this session is not authorized to do autonomously. The change was reverted
immediately after the confirming test run; no registry file changed as a
result of this investigation.

**Follow-up, logged in [open-questions #254](../open-questions.md):** add
`{ measure: 'M003288', label: '...' }` to `producer_price_index_level`'s
`alternates` in `src/registry/defaults.ts`, in an owner-supervised session
that budgets for `npm run intent:record`'s fixture re-record (a few cents of
real API spend, per ADR 012's own cost note) — a small, mechanical follow-up,
not a design question.

## Context

[Open-questions #254](../open-questions.md) named two genuine gaps in "what
journalists want from a chart tool": (1) same-measure alternate readings
(seasonally-adjusted vs. raw, index level vs. year-mutation) and (2)
level-vs-%-change. Gap (1) shipped as the chart alternate-reading toggle
([ADR 051](051-chart-alternate-reading-toggle.md), session 106→107, merged).
Gap (2) was explicitly left open there: *"needs a new registered
series-wide derivation and an ADR 011 revision, not an extension of the
toggle mechanism."* This ADR is that follow-up.

**This is a genuinely different mechanism from ADR 051, not a variant of
it — worth stating precisely, because on first glance it looks like the same
feature.** ADR 051's `buildAlternateReading` swaps `measure`/`dims` and
**re-queries** the database for a *different CBS-published cell* — the
alternate value is itself a real, independently-stored CBS observation
(a companion seasonally-adjusted series, a companion index-level measure).
Checked against the real registry (`src/registry/defaults.ts`), several
canonical measures already have exactly this kind of alternate wired up —
including some that read as "level vs. %-change" at a glance, e.g.
`goods_imports_value` ↔ its alternate `M001608` ("de jaarmutatie in %"), or
`house_price_index_regional` ↔ its alternate `M005355` ("de jaarmutatie van
de index in %"). **Those are already served by ADR 051 today, at zero
marginal cost, because CBS itself publishes the mutation as a separate
measure column.** They are explicitly NOT part of this ADR's scope — no new
code is needed for them, and duplicating a CBS-published mutation with our
own arithmetic would risk a second, independently-rounded number disagreeing
with CBS's own (a new honesty risk, not a feature).

The actual gap is: **canonical measures whose primary reading is a level and
which have NO CBS-published companion mutation measure at all** — population,
housing stock, average home price, bankruptcies, solar production, household
income. For those, the only way to offer a %-change reading is to **compute
it ourselves**, from the already-validated level cells, through a genuinely
new registered derivation. That computation is real arithmetic our own code
performs on stored CBS values — exactly the class of thing [ADR
011](011-query-contract.md) and R5 govern, hence the ADR 011 revision.

## Decision

**D1 — A new registered derivation kind, `period_change`, added to
`DerivationRecord` (`src/query/types.ts`) and computed by a new pure function
`derivePeriodChangeSeries` (`src/query/derivations.ts`) — the same file and
the same discipline as `deriveDifference`/`deriveMax`/`deriveDirection` (R5:
"derivations exist only as registered functions in the query module").**
Precise definition: for a period-ordered, single-region series of cells at
one grain, `period_change` is computed pairwise — period *N*'s value against
period *N−1*, i.e. the *immediately preceding entry in that same series*.
This is deliberately grain-agnostic in its definition (month-over-month for
monthly data, quarter-over-quarter for quarterly, year-over-year for yearly)
rather than a fixed calendar window, because the underlying series is already
validated as a gap-free, single-grain sequence (`contiguousPeriodCodes`,
existing helper) — "the previous period" always means the previous *stored*
period, never a skipped-ahead comparison. This is a different, narrower
concept than CBS's own "jaarmutatie" (always a same-period-last-year
comparison, regardless of the series' own grain) — where CBS publishes that
as a real measure, ADR 051 already serves it; this derivation fills the gap
where CBS does not.

**D2 — Refuse the WHOLE reading, never a partial one, on any of these
(principle c):**
- Fewer than 2 source cells, more than one region, or a null-valued cell
  anywhere in the series (a CBS null-with-reason cell — reused
  `checkComputable`/`checkSingleRegion` guards, unchanged from the existing
  derivations).
- The periods are not a gap-free, single-grain, ascending sequence
  (`contiguousPeriodCodes` — reused, not reimplemented; this is exactly the
  "irregular period spacing" refusal the brief asked for).
- **Any step's previous-period value is zero or negative.** Division by zero
  is refused outright (undefined); a negative base is refused because a
  percentage computed from a negative base is not a stable, honestly
  interpretable number (a move from −5 to +5 is arithmetically "+200%" but
  reads as nonsense) — principle (c) says refuse rather than show something
  that could mislead. Every measure this ADR marks eligible (D3) is normally
  a strictly-positive level (a count, a price, an amount, a production
  total), so this guard is a genuine backstop for real anomalies, not the
  common case — but it is enforced code, not an assumption about the data.

All-or-nothing matches every other refusal path in this codebase
(`runQuery`'s completeness gate, `buildAlternateReading`'s period-match
guard): a chart with silently-dropped points would imply a continuity the
data doesn't have.

**D3 — Eligibility is a hand-curated allowlist, `PERIOD_CHANGE_ELIGIBLE_KEYS`
in `src/registry/defaults.ts`, keyed by canonical measure key — not a runtime
heuristic ("does this measure's history happen to stay positive?").** New
canonical measures are ineligible by default until a person reviews and adds
them, same discipline as the registry's own `alternates` arrays. No database
column, no migration: this is a code-level policy constant (like the R7
safelist in ADR 024 — "the safelist is code, never configuration"), read
directly by the answer pipeline, matching the "cheapest mechanism first"
default (a hardcoded, reviewed list beats inferring eligibility from live
data or adding schema).

**Measures marked eligible** (7): `population_on_1_january`,
`housing_stock_start_of_year`, `average_existing_home_sale_price`,
`bankruptcies_businesses`, `solar_electricity_production`,
`average_disposable_household_income`, `average_home_sale_price_by_gemeente`
— all strictly-positive levels (counts, prices, amounts) with no CBS-published
companion mutation measure. **Owner-delegated decision (2026-09-17): ship
exactly these 7, unchanged** — see "Owner-delegated decisions" above.

**Future scope, deliberately not decided here:** `average_disposable_household_income`'s
own three registered ADR 051 alternates (primair inkomen, bruto inkomen,
gestandaardiseerd inkomen — reachable today only via the reading dropdown's
income-concept entries, not this feature) are NOT marked period-change-eligible
in this change. Adding them would need the same real-data check this ADR's
other 7 entries each got (period regularity, no zero/negative history) —
not assumed from the primary concept's own eligibility. A future session
should check each of the three explicitly before adding any of them here.

**Measures deliberately excluded, with reasons:**
- Already a %-change/mutation reading as the PRIMARY (a %-change of a
  %-change is a different, out-of-scope statistic; some already have a level
  reachable via the ADR 051 toggle, from which this same gap would reopen —
  logged as a follow-up, not built here): `cpi_yearly_inflation`,
  `gdp_growth_yoy_volume`, `gdp_growth_qoq_volume`, `producer_prices_yoy`,
  `import_prices_yoy`, `retail_turnover_yoy`, `supermarket_turnover_yoy`,
  `goods_imports_yoy`, `goods_exports_yoy`, `household_consumption_growth`.
- Already served by a CBS-published companion mutation measure via ADR 051
  (adding our own computed version would be a second, possibly-disagreeing
  number for the same fact — a new honesty risk, not a gap):
  `goods_imports_value`, `goods_exports_value`, `house_price_index_regional`,
  `producer_price_index_level` (this last one has no *registered* ADR 051
  alternate yet even though CBS publishes one on the same table — a cheap,
  independent registry-only follow-up, **not done in this change** to keep
  this diff to the one new mechanism it was scoped for; flagged in
  open-questions).
- Already a rate/percentage, not a level (a %-change of a percentage risks
  exactly the procentpunt-vs-percentage confusion R10 exists to guard
  against): `unemployment_rate_seasonally_adjusted`,
  `monthly_unemployment_seasonally_adjusted`.
- Sentiment/balance indices that legitimately cross zero (consumentenvertrouwen
  and its sub-indicators routinely sit near or below zero in real CBS data —
  D2's positive-base guard would refuse most real questions, and even where it
  wouldn't, a %-change of a balance-of-opinion index is not a meaningful
  statistic): `consumer_confidence_seasonally_adjusted`,
  `economic_climate_seasonally_adjusted`, `willingness_to_buy_seasonally_adjusted`.

**D4 — A new module, `src/chart/period-change.ts`, exports
`buildPeriodChangeReading(primary: ValidatedResult)` — a PURE, synchronous
function, deliberately NOT a parallel to `buildAlternateReading`'s
re-query shape.** It takes the already-fetched, already-validated primary
result and transforms its own cells; it makes no database call and
constructs no new `StructuredIntent`. This is a real, structural
simplification over ADR 051's mechanism: there is no second `runQuery`, so
none of `buildAlternateReading`'s documented eviction-race caveat applies
here at all (that caveat exists specifically because `buildAlternateReading`
builds a fresh `explicit` target against `resolve.ts`; this function never
does). The function:
1. Refuses unless `primary.shape === 'series'`.
2. Calls `derivePeriodChangeSeries(primary.cells)` (D1/D2).
3. Projects each derivation record into a synthetic `ResultCell` (value = the
   computed percentage, unit `'%'`, decimals 1, `resultId` minted as
   `${currentCell.resultId}#period_change` — clearly derived, never
   colliding with a real coordinate id) and wraps them in a synthetic
   `ValidatedResult` (`shape: 'series'`, `attribution` copied from the
   primary with `alternates` dropped and `definitionLabel` extended to state
   the grain-specific phrase, e.g. "procentuele verandering t.o.v. vorig
   jaar" — see "Owner-delegated decisions" #3 above).
4. Feeds that synthetic result through the **existing, unmodified**
   `buildChartSpec` — reusing R6 wholesale rather than re-implementing chart
   assembly. This is the same reuse-over-reinvention approach ADR 051 itself
   used for `runQuery`, applied one level down.

**D5 — The reading rides the SAME `chartAlternates` sibling array ADR 051
built (`AnswerResponse.chartAlternates: { label; spec }[]`), not a separate UI
surface.** Concretely, `src/answer/respond/respond.ts` gains one extra
line after the existing registry-alternates loop: when the primary intent's
target is `canonical` and its key is in `PERIOD_CHANGE_ELIGIBLE_KEYS`, call
`buildPeriodChangeReading(result)` and push its `{label, spec}` onto the same
array the registry alternates already populate. **Chosen over a separate
toggle/UI component because `chartAlternates` is already a generic,
source-agnostic list** — `chart-view-state.ts`'s `activeReadingSpec` and
every consumer (chat, the visual dock, the anonymous trial, the digit-honesty
scan, the Embed-disable-on-non-primary-reading rule) already treat it as "any
complete alternate `ChartSpec` with a label," never assuming *how* an entry
was built. **Owner-delegated decision (2026-09-17): keep it exactly this way
— no separate control.** Zero UI code changes: chat, dock and the trial get the new reading
for free, the Embed button already disables itself for ANY non-primary
selection (ADR 051 D7), and the existing period-match philosophy naturally
holds trivially (nothing here re-queries, so there is nothing to mismatch).
The one new line is a genuinely tiny, low-risk touch to the answer pipeline;
a bespoke second dropdown/toggle would have meant threading new state through
`chart-view-state.ts`, `chat.tsx`, `visual-dock.tsx`, and `trial-chat.tsx`
for no product benefit — "toggle between readings of the same chart" is
exactly what the existing control already means to a reader.

**D6 — The new derivation's cap is a flat +1 on top of the existing "first 4
registry alternates," not folded into that same cap.** A canonical key can
carry up to 4 registry alternates (household income does) AND, independently,
one period-change reading if eligible — worst case 5 entries in
`chartAlternates`, still small. Kept separate because the two lists come from
structurally different places (registry data vs. a hardcoded eligibility set)
and conflating them would make the registry's own 4-alternate comment
("the highest count any registry entry carries today") describe a number
that no longer matches what it counts.

**D7 — No trend headline on the period-change chart.** `buildChartSpec` only
emits `attribution.trendHeadline` when the result carries a `direction`
derivation; the synthetic result here carries only `period_change` records.
Computing `direction`/`first_last` over the %-change series itself (the
"is the growth rate itself accelerating" question) is a real, separate
question this ADR deliberately does not answer — silence here is the honest
default (principle c: no invented headline) rather than a decision to
suppress something computed.

## Alternatives considered

- **Add the missing measures' %-change as literal ADR 051 registry
  `alternates` entries**, computing nothing new. Rejected as the general
  solution: it only works where CBS *already publishes* the mutation as its
  own measure on the same table (true for a handful of already-excluded keys
  above, added to open-questions as a cheap follow-up) — it is structurally
  impossible for population, housing stock, bankruptcies, home prices,
  disposable income, and solar production, none of which have any such
  CBS-published sibling measure to point an alternate at.
- **A new `IntentDerivation` value** (extending the 4-value enum in ADR 011)
  so the LLM could ask for a period-change series directly. Rejected for this
  slice: nothing in today's product asks a user-facing question that needs
  this as an intent-selectable derivation (it is a *reading* of an existing
  series, exactly like ADR 051's toggle, not a new kind of question) — adding
  it to the LLM-facing vocabulary would be schema surface with no current
  consumer. `DerivationRecord` (the OUTPUT vocabulary) gains the new kind;
  `IntentDerivation` (the INPUT vocabulary) is untouched. If a future
  benchmark task ever asks "what was the percentage change last year" as a
  literal intent, that is the trigger to revisit (see below).
- **Re-deriving via a second `runQuery` against an `explicit` target**,
  mirroring `buildAlternateReading`'s shape exactly. Rejected: there is no
  second CBS cell to query for these measures — the transform operates on
  the primary's own already-fetched cells, so a re-query would be pure
  overhead (and would reintroduce the eviction-race class of caveat
  `buildAlternateReading` has to carry, for no benefit).
- **Auto-detect eligibility from the data** (e.g. "offer the toggle whenever
  every historical value happens to be positive"). Rejected: silently
  data-dependent behavior (a measure's toggle could appear or disappear
  across syncs) is exactly the kind of implicit, unreviewed guess principle
  (c) and the registry's own curation discipline exist to prevent. A human
  reviews and opts a measure in, once, in code.

## Consequences

- 7 canonical measures gain a genuinely new, computed alternate reading in
  chat, the visual dock, and the anonymous trial, at zero extra query cost
  (no second `runQuery`) and zero extra LLM cost (same as every other
  reading toggle).
- A 2-cell primary series (the minimum for `shape: 'series'`) yields a
  period-change chart with exactly one plotted point — technically honest,
  visually thin. Not fixed here; a candidate UX nicety for later (e.g. only
  offering the toggle once ≥3 raw points exist), logged as an open question
  below rather than decided unilaterally.
- `producer_price_index_level`'s existing gap (no ADR 051 alternate for its
  own CBS-published mutation measure) stays open — a cheap, unrelated,
  registry-only follow-up, logged in open-questions rather than folded into
  this diff.
- The new `period_change` `DerivationRecord` kind is additive to a
  discriminated union with no exhaustive switch anywhere in the codebase over
  `DerivationRecord['kind']` (checked: every existing consumer is a `.find`/
  equality check, not a switch) — this change cannot break an existing
  compile-time exhaustiveness check because none exists.

## Revisit triggers

- A future benchmark task or user-facing feature needs the LLM to *ask* for a
  period-change series (not just toggle an already-delivered one) — that is
  the trigger to extend `IntentDerivation` itself, not this ADR's mechanism.
- `producer_price_index_level` (or any other level-with-an-unregistered-CBS-
  mutation measure) gets its own ADR 051 alternate — shrinks this ADR's
  eligible set's justification by exactly that one entry, not a contradiction.
- The 2-cell/1-point chart edge case (Consequences above) turns out to matter
  in practice — add a minimum-points gate, a owner-confirmable UX choice.

## Open questions — RESOLVED (2026-09-17, owner-delegated)

The four questions this ADR originally asked, and how each was resolved (see
"Owner-delegated decisions" at the top for the full reasoning):

1. **Eligible-measure list** — ship the 7 as scoped; household income's
   alternate income concepts are explicitly future scope (D3's note above),
   not decided now.
2. **Dropdown reuse vs. a separate control** — keep the dropdown reuse (D5);
   no code change, no separate control.
3. **Label wording** — made cadence-specific ("t.o.v. vorig jaar" / "vorig
   kwartaal" / "vorige maand") instead of the generic "vorige periode" this
   ADR originally shipped with (Owner-delegated decision #3).
4. **`producer_price_index_level`'s missing ADR 051 alternate** — investigated
   for real, a genuine companion measure code was found, but consciously NOT
   wired in this change because doing so provably invalidates the intent
   parser's recorded LLM fixtures project-wide (see "PPI alternate:
   investigated and consciously NOT added" above) — logged as an
   owner-supervised follow-up in open-questions #254 instead.

## Session 110 as-built addendum — #254(a) alternates eligibility

**Built:** the three `average_disposable_household_income` registry
alternates (primair/bruto/gestandaardiseerd inkomen, dims
`{Inkomensbegrippen: 'A043964'/'A043965'/'A043967'}`,
`src/registry/defaults.ts` ~lines 316-333) marked
`periodChangeEligible: true` — the "Future scope" item D3 above deliberately
left open, now resolved on the real-data check session 109 already ran and
recorded in [open-questions #254](../open-questions.md) (verified against
the committed `83932NED` fixture: same measure/unit as the primary, no
CBS-published mutation sibling, 14 non-null strictly-positive yearly values
per concept, 2011JJ00-2024JJ00). This session added no new data
verification — it implemented the mechanism the D3 note said was still
missing.

**Mechanism — an optional per-alternate marker, not a parallel eligibility
set.** `CanonicalMeasureAlternate` (`src/registry/types.ts`) and its runtime
mirror `AttributionAlternate` (`src/query/types.ts`) both gained an optional
`periodChangeEligible?: true` field, round-tripped unchanged through
`canonical_measures.alternates` (registry/apply.ts's existing
`JSON.stringify`/`resolve.ts`'s existing `parseJsonb` — no migration, no new
column: the JSONB shape already carries whatever keys the registry writes).
This was chosen over option (b) from the open-questions note (a parallel
`(key, dims)`-keyed set) because it keeps the eligibility fact on the same
object the label/dims already live on — one lookup, not two structures that
could drift out of sync — and it is the "cheapest mechanism first" choice:
zero new lookup machinery, reusing the exact discipline
`PERIOD_CHANGE_ELIGIBLE_KEYS` already established (a human-reviewed marker,
never inferred from the primary's own eligibility or from live data).

**Wiring — `src/answer/respond/respond.ts`'s existing registry-alternates
loop gained one more step, not a parallel loop.** For each alternate that
`buildAlternateReading` already resolves successfully, if that alternate's
own registry entry carries the marker, its own already-built `ValidatedResult`
(not the primary's) is fed through the SAME `buildPeriodChangeReading` the
primary's own period-change entry uses — no third query, matching D4's
"pure transform of already-fetched cells" design. This required extending
`AlternateReadingResult` (`src/chart/alternate-reading.ts`) with one
additive field, `validated: ValidatedResult` (the `altOutcome` the function
already had in scope), so a caller can reach the alternate's own cells
without a second `runQuery`. **Byte-identical envelope, verified, not just
argued:** respond.ts explicitly picks `{label, spec}` out of
`buildAlternateReading`'s result rather than pushing it wholesale — the new
`validated` field never reaches `AnswerResponse.chartAlternates`, confirmed
by a new assertion in `tests/answer/respond-pipeline.test.ts` (B4's entry's
own keys are exactly `['label', 'spec']`).

**Label composition — reuses, never re-derives, the phrase-builder.** A new
`composeAlternatePeriodChangeLabel(altLabel, standaloneLabel)`
(`src/chart/period-change.ts`) takes the alternate's own registry label
("primair inkomen") and the exact standalone label
`buildPeriodChangeReading` already returned for that same call
("Procentuele verandering t.o.v. vorig jaar"), decapitalizing the latter to
read as a suffix: "primair inkomen — procentuele verandering t.o.v. vorig
jaar". It does not re-derive the grain phrase itself (no new import of the
internal `PREVIOUS_PERIOD_PHRASE` table) — the one phrase-builder the ADR's
owner-delegated decision #3 established stays the single source, so the
alternate's wording can never drift from the primary's.

**D6's cap is unchanged and now compounds as designed.** Household income
can now surface up to 8 `chartAlternates` entries for one answer: the
primary chart is separate; up to 4 registry alternates (it has exactly 3);
the primary's own period-change entry (already eligible via
`PERIOD_CHANGE_ELIGIBLE_KEYS`); and up to 3 more period-change entries, one
per eligible alternate. This was a known consequence of D6's own "flat +1,
not folded into the cap" framing applied per-alternate rather than only to
the primary — no new cap was added, since nothing in the brief or D6 called
for one and the dropdown UI (unchanged, ADR 051 D5) already lists an
arbitrary number of entries.

**Not done, and why:** no live-database registry sync was run from this
session (a git worktree with no database access) — the marker exists in
`src/registry/defaults.ts` and will reach the live `canonical_measures`
table the next time the ordinary registry-apply mechanism runs (the same
path every other registry edit already takes; not a new deploy step this
change invented). No new LLM intent fixture was recorded — the hermetic
proof (`tests/chart/period-change.test.ts`) queries `average_disposable_
household_income` directly via `runQuery`/`buildAlternateReading` rather
than through `respondToQuestion`'s LLM-fixture-replay layer, since no
committed benchmark task asks a multi-period household-income question
(session 109's own #254 note already flagged the fixture-invalidation risk
of any registry vocabulary change — this change adds no new key, measure,
dims, or label text, only a boolean flag never read by the intent-parser
prompt builder, so no fixture was at risk and none was touched).

**Tests added:** `tests/registry/registry.test.ts` (marker pinned to
exactly the 3 income alternates, nothing else); `tests/chart/period-change.
test.ts` (a new describe block proving each of the 3 alternates yields a
real, non-null %-change reading of its OWN data, and that a control measure
whose alternate lacks the marker — `bankruptcies_businesses` — never carries
it); `tests/answer/respond-pipeline.test.ts` (the byte-identical-envelope
regression guard above). `tests/audit/envelope-key-manifest.test.ts`
re-run clean (unaffected — it manifests top-level `AnswerResponse`/
`ComposedAnswer` keys, not nested `Attribution.alternates` fields).

# ADR 011 — The structured-intent and ValidatedResult contract (query layer)

**Status:** accepted, 2026-07-03 (WP5)

## Context

WP5 builds the deterministic query layer before the LLM intent parser
([08-build-plan.md](../08-build-plan.md), sequencing note), which means WP5
*fixes* the contract the WP6 parser must target. Three load-bearing choices had
to be made: the shape of the intent object, the identity scheme for result
traceability (R1), and the refusal taxonomy (principle c). All live in
[src/query/types.ts](../../src/query/types.ts).

## Decision

1. **StructuredIntent** = target (`canonical` key from the ADR 010 alias list,
   or `explicit` table + measure + dims) + region codes + periods (explicit
   code list or inclusive same-grain range) + a derivation kind from the
   registered vocabulary (`none | difference | max | series`). Canonical
   targets take **no dim overrides** — choosing another reading of a term *is*
   choosing an alternate, which must be explicit. One varying axis per
   question: several periods at one place, or several regions at one period,
   never both (**Assumption**, [open-questions #38](../open-questions.md)).
2. **Result ids are deterministic coordinate ids**
   (`table:measure:region:period:dims`), not database row ids. Version pinning
   comes from `batchId` on each cell + `tableVersion` in attribution.
3. **Typed refusal taxonomy** mirroring the docs/05 failure table:
   `needs_clarification` (naming **all** unresolved user-facing axes together
   in one refusal, since the single clarification round must cover them all
   at once), `outside_loaded_slice`
   vs `not_published` (explicitly distinguished, per docs/05), `freshness`
   (offers the freshest available period + status, **never a value**),
   `table_quarantined`, `table_not_registered`, `invalid_intent`, `no_data`
   (loud gap), `derivation_failed`, `internal_inconsistency`.
4. **Pre-registered derivations**: every series result automatically carries
   `direction` + `first_last`, every multi-region comparison a non-explicit
   `max` — computed by the same registered functions (R5), flagged
   `explicit: false`, so R9's binding targets exist without the LLM asking.
   Pre-registrations that cannot be honest (null cells, tied max) are omitted;
   explicit derivation failures refuse.

## Alternatives considered

1. **Row-id-based result ids.** Simpler to emit, but unstable across
   re-ingests and meaningless in an audit record read a year later.
   Coordinate ids are self-describing and reproducible; rejected row ids.
2. **A single `periods: string[]` without ranges.** Forces WP6 to enumerate
   long series (and get enumeration subtly wrong); a range with grain-checked
   endpoints keeps enumeration in one tested place. Kept both forms.
3. **Serving partial series** (skip missing years, annotate). Rejected: a
   silently partial trend answer is a guess about what the user would accept —
   all-or-nothing with a typed refusal naming the first missing period
   (S2's "all six years present" criterion generalized).
4. **Free-form derivation expressions** in the intent (e.g. a formula string).
   Rejected outright by R5 — the vocabulary stays enumerated; new derivation
   kinds are code changes with tests, never runtime expressions.

## Consequences

- WP6 gets a frozen, schema-validatable target; any parse failure is
  unambiguously the parser's.
- WP7/WP10 consume `ValidatedResult` as-is: attribution and provisional flags
  are non-optional fields, so no rendering path can drop them (R4/R11).
- Human-readable titles/labels are whitespace-normalized at the query seam
  (CBS wire metadata carries stray double/trailing spaces); codes stay
  verbatim.

## Addendum (2026-09-17, see ADR 052)

[ADR 052](052-period-over-period-percent-change.md) adds a new
`DerivationRecord` kind, `period_change` (period-over-period percent change,
computed by a new registered function `derivePeriodChangeSeries`), to the
registered-derivation vocabulary this ADR's decision #4 describes. This is
narrower than it may sound: it extends the OUTPUT vocabulary
(`DerivationRecord`, the "what a registered function may compute" list) —
`IntentDerivation` (the four-value INPUT vocabulary a `StructuredIntent` may
select, decision #1 above) is untouched, because nothing today asks the LLM
to select a period-change series directly; it exists only as a chart
alternate-reading built over an already-answered primary series, the same
"toggle an already-delivered reading" shape [ADR 051](051-chart-alternate-reading-toggle.md)
uses. See ADR 052 for the full design and its own explicit Alternatives entry
on why `IntentDerivation` itself was left alone. **ADR 052 is ACCEPTED
(2026-09-17, owner-delegated) and merged.**

## Addendum (2026-09-17, see ADR 054)

[ADR 054](054-region-set-query.md) adds a second new result shape, `'region_set'`
(`ResultShape`), and one new present-only field on `StructuredIntent`, `regionSet?:
RegionScope` — a region CLASS ("alle provincies", "de gemeenten in Utrecht") as an
alternative to decision #1's explicit region-code list, mutually exclusive with
`regions`. `INTENT_SCHEMA_VERSION` is **not bumped**, for the same reason ADR 052's
addendum above did not bump it: the field is additive-optional (every intent stored
before this feature carries no key, `?? undefined` reads), so a bump would needlessly
break every live embed token (`src/chart/embed-live.ts`) and in-flight pending
clarification (`src/answer/respond/validate-pending.ts`). Decision #1's one-varying-axis
rule is **not relaxed for a region CLASS** — a region CLASS is still one axis (region) at
one period; a region CLASS crossed with several periods stays refused. **This "several
regions and several periods" framing is now qualified, not superseded: it stayed true only
for a region CLASS or an over-cap/derivation-incompatible named-region ask. A HANDFUL OF
EXPLICITLY NAMED regions crossed with a period range is answered as of ADR
[055](055-multi-region-series.md) (session 110, 2026-09-17) — see that ADR's own addendum
below, which is the one to read for the current, narrower scope of what "remains refused"
actually means today.**

This is a **scoped deviation from Alternatives #3 above** ("serving partial series...
Rejected... all-or-nothing"): for the new `'region_set'` shape only, a missing or withheld
roster member does not refuse the whole query — it is disclosed (a new coverage record,
`ValidatedResult.regionSet`) and it suppresses any ranking claim (ADR 054's RS1), rather
than either being served silently or refusing outright. Every other shape keeps decision
#3's original all-or-nothing rule unchanged; this deviation exists because a region-set
answer is not a trend the way a `series` answer is — partiality there is disclosed and
non-silent by construction, which is a different honesty question than a silently-shortened
series would raise. See ADR 054 for the full mechanism, the coverage record's four buckets,
and why `Impossible`-null members do not count as a gap. **Tasks 1–7 of ADR 054 are built
and merged (session 110, 2026-09-17); Task 9 (parser exposure) is not built — see ADR 054's
own status line.**

## Addendum (2026-09-17, see ADR 055)

[ADR 055](055-multi-region-series.md) adds a THIRD new result shape,
`'region_series'`, for exactly ONE relaxation of decision #1's one-varying-axis rule: a
handful of **explicitly named** regions (2 to `REGION_SERIES_MAX_REGIONS` = 6) crossed with
a period range, up to `REGION_SERIES_MAX_CELLS` (500) cells — one line per region, each
region's own `direction`/`first_last`, no cross-region claim (MS1). **This is the very
cross-product shape this ADR's own Revisit trigger below anticipated, and
`INTENT_SCHEMA_VERSION` is deliberately NOT bumped anyway** — the trigger's premise (that
such a shape would need a new field and its own derivations) turned out not to hold: the
shape is *derived* from `regions.length > 1 && periodCodes.length > 1` on fields the
contract already has, no `StructuredIntent` field is added, and the pre-registered
derivations (`direction`/`first_last`) are the SAME registered functions decision #4
describes, called per-region-slice rather than over the whole cell array. A bump would have
broken every live embed token (`src/chart/embed-live.ts`) and in-flight pending
clarification (`src/answer/respond/validate-pending.ts`) for a shape change that touches no
byte of the stored contract.

The one-varying-axis rule is **not relaxed in general** — only for this one, narrow,
named-regions-times-range case. Everything else it always refused stays refused, unchanged:
a region CLASS (ADR 054's `regionSet`) crossed with a range remains `invalid_intent` with
`subReason: 'multi_region_multi_period'`; more than 6 named regions, or a cross-product over
500 cells, refuses the same way rather than silently dropping a named region; a
`difference`/`max` derivation over several regions keeps its own, more specific arity
refusal (decision #1, unchanged).

This is also a scoped deviation from Alternatives #3 above, on the same axis ADR 054's own
addendum already deviated: for `'region_series'` only, a named region missing a whole row at
any requested period is **excluded from the answer entirely** rather than refusing the whole
query — disclosed structurally (`ValidatedResult.regionSeries`, a `regionSeriesLine`) and
never silently served or silently shortened. A region present at every period but with a
null-with-reason cell somewhere in the window is **partial**: its cells still draw (R11), but
it gets no trend claim (MS1). See ADR 055 for the full coverage-record mechanism, the
validator fix it required (`trendBacking` → `trendCandidates`/`resolveTrendBacking`, so a
later region's cells can no longer silently borrow an earlier region's derivation backing),
and why — unlike `region_set` — this capability is reachable by a real user question the
moment it merges, with no parser change needed at all. **Tasks 1–6 of ADR 055 are built and
merged (session 110, 2026-09-17); the first real-LLM confirmation (a live benchmark run) is
owner-supervised spend, not yet performed — see ADR 055's own status line.**

## Revisit triggers

- A benchmark-shaped question needs a region CLASS (not explicitly named regions — see the
  ADR 055 addendum above for the named-regions case, already built) *and* several periods
  (e.g. "compare all provincies' growth 2019-2024") → extend the contract with an explicit
  cross-product shape and its own derivations, bump `INTENT_SCHEMA_VERSION`.
- WP6 calibration shows the parser needs richer period expressions
  ("meest recente") → add a typed relative-period form; never free text.
- A second table with a non-`Perioden` time dimension or multiple geo
  dimensions enters scope → the resolve step's single-geo/single-time
  assumption needs revisiting.

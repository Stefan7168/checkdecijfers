# Multi-region series (`region_series`) — Design

**Status:** draft for owner review (session 110, 2026-09-17). Tracks UX-audit pass-3
rows [13 and 14](../../session-briefs/2026-09-17-session-110-ux-audit-pass3.md).
**Scope:** one measure, 2–N **explicitly named** regions, a period range → one line per region — the
most-wanted relaxation of ADR [011](../../decisions/011-query-contract.md)'s one-varying-axis rule.
A region CLASS over a range stays refused (ADR [054](../../decisions/054-region-set-query.md)'s axis,
and a different chart).

## Problem

Two audit findings, one root cause. **Row 13:** `src/query/resolve.ts:313-325` refuses any intent
with >1 region **and** >1 period; since `s110/ux-l` merged (b8547ed) it carries `subReason:
'multi_region_multi_period'`, so it is worded honestly (`respond/refusals.ts:546-558`) instead of
paging the owner — but *"Hoe ontwikkelde de bevolking van Amsterdam en Rotterdam zich van 2020 tot
2024?"* is still a refusal, and a natural journalist question. **Row 14:** `web/components/
chart.tsx:1867` offers small multiples on `activeForm === 'line' && spec.series.length > 1`, while
`src/chart/build.ts:74` emits `kind: 'line'` only for shape `'series'`, which the same resolver
guarantees is single-region — **small multiples is live code with tests and no reachable path from
a CBS answer**, and this shape is what makes it reachable.

The SQL primitive already fetches the cross-product in one statement (`run.ts:387-397`,
`region_code = any($4::text[]) and period_code = any($5::text[])`). The gap is a result shape, a
per-region completeness record, per-region derivations, and a template.

## The five questions

| # | Dutch question | Expected behaviour |
|---|---|---|
| 1 | *"Hoe ontwikkelde de bevolking van Amsterdam en Rotterdam zich van 2020 tot 2024?"* | **Answers.** 2 regions × 5 years = 10 cells, shape `region_series`, `kind: 'line'`, 2 series in intent order. Each region gets its own `direction` + `first_last`. Small multiples, legend hide/highlight and Lijn/Staaf/Tabel all light up unchanged. |
| 2 | *"Vergelijk de bevolkingsontwikkeling van de vier grote steden sinds 2015."* | **Answers.** The prompt already teaches G4 = four named gemeenten (`src/answer/intent/prompt.ts:191`) and `since` resolves to a `range` (`src/answer/intent/resolve.ts:525`). 4 series. |
| 3 | *"Wat was de gemiddelde huizenprijs in Amsterdam, Rotterdam en Den Haag van 2019 tot 2024?"* (partial-coverage case) | **Answers, with one region's trend claim suppressed.** A region with any null-with-reason cell in the window keeps its cells (R11, chart gap + `nullNotes`) but gets **no** `direction`/`first_last`, so no trend word can bind to it; the structural coverage line names it. No loaded table produces such a cell today — this branch is proven with a **seeded hermetic fixture**, exactly as ADR 054's question 4 was. |
| 4 | *"Hoe ontwikkelde de bevolking van alle provincies zich van 2020 tot 2024?"* | **Refuses**, unchanged — a region CLASS × a range. Same `multi_region_multi_period` sub-reason and wording; no offer chip (`regions` is empty, `refusals.ts:583`). |
| 5 | *"Hoe ontwikkelde de werkloosheid in Amsterdam en Rotterdam zich van 2020 tot 2024?"* | **Refuses**, unchanged and already honest: the INTENT layer catches a sub-national place on a national-only measure first (`src/answer/intent/resolve.ts:168-186`, reason `region_on_national_measure`), so the query layer's own no-geo-dimension branch (`resolve.ts:673-675`) is never reached from a real question. |

## The intent side — nothing changes, and no fixture is invalidated

**Verified, not assumed:** (1) the raw-parse schema already expresses the shape — `regions` and
`period` are independent fields with no coupling (`src/answer/intent/schema.ts:65-66`, and the
duplicated delivery shape at `:100-101`), `regions` has no length cap, `periodSpecSchema` carries
`year_range`/`since`/`last_n`/`date_range`; (2) the prompt already *requires* this parse — *"NEVER
drop or silently replace a named place"* (`prompt.ts:194`) plus *"series: development over a period
range"* (`:214`), so dropping Rotterdam to satisfy the one-varying-axis rule would break the
prompt's own rule; (3) the intent RESOLVER deliberately emits it — `intent/resolve.ts:7-12` states
the pass-through policy verbatim (*"…several regions AND several periods… are NOT duplicated here —
the intent is emitted and WP5's typed refusal is the single source of that behavior"*), and nothing
caps `regionResolution.codes` (`:228-257`). **Nothing under `src/answer/intent/` is edited, so
`PROMPT_VERSION` stays 6, `RAW_PARSE_VERSION` stays 3, and 0 of the 103 fixtures move.**

**Honest gap — no recorded fixture proves the LLM's behaviour.** All 72 `intent`, 23 `followup` and
7 `clarify` fixtures were scanned: **zero** carry ≥2 regions *and* a range period (the only
multi-region ones, `462d8fc0…` B14/G4 and `e4fb48b2…` B10/Amsterdam+Rotterdam, are both
`{kind:'year'}`), and pass-3 row 13's author reached the shape through the `!!intent` injector
(`respond/harness-intent.ts`), not the parser. The first real-LLM confirmation is therefore a
*benchmark* question, not a re-record — Task 8 adds two labelled cases.

## Query-contract change

1. **New `ResultShape` member: `'region_series'`** (`src/query/types.ts:290`), forward-only — chosen
   over widening `'series'`, whose every consumer assumes single-region (`period-change.ts:93`,
   `deriveDirection`'s `checkSingleRegion`, `suggestions.ts:266`).
2. **No `StructuredIntent` change at all, and `INTENT_SCHEMA_VERSION` stays `1`** — the shape is
   *derived* from fields that already exist (`regions.length > 1 && periodCodes.length > 1`), unlike
   ADR 054 which needed one new field. A deviation from ADR 011's own revisit trigger (which
   anticipated a bump "with an explicit cross-product shape"), recorded in the ADR 011 addendum: a
   bump would break every live embed token (`chart/embed-live.ts`) and every in-flight pending
   clarification (`respond/validate-pending.ts`) for nothing.
3. **Resolver gate** (`resolve.ts:313`): the one-varying-axis refusal becomes conditional — the
   cross-product is allowed when **all** of: the table has a geo dimension, `regionSet` is absent,
   `2 ≤ regions.length ≤ REGION_SERIES_MAX_REGIONS`, `derivation ∈ {none, series}`, and
   `regions.length × periodCodes.length ≤ REGION_SERIES_MAX_CELLS`. Anything else keeps today's
   refusal, `subReason` and chip. (`difference` with >1 region and `max` with >1 period already have
   their own arity refusals at `:331`/`:347` — untouched.)
4. **Fetch and result ids: unchanged** — the existing one-statement cross-product fetch, and
   `table:measure:region:period:dims` per cell (ADR 011 decision 2): a multi-region series is N×M
   ordinary cells, not a new id scheme. Cell order stays run.ts's period-major/region-minor order,
   so `buildChartSpec`'s group-by-region yields period-ascending points per series, unreordered.
5. **Per-region completeness, recorded** — `ValidatedResult.regionSeries?: RegionSeriesCoverage`,
   present-only (`?? null`, [docs/13](../../13-envelope-presence-grammar.md)):
   `{ requested: string[]` (the intent's codes, in intent order)`; partial: string[]` (served, but
   ≥1 requested period has no value → no trend claim)`; excluded: string[]` (not served: ≥1
   requested period has no ROW)`; complete: boolean` (`partial` and `excluded` both empty)`}`.
   A region with a row at every period is **served** (cells enter `cells`, nulls kept with their CBS
   reason, R11). One missing a whole row at any requested period is **excluded entirely**, never
   shortened — a line across an unsampled hole is what the #64 rule (`build.ts:65-73`) forbids. Same
   shape-scoped deviation from ADR 011 alternative 3 ADR 054 D3 took, same reason: disclosed
   structurally, claim suppressed, never silently served.
6. **Floor, not a new refusal.** With fewer than 2 surviving regions the query falls through to the
   EXISTING all-or-nothing path — `diagnoseMissing(db, q, firstMissingRegion, firstMissingPeriod)`
   (`run.ts:439-446`) — giving the already-worded `freshness`/`not_published`/`outside_loaded_slice`
   refusal. **Deliberately not `no_data`**: it routes to `buildInternalRefusal` (`refusals.ts:747`)
   and pages the owner.
7. **Caps: `REGION_SERIES_MAX_REGIONS = 6`, `REGION_SERIES_MAX_CELLS = 500`.** *6 regions:*
   `DEFAULT_PALETTE` has 8 entries (`chart-presentation.ts:92`) so ≤6 never repeats a colour; small
   multiples is available at every count >1 (`chart.tsx:1867`), so colour is never the only channel;
   `defaultFormFor` sends a non-comparison-shaped spec to Tabel only above `BAR_LABEL_MAX` (15).
   **Accepted trade-off:** only the palette's *first four* entries are pinned
   colour-blind-distinguishable (`:82-92`), so 5–6 series lean on the legend, highlight and small
   multiples — owner question 1. *500 cells:* ADR 054 D3's stored-envelope basis (R8 keeps result
   **and** spec forever); it binds — `house_price_index_regional` has a `KW` grain
   (`prompt.ts:100`), and 6 × 120 quarters = 720.

## The honesty rule, as a testable invariant

> **MS1.** In a `region_series` answer, a direction/trend claim about a region exists only when that
> region has a value at **every** requested period, backed by that region's own `direction`/
> `first_last` record computed by the registered functions (R5) over that region's cells alone; a
> region with any gap gets no record and therefore no trend word. **No cross-region claim —
> superlative, ranking, or "grew faster than" — is made or supported at all**: no registered
> derivation ranks *change* across regions (`deriveMax` refuses multi-period cells,
> `derivations.ts:97-100`), so R9 fails any such word closed.

Mechanised by **slicing, not a new function**: `run.ts` groups cells by `regionCode` and calls the
existing `deriveDirection`/`deriveFirstLast` per group. `checkSingleRegion` (`derivations.ts:52-58`)
stays intact and is exactly what makes a per-region slice the only legal input; `checkComputable`
(`:32-42`) is what drops a partial region's record — no extra code path. The pre-registered
comparison `deriveMax` (`run.ts:620`) must be re-gated off the new shape (plan Task 2): it is
coverage- and period-blind.

**One real validator weakness this shape exposes, fixed here.** `trendBacking` (`validate.ts:905-907`)
takes the FIRST `direction` record, and `expectedTrendForClause`'s `cellsByYear` map (`:936`) is
keyed by year across ALL cells, so a later region silently overwrites an earlier one. Our template
is safe only by accident (rule 1 — a clause with ≥2 bound cell tokens decides by their textual
order — always fires on it). Both become region-aware for a multi-`direction` result: a trend clause
not attributable to exactly one named region gets **no** backing and fails closed.

## Chart spec

- `kind: 'line'` — `build.ts:74` becomes `shape === 'series' || shape === 'region_series' ? 'line' :
  'bar'`; one series per region in **intent order** (the group-by at `:86-98` preserves cell order,
  and the `region_set` ranking sort at `:109-121` stays gated on `region_set`).
  The `#64` contiguity gate (`:71`) extends as-is (`contiguousPeriodCodes` de-duplicates
  internally, `resolve.ts:146`); `nullNotes` already names region + period + verbatim reason when
  `multiRegion` (`:53-59`); `trendHeadline` stays suppressed by `direction && !multiRegion`
  (`:160`); the `bar && points.length !== 1` throw (`:125`) is unreachable.
- **Web changes actually needed: exactly one, and it is not the chart.** Verified in source:
  `lineFormAllowed` → true (`chart-view-state.ts:237`), `areaFormAllowed` → false (multi-series),
  `hbarFormAllowed` → false (not `bar`), `defaultFormFor` → `'line'` at ≤15 series (`:107-115`),
  `smallMultiplesAvailable` → **true** (`chart.tsx:1867`); multi-series line rendering, the legend,
  hide/highlight and `chart-small-multiples.tsx` all take `spec.series` generically. The one gap:
  **`web/lib/answer-proof.ts:306`** maps every derivation to a step, so N regions produce N identical
  *"Richting van de reeks: gestegen van 2020 tot en met 2024"* rows naming no region (`:279-288`) —
  that step must name its region when the result has more than one.

## Answer

**Template-only by shape**, like `region_set` (`compose.ts:259`): zero phrasing calls, zero new
`answer` fixtures, and — `renderTemplateBody` then being a pure function of the stored result — a
body **re-derived byte-identically** at audit time. `renderRegionSeries` (`compose/template.ts`):

> **Bevolking op 1 januari per regio, van 2020 tot en met 2024: Amsterdam ging van 872.757 in 2020
> naar 933.680 in 2024 (gestegen); Rotterdam ging van 651.446 in 2020 naar 670.610 in 2024
> (gestegen).**

One clause per region **that has a direction record**; a region without one is disclosed in the
coverage line only (its cells still draw, with their gaps). With *no* complete region the body falls
back to the claim-free per-cell listing `cellLine` already produces — the fail-closed floor
`renderSeries` uses. Clause boundaries are `;`/`:`/`", "` (`validate.ts:772`), so each region's
direction word sits in a clause carrying that region's own two endpoint values.

**Coverage line — structural, present-only, absent when complete.** `buildRegionSeriesLine`
(`format.ts`, beside `buildRegionSetLine`) → `ComposedAnswer.regionSeriesLine`, assembled after
`regionSetLine` (`compose.ts:120-129`) and therefore **outside** the R1-scanned `body`, which is
what makes its roster digits legal (R1's exemptions are structural, never pattern-based):

> *Voor Den Haag ontbreekt een cijfer in 2 van de 6 gevraagde jaren; daarom noemt dit antwoord geen
> ontwikkeling voor die regio. Voor GM0363 hebben wij geen cijfers in onze database.*

A `partial` region has cells → verbatim CBS label; an `excluded` region has none → bare CBS code.
`regionMemberName` (`format.ts:314-317`) already does exactly this, under the same **Assumption**
ADR 054 D6 recorded and open-questions already mirrors.

## Audit / R8

- Manifest rows (`tests/audit/envelope-key-manifest.test.ts`): `ValidatedResult.regionSeries` —
  *shape-checked through the line it determines* (the `regionSet` entry's own argument, `:187-189`);
  `ComposedAnswer.regionSeriesLine` — `rederived`.
- `reconstruct.ts`: re-derive `regionSeriesLine` through the same builder, add it to the text
  re-assembly in the position `compose.ts` uses (`:341-348`), and extend the byte-identical body
  re-derivation + `source === 'template'` assertion (`:320-331`) to the new shape.
  Tampering pins: a `complete` flip, a region moved between `partial`/`excluded`, an invented
  `excluded` entry — each must stop the line re-deriving.
- **Billing: unchanged `simple`, 20 credits** — every pipeline answer is `simple` and no classifier
  exists (`docs/09-pricing.md:14,25`); this shape makes ONE intent call and zero phrasing calls.
- **Billing: unchanged `simple`, 20 credits.** Every pipeline answer is `simple` and no classifier
  exists (`docs/09-pricing.md:14,25`); this shape makes ONE intent call and zero phrasing calls.

## Risks

1. **Accessibility at 5–6 series** — the palette pins colour-blind separation for four entries only;
   mitigated by small multiples + legend highlight (owner question 1 offers N = 4).
2. **Envelope size** — up to 500 cells and 500 chart points stored forever (ADR 054's bound), now on
   a more common question shape; not load-tested. **A named region that gets excluded** —
   the user *asked about* Rotterdam, so answering about Amsterdam alone with a disclosure line is a
   weaker promise than ADR 054's class case, where the user named no member (owner question 2).

## Alternatives rejected

1. **Keep ADR 011 alternative 3 strictly: refuse the whole query when any named region has a gap.**
   Honest, one fewer bucket. Rejected as the default because it throws away a complete,
   correctly-labelled trend for one region because a *different* region has a hole — and ADR 054
   settled the same trade-off the other way (owner-delegated decision 1) with *less* disclosure
   available, not more. Kept as owner question 2.
2. **Widen `'series'` instead of adding a shape.** Cheapest-looking, and wrong: `period-change.ts:93`,
   `suggestions.ts:266` and `stat-card-data.ts` all read `'series'` as "single-region time series",
   and `deriveDirection`'s guard exists precisely because first-vs-last across regions is not a trend.
3. **A new registered derivation ranking growth across regions** ("Amsterdam groeide harder dan
   Rotterdam"). Rejected for v1: a second, independent honesty question (equal windows, equal bases,
   percent vs absolute — ADR 052's `period_change` refuses a zero/negative base for these reasons),
   and MS1 is only crisp while no cross-region claim is made. A revisit trigger, not scope.

## Open questions for the owner

1. **How many regions?** Default **6** — the palette holds 8 colours and small multiples covers the
   rest. Conservative alternative: **4**, the number of palette entries actually pinned as
   colour-blind-distinguishable (and exactly the G4).
2. **A named region with a gap: answer the others, or refuse?** Default **answer**, disclose the gap
   structurally, claim nothing about that region — consistent with ADR 054's decision 1. The
   alternative is a flat refusal naming the region, since the user named it.
3. **Deterministic (template) answer for this shape too?** Default **yes**, as ADR 054 decision 4,
   and here it also buys the byte-identical R8 body check. The alternative is the normal LLM
   phrasing ladder, which costs `answer` fixtures and re-opens the claim surface MS1 closes.

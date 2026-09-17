# ADR 055 — Multi-region time series: answering over several NAMED regions and a period range

**Status:** Tasks 1–6 built + merged session 110 (2026-09-17), on top of `main`, each on its own
worktree branch (`s110/mrs12`, `s110/mrs3`, `s110/mrs4`, `s110/mrs5`, `s110/mrsline`, `s110/mrs6`).
Task 7 (this doc + the other docs it lists) followed the same day. **Same-day UX audit pass 4 (rows
12+13, worktree `s110-ux-r`) then changed the answer body's own shape** — full CBS-qualified region
labels and one "– " line per region instead of a semicolon-joined sentence of base labels — see the
"Pass-4 addendum" section below for the change, the `splitSentences` mechanism it needed, and how R8
was kept green for rows stored before it. **Parser exposure is NOT needed** —
unlike ADR [054](054-region-set-query.md)'s `region_set` shape, this capability is reachable by a
real user question the moment it merged: the intent parser already emits 2+ named regions and a
period range as ordinary, independent fields (see D1 below). **The first real-LLM confirmation is a
live benchmark run (`npm run benchmark:run:live`), owner-supervised spend, not yet performed** — see
"Revisit triggers." **No labelled benchmark case was added for this shape in this change**
(`benchmark/intent-labelled-set.json`), a deliberate deviation from the plan's own Task 7 text: every
case in that file is replayed against a committed LLM fixture (`tests/answer/intent-parse.test.ts`,
`ReplayLlmClient`), and a missing/stale fixture "FAILS LOUDLY" by design
(`src/answer/llm/client.ts`) — adding a case with no recorded fixture would break that hermetic,
CI-gating suite, not merely leave `npm run intent:eval`'s default (real-API) mode untested. Recording
the fixture needs a real LLM call, which this hermetic docs-only worktree cannot make; it is exactly
the same live-spend step the "first real-LLM confirmation" sentence above already names, tracked in
[open-questions #270](../open-questions.md).

**Design:** [docs/superpowers/specs/2026-09-17-multi-region-series-design.md](../superpowers/specs/2026-09-17-multi-region-series-design.md).
**Plan + as-built notes for every task:** [docs/superpowers/plans/2026-09-17-multi-region-series.md](../superpowers/plans/2026-09-17-multi-region-series.md).

## Context

Session-110 UX-audit pass-3 rows [13 and 14](../session-briefs/2026-09-17-session-110-ux-audit-pass3.md)
named one root cause with two symptoms. **Row 13:** `src/query/resolve.ts` refused any intent with
more than one region **and** more than one period — the ADR [011](011-query-contract.md)
one-varying-axis rule — and, before `s110/ux-l` (b8547ed), that refusal was served as the generic
`internal` wording, which pages the owner (`src/answer/audit/alerts.ts`). *"Hoe ontwikkelde de
bevolking van Amsterdam en Rotterdam zich van 2020 tot 2024?"* is the most natural journalist
question the phrasing rule made unanswerable, not an edge case. **Row 14:** small multiples
(`web/components/chart.tsx`, `smallMultiplesAvailable`) is live code with tests offered whenever a
line chart carries more than one series — but `src/chart/build.ts` only emitted `kind: 'line'` for
shape `'series'`, which the resolver guaranteed was always single-region. Small multiples had no
reachable path from a real CBS answer.

The SQL primitive already fetched the cross-product in one round trip (`region_code =
any($4::text[]) and period_code = any($5::text[])`, `src/query/run.ts`). The gap was entirely
upstream and downstream of the fetch: a result shape, a per-region completeness record, per-region
derivations, a chart kind, a template, and a validator that could tell two regions' trend claims
apart.

## Decision

### D1 — Intent shape: unchanged, `INTENT_SCHEMA_VERSION` stays `1`, zero fixtures invalidated

No field is added to `StructuredIntent` and none is edited under `src/answer/intent/`. The raw-parse
schema already carries `regions` and `period` as independent fields with no coupling
(`src/answer/intent/schema.ts`), the prompt already requires the parser to keep every named place
("NEVER drop or silently replace a named place", `prompt.ts`) and to parse a range as a `series`
derivation, and the intent RESOLVER already states the pass-through policy verbatim
(`intent/resolve.ts`: "…several regions AND several periods… are NOT duplicated here — the intent is
emitted and WP5's typed refusal is the single source of that behavior"). `PROMPT_VERSION` stays `6`,
`RAW_PARSE_VERSION` stays `3`, and 0 of the 103 recorded LLM fixtures move.

This is the one respect in which this ADR differs structurally from ADR 054: `region_set` needed a
new field (`regionSet?: RegionScope`) because a region CLASS has no other way to enter the contract.
A multi-region series needs no such field because the shape is **derived**, not declared:
`regions.length > 1 && periodCodes.length > 1` on fields the contract already has.

### D2 — A new `ResultShape` member, `'region_series'`, forward-only

`src/query/types.ts` gains `'region_series'` rather than widening `'series'`. Every existing
`'series'` consumer assumes a single region by construction —
`src/answer/compose/period-change.ts`, `deriveDirection`'s `checkSingleRegion`
(`src/query/derivations.ts`), `src/answer/respond/suggestions.ts`'s region-variant generator — and
widening `'series'` would have made every one of those call sites newly wrong rather than newly
general. It is forward-only, like `region_set`: no row stored before this feature carries it.

### D3 — Resolver gate: the one-varying-axis refusal becomes conditional, for exactly one case

`src/query/resolve.ts`'s refusal is now guarded by an eligibility check that must ALL hold:
`regionSet` is absent (a region CLASS keeps ADR 054's own axis and its own, different chart),
`2 ≤ regions.length ≤ REGION_SERIES_MAX_REGIONS`, `derivation ∈ {none, series}`, and
`regions.length × periodCodes.length ≤ REGION_SERIES_MAX_CELLS`. Anything else — a region class over
a range, more than 6 named regions, more than 500 cells, or a `difference`/`max` derivation, each of
which already has its own more specific arity refusal — keeps today's refusal, its `subReason` and
its offer chip.

**As-built deviation from the plan's own sequencing:** the one-varying-axis check moved to AFTER the
derivation-arity `switch`, not before it. This is what makes a `difference`/`max` ask over several
regions hit its own arity message (on the `derivation` axis) rather than the generic
`multi_region_multi_period` scope-limit message — a more specific, more honest refusal for that case.
One consequence worth recording: a region CLASS combined with `max`/`difference` over several
periods now reads as a derivation-arity refusal rather than `multi_region_multi_period`; no fixture
or test pinned that combination, and the answer layer keys its chip builder on the sub-reason, so the
case degrades safely.

### D4 — Fetch, cell order and identity: unchanged

The existing one-statement cross-product fetch and the existing coordinate-id scheme
(`table:measure:region:period:dims`, ADR 011 decision 2) are reused as-is: a multi-region series is
N × M ordinary cells, not a new id scheme. Cells stay period-major/region-minor, exactly as `run.ts`
already produced them — `buildChartSpec`'s group-by-region loop turns that into period-ascending
points per series without any reordering, and the `#64` contiguity gate's de-duplication
(`contiguousPeriodCodes`, `resolve.ts`) already handled the repeated period codes this ordering
produces without a region-aware rewrite.

### D5 — A new coverage record, `RegionSeriesCoverage`, and an all-or-nothing floor scoped to this shape

`ValidatedResult.regionSeries?: RegionSeriesCoverage` (present-only, `?? null`, per
[docs/13](../13-envelope-presence-grammar.md)):

```ts
export interface RegionSeriesCoverage {
  requested: string[]; // every region the intent named, in the intent's own order
  partial: string[];   // served, but ≥1 requested period has no value — no trend claim
  excluded: string[];  // not served at all — ≥1 requested period has no ROW
  complete: boolean;   // partial and excluded both empty
}
```

A region with a row at every requested period is served in full (cells enter `cells`, nulls kept
with their CBS reason, R11) — even if some of those cells are null-with-reason, which lands it in
`partial`. A region missing a whole ROW at any requested period is **excluded entirely, never
shortened**: a line across an unsampled hole is exactly what the `#64` contiguity rule
(`src/chart/build.ts`) forbids drawing.

**Floor, not a new refusal kind.** With fewer than 2 surviving regions the query falls through to the
EXISTING all-or-nothing path, `diagnoseMissing` (`run.ts`) — the same `freshness`/`not_published`/
`outside_loaded_slice` refusal a single-region `series` gets over the same coordinate gap.
Deliberately never `no_data` for a genuinely unsampled interior hole either: `no_data` routes to
`buildInternalRefusal` and pages the owner, and this shape adds no new refusal vocabulary — pinned
both ways in `tests/query/region-series-run.test.ts` (the multi-region refusal's `kind`/`axis` equal
the single-region `series` refusal's, over the same coordinate).

This is the same shape-scoped deviation from ADR 011 alternative 3 that ADR 054's D3 already made,
for the same reason: partiality here is disclosed structurally and suppresses a claim, rather than
either being served silently or refusing the whole answer outright.

### D6 — Caps: `REGION_SERIES_MAX_REGIONS = 6`, `REGION_SERIES_MAX_CELLS = 500`

*6 regions:* `DEFAULT_PALETTE` (`web/lib/chart-presentation.ts`) has 8 entries, so at 6 no two lines
ever share a colour; small multiples is offered at every series count above 1, so colour is never the
only channel; `defaultFormFor` only sends a non-comparison-shaped spec to Tabel above `BAR_LABEL_MAX`
(15). **Accepted trade-off:** only the palette's first four entries are pinned
colour-blind-distinguishable, so 5–6 series lean on the legend, highlight and small multiples (owner
question 1, resolved as "6" below). *500 cells:* the same stored-envelope basis ADR 054's
`REGION_SET_MAX_MEMBERS` used (R8 keeps the result **and** the chart spec forever) — it binds in
practice, since `house_price_index_regional` has a `KW` grain and 6 × 120 quarters = 720. Over either
cap the query keeps today's honest scope-limit refusal; a named region is never silently dropped to
fit (principle c).

### D7 — MS1: the honesty rule, enforced by the absence of a derivation record, never a word filter

> **MS1.** In a `region_series` answer, a direction/trend claim about a region exists only when that
> region has a value at **every** requested period, backed by that region's own `direction`/
> `first_last` record computed by the registered functions (R5) over that region's cells alone; a
> region with any gap gets no record and therefore no trend word. **No cross-region claim —
> superlative, ranking, or "grew faster than" — is made or supported at all:** no registered
> derivation ranks change across regions, so R9 fails any such word closed.

Mechanised by **slicing, not a new function**: `run.ts` groups cells by `regionCode` and calls the
existing `deriveDirection`/`deriveFirstLast` per group; `checkSingleRegion`
(`src/query/derivations.ts`) is exactly what makes a per-region slice the only legal input, and
`checkComputable` is what silently drops a partial region's record — no extra code path. The
pre-registered comparison `deriveMax` is explicitly re-gated off this shape (an `!isRegionSeries`
guard in `run.ts`, stated even though no seed can make `deriveMax` fire on multi-period cells anyway
— the rule belongs to `run.ts`'s call site, not to another function's internals). Measured: zero `max`
records on a `region_series` result, while the same regions at one period still pre-register their
comparison `max` — the contrast that proves the exclusion is shape-scoped, not a dead branch.

**A real validator weakness this shape exposed, fixed in the same task.** `trendBacking` used to take
the FIRST `direction` record unconditionally, and its year-lookup map was keyed across ALL cells
regardless of region — so a later region's cells could silently overwrite an earlier region's in that
lookup, and a clause naming the wrong (or no, or two) region(s) could borrow another region's backing.
As built, `trendBacking()` was replaced by `trendCandidates()` (collects every `direction`/
`difference` derivation as a `TrendCandidate` carrying its own source cells and the one region they
share) and `resolveTrendBacking(scopeText, candidates, multiRegionResult)`, which requires a clause to
name **exactly one** of the RESULT's own distinct regions before it may bind — gated on the whole
result's distinct region count, not merely on candidate count. That refinement was necessary because
an ordinary single-region result can carry two candidates (an explicit `difference` alongside the
pre-registered `direction`, e.g. the existing B13 fixture) and must keep the old unconditional
"prefer `direction`" behaviour unchanged; gating on candidate count instead of region count was tried
first and broke that real fixture, caught by running `tests/answer` in full before committing. A
second refinement landed one task later: gating on the CANDIDATES spanning more than one region
(rather than the result's cells) left one hole — a `region_series` in which only one region is
complete carries only one candidate, so a hand-written clause wrongly claiming a trend for the
OTHER (partial) region could still silently borrow the complete region's backing. The gate is now the
result's own distinct region count, computed once and threaded through every `resolveTrendBacking`
call site.

## Chart spec

`buildChartSpec`'s shape gate now admits `'region_series'` alongside the existing three shapes; its
`kind` choice is `'line'` for `'series'` OR `'region_series'`, `'bar'` otherwise (`src/chart/build.ts`
— no new chart kind, no schema bump, [ADR 007](007-chart-spec-rendering.md)/
[014](014-chart-spec-v1-and-renderer.md) territory left untouched). One series per region, in
**intent order** — the existing group-by-region loop already preserved cell order, and the
`region_set`-only ranking sort stays gated on `result.shape === 'region_set'`, so it never runs here.

**Exactly one web-side gap, and it was not the chart.** `lineFormAllowed`, `areaFormAllowed`,
`hbarFormAllowed`, `defaultFormFor` and `smallMultiplesAvailable` all already treat any
`kind: 'line'`/multi-series spec generically — confirmed by test, not by inspection alone
(`web/components/chart.test.tsx`'s new "region_series (ADR 055 task 3)" block: a 3-region spec renders
three `.recharts-line-curve` paths, small multiples switches to 3 panels, a 6-series spec keeps 6
distinct palette colours). The one real gap: `web/lib/answer-proof.ts`'s `derivationStep` mapped every
`direction` derivation to an identically-worded row ("Richting van de reeks: …"), naming no region, so
N regions produced N indistinguishable proof-panel rows. Fixed by threading a `multiRegion` boolean
(computed once from the result's own distinct region count, not from `shape` — so a hand-built or
pre-feature result degrades the same honest way) into `derivationStep`, which appends
`` ` voor ${first.regionLabel}` `` only in the `'direction'` case and only when `multiRegion` is true;
a single-region result's proof text is byte-identical to before this change (regression-pinned).

## Answer

**Template-only by shape**, exactly like `region_set` (ADR 054 D6): `composeAnswer` runs
`templateOnly` for `'region_series'` by construction (a guard on the shape, not only at one call
site), so this shape makes zero phrasing-model calls and needs zero new `answer` LLM fixtures.
`renderRegionSeries` (`src/answer/compose/template.ts`) emits one clause per region **that has a
direction record**, in intent order:

> Bevolking op 1 januari per regio: Amsterdam ging van 872.757 in 2020 naar 931.298 in 2024
> (gestegen); Rotterdam ging van 651.157 in 2020 naar 670.610 in 2024 (gestegen).

**Deviation from the spec's own sketch:** the header carries no period range (the spec sketched "…
per regio, van 2020 tot en met 2024: …"); as built it mirrors `renderSeries`'s proven "… per
periode:" exactly, and every period is still stated inside each region's own clause. A bare year
after "van" in a shared header would be a numeric token on a different grounding path than the
clauses already use, and this floor renderer was judged not the place to take that risk for a
fragment the clauses already carry. A third direction word-form table was needed for the participle
(`gestegen`/`gedaald`/`gelijk gebleven`), deliberately reusing the exact phrase `validate.ts`'s
`FLAT_WORDS` recognises.

A region without a direction record (partial, or the answer falls back entirely when NO region is
complete) is disclosed only in the coverage line, never with a claim; with no complete region at all,
the body falls back to the claim-free per-cell listing `renderSeries` already produces — the same
fail-closed floor `region_set`'s asymmetric renderer uses for its own incomplete case.

**Coverage line — structural, present-only, absent when complete.**
`ComposedAnswer.regionSeriesLine` (`buildRegionSeriesLine`, `src/answer/compose/format.ts`) is
assembled immediately after `regionSetLine` and lives **outside** the R1-scanned `body`, exactly
mirroring `region_set`'s own line — which is what makes its roster digits legal under R1's
structural-only exemptions:

> Voor Rotterdam ontbreekt een cijfer in 1 van de 5 gevraagde jaren; daarom noemt dit antwoord geen
> ontwikkeling voor die regio. Over GM0344 zegt dit antwoord niets: in onze database ontbreken
> cijfers voor een of meer van de gevraagde jaren.

A `partial` region is named by its verbatim CBS label; an `excluded` region is named by its bare CBS
code — the same **Assumption** ADR 054 D6 recorded for `region_set`'s own excluded members
([open-questions #266](../open-questions.md)), extended here rather than re-litigated.

**Refusal wording, re-worded because the old wording became false.** The pre-existing
`multi_region_multi_period` refusal (ADR 054's own addendum, row 13) said "Ik kan meerdere regio's
over meerdere periodes nog niet in één antwoord combineren" — which this feature disproves for a
handful of named regions. It now states the disjunction that IS true for every case that still
reaches it: a whole region GROUP (a class — ADR 054's axis, a different chart), or more named regions
/ cells than one answer may carry. Sub-reason, offer chip and the no-chip-for-a-class rule are
unchanged; the offer chip still takes the first explicitly named region over the full range and forces
`derivation: 'series'`, mirroring `suggestions.ts`'s own `trend()` override.

## Web-render gap found and closed in the same session

Task 4 found, and flagged as unresolved, that `regionSetLine` (ADR 054) was assembled into
`answer.text` but never read by the field-by-field answer VIEW several surfaces render
(`web/lib/chat-message.ts`, `web/components/chat.tsx`, `web/lib/copy-answer.ts`,
`web/lib/replay-assemble.ts`, `src/threads/replay.ts`) — so a partial/excluded region's disclosure
would have been silently missing from the screen, the one outcome the design's honesty rule exists to
prevent. Branch `s110/mrsline` (merged) carried `regionSeriesLine` through every one of those surfaces
in the same pass it fixed the identical `regionSetLine` gap, mirroring the same-day `regionSetLine`
parity fix exactly. `src/billing/history.ts`'s narrower `answerParts` (the dashboard definition
expander) was left out of both fixes, same reasoning both times.

## Audit / R8

Manifest rows (`tests/audit/envelope-key-manifest.test.ts`): `ValidatedResult.regionSeries` is
`shape-checked`, read THROUGH the line it determines — the same argument the `regionSet` entry makes,
plus one it cannot: the line's digits ("N van de M gevraagde jaren") are counted from the SERVED
CELLS, so a tampered roster disagrees with the stored cells as well as the stored sentence.
`ComposedAnswer.regionSeriesLine` is `rederived`, with a three-way `?? null` meaning (pre-feature row
/ other shape / nothing was missing) that a reader must treat identically. Both declared-member counts
bumped (`ComposedAnswer` 17→18, `ValidatedResult` 11→12) — measured RED (3 failed/7 passed) before
this task, green after.

`src/answer/audit/reconstruct.ts`: the coverage line re-derives via the same builder immediately after
the `regionSetLine` check; the shape-scoped body re-derivation gate widened from `region_set` alone to
`region_set || region_series`, keeping the `region_set` problem strings byte-identical (the audit
divergence register pins problems by substring); the text re-assembly gained the
`regionSeriesLine` slot in the position `compose.ts` uses. Tampering pins, all measured green:
a `complete` flip, a region moved `partial` ↔ `excluded`, an invented `excluded` entry, a rewritten
line, and a stripped line (`?? null` is not an escape hatch) — each fails loudly. A pre-feature row
(no `regionSeries`, no `regionSeriesLine`) still reconstructs via `?? null`.

**Billing: unchanged `simple`, 20 credits.** Every pipeline answer is `simple` and no classifier
exists; this shape makes one intent call and zero phrasing calls, same as `region_set`.

## Pass-4 addendum (session 110, 2026-09-17): rows 12+13 — the qualified label and the per-line body

A same-day UX audit pass ([docs/session-briefs/2026-09-17-session-110-ux-audit-pass4.md](../session-briefs/2026-09-17-session-110-ux-audit-pass4.md), rows 12 and 13) drove five real `region_series`
turns through the chat UI and found the shape's own launch body (above) had two real readability/
honesty problems once it carried its full 2–6-region range rather than the two-region examples this
ADR was written against:

- **Row 12 — a bare region name is ambiguous once several regions share one sentence.** The body used
  `baseRegionLabel` (qualifier stripped) while the legend, proof table and CSV all kept the verbatim
  CBS label; in a 6-region answer, "Utrecht" is genuinely ambiguous between the gemeente (~374k) and
  the provincie (~1.4M) it collides with. **Decided: `renderRegionSeries` now names each region with
  the FULL verbatim CBS label** (e.g. "Utrecht (gemeente)"), matching every other surface. Checked, not
  changed: `sentenceMentionsCellRegion` (validate.ts) already matches on `baseRegionLabel` as a
  case-insensitive SUBSTRING, so it still finds a region's base name inside its qualified form with no
  code change — pinned in `tests/answer/compose-validate.test.ts`. `renderRegionSet` and
  `renderComparison` are UNCHANGED (still `baseRegionLabel`) — this decision is scoped to the one
  renderer row 12 named.
- **Row 13 — a 6-region body was a 15-line run-on paragraph at phone width.** All clauses sat in one
  semicolon-joined sentence. **Decided: one line per region**, each starting with "– " (en dash,
  space), joined by `\n`, with the header ending in ':' on its own line and only the body's FINAL line
  ending in '.'. This is the first `body` in the whole answer pipeline to contain a literal newline —
  `web/components/chat.tsx`'s `whitespace-pre-wrap` body div and `web/lib/copy-answer.ts`'s verbatim
  copy both already handle it with no change needed.
  **The mechanism this forced:** `validate.ts`'s `splitSentences` treats bare `\n` as a sentence
  boundary now, alongside `[.!?](?=\s|$)`. Without this, every region's line would sit inside ONE
  giant multi-region "sentence" for `checkBinding`/`checkDirectionWords` purposes — and since row 13
  also dropped the `';'` separators the OLD single-sentence form relied on, a trend word on line 2
  could "see" line 1's region name (mentioned anywhere in the shared scope) and pass a binding check it
  should fail. This is not hypothetical: pinned by a swapped-region-label regression in both
  `tests/answer/compose-validate.test.ts` (generic, hand-built two-region result) and
  `tests/answer/region-series-answer.test.ts` (a real query result) — each line's leading region name
  swapped with the other's, values left untouched, and the validator correctly rejects it because each
  line is now its own binding scope. No renderer before this one ever put `\n` inside `body`, so the
  change is additive for every other shape.

**R8 blast radius, and how it was closed without a database.** Both rows changed `region_series`
bodies' BYTES, which is `renderTemplateBody`'s R8 byte-identical re-derivation target
(`src/answer/audit/reconstruct.ts`, "Audit / R8" above) — a row stored between this shape's own
go-live (commit `f923f31`, 2026-09-17, ~13:50 UTC) and this change would fail fresh re-derivation
under today's renderer. The ordinary fix, a `known-divergences.ts` per-row-id entry (the `id: 76`/
`id: 227` pattern that file already carries), was not available: no real `audit_answers` id from that
window can be named from this hermetic worktree (no live database connection — the same gap
[open-questions #270](../open-questions.md) already tracked for this whole ADR), and that register's
own stated discipline is "one entry per row, never a range or a pattern" — a placeholder id would
violate it and could silently swallow an unrelated future problem on whatever row eventually gets that
id.

Instead, `reconstruct.ts` was given the file's OTHER documented mechanism: a small, NAMED,
narrowly-scoped tolerance living directly in the reconstruction check (that module's own header names
two precedents — the `attribution.source` A1 fallback and the `trendHeadline` optional-v1-field
exception) — except keyed on `createdAt` rather than on one field's presence, because what changed is
an entire rendering FORMAT for one shape, not one optional field. `template.ts` keeps a
`renderRegionSeriesLegacyPreLineFormat` export, byte-identical to how `renderRegionSeries` shipped at
`f923f31` (base labels, `'; '`-joined, one sentence — sharing its region/derivation data path with the
live renderer via `regionSeriesClauses`/`regionSeriesClauseText` so the two can never drift on WHICH
regions get a clause, only on wording). `reconstruct.ts`'s `REGION_SERIES_LINE_FORMAT_CUTOFF`
(`Date.parse('2026-09-17T15:30:00.000Z')`, this change's own authoring timestamp, verified against
`date -u`) picks which renderer a `region_series` row is checked against by its `createdAt` — a
genuinely pre-change row now reconstructs TRUE, not merely "known-divergent". Pinned in
`tests/audit/region-series-r8.test.ts` ("R8: pre-cutoff region_series rows…"): a pre-cutoff row with
the old-shape body reconstructs clean; the SAME old-shape body timestamped after the cutoff still
fails (proving the tolerance is date-scoped, not a blanket pass); a post-cutoff row with today's shape
is unaffected.

**Left open, tracked in [open-questions #273](../open-questions.md):** whether any REAL row actually
falls in the `f923f31`→this-change window is unconfirmed (no DB access here) — a session with live
access should run `npm run audit:verify` across that id range once, folded into #270's own pending
verification step, and register a `known-divergences.ts` id entry for any row the date tolerance does
not cover (e.g. one written in the short gap between this commit and its actual deploy).

## The five questions from the design, as built

| # | Question | As built |
|---|---|---|
| 1 | Amsterdam + Rotterdam, 2020–2024 | Answers: 10 cells, `region_series`, `kind: 'line'`, 2 series in intent order, each with its own direction/first_last. |
| 2 | The G4 since 2015 | Answers: 4 series, no new prompt vocabulary needed (the prompt already teaches the G4 as four named gemeenten, and `since` already resolves to a range). |
| 3 | Amsterdam, Rotterdam, Den Haag with one partial region | Answers, with that region's trend claim suppressed (no direction/first_last record) and the gap named in `regionSeriesLine`; proven with a seeded hermetic fixture, no loaded table produces this naturally today. |
| 4 | All provincies, 2020–2024 | Refuses, unchanged — a region CLASS over a range, `multi_region_multi_period`, no offer chip (`regionSet`-carrying refusals name no single region to fall back to). |
| 5 | Amsterdam + Rotterdam on a national-only measure | Refuses, unchanged and already honest — caught upstream by the intent layer's `region_on_national_measure` reason before the query layer's own path is ever reached from a real question. |

## Alternatives rejected

1. **Refuse the whole query when any named region has a gap** (ADR 011 alternative 3, strictly).
   Rejected as the default because it throws away a complete, correctly-labelled trend for one region
   over a hole in a *different* region — and ADR 054 already settled the same trade-off the other way,
   with less disclosure machinery available at the time, not more. Kept as owner question 2 below.
2. **Widen `'series'` instead of adding a shape.** Cheaper-looking, and wrong: every real `'series'`
   consumer (`period-change.ts`, `suggestions.ts`, `deriveDirection`'s own guard) reads that shape as
   "single-region time series" by construction.
3. **A new registered derivation ranking growth across regions** ("Amsterdam groeide harder dan
   Rotterdam"). Rejected for v1: a second, independent honesty question (equal windows, equal bases,
   percent vs. absolute — the same class of question ADR 052's `period_change` already refuses a
   zero/negative base over), and MS1 stays crisp only while no cross-region claim exists at all. A
   revisit trigger, not scope.

## Owner questions and the session's decisions

The design's three open questions were resolved by the parent session (**session decision, owner
delegated, 2026-09-17, open to veto** — the same framing ADR 054 used):

1. **How many regions?** → **6.** The palette holds 8 colours (no repeat at 6) and small multiples
   covers separability past the four colour-blind-pinned entries; the conservative alternative (4,
   exactly the palette's pinned entries / the G4) was not chosen because small multiples already
   closes most of that gap and a named region should not need to be dropped to fit a smaller cap.
2. **A named region with a gap: answer the others, or refuse?** → **Answer**, disclose the gap
   structurally, claim nothing about that region — consistent with ADR 054's decision 1 for the same
   trade-off on `region_set`.
3. **Deterministic (template) answer for this shape too?** → **Yes**, as ADR 054 decision 4: it buys
   the byte-identical R8 body check, and it keeps a phrasing model from ever seeing several regions'
   worth of numbers for a sentence a registered derivation already computes (cheapest-mechanism-first,
   CLAUDE.md).

## Trade-offs

- **Accessibility at 5–6 series.** The palette pins colour-blind separation for four entries only;
  mitigated by small multiples, the legend and highlight — not separately load-tested for real
  usability at 6.
- **Envelope size.** Up to 500 cells and 500 chart points stored forever (R8), now reachable by an
  ordinary journalist question rather than only a class query — not separately load-tested.
- **A named region that gets excluded is a weaker promise than the region-class case.** The user
  *asked about* Rotterdam by name; answering about Amsterdam alone with a disclosure line discloses
  less generously than ADR 054's class case, where the user named no specific member. Tracked as owner
  question 2 above, resolved "answer" for now.

## Revisit triggers

- **The live benchmark confirmation** (`npm run benchmark:run:live`) has not yet been run against this
  shape — the honest gap the design itself names: no recorded fixture (of the 72 `intent`, 23
  `followup`, 7 `clarify` fixtures scanned) carries ≥2 regions and a range period, so the parser's
  real behaviour on this shape is unconfirmed until a live run exercises it. Owner-supervised spend,
  not yet performed — see [open-questions](../open-questions.md) for the tracking row.
- **A benchmark-shaped question needs a region CLASS *and* several periods** (e.g. "compare all
  provincies' growth 2019–2024") — this ADR does not relax that combination; ADR 011's own revisit
  trigger for a cross-product shape with an `INTENT_SCHEMA_VERSION` bump still applies there.
- **A cross-region ranking or comparative claim becomes a real, requested feature** — needs its own
  honesty design (equal windows/bases, percent vs. absolute), not an extension of MS1.
- **Small multiples' real reachability should now be re-verified against a live benchmark answer**,
  not only the hermetic chart-spec tests — this is the same live-confirmation gap as the bullet above,
  from the chart-UX angle (row 14) rather than the parser angle (row 13).

## Consequences

- The query, chart, answer and audit layers can all now answer "one measure, a handful of NAMED
  regions, a period range" end to end, hermetically tested at every layer.
- Unlike ADR 054's `region_set`, **this capability is reachable by a real user question today** — the
  parser already emits the intent shape; nothing under `src/answer/intent/` needed to change.
- Small multiples (`#197` idea 8) has its first reachable path from a real CBS answer.
- The `multi_region_multi_period` refusal's wording is now honest for what it still refuses (a region
  class, or over-cap) rather than overclaiming the whole shape is unsupported.

**Verified:** `tests/query/region-series-resolve.test.ts`, `tests/query/region-series-run.test.ts`,
`tests/chart/region-series.test.ts` (6), `tests/answer/region-series-answer.test.ts` (13),
`tests/answer/compose-validate.test.ts` (89, 4 new), `tests/audit/region-series-r8.test.ts` (10),
`tests/audit/envelope-key-manifest.test.ts` + `tests/audit/region-set-r8.test.ts` (28), the
re-pointed `tests/query/query.test.ts`, `tests/answer/query-refusal-chips.test.ts` (9),
`tests/answer/region-set-answer.test.ts` (12). Full suite counts and per-task verification runs are in
the plan's "As-built notes" sections. Root `npm run typecheck` clean at every task. `npm run
audit:verify` against the live DB was **not run** in any hermetic worktree task (each task's own notes
say so) — reasoned correct from the code (this shape is forward-only, so every historical row's
`regionSeries ?? null` read is unaffected), but a session with DB access should run it once before
treating the whole plan as done.

**Pass-4 addendum (rows 12+13) verified:** `tests/answer/region-series-answer.test.ts` (16, 3 new —
qualified-label body content, per-line format, and a swapped-region-label rejection),
`tests/answer/compose-validate.test.ts` (92, 3 new — a `\n`-joined two-region body binds like a
semicolon-joined one; a swapped-region-label control fails; a CBS-qualified region label still binds),
`tests/audit/region-series-r8.test.ts` (13, 3 new — a pre-cutoff row with the old-shape body
reconstructs, the same body timestamped post-cutoff fails, a post-cutoff row with today's shape is
unaffected), `tests/audit/region-set-r8.test.ts` + `tests/audit/envelope-key-manifest.test.ts`
(28 total, unaffected, re-run clean). Root `npm run typecheck` clean. `npm run audit:verify`
against the live DB still **not run** (no DB access in this worktree either) — see
[open-questions #273](../open-questions.md) for the specific follow-up this addendum needs.

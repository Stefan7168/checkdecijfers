# ADR 060 — Two-measure charts: a zero-AI "Zet af tegen …" scatter on a CBS region-set answer

**Status:** accepted 2026-09-27 (session 137, owner present: picked the feature from four options, asked "What's best UX?" and
said "Go, build it" on the session's committed UX answer). **Built and merged** (session 137, Part 1 `3a0be206..89902c11`,
Part 2 `4998c7c9..ad96af3c`). Design: [superpowers/specs/2026-09-27-two-measure-scatter-design.md](../superpowers/specs/2026-09-27-two-measure-scatter-design.md);
plans: [part 1](../superpowers/plans/2026-09-27-two-measure-scatter.md), [part 2](../superpowers/plans/2026-09-27-two-measure-scatter-part-2.md).

**Relates to:** [open-questions #296](../open-questions.md) (scatter held session 120, un-held session 137), ADR
[054](054-region-set-query.md) (region-set query, the legs this pairs), ADR [029](029-follow-up-suggestion-chips.md) (the
zero-LLM chip carrier the doorway reuses), ADR [039](039-chart-presentation-panel.md) (one-measure form switcher; unchanged),
ADR [058](058-english-answers.md) (English answers; the scatter answer is English-at-render, no model call).

## Context

Every answer carried exactly one CBS measure. The most-requested chart shape journalists use for regional data — "how do two
figures relate across places" (a scatter, one dot per region) — needed a second measure per plotted point. Session 120 held it
(no measured demand, query layer one-measure-by-construction). With CBS down (#329) and the AI spend roof nearly used, the owner
chose it as the most valuable unblocked capability; it becomes much richer once the regional-statistics set (#329-blocked) adds
regional measures — the mechanism takes new `REGIONAL_KEYS` members with no code change. Today exactly one pair exists
(population on 1 January × average home sale price, per province / per municipality).

## Decision

1. **Doorway: a zero-AI click chip, not a parser change.** Under a CBS `region_set` answer a chip "Zet af tegen {measure}" is
   offered — first in the chip list, at most one — only after a dry-run of the pair serves (`echoServability` →
   `runPairQuery`, ≥ 3 paired regions). The click is taken through the existing chip carrier (ADR 029) with zero LLM calls and
   re-verified fail-closed at the click boundary (`validate-pending.ts`: strict `regionSet` + `pairWith` schema,
   `pairIntentProblem`, both keys in `REGIONAL_KEYS`). Typing "X tegen Y" as a question is NOT supported (needs an intent-prompt
   change + paid re-record) — a later phase only on measured demand (cheapest-mechanism rule).
2. **Intent:** one present-only field `pairWith?: IntentTarget`; `INTENT_SCHEMA_VERSION` stays 1. `resolveIntent`/`runQuery`
   refuse any paired intent, so nothing can silently answer one of the two measures; `runPairQuery` runs two ordinary
   region-set legs (y = the asked-about measure, vertical axis; x = the added measure).
3. **Two single-lineage results, joined by a pure function.** The envelope keeps `result` (y leg) and gains present-only
   `pairedResult` (x leg) and `scatter` (the spec); `chart: null`. `pairRegions` accounts for every region of both legs exactly
   once: a dot only when both cells carry a value; otherwise "left out" with each side's state and CBS reason, or "not
   applicable" (CBS `Impossible`, no cell on either side). Never imputed.
4. **Template-only text, no data value in the body.** Dutch body names the two measures, the region class and the period, and
   says the chart shows co-occurrence, not causation. Counts and left-out regions (with CBS reasons) live in the structural
   `scatterLine`; both legs' definition lines (`definitionLine`, `pairedDefinitionLine`) and attribution lines are shown. The
   body is NOT run through the single-result value validator (it carries no value); R1/R8 are held by re-deriving the spec and
   every text line byte-identically in `reconstruct.ts` (`checkScatterReconstruction`, which also re-checks the pair's own
   preconditions). No superlative in the text; extremes are only labelled on the chart, and only when both legs and the
   pairing are complete.
5. **A separate chart spec, not a new `ChartForm`.** `ScatterSpec` (`src/chart/scatter.ts`, strict zod) carries per-axis
   measure/unit/period/table/canonical key/sync date/attribution, the points (each with both result ids), labelled extremes,
   left-out regions and the region class. ADR 039's "scatter never offered" stays true for one-measure charts.
6. **UX (owner-approved):** asked-about measure vertical; an axis opens on a log scale when all values > 0 and max/min ≥ 100,
   marked in the axis title, one click back; ≤ 4 named extremes; a search box highlighting a region (size + outline, not colour
   only); swap axes; a table view; provisional points marked `*`; ticks are up to 5 REAL plotted values per axis (never
   invented round numbers). Log/swap/search are view state only.
7. **Staleness:** each leg is checked; a scatter warning names its table ("Let op: de tabel {id} ({measure}) …") so two
   warnings are never ambiguous; shown in the warning style directly under the coverage line on every surface. A recency
   question refuses if either leg is stale. A failing leg's refusal names that leg's measure (`QueryRefusal.pairedFrom` keeps
   the pair intent for the audit) and offers no retry chips.
8. **English:** no translate call for a scatter answer. English body, coverage line and definitions are built at render time
   from the stored Dutch-neutral spec (`web/lib/scatter-text-en.ts`, hand-written `ENGLISH_MEASURE_LABELS` /
   `ENGLISH_TOPIC_TERMS` by canonical key — never raw Dutch). The chip itself carries a deterministic `labelEn` ("Plot against
   population on 1 January") and is kept OUT of the English translation items of the region-set answer that offers it, so the
   live translate request of every answer without such a chip is byte-identical to before.
9. **Surfaces:** chat card (docked and undocked), thread replay, public embed (frozen, controls hidden, `?form=` and live
   re-run ignored), CSV (`web/lib/scatter-csv.ts`, ungrouped decimal-comma numbers per the WP21 CSV rule, plus region code and
   both cell ids per row, and the left-out block), the answer-proof/citation panel (both tables), Copy. PNG/SVG/PDF downloads
   carry the chart and attribution like the one-measure export (no coverage/staleness lines — same as today's export).
10. **Price:** the normal `simple` question price via `chargeAndRun`, refunded on refusal. No migration, no env flag.

## Alternatives considered

- **Parse "X tegen Y" from free text first.** Rejected for v1: an LLM-facing change with paid fixture re-recording and a new
  way to misfire, for a menu small enough to put on a button (cheapest-mechanism rule).
- **One merged result carrying both measures.** Rejected: every per-result rule (R1 lineage, R9 unit binding, attribution,
  CSV lineage) assumes one table per result; two ordinary legs keep them all unchanged.
- **Scatter as a new `ChartForm` of the one-measure spec.** Rejected: a one-measure spec has one value per point; it would
  reopen ADR 039's refusal for the wrong reason.
- **A trend line / correlation number.** Deferred: our own computation (needs a registered derivation and checks) and it
  invites causal readings; named extremes + search give most of the insight.

## Consequences / trade-offs

- Every CBS region-set answer runs one extra paired dry-run (two region-set queries) to decide whether to offer the chip.
- A too-few-pairs refusal at click time (data changed between offer and click, or a forged pending) is an internal refusal
  that alerts the owner — deliberately: it should not happen.
- Known, accepted limits: English withheld reasons are generic (app-wide, no English null-reason table); the provisional `*`
  marks the region, not the single value; the embed has no search/log/swap; dot labels keep CBS's "(PV)"/"(province)" suffix
  like the one-measure chart; the English source lines keep the Dutch CBS table title (app-wide convention).

## Revisit triggers

- The regional-statistics set lands → more pairs; check the chip's choice rule (first servable pair in registry order) still
  picks a sensible default, maybe offer a small menu.
- Logged demand for typed "X tegen Y" questions → the parser phase.
- Readers asking for a trend line / correlation → a registered derivation with its own checks.

## As-built (session 137)

Part 1 (backend, invisible) `3a0be206..89902c11`; Part 2 (user-visible) `4998c7c9..ad96af3c`. Built via subagent-driven
development: 7 tasks, a review after each, two final whole-branch reviews (opus). Real findings caught by the reviews and fixed
before merge: two different municipalities both labelled "Bergen"; a live embed that could have re-run a scatter as a
one-measure chart; the audit recording only the y leg's intent; an x-leg refusal naming the wrong measure; ambiguous
two-table staleness warnings; missing definitions; sparse ticks; Dutch measure names on the English card; the staleness
caution rendered as muted fine print; the chip entering the live English translation call. Verified: backend 3964 + web 3262
tests, hermetic benchmark 14/14 + 6/6 + 0 fabricated (template fallbacks 0), `audit:verify 1 400` unchanged (298 clean + 2
pinned + 36 redacted of 336 rows), a real browser pass on the local harness (Dutch + English, desktop + phone width: chip →
scatter answer, search, log, swap, table).

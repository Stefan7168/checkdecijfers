# Two-measure charts, first slice: "Plot against…" on a CBS region-set answer

**Status:** design APPROVED by the owner, session 137 (2026-09-27, in chat: "Go, build it" on the plain-English
design, after asking "What's best UX?" and accepting the session's committed UX answer — auto log scale, named
extreme dots + search, asked-about figure on the vertical axis + swap, no trend line in v1).
**Row:** [open-questions #296](../../open-questions.md) (un-held this session). **ADR:** 060 (written with the build).

## 1. What the reader gets

Under a CBS answer that covers a whole region class (ADR 054 `region_set`, e.g. "gemiddelde verkoopprijs per
gemeente in 2024"), a follow-up chip appears: **"Zet af tegen bevolking op 1 januari"** (English interface:
"Plot against population on 1 January"). One click, no AI, draws a **scatter chart**: one dot per region,
vertical axis = the figure the reader asked about, horizontal axis = the added figure, both for the same period.

- Hover a dot → region name + both values (formatted exactly as in answers, R3/R10).
- The most extreme places are labelled on the chart (highest and lowest on each axis, de-duplicated, at most 4).
- A search box highlights a region by name (client-side, over the regions on the chart).
- An axis whose values span ≥ 100× (all values > 0) opens on a **log scale**, the axis title says so, one click
  switches it back to linear. Default computed deterministically, so every surface opens the same way.
- "Swap axes" flips vertical and horizontal (view state only).
- A table view lists region | figure 1 | figure 2 (the accessible fallback, and the CSV).
- Works on every surface the normal chart works on: chat card, public embed, PNG/SVG/PDF download, CSV.
- Price: the normal `simple` question price via `chargeAndRun`, refunded on refusal (same as every chip take).

Not in this slice: typing "X tegen Y" as a chat question (needs an intent-prompt change + paid fixture
re-record — later, only on measured demand), scatter over own uploaded data (next slice), a trend line or
correlation number (our own computation, and it invites causal readings), colouring dots by province, chat
co-pilot edits of a scatter, saved view state (log/swap/search are not persisted to `chart_edits`).

## 2. Why this shape (decisions)

- **D1 — Doorway = a zero-LLM click chip, not a parser change.** The chip carrier (ADR 029 v2 / WP26
  `ClickOption`) already runs a fully resolved, dry-run-proven `StructuredIntent` without an LLM parse, re-verified
  fail-closed on the way back (`validate-pending.ts`), billed and audited like any answer. Cheapest mechanism first
  (CLAUDE.md): the menu of pairable figures is tiny and fully known in code.
- **D2 — Intent: one new present-only field `pairWith?: IntentTarget`.** `INTENT_SCHEMA_VERSION` stays `1`
  (the ADR 054 D1 reasoning: a bump would invalidate live embed tokens and in-flight pendings). The resolver
  accepts `pairWith` ONLY when: `regionSet` is set, exactly one period code, `derivation: 'none'`, and both
  `target` and `pairWith` are canonical keys in `REGIONAL_KEYS`, different from each other. Anything else refuses
  `invalid_intent` (sub-reason `pair_not_supported`). `validate-pending.ts` accepts the field under the same rule.
- **D3 — Two single-lineage results, not one merged result.** The envelope keeps `result` = the asked-about
  measure's ordinary `region_set` result (vertical axis) and gains **`pairedResult?: ValidatedResult`** = the
  added measure's ordinary `region_set` result over the same scope + period (horizontal axis). Each result keeps
  one table / one attribution, so every existing per-result rule (R1 traceability, R9 unit binding, R10, R11,
  attribution, CSV lineage) applies unchanged to each. Two separate queries through the existing `region-set.ts`
  roster resolution — the two tables may disagree on which gemeenten exist (03759ned 892 codes vs 83625NED 745),
  which the pairing step handles, never the roster step.
- **D4 — Pairing is a pure, re-derivable function** (`src/query/pair.ts`): join the two results' cells on
  `regionCode`. A region gets a dot only when BOTH cells carry a value. Every other region in either roster lands in
  exactly one bucket with its reason, per side: `notApplicable` (CBS `Impossible` — not part of the class at that
  period; not disclosed as "left out"), `withheld` (null with another CBS reason), `missing` (no row / not in the
  other table's roster). Output: `{ pairs: {regionCode, regionLabel, yResultId, xResultId}[], leftOut: {regionCode,
  regionLabel, side: 'y'|'x'|'both', reason}[] }`. Stored nowhere — recomputed from the two stored results by
  compose, chart build and audit reconstruction alike.
- **D5 — Same period, same grain.** The pair intent carries the answered result's single period code for both
  measures. A measure without a cell at that exact code is simply not offered (the chip's dry-run fails).
  Period labels are taken from each result's own cells (population's "1 januari 2024" vs price's "2024").
- **D6 — Offered only when proven.** A new chip generator `plotAgainst`, first in the generator list, runs only on
  a `region_set` answer, iterates `REGIONAL_KEYS` minus the answered key (registry order), dry-runs the full pair
  intent through the same `ServabilityCheck` the other chips use (extended to run both legs and require
  ≥ `SCATTER_MIN_PAIRS` = 3 pairs), and offers the first that passes. At most one scatter chip per answer (v1).
  Fail-open like every chip generator: an error means no chip, never a lost answer.
- **D7 — Template-only answer text** (ADR 054 D6 precedent: no phrasing model over hundreds of numbers). Dutch and
  English templates (English per the #332 deterministic-template pattern, no translate call). Body names the two
  figures, the period and the number of dots, e.g. "Gemiddelde verkoopprijs tegenover bevolking op 1 januari, 2024:
  342 gemeenten, één stip per gemeente. De grafiek laat zien hoe de twee cijfers samen voorkomen, niet dat het ene
  het andere veroorzaakt." Plus the labelled extremes with both values (every number bound to a cell of `result`
  or `pairedResult`), and a structural **left-out line** (outside the R1-scanned body, like `regionSetLine`):
  "Niet getoond: 12 gemeenten — 9 zonder verkoopprijs (CBS: geheim), 3 zonder bevolkingscijfer." naming up to 10
  regions, then "en N andere"; the full list is in the table view and CSV. Both attributions shown (two tables).
  No superlative beyond the labelled extremes, and those only when both results' coverage is `complete`
  (the RS1 rule, extended: an incomplete side means the "highest" might be a withheld one).
- **D8 — A separate chart spec, not a new `ChartForm`.** `ScatterSpec` (`src/chart/scatter.ts`, zod-validated,
  versioned) rides the envelope as **`scatter?: ScatterSpec`**; `chart` is `null` on these answers. The one-measure
  `ChartSpec`, `ChartForm` switcher and `allowedForms()` are untouched — ADR 039's "scatter never offered" stays
  true for one-measure charts (a scatter needs two measures; this is a distinct chart entity). Spec fields: both
  axes' measure label, unit, decimals, period label, attribution ref; `points: {regionCode, label, x, y,
  xFormatted, yFormatted, xResultId, yResultId}[]`; `labelled: regionCode[]` (≤ 4 extremes, only under the D7
  completeness rule); `defaultScale: {x: 'linear'|'log', y: 'linear'|'log'}` (log when min > 0 and max/min ≥ 100).
  Built deterministically from the two results (R6), rebuilt on reconstruction.
- **D9 — Rendering:** a new `ScatterView` web component (Recharts `ScatterChart`, same library and theming tokens
  as `ChartView`), used by the chat card, the embed page and the download/PDF path wherever they branch on
  `response.chart` today. English/Dutch strings in `web/lib/i18n/messages.ts`.
- **D10 — Audit (R8).** `pairedResult` and `scatter` are present-only envelope fields (JSONB, no migration).
  `reconstruct.ts` re-derives pairing, body, left-out line and scatter spec from the stored `result` +
  `pairedResult` and must byte-match; `npm run audit:verify` covers it; the envelope-key manifest test lists both
  keys. Refusal at click time (data changed since the dry-run) is an ordinary refusal row, refunded.
- **D11 — Chips on a scatter answer:** none in v1 (no follow-ups off a scatter).

## 3. Invariants at stake (docs/05)

R1 (every number and every dot traces to a cell of one of the two stored results), R3/R10 (shared formatter),
R6 (chart built deterministically from validated results), R8 (audit row before response; reconstruction
byte-identical), R9 (no causal/trend claim; template wording only), R11 (left-out regions with CBS's own reason;
provisional cells flagged), principle (c) (dry-run before offer; refuse at click if a leg no longer serves;
never impute a missing side).

## 4. Build order (plan follows in docs/superpowers/plans/)

1. Query: `pairWith` on the intent + resolver rule; `runPairQuery` (two legs); pure `pairRegions` (D4). Tests.
2. Chart: `ScatterSpec` + schema + builder (extremes, default scale). Tests.
3. Answer: compose (templates nl/en, left-out line, envelope fields), respond take-path, audit + reconstruct +
   envelope manifest. Tests + `audit:verify`.
4. Chips: `plotAgainst` generator, pair-aware `ServabilityCheck`, `validate-pending` acceptance. Tests.
5. Web: `ScatterView` (hover, extremes labels, search, log toggle, swap, table), wiring into chat card, embed,
   downloads/PDF, CSV; i18n. Tests + a real browser check on the dev server.
6. Docs: ADR 060, ADR 039/054/056 notes, 04-architecture, STATUS, open-questions #296.

Hermetic benchmark must stay 14/14 + 6/6 + 0 fabricated with template fallbacks 0 — the Dutch pipeline's prompts
and fixtures are not touched (no LLM-facing change anywhere in this slice).

## 5. Known limits, stated

Today only two regional canonical measures exist (`population_on_1_january`, `average_home_sale_price_by_gemeente`),
so exactly one pair is offerable until the regional-statistics set (blocked on the CBS outage #329) adds more —
the mechanism takes new `REGIONAL_KEYS` members with no code change. `all_landsdelen` stays unservable for
population (ADR 054 decision 2), so no chip there.

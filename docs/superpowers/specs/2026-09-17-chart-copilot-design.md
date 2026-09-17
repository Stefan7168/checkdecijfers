> **Naming note:** the competitor studied here is referred to as "Competitor G" throughout; its real name, URLs, people and investors are deliberately withheld because this repository is public. The owner knows which company is meant (owner instruction, 2026-09-18).

# Chart co-pilot — chat and direct controls on one chart, interleaved

**Status:** DRAFT spec, 2026-09-17, written in a read-only session for the owner (another session owns
the repo). Destination once approved: `docs/superpowers/specs/2026-09-17-chart-copilot-design.md`, an
ADR ("Chart co-pilot: one command log, two doorways, two trust tiers"), and open-questions #212 marked
"decided, scheduled". Companion research: `2026-09-17-competitor-g-deep-dive.md` (same folder).

**Owner's brief (in chat, 2026-09-17):** "Ik wil mensen de optie bieden om én te chatten én middels zulke
tools verder te optimaliseren, door elkaar heen, dat het echt een fijne UX is." And earlier the same day:
on their own data people get full freedom; on CBS/Eurostat data the existing honesty rules apply; stop
restating those rules for the own-data tier.

---

## 1. The experience, in one paragraph

A chart is on screen. Under it sits one small input, "Pas deze grafiek aan" ("Adjust this chart"), and beside the chart the
tools that already exist today (form switch, zoom, hide/highlight, notes, the Opmaak panel, templates,
colours, headline, insights). The person types "vanaf 2015 en alleen Utrecht en Amsterdam, dikkere lijn"
and the chart changes in one go; the reply is not a paragraph but a **recipe**: three chips, "Periode
2015–2024", "Reeksen: Utrecht, Amsterdam", "Lijndikte: dik", each with the same icon the panel uses, each
clickable to open that panel row. They then drag the zoom handle a year further, click a point to add a
note, and type "maak de kop korter". Every one of those six actions is a step in one history: ⌘Z steps
back through chat and click edits alike, each chat reply has its own Undo and Retry, and nothing typed
later throws away something clicked earlier. If the request is outside what the chart can do, the chip
says so and points at the doorway that can ("Annotatie → klik op een punt"), never "request a feature".

## 2. Why this shape (from the Competitor G hands-on, 2026-09-17)

Competitor G's chat is a co-pilot *next to* panels, which is right; but its steps are stateless (a second
prompt dropped the first prompt's filter and un-hid series), styling and annotations are unreachable
from chat ("I can't change the line thickness directly"), and its undo lost the title. The fixes are
structural: one vocabulary shared by chat and panel, edits applied as diffs on the current state, and one
command log that both doorways write to.

## 3. Architecture

### 3.1 One state, one log, two doorways

- **State:** the existing client `ChartViewState` (`web/lib/chart-view-state.ts`: form, hiddenKeys,
  highlightedKey, periodRange, presentation overrides, reading) plus notes (`chart-notes.tsx`) and the
  headline/caption text. The command log is persisted per account in `chart_edits` from phase 1 (owner decision, §7); the embed already
  serialises this state.
- **Commands:** every edit becomes a small serialisable `ChartCommand` (`web/lib/chart-commands.ts`, pure,
  no React): `{ id, at, source: 'panel' | 'chat' | 'canvas', kind, params, description }`. `apply(state) →
  state` and `invert(state) → command`. The reducer's existing actions (`setForm`, `toggleSeries`,
  `setHighlight`, `setPeriodRange`, `setPresentation`, `resetPresentation`, `setReading`) become command
  kinds; new kinds: `setNote`, `removeNote`, `setHeadline`, `setCaption`, `applyTemplate`, and for the
  own-data tier the instruction fields (`setFilters`, `setSeriesBy`, `setSort`, `setLimit`, `setAggregate`,
  `setDerived`).
- **History:** `ChartHistory` = `{ past: Command[], future: Command[] }` per chart instance; one gesture =
  one entry (drags dispatch `transient: true` and `seal()` on release, the Competitor G's SDK's own contract).
  ⌘Z/⇧⌘Z wired at the chart card; a small "History" popover lists entries with their source icon.
- **Doorway A — panel/canvas:** today's controls dispatch commands instead of reducer actions (a
  mechanical rewrite; the honesty locks in `resolvePresentation` keep running per render exactly as now).
- **Doorway B — chat:** the input under the chart sends `{ message, chart context }` to one route; a
  cheap-tier model returns a **command list** constrained by a JSON schema that enumerates *only* what
  this chart offers right now (see 3.3); deterministic code validates every command against the live
  state and dispatches the survivors; the reply is the list of applied commands (chips) plus one plain
  sentence per rejected item naming the click path.

### 3.2 Two trust tiers, one surface

| | Own data (upload / paste / sheet, ADR 037) | CBS / Eurostat |
|---|---|---|
| Chat may change | everything: columns, filters, series, sort, limit, **aggregate, derive**, form (all forms), style, notes, title/caption | form (within `lineFormAllowed`), period range, hidden/highlighted series, style keys, template, note text at a plotted point, headline/caption text |
| Numbers | computed by our deterministic executor from the user's stored rows (never by the model) | never touched; chart is a verbatim projection of validated cells (R6), provisional marks stay (R11) |
| New data | "add column X" is a data question → the existing instruction path re-runs | "en Amsterdam erbij" is a new question → existing follow-up path (ADR 021), reply shows "Grafiek uitgebreid" and the new series joins the same card when the result is compatible; otherwise a new card |
| Refusals | none for style/data; only "not chartable" | the existing refusal copy, one line, with the offer chips |

The own-data tier extends `src/attachments/instruct/schema.ts`: drop `unsupported.reason: 'aggregation' |
'computation'` and add `aggregate` (sum/mean/min/max/count over a group) and `derived` (a named column
from a closed set of expressions: difference, percent-of-total, percent-change, ratio of two columns).
The executor (`execute.ts`) computes; the model only selects. Internet findings never become chart data
(ADR 032), so there is no third tier.

### 3.3 The chat contract (both tiers)

Request: `{ message, tier, chartId, capabilities }` where `capabilities` is generated from the live
chart: the applicable presentation keys and their allowed values (`resolvePresentation().applicable`),
series keys with labels, the period bounds, the allowed forms, template ids, and — own-data only — the
column profile. Response schema: `{ commands: ChartCommand[], refused: { request: string, reason:
'not_available' | 'not_on_this_chart' | 'needs_click', hint: string }[], text?: string }`. `text` is only
used for the two narrate kinds (headline, caption) and passes the existing digit scan (every number in it
must be a plotted value). Routing: no separate classifier; the message goes to the chart co-pilot only
when the input under a chart is used. The main composer stays the question path.

Cost: one cheap-tier call per chat edit; zero for panel edits; a rule-based **chart-fit scorer**
(`web/lib/chart-fit.ts`, no model) ranks forms for "welke vorm past" and is the gate for pie/stacked
(disqualified unless the parts form a complete whole, the RS1 logic).

## 4. UX details that make it feel like one thing

- Input placement: directly under the chart card, above the notes strip; on phones it collapses to a
  chip "Pas deze grafiek aan".
- Recipe chips: icon + label + value, same icons as the panel rows; click → opens that panel row with the
  value selected. Rejected items render as a grey chip with the hint.
- Suggested prompts (three chips, deterministic, from chart state): "Alleen de laatste 5 jaar", "Zet
  <hoogste reeks> in de schijnwerper", "Maak de kop korter".
- Per reply: Undo · Retry · 👍/👎 (logged, no model call).
- Streaming: show chips as they validate; total wait target under 4 s.
- Language follows the app switch (ADR 040); CBS terms stay Dutch.
- Everything the chat did is visible in the panel afterwards (the panel is a view over the same state),
  which is the "stronger connection" Competitor G says it still wants.

## 5. Phases (cheapest first)

1. **Command log + undo/redo + in-place title/caption editing + account persistence** — no model; one
   numbered migration for `chart_edits` (owner-supervised), no LLM cost. Rewrite
   panel dispatches to commands; add history popover; ⌘Z. Unlocks everything else.
2. **Own-data chat co-pilot** — widen the instruction schema (aggregate/derive/all forms/style/notes/
   narrate), reuse the existing refinement referent (`replay.ts` `lastChartState`) as the command log's
   seed; flip `ATTACHMENTS_ENABLED` (owner step) once the e2e passes.
3. **CBS/Eurostat chat co-pilot** — same route, selection-only schema built from `capabilities`; the
   "Grafiek uitgebreid" presentation of compatible follow-ups.
4. **Storytelling primitives reachable from both doorways** — goal line (user value), average line
   (server-derived, traced), difference arrow (registered derivation), dim-not-hide, era shading,
   headline number.
5. **Chart-fit scorer + new forms** — stacked, 100% stacked, dumbbell, slope, heatmap, scatter, pie/donut.

## 6. Invariants and tests

- R1/R6/R11 untouched by construction for the CBS tier: commands never carry numbers; `windowSpec()` stays
  a verbatim copy; the digit scan runs over narrate output.
- Property test: for any command list, `apply` then `invert` returns the original state (fast-check).
- Contract test: every chip the chat can emit corresponds to a panel control (no chat-only capability).
- e2e (Playwright, hermetic harness): type → chips → panel shows the same values → ⌘Z → panel reverts;
  own-data: "totaal per regio, hoogste eerst" → executor output equals a hand-computed fixture.
- Benchmark 14/14 + 6/6 + 0 fabricated stays the gate; chat edits never write audit rows.

## 7. Owner decisions (given in chat, 2026-09-17)

1. **Derived columns on own data: the fixed set** — difference, share of total, percent change, ratio of
   two columns, sum/mean/min/max/count per group. Free arithmetic is a later phase, only if the logged
   "could not do" requests show demand.
2. **CBS chart edits are saved in the account from the start** (owner's call, overriding the
   per-visit-first recommendation). Concretely: a `chart_edits` table keyed by (user, chart/answer id)
   holding the serialised command log + a `updated_at`, written by the same dispatcher both doorways use,
   restored when the answer is reopened, covered by the monthly GDPR purge (retention leg), and applied via
   a numbered migration that the owner runs supervised (live DDL). This moves persistence into **phase 1**;
   the embed keeps serialising the same state.
3. **Input label: "Pas deze grafiek aan" / "Adjust this chart"**, with three deterministic example chips
   under it.

## 8. Still open (for the build session, not the owner)

- Exact shape of the `capabilities` payload and how the JSON schema is generated per tier.
- Whether `chart_edits` also stores notes' free text (yes by default; it is user content, own tier).

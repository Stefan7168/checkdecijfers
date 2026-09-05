# Chart ideas 4, 6, 8 — design (session 79, 2026-09-05)

Source: [session-briefs/2026-09-02-session-69-chart-ux-research.md](2026-09-02-session-69-chart-ux-research.md) §2, ideas 4/6/8 (1-3 already shipped, per [open-questions #197](../open-questions.md)). Owner picked these three to scope next; brainstormed in-chat before this doc was written, per `CLAUDE.md`'s brainstorming process. Grounded directly in `web/components/chart.tsx` (803 lines) as it exists today, not in the research brief's one-line descriptions, which turned out to understate idea 4's scope (see §3).

**Scope discipline (ADR 014's optional-v1-field rule applies to all three):** an addition is safe as an *optional* field only if (a) `buildChartSpec` never emits it for existing result types so stored/reconstructed specs stay byte-identical, (b) every already-stored v1 spec still validates unchanged, and (c) a renderer that ignores the field still draws an honest chart. Ideas 6 and 8 need no spec change at all (pure `web/` rendering/interaction state) and trivially satisfy this. Idea 4 needs one new optional field and must be checked against all three conditions before it ships (see §3).

## 1. Idea 6 — hide/show a series

**Current state:** the chart's legend (`chart.tsx:32,678,735`) is Recharts' stock, unconfigured `<Legend />` — decorative, no click handling. Series colour comes from a fixed `SERIES_COLORS` array indexed by position (`chart.tsx:67-74`), not from anything in `ChartSeries` (`src/chart/types.ts:44-48`, which carries only `label`/`regionCode`/`points`).

**Binding constraints already decided (open-questions [#46](../open-questions.md), not re-litigated here):**
- A visible "N van M reeksen verborgen" line must appear whenever ≥1 series is hidden — an explicit toggle is not the R6 silent-omission problem, but it must never look like the full picture in a screenshot.
- Hidden/shown state is client-side only — it never touches the stored `ChartSpec` or the audit record.
- Export bakes in whatever's on screen (session 69's already-adopted default) — the disclosure line goes into the same `attributedSvgMarkup()` footer text (`web/components/chart-download.tsx:33`) that already carries attribution, not a new export mode.

**Approach:** replace the stock `<Legend>` with a small custom HTML legend — one real `<button>` per series, not Recharts' native click-to-toggle legend. Recharts' own legend-click would be technically cheaper, but a plain `<button>` per entry is the only way to get this codebase's own established bar (real button semantics, accessible name, ≥24px touch target — session 69's step 1 precedent) without fighting Recharts' internals.

- **State:** `hiddenKeys: Set<string>` as local `useState` inside `ChartView`, initialized empty on every new `spec` (no persistence — matches #46(b) and session 69's "no user-adjustable state persisted yet" default).
- **Key:** series index (`s${i}`, already used internally by `buildRows`, `chart.tsx:98`) — not `regionCode`, since that's `null` for a plain national single-series line and wouldn't be unique/stable enough on its own.
- **Rendering:** a hidden series is filtered out of the `<Line>`/`<Bar>` mapping (`chart.tsx:694-707`, `:736-750`) but its legend button stays, visually dimmed (not removed) with `aria-pressed` reflecting hidden state.
- **Disclosure line:** rendered directly under the chart whenever `hiddenKeys.size > 0`, e.g. "2 van 4 reeksen verborgen" (exact copy TBD at implementation, not a design blocker).
- **Testing:** a new pin alongside the existing 27 real-svg jsdom tests (`chart.tsx`'s existing test file) — hide one series, assert it's absent from the rendered `<Line>`/`<Bar>` set and the disclosure line appears; hide all, assert the disclosure says so and the chart area still renders honestly (axes, no crash) rather than blanking.

## 2. Idea 8 — small multiples (manual toggle)

Per your answer: **manual**, not automatic — always available as a switch, not triggered by a series-count threshold.

**Current state:** exactly one shared `<LineChart>`/`<BarChart>` per spec today, one shared `XAxis`/`YAxis`, all series mapped into it in one pass (`chart.tsx:694-707`/`:736-750`) inside one `<ResponsiveContainer>` (`chart.tsx:660`). No per-series layout precedent exists anywhere in `web/components` or `src/chart`.

**Approach:** a new sibling component, `ChartSmallMultiples`, rendered by `ChartView` instead of the single combined chart when the toggle is on. It reuses the existing pure, spec-only helpers per series rather than re-deriving anything: `buildRows(spec)` (`chart.tsx:90-124`), `seriesStyle(index)` (`chart.tsx:70-74`), `valueLabelPlan(spec)` (`chart.tsx:191-243`), `annotationMarkers(spec, rows)` (`chart.tsx:134-146`) — filtered per series rather than called once for all.

- **Trigger:** a "Kleine grafieken" toggle next to the existing Grafiek/Tabel switch, visible only while in Grafiek view (Tabel is unaffected and needs no small-multiples equivalent — it's already one row per series).
- **Axis mode:** a second switch, "Gelijke assen / Eigen assen," visible only while small multiples is active — shared y-domain across all mini-panels vs. each panel scaled to its own data. Default: **gelijke assen** (equal axes), since that's the one that makes cross-series comparison honest — "eigen assen" is the opt-in for when one series's scale would otherwise flatten the others.
- **Layout:** a CSS grid of panels, one per series, each a smaller `<ResponsiveContainer>` reusing the same `<Line>`/`<Bar>` rendering logic as the combined chart, just fed one series' `rows` at a time.
- **Interaction with idea 6:** a series hidden via the legend toggle removes/greys its whole panel here rather than leaving an empty one.
- **Testing:** a new test file (`chart-small-multiples.test.tsx` or similar) rendering a 3+ series spec, asserting one panel per series, the equal/own-axes switch changes each panel's computed y-domain, and a hidden series (idea 6) removes its panel.

## 3. Idea 4 — takeaway headline (bigger than it first looked)

**Correction to the research brief:** its line "IS #89 (already approved), placed on the chart" bundles two different things. Only one of them already exists.

- **Already exists, directly reusable:** the *explainer* half (definition, period meaning, what "voorlopig" means) is exactly [#89](../open-questions.md)'s existing mechanism — `buildAnswerProof` (`web/lib/answer-proof.ts`) + `AnswerProof` (`web/components/answer-proof.tsx`), shipped 2026-09-03 (PR #123). Reuse as-is on the chart.
- **Does NOT exist yet:** the *headline sentence itself* ("Bevolking steeg gestaag sinds 2015"). `direction`/`first_last` derivations are computed and pre-registered today (`deriveDirection`, `deriveFirstLast`, `src/query/derivations.ts:107-138,211-229`), but nothing turns them into a Dutch sentence deterministically. `src/answer/compose/template.ts` explicitly declines to (`template.ts:100-102`: *"Trend prose is the LLM path's job... the template only states what the cells state"*) — the only existing primitive is a 3-word dictionary (`TREND_WORD_BY_DIRECTION`, `prompt.ts:39`) used purely as an LLM phrasing hint, not a formatter.

**Approach:**
1. A new deterministic formatter, `renderTrendHeadline(derivation): string`, in the same style and file as `template.ts`'s existing `renderDifference`/`renderMax` — template-only, no LLM, matching your own stated leaning in the original research brief (decision 6: "AI doesn't decide what's noteworthy"). Covers the `direction` shape (up/down/flat + `netChange`) first; `first_last` can follow as a second sentence shape if wanted, not required for v1.
2. **Schema change, small and additive:** `ChartAttribution` (`src/chart/types.ts:53-60`) gets one new optional field, e.g. `trendHeadline?: string` — computed once in `buildChartSpec` (`src/chart/build.ts`) from the result's own registered derivation, alongside the other display strings it already builds (per the file's own header comment: "Display strings are built once, here"). Checked against ADR 014's three conditions: (a) old code paths that don't have a relevant derivation simply don't set it — byte-identical; (b) every existing stored spec has no `trendHeadline` key and still validates against `src/chart/schema.ts` unchanged (optional field); (c) `chart.tsx` renders nothing extra when the field is absent — an old renderer or an old stored spec still draws an honest chart. All three hold — no `schemaVersion` bump needed.
3. **Placement:** the headline renders as a short line directly under the chart (above the legend/toggles), with the #89-style info icon next to it opening the reused `AnswerProof` explainer panel for definitions.
4. **Testing:** unit tests on `renderTrendHeadline` covering up/down/flat/no-derivation (returns `undefined`, renders nothing); a `chart.tsx` render test confirming the headline text appears when `trendHeadline` is present and the layout is unchanged when it's absent (the ADR-014 byte-identical-for-old-specs check, made concrete as a test).

**Sequencing recommendation:** build 6 and 8 first (pure `web/`, fully independent of each other and of 4, lower risk, no schema touch) before 4 (the only one crossing into `src/chart/`).

## Open points carried into implementation (not blocking this design)

- Exact Dutch copy for the "N van M reeksen verborgen" disclosure and the small-multiples axis-switch labels — implementation detail, not a design fork.
- Whether `renderTrendHeadline` also needs a `first_last`-shaped sentence in v1 or can ship `direction`-only first — leaning: `direction`-only for v1, `first_last` is a cheap follow-up once the pattern exists.

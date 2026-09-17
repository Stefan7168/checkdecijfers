# ADR 041 — Insights: AI-phrased outlier findings, replacing Story mode's selection

**Status:** accepted, 2026-09-10 (session 94, owner present) — built as described below.

## Context

The owner asked (session 94, in-chat) to replace Story mode's content: "Current story mode sucks, let's change that to have 'Insights' that are created by the AI, with the top 3-5 most interesting findings / 'uitschieters' from the data, which could potentially be interesting for the journalist to report on." Story mode as built (session 92, ADR — none dedicated; spec [superpowers/specs/2026-09-09-story-mode-and-embed-design.md](../superpowers/specs/2026-09-09-story-mode-and-embed-design.md) Part A) selects chronological Start/Highest/Lowest/Latest points and phrases them from a fixed Dutch template (`web/lib/chart-story.ts`'s `buildStorySteps`) — no ranking by how "interesting" a point actually is, no AI phrasing at all. The session's own earlier "next level" visual plan ([session-briefs/2026-09-10-visual-next-level-plan.md](../session-briefs/2026-09-10-visual-next-level-plan.md), line 503) explicitly listed "LLM captions" as **not proposed, conditional on an owner ask** — this is that ask.

Two invariants constrain the design: principle (a) — the LLM never computes or selects which points are interesting, it only phrases already-validated results; and R3 — a served number must be verbatim-traceable, never fabricated. The core answer pipeline (`src/answer/compose/`) already proves a mechanism for exactly this shape of problem: `slots.ts`'s digit-free placeholder phrasing, where a fabricated number is not merely caught by a validator but **unrepresentable** (the model cannot emit a digit at all; deterministic code fills every value afterward).

## Decision

1. **Selection stays 100% deterministic, in a new module, not chart-story.ts.** `src/chart/insights.ts`'s `scoreFindings(spec)` ranks every plotted point (and every period-over-period step, as a "jump") by a z-score against the series' own mean/spread, always guarantees the series' genuine high/low rank at least on par with a real jump, dedupes to one finding per point, and caps at 5 (`INSIGHTS_MAX_FINDINGS`). Every field on a `ScoredFinding` (period, value, unit) is a verbatim projection of the spec's own already-formatted strings — R1/R6 unchanged.
2. **Backend placement, not web/lib (chart-story.ts's own precedent).** Unlike Story mode, Insights has two independent callers that must never disagree on which points are interesting: the client's instant synchronous render (`web/lib/chart-insights.ts`, a thin i18n wrapper attaching a translated title + template caption) and the server action's LLM payload (re-derived from the same spec, never trusted from client-sent finding data — `prompt.ts`'s existing R2 discipline: "keep user-typed text out of the phrasing prompt"). Putting the pure scoring function in `src/chart/insights.ts` lets both sides import the SAME algorithm (frontend via the `web/backend` symlink), rather than risking two hand-maintained copies drifting apart.
3. **AI phrasing via the slot-filling pattern, not the legacy see-and-echo validator.** `src/chart/insights-phrase.ts` mirrors `answer/compose/slots.ts`'s mechanism (closed per-finding placeholder menu, zero digits outside a placeholder, Dutch word-form rejection reused verbatim from `format.ts`/`validate.ts`) rather than adapting the 1000+-line `ValidatedResult`-coupled validator — a chart finding has no query cells/derivations to bind against, so a finding's own slots are its whole closed menu. One LLM pass over every finding, ONE stricter retry over only the findings still missing a valid sentence, structured JSON output (`z.toJSONSchema`, mirroring `semantic-check.ts`'s own pattern) rather than delimited free text.
4. **Per-finding fail-closed, not whole-batch.** A finding whose AI sentence fails validation twice simply has no entry in the returned map — chart.tsx's own deterministic caption (already rendered, synchronously, before any server round-trip) is the floor for that finding. This is a STRONGER guarantee than the answer pipeline's own template floor: the fallback is never even a separate code path invoked on failure, it is what was already on screen.
5. **Fired on open, not eagerly.** `chart.tsx`'s `openStory()` calls the new `generateInsights` server action only once per findings set, only when the panel is actually opened — cheapest-viable-mechanism (CLAUDE.md convention): a chart nobody inspects never spends a token.
6. **Dutch phrasing regardless of chart display language.** The server action always receives the RAW (untranslated) spec — matching the core answer pipeline's own Dutch-only convention (CLAUDE.md: UI chrome may be English, backend-composed prose stays Dutch). Finding ids are translation-invariant (built from `periodCode`/`kind`/`seriesKey`, never a label), so they still map back onto the client's own translated-spec-derived findings correctly.
7. **The existing panel shell (`chart-story.tsx`'s `ChartStoryTrigger`/`ChartStoryPanel`) is untouched.** Only the content source changed — `StoryStep.kind`'s type was widened to also accept `FindingKind` (both unused for control flow anywhere in the panel or chart.tsx, confirmed by grep before widening); everything else (keyboard nav, dots, intersection-observer scroll-sync, point-ring/series-highlight wiring, the locked-controls-while-open behavior, snapshot restore) is the same proven, tested mechanism Story mode already had.
8. **No rate limit, no credit cost, v1.** Authenticated-only (mirrors every other server action), click-triggered, runs on `PHRASING_MODEL` (Haiku, already the cheapest tier), short response. Deliberately not wired into the `chart_style_usage` counter table (a different event's table by name and purpose) or a new one — marked as an assumption, revisit with measured usage per CLAUDE.md's escalate-on-evidence convention.

## Alternatives considered

- **Reuse `answer/compose/validate.ts`'s full digit-scanning validator directly.** Rejected: it is built around `ValidatedResult`'s cells/derivations/regions — a chart finding has none of that structure, and adapting the validator would mean either loosening it (risk) or duplicating ~1000 lines of adversarially-hardened logic for a different input shape. The slot-filling mechanism (already proven, already in this codebase, behind its own flag) is the right-sized tool: it needs no fabrication detection at all, since fabrication is structurally impossible.
- **Free-text phrasing with a see-and-echo validator (the legacy `compose.ts` rung), scoped to findings.** Rejected for the same reason as above, plus: it would need its OWN bespoke `AllowedNumbers`-equivalent per finding, more code than the slot approach for less safety margin.
- **No AI at all — just improve the deterministic captions.** This was the CLAUDE.md "cheapest viable mechanism" default, but the owner explicitly asked for AI-generated phrasing by name; principle here is that an explicit owner instruction is the owner's call to make, not something the default overrides.
- **Keep `buildFindings` (selection) in `web/lib/chart-insights.ts` only, no backend module.** Rejected once the server-action design was worked through: the backend needs its own copy of "which points are interesting" for the LLM payload, and trusting client-sent finding data in a prompt would reopen the injection surface `prompt.ts` deliberately closed. A shared backend function is the only way to guarantee the two sides can never disagree.
- **Delete `chart-story.ts`'s old selection functions (`buildStorySteps` and its three branch helpers) in this same change.** Considered and deferred: they are now dead code (nothing calls them), but cleanly removing them means also rewriting/deleting `chart-story.test.ts` (302 lines) and pruning now-orphaned i18n keys — real, mechanical, low-risk work, but separable from shipping the feature correctly. Tracked in [open-questions.md](../open-questions.md) as a follow-up, per CLAUDE.md's "spin off out-of-scope hygiene as task chips."

## Consequences

- `chart-story.ts`'s `StoryStepKind`/`StoryStep` types are now shared between two producers (the orphaned `buildStorySteps` and the live `chart-insights.ts`); its own selection functions are unreachable from the app but still compile and are still covered by their own test file — a known, tracked, not-yet-paid-down cleanup debt (see open-questions.md), not a silently-forgotten one. **As-built, session 102 (2026-09-15):** paid down — `buildStorySteps`/`timeSeriesSteps`/`multiSeriesSteps`/`comparisonSteps`/`exploreStep`/`STORY_MAX_SERIES_STEPS` and `chart-story.test.ts` deleted, the eleven orphaned i18n keys removed (both languages); `StoryStepKind`/`StoryStep` themselves untouched, still the shared type. PR #25, CI green, not yet merged.
- The Story/Insights trigger's threshold changed from "≥3 steps" (session 92: every OLD step counted, including the non-data overview/explore filler) to "≥1 finding" (session 94: every Insights finding is real content) — a short chart that previously showed no trigger at all may now show one with 1-2 findings.
- On an English-displayed chart, the deterministic fallback title/caption is English but an AI-phrased upgrade (once it lands) is Dutch prose — a known, accepted mixed-language limitation for v1, not a defect in either language path individually.
- A new LLM call path exists (`PHRASING_MODEL`, same tier the answer pipeline already uses) with no server-side spend cap — acceptable today (click-triggered, cheap tier, short responses) but worth a counter if usage ever makes it worth the schema cost.
- `docs/superpowers/plans/2026-09-09-story-mode-and-embed-design.md`'s original session-92 selection description is now historical (Story mode's PRESENTATION shell it describes is unchanged; its SELECTION description is superseded by this ADR) — not edited in place per this repo's doc-freshness convention (superseding notes, not silent rewrites); this ADR is the source of truth for the current selection/phrasing mechanism.

## Revisit triggers

- Real usage data suggesting Insights generation needs a rate/spend cap (mirror `chart_style_usage`'s `brand_fetch` counter pattern).
- ~~The `chart-story.ts` cleanup follow-up actually getting picked up~~ — **done, session 102 (2026-09-15), PR #25** (see the Consequences section above for what was actually deleted).
- A request to phrase Insights in the chart's own display language rather than always Dutch — would need a second (English) system prompt in `insights-phrase.ts`, mirrored word-form/validation rules, and its own fixture/eval coverage.
- The big "Story stage" (3D/scroll full-screen presentation, [session-briefs/2026-09-10-visual-next-level-plan.md](../session-briefs/2026-09-10-visual-next-level-plan.md) §3) reusing `buildStorySteps`/`storySteps`/`storyIndex` unchanged, per that plan's own text — it should reuse `chart-insights.ts`'s findings instead once built, the same swap this ADR made.

## Session 110 addendum — extreme labels only on the actual extreme

**Context (2026-09-17, session 110 UX audit, row #19).** The audit found the Insights carousel labelling
two consecutive cards "Notable low" on the same chart: `2020: 1,3 %` and `2021: 2,7 %` — the second was a
*rise* over the first, not a low. The root cause, as originally built: `candidatesForSeries`'
(`src/chart/insights.ts`) and `comparisonCandidates`' kind assignment used `p.value >= mean ? 'recordHigh'
: 'recordLow'` — i.e. ANY point above/below the series' (or, for a bar chart, the cross-series) own mean
was labelled a "record", not only the point that actually IS the series' minimum/maximum. For a
fact-checking product, an outlier label on a non-outlier is a credibility risk (this is exactly the
"needs a design decision" framing row #19 used, not a mechanical bug — R9 requires a ranking/extremity
claim to match the data).

**Decision.** `recordHigh`/`recordLow` are now reserved for the series' (or cross-series, for a bar
chart) actual maximum/minimum point only — the same `high`/`low` values `candidatesForSeries`/
`comparisonCandidates` already computed for scoring purposes (`isRecord = p === high || p === low`) are
now also used to decide the KIND, not just the score floor. A tie resolves to the earliest occurrence,
matching the pre-existing `>`/`<` reduce that picked `high`/`low` in the first place — no new tie-break
logic was introduced. Two new `FindingKind` values, `aboveAverage`/`belowAverage`, cover every other
point that still ranks (a real z-score against the mean) but is not the actual extreme — titled "Above
average"/"Below average" (EN) and "Boven het gemiddelde"/"Onder het gemiddelde" (NL) in
`web/lib/i18n/messages.ts`, wired through `web/lib/chart-insights.ts`'s `TITLE_KEY` map exactly like the
existing four kinds. No new number is computed or displayed: a `belowAverage`/`aboveAverage` finding
still only shows the point's own already-formatted value (R1/R3 unchanged by construction), and the
series/cross-series mean itself is still never displayed (it wasn't before this change either — checked,
`chart-insights.ts`'s caption builders never render `mean`). The AI-phrasing system prompt
(`src/chart/insights-phrase.ts`, rule 7) was updated to tell the model `aboveAverage`/`belowAverage` may
not be phrased as a record/outlier/extreme, mirroring the same distinction.

**As-built.** `src/chart/insights.ts` (kind assignment in both `candidatesForSeries` and
`comparisonCandidates`), `src/chart/insights-phrase.ts` (system prompt rule 7),
`web/lib/chart-insights.ts` (`TITLE_KEY`), `web/lib/i18n/messages.ts` (4 new keys, nl+en). Test coverage:
new `tests/chart/insights.test.ts` pins "at most one `recordHigh`/one `recordLow` per series" and that a
below-mean non-minimum point is `belowAverage` (plus a case showing this invariant holds even when a
competing jump — a pre-existing, unrelated dynamic — outscores the level record at the same point);
`web/lib/chart-insights.test.ts`'s existing `fourPointSpec` case updated (its 2021 point, below the
series mean but not the series minimum, now asserts `belowAverage` instead of the previous, overclaiming
`recordLow`) plus new title-text assertions in both languages.

## Session 110 addendum (audit pass 2, row 14) — disambiguating same-kind step names by period

**Context (2026-09-17).** The addendum above fixed WHICH kind a finding gets; a second-pass audit found
that the Insights carousel's and the Story stage's "position" dots still name every step by kind alone
(`aria-label` = `step.title`) — two `belowAverage` findings on one chart (e.g. 2021 and 2024) produce two
buttons with the IDENTICAL accessible name. A sighted reader tells them apart by the caption text next
to each dot; a screen-reader user hitting the dot list alone cannot.

**Decision.** Append the finding's own period to the ACCESSIBLE name only — `"Below average — 2021"` —
leaving the visible dot (a plain coloured circle, no text) and the caption cards unchanged.
`web/lib/chart-insights.ts`'s `Finding.point` now also carries `periodLabel` (alongside the pre-existing
`seriesKey`/`periodCode`), and a new exported `stepAccessibleName(step)` builds the string, falling back
to the title alone for a step with no point (`overview`/`explore`, never duplicated by kind).
`chart-story.ts` (the shared `StoryStep` type) and chart.tsx's `storySteps` mapping were both out of this
fix's file scope, so `stepAccessibleName`'s parameter is a small duck-typed shape (`{title, point:
{periodLabel?}}`), not an import of `StoryStep` — avoiding a circular type-only import back into
chart-insights.ts. chart.tsx's existing `point: f.point` assignment forwards the extra field by
reference unchanged, so it reaches every real `StoryStep` at runtime despite the type never declaring it.

**As-built.** `web/lib/chart-insights.ts` (`Finding.point.periodLabel`, `stepAccessibleName`),
`web/components/chart-story.tsx` and `web/components/chart-story-stage.tsx` (both dot lists now call
`stepAccessibleName` instead of reading `step.title` directly). Test coverage: `stepAccessibleName` unit
tests plus the updated `buildFindings` point-shape assertion in `chart-insights.test.ts`; a dedicated
two-same-kind-findings test in both `chart-story.test.tsx` and `chart-story-stage.test.tsx` asserting
distinct `aria-label`s and an unchanged visible card/caption.

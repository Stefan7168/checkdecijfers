# Own-data chart-fit + verified-whole parity — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development to implement
> this plan task-by-task, ONE implementer at a time. `web/components/user-chart.tsx` is this app's
> own-data sibling of `web/components/chart.tsx` — the same kind of large file with its own tab strip and
> shared render tree that session 116 found genuinely fragile under concurrent edits on the CBS side. Every
> task in this plan touches it. Keep the whole plan sequential. Steps use checkbox (`- [ ]`) syntax for
> tracking.

**Goal:** Bring the own-data ("eigen data" / attachments) chart card to parity with two capabilities the
CBS/Eurostat card already has, in two structurally different ways:

1. **Chart-fit trio (dumbbell, slope, heatmap)** — a straight port. These forms are honest by
   construction (nothing computed, every drawn number is a value the chart already has) and their guard
   functions are already generic over series/points shape, not CBS-specific. Own-data gets all three,
   panel + chat.
2. **Pie / stacked / 100%-stacked** — NOT a port, by deliberate product decision. CBS's version
   (`docs/decisions/056-chart-copilot.md`, "Phase 5b") only ever offers these forms when the chart's
   regions are a complete, CBS-registry-known roster, verified server-side against a real published total.
   Own-data has no registry and no independent total to check against — building the same mechanism is
   structurally impossible, not just unbuilt. Instead: these three forms become **unconditionally
   available** for own-data (no gate), always carrying a visible, honest note about what has and hasn't
   been checked. The reader can optionally click one point on their own chart to designate it "the total,"
   which runs a **real arithmetic check** (parts vs. that reader-designated cell) using the exact same
   tolerance/verification function CBS's tier already trusts — just fed a reader-declared cell instead of
   an independently CBS-audited one. A mismatch is reported, never hidden — own-data doesn't refuse the
   reader's own chart the way CBS refuses an unverifiable one, because a mismatch here just as plausibly
   means the reader filtered a row on purpose as that something is wrong.

No CBS/Eurostat code changes in this plan — `web/components/chart.tsx`, `src/chart/copilot/*`,
`src/query/whole-verification.ts` are consumed (imported), never modified.

**Architecture:**
- The chart-fit trio reuses `web/lib/chart-fit.ts`'s `allowedForms()` and its underlying guards
  (`dumbbellFormAllowed`/`slopeFormAllowed`/`heatmapFormAllowed`, `web/lib/chart-view-state.ts`) verbatim —
  these already type against a minimal `{series: {points: {value, periodCode}[]}[]}` shape, not against
  anything CBS-specific.
- Pie/stacked/100%-stacked for own-data get their OWN, separately named guard functions
  (`ownDataPieFormAllowed`/`ownDataStackedFormAllowed`/`ownDataStacked100FormAllowed`) — never the CBS
  ones. The CBS guards are physically incapable of returning `true` for own-data anyway (they require
  `spec.regionScope != null`, and own-data specs never set that field), so reusing them would just mean
  "always disabled," the opposite of the product decision. Keeping them separately named (not a shared
  function with a boolean flag) means "verified" and "unconditional" can never be confused by a future
  edit that merges the two paths.
- The reader-designated-total mechanism reuses `src/query/whole-verification.ts`'s `PartCell`,
  `wholeSumTolerance`, and `verifyPartsSumToWhole` UNCHANGED (confirmed generic: the function's actual
  arithmetic reads only `value`/`decimals`; `valueAttribute` is carried but unread by the check itself, so
  own-data can pass `valueAttribute: null` with no loss of correctness). Resolving the designated cell's
  real value reuses own-data's own existing `executeInstruction`-over-the-reader's-dataset pattern (the
  same one `src/attachments/derive-overlay.ts` already uses for the difference/mean overlay), addressed by
  `rowRef` — not a new query mechanism.
- The designation itself is a **command in the shared `chart-commands.ts` reducer**, applied and undone the
  same way every other phase-4/6 primitive (goal line, era shading, dimmed series) already is — no new
  state-management mechanism, no schema/DB change, no AI call. This is the cheapest-mechanism-first
  version of "let the reader tell us their total": a click, not a chat parse.

**Tech Stack:** Next.js/React/TypeScript, Recharts (native `Pie`/stacked `Bar`, already used by
`chart.tsx`, not yet imported by `user-chart.tsx`), Vitest + Testing Library (jsdom), Playwright (hermetic
e2e, LLM-stub-backed).

**Background reading:** `docs/decisions/056-chart-copilot.md` phase 5 and "Phase 5b" as-built sections (the
mechanism this plan ports from and deliberately does NOT port from, respectively); `src/query/whole-verification.ts`
in full (the function this plan reuses); `src/attachments/derive-overlay.ts` +
`web/app/dataset-derivation-actions.ts` (the own-data server-action + rowRef-resolution pattern this plan's
Task 4 mirrors); `web/components/user-chart.tsx`'s existing `onPointClick`/`PendingPoint` mechanism (the
click-to-pick pattern Task 4 extends).

## Global Constraints

- **No number is ever drawn that isn't a real value already on the chart, a value resolved from the
  reader's own uploaded file via the existing `executeInstruction` pipeline, or pure arithmetic over
  either.** The verification check never computes a number that gets shown as if independently sourced —
  it only checks a claim about numbers already resolvable from the reader's own file. If a task finds
  itself inventing or estimating a number to make something render, stop and flag it.
- **Own-data's pie/stacked/100%-stacked are UNCONDITIONAL — never gated on `regionScope`.** Do not import
  or call `pieFormAllowed`/`stackedFormAllowed`/`stacked100FormAllowed` from `chart-view-state.ts` for
  own-data. Those are the CBS tier's verified-gate functions and will never return `true` for an own-data
  spec (own-data never sets `regionScope`) — own-data needs its own, separately named, shape-only guards
  (see Task 3).
- **`ChartForm` is a widely-narrowed shared type.** CBS's own sites (`web/lib/chart-view-state.ts`'s
  `ChartForm`/`isChartForm`/`fallbackForm`, `web/lib/chart-commands.ts`'s `setForm` schema,
  `src/chart/copilot/*`) are ALREADY at the full 11-member union from CBS's own phase 5/5b work — this plan
  does not need to widen the type itself, only add own-data's OWN consumers of it. The own-data-specific
  narrowing sites that DO need widening, confirmed as of this plan's writing (re-verify — this list may
  have shifted):
  - `web/components/user-chart.tsx` — `FORM_TABS` (hardcoded to 5), `formAllowed()`.
  - `web/lib/chart-capabilities.ts` — `formsFor()` / `ownDataCapabilities()` (hardcoded to the same 5).
  - `src/attachments/copilot/types.ts` — `COPILOT_FORMS` (hardcoded to 5).
  - `src/attachments/copilot/schema.ts` — the own-data `setForm` zod enum, if separately declared from
    the CBS one (confirm the real relationship before editing).
  - `src/attachments/copilot/prompt.ts` — any hand-listed form example in the system prompt text.
  - Any test file with the own-data form list written out literally.
  Run the FULL typecheck (root `npm run typecheck` AND `cd web && npm run typecheck`) and `cd web && npm
  run build` before any task that touches these is called done.
- **`chart-commands.ts` is a shared reducer used by BOTH cards.** A new command kind added there is
  automatically available to the CBS tier's type system too, even if only own-data's UI ever dispatches it
  in this plan. Name it so it reads correctly for either tier (e.g. `setWholeReference`, not
  `setOwnDataTotal`) — mirror how `addGoalLine`/`addEraShading`/`setDimmed` are already named
  tier-agnostically.
- **i18n:** every new user-facing string (tab labels, disabled-reason text, the three/four note states)
  needs both `nl` and `en` entries in `web/lib/i18n/messages.ts`. Own-data's note copy must never reuse
  CBS's `chart.whole.*` keys verbatim — those name "het CBS-totaal" specifically, which is never true for
  an own-data chart. Write parallel, own-data-specific keys (e.g. `chart.ownWhole.*`) with copy that names
  what's actually true: a reader-selected cell, not an independently-audited one.
- **One implementer at a time, no parallel dispatch** — see this plan's own header note on
  `user-chart.tsx`'s fragility.
- **Follow existing conventions exactly.** The guard-predicate pattern (`web/lib/chart-view-state.ts`), the
  on-demand-derivation server-action pattern (`web/app/dataset-derivation-actions.ts`,
  `requestDatasetDerivation`), and the shared-command-reducer pattern (`web/lib/chart-commands.ts`) are all
  proven, reviewed code in this exact codebase — reuse their shape, don't invent a second mechanism.
- **Chat-reachability is in scope for all six new forms** (`setForm` already accepts them once the
  own-data-side narrowing sites above are widened) but **NOT for the total-designation gesture itself** —
  that stays a click, per the cheapest-mechanism-first principle (CLAUDE.md). Do not add an LLM-parseable
  way to "tell" the co-pilot which row is the total.

## Task 1: Wire the chart-fit scorer for own-data; slope + heatmap rendering

**Files:**
- Modify: `web/lib/chart-capabilities.ts` (`ownDataCapabilities()` — replace the hardcoded `formsFor()`
  call with `allowedForms()` from `chart-fit.ts`, same function `cbsCapabilities()` already uses)
- Modify: `web/components/user-chart.tsx` (`FORM_TABS`, `formAllowed()`, new render branches for `slope`
  and `heatmap`)
- Test: `web/lib/chart-capabilities.test.ts`, `web/components/user-chart.test.tsx`

**Interfaces:**
- Consumes: `allowedForms` (`web/lib/chart-fit.ts`), `dumbbellFormAllowed`/`slopeFormAllowed`/
  `heatmapFormAllowed` (`web/lib/chart-view-state.ts`) — read these three guards' real signatures first;
  confirm (per phase 5's own documented precedent) whether they're typed on a `SeriesShape` export that
  already fits `UserChartSpec`'s shape, or whether a `Pick<ChartSpec, 'series'>` mismatch needs the same
  fix phase 5 needed. `isTabularForm` (`web/lib/chart-view-state.ts:57`, confirmed exported and
  tier-agnostic).
- Produces: own-data's `FORM_TABS` gains `slope`, `heatmap` (dumbbell is Task 2 — kept separate since it
  needs a real rendering decision, not just wiring). `ownDataCapabilities()`'s `forms` list now reflects
  the real scorer output for these two, still capped to what `user-chart.tsx` can actually render (i.e.
  read `allowedForms()`'s full output but only surface `slope`/`heatmap` from it in this task — `pie`/
  `stacked`/`stacked100` from the SAME call are CBS-gated and will already be `false` for any own-data
  spec since `regionScope` is never set, so they need no explicit filtering, but confirm this by reading
  the guard bodies rather than assuming).

- [ ] **Step 1: Confirm the real shapes before writing code**

Read `web/lib/chart-fit.ts`'s `allowedForms()` in full, and `dumbbellFormAllowed`/`slopeFormAllowed`/
`heatmapFormAllowed`'s real signatures in `web/lib/chart-view-state.ts`. Read `UserChartSpec`
(`src/attachments/types.ts`) and confirm its `series`/`points` shape structurally satisfies whatever type
these guards require. Read `user-chart.tsx`'s current `FORM_TABS` (around line 214-220) and `formAllowed()`
(around line 658-663) and `web/lib/chart-capabilities.ts`'s `ownDataCapabilities()`/`formsFor()` (around
lines 27-72) to confirm the line numbers and exact current shape — these are from an earlier investigation
and may have shifted.

- [ ] **Step 2: Wire the scorer into `ownDataCapabilities()`**

Replace the `formsFor()` call with `allowedForms()`, filtering the result to forms `user-chart.tsx` can
actually render at the end of THIS task (line/area/bar/hbar/table/slope/heatmap — not yet dumbbell, not
ever pie/stacked/stacked100 through this path). Leave a comment explaining why the filter exists (chat must
never offer a shape the panel can't draw — mirrors the existing comment this replaces) and that it narrows
as later tasks in this plan add more render branches.

- [ ] **Step 3: Slope rendering**

Mirror `chart.tsx`'s own slope handling: it needs zero new render code because a slope chart is exactly a
line chart with two points per series (`slopeFormAllowed`'s own condition). Confirm `user-chart.tsx`'s
existing line-chart branch already handles this shape correctly once `slope` is a selectable tab routed to
it, and add the tab.

- [ ] **Step 4: Heatmap rendering**

Mirror `chart.tsx`'s heatmap-as-sibling-of-table pattern: make heatmap a sibling of `user-chart.tsx`'s own
table branch, gated by the same `isTabularForm` predicate imported from `chart-view-state.ts` (do not
duplicate the predicate). Read how many `activeForm !== 'table'`-style checks exist elsewhere in
`user-chart.tsx` (legend, notes, download/embed, co-pilot input, etc. — `chart.tsx` had ~17) and confirm
each one is either already keyed on `isTabularForm` or needs updating to include heatmap. Reuse
`chart.tsx`'s actual heatmap grid rendering approach (CSS grid over the same rows the table shows,
recoloured) rather than inventing a new layout mechanism.

- [ ] **Step 5: Tests**

Guard/capability tests: an own-data spec shaped for slope (two points per series, ≥2 series) surfaces
`slope` in `ownDataCapabilities()`'s forms; a heatmap-shaped spec (≥2 series, matching period-code sets)
surfaces `heatmap`; a spec shaped for neither surfaces neither. Render tests: slope renders via the
existing line branch with no new bugs; heatmap renders the same CSS-grid structure `chart.tsx` already has
a passing layout assertion for (mirror that assertion, real bounding-box/computed-`display` check, not a
"doesn't crash" test — jsdom has no layout engine, so this may need to stay a Playwright case instead; if
so, note it for Task 5's e2e file explicitly, don't skip coverage silently).

- [ ] **Step 6: Full verification and commit**

`npm run typecheck` (root + web), `cd web && npm test` (solo). Commit: `feat(chart): slope + heatmap
reachable for own-data (chart-fit trio, part 1)`.

## Task 2: Dumbbell rendering for own-data

**Depends on:** Task 1 (same `FORM_TABS`/`formAllowed()` region — sequenced after it to avoid two tasks
editing the same tab-list lines concurrently).

**Files:**
- Modify: `web/components/user-chart.tsx` (new `dumbbell` tab + render branch)
- Possibly modify/create a shared component file, if `chart.tsx`'s `DumbbellOverlay` is cleanly extractable
- Test: `web/components/user-chart.test.tsx`

**Interfaces:**
- Consumes: `chart.tsx`'s existing `DumbbellOverlay` pattern (the `useXAxisScale()`/`useYAxisScale()`/
  `usePlotArea()` hook technique reading Recharts' own settled axis scales) and `dumbbellFormAllowed`
  (`chart-view-state.ts`, already confirmed generic in Task 1).

- [ ] **Step 1: Decide extraction vs. mirroring**

Read `chart.tsx`'s `DumbbellOverlay` and its supporting hooks in full. If it has no CBS-specific data in
its prop contract (check: does it take `ChartSpec`-typed props, or only primitive point/axis values?),
extract it to a shared file both components import (e.g. `web/components/chart-overlays.tsx` or wherever
`EndLabelsOverlay` already lives, if that's already shared — check first). If extraction would require
non-trivial prop-contract changes to the existing, already-reviewed CBS render path, mirror the pattern
into `user-chart.tsx` instead rather than risk destabilizing `chart.tsx`. Record which choice was made and
why in the commit message — this is a judgment call the plan deliberately leaves to the implementer with
the real code in front of them, not a guess made here.

- [ ] **Step 2: Wire the guard + tab + render branch**

Add `dumbbell` to `FORM_TABS`, route to the overlay from Step 1, using `BarChart layout="vertical"` with no
visible `<Bar>` exactly as `chart.tsx` does — the overlay draws everything.

- [ ] **Step 3: Tests**

Mirror `chart.tsx`'s own dumbbell test: a real rendered-DOM test pinning each dot's pixel position against
Recharts' own axis tick (not a snapshot, not a "doesn't crash" check).

- [ ] **Step 4: Full verification and commit**

`npm run typecheck` (root + web), `cd web && npm test` (solo). Commit: `feat(chart): dumbbell reachable for
own-data (chart-fit trio, part 2)`.

## Task 3: Unconditional pie / stacked / 100%-stacked rendering (default state)

**Depends on:** nothing from Tasks 1-2 technically, sequenced after them per the one-at-a-time rule.

**Files:**
- Modify: `web/components/user-chart.tsx` (new guards or their call sites, `FORM_TABS`, three new render
  branches)
- Modify: `web/lib/chart-view-state.ts` (the three new own-data-only guard functions — see Global
  Constraints on naming)
- Modify: `web/lib/i18n/messages.ts` (new `chart.ownWhole.*` keys, nl + en — the default "not checked" note
  only; the other three states are Task 4)
- Test: `web/lib/chart-view-state.test.ts`, `web/components/user-chart.test.tsx`

**Interfaces:**
- Produces: `ownDataPieFormAllowed(spec, seriesCount)`, `ownDataStackedFormAllowed(spec, seriesCount)`,
  `ownDataStacked100FormAllowed(spec, seriesCount)` — same shape conditions as CBS's `pieFormAllowed`/
  `stackedFormAllowed`/`stacked100FormAllowed` (pie: ≥2 series, every series exactly 1 point; stacked/
  stacked100: ≥2 series, multi-period allowed) MINUS the `regionScope` check entirely — these are always
  reachable once the shape fits, full stop.

- [ ] **Step 1: Confirm the real shapes**

Read `pieFormAllowed`/`stackedFormAllowed`/`stacked100FormAllowed` in `web/lib/chart-view-state.ts` in
full. Confirm they compose as independent ANDed conditions (a `hasVerifiableRegionScope(spec)` check ANDed
with pure shape checks) — if so, the new own-data guards are the SAME shape checks with the
`hasVerifiableRegionScope` clause simply omitted, not rewritten from scratch.

- [ ] **Step 2: The three guards**

Add `ownDataPieFormAllowed`/`ownDataStackedFormAllowed`/`ownDataStacked100FormAllowed` next to the CBS
ones, each with a doc comment stating plainly: unlike their CBS counterparts, these never check
provenance — own-data has no registry to check against, so the chart is offered on shape alone, and the
honesty work happens entirely in the rendered note (Task 3/4), not in a gate.

- [ ] **Step 3: `FORM_TABS` + capabilities**

Add `pie`, `stacked`, `stacked100` to `user-chart.tsx`'s `FORM_TABS` and `formAllowed()`, using the new
guards.

**Updated after Task 1 (ratified ruling, see ledger): use the real pipeline Task 1 already built**, do not
route these through `allowedForms()`. `web/lib/chart-capabilities.ts` now computes
`ownDataCapabilities().forms` via `ownDataRenderableForms(spec, seriesCount)`, a three-step pipeline: (1)
the shared scorer `allowedForms()`, (2) filtered to `OWN_DATA_RENDERABLE_FORMS` (what `user-chart.tsx` has
a branch for — Task 1 seeded this with `['line','area','bar','hbar','table','slope','heatmap']`, Task 2
added `'dumbbell'`), (3) filtered again through `COPILOT_FORMS` (the chat wire — still 5 members until Task
5). Since `pieFormAllowed`/`stackedFormAllowed`/`stacked100FormAllowed` require `regionScope`, which
own-data specs never carry, they can never come from step (1) — append the three new own-data guards'
results directly inside `ownDataRenderableForms`, after the `allowedForms()` filter, e.g. `return
[...allowedForms(spec, seriesCount).filter(renderable), ...ownDataWholeForms(spec, seriesCount)]` (name at
your discretion) — keep pie/stacked/stacked100 last in the returned order, matching the scorer's own fixed
ordering convention. Step (3) (the `COPILOT_FORMS` filter) still applies on top and will continue
suppressing all three until Task 5 — do not widen `COPILOT_FORMS` in this task.

- [ ] **Step 4: Rendering**

New render branches mirroring `chart.tsx`'s native-Recharts approach: `<PieChart>`/`<Pie>` for pie (one
slice per series, single period only per the guard), `<BarChart>` with `<Bar stackId="whole">` per series
for stacked/100%-stacked. For `stacked100`, the percentage denominator is simply the sum of the
CURRENTLY-DISPLAYED parts for that period — no verification step gates this arithmetic, unlike CBS's
version (own-data never had an independent total to wait on in the first place). Value labels show the
real underlying number via `formattedValue`-based text, `data-label-for` on every slice/segment, matching
this app's existing no-invented-numbers rendering discipline.

- [ ] **Step 5: The default honesty note**

Whenever `pie`/`stacked`/`stacked100` is the active own-data form, render a persistent note at the same
visual prominence `chart.tsx` gives `chart.whole.verifiedNote` (check its exact mount point —
`web/components/chart.tsx` around line 6302-6309 — and mirror the placement, not just the existence, of
the note). New key `chart.ownWhole.notChecked`:
  - nl: `"Niet gecontroleerd tegen een totaal — klik op een punt om te controleren of deze delen optellen."`
  - en: `"Not checked against a total — click a point to verify these parts add up."`

This is the ONLY state built in this task; Task 4 adds the designation action and the other three states.

- [ ] **Step 6: Tests**

Guard tests: shape-only, no regionScope involvement, mirroring Task 1's test style. Render tests: all three
forms draw real slices/bars from real own-data values with correct `data-label-for` bindings; the default
note is present and visible whenever one of these three forms is active, absent otherwise.

- [ ] **Step 7: Full verification and commit**

`npm run typecheck` (root + web), `cd web && npm test` (solo). Commit: `feat(chart): unconditional
pie/stacked/stacked100 for own-data, default unverified state`.

## Task 4: Reader-designated total — command, verification, remaining note states

**Depends on:** Task 3 (the three forms and their default note must exist first).

**Files:**
- Modify: `web/lib/chart-commands.ts` (new `setWholeReference` command kind)
- Create: `src/attachments/verify-whole.ts` (or extend `derive-overlay.ts` if that proves the more natural
  home — decide after Step 1's reading) — resolves one `rowRef`'s real value via the existing
  `executeInstruction`-over-dataset pattern, then calls `verifyPartsSumToWhole`
- Create: `web/app/dataset-whole-verification-actions.ts` — the server action, mirroring
  `dataset-derivation-actions.ts`'s ownership check (`getDataset(db, userId, datasetId)`) exactly
- Modify: `web/components/user-chart.tsx` (extend the existing `onPointClick`/`PendingPoint` mechanism with
  a third mode: designate/clear the whole-reference point; wire the server action call; render the
  remaining three note states)
- Modify: `web/lib/i18n/messages.ts` (three more `chart.ownWhole.*` keys, nl + en)
- Test: `tests/attachments/verify-whole.test.ts`, `web/components/user-chart.test.tsx`,
  `web/lib/chart-commands.test.ts`

**Interfaces:**
- Consumes: `PartCell`, `wholeSumTolerance`, `verifyPartsSumToWhole` (`src/query/whole-verification.ts`,
  UNCHANGED — confirmed generic: the arithmetic reads only `value`/`decimals`, `valueAttribute` is unread
  by the check itself, so pass `valueAttribute: null` for own-data cells). `executeInstruction`
  (`src/attachments/execute.ts`) and `getDataset` (own-data's store module) via the same pattern
  `derive-overlay.ts`/`dataset-derivation-actions.ts` already establish.
- Produces: a `setWholeReference` command (`{ rowRef: string } | { rowRef: null }` — read how
  `setHeadlineOverride` or another existing "pick one point, or clear it" command structures its clear
  case in `chart-commands.ts` and mirror that shape exactly rather than inventing a new convention). A
  `WholeVerificationOutcome` = `VerifyOutcome` from the reused function (`verified: true` /
  `missing_whole` / `withheld_member` / `sum_mismatch`), each mapped to its own own-data-specific note copy.

**Updated after Task 3 (ratified rulings, see ledger) — read before Step 1:**
- Task 3 already built the guards (`ownDataPieFormAllowed`/`ownDataStackedFormAllowed`/
  `ownDataStacked100FormAllowed`, `ownDataFallbackForm`, all in `web/lib/chart-view-state.ts`), the
  render branches, the row models (`pieRows`, `rows`/`visibleSeries` for the stacks, `stack100.rows`), and
  the default note (`OWN_WHOLE_NOTE` state map + the single `<p data-testid="own-whole-note"
  data-state="not_checked">` mount, directly above the provenance footer). Read Task 3's own report
  (`.superpowers/sdd/2026-09-22-own-data-chart-fit-verified-whole-parity/task-3-report.md`) section "Task 4
  handoff" FIRST — it documents exactly how to extend the note (add `checked`/`mismatch`/`cannot_check`
  entries to `OWN_WHOLE_NOTE`, compute `ownWholeNoteState` from your new command + verification outcome
  instead of the hardcoded `'not_checked'`, thread `{label}` params through) rather than rewriting it.
- **Ratified ruling: the verification check runs over exactly the same "currently-displayed" set Task 3
  already established for rendering** (`visibleSeries`' `pieRows` for pie, `rows`/`visibleSeries` for the
  stacks) — NOT the full series list including hidden ones. This is consistency with what Task 3 already
  draws (hidden series are already dropped from the pie and the 100%-stacked denominator), not a new
  semantic choice: the check should verify exactly what the reader is looking at.
- `web/lib/chart-commands.ts`'s `validateCommand` already has the own-data/CBS split pattern you need
  (`ctx.profile !== undefined ? ownData... : ...`, added by Task 3 for `setForm`) — your new
  `setWholeReference` command's validator case follows the same pattern, don't invent a new one.
- Slices/segments already carry `data-result-id` (the rowRef) and `data-series-key` on the DOM element —
  Task 3 added these specifically so your designation click can read the rowRef directly off the clicked
  element without a new lookup mechanism.

- [ ] **Step 1: Read the precedent and the real click-to-pick mechanism in full**

Read `web/app/dataset-derivation-actions.ts`'s `requestDatasetDerivation` completely: its request/response
shape, ownership check, and how it resolves `resultIds` via `executeInstruction`. Read `user-chart.tsx`'s
existing `onPointClick`/`pendingPoint` mechanism in full (it currently serves at least two purposes — a
note-adding draft and building a derived-overlay's `resultIds` — confirm exactly how mode-switching between
these already works before adding a third mode; do not assume a mechanism not actually present).

- [ ] **Step 2: `verify-whole.ts` — resolve one rowRef, then check**

A function taking `(dataset, instruction, wholeRowRef: string, partRowRefs: string[])` that resolves the
whole's real value via `executeInstruction` (mirroring exactly how `derive-overlay.ts` resolves its own
`resultIds`), builds `PartCell`s for the whole and each part (`valueAttribute: null` for all — own-data has
no CBS-style withheld/estimated attribute concept, only "has a value" or "is null"), and returns
`verifyPartsSumToWhole`'s outcome unchanged. A missing/null value at either the whole or any part must
produce the SAME refusal-shaped outcome the reused function already gives (`missing_whole`/
`withheld_member`) — do not add own-data-specific arithmetic branches; the entire point of reuse is that
this arithmetic is already trusted.

- [ ] **Step 3: The server action**

`web/app/dataset-whole-verification-actions.ts`, `requestWholeVerification(datasetId, instruction,
wholeRowRef, partRowRefs)`: ownership check first (copy `dataset-derivation-actions.ts`'s exact pattern),
then call Step 2's function. No audit row (matches the difference/mean overlay precedent — a view command,
not a new answer, per principle (b)'s scope).

- [ ] **Step 4: Wire the client — designation gesture + the three remaining notes**

Extend `onPointClick`'s mode handling so a point can be marked/cleared as the whole reference (read Step
1's findings for exactly how to add this without breaking the existing two modes). On designation, dispatch
`setWholeReference` and call the server action for the current view's parts. Render three more states,
replacing the Task 3 default note when a reference is set:
  - `verified: true` → `chart.ownWhole.checked` — nl: `"Gecontroleerd tegen de rij die je koos: {label}."` /
    en: `"Checked against the row you selected: {label}."`
  - `sum_mismatch` → `chart.ownWhole.mismatch` — nl: `"Deze delen tellen niet op tot {label} — controleer je
    selectie."` / en: `"These parts don't add up to {label} — check your selection."` **The chart still
    renders in full** — this is informational, never a refusal. This is the one deliberate behavioral
    difference from CBS's tier: CBS hides an unverifiable form because a mismatch there means either our
    pipeline or CBS's own data has a real problem; here a mismatch just as plausibly means the reader
    filtered a row on purpose, which is entirely their prerogative.
  - `missing_whole` / `withheld_member` → `chart.ownWhole.cannotCheck` — nl: `"Kan niet worden
    gecontroleerd: {label} heeft geen waarde, of een van de delen ontbreekt."` / en: `"Can't be checked:
    {label} has no value, or one of the parts is missing one."` Chart still renders.
  Visually distinguish the three (e.g. neutral / confirmed / warning treatment) — a reasonable default,
  not a pixel-precise spec; keep it simple and consistent with this file's existing note styling.

- [ ] **Step 5: Tests**

`verify-whole.ts`: a genuine match, a genuine mismatch, a null part, a null whole — mirroring
`whole-verification.test.ts`'s own fixture style exactly (same four cases, own-data-shaped inputs). Server
action: ownership rejection for a foreign `datasetId` (copy the existing derivation-action ownership test
verbatim in shape). Client: designating a point sets the command and triggers verification; clearing it
reverts to the Task 3 default note; a mismatch renders the chart AND the mismatch note (not one or the
other).

- [ ] **Step 6: Full verification and commit**

`npm run typecheck` (root + web), `cd web && npm test` (solo). Commit: `feat(chart): reader-designated
total verification for own-data pie/stacked/stacked100`.

## Task 5: Chat-doorway wiring (all six new forms) + contract/property/e2e coverage

**Depends on:** Tasks 1-4 (needs the finished, mergeable state of everything).

**Files:**
- Modify: `src/attachments/copilot/types.ts` (`COPILOT_FORMS` 5→11, and `CopilotCapabilities['forms']`'s
  own separately-declared literal union — confirmed by Task 1 to be a SECOND five-member type at line ~27,
  distinct from `COPILOT_FORMS` at line ~46; both need widening), `src/attachments/copilot/schema.ts`
  (`setForm`'s zod enum, confirmed five members at line ~48), `src/attachments/copilot/prompt.ts`
  (hand-listed form example at line ~42, AND `capabilities.forms` is embedded in the prompt at line ~119 —
  both are prompt bytes, `COPILOT_PROMPT_VERSION` bump required)
- Modify: `web/lib/chart-capabilities.ts` — **no code change needed** once `COPILOT_FORMS` is widened
  (Task 1 built `ownDataCapabilities()`'s forms as `ownDataRenderableForms(spec, seriesCount).filter(isCopilotForm)`,
  where `isCopilotForm` reads `COPILOT_FORMS` directly — confirm this still holds, it should just start
  passing more forms through with zero edits here)
- Modify: `web/lib/chart-capabilities.test.ts` — flip the Task-1-authored tripwire test
  (`expect([...COPILOT_FORMS]).not.toContain('slope')`, comment says exactly this) to assert the opposite
  once all six are in `COPILOT_FORMS`
- Modify: `tests/fixtures/attachments/cases.ts` — `LINE_CAPABILITIES.forms` (or wherever the fixture
  scaffolding hand-lists the expected capabilities forms for the verkoop.csv-shaped test chart) must be
  updated to include the newly-qualifying forms in the browser's own computed order — the llm-stub matches
  exact prompt bytes, so a stale hardcoded list here breaks silently rather than loudly
- Modify: `web/components/chart-commands-contract.test.tsx`, `web/lib/chart-commands.test.ts`
- Modify: `web/e2e/own-data-copilot.spec.ts`
- Fixture regen: `npm run attachments:fixtures` (free, offline, no live spend — required after the
  `COPILOT_PROMPT_VERSION` bump per this codebase's established pattern; see
  `[[feedback_llm_prompt_embedded_lists_hash_risk]]`-equivalent reasoning already documented in
  `docs/lessons-learned.md` and `docs/open-questions.md` #301/#275)

**Interfaces:**
- Consumes: everything Tasks 1-4 produced.
- Produces: `setForm` reachable via chat for all six new forms on the own-data card; no new command kind
  needed for this (widening `COPILOT_FORMS` is sufficient, mirroring exactly how CBS's phase 5/5b widened
  their own equivalent list).

- [ ] **Step 1: The own-data co-pilot prompt**

Widen BOTH `COPILOT_FORMS` and `CopilotCapabilities['forms']` (two separate five-member types, per Task
1's report — read `src/attachments/copilot/types.ts` in full before editing, do not assume they're the same
declaration) 5→11 (all: line, area, bar, hbar, table, dumbbell, slope, heatmap, pie, stacked, stacked100).
Update `schema.ts`'s `setForm` zod enum and `prompt.ts`'s hand-listed form example to match. Bump
`COPILOT_PROMPT_VERSION` by 1 (one combined bump for all six new forms, not one per form and not one per
task — avoids a wasted double fixture regen). Check for and update any test pinning the version number, AND
the tripwire test named above.

- [ ] **Step 2: Regenerate fixtures**

`npm run attachments:fixtures` — free, offline, no live spend. Before running it, update
`tests/fixtures/attachments/cases.ts`'s hand-listed expected-capabilities forms list(s) for any case built
on a slope/heatmap/dumbbell/pie/stacked/stacked100-qualifying shape (the verkoop.csv 2×2 case at minimum
now qualifies for slope + heatmap per Task 1's own tests) — the regen script reflects real capability
output, but a fixture TEST asserting the old five-form list would still pass against stale expectations
without a matching update. Confirm the diff only touches `tests/fixtures/llm/attachments/*.json` request
hashes as expected, not response content.

- [ ] **Step 3: Contract test**

Extend whatever test already pins "every form the own-data chat can offer must have a matching panel tab"
to include all six new forms.

- [ ] **Step 4: Property test**

Check the own-data equivalent of `randomCommand()`'s `setForm` case (`web/lib/chart-commands.test.ts`) —
per phase 5's own documented lesson, do NOT naively widen a literal form list in a property test without
confirming the shared test context's spec shape actually qualifies for the new forms (dumbbell/slope need
exactly two points; pie needs exactly one; stacked/stacked100 need ≥2 series). Add a targeted round-trip
test on a purpose-shaped context if the shared one can't realistically cover all six.

- [ ] **Step 5: e2e — Playwright, hermetic**

**Heatmap and slope layout proof — handoff from Task 1 (its own jsdom coverage cannot prove real layout;
this is that missing proof, not new scope):** port `web/e2e/chart-copilot.spec.ts` lines 513–559 (the
heatmap click + bounding-box/computed-display block, and the slope segment/point-count assertions) into
`own-data-copilot.spec.ts`, substituting: locator `[data-testid="user-heatmap-grid"]` (own-data's own test
id, confirm it still matches what Task 1 actually named it); the verkoop.csv fixture chart (2 series × 2
years) qualifies for both tabs; expected column headers `['Jaar'/'Year', 'Amsterdam', 'Rotterdam']`, row
headers `['2020', '2021']`, four bound cells each with its own `data-label-for` rowRef; assert no
`[data-testid="user-chart-container"]` while the grid is shown. For slope: one path segment per curve (`d`
split on `L`), 4 `circle[data-point="value"]`, x-tick labels `['2020','2021']`. Re-verify these exact
values against Task 1's own test file (`web/components/user-chart.test.tsx`) before writing the e2e case —
the plan text here is Task 1's own handoff note, not independently re-derived.

In `web/e2e/own-data-copilot.spec.ts`: an own-data dataset shaped for the chart-fit trio shows all three
new tabs enabled and each renders real content when clicked (one render-level proof per genuinely new
mechanism — heatmap's grid, dumbbell's overlay geometry — not per chat command); a dataset shaped for
pie/stacked/stacked100 shows those three enabled UNCONDITIONALLY (no dataset needs any special "complete
roster" property, unlike the CBS equivalent test); clicking a point to designate a total, then verifying a
match and a mismatch case, each render the correct one of the four notes; a chat message asking for one of
the six new forms produces the matching `setForm` chip and the same rendered result as the tab click.

- [ ] **Step 6: Full verification, whole-branch review, and commit**

Root typecheck, `cd web && npm run typecheck`, root `npm test` (solo), `cd web && npm test` (solo), `cd web
&& npm run build` (real build — if run from this worktree, confirm `node_modules` is a real install, not a
symlink, per phase 5's own documented Turbopack gotcha), the full Playwright e2e suite, hermetic benchmark
(`npm run benchmark:run` + `benchmark:score` at the root — must stay 14/14 + 6/6 + 0 fabricated; this plan
does not touch the CBS answer pipeline, so this is a regression check, not new coverage). Commit:
`test(chart): chat-doorway wiring + contract/property/e2e coverage for own-data chart-fit + verified-whole
parity`.

After Task 5 is reviewed clean, proceed to a final whole-branch review on the most capable available model,
exactly as phases 1-6 did. Update `docs/STATUS.md`, `docs/status-archive.md`, `docs/08-build-plan.md`, ADR
[056](../decisions/056-chart-copilot.md)'s "as built" section (a new entry — this is NOT part of any
existing phase number; consider whether it earns "phase 7" or its own heading, owner's/session's call at
wrap-up), `docs/04-architecture.md` capability rows, `docs/open-questions.md` (record #306(d) as
built — chart-fit trio ported, verified-whole intentionally NOT ported, replaced by the reader-designated
mechanism — and note the design conversation that led here, since it's a real product decision worth
finding again later), and `docs/lessons-learned.md`.

# ADR 038 — Chart view-state editing (Phases 1-3) as a pure client reducer

**Status:** accepted, 2026-09-08 (autonomous session, branch `feat/chart-editing-p1`) — Phases
1-3 only (form switch, period-range zoom, series hide/highlight, click-to-annotate notes). Phase 4
(chat-routed edits) and the map-view prerequisite are explicitly deferred, not designed here.

## Context

Session 88's architecture panel ([open-questions #212](../open-questions.md), synthesis published
as an artifact: https://claude.ai/code/artifact/91b16e9d-d5aa-4223-a6cf-ff3a7001c938) proposed
letting a user adjust how an already-answered CBS chart is *displayed* — line/bar/table form, a
period-range zoom, series hide/highlight — and add personal click-to-annotate notes, all without
an LLM call, a database change, or a prompt-byte change for the first three phases. The panel's
converged decision was "no LLM instruction schema in v1": a deterministic view-state reducer
driven by direct on-screen controls, matching the owner's own click-first steer on annotations
(session 88, given in passing) and the CLAUDE.md "cheapest mechanism first" convention this whole
plan was itself the worked example of.

The panel also surfaced 8 open owner decisions, lettered A-H, and recorded the owner's response as
"Great plan on most items so far" — explicitly *not* a line-by-line sign-off. The session-89
kickoff dispatched an autonomous session to build what was judged safe on that basis. This ADR
records the as-built mechanism from that build (7 tasks, 6 feature/fix commit pairs, all on
`feat/chart-editing-p1`) and, per this repo's "note everything" convention, is deliberately
explicit about which of A-H got a real decision versus a conservative placeholder — see
Consequences.

## Decision

All new state (`ChartForm`, `hiddenKeys`, `highlightedKey`, `periodRange`, annotation notes) lives
only in client React state, owned by a pure reducer (`web/lib/chart-view-state.ts`,
`chartViewReducer` + `initialViewState`) plus one local note-list `useState` pair
(`web/components/chart-notes.tsx`'s `ChartNote`/`PendingPoint` types, held by `ChartView` in
`web/components/chart.tsx`). It is a strict projection over the unchanged, server-built
`ChartSpec` — `windowSpec()` (also in `chart-view-state.ts`) filters a spec's points to a period
range as a verbatim copy, never a recomputation. Nothing in this change calls `buildChartSpec`
again, writes an audit record, or touches `src/chart/*`.

Two safety rules are enforced structurally, not just documented:

- Switching to line form is blocked (`lineFormAllowed(spec, seriesCount)`) whenever the original
  spec is a multi-region comparison (`kind === 'bar'`, more than one series) — a connected line
  would imply a trend across regions that was never measured. A second guard, added during
  self-review (Task 3), also forces `effectiveKind` back to `'bar'` if a same-instance spec swap
  (the visual dock / Ontdek's reading toggle re-using one mounted `ChartView`) hands the component
  a newly-disallowed multi-region spec while `state.form` was still `'line'` from the prior chart
  — closing an edge case the reducer's own "preserve the user's chosen form across a spec swap"
  behavior would otherwise have let through.
- Bar form's Y-axis always starts at zero (`yAxisDomain(effectiveKind)` in `chart.tsx`, never
  `yAxisDomain(spec.kind)`) regardless of the chart's original kind — so a user-selected Staaf view
  can never visually exaggerate a small change the way a non-zero-based bar axis would.

Click-to-annotate notes render in a new sibling component, `ChartNotes`, mounted outside
`ChartView`'s `chartContainerRef`-wrapped subtree — the same container `ChartDownloadMenu` reads
for PNG/SVG export — so notes are excluded from every export by construction, with no new
exemption needed in the R6 token-scan (which only ever inspects the exported `<svg>`).

## Alternatives considered

(As catalogued in more detail by the session-88 architecture panel's published artifact.)

1. **Reuse ADR [037](037-user-data-attachments.md)'s `ChartInstruction`/`execute.ts` machinery for
   CBS charts.** Rejected — that mechanism exists to keep an LLM away from a *value* pulled from a
   user's own uploaded data; CBS charts have no analogous "closed vocabulary per dataset" to
   validate against, and routing a presentation-only form switch through it would strip or
   re-derive the CBS provenance fields (`resultId`, `formattedValue`, `status`) that make a number
   trustworthy, for no safety benefit.
2. **An LLM instruction schema as the first slice**, i.e. building the chat-routed producer before
   the on-screen controls. Rejected — the full menu of Phase 1-3 adjustments is small enough to
   put directly on screen; per the CLAUDE.md "cheapest mechanism first" convention, a prompt-byte
   change is not justified until usage data shows the deterministic controls aren't enough.
3. **Draw annotation notes inside the chart's own SVG** (e.g. as a Recharts overlay layer).
   Rejected — would require a new R6 token-scan exemption for the annotation text (currently the
   scan only ever inspects the exported `<svg>`, so anything drawn inside it needs a carve-out) and
   risks a personal note being mistaken for official CBS data on a shared screenshot. Mounting
   `ChartNotes` as a structurally separate sibling, outside the exported container, avoids both.

## Consequences

- Zero change to the R1-R11 backend test suites — none of this touches server code, calls
  `buildChartSpec`, or writes an audit record; `src/chart/*` is untouched.
- Notes are session-only: lost on reload, no new database table, no GDPR retention surface added.
  **This is decision F's conservative default, not a formal owner decision** — see the paragraph
  below and the dated addendum on [open-questions #212](../open-questions.md).
- **Decisions B and F used the conservative/reversible default because the owner had not resolved
  them by the time this autonomous session ran — not a formal owner decision:**
  - **B** (bar Y-axis always zero vs. conditional): built as *always* zero for a bar-form render,
    the option with no honesty downside, rather than the more permissive conditional behavior the
    architecture panel also considered.
  - **F** (whether notes persist): built as session-only, in-memory state with no schema change,
    the option that is trivially reversible and adds no retention/GDPR surface, rather than a
    persisted `chart_annotations` table.
  Both are flagged here explicitly, and again in the open-questions addendum, so a future reader
  of either document does not mistake "this is what got built" for "this is what the owner chose."
- **Decisions A, C, D, E were effectively resolved by the mechanism this build chose**, not by an
  independent owner call:
  - **A** (whether a chart's trend-headline sentence can be rewritten under a zoom): resolved by
    design — the trend sentence is *suppressed* while a period range is active, never rewritten,
    exactly as the architecture panel described; there was no separate decision to make once that
    mechanism was chosen.
  - **C/D** (how an annotation is visually distinguished from official data / how the zoom's
    narrowed range is disclosed): resolved by the mechanism itself — a separate, structurally
    distinct, clearly labelled disclosure sentence (period-range) and a structurally distinct,
    clearly labelled note affordance (annotations), never rewriting the source line. Residual risk
    is accepted as documented in the original artifact.
  - **E** (whether annotation notes appear in downloads): resolved by construction — notes mount
    outside `chartContainerRef`, so they are excluded from every export; permanence of that
    exclusion policy itself was not separately debated because the mount point makes the question
    moot for this build.
- **Decisions G (transparent PNG export) and H (map view) are untouched — fully out of scope for
  this build.** Nothing in this change reads or writes either.

## Revisit triggers

- If usage data ever shows demand for chat-routed chart edits, Phase 4 (a thin
  `ChartInstruction`-shaped schema, explicitly deferred by the architecture panel) is designed
  separately and requires owner sign-off before any LLM call is added.
- If the owner wants notes to survive a reload, Phase 5 (a new `chart_annotations` table under the
  existing GDPR retention machinery, per ADR 037's precedent) requires a migration and an explicit
  owner decision on decision F — the current session-only behavior should not be read as that
  decision having been made.
- If the owner wants a conditional (non-always-zero) bar Y-axis in some case, decision B needs its
  own explicit resolution — the current always-zero behavior was chosen for having no honesty
  downside, not because the alternative was ruled out on the merits.
- A map view (decision H) stays gated behind the architecture panel's stated prerequisite: a
  "region-set" query capability the product does not have today (a CBS result only ever contains
  the regions one question named, so a map of them would visually claim "no data" everywhere else).

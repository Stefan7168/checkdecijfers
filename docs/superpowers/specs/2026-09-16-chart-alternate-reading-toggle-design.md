# Design — alternate-reading toggle on chat charts (raw ↔ seasonally-adjusted)

**Date:** 2026-09-16 (session 106, continuing autonomously in an owner-present chat — see
[CLAUDE.md](../../../CLAUDE.md) §Git workflow #118(a): decisions below are session defaults,
documented for owner veto-by-exception, not a live back-and-forth). **Status:** approved design,
not yet built.

## Context

[open-questions #254](../../open-questions.md) named "context controls (level vs. % change,
seasonally-adjusted vs. raw)" as a genuine, unscheduled gap — session 69's research (idea 7)
scoped it as: "generalises `CuratedChartToggle.alternateSpec` via `Attribution.alternates`; many
pairs need no new derivation (registry siblings already exist)." `STATUS.md` flagged this as the
likely next priority after the journalist-headline feature (session 105).

**A prior session-105 claim needed correcting, not assumed:** the session-106 kickoff brief stated
that "seasonally-adjusted already exists as a separate measure a user has to ask for by name."
Verified directly against `src/registry/defaults.ts` before designing anything:

- **True for unemployment only.** `unemployment_rate_seasonally_adjusted` (defaults.ts:219-229)
  has a real `alternates` entry pointing at the same table's raw dims sibling (table `85224NED`,
  `SeizoenEnWerkdagcorrectie` `A050903` ↔ `A042501`) — this is also the ONE concept
  `src/chart/curated.ts` already builds a working toggle for today (the `werkloosheid` Ontdek
  chart).
- **False for consumer confidence** — the chat demo's own running example
  (`Wat is het consumentenvertrouwen in juni 2026?`). `consumer_confidence_seasonally_adjusted`
  (defaults.ts:283-292) carries **no `alternates` field**; its own comment names the raw sibling as
  **table `83693NED`'s the corrected series only** — the actually-raw reading lives in table
  `83694NED`, which is **not ingested or registered anywhere in this repo**. Toggling this chart
  would need a whole new table onboarded (bulk ingestion, ADR 003's pipeline) — real, separate
  scope, not a styling generalization.

This changes what "ship the gap" honestly means: the mechanism generalizes to every future
registered alternate, but **today it lights up for exactly one concept (unemployment)**. That is
still real, shippable value — the seam is the expensive part, not any one pair — but the owner
should not be told this closes the gap for every chart; it closes it for the charts that already
have a registered sibling, and sets up every future one to cost nothing further.

**Level vs. percent-change is explicitly OUT of scope for this slice.** Verified against
`src/query/types.ts:42` (`IntentDerivation = 'none' | 'difference' | 'max' | 'series'`) and
[ADR 011](../../decisions/011-query-contract.md) (the derivation vocabulary is a closed enum by
design — "no free-form derivation expressions"): there is no registered derivation that turns a
whole plotted series into percent-change-from-previous-period. `difference` computes a single
two-point growth number (B13), not a series transform. Building one is a real ADR-011-revision
job — a new registered derivation, its own honesty tests, its own registry wiring — not a
generalization of an existing mechanism. **Recorded as a follow-up in open-questions, not
attempted here.**

## Decision

### Scope: generalize the existing curated toggle mechanism to chat + dock charts

Whenever the measure a chat answer resolves to has a registered `alternates` entry (today: only
`unemployment_rate_seasonally_adjusted`), the chart the user already gets shows a small toggle to
the alternate reading. No new derivation, no new registered measure, no schema bump to `ChartSpec`.

### Mechanism: build both specs once, server-side, at answer time — ship both, swap client-side

`src/chart/curated.ts`'s own header comment already states the model to reuse verbatim: "the
client toggle only ever swaps which already-validated spec is shown" (line 64). `buildAlternateSpec`
(curated.ts:323-351) already proves the whole pipeline: a second `StructuredIntent` with
`target.kind: 'explicit'`, `primary.attribution.tableId` + `primary.cells[0].measure`, the
registry alternate's `dims` swapped in, then `runQuery` + `buildChartSpec` — same deterministic
pipeline, zero LLM, degrade-on-failure (never blocks the primary answer, mirrors
`CuratedChartsOutcome.toggleSkipped`).

**`src/answer/respond/respond.ts`, right after today's `const chart = buildChartSpec(result);`:**
if `result.attribution.alternates` is non-empty, best-effort build one alternate `ChartSpec` the
same way curated does (first alternate only — today there is never more than one; the type stays
an array for the registry's own future use, this feature reads only `[0]`). On any failure
(refusal, missing coordinate, anything `buildAlternateSpec` already treats as skip), silently omit
— the primary answer is never put at risk by the alternate build.

**New structural field, NOT inside `ChartSpec`:** `AnswerResponse` gains
`chartAlternate?: { label: string; spec: ChartSpec } | null`, additive exactly like `sourceSelection`
and `webSection` already are (`src/answer/respond/types.ts:200-212`) — absent on every existing
audit row, readers use `?? null`. **Deliberately not a field on `ChartSpec`/`ChartAttribution`**:
session 69's own research (§1, fact 3) already flagged that any change to what `buildChartSpec`
emits is a schema-v2 + versioned-builder job (`reconstruct.ts` diffs builder output against stored
rows). Keeping the alternate as a sibling of `chart`, not inside it, means `ChartSpec` itself is
byte-identical before and after this feature — no versioned-builder work, no `known-divergences.ts`
entry, no schema bump.

**No new server round-trip at click time.** Both specs are already on the client after the answer
loads (one extra deterministic query executed once, server-side, same request). The toggle in
`chart.tsx` is a pure local state swap between two already-fetched `ChartSpec` objects — the exact
same philosophy `chart-view-state.ts`'s `windowSpec` already documents ("projects an unchanged
server-built spec for display"). No extra LLM cost, no extra credit charge (same tier as switching
chart form Line ↔ Bar, which is also a free, already-fetched-data operation), no extra network
request.

### Audit / R8 — nothing stored, nothing to reconstruct differently

`chartAlternate` is **never written to `audit_answers`** — R8's guarantee ("every number
traceable," `reconstructionReport` re-verifies each row from its own stored fields) is about the
row's own claimed answer, unchanged by this feature. The alternate is rebuildable on demand from
data already in the stored row (`attribution.tableId`, `cells[0].measure`) plus the registry's
*current* alternates — the same non-stored, rebuild-from-code relationship curated charts already
have with their toggle, and the same shape `rerunLive` (`src/chart/embed-live.ts:143-158`) already
uses for a live embed re-render. If the registry's alternates ever change, older answers simply
stop (or start) offering the toggle — an honest, unremarkable consequence, not a divergence a
reconstruction check needs to catch, because the toggle was never part of what was audited.

### Surfaces: chat + dock in v1 — trial, gallery and embed are explicitly out

Checked directly (not assumed from the ADR 042 surfaces list, which names "the same `ChartView`"
but not the same *answer pipeline*):

- **Chat** (`web/components/chat.tsx` → `askQuestion`, `web/app/actions.ts`) calls `respond.ts`
  and is the primary target.
- **Dock** (`visual-dock.tsx`) is not a separate pipeline call — it renders a `DockVisual` chat.tsx
  already extracted from the SAME answer object. It gets `chartAlternate` for free once chat.tsx
  has it; no separate wiring.
- **Trial** (`trial-chat.tsx` → `askTrialQuestion`, `web/app/trial-actions.ts`) is a genuinely
  **separate** server action from `askQuestion`, sharing only the `ComposedResponse` type from
  `respond/types.ts`. It would need its own explicit pass-through of the new field. **Deferred**:
  the anonymous trial is a stripped-down surface (no saved account default, no Style panel in some
  configurations) and threading a second surface through in the same slice risks the same kind of
  scope creep this design is trying to avoid. Logged as a fast-follow, same mechanism.
- **Gallery** (`/galerij`, `lib/ontdek.ts` + `src/chart/curated.ts`) is **not** built on
  `respond.ts` at all — it is the curated-chart pipeline this feature generalizes FROM, and it
  already has its own toggle mechanism (`CuratedChartToggle`, manually configured per chart
  definition via `alternateReading`, not automatic from registry `alternates`). Out of scope by
  construction — nothing to change here, and unifying the two toggle mechanisms is a separate,
  later question if it's ever worth doing.
- **Embed** (`rerunLive`, `src/chart/embed-live.ts:143-158`) already receives the full
  `outcome`/`ValidatedResult` and could plausibly carry the same `chartAlternate` with a few lines
  of code — but it is a separate route with its own tests and its own "frozen render" framing.
  **Logged as a fast-follow, not built here.**

### UI: one small control, only when an alternate exists

A toggle appears in the existing control row (next to the Weergave tabs / Vanaf-Tot selects,
`chart.tsx`) **only when `chartAlternate` is present** — for every chart today except unemployment,
zero visual change. Labelled with the registry alternate's own `label` string (already Dutch,
digit-free, e.g. "Ongecorrigeerd" for the raw reading) against the primary's own implicit "current"
state — a two-state pill/segmented control, not a dropdown (there is never more than one
alternate today). Switching it re-renders the SAME `ChartView` with the swapped spec — every
existing per-chart view state (form, zoom window, presentation overrides) carries over unchanged,
since only the underlying data changes, not the chart's own display settings.

**Exports/embeds after a toggle:** whichever spec is currently shown is what gets exported — the
same behaviour a period-zoom window or a form switch already has today (no special-casing needed;
`chart-download.tsx` reads whatever `ChartView` is currently displaying, not a fixed "the primary
spec").

### Honesty invariants — unchanged by construction

- **R1/R6 (every number traceable):** the alternate `ChartSpec` carries its own full
  `ChartAttribution` (table id, sync date, coordinates) from `buildChartSpec`, exactly like the
  primary — `scanForUnboundDigits` walks whichever spec is rendered; both specs pass the same
  honesty scan independently, nothing new to weaken.
- **R11 (provisional marker):** the alternate build goes through the same `buildChartSpec`, so the
  hollow/hatched provisional treatment applies identically if the alternate's own most-recent point
  is provisional.
- **Zero LLM, zero new spend:** `target.kind: 'explicit'` bypasses intent parsing entirely, exactly
  like curated's own toggle and exactly like the WP29 chip take-path.

## Alternatives considered

- **A live server round-trip per toggle click** (a new server action re-querying on demand).
  Rejected: curated's own mechanism already proves the "build both up front, swap client-side"
  pattern works and is cheaper — no extra request, no extra latency, no click-time failure mode to
  design for.
- **Putting `alternates`/the alternate spec inside `ChartSpec` itself.** Rejected: triggers the
  schema-v2 + versioned-builder cost session 69's research explicitly flagged; the sibling-field
  approach on `AnswerResponse` is additive and free.
- **Storing the alternate in `audit_answers`.** Rejected: nothing about the alternate reading needs
  to be reconstructible from a stored row independent of the current registry — it is presentation
  sugar over already-attributed data, not a second claim needing its own audit trail. Simpler, and
  consistent with how curated charts (which have no audit rows at all) already treat their toggle.
- **Building the level↔%-change transform now, since it was in the same research idea.** Rejected:
  it needs a new registered derivation and an ADR 011 revision — a materially different, larger
  piece of work than a generalization, and not safe to design blind without the owner's read on
  whether a new derivation kind is worth the schema/registry cost. Logged as a separate follow-up.
- **Onboarding CBS table 83693NED/83694NED... 83694NED specifically, so consumer confidence also
  gets a real toggle in this slice.** Rejected: bulk table ingestion is its own scoped job (ADR 003)
  with its own review, not a side effect of a UI generalization. Logged as a follow-up naming the
  concrete table.

## Consequences

- Exactly one concept (unemployment) shows the toggle in chat + dock today. The
  mechanism is real and generalizes for free the next time a registry entry gains an `alternates`
  sibling — no further engineering needed, only a registry data change.
- `AnswerResponse` gains one additive optional field; every existing stored row, replay path and
  benchmark fixture is unaffected (absent ⇒ `?? null`, same pattern as `sourceSelection`).
- `ChartSpec`'s own shape, and everything that diffs it (`reconstruct.ts`, `known-divergences.ts`),
  is untouched.
- Embed does not get the toggle in this slice — a known, logged gap, not a silent omission.
- No migration, no new registered derivation, no LLM cost, no credit cost, no env flag — clears
  every "no live DDL / no real spend / no env-flag flips autonomously" binding constraint in
  `CLAUDE.md`, so this is safe to build and ship in this same autonomous stretch.

## Follow-ups recorded (not built here)

1. **Level vs. percent-change toggle** — needs a new registered series-wide derivation + an
   ADR 011 revision; a real design task of its own, larger than this slice.
2. **Consumer confidence's raw sibling (table 83694NED)** — would need bulk ingestion (ADR 003) to
   register a real `alternates` entry; today the toggle correctly does not appear on this chart.
3. **Embed's live-reload route** (`rerunLive`, `src/chart/embed-live.ts`) — same mechanism could
   attach `chartAlternate` with a few lines; deferred so this slice's diff stays reviewable.
4. **The anonymous trial** (`askTrialQuestion`, `web/app/trial-actions.ts`) — a genuinely separate
   server action from chat's `askQuestion`; needs its own explicit pass-through of the new field.
5. **Unifying gallery's manual `alternateReading` mechanism with this automatic, registry-driven
   one** — gallery already has a working toggle; whether it's worth collapsing the two into one
   code path is a later question, not assumed here.

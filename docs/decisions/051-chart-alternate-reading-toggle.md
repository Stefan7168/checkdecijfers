# ADR 051 — Chart alternate-reading toggle: sibling field, merged coordinates, degrade-on-refusal

**Status:** accepted, built via subagent-driven development (session 106→107, 2026-09-16,
branch `worktree-chart-alternate-reading-toggle`) — 7 tasks (including one standalone fix folded
in mid-build) + a whole-branch review, all task-scoped reviews clean. **MERGED to `main`, CI
green.**

## Context

[Open-questions #254](../open-questions.md)'s second genuine gap ("context controls: level vs.
%-change, seasonally-adjusted vs. raw") was picked as session 106's work, continuing autonomously
in an owner-present chat (CLAUDE.md §Git workflow #118(a)). `src/chart/curated.ts` already proved
a narrow version of this mechanism for the hand-curated gallery: one hard-coded alternate reading
per chart definition, built via a second `runQuery` + `buildChartSpec` pass over an `explicit`
target. The design generalizes this to every chat/dock answer, driven by the registry's own
`alternates` data rather than a per-chart hand-authored config.

Two claims from the original kickoff needed correcting against the real registry before design
work proceeded (see the full design doc,
[superpowers/specs/2026-09-16-chart-alternate-reading-toggle-design.md](../superpowers/specs/2026-09-16-chart-alternate-reading-toggle-design.md)):
the registry carries **20** canonical measures with a real `alternates` array, not 1 as first
assumed, and several of those swap `measure` (not `dims`), several carry more than one alternate
(household income has 4), and several primaries carry non-empty `dims` of their own that a literal
copy of `curated.ts`'s existing code would silently drop. Level-vs-%-change stays explicitly out of
scope: `IntentDerivation` (ADR 011) is a closed enum with no registered series-wide percent-change
transform — building one is a separate ADR-011-revision job, not a generalization of this
mechanism.

## Decision

**D1 — A new shared function, `buildAlternateReading` (`src/chart/alternate-reading.ts`), replaces
`curated.ts`'s old inline `buildAlternateSpec`, and MERGES the alternate's dims over the primary's
own resolved dims rather than replacing them wholesale.**
```ts
target: {
  kind: 'explicit',
  tableId: primary.attribution.tableId,
  measure: alt.measure ?? primaryCell.measure,
  dims: { ...primaryCell.dims, ...(alt.dims ?? {}) },
}
```
`curated.ts`'s original `dims: alt.dims` was safe only because its one real caller
(unemployment's dims-only alternate) happens to swap the same key it reads. Checked against the
real registry: most of the 20 entries swap `measure` with no `dims` key at all, and several
primaries (e.g. retail turnover) carry a non-empty branch-code `dims` of their own that a literal
replace would silently drop — not a fabrication, but a needlessly broken toggle. The merged form is
also what makes a multi-region comparison primary work: `regions: primaryIntent.regions` is passed
through explicitly (a review finding fixed inside Task 1/2, before it could reach a general
caller), since `resolve.ts` defaults an absent `regions` to `[]`.

**D2 — `AnswerResponse` gains a sibling field, `chartAlternates: { label: string; spec: ChartSpec
}[]`, never a field inside `ChartSpec` itself.** Keeping `ChartSpec`'s own shape byte-identical
avoids a schema-v2 + versioned-builder cost (`reconstruct.ts`/`known-divergences.ts`) entirely —
every alternate is a complete, independent `ChartSpec`, built through the exact same
`runQuery`→`buildChartSpec` pipeline as the primary (R6), so it carries its own full
`ChartAttribution` and passes the same honesty scan independently. `chartAlternates` rides the
audit envelope like `suggestions`/`pending` (produce-time, never re-derivation-checked on R8
reconstruction — `tests/audit/envelope-key-manifest.test.ts`'s `ignored` category) since the
registry's alternates can change after a row is written, and an older row simply offering a
different set later is an honest, unremarkable consequence, not a divergence worth pinning against
a frozen value.

**D3 — Every registered alternate is built up front, server-side, at answer time (capped at 4);
the client only ever swaps between already-fetched specs, never re-queries.** Same "build once,
swap client-side" philosophy `chart-view-state.ts`'s `windowSpec` already documents for zoom
windows. Zero extra LLM cost (an `explicit` target bypasses intent parsing), zero extra credit
charge (same tier as switching chart form Line↔Bar), zero extra network request after the answer
loads. Each alternate degrades independently — one refusing never blocks a sibling alternate or the
primary answer.

**D4 — A period-code-match guard, added as a standalone fix after Task 5's review (not part of the
original design doc).** The whole toggle assumes every alternate is built over the IDENTICAL period
window as the primary — that assumption is what lets the UI keep the zoom-window bounds and the
Vanaf/Tot options derived from the primary spec even while an alternate is on screen. Under today's
architecture this is structurally guaranteed on the happy path (`runQuery`'s completeness gate
refuses the whole query rather than ever serving a partial period set), so the natural failure mode
this guard defends against (a gappier alternate measure) is currently unreachable via real call
paths — the implementer discovered and reported this honestly rather than fabricating a misleading
test. The guard stands as a defensive backstop against the function's two decoupled parameters
(`primary` and `primaryIntent` are never otherwise checked against each other) and any future
relaxation of the completeness gate: a mismatch degrades to `{ ok: false }` — refusing the whole
alternate — never a chart claiming coverage its own data doesn't back (principle c).

**D5 — Client-side state lives in the reducer (`selectedReading: number | null`), never derived
from the `spec` prop's identity, so a reading switch never trips the existing spec-identity reset
effect** that wipes form/zoom/presentation/notes on a genuinely new chart. `activeReadingSpec(spec,
alternates, selectedReading)` computes which spec's DATA the chart draws from; every
per-reading FACT (attribution, dimLabels, definitionLine, provisionalNote, nullNotes,
trendHeadline, Insights findings, the drafted headline) follows the active reading, while every
IDENTITY/shape read (form guards, `allPeriodCodes`/zoomAvailable/the Vanaf-Tot options, the embed
button's table id) deliberately stays on the primary `spec` — the whole feature's safety rests on
that split holding at every call site, verified by an explicit whole-branch diff read against this
exact list.

**D6 — Registry alternate labels are exempt from the per-card digit-honesty scan, narrowly and by
explicit precedent.** The registry ships several digit-bearing labels ("CPI indexniveau
(2025=100)", "stand per 31 december"), and these are curated config — hand-authored in
`src/registry/defaults.ts`, code-reviewed, never derived from a CBS cell at runtime, and naming a
reading rather than stating a measured quantity (an index base is a definitional property of the
measure, not a plotted value). Same class as `ChartAnnotation`'s curated event-marker labels,
whose own type comment already states this policy. The exemption is pinned narrow by a test that
scans the whole card MINUS the reading control's own subtree with zero exemption at all — a
curated label's digits can never leak into the chart, table, headline figure, axis, or attribution.

**D7 — The Embed button disables itself (with an `aria-describedby` reason) while a non-primary
reading is selected.** An embed always republishes the stored audit row's PRIMARY reading (the row
carries no reading selection; `/embed/[token]` has no `chartAlternates` concept at all,
deliberately out of scope). Without this, a reader could switch to an alternate, see it in the
Embed dialog's live preview, and copy code believing it publishes that reading when it always
publishes the primary instead.

**D8 — The anonymous trial chat (`trial-chat.tsx`) IS wired into this feature, reversing the
original design doc's Follow-up #4 ("deferred, needs its own explicit pass-through").** The
whole-branch review (Task 6) flagged the surface as a missed call site — `message.response`
already carries `chartAlternates` on the same `ComposedResponse` type chat.tsx reads, so the data
existed there unused. Asked directly, the owner chose to wire it now rather than document the
exclusion: one line (`alternates={message.response.chartAlternates}`) plus a regression test,
following the exact same pattern as chat.tsx/visual-dock.tsx. No embed button exists on this
surface, so D7's disable addendum does not apply here.

## Alternatives considered

- **A live server round-trip per toggle click.** Rejected: curated's own mechanism already proves
  build-once-swap-client-side is cheaper, with no click-time failure mode to design for.
- **Truncating to only the first registered alternate**, matching curated's single-alternate shape.
  Rejected once the real registry count (20 entries, several with 2-4 alternates) was measured —
  arbitrarily hiding household income's other three siblings would be a worse, less honest UX than
  a short dropdown.
- **Putting `alternates` inside `ChartSpec` itself.** Rejected: triggers the schema-v2 +
  versioned-builder cost session 69's research flagged; the sibling-field approach on
  `AnswerResponse` is additive and free.
- **Requiring registry alternate labels to be digit-free**, so the honesty scan could stay
  unexempted everywhere. Rejected: a label is not a claim about a plotted number, and suppressing a
  measure's own index base (e.g. "(2025=100)") makes the toggle harder to read without buying any
  additional honesty guarantee.
- **Building the level↔%-change transform in the same slice.** Rejected: needs a new registered
  derivation and an ADR 011 revision — a materially larger, separately-scoped piece of work. Stays
  logged as open-questions #254's remaining unscheduled gap.

## Consequences

- ~20 registered concepts (inflation, population, housing stock, GDP growth, bankruptcies,
  household income, imports/exports, retail turnover, house prices, unemployment, and others) show
  a real toggle in chat, dock, and the anonymous trial immediately. The mechanism generalizes for
  free the next time a registry entry gains an `alternates` entry — a registry data change only, no
  further engineering.
- A small number of registered alternates will build-fail every time and simply never show a
  working entry (e.g. an alternate whose `measure` lives on a different table than its primary) —
  degrades safely to a missing dropdown entry, a real logged residual (open-questions #254's
  follow-up list), not a defect fixed in this slice.
- `AnswerResponse.chartAlternates` stores up to 4 full `ChartSpec` objects per audit row
  (`buildAuditRow` stringifies the whole response) — a real, currently-unreviewed architectural
  assumption, judged low-risk today (at most 1 alternate per measure actually registered) and
  tracked at [open-questions #261](../open-questions.md), not fixed here.
- Embed (`rerunLive`/`/embed/[token]`) does not get the toggle in this slice — deliberately out of
  scope, logged as a follow-up, same mechanism could attach it with a few lines later.
- Gallery's existing manual `CuratedChartToggle` mechanism is untouched and still separate;
  unifying the two is a later question, not assumed here.

## Revisit triggers

- Level-vs-%-change gets scheduled — needs its own ADR 011 revision, not an extension of this one.
- Consumer confidence's raw sibling (table 83694NED) gets bulk-ingested — would register a real
  `alternates` entry for a measure this design explicitly found lacking one.
- Registry entries grow enough alternates, or audit-row volume grows enough, that the
  stored-`chartAlternates` size (open-questions #261) becomes a real cost/perf concern worth
  stripping before write.
- Embed's live-reload route (`rerunLive`) gets the same toggle — the mechanism is proven, just not
  wired there yet.

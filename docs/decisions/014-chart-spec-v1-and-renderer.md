# ADR 014 — Chart spec v1 contents and the Phase 0 renderer

**Status:** accepted, 2026-07-03 (WP8)

## Context

ADR [007](007-chart-spec-rendering.md) fixed the seam: a server-built declarative
chart spec, rendered by dumb renderers that may not compute, aggregate, round or
omit (invariant R6), with the client charting library "picked at implementation".
ADR [008](008-ui-foundation.md) later recorded Recharts as the default *client*
renderer. At WP8 implementation time the code in front of the session looks like
this: the repo has **no web app yet** (the minimal chat UI is a later Phase 0
session), `src/` runs directly under Node's native type stripping
(`erasableSyntaxOnly`, `.ts`-only — JSX cannot even be imported), and CI is
hermetic. The build plan makes the implementing session responsible for firming
the plan of record against that reality and recording deviations.

## Decision

1. **ChartSpec v1** (`src/chart/types.ts`, zod runtime schema in
   `src/chart/schema.ts` — ADR 008: zod is the single schema layer; stored specs
   are parsed, never trusted). Kinds `line` | `bar` in Phase 0 (`table` from
   ADR 007's vocabulary is *not emitted*: a lone number or a derivation headline
   is prose, not a chart — revisit if a table-render need appears). Each point
   carries: `resultId` (R1 traceability), period code + validated label, `value`,
   `formattedValue` (built once by the same Dutch formatter answers use — R3/R10),
   `decimals`, CBS `status` + `provisional` (R11), `valueAttribute`. Null-valued
   cells stay in the spec with their CBS reason plus a human-readable
   `nullNotes` line — a renderer cannot silently omit them. The R4 attribution
   sentence (same builder as answer text, `buildAttributionLine`) and a
   structured attribution block live inside the spec; `definitionLine` carries
   canonical-default transparency so a standalone chart render still states the
   chosen definition.
2. **Builder policy** (`buildChartSpec`): result shape `series` → line,
   `comparison` → bar, `single`/`derived` → no chart. Mixed units across cells
   throw (the query layer already refuses them; reaching the builder means
   corruption). Cell order is never changed; series group by region in intent
   order.
3. **The Phase 0 renderer is a pure, dependency-free SVG generator**
   (`renderChartSvg`) — not the Recharts wrapper. Its honesty contract: it may
   compute *layout*, never *data*; every number a viewer can read is a spec
   string (gridlines are deliberately unlabeled — no invented axis ticks); null
   points render an honest gap (marker + note, line broken, no interpolation);
   provisional points render visibly marked; attribution always renders. It
   dispatches on `schemaVersion` and refuses versions it does not speak.
   Two rules added by the pre-push adversarial review (2026-07-03): every
   value label carries a `data-label-for` binding to its point's resultId —
   the review's executing skeptics proved an unbound label swap (point A's
   value shown at point B) passed the entire original suite — and the
   categorical x-axis sorts period codes chronologically instead of trusting
   first-seen order, which misplace periods when series carry disjoint
   period sets. Both are test-enforced.
4. **The Recharts client wrapper is deferred to the chat-UI session.** ADR 008's
   constraint 3 stands unchanged: the client renders only from this spec via the
   wrapper. This SVG renderer additionally *is* the "server-side charting path"
   ADR 008's revisit triggers anticipated — the Phase 2 static-image/OpenGraph
   renderer starts from it rather than from a headless browser.

**Contract-audit additions (2026-07-03, pre-push):** the spec carries the
pinned non-geo/non-period coordinates (`dims` + `dimLabels`, one set per chart,
builder refuses disagreement) — without them two charts of the same measure at
different coordinates (Geslacht=Vrouwen vs =Mannen) were indistinguishable,
violating ADR 007's "the renderer receives only the spec"; the renderer shows
them as a subtitle. Audit notes that need no code change: NaN/Infinity can
never reach a spec (`toNumber` in the query layer throws first, and the zod
refine would catch the JSON-null artifact loudly on re-parse); a stored `-0`
becomes `+0` through JSON round-trip, which is harmless because rendering only
ever reads `formattedValue` (already "0"); the zod schema is deliberately
stricter than the TS types (int/non-empty checks TS cannot express) — one-way
only, which is the safe direction.

## Alternatives considered

1. **Add React + Recharts now and render the client component in tests.**
   Rejected: there is no app to mount it in; it forces `jsx` config and `.tsx`
   islands into a `src/` tree that runs under Node type stripping; and R6
   testability weakens — the point geometry would live inside library internals
   instead of being assertable as an exact affine image of the values.
2. **Ship the spec only, no renderer in WP8.** Rejected: the done-criterion is
   "B4/B8 *render* a correct line chart whose points equal their cells", and
   R6's renderer half ("cannot compute or omit") needs a real renderer to hold
   against, not a promise.
3. **Headless-browser rendering in tests.** Rejected: heavyweight and
   unnecessary; CI is hermetic and the SVG output is directly assertable.

## Consequences

- R6 is testable to the pixel: `tests/chart/` asserts marker positions are
  affine images of the values, every numeric token in the SVG's text occurs
  verbatim in the spec's own strings, and B4/B8 reproduce the frozen answer key
  through the real query path.
- The chat-UI session must add the Recharts wrapper *over the same spec* (and
  may serve this SVG renderer's output directly where interactivity isn't
  needed).
- Spec v1 is frozen the moment it is stored (audit records, WP10): additions
  arrive as `schemaVersion: 2` plus renderer dispatch, never as silent v1 edits.

## Revisit triggers

- Chat-UI session → build the Recharts wrapper (ADR 008 constraint 3).
- Phase 2 sharing/OpenGraph → extend this SVG renderer into the static-image
  path (sizes, formats).
- A result shape that genuinely needs the `table` kind, or a spec field v1
  lacks → schema version 2.

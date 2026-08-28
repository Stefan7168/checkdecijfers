# ADR 035 — "Ontdek Nederland in grafieken": curated deterministic charts on the public landing

**Status:** accepted (session 52, 2026-07-17). Owner approval: session 51 in-chat (open-questions
[#53](../open-questions.md)(c) refinement — the section may ship before the anonymous trial; LLM-free, no
money path).

## Context

The session-51 owner pivot puts finishing the product ahead of coverage tables. The public landing on `/`
(ADR 018 + the #98 resolution) shows one frozen example answer; the owner approved a free discovery section:
real charts of well-known series (consumentenvertrouwen, economische groei, inflatie, huizenprijzen) drawn
from our own database — no LLM, no chargeable entry point. This is the first surface reachable WITHOUT a
login that reads the database, so the choices below are load-bearing for cost, robustness and the
invariants' reach.

## Decisions

### D1 — Curated intents through the real pipeline, anchored on the freshest ingested period

`src/chart/curated.ts` holds a fixed list of chart definitions (canonical registry key + designed grain +
window length). Building a chart is exactly the chat pipeline minus the LLM parser: `freshestForCanonical`
(the WP9 seam) supplies the anchor, code authors a `StructuredIntent` for the window ending there, and
`runQuery` → `buildChartSpec` produce the spec. Every invariant that guards a chat chart (R1 resultIds, R4
attribution in the spec, R6 deterministic projection, R7 stated canonical definition, R10 units, R11
provisional marking) is therefore inherited, not re-implemented. If the freshest period is ever of a
different grain than the chart was designed for, the chart is skipped — cadence never switches silently.

*Alternatives rejected:* hardcoded period ranges (go stale every sync; a stale "discover" section is
anti-marketing); a new bespoke SQL read for the landing (would bypass the validated query layer and R7/R11 —
exactly the hole principle (a) forbids).

### D2 — Rendered by the product's client ChartView, not the pure SVG renderer

The section renders each spec with the SAME `web/components/chart.tsx` (Recharts) the paid product uses.
The session-52 kickoff sketched the pure SVG renderer (`src/chart/render.ts`), but measured against the real
job it loses: the SVG renderer labels EVERY point at fixed font sizes inside a fixed viewBox — correct for
the ≤8-point benchmark charts it gates, unreadable for 24-month windows and unscalable on mobile (scaled-down
6px text), and its hardcoded hex colors predate the huisstijl. ChartView is already huisstijl-tokenized
(s51), responsive, shows values via the bound tooltip instead of colliding labels, renders the R4/R11/
definition lines, and ships in `/`'s client bundle TODAY (page.tsx's logged-in branches import it) — so this
adds ~zero bundle weight and the visitor sees exactly the chart surface a customer gets. Data work stays
server-side; only pixel drawing is client-side, same as every product chart.

*Alternatives rejected:* pure SVG renderer inline (above); making the SVG renderer responsive/token-aware
(real surgery on a frozen, invariant-tested module for a worse result; it stays reserved as the
static-image/OpenGraph seam per ADR 007/008/014, untouched).

### D3 — In-process TTL cache with stale-over-nothing, and per-chart skip (site never breaks)

`web/lib/ontdek.ts` caches the built set for 30 minutes per warm server instance, coalesces concurrent
rebuilds onto one in-flight promise (no thundering herd, no last-writer-wins race — adversarial-review
finding, session 52) and serves the previous set when a rebuild fails (empty list when there is none — the
section then renders as nothing). Failure classes are deliberately split (same review): a DETERMINISTIC
cannot-serve (absent/quarantined table, grain mismatch, typed refusal, a pure `buildChartSpec` corruption
throw) skips THAT series with a logged reason while the healthy ones keep serving — it reproduces
identically on every rebuild, so caching it is honest; a TRANSIENT-shaped I/O throw (connection reset,
timeout) propagates out of the whole build so the stale-over-nothing fallback engages, and a one-off blip
can never get cached as a smaller chart set for a full TTL. This is the #53 continuity posture applied to
charts: the public landing NEVER breaks on a data problem, and we never guess (principle c) — we omit. The
hermetic gate test (`tests/chart/curated.test.ts`) pins zero skips against the committed fixtures, so a
production skip is a regression signal, not an accepted state. Honesty is unaffected by the cache: every
spec carries its own `syncedAt` in the R4 line, so what the visitor reads is exactly as fresh as it claims
to be.

*Alternatives rejected:* uncached per-request reads (every anonymous drive-by hits Postgres ~4× — needless
cost/DoS surface on the only login-free page); Next data-cache/`'use cache'` (new framework machinery this
repo deliberately doesn't use yet; an in-process TTL is idiom-consistent with `getDb()`'s warm-instance
singleton and trivially testable); build-time static rendering (charts would freeze at deploy time, going
stale between deploys — syncs land without deploys).

### D4 — No R8 audit rows for landing views

R8's text scopes audit records to ANSWERS to user questions. These charts answer no question, spend no
credits and involve no LLM; writing a row per anonymous page view would be write-amplification with no
verification value. Traceability is preserved structurally: every point carries its `resultId` (R1) in the
spec, and the spec is reproducible from the database by construction. **Assumption (flagged for the owner,
mirrored in open-questions [#53](../open-questions.md)(c) note):** R8 stays answer-scoped; if the owner ever
wants view-level audit for public surfaces, that is a new decision.

### D5 — Event annotations and the narrow definition toggle (as-built, session 66, open-questions #170(4))

Two additive, optional extensions to the D1 pipeline, both landed together on `feat/170-4-ontdek-annotations-and-toggle`:

**Annotations.** A curated `CHART_ANNOTATIONS` dataset (`src/chart/annotations.ts`, plain hand-authored array —
mirrors how `ONTDEK_CHARTS` itself is curated, per D1) of real, uncontroversial macro-economic reference points
(financiële crisis 2008, coronacrisis 2020, start Oekraïne-oorlog 2022). `ChartSpec` gains an OPTIONAL
`annotations` field (`src/chart/schema.ts`/`types.ts`) — `buildChartSpec` itself never sets it, so every spec the
chat/answer pipeline builds and every spec stored before this change (R8: those rows live forever) is unaffected;
only `src/chart/curated.ts`'s Ontdek path merges annotations in, after the deterministic builder runs, selecting
only entries whose curated period code is literally one of the chart's own already-plotted periods (never an
approximate placement). Rendered as a dashed reference line + always-visible footer text (never hover-only) in
both `src/chart/render.ts` (SVG) and `web/components/chart.tsx` (Recharts `ReferenceLine`) — the SVG renderer's
own comment explains why a rotated inline label was rejected (collision risk with point labels at this chart's
typical width). **Measured limit, not a defect:** with the D1 rolling windows (2 years of months / 3 years of
quarters ending at the freshest ingested period), none of the three curated dates falls inside any live chart's
plotted range today — the mechanism is proven directly (`tests/chart/annotations.test.ts`) against a constructed
in-range window rather than against today's actual timing.

**Definition toggle, narrow form.** `CuratedChartDefinition` gains an optional `alternateReading` (dims +
label); when present, `buildOne` builds a SECOND spec over the identical period window via an explicit
`{tableId, measure, dims}` target (the same table + measure the primary canonical reading resolved to, from its
own `ValidatedResult` — never re-derived independently), through the identical `runQuery` → `buildChartSpec`
path. The client (`web/components/chart-toggle.tsx`) only swaps which of the two already-validated specs is
displayed — no new query, no client-side computation — so R6 is unaffected by which reading is on screen. This
is deliberately the general Phase-2 `#46` mechanism's narrow ancestor, not `#46` itself (per the #170(4)
architecture sketch's own recommendation): one hardcoded alternate per chart definition. Only one of the five
`ONTDEK_CHARTS` entries carries it — `werkloosheid` (`unemployment_rate_seasonally_adjusted`), added to
`ONTDEK_CHARTS` specifically for this, because it is the only `CANONICAL_MEASURES` entry
(`src/registry/defaults.ts`) whose `alternates` names a genuine same-table, same-measure
seizoengecorrigeerd/ongecorrigeerd pair; none of the original four chart's measures have one (their own
`alternates`, where present, differ by measure code or table, not by this dims-only seasonal-adjustment
reading). A failed or refused alternate build degrades to "no toggle" (`CuratedChartsOutcome.toggleSkipped`,
logged in `web/lib/ontdek.ts` the same way a whole-chart skip is) without touching the primary chart.

*Alternatives considered:* fabricating a new registry alternate on one of the original four charts (rejected —
would need unverified CBS dimension coordinates, against principle (c)); building `#46` in general (rejected —
explicitly out of scope, Phase-2-tied, and unnecessary for one hardcoded pair); embedding annotations inside
`buildChartSpec` itself (rejected — would touch the one shared builder chat answers also use, for a feature that
is Ontdek-only today).

## Revisit triggers

- The #53 anonymous trial ships on the same page (shared surface — re-check load and cache posture).
- A curated series is skipped in production (data regression — fix the data, not the section).
- Marketing wants more/other series (extend `ONTDEK_CHARTS`; the gate test pins each addition).
- Real traffic makes the per-instance TTL insufficient (move to a shared cache then, not before).

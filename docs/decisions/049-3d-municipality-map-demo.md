# ADR 049 — 3D municipality map demo over fictional data

**Status:** built, session 103 (2026-09-15, autonomous — the owner was present in the parent conversation that
dispatched this build, but the build itself ran unsupervised in the background, so it goes through branch + PR
review per [open-questions #118](../open-questions.md)(b), not a direct push). Branch `demo-3d-municipality-map`,
PR open, not merged. **Not part of the product** — see Context.
**Deciders:** Stefan (the demo concept, seeing a reference site he built himself, and the go-ahead to build it);
session (the engineering shape, written up here as the plan's own "Design decisions taken for this plan" section,
executed task-by-task via [superpowers:subagent-driven-development](../superpowers/plans/2026-09-15-3d-municipality-map-demo.md)).
**Input:** [superpowers/plans/2026-09-15-3d-municipality-map-demo.md](../superpowers/plans/2026-09-15-3d-municipality-map-demo.md)
(the plan's own "Design decisions taken for this plan" section is this ADR's rationale, restated below with the
as-built numbers this ADR is responsible for recording).

## Context

The owner asked for a demo reproducing a reference site he had built himself: every Dutch municipality as an
extruded 3D column on a map, height = population, colour = growth, a year slider, hover/click detail. This is
**not a reopening of a settled decision.** ADR [044](044-story-stage.md)'s kickoff (session 95, 2026-09-11)
explicitly ruled a 3D municipality map OUT of the real product's Story stage: *"a 3D chart makes equal values
look unequal (Tufte, Cleveland–McGill) and a WebGL canvas is invisible to every honesty scan and to the export
(R6)"* — see that ADR's "Alternatives considered": *"Charts drawn as 3D objects … a canvas is opaque to the
R1/R6 scans, to screen readers and to the svg export; a second renderer with its own honesty proofs is a
different product with a weaker guarantee,"* and *"The 3D municipality map (what the reference demo actually
is). Out of scope for this programme — a geographic feature, not a chart enhancement; a written proposal at
most, once everything else is done."* Nothing in this ADR overrides that ruling. This demo exists entirely
OUTSIDE the answer pipeline: it answers no question, computes no CBS statistic, and enters no envelope, audit
row, or export path R1/R6/R11 govern.

## Decision

**D1 — One directory is the whole isolation boundary.** `web/app/bevolking-3d-demo/` holds every non-shared file
— page, a server-rendered `DemoBanner`, the `map3d-loader.tsx` dynamic-import shim, the WebGL scene, the fake
data generator, the hand-rolled TopoJSON decoder, the colour/height scales, the column-mesh builder — plus their
tests. Nothing outside that directory changed except the message catalogue (new keys only) and `package.json`
(`three`+`@types/three`, unreferenced outside the directory). `web/app/bevolking-3d-demo/isolation.test.ts` walks
`web/app`, `web/components`, `web/lib` and `web/proxy.ts` and pins three separate things at once: (a) no file
outside the directory imports `three`; (b) the route string `bevolking-3d-demo` appears nowhere outside its own
directory (nothing links to it); (c) nothing inside the directory reaches `web/backend` (`src/`), `lib/db.ts`,
`@anthropic-ai`, a `'use server'` action, or a live `fetch('https://…')` call.

**D2 — Fictional, deterministic, name-blind data.** `fake-data.ts`'s `buildFakeDataset` seeds a `mulberry32` PRNG
from an FNV-1a hash of the municipality CODE (never the name) combined with the polygon's approximate area; the
same boundary file always yields the same fake numbers. The generator is deliberately NOT tuned to look right for
any real place — principle (c) applied to a demo: a fake that resembles Amsterdam's real population is more
dangerous than one that looks obviously made up. Every record and the dataset itself carry `fictional: true`.

**D3 — `three`+`@types/three` is the one owner-approved exception to the zero-library rule for chart visuals,**
reachable only through `map3d-loader.tsx`'s `next/dynamic(() => import('./map3d.tsx'), { ssr: false })`.
TopoJSON decoding is hand-rolled (~40 lines, zod-validated) rather than adding `topojson-client`, keeping the
exception at exactly one library. `OrbitControls` comes from `three/addons/…` inside the same package — no
`@react-three/fiber`, no `drei`, no tween library.

**D4 — Placement, gating, discoverability (four independent locks, per the plan):** the route
`/bevolking-3d-demo` is (1) `robots: { index: false, follow: false }`; (2) linked from nowhere (D1's isolation
test); (3) login-gated by default — not in `web/proxy.ts`'s `PUBLIC_EXACT_PATHS`, so an anonymous visit 307s to
`/login` with zero proxy change (`isPublicPath('/bevolking-3d-demo') === false`, pinned in `page.test.tsx`); (4)
no env flag — unlike the Eurostat internal explorer (which must NEVER appear in production), this demo is meant
to be shown from production by the signed-in owner, so a flag would add a RUNBOOK secret for no honesty gain.
Whether to ever make it link-shareable to an outsider is [open-questions #250](../open-questions.md) — not
decided here.

**D5 — The boundary file is a static asset, not a module import.** `web/public/demo/gemeente_2024.topojson`
(169 KB, real CBS/PDOK municipality boundaries and names via cartomap.github.io, CC BY 4.0) is fetched at
runtime from the app's own origin (`/demo/gemeente_2024.topojson`) — never live from cartomap. Fetched once, by
hand, with the owner's go-ahead recorded 2026-09-15; `web/public/demo/README.md` documents the provenance.
Importing it as JSON would have inlined 169 KB into the route's JS chunk; as a static asset it is CDN-cached and
parsed off the JS main thread. The `TOPO_OBJECT`/`CODE_KEY`/`NAME_KEY` assumption (that the file names its
object `gemeente_2024` and its properties `statcode`/`statnaam`) is verified against the real committed file by
`asset.test.ts`, which decodes it for real and would fail loudly, naming the real keys, if the assumption were
wrong — see [open-questions #251](../open-questions.md). It held on the first run: 369 municipalities, every
code matching `GM####`, total area ≈37,000 km² (the real Netherlands).

**D6 — Colours reuse the house palette; the WebGL-only literals are a narrowly sanctioned exception.** The
growth scale's two ENDPOINTS are `DEFAULT_PALETTE[0]`/`DEFAULT_PALETTE[1]` (not new literals) through a neutral
per-theme midpoint; both endpoints re-pinned at ≥3:1 contrast against both cards (the same ADR 042 pin,
re-asserted in `scales.test.ts` so the demo cannot silently drift from it). Because a `three.js` `Color`/
`Material` cannot read a CSS custom property, `scales.ts` (the theme midpoint + plate colour), `columns.ts` (an
initial placeholder colour before the scale first applies) and `scene.ts` (the pure white/black hover-highlight
emissive) each hold small literal hex values — the demo's sanctioned literal-hex spot, recorded in
[docs/12-huisstijl.md](../12-huisstijl.md) rule 1. Every other surface — the banner, buttons, labels, the legend
swatch background — uses tokens exclusively.

**D7 — Labelling is five independent layers, locked by test, not by convention alone:** (1) `DemoBanner`, a
server-rendered, prop-less (`{ lang }` only — a `// @ts-expect-error` line pins that no `hidden`-style prop
compiles) component rendered by the PAGE, so the "DEMO — FICTIEVE DATA" badge exists in the HTML before any JS
runs and survives a failed or slow 3D chunk; (2) a diagonal "FICTIEF" watermark over the canvas
(`aria-hidden`, `pointer-events-none`), visible in every screenshot; (3) every number-bearing DOM element sits
inside `data-fictional="true"`, walked by `map3d.test.tsx`'s own digit-scan (every digit-bearing text node must
sit under `[data-fictional="true"]` or `[data-year]` — the one exemption, matching the plan's own footer
carve-out, is `[role="status"]`: fixed UI copy like "This browser cannot show 3D (no WebGL)" carries an
incidental digit that is not a fictional statistic, exactly the same reasoning the plan already applied to the
footer's "CC BY 4.0"); (4) the `<title>` says "Demo … (fictieve data)"; (5) the footer line "Cijfers: fictief,
alleen ter demonstratie."

## Alternatives considered

- **`topojson-client` for the boundary decode.** Rejected — would have made two new libraries instead of one;
  the hand-rolled decoder is ~40 lines and fully unit-tested against an inline two-municipality fixture
  (`test-fixture.ts`'s `TWO_SQUARES_TOPOLOGY`) covering delta-decoding, negative-index arc reversal, ring
  joining, MultiPolygon and the no-transform (absolute-arc) case.
- **`@react-three/fiber`/`drei`.** Rejected — plain `three.js` keeps the scene as one pure, disposable module
  (`scene.ts`) with an explicit imperative API (`SceneHandle`) the React component calls into, rather than a
  second component-tree paradigm layered over the existing one; nothing in this demo needs `drei`'s helpers.
- **A fully public route (no login gate).** Rejected for now — the owner asked for a demo, not a marketing page;
  gating it behind the login costs nothing today and is the more conservative default. Recorded as
  [open-questions #250](../open-questions.md) rather than decided either way, since sharing it externally is a
  real, plausible future ask.
- **An env flag (mirroring the Eurostat internal explorer's `EUROSTAT_EXPLORER_ENABLED`).** Rejected — that
  flag exists because the explorer must NEVER appear in production; this demo is the opposite case, meant to be
  shown from production by the signed-in owner. A flag here would only add a RUNBOOK secret and a "forgot to set
  it" failure mode for no honesty gain.

## Consequences

- A route-private client chunk group exists that no other page can reach — see "Bundle measurement" below for
  the measured cost.
- `three`+`@types/three` are now real `package.json` dependencies of `web/`, even though `isolation.test.ts`
  proves they are imported nowhere outside this one directory — `npm audit`/dependency-alert tooling will now
  surface `three` advisories at the monthly maintenance session; this is the accepted cost of the one-library
  exception.
- The demo has its own trust surface, distinct from the product's: `05-data-rules.md`'s invariants (R1–R11)
  govern the real answer pipeline and do not apply here by construction (nothing in this directory can produce
  an `AnswerResponse`, an audit row, or a chart spec) — this ADR's own D2/D7 are the demo's equivalent honesty
  contract, verified by its own tests rather than the shared invariant suite.
- A future real geographic/region-map feature (if the product ever grows one) starts from zero, not from this
  demo — see Revisit triggers.

## Bundle measurement (measured, not asserted — 2026-09-15)

**Method.** Turbopack's `next build` output (Next.js 16.3.4) does not print the webpack-era per-route "First
Load JS" table, so route attribution was done from the actual build artifacts instead: each route's
`.next/server/app/<route>/page/react-loadable-manifest.json` lists exactly which static chunk files that
route's `next/dynamic` calls can reach. Cross-checking every route's manifest confirmed the three-touching chunk
group is listed ONLY under `/bevolking-3d-demo` — no other route's manifest references any of them.

**The route-private chunk group** (`static/chunks/0s-gtnyug0-di.js`, `27_yx23vm9gwy.js`, `0u0b7x8kyggl4.js` —
reachable only via `map3d-loader.tsx`'s dynamic import):

| File | Raw bytes | Gzip bytes | Contents (identified by grep against the minified output) |
|---|---|---|---|
| `0s-gtnyug0-di.js` | 591,830 | 147,557 | `three`'s `WebGLRenderer`/`ExtrudeGeometry`/`Earcut` + `OrbitControls` |
| `27_yx23vm9gwy.js` | 381,627 | 87,256 | `zod` — this is the FIRST client-side bundling of `zod` anywhere in the app (every other use is server-side); `topojson.ts`'s schema validation, reached through the dynamic import, is what pulls it into a browser bundle for the first time |
| `0u0b7x8kyggl4.js` | 497 | 327 | glue |
| **Total** | **973,954 (≈951 KB)** | **235,140 (≈229.6 KB)** | |

**Against the plan's own numbers:** the plan estimated ≈150–180 kB gzipped for the `three`-only payload and set
a 250 kB ceiling for "the route-private chunk." The `three`+`OrbitControls` chunk alone (147.6 KB gzip) lands
inside that estimate. The group's TOTAL (229.6 KB gzip) is under the 250 KB ceiling but closer to it than the
plan expected, almost entirely because `zod` — already a project dependency, previously bundled only in
server-side code paths — gets bundled client-side for the first time by this route. **This did not require
stopping and reporting per the plan's own rule** (only exceeding 250 KB does), but is recorded here because it
is a real, non-obvious cost worth knowing about: a future route that also imports `topojson.ts` (or otherwise
becomes the second client-side `zod` consumer) would NOT re-pay this 87 KB — it is a one-time cost this route
happens to be first to trigger, not a `three`-specific cost.

**The other routes (`/`, `/galerij`, `/geschiedenis`).** A true byte-level "identical before/after" comparison —
what the plan asked for — turned out not to be obtainable the way the plan expected, and that is recorded here
rather than papered over: a fresh `main`-branch build (via a detached-HEAD worktree at `292fec4`, the commit
this branch forked from) and a fresh rebuild of this branch produced chunk-file counts/total sizes that differ
by more than this change's source diff could explain (19 files / 2024 KB on `main`'s non-demo routes vs. a
non-demo remainder that does not net out to the same total on the branch) — Turbopack's chunk splitting is not
byte-stable across separate build invocations of unchanged code, so filename- or total-size-based comparison
across two separate `next build` runs is not a reliable signal here. **The reliable proof is the source diff,
not a bundle-size diff:** `git diff --stat main -- src/ tests/ benchmark/ migrations/` is EMPTY (the answer
pipeline, the invariant suite and the benchmark are byte-untouched), and outside `web/app/bevolking-3d-demo/` +
`web/public/demo/`, exactly two files changed: `web/lib/i18n/messages.ts` (58 lines added, all new `lab3d.*`
keys, zero existing keys touched — ≈3.6 KB of added source text, shared by every page that imports the
catalogue, negligible after minification/gzip) and `web/package.json`/`web/package-lock.json` (`three` +
`@types/three` added as dependencies — confirmed by `isolation.test.ts` to be imported nowhere outside this
directory, so they add zero bytes to any other route's actual JS output; a dependency in `package.json` with no
importer contributes nothing to a bundle). The route list itself is the other confirmable fact: `main` builds
15 routes, the branch builds those same 15 plus `/bevolking-3d-demo` — no route was removed, renamed, or
changed shape.

## Revisit triggers

- **A real (non-demo) geographic/region-map feature is proposed.** This ADR does not authorize one. That
  feature would need its own design round re-answering ADR 044's two objections in ITS OWN terms: how would a
  3D/extruded encoding avoid making equal values look visually unequal (Tufte/Cleveland–McGill), and how would
  the rendered result stay visible to the R1/R6 honesty scans and the SVG export path real charts go through
  today (a canvas is opaque to both). Nothing about this demo's existence — including that it looks good, or
  that `three` is now a `package.json` dependency — answers either question for a real feature.
- **`three` needs to appear in a second place.** If a future feature legitimately needs `three` too, revisit
  whether it stays a demo-only dependency or graduates to a documented, generally-available exception — do not
  silently duplicate the library or the TopoJSON decoder.
- **The route-private chunk group approaches or exceeds 250 kB gzip** (today 229.6 KB, see measurement above) —
  the next addition to this directory that grows the bundle should re-measure before merging, not assume
  headroom remains.
- **[open-questions #250](../open-questions.md) is answered "yes, make it public"** — implement the two-line
  proxy allowlist change + `proxy.test.ts` pin the plan describes; do not improvise a different gating
  mechanism.

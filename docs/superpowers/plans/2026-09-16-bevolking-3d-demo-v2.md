# Plan — `/bevolking-3d-demo` v2: close the visual/UX gap to the reference

**Status:** dispatched autonomously, session 104 (2026-09-15/16, owner not present for the build itself — the
owner asked for this live in chat, showed the reference, then said to proceed autonomously overnight; branch +
PR per [open-questions #118](../../open-questions.md)(b), no direct merge).
**Trigger:** the owner reacted very negatively to the built demo (ADR [049](../../decisions/049-3d-municipality-map-demo.md))
compared to `https://checkdecijfers-3d-demo.vercel.app/nl-bevolking-3d` — his own separate personal showcase site
(18 Three.js demos, repo `checkdecijfers-3d-demo`, NOT part of this product) — and asked, in strong terms, for a
"re-engineer" pass, then handed the session autonomy to just do it well rather than ask more questions.

## Scope decision (made by the session, no owner interview possible — default + bound, per
[docs/lessons-learned.md](../../lessons-learned.md)'s "Document, don't escalate" convention)

**In scope tonight:** raise `/bevolking-3d-demo` (the population-growth 3D map, ADR 049) to the polish level of
the reference site's own `/nl-bevolking-3d` page — same underlying concept (extruded municipality columns,
height = population, colour = growth since 1995, a year control, fictional test data over real municipality
boundaries), executed at reference quality. This is not a new feature or a new ADR-level decision — it is
ADR 049 done properly, on the same D1–D7 invariants.

**Explicitly OUT of scope tonight (do not build these — flagged in open-questions instead):**
- The `/pendel` commuting-flow demo (animated OD arcs, a real CBS table `85481NED`) — a structurally different
  feature needing real commuting-matrix data, not a visual-polish pass on what exists. Real data in a demo
  context is also a new question ADR 049 never answered (D2 is fictional-only).
- Any of the other 16 pages on the reference site (scrollytelling news reconstructions, the neighbourhood
  drill-down, the two-municipality duel view, the CBS embed generator, etc.). Each is its own scoping/ADR
  decision.
- Recorded as [open-questions #258](../../open-questions.md) for the owner to prioritise, not decided here.

## What "the gap" actually is (read directly off both live pages, session 104)

Screenshotted both `checkdecijfers.vercel.app/bevolking-3d-demo` is login-gated so a like-for-like screenshot
wasn't possible this session (the session has no credentials to complete the magic-link/Google login flow
autonomously) — the comparison below is the reference page's screenshot against a full read of this repo's
current `scene.ts` / `map3d.tsx` / `columns.ts` / `scales.ts`. Whoever executes this plan should log in once
(the owner's session, or ask in the PR description) and take a real before/after screenshot pair for the PR.

1. **No choropleth "floor."** The reference colours EVERY municipality's own footprint by growth (a full diverging
   red↔blue map even where population is low), with columns as an ADDITIONAL height layer only for population —
   so the whole country reads as a coloured terrain, columns rising out of it. Our `scene.ts` renders one flat
   grey `plate` (`SCENE_COLORS[theme].plate`, uniform `#e5e5e5`/`#262626`) UNDER columns that are each individually
   coloured — architecturally close (every column's own top face already carries `growthColor()`), but the
   near-invisible sliver at `MIN_HEIGHT` (0.4 of a 0–40 range) reads as flat grey from the camera angle, and nothing
   currently proves the low-population municipalities are legible as coloured terrain rather than grey gaps.
2. **No building separation.** The reference's tall columns read as distinct city blocks with visible gaps between
   neighbours; `columns.ts`'s `ExtrudeGeometry` traces each municipality boundary edge-to-edge with zero inset, so
   adjacent tall columns fuse into a single coloured mass.
3. **Flat, toy-like lighting.** `scene.ts` uses one `HemisphereLight` + one `DirectionalLight` over
   `MeshLambertMaterial` — no shadows, no ambient occlusion feel, no material variation. The reference's terrain and
   columns read as considered, designed objects, not a wireframe demo.
4. **No self-contained legend.** The reference has a floating card INSIDE the canvas (top-right) with a proper
   diverging legend (`≤ -20 % … 0 % … ≥ +60 %`) and a one-line height caption. Ours is a thin gradient bar living
   BELOW the canvas as its own paragraph — functional, not designed.
5. **No guided narrative.** The reference's biggest structural difference: a card below the map titled "Zo lees je
   deze kaart" with 5 dot-paginated steps and Vorige/Volgende buttons — it reads as an edited, finished piece
   walking the visitor through what they're looking at. Ours has zero narrative layer — just raw controls (year
   slider, play, reset view, type filter, municipality picker) with no framing.
6. **Control-bar polish.** The reference's bottom bar is one clean row: year value + scrubber + play, and a
   municipality search/dropdown. Ours wraps five separate control groups (slider, play, reset, type filter,
   municipality picker) with less visual hierarchy.

## Design decisions for this plan (session-made defaults; ADR 049 gets an as-built addendum, not a new ADR
— the underlying decision doesn't change, only its execution quality)

- **D1′ — Floor becomes a choropleth.** Replace the flat `plate` with a per-municipality thin extrusion
  (reuse `columns.ts`'s geometry-building path, depth ~0.15, NOT scaled by the year tween) coloured by
  `growthColor()` at all times — this is the terrain. The existing population column becomes a SEPARATE mesh
  per municipality, inset ~6% from its footprint (shrink the traced ring toward its centroid before extruding —
  keep it a pure client-side geometry transform, no new dependency) so tall columns show a visible seam between
  neighbours, sitting visually ON TOP of the floor tile at the same (x, y). Both meshes share `growthColor()` so
  they read as one continuous colour at any given (municipality, year) — this must be pinned by a test (same
  colour computed once, applied to both meshes) so the floor and the column can never visually disagree.
- **D2′ — Lighting/material pass, still `MeshLambertMaterial`/no new dependency.** Add a second, softer fill
  `DirectionalLight` from the opposite side (reduces the single-shadow-direction toy look) and tune
  `HemisphereLight` ground colour toward the plate/floor palette so ambient bounce reads as "terrain," not
  "grey box." No shadow maps (real-time shadow maps on ~342×2 meshes is a real perf/complexity jump this plan
  does not sign up for) — stays in the plan's stated budget.
- **D3′ — Legend becomes a floating card.** A new `Legend` component absolutely positioned inside the canvas
  wrapper (top-right on desktop, collapses to a compact strip on narrow viewports — the existing `useMediaQuery`
  hook already in this directory), reusing `GROWTH_LOW_HEX`/`GROWTH_HIGH_HEX`/`GROWTH_MID_HEX` — no new colour
  literals. Every digit it shows (the `±20%`/`±60%` domain labels) sits under `data-fictional="true"` per D7 of
  ADR 049 (the digit-scan test in `map3d.test.tsx` will catch a miss).
- **D4′ — A guided narrative card, five steps, dot pagination + Vorige/Volgende — new i18n keys only, both
  `nl` and `en` (per CLAUDE.md's UI-copy convention, superseded 2026-09-09: interface strings get both locales).**
  Steps are static copy (not data-driven), each one a short (`nl`) sentence pair matching the reference's own
  voice ("Elke gemeente is een kolom: hoogte is het aantal inwoners, kleur de groei sinds 1995. Alle cijfers zijn
  fictief." style) — draft real copy against this repo's actual scale/domain numbers
  (`GROWTH_DOMAIN`, `YEAR_START`/`YEAR_END` from `fake-data.ts`), not the reference site's own numbers (they
  describe ITS dataset, not ours). The narrative card does not control the 3D scene (no "step 3 flies the camera
  here") — that is a materially bigger feature (camera choreography) this plan does not include; it is expository
  text only, consistent with keeping this a bounded polish pass.
- **D5′ — Control bar consolidation.** One row: year label + value + scrubber + play/pause, and the municipality
  picker becomes a labelled search-style `<input list=…>` or keeps the existing `<select>` (executor's call,
  whichever reads cleaner against the reference) sitting to the right. The `type` filter (city/mid/rural) and
  `resetView` button move into a small secondary row or an overflow disclosure — they are real, useful controls
  from ADR 049 and must not be deleted, just de-emphasised relative to year/play/search.
- **Everything else about ADR 049 stands unchanged:** D1 (one-directory isolation, `isolation.test.ts` keeps
  passing untouched), D2 (fictional-only data — the new floor/legend/narrative show ZERO new numbers, only
  restyle existing `growthSince`/`populationIn` outputs), D3 (still exactly `three` + `@types/three`, no new
  library — the "search" input above must not become a new combobox dependency), D4 (gating: noindex, no site
  link, login-gated, no env flag), D6 (house palette only, same sanctioned literal-hex spots — do not add new
  ones without updating ADR 049's D6 list), D7 (all five labelling layers, banner/watermark/`data-fictional`/
  title/footer, stay — the digit-scan test is the enforcement mechanism, keep it green).

## Execution

Single agent, one worktree (`../checkdecijfers-worktrees/bevolking-3d-demo-v2`, branch `bevolking-3d-demo-v2`) —
this is one small, dense directory (14 files); splitting into parallel agents would create merge conflicts, not
speed. The agent should visit both reference pages itself
(`https://checkdecijfers-3d-demo.vercel.app/nl-bevolking-3d` and the site root `https://checkdecijfers-3d-demo.vercel.app/`)
for direct visual grounding rather than working from this document's prose description alone.

## Done-definition

- Full verification block (typecheck, suites incl. this directory's own tests, hermetic benchmark gate unaffected
  since this route touches nothing in the answer pipeline, real `next build`) green.
- `isolation.test.ts` and `map3d.test.tsx`'s digit-scan pass UNCHANGED in their pinned invariants (new code must
  satisfy them, not weaken them).
- `/code-review` LOW-or-above pass on the diff, findings fixed before PR.
- A before/after screenshot pair in the PR description (after requires a logged-in session — note in the PR if
  this wasn't obtainable and say why).
- ADR 049 gets an as-built addendum (not a rewrite) recording D1′–D5′ as executed, and
  [open-questions #258](../../open-questions.md) records the explicitly-deferred scope (pendel/commuting demo,
  the other 16 reference pages).

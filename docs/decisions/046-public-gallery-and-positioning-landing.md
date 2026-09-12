# ADR 046 — The public gallery and the positioning-sentence landing

**Status:** accepted in design, 2026-09-12 (session 98, autonomous big-build variant, item 1 of the session-98
kickoff's package list — [open-questions #237](../open-questions.md), [08-build-plan.md § Journey programme](../08-build-plan.md)
decision 12). Built on branch `journey-public-face`, stacked on `journey-programme`, for the owner's review before
merge (autonomous session, core-product code — [#118](../open-questions.md)(b)).

## Context

The landing (`web/components/landing.tsx`) and the "Ontdek Nederland in grafieken" section (ADR 035) predate the
product's current positioning: *"chat your way from official-statistics research to an embedded, sourced chart"*
over official CBS data. The landing's copy still led with a bare Q&A framing, and the only public chart surface was
four discovery charts tucked into a 2×2 grid with no story around them — nothing on the public site showed the full
loop (ask → chart → present/style → embed) that is now the product's actual pitch. The owner asked for the landing
rebuilt around that sentence, plus a public gallery of roughly ten real stories on the live `ChartView`, in both
languages, with **zero AI spend and zero server-action calls** on the public pages — the same cost discipline as
ADR 035's Ontdek section, now stated as an explicit constraint because the gallery mounts an order of magnitude more
charts per page load than the landing ever did.

## Decision

1. **`GALLERY_STORIES` is a second, parallel definition list in `src/chart/curated.ts`**, built through the
   IDENTICAL deterministic pipeline as `ONTDEK_CHARTS` (`freshestForCanonical` → hand-authored `StructuredIntent` →
   `runQuery` → `buildChartSpec`, ADR 035's own posture: skip-never-guess, no LLM, no audit rows). `ONTDEK_CHARTS`
   stays byte-identical — this is additive, not a replacement. `buildCuratedCharts(db, definitions = ONTDEK_CHARTS)`
   took an optional second parameter so both lists share one builder.
2. **Twelve stories**, chosen from `CANONICAL_MEASURES` keys whose table + grain are present in the committed
   fixtures (`tests/fixtures/cbs`, `SEED_TABLES`) and which yield at least one `scoreFindings` finding over their
   window: `consumentenvertrouwen`, `economische-groei`, `inflatie`, `huizenprijzen`, `werkloosheid` (the five
   ONTDEK_CHARTS definitions, re-listed rather than imported — each needs its own `look`), plus `faillissementen`,
   `producentenprijzen`, `detailhandelsomzet`, `supermarktomzet`, `consumptie-huishoudens`,
   `werkloosheid-maandelijks`, and `zonnestroom`. **`population_on_1_january` was tried and dropped**: it is a
   regional table (`RegioS`) with no default region pinned in the registry entry, so a bare canonical query on it
   refuses `needs_clarification` — correctly, per principle (c): no axis is ever defaulted silently. Adding a
   region-default convention for population-style keys is a separate, later registry decision, not implied by this
   substitution (mirrored in open-questions.md).
3. **Each definition carries an optional `look?: string`** — a `web/lib/chart-templates.ts` `ChartTemplateId`, kept
   as a bare string in `src/chart/curated.ts` so `src/` never imports from `web/lib` (the ADR 001 module boundary).
   The web side (`web/components/gallery.tsx`) resolves it back to a real `ChartTemplateId`, falling back to
   `'standard'` for any unrecognised value — never a thrown error on the public surface.
4. **`web/lib/ontdek.ts` was generalised into one `makeCuratedFeed(label, definitions)` factory** shared by
   `getOntdekCharts()` (over `ONTDEK_CHARTS`) and the new `getGalleryStories()` (over `GALLERY_STORIES`) — same TTL
   cache (30 min), in-flight coalescing, stale-over-nothing and empty-over-crash fail-safe as before, now with two
   INDEPENDENT cache slots (a build failure or cache hit on one feed never leaks into the other — pinned in
   `web/lib/ontdek.test.ts`).
5. **`ChartView` gained two additive props**: `initialPresentation?: PresentationOverrides` (the chart mounts already
   wearing a look — the gallery's `templateById(look).overrides`) and `initialPanel?: 'story'` (mounts with Insights
   open at step 0, as if the reader had clicked its trigger). The spec-swap reset path (`chart-view-state.ts`'s
   `reset` action) now falls back to `initialPresentation` instead of `{}` when one was given; `onReset` ("Standaard")
   is UNCHANGED and always clears to `{}` regardless of what the chart mounted with (owner decision E, session 90,
   stays intact).
6. **The zero-server-action-calls rule is enforced inside `ChartView` itself, not by the gallery page**: `openStory`
   now checks `useChartStyle().signedIn` before calling `generateInsights` — an anonymous visitor gets the R5.3
   honest "log in for AI-phrased insights" line set directly, with no round trip. Before this change every chart
   opened with `initialPanel="story"` fired one wasted anonymous server-action call; a gallery of ten stories would
   have been ten calls per page load. This fix benefits every anonymous surface, not only the gallery.
7. **`/galerij`** (`web/app/galerij/page.tsx`) is a public, noindexed Server Component — same shell pattern as
   `/werkwijze`/`/systeemoverzicht`: stripped `SiteHeader`, every string through `getLang()`/`t()`, explicit
   `robots: { index: false, follow: false }` metadata, added to `proxy.ts`'s `PUBLIC_EXACT_PATHS` (exact match, with
   its `proxy.test.ts` case in the same commit — the session-97 lesson about new routes 307ing to `/login`). The
   gallery's card grid (`web/components/gallery.tsx`) is shared between this page (all stories) and the landing's
   new teaser section (first three, `GalleryTeaser`) — one card renderer, one data-fetch path.
8. **The landing was rewritten around the positioning sentence**: the Dutch H1 (`landing.heroTitle`) stays
   owner-pinned verbatim; the subtitle (`landing.heroSubtitleV2`) and a second CTA ("Bekijk de galerij"/"See the
   gallery" → `/galerij`) carry the positioning sentence in both languages. The old Ontdek section (`ontdek.tsx`) is
   no longer mounted on the landing — replaced by the gallery teaser — but stays compiling (referenced elsewhere,
   its own test suite untouched).
9. **No embed code ships on this branch.** PR #9 (the embed feature) is not merged into this branch's base; the
   gallery's intro carries an honest, source-free "coming soon" line (`gallery.embedComingSoon`) rather than naming
   what's coming, per the Public-claim rule and principle (c). Tracked as a follow-up in open-questions.md.

## Alternatives considered

- **A static gallery of pre-rendered PNGs of ten example charts.** Cheapest possible mechanism, and tempting under
  the "cheapest viable mechanism first" convention — but it fails the actual ask outright: the owner's whole point
  was to *demonstrate the live product* (Present/Style/Insights all working, in front of a signed-out visitor), and
  a screenshot cannot do that. It would also drift from reality the moment CBS publishes a new period, silently
  becoming a stale, uncorrectable claim — worse than the maintenance cost of the real pipeline, which self-refreshes
  on every sync via the existing TTL cache.
- **A separate marketing site/subdomain for the gallery**, decoupled from the Next.js app. Rejected: it would need
  its OWN copy of `ChartView`, the huisstijl tokens, and the i18n catalogue (or ship a static screenshot after all),
  duplicating exactly the code this ADR's whole point is to reuse verbatim. It also multiplies the noindex/proxy
  surface to manage and gives the owner a second deploy pipeline to keep in sync with zero product benefit at this
  phase (pre-launch, one contributor).
- **Route the gallery's Insights panel through a real `generateInsights` call, showing the AI-phrased captions to
  everyone.** Rejected on the explicit owner constraint (zero AI spend on public pages) and the "cheapest viable
  mechanism first" convention: the deterministic `buildFindings` captions (R3 floor) already read as genuine
  findings without any model call, and offering the AI upgrade only to signed-in visitors is the existing,
  already-shipped R5.3 posture — this ADR only closes the wasted-round-trip bug in it, never widens who gets billed.

## Consequences

- A gallery page load now touches the database through exactly ONE cached, deadline-guarded feed
  (`getGalleryStories()`) and zero server actions — verified directly in `web/components/gallery.test.tsx` (mocks
  `generateInsights` and asserts it is never called across all twelve cards) and `tests/chart/curated.test.ts` (every
  story builds, ≥ 8 points, ≥ 1 finding, full R4 attribution).
- `ChartView`'s two new props are additive and off by default everywhere except the gallery — every existing call
  site (chat, the visual dock, Ontdek, the story stage) is unaffected; the whole existing chart test suite
  (`chart.test.tsx`, 217 → 220+ tests) stays green.
- The `openStory` signedIn gate is a genuine bug fix beyond this WP's scope, landing here because the gallery is
  what exposed it (ten charts × one wasted call each, versus one on the old Ontdek section).

## Revisit triggers

- PR #9 (embed) merging — replace `gallery.embedComingSoon` with the real embed control on every gallery card.
- A future registry decision that gives `population_on_1_january` (or any other regional canonical key) a default
  region — revisit whether it belongs back in `GALLERY_STORIES`.
- The `look` string losing sync with `ChartTemplateId` (a template renamed/removed in `chart-templates.ts` without
  updating `curated.ts`) — currently silently falls back to `'standard'`; if that ever surprises the owner, consider
  a lint/test that cross-checks the two literal lists instead of relying on the runtime fallback alone.

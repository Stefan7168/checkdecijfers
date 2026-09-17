# ADR 053 — Chart export formats: PDF vector, and a chart-only transparent PNG

**Status: ACCEPTED (2026-09-17).** Built in an isolated worktree (branch
`s110/215-chart-export-pdf-png`), addressing [open-questions
#215](../open-questions.md). Not yet merged to `main` (parent session's own
verification pass runs before that).

## Context

Owner feedback (session 88, 2026-09-08, logged as #215) asked for two changes
to `web/components/chart-download.tsx` (#170(3), the PNG/SVG download menu):

1. The "download as vector" option should be a **PDF**, not the current SVG.
2. The PNG download should be **~half the current file size**, with a
   **transparent background and no baked-in source/attribution text** —
   "just the chart itself".

#215 itself flagged the real tension in (2): `attributedSvgMarkup()` bakes a
white background rect **and** a footer attribution line into both the SVG
and PNG exports **by deliberate design** — the file's own header comment
states the invariant explicitly: *"a PNG and an SVG of the same chart can
never show different text."* Dropping attribution for PNG specifically would
reverse that invariant, and R4 (docs/05-data-rules.md) requires every answer
to display its CBS table id, title, sync date and covered period. #215 left
this for a scoping pass before touching the code; this ADR is that pass.

## Decision

**Add two new menu options; do not touch the existing two.** The menu is now
PNG, SVG, PDF, "PNG, chart only (transparent)" — in that order. The default
PNG and SVG exports stay byte-identical to before (same markup-building
functions, untouched), so the "same markup, same text" invariant keeps
holding for the two formats it always applied to. Reasoning follows the
project's own precedence: an *additional, explicit, user-chosen* format
is not the same decision as *silently removing* attribution from an
existing one, and the owner's own words for the new option ("just the chart
itself") describe a deliberately different, narrower-purpose asset, not a
replacement for the attributed defaults.

### D1 — PDF is vector, from the SAME attributed markup as the SVG

`downloadPdf` builds the export from `framedSvgMarkup(...)` — the exact same
function `downloadSvg`/`downloadPng` already call — so a PDF can never show
different text than the SVG (extending #170(3)'s own invariant to the third
format, rather than inventing a second attribution path that could drift).

**Mechanism: client-side SVG → PDF via `jspdf` (^4.2.1) + `svg2pdf.js`
(^2.8.1), loaded through a dynamic `import()` only when the PDF menu item is
clicked**, so neither library reaches the main bundle for the (presumably
much more common) PNG/SVG/chart-only paths. `svg2pdf.js`'s own README states
it "does not work with JSDOM" and requires a real DOM; this is only ever
exercised in the browser at click time, never at build/SSR time (the whole
component is `'use client'`, and both imports are inside an event handler,
never at module scope).

Concretely: `svg2pdf.js` exports a plain callable `svg2pdf(element, pdf,
options)` (not just the documented `jsPDF.prototype.svg` mixin) — used
directly, since it is trivially mockable in tests (`vi.mock('svg2pdf.js', …)`)
without needing to fake a prototype-patching side effect. Page size is
`new jsPDF({ unit: 'pt', format: [width, height], orientation: width >= height
? 'l' : 'p' })` — the exported SVG's own width/height in points, no margins,
so the PDF page is exactly the chart's own bounding box rather than a fixed
paper size that would crop or pad it.

**Re-parsing the markup uses `div.innerHTML = markup` (HTML/foreign-content
parsing), not `DOMParser(...).parseFromString(markup, 'image/svg+xml')`
(strict XML parsing).** Found empirically while writing the PDF test:
`buildAttributedClone`'s `clone.setAttribute('xmlns', SVG_NS)` lands as a
plain attribute alongside the namespace declaration `XMLSerializer` already
emits for a root SVG element already in the SVG namespace, producing two
literal `xmlns="..."` occurrences in the serialized string — invalid XML
strictly, but harmless to the lenient consumers this markup already had (an
`<img>` decoding it from a blob URL, exactly what `downloadPng` does) until
a strict XML re-parse rejected the duplicate outright ("duplicate attribute:
xmlns"). The HTML-parser workaround tolerates it the same way those existing
consumers already do, with **no change to the shared markup builder** both
the old and new formats depend on — fixing the builder itself was
deliberately out of scope here (it would touch `buildAttributedClone`, which
the "keep the defaults byte-identical" decision above rules out touching for
this task).

**Known limitation, accepted for v1:** the SVG uses web fonts (system-ui/
system sans-serif stacks); `svg2pdf.js` falls back to its own bundled
standard PDF fonts when it cannot resolve a system font, so PDF text is
close but not pixel-identical to the on-screen/SVG/PNG typeface. Not fixed
here — embedding a real font file would be a real added-cost feature
(`cheapest mechanism first`), not a bugfix, and the numbers/labels
themselves are unaffected (still literal spec strings, R6).

**Fallback path considered, not needed:** the brief's own fallback — if
`svg2pdf.js` proved incompatible with this repo's React 19/Next 16.3 stack,
rasterize the PNG path at scale 2 and embed it as an image into a `jsPDF`
page (a *raster* PDF, no vector text). Verified compatible instead: `jspdf`
4.2.1's peer range (`^4.0.0 || ^3.0.0 || ^2.0.0`) matches the installed
4.2.1 exactly, and `svg2pdf.js`'s ESM build (`dist/svg2pdf.es.min.js`, the
`"module"` field bundlers resolve for `import('svg2pdf.js')`) does a plain
`import { jsPDF, ... } from 'jspdf'` and mixes in `jsPDF.prototype.svg` —
confirmed working end to end with a manual Node ESM smoke test (`new
jsPDF(...).svg` is a function after both imports resolve). The vector path
was shipped; the raster fallback was not needed.

### D2 — PNG, chart only (transparent): scope, filename, and what it deliberately skips

A new, explicit menu item — never a silent change to the default PNG.
Built from a **new, minimal clone builder** (`buildBareClone` /
`bareChartMarkup`), not a flag threaded through `buildAttributedClone`:
paint is still inlined (so `var(--token)` colors and hover-cursor artifacts
are still resolved/stripped, same as every other export — the chart must
still render correctly once it leaves the page) and light-theme-forced
(#222), but **no white background rect, no footer attribution text, no
headline, and no frame** are added, and the canvas is drawn at
`TRANSPARENT_PNG_SCALE = 1` instead of the default `PNG_SCALE = 2` — roughly
a quarter the pixel count (half the linear dimensions on each axis), which
is more than the "~half" the owner asked for but the closest match to a
) already-established constant (`PNG_SCALE`'s counterpoint) rather than a
new, one-off scale factor invented for this single case.

**A separate builder function, not a parameter on the existing one, because
the two have genuinely different growth rules:** `buildAttributedClone`
always grows `totalHeight` for the footer (and headline, when present) —
letting a caller opt out of that growth mid-function would mean threading
several independent booleans through code that already carries `paintWhiteBg`
and `headlineText` as conditional inputs; keeping the "bare" path as its own,
much shorter function (no footer/headline math at all) is the lower-risk
change and — per the "keep the defaults byte-identical" requirement — the
only way to *guarantee* the existing function's behavior for its two
existing callers cannot regress from touching it.

**Deliberately ignores `frame` and `headlineText`, even though both are
otherwise available to `ChartDownloadMenu`.** The frame feature (ADR 039)
exists to add a styled background/padding for a *shareable, attributed*
image; a solid or gradient frame background is the opposite of "transparent"
outright. Baking the frame in anyway would silently reintroduce exactly the
styling choice this option exists to opt out of. The journalist headline
(ADR 050) is closer to user-authored caption content than to mandatory CBS
attribution, and "just the chart itself" (the owner's own words, #215) reads
most literally as excluding *any* baked-in text, not only the footer line —
so it is dropped too, for this v1. **Marked as an assumption** (mirrored in
open-questions #215): a future revision could keep the headline while still
dropping the frame/attribution, if the owner wants a captioned-but-
unbranded asset; not built now because #215's own wording does not
distinguish the two, and guessing which reading was meant would violate
principle (c).

**Filename carries the provenance the file itself no longer states.**
R4 governs the *answer* (the chat/chart-card display, which is unaffected —
the badge, the disclaimer footer, and the default PNG/SVG/PDF exports all
keep full attribution); it does not require every derived, user-chosen
export asset to carry attribution text baked into the pixels. Principle (a)
and R4's own intent — "every number traceable to a CBS cell, with source and
date shown" — are satisfied here by making the source explicit **another
way that costs nothing**: the filename. `ChartDownloadMenu` takes a new
optional `syncedAt` prop (the same ISO timestamp `SourceBadge` already
renders from, `ChartAttribution.syncedAt` / `UserChartProvenance.capturedAt`)
and builds `<filenameBase>-<YYYY-MM-DD>-chart-only.png` — e.g.
`checkdecijfers-85999NED-2026-09-15-chart-only.png` — reusing the same
`^\d{4}-\d{2}-\d{2}` extraction `source-badge.tsx`'s `syncDateLabel` already
uses (duplicated as a two-line local regex rather than importing that file,
which would pull the source registry and i18n machinery into this leaf
component for a two-line regex). **Never guesses:** when `syncedAt` is
absent (an old caller, or a spec that predates the field), the date segment
is simply omitted rather than fabricated (principle c).

The menu label states the trade-off plainly rather than implying a plain
"PNG" alternative: **"PNG, alleen grafiek (transparant, zonder bronregel)"**
/ **"PNG, chart only (transparent, no source line)"** — so the omission is a
visible, informed choice at click time, not a surprise discovered later.

## Alternatives considered

1. **Server-side rendering for the PDF** (e.g. a headless-browser or
   Puppeteer-style render-to-PDF endpoint). Rejected: the whole point of
   #170(3)'s original design is that the export "structurally cannot drift
   from what was shown" because it serializes the SVG *actually on screen*
   at click time; a server round-trip would need to re-render the chart from
   scratch (a second code path, a second chance to drift) or transmit the
   live DOM back to the server (meaningfully more complex, and a new network
   dependency for a client-only interaction). It would also cost real
   server compute for a feature the owner explicitly gated on staying cheap
   ("cheapest mechanism first"). The client-side `jspdf`/`svg2pdf.js` path
   needs no server code, no new endpoint, and no spend.
2. **A single flag on `buildAttributedClone`/`framedSvgMarkup` for the
   chart-only PNG**, rather than a separate `buildBareClone`. Rejected per
   D2 above: the two builders have different growth rules (footer/headline
   height math vs. none), and reusing the well-tested existing function
   with a growing parameter list raises the risk of an accidental
   regression in the two exports this task must keep byte-identical.
3. **Silently dropping attribution from the existing PNG** (the reading
   #215 itself flagged as the risk — "confirm with the owner whether that
   invariant should be dropped entirely for PNG or just made conditional").
   Rejected: this task's own brief already resolved it — the two existing
   formats keep attribution unconditionally; the un-attributed option is
   new and explicit, never a silent behavior change to what exists today.
4. **Raster PDF (rasterize the PNG at scale 2, embed as an image)** instead
   of a true vector PDF. This was the brief's own named fallback, kept
   available but not used — see D1's "fallback path considered" above. A
   raster PDF would still satisfy "PDF instead of SVG" literally, but loses
   the actual point of choosing PDF over PNG for print/vector use (crisp
   text and paths at any zoom), so it was only a fallback for a genuine
   incompatibility, which did not materialize.

## Trade-offs

- **New runtime dependencies:** `jspdf` (^4.2.1, MIT) and `svg2pdf.js`
  (^2.8.1, MIT) — both loaded on demand via dynamic `import()`, so they add
  no weight to the initial bundle; their cost is paid only by a user who
  clicks "Download as PDF". Both ship their own TypeScript types (no
  `@types/*` package needed).
- **PDF font fidelity is a known, accepted gap for v1** (see D1) — worth a
  real-browser spot-check later, not solved here.
- **The chart-only PNG's provenance lives in the filename, not the pixels.**
  A file that gets renamed by whoever downloads it loses that provenance
  entirely — an inherent trade-off of "just the chart itself," accepted
  because the alternative (baking text back in) is the exact thing the
  owner asked to remove.
- **The chart-only PNG silently drops the frame/headline even when they are
  set on screen.** A user who has styled a frame and then picks this option
  gets an unframed, uncaptioned chart, which could read as a bug rather
  than a deliberate scope choice, until the menu label is read carefully.
  Mitigated by the explicit label wording; not further guarded (e.g. a
  confirmation dialog) since that would add friction to a "cheapest
  mechanism" feature for a low-severity surprise.

## Revisit triggers

- If usage/feedback shows people want the frame or headline preserved in
  the chart-only PNG (D2's open assumption), design and build that as a
  conditional, not a guess made now.
- If the PDF font-fidelity gap (D1) becomes a real complaint, revisit
  embedding a web font into the PDF via `svg2pdf.js`'s custom-font support
  (its README documents the mechanism) — a real, scoped follow-up, not done
  speculatively here.
- If a future change to `buildAttributedClone` ever removes the redundant
  `xmlns` attribute (the root cause of the duplicate-attribute XML-parse
  bug worked around in D1), the `div.innerHTML` re-parse workaround in
  `downloadPdf` can be revisited (a strict `DOMParser` re-parse would then
  work too) — not required, since the current workaround is already correct
  and only slightly more lenient than necessary.

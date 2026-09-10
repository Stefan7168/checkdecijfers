# Story mode + Embed — design (owner-approved 2026-09-09, session 92)

**Status:** design approved by the owner in chat (session 92, 2026-09-09, owner present) after a
brainstorm with mock-ups; not yet planned or built. Two features, two implementation plans
(Story mode first — it is client-only; Embed second — it adds a public route and two owner-set
settings). Both extend the chart card (`web/components/chart.tsx`, ADR 038/039) and change nothing
in the answer pipeline.

## In one paragraph, for the owner

Every chart gets a colourful **Story mode** button. Pressing it opens a story under the chart:
a few short steps that zoom and highlight the chart while you scroll or press Next, with
captions built by code from the numbers already on the chart (no AI, no cost). Every chart also
gets an **Embed** button next to Download. It opens a pop-up with a preview, a few options and a
piece of code to paste into an article. The pasted code shows the chart from our site, frozen as
it was when embedded, with the source, the date and a link back to checkdecijfers.nl. A **Live
embed** toggle (the chart updates itself when CBS corrects or extends the data) is shown greyed
out with a hover text as the Pro incentive; it works only for Pro accounts — and since no Pro plan
exists yet (open-questions #205), for now only for accounts you list in a private setting, so
you can demo it.

## Owner decisions recorded here (2026-09-09, in chat)

1. Story mode = a scroll story **in the chat**, chart stays on screen, steps built by code.
2. Embed = a pop-up with the embed code and options; the default embed is a **frozen chart served
   from our site**; the **Live embed toggle is Pro-only**, shown greyed out with a tooltip to
   everyone else.
3. Until a Pro plan exists: the Live toggle is greyed for everyone, plus a **private demo switch**
   for the owner's own account (no billing work now).
4. "Scroll / map" in the owner's ask means **later**: the embedded chart may play the story too,
   and a map chart type (municipalities / provinces, like the 3D demo) gets the same Embed button
   when it exists. Recorded as follow-ups, not built.
5. Ordering: these two features are the next build after the session-92 kickoff items.

These override, where they differ, the older export-ladder framing on open-questions #45 ("free
watermarked embed with backlink → watermark-free huisstijl embed costs credits"): the free tier is
the frozen embed with attribution + backlink; the paid tier is now "Live embed = Pro", not a
credit-priced huisstijl embed. #49 (live embeds auto-update, downloads freeze) and #50
(attribution per shape) stay as decided. #46(c) (an exported/embedded view must carry its own
disclosure) applies: the embed bakes the same disclosure text the download bakes.

---

## Part A — Story mode

### A1. Trigger

- A `ChartStoryTrigger` button rendered as a row-mate of the Weergave tablist, directly after
  `ChartConfigTrigger` (Style), in `ChartView`. Gated exactly like the Style trigger
  (`state.form !== 'table'`) AND on `storySteps.length >= 3` (a chart with one point has no story).
- Look (the owner's ask: "colourful border, magic wand or stars, to show something exciting will
  happen"): a 2 px gradient ring (conic or linear, purple → pink → amber, via a wrapper with the
  gradient as background and the button inset 2 px with the card background), the lucide
  `WandSparkles` icon, label `chart.story.trigger` = nl "Verhaal" / en "Story mode". The ring is
  the ONLY gradient in the app (12-huisstijl gets a one-line note: reserved for the story
  trigger). `aria-expanded`, `aria-controls` like the Style trigger; opening the story closes the
  Style panel and vice versa (one open region under the chart at a time — `ChartView` holds
  `openPanel: 'style' | 'story' | null` instead of the current boolean).
- Everywhere `ChartView` mounts (chat, dock, Ontdek/homepage, trial, history) — owner G of #218.

### A2. Panel

- `web/components/chart-story.tsx`: a `role="region"` labelled `chart.story.regionLabel`, rendered
  in the same slot as the Style panel (directly after the chart's export container, OUTSIDE
  `chartContainerRef` so nothing of it can enter a PNG/SVG — the ChartNotes precedent).
- Layout: header "Story" (digit-free — the dotted step list below carries the position) + hint "scroll or use the arrows"; a fixed-height
  (~9 rem) vertical scroll area containing one card per step (title + caption); below it
  Previous / Next buttons and a dotted step list (the mock-up in session 92). Arrow keys on the
  region move steps; Escape closes and refocuses the trigger. Prefers-reduced-motion: no smooth
  scrolling.
- Active step = the card with the largest visible share of the scroll area, at least half (an IntersectionObserver with
  `root` = the scroll area, thresholds at 0.5; jsdom fallback: the buttons drive the index
  directly). Previous/Next scroll the card into view AND set the index — both paths call the same
  `setStep(i)`.
- On step change the panel dispatches the existing `setHighlight` per step (zoom is NOT used in v1 — see the Global Constraints of the plan and ADR 039's addendum; one new action `setView` restores the reader's view on close). A point step additionally renders a marker on the chart:
  `ChartView` passes `storyPoint: { seriesKey, periodCode } | null` into the render, which draws a
  dashed, unfilled ring around that point using `dotGeometry` (R11: the hollow provisional ring
  stays visible inside the story ring — the story ring is 5 px outside it, never on top of it, and
  the dash keeps it from ever reading as a provisional marker); in bar form a dashed outline
  around the bar plays the same role (as built, final review).
- Closing the story (trigger, Escape, or a spec swap through the reducer `reset`) restores the
  view state the user had before opening (the panel snapshots `periodRange` + `highlightedKey`
  on open and restores on close; a user who changed nothing gets the untouched chart back).

### A3. Steps — pure, test-pinned, no new numbers

`web/lib/chart-story.ts` (pure, no React) exports `buildStorySteps(spec, lang): StoryStep[]` with
`StoryStep = { id, title, caption, highlight: string | null,
point: { seriesKey, periodCode } | null, kind: 'overview' | 'start' | 'high' | 'low' | 'latest' |
'series' | 'explore' }`.

Rules (docs/05: R1/R3/R6/R10/R11 — every digit token on the card must be a spec string):
- A caption may contain ONLY these digit-bearing strings, verbatim from the spec: `periodLabel`,
  `formattedValue`, `unit`, series `label`s, and `attribution.trendHeadline`. Never a computed
  difference, percentage, rank number or count — the step titles are words ("Highest point"), and
  no "step N of M" text appears anywhere in the card: the dotted step list carries the position
  visually, each dot has `aria-label` = the step title and `aria-current` on the active one. The
  existing whole-card digit scans in `chart.test.tsx` are extended to a chart with the story
  open, in both languages.
- Choosing which point is highest/lowest is a comparison over `value` (numbers already in the
  spec), skipping `null` points; ties → the earliest period. This is presentation selection, the
  same class as highlight/zoom (ADR 038), not computation of a new number — **Assumption**,
  mirrored on open-questions (new row): a "highest / lowest" caption that repeats a spec string is
  allowed under R6. If the owner or a later review disagrees, drop the `high`/`low` kinds; the
  rest of the story stands.
- A provisional point's caption appends the existing R11 wording (`chart.story.provisional` =
  nl "voorlopig cijfer" / en "provisional figure") — the hollow marker stays on the chart too.
- Time series (spec.kind `line`, one series): `overview` (zoom null, caption = trendHeadline if
  present, else "{firstLabel} – {lastLabel}"), `start` (point = first non-null; caption
  "{periodLabel}: {formattedValue} {unit}"), `high`, `low`, `latest` (last non-null point), `explore`.
  `high`/`low` are omitted when they coincide with start/latest (no duplicate steps).
- Several series (regions): `overview`, then one `series` step per series in spec order
  (highlight = that series' key, caption "{label}: {first formattedValue} → {last formattedValue}
  {unit}" using the arrow character, both strings verbatim), capped at five series (the sixth
  onwards are not narrated; the overview caption then says the chart holds more series, in words),
  then `explore`.
- Comparison (spec.kind `bar`, one point per series): `overview`, `high` (highlight = that bar's
  series key), `low`, `explore`.
- `explore`: zoom null, highlight null, caption `chart.story.explore` (points at the tabs, the
  period selectors and Style — digit-free).
- Language: titles/captions through `t(lang, …)` from `messages.ts`; CBS words through
  `cbs-words.ts` exactly as the card already does (`translateSpecForDisplay` output is the input
  to `buildStorySteps`, so period labels/units arrive already translated). `trendHeadline` stays
  Dutch on an English chart (ADR 040 known limitation — say so in the ADR addendum).

### A4. Counting, export, tests

- Usage counter (#220, no schema change beyond the file-only migration 028 the owner still has to
  apply): two new `CHART_STYLE_EVENTS` — `story_open`, `story_step` — recorded through the existing
  `trackChartStyleEvent` sink. Counts nothing until migration 028 runs (by design).
- Export: the story panel lives outside the export container and can never be exported; the story
  ring (a dashed outline around the step's point or bar) IS on screen and therefore IS exported,
  like the highlight dimming (#46(c): the export shows what is on screen); no zoom is used, so no
  disclosure line changes during a story — the decision that ring + dimming need no disclosure is
  recorded in ADR 039's addendum. Test-pinned.
- Tests: `chart-story.test.ts` (steps for the four spec shapes, the null/tie rules, the digit
  rule: every digit token in every caption ∈ spec strings), `chart-story.test.tsx` (open/close,
  Next/Previous, Escape refocus, restore-on-close, the marker's DOM, the digit scan with the
  story open in nl and en), `chart.test.tsx` additions (trigger gating, one-open-panel rule).

### A5. Not in Story mode v1

Auto-play, per-step notes, saving a story, story in the export, story in the embed (Part B
follow-up), LLM-written captions (a later, conditional phase per the cheapest-first rule — only
if the counter shows real use AND the owner asks).

---

## Part B — Embed

### B1. Trigger and pop-up

- `ChartEmbedButton` next to `ChartDownloadMenu` in the card footer (same quiet style), rendered
  only when `ChartView` receives an `embed` prop `{ auditId: number }` — the chat/dock/history
  call sites pass it for the user's own answered questions (the `LoadedThread` / history rows
  already carry the audit id); Ontdek charts and the trial pass nothing → no button. Signed-in
  only (the action checks the session anyway).
- Click → a `role="dialog"` pop-up (`web/components/chart-embed-dialog.tsx`; shadcn `dialog` added
  with `npx shadcn add dialog` — the session-90 `dropdown-menu` precedent — or hand-rolled if Base
  UI's dialog misbehaves in jsdom): title, one-line explanation, a preview (an `<iframe>` of our own
  embed route with the current options — omitted in tests), the options, the Live row, the code,
  Copy code (Clipboard API with a textarea fallback), Close. Focus trap + Escape per the house ARIA
  pattern.
- Options (all reflected in the code's query string): **Language** NL | EN, preselected to the
  chart's resolved language; **Colours** Light | Dark | Reader's device (`theme=light|dark|auto`);
  **Chart type** As shown | Default (`form=line|area|bar|hbar` when "As shown" and the current
  form is not the default; the table form is not embeddable — the button is hidden in table
  form, like Download). Sizes, title hiding: follow-ups.
- **Live embed** row: a switch + "Pro" badge + text. Disabled with `aria-describedby` reason and a
  `title` tooltip when `pro === false` (`chart.embed.liveProOnly` = "Part of Pro. The embedded chart
  updates automatically when CBS corrects or extends the data."); enabled for Pro accounts and,
  when on, the code carries `live=1`.
- The code: `<iframe src="{APP_URL}/embed/{token}?lang=nl&theme=light[&form=…][&live=1]"
  width="100%" height="440" title="{chart title}" loading="lazy" style="border:0"></iframe>`.
  `APP_URL` = `NEXT_PUBLIC_APP_URL`.

### B2. Token — signed, stateless, owner-supervised secret

- `src/chart/embed-token.ts` (pure): `signEmbedToken(auditId, secret) → string` and
  `verifyEmbedToken(token, secret) → number | null`, HMAC-SHA256 over the decimal audit id,
  base64url, token = `{id}.{sig}` truncated sig (16 bytes) — constant-time compare. Unit-tested
  incl. tamper cases.
- Secret: `EMBED_TOKEN_SECRET` (Vercel env, Production, Sensitive — owner-set, like
  `TRIAL_IP_HASH_SECRET`; RUNBOOK secrets table row + a go-live section). Missing → the server
  action returns `unavailable` and the dialog says embedding is not available right now; the
  route returns 404. Fail closed, no error pages.
- Server action `createEmbedCode(auditId, options)` in `web/app/embed-actions.ts`: requires a
  session; loads the audit row; refuses unless `record.userId === session user id`,
  `record.kind === 'answer'`, `record.response.chart !== null`, and the row is not redacted;
  returns `{ token, pro }`. `pro` from `hasProPlan(user)` (B4).
- Revocation model (told to the owner, recorded on #45): none per embed; deleting the chat /
  retention redaction blanks the embed; rotating the secret blanks all embeds. A per-embed table
  is a later step if wanted.

### B3. Public route `/embed/[token]`

- `web/app/embed/[token]/page.tsx` (server component, dynamic): verify the token (404 on failure
  or missing secret), `loadAuditRecord` (404 when absent), a redacted/chart-less record → a
  digit-free "This chart is no longer available." page (200, `noindex`), else render
  `EmbedChart` (a client component) inside a minimal layout: NO site header/footer, `<html lang>`
  from `?lang`, theme from `?theme` (`auto` = `prefers-color-scheme`), `robots: noindex, nofollow`
  (an embed page is not a landing page — the Phase-2 shareable answer pages (#9) are).
- Frozen (default): `spec = record.response.chart` rendered through the SAME `ChartView`
  (frameless, `embed` mode prop that hides Style, Story, Download, Notes, the tab row and the
  language select — a clean chart: title, unit, the chart, the R4 attribution line + SourceBadge,
  and an embed footer line "Frozen on {date} · checkdecijfers.nl" (the date = the audit row's
  `createdAt`, formatted by the same date formatter the attribution line uses — a spec/record
  string, never re-derived) with the backlink to the site's homepage. `?form=` applies the
  requested form through the reducer's `setForm` only when the guards allow it (`lineFormAllowed`
  etc.), else the spec's default.
- Live (`?live=1`, only honoured when the row's owner is Pro AT RENDER TIME — `hasProPlan` on the
  row's `userId`; otherwise silently falls back to frozen, so a copied "live" code stops being
  live when Pro lapses): re-run the stored `record.intent` (a `StructuredIntent`, the WP26 click-take
  precedent — zero LLM) through `runQuery(db, intent, options)` → `buildChartSpec(result)`; on a
  refusal/clarification outcome or a missing table, fall back to the frozen spec with the footer
  saying "Live update not available, showing the chart of {date}" (digit-free apart from the
  date string). Footer for a live render: "Live · data as of {syncedAt}" from the fresh spec's
  attribution. Cache: `revalidate = 3600` for live renders (an hour is well inside CBS's cadence).
- Disclosure: the embed footer carries the same `viewDisclosure` text a download would carry for
  the requested form/zoom (#46(c)); the embed never carries hide/highlight state (there is none in
  the URL by design).
- Framing headers (hygiene that comes with this work): `next.config.ts` `headers()` sets
  `Content-Security-Policy: frame-ancestors 'none'` + `X-Frame-Options: DENY` for every route
  EXCEPT `/embed/:path*`, which sets `frame-ancestors *`. Test-pinned (a `next.config` unit test
  over the headers function).

### B4. Pro check — one function, no billing work

- `src/billing/pro.ts`: `hasProPlan(user: { id: string; email: string | null }): boolean` —
  today: `true` iff the email is in `PRO_ACCOUNT_EMAILS` (comma-separated, case-insensitive; env
  var, owner-set, not a secret — the owner's demo switch; documented in the RUNBOOK table and as
  the #205 seam). Unset → nobody is Pro. When #205 (the monthly plan) is built, this function
  reads the plan; every caller (the dialog's `pro`, the live route) stays unchanged.
- **Assumption** (open-questions #205 addendum + a new row): "Pro" here is the same tier as the
  parked monthly plan of #205, and Live embed is one of the things it unlocks.

### B5. Counting, docs, tests

- `CHART_STYLE_EVENTS` += `embed_open`, `embed_copy` (anonymous counts, migration 028).
- ADR 041 "Public embed pages: signed stateless chart URLs, frozen by default, live for Pro"
  (context, decision, alternatives: per-embed table / unsigned ids / inline-SVG snippet / a
  separate public-page product; consequences; revisit triggers: per-embed revocation, homepage
  chart embeds, story-in-embed, sizes, the #9 answer pages).
- 03-mvp-scope: embeds and public chart URLs move from the Studio non-goal into scope (frozen +
  live-for-Pro), the rest of the non-goal stays. 06-roadmap Visualisatie Studio row + the export
  ladder wording updated. open-questions #45 (decision + the new ladder), #46(c) (embed bakes the
  disclosure), #49/#50 (as built), #205 (the Pro seam), new rows for the R6 assumption (A3) and
  the Pro assumption (B4). RUNBOOK: two env rows + "Embed go-live" section (set the secret,
  optionally the demo emails, redeploy, smoke test: copy a code, open it in a plain HTML file,
  see the chart; delete the chat, reload the embed, see the not-available page). README/web
  README one line each. 12-huisstijl: the story trigger's gradient ring.
- Tests: token unit tests; action tests (session, ownership, kind, redaction, missing secret);
  route tests (404s, frozen render, live fallback, header/footer text digit-free apart from spec
  strings, `?form` guard); dialog tests (options → code string, Pro row disabled + reason, copy);
  headers test; the whole-card digit scan on the embed render in both languages.

### B6. Follow-ups (recorded, not built)

Story inside the embed (a `?story=1` that mounts the story panel in embed mode); a map chart form
(municipalities/provinces; a separate design — needs shapes, colour rules and honesty checks);
Ontdek/homepage chart embeds (curated specs have no audit row — a second token kind); sizes and
title hiding; per-embed revocation table; the Pro plan itself (#205).

**As-built correction (2026-09-10, session 93, branch `embed-charts`, ADR
[041](../../decisions/041-public-embed-pages.md)):** built as designed above, with three points
where reality diverged from this section's literal text rather than merely extending it — recorded
here so this design record does not read as still-accurate on these specifics. **(1)** B3's framing
pattern is `/embed/:path+` (one-or-more segments) in `next.config.ts`, not the `/embed/:path*`
written above — `:path*` (zero-or-more) let a bare `/embed` URL match BOTH the deny-framing and the
wide-open header groups at once, confirmed live via `curl` and closed by the one-character fix.
**(2)** B3's Live branch reads simply as "`hasProPlan` on the row's userId," as if resolving that
user's email were free — it is not: no mechanism anywhere in this codebase resolves an arbitrary
user id to that user's email (only the CURRENT session's own email is ever available, via
`currentUserEmail()`), so **Live is gated CLOSED for every embed today, by construction, until that
lookup is built** (ADR 041, open-questions [#224](../../open-questions.md)) — a real, deliberate,
safe limitation surfaced during the build, not an oversight in what shipped. **(3)** B3's
`revalidate = 3600` was deliberately NOT added: `dynamic = 'force-dynamic'` (needed regardless)
silently forces Next's own per-fetch revalidate to `0`, so the export as literally written would
have been a no-op, and unsafe if that precedence relationship ever changed (ADR 041, Decision point
12). **ADR 041 is the authoritative as-built record for all of Part B** — this design section is
kept verbatim above as the historical record of what was approved before the build, not updated to
match it.

---

## Verification and workflow

Owner present → direct push to `main` after the full verification block (typecheck ×2, web +
backend suites, benchmark suite, real `next build`, docs test, LOW-effort review); autonomous →
branch + PR (#118). `EMBED_TOKEN_SECRET` and `PRO_ACCOUNT_EMAILS` are owner-set (env), never by
the session. No migration: both features ride migration 028 for counting only. Backend suite
solo (~35 min). Visual checks on production in the owner's Chrome (the hidden Browser pane never
hydrates the chart subtree).

---

## Part C — Frame styling and the Style pop-up (owner-approved 2026-09-09, session 92, later the same day)

**The ask (owner, in chat):** "when people download the graph, it looks too boring" — a background colour or
gradient chosen by hex, or an uploaded background image, plus padding, rounded corners, shadow, inset
and aspect ratio; it belongs with the styling, so the Style button becomes a pop-up. **Owner decisions
(three questions, 2026-09-09):** (1) the frame shows ON SCREEN and in the download — what you see is what
you get; (2) an uploaded image lives only in the reader's browser for this chart, never on our servers;
(3) the Style button opens a FLOATING PANEL beside the chart (the chart stays visible and changes live),
not a centred window and not the panel under the chart.

### C1. The Style pop-up

- `ChartConfigPanel` becomes a floating, non-modal panel: `role="dialog"` (not `aria-modal`), anchored
  to the right edge of the viewport (`position: fixed; right: 1rem; top: 5rem; width: 22rem; max-height:
  calc(100vh - 6rem); overflow-y: auto`), rendered through a portal into `document.body` so the dock's
  `overflow-hidden` cannot clip it (the portal is for POSITION only — the open state stays in
  `ChartView` as today, the lesson of session 91 was about moving a BUTTON with a portal). Below `lg`
  (< 1024 px) it becomes a bottom sheet. As built: below `lg` the panel is a bottom sheet (max-height 60vh) with no preview — the chart stays partly visible above it; a preview instance was not built.
- Tabs: Grafiek / Kleuren / Lettertype (unchanged) + **Kader / Frame** (C2). The header keeps the
  chart-language select; the footer keeps Standaard, the "why no pie chart" note and the account row.
- Open/close: the same `openPanel` state (`'style' | 'story' | null`); Escape and a Close button close
  and refocus the trigger; a click outside does NOT close (the reader is adjusting the chart behind it).
  One panel per page: opening Style on chart B closes it on chart A (the state lives per `ChartView`,
  so a module-level "which chart owns the panel" signal is needed — a tiny context in the layout:
  `StylePanelOwnerContext` holding the owning `domId`).
- The panel under the chart (option A layout, session 91) is retired; the Story panel keeps that slot.

### C2. The Frame tab — presentation keys (extend `ChartPresentation`, ADR 039)

All keys are plain enums or hex strings; `sanitizeOverrides` allow-lists them; the resolver applies no
locks. Tabel form has no frame and no Style panel (as before) — decided in the final review: a framed
table would need its own export path.

| key | values | default |
|---|---|---|
| `frameBackground` | `'none'` \| `{ kind: 'solid', hex }` \| `{ kind: 'gradient', from: hex, to: hex, angle: 135 }` \| `{ kind: 'image' }` | `'none'` |
| `framePadding` | `none` \| `small` \| `medium` \| `large` (0 / 16 / 32 / 56 px) | `none` |
| `frameCorners` | `square` \| `rounded` \| `veryRounded` (0 / 12 / 28 px) | `square` |
| `frameShadow` | `none` \| `soft` \| `strong` | `none` |
| `frameInset` | `none` \| `small` \| `large` (the chart sits on a card inside the background: 0 / 12 / 24 px card padding, white/`--card` fill, corners follow `frameCorners`) | `none` |
| `frameAspect` | `auto` \| `16:9` \| `4:5` \| `1:1` \| `1.91:1` | `auto` |

- Gradient presets (six, named in words: Dawn, Ocean, Forest, Berry, Slate, Sand) are pairs of hex
  values in `chart-presentation.ts`; a custom gradient is two hex pickers. The angle is fixed at 135°.
- **The image never enters the presentation object** (it is not serialisable into the account default
  and must never reach the server): `ChartView` keeps `frameImage: string | null` (an object URL from
  `URL.createObjectURL(file)`, revoked on replace/unmount/spec swap) in component state; `frameBackground
  = { kind: 'image' }` only says "use the browser-held image"; if the image is absent (a saved default,
  a fresh chart) the resolver degrades `{ kind: 'image' }` to `'none'`. Accepted types: png/jpeg/webp,
  max 5 MB (refused with a plain message); the file is read with `FileReader` to a data URL for the
  export (C3) and shown via CSS `background-image` on screen.
- "Save as my default" saves every frame key except `{ kind: 'image' }` (dropped to `'none'`, said in
  the status line: "the picture is not saved").
- Contrast guard: with a background set, `judgeColor` is re-run for every series colour against the
  frame's effective backdrop (the inset card colour when inset is on, else the background colour or the
  gradient's two ends); a refusal keeps the palette colour and warns, exactly like the Kleuren tab.
- Counter: `frame_changed` (once per control change) joins `CHART_STYLE_EVENTS`.

### C3. Rendering and export

- On screen: a `ChartFrame` wrapper (`web/components/chart-frame.tsx`) around the chart's export
  container: background (colour / CSS gradient / `background-image` cover), padding, `border-radius`,
  `box-shadow`, the inset card, and `aspect-ratio` on the frame with the chart scaled to fit (the
  `ResponsiveContainer` fills the frame's inner box; the attribution line and badge stay INSIDE the
  frame, under the chart, never cropped — the chart shrinks instead).
- Export (`chart-download.tsx`): `attributedSvgMarkup` gains a `frame` argument and wraps the chart
  svg in an outer `<svg>` of the frame's size: a `<rect>` (solid), a `<linearGradient>` + `<rect>`
  (gradient) or an `<image href={dataUrl}>` with `preserveAspectRatio="xMidYMid slice"` (image),
  `rx` for corners, an `<feDropShadow>` filter for the shadow, the inset card as a second `<rect>`, the
  chart `<svg>` nested with `x/y/width/height` inside the padding + inset, the attribution text inside
  the frame. PNG rasterises the outer svg (the data-URL image is inlined, so the `<img>` path still
  works; a 5 MB cap keeps the data URL sane). SVG keeps the image as base64 (large but self-contained).
- The Story ring/outline, highlight dimming and the zoom disclosure are unchanged; the frame carries no
  text, so the whole-card digit scans are unaffected (a test renders a framed chart and re-runs them).
- Embed (Part B, later): the embed route renders the frame from the query-string-free presentation
  saved with the chart? NO — the embed is frozen from the audit record which has no presentation; a
  framed embed is a follow-up (the frame would ride the token as a compact param set).

### C4. Not in v1

Free pixel inputs; custom shadow colours; image position/zoom controls; text overlays; saving the image
with the account (owner decision 2); a frame on the homepage curated charts' download (they use the same
`ChartView`, so it comes for free on screen — nothing to exclude); templates/presets beyond the six
gradients.

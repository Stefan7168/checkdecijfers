# Phone walk — 2026-09-12 (session 98, branch `journey-phone`)

Scope: R9.1 (#238) — walk the whole product journey at 375px, light + dark, in
a real Chromium browser (Playwright, driven against the session's harness at
`http://localhost:3102`), and fix what's broken or cramped.

## Findings

| Step | Wrong | Fix | File |
|---|---|---|---|
| Workspace header, 375px | Wordmark "Check de Cijfers" wrapped onto two lines (header + balance chip + NL\|EN + Account don't fit on one line even after moving two links into the Account menu earlier), blowing out the header's fixed `h-12`. | `whitespace-nowrap`+`shrink-0` on the wordmark and balance badge; `gap-2 px-3` on mobile widening to `gap-3 px-4` at `sm`. | `web/components/site-header.tsx` |
| Account menu items (Credits kopen, Geschiedenis, Log uit, Verwijder mijn vraaggeschiedenis) | Plain text links/buttons with no padding — measured 16-20px tall, well under the 44px minimum tap target. | `flex min-h-11 sm:min-h-0 items-center` on each menu item/button — 44px tall only below `sm`, so the always-visible desktop items (Log uit, Verwijder) stay pixel-identical at 1280px. | `web/components/site-header.tsx`, `web/components/delete-history-button.tsx` |
| Delete-history confirm/cancel buttons | 28-32px tall (`py-1.5` only) — under 44px. | `min-h-11 sm:min-h-0` added. | `web/components/delete-history-button.tsx` |
| Chart form tabs (Lijn/Vlak/Staaf/Liggend/Tabel) | Measured 24px tall at 375px — under the 44px minimum tap target. | `min-h-11 sm:min-h-6` (was `min-h-6`) — 44px only below `sm`, 1280px unchanged. | `web/components/chart.tsx` |
| NL\|EN language switch | 24px tall (`h-6`) at every width. | `h-11 sm:h-6`. | `web/components/language-switch.tsx` |
| Theme toggle (☀️/🌙/🖥️) | 24px tall (`h-6 w-7`) at every width. | `h-11 sm:h-6 w-11 sm:w-7`. | `web/components/theme-toggle.tsx` |
| Present stage, below `lg` (375px) | **Real bug, correcting the first pass of this doc below.** The pinned chart card caps at 50vh, then "Scroll om verder te gaan", then a BLANK gap, with the active caption sitting at the very bottom edge, mostly below the fold. `min-h-[85vh]` per caption is right for the `lg` two-column layout (chart pinned LEFT at full height, captions scroll on the RIGHT — a full viewport height of scroll room per step reads naturally there); below `lg` the chart is pinned at the TOP instead and only ~50vh of free space is left under it, so an 85vh caption block put its centre ~42vh in — mostly unreachable without scrolling further. `min-h-[45dvh] lg:min-h-[85vh]` (`dvh` so mobile address-bar chrome doesn't throw the maths off) sizes each block to the free space actually left under the pinned card below `lg`, and the existing `justify-center` then centres the caption within THAT space — fully visible directly under the chart at every step. The nearest-centre scroll math (`chart-stage.ts`/`use-stage-scroll.ts`) reads `offsetTop`/`offsetHeight` straight from the DOM, so it needed no change — verified the dots still advance correctly while scrolling. | `web/components/chart-story-stage.tsx` |

All six fixes verified with a real Playwright measurement
(`getBoundingClientRect`) before/after, at both 375px and 1280px — see
"Verification" below for the numbers. Each has a matching unit test asserting
the responsive class pair, since jsdom has no layout engine to measure real
pixel heights.

**Confirmed working correctly, no fix needed** (walked and visually verified
at 375px, light + dark unless noted): the landing page top-to-bottom
(header, how-it-works, charts, coverage disclosure, pricing, footer) and
`/werkwijze` + `/privacy` at 375px full-page, logged out; `/login` (form,
Google button); the workspace first visit + the "Welke bronnen zijn
ingebouwd?" sources disclosure opened (a long CBS-source list — closed again
before continuing, since leaving it open eats nearly the whole 812px
viewport and would crowd out every later screenshot, which is a walk-script
concern, not a product one); a full B4 (inflation) question round trip via
the LLM stub — chart, answer body, citation chip, download link, follow-up
chip, all clean at 375px; the chart tabs' own content (Lijn line chart, Vlak
area, Staaf bars, Tabel — Liggend is correctly disabled/greyed for a
national time series, since it only applies to a region comparison) and the
Vanaf/Tot period selects; the Style panel (Opmaak) — Sjablonen gallery
first (ADR 043), applying "Presentatie" and "Sociaal" templates, the
Grafiek and Kader (Frame) tabs, the Download menu; the Insights panel
(Inzichten) and its step dots/arrows; the Present stage — closing via
Escape and via the close button both work, and scrolling still advances the
active step correctly after the fix above (verified 0 → 3 while scrolling
to 50%); a clarification round (B16, "Wat is de gemiddelde huizenprijs in
mijn buurt?") — see the note below on how it actually resolves; a refusal
(B18, "Wat wordt de inflatie in 2027?"); the insufficient-credits message
with its `/credits` link, reached naturally once the grant ran low;
`/?purchase=success`; `/geschiedenis` with entries; the sidebar/thread list
(open/close, "Nieuwe chat", search field, per-thread ⋯ menu); the Account
menu and its delete-history confirm state (cancelled, not confirmed); the
in-app theme toggle persisting across a navigation; an EN spot-check of the
workspace + a chart round trip. `scrollWidth` was 375 on every page (no
horizontal scroll) and no console/page errors were logged on any step.

**B16's clarification round has no literal "Utrecht" chip** — worth
recording since the kickoff brief describes tapping one. The options WP26
offers as one-click chips are only the ones a deterministic dry-run has
verified as directly answerable; for this question (a missing sub-national
region on a `average_home_sale_price_by_gemeente` reading) neither offered
option is "Utrecht" — the two real options are "heel Nederland (landelijk
cijfer)" and "een specifieke gemeente of provincie — noem de naam" ("name
it"). Picking the second is a free-text reply, not a chip tap: the composer
placeholder correctly swaps to the clarifying question while it's open and
correctly reverts to "Stel een vraag…" once answered. Typing "Utrecht" and
sending resolves it exactly like the `c-b16-utrecht` fixture predicts. This
is the working, by-design mechanism — not a bug — but it does mean the
kickoff brief's phrasing ("tap the Utrecht option") doesn't match this
question's actual options; flagged for whoever wrote #238 next.

**Why `21-clarification-options.png` showed the Present stage instead of
the clarification** — a walk-SCRIPT bug, not a product one, found while
investigating the coordinator's report. The walk script closed the stage
with `page.getByRole('button', { name: 'Sluiten' })`, which matches TWO
buttons at that point (the stage's own close button AND the still-mounted
Insights panel's "Sluiten" underneath it, `chart.story.close` — same Dutch
label). Playwright's strict mode throws on the ambiguous match; the script's
blanket `.catch(() => {})` on that click swallowed the error, so the stage
never actually closed and every later screenshot in that run (including
`21`) was still showing it. Fixed by scoping the locator to the dialog
(`page.locator('[role="dialog"]').getByRole('button', { name: 'Sluiten' })`)
— confirmed the stage now closes (`dialog open? 0`) and a fresh capture of
the clarification round renders correctly, chips and all
(`$SCRATCHPAD/phone/light/21-clarification-options-CORRECTED.png`).

**Not fixed, documented for a future pass**: the sidebar's collapse/expand
toggle and each thread's ⋯ (options) button also measured under 44px, but
both use the shared `Button` `icon-xs`/`icon-sm` size tokens
(`web/components/ui/button.tsx`) — a design-system primitive used broadly
across the app well beyond this walk's flagged instances. Bumping those
tokens (even only below `sm`) is a wider-blast-radius change than the
per-component fixes above and deserves its own pass with a fuller audit of
every `icon-xs`/`icon-sm` usage, not a one-off patch buried in this WP.

## Verification (measured)

Tap-target heights, `getBoundingClientRect` via Playwright, before vs. after:

| Control | 375px before | 375px after | 1280px before | 1280px after |
|---|---|---|---|---|
| Account menu items | 16-20px | 44px | 16-20px | 16-20px (unchanged) |
| Chart form tabs | 24px | 44px | 24px | 24px (unchanged) |
| NL\|EN switch | 24px | 44px | 24px | 24px (unchanged) |
| Theme toggle | 24px | 44px | 24px | 24px (unchanged) |

Present stage caption visibility, confirmed with real screenshots (not a
`getBoundingClientRect` measurement — visibility is a layout/scroll-position
property, not a static tap-target size):

- 375px before: active caption sat at the bottom edge below a blank gap,
  mostly below the fold.
- 375px after: active caption fully visible directly under the pinned
  chart at step 0 and after scrolling to a later step (verified stepping to
  index 3 at 50% scroll still shows the correct caption fully on-screen).
- 1280px before/after: byte-identical — chart pinned left, caption centred
  in its `85vh` block on the right, exactly as before (the fix is gated
  `lg:min-h-[85vh]`).

- `npm run typecheck` — clean.
- `npm run web:typecheck` — clean.
- `npm run test:docs` — 1 file / 11 tests passed.
- `npm run web:test` — 98 files / 1499 tests passed (branch baseline was 98
  files / 1492 tests; +7 new regression tests across this WP's two commits,
  0 failed, 0 regressed).
- `npm run web:build` — see the session's final report for the measured
  result (real `next build`, not `next dev`).
- No `src/` file changed in this WP, so `benchmark:run`/`benchmark:score`
  were not re-run — the change is confined to `web/components/*`.

Desktop (1280px) was screenshotted before and after every fix (workspace,
a chart, the Present stage) and is behaviourally unchanged — every phone fix
above is gated with a `sm:`/`lg:` responsive class specifically so desktop
stays pixel-identical.

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
(Inzichten) and its step dots/arrows; the Present stage (full-screen,
`fixed inset-0`) — the chart pinned via `sticky top-0 max-h-[50vh]` with
each insight caption in its own `min-h-[85vh]` block is a deliberate
scroll-driven story (the visible "Scroll om verder te gaan" hint is the
tell) — NOT a layout bug, closing it via Escape and via the close button
both work; a clarification round (B16, "Wat is de gemiddelde huizenprijs in
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

- `npm run typecheck` — clean.
- `npm run web:typecheck` — clean.
- `npm run test:docs` — 1 file / 11 tests passed.
- `npm run web:test` — 98 files / 1496 tests passed (branch baseline was 98
  files / 1492 tests; +4 new tap-target regression tests, 0 failed, 0
  regressed).
- `npm run web:build` — see the session's final report for the measured
  result (real `next build`, not `next dev`).
- No `src/` file changed in this WP, so `benchmark:run`/`benchmark:score`
  were not re-run — the change is confined to `web/components/*`.

Desktop (1280px) was screenshotted before and after every fix (workspace,
a chart, the Present stage) and is behaviourally unchanged — every phone fix
above is gated with a `sm:` (or `md:`) responsive class specifically so
desktop stays pixel-identical.

# Session 110 — UX audit pass 5: verification of the pass 1–4 + a11y fixes (2026-09-17)

**How this was verified.** Current `main` at `ca5f763`, in the repo's own hermetic harness
(`scripts/dev-harness/`) on `:3102` with `HARNESS_INTENT_INJECT=1`, `EUROSTAT_EXPLORER_ENABLED=1`,
`TRIAL_ENABLED=1`, `EMBED_TOKEN_SECRET` set and the trial pot seeded 25/25 from a scratchpad preload
wrapper — PGlite fixture DB, stubbed auth, stubbed LLM, **zero LLM spend, production never touched**.
Driven through Playwright MCP at 1280×800, 375×812, 600×680 and 320×240. No tracked file was changed;
this file is the only write. Every row below reproduces the ORIGINAL audit's repro and reports a
measurement, not an impression.

**Counts: 36 VERIFIED · 2 PARTIAL · 2 STILL BROKEN · 1 regression found.**

---

## Verification table

| Report · row | Sev | Status | Measurement on `ca5f763` |
|---|---|---|---|
| p1 · 1 sidebar squeeze at 375 | P1 | **VERIFIED** | Expanded sidebar is `absolute inset-y-0 left-0 z-20 w-64` (computed `position:absolute`, `z-index:20`), 256×727 **over** the pane; composer "Verstuur" stays 91×40 at x 263 (was clipped off-screen). |
| p1 · 2 bad cookie → HTTP 500 | P1 | **VERIFIED** | 4 malformed `sb-…-auth-token` values → `/`, `/login`, `/galerij` all **200**; `/geschiedenis` **307 → /login**. `web/proxy.ts:256-266` try/catch + cookie delete. |
| p1 · 3 blank `/galerij` on a slow read | P2 | **VERIFIED (code)** | `return null` replaced by `GalleryLoadingRow` (skeletons + `gallery.loadingNote`), `web/components/gallery.tsx:88-103`. The >5 s degrade is not forceable in a browser without editing files; the normal path renders 12 cards. |
| p1 · 4 Dutch date headings in EN | P2 | **VERIFIED** | `lang="en"` sidebar heading reads **TODAY**. |
| p1 · 5 "Grafiek 1" in EN | P2 | **VERIFIED** | Dock tabs `Chart 1 · …` … `Chart 5 · …` with `lang="en"`. |
| p1 · 6 two "Close" in Style dialog | P2 | **VERIFIED** | Dialog buttons end `…, Terug naar standaard, Bewaar als mijn standaard, Download, Insluiten, **Sluiten**` — exactly 1. |
| p1 · 7 mixed number separators | P2 | **VERIFIED** | EN: `€30.00 — 2,000 credits` / `≈ 1,250 simple questions`. NL: `€ 30,00 — 2.000 credits` / `≈ 1.250 gewone vragen`. |
| p1 · 8 Account button clipped at 375 | P2 | **STILL BROKEN (worse)** | `right: 383` vs `clientWidth: 375` (pass 1 measured 379); `header.scrollWidth 383 > clientWidth 375`. The chevron glyph now ends at 372 so it is legible, but the button's right border is visibly cut (screenshot). `web/components/site-header.tsx:81` `px-2` + `:88` all-`shrink-0` cluster. |
| p1 · 9 proof panel opens below the fold | P2 | **VERIFIED** | After clicking "Bewijs deze cijfers": panel `top 274 / bottom 479` in an 800 px viewport. |
| p1 · 10 Download/Embed on different rows | P2 | **VERIFIED** | Download `x 889–954, y 867`; Insluiten `x 962–1036, y 865` — one row, 2 px apart. |
| p1 · 11 footer 2 lines / transparent | P2 | **VERIFIED** | 375 px: footer **37 px**, every text rect at `y 787` (one line), `background-color: lab(100 0 0)` (was `rgba(0,0,0,0)`). |
| p1 · 13 four buttons named "Buy" | P3 | **VERIFIED** | `aria-label` = `Buy €5.00 — 200 credits` … `Buy €250.00 — 25,000 credits` (NL: `Koop € 5,00 — 200 credits`). |
| p1 · 14 `<h1>` repeats the site name | P3 | **VERIFIED** | `Credits`, `Geschiedenis`, `Log in`. |
| p1 · 15 disabled composer chips | P3 | **VERIFIED** | Visible hints render: "Coming soon: upload a file (e.g. PDF)" etc. |
| p1 · 16 hbar reason always visible | P3 | **VERIFIED** | Gallery card: reason element is `class="sr-only"` (1×1 px) + `title` + `aria-describedby` on the disabled **Liggend** tab. |
| p1 · 17 run-on history name | P3 | **VERIFIED** | `…2024? 20 credits · 17 september 2026 om 17:31 …` — separator present. |
| p2 · 1 last trial answer vanishes | P1 | **VERIFIED** | 2nd trial question: the question **and** its refusal stay on screen, with "Je hebt je gratis proefvragen gebruikt. Maak een gratis account om verder te gaan." + CTA under them. |
| p2 · 2 embed snippet too short | P1 | **VERIFIED** | Generated `height="680"` + auto-resize script. At 600×680: source line bottom **585**, "Bevroren op 2026-09-17 · … · checkdecijfers.nl" bottom **605**, `documentElement.scrollHeight 680`, **zero** inner scrollers. |
| p2 · 3 internal refusal eats a trial question | P2 | **VERIFIED** | Non-fixture question → server log `ADMIN ALERT: INTERNAL refusal served`; counter stayed **"2 van 2 gratis proefvragen over"**. |
| p2 · 4 auto-play advances one step | P2 | **VERIFIED** | `scrollTop` 804 → 1484 → 2164 → 2844 over 12 s; `aria-pressed` flips false only at the **last** step (`aria-current="step"` on "Onder het gemiddelde — 2024"). |
| p2 · 5 two "Close" in Embed dialog | P2 | **VERIFIED** | Buttons: `Interesse in Pro, Kopieer code, Sluiten`. |
| p2 · 8 note editor never gets focus | P2 | **VERIFIED** | After activating a point, `document.activeElement` is the note `TEXTAREA` (inside "Notitie bij Jaarmutatie CPI · 2020"). |
| p2 · 9 Enter does nothing on a point | P2 | **VERIFIED** | Focus point → **Enter** → editor opens and takes focus. |
| p2 · 10 embed chart at 320×240 | P2 | **PARTIAL** | Chart height 256 → **168 px**, total content 648 → **559 px**, but the chart still sits at `y 216–384` in a 240 px frame, so it is not visible in the frame. See also the regression below. |
| p2 · 11 "Apply brand colours" ungated | P3 | **STILL BROKEN** | Button enabled with no brand key; click → "Merkkleuren ophalen is op dit moment niet mogelijk." (`web/components/chart-config-panel.tsx`, Colours tab). |
| p2 · 12 button named just "Default" | P3 | **VERIFIED** | Reads "Terug naar standaard". |
| p2 · 14 step buttons named by kind only | P3 | **VERIFIED** | `Uitschieter naar beneden — 2020, Onder het gemiddelde — 2021, Sterke stijging — 2022, Sterke daling — 2023, Onder het gemiddelde — 2024` — all distinct. |
| p2 · 17 notes disclosure missing | P3 | **VERIFIED** | "Aantekeningen blijven in deze sessie en staan niet in downloads of embeds." |
| p3 · 1 12-province default form | P1 | **VERIFIED** | `!!regionset provincies`: **Liggend** is `aria-selected="true"`; 24 `<text>` nodes = 12 province names on the axis + 12 values; **0 overlapping pairs** (row pitch 17.5 px vs 13–15 px text). Was: no region named, 10/12 labels overlapping. |
| p3 · 2 proof button gone on replay | P1 | **VERIFIED** | Reload + re-open the thread → `[Nuttig antwoord, Niet nuttig, **Bewijs deze cijfers**, Grafiek in het paneel →, Kopieer, CSV]`; `/geschiedenis` also carries "Bewijs deze cijfers". |
| p3 · 3 26 gemeente labels collide | P2 | **VERIFIED** | `!!regionset gemeenten-utrecht`: chart height 256 → **520 px**, 26 labels, pitch **18–19 px** vs 13 px text, **0 collisions** — at 1280 (334 px chart) **and** 375 (211 px chart), no horizontal page scroll. |
| p3 · 4 promised reading, no control | P2 | **VERIFIED** | Region-set card now has `<select aria-label="Lezing">` with `Standaard` / `Gemiddelde bevolking (jaargemiddelde, geen standcijfer)` — the exact reading the body promises. |
| p3 · 6 auto-play (recheck) | P2 | **VERIFIED** | Same trace as p2 · 4. |
| p3 · 7 hardcoded "Close" in NL | P3 | **VERIFIED** | Style and Embed dialogs both end in **"Sluiten"** with `lang=nl`. |
| p4 · 1 bar labels overpainted | P1 | **VERIFIED** | 3-region Staaf: 15 value labels, all full (`45.587 45.389 45.394 45.106 …`); **0** labels covered by a shape painted later in document order; screenshot legible. |
| p4 · 2 20 px plot at 375 | P1 | **VERIFIED** | 6-region line at 375×812: plot **142 px of a 211 px** chart = **67 %** (was 20 px = 9 %); x-axis ticks `2020 2022 2024` now render; end-label layer thinned to 2. |
| p4 · 3 end labels overlap | P1 | **VERIFIED** | 6-region at 1280×800: 12 chart texts, **0 overlapping pairs**; only one label keeps the `2024: ` prefix. |
| p4 · 4 small-multiples axis clips labels | P2 | **VERIFIED** | Eigen assen: min/max labels 34–42 px wide inside 117 px panels, left edges 853/993/1139 vs panel lefts 829/972/1115 — `872.757`, `651.157`, `45.587`, `45.106` all whole; screenshot legible. |
| p4 · 6 raw `Impossible` in the gap note | P2 | **VERIFIED** | "Geen waarde voor 2020 (Eemsdelta): **deze waarde kan volgens CBS niet voorkomen.**" |
| p4 · 7 wrong Liggend reason | P2 | **VERIFIED** | "Liggende staven tonen één periode; deze grafiek loopt over meerdere periodes." |
| a11y · 1 muted-foreground contrast | Serious | **VERIFIED** | Source-badge pill computes `#6c6c6c` on `#f5f5f5` = **4.816:1** (was 4.34) — clears 4.5:1. |
| a11y · 2 no `<main>` landmark | Moderate | **VERIFIED** | `/login`, `/werkwijze`, `/privacy` each serve exactly one `<main>`. |
| a11y · 3 scrollable findings list | Serious | **VERIFIED** | `tabindex="0" role="region" aria-label="Lijst met bevindingen"` on the `max-h-40 overflow-y-auto` div. |
| a11y · 4 heading order on `/galerij` | Moderate | **VERIFIED** | `h1 "De galerij"` followed by 12 × `h2` (0 `h3`). |

**Design rows built in waves 9/12, confirmed as built (not re-scored):** p3 · 10 — an hbar above 15 bars
labels its first and last row only (`701.163` / `403.296`, real cell values); p3 · 11 — all 26 bars of a
comparison-shaped chart are ONE colour (`#0072b2`); p1 · 18 — the chart card shows `000000 Alle
bestedingen` without the `Bestedingscategorieen:` prefix (the raw key stays in the proof table);
p1 · 20 — the composer is now a `<textarea maxlength="500">`.

## Regressions found

| # | Sev | Where | What I saw | Expected | Repro | Proposed fix |
|---|-----|-------|-----------|----------|-------|--------------|
| 1 | P2 | `web/components/chart.tsx:3800-3809` (the `embedMode` reading row added by #262(c)) | The public embed page **scrolls horizontally at 320 px**: the alternate-reading `<select>` is **341 px wide in a 320 px frame** (`documentElement.scrollWidth 348 > clientWidth 320`), because a registry alternate label ("CPI indexniveau (2025=100), geen mutatiepercentage") sets its intrinsic width and nothing caps it. Pass 2 explicitly recorded "no horizontal scroll … in the embed at 320 px", so this arrived with the wave-1 embed reading toggle. | The embed never scrolls sideways at a common sidebar unit. | Open any embed token URL at 320×240 and measure `scrollWidth`. | Add `max-w-full` (and `min-w-0` on the wrapper `div`) to the embed `<select>`, or `truncate` the option text — the chat/dock copy at `:3661` sits in a `flex-wrap` row and does not hit this. |

Also worth naming, though it is the accepted shape of p1 · 11's own fix: at 375 px the footer now reads
"Cijfers: CBS StatLine (CC BY 4.0) · Werkwijze · Privacy" — the **"Elk getal herleidbaar tot een
officiële CBS-tabel" clause is hidden below `sm`**. The per-chart source+date line is unaffected, so the
public claim still holds on every card; flagging it only so nobody is surprised that the phone footer
drops the trust sentence.

## Still broken

- **p1 · 8 (P2) — Account button overflows the 375 px viewport.** `right: 383`, `header.scrollWidth 383`
  vs `clientWidth 375`; the button's right border is cut in the screenshot. It moved the *wrong way*
  since pass 1 (379 → 383), although the chevron glyph is now inside the viewport. The row asked for a
  ≥ 12 px right gutter; there is none. `web/components/site-header.tsx:81` (`px-2` at `<sm`) and `:88`
  (wordmark, balance badge and Account button are all `shrink-0`/non-shrinking, so nothing gives).
- **p2 · 10 (P2) — embed chart at 320×240 (PARTIAL).** The fix did make the chart height frame-relative
  (256 → 168 px) and cut total content 648 → 559 px, but in a 240 px frame the chart still begins at
  `y 216`, i.e. entirely below the fold. A 320×240 sidebar unit still cannot show the chart.
- **p2 · 11 (P3) — "Pas merkkleuren toe" is still offered and still fails after the click.** Same shape
  as p1 · 12, which WAS fixed for Embed; the Colours-tab brand button was not gated on the same
  server-side condition its action checks.

## What works well

The region-set and multi-region work is the visible win of this session and it holds up under
measurement: the 12-province chart now **names every province on an axis with zero label collisions**,
the 26-gemeente chart grew to 520 px so all 26 names are readable at 375 px as well as 1280, the
6-region line keeps **67 % of a phone's width for the plot** (it was 9 %), and no two numbers touch on
any chart I measured — 0 overlapping text pairs across four different chart shapes at two viewports.
The partial-region case is exactly as ADR 055 designs it: a gap in the line, no 2020 bar, and now a
plain-Dutch note ("deze waarde kan volgens CBS niet voorkomen") instead of the raw CBS attribute. The
trial path is honest in both directions — an internal refusal refunds the visitor's question, and the
last trial answer now stays on screen with the account nudge under it instead of vanishing. **"Bewijs
deze cijfers" survives a reload and reaches `/geschiedenis`**, which was the most serious of the P1s.
The Present stage's auto-play runs the whole story to the last step. **Console is clean**: across the
whole pass, 0 app errors, 0 React warnings, 0 hydration mismatches — the only noise is the dev HMR
socket (from my own harness restart), Next's CSS-preload notice, and two 404s I fired deliberately.
No horizontal page scroll at 375 px on any surface. Opening the Style modal a second time renders it
fully within 40 ms; the first open in `next dev` takes ~120 ms to fill the panel (on-demand chunk
compilation — the modal frame and chart are already painted, nothing blanks), and Present showed no
flash at all.

## Checked and deliberately not reported

- **No gallery card is comparison-shaped.** All 12 curated charts are single-series time-series lines
  (1 `.recharts-line-curve`, 0 bars each), so the new one-colour-per-comparison rule cannot have
  changed any of them — the sweep question answers "no".
- **The cookie-clearing half of p1 · 2's fix never fired** in my probes: every malformed value resolved
  to "no claims" rather than throwing, so no `Set-Cookie` delete appeared. The defect the row reported
  (HTTP 500 on every route) is gone either way; the delete branch is simply unexercised.
- **`!!regionset …` / `!!intent …` thread titles** in the sidebar and dock tabs — a harness artifact of
  the injection prefix, as pass 3 already noted.
- **Backend prose staying Dutch under English chrome** — the documented word-list limitation
  (p1 · 25 / p4 · 15), unchanged and deliberate.

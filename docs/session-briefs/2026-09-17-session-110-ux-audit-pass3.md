# Session 110 — UX audit pass 3: region sets, the Eurostat explorer, small multiples (2026-09-17)

**How this was audited.** The repo's own hermetic harness (`scripts/dev-harness/`) on `:3102` with BOTH
session-111 flags on (`HARNESS_INTENT_INJECT=1`, `EUROSTAT_EXPLORER_ENABLED=1`) — PGlite fixture DB,
stubbed auth, stubbed LLM, **zero LLM spend, production never written to**. Three real region-set answers
were driven through the chat UI (`!!regionset provincies`, `!!regionset gemeenten-utrecht`, and two raw
`!!intent` payloads), plus `/eurostat-explorer`, `/geschiedenis`, the Insights panel and the Present stage.
Viewports 1280×800 and 375×812, light and dark. ADRs 041, 042, 048, 050, 051, 054 and
`chart-small-multiples.tsx` (+ test) were read first, so deliberate choices are not reported as bugs.
Passes 1–2 were re-checked only where a finding could recur.

**Counts: P1 = 2 · P2 = 8 · P3 = 6.**

*Tooling note:* the shared Playwright-MCP browser was repeatedly navigated to **production** mid-session by
something outside this session (three times, to `/`, `/galerij`, `/werkwijze`). No question was asked there
and no spend occurred; the audit was finished in a private Chromium driven from the scratchpad instead.

---

## Fix now (mechanical — no design decision needed)

| # | Sev | Where | What I saw | Expected | Repro | Proposed fix |
|---|-----|-------|-----------|----------|-------|--------------|
| 1 | **P1** | `web/lib/chart-view-state.ts:71-79` (`defaultFormFor`), rendered by `web/components/chart.tsx` bar branch | The **default** chart of a 12-province region-set answer names **no region at all**: the 334×256 dock chart holds 13 `<text>` nodes — 12 values and the single x label "2025" — and the 12 bars are told apart only by colour. On top of that **10 of the 12 value labels physically overlap** at 1280×800 (`1.409.144 ∩ 1.195.789 ∩ 1.135.328`, `664.222 ∩ 602.833 ∩ 506.529 ∩ 456.395`), and **13 pairs** at 375×812 — the numbers smear into each other. | The reader can tell which bar is which province, and read each number. | Ask `!!regionset provincies`, look at the dock. Screenshots `.playwright-mcp/s110p3-bar12-light.png`, `…-bar12-mobile-dark.png`. | Move `defaultFormFor`'s `isComparisonShaped → 'hbar'` branch **above** the `> BAR_LABEL_MAX` gate: a comparison-shaped spec opens on Liggend at every series count (it is the only form that puts the region on an axis), not just at 16–40. |
| 2 | **P1** | `web/lib/answer-proof.ts:350-376` (silent `catch { return null }`), called from `web/lib/replay-assemble.ts:142`, `web/components/question-history.tsx:187`, `web/app/actions.ts:29` | **"Bewijs deze cijfers" is present on a live answer and gone from every stored one.** Measured on two different answers (B4 inflation and a region set): fresh turn → `[Nuttig antwoord, Niet nuttig, Bewijs deze cijfers, Grafiek in het paneel →, Kopieer, CSV]`; re-open the same thread, or reload → the proof button is missing. `/geschiedenis` has **no proof panel at all**. Citation, CSV, stat card and `answerView` all replay fine, so the envelope and its `cells` are intact — `buildAnswerProof` is **throwing and being swallowed**. | The proof panel is the product's namesake action; it must survive a reload. | Ask anything, reload, re-open the thread; then open `/geschiedenis`. | Prime suspect: `answer-proof.ts:57` imports `syncDateLabel` from `web/components/source-badge.tsx`, a **`'use client'` module** — calling it from a Server Action/Server Component throws on a client reference (vitest never sees this, it loads both as plain modules). Move `syncDateLabel` into a plain lib module, and **log the caught error instead of swallowing it**. Same bug silently disables #252's "Opgehaalde URL's" badges (the third call site). |
| 3 | P2 | `web/components/chart.tsx:2879-2887` (`<YAxis interval={0}>` at a fixed 256 px chart height) | At 26 bars (the gemeenten of Utrecht, the exact case ADR 054 was built for) **every** category label overlaps its neighbour: row pitch **8.1 px** against **13 px** of text — 25 of 25 adjacent pairs collide, at 1280 (334 px chart) and at 375 (211 px chart). | Labels readable, or thinned. | `!!regionset gemeenten-utrecht`. Screenshots `s110p3-hbar26-dock.png`, `s110p3-hbar26-mobile.png`. | Give the hbar chart a height proportional to series count (`max(256, n * 18)`) instead of the fixed card height. |
| 4 | P2 | `src/chart/alternate-reading.ts:114` | A region-set answer's body promises *"Er is ook een andere lezing beschikbaar: Gemiddelde bevolking…"* but the chart offers **no "Lezing" control**. On an ordinary answer the same promise comes with a working dropdown (`Lezing: Standaard / CPI indexniveau…`), verified side by side in the same session. | The promised reading is one click away, as everywhere else. | Ask `!!regionset provincies` vs the B4 inflation question; compare the chart header. | The alternate intent copies `regions: primaryIntent.regions` but **not `regionSet`**, so the alternate re-query runs regionless on a geo table and is dropped best-effort. Add `regionSet: primaryIntent.regionSet` — the same fix the comment directly above it already records for `regions`. |
| 5 | P2 | `web/app/eurostat-explorer/page.tsx:149-172` + `web/lib/eurostat-explorer.ts:88-99` | The explorer's form is Table + Measure + From/To year — **no dimension/region picker**. The only registered table (`eurostat:demo_pjan`, a geo dataset) therefore always ends at "**Needs clarification: Kun je aangeven voor welke regio?**", a chat question the form has no field to answer. The table, chart, CSV export and proof panel are unreachable for it. | Either a dimension picker, or the page saying *why* this is a dead end — its own empty state does exactly that, excellently. | `/eurostat-explorer` → pick the table → pick the measure → Run query. | Render the clarification with the residual named ("this tool has no dimension picker yet — see RUNBOOK § WP30c E1"), and/or add a geo select built from the table's own `dimension_labels`. |
| 6 | P2 | `web/components/chart-story-stage.tsx:186-235` (`armProgrammaticLatch`) + `:376` | **Auto-play still advances exactly one step and switches itself off** — pass 2 row 4 is not fixed by `0fa6404`. Traced twice at 0.5 s resolution: `aria-pressed` true at 0 s, `scrollTop` 0 → 779 → 804 at 4.5 s, `aria-pressed` **false** at 5 s, no further movement for the next 12 s (6 steps, 3904 px of content). | Runs to the last step unless the reader intervenes. | Insights → Presenteren → Automatisch afspelen, wait 12 s. | The latch clears on `scrollend`/position-reached/`MAX_SETTLE_MS`; a trailing animation `scroll` event still arrives after it clears. Keep it armed until the *next* step is requested, or ignore `scroll` entirely and rely on `wheel`/`touchmove`/`pointerdown` (which already fire for real gestures). |
| 7 | P3 | `web/components/ui/dialog.tsx:83` | Every modal's × is named by a hardcoded `<span className="sr-only">Close</span>` — so in the **Dutch** UI the Style dialog, the Embed dialog and every other modal announce "Close". | "Sluiten" in NL. | `lang=nl`, open Grafiek → Insluiten; the dialog's last accessible name is "Close". | Take the label from the catalogue (`t(lang, 'common.close')`). |
| 8 | P3 | `web/components/chart-story.tsx` / `chart-story-stage.tsx` step buttons | Pass 2 row 14's fix appends the finding's **period** — which on a region comparison is the same for every finding, so the stage's step list reads `Uitschieter naar boven — 2024`, `Uitschieter naar beneden — 2024`, `Onder het gemiddelde — 2024`, `Boven het gemiddelde — 2024`, **`Onder het gemiddelde — 2024`** — two identical names again. | The disambiguator is the thing that varies: the **region**. | `!!regionset gemeenten-utrecht` → Inzichten → Presenteren; read the step buttons' `aria-label`s. | Append the finding's series label when the periods are all equal (or always: "Onder het gemiddelde — Nieuwegein"). |
| 9 | P3 | `web/app/eurostat-explorer/page.tsx` | With `lang=nl` the page's own chrome is English ("Eurostat explorer (internal)", "Table", "Choose a table…", "Run query") while the shared footer under it is Dutch ("Cijfers: Eurostat (CC BY 4.0) · Elk getal herleidbaar tot een officiële Eurostat-dataset"). | One language per page. | `/eurostat-explorer` with the `lang=nl` cookie. | Internal tool — either drop the shared footer here or accept English and say so in the page's intro. |

## Needs a design decision (do **not** auto-dispatch)

| # | Sev | Where | What I saw | Why it needs a call |
|---|-----|-------|-----------|---------------------|
| 10 | P2 | `web/components/chart.tsx:2197-2198` (`hbarLabelsShown`, `BAR_LABEL_MAX = 15`) + `:2871-2878` (`<XAxis tick={false}>`) | A 16–40-series horizontal bar chart — the band ADR 042's session-110 addendum made the **default** — contains **zero numbers**: value labels are thinned above 15 bars and the number axis draws no ticks by design. The 26-gemeente chart has no digit anywhere on it; 24 of the 26 values exist only in the proof panel, the Tabel view and the CSV. | Both halves are deliberate ("no invented ticks"; the >15 thinning rule). Fixing it means choosing: show an x-axis when labels are thinned, label only the top/bottom bars, or accept the chart as a shape-only picture with the table beside it. |
| 11 | P2 | `web/lib/chart-presentation.ts` (`seriesColor`, Okabe–Ito 8) | The palette cycles after 8, so on a 12-province chart **Zuid-Holland and Groningen are both `#0072b2`**, Noord-Holland and Drenthe both `#d55e00`, Noord-Brabant and Flevoland `#009e73`, Gelderland and Zeeland `#cc79a7` — and on the default vertical-bar form colour is the *only* thing identifying a bar (row 1). | ADR 042 chose an 8-colour accessible palette on purpose. A region comparison arguably wants **one** colour for every bar (the measure is the same; the region is the axis) — that is a product-voice call, not a bug fix. |
| 12 | P2 | `src/answer/compose/template.ts` (`renderRegionSet`) + `format.ts` (`buildRegionSetLine`) | Two denominators in adjacent sentences: *"**Van de 26 gemeenten** had De Bilt in 2024 de hoogste waarde…"* directly above *"Dekking: **26 van de 42 gemeenten** hebben een cijfer. 16 gemeenten bestonden in deze periode niet volgens het CBS."* Both are true (ADR 054 D4: `Impossible` members do not break completeness) but a reader meets 26, then 42, then 16 in three lines. | Re-wording the body to name the class once ("Van de 26 gemeenten die in 2024 bestonden…") touches R1-scanned answer text and the R8 byte-identical re-derivation. Owner/product call. |
| 13 | P2 | `src/answer/respond/refusals.ts:608-615` + `src/query/resolve.ts:313` | An intent with several regions **and** several periods is refused `invalid_intent` with no sub-reason, so it is served as the **generic internal refusal** ("Ik kon deze vraag niet omzetten in een geldige zoekopdracht op onze data.") **and pages the owner**: the dev log shows `ADMIN ALERT: INTERNAL refusal served … several regions AND several periods in one question is not supported`. "Hoe ontwikkelde de bevolking van Amsterdam en Rotterdam zich van 2020 tot 2024?" is a natural journalist question. | Exactly the class ADR 054 D6 already fixed for the national-measure case (a `subReason` + honest wording). Whether today's parser can emit that shape I did **not** verify — no fixture exercises it; I reached it through `!!intent`. Worth deciding before it alerts in production. **Superseded same session (ADR [055](../decisions/055-multi-region-series.md)): the example question now ANSWERS** (2–6 explicitly named regions × a range, a new `region_series` shape); the `subReason`/honest wording this row asked for was also built, for what still refuses (a region class, or over-cap). |
| 14 | P2 | `web/components/chart.tsx:1832` (`smallMultiplesAvailable`) vs `src/query/resolve.ts:313` | **Small multiples can never appear from a CBS answer.** The toggle needs `form === 'line' && series.length > 1`; `src/chart/build.ts:74` emits `kind: 'line'` only for shape `'series'`, and the resolver refuses several regions with several periods — so a line chart always has exactly one series. Every multi-series spec (comparison / region_set) is a bar, where small multiples is deliberately unavailable. | The feature (#197 idea 8) is live code with tests and no reachable path. Either the one-varying-axis rule relaxes for a "trend per region" shape, or small multiples belongs only to the (dormant) user-data charts — a roadmap call, not a fix. **Superseded same session (ADR [055](../decisions/055-multi-region-series.md)): the first option was taken** — a `region_series` result charts as multi-series `kind: 'line'`, so small multiples now has a real, reachable, tested path from a CBS answer. |
| 15 | P3 | `src/answer/respond/refusals.ts` (`buildRegionScopeOnNationalMeasureRefusal`) | The new refusal is excellent — *"De cijfers over werkloosheidspercentage … publiceert het CBS alleen landelijk … **Ik kan je wel het landelijke cijfer geven.**"*, 0 credits — but that offer is prose only; no chip takes it, although the intent to serve it is one field away (drop `regionSet`). | Same shape as pass 1 row 23, which #134(c) solved for the forecast/causal refusal. Touches the chip carrier and the credit rules (ADR 029). |
| 16 | P3 | `src/chart/insights.ts:223-228` + `web/lib/i18n/messages.ts:503-504` | On a region ranking the first two Insight cards are "**Uitschieter naar boven** — De Bilt: 701.163 euro" and "**Uitschieter naar beneden** — Veenendaal: 403.296 euro" — i.e. the answer body's own two sentences, restated, and the highest member of a complete ranked class called an *outlier* (the EN "Notable high" is softer). | The bar branch is deliberate and correct about *which* bar it picks. Whether "uitschieter" is honest for a ranked maximum, and whether cards 1–2 should be skipped when the body already states them, is product voice. |

## What works well (do not "fix" these)

The **region-set answer itself is very good**. The Dutch reads naturally (*"Van de 12 provincies had
Zuid-Holland in 2025 de hoogste waarde voor bevolking op 1 januari: 3.863.397. Zeeland had de laagste
waarde: 392.969."*), every number on screen is a cell value, and the **coverage line lands exactly where
ADR 054 D6 says**: `<p class="text-sm text-muted-foreground">` immediately after the body, in the same slot
and style as the assumption line (`chat.tsx:1137-1149`), outside the R1-scanned body. The incomplete case
is honest without being noisy: "26 van de 42 … 16 gemeenten bestonden in deze periode niet volgens het CBS"
— counts, not codes, above the 5-member naming threshold. **Bar order matches the ranking derivation
exactly** (De Bilt → Veenendaal; Zuid-Holland → Zeeland), the **Tabel view is the best view of this answer**
(26 rows, Regio + 2024, ranking order, no horizontal scroll at 375), the **proof panel on a live turn lists
all 12/26 cells** with status and a step-by-step that prints the whole ranking order, the **Download menu**
(PNG/SVG/PDF/chart-only) works on a region-set chart, `regionSetLine` **is** carried by `copy-answer.ts:31`
and `src/threads/replay.ts:97` (ADR 054 D7's "not carried yet" caveat is now stale — worth deleting), and
the **`region_scope_on_national_measure` refusal is the best-written refusal in the product**, at 0 credits.
Pass 2's row 5 (duplicate Close in the Embed dialog), row 6 (*"Could not save the headline"* → now "Kon de
kop niet voorstellen.") and row 15 (`role="alert"` on it) are **verified fixed**, as is pass 2 row 18 — the
Eurostat explorer's footer is now source-aware ("Cijfers: Eurostat (CC BY 4.0)"). Pass 1 row 9 is fixed: the
proof panel now scrolls itself into view (measured `top: 105` in an 800 px viewport). **Zero console errors
and zero React warnings** across every surface in this pass (the only noise is Next's dev HMR socket and a
CSS-preload notice), and **no horizontal page scroll** at 375 px anywhere.

## Surfaces I could NOT reach, and why

- **The journalist headline's happy path (ADR 050)** — there is no `headline` (or `insights`) directory
  under `tests/fixtures/llm/`, so `llm-stub.mjs` 400s the request (`MISS model=claude-haiku-4-5 q="GEGEVENS
  (waarden en periodes als placeholders)…"`) and only the failure path renders. Recording those two
  fixtures is the cheapest way to make this auditable — I did not add them, since a new file under
  `tests/fixtures/llm/**` is repo content an audit may not create.
- **Insights AI phrasing** — same reason; the cards fall back to the deterministic kind + value labels,
  which is what rows 8 and 16 were judged on.
- **The embed code box** — `EMBED_TOKEN_SECRET` is not set by `scripts/dev-harness/env.sh`, so the dialog
  opens and then says "Insluiten is nu niet beschikbaar" (pass 1 row 12's shape, still unfixed). Pass 2 set
  the secret by hand and audited the embed properly; not re-reported here.
- **Small multiples** — unreachable by construction; see row 14, which is the finding. **Superseded same session (ADR [055](../decisions/055-multi-region-series.md)): row 14's own fix now gives it a reachable path via `region_series`.**
- **The Eurostat table/chart/CSV/proof path** — unreachable; see row 5.
- **Production** — deliberately untouched beyond the three hijacked navigations noted above.

## Checked and deliberately **not** reported

- **Region labels carry CBS's own "(PV)" / "(gemeente)" suffixes** ("Zuid-Holland (PV)", "Utrecht
  (gemeente)") on the chart, the legend and the proof table. These are CBS's verbatim `dimension_labels`
  values; inventing a prettier label would be exactly the kind of un-sourced rewrite R11/principle (a) rule
  out. Worth an owner conversation some day, not a defect.
- **Insights picks two "Onder het gemiddelde" members out of 26** (Nieuwegein, Vijfheerenlanden) with no
  stated reason for those two — `insights.ts`'s selection is deterministic and documented; only the
  labelling (row 16) is questioned.
- **The Tabel view shows no unit column** ("Regio | 2024", values "701.163") — the unit rides the card
  header and the body sentence ("euro"), consistent with every other table in the product.
- **The `!!regionset …` thread titles in the sidebar and `/geschiedenis`** — a harness artifact of the
  injection prefix, not product copy.
- **Backend prose staying Dutch in the EN UI** (body, Definitie, "Er is ook een andere lezing…",
  attribution) — the documented limitation of the word-list approach (pass 1 row 25).

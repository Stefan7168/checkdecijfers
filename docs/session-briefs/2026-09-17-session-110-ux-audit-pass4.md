# Session 110 — UX audit pass 4: the multi-region time series (ADR 055) (2026-09-17)

**How this was audited.** The repo's own hermetic harness (`scripts/dev-harness/start-all.mjs`) on
`:3102` with `HARNESS_INTENT_INJECT=1` — PGlite fixture DB, stubbed auth, stubbed LLM, **zero LLM
spend, production never touched**. Five real `region_series` turns were driven through the chat UI with
raw `!!intent` payloads (region CODES, as `tests/answer/region-series-answer.test.ts` uses them):
Amsterdam+Rotterdam 2020–2024; the G4 + Eindhoven + Tilburg (6 regions); Amsterdam + **Eemsdelta** +
Rotterdam (a naturally *partial* region — Eemsdelta has a row but a null `Impossible` value at 2020,
found by scanning `tests/fixtures/cbs/03759ned/observations-page-1.json`, so no DB mutation was needed);
a region-CLASS × range refusal; a 7-named-region × range refusal plus its offer chip clicked and sent.
Viewports 1280×800 and 375×812. [ADR 055](../decisions/055-multi-region-series.md),
`chart-small-multiples.tsx`, `csv.ts`, `copy-answer.ts` and `refusals.ts` were read first, so deliberate
choices (no trend headline on a multi-region card, no Download/Embed in Tabel or small multiples, no
value labels under "Gelijke assen") are **not** reported as bugs. Passes 1–3 were treated as fixed.

**Counts: P1 = 3 · P2 = 5 · P3 = 5.**

*Tooling note (same class of problem pass 3 hit).* Another session was driving the **same** harness on
`:3102` throughout: its `askQuestion` calls appear in my own harness log and it burned the 100-credit
signup grant twice, forcing two harness restarts. Screenshots below are in `.playwright-mcp/` (gitignored).

---

## Fix now (mechanical — no design decision needed)

| # | Sev | Where | What I saw | Expected | Repro | Proposed fix |
|---|-----|-------|-----------|----------|-------|--------------|
| 1 | **P1** | `web/components/chart.tsx:1156-1168` (`SeriesBar` draws its `<rect>` **and** its `<text>` in one `<g>`, one `<g>` per series) | In **Staaf** form on a 3-region series, Eemsdelta's bar labels render **truncated**: the screen shows `45.58`, `45.38`, `45.39`, `45.10(` while the DOM text is `45.587`, `45.389`, `45.394`, `45.106`. Recharts paints series in order, so a *later* series' bars overpaint an *earlier* series' value label. A CBS value is shown wrong on screen. | Every printed digit is the cell's digits. | Ask the 3-region intent (Amsterdam/Eemsdelta/Rotterdam, 2020–2024) → chart tab **Staaf**. `p4-staaf.png`, `p4-staaf-zoom.png`. | Collect the bar labels into ONE overlay `<g>` rendered after all bar series (or skip a label whose measured width exceeds the bar band). |
| 2 | **P1** | `web/components/chart.tsx:2178-2185` (`yAxisWidth` ≤ 80 px, `rightMargin` ≤ 140 px — both absolute, neither relative to chart width) | At **375×812** the 6-region line chart has a **20 px** plot area: measured, all six `.recharts-line-curve` paths are `x 183→203` inside a 211 px wrapper (y-axis + left margin eat 69 px, end-of-line labels 87 px). Five years of six series are drawn in 9 % of the chart; **no x-axis tick renders at all** (`xTicks: []`). | The plot keeps the majority of the width on a phone. | 375×812, 6-region intent, scroll to the chart. `p4-6reg-mobile-chart.png`. | Cap both margins as a *fraction* of the container (e.g. `min(rightMargin, 0.3 * width)`), and drop the end-label layer below ~260 px, falling back to the legend. |
| 3 | **P1** | `web/components/chart.tsx:515-531` (`valueLabelPlan`'s `endLabels`: one per series, no collision pass) | Two end-of-line labels are drawn **on top of each other** on the flagship 6-region case: `2024: 246.417` (Eindhoven) and `2024: 229.836` (Tilburg) share the identical x-range with only a **4 px** y offset — measured at **both** 1280×800 and 375×812, and again with the sidebar collapsed (a wider panel), so it is value-driven, not width-driven. The digits smear. | Two numbers never overlap. | 6-region intent, look at the bottom right of the chart. `p4-6reg-desktop-dark.png`, `p4-6reg-desktop-light.png`. | After building `endLabels`, nudge/stack labels whose y boxes collide (the hbar form already thins labels; the line form has no equivalent), or drop the lower one and rely on the legend + Tabel. |
| 4 | P2 | `web/components/chart-small-multiples.tsx:136` (`width={ownTicks.length > 0 ? 28 : 0}`) | Under **Kleine grafieken → Eigen assen** the per-panel min/max labels are clipped by the 28 px axis: an 89 px panel shows `.298` / `.757` (Amsterdam) and `).610` / `1.157` (Rotterdam) — the real values are 931.298 / 872.757 / 670.610 / **651.157**. `1.157` reads as a plausible but wrong number. | The label fits, or is not drawn. | 2-region intent → Kleine grafieken → Eigen assen. `p4-sm-own.png` (DOM text 41.6 px wide vs a 28 px axis). | Width the axis from the measured label (`labelWidthPx`, already used by the combined chart at `chart.tsx:2178`) instead of the constant 28. |
| 5 | P2 | `src/answer/respond/refusals.ts:617` | The over-cap refusal's offer chip names the region by its **raw CBS code**: *"Hoe ontwikkelde bevolking op 1 januari in **GM0363** zich van 2020 tot en met 2024?"* — machine identifiers in product copy. (The chip does work: clicking it pre-fills the composer and sending it returns a correct Amsterdam series, so this is cosmetic, not broken.) | "…in Amsterdam zich…". | 7-region intent → read the chip under "Probeer in plaats daarvan:". `p4-sevenrefusal.png`. | The file's own header records this as an accepted **Assumption** (no registry lookup in this pure template layer). `suggestions.ts`'s `buildRefusalSuggestions` already has an injected label lookup — thread the same lookup in, or carry the label on the refusal. |
| 6 | P2 | `src/chart/build.ts:60-66` (`nullNote`) | The gap note prints the CBS attribute verbatim in Dutch copy: *"Geen waarde voor 2020 (Eemsdelta): **Impossible** (CBS)."* ADR 054's own region-set line already renders this exact situation in plain Dutch ("… bestonden in deze periode niet volgens het CBS"), so the product now says the same thing two ways. | Plain Dutch, e.g. "…: de gemeente bestond toen niet volgens het CBS." | 3-region partial intent → read under the chart. `p4-partial.png`, `p4-staaf.png`. | Map the handful of CBS `ValueAttribute` values to NL/EN strings in the i18n catalogue; keep the raw code in the proof panel's Status column, where it belongs. |
| 7 | P2 | `web/lib/i18n/messages.ts:404` (`chart.formReason.hbarTimeSeries`) | On a 6-region series the disabled **Liggend** tab explains: *"Liggende staven passen alleen bij een vergelijking tussen regio's."* — shown on a chart that **is** a comparison between six regions. The real reason is the time axis. | A reason that is true for this chart. | Any `region_series` answer, hover/read the Liggend tab. | Re-word to name the time axis ("Liggende staven tonen één periode; deze grafiek loopt over meerdere jaren."). |
| 8 | P3 | `web/components/chart-story.tsx` / `chart-story-stage.tsx` step labels | The Insights steps on a 2-region series are `Sterke stijging — 2023 · Amsterdam`, `… · Rotterdam`, `Uitschieter naar boven — 2024 · **Rotterdam**`, `… · **Amsterdam**` — the region order **flips** between the two pairs, so stepping through reads as jumping back and forth. | Stable region order (the intent's) inside each finding kind. | 2-region intent → Inzichten → read the step `aria-label`s. | Secondary-sort findings of equal kind/period by series index. |
| 9 | P3 | `src/answer/respond/refusals.ts` (`multi_region_multi_period` body) | The refusal never states the cap: *"… of over meer regio's dan in één antwoord passen."* A journalist who asked for 7 is not told that 6 is the limit. | Name the number (`REGION_SERIES_MAX_REGIONS`). | 7-region intent. `p4-sevenrefusal.png`. | "…tot zes regio's met naam over die periode…". |
| 10 | P3 | `web/components/chart-embed-dialog.tsx:364-374` | When embedding is unavailable the dialog still shows both instruction paragraphs ("Plak deze code in een artikel…", "De grafiek past zichzelf aan…") **above** "Insluiten is nu niet beschikbaar.", with no code anywhere — instructions for something that does not exist. | Hide the instructions in the `unavailable` state. | Chart → Insluiten with `EMBED_TOKEN_SECRET` unset (the harness). `p4-embed.png`. | Gate the two `<p>`s on `result !== 'unavailable'`, as the code block already is. |
| 11 | P3 | `web/components/chart-small-multiples.tsx:134` (`<XAxis tick={false}>`) | A small-multiples panel shows a region name and a shape and **no period at all** — neither axis is labelled under "Gelijke assen", so the panel never says which years it covers. | The panel states its span at least once (a caption, or first/last period under the grid). | Any multi-region answer → Kleine grafieken. `p4-sm-2reg.png`, `p4-sm-mobile.png`. | Add one shared "2020 – 2024" caption above the grid (a spec string, no new number). |

## Needs a design decision (do **not** auto-dispatch)

| # | Sev | Where | What I saw | Why it needs a call |
|---|-----|-------|-----------|---------------------|
| 12 | P2 | `src/answer/compose/format.ts:16` (`baseRegionLabel`) vs the chart/proof labels | The body strips the CBS qualifier while every other surface keeps it: the 6-region answer says *"**Utrecht** ging van 357.597 in 2020 naar 374.238 in 2024"* and *"'s-Gravenhage …"*, while the legend, proof table and CSV say "Utrecht (gemeente)" / "'s-Gravenhage (gemeente)". In a single sentence naming six places, a bare "Utrecht" is genuinely ambiguous between the gemeente (374k) and the provincie (~1.4M) — and ADR 055 makes exactly this sentence the product's new headline shape. | `baseRegionLabel` is deliberate and load-bearing: R9's region-mention check and `buildRegionSeriesLine` both key on it, and the R8 body re-derivation is byte-identical. Changing prose labels touches R1-scanned text and the audit re-derivation. Owner/product call. |
| 13 | P2 | `src/answer/compose/template.ts` (`renderRegionSeries`) | At 375 px the 6-region body is a **15-line run-on paragraph** of six identical `X ging van A in 2020 naar B in 2024 (gestegen);` clauses, each ending in a parenthesised participle. It is accurate and unreadable; the Tabel view beside it is excellent. | A list/line-per-region rendering (or a "…en 4 andere regio's" fold) is an answer-text change: R1 scanning, the R8 byte-identical body check and `copy-answer`/`replay-assemble` all consume `body` as one string. |
| 14 | P3 | `web/components/chart.tsx:515-531` | Every end-of-line label repeats the same period prefix — six copies of `2024: ` on one chart — which is most of the 87 px that squeezes the plot in row 2. | Dropping the prefix when every series ends at the same period is a small honesty question (the label stops being self-describing when a series ends early, exactly the partial case ADR 055 introduces). |
| 15 | P3 | Whole product, visible here | With the interface set to **EN** a `region_series` answer is 100 % Dutch (body, coverage line, follow-up chips, refusal) under English chrome ("Prove these numbers", "Suggested follow-up questions:"). | This is the CLAUDE.md convention working as written (backend text stays Dutch). Worth an explicit owner decision now that the EN toggle ships, not a bug to fix silently. |

## What works well

- **The partial case is exactly the design.** Amsterdam + **Eemsdelta** + Rotterdam 2020–2024 answers with
  two clauses, **no** Eemsdelta claim, and the muted coverage line right after the body: *"Voor Eemsdelta
  ontbreekt een cijfer in 1 van de 5 gevraagde jaren; daarom noemt dit antwoord geen ontwikkeling voor die
  regio."* The chart shows a **gap, not a guess** — measured, Eemsdelta's path starts at `M112.75` (2021)
  while the other two start at `M77` (2020) — and the Staaf view simply has no 2020 bar. Verified at 1280
  and 375.
- **Six series, six distinct colours**, measured: `#0072b2 #d55e00 #009e73 #cc79a7 #b8860b #3a8fc4` — ADR 055
  D6's "no repeat at 6" claim holds in the real render.
- **The proof panel names the region per step**: "Richting van de reeks **voor Amsterdam**: gestegen van 2020
  tot en met 2024; netto 58.541" and the same for Rotterdam. All 10 cells listed, each deep-linked.
- **No cross-region claim anywhere** (MS1): no superlative, no "harder gegroeid", and the chart card
  deliberately shows **no** stat number / trend headline on a multi-region spec — the single-region answer
  reached via the offer chip does, which proves the suppression is shape-scoped, not missing.
- Legend hide + highlight, the **Lezing** (alternate-reading) dropdown — it re-queries and redraws all three
  series *and keeps the gap* — the Tabel view (one column per region, all 10 values), CSV (`regio` +
  `regiocode` columns), Download menu, copy-answer (it carries `regionSeriesLine`), Insights and the Present
  stage all work on a multi-region line.
- **Small multiples is genuinely reachable now** (ADR 055's stated goal) and lays out correctly at 375 px
  (2 columns, region names legible).
- **Refusals are honest and free**: both the region-CLASS × range and the 7-region cases refuse with the
  re-worded disjunction, charge **0 credits**, the class case correctly offers **no** chip, and the
  over-cap case's chip round-trips to a real answer.
- **Console is clean** — 0 app errors/warnings across the whole session (only harness HMR socket noise).

## Could not reach, and why

- **Light theme.** The shared Playwright MCP browser applies Chromium's auto-dark to the page: with
  `html.light` and every computed background `lab(100 0 0)` the screenshot still paints dark cards. Every
  finding above is layout/DOM-measured, so none depends on theme — but **light mode was not verified** and
  should be re-checked with `scripts/dev-harness/shot.mjs` (which sets `colorScheme` on the context).
- **The `excluded` branch of the coverage line** (a region with no ROW at a requested period). No loaded
  table produces it naturally — I scanned all 848 regions of `03759ned`; every one has a row for all five
  years. Only the seeded `region-series-run.test.ts` case reaches it, so the "Over GM0344 zegt dit antwoord
  niets…" sentence and its bare-code naming are **unverified on screen**.
- **The embed snippet.** `EMBED_TOKEN_SECRET` is not in `scripts/dev-harness/env.sh`, so `createEmbedCode`
  returns `unavailable` and no code renders. Worth adding a dummy secret to the harness env so this surface
  is auditable at all (that is how row 10 was found).
- **Real-parser confirmation** — every turn used `!!intent` injection; ADR 055's own open live-benchmark
  gap ([#270](../open-questions.md)) is untouched by this pass.

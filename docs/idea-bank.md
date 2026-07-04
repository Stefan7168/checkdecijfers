# Idea bank — chart formats & chart-triggering (Phase 2+)

> **STATUS: idea bank, NOT queued work. Read this before treating anything here as a mandate.**
>
> This doc captures the **chart-format and chart-triggering** thinking from an owner-present brainstorm (session 18, 2026-07-04/05). It exists so nothing is forgotten — **not** as a build queue. Almost none of it is next.
>
> **Scope note (avoid duplication):** the *broader* UX / answer-quality / display ideas from the same brainstorm are already recorded as open-questions **[#78–#93](open-questions.md)** (citation-copy, "bewijs dit cijfer", stat card, revision-risk gauge, cost transparency, etc.), with the three owner rejections at **[#93](open-questions.md)**. This doc does **not** repeat those — it holds only the chart-specific material, which was a separate deep dive and isn't captured anywhere else.
>
> **What is actually next** lives in [STATUS.md](STATUS.md)'s "next up" line and [08-build-plan.md](08-build-plan.md): CSV export (#52), then the standing backlog. The material below is deliberately downstream of all of that.
>
> **The honest framing (owner + assistant agreed, session 18):** these chart formats are a great idea bank for when real usage tells us which visuals journalists actually want — a bad build queue today (8 tables, no paying users, website not finished). **A future session must re-prioritize with the owner and check [03-mvp-scope.md](03-mvp-scope.md) before building any of this**, per the phase-gate discipline in [CLAUDE.md](../CLAUDE.md).
>
> Everything here stays inside the hard architecture constraints: the LLM never computes or interprets numbers; chart type is chosen deterministically from the validated result's shape, never from words in the question; every visible number/derivation traces to a CBS cell or a registered derivation (invariants R1–R11, [05-data-rules.md](05-data-rules.md)).

---

## 1. Chart-triggering rules (design conclusions from the session-18 discussion)

These refine *when* a chart is drawn and how it degrades — all deterministic, count-based rules, never an AI judgment about whether data is "interesting enough."

- **Line chart: minimum 3 real (non-null, published) points.** A 2-point line is just a straight segment between two dots — its whole story (direction, delta) already lives in the sentence and the registered derivations. A shape only emerges at 3+ points. "Real" = only published, non-null cells count; a range requested from 1970 with data in only 2 years counts as 2.
- **Bar comparison: keep the current minimum of 2.** Two bars side by side is a standard, readable pattern (city A vs city B); a min-of-3 would kill a common, useful comparison.
- **Bar comparison upper bound → table fallback.** Above ~15–20 categories a bar chart is unreadable (342 gemeenten). Switch automatically to a sortable table instead of / alongside the chart — still a count-based rule.
- **Long-series label thinning.** For 600+ point monthly series ("inflatie sinds 1970"), keep every point present and pinpointable but show only every Nth x-axis label (e.g. year ticks) so the axis isn't an unreadable smear. Count-based, no judgment.
- **Manual "toon toch als grafiek" button.** The default stays strictly shape-based (never triggered by the word "grafiek" — that would sneak an implicit AI choice back in). But a user-initiated button to force a visual render even below the threshold (e.g. to share a 2-point change on social) returns control without breaking the default rule.
- **Honest note when a chart is withheld.** If someone explicitly asks for a chart but the result doesn't meet the threshold, state why in one deterministic sentence ("bij twee datapunten toon ik het verschil in tekst") — never silently ignore the request.

**Two genuinely new result shapes surfaced (both need query-layer work, not just a renderer):**

- **Distribution / breakdown.** One period + one region, split across a category (population by age band, bankruptcies by sector, workforce by sex). Not expressible today — every question maps to exactly one canonical measure (WP5/ADR 011). Recommend **bars per category, not a pie** (angle/area are read less accurately than bar length). This is the most common gap in what the app can currently answer.
- **Two measures side by side** (e.g. unemployment and bankruptcies over time). Owner-clarified (session 18): showing two correctly-measured, correctly-sourced series because the user asked is **not** a causal claim and should be allowed — what the journalist concludes is their job, not ours. The distinction to hold: a *causal question* ("does X cause Y?") stays refused (WP6 classification); *displaying two facts* does not. The accompanying **text** must never assert a relationship that isn't a registered derivation (principle a, unchanged). Care needed on honest axis scaling when the two measures have different units (percentage vs count) so the chart itself doesn't imply a link.

---

## 2. New chart FORMATS (deep-dive, session 18 — each with its deterministic honesty guardrail)

From a four-lens deep dive (social-shareability, Dutch/CBS domain, newsroom dataviz patterns, and a rigor guardian who paired every format with the hard rule that keeps it honest). Ranked roughly by shareability × feasibility. **"Nieuwe vorm nodig" = needs a new query/result shape or data not yet ingested.**

| Format | Past bij (loaded topics) | Nieuwe vorm? | Effort | Guardrail |
|---|---|---|---|---|
| **Bevolkingspiramide** — mannen links / vrouwen rechts, gespiegelde balken per 5-jaars leeftijdsband | Bevolking (03759ned) | **Ja** — needs the ingest slice widened from Geslacht=totaal/Leeftijd=totaal to real M/V × age-band cells | Groot | A strict 2-D cross-tab (age × sex); renderer refuses unless every band has exactly two cells (M+V) at the same period/region; missing band = visible gap with CBS reason (R11), never interpolated |
| **Ranglijst** — horizontal bars per gemeente/provincie, sorted descending, value at bar end, top/bottom highlighted, 4:5 portrait for feeds | Any region comparison (population, housing, prices, bankruptcies, income) | Nee | Middel | The headline claim ("Deze 10 gemeenten hebben de meeste X") and top/bottom highlight come only from the already-registered ranking derivation (R5/R9), never an LLM "what stands out"; ties shown explicitly |
| **Dumbbell — "toen vs. nu"** — two dots per category joined by a bar, delta as a middle badge, 1:1 square | Any measure with two comparable periods/regions (prices, income, population, unemployment) | Nee | Klein | The delta badge is a registered subtraction derivation (cell A − cell B, each with its own resultId), never recomputed in the renderer; both points same definition status or R11-marked. *(Distinct from the rejected "vergelijkingskaart" [#93](open-questions.md): this is a two-dot geometry, not a big-numbers card.)* |
| **"Sinds [jaar]"-indexlijn** — series rebased to base year = 100, thick line + area fill, big overlaid headline ("+34% sinds 2015") | Prices, CPI, income, solar — any long series; also 2+ series at different scales | Nee (new derivation, not new query) | Middel | Indexing (value/base × 100) is a **new registered R5 derivation**, never a renderer trick; the literal absolute base value + base year always shown, not just "100"; headline follows the R9 direction-word template |
| **Lollipop dot-plot** — one row per region, a dot at the value, ranked; lighter ranking variant for >8 categories | Any region comparison | Nee | Klein | Same R6 projection as the existing bar chart (each cell once, order/values unchanged); reuses the same resultId-per-marker binding and sort-order validation, not a separate untested draw path |
| **Diverging bar** — bars left/right of a shared reference line (e.g. national average), sorted by deviation | Unemployment/income per region vs average, inflation per category vs headline CPI | Nee | Klein | Bar length is a registered "difference-from-reference" derivation (cell − an explicitly named reference cell, both with resultId and their own status shown); if the reference is itself provisional, mark it (R11) |
| **Isotype pictogramraster** — repeated topic icons (huisje, poppetje, euromunt) partly filled to show a percentage ("1 op de 8 woningen na 2015") | Any single-percentage answer | Nee (second renderer on the planned waffle-grid shape) | Middel | Filled-icon count is an exact deterministic rounding of the source number by one fixed documented rule; that rule + the exact % always in the caption so "bijna 1 op de 8" never reads as "exact" |
| **Reeksonderbreking / trendbreuk-marker** — shaded vertical band on a line at a registered break (herindeling, definition change), sides shaded differently, caption naming the change | Population at herindelingen; any table with a registered definition change | Nee — **but blocked on [#26](open-questions.md)** | Middel | Break year + caption come only from a human-reviewed registry table (never an LLM guess about what a break is); must not be built until that registry table exists, or the band is unverifiable. Relates to the revision-awareness idea [#88](open-questions.md) |
| **Sparkline-KPI-kaart** — one large formatted headline number + a tiny axis-less, gridline-less sparkline of the last N periods | Any series (CPI, unemployment, income, solar) | Nee | Klein | No axis/gridline = no implied precision; headline is literally the same formatted value already in the ChartSpec (no separate rounding); each sparkline point stays resultId-bound so "prove this number" replays from the mini-card too |

**Also noted, cheap stylistic variants of existing types (no new shape):** horizontal bar orientation for long/many category labels (also helps the >15 overflow); area-fill under a line for stock/cumulative measures; a **waffle grid** for a single percentage (100 squares, N filled, "±1 op de X" — exact % always shown alongside).

### The six general guardrails (apply to every format above)

1. A new visual is never a new data path — always the same R6-validated ChartSpec, only drawn differently (each cell once, values/order unchanged, nulls-with-reason kept).
2. Every visible derived value (difference, index, deviation, rank) must be a registered R5 derivation with a visible "bewerking van CBS-gegevens" marking — a format is never a backdoor for unregistered arithmetic in the renderer.
3. Every headline/title sentence that "reads" the format for the viewer (ranking, growth, deviation claim) comes from a fixed template filling only registered direction/rank derivations (R9) — never free LLM prose beyond what was computed.
4. Attribution (table ID, title, sync date, period, CC BY line) is part of the ChartSpec itself (R4/R6) and must survive every downloadable/shareable crop — a format that drops the source line on export is an architecture bug, not a design choice.
5. Provisional figures (R11) and trend breaks stay visibly marked in every format, including compact ones (sparkline, dot-plot) — as a small icon+tooltip if need be, never dropped for lack of space.
6. Formats needing a NEW query shape or new data (pyramid, trend-break marker) may only be built after the required ingestion/registry widening is done and validated separately — the chart shape follows the data, never the reverse.

---

## 3. Chart-related rejection on record

- **A "spinner + live CBS fetch after OK" flow for missing topics** — rejected: contradicts ADR 003 (never a live CBS query in the answer path). The live-verified path for a not-yet-loaded topic is the async WP16 onboarding flow, not a few-seconds spinner. See [08-build-plan.md](08-build-plan.md) WP16 and [open-questions #24](open-questions.md).

*(The other session-18 rejections — watch-list, pattern/shape accessibility encoding, and the big-numbers comparison card — are recorded with the UX brainstorm at [open-questions #93](open-questions.md).)*

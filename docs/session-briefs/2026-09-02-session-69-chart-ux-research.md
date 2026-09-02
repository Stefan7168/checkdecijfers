# Chart/graphics UX research — session 69 (2026-09-02)

**Status: proposal only, awaiting owner go/no-go. Nothing built from this yet.**

Polished version (published as a Claude Artifact, may not survive an account switch —
this file is the durable copy): the session published it at publish time; ask a fresh
session to re-run the research workflow if the link is gone. This file is the source of
truth for the content either way.

Origin: owner request mid-session 69 — "research on how to improve the graphics (design
options for users, etc.)" with Fable 5.1 for architecture decisions. Built as a 5-agent
background Workflow (`chart-graphics-research`, run id `wf_93184bc9-c56`): four parallel
research passes (user value, architecture safety against R1/R6, accessibility/mobile,
competitive scan of CBS StatLine / Our World in Data / Eurostat / NOS) synthesized into
one proposal. Every citation below was independently re-verified against the repo by the
session before publishing (not taken on the agents' word) — one fabricated claim was
caught and removed, see the note in §0.

## 0. One claim caught and corrected

The synthesis pass claimed the six chart series colours were run through "a palette
validator" (`validate_palette.js`), scoring "CVD ΔE 7.1" and proposing four specific
replacement hex colours as tested-and-passing. **That script does not exist anywhere in
the repo** (`grep -rn "validate_palette\|CVD\|deltaE" --include="*.ts" --include="*.js"`,
zero hits) — dropped from this proposal as fabricated. What does hold up, independently
recomputed by hand from the real hex values in `app/globals.css`: the WCAG contrast
ratios in fact 2 below, exact to two decimals.

## 1. Five verified facts

1. **The web chart shows no numbers.** `web/components/chart.tsx:210,245` sets
   `tick={false}`, no value labels; values exist only in the hover tooltip. The server
   SVG renderer (`src/chart/render.ts:275,307`) already labels every point — this is a
   web-renderer gap, not a data gap.
2. **Six series colours, three near-identical.** `COLORS` (`chart.tsx:47-54`) reuses
   `--danger`/`--ok`/`--warn` as series colours. Recomputed WCAG contrast: danger-vs-ok
   **1.10:1**, ok-vs-warn **1.01:1**, danger-vs-warn **1.10:1** — all far under the 3:1
   minimum, and danger/ok (red/green) is also the pair deuteranopia/protanopia collapse
   by hue. Any 3+-region chart (a normal case) hits this by default (`COLORS[i %
   COLORS.length]`, `chart.tsx:77`).
3. **Changing what the chart-builder emits is never small.**
   `src/answer/audit/reconstruct.ts` re-runs `buildChartSpec` on every stored answer and
   diffs it; `known-divergences.ts` accepts only pinned per-row exceptions. Any change to
   builder output (axis ticks, a definition field, revision history) is a schema-v2 +
   versioned-builder job, not a styling tweak.
4. **A free accessibility feature was silently dropped.** Recharts 3.10.0 (installed)
   defaults `accessibilityLayer: true` (`node_modules/recharts/es6/chart/
   CartesianChart.js:24`) — keyboard-focusable, arrow-key point navigation, with the
   library's own tooltip announced via `role="status" aria-live="assertive"`
   (`DefaultTooltipContent.js:141-142`). `chart.tsx`'s custom `<ChartTooltip>`
   (lines 133-167) replaced that tooltip — necessarily, to show the honesty-contract
   `_display` field instead of Recharts' raw number — but the replacement carries no
   `role`/`aria-live` at all. Screen-reader users can still tab in and arrow through
   points; nothing is announced while they do.
5. **The PNG/SVG download shipped this session is the pattern to build on.** Several
   ideas below (hidden-series disclosure, comparison-chip exports) reuse
   `attributedSvgMarkup()` (`web/components/chart-download.tsx:33`) rather than
   inventing a new mechanism.

## 2. Eight ideas, ranked by user value

Classes: **A** = client-only (`web/` only, no stored/audit change) · **B** = new
ChartSpec schema version · **C** = new backend capability (chip through the existing
zero-LLM `ClickOption` take-path, a registered derivation, or a migration — costs credits
and/or writes audit rows).

| # | Idea | Class | Effort | Seam |
|---|---|---|---|---|
| 1 | **Numbers back on the chart** — labelled y-axis, end-of-line value label, legend key for "voorlopig", non-colour series encoding (dash patterns, hatch fill), tap-to-pin tooltip on mobile, real accessible name + `aria-live` on the tooltip. | A | S–M | `chart.tsx` — labels are spec strings (`formattedValue`/`periodLabel`) already bound to `resultId`; `chart.test.tsx:227/344` pass unchanged. |
| 2 | **"Tabel" view beside every chart** — period × series, value, CBS status, null reason; automatic fallback above ~15 series; pairs with the existing WP21 CSV export. | A | S | A second dumb renderer over the same spec (ADR 007 already names `table` in its vocabulary, never emitted). |
| 3 | **One-tap comparison chips** — "Vergelijk met Nederland/G4/[gemeente]", "Zelfde periode vorig jaar", "Sinds 2008". | C | M | A 5th generator in `src/answer/respond/suggestions.ts` (today: adjacentPeriod/trend/regionVariant/sameTopic, `MAX_SUGGESTIONS=3`), gated by `echoServability`, taken via the existing `templateOnly: true` path — zero LLM, real audit row, #158's routing rule verbatim. |
| 4 | **"Wat zie ik hier?"** — deterministic takeaway headline (from registered `direction`/`first_last` records) + an explainer panel (definition, period meaning, what "voorlopig" means). | A on chat (B for Ontdek/exports) | M | Template rung (`src/answer/compose/template.ts`); IS #89 (already approved) placed on the chart. |
| 5 | **"Bewijs dit punt" + revision history** — tap a point for its exact CBS cell, plus "herzien op 30-07: was 0,4%, nu 0,6%" sourced from the correction-diff log. Turns #193's finding (1,103 revised "Definitief" figures) into a trust feature. | C (read-only) | M | Needs a normalized `cell_corrections` lookup (today `ingestion_batches.corrections` is a per-batch jsonb array) → one migration + one read endpoint keyed on `resultId`, fetched on click, never emitted into the spec. |
| 6 | **Show/hide a series** with a visible "2 van 4 reeksen verborgen" indicator baked into PNG/SVG exports. | A | M | #46's 3 constraints (explicit indicator, client-only, deliberate export call); reuses `attributedSvgMarkup()`'s footer text seam. |
| 7 | **Reading toggles on chat charts** — level vs. % change, seizoengecorrigeerd vs. origineel — generalised from the Ontdek toggle. | C | M–L | Generalises `CuratedChartToggle.alternateSpec` (`src/chart/curated.ts`) via `Attribution.alternates`; many pairs need no new derivation (registry siblings already exist). |
| 8 | **Small multiples** with an explicit "gelijke assen / eigen assen" switch and synced hover — the honest alternative to a misleading shared/dual axis. | A | M | Layout-only over the same spec, one panel per series. |

**Parked, not shortlisted:** a map view ("Kaart") for gemeente-level comparisons — the
most natural lay question the product can't chart today, but large (region-set intents,
bulk-ingested year-versioned geometry, server-built class breaks). Re-raise if real
region-set demand shows up.

**Deliberately not proposed:** pie charts, dual y-axes, LLM-chosen chart types, curve
smoothing/interpolation, client-side moving averages/trend lines, client-side merging of
two answers, client-side date slicing — each is an R1/R5/R6 violation by construction or
recreates a refusal the builder already enforces (`build.ts` mixed-unit / differing-dims
/ gap-chart refusals).

## 3. Recommended build order (first three)

1. **Numbers + accessibility baseline (idea 1).** S–M, web-only, zero invariant risk —
   every chart, every surface, every phone. Bundle: y-axis labels, palette fix (drop
   `--danger/--ok/--warn` reuse, cap coloured series, add non-colour encoding),
   screen-reader name + live region, tap-to-pin on mobile, `chart-download.tsx`'s missing
   ARIA (`aria-expanded`/`haspopup`/`controls`, Escape/outside-click close, focus
   management, `role="alert"` on the failure text — the `delete-history-button.tsx`
   pattern already used elsewhere in this codebase), `chart-toggle.tsx`'s
   `aria-pressed`→`radiogroup` fix. Also: add a `schemaVersion` guard to `chart.tsx`
   (today it has none, unlike `render.ts:111-114`) as a prerequisite for any future
   schema-v2 work, and write the "when is an optional v1 field allowed" rule into ADR
   007/014's as-built notes (precedent: `annotations` landed as optional-v1 because the
   builder never emits it for old specs — that rule is applied but not written down
   anywhere yet).
2. **Tabel view + CSV in the download menu (idea 2).** S, web-only, zero data work.
3. **Comparison chips (idea 3).** M, the first genuinely new capability. Sequenced after
   1–2 (a 3-region chart needs labels/palette to read well; also blocked on the still-
   unconfirmed `CLARIFY_CLICK_ENABLED` live smoke test, since it reuses that take-path).

Ideas 4–5 are the chart-side realisation of the existing drill-through/#89/#70/#79/#88
cluster; ideas 6–8 are Phase-2 Studio slices per `03-mvp-scope.md`'s existing placement.

## 4. Owner decisions (condensed to the ones that change what gets built)

1. **Phase-gate pull-forward** — is 1–3 worth pulling ahead of the Phase-2 Studio window?
   (Leaning: yes for 1–3, leave 6–8 where they are.)
2. **Where a presentation preference lives** — per-device only (localStorage, zero
   backend) vs. an account setting (new `user_preferences` table, needed anyway for
   #158's style profile) vs. URL-encoded (natural once shareable answer pages exist).
   (Leaning: per-device now, promote later.)
3. **#46(c): does an exported image bake in a toggled/hidden-series view, or reset to
   canonical?** (Leaning: bake in — matches #170(3)'s "download can't drift from what was
   shown".)
4. **Price of a comparison chip** — full answer price (20 credits) vs. a cheaper
   `chart_edit` class, given it's zero-LLM. (Leaning: ship at 20 first, revisit with
   usage data.)
5. **Reading-toggle build scope** — on-demand chip vs. pre-built into every answer.
   (Leaning: chip; pre-build stays Ontdek-only, bounded.)
6. **Takeaway line: template-only or AI-phrased?** (Leaning: template-only — #158 already
   rules the AI doesn't decide what's noteworthy.)
7. **Palette: keep the validated neutral 4-colour cap, or swap in house colours?** Either
   way needs an honest contrast re-check before shipping — the specific replacement hex
   values in the original research were the fabricated part (§0), not just the script
   name.
8. **Revision history (idea 5) needs a migration** — owner-supervised live DDL, same as
   always.
9. **Which surface first** — chat (paying users) vs. Ontdek (public, bounded pre-built
   sets only, never a free picker on the anonymous route).
10. **Map view** — stay parked, or fund as the one deliberate big bet.

## Verification this research owes before anything is built from it

The full CLAUDE.md block (typecheck + suites + benchmark 14/14 + 6/6 + 0 fabricated, real
build, LOW `/code-review`) before any push. Step 1 additionally needs the palette
validator run recorded in the commit (once a real one exists — none does today, see §0)
and new a11y/version-guard tests. Step 3 needs the RUNBOOK's live chip-click smoke test
confirmed first (still outstanding as of session 69) and chip-generator tests
(unservable chips dropped by the dry-run; a taken chip yields a new audit row; no
national row → no compare chip).

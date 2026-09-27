# English chart texts — a display layer for English readers (ADR 058 phase 3, #332)

**Status:** BUILT session 135 (see ADR 058 "Phase 3 as built"). Owner GO 2026-09-27 (session 135) on: "show the chart's title, legend, axis dates, source line and notes in
English on the English interface, from the English names we already have; no AI call; the stored chart stays Dutch;
the AI-worded insights and journalist headline stay Dutch for now."

## Design

- **Stored `ChartSpec` is unchanged** (audit rows, embeds, exports for Dutch readers, the Dutch site). English is a
  DISPLAY COPY made at render time: `toEnglishChartSpec(spec: ChartSpec): ChartSpec` in `src/chart/english.ts` — pure,
  DB-free, deterministic, idempotent-safe (never applied twice), returns a NEW object (never mutates).
- What it translates (all from existing name tables in `src/registry/english-names.ts` and
  `src/answer/respond/english.ts`; nothing model-generated):
  - `title` (CBS measure title) → `translateMeasureTitle`; `unit` → `translateUnit`; `dimLabels` values → `translateDimLabel`.
  - `series[].label` (region/dimension names) → `translateRegion` / `translateDimLabel` — **`regionCode` and every id stay
    identical**; anything keyed on a label (co-pilot edits, hidden series, colours) must be checked and must keep working.
  - `points[].periodLabel` → `translatePeriodLabel`; `points[].formattedValue` → the SAME number in English notation via the
    answer path's notation swap (`toEnglishNumberToken` or equivalent) — never recomputed from `value`.
  - `provisionalNote`, `nullNotes`, `definitionLine`, `attributionLine` (`translateAttributionLine`),
    `attribution.trendHeadline`, and annotation labels: English siblings of the Dutch templates in `src/chart/build.ts` /
    `annotations.ts`, rebuilt from the structured spec where possible, else mapped from the exact Dutch template.
  - Anything with no deterministic English (an unknown name, AI-worded insights/journalist headline) stays Dutch.
- **Invariant:** the English copy carries exactly the same numbers (values, periods, counts) as the Dutch spec; only
  words and number notation change. Tests assert digit-multiset equality after normalising notation.
- **Web:** the CBS chart components (`web/components/chart.tsx` and whatever renders a CBS answer's chart, including
  alternates and the story stage) receive `toEnglishChartSpec(spec)` when the interface language is English. Own-data
  charts (`user-chart.tsx`) are the user's own labels — untouched. Embeds (public, no reader language) stay Dutch.
  PNG/PDF exports made by an English reader follow what is on screen if they render the displayed spec.

## Tasks

1. `src/chart/english.ts` + tests (every translated field; ids unchanged; numbers identical; no mutation; unknown names
   pass through).
2. Web wiring + tests (English interface shows English chart texts; Dutch unchanged; hidden series / co-pilot edits keep
   working on English charts).
3. Docs: ADR 058 phase-3 note, #332, STATUS.

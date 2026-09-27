# Shared charts match what the reader sees: design

**Session 136, 2026-09-27. Owner GO in chat on all three decisions below.** Picked by the owner as the next item while the
regional-statistics priority is blocked by the CBS outage ([open-questions #329](../../open-questions.md)). Closes
[#277](../../open-questions.md)(b) and [#278](../../open-questions.md), and the last leftover of [#324](../../open-questions.md) gap 3.

## What was measured before designing

- **English already works on share pages and downloads.** ADR 058 phase 3 (session 135) made `chartLang` drive the whole
  display layer, and `/embed/[token]?lang=en` sets `chartLang` through `x-embed-lang` → `LangProvider`. Checked by
  rendering a real stored answer (audit 264) locally with `?lang=en`. The only Dutch left: the bare dimension label
  `Totaal` (deliberately unmapped in `english-names.data.ts`, because CBS's own English differs per table), CBS's own Dutch
  table name inside the source line (a citation, kept verbatim on purpose), and the AI-worded journalist headline (a known
  ADR 058 limit).
- **Downloads (PNG/SVG/PDF) carry no title at all.** `chart-download.tsx` exports the chart SVG, an optional journalist
  headline and the source line. The title and the reader's caption render as DOM siblings outside `chartContainerRef`.
- **The public embed ignores the reader's edits.** `useChartEdits` is keyed off `!embedMode`. Real usage (read-only
  query, 2026-09-27): 2 CBS charts have ever been edited, both the owner's. The edits are style templates, chart form,
  one shaded period and one note. The owner also has a house style (`user_chart_styles`), which the embed does not apply.

## Decisions (owner, 2026-09-27)

1. **Build A–D:** (A) downloads get the title above the chart and the caption below it, for CBS and own-data charts;
   (B) the public embed shows the chart as the author styled it; (C) the numbers rule below; (D) fix the leftover
   English label.
2. **The embed follows the author's later edits.** The embed page reads the author's saved edit log on every request.
   No new table: the cheapest mechanism. Freezing the look at embed time would need a new table (rejected for now).
   Consequence, accepted: a later restyle also changes pages that already embed the chart.
3. **Notes stay private.** Personal notes and the typed labels on goal lines and shaded periods never go into a download
   or onto a public page (ADR 038 stands). The goal line and shaded band themselves still draw, as they already do in
   downloads.

## The numbers rule (C): principle (a) on public surfaces

A reader-typed title or caption is the reader's own words. In the app it shows unchecked, outside the chart image
(ADR 056's provenance split). **The moment it goes into a download or onto a public page, it sits next to "Source:
CBS"**, so it must not carry a number the chart doesn't show. Rule: a reader-typed title/caption goes out only when
`unplottedDigits` (`src/chart/copilot/text-guard.ts`, the co-pilot's existing digit guard) finds no offending digit run
against the spec actually shown. Both the Dutch spec and its English display form count, because the reader may have
typed either spelling. Otherwise:

- **title:** the standard (spec) title is used instead;
- **caption:** left out;
- **downloads:** the download menu shows one line saying so (nl + en);
- **embed:** silently (the anonymous visitor is not the author; the author sees the line on their own downloads).

**Own-data charts are exempt** (their numbers are the reader's own data, not a CBS claim). Their title/caption go into the
download as typed, the same as ADR 057's public own-data page already publishes author-written text.

The rule is applied to the spec the visitor actually sees: on a `?live=1` embed, that is the live re-run's spec, so a
title quoting a since-revised value falls back to the standard title.

## Design

### B. Embed replays the author's pruned edit log

- `web/app/embed/[token]/page.tsx` (server): after `finalSpec` is settled (frozen or live), load the author's log with
  `getOwnChartEdits(db, { kind: 'answer', id: auditId }, record.userId)` (null owner → no log), and the author's house
  style with `getUserChartStyle`. Both fail soft to "none".
- **Pruned on the server, before anything reaches the visitor's browser** (the ADR 057 P1 lesson). A new pure function
  `prunePublishedLog(log, spec)` in `web/lib/chart-publish.ts`:
  - `parseCommandLog` first (re-validates the schema); an unparseable log → no log;
  - drops `addNote`/`removeNote`, `setReading` (an embed republishes the primary answer; the embed dialog is already
    disabled while a reading is selected), and the own-data-only commands (`setInstruction`, `addDerivedOverlay`,
    `removeDerivedOverlay`, `setWholeReference`);
  - replaces the typed label of `addGoalLine`/`addEraShading` with a fixed digit-free placeholder (the lists that show
    these labels are already hidden in `embedMode`; the placeholder keeps `validateCommand`'s non-empty rule satisfied);
  - `setTitle`/`setCaption` whose text fails the numbers rule become `setTitle null`/`setCaption null`.
- `ChartView` gains `publishedLog?: ChartCommand[]` and `publishedStyle?: unknown` props, used only in `embedMode`. The
  log is replayed with the existing `replayLog(initialDocState(...), log, ctx)` into the initial history (commands that
  no longer validate, e.g. a zoom period missing from a live spec, drop out as they do today). `publishedStyle` is
  sanitised with `sanitizeOverrides` and used as the account-default base in place of the (anonymous) viewer's.
- **Precedence:** an explicit `?form=` in the embed URL (chosen in the embed dialog) still wins over the log's form.
- **Caption in `embedMode`:** a plain read-only `<p>` (today `captionNode` is `!embedMode`).
- The embed page's digit-honesty test gets a case with a reader title carrying an unplotted number → not rendered.

### A. Downloads include the title and the caption

- `chart-download.tsx`: `ChartDownloadMenu` gains `titleText` and `captionText` props, drawn into the attributed clone
  the same way the headline already is (wrapped, measured). Order top to bottom: headline (if any), title, chart,
  caption, source line. The transparent "chart only" PNG stays bare (ADR 053).
- `chart.tsx` passes the title (reader's if it passes the numbers rule, otherwise the spec title, in `chartLang`) and the
  caption (only if it passes), plus a flag that drives the one-line notice in the menu.
- `user-chart.tsx` passes its own title and caption as typed.
- The existing R6 export scan tests (every digit in the exported SVG traces to the spec) get a case with a title and a
  caption in the export.

### D. English leftover

- `src/chart/english.ts` only (the chart display layer, NOT `english-names.data.ts`, whose glossary feeds the answer
  translator's prompt; changing it would shift recorded LLM fixtures): a bare `Totaal` dimension label shows as `Total`.
  A literal translation, correct for every dimension; CBS's per-table wording ("Total sex") stays unused.

## Invariants at stake

- **R1/R6/R11 (every digit on a public surface traces to a cell):** held by the numbers rule, checked against the
  rendered spec; tests on both the embed page and the export.
- **Privacy:** notes and typed labels never leave the server for an embed; the log is pruned before serialisation.
- **No AI call, no schema change, no env flag.** `chart_edits` and `user_chart_styles` are only read.
- Deleting/redacting the answer still kills the embed (unchanged: `isRedacted` check first).

## Implementation tasks

1. D: `Totaal` → `Total` in `toEnglishChartSpec` + test.
2. `web/lib/chart-publish.ts`: `publishableText(text, specs)` + `prunePublishedLog(log, spec)` + unit tests.
3. B: embed page loads + prunes the log and style; `ChartView` `publishedLog`/`publishedStyle` + embed caption;
   embed page tests.
4. A: export title/caption in `chart-download.tsx`, wired from `chart.tsx` (guarded) and `user-chart.tsx`; notice line
   (nl/en); export tests.
5. Docs: ADR 056/041 as-built notes, open-questions #277/#278/#324 rows, STATUS.

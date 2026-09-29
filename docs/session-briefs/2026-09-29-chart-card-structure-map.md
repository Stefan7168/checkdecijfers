# Chart card structure map — for WP-LOOK part (a) (session 141, 2026-09-29)

A read-only map of `web/components/chart.tsx` (4,847 lines) and `web/components/chart-edit-modal.tsx`, produced by a cheap-tier agent from grep + partial reads; line numbers are as of `main` at 7f55cfae. Use it to plan which nodes move into the Edit popup. Verify a line before editing it.

Line numbers are from `web/components/chart.tsx` unless noted. Findings come from grep and partial reads, so the outline is complete for structure but not for every prop.

## Overall structure
- `ChartView` is defined at L397 with the Props destructure at L397–410 and the inline type at L411–503.
- The lazy imports are at L244–270. `ChartEditModal`, `ChartConfigPanel`, `ChartStoryStage`, `ChartNotes`, `ChartGoalLine` and `ChartEraShading` are `next/dynamic`. `ChartConfigTrigger`, `ChartStoryTrigger`, `ChartDownloadMenu`, `ChartEmbedButton`, `ChartCopilotInput`, `ChartHistoryActions` and `SourceBadge` are static imports.
- **Early returns**
  - L1533: schema-refusal branch when `spec.schemaVersion !== 1`, a small card with title, warning text and attribution.
  - L3417: the main return, which ends at L4845.
  - There is no separate table render branch. Table and heatmap are branches of `canvasNode`.
- **Command dispatch**
  - `dispatchCommand(cmd, 'canvas' | 'panel', opts?)` comes from a reducer hook, with `undo`, `redo`, `seal` and `replace`.
  - A few writes use `dispatchRaw`, such as the `initialFormOverride` apply at L654.
  - `setForm` is fired via `selectForm` at L2026.
- **Panel state**
  - `openPanel` (L823) is one of `'style' | 'story' | 'embed' | null`.
  - Derived: `styleOpen` (L824), `embedOpen` (L849), `storyOpen = openPanel==='story' && storyAvailable` (L2237).
  - Other gates: `inStage = stage !== undefined` (L~510), `tabularForm` (L1290), `wholeForm` (L1236), `zoomAvailable` (L1113), `smallMultiplesAvailable` (L1323), `copilotAvailable = editsKey !== null` (L3415).
  - `storyAvailable` is `!tabularForm && !(smallMultiples && smallMultiplesAvailable) && storySteps.length >= 1` (L1512).

## Lifted nodes (the "one live instance" mechanism)
Four nodes are lifted into consts before the return.
- `canvasNode` (L2521–~3278)
  - Heatmap branch: `HeatmapGrid` in a tabpanel.
  - Table branch: `<table>`.
  - Otherwise: `ChartFrame` (L2567) containing Recharts `ResponsiveContainer` (L2641). `chartContainerRef` wraps it, and it is the export source.
- `legendNode` (L3280): gated on `legendVisible && seriesMeta.length>1`. `legendVisible` (L3279) is `!tabularForm || (wholeFormWanted && hiddenKeys.size>0)`. It renders `StageLegend` in stage mode, otherwise `SeriesLegend`.
  - `toggleSeries` fires on `'canvas'` (L3290).
  - `setDimmed` fires on `'panel'` (L3292).
  - `setHighlight` fires on `'canvas'` (L3294).
- `captionNode` (L3318): a read-only `<p>` in embedMode. Otherwise (`!inStage`) it renders an editable caption, and `setCaption` fires on `'canvas'` (L3335).
- `notesNode` (L3343): gated on `!tabularForm && !embedMode && !inStage`. It holds `ChartNotes` (L3348) and `ChartGoalLine` (L3384), and both are wrapped in `tabIndex=-1` divs for co-pilot focus.
  - `addNote` and `removeNote` fire on `'canvas'` (L3359, L3363).
  - `setHeadlineOverride` fires on `'canvas'` (L3366, L3377).
  - `addGoalLine` and `removeGoalLine` fire on `'panel'` (L3388–3389).
- `eraShadingNode` (L3396): same gate as `notesNode`. `addEraShading` and `removeEraShading` fire on `'canvas'` (L3404, L3406).

Placement is XOR per render, so there is one live instance.
- **Dock slot**
  - Canvas: `!styleOpen && !embedOpen ? canvasNode` (L4269).
  - Legend: same gate (L4576).
  - Caption, notes, era shading: `!styleOpen ?` (L4701, L4702, L4709).
- **Style modal:** `ChartEditModal` (L4344) has `chartSlot={<>canvasNode legendNode captionNode notesNode eraShadingNode</>}` (L4356).
- **Embed modal:** `ChartEmbedButton`'s `chartSlot` is `canvasNode + legendNode` (L4561, L4810).
- **Modal shell:** `chart-edit-modal.tsx` (98 lines)
  - It takes `open, onClose, title, closeLabel?, chartSlot, children`.
  - It returns `null` when `!open`. Otherwise it renders Base UI `Dialog`/`DialogContent` with `aria-modal`.
  - Layout is a grid with `DialogTitle` spanning both columns, `chartSlot` in a left `div`, and `children` in a right `div`.
  - Wide layout (`lg`) is `grid-cols-[minmax(0,1fr)_22rem]`. Below `lg` it stacks.
  - `ChartEditModal` does not reorder the DOM and does not manage initial focus. `ChartConfigPanel` focuses its own tab on mount.

## Main render outline (L3417–4845)
- **L3417–3431: root div.** It uses `frameClass` (no card when `frameless || inStage`), `tabIndex=-1`, and `onKeyDown=onHistoryKeyDown` for undo/redo shortcuts.
- **L3439–3618: header row.**
  - Left, L3440–~3555: editable title (`titleEditing` input or heading with Pencil button `startTitleEdit` at ~L3514), then the subtitle with unit and measure name (~L3526+).
  - Right wrapper, L3563–3617, gated `!embedMode && !inStage`:
    - `ChartHistoryActions` (undo, redo, history). It is locked while `storyOpen`.
    - L3575 `data-slot="chart-card-actions"`, gated `storyAvailable || !tabularForm`:
      - `ChartStoryTrigger` (L3580), the "Insights" button, gated `storyAvailable`.
      - `ChartConfigTrigger` compact (L3594), the Style icon, gated `!tabularForm`.
      - A headline Suggest/Edit `Button` (L~3606), gated `embed?.auditId !== undefined && findings.length>0`.
- **L3620–3665: journalist headline.** The editor (`headlineEditing`) is at L3624, the read-only headline at L3653 (`data-testid="chart-headline-text"`), and an error alert at L3662.
- **L3675: headline figure.** The big number, gated `headline!==null && value!=='' && !inStage && !tabularForm`.
- **L3705: trend sentence.** The active reading's `trendHeadline`, gated `!inStage && !tabularForm && !state.periodRange`.
- **L3727–4218: controls row.** `data-slot="chart-controls"`, gated `!embedMode && !inStage`.
  - L3730: form tablist `role="tablist"`. Each tab has `data-command-kind="setForm"` and calls `selectForm`. The tabs are Line, Area, Bar, HBar, Table, Dumbbell, Slope, Heatmap, Pie, Stacked, Stacked100 (L3735–3910). Disabled tabs have `sr-only` reason spans (L3915+).
  - L3964–4000: reading select, when `alternates.length>0`. It fires `setReading` on `'panel'` (L3987).
  - L4030–4100: period from/to selects, when `zoomAvailable`. The `dispatchCommand` calls at L4049 and L4082 are the range/zoom commands, and I did not identify their kinds.
  - L4103–4215: derived overlays (average and difference), gated `embed!==undefined` plus form gating. Add controls are line/area only. The remove chip stays on every form and fires `removeDerivedOverlay` on `'panel'` (L4197). The other dispatch at L4177 is an add, and I did not identify its kind.
- **L4236: embed-mode reading select.** `data-slot="chart-controls-embed"`, gated `embedMode && !inStage && alternates.length>0`. It fires `setReading` (L4248).
- **L4269: `canvasNode` dock slot.**
- **L4273: `ChartStoryPanel` (the Insights panel).** It is inline, gated `!inStage && storyAvailable`, with the open state from `storyOpen`. It is fed `steps`, `index`, `onPresent=openStage` and `insightsUnauthenticated`.
- **L4300: `ChartStoryStage` (full-screen portal).** Gated `storyAvailable && !inStage`.
- **L4323: `sr-only` story lock span.** Gated `!inStage && storyOpen`.
- **L4343–4571: `ChartEditModal` mount.** Gated `!inStage && !tabularForm`.
  - Props: `open=styleOpen`, and `onClose` closes it and refocuses the style trigger.
  - Children:
    - `ChartConfigPanel` (L4366), keyed by `chartEpoch`. Command sites: `setPresentation` (L4405, with `transient`), `applyTemplate` (L4425), `resetPresentation` (L4431).
    - A footer row (L4532) with `ChartDownloadMenu` and `ChartEmbedButton` (L4552). It is gated `!(smallMultiples && smallMultiplesAvailable) && !embedMode && !inStage`.
- **L4576: legend slot.** Gated `!styleOpen && !embedOpen`.
- **L4580: zoom disclosure.** A `<p>`, shown when `zoomDisclosure` is set.
- **L4581–4614: small-multiples row.** Toggle `setSmallMultiples` plus a shared/own axes group. Gated `!tabularForm && smallMultiplesAvailable && !embedMode && !inStage`.
- **L4633–4670: notes prose.** Warning notes for `wholeForm`, `provisionalNote` and `nullNotes`.
- **L4680: definition line.** `definitionLine`, gated `!inStage`.
- **L4685: event markers.** `markers.map`.
- **L4701–4709: caption, notes (with goal-lines box), era-shading (period ranges box).** All gated `!styleOpen`.
- **L4718: `ChartCopilotInput`.** Gated `copilotAvailable`.
  - It stays mounted but disabled in table form or while the story is open. The reason is given via `disabledReasonId` and the `sr-only` span at L4737.
  - It calls the `sendToCopilot` handler. That handler does not dispatch a single command kind; it applies the reply's commands.
- **L4747–4818: source row.**
  - Attribution paragraph (L4748) and `SourceBadge` (L4753, the sync badge).
  - `data-slot="chart-footer-actions"` (L4783) holds `ChartDownloadMenu` and `ChartEmbedButton`. Gated `!tabularForm && !(smallMultiples && smallMultiplesAvailable) && !embedMode && !inStage`. `ChartEmbedButton` is also gated `embed`.
- **L4821: embed footer.** `embedFooter` text plus a `target=_blank` link to `APP_URL`, gated `embedMode && embedFooter`.

## ChartConfigPanel (Style)
`chart-config-panel.tsx` is 1951 lines. `TabKey` is `'templates' | 'chart' | 'colors' | 'font' | 'frame'` (L188), with a roving-tabindex tablist (L1217).
- **Tab bodies:** templates (L1326, gated on `applicable.has('grid')`), chart (L1380), colors (L1495), font (L1637), frame (L1684, gated on `applicable.has('frameBackground')`).
- **Chart tab contents:** option radio groups plus toggles for axisLines, valueLabels, zeroBaseline, areaFill and pieHole (L474–482).
- **Other elements:** a language select in the tab row and a block at L1890 that renders on the chart tab. The account and Merkkleuren blocks are gated in `chart.tsx` on `signedIn`, and `onBrandApplied` is wired at ~L4410.
- **Applicability:** controls outside `resolved.applicable` are not rendered. Controls in `resolved.locks` are disabled with an `aria-describedby` reason.

## Satellite components
- **`ChartDownloadMenu`** (`chart-download.tsx` L982)
  - A disclosure menu with `menuitem`s for PNG, SVG, PDF and transparent PNG.
  - It serializes the live SVG from `containerRef` at click time, inlines computed paint, and bakes in the attribution, `headlineText`, `titleText` and `captionText`.
  - It applies `frame`/`frameImage` and shows `chart.download.failed` on error.
- **`ChartEmbedButton`** (`chart-embed-dialog.tsx` L167)
  - The trigger calls `onOpenChange`. It is `disabled` with a reason when a non-primary reading is selected.
  - Its dialog mounts inside `ChartEditModal` with the `chartSlot` above.
  - The dialog offers an embed language (radio nl/en), a colour scheme (light/dark/auto), and a chart type (as-shown/default). It calls `createEmbedCode` for a signed token.
  - The generated code is an `<iframe src=APP_URL/embed/<token>?…>` at `EMBED_DEFAULT_HEIGHT_PX` 680, plus an auto-resize script (`buildEmbedResizeScript`).
  - `APP_URL` is `NEXT_PUBLIC_APP_URL` or `https://checkdecijfers.nl`.
- **`ChartStoryTrigger`** (`chart-story-trigger.tsx`, 49 lines)
  - A 2px gradient-ringed ghost button with a wand icon. It is the "Insights" trigger.
  - Props: `open`, `onToggle`, `controlsId`, `triggerId`, `lang`.
  - It is split from `chart-story.tsx` so the panel and stage can be lazy-loaded.

## ChartView Props (L411–503)
- `spec`: the chart spec (required).
- `alternates`: `{label, spec}[]`, alternate readings that drive the reading select. Default `[]`.
- `frameless`: drop the card frame when the mount is already a card. Default `false`.
- `embed`: `{auditId}`; enables Embed and headline features.
- `embedMode`: true only for the public `/embed/[token]` render. It strips the controls and Download/Embed. Default `false`.
- `embedFooter`: the embed page's footer sentence. Ignored unless `embedMode`.
- `headlineText`: a server-resolved headline. `undefined` means fetch lazily, `null` means none exists.
- `initialFormOverride`: one-shot initial `ChartForm` from the embed route, applied only if the form is allowed.
- `stage`: `ChartStageMode`; when set (`inStage`) it strips all chat chrome.
- `initialPresentation`: `PresentationOverrides` applied at mount.
- `initialPanel`: `'story'`; auto-opens the Insights panel once when `storyAvailable` (L2357).
- `onAskFollowUp`: callback into the co-pilot input's follow-up chip.
- `extendsPrevious`: boolean, declared at L497–502. I did not read its docs, so its exact effect is unconfirmed.
- `publishedLog`: `ChartCommand[]`, a saved command log to replay.
- `publishedStyle`: `PresentationOverrides | null`, the saved style. The last three props (`initialPresentation`, `publishedLog`, `publishedStyle`) I inferred from names and types only.

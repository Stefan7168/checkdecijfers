# ADR 056 — Chart co-pilot: one command log, two doorways, two trust tiers

**Status:** accepted 2026-09-18 (session 111, owner present in chat; decisions recorded in
[open-questions #212](../open-questions.md) and #274); **phase 1 BUILT 2026-09-18 (session 112,
merged fast-forward to `main` `7a9b737..3c295f1`, CI run 35306079885 green incl. deploy, live on production the same day)**. Spec:
[superpowers/specs/2026-09-17-chart-copilot-design.md](../superpowers/specs/2026-09-17-chart-copilot-design.md).
Research that shaped it: [session-briefs/2026-09-17-competitor-g-deep-dive.md](../session-briefs/2026-09-17-competitor-g-deep-dive.md).

## Context

Since session 89 (ADR 038) a shown chart can be adjusted with on-screen controls only (form switch,
zoom, hide/highlight, notes; since session 91 the style panel, templates, colours, fonts; later the
headline, insights, story stage). Chat-driven editing of a CBS chart was designed in session 88 and
deliberately parked ("no LLM instruction schema in v1; build it only on usage evidence"). The own-data
tier (ADR 037) has a narrow chat path — column/filter/line-or-bar selection with a refinement
referent — behind a flag that is unset in every environment.

On 2026-09-17 the owner made chart quality, and specifically **editing charts by chatting, interleaved
with the direct controls**, the top priority, and lifted the session-88 parking: there are no users yet
to produce the usage evidence it waited for. A hands-on study of the closest competitor the same day
showed what a chat co-pilot gets wrong when bolted on: its AI could not reach styling or annotations
("I can't change the line thickness directly"), each AI step was stateless (a later prompt dropped an
earlier filter and un-hid series), and its undo existed only per chat message and lost the title.

Constraints that bind every option: R1/R6/R11 for CBS/Eurostat charts (numbers never pass through the
model; the renderer never computes or omits; provisional marks stay), ADR 037's structural tier
separation for own data, ADR 032 (web findings never become chart data), and the cheapest-mechanism
rule (no LLM/DDL/cost until it earns its place).

## Decision

1. **One state, one log.** Every edit to a chart — from a panel control, a canvas gesture, or a chat
   reply — is a small serialisable command applied to the same client view-state, with `apply` and
   `invert`, on one undo/redo history (one gesture = one entry). The panel is a view over that state,
   so whatever the chat did is visible in the panel afterwards and vice versa.
2. **Two doorways, one vocabulary.** The chat may only emit values the panel already offers for THIS
   chart: the request carries a generated `capabilities` list (applicable presentation keys and values,
   series, period bounds, allowed forms, templates; own-data only: the column profile), the model
   returns a command list constrained by a JSON schema built from it, and deterministic code validates
   every command against the live state before dispatch. The reply is a **recipe**: chips with the
   panel's own icons, one plain sentence per refused item naming the click path. No chat-only
   capability may exist (a contract test enforces it).
3. **Two trust tiers, one surface.** Own data: everything, including aggregate and a fixed set of
   derived columns (difference, share of total, percent change, ratio; owner decision 2026-09-18),
   computed by our executor, never by the model. CBS/Eurostat: selection only; "add another region" is
   a new question through the existing follow-up path, shown as an extension of the same card when
   compatible. Internet findings are not chart data, so there is no third tier.
4. **Persistence in the account from phase 1** (owner decision 2026-09-18, overriding the per-visit-first
   recommendation): a `chart_edits` table holds the command log per (user, chart), numbered migration
   applied supervised, retention under the monthly GDPR purge.
5. **Chart-fit is rule-based.** A deterministic scorer ranks forms with visible reasons and is the
   honesty gate for pie/stacked forms (disqualified unless the parts are a complete whole). No model.
6. **Narrate is the one text the model writes** (headline/caption on request); every digit in it must
   be a plotted value (the existing digit scan).
7. **Input label:** "Pas deze grafiek aan" / "Adjust this chart", with three deterministic example chips.

## Alternatives considered

- **Build on the competitor's SDK** (grammar-of-graphics engine with a command system and AI agents).
  Rejected: closed source under a licence that flips to "contact us" past a size threshold; its engine
  computes inside the chart (stats, stacking), which is hard to reconcile with R6 through code we cannot
  read; a beta dependency at the core of the product.
- **Chat-only editing** (the "AI-native" route). Rejected: the owner explicitly wants both doorways
  interleaved, and the competitor's own designer wrote that clicking beats typing "switch to a heatmap";
  a chat-only path also makes every edit a paid call.
- **Panel-only, keep #212 parked** (the session-88 decision). Superseded by the owner: the evidence it
  waited for cannot arrive before launch, and the feature is now the differentiating UX.
- **Stateless config-in/config-out per AI turn** (the competitor's mechanism). Rejected on the hands-on
  evidence: it loses earlier edits; we apply diffs on the current state instead.
- **Per-visit state first, persistence later.** Recommended by the session, overridden by the owner
  (decision 4) — recorded as such.

## Consequences

- Phase 1 needs no model and no prompt bytes; phases 2–3 add one cheap-tier call per chat edit and one
  new route; phase 1 adds one table and one supervised migration.
- The style panel (#218) and the own-data instruction schema (ADR 037) both change shape: dispatch
  becomes commands; `unsupported.reason: 'aggregation' | 'computation'` disappears.
- Benchmark and audit are untouched: chart edits never write audit rows and never change the answer's
  numbers.

## As built — phase 1 (session 112)

Built via subagent-driven development, 7 tasks + a Task-8 docs pass, each task independently
reviewed (the ledger: `.superpowers/sdd/2026-09-18-chart-copilot-phase1/progress.md`). Panel-only
and canvas-only doorways so far — the chat doorway (phases 2–3) is not built.

**Files:** `web/lib/chart-commands.ts` (the command vocabulary and its `apply`/`invert`/`validate`
functions), `web/lib/chart-history.ts` (past/future undo stacks, transient-merge + seal,
`HISTORY_CAP` 200 entries, `replayLog`, `serializeHistory`), `web/lib/use-chart-history.ts` (the
hook; `dispatchRaw` bypasses the history entirely), `web/components/chart.tsx` (every panel/canvas
control now dispatches a command; Undo/Redo buttons plus ⌘Z/⇧⌘Z/Ctrl+Z/Ctrl+Y on the card; the
history menu; in-place title and caption editing; hydrate-on-open and 800&nbsp;ms debounced save of
the log), `web/components/chart-history-menu.tsx` (the edit-history popover, click an entry to
undo/redo to it), `web/components/chart-config-panel.tsx` (colour pickers report
`meta.transient`/`onSeal`), `web/components/chart-notes.tsx`, `web/lib/i18n/messages.ts` (new
`chart.history.*`/`chart.command.*`/`chart.title.*`/`chart.caption.*` keys, nl + en),
`migrations/034_chart_edits.sql` (file-only, not applied — see RUNBOOK), `src/chart/edits-store.ts`
(the store), `src/answer/audit/retention.ts` (the `headlineDelete` hard-delete pattern generalised
to a `hardDeletes[]` array with a `chart_edits` leg added at all three call sites),
`web/app/chart-edits-actions.ts` (the `fetchChartEdits`/`saveChartEdits` server actions),
`web/e2e/chart-copilot.spec.ts` (Playwright: hide a series → Undo → Redo → keyboard shortcuts →
reload → still hidden).

**Two inverse-only command kinds.** `setSeriesView` (restores the whole hidden-set + highlight
together) and `replacePresentation` (restores the whole presentation object) never come from a
doorway directly — they exist only as what `invertCommand` returns for `toggleSeries`/
`setHighlight` and for `setPresentation`/`resetPresentation`/`applyTemplate` respectively, so an
undo of "hide series X while Y was already hidden" or "apply a template" restores the exact prior
state in one step rather than replaying a diff.

**Transient/seal contract.** A drag-style control (the native colour picker) reports intermediate
values with `meta.transient: true`; the history merges consecutive transient entries from the same
control into one open entry instead of one-entry-per-pixel, and the control calls `onSeal()` on
blur/mouseup to close it into a normal undoable entry. `serializeHistory` drops an unsealed
transient entry entirely, so a colour drag that never finishes never gets saved.

**What bypasses history via `dispatchRaw`.** A spec swap (a new question/reset), the Story stage
entering/advancing/leaving, and the embed page's `?form=` seed all replace state directly — none of
these are a reader's own undoable gesture, and the Story stage additionally locks the history
controls themselves out (an Important-severity finding from the Task 3 review: without the lock, a
reader's ⌘Z during a story step could silently step through the underlying doc history instead of
the story).

**Persistence mechanism + limits.** One row per (audit answer, user) in `chart_edits`, written by
`saveChartEdits` 800&nbsp;ms after the history stops changing (`CHART_EDITS_SAVE_DEBOUNCE_MS` in
`chart.tsx`), and only when the card is signed-in, not in embed mode, not in the Story stage, and
has a real audit id. A pending debounced save is flushed (not lost) on unmount and on a chart swap
(`pendingSaveRef` + `flushPendingSave`, fix round 1, commit `1a8fc97`) — an edit made in the last
800&nbsp;ms before a reader navigates away still gets written. A dock tab switch also never writes
an empty log over another chart's row: `lastSavedEditsRef` resets to `'[]'` on every `editsKey`
change (same fix round), so the save effect's "unchanged, skip" check can't compare a new chart's
history against a previous chart's leftover baseline. The redo stack is never persisted (only
`past`, via `serializeHistory`); a command that fails
`validateCommand` at replay is silently dropped from the *restored* history but stays in the
*stored* row until the reader's next edit overwrites it. The journalist headline
(`chart_headlines`, AI-drafted) is a separate flow and is deliberately not on this undo history.
The public `/embed/[token]` page does not read `chart_edits` yet — a title/caption/hidden-series
edit made signed-in is invisible on that chart's public embed (phase-3 candidate, see
open-questions #274 addendum below). Exports (PNG/SVG/PDF) never include the reader's title,
caption, or notes — all three render as DOM siblings outside the export container, the same
by-construction pattern ADR 038 already used for notes (R6 needs no new exemption).

**Ledger rulings that changed the plan text:**
- `removeNote`'s parameter renamed `id` → `noteId` (Task 1): the envelope's own command `id` field
  collided with a same-named field on the command itself under the discriminated-union
  intersection type.
- `meta.transient` became an explicit flag passed by the colour-picker call sites (Task 3),
  replacing the plan's original key-based transient-detection rule.
- The edit-history popover closes on click like every other menu in the app (Task 4 fix round 1) —
  a first pass had left it open (`closeOnClick=false`), reviewed as a deviation from house menu
  behaviour.
- The chart card gets `tabIndex={-1}` (Task 7 fix round 1, commit `1a8fc97`) so it is itself
  click-focusable, meaning ⌘Z/⌘⇧Z work after any click inside the card, not only after focusing a
  specific button.

## As built — phase 2, the own-data co-pilot (session 113, 2026-09-18)

Built via subagent-driven development from
[superpowers/plans/2026-09-18-chart-copilot-phase2.md](../superpowers/plans/2026-09-18-chart-copilot-phase2.md)
(nine tasks, one implementer + one reviewer per task, every task with a fix round where the reviewer
found something real — see the plan's ledger rulings in the status archive). In plain words: on a
chart drawn from a reader's OWN uploaded file, the reader can now change the data itself (which
columns, filters, series, sort, top-N, **a total/average/min/max/count per group, and one of four
derived readings: difference, share of total, change versus the previous point, ratio of two
columns**), the chart form, the style, notes and the title/caption — by clicking controls OR by typing
under the chart — and every one of those edits sits on the same undo history phase 1 built, saved
per account.

**The shared card shell is hooks and small components, not a JSX extraction.** `ChartView`
(CBS data, ~4,600 lines) and `UserChartView` (own data) stay two components over two spec types —
the ADR 037 D11 type guard is untouched: a `UserChartSpec` still cannot parse as a `ChartSpec`, and
`ChartView` never receives one. What both cards now compose from shared modules: `useChartEdits`
(`web/lib/use-chart-edits.ts`, the hydrate/save block lifted out of `chart.tsx` with every phase-1
review rule intact), `ChartHistoryActions` (Undo/Redo/History), `ChartEditableText` (the in-place
caption/title editor), `ChartSeriesLegend` (hide/highlight), and — new — `ChartCopilotInput` (the
chat doorway) and `ChartDataPanel` (the data doorway). `chart.tsx` shrank by ~250 lines and its
behaviour is pinned unchanged by the phase-1 suites and the phase-1 Playwright proof.

**A data change is a command.** The instruction the model selects (schema v2:
`aggregate`, `derived`, `sort.by: 'value'`, `CHART_INSTRUCTION_SCHEMA_VERSION = 2`,
`DATASET_INSTRUCT_PROMPT_VERSION = 2`) lives in the card's document state; changing it is a
`setInstruction` command like any other, so it undoes/redoes with the rest. Its validation
(`validateCommand`) runs the server's own `validateInstructionObject` against the dataset profile the
card carries — and is `false` without a profile, which is how the type guard reaches the command
log: a CBS card can never validate an own-data command, and `setPeriodRange` (zoom) is never valid
on an own-data card. The chart for an instruction comes from a **free, deterministic** server
action, `renderDatasetInstruction` (no credit reserve, the D12 CSV-ingest precedent), cached per
instruction in the card so undo/redo never re-fetch; on hydrate the card pre-renders every stored
instruction before replaying the log, and the replay validates each command against the spec that
was on screen *before* it (a Task 5 review finding: without that, every view/note edit made after a
stored data command was silently dropped and then persisted away).

**Persistence keyed by the turn.** `chart_edits` gained a second, mutually exclusive key
(`dataset_turn_id`, migration 035 — FILE-ONLY, applied together with 034; the store picks its
`ON CONFLICT` target from the live schema so the answer leg keeps working before 035 is applied);
own-data edits are deleted with their dataset (retention leg in `src/attachments/retention.ts`).

**The chat doorway.** `adjustDatasetChart` (`web/app/dataset-copilot-actions.ts`) runs through the
same credit gate as a question (`dataset_turn`, 20 credits) and one cheap-tier call
(`src/attachments/copilot/`: schema, prompt v1, parse, `map.ts`, `text-guard.ts`, `respond.ts`).
The model returns a FULL instruction (or null when the data stays) plus view commands that name
series by LABEL; deterministic code executes the instruction first and then maps every view command
by lookup against the chart it just drew (label → `s<i>` key, note point → `rowRef`), allowlists
template ids, hex colours and font names, and digit-guards title/caption/note text (every digit run
must be a plotted value, source cell, x label or header token — else the item is refused as
`unplotted_number`). The guard also covers the model's OWN refusal text, which reaches the screen
as well (final review): there an unplotted number is STRIPPED and the sentence kept, because a
refusal cannot itself be refused without hiding from the reader that the request was declined.
The client validates every stored command AGAIN with `validateCommand` before
dispatching with `source: 'chat'`. Two defects the review loop caught here: the output JSON schema
emitted `oneOf` (structured outputs reject it — the intent parser's `oneOfToAnyOf` walker is now a
shared module, `src/answer/llm/json-schema.ts`, with a no-`oneOf` test), and the model's font name
reached the stored log unvalidated. The turn is stored as a `dataset_turns` row of kind `chart` with
a `copilot` envelope field (message, mapped commands, refusals, feedback); on replay it shows as a
compact recipe message in the thread, never a second chart card, while the card itself restores from
`chart_edits`. The reply in the card: recipe chips with the panel's own icons (click → the panel
that owns the setting), one plain sentence per refused item naming the click path, Undo (the reply's
commands as a group; disabled with a reason once the reader has edited on top), Retry (a new call),
👍/👎 (stored on the turn; "thanks" only once the server confirms — a review finding), and three
deterministic example chips. Capabilities the client sends are advisory for the prompt only; the
client's validation and the server's allowlists are the authority.

**Hermetic proof.** Four hand-authored LLM fixtures (`tests/fixtures/attachments/cases.ts`,
generated by `npm run attachments:fixtures` with the real request builders, so the harness stub
matches byte-for-byte; `npm run attachments:record` is the owner-supervised live variant) and
`web/e2e/own-data-copilot.spec.ts`: upload → question → chart → "totaal per gemeente, hoogste eerst,
en maak er staven van" → bars + recipe chips + the Data panel reading "Som" → ⌘Z twice → back →
reload → restored.

**Not built (recorded in open-questions):** a chip click opens the owning panel but does not
select the exact row; no streaming of chips (one call, one reply); `count` ignores the y column; the
own-data table form has no CSV export; the Data panel's problem line shows the validator's English
message; the reply lives in the card and only appears in the thread after a reload.

## As built — phase 3, the CBS/Eurostat chat doorway (session 114, 2026-09-18)

Plan: [superpowers/plans/2026-09-18-chart-copilot-phase3.md](../superpowers/plans/2026-09-18-chart-copilot-phase3.md).
Built via subagent-driven development (four implementer tasks in two waves, two worktrees; one fix
round; the Playwright proof and the final review by the session).

- **Selection only, by construction.** `src/chart/copilot/` mirrors `src/attachments/copilot/` file for
  file but its schema has NO instruction field: the model may emit `setForm`, `setSeriesView` (by series
  LABEL), `setPeriodRange` (by period LABEL, only when the card offers the zoom), `setPresentation`,
  `applyTemplate`, `resetPresentation`, `setTitle`, `setCaption`, `addNote` (series label + period label),
  plus one boolean `dataRequest`. The prompt payload carries the chart's title, unit, kind, series labels
  and period labels — never a `formattedValue`, `value` or `resultId` (pinned by
  `tests/chart/copilot-respond.test.ts`). `map.ts` turns labels into `s${index}` keys and period CODES by
  lookup against the spec; a label that does not resolve is a refusal naming the control, never a guess.
  The digit guard (`text-guard.ts`) allows only digit runs present in the spec's own formatted values,
  period labels/codes, title, unit and covered-period bounds. The card re-validates every stored command
  with `validateCommand` before dispatching with `source: 'chat'` (R1/R6/R11 untouched; `windowSpec()`
  unchanged).
- **"En Amsterdam erbij" is a data request, not an edit.** The model sets `dataRequest: true` with an empty
  view; the reply strip then shows one chip "Stel als vervolgvraag" that sends the reader's OWN words
  through the thread's existing question path (`chat.tsx`'s `sendText`, ADR 021 follow-up context) —
  the model never rewrites the question. When the resulting answer's chart is compatible with an earlier
  card in the thread (same `attribution.tableId`, `unit`, `kind` and `dims` — `extendsPreviousChart` in
  `web/lib/chat-message.ts`) the new card carries the badge "Grafiek uitgebreid" and mounts in the
  previous card's saved form and look (its `chart_edits` log folded into `initialFormOverride` +
  `initialPresentation`). The two answers stay two cards with two audit rows; merging their series into
  one drawn spec is [#287](../open-questions.md).
- **Billing without DDL.** `src/billing/chart-edit-gate.ts` (the dataset-gate pattern; hot path untouched)
  reserves the existing `clarification` action-class price through the existing `question_cost`
  reservation with a fresh request id; an `edit` reply keeps the debit, a clarification/refusal refunds
  in full; every compensation passes `auditAnswerId: null`. **A chart edit never writes `audit_answers`**
  (spec §6). What survives: the ledger rows and the applied commands in the card's `chart_edits` log
  (phase 1). The reply text, refusals and token counts are not stored, so this tier has no 👍/👎 —
  [#285](../open-questions.md) (re-pricing), [#286](../open-questions.md) (a turn record).
- **Gating on the CBS card** (`web/components/chart.tsx`): the input mounts only where the history
  actions do — signed in, in-app, a saved answer behind the card (`editsKey !== null`), never in embed or
  stage mode, not in table form, not while the story panel is open. The reply strip renders outside the
  export container (no credit figure can enter a PNG/SVG). Three deterministic example chips
  (`cbsExampleChips`): spotlight the top visible series, "Alleen de laatste jaren" when the zoom is on
  offer, a title suggestion — zero model calls.
- **Hermetic proof.** `tests/fixtures/chart-copilot/cases.ts` holds three hand-authored cases over the
  exact spec the harness draws for the phase-1 e2e question (captured through the same PGlite snapshot +
  `runQuery` + `buildChartSpec` route the harness uses); `npm run chart-copilot:fixtures` writes them
  under their real request hash (drift test `tests/chart/copilot-fixtures.test.ts`);
  `npm run chart-copilot:record` is the owner's live check (blocked by the API cap until 2026-10-01,
  [#288](../open-questions.md)); `web/e2e/cbs-copilot.spec.ts` walks hide → ⌘Z → data request →
  follow-up hand-off → reload in a real browser with zero model calls.
- **Not built (by decision):** series merging for "Grafiek uitgebreid" ([#287](../open-questions.md));
  a reading (`setReading`) command through the chat — the reading select stays panel-only for now (an
  alternate reading is a different measure and deserves the panel's explicit label).

## Revisit triggers

- Logged "could not do" chat requests show demand for free arithmetic on own data → widen the derived set.
- A form the scorer disqualifies is repeatedly requested on CBS data → revisit the honesty rule, not the gate.
- The command log grows beyond what a JSON column comfortably holds per chart → snapshot + tail.
- Recharts cannot draw a phase-5 form cleanly → the engine ADR the plan already foresees (Vega-Lite /
  Observable Plot / own SVG; never the competitor's SDK).

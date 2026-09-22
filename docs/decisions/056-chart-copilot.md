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

## As built — phase 4, storytelling primitives (session 115, 2026-09-19)

Plan: [superpowers/plans/2026-09-19-chart-copilot-phase4.md](../superpowers/plans/2026-09-19-chart-copilot-phase4.md).
Built via subagent-driven development (8 tasks across three waves — a foundation wave, five parallel
UI tasks merged one at a time, a test-coverage task), a final whole-branch review on the most capable
model, one fix wave, one scoped re-review, a small set of controller-fixed residuals, and — once pushed
— a 5-round CI fix loop (see Verification below). Merged to `main` `edbf6d30..4902737c`.

- **The provenance split, in one rule (spec §9):** a primitive shows either the reader's OWN typed
  words (never checked against data, rendered outside `chartContainerRef` so it can never enter a
  PNG/SVG export — the same trick chart notes already use) or a NUMBER the product calculated, which
  must always trace to a real, already-verified cell and is drawn as part of the chart's own image.
- **Goal line and era shading are a hybrid of both halves.** The reader's typed VALUE/RANGE draws as a
  native Recharts primitive (`<ReferenceLine>`/`<ReferenceArea>`) with no `label` prop, INSIDE
  `chartContainerRef` — a structural marker, not a data claim, so it's acceptable for it to appear in
  a download. The reader's typed LABEL TEXT stays in the existing outside-`chartContainerRef` list,
  same as notes. (Mid-session finding: the original assumption that the chart's period/zoom controls
  already exposed a reusable pixel-positioning x-scale was wrong — they're plain `<select>`s. Recharts'
  own `x1`/`x2`/`segment` props, keyed by period LABEL, replaced any need for manual pixel math.)
- **Difference arrow and average line are computed on demand, server-side, never precomputed and never
  in the browser (owner decision, "Option A").** `requestChartDerivation`
  (`web/app/chart-derivation-actions.ts`) re-runs a registered R5 derivation (`deriveDifference`,
  a new `deriveMean`) over an already-audited chart's own cells (`specCellsByResultId` flattens the
  stored `ChartSpec` back into derivation-ready cells) — no new CBS/Eurostat fetch, no new
  `audit_answers` row. The command log itself never carries the computed number, only the "recipe"
  (`calcKind` + `resultIds`); the resolved value lives in transient client state
  (`resolvedOverlays`), resolved via `resolveDerivedOverlays`. **The final review found this action
  had no ownership/GDPR-redaction check** — unlike its sibling `createEmbedCode`, which has exactly
  that check for the same client-supplied-id shape — fixed same session (real hole: `resultId` is
  fully guessable from public CBS vocabulary, so an unscoped read let any signed-in user probe which
  table/region/period another user's account had asked about).
- **Dim instead of hide** is a third `shown | dimmed | hidden` series state (`ChartViewState.
  dimmedKeys`), on both the CBS/Eurostat and own-data cards — the one primitive built for both cards
  this session.
- **Reader-chosen headline number** widens `web/lib/chart-headline.ts`'s existing automatic
  `headlineFigure()` (previously always "the last point of a single-series chart") to accept an
  override resultId the reader picks via the same click-to-annotate affordance chart notes already
  use; falls back to the default figure (never blanks the card) when a zoom/alternate-reading makes
  the override's resultId no longer present on the displayed spec. **A real interaction bug surfaced
  only by CI's first real-browser run of this flow:** setting an override closed its own point popover
  immediately, so the "Toon standaard hoofdcijfer" (clear override) toggle it's meant to reveal could
  never be seen without re-clicking the same point — fixed by leaving the popover open on set/clear
  (`web/components/chart.tsx`), with a new jsdom test exercising the full flow.
- **CBS/Eurostat card only this session; own-data support deferred** ([#289](../open-questions.md)) for
  goal line, era shading and the headline override — none has provenance complexity that would make it
  harder there, it just wasn't built. Difference/average are permanently CBS-only by construction
  ([#290](../open-questions.md)) — own-data already has full arithmetic freedom via `setInstruction`.
- **Not chat-reachable yet, for any of the six primitives** — `src/chart/copilot/schema.ts`/`map.ts`
  (the CBS chat doorway's vocabulary) and the own-data equivalent are untouched by this session. Phase
  4 shipped the cheapest-mechanism-first panel controls; the chat side is a later, explicitly separate
  step, not silently dropped scope.
- **A real process incident, caught and remediated same session:** a subagent, mid-fix-round, operated
  against the main repo checkout instead of its assigned `git worktree`, producing a real but entirely
  unreviewed commit on `main`'s HEAD. Found via the controller's own sanity check (not the agent's own
  report, which had mis-described it as a stalled background command), remediated with a local
  `git reset --hard` to the last known-good merge (nothing pushed, fully recoverable via reflog) before
  the properly-reviewed history was built on top. See [lessons-learned.md](../lessons-learned.md)
  session 115 for the full account and four related lessons (a shared-type widening silently breaking
  unrelated exhaustive switches three separate times; a "doesn't crash" test masquerading as coverage
  across two different tasks; a Recharts-specific gotcha — `<ReferenceLine>`/`<ReferenceArea>` must be
  direct JSX children, not wrapped in a custom component).
- **Verification:** 2433/2433 web tests, 2977/2977 root tests, both typechecks clean, `next build`
  succeeds, CI green including deploy (run `35440310164`). **Correction to an earlier draft: the
  Playwright e2e suite runs hermetically against an LLM stub — it is NOT blocked by the Anthropic
  usage cap, and it DID run this session, via CI.** Its first-ever real execution (none of phase 4's
  new e2e cases had run against a real browser before) surfaced 5 real bugs across a 5-round CI fix
  loop: 3 were test-selector bugs invisible to jsdom/unit tests (a locator matching 6 elements on a
  real page instead of the intended 1; Playwright's `getByLabel` substring-matching an unrelated
  element with a similar accessible name; a hardcoded period-code format that doesn't match real CBS
  codes), and 2 were real product bugs — Task 5's own e2e test assumed a default headline exists on a
  2-series chart (it deliberately doesn't), and the headline-override popover bug noted above. Only the
  true live-API paths (`attachments:record`/`chart-copilot:record`, `benchmark:run:live`) remain
  blocked by the cap ([#288](../open-questions.md)).
- **Residuals, all deliberately deferred, not silently dropped:** [#289](../open-questions.md)–[#294](../open-questions.md).

## As built — phase 5, chart-fit scorer + dumbbell/slope/heatmap (session 116, 2026-09-19)

Plan: [superpowers/plans/2026-09-19-chart-fit-scorer-phase5.md](../superpowers/plans/2026-09-19-chart-fit-scorer-phase5.md).
Spec addendum: [superpowers/specs/2026-09-17-chart-copilot-design.md](../superpowers/specs/2026-09-17-chart-copilot-design.md) §10.
Built via subagent-driven development (5 sequential tasks — this file's own tab strip and render tree
turned out too fragile for parallel edits, so every task ran one at a time on a single worktree), a final
whole-branch review on the most capable model, one fix wave, one scoped re-review. Merged to `main`
`dfdaee18..8abd187c` (11 commits).

- **Scope split, decided before any code was written (owner: "Split"):** the original phase-5 sketch
  named seven new forms. A feasibility check found two of them need real new capabilities that don't
  exist yet — scatter needs a second measure per plotted point (every `ChartPoint` carries exactly one
  `value`), and pie/donut/stacked/100%-stacked need a "verified whole" concept (nothing in `src/query`/
  `src/registry` can check that a set of cells sums to some other real, published cell). Those four stay
  **out of scope**, [ADR 039](039-chart-presentation-panel.md)'s existing blanket refusal of them is
  **unchanged** — this phase does not reopen it. Dumbbell, slope, and heatmap shipped instead: all three
  are honest by construction (nothing computed, every drawn number is a `ChartPoint.value`/
  `formattedValue` the chart already fetched and verified), gated by a small rule-based scorer
  (`web/lib/chart-fit.ts`, `allowedForms`), CBS/Eurostat card only (`web/components/chart.tsx`) —
  `web/components/user-chart.tsx` (own-data) has no matching render code and was not touched.
- **Slope needed zero new render code.** It reuses the existing line-chart branch verbatim — a slope
  chart IS a line chart with exactly two points per series, which is exactly `slopeFormAllowed`'s own
  condition (`web/lib/chart-view-state.ts`).
- **Dumbbell is a new render mechanism, deliberately NOT what the plan originally sketched.** The
  original draft proposed a Recharts `ComposedChart` + a "range bar" (`[min,max]` as a `Bar`'s value) +
  a `Scatter` overlay — untested against this app's actual Recharts version. Corrected before dispatch to
  reuse a pattern this file already ships and has already been reviewed: `EndLabelsOverlay`'s own
  `useXAxisScale()`/`useYAxisScale()`/`usePlotArea()` hook technique (a component that reads Recharts'
  own settled axis scales to independently place arbitrary SVG). `DumbbellOverlay` draws a connecting
  `<line>` plus a `<circle>` and a `formattedValue` label at each endpoint, inside a `BarChart
  layout="vertical"` shell with no visible `<Bar>` — the overlay draws everything. The geometry mechanism
  was independently verified against the actual installed Recharts source (domain-sizing with zero
  graphical items, category-axis band centring) before being trusted, and a real rendered-DOM test pins
  each dot's pixel position against Recharts' own axis tick.
- **Heatmap surfaced a real architecture fact the plan's author hadn't read far enough to know:** the
  table form does not live inside the main Recharts render tree — it is a sibling `canvasNode` branch,
  and ~17 separate `state.form !== 'table'` checks elsewhere in `chart.tsx` gate the Style panel, legend,
  notes, era shading, story mode, download/embed, headline, trend sentence, and the co-pilot input
  specifically for it. Heatmap ("the same rows the table already shows, recoloured," per spec §10) was
  made a sibling of the table branch too, inheriting every one of those same gates via one derived flag
  (`isTabularForm(activeForm)`, later exported and shared with the public embed route — see the final
  review below). A real guard bug was found and fixed in the same task: the original `heatmapFormAllowed`
  only checked that every series had the same NUMBER of points, not the same SET of period codes — a
  ragged spec (two series covering different, same-length period ranges) would have passed and produced
  a grid cell with no real point behind it. The as-built guard requires the exact same period-code set
  across every series, plus every value non-null.
- **The final whole-branch review found two real cross-task bugs, both fixed in one fix wave:**
  (1) the three new forms' "is this honestly offered" guards were computed from the `spec` PROP, but the
  actual drawn canvas comes from `displaySpec`/`viewSpec` — reachable through an alternate-reading
  `<select>` and a zoom window, neither of which resets the selected form. A reader on the heatmap tab
  picking a disqualifying alternate reading made the render code throw (no error boundary in `web/`); the
  dumbbell case rendered a blank, unexplained canvas instead. Fixed with a single composite `guardSpec`
  feeding all three new guards and `fallbackForm`, while the five pre-existing forms' guards — verified by
  reading their own type signatures, which cannot even read `.series` — are unaffected by construction.
  (2) the public embed route's `?form=` allowlist excluded `'table'` specifically (a previously-closed
  hole: nothing else stops a hand-crafted URL reaching the un-embeddable table view) but not `'heatmap'`,
  reopening that exact hole for heatmap's own table-like twin — fixed by sharing one `isTabularForm`
  predicate between `chart.tsx` and the embed route instead of two independent literals.
- **Not chat-reachable via a new prompt vocabulary — but not deferred either, unlike phase 4's
  primitives.** Chart-form switching has gone through the chat co-pilot since phase 1/3 (`setForm` is an
  existing command); widening `ChartForm` to eight members automatically extended it. The one thing that
  did need a same-task fix: `src/chart/copilot/prompt.ts` hand-lists the offered forms directly in the
  system prompt text (separately from the JSON schema/capabilities), so `CBS_COPILOT_PROMPT_VERSION`
  bumped 1→2 alongside the widened example list — otherwise the model would have kept anchoring on the
  five-form example it was shown and never proposed the three new ones even once capabilities allowed them.
- **Residual, disclosed and parked, not a merge blocker:** `cbsCapabilities`'s advertised `forms` list
  still reads the primary `spec`, not the new `guardSpec` — so on a disqualifying alternate reading, the
  chat could still be told a phase-5 form is available even though its tab is now correctly disabled.
  Harmless (re-validates through `fallbackForm`/`guardSpec` server- and client-side, never crashes, never
  a wrong number) but the same "chat offers what the panel can't reach" smell the scorer exists to
  prevent. A one-line follow-up if picked up later.
- **Verification:** root + web typechecks clean; web suite 2505/2505; real Turbopack production build
  clean (the worktree's symlinked `node_modules` initially broke Turbopack's own root-boundary check —
  replaced with real local installs so the actually-configured bundler, not a webpack substitute, ran);
  full Playwright e2e suite 21/21 (real Chromium, LLM-stub-backed, zero model calls) including a genuine
  CSS-grid layout assertion (bounding-box row/column alignment, computed `display: grid`/`contents`) for
  the heatmap — the one real-browser check this phase's CSS-grid work needed, since jsdom has no layout
  engine. A task-scoped review found and fixed a real, unrelated e2e-fixture staleness bug: Task 1's
  scorer change silently changed what an EXISTING phase-3 fixture's request bytes should be, masked by
  the LLM stub's 60-character prefix-match fallback. CI green post-merge (verify the exact run id against
  `gh run list` before citing it — this doc was written while that run was still in progress).
- **See [lessons-learned.md](../lessons-learned.md) session 116** for the full account of the
  guard-vs-drawn-spec bug class, the table's real sibling-branch architecture, the fixture-staleness
  finding, and a disclosed process deviation (a worktree-removal `--force` used without the
  human-in-the-loop check the process calls for).

## Phase 5b — the "verified whole" (session 117 design, session 118 build), as built

Design: spec [superpowers/specs/2026-09-17-chart-copilot-design.md](../superpowers/specs/2026-09-17-chart-copilot-design.md)
§11. Plan: [superpowers/plans/2026-09-19-verified-whole-phase5b.md](../superpowers/plans/2026-09-19-verified-whole-phase5b.md).
Built via subagent-driven development (5 tasks, Fable-tier implementers, sonnet task reviewers, one opus
final whole-branch review); full history in `.superpowers/sdd/2026-09-19-verified-whole-phase5b/progress.md`.
Merged to `main` at `c7723c34` (session 118, 2026-09-20).

- **The core new concept:** `src/query/whole-verification.ts` — `parentCellRef(scope: RegionScope)` maps
  a region scope to what its "whole" cell should be (the national `NL` total for provinces/landsdelen, a
  province's own cell for a gemeenten-in-provincie roster), or `null` when the concept doesn't apply
  (`all_gemeenten` — see [#299](../open-questions.md)); `verifyPartsSumToWhole(parts, whole)` checks the
  parts sum to the whole within `max(0.5 at the whole's own decimals, 0.5% of its value)`, refusing on a
  missing whole or any withheld/null part before ever comparing sums.
- **Provenance, not code-list equality:** `ChartSpec.regionScope: RegionScope | null` (a new optional-v1
  field, ADR [014](014-chart-spec-v1-and-renderer.md)'s pattern, always explicitly emitted by
  `buildChartSpec`, never omitted) records HOW a chart's regions were selected. The three new `ChartForm`
  guards (`pieFormAllowed`/`stackedFormAllowed`/`stacked100FormAllowed`, `ChartForm` now 11 members) check
  this field, not whether the region codes happen to numerically match a complete roster — a hand-picked
  or LLM-assembled selection that coincidentally names every province still refuses, proven by a dedicated
  contract test. Donut is a `pieHole` presentation variant of `pie` (`ChartPresentation`), never a fourth
  form.
- **On-demand verification, Option A pattern:** `web/app/chart-whole-verification-actions.ts` re-reads an
  already-audited chart's own cells (never the client's own idea of them) and fetches exactly one more
  cell per period (the whole) from our own database — no new CBS fetch, no new `audit_answers` row, same
  "not a new answer, a view command" pattern as phase 4's difference/mean. **Deliberately built to accept
  `(auditKey: {kind:'answer', id}, periodCodes)` rather than the plan's literal client-supplied-`ChartSpec`
  signature** — a client-supplied spec would let a fabricated spec make the server report a false
  "verified" for numbers never actually checked against any real cell, a direct violation of the never-
  fabricate principle, not just a privacy gap. Ownership + GDPR-redaction check (mirroring
  `chart-derivation-actions.ts`) runs before any distinguishing refusal reason can leak. Confirmed by both
  the task-scoped review and the final whole-branch review, independently re-derived each time.
- **A completeness gate, added in the final fix round:** a roster member that has NO observation row at
  all (distinct from a withheld/null member, which already refused correctly) was initially invisible to
  the sum check — the only thing standing between an incomplete roster and a false "verified" was the
  tolerance, safe for provinces but not for small gemeenten in a `gemeenten_in_provincie` roster. Closed
  by reading the audit row's own stored `RegionSetCoverage.complete` before any DB query runs (mirroring
  the existing `deriveRegionRanking` precedent in `src/query/derivations.ts`, which refuses a ranking over
  an incomplete set for the identical reason), with a new honest `incomplete_roster` refusal reason.
- **Rendering:** native Recharts `PieChart`/`Pie` (pie) and `BarChart` with `stackId` (stacked/100%-
  stacked) in `web/components/chart.tsx` — not a custom SVG overlay, this app's first native-library chart
  forms alongside its custom `EndLabelsOverlay`/`DumbbellOverlay` pattern from phase 5. 100%-stacked's
  percentage denominator is the verified parts' own sum (not the CBS whole's raw value), so bars are
  exactly full — differs from the true total by at most the tolerance (~0.5%), still pure arithmetic over
  already-verified reals. Three local refusals — no audit row, an alternate reading, a hidden series — are
  a complete set (confirmed by the final review); a public embed structurally falls back to the table.
- **Chat vocabulary:** `CBS_COPILOT_PROMPT_VERSION` 2→3, `setForm`'s hand-listed forms widened to all 11.
- **Scope, unchanged from the design:** region hierarchies only (never a category breakdown); CBS/Eurostat
  card only — `web/components/user-chart.tsx` deliberately untouched (mirrors [#289](../open-questions.md)'s
  precedent); scatter stays out of scope, still needing its own two-measure-per-point chart-spec shape
  ([#296](../open-questions.md)).
- **Deferred, not silently dropped** (all Minor, none a data-integrity risk — see
  [#300](../open-questions.md)–[#305](../open-questions.md)): a chat-capability-list vs. real-tab-state
  edge case; donut unreachable from chat; a latent `cbsCapabilities` typing gap; the multi-period
  stacked/100%-stacked path being structurally unreachable from the real pipeline today (correct code,
  untested by a real end-to-end run); a `value_attribute` null-coercion nit.

## As built — phase 6, chat wiring for the six storytelling primitives (session 121 design/build, session 122 fix wave)

Plan: [superpowers/plans/2026-09-20-chart-copilot-phase6-chat-wiring.md](../superpowers/plans/2026-09-20-chart-copilot-phase6-chat-wiring.md).
Built via subagent-driven development (6 sequential tasks, one worktree, one implementer at a time —
session 116's own lesson on shared-file fragility), a final whole-branch review (opus), then a session-122
fix wave applying that review's findings. **As of this writing: fully built and verified, on branch
`claude/chart-copilot-phase6-fixes-wpim88` (`0f7c7f18`, built on top of `worktree-chart-copilot-phase6`
@ `58db5097`), pushed to `origin` — NOT YET merged to `main`** (a session-assigned branch constraint, not
a design or review blocker — see [STATUS.md](../STATUS.md)'s top block). Full ledger:
`.claude/worktrees/chart-copilot-phase6/.superpowers/sdd/2026-09-20-chart-copilot-phase6-chat-wiring/progress.md`
(git-ignored, machine-local).

- **All six of phase 4's "storytelling primitives" ([#289](../open-questions.md)) are now chat-reachable**,
  making phase 4's own "panel-only, chat-second" gap current no longer: `setDimmed` (dim instead of hide),
  `setHeadlineOverride` (feature one point as the headline), `addEraShading` (shade a period range with a
  typed label), `addDerivedOverlay` (one command covering BOTH the difference-arrow and average-line
  primitives via `calcKind: 'difference' | 'mean'`), and `addGoalLine` (a reader-set target line). Plus
  Task 1 re-applied two already-designed-but-reverted capabilities: the `pieHole` donut toggle
  ([#301](../open-questions.md)) and the five house styles ([#275](../open-questions.md)) by name.
  CBS/Eurostat card only, by construction — own-data wiring for all six remains a separate, unscheduled
  step (mirrors [#289](../open-questions.md)/[#295](../open-questions.md)'s own precedent).
- **`goalLine.value` is this tier's one genuine exception to "the model never carries a number"** — a
  reader-set target is deliberately not a plotted value, so `text-guard.ts`'s `goalLineValueInMessage`
  checks it against the READER's own raw message instead of the chart's own digits: the value must equal,
  numerically, a number the reader actually typed (read both the Dutch and the English way — a moved
  decimal or a flipped sign never counts as a match). The first version of this guard compared
  separator-stripped digit STRINGS, not numbers, and would have accepted a value 10x/1000x off or
  sign-flipped from what the reader typed; caught by the implementer itself, then independently confirmed
  by an opus-tier reviewer that EXECUTED the guard on constructed adversarial inputs rather than just
  reading it. **Deliberate, accepted limitation, documented in the guard's own TSDoc (session 122):** the
  guard only checks that the value appears somewhere in the message, not that it names the goal, so a bare
  year mentioned for another reason ("tussen 2020 en 2024") also passes — narrowing this would need
  real-model confirmation this tier has not spent yet, and the guard's actual job (refusing a value the
  reader never typed at all) still holds.
- **Two already-designed capabilities were re-applied, not newly built:** the offline-fixture-regeneration
  method (`npm run chart-copilot:fixtures`/`attachments:fixtures`, free, no network) unblocks a
  prompt-embedded-list widening's fixture-hash shift without needing live model spend — see
  [[feedback_llm_prompt_embedded_lists_hash_risk]] for the corrected mechanism (an earlier belief that this
  needed real spend was itself a bug, fixed this same session). Real-model confirmation of the two newly
  hand-authored fixture cases is still owed via `:record` once the Anthropic workspace usage cap lifts
  (2026-10-01).
- **Final whole-branch review found two real Important findings, both fixed in the session-122 fix wave:**
  1. **No form gate on `addDerivedOverlay` ([#310](../open-questions.md), the more serious of the two).**
     `map.ts` only checked that the named series/points were real, never that the current chart FORM can
     draw an overlay at all — so asking for one on a bar/pie/stacked chart silently stored a command that
     rendered nothing and could not be explained or removed. This is the exact defect class session 116's
     own final review closed for the on-screen panel (`chart.tsx`'s difference/mean buttons are gated
     `activeForm === 'line' || activeForm === 'area'`), reopened through the new chat doorway. **Fix:** a
     new `overlays: boolean` field on `CbsCopilotCapabilities` (`src/chart/copilot/types.ts`), computed in
     `cbsCapabilities` (`web/lib/chart-capabilities.ts`) from the same `form === 'line' || form === 'area'`
     test as the panel's own gate, defaulted `false` in `sanitizeCbsCapabilities`, and checked FIRST in
     `map.ts`'s `addDerivedOverlay` case (refuses `not_available`/`form` before any series/period lookup).
     Deliberately NOT mentioned in `SYSTEM_PROMPT` — a prompt-byte change would re-hash all 14 co-pilot
     fixtures and force a full Playwright re-run for a gate that is just as effective enforced purely at
     the deterministic mapping layer. Proven, not just claimed: the real Playwright suite's 18/18 passing
     cases all matched their fixture "exact" (never the risky prefix-match fallback), and the suite's own
     request log shows `overlays:false` for the hbar-form province cases and `overlays:true` for the
     line-form city cases.
  2. **Inconsistent confirmation-chip destination (I2).** The five new commands' applied-chip icon
     (`web/lib/chart-copilot-reply.ts`'s `iconFor`) all fell through to the generic `'style'` default
     (untested, so this shipped unnoticed), while their own refusals in `map.ts` pointed at different
     controls — one command's success path and its own refusal path opened two different panels. **Fix:**
     explicit `iconFor` arms for all five (`setDimmed`→series, matching its sibling `setSeriesView`;
     `setHeadlineOverride`/`addGoalLine`/`addEraShading`→note; `addDerivedOverlay`→form, verified against
     `chart.tsx` that its two buttons genuinely sit in the same control row as the form tabs), plus
     `map.ts`'s `addGoalLine`/`addEraShading` `not_available` refusals changed from `control: 'form'` to
     `control: 'notes'` so the refusal names the SAME panel the applied chip now opens.
  3. The reviewer also caught that an EARLIER task review's stated mechanism for a related finding
     (`iconFor()` "unmounting" the era-shading UI) was wrong when independently re-checked — the underlying
     issue was still real, just not for the originally claimed reason (see
     [lessons-learned.md](../lessons-learned.md) session 121).
- **Two stale doc comments corrected in the same fix wave** (session 122): `CbsCopilotOutput.dataRequest`'s
  TSDoc used to paraphrase the OLDER prompt wording, from before this same phase's own
  `addDerivedOverlay` carve-out (an on-chart average/difference used to route to `dataRequest` too) — now
  matches the current `SYSTEM_PROMPT` paragraph. `text-guard.ts`'s bare-year false-accept (above) is now
  documented instead of silent.
- **Deliberately documented, not fixed** (low-risk, or expensive — a `SYSTEM_PROMPT` byte change re-hashes
  every co-pilot fixture): the chat's "average" ignores an active zoom window despite the prompt's own
  wording ([#307](../open-questions.md)); the real e2e suite proves 1 of the 5 new command kinds
  (`addEraShading`) renders correctly through an actual browser, the other four only through the
  fixture-hash + unit-level mapping proof ([#308](../open-questions.md)); `setDimmed` replaces the whole
  hidden-set wholesale, same as the pre-existing `setSeriesView`, so it silently un-hides a series the
  reader had separately hidden by clicking ([#309](../open-questions.md)).
- **Verification (session 122, measured, all green):** root + web typecheck clean; root vitest 205 files /
  3,095 tests (was 3,080 before the fix wave's own +15 new assertions); web vitest 146 files / 2,594 tests
  (was 2,593); real Playwright `chart-copilot.spec.ts` 18/18 (real Chromium; this environment's installed
  `@playwright/test` package version did not match the pre-installed browser revision, worked around with
  `CHROMIUM_PATH` pointed at the real installed binary — an environment quirk, not a code issue); hermetic
  benchmark 14/14 answerable + 6/6 refusal + 0 fabricated, GATE PASS; `/code-review` LOW on the diff: no
  findings; real `next build`: clean.

## Revisit triggers

- Logged "could not do" chat requests show demand for free arithmetic on own data → widen the derived set.
- A form the scorer disqualifies is repeatedly requested on CBS data → revisit the honesty rule, not the gate.
- The command log grows beyond what a JSON column comfortably holds per chart → snapshot + tail.
- Recharts cannot draw a phase-5 form cleanly → the engine ADR the plan already foresees (Vega-Lite /
  Observable Plot / own SVG; never the competitor's SDK).

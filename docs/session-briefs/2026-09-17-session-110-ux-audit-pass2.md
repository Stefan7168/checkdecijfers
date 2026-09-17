# Session 110 — UX audit pass 2: the surfaces pass 1 could not reach (2026-09-17)

**How this was audited.** The repo's own hermetic harness (`scripts/dev-harness/`, RUNBOOK § "Local
real-browser harness") on `:3102` — PGlite fixture DB, stubbed auth, stubbed LLM, **zero LLM spend,
production never touched** — driven through Playwright. Started with `TRIAL_ENABLED=1` +
`ANTHROPIC_TRIAL_API_KEY`/`TRIAL_IP_HASH_SECRET` (both pointed at the stub), a trial pot seeded to
25/25 via a scratchpad preload wrapper, `EUROSTAT_EXPLORER_ENABLED=1` and `EMBED_TOKEN_SECRET` set;
no tracked file was changed. Viewports 1280×800, 600×440, 320×240 and 375×812. ADRs 036, 038, 041,
042/043, 044, 048 and 050 were read first, so deliberate choices are not reported as bugs.
Pass 1's rows 1–21/23 were re-checked only where they could recur; rows 4, 5, 6 and 15 were
verified **fixed** on main.

**Counts: P1 = 2 · P2 = 8 · P3 = 7.**

---

## Fix now (mechanical — no design decision needed)

| # | Sev | Where | What I saw | Expected | Repro | Proposed fix |
|---|-----|-------|-----------|----------|-------|--------------|
| 1 | **P1** | `web/components/trial.tsx:38-42` (server gate) + `web/components/trial-chat.tsx:60-90` | Asking the **last** free trial question wipes the whole trial section: both the question and the answer disappear and the visitor sees only "You have used your free trial questions." They never see the answer they just spent their last question on. The server action triggers a router refresh; `TrialGate` re-reads `questionsLeft`, now 0, and renders `LoginNudge` **instead of** `<TrialChat>`, unmounting the client message list. | The answer stays on screen with the "create an account" nudge underneath it. | Landing logged out, ask two trial questions. Second answer never appears (verified: the server log shows `askTrialQuestion(…)` succeeded and the intent fixture hit). | Render `<TrialChat>` even at `questionsLeft === 0` (it already shows `used_up` itself), or let the gate pass `used_up` in as an initial notice instead of swapping the component. |
| 2 | **P1** | `web/components/chart-embed-dialog.tsx` (generated `height="440"`) + `web/app/embed/[token]/page.tsx` layout | The iframe snippet the Embed dialog hands the journalist is **440 px tall; the embed page's own content is 613 px**. At that height the CBS **source line, the "Frozen on 2026-09-17" date and the checkdecijfers.nl attribution** are all below the fold of an inner `overflow-y-auto` scroller — the page body itself does not grow (`documentElement.scrollHeight` stays 440), so an auto-resize script cannot rescue it either. The product's public claim is "source and date shown". | The default snippet height shows the chart **and** the attribution block. | Chart → Embed → copy code → open the token URL at 600×440. Measured: last `<p>` bottom = 604.5 px, viewport 440. | Raise the generated height to the measured content height (or make the embed layout size to the frame), and keep the attribution block out of the inner scroller. |
| 3 | P2 | `web/app/trial-actions.ts:195-265` | An **INTERNAL refusal** (our own pipeline error, not a data gap) still **consumes one of the two free trial questions**: the counter went "2 of 2" → "1 of 2" while the server logged `ADMIN ALERT: INTERNAL refusal served`. The refund in the `catch` only fires when the pipeline *throws*; a caught error that is served as a refusal never refunds. A logged-in user is charged 0 credits for the same refusal. | An internal-error refusal refunds the pot/visitor take, like the paid path charges 0. | Ask any question whose pipeline errors (harness: any non-fixture question). | Refund when the served response is an INTERNAL refusal, not only on a throw. |
| 4 | P2 | `web/components/chart-story-stage.tsx:320-330` (autoplay effect) + the `onAnyScroll` reader-gesture detector at `:300-318` | **Auto-play advances exactly one step and then switches itself off.** Measured twice: `aria-pressed` goes true, `scrollTop` 804→1484 (or 1484→2164), then `aria-pressed` flips back to false with no further movement. The autoplay's own `scrollIntoView({behavior:'smooth'})` keeps firing scroll events after `beginProgrammatic`'s window closes, so `onAnyScroll` reads it as a reader gesture and cancels. | Auto-play runs to the last step unless the reader intervenes. | Open Insights → Present → Auto-play, wait 8 s. | Keep the programmatic flag latched until the smooth scroll settles (`scrollend`, or clear it only when the target panel is reached). |
| 5 | P2 | `web/components/chart-embed-dialog.tsx:428` | The Embed dialog has **two controls named "Close"** — `ChartEditModal`'s own × plus a second one added at :428. This is pass 1's row 6 recurring in a different component (row 6's own fix on the Style dialog is verified good). | One close control. | Chart → Embed; the dialog's button list is `[…, "Copy code", "Close", "Close"]`. | Drop the :428 button, or relabel it "Done". |
| 6 | P2 | `web/components/chart.tsx:2337` + `web/lib/i18n/messages.ts:417,1214` | A **failed headline draft** shows "**Could not save the headline.**" — nothing was being saved. One `chart.headline.error` string serves both the draft and the save path. | A draft failure says the draft failed. | Chart → Suggest headline with the drafting call failing. | Add `chart.headline.draftError` ("Could not suggest a headline.") and use it at :2337. |
| 7 | P2 | `web/lib/i18n/messages.ts:404,1203` (`chart.provisionalMarkerNote`) vs `src/chart/build.ts:32` (`PROVISIONAL_NOTE`) | One chart card states **two different provisional conventions**: the UI legend "**○ = provisional figure**" and, two lines below it, the backend prose "**Voorlopige cijfers zijn gemarkeerd met \*.**" — while the value actually printed is "**1,4\***". A reader is told the marker is a hollow circle and an asterisk in the same card. | One convention per card. | Landing page, the GDP and CPI cards (also in the chat card for any chart with a provisional point). | Align the two strings (the marker mode is `provisionalOnly`, so the legend should name what the reader sees), or suppress the UI legend when the backend note is present. |
| 8 | P2 | `web/components/chart-notes.tsx` (editor mount) | Opening the note editor **never moves focus into it** — after clicking (or Space-ing) an "Add a note at …" point, `document.activeElement` is `BODY`. The editor mounts far below the chart, after the definition line, so a keyboard user is dropped at the top of the document and has to Tab past the whole card to reach the field they just opened. | Focus moves to the note field on open, and returns to the point on save/cancel. | Focus any "Add a note at …" point, press Space, read `document.activeElement`. | `ref.focus()` on the pending note field when it mounts; restore focus to the originating point on Save/Cancel. |
| 9 | P2 | `web/components/chart.tsx:914,1028,1122` (`onKeyDown` on the `role="button"` SVG points) | **Enter on a focused annotation point does nothing; Space works.** The handler accepts both keys, but with a real key press the editor opens only for Space — verified with a capture-phase listener showing the `Enter` keydown arriving at the right target and no editor appearing. | Enter and Space both activate, as on a real `<button>`. | Focus an "Add a note at …" point, press Enter → nothing; press Space → the editor opens. | Trace why the Enter branch does not reach `activate()` (an ancestor form/`keydown` handler swallowing Enter is the likely cause) and fix it there. |
| 10 | P2 | `web/app/embed/[token]/page.tsx` / `web/components/chart.tsx` embed mode | At a small embed size (320×240, a common sidebar unit) the **chart alone is 256 px tall in a 240 px frame** and the total content is 648 px — the chart is not fully visible, let alone the source line. The chart height does not adapt to the frame. | The chart scales to the iframe height. | Open the token URL at 320×240. | Make the embed chart height frame-relative (with a floor), instead of the fixed card height. |
| 11 | P3 | `web/components/chart-config-panel.tsx` (Colours tab, brand block) | "**Apply brand colours**" is always offered; with no brand key configured it fails **after** the click with "Fetching brand colours is not possible right now." Same shape as pass 1's row 12 (Embed). | Hidden or disabled with the reason, when no brand lookup is configured. | Chart → Style → Colours → Apply brand colours. | Gate the button on the same server-side condition the action checks. |
| 12 | P3 | `web/components/chart-config-panel.tsx:1845` + `messages.ts:523,1282` (`chart.panel.reset`) | A button whose **entire accessible name is "Default"** sits directly above "Save as my default". It is the *reset* control, but it reads as a state label. | "Reset to default". | Chart → Style; the button above the account row. | Rename the `chart.panel.reset` string in both languages. |
| 13 | P3 | `web/components/chart-notes.tsx:94-97` | Every saved note's delete control is named just "**Delete**" — with several notes a screen-reader user hears "Delete, Delete, Delete". | `aria-label="Delete the note at Jaarmutatie CPI · 2020"`. | Save two notes, read the button names. | Put the note's series + period into the accessible name. |
| 14 | P3 | Insights carousel + story stage step lists (`chart-story.tsx` / `chart-story-stage.tsx`) | The "Steps" / "Position in the story" buttons are named **by kind only**: `Notable low, Below average, Sharp rise, Sharp drop, Below average` — two buttons with the identical name, and none says which period it jumps to. | "Below average — 2021", "Below average — 2024". | Open Insights on any chart with two same-kind findings. | Append the finding's period to each step button's accessible name. |
| 15 | P3 | `web/components/chart.tsx` (headline error paragraph) | The headline error renders as a plain `<p class="mt-3 text-xs text-destructive">` with **no `role="alert"` and no `aria-live`** — a screen-reader user who presses "Suggest headline" gets silence. | Announced when it appears. | Trigger a headline failure, inspect the paragraph. | Add `role="alert"`. |
| 16 | P3 | answer-card feedback row (`web/components/chat.tsx`) | At 375 px the "**Helpful answer**" / "**Not helpful**" buttons measure **32×24 px** — well under the 44 px phone tap target the codebase enforces elsewhere (the Style and Show-chats triggers on the same screen are both exactly 44×44 via `max-sm:size-11`). | ≥ 44×44 at `<sm`. | 375×812, measure the two buttons' bounding boxes. | Give them the same `max-sm:size-11` treatment. |
| 17 | P3 | `web/components/chart-notes.tsx` (notes block heading) | Nothing on screen tells the user that notes are **session-only and never appear in any download or embed** — both are deliberate (ADR 038, see below), but the affordance reads like a normal annotation feature. Someone will annotate a chart, download it, and find the note gone. | One line under "Your notes (not CBS data)". | Save a note, open Download. | Add a muted line: "Notes stay in this session and are not included in downloads or embeds." |

## Needs a design decision (do **not** auto-dispatch)

| # | Sev | Where | What I saw | Why it needs a call |
|---|-----|-------|-----------|---------------------|
| 18 | P2 | `web/app/eurostat-explorer/page.tsx` (site footer) | The Eurostat explorer renders the global footer whose trust line reads "**Figures: CBS StatLine (CC BY 4.0) · Every number traceable to an official CBS table**" — on a page that is entirely about Eurostat. Harmless today (internal, flag-gated), but the same global footer will be wrong the day a Eurostat-sourced answer ships publicly. | The footer claim is deliberately CBS-only (rebrand decision, #7/#207). Making it source-aware is a product-voice change, tied to when Eurostat goes public (ADR 048). |
| 19 | P2 | `web/app/embed/[token]/page.tsx` attribution line | Every embed's footer reads "Frozen on 2026-09-17 · **Never go stale — go Pro** · checkdecijfers.nl" — a paid-upgrade pitch riding inside a third party's article, next to the CBS attribution. | Plausibly deliberate (ADR 041 growth loop), but it mixes a commercial message into the trust line a journalist is vouching for. Owner call. |

## What works well (do not "fix" these)

The **Chart style modal is in good shape**: pass 1's duplicate Close is gone (one control now), all
five tabs (Templates / Chart / Colours / Font / Frame) render and switch cleanly, the modal is
properly named and modal (`aria-modal`, `aria-labelledby` → the real `<h2>`), **Save as my default →
"Saved." → Forget my default → "Forgotten."** round-trips correctly with a `role="status"` line, and
at 375 px it fits the phone (343×780, no horizontal scroll). Pass 1's rows **4** (sidebar date
headings — now "TODAY"), **5** (dock tab — now "Chart 1"), **6** and **15** (composer chips now
`aria-disabled` with visible hints) are verified fixed. Pass 1's row **19** is fixed and the new
labelling is correct: the CPI series' mean is 4,22 and the carousel now reads "Notable low 2020:
1,3 %" then "**Below average** 2021: 2,7 %" — no non-low is called a low. The **embed page degrades
honestly**: `?theme=dark` works, `?form=hbar` is ignored for a time series rather than drawing a
misleading chart, and `?live=1` without Pro silently stays "Frozen on …". The **story stage** is
otherwise solid — `aria-modal`, body scroll locked, ArrowDown/ArrowUp step it, Escape closes it and
restores the trigger, and `aria-current="step"` tracks the position. The **Eurostat explorer's empty
state is exemplary**: it states that the adapter and migrations are verified and applied and that
this is "a genuinely empty state, not a missing prerequisite", and names the exact RUNBOOK step to
register a table. **Zero console errors** across every surface in this pass (18 messages, 0 errors,
0 React warnings; the only warnings are a Next dev CSS-preload notice), and **no horizontal scroll**
at 375 px or in the embed at 320 px.

## Surfaces I could NOT reach, and why

- **Small multiples** (`chart-small-multiples.tsx`) — the toggle needs `form === 'line'` **and**
  `series.length > 1`; no fixture question in `tests/fixtures/llm/` produces a multi-series line
  chart, so the control never appears in the harness.
- **Region-set answer rendering** (the coverage line, sorted hbar, 26-series default form) — the
  harness has **no intent-injection hook** (`ask.mjs` only posts a question string), and the two
  candidate fixture questions route elsewhere: "Welke van de G4-gemeenten…" returns the meta
  capability reply, and "Vergelijk … Amsterdam en Rotterdam" never reached `askQuestion`.
- **`/eurostat-explorer` beyond the empty state** — no Eurostat table is registered in the CBS
  fixture snapshot, so the dataset picker, filters, table+chart, CSV export and proof panel have
  nothing to render. Registering one needs the real `registerTables`/`syncTable` path (RUNBOOK
  "WP30c E1" step 4), which is out of scope for an audit.
- **The journalist headline's happy path** (ADR 050: drafted text, editing, the digit-free honesty
  guard, how it exports/embeds) — `draftChartHeadline` is an LLM call with no fixture, so only the
  failure path was observable (rows 6 and 15 above).
- **Insights phrasing stub** — same reason; the phrasing call misses the fixture set, so the cards
  fall back to the deterministic kind + value labels (which is what rows 14 and pass 1's row 19 were
  judged on).
- **Chart notes persisting across a thread switch** — moot: ADR 038 makes them session-only in-memory
  state by design.

## Checked and deliberately **not** reported

- **Notes have no edit, never appear on the chart itself, and are absent from every PNG/SVG/PDF/embed
  export.** All three are explicit ADR 038 decisions (§Decision and alternative 3: `ChartNotes`
  mounts *outside* the exported container precisely so a personal note can never be mistaken for CBS
  data on a shared screenshot; option **E** and **F** in Consequences). Only the missing disclosure
  is reported, as row 17.
- **"Which sources are built in?" looks like a non-interactive line in the accessibility tree** — it
  is a native `<details>/<summary>`, fully keyboard-operable.
- **The Style dialog appearing unnamed in the accessibility snapshot** — `aria-labelledby` resolves
  to the real `<h2>Chart style</h2>`; a snapshot-rendering artifact.
- **"Style" and "Show chats" appearing absent at 375 px** — both are icon-only buttons with the label
  in `aria-label`; both measure 44×44.
- **`?form=hbar` ignored on a time series** — correct: horizontal bars are deliberately disallowed
  for non-region charts (the same rule that disables the tab).
- **Screenshot tooling timing out on the story stage** — a 5 s Playwright screenshot budget, not an
  app defect (`document.getAnimations()` is empty once the stage settles).

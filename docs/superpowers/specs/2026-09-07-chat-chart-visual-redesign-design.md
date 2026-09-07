# Chat + chart visual redesign — sub-project 1 of 3 (visual polish)

Date: 2026-09-07. Owner: Stefan (product owner), in-chat, session 87.

## Context

Owner asked to improve the UI, the look of the graphs, and the overall
chat/chart experience — including, eventually, adjusting a graph by chatting.
That request was decomposed (brainstorming session, 2026-09-07) into three
sequenced sub-projects:

1. **Visual polish** (this spec) — restyle chat + charts, no new backend
   behavior.
2. Chat interaction polish (streaming, affordances) — not yet designed.
3. Conversational chart editing for CBS charts — new capability, pulled into
   scope (owner decision, this session); `docs/03-mvp-scope.md` needs its
   "interactive chart studio" non-goal row updated when that sub-project is
   designed. Not yet designed.

This spec covers **sub-project 1 only**. It is a presentation-layer change:
no new data, no new pipeline behavior, no new invariants at stake beyond
"don't change what a number means or how it's sourced" (R1–R3, R5, R9–R10 in
`docs/05-data-rules.md` are about data correctness, not styling — this work
must not touch `src/` or any `web/backend/` (`src/` symlink) code at all).

## Decisions (all confirmed in-chat, 2026-09-07)

- **Component foundation**: adopt shadcn/ui (Tailwind v4-compatible), neutral
  base color, no custom brand theme. Add `next-themes` for light/dark
  toggling.
- **Identity change**: the "papier & inkt" house style
  (`docs/12-huisstijl.md`) is **retired**, replaced by the plain shadcn
  neutral look. `docs/12-huisstijl.md` must be rewritten (not just
  patched) to record this as the new decided direction — this is a real
  identity change, not incidental cleanup.
- **Chosen visual direction**: mockup **Option B ("Inset Cards")** from the
  3-option comparison built this session (published artifact
  `9682077c-d5be-4598-a832-f32553d582de`, mockup source kept at
  `docs/superpowers/specs/assets/2026-09-07-redesign-mockups.html` — copy it
  there before the scratchpad is cleaned up). Characteristics: sidebar on a
  grey ground with a search field and dense thread rows; chat and the chart
  dock render as two separate cards, each with its own header bar (thread
  title, theme control); user messages are outlined cards; dock uses
  underline tabs plus a Chart/Table switch.
  - **Owner amendment 1**: in Option B's mockup the row of chips (source
    toggles — "CBS data" / "Internet" — plus "Add link" / "Upload file" /
    the disabled "soon" affordances) sat *above* the message input. Move
    that row to sit **below** the input instead.
  - **Owner amendment 2**: Option B's mockup used a small `[+]` icon button
    for "new chat", next to the search field. Replace it with a full
    **"New chat" text button placed above the "Search chats" field**,
    matching the search field's width and height exactly (same sidebar
    column, stacked: New chat button, then Search chats field, then the
    thread list).
  - **Owner amendment 3**: the chip row (see amendment 1 — now below the
    input) must include a disabled "Connect database" chip labeled/marked
    **SOON**, placed immediately to the right of "Upload file". This is not
    new functionality — it is the existing disabled "Databron verbinden /
    Binnenkort beschikbaar: verbind een databron (bijv. Google Sheets)"
    affordance already in the current app (`web/components/chat.tsx`),
    carried into the redesign under its English copy, positioned right
    after Upload file. Final chip row order: CBS data, Internet, Add link,
    Upload file, Connect database (soon).
- **Chat screen content removal** (chat screen only — the logged-out landing
  page, `web/components/landing.tsx`, keeps its own copy untouched):
  - Remove the "Over dit project" paragraph currently rendered in
    `web/components/workspace.tsx:336`.
  - Remove the 3 example-question chips currently rendered on the empty
    chat state in `web/components/chat.tsx`.
  - The empty chat state becomes a bare composer, no explanatory copy, no
    example chips — reads as a blank LLM chat screen.
- **Message bubbles**: user messages as a subtle/outlined card aligned
  right; assistant messages as plain text aligned left. Replaces today's
  bordered-box-for-every-message style.
- **Charts**: keep Recharts as the library. Use Recharts' **basic/default**
  styling (default categorical palette, default gridlines/axis labels) —
  explicitly **do not** design or keep a custom restyled palette. This
  supersedes an earlier in-chat exploration of a custom neutral-palette
  chart restyle; the owner's final call was "use the basic Recharts style."
  The existing colorblind-safe-palette property is **not** a hard
  requirement to preserve past this point — Recharts' own default palette is
  the new baseline; if it happens to be colorblind-unsafe, that's an
  accepted trade-off of this decision (not something to silently
  work around by re-introducing a custom palette).
- **Dark mode**: required, light + dark, via `next-themes`.
- **Structure**: unchanged — left sidebar (past conversations, grouped by
  day, "New chat" button), center chat column, right-hand dock panel for
  charts/tables with tabs when more than one visual exists in a thread. Only
  the visual treatment changes, not the component tree's responsibilities
  (`VisualDock`, `ThreadSidebar`, `ChartView`, `UserChartView`, `StatCard`
  keep their existing props/behavior contracts).

## Explicitly out of scope for this spec

- Sub-projects 2 (chat interaction polish: streaming, affordances) and 3
  (conversational chart editing for CBS charts) — separate specs, separate
  brainstorming rounds.
- Any change to `src/` (the deterministic backend — chart-spec building,
  answer computation, CBS access). This spec is `web/components/*` and
  `web/app/globals.css` only, plus the doc updates named below.
- Any change to the dataset-chat / `UserChartView` *data* behavior (ADR 037)
  — only its visual chrome is restyled, same as every other component here.

## Surface (files expected to change)

- New: shadcn/ui scaffolding (`web/components.json`, `web/components/ui/*`
  as generated by the shadcn CLI), `next-themes` dependency + a
  `ThemeProvider`/theme-toggle component.
- Rewritten token layer: `web/app/globals.css` (shadcn's CSS-variable tokens
  for light + dark, replacing the `--paper`/`--ink`/`--accent`/etc. layer).
- Restyled (visual only, behavior/props unchanged unless a prop is purely
  presentational): `web/components/chat.tsx`, `workspace.tsx`,
  `thread-sidebar.tsx`, `chart.tsx`, `chart-small-multiples.tsx`,
  `user-chart.tsx`, `stat-card.tsx`, `visual-dock.tsx`, `site-header.tsx`,
  `site-footer.tsx`.
- Content removal: the "Over dit project" block (`workspace.tsx`) and the
  example-question chips (`chat.tsx`), chat screen only.
- Docs: `docs/12-huisstijl.md` rewritten; `docs/STATUS.md`,
  `docs/08-build-plan.md`, `docs/lessons-learned.md` updated per the
  session's normal definition-of-done once built and verified.

## Verification

- Full web test suite must stay green throughout. Existing tests are
  role/text-based (not brittle className assertions, per a spot check of
  `visual-dock.test.tsx`) — update test expectations only where they assert
  copy that this spec explicitly removes (the "Over dit project" text, the
  example-question chip labels) or structure that intentionally changes
  (e.g. bubble markup). Never change a test's behavioral assertion (data
  shown, honesty bindings, PNG export, ARIA roles/labels used for a11y) to
  make it pass — if a test conflicts with something this spec did NOT ask
  to change, that is a bug to fix in the implementation, not the test.
- `npx tsc --noEmit` clean, real `next build` clean, full backend suite
  (untouched, but run as the standing verification-block practice) green.
- Visual check in the dev server: empty state, mid-conversation with a
  docked chart, light mode, dark mode.
- `/code-review` LOW pass on the diff before any push (repo standing rule).

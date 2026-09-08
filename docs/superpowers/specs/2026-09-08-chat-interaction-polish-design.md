# Chat interaction polish — loading skeletons + resizable chart panel

Design spec for the concrete slice of sub-project 2 ([#210](../../open-questions.md)/[#211](../../open-questions.md)) that the owner approved building, 2026-09-08. Brainstormed conversationally with the owner; this doc is the durable record.

**As shipped, 2026-09-08:** everything below built as designed EXCEPT the resizable panel's cross-visit persistence (§5) — real-browser verification found `react-resizable-panels@4.12.4`'s own layout-restore path genuinely broken (a saved width comes back swapped/wrong on reload, violating the chat panel's own configured minimum). Owner decision: ship drag-to-resize without persistence rather than chase a defect in a very recent library release. The `autoSaveId`/localStorage mechanism §5 describes was never actually available in the installed version anyway (see the implementation plan's Task 6 for the real, verified API) — persistence was attempted via `useDefaultLayout` instead, then dropped for the reason above. See [docs/superpowers/plans/2026-09-08-chat-interaction-polish.md](../plans/2026-09-08-chat-interaction-polish.md) for the full trace.

## Scope

Two independent UI-feedback features, both **pure client-side polish** — no answer-pipeline, billing, or CBS-data code touched, so no invariant (R1–R11) is at risk and no ADR is needed (mechanical UI choice, same class as the sidebar auto-collapse fix in [#213](../../open-questions.md)).

1. **Loading skeletons** in the three spots that currently show weak or no feedback:
   - Chat answer area (today: a single plain-text busy line, no spinner).
   - Chart panel (today: nothing — the panel just pops in fully-formed once the answer resolves).
   - Thread switching in the sidebar (today: zero feedback while `loadMyThread` awaits).
2. **Resizable chart panel** — drag-to-resize the right-hand visual dock's width, remembered across visits.

### Explicitly out of scope (not part of this increment)

- **Real token-by-token streaming of the LLM answer.** This was the original framing of sub-project 2 in [#211](../../open-questions.md); the owner's actual complaint was missing loading *feedback*, not the absence of live-typed text. Skeletons resolve that without touching the pipeline at all, so the streaming-vs-validate-after-generate architectural tension recorded in #211 remains genuinely unresolved and undecided — this spec does not attempt to settle it.
- The other friction points [#211](../../open-questions.md) flagged (clarification-chip legibility, fill-don't-send follow-up chips, inconsistent attachment-row affordance states) — untouched, remain open.
- The `--muted-foreground` contrast residual from sub-project 1 — untouched, remains open.

## 1. Skeleton primitive

Add shadcn's stock `Skeleton` component (`web/components/ui/skeleton.tsx`) — a themed `animate-pulse` div, consistent with sub-project 1's "stock shadcn, no custom theme" decision. No new npm dependency.

## 2. Chat answer skeleton

`web/components/chat.tsx` (~line 942–953): while `busy` is true, add a skeleton "answer card" — a few pulsing placeholder lines shaped like a text answer — below today's busy-text line, not instead of it. **Keep the existing text.** It isn't decorative: it differentiates "searching CBS," "searching CBS and the web," and "searching the web only" (an explicit owner-requested honesty fix from the WP129+130 go-live, 2026-07-12, predating this redesign) — dropping it would silently remove that distinction. The skeleton adds visual weight to an already-correct message; it doesn't replace it.

## 3. Chart panel skeleton

Only applies when the dock is **already open** from an earlier turn in the same conversation — matches the owner's explicit call: on a brand-new question with no dock yet, we don't know a chart is coming, so nothing should imply one is.

This falls out naturally from existing state: `Workspace`'s `showDock` (`workspace.tsx:96`) is `isWide && visuals.length > 0` — true only once at least one visual already exists. Pass the existing `chatBusy` state (`workspace.tsx:88`, already wired to `ThreadSidebar`) into `VisualDock` as a new `busy` prop. `VisualDock` (`visual-dock.tsx`), when `busy` is true, renders a skeleton chart shape in place of the active visual's content (the `<div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4">` block, `visual-dock.tsx:91–99`) instead of `ChartView`/`UserChartView`/`StatCard`. Tabs stay as they are — this is visual feedback only, not a correctness change.

## 4. Thread-switch skeleton

`Workspace.selectThread` (`workspace.tsx:150–178`) currently awaits `loadMyThread` with no feedback. Add a `threadLoading` boolean state, set `true` immediately before the `await`, `false` in a `finally` after it resolves (covers the `kind === 'empty'` early-return path too). In the chat `<section>` (`workspace.tsx:296–361`), render a skeleton message list (a few placeholder message bubbles) instead of `<Chat>`/`<DatasetChat>` while `threadLoading` is true.

## 5. Resizable chart panel

Add `react-resizable-panels` (the library shadcn's own `Resizable` component wraps) plus shadcn's `Resizable` component (`ResizablePanelGroup`, `ResizablePanel`, `ResizableHandle` — `web/components/ui/resizable.tsx`).

Layout change in `workspace.tsx:283–368`: the sidebar stays a plain fixed-width div (its own separate collapse mechanism, untouched). The chat `<section>` and the dock `<div>` — currently plain flex siblings — become a `ResizablePanelGroup direction="horizontal"` **only when `showDock` is true**; when `showDock` is false, the chat section renders alone at full width exactly as today (no panel group, no resize handle with nothing to resize against).

- `ResizablePanel` (chat): `minSize` ~55% (chat must stay usable even at the dock's max width).
- `ResizableHandle` between them (shadcn's default — a thin border-colored bar, matches the app's existing borders).
- `ResizablePanel` (dock): `defaultSize={33}` (≈ today's `w-96`/384px on a typical ~1440px desktop viewport once the sidebar and gaps are subtracted), `minSize={18}` (chart stays legible), `maxSize={40}` (chat never gets squeezed to something unusable) — all percentages of the group's width, so it scales sensibly across screen sizes rather than a fixed pixel range.
- `autoSaveId="dock-panel-width"` on `ResizablePanelGroup` — `react-resizable-panels`' own built-in localStorage persistence (no custom width-storage code needed; if the stored value is missing/invalid it silently falls back to `defaultSize`, so no separate error handling required).

## Testing

- Component tests (web suite): `Chat` renders the skeleton while `busy`, real content otherwise; `VisualDock` renders the skeleton when `busy` and hides the real visual, shows the real visual when not busy; `Workspace.selectThread` sets/clears `threadLoading` around the await (including the `empty`-thread early return) and the skeleton message list renders meanwhile.
- Resizable panel: a render-level test confirming the panel group only mounts when `showDock`, and that `minSize`/`maxSize`/`autoSaveId` props are wired — full drag-gesture behavior is the library's own tested surface, not re-tested here.
- Full definition-of-done per `CLAUDE.md`: both typechecks, full web suite, `next build` clean, `/code-review` LOW clean, and a real browser check (light/dark, the three skeleton spots, dragging the resize handle, a reload confirming the remembered width) before calling this done — no UI change ships on test-suite evidence alone.

## Docs impact

- [docs/open-questions.md](../../open-questions.md) row [#211](../../open-questions.md): record this concrete increment as decided+built, keep the streaming question and the other friction points explicitly open (not resolved by this work).
- [docs/STATUS.md](../../STATUS.md): top-block update once built and shipped, with measured results.
- No ADR — mechanical UI choice using already-adopted stock-shadcn conventions, no invariant or architecture decision at stake.

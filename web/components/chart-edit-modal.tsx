// The shared popup shell for chart-editing surfaces (Style, Embed) — owner
// ask, session 101 (2026-09-13, owner present): "graphs edit and embed
// things in a popup instead of inside the right panel" (open-questions
// #243). A REAL modal: Base UI's Dialog (the same primitive
// chart-embed-dialog.tsx already proved out in this stack — role="dialog",
// aria-modal, focus-trap/restore, Escape and backdrop-click both close),
// with the chart on the left and the feature's own controls on the right.
//
// This is deliberately NOT a repeat of the session-92 floating Style panel
// (ADR 039 addendum, reverted session 94 on owner feedback): that one was a
// non-modal `role="dialog"` with no `aria-modal`, positioned beside a chart
// that stayed live and interactive behind it, and outside-click did nothing
// on purpose ("the reader is adjusting the chart behind it"). This shell is
// the opposite on every one of those points — a true modal, the page inert
// behind it, backdrop-click closes it — matching how the Embed dialog
// already behaved before this change. The chart itself moves INTO the
// popup's left pane — chart.tsx lifts its own canvas/legend/notes JSX into
// local consts and renders that SAME value in exactly ONE of two possible
// positions per render (its normal dock slot, or here) depending on
// whether this modal is open, so there is only ever one live instance —
// never two simultaneously-mounted copies needing their DOM ids kept apart.
//
// Below `lg` the two columns stack (chart on top, controls under it) — a
// side-by-side split has no room under ~1024px (open-questions #243(d)).
//
// WP-LOOK part (b) (session 143, 2026-09-29, ADR 063 — owner GO on the
// plain-English design): the shell grew a HEADER ROW and a FOOTER slot.
// The header holds the title on the left and the caller's `headerActions`
// (undo · redo · history) on the right, next to the dialog's own close
// button; the footer sits under the right-hand column and stays visible
// while that column scrolls (the "ask to change" box and the Klaar button).
// The right column is a flex column for exactly that reason: `children`
// scroll in the middle, `footer` is pinned below. Nothing here decides what
// goes into the slots — chart.tsx does.
//
// This shell does NOT manage initial focus itself beyond what the Dialog
// primitive already does (focus the popup, trap Tab inside it) — it makes
// no assumption about which pane a caller wants focused first, and it
// deliberately does NOT reorder `chartSlot`/`children` in the DOM to chase
// that (a CSS `order` swap would decouple visual position from DOM/tab
// order, its own accessibility footgun — LOW code-review finding). A
// caller whose controls pane needs the FIRST focus, not the chart pane
// Base UI's own "first focusable descendant" default would otherwise land
// on, is responsible for focusing its own active control on mount — see
// `ChartConfigPanel`'s own mount-time tab focus.
import type { KeyboardEventHandler, ReactNode } from 'react';
import { Dialog, DialogContent, DialogTitle } from './ui/dialog.tsx';

export function ChartEditModal({
  open,
  onClose,
  title,
  closeLabel,
  headerActions,
  chartSlot,
  children,
  footer,
  onKeyDown,
}: {
  open: boolean;
  onClose: () => void;
  /** The dialog's accessible name, rendered as a real, visible heading —
   * matching Embed's own pre-existing visible title (chart-embed-dialog.tsx)
   * rather than hiding it: a popup benefits from a plain confirmation of
   * what it is, even when its own content (a tablist, say) also implies it.
   * A caller with no visible-heading need of its own may still pass a
   * visually-hidden node instead; the shell renders whatever `title` is
   * given as-is, without an opinion. Spans both columns on wide viewports
   * so a visible title reads as one header over the whole popup, not
   * squeezed into the chart column alone. */
  title: ReactNode;
  /** Session 110 UX audit pass 3, row 7: forwarded verbatim to
   * DialogContent's own `closeLabel` — optional, so a caller with no
   * language of its own to thread (there is none today) can still omit it
   * and fall back to DialogContent's ambient-context default. Both of this
   * shell's real callers (chart.tsx, chart-embed-dialog.tsx) already resolve
   * `title` via their own explicit `t(lang, …)` call above; passing the same
   * resolved `t(lang, 'common.close')` here keeps the × in the SAME
   * language as everything else those callers render, exactly like `title`
   * already does, rather than relying on an ambient LangProvider those
   * callers deliberately don't depend on (see chart-embed-dialog.tsx's own
   * header comment on that convention). */
  closeLabel?: string;
  /** Part (b): controls that belong to the whole popup, rendered in the
   * header row right of the title (chart.tsx passes undo · redo · history).
   * Leaves room for the dialog's own absolute-positioned close button. */
  headerActions?: ReactNode;
  /** Left pane (top on phone): the live chart (+ legend) — chart.tsx's own
   * lifted canvas/legend/notes, the exact same rendered output shown in
   * the dock, relocated here rather than duplicated (see the file header). */
  chartSlot: ReactNode;
  /** Right pane (below the chart on phone): the feature's own controls
   * (ChartConfigPanel's tabs, or the Embed dialog's fields). */
  children: ReactNode;
  /** Part (b): pinned under the right pane, visible while `children`
   * scroll — the co-pilot input and the Klaar button. */
  footer?: ReactNode;
  /** WP-LOOK part (a) (session 142): the card's own keyboard handler (⌘Z /
   * ⇧⌘Z / Ctrl+Y undo-redo) re-attached to the popup's content — the dialog
   * is a portal OUTSIDE the card's DOM, so a shortcut pressed while the
   * reader is editing inside it never bubbled to the card root before. */
  onKeyDown?: KeyboardEventHandler<HTMLDivElement>;
}) {
  if (!open) return null;
  return (
    <Dialog
      open
      onOpenChange={(next: boolean) => {
        if (!next) onClose();
      }}
    >
      <DialogContent
        aria-modal="true"
        closeLabel={closeLabel}
        onKeyDown={onKeyDown}
        className="grid max-h-[calc(100vh-2rem)] w-full max-w-[calc(100%-2rem)] grid-cols-1 gap-4 overflow-y-auto p-5 sm:max-w-2xl sm:p-6 lg:max-h-[88vh] lg:max-w-6xl lg:grid-cols-[minmax(0,1.15fr)_minmax(22rem,1fr)] lg:grid-rows-[auto_minmax(0,1fr)] lg:gap-x-6 lg:overflow-hidden"
      >
        {/* Header row: title left, the caller's actions right. `pr-10` keeps
          * the actions clear of the dialog's own × (absolute, top-2 right-2). */}
        <div className="flex min-w-0 items-center justify-between gap-3 pr-10 lg:col-span-2" data-slot="chart-edit-header">
          <DialogTitle className="min-w-0 truncate">{title}</DialogTitle>
          {headerActions ? <div className="flex shrink-0 items-center gap-1">{headerActions}</div> : null}
        </div>
        {/* WP-LOOK part (a) (session 142): the chart column scrolls on its own
          * at desktop width too — with the notes / goal-line / period-range
          * strips under the chart, a 720–800 px laptop window otherwise put
          * the note form and "Periode markeren" below an unreachable fold
          * (found by the Playwright smoke). */}
        <div className="min-w-0 lg:min-h-0 lg:overflow-y-auto" data-slot="chart-edit-chart-column">
          {chartSlot}
        </div>
        <div className="flex min-w-0 flex-col gap-3 lg:min-h-0" data-slot="chart-edit-controls-column">
          <div className="min-w-0 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:pr-1">{children}</div>
          {footer ? (
            <div className="shrink-0 border-t border-border pt-3" data-slot="chart-edit-footer">
              {footer}
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

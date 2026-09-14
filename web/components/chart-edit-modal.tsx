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
import type { ReactNode } from 'react';
import { Dialog, DialogContent, DialogTitle } from './ui/dialog.tsx';

export function ChartEditModal({
  open,
  onClose,
  title,
  chartSlot,
  children,
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
  /** Left pane (top on phone): the live chart (+ legend) — chart.tsx's own
   * lifted canvas/legend/notes, the exact same rendered output shown in
   * the dock, relocated here rather than duplicated (see the file header). */
  chartSlot: ReactNode;
  /** Right pane (below the chart on phone): the feature's own controls
   * (ChartConfigPanel's tabs, or the Embed dialog's fields). */
  children: ReactNode;
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
        className="grid max-h-[calc(100vh-2rem)] w-full max-w-[calc(100%-2rem)] grid-cols-1 gap-4 overflow-y-auto p-6 sm:max-w-2xl sm:p-8 lg:max-h-[85vh] lg:max-w-5xl lg:grid-cols-[minmax(0,1fr)_22rem] lg:overflow-visible"
      >
        <DialogTitle className="lg:col-span-2">{title}</DialogTitle>
        <div className="min-w-0">{chartSlot}</div>
        <div className="min-w-0 lg:max-h-[85vh] lg:overflow-y-auto">{children}</div>
      </DialogContent>
    </Dialog>
  );
}

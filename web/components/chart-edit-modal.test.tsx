// The shared popup shell (chart.tsx's Style panel and, potentially, other
// chart-editing surfaces mount their content through this). Proves the
// GENERIC contract only — real dialog semantics (role, Escape/backdrop
// close via onClose, an accessible name from `title`), the two-pane
// chart/children layout, and hidden-when-closed — mirroring
// chart-embed-dialog.test.tsx's own precedent for testing a Base-UI-Dialog
// -based component (render for real, no mocking the dialog itself). Each
// FEATURE's own content (ChartConfigPanel's tabs, say) is that feature's own
// test file's job, not this one's.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChartEditModal } from './chart-edit-modal.tsx';

afterEach(() => {
  cleanup();
});

describe('ChartEditModal', () => {
  it('renders nothing when closed', () => {
    render(
      <ChartEditModal open={false} onClose={() => {}} title="Chart style" chartSlot={<p>chart</p>}>
        <p>controls</p>
      </ChartEditModal>,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText('chart')).toBeNull();
    expect(screen.queryByText('controls')).toBeNull();
  });

  it('opens as a real, modal dialog with both the chart slot and the controls children visible', () => {
    render(
      <ChartEditModal open onClose={() => {}} title="Chart style" chartSlot={<p>the chart</p>}>
        <p>the controls</p>
      </ChartEditModal>,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByText('the chart')).toBeInTheDocument();
    expect(screen.getByText('the controls')).toBeInTheDocument();
  });

  it("takes its accessible name from `title`", () => {
    render(
      <ChartEditModal open onClose={() => {}} title="Chart style" chartSlot={<p>chart</p>}>
        <p>controls</p>
      </ChartEditModal>,
    );
    expect(screen.getByRole('dialog', { name: 'Chart style' })).toBeInTheDocument();
  });

  it('calls onClose on Escape', () => {
    const onClose = vi.fn();
    render(
      <ChartEditModal open onClose={onClose} title="Chart style" chartSlot={<p>chart</p>}>
        <p>controls</p>
      </ChartEditModal>,
    );
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calling the parent-owned onClose is what actually closes it — a controlled component, like ChartConfigPanel', () => {
    // The Escape test above proves the Dialog primitive REQUESTS a close;
    // this proves ChartEditModal has no state of its own to grant that
    // request — the caller (chart.tsx) owns `open` and must act on it, same
    // contract ChartConfigPanel's own `open`/`onOpenChange` already used.
    const { rerender } = render(
      <ChartEditModal open onClose={() => {}} title="Chart style" chartSlot={<p>chart</p>}>
        <p>controls</p>
      </ChartEditModal>,
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    rerender(
      <ChartEditModal open={false} onClose={() => {}} title="Chart style" chartSlot={<p>chart</p>}>
        <p>controls</p>
      </ChartEditModal>,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  // Owner punch-list item 2 (session 102): the modal shell inherited the
  // base DialogContent's p-4 with no override, which read as cramped for a
  // popup this size — bumped to more breathing room on every viewport.
  it('gives the popup more padding than the bare DialogContent default (p-4)', () => {
    render(
      <ChartEditModal open onClose={() => {}} title="Chart style" chartSlot={<p>chart</p>}>
        <p>controls</p>
      </ChartEditModal>,
    );
    expect(screen.getByRole('dialog').className).toMatch(/\bp-6\b/);
  });

  // Session 110 UX audit pass 3, row 7: the shell's own × used to be a
  // hardcoded English "Close" regardless of language — every Dutch-UI modal
  // (this shell's own Style/Embed content included) announced "Close" as
  // its last accessible name. With no `closeLabel` given and no
  // LangProvider above it (this file's own convention, like every other
  // test here), DialogContent's ambient useT() falls back to its context
  // default ('nl', lang-provider.tsx) — proving the fix actually localizes
  // it, not just that it still reads "Close" by coincidence.
  it('the × close control reads the localized common.close label by default (no LangProvider: falls back to the nl context default)', () => {
    render(
      <ChartEditModal open onClose={() => {}} title="Chart style" chartSlot={<p>chart</p>}>
        <p>controls</p>
      </ChartEditModal>,
    );
    expect(screen.getByRole('button', { name: 'Sluiten' })).toBeInTheDocument();
  });

  // chart.tsx and chart-embed-dialog.tsx both resolve `title` via their own
  // explicit `t(lang, …)` call (no ambient LangProvider dependency, by
  // design — see chart-embed-dialog.tsx's header comment) and must be able
  // to do the exact same thing for the × — this is the plumbing that lets
  // them.
  it('an explicit closeLabel overrides the ambient default, matching how those callers already resolve `title`', () => {
    render(
      <ChartEditModal open onClose={() => {}} title="Chart style" closeLabel="Close" chartSlot={<p>chart</p>}>
        <p>controls</p>
      </ChartEditModal>,
    );
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sluiten' })).toBeNull();
  });
});

// Task 4 (spec Part B1): ChartEmbedButton/ChartEmbedDialog. Mirrors
// chart-download.test.tsx's mocking shape for the same footer-menu class of
// component: the Server Action (embed-actions.ts) and the usage-counter sink
// are both mocked at the module boundary; everything else (Dialog, Button)
// renders for real, because the dialog's OWN open/close/Escape/focus
// behaviour is exactly what this file exists to prove, not something a mock
// can stand in for.
//
// The real usage-counter sink chart.tsx fires 'frame_changed'/'story_open'
// etc. through is `trackChartStyleEvent` (web/lib/chart-usage-client.ts) —
// NOT `recordChartStyleEvent`, which was this suite's own placeholder guess
// before the real call sites were grepped. Mirrored here exactly.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { createEmbedCode } = vi.hoisted(() => ({ createEmbedCode: vi.fn() }));
vi.mock('../app/embed-actions.ts', () => ({ createEmbedCode }));

const { trackChartStyleEvent } = vi.hoisted(() => ({ trackChartStyleEvent: vi.fn() }));
vi.mock('../lib/chart-usage-client.ts', () => ({ trackChartStyleEvent }));

import { ChartEmbedButton } from './chart-embed-dialog.tsx';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ChartEmbedButton / ChartEmbedDialog', () => {
  it('opens the dialog on click and shows a loading state before the code is ready', async () => {
    createEmbedCode.mockReturnValue(new Promise(() => {})); // never resolves in this test
    render(<ChartEmbedButton auditId={42} tableId="83693NED" lang="en" />);
    fireEvent.click(screen.getByRole('button', { name: /embed/i }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/generating/i)).toBeInTheDocument();
  });

  it('fires embed_open exactly once per open, through the real trackChartStyleEvent sink', async () => {
    createEmbedCode.mockResolvedValue({ ok: true, token: '42.abc', pro: false });
    render(<ChartEmbedButton auditId={42} tableId="83693NED" lang="en" />);
    fireEvent.click(screen.getByRole('button', { name: /embed/i }));
    await screen.findByRole('dialog');
    expect(trackChartStyleEvent).toHaveBeenCalledWith('embed_open');
    expect(trackChartStyleEvent).toHaveBeenCalledTimes(1);
  });

  it('shows the generated <iframe> code once createEmbedCode resolves', async () => {
    createEmbedCode.mockResolvedValue({ ok: true, token: '42.abc', pro: false });
    render(<ChartEmbedButton auditId={42} tableId="83693NED" lang="en" />);
    fireEvent.click(screen.getByRole('button', { name: /embed/i }));
    await waitFor(() => expect(screen.getByText(/<iframe/)).toBeInTheDocument());
    expect(screen.getByText(/42\.abc/)).toBeInTheDocument();
    expect(createEmbedCode).toHaveBeenCalledWith(42);
  });

  it('shows an unavailable message when the action refuses', async () => {
    createEmbedCode.mockResolvedValue({ ok: false, reason: 'unavailable' });
    render(<ChartEmbedButton auditId={42} tableId="83693NED" lang="en" />);
    fireEvent.click(screen.getByRole('button', { name: /embed/i }));
    await waitFor(() => expect(screen.getByText(/not available/i)).toBeInTheDocument());
    expect(screen.queryByText(/<iframe/)).toBeNull();
  });

  it('disables the Live switch with a Pro-only reason when pro is false', async () => {
    createEmbedCode.mockResolvedValue({ ok: true, token: '42.abc', pro: false });
    render(<ChartEmbedButton auditId={42} tableId="83693NED" lang="en" />);
    fireEvent.click(screen.getByRole('button', { name: /embed/i }));
    const liveSwitch = await screen.findByRole('switch', { name: /live/i });
    expect(liveSwitch).toBeDisabled();
    expect(liveSwitch).toHaveAccessibleDescription(/pro/i);
  });

  it('enables the Live switch when pro is true, and the code gains &live=1 when it is toggled on', async () => {
    createEmbedCode.mockResolvedValue({ ok: true, token: '42.abc', pro: true });
    render(<ChartEmbedButton auditId={42} tableId="83693NED" lang="en" />);
    fireEvent.click(screen.getByRole('button', { name: /embed/i }));
    const liveSwitch = await screen.findByRole('switch', { name: /live/i });
    expect(liveSwitch).not.toBeDisabled();
    fireEvent.click(liveSwitch);
    expect(screen.getByText(/live=1/)).toBeInTheDocument();
  });

  it("changing the language option changes the code's lang= query param", async () => {
    createEmbedCode.mockResolvedValue({ ok: true, token: '42.abc', pro: false });
    // NB: `lang="nl"` here is the CHART's own display language (it only seeds
    // the dialog's `embedLang` default) — the trigger button itself is
    // therefore rendered as "Insluiten", not "Embed", so it is found here by
    // role alone (it is the only button on the page before the dialog
    // opens), not by an English-only name filter.
    render(<ChartEmbedButton auditId={42} tableId="83693NED" lang="nl" />);
    fireEvent.click(screen.getByRole('button'));
    await screen.findByText(/lang=nl/);
    fireEvent.click(await screen.findByRole('radio', { name: /english|engels/i }));
    expect(screen.getByText(/lang=en/)).toBeInTheDocument();
  });

  it('changing the colour option changes the code\'s theme= query param', async () => {
    createEmbedCode.mockResolvedValue({ ok: true, token: '42.abc', pro: false });
    render(<ChartEmbedButton auditId={42} tableId="83693NED" lang="en" />);
    fireEvent.click(screen.getByRole('button', { name: /embed/i }));
    await screen.findByText(/theme=light/);
    fireEvent.click(await screen.findByRole('radio', { name: /dark/i }));
    expect(screen.getByText(/theme=dark/)).toBeInTheDocument();
  });

  it('changing the chart-type option to "As shown" adds a form= query param from currentForm', async () => {
    createEmbedCode.mockResolvedValue({ ok: true, token: '42.abc', pro: false });
    render(<ChartEmbedButton auditId={42} tableId="83693NED" lang="en" currentForm="bar" />);
    fireEvent.click(screen.getByRole('button', { name: /embed/i }));
    await screen.findByText(/form=bar/);
    fireEvent.click(await screen.findByRole('radio', { name: /^default$/i }));
    expect(screen.queryByText(/form=bar/)).toBeNull();
  });

  it('Escape closes the dialog and refocuses the trigger', async () => {
    createEmbedCode.mockResolvedValue({ ok: true, token: '42.abc', pro: false });
    render(<ChartEmbedButton auditId={42} tableId="83693NED" lang="en" />);
    const trigger = screen.getByRole('button', { name: /embed/i });
    fireEvent.click(trigger);
    await screen.findByRole('dialog');
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it('re-fetches a fresh code the next time it is opened after being closed', async () => {
    createEmbedCode.mockResolvedValue({ ok: true, token: '42.abc', pro: false });
    render(<ChartEmbedButton auditId={42} tableId="83693NED" lang="en" />);
    const trigger = screen.getByRole('button', { name: /embed/i });
    fireEvent.click(trigger);
    const dialog = await screen.findByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(trigger);
    await screen.findByRole('dialog');
    expect(createEmbedCode).toHaveBeenCalledTimes(2);
    expect(trackChartStyleEvent).toHaveBeenCalledWith('embed_open');
    expect(trackChartStyleEvent).toHaveBeenCalledTimes(2);
  });
});

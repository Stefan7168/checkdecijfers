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
import { useState, type ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { createEmbedCode, startProSubscriptionCheckout } = vi.hoisted(() => ({
  createEmbedCode: vi.fn(),
  startProSubscriptionCheckout: vi.fn(),
}));
vi.mock('../app/embed-actions.ts', () => ({ createEmbedCode, startProSubscriptionCheckout }));

const { trackChartStyleEvent } = vi.hoisted(() => ({ trackChartStyleEvent: vi.fn() }));
vi.mock('../lib/chart-usage-client.ts', () => ({ trackChartStyleEvent }));

import { ChartEmbedButton, EMBED_DEFAULT_HEIGHT_PX } from './chart-embed-dialog.tsx';

beforeEach(() => {
  // Task 11 (#205): the real-world default everywhere except a session that
  // has explicitly flipped PRO_SUBSCRIPTIONS_ENABLED — every test below that
  // doesn't care about the flag-on branch gets the exact pre-Task-11
  // interest-tracking behaviour unchanged.
  startProSubscriptionCheckout.mockResolvedValue({ ok: false, reason: 'disabled' });
});

// Task 3 (chart-visual-embed-pass): ChartEmbedButton became a controlled
// component (open/onOpenChange lifted into chart.tsx's shared openPanel
// state) so its real caller can share one slot with Style/Story. This suite
// is about the dialog's OWN open/close/fetch/field behaviour, not about who
// owns the boolean, so a small local wrapper reintroduces that state the
// same way chart.tsx does — every `render(<ChartEmbedButton .../>)` call this
// suite used to make is now `render(<Uncontrolled .../>)` with otherwise
// identical props. `chartSlot` defaults to a plain stub div: none of these tests
// assert on the live-preview content itself (that is a real-browser check,
// per the task brief), only on the fieldset controls/generated code/dialog
// mechanics untouched by this task.
function Uncontrolled(props: Omit<ComponentProps<typeof ChartEmbedButton>, 'open' | 'onOpenChange' | 'chartSlot'>) {
  const [open, setOpen] = useState(false);
  return <ChartEmbedButton {...props} open={open} onOpenChange={setOpen} chartSlot={<div>chart preview</div>} />;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ChartEmbedButton / ChartEmbedDialog', () => {
  it('opens the dialog on click and shows a loading state before the code is ready', async () => {
    createEmbedCode.mockReturnValue(new Promise(() => {})); // never resolves in this test
    render(<Uncontrolled auditId={42} tableId="83693NED" lang="en" />);
    fireEvent.click(screen.getByRole('button', { name: /embed/i }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/generating/i)).toBeInTheDocument();
  });

  it('fires embed_open exactly once per open, through the real trackChartStyleEvent sink', async () => {
    createEmbedCode.mockResolvedValue({ ok: true, token: '42.abc', pro: false });
    render(<Uncontrolled auditId={42} tableId="83693NED" lang="en" />);
    fireEvent.click(screen.getByRole('button', { name: /embed/i }));
    await screen.findByRole('dialog');
    expect(trackChartStyleEvent).toHaveBeenCalledWith('embed_open');
    expect(trackChartStyleEvent).toHaveBeenCalledTimes(1);
  });

  it('shows the generated <iframe> code once createEmbedCode resolves', async () => {
    createEmbedCode.mockResolvedValue({ ok: true, token: '42.abc', pro: false });
    render(<Uncontrolled auditId={42} tableId="83693NED" lang="en" />);
    fireEvent.click(screen.getByRole('button', { name: /embed/i }));
    await waitFor(() => expect(screen.getByText(/<iframe/)).toBeInTheDocument());
    expect(screen.getByText(/42\.abc/)).toBeInTheDocument();
    expect(createEmbedCode).toHaveBeenCalledWith(42);
  });

  it('shows an unavailable message when the action refuses', async () => {
    createEmbedCode.mockResolvedValue({ ok: false, reason: 'unavailable' });
    render(<Uncontrolled auditId={42} tableId="83693NED" lang="en" />);
    fireEvent.click(screen.getByRole('button', { name: /embed/i }));
    await waitFor(() => expect(screen.getByText(/not available/i)).toBeInTheDocument());
    expect(screen.queryByText(/<iframe/)).toBeNull();
  });

  // #12 (session 110 UX audit): whether embedding is available is only known
  // AFTER this server round trip (EMBED_TOKEN_SECRET is a server-only env
  // check inside createEmbedCode) — there is no earlier render-time signal
  // the BUTTON itself could gate on. The dialog stays the honest fallback,
  // but the message reads as a disabled-state hint (muted), never as a red
  // destructive error — the reader did nothing wrong.
  it('styles the unavailable message as a neutral hint, not a red error', async () => {
    createEmbedCode.mockResolvedValue({ ok: false, reason: 'unavailable' });
    render(<Uncontrolled auditId={42} tableId="83693NED" lang="en" />);
    fireEvent.click(screen.getByRole('button', { name: /embed/i }));
    const message = await screen.findByText(/not available/i);
    expect(message.className).not.toContain('text-destructive');
    expect(message.className).toContain('text-muted-foreground');
  });

  // Minor #3 (opus review): a rejected Server Action promise must not leave
  // the dialog stuck on "loading" forever with an unhandled rejection — it
  // should collapse to the same terminal 'unavailable' state as { ok: false }.
  it('shows the unavailable message (not stuck loading) when createEmbedCode rejects', async () => {
    createEmbedCode.mockRejectedValue(new Error('network error'));
    render(<Uncontrolled auditId={42} tableId="83693NED" lang="en" />);
    fireEvent.click(screen.getByRole('button', { name: /embed/i }));
    await waitFor(() => expect(screen.getByText(/not available/i)).toBeInTheDocument());
    expect(screen.queryByText(/generating/i)).toBeNull();
  });

  it('disables the Live switch with a Pro-only reason when pro is false', async () => {
    createEmbedCode.mockResolvedValue({ ok: true, token: '42.abc', pro: false });
    render(<Uncontrolled auditId={42} tableId="83693NED" lang="en" />);
    fireEvent.click(screen.getByRole('button', { name: /embed/i }));
    const liveSwitch = await screen.findByRole('switch', { name: /live/i });
    expect(liveSwitch).toBeDisabled();
    expect(liveSwitch).toHaveAccessibleDescription(/pro/i);
  });

  // Session 101 (open-questions #237(b)/#205): the visible Pro pitch and its
  // interest-only "upgrade" click — no charge, a real click count. Task 11:
  // this is now the FLAG-OFF branch specifically — startProSubscriptionCheckout
  // resolves `disabled` (the beforeEach default), so the click falls through
  // to the original tracking-only behaviour, unchanged.
  it('shows the price and an upgrade CTA when pro is false, tracks pro_upgrade_click and shows thanks on click, and shows neither when pro is true', async () => {
    createEmbedCode.mockResolvedValue({ ok: true, token: '42.abc', pro: false });
    render(<Uncontrolled auditId={42} tableId="83693NED" lang="en" />);
    fireEvent.click(screen.getByRole('button', { name: /embed/i }));
    await screen.findByRole('dialog');
    expect(screen.getByText(/€19\/month/)).toBeInTheDocument();
    const upgradeButton = screen.getByRole('button', { name: /interested in pro/i });
    fireEvent.click(upgradeButton);
    await waitFor(() => expect(trackChartStyleEvent).toHaveBeenCalledWith('pro_upgrade_click'));
    expect(startProSubscriptionCheckout).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/thanks/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /interested in pro/i })).toBeNull();
  });

  // Task 11 (#205): PRO_SUBSCRIPTIONS_ENABLED on — the click opens a real
  // Stripe Checkout redirect instead of the interest-only tracking above.
  it('redirects to the real Checkout URL when startProSubscriptionCheckout succeeds, without tracking pro_upgrade_click', async () => {
    createEmbedCode.mockResolvedValue({ ok: true, token: '42.abc', pro: false });
    startProSubscriptionCheckout.mockResolvedValue({ ok: true, url: 'https://checkout.stripe.com/session-xyz' });
    render(<Uncontrolled auditId={42} tableId="83693NED" lang="en" />);
    fireEvent.click(screen.getByRole('button', { name: /embed/i }));
    await screen.findByRole('dialog');
    const upgradeButton = screen.getByRole('button', { name: /interested in pro/i });

    // jsdom's window.location is non-configurable — full-object replacement
    // is the working idiom (same as chat.test.tsx's own reload() precedent).
    const original = window.location;
    Object.defineProperty(window, 'location', {
      value: { ...original, href: original.href },
      configurable: true,
      writable: true,
    });
    try {
      fireEvent.click(upgradeButton);
      await waitFor(() => expect(startProSubscriptionCheckout).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(window.location.href).toBe('https://checkout.stripe.com/session-xyz'));
      expect(trackChartStyleEvent).not.toHaveBeenCalledWith('pro_upgrade_click');
      expect(screen.queryByText(/thanks/i)).toBeNull();
    } finally {
      Object.defineProperty(window, 'location', { value: original, configurable: true, writable: true });
    }
  });

  // Task 11: the not_signed_in fail-safe (shouldn't happen — this dialog
  // only mounts for a signed-in embed creator) still falls through to the
  // original tracking behaviour rather than leaving the button inert.
  it('falls through to the interest-tracking behaviour when startProSubscriptionCheckout reports not_signed_in', async () => {
    createEmbedCode.mockResolvedValue({ ok: true, token: '42.abc', pro: false });
    startProSubscriptionCheckout.mockResolvedValue({ ok: false, reason: 'not_signed_in' });
    render(<Uncontrolled auditId={42} tableId="83693NED" lang="en" />);
    fireEvent.click(screen.getByRole('button', { name: /embed/i }));
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: /interested in pro/i }));
    await waitFor(() => expect(trackChartStyleEvent).toHaveBeenCalledWith('pro_upgrade_click'));
    expect(screen.getByText(/thanks/i)).toBeInTheDocument();
  });

  // Review fix round: the concrete bug traced by the reviewer — a transient
  // Stripe failure (checkout_failed) must reset checkingOut and fall
  // through exactly like disabled/not_signed_in, never leave the Upgrade
  // button stuck `disabled` with no message until the dialog is reopened.
  it('resets checkingOut and falls through to interest-tracking (button not left stuck disabled) when startProSubscriptionCheckout reports checkout_failed', async () => {
    createEmbedCode.mockResolvedValue({ ok: true, token: '42.abc', pro: false });
    startProSubscriptionCheckout.mockResolvedValue({ ok: false, reason: 'checkout_failed' });
    render(<Uncontrolled auditId={42} tableId="83693NED" lang="en" />);
    fireEvent.click(screen.getByRole('button', { name: /embed/i }));
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: /interested in pro/i }));
    await waitFor(() => expect(trackChartStyleEvent).toHaveBeenCalledWith('pro_upgrade_click'));
    expect(screen.getByText(/thanks/i)).toBeInTheDocument();
    // The CTA button is gone once `upgradeClicked` flips (replaced by the
    // thanks message) — the meaningful assertion is that the flow reached
    // that state at all, rather than the button staying rendered and
    // disabled forever (the bug: an uncaught rejection would have aborted
    // the handler before setCheckingOut(false)/setUpgradeClicked(true) ran).
    expect(screen.queryByRole('button', { name: /interested in pro/i })).toBeNull();
  });

  it('shows neither the Pro price nor the upgrade CTA when pro is true', async () => {
    createEmbedCode.mockResolvedValue({ ok: true, token: '42.abc', pro: true });
    render(<Uncontrolled auditId={42} tableId="83693NED" lang="en" />);
    fireEvent.click(screen.getByRole('button', { name: /embed/i }));
    await screen.findByRole('dialog');
    expect(screen.queryByText(/€19\/month/)).toBeNull();
    expect(screen.queryByRole('button', { name: /interested in pro/i })).toBeNull();
  });

  it('enables the Live switch when pro is true, and the code gains &live=1 when it is toggled on', async () => {
    createEmbedCode.mockResolvedValue({ ok: true, token: '42.abc', pro: true });
    render(<Uncontrolled auditId={42} tableId="83693NED" lang="en" />);
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
    render(<Uncontrolled auditId={42} tableId="83693NED" lang="nl" />);
    fireEvent.click(screen.getByRole('button'));
    await screen.findByText(/lang=nl/);
    fireEvent.click(await screen.findByRole('radio', { name: /english|engels/i }));
    expect(screen.getByText(/lang=en/)).toBeInTheDocument();
  });

  it('changing the colour option changes the code\'s theme= query param', async () => {
    createEmbedCode.mockResolvedValue({ ok: true, token: '42.abc', pro: false });
    render(<Uncontrolled auditId={42} tableId="83693NED" lang="en" />);
    fireEvent.click(screen.getByRole('button', { name: /embed/i }));
    await screen.findByText(/theme=light/);
    fireEvent.click(await screen.findByRole('radio', { name: /dark/i }));
    expect(screen.getByText(/theme=dark/)).toBeInTheDocument();
  });

  // Row 2 (session 110 UX audit pass 2): the generated snippet used to
  // hardcode height="440" while a default embedded chart's content (the
  // chart + attribution/source/footer block) measured 604.5px on the real
  // audit harness — the CBS source line, "Frozen on" date and attribution
  // sat below an inner scroller's fold at that height. The snippet now
  // carries the measured, documented constant instead of a bare literal.
  it('generates the snippet with the measured EMBED_DEFAULT_HEIGHT_PX, not the old 440', async () => {
    createEmbedCode.mockResolvedValue({ ok: true, token: '42.abc', pro: false });
    render(<Uncontrolled auditId={42} tableId="83693NED" lang="en" />);
    fireEvent.click(screen.getByRole('button', { name: /embed/i }));
    expect(EMBED_DEFAULT_HEIGHT_PX).toBeGreaterThan(604.5);
    await screen.findByText(new RegExp(`height="${EMBED_DEFAULT_HEIGHT_PX}"`));
    expect(screen.queryByText(/height="440"/)).toBeNull();
  });

  // Session 110 (embed auto-resize): pins the SHAPE of the appended inline
  // <script> — it must exist, must select the iframe by this embed's own
  // token (data-checkdecijfers-embed, unique per embed by construction), and
  // must listen for the SAME message type string EmbedResize itself posts
  // (web/app/embed/[token]/embed-resize.tsx) — the two halves of this
  // mechanism drift silently apart if either side's literal string changes
  // without the other. Also pins the height="680" (EMBED_DEFAULT_HEIGHT_PX)
  // fallback attribute staying on the <iframe> itself, and the one-sentence
  // explanation of the mechanism in the dialog's own copy.
  it('appends a resize <script> that targets this embed by its token and listens for the embed-height message, alongside the height fallback', async () => {
    createEmbedCode.mockResolvedValue({ ok: true, token: '42.abc', pro: false });
    render(<Uncontrolled auditId={42} tableId="83693NED" lang="en" />);
    fireEvent.click(screen.getByRole('button', { name: /embed/i }));
    const pre = await screen.findByText(/<iframe/);
    const code = pre.textContent ?? '';

    expect(code).toContain('<script>');
    expect(code).toContain('data-checkdecijfers-embed="42.abc"');
    expect(code).toContain('checkdecijfers:embed-height');
    expect(code).toMatch(new RegExp(`height="${EMBED_DEFAULT_HEIGHT_PX}"`));

    expect(
      screen.getByText('The chart resizes itself to its content; the height attribute is the fallback when scripts are blocked.'),
    ).toBeInTheDocument();
  });

  it('changing the chart-type option to "As shown" adds a form= query param from currentForm', async () => {
    createEmbedCode.mockResolvedValue({ ok: true, token: '42.abc', pro: false });
    render(<Uncontrolled auditId={42} tableId="83693NED" lang="en" currentForm="bar" />);
    fireEvent.click(screen.getByRole('button', { name: /embed/i }));
    await screen.findByText(/form=bar/);
    fireEvent.click(await screen.findByRole('radio', { name: /^default$/i }));
    expect(screen.queryByText(/form=bar/)).toBeNull();
  });

  // #229 (ADR 041 addendum, session 110): a >15-series spec's OWN default
  // form is Tabel (chart-view-state.ts's defaultFormIsTable) — the exact
  // gap open-questions #229 recorded (a >15-series chart switched to Lijn/
  // Staaf still embedded as a Tabel with chart-type "Default", since
  // "Default" meant "omit `form`, let the un-embeddable Tabel default
  // apply"). `defaultIsTable` is chart.tsx's own call-site flag for exactly
  // this case: the dialog must not offer "Default" as a real choice, and
  // must always publish the publisher's CURRENT form instead.
  it('hides the "Default" chart-type option and always encodes the current form when defaultIsTable is true', async () => {
    createEmbedCode.mockResolvedValue({ ok: true, token: '42.abc', pro: false });
    render(<Uncontrolled auditId={42} tableId="83693NED" lang="en" currentForm="line" defaultIsTable />);
    fireEvent.click(screen.getByRole('button', { name: /embed/i }));
    await screen.findByText(/form=line/);
    // The "Default" radio must not exist at all — not merely disabled —
    // there is nothing honest for it to do differently from "As shown" here.
    expect(screen.queryByRole('radio', { name: /^default$/i })).toBeNull();
    // Only "As shown" remains, and it's already selected/producing form=line
    // with no interaction needed.
    expect(screen.getByRole('radio', { name: /as shown/i })).toBeChecked();
  });

  it('still offers the "Default" chart-type option when defaultIsTable is false (the ordinary case)', async () => {
    createEmbedCode.mockResolvedValue({ ok: true, token: '42.abc', pro: false });
    render(<Uncontrolled auditId={42} tableId="83693NED" lang="en" currentForm="line" defaultIsTable={false} />);
    fireEvent.click(screen.getByRole('button', { name: /embed/i }));
    await screen.findByText(/form=line/);
    expect(screen.getByRole('radio', { name: /^default$/i })).toBeInTheDocument();
  });

  // Row 5 (session 110 UX audit pass 2): the dialog used to add its OWN
  // "Close" button alongside ChartEditModal's built-in × (which also carries
  // the accessible name "Close", per ui/dialog.tsx's DialogContent default),
  // giving the dialog two identically-named close controls — the same shape
  // as pass 1's row 6 on the Style dialog. Fixed by dropping the dialog's own
  // button; the shell's × is the only close control left.
  it('has exactly one control named "Close" (no duplicate close button)', async () => {
    createEmbedCode.mockResolvedValue({ ok: true, token: '42.abc', pro: false });
    render(<Uncontrolled auditId={42} tableId="83693NED" lang="en" />);
    fireEvent.click(screen.getByRole('button', { name: /embed/i }));
    await screen.findByText(/copy code/i);
    expect(screen.getAllByRole('button', { name: /^close$/i })).toHaveLength(1);
  });

  it('Escape closes the dialog and refocuses the trigger', async () => {
    createEmbedCode.mockResolvedValue({ ok: true, token: '42.abc', pro: false });
    render(<Uncontrolled auditId={42} tableId="83693NED" lang="en" />);
    const trigger = screen.getByRole('button', { name: /embed/i });
    fireEvent.click(trigger);
    await screen.findByRole('dialog');
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it('re-fetches a fresh code the next time it is opened after being closed', async () => {
    createEmbedCode.mockResolvedValue({ ok: true, token: '42.abc', pro: false });
    render(<Uncontrolled auditId={42} tableId="83693NED" lang="en" />);
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

  // Fix round (opus review, Important #1/#2): embed_copy must count a real,
  // successful copy only — mirroring chart.tsx's own default_saved/
  // default_forgotten precedent, which fires its tracking call solely inside
  // the `if (r.ok)` branch of a fallible operation, never unconditionally
  // after it. These two tests are the copy path's first coverage.
  describe('copying the code', () => {
    it('copies the exact generated code, flips the button label to "Copied!", and fires embed_copy on a successful copy', async () => {
      createEmbedCode.mockResolvedValue({ ok: true, token: '42.abc', pro: false });
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
      render(<Uncontrolled auditId={42} tableId="83693NED" lang="en" />);
      fireEvent.click(screen.getByRole('button', { name: /embed/i }));
      const pre = await screen.findByText(/<iframe/);
      const expectedCode = pre.textContent;

      fireEvent.click(screen.getByRole('button', { name: /^copy code$/i }));

      expect(await screen.findByRole('button', { name: /^copied!$/i })).toBeInTheDocument();
      expect(writeText).toHaveBeenCalledTimes(1);
      expect(writeText).toHaveBeenCalledWith(expectedCode);
      expect(trackChartStyleEvent).toHaveBeenCalledWith('embed_copy');
    });

    // RED against the pre-fix code path: the old handler called setCopied(true)
    // and trackChartStyleEvent('embed_copy') unconditionally AFTER the
    // try/catch, so both fired even though the write below rejects.
    it('does NOT flip to "Copied!" and does NOT fire embed_copy when the clipboard write fails', async () => {
      createEmbedCode.mockResolvedValue({ ok: true, token: '42.abc', pro: false });
      const writeText = vi.fn().mockRejectedValue(new Error('clipboard denied'));
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
      render(<Uncontrolled auditId={42} tableId="83693NED" lang="en" />);
      fireEvent.click(screen.getByRole('button', { name: /embed/i }));
      await screen.findByText(/<iframe/);

      fireEvent.click(screen.getByRole('button', { name: /^copy code$/i }));

      await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
      expect(screen.queryByRole('button', { name: /^copied!$/i })).toBeNull();
      expect(trackChartStyleEvent).not.toHaveBeenCalledWith('embed_copy');
    });
  });
});

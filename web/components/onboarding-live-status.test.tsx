// OnboardingLiveStatus (#74 + #117): the at-a-glance in-behandeling line and
// the router.refresh() poll behind it. The pins that matter: the poll only
// runs while the SERVER-rendered in-flight count is non-zero (start, tick,
// and — critically — STOP when a refreshed render brings the count to zero),
// hidden tabs skip their ticks, and unmount always cleans up. useRouter is
// mocked (jsdom has no App Router context); the polling contract is the unit
// under test, not Next's refresh implementation.
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

import {
  ONBOARDING_POLL_INTERVAL_MS,
  OnboardingLiveStatus,
} from './onboarding-live-status.tsx';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  refresh.mockReset();
  // Tests that fake a hidden tab shadow the prototype getter with an own
  // property -- remove it so jsdom's real 'visible' is back for the next test.
  delete (document as { visibilityState?: unknown }).visibilityState;
});

function advance(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

/** Shadow jsdom's document.visibilityState (configurable own property) and
 * fire the event listeners exactly like a real tab switch does. */
function setVisibility(state: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: state });
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

describe('OnboardingLiveStatus', () => {
  it('renders nothing and never polls when no request is in flight', () => {
    const { container } = render(<OnboardingLiveStatus inFlightCount={0} />);
    expect(container).toBeEmptyDOMElement();
    advance(ONBOARDING_POLL_INTERVAL_MS * 3);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('shows the singular line for one in-flight request', () => {
    render(<OnboardingLiveStatus inFlightCount={1} />);
    expect(
      screen.getByRole('status'),
    ).toHaveTextContent(
      'Er is 1 aanvraag bij het CBS in behandeling — de status hieronder wordt automatisch bijgewerkt.',
    );
  });

  it('shows the plural line with the count for multiple in-flight requests', () => {
    render(<OnboardingLiveStatus inFlightCount={3} />);
    expect(screen.getByRole('status')).toHaveTextContent(
      'Er zijn 3 aanvragen bij het CBS in behandeling',
    );
  });

  it('refreshes the router once per interval while in flight', () => {
    render(<OnboardingLiveStatus inFlightCount={1} />);
    expect(refresh).not.toHaveBeenCalled();
    advance(ONBOARDING_POLL_INTERVAL_MS);
    expect(refresh).toHaveBeenCalledTimes(1);
    advance(ONBOARDING_POLL_INTERVAL_MS);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('stops polling when a refreshed render reports zero in flight (#117 stop condition)', () => {
    const { rerender } = render(<OnboardingLiveStatus inFlightCount={1} />);
    advance(ONBOARDING_POLL_INTERVAL_MS);
    expect(refresh).toHaveBeenCalledTimes(1);
    // The server payload came back with the request delivered: the SERVER
    // prop drops to 0 -- the banner disappears and no further tick may fire.
    rerender(<OnboardingLiveStatus inFlightCount={0} />);
    expect(screen.queryByRole('status')).toBeNull();
    advance(ONBOARDING_POLL_INTERVAL_MS * 3);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('skips ticks while the tab is hidden, refreshes immediately on return', () => {
    render(<OnboardingLiveStatus inFlightCount={1} />);
    setVisibility('hidden');
    advance(ONBOARDING_POLL_INTERVAL_MS * 2);
    expect(refresh).not.toHaveBeenCalled();
    // Returning to the tab refreshes right away (the visibilitychange
    // listener), not only at the next interval tick.
    setVisibility('visible');
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('cleans up its timer on unmount', () => {
    const { unmount } = render(<OnboardingLiveStatus inFlightCount={2} />);
    unmount();
    advance(ONBOARDING_POLL_INTERVAL_MS * 2);
    expect(refresh).not.toHaveBeenCalled();
  });
});

// AccountPanel (WP19): the low-balance warning's exact boundary behaviour
// (open-questions #69 -- visible iff simple <= balance < 2*simple) and the
// credits explainer (#76) staying BOUND to the config-driven props -- every
// number in the copy must move when the props move, so a hardcoded price or
// grant in the component is caught here, not in production (ADR 006).
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AccountPanel } from './account-panel.tsx';

afterEach(cleanup);

const WARNING = 'Je saldo is bijna op — er is nog genoeg voor één vraag.';

function renderPanel(overrides: Partial<Parameters<typeof AccountPanel>[0]> = {}) {
  return render(
    <AccountPanel balance={100} simplePrice={20} signupGrantCredits={100} {...overrides} />,
  );
}

describe('AccountPanel — balance display', () => {
  it('renders the balance and the buy link', () => {
    renderPanel({ balance: 80 });
    expect(screen.getByText('80 credits')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Credits kopen' })).toHaveAttribute('href', '/credits');
  });
});

describe('AccountPanel — low-balance warning boundaries (#69)', () => {
  // Owner-decided range: one more simple question covered, but not two.
  // At simplePrice 20 that is exactly [20, 40).
  for (const [balance, visible] of [
    [19, false], // below one question: the insufficient_credits refusal owns this
    [20, true], // lower bound, inclusive
    [39, true], // upper bound - 1
    [40, false], // two questions covered: no warning yet
  ] as const) {
    it(`balance ${balance} at simplePrice 20 -> warning ${visible ? 'visible' : 'hidden'}`, () => {
      renderPanel({ balance });
      if (visible) {
        expect(screen.getByText(WARNING)).toBeInTheDocument();
      } else {
        expect(screen.queryByText(WARNING)).toBeNull();
      }
    });
  }

  it('the threshold follows the LIVE simple price, not a hardcoded 20/40', () => {
    // At simplePrice 50 the range becomes [50, 100): 60 must now warn...
    renderPanel({ balance: 60, simplePrice: 50 });
    expect(screen.getByText(WARNING)).toBeInTheDocument();
    cleanup();
    // ...while at the default price 20 the same balance must not.
    renderPanel({ balance: 60 });
    expect(screen.queryByText(WARNING)).toBeNull();
  });
});

describe('AccountPanel — credits explainer (#76)', () => {
  it('renders under the buy button with the grant, the price, and the rough question count', () => {
    renderPanel();
    expect(
      screen.getByText(
        "Bij aanmelding krijg je eenmalig 100 credits. Een gewone vraag kost 20 credits — 100 credits zijn dus goed voor zo'n 5 vragen.",
      ),
    ).toBeInTheDocument();
  });

  it('every number is bound to the props (a config change changes the copy)', () => {
    renderPanel({ simplePrice: 50, signupGrantCredits: 200 });
    expect(
      screen.getByText(
        "Bij aanmelding krijg je eenmalig 200 credits. Een gewone vraag kost 50 credits — 200 credits zijn dus goed voor zo'n 4 vragen.",
      ),
    ).toBeInTheDocument();
  });
});

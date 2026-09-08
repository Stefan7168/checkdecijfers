import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PricingHintProvider, usePricingHint } from './pricing-hint-context.tsx';

afterEach(cleanup);

function Consumer() {
  const { pricingHint, setPricingHint } = usePricingHint();
  return (
    <div>
      <span data-testid="hint">{pricingHint ?? '(none)'}</span>
      <button type="button" onClick={() => setPricingHint('Een vraag kost ~20 credits')}>set</button>
      <button type="button" onClick={() => setPricingHint(null)}>clear</button>
    </div>
  );
}

describe('PricingHintContext', () => {
  it('starts null and updates when setPricingHint is called, inside a provider', () => {
    render(
      <PricingHintProvider>
        <Consumer />
      </PricingHintProvider>,
    );
    expect(screen.getByTestId('hint').textContent).toBe('(none)');
    act(() => screen.getByRole('button', { name: 'set' }).click());
    expect(screen.getByTestId('hint').textContent).toBe('Een vraag kost ~20 credits');
    act(() => screen.getByRole('button', { name: 'clear' }).click());
    expect(screen.getByTestId('hint').textContent).toBe('(none)');
  });

  it('a consumer outside any provider gets the no-op default (null, setter does nothing)', () => {
    render(<Consumer />);
    expect(screen.getByTestId('hint').textContent).toBe('(none)');
    act(() => screen.getByRole('button', { name: 'set' }).click());
    // No provider above this Consumer, so the default no-op setter is what
    // runs -- the value stays null. This is the exact behavior every
    // existing byte-pinned footer test in workspace.test.tsx relies on.
    expect(screen.getByTestId('hint').textContent).toBe('(none)');
  });
});

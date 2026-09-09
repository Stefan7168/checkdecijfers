// WP218 phase 2 (#218 chart styling, owner C): the account-default context —
// the no-provider default (a logged-out surface never mounts the provider),
// the provider sanitising its `initial` prop exactly once at mount, and
// `setAccountStyle` propagating to every consumer.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ChartStyleProvider, useChartStyle } from './chart-style-context.tsx';

afterEach(cleanup);

function Probe() {
  const { accountStyle, setAccountStyle, signedIn } = useChartStyle();
  return (
    <div>
      <span data-testid="signed-in">{String(signedIn)}</span>
      <span data-testid="style">{JSON.stringify(accountStyle)}</span>
      <button type="button" onClick={() => setAccountStyle({ lineWidth: 'thin' })}>
        set
      </button>
      <button type="button" onClick={() => setAccountStyle(null)}>
        clear
      </button>
    </div>
  );
}

describe('useChartStyle — no provider', () => {
  it('defaults to signed out, null style, a no-op setter', () => {
    render(<Probe />);
    expect(screen.getByTestId('signed-in').textContent).toBe('false');
    expect(screen.getByTestId('style').textContent).toBe('null');
    // setAccountStyle is a no-op outside a provider — clicking must not throw
    // and must not change anything.
    fireEvent.click(screen.getByRole('button', { name: 'set' }));
    expect(screen.getByTestId('style').textContent).toBe('null');
  });
});

describe('ChartStyleProvider', () => {
  it('signed in with a null initial: signedIn true, accountStyle null', () => {
    render(
      <ChartStyleProvider initial={null}>
        <Probe />
      </ChartStyleProvider>,
    );
    expect(screen.getByTestId('signed-in').textContent).toBe('true');
    expect(screen.getByTestId('style').textContent).toBe('null');
  });

  it('sanitises the initial value once — junk collapses to null, not an empty object', () => {
    render(
      <ChartStyleProvider initial={{ bogus: 1, lineWidth: 'huge' }}>
        <Probe />
      </ChartStyleProvider>,
    );
    expect(screen.getByTestId('style').textContent).toBe('null');
  });

  it('sanitises the initial value once — a valid partial survives, junk keys dropped', () => {
    render(
      <ChartStyleProvider initial={{ lineWidth: 'thick', bogus: 1 }}>
        <Probe />
      </ChartStyleProvider>,
    );
    expect(screen.getByTestId('style').textContent).toBe(JSON.stringify({ lineWidth: 'thick' }));
  });

  it('setAccountStyle updates the value every consumer sees, including back to null', () => {
    render(
      <ChartStyleProvider initial={null}>
        <Probe />
      </ChartStyleProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'set' }));
    expect(screen.getByTestId('style').textContent).toBe(JSON.stringify({ lineWidth: 'thin' }));
    fireEvent.click(screen.getByRole('button', { name: 'clear' }));
    expect(screen.getByTestId('style').textContent).toBe('null');
  });
});

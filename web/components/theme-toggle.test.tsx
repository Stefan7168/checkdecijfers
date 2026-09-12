// WP218 phase 4 (#219): ThemeToggle's labels were English-only before this
// sweep (no Dutch entries existed yet) — nl gets NEW Dutch copy and the
// former English literals move into the en catalogue (design §3). No prior
// test file existed for this component.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LangProvider } from '../lib/i18n/lang-provider.tsx';
import { ThemeToggle } from './theme-toggle.tsx';

const { setTheme } = vi.hoisted(() => ({ setTheme: vi.fn() }));
vi.mock('next-themes', () => ({ useTheme: () => ({ theme: 'light', setTheme }) }));

afterEach(() => {
  cleanup();
  setTheme.mockReset();
});

describe('ThemeToggle — nl (default)', () => {
  it('renders the Dutch group label and the three Dutch option labels', () => {
    render(<ThemeToggle />);
    expect(screen.getByRole('group', { name: 'Thema' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Licht thema' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Donker thema' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Systeemthema' })).toBeInTheDocument();
  });

  it('marks the current theme active and calls setTheme on click', () => {
    render(<ThemeToggle />);
    expect(screen.getByRole('button', { name: 'Licht thema' })).toHaveAttribute('aria-pressed', 'true');
    screen.getByRole('button', { name: 'Donker thema' }).click();
    expect(setTheme).toHaveBeenCalledWith('dark');
  });
});

// R9.1 (#238): each option measured 24px tall at 375px — under the 44px
// minimum tap target — while 1280px had to stay pixel-identical. Pinned as a
// CSS-contract test (jsdom has no layout engine to measure real pixels).
describe('ThemeToggle — phone tap targets (R9.1, #238)', () => {
  it('gives each option a 44px tap target only below sm', () => {
    render(<ThemeToggle />);
    for (const name of ['Licht thema', 'Donker thema', 'Systeemthema']) {
      const className = screen.getByRole('button', { name }).className;
      expect(className).toContain('h-11');
      expect(className).toContain('sm:h-6');
    }
  });
});

// WP218 phase 4 (#219): proves the language switch reaches this surface.
describe('ThemeToggle — en', () => {
  it('renders the English group label and option labels under LangProvider lang="en"', () => {
    render(
      <LangProvider lang="en">
        <ThemeToggle />
      </LangProvider>,
    );
    expect(screen.getByRole('group', { name: 'Theme' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Light theme' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dark theme' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'System theme' })).toBeInTheDocument();
  });
});

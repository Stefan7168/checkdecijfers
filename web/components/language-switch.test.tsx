// WP218 phase 4 (#219): renders NL/EN with aria-pressed on the current
// language, and clicking the other one calls the (mocked) setLanguage
// server action followed by router.refresh() (design §2.5, the
// onboarding-live-status.test.tsx pattern for mocking next/navigation).
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LangProvider } from '../lib/i18n/lang-provider.tsx';
import { LanguageSwitch } from './language-switch.tsx';

const { setLanguage } = vi.hoisted(() => ({ setLanguage: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../app/lang-actions.ts', () => ({ setLanguage }));

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

afterEach(() => {
  cleanup();
  setLanguage.mockClear();
  refresh.mockClear();
});

describe('LanguageSwitch', () => {
  it('marks the current language aria-pressed and the other one not', () => {
    render(<LanguageSwitch />);
    expect(screen.getByRole('button', { name: 'NL' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'EN' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('reflects the provided lang', () => {
    render(
      <LangProvider lang="en">
        <LanguageSwitch />
      </LangProvider>,
    );
    expect(screen.getByRole('button', { name: 'EN' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'NL' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('is a labelled group', () => {
    render(<LanguageSwitch />);
    expect(screen.getByRole('group', { name: 'Taal' })).toBeInTheDocument();
  });

  it('calls setLanguage then router.refresh() on click', async () => {
    render(<LanguageSwitch />);
    fireEvent.click(screen.getByRole('button', { name: 'EN' }));

    await waitFor(() => expect(setLanguage).toHaveBeenCalledWith('en'));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });
});

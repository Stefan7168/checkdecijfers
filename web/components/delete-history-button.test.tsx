// #14 (GDPR self-service deletion, WP14): the "Verwijder mijn
// vraaggeschiedenis" button -- owner-decided UX (session 23): ONE CLICK then
// a confirmation step (inline confirm, NOT a typed-word confirmation). The
// server action itself (deleteMyQuestionHistory) is mocked here -- its own
// scoping/security behaviour is pinned hermetically against a real database
// in tests/audit/retention.test.ts; this suite is purely about the button's
// two-stage interaction.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LangProvider } from '../lib/i18n/lang-provider.tsx';
import { DeleteHistoryButton } from './delete-history-button.tsx';

const { deleteMyQuestionHistory } = vi.hoisted(() => ({
  deleteMyQuestionHistory: vi.fn<() => Promise<{ deletedCount: number }>>(),
}));
vi.mock('../app/actions.ts', () => ({
  deleteMyQuestionHistory,
}));

afterEach(() => {
  cleanup();
  deleteMyQuestionHistory.mockReset();
});

/** Same idiom chat.test.tsx uses for window.location.reload(): jsdom's
 * `location` is non-configurable, so a full-object replacement is required
 * rather than `vi.spyOn(window.location, 'reload')`. */
function withMockedReload(fn: (reload: ReturnType<typeof vi.fn>) => Promise<void> | void) {
  const original = window.location;
  const reload = vi.fn();
  Object.defineProperty(window, 'location', {
    value: { ...original, reload },
    configurable: true,
    writable: true,
  });
  return Promise.resolve(fn(reload)).finally(() => {
    Object.defineProperty(window, 'location', { value: original, configurable: true, writable: true });
  });
}

describe('DeleteHistoryButton — one click + confirmation step (owner decision, session 23)', () => {
  it('does not call the server action on the first click -- only shows a confirmation', () => {
    render(<DeleteHistoryButton />);
    fireEvent.click(screen.getByRole('button', { name: 'Verwijder mijn vraaggeschiedenis' }));

    expect(deleteMyQuestionHistory).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Ja, verwijder' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Annuleren' })).toBeInTheDocument();
  });

  it('calls the server action only after the confirmation click, then reloads the page', async () => {
    await withMockedReload(async (reload) => {
      deleteMyQuestionHistory.mockResolvedValue({ deletedCount: 3 });
      render(<DeleteHistoryButton />);

      fireEvent.click(screen.getByRole('button', { name: 'Verwijder mijn vraaggeschiedenis' }));
      fireEvent.click(screen.getByRole('button', { name: 'Ja, verwijder' }));

      await waitFor(() => expect(deleteMyQuestionHistory).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    });
  });

  it('canceling the confirmation never calls the server action and returns to the initial state', () => {
    render(<DeleteHistoryButton />);
    fireEvent.click(screen.getByRole('button', { name: 'Verwijder mijn vraaggeschiedenis' }));
    fireEvent.click(screen.getByRole('button', { name: 'Annuleren' }));

    expect(deleteMyQuestionHistory).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Verwijder mijn vraaggeschiedenis' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ja, verwijder' })).toBeNull();
  });

  it('shows an honest error and does not reload when the action throws', async () => {
    await withMockedReload(async (reload) => {
      deleteMyQuestionHistory.mockRejectedValue(new Error('boom'));
      render(<DeleteHistoryButton />);

      fireEvent.click(screen.getByRole('button', { name: 'Verwijder mijn vraaggeschiedenis' }));
      fireEvent.click(screen.getByRole('button', { name: 'Ja, verwijder' }));

      await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
      expect(reload).not.toHaveBeenCalled();
    });
  });

  it('confirmation text names the destructive, irreversible nature of the action (no typed-word confirmation required)', () => {
    render(<DeleteHistoryButton />);
    fireEvent.click(screen.getByRole('button', { name: 'Verwijder mijn vraaggeschiedenis' }));
    expect(screen.getByText(/permanent verwijderd/)).toBeInTheDocument();
    // No text input anywhere in the confirm step -- a click-only confirmation.
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});

// R9.1 (#238): the trigger and the two confirm/cancel buttons measured
// 16-20px tall at 375px — well under the 44px minimum tap target — and
// pixel-identical at 1280px was a hard constraint, so the fix is a
// responsive class (`min-h-11 sm:min-h-0`), pinned here as a CSS-contract
// test (jsdom has no layout engine to measure real pixel heights).
describe('DeleteHistoryButton — phone tap targets (R9.1, #238)', () => {
  it('gives the trigger and the confirm/cancel buttons a 44px tap target only below sm', () => {
    render(<DeleteHistoryButton />);
    const trigger = screen.getByRole('button', { name: 'Verwijder mijn vraaggeschiedenis' });
    expect(trigger.className).toContain('min-h-11');
    expect(trigger.className).toContain('sm:min-h-0');
    fireEvent.click(trigger);
    const yes = screen.getByRole('button', { name: 'Ja, verwijder' });
    const cancel = screen.getByRole('button', { name: 'Annuleren' });
    for (const button of [yes, cancel]) {
      expect(button.className).toContain('min-h-11');
      expect(button.className).toContain('sm:min-h-0');
    }
  });
});

// WP218 phase 4 (#219): proves the language switch reaches this surface.
describe('DeleteHistoryButton — en', () => {
  it('renders the English trigger and confirmation under LangProvider lang="en"', () => {
    render(
      <LangProvider lang="en">
        <DeleteHistoryButton />
      </LangProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Delete my question history' }));
    expect(screen.getByRole('button', { name: 'Yes, delete' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });
});

// #14 (GDPR self-service deletion, WP14): the "Verwijder mijn
// vraaggeschiedenis" button -- owner-decided UX (session 23): ONE CLICK then
// a confirmation step (inline confirm, NOT a typed-word confirmation). The
// server action itself (deleteMyQuestionHistory) is mocked here -- its own
// scoping/security behaviour is pinned hermetically against a real database
// in tests/audit/retention.test.ts; this suite is purely about the button's
// two-stage interaction.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

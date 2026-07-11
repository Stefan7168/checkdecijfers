// WP128 (#128): FeedbackButtons — the frozen-brief F6 pins, component-level
// via the prop-injected submit seam (the delete-history-button precedent):
// 👍 submits once (double-click pin), 👎 opens the inline panel (no submit
// yet), panel submits with text / Overslaan submits bare, ok:false shows the
// soft copy AND resets busy (retry stays possible), verdict change re-calls
// the action and moves aria-pressed.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FeedbackButtons } from './feedback-buttons.tsx';

afterEach(cleanup);

type Submit = (auditId: number, verdict: 'up' | 'down', feedbackText?: string) => Promise<{ ok: boolean }>;

function okSubmit(): ReturnType<typeof vi.fn<Submit>> {
  const fn = vi.fn<Submit>();
  fn.mockResolvedValue({ ok: true });
  return fn;
}

describe('FeedbackButtons', () => {
  it('👍 submits exactly once, even on a double click, and thanks the user', async () => {
    const submit = okSubmit();
    let release: (v: { ok: boolean }) => void = () => {};
    submit.mockImplementationOnce(
      () => new Promise<{ ok: boolean }>((resolve) => (release = resolve)),
    );
    render(<FeedbackButtons auditId={42} submit={submit} />);
    const up = screen.getByRole('button', { name: 'Nuttig antwoord' });
    fireEvent.click(up);
    fireEvent.click(up); // while busy — must be ignored
    release({ ok: true });
    await screen.findByText('Bedankt voor je feedback.');
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledWith(42, 'up', undefined);
    expect(up).toHaveAttribute('aria-pressed', 'true');
  });

  it('👎 opens the inline panel WITHOUT submitting; "Verstuur feedback" submits with the text', async () => {
    const submit = okSubmit();
    render(<FeedbackButtons auditId={7} submit={submit} />);
    fireEvent.click(screen.getByRole('button', { name: 'Niet nuttig' }));
    expect(submit).not.toHaveBeenCalled();
    const textarea = screen.getByPlaceholderText('Wat kon beter? (optioneel)');
    fireEvent.change(textarea, { target: { value: 'te vaag' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verstuur feedback' }));
    await screen.findByText('Bedankt voor je feedback.');
    expect(submit).toHaveBeenCalledWith(7, 'down', 'te vaag');
    // The panel closes after a successful submit.
    expect(screen.queryByPlaceholderText('Wat kon beter? (optioneel)')).toBeNull();
    expect(screen.getByRole('button', { name: 'Niet nuttig' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('"Overslaan" submits the bare 👎 (no text)', async () => {
    const submit = okSubmit();
    render(<FeedbackButtons auditId={7} submit={submit} />);
    fireEvent.click(screen.getByRole('button', { name: 'Niet nuttig' }));
    fireEvent.click(screen.getByRole('button', { name: 'Overslaan' }));
    await screen.findByText('Bedankt voor je feedback.');
    expect(submit).toHaveBeenCalledWith(7, 'down', undefined);
  });

  it('ok:false shows the soft copy, resets busy (retry possible), and claims no verdict', async () => {
    const submit = vi.fn<Submit>();
    submit.mockResolvedValueOnce({ ok: false }).mockResolvedValueOnce({ ok: true });
    render(<FeedbackButtons auditId={9} submit={submit} />);
    const up = screen.getByRole('button', { name: 'Nuttig antwoord' });
    fireEvent.click(up);
    await screen.findByText('Feedback kon niet worden opgeslagen.');
    expect(up).toHaveAttribute('aria-pressed', 'false');
    // Retry works: busy was reset.
    fireEvent.click(up);
    await screen.findByText('Bedankt voor je feedback.');
    expect(submit).toHaveBeenCalledTimes(2);
  });

  it('a throwing submit is caught — the soft copy shows, nothing propagates', async () => {
    const submit = vi.fn<Submit>();
    submit.mockRejectedValueOnce(new Error('boom'));
    render(<FeedbackButtons auditId={9} submit={submit} />);
    fireEvent.click(screen.getByRole('button', { name: 'Nuttig antwoord' }));
    await screen.findByText('Feedback kon niet worden opgeslagen.');
  });

  it('a verdict CHANGE re-calls the action and moves aria-pressed (the upsert seam)', async () => {
    const submit = okSubmit();
    render(<FeedbackButtons auditId={5} submit={submit} />);
    const up = screen.getByRole('button', { name: 'Nuttig antwoord' });
    const down = screen.getByRole('button', { name: 'Niet nuttig' });
    fireEvent.click(up);
    await screen.findByText('Bedankt voor je feedback.');
    fireEvent.click(down);
    fireEvent.click(screen.getByRole('button', { name: 'Overslaan' }));
    await waitFor(() => expect(down).toHaveAttribute('aria-pressed', 'true'));
    expect(up).toHaveAttribute('aria-pressed', 'false');
    expect(submit).toHaveBeenCalledTimes(2);
  });
});

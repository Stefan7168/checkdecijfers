// WP28 (ADR 028 D3): the login form now offers two independent doors — the
// existing magic-link form (behavior untouched; its tests here are the
// regression pin) and the Google button. Both actions are mocked at the
// module seam, typed against the real SignInResult so a mocked-shape drift
// fails typecheck (the chat.test.tsx lesson).
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SignInResult } from './actions.ts';
import { LoginForm } from './login-form.tsx';

const { signInWithMagicLink, signInWithGoogle } = vi.hoisted(() => ({
  signInWithMagicLink: vi.fn<(formData: FormData) => Promise<SignInResult>>(),
  signInWithGoogle: vi.fn<() => Promise<SignInResult>>(),
}));

vi.mock('./actions.ts', () => ({
  signInWithMagicLink,
  signInWithGoogle,
}));

afterEach(() => {
  cleanup();
  signInWithMagicLink.mockReset();
  signInWithGoogle.mockReset();
});

describe('LoginForm (WP28: magic link + Google)', () => {
  it('renders both sign-in methods', () => {
    render(<LoginForm />);
    expect(screen.getByRole('button', { name: 'Stuur inloglink' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Doorgaan met Google' })).toBeInTheDocument();
  });

  it('magic-link flow untouched: submit shows the sent message', async () => {
    signInWithMagicLink.mockResolvedValue({ ok: true, error: null });
    render(<LoginForm />);

    fireEvent.change(screen.getByPlaceholderText('jij@voorbeeld.nl'), {
      target: { value: 'iemand@voorbeeld.nl' },
    });
    fireEvent.submit(screen.getByRole('button', { name: 'Stuur inloglink' }).closest('form')!);

    expect(await screen.findByText('Check je e-mail voor de inloglink.')).toBeInTheDocument();
    expect(signInWithGoogle).not.toHaveBeenCalled();
  });

  it('magic-link flow untouched: an action error renders inline', async () => {
    signInWithMagicLink.mockResolvedValue({ ok: false, error: 'E-mailadres is verplicht.' });
    render(<LoginForm />);

    fireEvent.submit(screen.getByRole('button', { name: 'Stuur inloglink' }).closest('form')!);

    expect(await screen.findByText('E-mailadres is verplicht.')).toBeInTheDocument();
  });

  it('a Google fail-soft error renders in the existing inline error slot', async () => {
    signInWithGoogle.mockResolvedValue({
      ok: false,
      error: 'Inloggen met Google is niet gelukt. Probeer het opnieuw of gebruik de inloglink.',
    });
    render(<LoginForm />);

    fireEvent.click(screen.getByRole('button', { name: 'Doorgaan met Google' }));

    expect(
      await screen.findByText(
        'Inloggen met Google is niet gelukt. Probeer het opnieuw of gebruik de inloglink.',
      ),
    ).toBeInTheDocument();
    // The error released the shared busy state — both doors usable again.
    expect(screen.getByRole('button', { name: 'Stuur inloglink' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Doorgaan met Google' })).toBeEnabled();
    expect(signInWithMagicLink).not.toHaveBeenCalled();
  });

  it('both buttons share one busy state: a pending Google call disables both doors', async () => {
    let resolveGoogle!: (r: SignInResult) => void;
    signInWithGoogle.mockImplementation(
      () => new Promise<SignInResult>((resolve) => { resolveGoogle = resolve; }),
    );
    render(<LoginForm />);

    fireEvent.click(screen.getByRole('button', { name: 'Doorgaan met Google' }));

    expect(screen.getByRole('button', { name: 'Doorgaan met Google' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Stuur inloglink' })).toBeDisabled();
    expect(screen.getByPlaceholderText('jij@voorbeeld.nl')).toBeDisabled();

    resolveGoogle({ ok: false, error: 'x' });
    expect(await screen.findByText('x')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Doorgaan met Google' })).toBeEnabled();
  });
});

// SOURCE-TEXT pin, purchase-wiring.test.ts precedent (brittle-but-honest,
// used only where jsdom cannot exercise the path): a NEXT_REDIRECT throw
// escaping the client-side action call must reach Next's own handler, never
// the inline error slot. Behaviorally simulating that throw in jsdom leaves
// an unhandled rejection vitest rightly fails on, so the pin asserts the
// documented pattern is wired: unstable_rethrow(err) sits in the catch BEFORE
// any error state is set (node_modules/next/dist/docs, unstable_rethrow.md:
// "called at the top of the catch block").
describe('Google redirect throw handling (source pin)', () => {
  it('the catch rethrows framework control-flow errors before rendering anything', () => {
    const source = readFileSync(join(__dirname, 'login-form.tsx'), 'utf-8');
    const catchBlock = source.slice(source.indexOf('catch (err)'));
    const rethrowAt = catchBlock.indexOf('unstable_rethrow(err)');
    const setErrorAt = catchBlock.indexOf('setError(');
    expect(rethrowAt).toBeGreaterThan(-1);
    expect(setErrorAt).toBeGreaterThan(-1);
    expect(rethrowAt).toBeLessThan(setErrorAt);
  });
});

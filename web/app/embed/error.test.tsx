// #319 (session 128): web/app/embed/error.tsx — the shared route-segment
// error boundary for both public embed routes. Proves the two properties
// the row itself calls out: (1) a neutral, digit-free message renders
// instead of Next's raw error page, and (2) neither `error.message` nor
// `error.digest` ever reaches the DOM — the whole point of this file, since
// a thrown DB error can carry connection details or row content and this
// page renders inside a third party's `<iframe>`.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { useSearchParams } = vi.hoisted(() => ({ useSearchParams: vi.fn(() => new URLSearchParams()) }));
vi.mock('next/navigation', () => ({ useSearchParams }));

import EmbedError from './error.tsx';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  useSearchParams.mockReturnValue(new URLSearchParams());
});

function makeError(message: string, digest?: string): Error & { digest?: string } {
  const error = new Error(message) as Error & { digest?: string };
  if (digest !== undefined) error.digest = digest;
  return error;
}

describe('EmbedError', () => {
  it('renders a neutral message instead of the thrown error', async () => {
    render(<EmbedError error={makeError('connection to db failed')} reset={vi.fn()} />);
    expect(await screen.findByText(/not available right now|niet beschikbaar/i)).toBeInTheDocument();
  });

  it('never renders the error message or digest — no internals leak into the iframe', async () => {
    render(
      <EmbedError
        error={makeError('password authentication failed for user "postgres" at host db.internal:5432', 'abc123digest')}
        reset={vi.fn()}
      />,
    );
    await screen.findByText(/not available right now|niet beschikbaar/i);
    const text = document.body.textContent ?? '';
    expect(text).not.toContain('password authentication failed');
    expect(text).not.toContain('db.internal');
    expect(text).not.toContain('abc123digest');
    expect(text).not.toContain('postgres');
  });

  it('the message is digit-free', async () => {
    render(<EmbedError error={makeError('boom')} reset={vi.fn()} />);
    await screen.findByText(/not available right now|niet beschikbaar/i);
    expect(document.body.textContent ?? '').not.toMatch(/\d/);
  });

  it('defaults to Dutch when the URL carries no ?lang', async () => {
    useSearchParams.mockReturnValue(new URLSearchParams());
    render(<EmbedError error={makeError('boom')} reset={vi.fn()} />);
    expect(await screen.findByText('Deze grafiek is op dit moment niet beschikbaar.')).toBeInTheDocument();
  });

  it('reads ?lang=en from the URL', async () => {
    useSearchParams.mockReturnValue(new URLSearchParams('lang=en'));
    render(<EmbedError error={makeError('boom')} reset={vi.fn()} />);
    expect(await screen.findByText('This chart is not available right now.')).toBeInTheDocument();
  });

  it('falls back to Dutch for an unrecognised ?lang value', async () => {
    useSearchParams.mockReturnValue(new URLSearchParams('lang=fr'));
    render(<EmbedError error={makeError('boom')} reset={vi.fn()} />);
    expect(await screen.findByText('Deze grafiek is op dit moment niet beschikbaar.')).toBeInTheDocument();
  });

  it('reuses the not-available pages’ own markup shape (a centered <main> with the shared classes)', async () => {
    const { container } = render(<EmbedError error={makeError('boom')} reset={vi.fn()} />);
    await screen.findByText(/niet beschikbaar/i);
    const main = container.querySelector('main');
    expect(main).not.toBeNull();
    expect(main).toHaveClass('flex', 'min-h-[200px]', 'items-center', 'justify-center', 'p-4', 'text-sm', 'text-muted-foreground');
  });
});

// WP-LOOK part (a) (session 142, 2026-09-29, ADR 063): the card's Share
// button copies a link to the chart's public embed page. Mirrors
// chart-embed-dialog.test.tsx's mocking shape: the Server Action is mocked at
// the module boundary, the Button renders for real.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { createEmbedCode } = vi.hoisted(() => ({ createEmbedCode: vi.fn() }));
vi.mock('../app/embed-actions.ts', () => ({ createEmbedCode }));

import { APP_URL } from './chart-embed-dialog.tsx';
import { buildShareUrl, ChartShareButton } from './chart-share-button.tsx';

afterEach(() => {
  cleanup();
  createEmbedCode.mockReset();
});

function stubClipboard(writeText: ReturnType<typeof vi.fn>) {
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
}

describe('buildShareUrl', () => {
  it('points at the public embed page, follows the reader device (theme=auto) and carries the shown form', () => {
    expect(buildShareUrl('tok', { lang: 'nl', form: 'bar' })).toBe(`${APP_URL}/embed/tok?lang=nl&theme=auto&form=bar`);
    expect(buildShareUrl('tok', { lang: 'en', form: null })).toBe(`${APP_URL}/embed/tok?lang=en&theme=auto`);
  });
});

describe('ChartShareButton', () => {
  it('mints the same signed token Embed uses, copies the link and says so in place', async () => {
    createEmbedCode.mockResolvedValue({ ok: true, token: 'tok', pro: false });
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);
    render(<ChartShareButton auditId={42} lang="nl" currentForm="line" />);
    fireEvent.click(screen.getByRole('button', { name: 'Delen' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Link gekopieerd' })).toBeTruthy());
    expect(createEmbedCode).toHaveBeenCalledWith(42);
    expect(writeText).toHaveBeenCalledWith(`${APP_URL}/embed/tok?lang=nl&theme=auto&form=line`);
  });

  it('asks a signed-out reader to sign in, and reports any other refusal or a clipboard failure honestly', async () => {
    createEmbedCode.mockResolvedValueOnce({ ok: false, reason: 'unauthenticated' });
    stubClipboard(vi.fn());
    const { unmount } = render(<ChartShareButton auditId={1} lang="en" currentForm={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sign in to share a link.' })).toBeTruthy());
    unmount();

    createEmbedCode.mockResolvedValueOnce({ ok: true, token: 'tok', pro: false });
    stubClipboard(vi.fn().mockRejectedValue(new Error('denied')));
    render(<ChartShareButton auditId={1} lang="en" currentForm={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sharing did not work.' })).toBeTruthy());
  });

  it('is disabled with the same reason as Embed while a non-primary reading is shown', () => {
    render(<ChartShareButton auditId={1} lang="nl" currentForm="line" disabled />);
    const btn = screen.getByRole('button', { name: 'Delen' });
    expect(btn).toHaveProperty('disabled', true);
    expect(btn.getAttribute('title')).not.toBe('Kopieer een link naar deze grafiek');
  });
});

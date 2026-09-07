// ThreadSidebar's first dedicated test file (ADR 037 D10's own "fixed in
// review" finding: this component had none before — only incidental
// coverage of `busy` inside chat-workspace.test.tsx). Two things this file
// exists to pin: (1) a `kind: 'cbs'` thread list renders BYTE-IDENTICAL to
// today — no prefix, exact title text, nothing attachment-related in the
// tree at all; (2) a `kind: 'dataset'` thread gets the paperclip prefix and
// nothing else about its row differs (same className, same click wiring).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ThreadSidebar } from './thread-sidebar.tsx';
import type { ThreadSummary } from '../backend/threads/index.ts';

afterEach(() => {
  cleanup();
});

function cbsThread(overrides: Partial<ThreadSummary> = {}): ThreadSummary {
  return { id: 1, title: 'Hoeveel inwoners heeft Nederland?', lastActivityAt: new Date().toISOString(), kind: 'cbs', ...overrides };
}

describe('ThreadSidebar — kind-absent (CBS) rendering stays byte-identical', () => {
  it('renders the exact title text with no prefix and no attachment-related node', () => {
    render(
      <ThreadSidebar
        threads={[cbsThread()]}
        activeThreadId={null}
        collapsed={false}
        onSelect={vi.fn()}
        onNewChat={vi.fn()}
        onToggleCollapse={vi.fn()}
      />,
    );
    const button = screen.getByRole('button', { name: 'Hoeveel inwoners heeft Nederland?' });
    expect(button.textContent).toBe('Hoeveel inwoners heeft Nederland?');
    expect(button.getAttribute('title')).toBe('Hoeveel inwoners heeft Nederland?');
    expect(screen.queryByText('📎')).not.toBeInTheDocument();
  });

  it('keeps the exact className/disabled/aria-current wiring for a CBS thread', () => {
    render(
      <ThreadSidebar
        threads={[cbsThread({ id: 7 })]}
        activeThreadId={7}
        collapsed={false}
        busy={false}
        onSelect={vi.fn()}
        onNewChat={vi.fn()}
        onToggleCollapse={vi.fn()}
      />,
    );
    const button = screen.getByRole('button', { name: 'Hoeveel inwoners heeft Nederland?' });
    // Session 87 restyle (dense sidebar rows on the grey ground); still one
    // literal string so the CBS/dataset row parity stays a deliberate diff.
    expect(button.className).toBe(
      'block w-full truncate rounded-md px-2.5 py-1.5 text-left text-[13px] disabled:cursor-not-allowed disabled:opacity-50 bg-accent font-medium text-foreground',
    );
    expect(button.getAttribute('aria-current')).toBe('true');
    expect(button).not.toBeDisabled();
  });
});

describe('ThreadSidebar — dataset threads (ADR 037 D10)', () => {
  it('prefixes a dataset thread with the paperclip, title text and title attribute otherwise unchanged in shape', () => {
    render(
      <ThreadSidebar
        threads={[{ id: 2, title: 'verkoop-2024.csv', lastActivityAt: new Date().toISOString(), kind: 'dataset' }]}
        activeThreadId={null}
        collapsed={false}
        onSelect={vi.fn()}
        onNewChat={vi.fn()}
        onToggleCollapse={vi.fn()}
      />,
    );
    const button = screen.getByRole('button', { name: /verkoop-2024\.csv/ });
    expect(button.textContent).toBe('📎verkoop-2024.csv');
    expect(button.getAttribute('title')).toBe('Your data: verkoop-2024.csv');
  });

  it('a dataset thread row is clickable exactly like a CBS one', () => {
    const onSelect = vi.fn();
    render(
      <ThreadSidebar
        threads={[{ id: 3, title: 'x.csv', lastActivityAt: new Date().toISOString(), kind: 'dataset' }]}
        activeThreadId={null}
        collapsed={false}
        onSelect={onSelect}
        onNewChat={vi.fn()}
        onToggleCollapse={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /x\.csv/ }));
    expect(onSelect).toHaveBeenCalledWith(3);
  });

  it('a mixed CBS + dataset list renders each with its own correct prefix', () => {
    render(
      <ThreadSidebar
        threads={[cbsThread({ id: 1, title: 'CBS-vraag' }), { id: 2, title: 'data.csv', lastActivityAt: new Date().toISOString(), kind: 'dataset' }]}
        activeThreadId={null}
        collapsed={false}
        onSelect={vi.fn()}
        onNewChat={vi.fn()}
        onToggleCollapse={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'CBS-vraag' }).textContent).toBe('CBS-vraag');
    expect(screen.getByRole('button', { name: /data\.csv/ }).textContent).toBe('📎data.csv');
  });

  it('busy disables a dataset thread row exactly like a CBS one', () => {
    render(
      <ThreadSidebar
        threads={[{ id: 4, title: 'x.csv', lastActivityAt: new Date().toISOString(), kind: 'dataset' }]}
        activeThreadId={null}
        collapsed={false}
        busy
        onSelect={vi.fn()}
        onNewChat={vi.fn()}
        onToggleCollapse={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /x\.csv/ })).toBeDisabled();
  });
});

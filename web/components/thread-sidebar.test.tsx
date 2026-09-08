// ThreadSidebar's first dedicated test file (ADR 037 D10's own "fixed in
// review" finding: this component had none before — only incidental
// coverage of `busy` inside chat-workspace.test.tsx). Two things this file
// exists to pin: (1) a `kind: 'cbs'` thread list renders BYTE-IDENTICAL to
// today — no prefix, exact title text, nothing attachment-related in the
// tree at all; (2) a `kind: 'dataset'` thread gets the paperclip prefix and
// nothing else about its row differs (same className, same click wiring).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { LangProvider } from '../lib/i18n/lang-provider.tsx';
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
      'block min-w-0 flex-1 truncate rounded-md px-2.5 py-1.5 text-left text-[13px] disabled:cursor-not-allowed disabled:opacity-50 bg-accent font-medium text-foreground',
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
    expect(button.getAttribute('title')).toBe('Jouw data: verkoop-2024.csv');
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

describe('ThreadSidebar — session 90: plus icon, per-row ⋯ menu, delete with inline confirmation', () => {
  function renderWithDelete(onDelete: (id: number) => Promise<boolean>, extra: Partial<Parameters<typeof ThreadSidebar>[0]> = {}) {
    return render(
      <ThreadSidebar
        threads={[cbsThread({ id: 5, title: 'Inflatie 2024' })]}
        activeThreadId={null}
        collapsed={false}
        onSelect={vi.fn()}
        onNewChat={vi.fn()}
        onToggleCollapse={vi.fn()}
        onDelete={onDelete}
        {...extra}
      />,
    );
  }

  it('the Nieuwe chat button carries a plus icon and keeps its accessible name', () => {
    render(
      <ThreadSidebar threads={[]} activeThreadId={null} collapsed={false} onSelect={vi.fn()} onNewChat={vi.fn()} onToggleCollapse={vi.fn()} />,
    );
    const button = screen.getByRole('button', { name: 'Nieuwe chat' });
    expect(button.querySelector('svg')).not.toBeNull();
    expect(button.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
  });

  it('without onDelete there is no options button in the tree at all (rows byte-identical to before)', () => {
    render(
      <ThreadSidebar threads={[cbsThread()]} activeThreadId={null} collapsed={false} onSelect={vi.fn()} onNewChat={vi.fn()} onToggleCollapse={vi.fn()} />,
    );
    expect(screen.queryByRole('button', { name: 'Chatopties' })).toBeNull();
  });

  it('⋯ opens a menu whose "Delete chat" asks for confirmation; confirming calls onDelete(id) and the block closes on success', async () => {
    const onDelete = vi.fn().mockResolvedValue(true);
    renderWithDelete(onDelete);
    const options = screen.getByRole('button', { name: 'Chatopties' });
    // Described by the row's own title, so a screen reader hears which chat.
    expect(document.getElementById(options.getAttribute('aria-describedby')!)!.textContent).toBe('Inflatie 2024');
    expect(onDelete).not.toHaveBeenCalled();
    fireEvent.click(options);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Chat verwijderen' }));
    const confirm = await screen.findByRole('group', { name: 'Chat verwijderen?' });
    expect(onDelete).not.toHaveBeenCalled(); // nothing happens before the explicit confirm
    fireEvent.click(within(confirm).getByRole('button', { name: 'Verwijder' }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith(5));
    await waitFor(() => expect(screen.queryByRole('group', { name: 'Chat verwijderen?' })).toBeNull());
  });

  it('Cancel closes the confirmation without calling onDelete', async () => {
    const onDelete = vi.fn().mockResolvedValue(true);
    renderWithDelete(onDelete);
    fireEvent.click(screen.getByRole('button', { name: 'Chatopties' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Chat verwijderen' }));
    const confirm = await screen.findByRole('group', { name: 'Chat verwijderen?' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Annuleren' }));
    expect(screen.queryByRole('group', { name: 'Chat verwijderen?' })).toBeNull();
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('a failed delete shows an error line and keeps the confirmation open', async () => {
    const onDelete = vi.fn().mockResolvedValue(false);
    renderWithDelete(onDelete);
    fireEvent.click(screen.getByRole('button', { name: 'Chatopties' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Chat verwijderen' }));
    const confirm = await screen.findByRole('group', { name: 'Chat verwijderen?' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Verwijder' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Kon deze chat niet verwijderen');
    expect(screen.getByRole('group', { name: 'Chat verwijderen?' })).toBeInTheDocument();
  });

  it('busy disables the options button like the row itself', () => {
    renderWithDelete(vi.fn().mockResolvedValue(true), { busy: true });
    expect(screen.getByRole('button', { name: 'Chatopties' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Inflatie 2024' })).toBeDisabled();
  });
});

// WP218 phase 4 (#219): proves the language switch reaches this surface.
describe('ThreadSidebar — en', () => {
  it('renders the English chrome under LangProvider lang="en"', () => {
    render(
      <LangProvider lang="en">
        <ThreadSidebar
          threads={[cbsThread()]}
          activeThreadId={null}
          collapsed={false}
          onSelect={vi.fn()}
          onNewChat={vi.fn()}
          onToggleCollapse={vi.fn()}
        />
      </LangProvider>,
    );
    expect(screen.getByRole('button', { name: 'New chat' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Search chats')).toBeInTheDocument();
  });
});

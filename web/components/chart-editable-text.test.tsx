// Chart co-pilot phase 2 (session 113), Task 4: the in-place caption editor
// lifted out of chart.tsx so the own-data card can reuse it for its own
// title. Phase 1's behaviour, now testable on its own.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { t } from '../lib/i18n/messages.ts';
import { ChartEditableText } from './chart-editable-text.tsx';

afterEach(cleanup);

const labels = {
  placeholder: t('nl', 'chart.caption.placeholder'),
  editLabel: t('nl', 'chart.caption.edit'),
  addLabel: t('nl', 'chart.caption.add'),
  saveLabel: t('nl', 'chart.caption.save'),
  cancelLabel: t('nl', 'chart.caption.cancel'),
};

function renderText(props: Partial<React.ComponentProps<typeof ChartEditableText>> = {}) {
  const onCommit = vi.fn();
  const view = render(
    <ChartEditableText
      value={null}
      commandKind="setCaption"
      {...labels}
      maxLength={280}
      onCommit={onCommit}
      testId="chart-caption"
      {...props}
    />,
  );
  return { ...view, onCommit };
}

describe('ChartEditableText', () => {
  it('add → type → Enter commits the trimmed text', () => {
    const { onCommit } = renderText();
    fireEvent.click(screen.getByRole('button', { name: labels.addLabel }));
    const input = screen.getByPlaceholderText(labels.placeholder) as HTMLInputElement;
    expect(input.maxLength).toBe(280);
    fireEvent.change(input, { target: { value: '  Bron: eigen bewerking  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onCommit).toHaveBeenCalledWith('Bron: eigen bewerking');
  });

  it('Save commits too, and Escape cancels without committing', () => {
    const { onCommit } = renderText();
    fireEvent.click(screen.getByRole('button', { name: labels.addLabel }));
    fireEvent.change(screen.getByPlaceholderText(labels.placeholder), { target: { value: 'tekst' } });
    fireEvent.click(screen.getByRole('button', { name: labels.saveLabel }));
    expect(onCommit).toHaveBeenCalledWith('tekst');

    fireEvent.click(screen.getByRole('button', { name: labels.addLabel }));
    fireEvent.change(screen.getByPlaceholderText(labels.placeholder), { target: { value: 'weg hiermee' } });
    fireEvent.keyDown(screen.getByPlaceholderText(labels.placeholder), { key: 'Escape' });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(screen.queryByPlaceholderText(labels.placeholder)).toBeNull();
  });

  it('Cancel closes the editor without committing', () => {
    const { onCommit } = renderText();
    fireEvent.click(screen.getByRole('button', { name: labels.addLabel }));
    fireEvent.change(screen.getByPlaceholderText(labels.placeholder), { target: { value: 'tekst' } });
    fireEvent.click(screen.getByRole('button', { name: labels.cancelLabel }));
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.queryByPlaceholderText(labels.placeholder)).toBeNull();
  });

  it('emptying an existing text commits null; an unchanged text commits nothing', () => {
    const { onCommit } = renderText({ value: 'bestaand' });
    expect(screen.getByTestId('chart-caption')).toHaveTextContent('bestaand');
    fireEvent.click(screen.getByRole('button', { name: labels.editLabel }));
    fireEvent.change(screen.getByPlaceholderText(labels.placeholder), { target: { value: '' } });
    fireEvent.keyDown(screen.getByPlaceholderText(labels.placeholder), { key: 'Enter' });
    expect(onCommit).toHaveBeenCalledWith(null);

    fireEvent.click(screen.getByRole('button', { name: labels.editLabel }));
    fireEvent.keyDown(screen.getByPlaceholderText(labels.placeholder), { key: 'Enter' });
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it('both the add and the edit control carry data-command-kind (the §6 contract)', () => {
    const { container, rerender, onCommit } = renderText();
    expect(container.querySelector('[data-command-kind="setCaption"]')).not.toBeNull();
    rerender(
      <ChartEditableText
        value="bestaand"
        commandKind="setCaption"
        {...labels}
        maxLength={280}
        onCommit={onCommit}
        testId="chart-caption"
      />,
    );
    expect(container.querySelector('[data-command-kind="setCaption"]')).not.toBeNull();
  });

  it('`as` picks the display element (a caption is a paragraph, an own-data title a heading)', () => {
    renderText({ value: 'bestaand', as: 'h3' });
    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('bestaand');
  });

  it('while locked nothing can be opened, and a commit through an open editor writes nothing', () => {
    const locked = { title: t('nl', 'chart.story.controlsLocked'), describedBy: 'lock-id' };
    const { onCommit, rerender } = renderText();
    // Open first, THEN lock: the commit path itself must obey the lock, not
    // only the buttons that open the editor (phase-1 review finding M4).
    fireEvent.click(screen.getByRole('button', { name: labels.addLabel }));
    fireEvent.change(screen.getByPlaceholderText(labels.placeholder), { target: { value: 'mag niet' } });
    rerender(
      <ChartEditableText
        value={null}
        commandKind="setCaption"
        {...labels}
        maxLength={280}
        onCommit={onCommit}
        testId="chart-caption"
        locked={locked}
      />,
    );
    expect(screen.getByRole('button', { name: labels.saveLabel })).toBeDisabled();
    fireEvent.keyDown(screen.getByPlaceholderText(labels.placeholder), { key: 'Enter' });
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('a locked add button is disabled and names the reason', () => {
    renderText({ locked: { title: t('nl', 'chart.story.controlsLocked'), describedBy: 'lock-id' } });
    const add = screen.getByRole('button', { name: labels.addLabel });
    expect(add).toBeDisabled();
    expect(add).toHaveAttribute('title', t('nl', 'chart.story.controlsLocked'));
    expect(add).toHaveAttribute('aria-describedby', 'lock-id');
  });
});

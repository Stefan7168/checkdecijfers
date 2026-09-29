// Breadth step 5 (Task 6): the table lane's breakdown question - one button per
// member (CBS order, at most 12), and a hint when the dimension has more.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BreakdownQuestion } from '../backend/query/breakdowns.ts';
import { LangProvider } from '../lib/i18n/lang-provider.tsx';
import { TableLaneQuestion } from './table-lane-question.tsx';

afterEach(cleanup);

function question(count: number, totalOptions = count): BreakdownQuestion {
  return {
    dimension: 'Geslacht',
    dimensionTitle: 'Geslacht',
    options: Array.from({ length: count }, (_, i) => ({ code: `C${i}`, title: `Optie ${i}` })),
    totalOptions,
  };
}

function setup(q: BreakdownQuestion, lang: 'nl' | 'en' = 'nl', onChoose = vi.fn(), disabled = false) {
  render(
    <LangProvider lang={lang}>
      <TableLaneQuestion question={q} disabled={disabled} onChoose={onChoose} />
    </LangProvider>,
  );
  return onChoose;
}

describe('TableLaneQuestion', () => {
  it('renders one button per member in CBS order', () => {
    setup(question(3));
    const buttons = screen.getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual(['Optie 0', 'Optie 1', 'Optie 2']);
  });

  it('renders at most 12 buttons', () => {
    setup(question(15, 40));
    expect(screen.getAllByRole('button')).toHaveLength(12);
  });

  it('a click calls onChoose with the member code and title', () => {
    const onChoose = setup(question(3));
    fireEvent.click(screen.getByRole('button', { name: 'Optie 1' }));
    expect(onChoose).toHaveBeenCalledWith({ code: 'C1' }, 'Optie 1');
  });

  it('shows the type-the-name hint only when the dimension has more members than shown', () => {
    setup(question(12, 30));
    expect(screen.getByText('Staat je keuze er niet bij? Typ de naam.')).toBeTruthy();
    cleanup();
    setup(question(12, 12));
    expect(screen.queryByText('Staat je keuze er niet bij? Typ de naam.')).toBeNull();
  });

  it('shows the English hint in the English interface', () => {
    setup(question(12, 30), 'en');
    expect(screen.getByText('Not listed? Type the name.')).toBeTruthy();
  });

  it('disables the buttons while disabled', () => {
    const onChoose = setup(question(2), 'nl', vi.fn(), true);
    const button = screen.getByRole('button', { name: 'Optie 0' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(onChoose).not.toHaveBeenCalled();
  });
});

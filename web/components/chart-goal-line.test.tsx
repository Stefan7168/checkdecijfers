import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ChartGoalLine } from './chart-goal-line.tsx';

describe('ChartGoalLine', () => {
  it('submits a typed value and label via onAdd, never validates against data', () => {
    const onAdd = vi.fn();
    render(<ChartGoalLine goalLines={[]} onAdd={onAdd} onRemove={vi.fn()} lang="nl" idPrefix="t" />);
    fireEvent.click(screen.getByText('Doellijn toevoegen'));
    fireEvent.change(screen.getByLabelText('Waarde'), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'Doel 2026' } });
    fireEvent.click(screen.getByText('Opslaan'));
    expect(onAdd).toHaveBeenCalledWith(100, 'Doel 2026');
  });

  it('lists existing goal lines with a remove control', () => {
    const onRemove = vi.fn();
    render(<ChartGoalLine goalLines={[{ id: 'g1', value: 50, label: 'Doel' }]} onAdd={vi.fn()} onRemove={onRemove} lang="nl" idPrefix="t" />);
    fireEvent.click(screen.getByLabelText('Doel verwijderen'));
    expect(onRemove).toHaveBeenCalledWith('g1');
  });
});

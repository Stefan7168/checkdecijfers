import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ChartEraShading } from './chart-era-shading.tsx';

const periodOptions = [{ code: '2019', label: '2019' }, { code: '2020', label: '2020' }, { code: '2021', label: '2021' }];

describe('ChartEraShading', () => {
  it('submits a from/to period pair and a typed label via onAdd', () => {
    const onAdd = vi.fn();
    render(<ChartEraShading eraShadings={[]} periodOptions={periodOptions} onAdd={onAdd} onRemove={vi.fn()} lang="nl" idPrefix="t" />);
    fireEvent.click(screen.getByText('Periode markeren'));
    fireEvent.change(screen.getByLabelText('Van'), { target: { value: '2020' } });
    fireEvent.change(screen.getByLabelText('Tot'), { target: { value: '2021' } });
    fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'Crisis' } });
    fireEvent.click(screen.getByText('Opslaan'));
    expect(onAdd).toHaveBeenCalledWith('2020', '2021', 'Crisis');
  });
});

// StatCard (WP20, open-questions #80): the SVG card renders every StatCardData
// field verbatim (dumb-renderer discipline, WP8 precedent) and the provisional
// badge appears exactly when flagged.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { StatCardData } from '../lib/stat-card-data.ts';
import { StatCard } from './stat-card.tsx';

afterEach(cleanup);

function data(overrides: Partial<StatCardData> = {}): StatCardData {
  return {
    value: '42.100',
    unit: 'personen',
    measureTitle: 'Werklozen',
    context: 'Rotterdam · 2023',
    provisional: false,
    tableId: '82931NED',
    syncedDate: '2026-07-03',
    ...overrides,
  };
}

describe('StatCard', () => {
  it('renders value, unit, title, context and the full source line', () => {
    render(<StatCard data={data()} />);
    expect(screen.getByText('42.100')).toBeInTheDocument();
    expect(screen.getByText(/personen/)).toBeInTheDocument();
    expect(screen.getByText('Werklozen')).toBeInTheDocument();
    expect(screen.getByText('Rotterdam · 2023')).toBeInTheDocument();
    expect(
      screen.getByText('CBS StatLine · tabel 82931NED · gesynchroniseerd 2026-07-03 · checkdecijfers.nl'),
    ).toBeInTheDocument();
  });

  it('shows the amber voorlopig badge only when the cell is provisional', () => {
    render(<StatCard data={data({ provisional: true })} />);
    expect(screen.getByText('voorlopig')).toBeInTheDocument();
    cleanup();
    render(<StatCard data={data()} />);
    expect(screen.queryByText('voorlopig')).toBeNull();
  });

  it('offers the PNG download button', () => {
    render(<StatCard data={data()} />);
    expect(screen.getByRole('button', { name: 'Download als afbeelding' })).toBeInTheDocument();
  });

  it('hugs the % unit against the number in the accessible label', () => {
    render(<StatCard data={data({ value: '3,3', unit: '%', measureTitle: 'Inflatie (CPI)' })} />);
    expect(screen.getByRole('img', { name: 'Inflatie (CPI): 3,3%' })).toBeInTheDocument();
  });
});

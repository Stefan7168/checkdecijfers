// #170(4): the narrow-scope definition toggle. Two PRE-BUILT specs, pure UI
// state — this test proves the swap changes nothing but which already-built
// spec is on screen (no new query, no recomputation).
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChartSpec } from '../backend/chart/types.ts';
import { ChartWithToggle } from './chart-toggle.tsx';

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function spec(title: string): ChartSpec {
  return {
    schemaVersion: 1,
    kind: 'line',
    title,
    dims: {},
    dimLabels: {},
    unit: '%',
    series: [
      {
        label: title,
        regionCode: null,
        points: [
          {
            resultId: `${title}:p1`,
            periodCode: '2026KW01',
            periodLabel: '1e kwartaal 2026',
            value: 3.5,
            formattedValue: '3,5',
            decimals: 1,
            status: 'Definitief',
            provisional: false,
            valueAttribute: 'None',
          },
        ],
      },
    ],
    provisionalNote: null,
    nullNotes: [],
    definitionLine: null,
    attributionLine: 'Bron: CBS StatLine, tabel 85224NED. Licentie: CC BY 4.0.',
    attribution: {
      tableId: '85224NED',
      tableTitle: title,
      tableVersion: 1,
      syncedAt: '2026-08-01',
      coveredPeriods: { from: '2023KW02', to: '2026KW01' },
      license: 'CC BY 4.0',
    },
  };
}

describe('ChartWithToggle', () => {
  it('shows the primary spec by default, both buttons present, primary marked pressed', () => {
    render(
      <ChartWithToggle
        spec={spec('Seizoengecorrigeerd')}
        toggle={{
          primaryLabel: 'seizoengecorrigeerd',
          alternateLabel: 'ongecorrigeerd',
          alternateSpec: spec('Ongecorrigeerd'),
        }}
      />,
    );
    expect(screen.getByText('Seizoengecorrigeerd')).toBeInTheDocument();
    expect(screen.queryByText('Ongecorrigeerd')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'seizoengecorrigeerd' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'ongecorrigeerd' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('clicking the alternate button swaps to the alternate spec — pure UI state, no new data', () => {
    render(
      <ChartWithToggle
        spec={spec('Seizoengecorrigeerd')}
        toggle={{
          primaryLabel: 'seizoengecorrigeerd',
          alternateLabel: 'ongecorrigeerd',
          alternateSpec: spec('Ongecorrigeerd'),
        }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'ongecorrigeerd' }));
    expect(screen.getByText('Ongecorrigeerd')).toBeInTheDocument();
    expect(screen.queryByText('Seizoengecorrigeerd')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ongecorrigeerd' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'seizoengecorrigeerd' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('clicking back to the primary button restores the primary spec', () => {
    render(
      <ChartWithToggle
        spec={spec('Seizoengecorrigeerd')}
        toggle={{
          primaryLabel: 'seizoengecorrigeerd',
          alternateLabel: 'ongecorrigeerd',
          alternateSpec: spec('Ongecorrigeerd'),
        }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'ongecorrigeerd' }));
    fireEvent.click(screen.getByRole('button', { name: 'seizoengecorrigeerd' }));
    expect(screen.getByText('Seizoengecorrigeerd')).toBeInTheDocument();
    expect(screen.queryByText('Ongecorrigeerd')).not.toBeInTheDocument();
  });

  it('the toggle is a labelled group for assistive tech', () => {
    render(
      <ChartWithToggle
        spec={spec('Seizoengecorrigeerd')}
        toggle={{
          primaryLabel: 'seizoengecorrigeerd',
          alternateLabel: 'ongecorrigeerd',
          alternateSpec: spec('Ongecorrigeerd'),
        }}
      />,
    );
    expect(screen.getByRole('group', { name: 'Definitie wisselen' })).toBeInTheDocument();
  });
});

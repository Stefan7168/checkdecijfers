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
  it('shows the primary spec by default, both options present, primary marked checked', () => {
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
    expect(screen.getByRole('radio', { name: 'seizoengecorrigeerd' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('radio', { name: 'ongecorrigeerd' })).toHaveAttribute(
      'aria-checked',
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
    fireEvent.click(screen.getByRole('radio', { name: 'ongecorrigeerd' }));
    expect(screen.getByText('Ongecorrigeerd')).toBeInTheDocument();
    expect(screen.queryByText('Seizoengecorrigeerd')).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'ongecorrigeerd' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('radio', { name: 'seizoengecorrigeerd' })).toHaveAttribute(
      'aria-checked',
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
    fireEvent.click(screen.getByRole('radio', { name: 'ongecorrigeerd' }));
    fireEvent.click(screen.getByRole('radio', { name: 'seizoengecorrigeerd' }));
    expect(screen.getByText('Seizoengecorrigeerd')).toBeInTheDocument();
    expect(screen.queryByText('Ongecorrigeerd')).not.toBeInTheDocument();
  });

  it('#197: the toggle is a labelled radiogroup — one choice of two, not two independent toggles', () => {
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
    expect(screen.getByRole('radiogroup', { name: 'Definitie wisselen' })).toBeInTheDocument();
  });

  it('#197: arrow keys move the selection like a native radio group', () => {
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
    const primary = screen.getByRole('radio', { name: 'seizoengecorrigeerd' });
    primary.focus();
    fireEvent.keyDown(primary, { key: 'ArrowRight' });
    expect(screen.getByRole('radio', { name: 'ongecorrigeerd' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('Ongecorrigeerd')).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'ongecorrigeerd' }));
  });
});

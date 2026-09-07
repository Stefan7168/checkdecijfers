// UserChartView (ADR 037 D11, H2) — the first-ever test file for this
// component. The load-bearing property throughout: a UserChartSpec chart
// must be visibly/structurally impossible to confuse with a CBS ChartView —
// the badge, the dashed chrome, the provenance+disclaimer footer, and the
// ABSENCE of anything CBS-shaped (no SourceBadge, no "Bron: CBS StatLine",
// no "CC BY 4.0"). Every displayed number must be the spec's own
// formattedValue string (R6-analog, same honesty contract chart.test.tsx
// pins for ChartView).
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { UserChartView } from './user-chart.tsx';
import type { UserChartSpec } from '../backend/attachments/types.ts';

afterEach(cleanup);

function point(overrides: Partial<UserChartSpec['series'][0]['points'][0]> = {}) {
  return {
    rowRef: 'r1:c1',
    xKey: '2024',
    xLabel: '2024',
    value: 42,
    formattedValue: '42,0',
    sourceText: '42,0',
    ...overrides,
  };
}

function spec(overrides: Partial<UserChartSpec> = {}): UserChartSpec {
  return {
    schemaVersion: 1,
    origin: 'user_dataset',
    trust: 'unverified',
    kind: 'line',
    xHeader: 'Year',
    yHeaders: ['Revenue'],
    series: [{ label: 'Revenue', points: [point()] }],
    provenance: {
      datasetId: 7,
      sourceKind: 'file_csv',
      displayName: 'verkoop-2024.csv',
      sourceUrlHost: null,
      capturedAt: '2026-09-06T12:00:00.000Z',
      contentSha256: 'deadbeef',
    },
    disclaimerLine: 'User-uploaded data — not verified by checkdecijfers.',
    ...overrides,
  };
}

describe('UserChartView — H2 structural distinction from ChartView', () => {
  it('renders the persistent "Your data · unverified" badge', () => {
    render(<UserChartView spec={spec()} />);
    expect(screen.getByText('Your data · unverified')).toBeInTheDocument();
  });

  it('uses a dashed, distinct container chrome (huisstijl tokens)', () => {
    const { container } = render(<UserChartView spec={spec()} />);
    expect(container.firstElementChild?.className).toContain('border-dashed');
  });

  it('never renders a SourceBadge, CBS attribution, or a license line', () => {
    render(<UserChartView spec={spec()} />);
    expect(screen.queryByText(/CC BY 4\.0/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Bron: CBS/)).not.toBeInTheDocument();
    expect(screen.queryByText(/StatLine/)).not.toBeInTheDocument();
  });

  it('shows the exact disclaimer line the spec carries, verbatim', () => {
    render(<UserChartView spec={spec()} />);
    expect(screen.getByText('User-uploaded data — not verified by checkdecijfers.')).toBeInTheDocument();
  });

  it('shows a provenance line built from the file name, upload date, and points plotted', () => {
    render(<UserChartView spec={spec()} />);
    expect(screen.getByText('From file verkoop-2024.csv, uploaded 2026-09-06 · 1 points plotted')).toBeInTheDocument();
  });

  it('shows the heading built from the spec\'s own headers, verbatim (U9)', () => {
    render(<UserChartView spec={spec()} />);
    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('Revenue by Year');
  });
});

describe('UserChartView — honesty contract (mirrors chart.test.tsx)', () => {
  it('renders a download menu wired to this chart\'s own disclaimer + dataset id', () => {
    render(<UserChartView spec={spec()} />);
    expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument();
  });

  it('renders a legend only when there is more than one series', () => {
    const { rerender } = render(<UserChartView spec={spec()} />);
    expect(screen.queryByRole('list')).not.toBeInTheDocument();

    rerender(
      <UserChartView
        spec={spec({
          yHeaders: ['Revenue'],
          series: [
            { label: 'Amsterdam', points: [point({ rowRef: 'r1:c1' })] },
            { label: 'Rotterdam', points: [point({ rowRef: 'r1:c2' })] },
          ],
        })}
      />,
    );
    const legend = screen.getByRole('list');
    expect(legend).toHaveTextContent('Amsterdam');
    expect(legend).toHaveTextContent('Rotterdam');
  });

  it('accepts a bar-kind spec without throwing', () => {
    expect(() => render(<UserChartView spec={spec({ kind: 'bar' })} />)).not.toThrow();
  });
});

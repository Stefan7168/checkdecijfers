// StatCard (WP20, open-questions #80): the SVG card renders every StatCardData
// field verbatim (dumb-renderer discipline, WP8 precedent) and the provisional
// badge appears exactly when flagged.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StatCardData } from '../lib/stat-card-data.ts';
import { StatCard } from './stat-card.tsx';

afterEach(cleanup);

function data(overrides: Partial<StatCardData> = {}): StatCardData {
  return {
    value: '42.100',
    unitSuffix: ' personen',
    measureTitle: 'Werklozen',
    context: 'Rotterdam · 2023',
    provisional: false,
    tableId: '82931NED',
    sourceLabel: 'CBS StatLine',
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
    render(<StatCard data={data({ value: '3,3', unitSuffix: '%', measureTitle: 'Inflatie (CPI)' })} />);
    expect(screen.getByRole('img', { name: 'Inflatie (CPI): 3,3%' })).toBeInTheDocument();
  });

  it("renders NO unit text for a bare count (unitSuffix '')", () => {
    render(<StatCard data={data({ value: '18.044.027', unitSuffix: '', measureTitle: 'Bevolking' })} />);
    expect(screen.getByRole('img', { name: 'Bevolking: 18.044.027' })).toBeInTheDocument();
    expect(screen.queryByText('personen')).toBeNull();
  });

  // WP20 adversarial-review finding: truncation had zero boundary coverage —
  // expected strings are hardcoded literals, never derived from truncate()
  // itself (punch-a-hole honesty).
  it('truncates a 60-char title to 45 chars plus the ellipsis', () => {
    render(<StatCard data={data({ measureTitle: 'A'.repeat(60) })} />);
    expect(screen.getByText(`${'A'.repeat(45)}…`)).toBeInTheDocument();
    expect(screen.queryByText('A'.repeat(60))).toBeNull();
  });

  it('leaves an exactly-46-char title untouched', () => {
    render(<StatCard data={data({ measureTitle: 'B'.repeat(46) })} />);
    expect(screen.getByText('B'.repeat(46))).toBeInTheDocument();
  });

  it('truncates a 49-char context to 47 chars plus the ellipsis', () => {
    render(<StatCard data={data({ context: 'C'.repeat(49) })} />);
    expect(screen.getByText(`${'C'.repeat(47)}…`)).toBeInTheDocument();
  });
});

// WP20 adversarial-review finding: the whole downloadPng() body and the
// user-facing failure message were unexercised. jsdom has no real image
// decoding or canvas, so BOTH reachable failure legs are pinned: an Image
// error, and (via a loading Image) jsdom's own null getContext.
describe('StatCard — PNG download failure surfaces', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    // jsdom's URL lacks createObjectURL entirely; remove what the test added.
    delete (URL as unknown as Record<string, unknown>).createObjectURL;
    delete (URL as unknown as Record<string, unknown>).revokeObjectURL;
  });

  function stubUrlApi(): void {
    (URL as unknown as Record<string, unknown>).createObjectURL = vi.fn(() => 'blob:mock');
    (URL as unknown as Record<string, unknown>).revokeObjectURL = vi.fn();
  }

  it('shows the failure message when the SVG image fails to load', async () => {
    stubUrlApi();
    vi.stubGlobal(
      'Image',
      class {
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        set src(_value: string) {
          queueMicrotask(() => this.onerror?.());
        }
      },
    );
    render(<StatCard data={data()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Download als afbeelding' }));
    expect(await screen.findByText('Downloaden lukte niet in deze browser.')).toBeInTheDocument();
  });

  it('shows the failure message when no canvas 2d context is available (the jsdom leg)', async () => {
    stubUrlApi();
    vi.stubGlobal(
      'Image',
      class {
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        set src(_value: string) {
          queueMicrotask(() => this.onload?.());
        }
      },
    );
    render(<StatCard data={data()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Download als afbeelding' }));
    // jsdom's canvas.getContext('2d') returns null -> the guarded branch.
    expect(await screen.findByText('Downloaden lukte niet in deze browser.')).toBeInTheDocument();
  });
});

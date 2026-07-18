// #170(1): the source badge — rendered from envelope/registry data only.
// Pins: the deep link stays BOUND to the answer's own table id (the #86
// binding class), casing rides verbatim (ingestion quirk #1), the date shown
// is the MEASURED sync date (never a cadence promise), and absent data
// degrades honestly (no date without syncedAt; no badge without a table id).
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { SourceBadge, syncDateLabel } from './source-badge.tsx';

afterEach(cleanup);

describe('syncDateLabel', () => {
  it('takes the date part of an ISO timestamp', () => {
    expect(syncDateLabel('2026-07-03T12:00:00.000Z')).toBe('2026-07-03');
  });
  it('never invents a date', () => {
    expect(syncDateLabel(null)).toBeNull();
    expect(syncDateLabel(undefined)).toBeNull();
    expect(syncDateLabel('geen datum')).toBeNull();
  });
});

describe('SourceBadge', () => {
  it('links source + table id + measured sync date to the pinned StatLine URL', () => {
    render(<SourceBadge tableId="86141NED" source="cbs" syncedAt="2026-07-03T12:00:00.000Z" />);
    const link = screen.getByRole('link', {
      name: 'CBS 86141NED · gesynchroniseerd 2026-07-03',
    });
    expect(link).toHaveAttribute(
      'href',
      'https://opendata.cbs.nl/statline/#/CBS/nl/dataset/86141NED/table',
    );
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('title', 'Bekijk bij CBS StatLine');
  });

  it('derives the source from the table id when none is passed (charts) and keeps casing verbatim', () => {
    render(<SourceBadge tableId="03759ned" syncedAt="2026-07-12T06:30:00.000Z" />);
    const link = screen.getByRole('link', {
      name: 'CBS 03759ned · gesynchroniseerd 2026-07-12',
    });
    expect(link).toHaveAttribute(
      'href',
      'https://opendata.cbs.nl/statline/#/CBS/nl/dataset/03759ned/table',
    );
  });

  it('shows no date when syncedAt is absent (old stored envelopes) — measured only', () => {
    render(<SourceBadge tableId="86141NED" source="cbs" />);
    expect(screen.getByRole('link', { name: 'CBS 86141NED' })).toBeInTheDocument();
    expect(screen.queryByText(/gesynchroniseerd/)).toBeNull();
  });

  it('renders nothing without a table id (principle c: never a badge pointing nowhere)', () => {
    const { container } = render(<SourceBadge tableId="" source="cbs" />);
    expect(container).toBeEmptyDOMElement();
  });
});

// WP-E (journey programme, 2026-09-12): both languages, the example
// click-to-fill handler, the plain-text fallback with no handler, and the
// Eurostat group never claiming to answer anything (principle c).
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LangProvider } from '../lib/i18n/lang-provider.tsx';
import type { CoverageDisclosure } from '../lib/coverage-disclosure.ts';
import { CoverageDisclosureView } from './coverage-disclosure.tsx';

afterEach(cleanup);

function coverage(): CoverageDisclosure {
  return {
    tables: [
      {
        id: '86141NED',
        title: 'Consumentenprijzen; prijsindex 2015=100',
        sourceDisplayName: 'CBS',
        syncedOn: '2026-07-03',
        concepts: ['inflatie (CPI)', 'consumentenprijsindex'],
        example: 'Wat was de inflatie in 2025?',
      },
    ],
  };
}

describe('CoverageDisclosureView — nl (default)', () => {
  it('renders the collapsed summary and, once opened, the table + sync date + concepts', () => {
    const { container } = render(<CoverageDisclosureView coverage={coverage()} />);
    expect(screen.getByText('Welke bronnen zijn ingebouwd?')).toBeInTheDocument();
    // Collapsed by default — the composer stays bare (owner, session 87);
    // jsdom exposes <details> children regardless of `open`, so pin the
    // attribute itself.
    expect(container.querySelector('details')).not.toHaveAttribute('open');
    expect(screen.getByText(/Consumentenprijzen; prijsindex 2015=100/)).toBeInTheDocument();
    expect(screen.getByText(/gesynchroniseerd 2026-07-03/)).toBeInTheDocument();
    expect(screen.getByText('inflatie (CPI), consumentenprijsindex')).toBeInTheDocument();
  });

  it('calls onPickExample with the question when the example button is clicked', () => {
    const onPickExample = vi.fn();
    render(<CoverageDisclosureView coverage={coverage()} onPickExample={onPickExample} />);
    fireEvent.click(screen.getByRole('button', { name: 'Wat was de inflatie in 2025?' }));
    expect(onPickExample).toHaveBeenCalledWith('Wat was de inflatie in 2025?');
  });

  it('renders the example as plain text, never a button, when no handler is given (the landing case)', () => {
    render(<CoverageDisclosureView coverage={coverage()} />);
    expect(screen.getByText('bijvoorbeeld: Wat was de inflatie in 2025?')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /inflatie/ })).toBeNull();
  });

  it('renders the "on request" line and never mentions Eurostat (ADR 048 D3: never announced before it answers)', () => {
    render(<CoverageDisclosureView coverage={coverage()} />);
    expect(screen.getByText('Andere CBS-onderwerpen halen we op verzoek op.')).toBeInTheDocument();
    expect(screen.queryByText(/eurostat/i)).toBeNull();
  });

  it('#353: defaultOpen renders the <details> already open (the SEO page lists its holdings in full)', () => {
    const { container } = render(<CoverageDisclosureView coverage={coverage()} defaultOpen />);
    expect(container.querySelector('details')?.hasAttribute('open')).toBe(true);
  });

  it('renders nothing when coverage is null (never a build has succeeded)', () => {
    const { container } = render(<CoverageDisclosureView coverage={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('CoverageDisclosureView — en', () => {
  it('renders the English chrome via LangProvider', () => {
    render(
      <LangProvider lang="en">
        <CoverageDisclosureView coverage={coverage()} />
      </LangProvider>,
    );
    expect(screen.getByText('Which sources are built in?')).toBeInTheDocument();
    expect(screen.getByText(/synced 2026-07-03/)).toBeInTheDocument();
    expect(screen.getByText('Other CBS topics we fetch on request.')).toBeInTheDocument();
    expect(screen.queryByText(/eurostat/i)).toBeNull();
  });
});

// Owner-signed 2026-10-04 (session 154, #357 sweep item 6): rows are grouped
// by each row's OWN source name — never one hard-coded "CBS" heading over
// every row. Eurostat shows up only when a row says so.
describe('CoverageDisclosureView — grouped by each row’s own source', () => {
  function mixed(): CoverageDisclosure {
    const cbs = coverage().tables[0]!;
    return {
      tables: [
        cbs,
        { ...cbs, id: '70072NED', title: 'Regionale kerncijfers', example: null },
        {
          id: 'eurostat:une_rt_m',
          title: 'Unemployment by sex and age – monthly data',
          sourceDisplayName: 'Eurostat',
          syncedOn: '2026-10-01',
          concepts: ['werkloosheid'],
          example: null,
        },
      ],
    };
  }

  it('renders one heading per source, with each row under its own source', () => {
    render(<CoverageDisclosureView coverage={mixed()} />);
    const headings = screen.getAllByText(/^(CBS|Eurostat)$/);
    expect(headings.map((el) => el.textContent)).toEqual(['CBS', 'Eurostat']);
    const cbsGroup = headings[0]!.parentElement!;
    const eurostatGroup = headings[1]!.parentElement!;
    expect(cbsGroup.textContent).toContain('Consumentenprijzen; prijsindex 2015=100');
    expect(cbsGroup.textContent).toContain('Regionale kerncijfers');
    expect(cbsGroup.textContent).not.toContain('Unemployment by sex and age');
    expect(eurostatGroup.textContent).toContain('Unemployment by sex and age – monthly data');
    expect(eurostatGroup.textContent).not.toContain('Consumentenprijzen');
  });

  it('shows no Eurostat heading when no row comes from Eurostat', () => {
    render(<CoverageDisclosureView coverage={coverage()} />);
    expect(screen.queryByText('Eurostat')).toBeNull();
    expect(screen.getAllByText('CBS')).toHaveLength(1);
  });
});

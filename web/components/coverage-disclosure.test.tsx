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
        syncedOn: '2026-07-03',
        concepts: ['inflatie (CPI)', 'consumentenprijsindex'],
        example: 'Wat was de inflatie in 2025?',
      },
    ],
  };
}

describe('CoverageDisclosureView — nl (default)', () => {
  it('renders the collapsed summary and, once opened, the table + sync date + concepts', () => {
    render(<CoverageDisclosureView coverage={coverage()} />);
    expect(screen.getByText('Welke bronnen zijn ingebouwd?')).toBeInTheDocument();
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

  it('renders the "on request" line and an Eurostat group that never claims to answer anything', () => {
    render(<CoverageDisclosureView coverage={coverage()} />);
    expect(screen.getByText('Andere CBS-onderwerpen halen we op verzoek op.')).toBeInTheDocument();
    expect(screen.getByText('Eurostat — binnenkort')).toBeInTheDocument();
    const eurostatBody = screen.getByText('We werken aan Eurostat-cijfers als aanvullende bron.');
    expect(eurostatBody.textContent).not.toMatch(/beantwoord|antwoord/i);
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
    expect(screen.getByText('Eurostat — coming')).toBeInTheDocument();
  });
});

// DatasetChat (ADR 037 D8/D10) — the dataset-chat loop's first test file.
// Mocks the Server Action module exactly like chat.test.tsx mocks
// '../app/actions.ts'; askDataset/decideDatasetFormat never really run.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AskDatasetOutcome, DecideDatasetFormatOutcome } from '../app/dataset-actions.ts';
import { DatasetChat } from './dataset-chat.tsx';
import type { DatasetProfile } from '../backend/attachments/types.ts';

Element.prototype.scrollIntoView = vi.fn();

const { askDataset, decideDatasetFormat } = vi.hoisted(() => ({
  askDataset: vi.fn<(...args: unknown[]) => Promise<AskDatasetOutcome>>(),
  decideDatasetFormat: vi.fn<(...args: unknown[]) => Promise<DecideDatasetFormatOutcome>>(),
}));
vi.mock('../app/dataset-actions.ts', () => ({ askDataset, decideDatasetFormat }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const READY_PROFILE: DatasetProfile = {
  columns: [
    { id: 'c0', header: 'Year', type: 'year', nulls: 0 },
    { id: 'c1', header: 'Revenue', type: 'number', numberFormat: 'nl', nulls: 0 },
  ],
  rowCount: 3,
};

function baseProps(overrides: Partial<Parameters<typeof DatasetChat>[0]> = {}) {
  return {
    datasetId: 1,
    threadId: 42,
    displayName: 'verkoop.csv',
    initialStatus: 'ready' as const,
    initialProfile: READY_PROFILE,
    initialMessages: [],
    initialRawState: null,
    ...overrides,
  };
}

async function submit(text: string) {
  fireEvent.change(screen.getByPlaceholderText('Ask about your data…'), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  await screen.findByText(text);
}

const CHART_SPEC = {
  schemaVersion: 1 as const,
  origin: 'user_dataset' as const,
  trust: 'unverified' as const,
  kind: 'line' as const,
  xHeader: 'Year',
  yHeaders: ['Revenue'],
  series: [{ label: 'Revenue', points: [{ rowRef: 'r1:c1', xKey: '2020', xLabel: '2020', value: 100, formattedValue: '100,0', sourceText: '100,0' }] }],
  provenance: { datasetId: 1, sourceKind: 'file_csv' as const, displayName: 'verkoop.csv', sourceUrlHost: null, capturedAt: '2026-01-01', contentSha256: 'x' },
  disclaimerLine: 'User-uploaded data — not verified by checkdecijfers.' as const,
};

describe('DatasetChat — normal turn flow', () => {
  it('renders a chart turn and its UserChartView', async () => {
    askDataset.mockResolvedValue({
      kind: 'ok',
      auditId: 1,
      datasetGone: false,
      netCost: 5,
      envelope: {
        schemaVersion: 1,
        kind: 'chart',
        question: 'show revenue by year',
        text: "Here's your chart.",
        instruction: { version: 1, kind: 'line', x: 'c0', y: ['c1'], seriesBy: null, filters: [], sort: null, limit: null, confidence: 0.9, reading: 'r', unsupported: null },
        chart: CHART_SPEC,
        state: { datasetId: 1, lastInstruction: { version: 1, kind: 'line', x: 'c0', y: ['c1'], seriesBy: null, filters: [], sort: null, limit: null, unsupported: null } },
      },
    });
    render(<DatasetChat {...baseProps()} />);
    await submit('show revenue by year');
    expect(await screen.findByText("Here's your chart.")).toBeInTheDocument();
    expect(screen.getByText('Your data · unverified')).toBeInTheDocument();
  });

  it('threads the resumed/updated rawState into the NEXT askDataset call', async () => {
    askDataset.mockResolvedValue({
      kind: 'ok',
      auditId: 1,
      datasetGone: false,
      netCost: 5,
      envelope: {
        schemaVersion: 1,
        kind: 'chart',
        question: 'q1',
        text: 't',
        instruction: { version: 1, kind: 'line', x: 'c0', y: ['c1'], seriesBy: null, filters: [], sort: null, limit: null, confidence: 0.9, reading: 'r', unsupported: null },
        chart: CHART_SPEC,
        state: { datasetId: 1, lastInstruction: { version: 1, kind: 'line', x: 'c0', y: ['c1'], seriesBy: null, filters: [], sort: null, limit: 5, unsupported: null } },
      },
    });
    render(<DatasetChat {...baseProps()} />);
    await submit('q1');
    await submit('q2');
    const secondCallRawState = askDataset.mock.calls[1]![4];
    expect(secondCallRawState).toEqual({ datasetId: 1, lastInstruction: { version: 1, kind: 'line', x: 'c0', y: ['c1'], seriesBy: null, filters: [], sort: null, limit: 5, unsupported: null } });
  });

  it('renders a clarification and fills the input on chip click (fill-don\'t-send)', async () => {
    askDataset.mockResolvedValue({
      kind: 'ok',
      auditId: 1,
      datasetGone: false,
      netCost: 0,
      envelope: { schemaVersion: 1, kind: 'clarification', question: 'x', text: 'Did you mean one of these?', options: ['Line chart of Revenue by Year'], instruction: null, reason: 'low_confidence' },
    });
    render(<DatasetChat {...baseProps()} />);
    await submit('x');
    expect(await screen.findByText('Did you mean one of these?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Line chart of Revenue by Year' }));
    expect(screen.getByPlaceholderText('Ask about your data…')).toHaveValue('Line chart of Revenue by Year');
  });

  it('renders a refusal with its guidance', async () => {
    askDataset.mockResolvedValue({
      kind: 'ok',
      auditId: 1,
      datasetGone: false,
      netCost: 0,
      envelope: { schemaVersion: 1, kind: 'refusal', question: 'x', text: "I can't do that.", reason: 'aggregation', guidance: 'Try asking for the raw values instead.' },
    });
    render(<DatasetChat {...baseProps()} />);
    await submit('x');
    expect(await screen.findByText("I can't do that.")).toBeInTheDocument();
    expect(screen.getByText('Try asking for the raw values instead.')).toBeInTheDocument();
  });

  it('shows an error for insufficient_credits', async () => {
    askDataset.mockResolvedValue({ kind: 'insufficient_credits', balance: 2, required: 10 });
    render(<DatasetChat {...baseProps()} />);
    await submit('x');
    expect(await screen.findByText(/Not enough credits/)).toBeInTheDocument();
  });

  it('shows an error for not_found (dataset deleted mid-session)', async () => {
    askDataset.mockResolvedValue({ kind: 'not_found' });
    render(<DatasetChat {...baseProps()} />);
    await submit('x');
    expect(await screen.findByText('This file is no longer available.')).toBeInTheDocument();
  });

  it('disables the send control while a request is in flight (double-click guard)', async () => {
    let resolve!: (value: AskDatasetOutcome) => void;
    askDataset.mockReturnValue(new Promise((r) => { resolve = r; }));
    render(<DatasetChat {...baseProps()} />);
    fireEvent.change(screen.getByPlaceholderText('Ask about your data…'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    resolve({ kind: 'not_found' });
    await screen.findByText('This file is no longer available.');
  });
});

describe('DatasetChat — needs_decision (D5 profile-card two-chip decision)', () => {
  const AMBIGUOUS_PROFILE: DatasetProfile = {
    columns: [{ id: 'c0', header: 'Omzet', type: 'number', numberFormat: 'ambiguous', nulls: 0 }],
    rowCount: 2,
  };

  it('shows the ambiguous-format question instead of the normal chat input', () => {
    render(<DatasetChat {...baseProps({ initialStatus: 'needs_decision', initialProfile: AMBIGUOUS_PROFILE })} />);
    expect(screen.getByText(/The numbers in "Omzet" could be read two ways/)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Ask about your data…')).not.toBeInTheDocument();
  });

  it('resolves the decision and switches to the normal chat on success', async () => {
    decideDatasetFormat.mockResolvedValue({ kind: 'ok', profile: { columns: [{ id: 'c0', header: 'Omzet', type: 'number', numberFormat: 'nl', nulls: 0 }], rowCount: 2 } });
    render(<DatasetChat {...baseProps({ initialStatus: 'needs_decision', initialProfile: AMBIGUOUS_PROFILE })} />);
    fireEvent.click(screen.getByRole('button', { name: /groups thousands/ }));
    expect(await screen.findByPlaceholderText('Ask about your data…')).toBeInTheDocument();
    expect(decideDatasetFormat).toHaveBeenCalledWith(1, { c0: 'nl' });
  });
});

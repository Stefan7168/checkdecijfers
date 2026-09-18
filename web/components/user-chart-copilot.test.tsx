// Co-pilot phase 2 (session 113, Task 8) — the chat doorway END TO END on
// the own-data card: one credited call, the reply's commands re-validated
// and dispatched into the SAME history the panel and the canvas write to,
// the new chart drawn from the envelope (never a second render fetch), and
// one Undo that takes the whole reply back.
//
// The Server Action modules are mocked exactly as user-chart.test.tsx mocks
// them — without that, the imports would reach the real 'use server' modules
// in jsdom.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChartStyleProvider } from '../lib/chart-style-context.tsx';
import type { ClientChartInstruction, DatasetProfile, UserChartSpec } from '../backend/attachments/types.ts';

const datasetActions = vi.hoisted(() => ({ renderDatasetInstruction: vi.fn() }));
vi.mock('../app/dataset-actions.ts', () => datasetActions);
const chartEditsActions = vi.hoisted(() => ({
  fetchChartEdits: vi.fn().mockResolvedValue({ ok: true, log: null }),
  saveChartEdits: vi.fn().mockResolvedValue({ ok: true }),
}));
vi.mock('../app/chart-edits-actions.ts', () => chartEditsActions);
const copilotActions = vi.hoisted(() => ({
  adjustDatasetChart: vi.fn(),
  submitCopilotFeedback: vi.fn().mockResolvedValue({ ok: true }),
}));
vi.mock('../app/dataset-copilot-actions.ts', () => copilotActions);

import { UserChartView, type UserChartEditContext } from './user-chart.tsx';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  chartEditsActions.fetchChartEdits.mockResolvedValue({ ok: true, log: null });
  chartEditsActions.saveChartEdits.mockResolvedValue({ ok: true });
  datasetActions.renderDatasetInstruction.mockReset();
  copilotActions.adjustDatasetChart.mockReset();
  copilotActions.submitCopilotFeedback.mockResolvedValue({ ok: true });
});

function point(overrides: Partial<UserChartSpec['series'][0]['points'][0]> = {}) {
  return { rowRef: 'r1:c1', xKey: 'Amsterdam', xLabel: 'Amsterdam', value: 42, formattedValue: '42', sourceText: '42', ...overrides };
}

function spec(overrides: Partial<UserChartSpec> = {}): UserChartSpec {
  return {
    schemaVersion: 1,
    origin: 'user_dataset',
    trust: 'unverified',
    kind: 'line',
    xHeader: 'Gemeente',
    yHeaders: ['Omzet'],
    // Two points, so the line form actually draws a curve.
    series: [
      {
        label: 'Omzet',
        points: [point(), point({ rowRef: 'r2:c1', xKey: 'Rotterdam', xLabel: 'Rotterdam', value: 24, formattedValue: '24', sourceText: '24' })],
      },
    ],
    provenance: {
      datasetId: 7,
      sourceKind: 'file_csv',
      displayName: 'verkoop.csv',
      sourceUrlHost: null,
      capturedAt: '2026-09-18T12:00:00.000Z',
      contentSha256: 'deadbeef',
    },
    disclaimerLine: 'User-uploaded data — not verified by checkdecijfers.',
    ...overrides,
  };
}

/** What the co-pilot's own `setInstruction` draws: the summed bar chart. */
function summedSpec(): UserChartSpec {
  return spec({
    kind: 'bar',
    yHeaders: ['Som van Omzet'],
    series: [{ label: 'Som van Omzet', points: [point({ rowRef: 'g1', value: 66, formattedValue: '66', sourceText: '66' })] }],
  });
}

const PROFILE: DatasetProfile = {
  columns: [
    { id: 'c0', header: 'Gemeente', type: 'text', distinct: ['Amsterdam', 'Rotterdam'], nulls: 0 },
    { id: 'c1', header: 'Omzet', type: 'number', numberFormat: 'nl', nulls: 0 },
  ],
  rowCount: 2,
};

const LAST_INSTRUCTION: ClientChartInstruction = {
  version: 2,
  kind: 'line',
  x: 'c0',
  y: ['c1'],
  seriesBy: null,
  filters: [],
  sort: null,
  limit: null,
  aggregate: null,
  derived: null,
  unsupported: null,
};
const SUMMED_INSTRUCTION: ClientChartInstruction = { ...LAST_INSTRUCTION, kind: 'bar', aggregate: { fn: 'sum' } };

function editContext(overrides: Partial<UserChartEditContext> = {}): UserChartEditContext {
  return { datasetId: 3, threadId: 42, turnId: 7, profile: PROFILE, lastInstruction: LAST_INSTRUCTION, ...overrides };
}

function okReply(overrides: { commands?: unknown[]; refused?: unknown[] } = {}) {
  return {
    kind: 'ok',
    netCost: 4,
    auditId: 21,
    datasetGone: false,
    envelope: {
      schemaVersion: 1,
      kind: 'chart',
      question: 'tel de omzet op per gemeente',
      text: 'Twee dingen aangepast.',
      instruction: null,
      chart: summedSpec(),
      state: { datasetId: 3, lastInstruction: SUMMED_INSTRUCTION },
      copilot: {
        message: 'tel de omzet op per gemeente',
        commands: overrides.commands ?? [
          { kind: 'setInstruction', instruction: SUMMED_INSTRUCTION, summary: 'Som van Omzet per Gemeente' },
          { kind: 'setForm', form: 'bar' },
        ],
        refused: overrides.refused ?? [],
        targetTurnId: 7,
        feedback: null,
      },
    },
  };
}

function renderCard(edit: UserChartEditContext = editContext()) {
  return render(
    <ChartStyleProvider initial={null}>
      <UserChartView spec={spec()} edit={edit} />
    </ChartStyleProvider>,
  );
}

/** The same card with no edit context at all — no dataset profile, so no
 * data command and no chat. */
function renderBare() {
  return render(
    <ChartStyleProvider initial={null}>
      <UserChartView spec={spec()} />
    </ChartStyleProvider>,
  );
}

function send(message = 'tel de omzet op per gemeente'): void {
  fireEvent.change(screen.getByPlaceholderText('Pas deze grafiek aan'), { target: { value: message } });
  fireEvent.click(screen.getByRole('button', { name: 'Versturen' }));
}

describe('UserChartView — the chat doorway (co-pilot phase 2, Task 8)', () => {
  it('offers no chat input at all without an edit context', () => {
    renderBare();
    expect(screen.queryByPlaceholderText('Pas deze grafiek aan')).not.toBeInTheDocument();
  });

  it('applies the reply: the new chart is drawn, the form switches, and no render call is made', async () => {
    copilotActions.adjustDatasetChart.mockResolvedValue(okReply());
    renderCard();
    expect(document.querySelectorAll('.recharts-line-curve').length).toBe(1);

    send();

    await waitFor(() => expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('Som van Omzet per Gemeente'));
    // The reply's chart came with the envelope: nothing re-fetched it.
    expect(datasetActions.renderDatasetInstruction).not.toHaveBeenCalled();
    // setForm('bar') applied — a BarChart, not a line.
    expect(document.querySelectorAll('.recharts-bar-rectangle').length).toBeGreaterThan(0);
    expect(document.querySelectorAll('.recharts-line-curve').length).toBe(0);
  });

  it('passes the dataset/thread/turn, a fresh requestId, the held instruction and this chart\'s capabilities', async () => {
    copilotActions.adjustDatasetChart.mockResolvedValue(okReply());
    renderCard();
    send('maak er een staafdiagram van');
    await waitFor(() => expect(copilotActions.adjustDatasetChart).toHaveBeenCalledTimes(1));
    const [datasetId, threadId, targetTurnId, message, requestId, current, capabilities] = copilotActions.adjustDatasetChart.mock.calls[0]!;
    expect([datasetId, threadId, targetTurnId]).toEqual([3, 42, 7]);
    expect(message).toBe('maak er een staafdiagram van');
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(current).toEqual(LAST_INSTRUCTION);
    expect(capabilities).toMatchObject({ lang: 'nl' });
    expect((capabilities as { forms: string[] }).forms).toContain('bar');
  });

  it('shows the data command in the Data panel — the same state the panel writes', async () => {
    copilotActions.adjustDatasetChart.mockResolvedValue(okReply());
    renderCard();
    send();
    await waitFor(() => expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('Som van Omzet per Gemeente'));
    fireEvent.click(screen.getByRole('button', { name: 'Data' }));
    expect((screen.getByLabelText('Samenvatten') as HTMLSelectElement).value).toBe('sum');
  });

  it('records both commands in the history as chat-sourced', async () => {
    copilotActions.adjustDatasetChart.mockResolvedValue(okReply());
    renderCard();
    send();
    await waitFor(() => expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('Som van Omzet per Gemeente'));
    fireEvent.click(screen.getByRole('button', { name: 'Geschiedenis van bewerkingen' }));
    expect(await screen.findAllByText('via de chat')).toHaveLength(2);
  });

  it('takes the WHOLE reply back with one Undo, chart and form together', async () => {
    copilotActions.adjustDatasetChart.mockResolvedValue(okReply());
    renderCard();
    send();
    await waitFor(() => expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('Som van Omzet per Gemeente'));
    fireEvent.click(screen.getByRole('button', { name: 'Dit antwoord ongedaan maken' }));
    await waitFor(() => expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('Omzet per Gemeente'));
    expect(document.querySelectorAll('.recharts-line-curve').length).toBe(1);
  });

  it('drops a command the new chart cannot take and says one item could not be applied', async () => {
    copilotActions.adjustDatasetChart.mockResolvedValue(
      okReply({ commands: [{ kind: 'setForm', form: 'bar' }, { kind: 'toggleSeries', key: 's9' }] }),
    );
    renderCard();
    send();
    expect(await screen.findByText('Eén onderdeel kon niet worden toegepast.')).toBeInTheDocument();
  });

  it('shows a refusal line naming the control that can do it', async () => {
    copilotActions.adjustDatasetChart.mockResolvedValue(
      okReply({ commands: [], refused: [{ request: 'kleur van de lijn', reason: 'not_available', control: 'style' }] }),
    );
    renderCard();
    send();
    expect(await screen.findByText(/kleur van de lijn.*Opmaak: open het paneel Opmaak\./)).toBeInTheDocument();
  });

  it('opens the Style panel when the reader clicks a style chip', async () => {
    copilotActions.adjustDatasetChart.mockResolvedValue(okReply({ commands: [{ kind: 'resetPresentation' }] }));
    renderCard();
    send();
    const chip = await screen.findByRole('button', { name: 'Opmaak teruggezet' });
    fireEvent.click(chip);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Opmaak' })).toHaveAttribute('aria-expanded', 'true'));
  });

  it('sends the vote once, and only says thanks when the action confirms it', async () => {
    copilotActions.adjustDatasetChart.mockResolvedValue(okReply());
    renderCard();
    send();
    const up = await screen.findByRole('button', { name: 'Dit antwoord was goed' });
    fireEvent.click(up);
    await waitFor(() => expect(copilotActions.submitCopilotFeedback).toHaveBeenCalledWith(21, 'up'));
    expect(await screen.findByText('Bedankt voor je feedback.')).toBeInTheDocument();
    fireEvent.click(up);
    expect(copilotActions.submitCopilotFeedback).toHaveBeenCalledTimes(1);
  });

  it('shows the failure line — not thanks — when the vote could not be stored', async () => {
    copilotActions.adjustDatasetChart.mockResolvedValue(okReply());
    copilotActions.submitCopilotFeedback.mockResolvedValue({ ok: false });
    renderCard();
    send();
    fireEvent.click(await screen.findByRole('button', { name: 'Dit antwoord was goed' }));
    expect(await screen.findByText('Feedback kon niet worden opgeslagen.')).toBeInTheDocument();
    expect(screen.queryByText('Bedankt voor je feedback.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dit antwoord was goed' })).toBeEnabled();
  });

  it('survives a REJECTED vote call with the same line (no unhandled rejection)', async () => {
    copilotActions.adjustDatasetChart.mockResolvedValue(okReply());
    copilotActions.submitCopilotFeedback.mockRejectedValue(new Error('offline'));
    renderCard();
    send();
    fireEvent.click(await screen.findByRole('button', { name: 'Dit antwoord was goed' }));
    expect(await screen.findByText('Feedback kon niet worden opgeslagen.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dit antwoord was goed' })).toBeEnabled();
  });

  it('marks the reply chips as undone once the group Undo ran', async () => {
    copilotActions.adjustDatasetChart.mockResolvedValue(okReply());
    renderCard();
    send();
    fireEvent.click(await screen.findByRole('button', { name: 'Dit antwoord ongedaan maken' }));
    const chip = await screen.findByRole('button', { name: 'Weergave: Staaf ongedaan gemaakt' });
    expect(chip.className).toContain('line-through');
    expect(screen.queryByRole('button', { name: 'Dit antwoord ongedaan maken' })).not.toBeInTheDocument();
  });

  it('disables the group Undo — with its reason — once the reader changed something on top of it', async () => {
    copilotActions.adjustDatasetChart.mockResolvedValue(okReply());
    renderCard();
    send();
    await screen.findByRole('button', { name: 'Dit antwoord ongedaan maken' });
    // A reader edit AFTER the reply: the reply is no longer the top of the
    // history, so walking its ids back would do nothing.
    fireEvent.click(screen.getByRole('tab', { name: 'Tabel' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Dit antwoord ongedaan maken' })).toBeDisabled());
    expect(screen.getByRole('button', { name: 'Dit antwoord ongedaan maken' })).toHaveAttribute(
      'title',
      'Dit antwoord staat niet meer bovenaan. Gebruik Ongedaan maken of de geschiedenis.',
    );
  });

  it('does not offer a Style chip in Tabel form, where that panel is not mounted', async () => {
    copilotActions.adjustDatasetChart.mockResolvedValue(okReply({ commands: [{ kind: 'resetPresentation' }] }));
    renderCard();
    send();
    const chip = await screen.findByRole('button', { name: 'Opmaak teruggezet' });
    expect(chip).toBeEnabled();
    fireEvent.click(screen.getByRole('tab', { name: 'Tabel' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Opmaak teruggezet' })).toBeDisabled());
  });

  it('says so when the same submit was already settled', async () => {
    copilotActions.adjustDatasetChart.mockResolvedValue({ kind: 'duplicate_request' });
    renderCard();
    send();
    expect(await screen.findByText('Deze aanpassing is al verwerkt. Vernieuw de pagina om het resultaat te zien.')).toBeInTheDocument();
  });

  it('retries with a NEW requestId and the same message', async () => {
    copilotActions.adjustDatasetChart.mockResolvedValue(okReply());
    renderCard();
    send('maak er een staafdiagram van');
    const retry = await screen.findByRole('button', { name: 'Opnieuw proberen (kost credits)' });
    fireEvent.click(retry);
    await waitFor(() => expect(copilotActions.adjustDatasetChart).toHaveBeenCalledTimes(2));
    const first = copilotActions.adjustDatasetChart.mock.calls[0]!;
    const second = copilotActions.adjustDatasetChart.mock.calls[1]!;
    expect(second[3]).toBe('maak er een staafdiagram van');
    expect(second[4]).not.toBe(first[4]);
  });

  it('turns every gate outcome into one plain line', async () => {
    copilotActions.adjustDatasetChart.mockResolvedValue({ kind: 'insufficient_credits', required: 5, balance: 1 });
    renderCard();
    send();
    expect(await screen.findByText('Niet genoeg credits (nodig: 5, je hebt: 1).')).toBeInTheDocument();
  });

  it('shows a clarification envelope as text, with no chips and no Undo', async () => {
    copilotActions.adjustDatasetChart.mockResolvedValue({
      kind: 'ok',
      netCost: 2,
      auditId: 22,
      datasetGone: false,
      envelope: { schemaVersion: 1, kind: 'clarification', question: 'q', text: 'Wat bedoel je precies?', options: [], instruction: null, reason: 'low_confidence' },
    });
    renderCard();
    send();
    expect(await screen.findByText('Wat bedoel je precies?')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Dit antwoord ongedaan maken' })).not.toBeInTheDocument();
  });

  it('shows the thrown-error line rather than a stuck busy state', async () => {
    copilotActions.adjustDatasetChart.mockRejectedValue(new Error('boom'));
    renderCard();
    send();
    expect(await screen.findByText('Deze aanpassing lukte niet. Probeer het opnieuw.')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Pas deze grafiek aan')).toBeEnabled();
  });

  it('keeps the credit figure — the one digit-bearing string here — outside the export container', async () => {
    copilotActions.adjustDatasetChart.mockResolvedValue(okReply());
    renderCard();
    send();
    const cost = await screen.findByText('Kostte 4 credits');
    expect(screen.getByTestId('user-chart-container').contains(cost)).toBe(false);
  });

  it('the whole-card digit scan is clean with a reply on screen: the cost line is the only composed figure', async () => {
    copilotActions.adjustDatasetChart.mockResolvedValue(okReply());
    const { container } = renderCard();
    send();
    await screen.findByText('Kostte 4 credits');
    const s = summedSpec();
    const allowed = [
      s.provenance.capturedAt.slice(0, 10),
      s.provenance.displayName,
      String(s.series[0]!.points.length),
      // The credit cost of the turn — the ONE figure this card composes, and
      // it lives outside the export container (pinned by the test above).
      '4',
      ...s.series.flatMap((se) => [se.label, ...se.points.flatMap((p) => [p.formattedValue ?? '', p.xLabel])]),
    ].filter(Boolean);
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    const tokens: string[] = [];
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      tokens.push(...((node.textContent ?? '').match(/\d[\d.,]*/g) ?? []));
    }
    expect(tokens.length).toBeGreaterThan(0);
    for (const tok of tokens) {
      expect(allowed.some((str) => str.includes(tok)), `numeric token "${tok}" has no source in the spec's own strings`).toBe(true);
    }
  });
});

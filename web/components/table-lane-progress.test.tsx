// Breadth step 5 (Task 6): the table lane's progress bubble polls
// pollTableLane every 2 s for 60 s, then every 15 s up to 10 minutes.
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PollTableLaneOutcome } from '../lib/table-lane.ts';
import { LangProvider } from '../lib/i18n/lang-provider.tsx';
import { TableLaneProgress } from './table-lane-progress.tsx';

const { pollTableLane } = vi.hoisted(() => ({
  pollTableLane: vi.fn<(rowId: number) => Promise<PollTableLaneOutcome>>(),
}));
vi.mock('../app/actions.ts', () => ({ pollTableLane }));

beforeEach(() => {
  vi.useFakeTimers();
  pollTableLane.mockResolvedValue({ status: 'running' });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  pollTableLane.mockReset();
});

function setup(overrides: Partial<React.ComponentProps<typeof TableLaneProgress>> = {}) {
  const props = { onDone: vi.fn(), onGone: vi.fn(), onSlow: vi.fn(), ...overrides };
  const view = render(
    <LangProvider lang="nl">
      <TableLaneProgress rowId={41} phase="fetching" {...props} />
    </LangProvider>,
  );
  return { props, ...view };
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe('TableLaneProgress', () => {
  it('shows the progress text with an AnswerSkeleton look and does not poll before 2 s', async () => {
    const { container } = setup();
    expect(screen.getByText('CBS-tabel ophalen…')).toBeTruthy();
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThanOrEqual(3);
    await advance(1999);
    expect(pollTableLane).not.toHaveBeenCalled();
    await advance(1);
    expect(pollTableLane).toHaveBeenCalledTimes(1);
    expect(pollTableLane).toHaveBeenCalledWith(41);
  });

  it('polls every 2 s for the first 60 s, then every 15 s', async () => {
    setup();
    await advance(60_000);
    expect(pollTableLane).toHaveBeenCalledTimes(30);
    await advance(14_999);
    expect(pollTableLane).toHaveBeenCalledTimes(30);
    await advance(1);
    expect(pollTableLane).toHaveBeenCalledTimes(31);
    await advance(30_000);
    expect(pollTableLane).toHaveBeenCalledTimes(33);
  });

  it('asks its parent to switch to the slow phase after 60 s, once', async () => {
    const { props } = setup();
    await advance(58_000);
    expect(props.onSlow).not.toHaveBeenCalled();
    await advance(2_000);
    expect(props.onSlow).toHaveBeenCalledTimes(1);
    await advance(30_000);
    expect(props.onSlow).toHaveBeenCalledTimes(1);
  });

  it('shows the over-budget text in the slow phase', () => {
    setup({ phase: 'slow' });
    expect(
      screen.getByText('Dit duurt langer dan normaal. Het antwoord verschijnt in dit gesprek zodra het klaar is.'),
    ).toBeTruthy();
  });

  it('hands a done poll to onDone and stops polling', async () => {
    const gated = { kind: 'ok', netCost: 20, auditId: 3, response: { kind: 'answer' } } as never;
    pollTableLane.mockResolvedValueOnce({ status: 'running' }).mockResolvedValueOnce({
      status: 'done',
      gated,
      threadId: 12,
    });
    const { props } = setup();
    await advance(4_000);
    expect(props.onDone).toHaveBeenCalledTimes(1);
    expect(props.onDone).toHaveBeenCalledWith({ gated, threadId: 12 });
    await advance(60_000);
    expect(pollTableLane).toHaveBeenCalledTimes(2);
    expect(props.onGone).not.toHaveBeenCalled();
  });

  it('reports gone and stops', async () => {
    pollTableLane.mockResolvedValueOnce({ status: 'gone' });
    const { props } = setup();
    await advance(2_000);
    expect(props.onGone).toHaveBeenCalledTimes(1);
    await advance(30_000);
    expect(pollTableLane).toHaveBeenCalledTimes(1);
  });

  it('gives up after 10 minutes with onGone', async () => {
    const { props } = setup();
    await advance(599_000);
    expect(props.onGone).not.toHaveBeenCalled();
    await advance(1_000);
    expect(props.onGone).toHaveBeenCalledTimes(1);
    const calls = pollTableLane.mock.calls.length;
    await advance(60_000);
    expect(pollTableLane).toHaveBeenCalledTimes(calls);
  });

  it('keeps polling through a failed poll', async () => {
    pollTableLane.mockRejectedValueOnce(new Error('network'));
    const { props } = setup();
    await advance(6_000);
    expect(pollTableLane).toHaveBeenCalledTimes(3);
    expect(props.onGone).not.toHaveBeenCalled();
  });

  it('stops polling on unmount and ignores an in-flight result', async () => {
    let resolve!: (value: PollTableLaneOutcome) => void;
    pollTableLane.mockImplementationOnce(() => new Promise((r) => (resolve = r)));
    const { props, unmount } = setup();
    await advance(2_000);
    expect(pollTableLane).toHaveBeenCalledTimes(1);
    unmount();
    await act(async () => {
      resolve({ status: 'done', gated: { kind: 'unauthenticated' } as never, threadId: null });
    });
    await advance(60_000);
    expect(props.onDone).not.toHaveBeenCalled();
    expect(pollTableLane).toHaveBeenCalledTimes(1);
  });
});

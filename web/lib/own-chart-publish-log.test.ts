// Final-review fixes A4 (ruling R14) + A5 (ruling R13) — the own-data card's
// publish log. See own-chart-publish-log.ts's header.
import { describe, expect, it } from 'vitest';
import { initialDocState, makeCommand, type ChartDocState, type CommandContext } from './chart-commands.ts';
import { emptyHistory, HISTORY_CAP, pushCommand, type ChartHistory } from './chart-history.ts';
import { buildPublishLog, publishStateMatches } from './own-chart-publish-log.ts';

const pt = (resultId: string, periodCode: string, value: number) => ({
  resultId,
  periodCode,
  periodLabel: periodCode,
  value,
  formattedValue: String(value),
  provisional: false,
  note: null,
});
const ctx = {
  spec: {
    kind: 'line' as const,
    series: [
      { label: 'a', regionCode: null, points: [pt('r1', '2020', 1), pt('r2', '2021', 2)] },
      { label: 'b', regionCode: null, points: [pt('r3', '2020', 3), pt('r4', '2021', 4)] },
    ],
  },
  alternatesCount: 0,
} as unknown as CommandContext;

function run(commands: Parameters<typeof makeCommand>[0][], opts: { transientLast?: boolean } = {}): { history: ChartHistory; state: ChartDocState } {
  let state = initialDocState('line');
  let history = emptyHistory();
  commands.forEach((params, i) => {
    const transient = opts.transientLast === true && i === commands.length - 1;
    ({ history, state } = pushCommand(history, state, makeCommand(params, 'panel'), { transient }));
  });
  return { history, state };
}

describe('buildPublishLog', () => {
  it('returns the full log when it replays to what the author sees', () => {
    const { history, state } = run([{ kind: 'toggleSeries', key: 's0' }, { kind: 'setTitle', title: 'Kop' }]);
    const log = buildPublishLog(history, initialDocState('line'), ctx, state);
    expect(log?.map((c) => c.kind)).toEqual(['toggleSeries', 'setTitle']);
  });

  // A4: an unsealed transient top entry (a colour drag still "in progress")
  // is part of what the author sees, so it must be in the published log —
  // bare serializeHistory would skip it.
  it('A4: includes an unsealed transient top entry (a colour drag)', () => {
    const { history, state } = run(
      [{ kind: 'setTitle', title: 'Kop' }, { kind: 'setPresentation', patch: { seriesColors: { 0: '#123456' } } }],
      { transientLast: true },
    );
    expect(history.past[history.past.length - 1]!.transient).toBe(true);
    const log = buildPublishLog(history, initialDocState('line'), ctx, state);
    expect(log).not.toBeNull();
    expect(log!.map((c) => c.kind)).toEqual(['setTitle', 'setPresentation']);
  });

  // A5: once the history is longer than HISTORY_CAP its oldest entries are
  // trimmed. Here the trimmed entry is the very first toggleSeries — so the
  // remaining log (an even number of toggles) replays to s0 SHOWN while the
  // author sees it HIDDEN. That must refuse, never publish.
  it('A5: returns null when a trimmed history no longer replays to the current state', () => {
    const toggles = Array.from({ length: HISTORY_CAP + 1 }, () => ({ kind: 'toggleSeries' as const, key: 's0' }));
    const { history, state } = run(toggles);
    expect(history.past).toHaveLength(HISTORY_CAP);
    expect(state.hiddenKeys.has('s0')).toBe(true);
    expect(buildPublishLog(history, initialDocState('line'), ctx, state)).toBeNull();
  });

  it('A5: returns null when the log omits an early toggleSeries (history built from a later starting point)', () => {
    // Simulates the trim directly: the history's first command is gone, so
    // the author's current state (s0 hidden) is not what the log replays to.
    const { history } = run([{ kind: 'setTitle', title: 'Kop' }]);
    const current: ChartDocState = { ...initialDocState('line'), title: 'Kop', hiddenKeys: new Set(['s0']) };
    expect(buildPublishLog(history, initialDocState('line'), ctx, current)).toBeNull();
  });
});

describe('publishStateMatches', () => {
  const base = initialDocState('line');
  it('compares hiddenKeys as sets (order-free)', () => {
    expect(publishStateMatches({ ...base, hiddenKeys: new Set(['s0', 's1']) }, { ...base, hiddenKeys: new Set(['s1', 's0']) })).toBe(true);
    expect(publishStateMatches({ ...base, hiddenKeys: new Set(['s0']) }, { ...base, hiddenKeys: new Set(['s1']) })).toBe(false);
  });
  it('compares the form', () => {
    expect(publishStateMatches({ ...base, form: 'bar' }, { ...base, form: 'line' })).toBe(false);
  });
  it('compares the instruction by instructionKey', () => {
    const instruction = {
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
    } as unknown as ChartDocState['instruction'];
    expect(publishStateMatches({ ...base, instruction }, { ...base, instruction })).toBe(true);
    expect(publishStateMatches({ ...base, instruction }, { ...base, instruction: null })).toBe(false);
  });
});

// dock-visuals.ts's first dedicated test file — until ADR 037 D10/WP202a's
// `deriveDatasetVisuals`/`datasetMessageHasVisual`, this module's CBS-side
// `deriveVisuals`/`messageHasVisual` had only incidental coverage (via
// chat.test.tsx/workspace.test.tsx exercising Chat's own effect). The new
// dataset-side derivation is genuinely new logic, so it gets its own tests
// here rather than growing dataset-chat.test.tsx into a second dock-visuals
// suite.
import { describe, expect, it } from 'vitest';
import { datasetMessageHasVisual, deriveDatasetVisuals } from './dock-visuals.ts';
import type { DatasetChatMessage } from '../backend/attachments/replay.ts';
import type { UserChartSpec } from '../backend/attachments/types.ts';

const CHART_SPEC: UserChartSpec = {
  schemaVersion: 1,
  origin: 'user_dataset',
  trust: 'unverified',
  kind: 'line',
  xHeader: 'Year',
  yHeaders: ['Revenue'],
  series: [{ label: 'Revenue', points: [{ rowRef: 'r1:c1', xKey: '2020', xLabel: '2020', value: 100, formattedValue: '100,0', sourceText: '100,0' }] }],
  provenance: { datasetId: 1, sourceKind: 'file_csv', displayName: 'verkoop.csv', sourceUrlHost: null, capturedAt: '2026-01-01', contentSha256: 'x' },
  disclaimerLine: 'User-uploaded data — not verified by checkdecijfers.',
};

function chartMessage(): DatasetChatMessage {
  return {
    role: 'assistant',
    kind: 'chart',
    text: "Here's your chart.",
    chart: CHART_SPEC,
    lastInstruction: { version: 1, kind: 'line', x: 'c0', y: ['c1'], seriesBy: null, filters: [], sort: null, limit: null, unsupported: null },
  };
}

describe('datasetMessageHasVisual', () => {
  it('is true only for a chart-kind assistant message', () => {
    expect(datasetMessageHasVisual(chartMessage())).toBe(true);
    expect(datasetMessageHasVisual({ role: 'user', text: 'x' })).toBe(false);
    expect(datasetMessageHasVisual({ role: 'assistant', kind: 'clarification', text: 'x', options: [] })).toBe(false);
    expect(datasetMessageHasVisual({ role: 'assistant', kind: 'refusal', text: 'x', guidance: null })).toBe(false);
    expect(datasetMessageHasVisual({ role: 'redacted' })).toBe(false);
  });
});

describe('deriveDatasetVisuals', () => {
  it('produces no tabs for a thread with no chart turn', () => {
    expect(deriveDatasetVisuals([{ role: 'user', text: 'hi' }, { role: 'assistant', kind: 'refusal', text: 'no', guidance: null }])).toEqual([]);
  });

  it('produces one userChart tab per chart turn, labeled and questioned in order', () => {
    const messages: DatasetChatMessage[] = [
      { role: 'user', text: 'show revenue by year' },
      chartMessage(),
      { role: 'user', text: 'now as a bar chart' },
      chartMessage(),
    ];
    const visuals = deriveDatasetVisuals(messages);
    expect(visuals).toHaveLength(2);
    expect(visuals[0]).toEqual({
      id: 'visual-1',
      kind: 'userChart',
      label: 'Your chart 1',
      question: 'show revenue by year',
      chart: null,
      card: null,
      userChart: CHART_SPEC,
    });
    expect(visuals[1]!.id).toBe('visual-3');
    expect(visuals[1]!.label).toBe('Your chart 2');
    expect(visuals[1]!.question).toBe('now as a bar chart');
  });

  it('skips a redacted turn entirely — no tab, no crash', () => {
    const messages: DatasetChatMessage[] = [{ role: 'user', text: 'x' }, { role: 'redacted' }];
    expect(deriveDatasetVisuals(messages)).toEqual([]);
  });

  it('a clarification/refusal turn contributes no tab, and does not reset the running question', () => {
    const messages: DatasetChatMessage[] = [
      { role: 'user', text: 'q1' },
      { role: 'assistant', kind: 'clarification', text: 'Did you mean…', options: [] },
    ];
    expect(deriveDatasetVisuals(messages)).toEqual([]);
  });
});

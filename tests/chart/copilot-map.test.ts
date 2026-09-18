// mapCbsCopilotOutput — the CBS chart co-pilot's label→key mapping (session
// 114, co-pilot phase 3). The model answers in LABELS it was shown; every
// command stored (and later dispatched by web/lib) is derived from the
// spec by lookup here. Selection-only sibling of
// tests/attachments/copilot-map.test.ts, minus rule 1 (no instruction) and
// plus setPeriodRange (this tier's own command, resolved to period CODES).
import { describe, expect, it } from 'vitest';
import { mapCbsCopilotOutput } from '../../src/chart/copilot/map.ts';
import type { CbsCopilotCapabilities, CbsCopilotOutput, CbsViewCommand } from '../../src/chart/copilot/types.ts';
import { CBS_CAPABILITIES_FIXTURE, CHART_SPEC_FIXTURE } from './copilot-fixtures.ts';

function output(view: CbsViewCommand[], fields: Partial<CbsCopilotOutput> = {}): CbsCopilotOutput {
  return { version: 1, view, dataRequest: false, refused: [], confidence: 0.95, reading: 'test', ...fields };
}

const SUFFIX = 'zz1';

function map(out: CbsCopilotOutput, capabilities: CbsCopilotCapabilities = CBS_CAPABILITIES_FIXTURE) {
  return mapCbsCopilotOutput(out, CHART_SPEC_FIXTURE, capabilities, SUFFIX);
}

describe('setSeriesView — labels resolve to s${index} keys', () => {
  it('maps a known hidden label and highlighted label', () => {
    const { commands, refused } = map(
      output([{ kind: 'setSeriesView', hiddenLabels: ['Rotterdam'], highlightedLabel: 'Amsterdam' }]),
    );
    expect(refused).toEqual([]);
    expect(commands).toEqual([{ kind: 'setSeriesView', hiddenKeys: ['s1'], highlightedKey: 's0' }]);
  });

  it('refuses the whole command on an unknown label, with control form', () => {
    const { commands, refused } = map(
      output([{ kind: 'setSeriesView', hiddenLabels: ['Utrecht'], highlightedLabel: null }]),
    );
    expect(commands).toEqual([]);
    expect(refused).toEqual([{ request: 'series: Utrecht', reason: 'not_on_this_chart', control: 'form' }]);
  });
});

describe('setPeriodRange — labels resolve to period codes', () => {
  it('resolves both labels when zoom is available', () => {
    const { commands, refused } = map(
      output([{ kind: 'setPeriodRange', fromLabel: '2021', toLabel: '2022' }]),
    );
    expect(refused).toEqual([]);
    expect(commands).toEqual([{ kind: 'setPeriodRange', range: ['2021JJ00', '2022JJ00'] }]);
  });

  it('swaps reversed labels into ascending order', () => {
    const { commands } = map(output([{ kind: 'setPeriodRange', fromLabel: '2022', toLabel: '2020' }]));
    expect(commands).toEqual([{ kind: 'setPeriodRange', range: ['2020JJ00', '2022JJ00'] }]);
  });

  it('both labels null clears the zoom', () => {
    const { commands, refused } = map(output([{ kind: 'setPeriodRange', fromLabel: null, toLabel: null }]));
    expect(refused).toEqual([]);
    expect(commands).toEqual([{ kind: 'setPeriodRange', range: null }]);
  });

  it('refuses not_available/form when capabilities.zoom is false', () => {
    const { commands, refused } = map(
      output([{ kind: 'setPeriodRange', fromLabel: '2021', toLabel: '2022' }]),
      { ...CBS_CAPABILITIES_FIXTURE, zoom: false },
    );
    expect(commands).toEqual([]);
    expect(refused).toEqual([{ request: expect.stringContaining('2021'), reason: 'not_available', control: 'form' }]);
  });

  it('refuses an unknown period label', () => {
    const { commands, refused } = map(output([{ kind: 'setPeriodRange', fromLabel: '2019', toLabel: '2022' }]));
    expect(commands).toEqual([]);
    expect(refused[0]).toMatchObject({ reason: 'not_available', control: 'form' });
  });
});

describe('setForm — refused when the form is off-capability', () => {
  it('passes through a form the capabilities list', () => {
    const { commands } = map(output([{ kind: 'setForm', form: 'bar' }]));
    expect(commands).toEqual([{ kind: 'setForm', form: 'bar' }]);
  });

  it('refuses not_available/form for a form outside capabilities.forms', () => {
    const { commands, refused } = map(output([{ kind: 'setForm', form: 'hbar' }]));
    expect(commands).toEqual([]);
    expect(refused).toEqual([{ request: 'form: hbar', reason: 'not_available', control: 'form' }]);
  });
});

describe('applyTemplate', () => {
  it('passes through a known template id', () => {
    const { commands } = map(output([{ kind: 'applyTemplate', templateId: 'newsroom' }]));
    expect(commands).toEqual([{ kind: 'applyTemplate', templateId: 'newsroom' }]);
  });

  it('refuses an unknown template id', () => {
    const { commands, refused } = map(output([{ kind: 'applyTemplate', templateId: 'bogus' }]));
    expect(commands).toEqual([]);
    expect(refused).toEqual([{ request: 'template: bogus', reason: 'not_available', control: 'style' }]);
  });
});

describe('resetPresentation', () => {
  it('passes through', () => {
    const { commands } = map(output([{ kind: 'resetPresentation' }]));
    expect(commands).toEqual([{ kind: 'resetPresentation' }]);
  });
});

describe('setTitle / setCaption', () => {
  it('a title quoting only plotted numbers is stored', () => {
    const { commands } = map(output([{ kind: 'setTitle', title: 'Bevolking in 2021' }]));
    expect(commands).toEqual([{ kind: 'setTitle', title: 'Bevolking in 2021' }]);
  });

  it('null clears the title with no guard needed', () => {
    const { commands } = map(output([{ kind: 'setTitle', title: null }]));
    expect(commands).toEqual([{ kind: 'setTitle', title: null }]);
  });

  it('a caption naming an unplotted number is refused as unplotted_number', () => {
    const { commands, refused } = map(output([{ kind: 'setCaption', caption: '99 procent groei' }]));
    expect(commands).toEqual([]);
    expect(refused).toEqual([{ request: '99 procent groei', reason: 'unplotted_number', control: 'none' }]);
  });
});

describe('addNote', () => {
  it('anchors to the real point by (seriesLabel, periodLabel)', () => {
    const { commands } = map(output([{ kind: 'addNote', seriesLabel: 'Amsterdam', periodLabel: '2021', text: 'piek' }]));
    expect(commands).toHaveLength(1);
    const note = (commands[0] as unknown as { note: { id: string; resultId: string } }).note;
    expect(note.id).toMatch(/^chat-/);
    expect(note.resultId).toBe('TESTCBS:M1:GM0363:2021JJ00');
  });

  it('refuses a note whose text names an unplotted number', () => {
    const { commands, refused } = map(
      output([{ kind: 'addNote', seriesLabel: 'Amsterdam', periodLabel: '2021', text: '99 procent' }]),
    );
    expect(commands).toEqual([]);
    expect(refused).toEqual([{ request: '99 procent', reason: 'unplotted_number', control: 'none' }]);
  });

  it('refuses a note on a point that does not exist', () => {
    const { commands, refused } = map(
      output([{ kind: 'addNote', seriesLabel: 'Amsterdam', periodLabel: '2099', text: 'x' }]),
    );
    expect(commands).toEqual([]);
    expect(refused[0]).toMatchObject({ reason: 'not_on_this_chart', control: 'notes' });
  });
});

describe('model refusals — rule 8', () => {
  it('an unplotted number in the request text is stripped, not dropped', () => {
    const { refused } = map(output([], { refused: [{ request: 'maak 99% groter', reason: 'not_available', control: 'style' }] }));
    expect(refused).toEqual([{ request: 'maak % groter', reason: 'not_available', control: 'style' }]);
  });

  it('a clean request text passes through unchanged', () => {
    const { refused } = map(output([], { refused: [{ request: 'maak het rond', reason: 'not_available', control: 'none' }] }));
    expect(refused).toEqual([{ request: 'maak het rond', reason: 'not_available', control: 'none' }]);
  });
});

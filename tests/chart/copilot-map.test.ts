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
/** The raw user message, threaded through since co-pilot phase 6 (Task 2).
 * Only the goal-line guard reads it (Task 5) — those cases pass their own
 * message below; every other case is indifferent to it. */
const MESSAGE = 'test message';

function map(out: CbsCopilotOutput, capabilities: CbsCopilotCapabilities = CBS_CAPABILITIES_FIXTURE) {
  return mapCbsCopilotOutput(out, CHART_SPEC_FIXTURE, MESSAGE, capabilities, SUFFIX);
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

describe('setDimmed — labels resolve to s${index} keys, hidden and dimmed alike', () => {
  it('maps a dimmed label, leaving hidden empty', () => {
    const { commands, refused } = map(output([{ kind: 'setDimmed', hiddenLabels: [], dimmedLabels: ['Rotterdam'] }]));
    expect(refused).toEqual([]);
    expect(commands).toEqual([{ kind: 'setDimmed', hiddenKeys: [], dimmedKeys: ['s1'] }]);
  });

  it('maps hidden and dimmed labels together', () => {
    const { commands, refused } = map(
      output([{ kind: 'setDimmed', hiddenLabels: ['Amsterdam'], dimmedLabels: ['Rotterdam'] }]),
    );
    expect(refused).toEqual([]);
    expect(commands).toEqual([{ kind: 'setDimmed', hiddenKeys: ['s0'], dimmedKeys: ['s1'] }]);
  });

  it('refuses the whole command on an unknown label, with control form', () => {
    const { commands, refused } = map(output([{ kind: 'setDimmed', hiddenLabels: ['Utrecht'], dimmedLabels: [] }]));
    expect(commands).toEqual([]);
    expect(refused).toEqual([{ request: 'series: Utrecht', reason: 'not_on_this_chart', control: 'form' }]);
  });

  it('refuses a label named as both hidden and dimmed — the client would drop that on dispatch', () => {
    const { commands, refused } = map(
      output([{ kind: 'setDimmed', hiddenLabels: ['Rotterdam'], dimmedLabels: ['Rotterdam'] }]),
    );
    expect(commands).toEqual([]);
    expect(refused).toEqual([{ request: 'series: Rotterdam', reason: 'invalid', control: 'form' }]);
  });
});

describe('setHeadlineOverride — the point resolves to its own resultId', () => {
  it('resolves a real point by (seriesLabel, periodLabel)', () => {
    const { commands, refused } = map(
      output([{ kind: 'setHeadlineOverride', seriesLabel: 'Amsterdam', periodLabel: '2022' }]),
    );
    expect(refused).toEqual([]);
    expect(commands).toEqual([{ kind: 'setHeadlineOverride', resultId: 'TESTCBS:M1:GM0363:2022JJ00' }]);
  });

  it('both labels null clears the override', () => {
    const { commands, refused } = map(output([{ kind: 'setHeadlineOverride', seriesLabel: null, periodLabel: null }]));
    expect(refused).toEqual([]);
    expect(commands).toEqual([{ kind: 'setHeadlineOverride', resultId: null }]);
  });

  it('refuses one label without the other, pointing at the notes editor', () => {
    const { commands, refused } = map(
      output([{ kind: 'setHeadlineOverride', seriesLabel: 'Amsterdam', periodLabel: null }]),
    );
    expect(commands).toEqual([]);
    expect(refused).toEqual([{ request: 'headline: Amsterdam @ ?', reason: 'not_on_this_chart', control: 'notes' }]);
  });

  it('refuses a point that does not exist', () => {
    const { commands, refused } = map(
      output([{ kind: 'setHeadlineOverride', seriesLabel: 'Amsterdam', periodLabel: '2099' }]),
    );
    expect(commands).toEqual([]);
    expect(refused).toEqual([{ request: 'headline: Amsterdam @ 2099', reason: 'not_on_this_chart', control: 'notes' }]);
  });
});

describe('addEraShading — period labels resolve to codes, the label is digit-guarded', () => {
  it('resolves both labels, swapping reversed labels into ascending order', () => {
    const { commands, refused } = map(
      output([{ kind: 'addEraShading', fromLabel: '2022', toLabel: '2020', label: 'Herstel' }]),
    );
    expect(refused).toEqual([]);
    expect(commands).toEqual([
      {
        kind: 'addEraShading',
        era: { id: expect.stringMatching(/^chat-era-/), fromPeriodCode: '2020JJ00', toPeriodCode: '2022JJ00', label: 'Herstel' },
      },
    ]);
  });

  it('mints a distinct id per era in one reply — the client reducer drops a duplicate id', () => {
    const { commands } = map(
      output([
        { kind: 'addEraShading', fromLabel: '2020', toLabel: '2021', label: 'Eerst' },
        { kind: 'addEraShading', fromLabel: '2021', toLabel: '2022', label: 'Daarna' },
      ]),
    );
    expect(commands).toHaveLength(2);
    const ids = commands.map((command) => (command as unknown as { era: { id: string } }).era.id);
    expect(new Set(ids).size).toBe(2);
  });

  it('refuses a label naming an unplotted number', () => {
    const { commands, refused } = map(
      output([{ kind: 'addEraShading', fromLabel: '2020', toLabel: '2022', label: 'Groei van 99 procent' }]),
    );
    expect(commands).toEqual([]);
    expect(refused).toEqual([{ request: 'Groei van 99 procent', reason: 'unplotted_number', control: 'none' }]);
  });

  it('refuses an unknown period label', () => {
    const { commands, refused } = map(
      output([{ kind: 'addEraShading', fromLabel: '2019', toLabel: '2022', label: 'Herstel' }]),
    );
    expect(commands).toEqual([]);
    expect(refused).toEqual([{ request: 'era: 2019–2022', reason: 'not_available', control: 'notes' }]);
  });
});

describe('addDerivedOverlay — two real points of one series, or every point of one series', () => {
  // Final review (fix wave, #310): the same gate chart.tsx puts on its own
  // difference/mean buttons (line/area only) — without it, a bar/pie/stacked
  // chart stored a command that rendered nothing and could not be removed.
  it('refuses outright when capabilities.overlays is false, before any series/period lookup', () => {
    const { commands, refused } = map(
      output([{ kind: 'addDerivedOverlay', calcKind: 'mean', seriesLabel: 'Amsterdam', fromLabel: null, toLabel: null }]),
      { ...CBS_CAPABILITIES_FIXTURE, overlays: false },
    );
    expect(commands).toEqual([]);
    expect(refused).toEqual([{ request: 'overlay: Amsterdam', reason: 'not_available', control: 'form' }]);
  });

  it('difference resolves fromLabel/toLabel to the two points of the named series', () => {
    const { commands, refused } = map(
      output([{ kind: 'addDerivedOverlay', calcKind: 'difference', seriesLabel: 'Amsterdam', fromLabel: '2020', toLabel: '2022' }]),
    );
    expect(refused).toEqual([]);
    expect(commands).toEqual([
      {
        kind: 'addDerivedOverlay',
        overlay: {
          id: expect.stringMatching(/^chat-overlay-/),
          calcKind: 'difference',
          resultIds: ['TESTCBS:M1:GM0363:2020JJ00', 'TESTCBS:M1:GM0363:2022JJ00'],
        },
      },
    ]);
  });

  it('mean takes every point of the named series, a null-valued point included', () => {
    const { commands, refused } = map(
      output([{ kind: 'addDerivedOverlay', calcKind: 'mean', seriesLabel: 'Rotterdam', fromLabel: null, toLabel: null }]),
    );
    expect(refused).toEqual([]);
    expect(commands).toEqual([
      {
        kind: 'addDerivedOverlay',
        overlay: {
          id: expect.stringMatching(/^chat-overlay-/),
          calcKind: 'mean',
          resultIds: ['TESTCBS:M1:GM0599:2020JJ00', 'TESTCBS:M1:GM0599:2021JJ00', 'TESTCBS:M1:GM0599:2022JJ00'],
        },
      },
    ]);
  });

  it('mints a distinct id per overlay in one reply — the client reducer drops a duplicate id', () => {
    const { commands } = map(
      output([
        { kind: 'addDerivedOverlay', calcKind: 'mean', seriesLabel: 'Amsterdam', fromLabel: null, toLabel: null },
        { kind: 'addDerivedOverlay', calcKind: 'difference', seriesLabel: 'Amsterdam', fromLabel: '2020', toLabel: '2021' },
      ]),
    );
    expect(commands).toHaveLength(2);
    const ids = commands.map((command) => (command as unknown as { overlay: { id: string } }).overlay.id);
    expect(new Set(ids).size).toBe(2);
  });

  it('refuses an unknown series, with control form', () => {
    const { commands, refused } = map(
      output([{ kind: 'addDerivedOverlay', calcKind: 'mean', seriesLabel: 'Utrecht', fromLabel: null, toLabel: null }]),
    );
    expect(commands).toEqual([]);
    expect(refused).toEqual([{ request: 'overlay: Utrecht', reason: 'not_on_this_chart', control: 'form' }]);
  });

  it('refuses a difference whose from and to name the same point as invalid — both resolve, the combination is degenerate', () => {
    const { commands, refused } = map(
      output([{ kind: 'addDerivedOverlay', calcKind: 'difference', seriesLabel: 'Amsterdam', fromLabel: '2022', toLabel: '2022' }]),
    );
    expect(commands).toEqual([]);
    expect(refused).toEqual([{ request: 'overlay: 2022–2022', reason: 'invalid', control: 'form' }]);
  });

  it('refuses a difference missing one of its two period labels', () => {
    const { commands, refused } = map(
      output([{ kind: 'addDerivedOverlay', calcKind: 'difference', seriesLabel: 'Amsterdam', fromLabel: '2020', toLabel: null }]),
    );
    expect(commands).toEqual([]);
    expect(refused).toEqual([{ request: 'overlay: difference', reason: 'not_available', control: 'form' }]);
  });

  it('refuses a difference whose period is not a point of that series', () => {
    const { commands, refused } = map(
      output([{ kind: 'addDerivedOverlay', calcKind: 'difference', seriesLabel: 'Amsterdam', fromLabel: '2019', toLabel: '2022' }]),
    );
    expect(commands).toEqual([]);
    expect(refused).toEqual([{ request: 'overlay: 2019–2022', reason: 'not_on_this_chart', control: 'form' }]);
  });

  it('refuses a mean over a series with fewer than two points — the client would drop that on dispatch', () => {
    const onePoint = {
      ...CHART_SPEC_FIXTURE,
      series: [{ ...CHART_SPEC_FIXTURE.series[0]!, points: CHART_SPEC_FIXTURE.series[0]!.points.slice(0, 1) }],
    };
    const { commands, refused } = mapCbsCopilotOutput(
      output([{ kind: 'addDerivedOverlay', calcKind: 'mean', seriesLabel: 'Amsterdam', fromLabel: null, toLabel: null }]),
      onePoint,
      MESSAGE,
      CBS_CAPABILITIES_FIXTURE,
      SUFFIX,
    );
    expect(commands).toEqual([]);
    expect(refused).toEqual([{ request: 'overlay: Amsterdam', reason: 'not_on_this_chart', control: 'form' }]);
  });
});

describe('addGoalLine — the value must be one the reader typed, the label is digit-guarded', () => {
  /** Unlike every other case in this file, these depend on the MESSAGE:
   * the guard judges the value against the reader's own words. */
  function mapGoal(view: CbsViewCommand[], message: string) {
    return mapCbsCopilotOutput(output(view), CHART_SPEC_FIXTURE, message, CBS_CAPABILITIES_FIXTURE, SUFFIX);
  }

  it('stores a value that appears in the user message — a target is on no chart, and need not be', () => {
    const { commands, refused } = mapGoal(
      [{ kind: 'addGoalLine', value: 900000, label: 'Doel' }],
      'Voeg een doellijn toe op 900000',
    );
    expect(refused).toEqual([]);
    expect(commands).toEqual([
      { kind: 'addGoalLine', goalLine: { id: expect.stringMatching(/^chat-goal-/), value: 900000, label: 'Doel' } },
    ]);
  });

  it('accepts a locale-formatted spelling of the value in the message', () => {
    const { commands, refused } = mapGoal(
      [{ kind: 'addGoalLine', value: 900000, label: 'Doel' }],
      'Voeg een doellijn toe op 900.000',
    );
    expect(refused).toEqual([]);
    expect(commands).toHaveLength(1);
  });

  it('refuses a value the user never typed — nothing is stored, the form control is named', () => {
    const { commands, refused } = mapGoal(
      [{ kind: 'addGoalLine', value: 12345, label: 'Doel' }],
      'Voeg een doellijn toe',
    );
    expect(commands).toEqual([]);
    expect(refused).toEqual([{ request: 'goal line: 12345', reason: 'not_available', control: 'notes' }]);
  });

  it('refuses the reader\'s digits with a shifted decimal before anything is stored (Task 5 review finding)', () => {
    const { commands, refused } = mapGoal(
      [{ kind: 'addGoalLine', value: 2.5, label: 'Doel' }],
      'Zet een doellijn op 25',
    );
    expect(commands).toEqual([]);
    expect(refused).toEqual([{ request: 'goal line: 2.5', reason: 'not_available', control: 'notes' }]);
  });

  it('stores a negative target the reader typed with its sign', () => {
    const { commands, refused } = mapGoal(
      [{ kind: 'addGoalLine', value: -5, label: 'Doel' }],
      'Zet een doellijn op -5',
    );
    expect(refused).toEqual([]);
    expect(commands).toEqual([
      { kind: 'addGoalLine', goalLine: { id: expect.stringMatching(/^chat-goal-/), value: -5, label: 'Doel' } },
    ]);
  });

  it('refuses an unplotted number in the label even when the value is valid', () => {
    const { commands, refused } = mapGoal(
      [{ kind: 'addGoalLine', value: 900000, label: 'Doel voor 2030' }],
      'Voeg een doellijn toe op 900000',
    );
    expect(commands).toEqual([]);
    expect(refused).toEqual([{ request: 'Doel voor 2030', reason: 'unplotted_number', control: 'none' }]);
  });

  it('stores a label quoting a number that IS on the chart', () => {
    const { commands, refused } = mapGoal(
      [{ kind: 'addGoalLine', value: 900000, label: 'Doel voor 2021' }],
      'Voeg een doellijn toe op 900000',
    );
    expect(refused).toEqual([]);
    expect(commands).toEqual([
      { kind: 'addGoalLine', goalLine: { id: expect.stringMatching(/^chat-goal-/), value: 900000, label: 'Doel voor 2021' } },
    ]);
  });

  it('refuses an empty label — the client would drop that on dispatch', () => {
    const { commands, refused } = mapGoal(
      [{ kind: 'addGoalLine', value: 900000, label: '   ' }],
      'Voeg een doellijn toe op 900000',
    );
    expect(commands).toEqual([]);
    expect(refused).toEqual([{ request: '', reason: 'invalid', control: 'none' }]);
  });

  it('mints a distinct id per goal line in one reply — the client reducer drops a duplicate id', () => {
    const { commands, refused } = mapGoal(
      [
        { kind: 'addGoalLine', value: 900000, label: 'Ondergrens' },
        { kind: 'addGoalLine', value: 950000, label: 'Bovengrens' },
      ],
      'Doellijnen op 900000 en 950000',
    );
    expect(refused).toEqual([]);
    expect(commands).toHaveLength(2);
    const ids = commands.map((command) => (command as unknown as { goalLine: { id: string } }).goalLine.id);
    expect(new Set(ids).size).toBe(2);
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

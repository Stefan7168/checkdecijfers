// mapCopilotOutput — the deterministic label→key mapping (session 113,
// co-pilot phase 2). The model answers in LABELS it was shown; every
// command stored (and later dispatched by web/lib) is derived from the
// EXECUTED chart by lookup here. Anything that does not resolve becomes a
// refusal with the control that can do it — never a guess.
import { describe, expect, it } from 'vitest';
import { mapCopilotOutput } from '../../src/attachments/copilot/map.ts';
import type { CopilotCapabilities, CopilotOutput, CopilotViewCommand } from '../../src/attachments/copilot/types.ts';
import type { ChartInstruction } from '../../src/attachments/types.ts';
import { CAPABILITIES_FIXTURE, CHART_FIXTURE, CURRENT_FIXTURE } from './copilot-fixtures.ts';

function output(view: CopilotViewCommand[], fields: Partial<CopilotOutput> = {}): CopilotOutput {
  return { version: 1, instruction: null, view, refused: [], confidence: 0.95, reading: 'test', ...fields };
}

const SUMMARY = 'Sum of Revenue per Year';

/** A fixed note-id suffix — in production it is derived from Date.now(), so
 * the tests pin it to keep the ids assertable (final review, session 113). */
const SUFFIX = 'zz1';
/** The raw user message, threaded through since this tier's own wiring of
 * the CBS co-pilot phase 6 primitives. Only the goal-line guard reads it —
 * every other case below is indifferent to it. */
const MESSAGE = 'test message';

function map(out: CopilotOutput, capabilities: CopilotCapabilities = CAPABILITIES_FIXTURE, message: string = MESSAGE) {
  return mapCopilotOutput(out, CHART_FIXTURE, CURRENT_FIXTURE, SUMMARY, message, capabilities, SUFFIX);
}

const NEW_INSTRUCTION: ChartInstruction = {
  version: 2,
  kind: 'bar',
  x: 'c0',
  y: ['c2'],
  seriesBy: 'c1',
  filters: [],
  sort: null,
  limit: null,
  aggregate: { fn: 'sum' },
  derived: null,
  confidence: 0.95,
  reading: 'server-only',
  unsupported: null,
};

describe('rule 1 — a changed instruction becomes the FIRST command', () => {
  it('emits setInstruction with the client projection and the summary', () => {
    const { commands, refused } = map(output([{ kind: 'setForm', form: 'bar' }], { instruction: NEW_INSTRUCTION }));
    expect(refused).toEqual([]);
    expect(commands[0]).toEqual({
      kind: 'setInstruction',
      instruction: {
        version: 2,
        kind: 'bar',
        x: 'c0',
        y: ['c2'],
        seriesBy: 'c1',
        filters: [],
        sort: null,
        limit: null,
        aggregate: { fn: 'sum' },
        derived: null,
        unsupported: null,
      },
      summary: SUMMARY,
    });
    expect(commands[1]).toEqual({ kind: 'setForm', form: 'bar' });
  });

  it('never carries a server-only field into the stored command', () => {
    const { commands } = map(output([], { instruction: NEW_INSTRUCTION }));
    expect(JSON.stringify(commands)).not.toContain('server-only');
    expect(JSON.stringify(commands)).not.toContain('confidence');
  });

  it('drops an instruction identical to what is already on screen', () => {
    const same: ChartInstruction = { ...NEW_INSTRUCTION, kind: 'line', aggregate: null };
    const { commands } = map(output([], { instruction: same }));
    expect(commands).toEqual([]);
  });
});

describe('rule 2 — setForm passes through', () => {
  it('keeps the form as the model named it', () => {
    expect(map(output([{ kind: 'setForm', form: 'table' }])).commands).toEqual([{ kind: 'setForm', form: 'table' }]);
  });
});

describe('rule 3 — setSeriesView labels become s<index> keys', () => {
  it('maps every known label to its series index', () => {
    const { commands, refused } = map(
      output([{ kind: 'setSeriesView', hiddenLabels: ['Rotterdam'], highlightedLabel: 'Amsterdam' }]),
    );
    expect(refused).toEqual([]);
    expect(commands).toEqual([{ kind: 'setSeriesView', hiddenKeys: ['s1'], highlightedKey: 's0' }]);
  });

  it('refuses the WHOLE command when any label is not on this chart', () => {
    const { commands, refused } = map(
      output([{ kind: 'setSeriesView', hiddenLabels: ['Utrecht'], highlightedLabel: 'Amsterdam' }]),
    );
    expect(commands).toEqual([]);
    expect(refused).toEqual([{ request: 'series: Utrecht', reason: 'not_on_this_chart', control: 'form' }]);
  });

  it('accepts a null highlight', () => {
    const { commands } = map(output([{ kind: 'setSeriesView', hiddenLabels: [], highlightedLabel: null }]));
    expect(commands).toEqual([{ kind: 'setSeriesView', hiddenKeys: [], highlightedKey: null }]);
  });
});

describe('rule 4 — setPresentation strips nulls and maps series colours', () => {
  function patch(fields: Record<string, unknown>) {
    return {
      kind: 'setPresentation' as const,
      patch: {
        lineWidth: null,
        markers: null,
        grid: null,
        xLabels: null,
        axisLines: null,
        zeroBaseline: null,
        areaFill: null,
        pieHole: null,
        fontFamily: null,
        seriesColors: [],
        framePadding: null,
        frameCorners: null,
        frameShadow: null,
        ...fields,
      },
    } as CopilotViewCommand;
  }

  it('keeps only the keys the model actually set', () => {
    const { commands } = map(output([patch({ lineWidth: 'thick', grid: 'none' })]));
    expect(commands).toEqual([{ kind: 'setPresentation', patch: { lineWidth: 'thick', grid: 'none' } }]);
  });

  it('turns a series label + hex into an index-keyed colour map, lower-cased', () => {
    const { commands } = map(output([patch({ seriesColors: [{ seriesLabel: 'Rotterdam', hex: '#AABBCC' }] })]));
    expect(commands).toEqual([{ kind: 'setPresentation', patch: { seriesColors: { 1: '#aabbcc' } } }]);
  });

  it('drops an unknown label and a malformed hex, keeping the rest', () => {
    const { commands } = map(
      output([
        patch({
          seriesColors: [
            { seriesLabel: 'Utrecht', hex: '#aabbcc' },
            { seriesLabel: 'Amsterdam', hex: 'red' },
            { seriesLabel: 'Amsterdam', hex: '#123456' },
          ],
        }),
      ]),
    );
    expect(commands).toEqual([{ kind: 'setPresentation', patch: { seriesColors: { 0: '#123456' } } }]);
  });

  it('keeps a font family the panel would accept', () => {
    const { commands } = map(output([patch({ fontFamily: 'Playfair Display' })]));
    expect(commands).toEqual([{ kind: 'setPresentation', patch: { fontFamily: 'Playfair Display' } }]);
  });

  it('drops a font family the panel would silently reject', () => {
    // web/lib's FONT_FAMILY_NAME: letters, digits and spaces, 1..40 chars.
    const { commands, refused } = map(output([patch({ fontFamily: '"Comic Sans MS", cursive' })]));
    expect(commands).toEqual([]);
    expect(refused).toEqual([]);
  });

  it('keeps the rest of a patch whose font family was dropped', () => {
    const { commands } = map(output([patch({ fontFamily: 'x'.repeat(41), grid: 'none' })]));
    expect(commands).toEqual([{ kind: 'setPresentation', patch: { grid: 'none' } }]);
  });

  it('drops an entirely empty patch silently', () => {
    const { commands, refused } = map(output([patch({})]));
    expect(commands).toEqual([]);
    expect(refused).toEqual([]);
  });
});

describe('rule 5 — applyTemplate is allowlisted', () => {
  it('keeps a known template id', () => {
    expect(map(output([{ kind: 'applyTemplate', templateId: 'newsroom' }])).commands).toEqual([
      { kind: 'applyTemplate', templateId: 'newsroom' },
    ]);
  });

  it('refuses an unknown template id as not_available', () => {
    const { commands, refused } = map(output([{ kind: 'applyTemplate', templateId: 'neon' }]));
    expect(commands).toEqual([]);
    expect(refused).toEqual([{ request: 'template: neon', reason: 'not_available', control: 'style' }]);
  });

  it('passes resetPresentation through', () => {
    expect(map(output([{ kind: 'resetPresentation' }])).commands).toEqual([{ kind: 'resetPresentation' }]);
  });
});

describe('rule 6 — title/caption are trimmed, capped and digit-guarded', () => {
  it('keeps a title whose numbers are on the chart', () => {
    const { commands } = map(output([{ kind: 'setTitle', title: '  Omzet piekt in 2021  ' }]));
    expect(commands).toEqual([{ kind: 'setTitle', title: 'Omzet piekt in 2021' }]);
  });

  it('refuses a title containing a number that is not plotted', () => {
    const { commands, refused } = map(output([{ kind: 'setTitle', title: 'Omzet stijgt met 12 procent' }]));
    expect(commands).toEqual([]);
    expect(refused).toEqual([
      { request: 'Omzet stijgt met 12 procent', reason: 'unplotted_number', control: 'none' },
    ]);
  });

  it('caps a caption at its maximum length', () => {
    const long = 'a'.repeat(400);
    const { commands } = map(output([{ kind: 'setCaption', caption: long }]));
    expect(commands).toEqual([{ kind: 'setCaption', caption: 'a'.repeat(280) }]);
  });

  it('passes a null title through as a clear', () => {
    expect(map(output([{ kind: 'setTitle', title: null }])).commands).toEqual([{ kind: 'setTitle', title: null }]);
  });

  it('refuses an empty title as invalid', () => {
    const { commands, refused } = map(output([{ kind: 'setTitle', title: '   ' }]));
    expect(commands).toEqual([]);
    expect(refused).toEqual([{ request: '', reason: 'invalid', control: 'none' }]);
  });
});

describe('rule 7 — addNote resolves a point by series + x label', () => {
  it('builds a deterministic note id from the point rowRef', () => {
    const { commands } = map(
      output([{ kind: 'addNote', seriesLabel: 'Amsterdam', xLabel: '2021', text: ' Hoogste punt ' }]),
    );
    expect(commands).toEqual([
      {
        kind: 'addNote',
        note: {
          id: 'chat-r2:c2-0zz1',
          resultId: 'r2:c2',
          periodLabel: '2021',
          seriesLabel: 'Amsterdam',
          text: 'Hoogste punt',
        },
      },
    ]);
  });

  it('refuses a point that is not on this chart', () => {
    const { commands, refused } = map(
      output([{ kind: 'addNote', seriesLabel: 'Amsterdam', xLabel: '2019', text: 'Start' }]),
    );
    expect(commands).toEqual([]);
    expect(refused).toEqual([
      { request: 'note: Amsterdam @ 2019', reason: 'not_on_this_chart', control: 'notes' },
    ]);
  });

  it('gives two notes on the SAME point two distinct ids', () => {
    const { commands } = map(
      output([
        { kind: 'addNote', seriesLabel: 'Amsterdam', xLabel: '2021', text: 'Eerste' },
        { kind: 'addNote', seriesLabel: 'Amsterdam', xLabel: '2021', text: 'Tweede' },
      ]),
    );
    const ids = commands.map((c) => (c as unknown as { note: { id: string } }).note.id);
    expect(ids).toEqual(['chat-r2:c2-0zz1', 'chat-r2:c2-1zz1']);
    expect(new Set(ids).size).toBe(2);
  });

  it('digit-guards the note text like a title', () => {
    const { refused } = map(
      output([{ kind: 'addNote', seriesLabel: 'Amsterdam', xLabel: '2021', text: 'plus 12 procent' }]),
    );
    expect(refused).toEqual([{ request: 'plus 12 procent', reason: 'unplotted_number', control: 'none' }]);
  });
});

// Own-data wiring of the CBS tier's co-pilot phase 6 primitives (mirrors
// tests/chart/copilot-map.test.ts's own describe blocks for these five
// kinds, adapted to CHART_FIXTURE's shape: Amsterdam has points at '2020'
// and '2021' only; Rotterdam has '2020' (real), '2021' (null) and '2022'
// (negative) — so a label may resolve chart-wide (via Rotterdam) while
// still not being a point of Amsterdam's own series).
//
// setDimmed and setHeadlineOverride specifically (session 122, further
// continuation, open-questions #311): added later than the other three —
// the original own-data-parity pass skipped them on the wrong assumption
// that the panel already dispatching both generically meant the chat could
// name them too. It could not; this closes that gap.
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

  // #309 (mirrors the CBS tier's own test — src/chart/copilot/map.ts's
  // identical fix): the model is never told which series the reader already
  // hid or dimmed by clicking the legend, so a wholesale replace of its own
  // hiddenLabels/dimmedLabels would silently show a series the reader hid.
  describe('#309 — merges onto the reader-held state instead of replacing it wholesale', () => {
    it('a reader-hidden series stays hidden when the chat only asks to dim another one', () => {
      const { commands, refused } = map(
        output([{ kind: 'setDimmed', hiddenLabels: [], dimmedLabels: ['Amsterdam'] }]),
        { ...CAPABILITIES_FIXTURE, currentHiddenKeys: ['s1'], currentDimmedKeys: [] },
      );
      expect(refused).toEqual([]);
      expect(commands).toEqual([{ kind: 'setDimmed', hiddenKeys: ['s1'], dimmedKeys: ['s0'] }]);
    });

    it('naming a series the reader already held overrides ITS OWN prior state', () => {
      const { commands } = map(
        output([{ kind: 'setDimmed', hiddenLabels: ['Rotterdam'], dimmedLabels: [] }]),
        { ...CAPABILITIES_FIXTURE, currentHiddenKeys: [], currentDimmedKeys: ['s1'] },
      );
      expect(commands).toEqual([{ kind: 'setDimmed', hiddenKeys: ['s1'], dimmedKeys: [] }]);
    });

    it('absent currentHiddenKeys/currentDimmedKeys reads as nothing held — same as before #309', () => {
      const { commands } = map(output([{ kind: 'setDimmed', hiddenLabels: [], dimmedLabels: ['Rotterdam'] }]));
      expect(commands).toEqual([{ kind: 'setDimmed', hiddenKeys: [], dimmedKeys: ['s1'] }]);
    });

    it('drops a stale/malformed current key that is not a real series on this chart', () => {
      const { commands } = map(
        output([{ kind: 'setDimmed', hiddenLabels: [], dimmedLabels: ['Amsterdam'] }]),
        { ...CAPABILITIES_FIXTURE, currentHiddenKeys: ['s9'], currentDimmedKeys: [] },
      );
      expect(commands).toEqual([{ kind: 'setDimmed', hiddenKeys: [], dimmedKeys: ['s0'] }]);
    });
  });
});

describe('setHeadlineOverride — the point resolves to its own rowRef', () => {
  it('resolves a real point by (seriesLabel, xLabel)', () => {
    const { commands, refused } = map(output([{ kind: 'setHeadlineOverride', seriesLabel: 'Amsterdam', xLabel: '2021' }]));
    expect(refused).toEqual([]);
    expect(commands).toEqual([{ kind: 'setHeadlineOverride', resultId: 'r2:c2' }]);
  });

  it('both labels null clears the override', () => {
    const { commands, refused } = map(output([{ kind: 'setHeadlineOverride', seriesLabel: null, xLabel: null }]));
    expect(refused).toEqual([]);
    expect(commands).toEqual([{ kind: 'setHeadlineOverride', resultId: null }]);
  });

  it('refuses one label without the other, pointing at the notes editor', () => {
    const { commands, refused } = map(output([{ kind: 'setHeadlineOverride', seriesLabel: 'Amsterdam', xLabel: null }]));
    expect(commands).toEqual([]);
    expect(refused).toEqual([{ request: 'headline: Amsterdam @ ?', reason: 'not_on_this_chart', control: 'notes' }]);
  });

  it('refuses a point that does not exist', () => {
    const { commands, refused } = map(output([{ kind: 'setHeadlineOverride', seriesLabel: 'Amsterdam', xLabel: '2099' }]));
    expect(commands).toEqual([]);
    expect(refused).toEqual([{ request: 'headline: Amsterdam @ 2099', reason: 'not_on_this_chart', control: 'notes' }]);
  });
});

describe('addEraShading — labels resolve to x keys, the label is digit-guarded', () => {
  it('resolves both labels, swapping reversed labels into ascending order', () => {
    const { commands, refused } = map(output([{ kind: 'addEraShading', fromLabel: '2022', toLabel: '2020', label: 'Herstel' }]));
    expect(refused).toEqual([]);
    expect(commands).toEqual([
      {
        kind: 'addEraShading',
        era: { id: expect.stringMatching(/^chat-era-/), fromPeriodCode: '2020', toPeriodCode: '2022', label: 'Herstel' },
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
      output([{ kind: 'addEraShading', fromLabel: '2020', toLabel: '2021', label: 'Groei van 99 procent' }]),
    );
    expect(commands).toEqual([]);
    expect(refused).toEqual([{ request: 'Groei van 99 procent', reason: 'unplotted_number', control: 'none' }]);
  });

  it('refuses an unknown x label, pointing at the notes editor', () => {
    const { commands, refused } = map(output([{ kind: 'addEraShading', fromLabel: '2019', toLabel: '2021', label: 'Herstel' }]));
    expect(commands).toEqual([]);
    expect(refused).toEqual([{ request: 'era: 2019–2021', reason: 'not_available', control: 'notes' }]);
  });
});

describe('addDerivedOverlay — two real points of one series, or every point of one series', () => {
  // Mirrors the CBS tier's own fix (#310): the same gate its panel puts on
  // its own difference/mean buttons (line/area only) — without it, a
  // bar/table chart's chat stored a command that rendered nothing and could
  // not be removed.
  it('refuses outright when capabilities.overlays is false, before any series/x-label lookup', () => {
    const { commands, refused } = map(
      output([{ kind: 'addDerivedOverlay', calcKind: 'mean', seriesLabel: 'Amsterdam', fromLabel: null, toLabel: null }]),
      { ...CAPABILITIES_FIXTURE, overlays: false },
    );
    expect(commands).toEqual([]);
    expect(refused).toEqual([{ request: 'overlay: Amsterdam', reason: 'not_available', control: 'form' }]);
  });

  it('difference resolves fromLabel/toLabel to the two points of the named series', () => {
    const { commands, refused } = map(
      output([{ kind: 'addDerivedOverlay', calcKind: 'difference', seriesLabel: 'Amsterdam', fromLabel: '2020', toLabel: '2021' }]),
    );
    expect(refused).toEqual([]);
    expect(commands).toEqual([
      {
        kind: 'addDerivedOverlay',
        overlay: { id: expect.stringMatching(/^chat-overlay-/), calcKind: 'difference', resultIds: ['r1:c2', 'r2:c2'] },
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
        overlay: { id: expect.stringMatching(/^chat-overlay-/), calcKind: 'mean', resultIds: ['r3:c2', 'r4:c2', 'r5:c2'] },
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
      output([{ kind: 'addDerivedOverlay', calcKind: 'difference', seriesLabel: 'Amsterdam', fromLabel: '2021', toLabel: '2021' }]),
    );
    expect(commands).toEqual([]);
    expect(refused).toEqual([{ request: 'overlay: 2021–2021', reason: 'invalid', control: 'form' }]);
  });

  it('refuses a difference missing one of its two x labels', () => {
    const { commands, refused } = map(
      output([{ kind: 'addDerivedOverlay', calcKind: 'difference', seriesLabel: 'Amsterdam', fromLabel: '2020', toLabel: null }]),
    );
    expect(commands).toEqual([]);
    expect(refused).toEqual([{ request: 'overlay: difference', reason: 'not_available', control: 'form' }]);
  });

  it('refuses a difference whose x label is not a point of THAT series, even though it resolves chart-wide via another series', () => {
    const { commands, refused } = map(
      output([{ kind: 'addDerivedOverlay', calcKind: 'difference', seriesLabel: 'Amsterdam', fromLabel: '2022', toLabel: '2021' }]),
    );
    expect(commands).toEqual([]);
    expect(refused).toEqual([{ request: 'overlay: 2022–2021', reason: 'not_on_this_chart', control: 'form' }]);
  });

  it('refuses a mean over a series with fewer than two points — the client would drop that on dispatch', () => {
    const onePoint = { ...CHART_FIXTURE, series: [{ ...CHART_FIXTURE.series[0]!, points: CHART_FIXTURE.series[0]!.points.slice(0, 1) }] };
    const { commands, refused } = mapCopilotOutput(
      output([{ kind: 'addDerivedOverlay', calcKind: 'mean', seriesLabel: 'Amsterdam', fromLabel: null, toLabel: null }]),
      onePoint,
      CURRENT_FIXTURE,
      SUMMARY,
      MESSAGE,
      CAPABILITIES_FIXTURE,
      SUFFIX,
    );
    expect(commands).toEqual([]);
    expect(refused).toEqual([{ request: 'overlay: Amsterdam', reason: 'not_on_this_chart', control: 'form' }]);
  });
});

describe('addGoalLine — the value must be one the reader typed, the label is digit-guarded', () => {
  /** Unlike every other case in this file, these depend on the MESSAGE: the
   * guard judges the value against the reader's own words. */
  function mapGoal(view: CopilotViewCommand[], message: string) {
    return mapCopilotOutput(output(view), CHART_FIXTURE, CURRENT_FIXTURE, SUMMARY, message, CAPABILITIES_FIXTURE, SUFFIX);
  }

  it('stores a value that appears in the user message — a target is on no chart, and need not be', () => {
    const { commands, refused } = mapGoal([{ kind: 'addGoalLine', value: 120, label: 'Doel' }], 'Voeg een doellijn toe op 120');
    expect(refused).toEqual([]);
    expect(commands).toEqual([{ kind: 'addGoalLine', goalLine: { id: expect.stringMatching(/^chat-goal-/), value: 120, label: 'Doel' } }]);
  });

  it('accepts a locale-formatted spelling of the value in the message', () => {
    const { commands, refused } = mapGoal([{ kind: 'addGoalLine', value: 900000, label: 'Doel' }], 'Voeg een doellijn toe op 900.000');
    expect(refused).toEqual([]);
    expect(commands).toHaveLength(1);
  });

  it('refuses a value the user never typed — nothing is stored, the form control is named', () => {
    const { commands, refused } = mapGoal([{ kind: 'addGoalLine', value: 12345, label: 'Doel' }], 'Voeg een doellijn toe');
    expect(commands).toEqual([]);
    expect(refused).toEqual([{ request: 'goal line: 12345', reason: 'not_available', control: 'notes' }]);
  });

  it("refuses the reader's digits with a shifted decimal before anything is stored", () => {
    const { commands, refused } = mapGoal([{ kind: 'addGoalLine', value: 2.5, label: 'Doel' }], 'Zet een doellijn op 25');
    expect(commands).toEqual([]);
    expect(refused).toEqual([{ request: 'goal line: 2.5', reason: 'not_available', control: 'notes' }]);
  });

  it('stores a negative target the reader typed with its sign', () => {
    const { commands, refused } = mapGoal([{ kind: 'addGoalLine', value: -5, label: 'Doel' }], 'Zet een doellijn op -5');
    expect(refused).toEqual([]);
    expect(commands).toEqual([{ kind: 'addGoalLine', goalLine: { id: expect.stringMatching(/^chat-goal-/), value: -5, label: 'Doel' } }]);
  });

  it('refuses an unplotted number in the label even when the value is valid', () => {
    const { commands, refused } = mapGoal([{ kind: 'addGoalLine', value: 120, label: 'Doel voor 2030' }], 'Voeg een doellijn toe op 120');
    expect(commands).toEqual([]);
    expect(refused).toEqual([{ request: 'Doel voor 2030', reason: 'unplotted_number', control: 'none' }]);
  });

  it('stores a label quoting a number that IS on the chart', () => {
    const { commands, refused } = mapGoal([{ kind: 'addGoalLine', value: 120, label: 'Doel voor 2021' }], 'Voeg een doellijn toe op 120');
    expect(refused).toEqual([]);
    expect(commands).toEqual([
      { kind: 'addGoalLine', goalLine: { id: expect.stringMatching(/^chat-goal-/), value: 120, label: 'Doel voor 2021' } },
    ]);
  });

  it('refuses an empty label — the client would drop that on dispatch', () => {
    const { commands, refused } = mapGoal([{ kind: 'addGoalLine', value: 120, label: '   ' }], 'Voeg een doellijn toe op 120');
    expect(commands).toEqual([]);
    expect(refused).toEqual([{ request: '', reason: 'invalid', control: 'none' }]);
  });

  it('mints a distinct id per goal line in one reply — the client reducer drops a duplicate id', () => {
    const { commands, refused } = mapGoal(
      [
        { kind: 'addGoalLine', value: 100, label: 'Ondergrens' },
        { kind: 'addGoalLine', value: 150, label: 'Bovengrens' },
      ],
      'Doellijnen op 100 en 150',
    );
    expect(refused).toEqual([]);
    expect(commands).toHaveLength(2);
    const ids = commands.map((command) => (command as unknown as { goalLine: { id: string } }).goalLine.id);
    expect(new Set(ids).size).toBe(2);
  });
});

describe('rule 8 — the model own refusals pass through', () => {
  it('caps the request text at 80 characters', () => {
    const { refused } = map(
      output([], { refused: [{ request: 'x'.repeat(200), reason: 'needs_click', control: 'notes' }] }),
    );
    expect(refused).toEqual([{ request: 'x'.repeat(80), reason: 'needs_click', control: 'notes' }]);
  });

  it('appends them after the mapping refusals', () => {
    const { refused } = map(
      output([{ kind: 'applyTemplate', templateId: 'neon' }], {
        refused: [{ request: 'make it three-dimensional', reason: 'not_available', control: 'none' }],
      }),
    );
    expect(refused.map((r) => r.request)).toEqual(['template: neon', 'make it three-dimensional']);
  });

  // Final review (session 113): the model's refusal text reaches the screen
  // too, so it owes the reader the same digit guard as a title/caption/note
  // — but stripped, never dropped: a hidden refusal is worse than a
  // number-free one.
  it('strips a number that is not on the chart from the request text', () => {
    const { refused } = map(
      output([], { refused: [{ request: 'the total of 4.521', reason: 'needs_click', control: 'none' }] }),
    );
    expect(refused).toEqual([{ request: 'the total of', reason: 'needs_click', control: 'none' }]);
  });

  it('keeps a number that IS plotted in the request text', () => {
    const { refused } = map(
      output([], { refused: [{ request: 'why is 150 the top?', reason: 'needs_click', control: 'none' }] }),
    );
    expect(refused).toEqual([{ request: 'why is 150 the top?', reason: 'needs_click', control: 'none' }]);
  });
});

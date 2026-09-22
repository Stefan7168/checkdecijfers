// mapCopilotOutput — the deterministic label→key mapping (session 113,
// co-pilot phase 2). The model answers in LABELS it was shown; every
// command stored (and later dispatched by web/lib) is derived from the
// EXECUTED chart by lookup here. Anything that does not resolve becomes a
// refusal with the control that can do it — never a guess.
import { describe, expect, it } from 'vitest';
import { mapCopilotOutput } from '../../src/attachments/copilot/map.ts';
import type { CopilotOutput, CopilotViewCommand } from '../../src/attachments/copilot/types.ts';
import type { ChartInstruction } from '../../src/attachments/types.ts';
import { CHART_FIXTURE, CURRENT_FIXTURE } from './copilot-fixtures.ts';

function output(view: CopilotViewCommand[], fields: Partial<CopilotOutput> = {}): CopilotOutput {
  return { version: 1, instruction: null, view, refused: [], confidence: 0.95, reading: 'test', ...fields };
}

const SUMMARY = 'Sum of Revenue per Year';

/** A fixed note-id suffix — in production it is derived from Date.now(), so
 * the tests pin it to keep the ids assertable (final review, session 113). */
const SUFFIX = 'zz1';

function map(out: CopilotOutput) {
  return mapCopilotOutput(out, CHART_FIXTURE, CURRENT_FIXTURE, SUMMARY, SUFFIX);
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

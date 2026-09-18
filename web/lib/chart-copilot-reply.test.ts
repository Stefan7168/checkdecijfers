// Co-pilot phase 2 (session 113, Task 8) — the client's own gate on a stored
// co-pilot reply. The server already mapped labels to keys against the chart
// it executed; this is the SECOND, authoritative check: every command is
// shape-parsed and re-validated against the chart the card is about to draw,
// and anything that does not survive is counted, never dispatched.
import { describe, expect, it } from 'vitest';
import { acceptReply, refusalLine, replayChips } from './chart-copilot-reply.ts';
import type { CommandContext } from './chart-commands.ts';
import type { ClientChartInstruction, CopilotCommand, DatasetProfile } from '../backend/attachments/types.ts';

const PROFILE: DatasetProfile = {
  columns: [
    { id: 'c0', header: 'Gemeente', type: 'text', distinct: ['Amsterdam', 'Rotterdam'], nulls: 0 },
    { id: 'c1', header: 'Omzet', type: 'number', numberFormat: 'nl', nulls: 0 },
  ],
  rowCount: 2,
};

const INSTRUCTION: ClientChartInstruction = {
  version: 2,
  kind: 'bar',
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

function ctx(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    spec: {
      kind: 'bar',
      series: [
        {
          label: 'Omzet',
          regionCode: null,
          points: [
            { resultId: 'r1', periodCode: 'a', periodLabel: 'a', value: 1, formattedValue: '1', decimals: 0, status: '', provisional: false, valueAttribute: '' },
          ],
        },
      ],
    },
    alternatesCount: 0,
    profile: PROFILE,
    ...overrides,
  };
}

describe('acceptReply', () => {
  it('accepts the commands this chart can take and labels them via describeCommand', () => {
    const commands: CopilotCommand[] = [
      { kind: 'setInstruction', instruction: INSTRUCTION, summary: 'Omzet per Gemeente' },
      { kind: 'setForm', form: 'bar' },
      { kind: 'applyTemplate', templateId: 'newsroom' },
    ];
    const { applied, dropped } = acceptReply(commands, ctx(), 'nl');
    expect(dropped).toBe(0);
    expect(applied.map((a) => a.label)).toEqual(['Data: Omzet per Gemeente', 'Weergave: Staaf', 'Sjabloon: Redactie']);
    expect(applied.map((a) => a.icon)).toEqual(['data', 'form', 'template']);
    expect(applied.map((a) => a.opens)).toEqual(['data', 'form', 'style']);
    expect(applied[0]!.command).toEqual({ kind: 'setInstruction', instruction: INSTRUCTION, summary: 'Omzet per Gemeente' });
  });

  it('drops and counts a command that does not validate against THIS chart', () => {
    // Only 's0' exists on a one-series chart.
    const { applied, dropped } = acceptReply([{ kind: 'setSeriesView', hiddenKeys: ['s7'], highlightedKey: null }], ctx(), 'nl');
    expect(applied).toEqual([]);
    expect(dropped).toBe(1);
  });

  it('drops a command whose stored SHAPE is wrong, without throwing', () => {
    const { applied, dropped } = acceptReply([{ kind: 'setForm', form: 'pie' }, { kind: 'nonsense' }], ctx(), 'nl');
    expect(applied).toEqual([]);
    expect(dropped).toBe(2);
  });

  it('drops a setInstruction when the context has no dataset profile (a CBS chart, ADR 037 D11)', () => {
    const { applied, dropped } = acceptReply(
      [{ kind: 'setInstruction', instruction: INSTRUCTION, summary: 'Omzet per Gemeente' }],
      ctx({ profile: undefined }),
      'nl',
    );
    expect(applied).toEqual([]);
    expect(dropped).toBe(1);
  });

  it('maps every chat-reachable kind to its panel icon and doorway', () => {
    const commands: CopilotCommand[] = [
      { kind: 'setSeriesView', hiddenKeys: [], highlightedKey: 's0' },
      { kind: 'setPresentation', patch: { grid: 'none' } },
      { kind: 'resetPresentation' },
      { kind: 'setTitle', title: 'Een kop' },
      { kind: 'setCaption', caption: 'Een bijschrift' },
      { kind: 'addNote', note: { id: 'chat-r1', resultId: 'r1', periodLabel: 'a', seriesLabel: 'Omzet', text: 'Let hierop' } },
    ];
    const { applied, dropped } = acceptReply(commands, ctx(), 'nl');
    expect(dropped).toBe(0);
    expect(applied.map((a) => a.icon)).toEqual(['series', 'style', 'style', 'title', 'caption', 'note']);
    expect(applied.map((a) => a.opens)).toEqual(['none', 'style', 'style', 'none', 'none', 'notes']);
  });
});

describe('refusalLine', () => {
  it('composes the echoed request, the reason and the control hint (nl)', () => {
    const line = refusalLine({ request: 'kleur van de lijn', reason: 'not_available', control: 'style' }, 'nl');
    expect(line).toContain('kleur van de lijn');
    expect(line).toContain('kan deze grafiek niet');
    expect(line).toContain('Opmaak: open het paneel Opmaak.');
    // Never "ask for a feature" — always the control that CAN do it.
    expect(line).not.toMatch(/functie|feature/i);
  });

  it('composes the same three pieces in en', () => {
    const line = refusalLine({ request: 'note on the peak', reason: 'needs_click', control: 'notes' }, 'en');
    expect(line).toContain('note on the peak');
    expect(line).toContain('needs a click');
    expect(line).toContain('Notes: click a point on the chart.');
  });

  it('degrades an unknown stored reason/control to the generic line, never to "undefined"', () => {
    const line = refusalLine({ request: 'x', reason: 'from_a_newer_row', control: 'somewhere' } as never, 'nl');
    expect(line).toBe('x: kon niet worden toegepast.');
  });

  it('omits the empty hint and an empty request without leaving stray punctuation', () => {
    const line = refusalLine({ request: '', reason: 'unplotted_number', control: 'none' }, 'nl');
    expect(line).toBe('bevat een getal dat niet in de grafiek staat.');
  });
});

describe('replayChips', () => {
  it('labels stored commands for a replayed edit message, skipping unparseable ones', () => {
    const chips = replayChips([{ kind: 'setForm', form: 'bar' }, { kind: 'nonsense' }], 'nl');
    expect(chips).toEqual([{ label: 'Weergave: Staaf', icon: 'form' }]);
  });
});

// The co-pilot's model-output schema (session 113, co-pilot phase 2) and —
// the other half of the contract — the VOCABULARY CROSS-CHECK against
// web/lib: every style value and template id the backend lets the model ask
// for must be one the panel itself can apply. "No chat-only capability"
// (ADR 056): the chat is a second doorway onto the SAME command vocabulary,
// so a value that survives here but not `sanitizeOverrides` would be a
// command stored, replayed and then silently dropped on dispatch.
import { describe, expect, it } from 'vitest';
import {
  COPILOT_SCHEMA_VERSION,
  copilotOutputJsonSchema,
  patchSchema,
  validateCopilotOutput,
} from '../../src/attachments/copilot/schema.ts';
import { PRESENTATION_KEYS, TEMPLATE_IDS } from '../../src/attachments/copilot/types.ts';
import { InstructionValidationError } from '../../src/attachments/instruct/schema.ts';
import { buildDatasetProfile } from '../../src/attachments/ingest/profile.ts';
import { FONT_OPTIONS, sanitizeOverrides } from '../../web/lib/chart-presentation.ts';
import { CHART_TEMPLATES } from '../../web/lib/chart-templates.ts';

const CELLS = [
  ['Year', 'City', 'Revenue'],
  ['2020', 'Amsterdam', '120,5'],
  ['2021', 'Amsterdam', '150,0'],
  ['2021', 'Rotterdam', '90,0'],
];
const PROFILE = buildDatasetProfile(CELLS);

function instruction(fields: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 2,
    kind: 'line',
    x: 'c0',
    y: ['c2'],
    seriesBy: 'c1',
    filters: [],
    sort: null,
    limit: null,
    aggregate: null,
    derived: null,
    confidence: 0.9,
    reading: 'Revenue over time.',
    unsupported: null,
    ...fields,
  };
}

function reply(fields: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: 1,
    instruction: null,
    view: [],
    refused: [],
    confidence: 0.9,
    reading: 'A style change only.',
    ...fields,
  });
}

const FULL_PATCH = {
  lineWidth: 'thick',
  markers: 'ends',
  grid: 'horizontal',
  xLabels: 'tilted',
  axisLines: 'hidden',
  zeroBaseline: 'zero',
  areaFill: 'gradient',
  fontFamily: 'Georgia',
  seriesColors: [{ seriesLabel: 'Amsterdam', hex: '#0072b2' }],
  framePadding: 'small',
  frameCorners: 'rounded',
  frameShadow: 'soft',
};

describe('validateCopilotOutput', () => {
  it('accepts a full valid output, instruction included', () => {
    const output = validateCopilotOutput(
      reply({
        instruction: instruction({ kind: 'bar', aggregate: { fn: 'sum' } }),
        view: [
          { kind: 'setForm', form: 'bar' },
          { kind: 'setSeriesView', hiddenLabels: ['Rotterdam'], highlightedLabel: null },
          { kind: 'setPresentation', patch: FULL_PATCH },
          { kind: 'applyTemplate', templateId: 'newsroom' },
          { kind: 'resetPresentation' },
          { kind: 'setTitle', title: 'Omzet' },
          { kind: 'setCaption', caption: null },
          { kind: 'addNote', seriesLabel: 'Amsterdam', xLabel: '2021', text: 'piek' },
        ],
        refused: [{ request: 'make it 3D', reason: 'not_available', control: 'none' }],
      }),
      PROFILE,
    );
    expect(output.version).toBe(COPILOT_SCHEMA_VERSION);
    expect(output.view).toHaveLength(8);
    expect(output.instruction?.aggregate).toEqual({ fn: 'sum' });
  });

  it('rejects an unknown view command kind', () => {
    expect(() => validateCopilotOutput(reply({ view: [{ kind: 'setZoom', factor: 2 }] }), PROFILE)).toThrow(
      InstructionValidationError,
    );
  });

  it('rejects an extra key on a view command', () => {
    expect(() =>
      validateCopilotOutput(reply({ view: [{ kind: 'setForm', form: 'bar', animate: true }] }), PROFILE),
    ).toThrow(InstructionValidationError);
  });

  it('rejects an extra top-level key', () => {
    expect(() => validateCopilotOutput(reply({ notes: 'extra' }), PROFILE)).toThrow(InstructionValidationError);
  });

  it('rejects an instruction naming a column the dataset does not have', () => {
    expect(() => validateCopilotOutput(reply({ instruction: instruction({ y: ['c9'] }) }), PROFILE)).toThrow(
      /c9/,
    );
  });

  it('rejects invalid JSON', () => {
    expect(() => validateCopilotOutput('not json', PROFILE)).toThrow(InstructionValidationError);
  });

  it('rejects a confidence outside 0..1', () => {
    expect(() => validateCopilotOutput(reply({ confidence: 1.4 }), PROFILE)).toThrow(InstructionValidationError);
  });

  it('produces a JSON schema for the structured-output call', () => {
    const schema = copilotOutputJsonSchema();
    expect(schema.type).toBe('object');
    expect(Object.keys(schema.properties as Record<string, unknown>).sort()).toEqual([
      'confidence',
      'instruction',
      'reading',
      'refused',
      'version',
      'view',
    ]);
  });
});

describe('the vocabulary can never drift from the panel (no chat-only capability)', () => {
  function enumOptions(): Record<string, readonly string[]> {
    const out: Record<string, readonly string[]> = {};
    for (const [key, field] of Object.entries(patchSchema.shape)) {
      const inner = 'unwrap' in field && typeof field.unwrap === 'function' ? field.unwrap() : field;
      const options = (inner as { options?: unknown }).options;
      if (Array.isArray(options)) out[key] = options as readonly string[];
    }
    return out;
  }

  it('declares exactly the keys PRESENTATION_KEYS lists', () => {
    expect(Object.keys(patchSchema.shape).sort()).toEqual([...PRESENTATION_KEYS].sort());
  });

  it('every enum value in patchSchema survives sanitizeOverrides', () => {
    const options = enumOptions();
    expect(Object.keys(options).length).toBeGreaterThan(8);
    for (const [key, values] of Object.entries(options)) {
      for (const value of values) {
        expect(sanitizeOverrides({ [key]: value }), `${key}=${value} is not a value the panel accepts`).toEqual({
          [key]: value,
        });
      }
    }
  });

  it('every font family the model may name survives sanitizeOverrides', () => {
    for (const font of FONT_OPTIONS) {
      expect(sanitizeOverrides({ fontFamily: font.family })).toEqual({ fontFamily: font.family });
    }
  });

  it('TEMPLATE_IDS equals the template list web/lib ships', () => {
    expect([...TEMPLATE_IDS]).toEqual(CHART_TEMPLATES.map((t) => t.id));
  });
});

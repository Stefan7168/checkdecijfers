// The CBS chart co-pilot's model-output schema (session 114, co-pilot phase
// 3) — the selection-only sibling of tests/attachments/copilot-schema.test.ts.
// No instruction field exists on this tier (R1/R6/R11: the model never sees
// or emits a number), so the vocabulary cross-check here is narrower: the
// style patch is the SAME cbsPatchSchema re-export from the attachments
// tier — one vocabulary, pinned by the equality assertion below.
import { describe, expect, it } from 'vitest';
import {
  CBS_COPILOT_SCHEMA_VERSION,
  CbsCopilotValidationError,
  cbsCopilotOutputJsonSchema,
  cbsPatchSchema,
  validateCbsCopilotOutput,
} from '../../src/chart/copilot/schema.ts';
import { sanitizeCbsCapabilities } from '../../src/chart/copilot/types.ts';
import { patchSchema } from '../../src/attachments/copilot/schema.ts';
import { PRESENTATION_KEYS } from '../../src/attachments/copilot/types.ts';
import { FONT_OPTIONS, sanitizeOverrides } from '../../web/lib/chart-presentation.ts';

function reply(fields: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: 1,
    view: [],
    dataRequest: false,
    refused: [],
    confidence: 0.9,
    reading: 'A view change only.',
    ...fields,
  });
}

describe('cbsCopilotOutputJsonSchema', () => {
  it('produces a JSON schema carrying no oneOf — the structured-output API rejects that dialect', () => {
    const json = JSON.stringify(cbsCopilotOutputJsonSchema());
    expect(json).not.toContain('"oneOf"');
    expect(json).toContain('"anyOf"');
  });
});

describe('cbsPatchSchema is the SAME style vocabulary as the own-data tier', () => {
  it('is byte-identical to attachments/copilot/schema.ts\'s patchSchema (one vocabulary)', () => {
    expect(cbsPatchSchema).toBe(patchSchema);
  });

  it('declares exactly the keys PRESENTATION_KEYS lists', () => {
    expect(Object.keys(cbsPatchSchema.shape).sort()).toEqual([...PRESENTATION_KEYS].sort());
  });

  it('every enum value in cbsPatchSchema survives sanitizeOverrides', () => {
    for (const [key, field] of Object.entries(cbsPatchSchema.shape)) {
      const inner = 'unwrap' in field && typeof field.unwrap === 'function' ? field.unwrap() : field;
      const options = (inner as { options?: unknown }).options;
      if (!Array.isArray(options)) continue;
      for (const value of options as string[]) {
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
});

describe('validateCbsCopilotOutput', () => {
  it('accepts a minimal valid object', () => {
    const output = validateCbsCopilotOutput(reply());
    expect(output.version).toBe(CBS_COPILOT_SCHEMA_VERSION);
    expect(output.view).toEqual([]);
    expect(output.dataRequest).toBe(false);
  });

  it('rejects an instruction field — this tier has none (selection only)', () => {
    expect(() => validateCbsCopilotOutput(reply({ instruction: null }))).toThrow(CbsCopilotValidationError);
  });

  it('rejects a confidence outside 0..1', () => {
    expect(() => validateCbsCopilotOutput(reply({ confidence: 1.2 }))).toThrow(CbsCopilotValidationError);
  });

  it('rejects invalid JSON', () => {
    expect(() => validateCbsCopilotOutput('not json')).toThrow(CbsCopilotValidationError);
  });

  it('rejects an unknown view command kind', () => {
    expect(() => validateCbsCopilotOutput(reply({ view: [{ kind: 'setZoom', factor: 2 }] }))).toThrow(
      CbsCopilotValidationError,
    );
  });

  it('accepts a full view list plus a dataRequest reply', () => {
    const output = validateCbsCopilotOutput(
      reply({
        view: [
          { kind: 'setForm', form: 'bar' },
          { kind: 'setSeriesView', hiddenLabels: ['Rotterdam'], highlightedLabel: null },
          { kind: 'setPeriodRange', fromLabel: '2021', toLabel: '2022' },
          { kind: 'setPresentation', patch: { ...Object.fromEntries(PRESENTATION_KEYS.map((k) => [k, null])), seriesColors: [] } },
          { kind: 'applyTemplate', templateId: 'newsroom' },
          { kind: 'resetPresentation' },
          { kind: 'setTitle', title: 'Bevolking' },
          { kind: 'setCaption', caption: null },
          { kind: 'addNote', seriesLabel: 'Amsterdam', periodLabel: '2021', text: 'piek' },
        ],
        dataRequest: false,
      }),
    );
    expect(output.view).toHaveLength(9);
  });
});

describe('sanitizeCbsCapabilities', () => {
  it('drops unknown forms/keys, coerces zoom and lang, keeps known values', () => {
    // 'scatter' is the off-list example now: phase 5b (verified-whole) made
    // 'pie' a real CBS-tier form.
    expect(
      sanitizeCbsCapabilities({
        forms: ['line', 'scatter'],
        presentationKeys: ['grid', 'bogus'],
        templates: ['newsroom'],
        zoom: 'yes',
        lang: 'fr',
      }),
    ).toEqual({
      forms: ['line'],
      presentationKeys: ['grid'],
      templates: ['newsroom'],
      zoom: false,
      lang: 'nl',
    });
  });

  it('phase 5b: keeps pie, stacked and stacked100 — CBS-tier forms since the verified whole', () => {
    expect(sanitizeCbsCapabilities({ forms: ['pie', 'stacked', 'stacked100'] }).forms).toEqual(['pie', 'stacked', 'stacked100']);
  });
});

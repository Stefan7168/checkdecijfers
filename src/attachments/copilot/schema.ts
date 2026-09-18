// The co-pilot's model-output schema (session 113, co-pilot phase 2) — the
// H1 boundary for the chat doorway, the sibling of instruct/schema.ts.
//
// NO FIELD BELOW CAN CARRY A DISPLAY VALUE. The view commands name a form,
// a series LABEL, a style enum value, a template id, or text the model
// wrote — and every one of those is either allowlisted here, resolved
// against the executed chart by copilot/map.ts, or digit-guarded by
// copilot/text-guard.ts before it is stored. Structured outputs allow
// neither per-request enums nor optional fields in practice (the
// rerank-schema.ts note instruct/schema.ts inherits), so every field is
// PRESENT AND NULLABLE and code — never the JSON schema — enforces the
// allowlists that depend on THIS chart.
import { z } from 'zod';
import { InstructionValidationError, chartInstructionSchema, validateInstructionObject } from '../instruct/schema.ts';
import type { DatasetProfile } from '../types.ts';
import type { CopilotOutput } from './types.ts';

export const COPILOT_SCHEMA_VERSION = 1;

/** The style patch. Keys MUST stay equal to copilot/types.ts's
 * PRESENTATION_KEYS, and every enum value must survive web/lib's
 * `sanitizeOverrides` — both pinned by copilot-schema.test.ts. `fontFamily`
 * is a free string here and allowlisted downstream (web/lib's
 * FONT_FAMILY_NAME rule); `seriesColors` is an ARRAY of label+hex pairs,
 * because the model never knows a series INDEX — map.ts assigns those. */
export const patchSchema = z.strictObject({
  lineWidth: z.enum(['thin', 'normal', 'thick', 'extraThick']).nullable(),
  markers: z.enum(['all', 'ends', 'provisionalOnly']).nullable(),
  grid: z.enum(['both', 'horizontal', 'none']).nullable(),
  xLabels: z.enum(['flat', 'tilted']).nullable(),
  axisLines: z.enum(['shown', 'hidden']).nullable(),
  zeroBaseline: z.enum(['auto', 'zero']).nullable(),
  areaFill: z.enum(['gradient', 'flat']).nullable(),
  fontFamily: z.string().nullable(),
  seriesColors: z.array(z.strictObject({ seriesLabel: z.string(), hex: z.string() })),
  framePadding: z.enum(['none', 'small', 'medium', 'large']).nullable(),
  frameCorners: z.enum(['square', 'rounded', 'veryRounded']).nullable(),
  frameShadow: z.enum(['none', 'soft', 'strong']).nullable(),
});

export const viewCommandSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('setForm'), form: z.enum(['line', 'area', 'bar', 'hbar', 'table']) }),
  z.strictObject({ kind: z.literal('setSeriesView'), hiddenLabels: z.array(z.string()), highlightedLabel: z.string().nullable() }),
  z.strictObject({ kind: z.literal('setPresentation'), patch: patchSchema }),
  z.strictObject({ kind: z.literal('applyTemplate'), templateId: z.string() }),
  z.strictObject({ kind: z.literal('resetPresentation') }),
  z.strictObject({ kind: z.literal('setTitle'), title: z.string().nullable() }),
  z.strictObject({ kind: z.literal('setCaption'), caption: z.string().nullable() }),
  z.strictObject({ kind: z.literal('addNote'), seriesLabel: z.string(), xLabel: z.string(), text: z.string() }),
]);

export const copilotOutputSchema = z.strictObject({
  version: z.literal(COPILOT_SCHEMA_VERSION),
  instruction: chartInstructionSchema.nullable(),
  view: z.array(viewCommandSchema),
  refused: z.array(
    z.strictObject({
      request: z.string(),
      reason: z.enum(['not_available', 'not_on_this_chart', 'needs_click']),
      control: z.enum(['notes', 'style', 'data', 'form', 'none']),
    }),
  ),
  confidence: z.number(),
  reading: z.string(),
});

export function copilotOutputJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(copilotOutputSchema) as Record<string, unknown>;
}

/**
 * Parses + validates one co-pilot reply. The `instruction` field, when
 * non-null, goes through instruct/schema.ts's OWN validateInstructionObject
 * against this dataset's profile — the same allowlist the question flow
 * uses, reused rather than re-implemented, so the chat doorway can never
 * accept a column id or filter value the other doorway would reject.
 * Throws InstructionValidationError (routed to a clarification by
 * copilot/respond.ts, never to a chart).
 */
export function validateCopilotOutput(outputText: string, profile: DatasetProfile): CopilotOutput {
  let parsed: unknown;
  try {
    parsed = JSON.parse(outputText);
  } catch (error) {
    throw new InstructionValidationError(`co-pilot output is not valid JSON: ${(error as Error).message}`, outputText);
  }
  const result = copilotOutputSchema.safeParse(parsed);
  if (!result.success) {
    throw new InstructionValidationError(`co-pilot output violates the schema: ${result.error.message}`, outputText);
  }
  const data = result.data;
  if (!Number.isFinite(data.confidence) || data.confidence < 0 || data.confidence > 1) {
    throw new InstructionValidationError(`co-pilot confidence ${data.confidence} is outside 0..1`, outputText);
  }
  const instruction = data.instruction === null ? null : validateInstructionObject(data.instruction, profile, outputText);
  return {
    version: COPILOT_SCHEMA_VERSION,
    instruction,
    view: data.view,
    refused: data.refused,
    confidence: data.confidence,
    reading: data.reading,
  };
}

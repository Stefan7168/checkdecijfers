// The CBS chart co-pilot's model-output schema (session 114, co-pilot phase
// 3) — the selection-only sibling of src/attachments/copilot/schema.ts.
//
// NO FIELD BELOW CAN CARRY A DISPLAY VALUE (R1/R6/R11). The view commands
// name a form, a series LABEL, a period LABEL, a style enum value, a
// template id, or text the model wrote — and every one of those is either
// allowlisted here, resolved against the executed spec by copilot/map.ts,
// or digit-guarded by copilot/text-guard.ts before it is stored. There is
// no `instruction` field at all: this tier never proposes different data,
// it only sets `dataRequest` and hands the message back to the follow-up
// path (respond.ts).
import { z } from 'zod';
import { oneOfToAnyOf } from '../../answer/llm/json-schema.ts';
import { patchSchema } from '../../attachments/copilot/schema.ts';
import type { CbsCopilotOutput } from './types.ts';

export const CBS_COPILOT_SCHEMA_VERSION = 1;

/** Re-exported, not redeclared — ONE style vocabulary shared with the
 * own-data tier ("no chat-only capability"), pinned by
 * tests/chart/copilot-schema.test.ts. */
export const cbsPatchSchema = patchSchema;

export const cbsViewCommandSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('setForm'), form: z.enum(['line', 'area', 'bar', 'hbar', 'table', 'dumbbell', 'slope', 'heatmap']) }),
  z.strictObject({
    kind: z.literal('setSeriesView'),
    hiddenLabels: z.array(z.string()),
    highlightedLabel: z.string().nullable(),
  }),
  z.strictObject({
    kind: z.literal('setPeriodRange'),
    // Both null clears the zoom. Otherwise both must be period LABELS
    // copied literally from the CURRENT CHART's own period labels —
    // map.ts resolves them to period codes by lookup.
    fromLabel: z.string().nullable(),
    toLabel: z.string().nullable(),
  }),
  z.strictObject({ kind: z.literal('setPresentation'), patch: cbsPatchSchema }),
  z.strictObject({ kind: z.literal('applyTemplate'), templateId: z.string() }),
  z.strictObject({ kind: z.literal('resetPresentation') }),
  z.strictObject({ kind: z.literal('setTitle'), title: z.string().nullable() }),
  z.strictObject({ kind: z.literal('setCaption'), caption: z.string().nullable() }),
  z.strictObject({ kind: z.literal('addNote'), seriesLabel: z.string(), periodLabel: z.string(), text: z.string() }),
]);

export const cbsCopilotOutputSchema = z.strictObject({
  version: z.literal(CBS_COPILOT_SCHEMA_VERSION),
  view: z.array(cbsViewCommandSchema),
  dataRequest: z.boolean(),
  refused: z.array(
    z.strictObject({
      request: z.string(),
      reason: z.enum(['not_available', 'not_on_this_chart', 'needs_click']),
      control: z.enum(['notes', 'style', 'form', 'none']),
    }),
  ),
  confidence: z.number(),
  reading: z.string(),
});

/** `cbsViewCommandSchema` is a discriminated union, which zod renders as
 * `oneOf` — a schema dialect the structured-output API REJECTS. The shared
 * oneOf→anyOf walker (the same one instruct/schema.ts and
 * attachments/copilot/schema.ts use) is mandatory here, not cosmetic;
 * copilot-schema.test.ts pins that no `oneOf` survives. */
export function cbsCopilotOutputJsonSchema(): Record<string, unknown> {
  return oneOfToAnyOf(z.toJSONSchema(cbsCopilotOutputSchema)) as Record<string, unknown>;
}

/** A pure validation error — deliberately its OWN class, not the
 * attachments tier's InstructionValidationError: this schema carries no
 * instruction and no DatasetProfile, so there is nothing to re-validate an
 * instruction object against here. Carries the raw output text for the
 * caller's own logging, same discipline as its sibling. */
export class CbsCopilotValidationError extends Error {
  readonly outputText: string;

  constructor(message: string, outputText: string) {
    super(message);
    this.name = 'CbsCopilotValidationError';
    this.outputText = outputText;
  }
}

/** Parses + validates one co-pilot reply. Throws CbsCopilotValidationError
 * on malformed JSON, a schema violation, or a confidence outside 0..1 —
 * routed to a clarification by copilot/respond.ts, never to a chart. */
export function validateCbsCopilotOutput(outputText: string): CbsCopilotOutput {
  let parsed: unknown;
  try {
    parsed = JSON.parse(outputText);
  } catch (error) {
    throw new CbsCopilotValidationError(`co-pilot output is not valid JSON: ${(error as Error).message}`, outputText);
  }
  const result = cbsCopilotOutputSchema.safeParse(parsed);
  if (!result.success) {
    throw new CbsCopilotValidationError(`co-pilot output violates the schema: ${result.error.message}`, outputText);
  }
  const data = result.data;
  if (!Number.isFinite(data.confidence) || data.confidence < 0 || data.confidence > 1) {
    throw new CbsCopilotValidationError(`co-pilot confidence ${data.confidence} is outside 0..1`, outputText);
  }
  return {
    version: CBS_COPILOT_SCHEMA_VERSION,
    view: data.view,
    dataRequest: data.dataRequest,
    refused: data.refused,
    confidence: data.confidence,
    reading: data.reading,
  };
}

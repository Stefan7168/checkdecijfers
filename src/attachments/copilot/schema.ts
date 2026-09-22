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
// allowlists that depend on THIS chart. The one bare NUMBER
// (addGoalLine.value, mirroring the CBS tier's co-pilot phase 6) is a
// reader-set target, not a display value — map.ts stores it only when it
// EQUALS, numerically, a number the reader's own message spells out
// (text-guard.ts's goalLineValueInMessage).
import { z } from 'zod';
import { oneOfToAnyOf } from '../../answer/llm/json-schema.ts';
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
  pieHole: z.enum(['none', 'donut']).nullable(),
  fontFamily: z.string().nullable(),
  seriesColors: z.array(z.strictObject({ seriesLabel: z.string(), hex: z.string() })),
  framePadding: z.enum(['none', 'small', 'medium', 'large']).nullable(),
  frameCorners: z.enum(['square', 'rounded', 'veryRounded']).nullable(),
  frameShadow: z.enum(['none', 'soft', 'strong']).nullable(),
});

export const viewCommandSchema = z.discriminatedUnion('kind', [
  // Widened 5 -> 11 (Task 5, plan 2026-09-22), matching copilot/types.ts's
  // COPILOT_FORMS and the CBS tier's own identically-widened enum
  // (src/chart/copilot/schema.ts) — kept in step by hand (the enum feeds
  // the structured-output JSON schema sent to the model), cross-checked
  // since session 124 by web/lib/chart-form-lists.test.ts against every
  // other hand-written copy (both prompts, both tiers' lists, the stored
  // edit-log schema, isChartForm, the ChartForm union).
  z.strictObject({
    kind: z.literal('setForm'),
    form: z.enum(['line', 'area', 'bar', 'hbar', 'table', 'dumbbell', 'slope', 'heatmap', 'pie', 'stacked', 'stacked100']),
  }),
  z.strictObject({ kind: z.literal('setSeriesView'), hiddenLabels: z.array(z.string()), highlightedLabel: z.string().nullable() }),
  z.strictObject({ kind: z.literal('setPresentation'), patch: patchSchema }),
  z.strictObject({ kind: z.literal('applyTemplate'), templateId: z.string() }),
  z.strictObject({ kind: z.literal('resetPresentation') }),
  z.strictObject({ kind: z.literal('setTitle'), title: z.string().nullable() }),
  z.strictObject({ kind: z.literal('setCaption'), caption: z.string().nullable() }),
  z.strictObject({ kind: z.literal('addNote'), seriesLabel: z.string(), xLabel: z.string(), text: z.string() }),
  // Own-data wiring of the CBS tier's co-pilot phase 6 primitives (session
  // 122, further continuation — closing the gap #311 left open: these two
  // were never given to this tier's schema, even though the PANEL already
  // dispatches both generically via the shared reducer). Labels resolved by
  // map.ts exactly like setSeriesView / addNote.
  z.strictObject({
    kind: z.literal('setDimmed'),
    hiddenLabels: z.array(z.string()),
    dimmedLabels: z.array(z.string()),
  }),
  z.strictObject({
    kind: z.literal('setHeadlineOverride'),
    // Both null clears the override; otherwise both must name a real point.
    seriesLabel: z.string().nullable(),
    xLabel: z.string().nullable(),
  }),
  // x-axis LABELS resolved to x KEYS by map.ts exactly like addNote resolves
  // xLabel; the label text is digit-guarded there.
  z.strictObject({ kind: z.literal('addEraShading'), fromLabel: z.string(), toLabel: z.string(), label: z.string() }),
  // A computed overlay (difference arrow or mean line) named by series
  // LABEL and x LABELS only — map.ts resolves them to the points' own
  // rowRefs; the number itself is derived by the client's own renderer from
  // those cells, never carried here. `difference` needs both x labels;
  // `mean` ignores them (both null).
  z.strictObject({
    kind: z.literal('addDerivedOverlay'),
    calcKind: z.enum(['difference', 'mean']),
    seriesLabel: z.string(),
    fromLabel: z.string().nullable(),
    toLabel: z.string().nullable(),
  }),
  // The ONE bare NUMBER on this tier. Not a display value — a goal line is
  // a reader-set target, deliberately not one of the chart's plotted
  // values — and map.ts stores it only when text-guard.ts's
  // goalLineValueInMessage finds a number in the reader's own raw message
  // that EQUALS it, read the Dutch and the English way (the same digits
  // with a moved decimal or a different sign do not count); the label is
  // digit-guarded like a title.
  z.strictObject({ kind: z.literal('addGoalLine'), value: z.number(), label: z.string() }),
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

/** `viewCommandSchema` is a discriminated union, which zod renders as
 * `oneOf` — a schema dialect the structured-output API REJECTS, so the call
 * would fail outright in production. The shared oneOf→anyOf walker (the same
 * one src/answer/intent/schema.ts uses) is mandatory here, not cosmetic;
 * copilot-schema.test.ts pins that no `oneOf` survives. */
export function copilotOutputJsonSchema(): Record<string, unknown> {
  return oneOfToAnyOf(z.toJSONSchema(copilotOutputSchema)) as Record<string, unknown>;
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

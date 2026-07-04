// The raw-parse contract as a zod schema — single source of truth for both
// the API's structured-output JSON schema and the call-site validation R7
// requires ("schema validation at the call site"). Validation runs on BOTH
// the live and the replay path, so fixtures can never smuggle in a shape the
// live pipeline would reject.
//
// Structured-outputs schema limitations (no numeric min/max, every object
// additionalProperties:false, all fields required): we use strictObject +
// nullable-instead-of-optional throughout and keep range checks (year sanity,
// quarter 1-4, confidence 0-1) in deterministic code, not in the schema.
import { z } from 'zod';
import { CANONICAL_MEASURES } from '../../registry/defaults.ts';
import { RawParseValidationError } from './types.ts';
import type { RawParse } from './types.ts';

const keys = CANONICAL_MEASURES.map((m) => m.key);
export const CANONICAL_KEYS = keys as [string, ...string[]];

const canonicalKeySchema = z.enum(CANONICAL_KEYS);

const regionTermSchema = z.strictObject({
  name: z.string(),
  kind: z.enum(['land', 'landsdeel', 'provincie', 'gemeente', 'onbekend']),
});

const periodSpecSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('year'), year: z.number() }),
  z.strictObject({ kind: z.literal('quarter'), year: z.number(), quarter: z.number() }),
  z.strictObject({ kind: z.literal('month'), year: z.number(), month: z.number() }),
  z.strictObject({ kind: z.literal('year_range'), fromYear: z.number(), toYear: z.number() }),
  z.strictObject({
    kind: z.literal('since'),
    year: z.number(),
    quarter: z.number().nullable(),
    month: z.number().nullable(),
  }),
  z.strictObject({
    kind: z.literal('last_n'),
    unit: z.enum(['month', 'quarter', 'year']),
    n: z.number(),
  }),
  z.strictObject({
    kind: z.literal('now_vs_ago'),
    unit: z.enum(['month', 'quarter', 'year']),
    amount: z.number(),
  }),
  z.strictObject({ kind: z.literal('change_over_year'), year: z.number() }),
  z.strictObject({
    kind: z.literal('relative'),
    unit: z.enum(['month', 'quarter', 'year']),
    offset: z.number(),
  }),
  z.strictObject({ kind: z.literal('latest') }),
  z.strictObject({ kind: z.literal('none') }),
]);

const rawCandidateSchema = z.strictObject({
  canonicalKey: canonicalKeySchema,
  regions: z.array(regionTermSchema).nullable(),
  period: periodSpecSchema,
  derivation: z.enum(['none', 'difference', 'max', 'series']),
  confidence: z.number(),
  reading: z.string(),
});

export const rawParseSchema = z.strictObject({
  version: z.literal(2),
  kind: z.enum([
    'data_query',
    'forecast_request',
    'causal_question',
    'out_of_scope',
    'compound',
    'smalltalk_or_other',
  ]),
  candidates: z.array(rawCandidateSchema),
  unmatchedMeasureTerm: z.string().nullable(),
  nearestCanonicalKeys: z.array(canonicalKeySchema),
  note: z.string().nullable(),
});

/** zod renders discriminated unions as oneOf; the structured-outputs schema
 * dialect only accepts anyOf. Our union members are disjoint (discriminated
 * on "kind"), so the rewrite is semantically identical. */
function oneOfToAnyOf(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(oneOfToAnyOf);
  if (node !== null && typeof node === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      out[key === 'oneOf' ? 'anyOf' : key] = oneOfToAnyOf(value);
    }
    return out;
  }
  return node;
}

/** JSON schema for output_config.format — generated from the zod schema so
 * the two can never drift apart. */
export function rawParseJsonSchema(): Record<string, unknown> {
  return oneOfToAnyOf(z.toJSONSchema(rawParseSchema)) as Record<string, unknown>;
}

/** Parses + validates the model's output text. Throws
 * RawParseValidationError — never returns a partially-valid object. */
export function validateRawParse(outputText: string): RawParse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(outputText);
  } catch (error) {
    throw new RawParseValidationError(
      `LLM output is not valid JSON: ${(error as Error).message}`,
      outputText,
    );
  }
  const result = rawParseSchema.safeParse(parsed);
  if (!result.success) {
    throw new RawParseValidationError(
      `LLM output violates the raw-parse schema: ${result.error.message}`,
      outputText,
    );
  }
  return result.data as RawParse;
}

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
// The oneOf→anyOf rewrite every structured-output schema built from a union
// needs (session 113: extracted from this file so the co-pilot's schema uses
// the same single copy).
import { oneOfToAnyOf } from '../llm/json-schema.ts';
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
    kind: z.literal('date_range'),
    from: z.strictObject({ year: z.number(), month: z.number(), day: z.number().nullable() }),
    to: z.strictObject({ year: z.number(), month: z.number(), day: z.number().nullable() }),
    toInclusive: z.boolean(),
  }),
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
  version: z.literal(3),
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

// --- Delivery-vocabulary variant (WP16 sub-part 2, ADR 026, design §3.6) -----
// `canonicalKeySchema` above is the STATIC Phase-0 vocabulary; the onboarding
// job's delivery re-run must accept on-demand-onboarded keys too, or the
// delivered parse is rejected here as off-vocabulary. When `extraKeys` is empty
// this returns the EXACT `rawParseSchema` object above — the default hot path
// (every non-delivery caller) is byte-for-byte unchanged, so the recorded LLM
// fixtures and the API JSON schema are unaffected by construction.
export function rawParseSchemaWith(extraKeys: readonly string[]) {
  if (extraKeys.length === 0) return rawParseSchema;
  const keySchema = z.enum([...CANONICAL_KEYS, ...extraKeys] as [string, ...string[]]);
  const candidateSchema = z.strictObject({
    canonicalKey: keySchema,
    regions: z.array(regionTermSchema).nullable(),
    period: periodSpecSchema,
    derivation: z.enum(['none', 'difference', 'max', 'series']),
    confidence: z.number(),
    reading: z.string(),
  });
  return z.strictObject({
    version: z.literal(3),
    kind: z.enum([
      'data_query',
      'forecast_request',
      'causal_question',
      'out_of_scope',
      'compound',
      'smalltalk_or_other',
    ]),
    candidates: z.array(candidateSchema),
    unmatchedMeasureTerm: z.string().nullable(),
    nearestCanonicalKeys: z.array(keySchema),
    note: z.string().nullable(),
  });
}

/** JSON schema for output_config.format — generated from the zod schema so
 * the two can never drift apart. `extraKeys` widens the canonical-key enum for
 * the delivery re-run (design §3.6); empty (the default) → byte-identical
 * Phase-0 schema, so the API request hash of every non-delivery call is
 * unchanged. */
export function rawParseJsonSchema(extraKeys: readonly string[] = []): Record<string, unknown> {
  return oneOfToAnyOf(z.toJSONSchema(rawParseSchemaWith(extraKeys))) as Record<string, unknown>;
}

/** Parses + validates the model's output text. Throws
 * RawParseValidationError — never returns a partially-valid object.
 * `extraKeys` (design §3.6) lets the delivery re-run accept on-demand-onboarded
 * canonical keys; empty (the default) → the exact Phase-0 schema. */
export function validateRawParse(outputText: string, extraKeys: readonly string[] = []): RawParse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(outputText);
  } catch (error) {
    throw new RawParseValidationError(
      `LLM output is not valid JSON: ${(error as Error).message}`,
      outputText,
    );
  }
  const result = rawParseSchemaWith(extraKeys).safeParse(parsed);
  if (!result.success) {
    throw new RawParseValidationError(
      `LLM output violates the raw-parse schema: ${result.error.message}`,
      outputText,
    );
  }
  return result.data as RawParse;
}

// Stage-2 rerank contract (WP16 sub-part 1) as a zod schema — single source of
// truth for both the structured-output JSON schema and the call-site validator,
// exactly mirroring the intent parser (schema.ts). The LOAD-BEARING guard is
// the hard allowlist check in validateRerankOutput: the model's picked id MUST
// be one of the shortlist ids we sent (mirrors R3's verbatim-number rule /
// principle a — the LLM emits a choice, never an invented table id). Range and
// allowlist checks live here in deterministic code, not in the JSON schema
// (structured-outputs allows no numeric min/max and no per-request enums).
import { z } from 'zod';
import type { RerankResult } from './types.ts';

/** Bumped whenever the output contract shape changes (forces a fixture re-record). */
export const RERANK_SCHEMA_VERSION = 1;

export class RerankValidationError extends Error {
  readonly outputText: string;

  constructor(message: string, outputText: string) {
    super(message);
    this.name = 'RerankValidationError';
    this.outputText = outputText;
  }
}

const rerankSchema = z.strictObject({
  version: z.literal(RERANK_SCHEMA_VERSION),
  /** The chosen table id — copied verbatim from the shortlist (allowlist-checked). */
  tableId: z.string(),
  /** Confidence 0..1 in the pick (range-checked in code). */
  confidence: z.number(),
  /** One short Dutch sentence explaining the pick. */
  reading: z.string(),
  /** Other plausible shortlist ids for disclosure; sanitized to the allowlist. */
  alternativeIds: z.array(z.string()),
});

/** zod renders nothing needing the oneOf→anyOf rewrite here (no unions), but we
 *  keep the same generation path as intent/schema.ts for consistency. */
export function rerankJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(rerankSchema) as Record<string, unknown>;
}

/**
 * Parses + validates the model's output against the shortlist.
 *
 * Throws RerankValidationError (never returns a partial result) on: invalid
 * JSON, schema violation, confidence outside 0..1, or — the hard allowlist —
 * a picked tableId not in `shortlistIds`. `alternativeIds` are the gentler
 * case: invented/duplicate ones are SANITIZED OUT (a junk alternative must not
 * discard an otherwise-good pick), never thrown on.
 */
export function validateRerankOutput(outputText: string, shortlistIds: string[]): RerankResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(outputText);
  } catch (error) {
    throw new RerankValidationError(
      `rerank output is not valid JSON: ${(error as Error).message}`,
      outputText,
    );
  }
  const result = rerankSchema.safeParse(parsed);
  if (!result.success) {
    throw new RerankValidationError(
      `rerank output violates the schema: ${result.error.message}`,
      outputText,
    );
  }
  const data = result.data;

  if (!Number.isFinite(data.confidence) || data.confidence < 0 || data.confidence > 1) {
    throw new RerankValidationError(
      `rerank confidence ${data.confidence} is outside 0..1`,
      outputText,
    );
  }

  const allow = new Set(shortlistIds);
  if (!allow.has(data.tableId)) {
    throw new RerankValidationError(
      `rerank picked table id '${data.tableId}' which is NOT in the shortlist ` +
        `(${shortlistIds.join(', ') || '<empty>'}) — the model may not invent a table id`,
      outputText,
    );
  }

  // Sanitize alternatives: keep only real shortlist ids, drop the pick itself
  // and any duplicates, preserve order.
  const seen = new Set<string>([data.tableId]);
  const alternativeIds: string[] = [];
  for (const id of data.alternativeIds) {
    if (allow.has(id) && !seen.has(id)) {
      seen.add(id);
      alternativeIds.push(id);
    }
  }

  return {
    tableId: data.tableId,
    confidence: data.confidence,
    reading: data.reading,
    alternativeIds,
  };
}

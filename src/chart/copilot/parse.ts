// The CBS chart co-pilot's LLM call (session 114, co-pilot phase 3) — the
// selection-only sibling of src/attachments/copilot/parse.ts.
//
// A schema-forced selection over vocabulary supplied in the prompt — the
// same narrow role as the own-data co-pilot call, so it runs on the cheap
// tier (delegation cost-tier rule), at temperature 0.
import type { LlmCallOptions, LlmRequest, LlmUsage } from '../../answer/llm/client.ts';
import type { ChartSpec } from '../types.ts';
import { buildCbsCopilotSystemPrompt, serializeCbsCopilotRequest, type CbsChartLabels } from './prompt.ts';
import { CbsCopilotValidationError, cbsCopilotOutputJsonSchema, validateCbsCopilotOutput } from './schema.ts';
import type { CbsCopilotCapabilities, CbsCopilotOutput } from './types.ts';

export const CBS_COPILOT_MODEL = 'claude-haiku-4-5';

/** The chart's own labels, in spec order, de-duplicated — NEVER a value.
 * `kind` is narrowed to the two shapes this system's chart vocabulary
 * actually draws (line/bar); ChartSpec.kind carries no other value today. */
export function chartLabels(spec: ChartSpec): CbsChartLabels {
  const periodLabels: string[] = [];
  for (const series of spec.series) {
    for (const point of series.points) {
      if (!periodLabels.includes(point.periodLabel)) periodLabels.push(point.periodLabel);
    }
  }
  return {
    title: spec.title,
    unit: spec.unit,
    kind: spec.kind,
    seriesLabels: spec.series.map((s) => s.label),
    periodLabels,
  };
}

export function buildCbsCopilotRequest(
  spec: ChartSpec,
  capabilities: CbsCopilotCapabilities,
  message: string,
  options: { model?: string; maxTokens?: number } = {},
): LlmRequest {
  return {
    model: options.model ?? CBS_COPILOT_MODEL,
    maxTokens: options.maxTokens ?? 1024,
    // Temperature 0 on the cheap tier (the own-data co-pilot's pattern).
    temperature: 0,
    system: buildCbsCopilotSystemPrompt(),
    question: serializeCbsCopilotRequest(chartLabels(spec), capabilities, message),
    jsonSchema: cbsCopilotOutputJsonSchema(),
  };
}

/** Carries the real LLM usage/model alongside a validation failure, so a
 * wasted-but-real call is still recorded truthfully by the caller. */
export class CbsCopilotFailure extends Error {
  readonly cause: CbsCopilotValidationError;
  readonly usage: LlmUsage;
  readonly model: string;

  constructor(cause: CbsCopilotValidationError, usage: LlmUsage, model: string) {
    super(cause.message);
    this.name = 'CbsCopilotFailure';
    this.cause = cause;
    this.usage = usage;
    this.model = model;
  }
}

export interface ParsedCbsCopilotReply {
  output: CbsCopilotOutput;
  usage: LlmUsage;
  model: string;
}

/** One call, one validated output. Throws CbsCopilotFailure (carrying the
 * real usage) on malformed or off-allowlist output — respond.ts routes that
 * to a clarification, never to a chart. */
export async function parseCbsCopilotReply(
  spec: ChartSpec,
  capabilities: CbsCopilotCapabilities,
  message: string,
  options: LlmCallOptions,
): Promise<ParsedCbsCopilotReply> {
  const request = buildCbsCopilotRequest(spec, capabilities, message, options);
  const response = await options.client.complete(request);
  try {
    return { output: validateCbsCopilotOutput(response.outputText), usage: response.usage, model: response.model };
  } catch (error) {
    if (error instanceof CbsCopilotValidationError) {
      throw new CbsCopilotFailure(error, response.usage, response.model);
    }
    throw error;
  }
}

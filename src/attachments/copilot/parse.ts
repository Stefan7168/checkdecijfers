// The co-pilot's LLM call (session 113, co-pilot phase 2) — the sibling of
// instruct/parse.ts, reusing its DatasetInstructFailure/DatasetInstructOptions
// so the orchestration around both calls is identical (a validation failure
// carries the REAL usage/model, so a wasted-but-real call is still recorded
// truthfully).
//
// A schema-forced selection over vocabulary supplied in the prompt — the
// same narrow role as the instruct call — so it runs on the cheap tier
// (delegation cost-tier rule), at temperature 0.
import type { LlmRequest, LlmUsage } from '../../answer/llm/client.ts';
import { DatasetInstructFailure, type DatasetInstructOptions } from '../instruct/parse.ts';
import { InstructionValidationError } from '../instruct/schema.ts';
import type { ClientChartInstruction, DatasetProfile } from '../types.ts';
import { buildCopilotSystemPrompt, serializeCopilotRequest } from './prompt.ts';
import { copilotOutputJsonSchema, validateCopilotOutput } from './schema.ts';
import type { CopilotCapabilities, CopilotOutput } from './types.ts';

export const COPILOT_MODEL = 'claude-haiku-4-5';

export interface CopilotChartLabels {
  seriesLabels: string[];
  xLabels: string[];
}

export function buildCopilotRequest(
  profile: DatasetProfile,
  current: ClientChartInstruction,
  chart: CopilotChartLabels,
  capabilities: CopilotCapabilities,
  message: string,
  options: Pick<DatasetInstructOptions, 'model' | 'maxTokens'> = {},
): LlmRequest {
  return {
    model: options.model ?? COPILOT_MODEL,
    // Headroom over a full instruction plus a handful of view commands —
    // more than instruct/parse.ts's 1024 because one reply can carry BOTH.
    maxTokens: options.maxTokens ?? 1536,
    // Temperature 0 on the cheap tier; a Sonnet escalation would need
    // `thinking: 'disabled'` instead (the #172/session-54 lesson).
    temperature: 0,
    system: buildCopilotSystemPrompt(),
    question: serializeCopilotRequest(profile, current, chart, capabilities, message),
    jsonSchema: copilotOutputJsonSchema(),
  };
}

export interface ParsedCopilotReply {
  output: CopilotOutput;
  usage: LlmUsage;
  model: string;
}

/** One call, one validated output. Throws DatasetInstructFailure (carrying
 * the real usage) on malformed or off-allowlist output — respond.ts routes
 * that to a clarification, never to a chart. */
export async function parseCopilotReply(
  profile: DatasetProfile,
  current: ClientChartInstruction,
  chart: CopilotChartLabels,
  capabilities: CopilotCapabilities,
  message: string,
  options: DatasetInstructOptions,
): Promise<ParsedCopilotReply> {
  const request = buildCopilotRequest(profile, current, chart, capabilities, message, options);
  const response = await options.client.complete(request);
  try {
    return { output: validateCopilotOutput(response.outputText, profile), usage: response.usage, model: response.model };
  } catch (error) {
    if (error instanceof InstructionValidationError) {
      throw new DatasetInstructFailure(error, response.usage, response.model);
    }
    throw error;
  }
}

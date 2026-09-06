// "Eigen data" attachments tier — the instruct caller: wraps the shared LLM
// harness to turn a question (+ profile + optional previous instruction)
// into a validated ChartInstruction. Mirrors src/catalog/rerank.ts's shape.
//
// A schema-forced multiple-choice over a supplied closed list — the same
// narrow role as table rerank/intent parsing — so it runs on the small/fast
// tier (delegation cost-tier rule), not Fable. A future escalation needs
// threshold co-calibration (#172's lesson), not a one-line model swap.
import type { LlmClient, LlmRequest } from '../../answer/llm/client.ts';
import type { ChartInstruction, ClientChartInstruction, DatasetProfile } from '../types.ts';
import { buildDatasetInstructSystemPrompt, serializeDatasetInstructRequest } from './prompt.ts';
import { chartInstructionJsonSchema, validateInstruction } from './schema.ts';

export const DATASET_INSTRUCT_MODEL = 'claude-haiku-4-5';

export interface DatasetInstructOptions {
  client: LlmClient;
  model?: string;
  maxTokens?: number;
}

export function buildDatasetInstructRequest(
  profile: DatasetProfile,
  previousInstruction: ClientChartInstruction | null,
  question: string,
  options: Pick<DatasetInstructOptions, 'model' | 'maxTokens'> = {},
): LlmRequest {
  return {
    model: options.model ?? DATASET_INSTRUCT_MODEL,
    // Headroom over the JSON output (a handful of column-id strings, a
    // filter list, a short English reading) — matches the rerank caller's
    // own reasoning for its 1024 budget over a comparably small schema.
    maxTokens: options.maxTokens ?? 1024,
    // Haiku parses deterministically at temperature 0 (the proven config
    // for every closed-vocabulary caller in this codebase). A future Sonnet
    // escalation needs `thinking: 'disabled'` instead — Sonnet 5 rejects
    // temperature 0 (the #172/session-54 lesson, src/catalog/rerank.ts).
    temperature: 0,
    system: buildDatasetInstructSystemPrompt(),
    question: serializeDatasetInstructRequest(profile, previousInstruction, question),
    jsonSchema: chartInstructionJsonSchema(),
  };
}

/**
 * Parses one dataset-chat turn's question into a validated ChartInstruction.
 * Throws InstructionValidationError (src/attachments/instruct/schema.ts) on
 * malformed or off-allowlist output — the orchestrator (respond.ts) catches
 * it and routes to a clarification, never to a chart (principle c: a
 * validation failure can only cost a turn, never produce a wrong picture).
 */
export async function parseDatasetInstruction(
  profile: DatasetProfile,
  previousInstruction: ClientChartInstruction | null,
  question: string,
  options: DatasetInstructOptions,
): Promise<ChartInstruction> {
  const request = buildDatasetInstructRequest(profile, previousInstruction, question, options);
  const response = await options.client.complete(request);
  return validateInstruction(response.outputText, profile);
}

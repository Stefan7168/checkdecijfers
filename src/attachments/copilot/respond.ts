// The co-pilot's credited turn (session 113, co-pilot phase 2) — the chat
// doorway's sibling of respond.ts, called as chargeAndRunDataset's `run()`
// exactly like the question flow. Every branch ends in ONE writeTurn call
// and ONE AuditedDatasetTurn return.
//
// THE SHAPE OF THE FLOW (and why): the client's held instruction is
// revalidated FIRST, against the dataset's current profile — a stale tab is
// bounced without spending a model call. Then the chart is executed, the
// model is asked once, its output is validated, the chart is re-executed
// for the new instruction, and only THEN are the view commands mapped
// against that executed chart. A command is never stored against a chart
// that was not actually drawn.
import type { AuditedDatasetTurn } from '../../billing/types.ts';
import type { Db } from '../../db/types.ts';
import { writeTurn } from '../audit.ts';
import { buildUserChartSpec } from '../chart.ts';
import { NoRowsError, TooManyPointsError } from '../execute.ts';
import { DatasetInstructFailure, type DatasetInstructOptions } from '../instruct/parse.ts';
import { CHART_INSTRUCTION_SCHEMA_VERSION, validateInstructionObject } from '../instruct/schema.ts';
import { MIN_INSTRUCTION_CONFIDENCE } from '../respond.ts';
import type { InsertDatasetTurnParams } from '../store.ts';
import {
  copilotReplyText,
  lowConfidenceClarificationText,
  refusalText,
  suggestionOptions,
  validationClarificationText,
  zeroRowsClarificationText,
} from '../templates.ts';
import {
  reviveClientInstruction,
  toClientInstruction,
  upgradeInstruction,
  type ChartInstruction,
  type ClientChartInstruction,
  type CopilotCommand,
  type CopilotRefusal,
  type DatasetTurnEnvelope,
  type UserChartSpec,
  type UserDataset,
} from '../types.ts';
import { mapCopilotOutput } from './map.ts';
import { parseCopilotReply } from './parse.ts';
import { COPILOT_PROMPT_VERSION } from './prompt.ts';
import { sanitizeCapabilities } from './types.ts';

export interface RespondToChartEditInput {
  dataset: UserDataset;
  threadId: number;
  /** The chart turn this edit applies to — the reader's own edit record
   * points back at it (the envelope's `copilot.targetTurnId`). */
  targetTurnId: number;
  message: string;
  requestId: string;
  /** The client's held ClientChartInstruction — untrusted, revalidated. */
  current: unknown;
  /** The client's claimed capabilities — untrusted, enum-checked. */
  capabilities: unknown;
  llmOptions: DatasetInstructOptions;
  /** Task 6's summarizeInstruction, injected: the plain-language line shown
   * on a data chip. Deterministic text, never the model's prose. */
  summarize: (instruction: ClientChartInstruction) => string;
}

/** One LLM call's telemetry, the shape respond.ts's own private
 * LlmCallInfo uses (model, token counts — no personal data). */
interface LlmCallInfo {
  model: string;
  promptVersion: number;
  inputTokens: number;
  outputTokens: number;
}

interface Outcome {
  envelope: DatasetTurnEnvelope;
  instruction: ChartInstruction | null;
  chartEmitted: boolean;
  llmCalls: LlmCallInfo[];
  latencyMs: number;
}

function noLlmCallOutcome(envelope: DatasetTurnEnvelope): Outcome {
  return { envelope, instruction: null, chartEmitted: false, llmCalls: [], latencyMs: 0 };
}

function refusal(
  question: string,
  reason: Extract<DatasetTurnEnvelope, { kind: 'refusal' }>['reason'],
): DatasetTurnEnvelope {
  // refusalText(reason) is what reconstruct.ts re-derives this text from —
  // a refusal envelope's text is NEVER a hand-picked sentence, or the
  // stored turn stops reconstructing (R8 analog, checkRefusalReconstruction).
  return { schemaVersion: 1, kind: 'refusal', question, text: refusalText(reason), reason, guidance: null };
}

function clarification(
  question: string,
  reason: 'low_confidence' | 'validation' | 'zero_rows',
  dataset: UserDataset,
  instruction: ChartInstruction | null,
): DatasetTurnEnvelope {
  // Same rule as above: reconstruct.ts re-derives BOTH the text and the
  // options per reason (checkClarificationReconstruction), so this builder
  // must call the very templates that check names.
  const text =
    reason === 'low_confidence'
      ? lowConfidenceClarificationText()
      : reason === 'validation'
        ? validationClarificationText()
        : zeroRowsClarificationText();
  const options = reason === 'zero_rows' ? [] : suggestionOptions(dataset.profile);
  return { schemaVersion: 1, kind: 'clarification', question, text, options, instruction, reason };
}

/** Flow step 1: the client's held instruction, revalidated against the
 * CURRENT profile. null = stale/garbage — the reader re-opens the thread. */
function validateCurrent(raw: unknown, dataset: UserDataset): ChartInstruction | null {
  try {
    const upgraded = upgradeInstruction(raw) as ClientChartInstruction;
    return validateInstructionObject(reviveClientInstruction(upgraded), dataset.profile);
  } catch {
    return null;
  }
}

function chartLabels(chart: UserChartSpec): { seriesLabels: string[]; xLabels: string[] } {
  const xLabels: string[] = [];
  for (const series of chart.series) {
    for (const point of series.points) {
      if (!xLabels.includes(point.xLabel)) xLabels.push(point.xLabel);
    }
  }
  return { seriesLabels: chart.series.map((s) => s.label), xLabels };
}

/**
 * Produces (and writes) one co-pilot edit turn. Called as
 * chargeAndRunDataset's `run()` — its return is what that gate settles
 * billing from (a 'chart' keeps the debit, a 'clarification' compensates
 * down, a 'refusal' refunds in full).
 */
export async function respondToChartEdit(db: Db, input: RespondToChartEditInput): Promise<AuditedDatasetTurn> {
  const { dataset, threadId, message, requestId } = input;
  const outcome = await produceOutcome(input);
  const params: InsertDatasetTurnParams = {
    userId: dataset.userId,
    datasetId: dataset.id,
    threadId,
    requestId,
    kind: outcome.envelope.kind,
    question: message,
    envelope: outcome.envelope,
    finalText: outcome.envelope.text,
    instruction: outcome.instruction,
    chartEmitted: outcome.chartEmitted,
    promptVersions:
      outcome.llmCalls.length > 0
        ? { copilot: COPILOT_PROMPT_VERSION, instruct_schema: CHART_INSTRUCTION_SCHEMA_VERSION }
        : {},
    llmCalls: outcome.llmCalls,
    inputTokens: outcome.llmCalls.reduce((sum, call) => sum + call.inputTokens, 0),
    outputTokens: outcome.llmCalls.reduce((sum, call) => sum + call.outputTokens, 0),
    latencyMs: outcome.latencyMs,
  };
  const written = await writeTurn(db, params);
  return { envelope: outcome.envelope, auditId: written.auditId, datasetGone: written.datasetGone };
}

async function produceOutcome(input: RespondToChartEditInput): Promise<Outcome> {
  const { dataset, targetTurnId, message, current, capabilities, llmOptions, summarize } = input;

  // Step 1 — a stale held instruction: no model call, no chart, refund.
  const validated = validateCurrent(current, dataset);
  if (validated === null) return noLlmCallOutcome(refusal(message, 'internal'));

  // Step 2 — the client's claimed capabilities, enum-checked before they
  // can reach the prompt.
  const caps = sanitizeCapabilities(capabilities);

  // Step 3.
  const trimmed = message.trim();
  if (trimmed.length === 0) return noLlmCallOutcome(refusal(message, 'empty_question'));

  // Step 4 — the chart as it is on screen, for the prompt's labels.
  let chartNow: UserChartSpec;
  try {
    chartNow = buildUserChartSpec(dataset, validated);
  } catch {
    return noLlmCallOutcome(refusal(message, 'internal'));
  }

  // Step 5 — the one model call.
  const startedAt = Date.now();
  let output;
  let llmCall: LlmCallInfo;
  try {
    const parsed = await parseCopilotReply(
      dataset.profile,
      toClientInstruction(validated),
      chartLabels(chartNow),
      caps,
      trimmed,
      llmOptions,
    );
    output = parsed.output;
    llmCall = {
      model: parsed.model,
      promptVersion: COPILOT_PROMPT_VERSION,
      inputTokens: parsed.usage.inputTokens,
      outputTokens: parsed.usage.outputTokens,
    };
  } catch (error) {
    if (!(error instanceof DatasetInstructFailure)) throw error;
    // The turn is still charged, same rule as a question whose parse
    // failed: a real call was made.
    return {
      envelope: clarification(message, 'validation', dataset, null),
      instruction: null,
      chartEmitted: false,
      llmCalls: [
        {
          model: error.model,
          promptVersion: COPILOT_PROMPT_VERSION,
          inputTokens: error.usage.inputTokens,
          outputTokens: error.usage.outputTokens,
        },
      ],
      latencyMs: Date.now() - startedAt,
    };
  }
  const latencyMs = Date.now() - startedAt;

  // Step 6 — the threshold, applied by code (the R7 analog).
  if (output.confidence < MIN_INSTRUCTION_CONFIDENCE) {
    return {
      envelope: clarification(message, 'low_confidence', dataset, output.instruction),
      instruction: output.instruction,
      chartEmitted: false,
      llmCalls: [llmCall],
      latencyMs,
    };
  }

  // Step 7 — execute the instruction the commands will be mapped against.
  const next = output.instruction ?? validated;
  let chart: UserChartSpec;
  try {
    chart = buildUserChartSpec(dataset, next);
  } catch (error) {
    if (error instanceof NoRowsError) {
      return {
        envelope: clarification(message, 'zero_rows', dataset, next),
        instruction: next,
        chartEmitted: false,
        llmCalls: [llmCall],
        latencyMs,
      };
    }
    if (error instanceof TooManyPointsError) {
      return {
        envelope: refusal(message, 'too_many_points'),
        instruction: next,
        chartEmitted: false,
        llmCalls: [llmCall],
        latencyMs,
      };
    }
    throw error;
  }

  // Step 8 — labels → keys, against the chart just executed.
  const nextClient = toClientInstruction(next);
  const { commands, refused } = mapCopilotOutput(output, chart, toClientInstruction(validated), summarize(nextClient));

  // Step 9 — one chart envelope carrying the reader's own edit record.
  return {
    envelope: {
      schemaVersion: 1,
      kind: 'chart',
      question: message,
      text: copilotReplyText(commands.length, refused.length),
      instruction: next,
      chart,
      state: { datasetId: dataset.id, lastInstruction: nextClient },
      copilot: copilotRecord(message, commands, refused, targetTurnId),
    },
    instruction: next,
    chartEmitted: true,
    llmCalls: [llmCall],
    latencyMs,
  };
}

function copilotRecord(
  message: string,
  commands: CopilotCommand[],
  refused: CopilotRefusal[],
  targetTurnId: number,
): NonNullable<Extract<DatasetTurnEnvelope, { kind: 'chart' }>['copilot']> {
  return { message, commands, refused, targetTurnId, feedback: null };
}

// "Eigen data" attachments tier — the turn orchestration (D8): the run()
// callback src/billing/dataset-gate.ts's chargeAndRunDataset invokes AFTER
// the credit reserve already happened (mirroring the CBS side's own
// pre-checks-after-reserve shape, gate.ts). Deterministic pre-checks →
// rawState revalidation → the one LLM call → threshold → execute/build →
// write. Every branch ends in exactly one writeTurn call and one
// AuditedDatasetTurn return.
import type { AuditedDatasetTurn } from '../billing/types.ts';
import { writeTurn } from './audit.ts';
import { buildUserChartSpec } from './chart.ts';
import { NoRowsError, TooManyPointsError } from './execute.ts';
import type { DatasetInstructOptions } from './instruct/parse.ts';
import { DatasetInstructFailure, parseDatasetInstruction } from './instruct/parse.ts';
import { validateInstruction } from './instruct/schema.ts';
import {
  chartReplyText,
  refusalText,
  lowConfidenceClarificationText,
  suggestionOptions,
  validationClarificationText,
  zeroRowsClarificationText,
} from './templates.ts';
import {
  reviveClientInstruction,
  toClientInstruction,
  type ChartInstruction,
  type ClientChartInstruction,
  type DatasetTurnEnvelope,
  type UserDataset,
} from './types.ts';
import type { Db } from '../db/types.ts';
import type { InsertDatasetTurnParams } from './store.ts';

/** Provisional — calibrated against real usage before go-live (the design
 * doc's own §5 done-definition for WP202a), matching the R7 finder's own
 * provisional-then-calibrated 0.8. */
export const MIN_INSTRUCTION_CONFIDENCE = 0.8;

/** A cheap, zero-LLM first pass — the model is ALSO trained (instruct
 * prompt.ts) to set `unsupported: 'compare_with_cbs'` for the same intent,
 * so this heuristic only needs to catch the obvious cases early, not be
 * exhaustive; a false negative here still gets caught one call later. */
function looksLikeCbsComparison(question: string): boolean {
  return /\bcbs\b/i.test(question) && /\b(compare|comparison|versus|vs\.?)\b/i.test(question);
}

function looksLikeExportRequest(question: string): boolean {
  return /\b(download|export)\b/i.test(question);
}

export interface RawDatasetState {
  datasetId: number;
  lastInstruction: ClientChartInstruction;
}

/** Revalidates a client-held rawState against the CURRENT profile — any
 * failure drops it (fail closed to a standalone parse), never surfaced as
 * an error (D8 step 2). `rawState.datasetId` itself is deliberately never
 * read here — the caller's own ownership-checked `dataset` is the only
 * source of truth for which dataset this is (a code-review fix from the
 * adversarial review, carried into this orchestration). */
function revalidatePrevious(
  rawState: RawDatasetState | null,
  dataset: UserDataset,
): ChartInstruction | null {
  if (rawState === null) return null;
  try {
    const revived = reviveClientInstruction(rawState.lastInstruction);
    return validateInstruction(JSON.stringify(revived), dataset.profile);
  } catch {
    return null;
  }
}

function clarification(
  question: string,
  text: string,
  options: string[],
  instruction: ChartInstruction | null,
  reason: 'low_confidence' | 'validation' | 'ambiguous_format' | 'zero_rows',
): DatasetTurnEnvelope {
  return { schemaVersion: 1, kind: 'clarification', question, text, options, instruction, reason };
}

function refusal(
  question: string,
  reason:
    | 'aggregation'
    | 'computation'
    | 'compare_with_cbs'
    | 'not_chartable'
    | 'other'
    | 'too_many_points'
    | 'export_hint'
    | 'empty_question'
    | 'internal',
  guidance: string | null = null,
): DatasetTurnEnvelope {
  return { schemaVersion: 1, kind: 'refusal', question, text: refusalText(reason), reason, guidance };
}

export interface RespondToDatasetQuestionInput {
  dataset: UserDataset;
  threadId: number;
  question: string;
  requestId: string;
  rawState: RawDatasetState | null;
  llmOptions: DatasetInstructOptions;
}

/**
 * Produces (and writes) one dataset-chat turn. Called as
 * chargeAndRunDataset's `run()` — its return is what that gate settles
 * billing from. Every code path below ends by calling writeTurn exactly
 * once and returning its result.
 */
export async function respondToDatasetQuestion(
  db: Db,
  input: RespondToDatasetQuestionInput,
): Promise<AuditedDatasetTurn> {
  const { dataset, threadId, question, requestId, rawState, llmOptions } = input;
  const trimmedQuestion = question.trim();

  const outcome: ParsedOutcome =
    trimmedQuestion.length === 0
      ? noLlmCallOutcome(refusal(question, 'empty_question'))
      : looksLikeCbsComparison(trimmedQuestion)
        ? noLlmCallOutcome(
            refusal(question, 'compare_with_cbs', 'Ask the CBS chat separately to compare with official figures.'),
          )
        : looksLikeExportRequest(trimmedQuestion)
          ? noLlmCallOutcome(refusal(question, 'export_hint'))
          : await parseAndBuildChart(dataset, question, trimmedQuestion, rawState, llmOptions);

  return writeAndReturn(db, threadId, requestId, dataset, question, outcome);
}

/** One LLM call's telemetry, in the same shape audit_answers' own
 * llm_calls/prompt_versions columns use elsewhere in this codebase (model,
 * token counts — no personal data). Empty for a pure pre-check outcome
 * (no LLM call made at all). */
interface LlmCallInfo {
  model: string;
  promptVersion: number;
  inputTokens: number;
  outputTokens: number;
}

interface ParsedOutcome {
  envelope: DatasetTurnEnvelope;
  instruction: ChartInstruction | null;
  chartEmitted: boolean;
  llmCalls: LlmCallInfo[];
  latencyMs: number;
}

function noLlmCallOutcome(envelope: DatasetTurnEnvelope): ParsedOutcome {
  return { envelope, instruction: null, chartEmitted: false, llmCalls: [], latencyMs: 0 };
}

/** The LLM-call branch (D8 steps 4-6): revalidate rawState, parse, then
 * threshold/execute. Extracted so respondToDatasetQuestion's own control
 * flow stays a single, flat outcome selection — every branch here returns
 * once, never falls through to a sibling branch. Code-review fix, session
 * 84: threads the REAL LlmResponse usage/model/latency through to the
 * caller in every branch that made a call — including the validation-
 * failure branch, where the original draft discarded it entirely, leaving
 * every dataset turn's token/latency columns permanently zero. */
async function parseAndBuildChart(
  dataset: UserDataset,
  question: string,
  trimmedQuestion: string,
  rawState: RawDatasetState | null,
  llmOptions: DatasetInstructOptions,
): Promise<ParsedOutcome> {
  const previous = revalidatePrevious(rawState, dataset);

  const startedAt = Date.now();
  let instruction: ChartInstruction;
  let llmCall: LlmCallInfo;
  try {
    const parsed = await parseDatasetInstruction(
      dataset.profile,
      previous === null ? null : toClientInstruction(previous),
      trimmedQuestion,
      llmOptions,
    );
    instruction = parsed.instruction;
    llmCall = {
      model: parsed.model,
      promptVersion: 1,
      inputTokens: parsed.usage.inputTokens,
      outputTokens: parsed.usage.outputTokens,
    };
  } catch (error) {
    if (!(error instanceof DatasetInstructFailure)) throw error;
    return {
      envelope: clarification(
        question,
        validationClarificationText(),
        suggestionOptions(dataset.profile),
        null,
        'validation',
      ),
      instruction: null,
      chartEmitted: false,
      llmCalls: [
        { model: error.model, promptVersion: 1, inputTokens: error.usage.inputTokens, outputTokens: error.usage.outputTokens },
      ],
      latencyMs: Date.now() - startedAt,
    };
  }
  const latencyMs = Date.now() - startedAt;

  if (instruction.unsupported !== null) {
    return {
      envelope: refusal(question, instruction.unsupported.reason, instruction.unsupported.detail),
      instruction,
      chartEmitted: false,
      llmCalls: [llmCall],
      latencyMs,
    };
  }

  if (instruction.confidence < MIN_INSTRUCTION_CONFIDENCE) {
    return {
      envelope: clarification(
        question,
        lowConfidenceClarificationText(),
        suggestionOptions(dataset.profile),
        instruction,
        'low_confidence',
      ),
      instruction,
      chartEmitted: false,
      llmCalls: [llmCall],
      latencyMs,
    };
  }

  try {
    const chart = buildUserChartSpec(dataset, instruction);
    return {
      envelope: {
        schemaVersion: 1,
        kind: 'chart',
        question,
        text: chartReplyText(),
        instruction,
        chart,
        state: { datasetId: dataset.id, lastInstruction: toClientInstruction(instruction) },
      },
      instruction,
      chartEmitted: true,
      llmCalls: [llmCall],
      latencyMs,
    };
  } catch (error) {
    if (error instanceof NoRowsError) {
      return {
        envelope: clarification(question, zeroRowsClarificationText(), [], instruction, 'zero_rows'),
        instruction,
        chartEmitted: false,
        llmCalls: [llmCall],
        latencyMs,
      };
    }
    if (error instanceof TooManyPointsError) {
      return {
        envelope: refusal(question, 'too_many_points'),
        instruction,
        chartEmitted: false,
        llmCalls: [llmCall],
        latencyMs,
      };
    }
    throw error;
  }
}

async function writeAndReturn(
  db: Db,
  threadId: number,
  requestId: string,
  dataset: UserDataset,
  question: string,
  outcome: ParsedOutcome,
): Promise<AuditedDatasetTurn> {
  const { envelope, instruction, chartEmitted, llmCalls, latencyMs } = outcome;
  const params: InsertDatasetTurnParams = {
    userId: dataset.userId,
    datasetId: dataset.id,
    threadId,
    requestId,
    kind: envelope.kind,
    question,
    envelope,
    finalText: envelope.text,
    instruction,
    chartEmitted,
    // Fixed in review: real per-call telemetry, not a hardcoded {instruct:1}
    // with no usage — llmCalls carries every LLM call this turn actually
    // made (0 or 1 in v1), and the aggregate token counts below are summed
    // from it, never independently guessed.
    promptVersions: llmCalls.length > 0 ? { instruct: llmCalls[0]!.promptVersion } : {},
    llmCalls,
    inputTokens: llmCalls.reduce((sum, call) => sum + call.inputTokens, 0),
    outputTokens: llmCalls.reduce((sum, call) => sum + call.outputTokens, 0),
    latencyMs,
  };
  const written = await writeTurn(db, params);
  return { envelope, auditId: written.auditId, datasetGone: written.datasetGone };
}

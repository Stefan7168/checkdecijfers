// The CBS/Eurostat chart co-pilot's reply (session 114, co-pilot phase 3) —
// called as chargeAndRunChartEdit's `run()`. PURE of the db: this tier
// never writes audit_answers (spec §6) — the applied commands are
// persisted only by the card's own existing debounced chart_edits save, and
// the reply text/refusals are not stored anywhere (open-questions #286).
import { MIN_INSTRUCTION_CONFIDENCE } from '../../attachments/respond.ts';
import type { LlmCallOptions } from '../../answer/llm/client.ts';
import type { ChartSpec } from '../types.ts';
import { mapCbsCopilotOutput } from './map.ts';
import { CbsCopilotFailure, parseCbsCopilotReply } from './parse.ts';
import { CBS_COPILOT_PROMPT_VERSION } from './prompt.ts';
import { sanitizeCbsCapabilities, type CbsCopilotReply, type LlmCallInfo } from './types.ts';

export const MIN_CBS_COPILOT_CONFIDENCE = MIN_INSTRUCTION_CONFIDENCE;

export interface RespondToCbsChartEditInput {
  spec: ChartSpec;
  message: string;
  /** The client's claimed capabilities — untrusted, enum-checked. */
  capabilities: unknown;
  llmOptions: LlmCallOptions;
}

const CLARIFICATION_TEXT =
  'That did not come through as a chart change. Try naming the form, a series, a period, or the style.';
const DATA_REQUEST_TEXT = 'That asks for other data — ask it as a follow-up question and the answer gets its own chart.';

function callInfo(model: string, inputTokens: number, outputTokens: number): LlmCallInfo {
  return { model, promptVersion: CBS_COPILOT_PROMPT_VERSION, inputTokens, outputTokens };
}

/** One reply, no db, one model call at most. */
export async function respondToCbsChartEdit(input: RespondToCbsChartEditInput): Promise<CbsCopilotReply> {
  const { spec, message, capabilities, llmOptions } = input;

  const trimmed = message.trim();
  if (trimmed.length === 0) {
    return { kind: 'refusal', reason: 'empty_message', text: 'Type what should change on the chart.', llmCalls: [] };
  }

  const caps = sanitizeCbsCapabilities(capabilities);

  let output;
  let llmCall: LlmCallInfo;
  try {
    const parsed = await parseCbsCopilotReply(spec, caps, trimmed, llmOptions);
    output = parsed.output;
    llmCall = callInfo(parsed.model, parsed.usage.inputTokens, parsed.usage.outputTokens);
  } catch (error) {
    if (!(error instanceof CbsCopilotFailure)) throw error;
    // The turn is still charged (the gate's own rule): a real call was
    // made, even though it did not validate.
    return { kind: 'clarification', text: CLARIFICATION_TEXT, llmCalls: [callInfo(error.model, error.usage.inputTokens, error.usage.outputTokens)] };
  }

  if (output.confidence < MIN_CBS_COPILOT_CONFIDENCE) {
    return { kind: 'clarification', text: CLARIFICATION_TEXT, llmCalls: [llmCall] };
  }

  if (output.dataRequest) {
    return { kind: 'edit', text: DATA_REQUEST_TEXT, commands: [], refused: [], dataRequest: true, llmCalls: [llmCall] };
  }

  const { commands, refused } = mapCbsCopilotOutput(output, spec, message, caps);
  const text =
    commands.length === 0
      ? 'Nothing could be applied.'
      : commands.length === 1
        ? 'Applied one change.'
        : 'Applied several changes.';
  return { kind: 'edit', text, commands, refused, dataRequest: false, llmCalls: [llmCall] };
}

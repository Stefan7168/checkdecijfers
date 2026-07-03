// LLM-call tracking for the audit record (docs/05: "model IDs and prompt
// versions used", per-answer token counts). A transparent decorator over the
// shared LlmClient seam: it changes NO request byte (fixture hashes stay
// valid — the replay/recording clients see the identical request) and records
// one LlmCallRecord per COMPLETED call. A call that throws produced no
// response object, so there is no usage to record — the error itself is
// carried in the envelope (compose attempts / internal-refusal note), never
// invented here.
import type { LlmClient, LlmRequest, LlmResponse } from '../llm/client.ts';
import type { LlmCallRecord } from './types.ts';

export class LlmCallTracker {
  readonly calls: LlmCallRecord[] = [];

  wrap(role: LlmCallRecord['role'], client: LlmClient): LlmClient {
    const calls = this.calls;
    return {
      async complete(request: LlmRequest): Promise<LlmResponse> {
        const response = await client.complete(request);
        calls.push({
          role,
          model: response.model,
          inputTokens: response.usage.inputTokens,
          outputTokens: response.usage.outputTokens,
        });
        return response;
      },
    };
  }

  totals(): { inputTokens: number; outputTokens: number } {
    return this.calls.reduce(
      (sum, call) => ({
        inputTokens: sum.inputTokens + call.inputTokens,
        outputTokens: sum.outputTokens + call.outputTokens,
      }),
      { inputTokens: 0, outputTokens: 0 },
    );
  }
}

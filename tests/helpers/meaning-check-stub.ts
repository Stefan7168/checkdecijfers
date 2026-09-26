// Test clients for check C12 (#325, spec docs/superpowers/specs/2026-09-26-english-meaning-check-design.md).
// A meaning-check request is recognised by its fixed system prompt, never by
// call order, so wrapping an existing translate stub keeps that stub's own
// output queue and request log untouched.
import type { LlmClient, LlmRequest, LlmResponse } from '../../src/answer/llm/client.ts';
import { MEANING_CHECK_SYSTEM_PROMPT } from '../../src/answer/translate/meaning-check.ts';

export function isMeaningCheckRequest(req: LlmRequest): boolean {
  return req.system === MEANING_CHECK_SYSTEM_PROMPT;
}

function itemIds(req: LlmRequest): string[] {
  return (JSON.parse(req.question) as { items: { id: string }[] }).items.map((i) => i.id);
}

/** A valid all-"same meaning" answer for this request's items. */
export function sameMeaningOutput(req: LlmRequest): string {
  return JSON.stringify({ items: itemIds(req).map((id) => ({ id, sameMeaning: true, differences: [] })) });
}

function reply(req: LlmRequest, outputText: string): LlmResponse {
  return { outputText, model: req.model, stopReason: 'end_turn', usage: { inputTokens: 1, outputTokens: 1 } };
}

/** Delegates every translate request to `inner`; answers every meaning-check
 * request "same meaning" itself (not forwarded, so `inner`'s own request log
 * and output queue only ever see translate calls). */
export function withSameMeaning<C extends LlmClient>(inner: C): C {
  return {
    ...inner,
    complete: async (req: LlmRequest) => (isMeaningCheckRequest(req) ? reply(req, sameMeaningOutput(req)) : inner.complete(req)),
  };
}

/** A meaning-check-only client: `verdictFor(id, call)` decides each item
 * (`call` is 1 for the first check request, 2 for the second, …); records
 * every request. */
export function meaningClient(verdictFor: (id: string, call: number) => boolean): LlmClient & { requests: LlmRequest[] } {
  const requests: LlmRequest[] = [];
  return {
    requests,
    async complete(req: LlmRequest) {
      requests.push(req);
      const call = requests.length;
      const items = itemIds(req).map((id) => {
        const same = verdictFor(id, call);
        return { id, sameMeaning: same, differences: same ? [] : ['direction reversed'] };
      });
      return reply(req, JSON.stringify({ items }));
    },
  };
}

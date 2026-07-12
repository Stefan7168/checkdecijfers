// WP129+130 (ADR 032 decision 2): the web-search augmentation call — a NEW,
// self-contained Anthropic call with its OWN client + interface, deliberately
// NOT AnthropicLlmClient (whose LlmRequest hash keys every recorded fixture and
// which passes no `tools` — src/answer/llm/client.ts stays byte-untouched, and
// this channel is hermetic via a hand-authored fake, not fixture replay).
//
// Uses Anthropic's native web_search_20260209 server tool (dynamic filtering —
// requires a mid-tier model; cheap tiers only support the basic 20250305
// variant, ADR 032). Errors come back IN-BAND (HTTP 200 with an error OBJECT in
// the result block); citations are always enabled and token-free. The client
// NEVER throws — every failure path returns a typed {status:'failed'} WebSection
// so the CBS answer always ships (principle c / ADR 032 fail-soft).
import Anthropic from '@anthropic-ai/sdk';
import type { WebFinding, WebSection } from './types.ts';
import { WEBSEARCH_PROMPT, WEBSEARCH_PROMPT_VERSION } from './prompt.ts';

/** Mid-tier per ADR 032 (supports web_search_20260209's dynamic filtering; the
 * cheap tiers only offer the basic 20250305 variant). A named config constant —
 * the TABLE_RERANK_MODEL discipline, never a hardcoded model string at the call
 * site. Recorded alternative: 'claude-sonnet-4-6'. */
export const WEBSEARCH_MODEL = 'claude-sonnet-5';
/** ADR 032 decision 7/9: the hard cost cap per request. */
export const WEBSEARCH_MAX_USES = 3;
/** ⟨W2⟩ Per-request timeout — must fit inside the raised 90s Server Action
 * budget alongside the ~14s CBS pipeline max + margin (web/app/page.tsx). */
export const WEBSEARCH_TIMEOUT_MS = 45_000;
/** ⟨W7⟩ sonnet-5 runs ADAPTIVE thinking by default and thinking tokens share
 * the max_tokens budget — 4096 risked routine truncation on 3-search rounds;
 * 16K costs nothing extra unless generated. */
export const WEBSEARCH_MAX_TOKENS = 16_000;

/** ADR 032 section shape: one short sentence per finding, at most four. */
const FINDING_TEXT_MAX = 300;
const MAX_FINDINGS = 4;

export interface WebSearchClient {
  search(question: string): Promise<WebSection>;
}

export class AnthropicWebSearchClient implements WebSearchClient {
  private readonly sdk: Anthropic;

  constructor(sdk?: Anthropic) {
    this.sdk = sdk ?? new Anthropic();
  }

  async search(question: string): Promise<WebSection> {
    try {
      const response = await this.sdk.messages.create(
        {
          model: WEBSEARCH_MODEL,
          max_tokens: WEBSEARCH_MAX_TOKENS,
          system: WEBSEARCH_PROMPT,
          messages: [{ role: 'user', content: question }],
          tools: [
            {
              type: 'web_search_20260209',
              name: 'web_search',
              max_uses: WEBSEARCH_MAX_USES,
              user_location: { type: 'approximate', country: 'NL' },
            },
          ],
        },
        { timeout: WEBSEARCH_TIMEOUT_MS },
      );

      // In-band tool error: a web_search_tool_result whose `content` is an
      // error OBJECT rather than an array of results (HTTP 200, but the search
      // itself failed) — branch on that shape BEFORE indexing (ADR 032).
      const hasToolError = response.content.some(
        (block) => block.type === 'web_search_tool_result' && !Array.isArray(block.content),
      );
      if (hasToolError) {
        return { status: 'failed', code: 'api_error' };
      }

      // A server-tool loop can end on pause_turn; a model can end on refusal;
      // max_tokens truncates (⟨W7⟩). v1 does not resume — any non-end_turn
      // stop is 'stopped', and NO partial findings are surfaced.
      if (response.stop_reason !== 'end_turn') {
        return { status: 'failed', code: 'stopped' };
      }

      const searches = response.content.filter((block) => block.type === 'server_tool_use').length;

      const findings: WebFinding[] = [];
      for (const block of response.content) {
        if (block.type !== 'text') continue;
        const citations: { url: string; title: string | null }[] = [];
        for (const citation of block.citations ?? []) {
          if (citation.type !== 'web_search_result_location') continue;
          // Only http(s) links survive — never javascript:/data:/etc.
          if (!/^https?:\/\//i.test(citation.url)) continue;
          citations.push({ url: citation.url, title: citation.title });
        }
        // A cited text block becomes ONE finding (⟨W9⟩: one block carrying N
        // citations ⇒ one finding with N links). Uncited connective prose is
        // dropped — an ok finding must carry >= 1 citation (reconstruct (c)).
        if (citations.length === 0) continue;
        findings.push({ text: block.text.trim().slice(0, FINDING_TEXT_MAX), citations });
        if (findings.length >= MAX_FINDINGS) break;
      }

      if (findings.length === 0) {
        return { status: 'failed', code: 'no_findings' };
      }

      return {
        status: 'ok',
        findings,
        model: response.model,
        searches,
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
        },
        promptVersion: WEBSEARCH_PROMPT_VERSION,
      };
    } catch {
      // Any throw (network, timeout, 4xx/5xx) ⇒ fail-soft (ADR 032 decision 7):
      // the CBS answer still ships; the add-on is refunded upstream.
      return { status: 'failed', code: 'api_error' };
    }
  }
}

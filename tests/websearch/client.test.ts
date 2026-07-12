// WP129+130 (ADR 032): AnthropicWebSearchClient response parsing, hermetic —
// hand-authored SDK-shaped payloads through a fake sdk, NO fixture recording,
// NO spend. The channel is deliberately separate from the fixture-replay
// machinery (src/answer/llm/client.ts stays byte-untouched); this suite is its
// only correctness proof until the supervised go-live optionally records one
// live specimen. The client NEVER throws — every path returns a typed
// WebSection so the CBS answer always ships (principle c / ADR 032 fail-soft).
import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import {
  AnthropicWebSearchClient,
  WEBSEARCH_MAX_TOKENS,
  WEBSEARCH_MAX_USES,
  WEBSEARCH_MODEL,
  WEBSEARCH_TIMEOUT_MS,
} from '../../src/websearch/client.ts';
import { WEBSEARCH_PROMPT_VERSION } from '../../src/websearch/prompt.ts';

interface Capture {
  params: Record<string, unknown>;
  opts: Record<string, unknown> | undefined;
}

/** A minimal fake Anthropic whose messages.create records its args and returns
 * (or throws) a hand-authored payload — the ONLY thing the client touches. */
function fakeSdk(result: unknown): { sdk: Anthropic; captures: Capture[] } {
  const captures: Capture[] = [];
  const sdk = {
    messages: {
      create: async (params: Record<string, unknown>, opts?: Record<string, unknown>) => {
        captures.push({ params, opts });
        if (result instanceof Error) throw result;
        return result;
      },
    },
  } as unknown as Anthropic;
  return { sdk, captures };
}

function message(overrides: Record<string, unknown>): unknown {
  return {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-5-actual',
    content: [],
    stop_reason: 'end_turn',
    stop_sequence: null,
    stop_details: null,
    usage: { input_tokens: 1234, output_tokens: 56 },
    ...overrides,
  };
}

function textBlock(text: string, urls: { url: string; title: string | null }[]): unknown {
  return {
    type: 'text',
    text,
    citations: urls.map((u) => ({
      type: 'web_search_result_location',
      url: u.url,
      title: u.title,
      cited_text: 'bron',
      encrypted_index: 'idx',
    })),
  };
}

function serverToolUse(): unknown {
  return { type: 'server_tool_use', id: 'stu', name: 'web_search', input: {}, caller: { type: 'direct' } };
}

function toolResultError(): unknown {
  return {
    type: 'web_search_tool_result',
    tool_use_id: 'stu',
    caller: { type: 'direct' },
    content: { type: 'web_search_tool_result_error', error_code: 'max_uses_exceeded' },
  };
}

describe('AnthropicWebSearchClient — success parsing', () => {
  it('collects cited text blocks into findings with model, searches and usage', async () => {
    const { sdk } = fakeSdk(
      message({
        model: 'claude-sonnet-5-actual',
        content: [
          serverToolUse(),
          textBlock('De werkloosheid daalde volgens het CPB.', [
            { url: 'https://cpb.nl/rapport', title: 'CPB raming' },
          ]),
        ],
        usage: { input_tokens: 1234, output_tokens: 56 },
      }),
    );
    const section = await new AnthropicWebSearchClient(sdk).search('werkloosheid 2027?');
    expect(section.status).toBe('ok');
    if (section.status !== 'ok') throw new Error('unreachable');
    expect(section.findings).toEqual([
      {
        text: 'De werkloosheid daalde volgens het CPB.',
        citations: [{ url: 'https://cpb.nl/rapport', title: 'CPB raming' }],
      },
    ]);
    expect(section.model).toBe('claude-sonnet-5-actual');
    expect(section.searches).toBe(1);
    expect(section.usage).toEqual({ inputTokens: 1234, outputTokens: 56 });
    expect(section.promptVersion).toBe(WEBSEARCH_PROMPT_VERSION);
  });

  it('preserves the full citation URL verbatim (domain extraction is the UI\'s job)', async () => {
    const { sdk } = fakeSdk(
      message({
        content: [textBlock('Een bevinding.', [{ url: 'https://www.rijksoverheid.nl/a/b?x=1', title: null }])],
      }),
    );
    const section = await new AnthropicWebSearchClient(sdk).search('q');
    if (section.status !== 'ok') throw new Error('unreachable');
    expect(section.findings[0]!.citations[0]!.url).toBe('https://www.rijksoverheid.nl/a/b?x=1');
  });
});

describe('AnthropicWebSearchClient — failure paths (never throws)', () => {
  it('an in-band tool error OBJECT ⇒ failed api_error', async () => {
    const { sdk } = fakeSdk(
      message({ content: [serverToolUse(), toolResultError(), textBlock('sorry', [])] }),
    );
    expect(await new AnthropicWebSearchClient(sdk).search('q')).toEqual({
      status: 'failed',
      code: 'api_error',
    });
  });

  it('zero cited findings ⇒ failed no_findings', async () => {
    const { sdk } = fakeSdk(message({ content: [textBlock('Niets gevonden.', [])] }));
    expect(await new AnthropicWebSearchClient(sdk).search('q')).toEqual({
      status: 'failed',
      code: 'no_findings',
    });
  });

  it('a pause_turn stop ⇒ failed stopped (v1 does not resume)', async () => {
    const { sdk } = fakeSdk(
      message({
        stop_reason: 'pause_turn',
        content: [textBlock('half antwoord', [{ url: 'https://x.nl', title: 't' }])],
      }),
    );
    expect(await new AnthropicWebSearchClient(sdk).search('q')).toEqual({ status: 'failed', code: 'stopped' });
  });

  it('a refusal stop ⇒ failed stopped', async () => {
    const { sdk } = fakeSdk(message({ stop_reason: 'refusal', content: [] }));
    expect(await new AnthropicWebSearchClient(sdk).search('q')).toEqual({ status: 'failed', code: 'stopped' });
  });

  it('⟨W7⟩ a max_tokens stop ⇒ failed stopped, with NO partial findings surfaced', async () => {
    const { sdk } = fakeSdk(
      message({
        stop_reason: 'max_tokens',
        // Even a fully-cited block is discarded on a truncation stop.
        content: [textBlock('afgekapt cijfer', [{ url: 'https://x.nl', title: 't' }])],
      }),
    );
    expect(await new AnthropicWebSearchClient(sdk).search('q')).toEqual({ status: 'failed', code: 'stopped' });
  });

  it('any throw from the SDK ⇒ failed api_error (fail-soft, never rethrows)', async () => {
    const { sdk } = fakeSdk(new Error('network down'));
    expect(await new AnthropicWebSearchClient(sdk).search('q')).toEqual({ status: 'failed', code: 'api_error' });
  });
});

describe('AnthropicWebSearchClient — finding shaping', () => {
  it('⟨W9⟩ a SINGLE text block carrying 3 citations ⇒ ONE finding with 3 links', async () => {
    const { sdk } = fakeSdk(
      message({
        content: [
          textBlock('Drie bronnen bevestigen dit.', [
            { url: 'https://a.nl', title: 'A' },
            { url: 'https://b.nl', title: 'B' },
            { url: 'https://c.nl', title: null },
          ]),
        ],
      }),
    );
    const section = await new AnthropicWebSearchClient(sdk).search('q');
    if (section.status !== 'ok') throw new Error('unreachable');
    expect(section.findings).toHaveLength(1);
    expect(section.findings[0]!.citations).toHaveLength(3);
  });

  it('caps at 4 findings even when more cited blocks are present', async () => {
    const blocks = Array.from({ length: 6 }, (_, i) =>
      textBlock(`Bevinding ${i}.`, [{ url: `https://s${i}.nl`, title: `S${i}` }]),
    );
    const { sdk } = fakeSdk(message({ content: blocks }));
    const section = await new AnthropicWebSearchClient(sdk).search('q');
    if (section.status !== 'ok') throw new Error('unreachable');
    expect(section.findings).toHaveLength(4);
  });

  it('hard-caps finding text at 300 chars', async () => {
    const long = 'a'.repeat(500);
    const { sdk } = fakeSdk(message({ content: [textBlock(long, [{ url: 'https://x.nl', title: 't' }])] }));
    const section = await new AnthropicWebSearchClient(sdk).search('q');
    if (section.status !== 'ok') throw new Error('unreachable');
    expect(section.findings[0]!.text).toHaveLength(300);
  });

  it('drops a javascript: citation URL — a block left with no valid citation is not a finding', async () => {
    const { sdk } = fakeSdk(
      message({
        content: [
          // eslint-disable-next-line no-script-url
          textBlock('Verdacht.', [{ url: 'javascript:alert(1)', title: 'x' }]),
          textBlock('Echt.', [{ url: 'https://echt.nl', title: 'Echt' }]),
        ],
      }),
    );
    const section = await new AnthropicWebSearchClient(sdk).search('q');
    if (section.status !== 'ok') throw new Error('unreachable');
    // Only the http(s)-cited block survives.
    expect(section.findings).toHaveLength(1);
    expect(section.findings[0]!.text).toBe('Echt.');
    expect(section.findings[0]!.citations[0]!.url).toBe('https://echt.nl');
  });
});

describe('AnthropicWebSearchClient — tool-param pin', () => {
  it('sends the WEBSEARCH_MODEL constant, the BASIC web_search_20250305 tool, max_uses/NL location, and the per-request timeout', async () => {
    const { sdk, captures } = fakeSdk(
      message({ content: [textBlock('x', [{ url: 'https://x.nl', title: 't' }])] }),
    );
    await new AnthropicWebSearchClient(sdk).search('een vraag');
    expect(captures).toHaveLength(1);
    const { params, opts } = captures[0]!;
    expect(params.model).toBe(WEBSEARCH_MODEL);
    expect(params.max_tokens).toBe(WEBSEARCH_MAX_TOKENS);
    // The go-live correction (ADR 032 as-built, measured 2026-07-12): the
    // 20260209 filtering variant returns citation-less text blocks on
    // claude-sonnet-5 → every call ended no_findings. The BASIC variant is
    // the one that satisfies the per-claim-citation honesty requirement —
    // this pin exists so a well-meaning "upgrade back to the newer variant"
    // fails loudly and re-reads the measurement first.
    expect(params.tools).toEqual([
      {
        type: 'web_search_20250305',
        name: 'web_search',
        max_uses: WEBSEARCH_MAX_USES,
        user_location: { type: 'approximate', country: 'NL' },
      },
    ]);
    expect(params.messages).toEqual([{ role: 'user', content: 'een vraag' }]);
    expect(opts).toEqual({ timeout: WEBSEARCH_TIMEOUT_MS });
  });
});

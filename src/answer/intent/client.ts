// The LLM call seam (ADR 012). Exactly three implementations:
//
//   AnthropicIntentClient — the real call (runtime + recording + live eval).
//   ReplayIntentClient    — CI: answers from committed fixtures, keyed by a
//                           hash of the full request. No key, no network. A
//                           missing/stale fixture FAILS LOUDLY — it means the
//                           prompt, schema, model or registry changed and the
//                           fixtures must be re-recorded (npm run intent:record).
//   RecordingIntentClient — wraps the real client and writes fixtures.
//
// The request hash covers every byte that shapes the model's answer (model,
// temperature, system prompt, schema, question), so a fixture can never be
// silently replayed against a changed prompt.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import type { LlmUsage } from './types.ts';

/** Small/fast tier for intent parsing per ADR 004 ("model per task"); the
 * concrete ID is an implementation-time choice, revisited via ADR 004's
 * triggers (benchmark accuracy, deprecation). */
export const INTENT_MODEL = 'claude-haiku-4-5';

export interface IntentLlmRequest {
  model: string;
  maxTokens: number;
  temperature: number;
  system: string;
  question: string;
  /** output_config.format JSON schema (from schema.ts). */
  jsonSchema: Record<string, unknown>;
}

export interface IntentLlmResponse {
  outputText: string;
  model: string;
  stopReason: string | null;
  usage: LlmUsage;
}

export interface IntentLlmClient {
  complete(request: IntentLlmRequest): Promise<IntentLlmResponse>;
}

/** JSON.stringify with recursively sorted object keys — hash input must not
 * depend on property insertion order. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

export function requestHash(request: IntentLlmRequest): string {
  return createHash('sha256').update(stableStringify(request)).digest('hex').slice(0, 32);
}

export class AnthropicIntentClient implements IntentLlmClient {
  private readonly sdk: Anthropic;

  constructor(sdk?: Anthropic) {
    this.sdk = sdk ?? new Anthropic();
  }

  async complete(request: IntentLlmRequest): Promise<IntentLlmResponse> {
    const response = await this.sdk.messages.create({
      model: request.model,
      max_tokens: request.maxTokens,
      temperature: request.temperature,
      system: request.system,
      messages: [{ role: 'user', content: request.question }],
      output_config: {
        format: { type: 'json_schema', schema: request.jsonSchema },
      },
    });
    if (response.stop_reason === 'refusal') {
      throw new Error('intent LLM call ended with stop_reason "refusal"');
    }
    if (response.stop_reason === 'max_tokens') {
      throw new Error(
        `intent LLM output truncated at max_tokens=${request.maxTokens} — raise the limit`,
      );
    }
    const text = response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('');
    return {
      outputText: text,
      model: response.model,
      stopReason: response.stop_reason,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };
  }
}

export interface RecordedFixture {
  requestHash: string;
  /** Human orientation only — the hash is the key. */
  question: string;
  label: string | null;
  recordedAt: string;
  request: IntentLlmRequest;
  response: IntentLlmResponse;
}

export class ReplayIntentClient implements IntentLlmClient {
  private readonly fixturesDir: string;

  constructor(fixturesDir: string) {
    this.fixturesDir = fixturesDir;
  }

  async complete(request: IntentLlmRequest): Promise<IntentLlmResponse> {
    const hash = requestHash(request);
    const file = join(this.fixturesDir, `${hash}.json`);
    if (!existsSync(file)) {
      throw new Error(
        `no recorded LLM fixture for this request (hash ${hash}).\n` +
          `Question: "${request.question}"\n` +
          `Either the question is new, or the prompt/schema/model/registry changed since ` +
          `recording. Re-record with: npm run intent:record (spends API tokens).`,
      );
    }
    const fixture = JSON.parse(readFileSync(file, 'utf8')) as RecordedFixture;
    return fixture.response;
  }
}

export class RecordingIntentClient implements IntentLlmClient {
  private readonly inner: IntentLlmClient;
  private readonly fixturesDir: string;
  private readonly labelFor: (question: string) => string | null;

  constructor(
    inner: IntentLlmClient,
    fixturesDir: string,
    labelFor: (question: string) => string | null = () => null,
  ) {
    this.inner = inner;
    this.fixturesDir = fixturesDir;
    this.labelFor = labelFor;
  }

  async complete(request: IntentLlmRequest): Promise<IntentLlmResponse> {
    const response = await this.inner.complete(request);
    const hash = requestHash(request);
    const fixture: RecordedFixture = {
      requestHash: hash,
      question: request.question,
      label: this.labelFor(request.question),
      recordedAt: new Date().toISOString(),
      request,
      response,
    };
    mkdirSync(this.fixturesDir, { recursive: true });
    writeFileSync(join(this.fixturesDir, `${hash}.json`), `${JSON.stringify(fixture, null, 2)}\n`);
    return response;
  }
}

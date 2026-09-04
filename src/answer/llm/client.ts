// The shared LLM call seam (ADR 012, generalized for WP7 — one harness, not
// two). Exactly three implementations:
//
//   AnthropicLlmClient — the real call (runtime + recording + live eval).
//   ReplayLlmClient    — CI: answers from committed fixtures, keyed by a
//                        hash of the full request. No key, no network. A
//                        missing/stale fixture FAILS LOUDLY — it means the
//                        prompt, schema, model or registry changed and the
//                        fixtures must be re-recorded (npm run intent:record
//                        or npm run answer:record).
//   RecordingLlmClient — wraps the real client and writes fixtures.
//
// The request hash covers every byte that shapes the model's answer (model,
// sampling, thinking config, system prompt, schema, user text), so a fixture
// can never be silently replayed against a changed prompt.
//
// HASH-STABILITY CONSTRAINT: the WP6 intent fixtures were recorded against
// the field names below with `temperature` present and no `thinking` /
// missing `jsonSchema` handled by stableStringify's undefined-dropping.
// Renaming a field or serializing undefined optionals would orphan every
// committed fixture. New optional fields are safe (absent = not serialized);
// renames are not.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface LlmRequest {
  model: string;
  maxTokens: number;
  /** Omit for models that reject non-default sampling params (Sonnet 5+);
   * set 0 for deterministic parsing on models that support it (Haiku). */
  temperature?: number;
  system: string;
  /** The user-turn text. For intent parsing this is the user's question; for
   * answer phrasing it is the serialized validated-results payload (R2). */
  question: string;
  /** output_config.format JSON schema — omit for plain-prose output. */
  jsonSchema?: Record<string, unknown>;
  /** 'disabled' opts out of thinking on models where omitting the parameter
   * would run adaptive thinking (Sonnet 5). Omit to use the model default. */
  thinking?: 'disabled';
}

export interface LlmResponse {
  outputText: string;
  model: string;
  stopReason: string | null;
  usage: LlmUsage;
}

export interface LlmClient {
  complete(request: LlmRequest): Promise<LlmResponse>;
}

/** The caller-supplied plumbing every LLM-calling options bag starts from: the
 * client seam plus the optional per-call model/max-tokens overrides (absent →
 * the module's own constant, e.g. INTENT_MODEL / PHRASING_MODEL /
 * SEMANTIC_CHECK_MODEL, decides). Extracted with intent/options.ts's seam
 * (PR #93 review finding): ComposeOptions, SemanticCheckOptions and
 * IntentCallOptions each hand-declared this same triple, the exact ad-hoc
 * duplication that produced #176/#191 on the intent side. One declaration,
 * extended everywhere — a field added here reaches every bag by construction. */
export interface LlmCallOptions {
  client: LlmClient;
  model?: string;
  maxTokens?: number;
}

/** JSON.stringify with recursively sorted object keys — hash input must not
 * depend on property insertion order. Undefined-valued fields are dropped,
 * which is what keeps pre-WP7 intent fixture hashes stable. */
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

export function requestHash(request: LlmRequest): string {
  return createHash('sha256').update(stableStringify(request)).digest('hex').slice(0, 32);
}

export class AnthropicLlmClient implements LlmClient {
  private readonly sdk: Anthropic;

  constructor(sdk?: Anthropic) {
    this.sdk = sdk ?? new Anthropic();
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const response = await this.sdk.messages.create({
      model: request.model,
      max_tokens: request.maxTokens,
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      ...(request.thinking === 'disabled' ? { thinking: { type: 'disabled' as const } } : {}),
      system: request.system,
      messages: [{ role: 'user', content: request.question }],
      ...(request.jsonSchema
        ? {
            output_config: {
              format: { type: 'json_schema' as const, schema: request.jsonSchema },
            },
          }
        : {}),
    });
    if (response.stop_reason === 'refusal') {
      throw new Error('LLM call ended with stop_reason "refusal"');
    }
    if (response.stop_reason === 'max_tokens') {
      throw new Error(
        `LLM output truncated at max_tokens=${request.maxTokens} — raise the limit`,
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
  request: LlmRequest;
  response: LlmResponse;
}

/** #200 direction (b): a fixture-miss diagnostic. When the exact request hash
 * has no fixture, scan the same directory for a fixture whose request is
 * identical in every field EXCEPT `jsonSchema`. This is the signature of
 * EITHER a non-behavioral schema-serialization change (e.g. zod's
 * `toJSONSchema()` emitting different bytes for the same schema across a
 * dependency bump, PR #124's confirmed bisection) OR a genuine, intentional
 * edit to a zod schema (e.g. a field added/removed in one of the schema.ts
 * call sites) that didn't also touch the prompt/model/registry in the same
 * commit — the "identical except jsonSchema" signal cannot distinguish
 * these two root causes, and the caller must check which one it is (see the
 * near-miss message below) rather than assume the former. Returns the
 * near-miss fixture, or null if none is found. Comparing with `jsonSchema`
 * stripped relies on stableStringify already dropping undefined-valued keys
 * (see the HASH-STABILITY CONSTRAINT above) — safe because that's an
 * existing, relied-upon property, not new behavior. Malformed/foreign files
 * in the directory are skipped, never thrown. */
function findNearMissFixture(
  fixturesDir: string,
  request: LlmRequest,
): RecordedFixture | null {
  const target = stableStringify({ ...request, jsonSchema: undefined });
  let entries: string[];
  try {
    entries = readdirSync(fixturesDir);
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    let candidate: RecordedFixture;
    try {
      candidate = JSON.parse(readFileSync(join(fixturesDir, entry), 'utf8')) as RecordedFixture;
    } catch {
      continue;
    }
    if (!candidate || typeof candidate !== 'object' || !candidate.request) continue;
    let candidateProjection: string;
    try {
      candidateProjection = stableStringify({ ...candidate.request, jsonSchema: undefined });
    } catch {
      continue;
    }
    if (candidateProjection === target) {
      return candidate;
    }
  }
  return null;
}

export class ReplayLlmClient implements LlmClient {
  private readonly fixturesDir: string;

  constructor(fixturesDir: string) {
    this.fixturesDir = fixturesDir;
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const hash = requestHash(request);
    const file = join(this.fixturesDir, `${hash}.json`);
    if (!existsSync(file)) {
      let message =
        `no recorded LLM fixture for this request (hash ${hash}).\n` +
        `User text: "${request.question.slice(0, 200)}"\n` +
        `Either the request is new, or the prompt/schema/model/registry changed since ` +
        `recording. Re-record with the matching record script (spends API tokens).`;
      const nearMiss = findNearMissFixture(this.fixturesDir, request);
      if (nearMiss) {
        message +=
          `\n\nNear-miss found: fixture ${nearMiss.requestHash} ` +
          `("${nearMiss.question.slice(0, 80)}") matches this request on every field ` +
          `except jsonSchema. This has two possible causes that look identical from here: ` +
          `(1) a schema-serialization library (e.g. zod's toJSONSchema()) changed its ` +
          `output shape in a dependency bump with no real prompt/schema/model/registry ` +
          `change, or (2) a genuine, intentional edit to a zod schema in one of the ` +
          `schema.ts call sites (e.g. a field added or removed) that didn't also touch ` +
          `the prompt wording in the same commit. Diff this request's jsonSchema against ` +
          `the near-miss fixture's, and check recent commits to the relevant schema.ts, ` +
          `before assuming this is just a dependency-bump artifact — do not treat this ` +
          `message as confirming (1). See docs/open-questions.md #200.`;
      }
      throw new Error(message);
    }
    const fixture = JSON.parse(readFileSync(file, 'utf8')) as RecordedFixture;
    return fixture.response;
  }
}

export class RecordingLlmClient implements LlmClient {
  private readonly inner: LlmClient;
  private readonly fixturesDir: string;
  private readonly labelFor: (question: string) => string | null;

  constructor(
    inner: LlmClient,
    fixturesDir: string,
    labelFor: (question: string) => string | null = () => null,
  ) {
    this.inner = inner;
    this.fixturesDir = fixturesDir;
    this.labelFor = labelFor;
  }

  async complete(request: LlmRequest): Promise<LlmResponse> {
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

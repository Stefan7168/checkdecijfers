// #200 direction (b): unit coverage for ReplayLlmClient.complete() — there was
// NO dedicated test of this class before (only indirect coverage via the
// intent/answer/clarify/tablefinder replay fixtures used elsewhere in
// tests/answer/). Covers:
//  (a) an exact hash hit returns fixture.response unchanged;
//  (b) a genuine miss with no near-miss fixture on disk throws the ORIGINAL
//      generic message, byte-for-byte — the hard regression constraint that
//      guarantees zero behavior change for every other test relying on it;
//  (c) a near-miss fixture (same request except jsonSchema) triggers the new
//      diagnostic naming that fixture's hash and pointing at #200;
//  (d) a true negative: unrelated fixtures with different `question` (and
//      different jsonSchema) must never cross-match a third, distinct miss.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ReplayLlmClient,
  requestHash,
  type LlmRequest,
  type LlmResponse,
  type RecordedFixture,
} from '../../src/answer/llm/client.ts';

function baseRequest(overrides: Partial<LlmRequest> = {}): LlmRequest {
  return {
    model: 'claude-test-model',
    maxTokens: 1024,
    system: 'You are a test system prompt.',
    question: 'Hoeveel inwoners heeft Nederland?',
    ...overrides,
  };
}

function baseResponse(overrides: Partial<LlmResponse> = {}): LlmResponse {
  return {
    outputText: '{"ok":true}',
    model: 'claude-test-model',
    stopReason: 'end_turn',
    usage: { inputTokens: 10, outputTokens: 5 },
    ...overrides,
  };
}

function writeFixture(dir: string, request: LlmRequest, response: LlmResponse): RecordedFixture {
  const hash = requestHash(request);
  const fixture: RecordedFixture = {
    requestHash: hash,
    question: request.question,
    label: null,
    recordedAt: new Date().toISOString(),
    request,
    response,
  };
  writeFileSync(join(dir, `${hash}.json`), `${JSON.stringify(fixture, null, 2)}\n`);
  return fixture;
}

describe('ReplayLlmClient.complete()', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'llm-client-test-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('(a) exact hash hit returns fixture.response unchanged', async () => {
    const request = baseRequest({ jsonSchema: { type: 'object', properties: { a: { type: 'string' } } } });
    const response = baseResponse({ outputText: '{"a":"exact-hit"}' });
    writeFixture(dir, request, response);

    const client = new ReplayLlmClient(dir);
    const result = await client.complete(request);

    expect(result).toEqual(response);
  });

  it('(b) a genuine miss with no near-miss fixture throws the original generic message byte-for-byte', async () => {
    // The directory is empty: no fixture at all, not even a near-miss.
    const request = baseRequest();
    const hash = requestHash(request);
    const client = new ReplayLlmClient(dir);

    const expected =
      `no recorded LLM fixture for this request (hash ${hash}).\n` +
      `User text: "${request.question.slice(0, 200)}"\n` +
      `Either the request is new, or the prompt/schema/model/registry changed since ` +
      `recording. Re-record with the matching record script (spends API tokens).`;

    await expect(client.complete(request)).rejects.toThrow(expected);
  });

  it('(c) a near-miss fixture (same request except jsonSchema) triggers the #200 diagnostic', async () => {
    const recordedRequest = baseRequest({
      jsonSchema: { type: 'object', properties: { a: { type: 'string' } } },
    });
    const recordedResponse = baseResponse({ outputText: '{"a":"recorded"}' });
    const nearMissFixture = writeFixture(dir, recordedRequest, recordedResponse);

    // Same request in every field except jsonSchema (keys reordered + an
    // added no-op wrapper key) — simulates zod's toJSONSchema() emitting
    // different bytes for an equivalent schema across a dependency bump.
    const currentRequest = baseRequest({
      jsonSchema: {
        properties: { a: { type: 'string' } },
        type: 'object',
        additionalProperties: false,
      },
    });
    expect(requestHash(currentRequest)).not.toBe(requestHash(recordedRequest));

    const client = new ReplayLlmClient(dir);

    await expect(client.complete(currentRequest)).rejects.toThrow(
      new RegExp(
        `Near-miss found: fixture ${nearMissFixture.requestHash} .*matches this request on every field except jsonSchema`,
      ),
    );
    await expect(client.complete(currentRequest)).rejects.toThrow(/#200/);
    await expect(client.complete(currentRequest)).rejects.toThrow(
      new RegExp(nearMissFixture.question.slice(0, 80).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    );
  });

  it('(d) unrelated fixtures with different question/jsonSchema do not false-positive on a distinct miss', async () => {
    writeFixture(
      dir,
      baseRequest({
        question: 'Wat is de inflatie in 2025?',
        jsonSchema: { type: 'object', properties: { rate: { type: 'number' } } },
      }),
      baseResponse({ outputText: '{"rate":2.1}' }),
    );
    writeFixture(
      dir,
      baseRequest({
        question: 'Hoeveel woningen zijn er gebouwd?',
        jsonSchema: { type: 'object', properties: { count: { type: 'number' } } },
      }),
      baseResponse({ outputText: '{"count":123}' }),
    );

    const unrelatedRequest = baseRequest({
      question: 'Wat is de werkloosheid in Utrecht?',
      jsonSchema: { type: 'object', properties: { unemployment: { type: 'number' } } },
    });
    const hash = requestHash(unrelatedRequest);
    const client = new ReplayLlmClient(dir);

    const expected =
      `no recorded LLM fixture for this request (hash ${hash}).\n` +
      `User text: "${unrelatedRequest.question.slice(0, 200)}"\n` +
      `Either the request is new, or the prompt/schema/model/registry changed since ` +
      `recording. Re-record with the matching record script (spends API tokens).`;

    await expect(client.complete(unrelatedRequest)).rejects.toThrow(expected);
  });
});

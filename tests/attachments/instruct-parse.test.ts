// The dataset-instruct caller (D6) — mirrors tests/catalog/rerank.test.ts's
// shape for the sibling caller. No live LLM: a fake LlmClient stands in.
import { describe, expect, it } from 'vitest';
import {
  buildDatasetInstructRequest,
  DATASET_INSTRUCT_MODEL,
  DatasetInstructFailure,
  parseDatasetInstruction,
} from '../../src/attachments/instruct/parse.ts';
import { InstructionValidationError } from '../../src/attachments/instruct/schema.ts';
import type { DatasetProfile } from '../../src/attachments/types.ts';
import type { LlmClient, LlmRequest, LlmResponse } from '../../src/answer/llm/client.ts';

const PROFILE: DatasetProfile = {
  rowCount: 3,
  columns: [
    { id: 'c0', header: 'Year', type: 'year', min: 2020, max: 2022, distinct: ['2020', '2021', '2022'], nulls: 0 },
    { id: 'c1', header: 'Revenue', type: 'number', numberFormat: 'nl', min: 80, max: 150, nulls: 0 },
  ],
};

function fakeClient(outputText: string): LlmClient {
  return {
    complete: async (_request: LlmRequest): Promise<LlmResponse> => ({
      outputText,
      model: DATASET_INSTRUCT_MODEL,
      stopReason: 'end_turn',
      usage: { inputTokens: 10, outputTokens: 5 },
    }),
  };
}

function validOutput(fields: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: 1,
    kind: 'line',
    x: 'c0',
    y: ['c1'],
    seriesBy: null,
    filters: [],
    sort: null,
    limit: null,
    confidence: 0.9,
    reading: 'Revenue over time.',
    unsupported: null,
    ...fields,
  });
}

describe('buildDatasetInstructRequest', () => {
  it('uses the Haiku model, temperature 0, and the closed-vocabulary JSON schema', () => {
    const request = buildDatasetInstructRequest(PROFILE, null, 'q', {});
    expect(request.model).toBe(DATASET_INSTRUCT_MODEL);
    expect(request.temperature).toBe(0);
    expect(request.jsonSchema).toBeDefined();
    expect(request.system.length).toBeGreaterThan(0);
    expect(request.question).toContain('id=c0');
  });

  it('accepts a model override', () => {
    const request = buildDatasetInstructRequest(PROFILE, null, 'q', { model: 'claude-sonnet-5' });
    expect(request.model).toBe('claude-sonnet-5');
  });
});

describe('parseDatasetInstruction', () => {
  it('returns a validated ChartInstruction plus the real LLM usage/model', async () => {
    const client = fakeClient(validOutput());
    const result = await parseDatasetInstruction(PROFILE, null, 'show revenue per year', { client });
    expect(result.instruction.x).toBe('c0');
    expect(result.instruction.y).toEqual(['c1']);
    expect(result.model).toBe(DATASET_INSTRUCT_MODEL);
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
  });

  it('throws DatasetInstructFailure (carrying real usage) for off-allowlist model output, never returns a partial result', async () => {
    const client = fakeClient(validOutput({ x: 'c99' }));
    await expect(parseDatasetInstruction(PROFILE, null, 'q', { client })).rejects.toThrow(
      DatasetInstructFailure,
    );
  });

  it('a caught DatasetInstructFailure carries the real usage so the turn can still be billed/recorded truthfully', async () => {
    const client = fakeClient(validOutput({ x: 'c99' }));
    let caught: unknown;
    await parseDatasetInstruction(PROFILE, null, 'q', { client }).catch((error) => {
      caught = error;
    });
    expect(caught).toBeInstanceOf(DatasetInstructFailure);
    const failure = caught as DatasetInstructFailure;
    expect(failure.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
    expect(failure.model).toBe(DATASET_INSTRUCT_MODEL);
    expect(failure.cause).toBeInstanceOf(InstructionValidationError);
  });

  it('throws for malformed JSON from the model', async () => {
    const client = fakeClient('{not json');
    await expect(parseDatasetInstruction(PROFILE, null, 'q', { client })).rejects.toThrow(
      DatasetInstructFailure,
    );
  });
});

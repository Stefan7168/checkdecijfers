// respondToCbsChartEdit — the CBS chart co-pilot's reply (session 114,
// co-pilot phase 3). Pure of the db, one model call — the selection-only
// sibling of tests/attachments/copilot-respond.test.ts, minus the DB/audit
// wiring (this tier never writes audit_answers; the caller's own gate
// settles billing from the returned `kind`).
import { describe, expect, it } from 'vitest';
import type { LlmClient, LlmRequest, LlmResponse } from '../../src/answer/llm/client.ts';
import { CBS_COPILOT_PROMPT_VERSION } from '../../src/chart/copilot/prompt.ts';
import { respondToCbsChartEdit } from '../../src/chart/copilot/respond.ts';
import { CBS_CAPABILITIES_FIXTURE, CHART_SPEC_FIXTURE } from './copilot-fixtures.ts';

function fakeClient(outputText: string): { client: LlmClient; calls: LlmRequest[] } {
  const calls: LlmRequest[] = [];
  return {
    calls,
    client: {
      complete: async (request: LlmRequest): Promise<LlmResponse> => {
        calls.push(request);
        return { outputText, model: 'claude-haiku-4-5', stopReason: 'end_turn', usage: { inputTokens: 100, outputTokens: 20 } };
      },
    },
  };
}

function reply(fields: Record<string, unknown> = {}): string {
  return JSON.stringify({
    version: 1,
    view: [],
    dataRequest: false,
    refused: [],
    confidence: 0.95,
    reading: 'x',
    ...fields,
  });
}

describe('respondToCbsChartEdit — an empty message', () => {
  it('refuses with no model call', async () => {
    const { client } = fakeClient(reply());
    const result = await respondToCbsChartEdit({
      spec: CHART_SPEC_FIXTURE,
      message: '   ',
      capabilities: CBS_CAPABILITIES_FIXTURE,
      llmOptions: { client },
    });
    expect(result).toEqual({
      kind: 'refusal',
      reason: 'empty_message',
      text: 'Type what should change on the chart.',
      llmCalls: [],
    });
  });
});

describe('respondToCbsChartEdit — a valid edit', () => {
  it('maps one command and returns the "one change" text', async () => {
    const { client, calls } = fakeClient(
      reply({ view: [{ kind: 'setForm', form: 'bar' }] }),
    );
    const result = await respondToCbsChartEdit({
      spec: CHART_SPEC_FIXTURE,
      message: 'maak er staven van',
      capabilities: CBS_CAPABILITIES_FIXTURE,
      llmOptions: { client },
    });
    expect(result).toMatchObject({ kind: 'edit', text: 'Applied one change.', dataRequest: false });
    if (result.kind !== 'edit') throw new Error('expected edit');
    expect(result.commands).toEqual([{ kind: 'setForm', form: 'bar' }]);
    expect(result.llmCalls[0]).toMatchObject({ promptVersion: CBS_COPILOT_PROMPT_VERSION, model: 'claude-haiku-4-5' });
    // The prompt payload never carries a formatted value from the spec.
    const question = calls[0]!.question;
    for (const series of CHART_SPEC_FIXTURE.series) {
      for (const point of series.points) {
        if (point.formattedValue !== null) expect(question).not.toContain(point.formattedValue);
      }
    }
  });

  it('several commands get the "several changes" text', async () => {
    const { client } = fakeClient(
      reply({ view: [{ kind: 'setForm', form: 'bar' }, { kind: 'setTitle', title: 'Bevolking' }] }),
    );
    const result = await respondToCbsChartEdit({
      spec: CHART_SPEC_FIXTURE,
      message: 'staven en titel',
      capabilities: CBS_CAPABILITIES_FIXTURE,
      llmOptions: { client },
    });
    expect(result).toMatchObject({ kind: 'edit', text: 'Applied several changes.' });
  });

  it('zero commands but a refusal gets the "nothing applied" text', async () => {
    const { client } = fakeClient(
      reply({ view: [{ kind: 'setForm', form: 'hbar' }] }),
    );
    const result = await respondToCbsChartEdit({
      spec: CHART_SPEC_FIXTURE,
      message: 'maak het horizontaal',
      capabilities: CBS_CAPABILITIES_FIXTURE,
      llmOptions: { client },
    });
    expect(result).toMatchObject({ kind: 'edit', text: 'Nothing could be applied.' });
  });
});

describe('respondToCbsChartEdit — confidence below threshold', () => {
  it('returns a clarification', async () => {
    const { client } = fakeClient(reply({ confidence: 0.5 }));
    const result = await respondToCbsChartEdit({
      spec: CHART_SPEC_FIXTURE,
      message: 'iets',
      capabilities: CBS_CAPABILITIES_FIXTURE,
      llmOptions: { client },
    });
    expect(result.kind).toBe('clarification');
  });
});

describe('respondToCbsChartEdit — malformed model output', () => {
  it('returns a clarification carrying the real usage', async () => {
    const { client } = fakeClient('not json');
    const result = await respondToCbsChartEdit({
      spec: CHART_SPEC_FIXTURE,
      message: 'iets',
      capabilities: CBS_CAPABILITIES_FIXTURE,
      llmOptions: { client },
    });
    expect(result.kind).toBe('clarification');
    if (result.kind !== 'clarification') throw new Error('expected clarification');
    expect(result.llmCalls[0]).toMatchObject({ inputTokens: 100, outputTokens: 20 });
  });
});

describe('respondToCbsChartEdit — a data request', () => {
  it('returns an edit with dataRequest true, zero commands, and the hand-off text', async () => {
    const { client } = fakeClient(reply({ dataRequest: true }));
    const result = await respondToCbsChartEdit({
      spec: CHART_SPEC_FIXTURE,
      message: 'en Utrecht erbij',
      capabilities: CBS_CAPABILITIES_FIXTURE,
      llmOptions: { client },
    });
    expect(result).toMatchObject({
      kind: 'edit',
      dataRequest: true,
      text: 'That asks for other data — ask it as a follow-up question and the answer gets its own chart.',
    });
    if (result.kind !== 'edit') throw new Error('expected edit');
    expect(result.commands).toEqual([]);
  });
});

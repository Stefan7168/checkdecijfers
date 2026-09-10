// Insights AI phrasing (session 94): the digit-free slot ladder over
// deterministic findings — hermetic (the LLM is a stub, mirroring
// tests/answer/slot-compose.test.ts's own stubClient exactly). Proves: a
// valid placeholder sentence gets filled with the finding's real values: an
// invalid one (a bare digit, a missing placeholder, an unmentioned series
// name, a spelled-out number, an unknown id) is rejected and retried once;
// whatever still fails after the retry is simply ABSENT from the result —
// composeInsights never throws and never fabricates.
import { describe, expect, it } from 'vitest';
import type { LlmClient, LlmRequest, LlmResponse } from '../../src/answer/llm/client.ts';
import type { ScoredFinding } from '../../src/chart/insights.ts';
import { composeInsights } from '../../src/chart/insights-phrase.ts';

function stubClient(outputs: Array<string | Error>): { client: LlmClient; requests: LlmRequest[] } {
  const requests: LlmRequest[] = [];
  let i = 0;
  return {
    requests,
    client: {
      async complete(request: LlmRequest): Promise<LlmResponse> {
        requests.push(request);
        const out = outputs[Math.min(i, outputs.length - 1)]!;
        i += 1;
        if (out instanceof Error) throw out;
        return { outputText: out, model: 'stub-model', stopReason: 'end_turn', usage: { inputTokens: 11, outputTokens: 7 } };
      },
    },
  };
}

function finding(overrides: Partial<ScoredFinding> = {}): ScoredFinding {
  return {
    id: 'recordHigh-s0-2022JJ00',
    kind: 'recordHigh',
    resultId: 'r1',
    seriesKey: 's0',
    seriesLabel: 'Nederland',
    periodCode: '2022JJ00',
    periodLabel: '2022',
    formattedValue: '3,5',
    unit: '%',
    provisional: false,
    multiSeries: false,
    ...overrides,
  };
}

const RECORD_SLOTS = { value: 'waarde-recordHigh-s0-2022JJ00', period: 'periode-recordHigh-s0-2022JJ00' };

function jsonInsights(entries: { id: string; text: string }[]): string {
  return JSON.stringify({ insights: entries });
}

describe('composeInsights', () => {
  it('fills a valid placeholder sentence with the finding\'s real value and period', async () => {
    const f = finding();
    const { client } = stubClient([
      jsonInsights([{ id: f.id, text: `Nederland piekte in {${RECORD_SLOTS.period}} op {${RECORD_SLOTS.value}}.` }]),
    ]);
    const result = await composeInsights([f], { client });
    expect(result.phrased.get(f.id)).toBe('Nederland piekte in 2022 op 3,5 %.');
  });

  it('returns nothing for zero findings and never calls the client', async () => {
    const { client, requests } = stubClient(['unused']);
    const result = await composeInsights([], { client });
    expect(result.phrased.size).toBe(0);
    expect(requests.length).toBe(0);
  });

  it('rejects a bare digit outside any placeholder, then accepts a clean retry', async () => {
    const f = finding();
    const { client, requests } = stubClient([
      jsonInsights([{ id: f.id, text: `Groeide naar {${RECORD_SLOTS.value}} in 2022.` }]), // bare "2022"
      jsonInsights([{ id: f.id, text: `Piek in {${RECORD_SLOTS.period}}: {${RECORD_SLOTS.value}}.` }]),
    ]);
    const result = await composeInsights([f], { client });
    expect(result.phrased.get(f.id)).toBe('Piek in 2022: 3,5 %.');
    expect(requests.length).toBe(2);
  });

  it('rejects a sentence missing its own period placeholder', async () => {
    const f = finding();
    const { client } = stubClient([
      jsonInsights([{ id: f.id, text: `Piekte op {${RECORD_SLOTS.value}}.` }]), // no period slot at all
      jsonInsights([{ id: f.id, text: `Nog steeds geen periode: {${RECORD_SLOTS.value}}.` }]),
    ]);
    const result = await composeInsights([f], { client });
    expect(result.phrased.has(f.id)).toBe(false);
  });

  it('rejects a placeholder borrowed from a DIFFERENT finding', async () => {
    const a = finding({ id: 'a', periodCode: '2022JJ00' });
    const b = finding({ id: 'b', periodCode: '2023JJ00', periodLabel: '2023', formattedValue: '9,0' });
    const { client } = stubClient([
      jsonInsights([
        { id: 'a', text: `Piek in {periode-a}: {waarde-a}.` },
        // b's sentence illegally uses a's period placeholder.
        { id: 'b', text: `Piek in {periode-a}: {waarde-b}.` },
      ]),
      jsonInsights([{ id: 'b', text: `Piek in {periode-b}: {waarde-b}.` }]),
    ]);
    const result = await composeInsights([a, b], { client });
    expect(result.phrased.get('a')).toBe('Piek in 2022: 3,5 %.');
    expect(result.phrased.get('b')).toBe('Piek in 2023: 9,0 %.');
  });

  it('requires both from/to placeholders for a jump finding', async () => {
    const f = finding({ id: 'jumpUp-s0-2022JJ00', kind: 'jumpUp', fromPeriodLabel: '2021', fromFormattedValue: '2,0' });
    const { client } = stubClient([
      // Missing the "from" period entirely.
      jsonInsights([{ id: f.id, text: `Steeg naar {waarde-jumpUp-s0-2022JJ00} in {periode-jumpUp-s0-2022JJ00}.` }]),
      jsonInsights([
        {
          id: f.id,
          text: `Van {periode-van-jumpUp-s0-2022JJ00} (${'{waarde-van-jumpUp-s0-2022JJ00}'}) naar {periode-jumpUp-s0-2022JJ00}: {waarde-jumpUp-s0-2022JJ00}.`,
        },
      ]),
    ]);
    const result = await composeInsights([f], { client });
    expect(result.phrased.get(f.id)).toBe('Van 2021 (2,0 %) naar 2022: 3,5 %.');
  });

  it('requires a declared series name to actually be mentioned', async () => {
    const f = finding({ multiSeries: true, seriesLabel: 'Amsterdam' });
    const { client } = stubClient([
      jsonInsights([{ id: f.id, text: `Piek in {${RECORD_SLOTS.period}}: {${RECORD_SLOTS.value}}.` }]), // no "Amsterdam"
      jsonInsights([{ id: f.id, text: `Amsterdam piekte in {${RECORD_SLOTS.period}}: {${RECORD_SLOTS.value}}.` }]),
    ]);
    const result = await composeInsights([f], { client });
    expect(result.phrased.get(f.id)).toBe('Amsterdam piekte in 2022: 3,5 %.');
  });

  it('rejects a spelled-out number (word-form R3)', async () => {
    const f = finding();
    const { client } = stubClient([
      jsonInsights([{ id: f.id, text: `Steeg naar bijna een miljoen in {${RECORD_SLOTS.period}}: {${RECORD_SLOTS.value}}.` }]),
      jsonInsights([{ id: f.id, text: `Piek in {${RECORD_SLOTS.period}}: {${RECORD_SLOTS.value}}.` }]),
    ]);
    const result = await composeInsights([f], { client });
    expect(result.phrased.get(f.id)).toBe('Piek in 2022: 3,5 %.');
  });

  it('ignores an invented finding id in the response without crashing', async () => {
    const f = finding();
    const { client } = stubClient([
      jsonInsights([
        { id: 'not-a-real-finding', text: 'Onzin.' },
        { id: f.id, text: `Piek in {${RECORD_SLOTS.period}}: {${RECORD_SLOTS.value}}.` },
      ]),
    ]);
    const result = await composeInsights([f], { client });
    expect(result.phrased.get(f.id)).toBe('Piek in 2022: 3,5 %.');
    expect(result.phrased.has('not-a-real-finding')).toBe(false);
  });

  it('never throws on a provider error — fails closed to an empty map', async () => {
    const f = finding();
    const { client } = stubClient([new Error('network down'), new Error('still down')]);
    const result = await composeInsights([f], { client });
    expect(result.phrased.size).toBe(0);
  });

  it('never throws on malformed JSON output — fails closed', async () => {
    const f = finding();
    const { client } = stubClient(['not json at all', 'still not json']);
    const result = await composeInsights([f], { client });
    expect(result.phrased.size).toBe(0);
  });

  it('marks a provisional finding\'s filled value, matching the deterministic caption convention', async () => {
    const f = finding({ provisional: true });
    const { client } = stubClient([jsonInsights([{ id: f.id, text: `Piek in {${RECORD_SLOTS.period}}: {${RECORD_SLOTS.value}}.` }])]);
    const result = await composeInsights([f], { client });
    expect(result.phrased.get(f.id)).toContain('(voorlopig cijfer)');
  });

  it('only retries findings still missing after the first pass, not ones that already succeeded', async () => {
    const a = finding({ id: 'a' });
    const b = finding({ id: 'b', periodCode: '2023JJ00', periodLabel: '2023' });
    const { client, requests } = stubClient([
      jsonInsights([
        { id: 'a', text: `Piek in {periode-a}: {waarde-a}.` }, // valid
        { id: 'b', text: `Steeg naar 3,5 in {periode-b}.` }, // bare digit — invalid
      ]),
      jsonInsights([{ id: 'b', text: `Piek in {periode-b}: {waarde-b}.` }]),
    ]);
    const result = await composeInsights([a, b], { client });
    expect(result.phrased.get('a')).toBe('Piek in 2022: 3,5 %.');
    expect(result.phrased.get('b')).toBe('Piek in 2023: 3,5 %.');
    // The retry request must only ask about the still-missing finding.
    const retryPayload = JSON.parse(requests[1]!.question.split('\n').slice(1).join('\n').split('\n\nSchrijf')[0]!) as {
      findings: { id: string }[];
    };
    expect(retryPayload.findings.map((x) => x.id)).toEqual(['b']);
  });
});

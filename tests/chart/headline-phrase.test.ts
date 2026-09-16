import { describe, expect, it } from 'vitest';
import type { LlmClient, LlmRequest, LlmResponse } from '../../src/answer/llm/client.ts';
import type { ChartSpec } from '../../src/chart/types.ts';
import { topFinding } from '../../src/chart/insights.ts';
import { draftHeadline } from '../../src/chart/headline-phrase.ts';

// Copied verbatim from tests/chart/insights-phrase.test.ts's own stubClient.
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

function jsonInsights(entries: { id: string; text: string }[]): string {
  return JSON.stringify({ insights: entries });
}

// Copied verbatim from web/lib/chart-insights.test.ts's own point()/spec()/
// fourPointSpec() builders (that file's fixtures live in web/, this test
// lives in tests/ — src/chart/types.ts's ChartSpec/ChartPoint are the same
// types either side of the web/backend symlink, so the object shape is
// identical; only the import path for ChartSpec differs).
function point(overrides: Record<string, unknown> = {}) {
  return {
    resultId: 'r1', periodCode: '2024JJ00', periodLabel: '2024', value: 42, formattedValue: '42,0',
    decimals: 1, status: 'Definitief', provisional: false, valueAttribute: 'None', ...overrides,
  };
}
function spec(overrides: Record<string, unknown> = {}): ChartSpec {
  return {
    schemaVersion: 1, kind: 'line', title: 'Testreeks', dims: { Kenmerk: '000000' },
    dimLabels: { Kenmerk: 'Alle kenmerken' }, unit: '%',
    series: [{ label: 'Nederland', regionCode: 'NL01', points: [point()] }],
    provisionalNote: null, nullNotes: [], definitionLine: null,
    attributionLine: 'Bron: CBS StatLine, tabel 12345NED.',
    attribution: { tableId: '12345NED', tableTitle: 'Test', tableVersion: 1, syncedAt: '2026-07-01', coveredPeriods: { from: '2020', to: '2024' }, license: 'CC BY 4.0' },
    ...overrides,
  } as unknown as ChartSpec;
}
function fourPointSpec(): ChartSpec {
  return spec({
    series: [{
      label: 'Nederland', regionCode: 'NL01',
      points: [
        point({ resultId: 'a', periodCode: '2021JJ00', periodLabel: '2021', value: 2, formattedValue: '2,0' }),
        point({ resultId: 'b', periodCode: '2022JJ00', periodLabel: '2022', value: 3.5, formattedValue: '3,5' }),
        point({ resultId: 'c', periodCode: '2023JJ00', periodLabel: '2023', value: 1.5, formattedValue: '1,5' }),
        point({ resultId: 'd', periodCode: '2024JJ00', periodLabel: '2024', value: 2.5, formattedValue: '2,5', provisional: true, status: 'Voorlopig' }),
      ],
    }],
  });
}

describe('draftHeadline', () => {
  it('returns ok:false, reason: no_findings for a spec with a single flat point', async () => {
    const flatSpec = spec(); // one point only — scoreFindings needs ≥2 to find anything
    const { client } = stubClient(['unused']);
    const result = await draftHeadline(flatSpec, { client });
    expect(result).toEqual({ ok: false, reason: 'no_findings' });
  });

  it("drafts a headline from the single top finding's AI phrase (fourPointSpec's highest-scored finding: jumpDown to 2023)", async () => {
    const top = topFinding(fourPointSpec())!;
    const { client } = stubClient([
      jsonInsights([{ id: top.id, text: `Van {waarde-van-${top.id}} in {periode-van-${top.id}} naar {waarde-${top.id}} in {periode-${top.id}}.` }]),
    ]);
    const result = await draftHeadline(fourPointSpec(), { client });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.headline).toBe('Van 3,5 % in 2022 naar 1,5 % in 2023.');
    }
  });

  it('returns ok:false, reason: phrasing_failed when the AI phrase never validates, even after the retry', async () => {
    const { client } = stubClient([jsonInsights([]), jsonInsights([])]);
    const result = await draftHeadline(fourPointSpec(), { client });
    expect(result).toEqual({ ok: false, reason: 'phrasing_failed' });
  });
});

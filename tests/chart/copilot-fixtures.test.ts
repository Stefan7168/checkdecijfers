// The drift guard for the CBS chart co-pilot's LLM fixtures (session 114,
// co-pilot phase 3, Task 4). Mirrors tests/attachments/fixtures.test.ts.
//
// The real-browser proof (web/e2e/cbs-copilot.spec.ts) is hermetic only as
// long as the committed fixtures still match the requests the app builds. A
// prompt edit, a schema change, a model change or a capabilities change all
// move the request hash — and the llm-stub would then either miss (a 400 the
// spec surfaces as a failure) or, worse, fall back to its question-only match
// and replay something that no longer belongs to that request. This test
// fails FIRST, in the unit suite, with the instruction to re-run
// `npm run chart-copilot:fixtures`.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { requestHash, type RecordedFixture } from '../../src/answer/llm/client.ts';
import { validateCbsCopilotOutput } from '../../src/chart/copilot/schema.ts';
import { buildCaseRequest, FIXTURES_DIR } from '../../scripts/chart-copilot-fixtures.ts';
import { CASES } from '../fixtures/chart-copilot/cases.ts';

function readFixture(hash: string): RecordedFixture {
  const file = resolve(FIXTURES_DIR, `${hash}.json`);
  expect(
    existsSync(file),
    `no committed fixture for request hash ${hash} — run \`npm run chart-copilot:fixtures\``,
  ).toBe(true);
  return JSON.parse(readFileSync(file, 'utf8')) as RecordedFixture;
}

describe('CBS chart co-pilot LLM fixtures', () => {
  it('has three cases over one ChartSpec', () => {
    expect(CASES).toHaveLength(3);
    expect(new Set(CASES.map((c) => c.spec.attribution.tableId))).toEqual(new Set(['03759ned']));
  });

  for (const kase of CASES) {
    it(`${kase.label}: the committed fixture matches a freshly built request`, () => {
      const request = buildCaseRequest(kase);
      const hash = requestHash(request);
      const fixture = readFixture(hash);
      expect(fixture.requestHash).toBe(hash);
      // The stored request, field for field — not just the hash: a fixture
      // whose file name matched but whose body had drifted would replay the
      // wrong bytes into the llm-stub's (model, system, question) match.
      expect(fixture.request).toEqual(request);
      expect(fixture.label).toBe(kase.label);
      expect(fixture.response.outputText).toBe(JSON.stringify(kase.output));
    });

    it(`${kase.label}: the replayed output survives this tier's own validator`, () => {
      // The reason the browser proof can trust these: the hand-authored
      // output is checked against the SAME allowlist the server applies to a
      // real model answer.
      const outputText = JSON.stringify(kase.output);
      expect(validateCbsCopilotOutput(outputText)).toEqual(kase.output);
    });
  }
});

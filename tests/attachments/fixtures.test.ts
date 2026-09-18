// The drift guard for the own-data LLM fixtures (session 113, co-pilot
// phase 2, Task 9).
//
// The real-browser proof (web/e2e/own-data-copilot.spec.ts) is hermetic only
// as long as the committed fixtures still match the requests the app builds.
// A prompt edit, a schema change, a model change or a capabilities change all
// move the request hash — and the llm-stub would then either miss (a 400 the
// spec surfaces as a failure) or, worse, fall back to its question-only match
// and replay something that no longer belongs to that request. This test
// fails FIRST, in the unit suite, with the instruction to re-run
// `npm run attachments:fixtures`.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { requestHash, type RecordedFixture } from '../../src/answer/llm/client.ts';
import { validateCopilotOutput } from '../../src/attachments/copilot/schema.ts';
import { buildDatasetProfile } from '../../src/attachments/ingest/profile.ts';
import { parseCsv } from '../../src/attachments/ingest/csv.ts';
import { validateInstruction } from '../../src/attachments/instruct/schema.ts';
import { buildCaseRequest, FIXTURES_DIR } from '../../scripts/attachments-fixtures.ts';
import { CASES } from '../fixtures/attachments/cases.ts';

const CSV_DIR = fileURLToPath(new URL('../fixtures/attachments', import.meta.url));

function readFixture(hash: string): RecordedFixture {
  const file = resolve(FIXTURES_DIR, `${hash}.json`);
  expect(
    existsSync(file),
    `no committed fixture for request hash ${hash} — run \`npm run attachments:fixtures\``,
  ).toBe(true);
  return JSON.parse(readFileSync(file, 'utf8')) as RecordedFixture;
}

describe('own-data LLM fixtures', () => {
  it('has four cases over one CSV', () => {
    expect(CASES).toHaveLength(4);
    expect(CASES.map((c) => c.kind)).toEqual(['instruct', 'copilot', 'copilot', 'copilot']);
    expect(new Set(CASES.map((c) => c.csv))).toEqual(new Set(['verkoop.csv']));
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
      // real model answer, over the real profile of the real CSV.
      const profile = buildDatasetProfile(parseCsv(readFileSync(resolve(CSV_DIR, kase.csv), 'utf8')).cells);
      const outputText = JSON.stringify(kase.output);
      if (kase.kind === 'instruct') expect(validateInstruction(outputText, profile)).toEqual(kase.output);
      else expect(validateCopilotOutput(outputText, profile)).toEqual(kase.output);
    });
  }
});

// Table-parser calibration replay (session 153, 2026-10-01) — the hermetic,
// CI-side counterpart of `npm run tableparse:eval -- --replay`. Runs the REAL
// tableParse() (request build → ReplayLlmClient over the committed fixtures
// → validation → the seasonal-adjustment rule) for every case in
// benchmark/tableparse-labelled-set.json and scores it exactly as the eval
// script does.
//
// Zero LLM spend: the fixtures were recorded live with claude-sonnet-5 in
// the owner-supervised session 153 (second, stability run). A change to the
// prompt bytes, the request shape or a schema fixture shifts the request
// hash, replay misses, and this test fails — forcing a re-record
// (`TABLEPARSE_RECORD_OK=1 npm run tableparse:record`), the fit-replay
// precedent.
//
// The six known misses are pinned BY NAME, so a change in either direction
// is visible. None of them shows a number (measured, session 153): two are
// 'geen' refusals with a breakdown or period mismatch, three read "op 1
// januari JJJJ" as a one-day date range (refused as an unsupported period),
// one names "Caribisch Nederland" as a land (refused), and the gross/net
// labour-participation case sits under the 0.6 accept threshold (refused).
import { describe, expect, it } from 'vitest';
import { ReplayLlmClient } from '../../../src/answer/llm/client.ts';
import { loadLabelledSet, scoreCase } from '../../../scripts/tableparse-eval.ts';
import { fileURLToPath } from 'node:url';

const FIXTURES_DIR = fileURLToPath(new URL('../../fixtures/llm/tableparse', import.meta.url));

const KNOWN_MISSES = [
  'followup-bevolking-plaats',
  'followup-onderwerpwissel-geen',
  'geen-water-afval',
  'region-amsterdam-bevolking',
  'total-arbeidsdeelname-generiek',
  'total-caribisch-bloeddruk',
];

describe('table-parse calibration — replay of the recorded labelled set', () => {
  it('replays every labelled case; exactly the pinned known misses fail', async () => {
    const client = new ReplayLlmClient(FIXTURES_DIR);
    const failing: string[] = [];
    const cases = loadLabelledSet().cases;
    for (const c of cases) {
      const scored = await scoreCase(client, c);
      if (!scored.pass) failing.push(c.id);
    }
    expect(cases.length).toBe(50);
    expect(failing.sort()).toEqual(KNOWN_MISSES);
  });
});

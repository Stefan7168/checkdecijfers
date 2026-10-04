// Eurostat table-parser calibration replay (session 153, #357 study step 4) —
// the CI-side counterpart of `npm run tableparse:eval -- --eurostat --replay`.
// Runs the REAL tableParse() over benchmark/eurostat-tableparse-set.json, each
// table laid out by the production structure reader from the captured
// Eurostat structure, against fixtures recorded live with the mid tier in the
// owner-supervised session 153. Zero spend; a prompt, request or layout change
// shifts the hash, replay misses, and this fails — forcing a re-record
// (`TABLEPARSE_RECORD_OK=1 npm run tableparse:record -- --eurostat`).
//
// The two known misses are pinned BY NAME. None shows an invented number:
// E3 (youth unemployment, 15–25) reads the age as 'anders' → a button question;
// E11 picked the seasonally adjusted GDP series (SA) where the headline is
// seasonally AND calendar adjusted (SCA) — a real, labelled cell. Re-recorded
// 2026-10-04 (session 154, prompt v5 — the owner-signed wording + the headline-
// figure MAAT line): E4/E5 (rate vs count for "hoe hoog was de werkloosheid")
// pass — they had slipped back to "x 1 000 personen" under the wording-only v5;
// E7 (Beieren) now passes too.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ReplayLlmClient } from '../../../src/answer/llm/client.ts';
import { scoreCase, type LabelledSet } from '../../../scripts/tableparse-eval.ts';

const FIXTURES_DIR = fileURLToPath(new URL('../../fixtures/llm/tableparse-eurostat', import.meta.url));
const SET = JSON.parse(
  readFileSync(new URL('../../../benchmark/eurostat-tableparse-set.json', import.meta.url), 'utf8'),
) as LabelledSet;

// E8–E10 (asylum) were misses until #365 kept the all-citizenships TOTAL;
// re-recorded 2026-10-02, all three pass.
const KNOWN_MISSES = ['E11', 'E3'];

describe('Eurostat table-parse calibration — replay of the recorded set', () => {
  it('replays every case; exactly the pinned known misses fail', async () => {
    const client = new ReplayLlmClient(FIXTURES_DIR);
    const failing: string[] = [];
    for (const c of SET.cases) {
      expect(c.table.startsWith('eurostat:')).toBe(true);
      const scored = await scoreCase(client, c);
      if (!scored.pass) failing.push(c.id);
    }
    expect(SET.cases.length).toBe(17);
    expect(failing.sort()).toEqual(KNOWN_MISSES);
  });
});

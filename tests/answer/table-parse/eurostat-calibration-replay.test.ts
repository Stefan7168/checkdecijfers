// Eurostat table-parser calibration replay (session 153, #357 study step 4) —
// the CI-side counterpart of `npm run tableparse:eval -- --eurostat --replay`.
// Runs the REAL tableParse() over benchmark/eurostat-tableparse-set.json, each
// table laid out by the production structure reader from the captured
// Eurostat structure, against fixtures recorded live with the mid tier in the
// owner-supervised session 153. Zero spend; a prompt, request or layout change
// shifts the hash, replay misses, and this fails — forcing a re-record
// (`TABLEPARSE_RECORD_OK=1 npm run tableparse:record -- --eurostat`).
//
// The four known misses are pinned BY NAME. None shows an invented number:
// E7 (Beieren, below country level) and E10 (minors asking asylum in België)
// read 'geen' → refused; E9 chose 'anders' on citizenship → asked/refused —
// both asylum misses follow from the licence rule withholding the
// all-citizenships total (ADR 048 addendum (d), restrictive reading); E4 picked
// the count (thousand persons) instead of the rate for "hoe hoog was de
// werkloosheid" — a real cell with its unit stated, the wrong kind of figure.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ReplayLlmClient } from '../../../src/answer/llm/client.ts';
import { scoreCase, type LabelledSet } from '../../../scripts/tableparse-eval.ts';

const FIXTURES_DIR = fileURLToPath(new URL('../../fixtures/llm/tableparse-eurostat', import.meta.url));
const SET = JSON.parse(
  readFileSync(new URL('../../../benchmark/eurostat-tableparse-set.json', import.meta.url), 'utf8'),
) as LabelledSet;

const KNOWN_MISSES = ['E10', 'E4', 'E7', 'E9'];

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

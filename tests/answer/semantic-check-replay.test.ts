// #144 (ADR 034): the CALIBRATED checker behavior, pinned hermetically — the
// replay leg the supervised go-live step added (RUNBOOK § "#144 semantic
// checker", step 2). Replays the committed fixtures
// (tests/fixtures/llm/semantic-check/, recorded 2026-07-16, prompt v2,
// measured 9/9 FP=0 FN=0 flips=0 at --repeat=3) against the labelled set: a
// prompt/schema/model change re-keys the request hashes and fails loudly
// with the re-record instruction (ADR 012 — a fixture can never be silently
// replayed against a changed prompt).
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ReplayLlmClient } from '../../src/answer/llm/client.ts';
import { runSemanticCheck } from '../../src/answer/compose/semantic-check.ts';
import { SEMANTIC_CHECK_CASES } from '../helpers/semantic-check-cases.ts';

const FIXTURES = fileURLToPath(new URL('../fixtures/llm/semantic-check', import.meta.url));

describe('semantic-check calibrated behavior (replayed fixtures, ADR 034 §6)', () => {
  it('every labelled case reproduces its calibrated verdict: fabricated rejects, clear serves', async () => {
    const client = new ReplayLlmClient(FIXTURES);
    for (const c of SEMANTIC_CHECK_CASES) {
      const outcome = await runSemanticCheck(c.body, c.result(), { client, mode: 'fail_closed' });
      // A replay error (status 'error') must fail the case loudly — it means
      // the fixtures are stale, never that the judgment changed.
      expect(outcome.record.status, `${c.id}: ${outcome.record.error ?? ''}`).toBe('ok');
      expect(outcome.reject, `${c.id} (expected ${c.expected})`).toBe(c.expected === 'fabricated');
    }
  });
});

// R8 across the #115-lever-b deploy boundary (session 29), hermetic. Rows
// stored BEFORE that session carry NO `definitionText` key in their frozen
// jsonb `attribution` object at all — `undefined` at runtime despite the
// `string | null` type. This is the SAME A1 fail-safe class WP30a applied to
// `attribution.source` (tests/audit/source-r8.test.ts); this pin was missing
// for `definitionText` and a real production row crashed reconstruction
// instead of falling back (caught live during the WP30b/WP128 post-merge
// migration window, 2026-07-12 — 87 of 91 live answer rows predate the key).
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ReplayLlmClient } from '../../src/answer/llm/client.ts';
import {
  answerQuestionAudited,
  loadAuditRecord,
  reconstructionReport,
} from '../../src/answer/audit/index.ts';
import type { AuditRecord } from '../../src/answer/audit/index.ts';
import { createIngestedDb } from '../helpers/ingested-db.ts';
import { ANSWERABLE_TASKS } from '../helpers/benchmark-intents.ts';
import { loadLabelledSet } from '../helpers/intent-expectations.ts';

const INTENT_FIXTURES = fileURLToPath(new URL('../fixtures/llm/intent', import.meta.url));
const ANSWER_FIXTURES = fileURLToPath(new URL('../fixtures/llm/answer', import.meta.url));
const REFERENCE_DATE = loadLabelledSet().referenceDate;

// B6 exercises a real definitionLabel (the fallback path this bug skips);
// none of the Phase-0 fixtures carry a real definitionText (that is an
// onboarded-only field), so the probe's job is purely the ABSENT-key crash.
const PROBES = ['B6', 'B4'] as const;

describe('R8 across the #115-lever-b boundary (absent definitionText on stored rows)', () => {
  it('a pre-session-29 row (no definitionText key at all) reconstructs without throwing, falling back to definitionLabel', async () => {
    const { db, close } = await createIngestedDb();
    try {
      for (const taskId of PROBES) {
        const audited = await answerQuestionAudited(db, ANSWERABLE_TASKS[taskId]!.question, {
          intentClient: new ReplayLlmClient(INTENT_FIXTURES),
          answerClient: new ReplayLlmClient(ANSWER_FIXTURES),
          referenceDate: REFERENCE_DATE,
        });
        if (audited.response.kind !== 'answer') throw new Error(`${taskId}: expected an answer`);

        const record = await loadAuditRecord(db, audited.auditId!);
        expect(reconstructionReport(record as AuditRecord).problems).toEqual([]);

        // Simulate the real production shape: the SAME row with the key
        // physically absent (not null) — exactly what JSON.stringify drops
        // when a pre-session-29 write never included it.
        const old = JSON.parse(JSON.stringify(record)) as AuditRecord;
        if (old.response.kind !== 'answer') throw new Error('unreachable');
        expect('definitionText' in old.response.result.attribution).toBe(true);
        delete (old.response.result.attribution as { definitionText?: string | null }).definitionText;
        expect('definitionText' in old.response.result.attribution).toBe(false);

        // Must not throw, and must reconstruct clean (the whole point).
        expect(() => reconstructionReport(old)).not.toThrow();
        expect(reconstructionReport(old).problems).toEqual([]);
      }
    } finally {
      await close();
    }
  }, 180_000);
});

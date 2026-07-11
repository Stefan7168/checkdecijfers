// R8 across the ADR 026 (WP16 sub-part 2) deploy boundary, hermetic. Refusal
// rows stored before the compose-side `input.built.onboarding ?? null`
// normalization existed (src/answer/respond/refusals.ts) never serialize the
// `onboarding` key at all for non-'onboarding_pending' reasons — `undefined`
// at runtime despite the `OnboardingEnvelope | null` type. This is the SAME
// A1 fail-safe class as source-r8.test.ts / definition-text-r8.test.ts; the
// unguarded `!== null` read falsely flagged ~73 real historical rows across
// nearly every refusal reason (caught live during the WP30b/WP128 post-merge
// migration window, 2026-07-12 — confirmed empirically: the stored envelope's
// top-level `onboarding` key is genuinely absent on those rows).
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
import { REFUSAL_TASK_QUESTIONS } from '../helpers/benchmark-intents.ts';
import { loadLabelledSet } from '../helpers/intent-expectations.ts';

const INTENT_FIXTURES = fileURLToPath(new URL('../fixtures/llm/intent', import.meta.url));
const ANSWER_FIXTURES = fileURLToPath(new URL('../fixtures/llm/answer', import.meta.url));
const REFERENCE_DATE = loadLabelledSet().referenceDate;

// B18: "Wat wordt de inflatie in 2027?" — a real 'forecast' refusal, a
// non-onboarding_pending reason whose envelope must survive the absent-key
// shape (the exact reason class measured failing in production).
const PROBE = 'B18' as const;

describe('R8 across the ADR 026 boundary (absent onboarding key on stored refusal rows)', () => {
  it('a pre-ADR-026-normalization refusal row (no onboarding key at all) reconstructs without a false mismatch', async () => {
    const { db, close } = await createIngestedDb();
    try {
      const audited = await answerQuestionAudited(db, REFUSAL_TASK_QUESTIONS[PROBE]!, {
        intentClient: new ReplayLlmClient(INTENT_FIXTURES),
        answerClient: new ReplayLlmClient(ANSWER_FIXTURES),
        referenceDate: REFERENCE_DATE,
      });
      if (audited.response.kind !== 'refusal') throw new Error(`${PROBE}: expected a refusal`);
      expect(audited.response.reason).not.toBe('onboarding_pending');

      const record = await loadAuditRecord(db, audited.auditId!);
      expect(reconstructionReport(record as AuditRecord).problems).toEqual([]);

      // Simulate the real production shape: the SAME row with the key
      // physically absent (not null) — exactly what a pre-normalization
      // compose call never included in the first place.
      const old = JSON.parse(JSON.stringify(record)) as AuditRecord;
      if (old.response.kind !== 'refusal') throw new Error('unreachable');
      expect('onboarding' in old.response).toBe(true);
      delete (old.response as { onboarding?: unknown }).onboarding;
      expect('onboarding' in old.response).toBe(false);

      expect(() => reconstructionReport(old)).not.toThrow();
      expect(reconstructionReport(old).problems).toEqual([]);
    } finally {
      await close();
    }
  }, 180_000);
});

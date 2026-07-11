// WP30a (ADR 030 A1): R8 across the source-registry deploy boundary,
// hermetic. NEW rows store `attribution.source: 'cbs'`; rows stored BEFORE
// WP30a carry NO source key in their frozen jsonb — and reconstruct.ts
// re-derives the attribution line, structural lines and the chart spec from
// that stored JSON byte-for-byte. The A1 fallback (absent → the 'cbs'
// registry entry) is what keeps every historical row reconstructing; this
// test is the regression pin the design review demanded.
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

// B6: single + factor unit + marking line. B4: series + chart (the stored
// chart spec re-derives through buildChartSpec, which now resolves the
// source registry — the null-note/attribution surface).
const PROBES = ['B6', 'B4'] as const;

describe('R8 across the WP30a boundary (A1 — absent source on stored rows)', () => {
  it('new rows carry source: cbs and reconstruct; source-stripped rows (pre-WP30a shape) reconstruct byte-identically', async () => {
    const { db, close } = await createIngestedDb();
    try {
      for (const taskId of PROBES) {
        const audited = await answerQuestionAudited(db, ANSWERABLE_TASKS[taskId]!.question, {
          intentClient: new ReplayLlmClient(INTENT_FIXTURES),
          answerClient: new ReplayLlmClient(ANSWER_FIXTURES),
          referenceDate: REFERENCE_DATE,
        });
        if (audited.response.kind !== 'answer') throw new Error(`${taskId}: expected an answer`);

        // The new row writes the registry key…
        expect(audited.response.result.attribution.source).toBe('cbs');
        const record = await loadAuditRecord(db, audited.auditId!);
        expect(reconstructionReport(record as AuditRecord).problems).toEqual([]);

        // …and a pre-WP30a row is the SAME row without the key. Everything
        // else in the stored envelope is byte-identical BY DESIGN (that is
        // the WP30a claim) — so stripping the key alone must reconstruct.
        const old = JSON.parse(JSON.stringify(record)) as AuditRecord;
        if (old.response.kind !== 'answer') throw new Error('unreachable');
        expect('source' in old.response.result.attribution).toBe(true);
        delete (old.response.result.attribution as { source?: string }).source;
        expect(reconstructionReport(old).problems).toEqual([]);
      }
    } finally {
      await close();
    }
  }, 180_000);
});

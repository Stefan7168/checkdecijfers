// #125a (ADR 031 D7): R8 across the unit-expansion deploy boundary, hermetic.
// NEW rows store the SPLICED body plus the unit_expansion record and must
// reconstruct; rows stored BEFORE #125a (no record, no expansion in the body,
// no marking line) must keep reconstructing byte-identically under the new
// code — the display hangs only off the stored DerivationRecord, so old rows
// are structurally out of its reach.
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

describe('R8 across the #125a boundary (B6, the factor-unit benchmark task)', () => {
  it('a NEW row stores the spliced body + record and reconstructs; a pre-#125a row still reconstructs', async () => {
    const { db, close } = await createIngestedDb();
    try {
      const audited = await answerQuestionAudited(db, ANSWERABLE_TASKS['B6']!.question, {
        intentClient: new ReplayLlmClient(INTENT_FIXTURES),
        answerClient: new ReplayLlmClient(ANSWER_FIXTURES),
        referenceDate: REFERENCE_DATE,
      });
      if (audited.response.kind !== 'answer') throw new Error('expected an answer');

      // The new row: spliced body, the record in the stored result, the CC BY
      // marking (D6) — and it reconstructs from the stored row alone.
      expect(audited.response.answer.body).toContain('8.204 x 1 000 (= 8.204.000)');
      expect(audited.response.result.derivations.some((d) => d.kind === 'unit_expansion')).toBe(true);
      expect(audited.response.answer.markingLine).not.toBeNull();
      const record = await loadAuditRecord(db, audited.auditId!);
      expect(reconstructionReport(record as AuditRecord).problems).toEqual([]);

      // A pre-#125a row for the SAME question: no unit_expansion in the stored
      // result, the unspliced body, no marking line (B6 carried no derivations
      // at all before this change). Old rows are frozen JSON — this rebuilds
      // exactly what the old writer stored.
      const old = JSON.parse(JSON.stringify(record)) as AuditRecord;
      if (old.response.kind !== 'answer') throw new Error('unreachable');
      old.response.result.derivations = old.response.result.derivations.filter(
        (d) => d.kind !== 'unit_expansion',
      );
      old.response.answer.body = old.response.answer.body.replace(' (= 8.204.000)', '');
      expect(old.response.answer.body).not.toContain('8.204.000');
      old.response.answer.markingLine = null;
      const oldText = [
        old.response.answer.body,
        '',
        ...(old.response.answer.definitionLine ? [old.response.answer.definitionLine] : []),
        old.response.answer.attributionLine,
      ].join('\n');
      old.response.answer.text = oldText;
      old.response.text = oldText;
      old.finalText = oldText;

      expect(reconstructionReport(old).problems).toEqual([]);
    } finally {
      await close();
    }
  }, 120_000);
});

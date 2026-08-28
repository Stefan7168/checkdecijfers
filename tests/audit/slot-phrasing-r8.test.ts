// #162 (ADR-DRAFT slot-filling, hermetic half): R8 for the slot record. The
// raw placeholder body is recorded LLM output (like `body`, no deterministic
// ground truth of its own) — but EVERYTHING around it re-derives: the slot
// map is a pure function of the stored result, and the stored body must
// re-derive byte-identically by re-filling the stored raw body through the
// deterministic filler. These tests prove (a) flag-off rows carry no
// slotPhrasing key and reconstruct untouched, (b) a flag-on slot row —
// composed by the REAL slot rung against the stored result — reconstructs,
// and (c) every tamper class fails loudly: an edited raw body, a forged slot
// map, a slot record riding a template body, a version-pin mismatch.
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ReplayLlmClient } from '../../src/answer/llm/client.ts';
import type { LlmClient } from '../../src/answer/llm/client.ts';
import {
  answerQuestionAudited,
  loadAuditRecord,
  reconstructionReport,
} from '../../src/answer/audit/index.ts';
import type { AuditRecord } from '../../src/answer/audit/index.ts';
import { composeAnswer } from '../../src/answer/compose/compose.ts';
import { baseRegionLabel } from '../../src/answer/compose/validate.ts';
import type { ValidatedResult } from '../../src/query/index.ts';
import { createIngestedDb } from '../helpers/ingested-db.ts';
import { ANSWERABLE_TASKS } from '../helpers/benchmark-intents.ts';
import { loadLabelledSet } from '../helpers/intent-expectations.ts';

const INTENT_FIXTURES = fileURLToPath(new URL('../fixtures/llm/intent', import.meta.url));
const ANSWER_FIXTURES = fileURLToPath(new URL('../fixtures/llm/answer', import.meta.url));
const REFERENCE_DATE = loadLabelledSet().referenceDate;

/** Re-sync the record's assembled texts after swapping the answer (the
 * frozen-JSON idiom from semantic-check-r8: we simulate what a different
 * writer stored). */
function rebuildTexts(record: AuditRecord): void {
  if (record.response.kind !== 'answer') throw new Error('unreachable');
  const answer = record.response.answer;
  const text = [
    answer.body,
    '',
    ...(answer.assumptionLine ? [answer.assumptionLine] : []),
    ...(answer.definitionLine ? [answer.definitionLine] : []),
    ...(answer.alternatesLine ? [answer.alternatesLine] : []),
    ...(answer.markingLine ? [answer.markingLine] : []),
    answer.attributionLine,
  ].join('\n');
  answer.text = text;
  record.response.text =
    record.response.stalenessWarning === null ? text : `${text}\n\n${record.response.stalenessWarning}`;
  record.finalText = record.response.text;
}

function clone(record: AuditRecord): AuditRecord {
  return JSON.parse(JSON.stringify(record)) as AuditRecord;
}

function stubClient(output: string): LlmClient {
  return {
    async complete() {
      return {
        outputText: output,
        model: 'stub-model',
        stopReason: 'end_turn',
        usage: { inputTokens: 11, outputTokens: 7 },
      };
    },
  };
}

describe('R8 for the slot-phrasing record (#162)', () => {
  it('flag-off rows carry no slotPhrasing key; a real slot row reconstructs; tampers fail', async () => {
    const { db, close } = await createIngestedDb();
    try {
      const audited = await answerQuestionAudited(db, ANSWERABLE_TASKS['B1']!.question, {
        intentClient: new ReplayLlmClient(INTENT_FIXTURES),
        answerClient: new ReplayLlmClient(ANSWER_FIXTURES),
        referenceDate: REFERENCE_DATE,
      });
      if (audited.response.kind !== 'answer') throw new Error('expected an answer');
      const record = (await loadAuditRecord(db, audited.auditId!)) as AuditRecord;
      if (record.response.kind !== 'answer') throw new Error('unreachable');

      // (a) The flag-off row: no slotPhrasing key anywhere, reconstructs clean.
      expect(JSON.stringify(record.response.answer)).not.toContain('slotPhrasing');
      expect(reconstructionReport(record).problems).toEqual([]);

      // (b) A flag-on slot row: compose through the REAL slot rung against the
      // stored result, store what it produced, reconstruct.
      const result = record.response.result as ValidatedResult;
      const cell = result.cells[0]!;
      const region = cell.regionLabel === null ? '' : ` voor ${baseRegionLabel(cell.regionLabel)}`;
      const rawBody = `Het gevraagde cijfer${region} in {periode1} is {waarde1}.`;
      const slotAnswer = await composeAnswer(result, { client: stubClient(rawBody), slotPhrasing: true });
      expect(slotAnswer.source).toBe('llm');
      expect(slotAnswer.slotPhrasing).toBeDefined();

      const slotRow = clone(record);
      if (slotRow.response.kind !== 'answer') throw new Error('unreachable');
      slotRow.response.answer = JSON.parse(JSON.stringify(slotAnswer)) as typeof slotRow.response.answer;
      rebuildTexts(slotRow);
      expect(reconstructionReport(slotRow).problems).toEqual([]);

      // (c1) An edited raw body no longer re-fills to the stored body.
      const editedRaw = clone(slotRow);
      if (editedRaw.response.kind !== 'answer') throw new Error('unreachable');
      editedRaw.response.answer.slotPhrasing!.rawBody = `Het cijfer${region} in {periode1} is {waarde1}.`;
      expect(reconstructionReport(editedRaw).problems).toContainEqual(
        expect.stringContaining('does not re-derive from the stored raw placeholder body'),
      );

      // (c2) A forged slot map fails byte-comparison against the re-derived one.
      const forgedMap = clone(slotRow);
      if (forgedMap.response.kind !== 'answer') throw new Error('unreachable');
      forgedMap.response.answer.slotPhrasing!.slots[0]!.resultId = 'T1:M1:forged:2024JJ00:D';
      expect(reconstructionReport(forgedMap).problems).toContainEqual(
        expect.stringContaining('slot map does not re-derive'),
      );

      // (c3) A slot record riding a template body is a contradiction.
      const onTemplate = clone(slotRow);
      if (onTemplate.response.kind !== 'answer') throw new Error('unreachable');
      onTemplate.response.answer.source = 'template';
      onTemplate.answerSource = 'template';
      expect(reconstructionReport(onTemplate).problems).toContainEqual(
        expect.stringContaining('slotPhrasing present on a template body'),
      );

      // (c4) A version this reconstructor does not handle fails loudly.
      const wrongVersion = clone(slotRow);
      if (wrongVersion.response.kind !== 'answer') throw new Error('unreachable');
      (wrongVersion.response.answer.slotPhrasing! as { schemaVersion: number }).schemaVersion = 2;
      expect(reconstructionReport(wrongVersion).problems).toContainEqual(
        expect.stringContaining('slotPhrasing schemaVersion 2'),
      );
    } finally {
      await close();
    }
  }, 120_000);
});

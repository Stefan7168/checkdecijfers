// #144 (ADR 034): R8 for the semantic-check verdict. The verdict is RECORDED,
// never re-derived (an LLM judgment has no deterministic ground truth — the
// llm_calls policy), but its SCOPE is: the suspect list is a pure function of
// the stored body + result. These tests prove (a) pre-#144 / flag-off rows
// reconstruct untouched (no semanticCheck key — the deploy boundary), (b) a
// flag-on row with a stored verdict reconstructs, and (c) every tamper class
// fails loudly: forged scope, a fabricated=true verdict riding a served body,
// an error status the fail mode forbids, a verdict on a template body.
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ReplayLlmClient } from '../../src/answer/llm/client.ts';
import {
  answerQuestionAudited,
  loadAuditRecord,
  reconstructionReport,
} from '../../src/answer/audit/index.ts';
import type { AuditRecord } from '../../src/answer/audit/index.ts';
import { findSuspectTokens } from '../../src/answer/compose/semantic-check.ts';
import type { SemanticCheckRecord } from '../../src/answer/compose/types.ts';
import type { ValidatedResult } from '../../src/query/index.ts';
import { createIngestedDb } from '../helpers/ingested-db.ts';
import { ANSWERABLE_TASKS } from '../helpers/benchmark-intents.ts';
import { loadLabelledSet } from '../helpers/intent-expectations.ts';

const INTENT_FIXTURES = fileURLToPath(new URL('../fixtures/llm/intent', import.meta.url));
const ANSWER_FIXTURES = fileURLToPath(new URL('../fixtures/llm/answer', import.meta.url));
const REFERENCE_DATE = loadLabelledSet().referenceDate;

/** Rebuild the record's assembled texts after a body edit (the frozen-JSON
 * idiom from unit-expansion-r8: we simulate what a different writer stored). */
function rebuildTexts(record: AuditRecord): void {
  if (record.response.kind !== 'answer') throw new Error('unreachable');
  const answer = record.response.answer;
  const text = [
    answer.body,
    '',
    ...(answer.definitionLine ? [answer.definitionLine] : []),
    ...(answer.markingLine ? [answer.markingLine] : []),
    answer.attributionLine,
  ].join('\n');
  answer.text = text;
  record.response.text = record.response.stalenessWarning === null ? text : `${text}\n\n${record.response.stalenessWarning}`;
  record.finalText = record.response.text;
}

function clone(record: AuditRecord): AuditRecord {
  return JSON.parse(JSON.stringify(record)) as AuditRecord;
}

describe('R8 for the semantic-check verdict (#144)', () => {
  it('flag-off rows carry no semanticCheck key and reconstruct untouched; stored flag-on rows reconstruct; tampers fail', async () => {
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

      // (a) The flag-off row: no semanticCheck key anywhere, reconstructs clean.
      expect(JSON.stringify(record.response.answer)).not.toContain('semanticCheck');
      expect(reconstructionReport(record).problems).toEqual([]);

      // (b1) A flag-on row whose body had no suspects (the measured corpus
      // norm): skipped_no_suspects reconstructs clean.
      const skipped = clone(record);
      if (skipped.response.kind !== 'answer') throw new Error('unreachable');
      const skippedRecord: SemanticCheckRecord = {
        schemaVersion: 1,
        promptVersion: 1,
        mode: 'fail_open',
        status: 'skipped_no_suspects',
        model: null,
        suspects: [],
        verdicts: null,
        error: null,
        latencyMs: null,
      };
      skipped.response.answer.semanticCheck = skippedRecord;
      expect(findSuspectTokens(skipped.response.answer.body, skipped.response.result as ValidatedResult)).toEqual([]);
      expect(reconstructionReport(skipped).problems).toEqual([]);

      // (b2) A flag-on row whose body carried one suspect and a clearing
      // verdict: append a residual-shaped (but validator-passing) sentence,
      // rebuild the assembled texts, store the matching verdict.
      const checked = clone(record);
      if (checked.response.kind !== 'answer') throw new Error('unreachable');
      checked.response.answer.body += ' Het beeld veranderde na 2025 volgens het bureau.';
      rebuildTexts(checked);
      const suspects = findSuspectTokens(checked.response.answer.body, checked.response.result as ValidatedResult);
      expect(suspects.map((s) => `${s.token}:${s.kind}`)).toEqual(['2025:period']);
      const okRecord: SemanticCheckRecord = {
        schemaVersion: 1,
        promptVersion: 1,
        mode: 'fail_open',
        status: 'ok',
        model: 'claude-haiku-4-5',
        suspects,
        verdicts: [{ id: 0, fabricated: false, reason: 'jaartal na temporele marker' }],
        error: null,
        latencyMs: 240,
      };
      checked.response.answer.semanticCheck = okRecord;
      expect(reconstructionReport(checked).problems).toEqual([]);

      // (c) Tamper classes — each must fail loudly.
      const forgedScope = clone(checked);
      if (forgedScope.response.kind !== 'answer') throw new Error('unreachable');
      forgedScope.response.answer.semanticCheck!.suspects = [];
      expect(reconstructionReport(forgedScope).problems.join('\n')).toContain('suspects do not re-derive');

      const fabricatedServed = clone(checked);
      if (fabricatedServed.response.kind !== 'answer') throw new Error('unreachable');
      fabricatedServed.response.answer.semanticCheck!.verdicts = [{ id: 0, fabricated: true, reason: 'duur' }];
      expect(reconstructionReport(fabricatedServed).problems.join('\n')).toContain('fabricated=true');

      const partialVerdicts = clone(checked);
      if (partialVerdicts.response.kind !== 'answer') throw new Error('unreachable');
      partialVerdicts.response.answer.semanticCheck!.verdicts = [];
      expect(reconstructionReport(partialVerdicts).problems.join('\n')).toContain('cover the suspects exactly once');

      const skippedWithSuspects = clone(checked);
      if (skippedWithSuspects.response.kind !== 'answer') throw new Error('unreachable');
      skippedWithSuspects.response.answer.semanticCheck = { ...okRecord, status: 'skipped_no_suspects' };
      expect(reconstructionReport(skippedWithSuspects).problems.join('\n')).toContain('skipped_no_suspects');

      const errorUnderFailClosed = clone(checked);
      if (errorUnderFailClosed.response.kind !== 'answer') throw new Error('unreachable');
      errorUnderFailClosed.response.answer.semanticCheck = {
        ...okRecord,
        status: 'error',
        mode: 'fail_closed',
        model: null,
        verdicts: null,
        error: 'api down',
      };
      expect(reconstructionReport(errorUnderFailClosed).problems.join('\n')).toContain('requires fail_open');

      // A valid fail_open error row DOES reconstruct (the served-on-outage case).
      const errorFailOpen = clone(checked);
      if (errorFailOpen.response.kind !== 'answer') throw new Error('unreachable');
      errorFailOpen.response.answer.semanticCheck = {
        ...okRecord,
        status: 'error',
        mode: 'fail_open',
        model: null,
        verdicts: null,
        error: 'api down',
      };
      expect(reconstructionReport(errorFailOpen).problems).toEqual([]);

      const onTemplate = clone(checked);
      if (onTemplate.response.kind !== 'answer') throw new Error('unreachable');
      onTemplate.response.answer.source = 'template';
      onTemplate.answerSource = 'template';
      onTemplate.response.answer.model = null;
      expect(reconstructionReport(onTemplate).problems.join('\n')).toContain('template body');

      const unknownStatus = clone(checked);
      if (unknownStatus.response.kind !== 'answer') throw new Error('unreachable');
      (unknownStatus.response.answer.semanticCheck as { status: string }).status = 'approved';
      expect(reconstructionReport(unknownStatus).problems.join('\n')).toContain("unknown semanticCheck status 'approved'");

      const wrongVersion = clone(checked);
      if (wrongVersion.response.kind !== 'answer') throw new Error('unreachable');
      (wrongVersion.response.answer.semanticCheck as { schemaVersion: number }).schemaVersion = 99;
      expect(reconstructionReport(wrongVersion).problems.join('\n')).toContain('schemaVersion 99');
    } finally {
      await close();
    }
  }, 120_000);
});
